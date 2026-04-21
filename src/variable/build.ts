import type {
  FvarTable,
  GvarGlyphVariation,
  GvarTable,
  GvarTuple,
  Glyph,
  NamedInstance,
  StatAxis,
  StatAxisValue,
  StatTable,
  TTFObject,
  VariationAxis,
} from '../types'
import { normalizeAxisValue } from './instance'
import { compressTupleDeltas } from './iup'
import { packDeltas, packPointNumbers } from '../ttf/tables/gvar'

/**
 * Inputs used by `buildVariableFont`. Each master is a complete TTFObject
 * (same glyph set, same point counts per glyph, interpolation-compatible).
 * The "default" master contributes the outlines, metadata, and non-variable
 * table data — other masters contribute only geometry deltas.
 */
export interface MasterInput {
  /** The user-space location on each axis, e.g. `{ wght: 400 }`. */
  location: Record<string, number>
  /** The static master font at this location. */
  font: TTFObject
}

/** High-level axis definition supplied by the caller. */
export interface AxisInput {
  tag: string
  name: string
  minValue: number
  defaultValue: number
  maxValue: number
  flags?: number
}

/** Optional named instance to write into the fvar `instances` array. */
export interface NamedInstanceInput {
  name: string
  location: Record<string, number>
  postScriptName?: string
  flags?: number
}

export interface BuildVariableFontOptions {
  axes: AxisInput[]
  masters: MasterInput[]
  instances?: NamedInstanceInput[]
  /**
   * Whether to emit a STAT table alongside fvar. Recommended for tool
   * compatibility (macOS font-picker, font-matching heuristics).
   */
  emitStat?: boolean
  /**
   * Apply IUP (Interpolate Untouched Points) compression to gvar tuples.
   * Omits explicit deltas for points whose movement can be reconstructed
   * from flanking references — typically shrinks `gvar` by 20–40%.
   * Default: true. Set false only for debugging / golden-file comparisons.
   */
  iupCompression?: boolean
  /**
   * Max allowable per-axis deviation (em units) between actual and
   * IUP-reconstructed delta when deciding whether a point is omittable.
   * Default 0.5 — smaller values retain more references (higher fidelity,
   * less compression); larger values are more permissive (more compression,
   * sub-pixel rounding error at interior interpolation positions).
   */
  iupTolerance?: number
}

/**
 * Build a variable TTF from N point-compatible static masters.
 *
 * Requirements:
 *   - Exactly one master's `location` matches every axis `defaultValue`.
 *   - All masters have identical `glyf.length` and per-glyph point counts.
 *   - Contours have identical on/off-curve flags (they should; offsetting
 *     or parametric interpolation preserves this).
 *
 * The resulting font has fvar + gvar + (optionally) STAT. HVAR is not
 * emitted — OS rasterizers synthesize advance-width variations from the
 * gvar phantom-point deltas we encode instead.
 */
export function buildVariableFont(options: BuildVariableFontOptions): TTFObject {
  const {
    axes,
    masters,
    instances = [],
    emitStat = true,
    iupCompression = true,
    iupTolerance = 0.5,
  } = options

  if (masters.length < 2)
    throw new Error('buildVariableFont: need at least 2 masters')
  if (axes.length < 1)
    throw new Error('buildVariableFont: need at least 1 axis')

  const defaultMaster = masters.find(m =>
    axes.every(a => (m.location[a.tag] ?? a.defaultValue) === a.defaultValue),
  )
  if (!defaultMaster)
    throw new Error('buildVariableFont: no master matches the default axis location')

  const out: TTFObject = structuredClone(defaultMaster.font)

  // Assert interpolation compatibility.
  const refGlyfLen = defaultMaster.font.glyf.length
  for (const m of masters) {
    if (m.font.glyf.length !== refGlyfLen)
      throw new Error(`buildVariableFont: glyph count mismatch at location ${JSON.stringify(m.location)}`)
    for (let i = 0; i < refGlyfLen; i++) {
      const a = defaultMaster.font.glyf[i]
      const b = m.font.glyf[i]
      const aPoints = pointCount(a)
      const bPoints = pointCount(b)
      if (aPoints !== bPoints)
        throw new Error(
          `buildVariableFont: glyph "${a?.name ?? i}" has ${aPoints} points in default vs ${bPoints} at ${JSON.stringify(m.location)}`,
        )
    }
  }

  // Normalize each master's location into f2dot14 axis-order arrays.
  const normMasters = masters.map(m => ({
    location: m.location,
    font: m.font,
    coords: axes.map(a => normalizeAxisValue(axisToVariationAxis(a), m.location[a.tag] ?? a.defaultValue)),
  }))

  // Compute per-glyph deltas between each non-default master and the default,
  // then optionally compress via IUP.
  const glyphVariations: GvarGlyphVariation[] = []
  for (let gi = 0; gi < refGlyfLen; gi++) {
    const tuples: GvarTuple[] = []
    const refGlyph = defaultMaster.font.glyf[gi]!
    const contours = refGlyph.contours ?? []
    for (const m of normMasters) {
      if (m.font === defaultMaster.font) continue
      const otherGlyph = m.font.glyf[gi]!
      const deltas = diffGlyph(refGlyph, otherGlyph)
      const nonZero = deltas.some(d => d.x !== 0 || d.y !== 0)
      if (!nonZero) continue

      if (iupCompression && contours.length > 0) {
        const compressed = compressTupleDeltas(contours, deltas, iupTolerance)
        if (compressed.pointIndices.length === 0) continue // all zero within tolerance

        // Measure — IUP only wins when the pointIndices encoding + smaller
        // delta arrays beats the unsparse "one delta per point" layout.
        // For tuples with tiny deltas (mostly 1-byte), the overhead of
        // encoding pointIndices can exceed the savings. Pick per-tuple.
        const sparseBytes = packPointNumbers(compressed.pointIndices).length
          + packDeltas(compressed.deltas.map(d => Math.round(d.x))).length
          + packDeltas(compressed.deltas.map(d => Math.round(d.y))).length
        const denseBytes = packDeltas(deltas.map(d => Math.round(d.x))).length
          + packDeltas(deltas.map(d => Math.round(d.y))).length

        if (sparseBytes < denseBytes) {
          tuples.push({
            peakCoords: m.coords.slice(),
            pointIndices: compressed.pointIndices,
            deltas: compressed.deltas,
          })
        }
        else {
          tuples.push({ peakCoords: m.coords.slice(), deltas })
        }
      }
      else {
        tuples.push({
          peakCoords: m.coords.slice(),
          deltas,
        })
      }
    }
    glyphVariations.push({ tuples })
  }

  // Shared tuples: any peak coordinate that appears on ≥ 2 tuples is worth
  // hoisting — the tuple then references it by a 12-bit index (embedded in
  // flags, no extra bytes) instead of embedding axisCount × 2 bytes each
  // time. For typical single-axis fonts this is pure savings.
  const peakCounts = new Map<string, number>()
  for (const gv of glyphVariations) {
    for (const t of gv.tuples) {
      const key = t.peakCoords.map(v => v.toFixed(6)).join(',')
      peakCounts.set(key, (peakCounts.get(key) ?? 0) + 1)
    }
  }
  const sharedTuples: number[][] = []
  const sharedKeys = new Set<string>()
  for (const [key, count] of peakCounts) {
    if (count < 2) continue
    if (sharedTuples.length >= 4095) break // 12-bit index limit
    sharedTuples.push(key.split(',').map(Number))
    sharedKeys.add(key)
  }
  void sharedKeys // referenced by name in the writer

  const gvar: GvarTable = {
    majorVersion: 1,
    minorVersion: 0,
    axisCount: axes.length,
    sharedTuples,
    glyphVariations,
  }

  // Strip any pre-existing variable tables on the cloned default (these
  // would carry over if someone passed a variable font as a master).
  delete out.gvar
  delete out.HVAR
  delete out.MVAR
  delete out.avar

  // Assemble name.extra for axis + instance nameIDs starting at 256.
  let nextNameID = 256
  const extra = (out.name.extra = out.name.extra ?? [])

  const axisNameIDs: number[] = []
  for (const a of axes) {
    extra.push({ nameID: nextNameID, value: a.name })
    axisNameIDs.push(nextNameID)
    nextNameID++
  }

  const instanceRecords: NamedInstance[] = []
  for (const inst of instances) {
    // Each instance gets a subfamily nameID and (optionally) a postscript nameID.
    extra.push({ nameID: nextNameID, value: inst.name })
    const subfamilyNameID = nextNameID
    nextNameID++
    let postScriptNameID: number | undefined
    if (inst.postScriptName) {
      extra.push({ nameID: nextNameID, value: inst.postScriptName })
      postScriptNameID = nextNameID
      nextNameID++
    }
    const coordinates: Record<string, number> = {}
    for (const a of axes)
      coordinates[a.tag] = inst.location[a.tag] ?? a.defaultValue
    instanceRecords.push({
      subfamilyNameID,
      postScriptNameID,
      flags: inst.flags ?? 0,
      coordinates,
    })
  }

  const fvarAxes: VariationAxis[] = axes.map((a, i) => ({
    tag: a.tag,
    minValue: a.minValue,
    defaultValue: a.defaultValue,
    maxValue: a.maxValue,
    flags: a.flags ?? 0,
    nameID: axisNameIDs[i]!,
  }))

  const fvar: FvarTable = {
    majorVersion: 1,
    minorVersion: 0,
    axes: fvarAxes,
    instances: instanceRecords,
  }

  out.fvar = fvar
  out.gvar = gvar

  if (emitStat) {
    const designAxes: StatAxis[] = axes.map((a, i) => ({
      tag: a.tag,
      nameID: axisNameIDs[i]!,
      ordering: i,
    }))
    // Emit one StatAxisValue per named instance — a reasonable default that
    // lets platform pickers show named weights.
    const axisValues: StatAxisValue[] = []
    for (let ai = 0; ai < axes.length; ai++) {
      const a = axes[ai]!
      for (const inst of instances) {
        const v = inst.location[a.tag]
        if (v === undefined) continue
        const nameRec = extra.find(e => e.value === inst.name)
        if (!nameRec) continue
        axisValues.push({
          format: 1,
          axisIndex: ai,
          flags: inst.flags ?? 0,
          valueNameID: nameRec.nameID,
          value: v,
        })
      }
    }
    const stat: StatTable = {
      majorVersion: 1,
      minorVersion: 2,
      designAxes,
      axisValues,
    }
    out.STAT = stat
  }

  return out
}

function pointCount(g: Glyph | undefined): number {
  if (!g?.contours) return 0
  return g.contours.reduce((s, c) => s + c.length, 0)
}

function axisToVariationAxis(a: AxisInput): VariationAxis {
  return {
    tag: a.tag,
    minValue: a.minValue,
    defaultValue: a.defaultValue,
    maxValue: a.maxValue,
    flags: a.flags ?? 0,
    nameID: 0,
  }
}

/**
 * Per-point deltas between two interpolation-compatible glyphs. The first
 * N entries correspond to real contour points (in traversal order); the
 * final 4 entries are phantom points for advance-width/LSB variations:
 *   N..N+1 = left/right phantom (LSB, LSB + advanceWidth)
 *   N+2..N+3 = top/bottom phantom (vertical; we set these to zero)
 */
function diffGlyph(a: Glyph, b: Glyph): Array<{ x: number, y: number }> {
  const deltas: Array<{ x: number, y: number }> = []
  const aContours = a.contours ?? []
  const bContours = b.contours ?? []
  for (let ci = 0; ci < aContours.length; ci++) {
    const ac = aContours[ci]!
    const bc = bContours[ci] ?? ac
    for (let pi = 0; pi < ac.length; pi++) {
      const ap = ac[pi]!
      const bp = bc[pi] ?? ap
      deltas.push({ x: bp.x - ap.x, y: bp.y - ap.y })
    }
  }
  // Phantom points
  const aLSB = a.leftSideBearing ?? a.xMin
  const aAdv = a.advanceWidth ?? 0
  const bLSB = b.leftSideBearing ?? b.xMin
  const bAdv = b.advanceWidth ?? 0
  const aLeft = aLSB
  const aRight = aLSB + aAdv
  const bLeft = bLSB
  const bRight = bLSB + bAdv
  deltas.push({ x: bLeft - aLeft, y: 0 })
  deltas.push({ x: bRight - aRight, y: 0 })
  deltas.push({ x: 0, y: 0 })
  deltas.push({ x: 0, y: 0 })
  return deltas
}
