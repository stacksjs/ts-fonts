import type { Glyph, InstanceOptions, TTFObject, VariationAxis } from '../types'
import { tupleScalar } from '../ttf/tables/gvar'
import { iupDelta, type IupDelta } from './iup'

/**
 * Normalize a user-space coordinate to the -1..+1 normalized design-space range.
 * Per OpenType spec: the default value maps to 0, the min to -1, the max to +1,
 * with piecewise-linear interpolation.
 */
export function normalizeAxisValue(axis: VariationAxis, userValue: number): number {
  const v = Math.max(axis.minValue, Math.min(axis.maxValue, userValue))
  if (v === axis.defaultValue)
    return 0
  if (v < axis.defaultValue)
    return (v - axis.defaultValue) / (axis.defaultValue - axis.minValue)
  return (v - axis.defaultValue) / (axis.maxValue - axis.defaultValue)
}

/**
 * Apply the avar segment map (if any) to a normalized coordinate.
 */
export function applyAvarMap(normalized: number, correspondence?: Array<{ fromCoordinate: number, toCoordinate: number }>): number {
  if (!correspondence || correspondence.length === 0)
    return normalized
  if (normalized <= correspondence[0].fromCoordinate)
    return correspondence[0].toCoordinate
  for (let i = 1; i < correspondence.length; i++) {
    const prev = correspondence[i - 1]
    const curr = correspondence[i]
    if (normalized <= curr.fromCoordinate) {
      const t = (normalized - prev.fromCoordinate) / (curr.fromCoordinate - prev.fromCoordinate)
      return prev.toCoordinate + t * (curr.toCoordinate - prev.toCoordinate)
    }
  }
  return correspondence[correspondence.length - 1].toCoordinate
}

/**
 * Return an axis-tag keyed map of normalized coordinates.
 */
export function normalizeCoordinates(ttf: TTFObject, userCoords: Record<string, number>): Record<string, number> {
  if (!ttf.fvar) return {}
  const out: Record<string, number> = {}
  for (const axis of ttf.fvar.axes) {
    const requested = userCoords[axis.tag] ?? axis.defaultValue
    let normalized = normalizeAxisValue(axis, requested)
    const segMap = ttf.avar?.axisSegmentMaps.find(m => m.axisTag === axis.tag)
    if (segMap)
      normalized = applyAvarMap(normalized, segMap.correspondence)
    out[axis.tag] = normalized
  }
  return out
}

/**
 * Produce an axis-indexed array of normalized coordinates in the
 * same order as fvar.axes (gvar stores tuples that way).
 */
export function normalizedCoordsArray(ttf: TTFObject, userCoords: Record<string, number>): number[] {
  if (!ttf.fvar) return []
  const normalized = normalizeCoordinates(ttf, userCoords)
  return ttf.fvar.axes.map(a => normalized[a.tag] ?? 0)
}

function nearestRefInContour(localRefs: number[], from: number, step: number, n: number): number | null {
  // Walk the contour (circular) in the given direction from `from`,
  // returning the first index that is in `localRefs`.
  if (localRefs.length === 0) return null
  for (let k = 1; k < n; k++) {
    const j = ((from + step * k) % n + n) % n
    if (localRefs.includes(j)) return j
  }
  return null
}

/**
 * Apply gvar glyph-variation deltas to a glyph's contours based on the
 * provided normalized coordinate vector. Returns a NEW glyph object.
 *
 * Accounts for the 4 phantom points (LSB, advance, TSB, vertical advance)
 * that gvar tuples target after the real contour points; we compute their
 * implied deltas to adjust advanceWidth / leftSideBearing.
 */
export function applyGvarToGlyph(
  originalGlyph: Glyph,
  variationTuples: NonNullable<TTFObject['gvar']>['glyphVariations'][number],
  normalizedCoords: number[],
): Glyph {
  if (!originalGlyph.contours || originalGlyph.contours.length === 0)
    return originalGlyph

  const contours = originalGlyph.contours
  const totalRealPoints = contours.reduce((s, c) => s + c.length, 0)
  const totalPoints = totalRealPoints + 4 // phantom points
  const accDeltas: Array<{ x: number, y: number }> = Array.from({ length: totalPoints }, () => ({ x: 0, y: 0 }))

  for (const tuple of variationTuples.tuples) {
    const scalar = tupleScalar(tuple, normalizedCoords)
    if (scalar === 0) continue

    // Reconstruct this tuple's per-point deltas. Sparse tuples fill in
    // unreferenced contour points via IUP before scaling.
    const tupleDeltas: IupDelta[] = Array.from({ length: totalPoints }, () => ({ x: 0, y: 0 }))
    if (tuple.pointIndices) {
      // Seed reference points.
      const refIdxSet = new Set<number>()
      for (let i = 0; i < tuple.pointIndices.length; i++) {
        const idx = tuple.pointIndices[i]!
        const d = tuple.deltas[i]
        if (!d || idx >= totalPoints) continue
        tupleDeltas[idx] = { x: d.x, y: d.y }
        refIdxSet.add(idx)
      }
      // IUP-reconstruct unreferenced points within each contour.
      let cursor = 0
      for (const contour of contours) {
        const n = contour.length
        const localRefs: number[] = []
        for (let i = 0; i < n; i++) {
          if (refIdxSet.has(cursor + i)) localRefs.push(i)
        }
        if (localRefs.length === 0) {
          // No references for this contour — every point stays at zero delta.
        }
        else if (localRefs.length === 1) {
          // One reference: every other point inherits its delta.
          const r = localRefs[0]!
          const d = tupleDeltas[cursor + r]!
          for (let i = 0; i < n; i++) {
            if (i === r) continue
            tupleDeltas[cursor + i] = { x: d.x, y: d.y }
          }
        }
        else {
          // ≥2 refs — per OT spec, flanking in contour-traversal order.
          for (let i = 0; i < n; i++) {
            if (refIdxSet.has(cursor + i)) continue
            const before = nearestRefInContour(localRefs, i, -1, n)!
            const after = nearestRefInContour(localRefs, i, +1, n)!
            tupleDeltas[cursor + i] = iupDelta(
              contour[i]!,
              { pos: contour[before]!, delta: tupleDeltas[cursor + before]! },
              { pos: contour[after]!, delta: tupleDeltas[cursor + after]! },
            )
          }
        }
        cursor += n
      }
      // Phantom points are handled by explicit entries only; unreferenced
      // phantoms stay at zero (no interpolation across them).
    }
    else {
      for (let i = 0; i < Math.min(tuple.deltas.length, totalPoints); i++) {
        tupleDeltas[i] = { x: tuple.deltas[i].x, y: tuple.deltas[i].y }
      }
    }

    for (let i = 0; i < totalPoints; i++) {
      accDeltas[i].x += tupleDeltas[i].x * scalar
      accDeltas[i].y += tupleDeltas[i].y * scalar
    }
  }

  // Apply to real contour points
  const newContours = originalGlyph.contours.map(c => c.map(p => ({ ...p })))
  let ptIdx = 0
  let xMin = Infinity, yMin = Infinity, xMax = -Infinity, yMax = -Infinity
  for (const contour of newContours) {
    for (const p of contour) {
      const d = accDeltas[ptIdx++]
      p.x = Math.round(p.x + d.x)
      p.y = Math.round(p.y + d.y)
      if (p.x < xMin) xMin = p.x
      if (p.x > xMax) xMax = p.x
      if (p.y < yMin) yMin = p.y
      if (p.y > yMax) yMax = p.y
    }
  }

  // Phantom points: LSB at idx totalRealPoints, advance at idx totalRealPoints+1
  const lsbDelta = accDeltas[totalRealPoints]
  const advDelta = accDeltas[totalRealPoints + 1]
  const newAdvance = Math.round((originalGlyph.advanceWidth ?? 0) + (advDelta.x - lsbDelta.x))
  const newLSB = Math.round((originalGlyph.leftSideBearing ?? 0) + lsbDelta.x)

  return {
    ...originalGlyph,
    contours: newContours,
    xMin: Number.isFinite(xMin) ? xMin : originalGlyph.xMin,
    yMin: Number.isFinite(yMin) ? yMin : originalGlyph.yMin,
    xMax: Number.isFinite(xMax) ? xMax : originalGlyph.xMax,
    yMax: Number.isFinite(yMax) ? yMax : originalGlyph.yMax,
    advanceWidth: newAdvance,
    leftSideBearing: newLSB,
  }
}

/**
 * Create a "static" instance of a variable font by baking in axis coordinates.
 * Applies gvar glyph deltas (when a gvar table is present) so glyph outlines
 * are interpolated to the requested coordinates. Also updates fvar axis
 * ranges, trims named instances, and optionally updates the font name.
 */
export function createInstance(ttf: TTFObject, options: InstanceOptions): TTFObject {
  if (!ttf.fvar)
    return ttf

  const normalizedArr = normalizedCoordsArray(ttf, options.coordinates)
  const cloned: TTFObject = JSON.parse(JSON.stringify(ttf))

  // Apply gvar deltas to each glyph
  if (cloned.gvar && cloned.glyf) {
    for (let i = 0; i < cloned.glyf.length; i++) {
      const gv = cloned.gvar.glyphVariations[i]
      if (!gv || gv.tuples.length === 0) continue
      cloned.glyf[i] = applyGvarToGlyph(cloned.glyf[i], gv, normalizedArr)
    }
    // After baking, remove the variation tables (static instance has no variations)
    delete cloned.gvar
    delete cloned.HVAR
    delete cloned.MVAR
  }

  // If the user supplied coords for every axis, fully strip the variation
  // tables to produce a pure static font. Otherwise clamp supplied axes and
  // keep the remainder.
  if (cloned.fvar) {
    const allAxesSpecified = cloned.fvar.axes.every(a => options.coordinates[a.tag] !== undefined)
    if (allAxesSpecified) {
      delete cloned.fvar
      delete cloned.avar
      delete cloned.STAT
    }
    else {
      for (const axis of cloned.fvar.axes) {
        const target = options.coordinates[axis.tag]
        if (target !== undefined) {
          axis.defaultValue = target
          axis.minValue = target
          axis.maxValue = target
        }
      }
      cloned.fvar.instances = cloned.fvar.instances.filter((inst) => {
        for (const [tag, val] of Object.entries(inst.coordinates)) {
          const axis = cloned.fvar!.axes.find(a => a.tag === tag)
          if (!axis) continue
          if (val < axis.minValue || val > axis.maxValue)
            return false
        }
        return true
      })
    }
  }

  // Optionally update font name (e.g. append axis values)
  if (options.updateName !== false && cloned.name) {
    const parts: string[] = []
    for (const [tag, val] of Object.entries(options.coordinates))
      parts.push(`${tag}${val}`)
    if (parts.length > 0) {
      const suffix = parts.join(' ')
      cloned.name.fontFamily = `${cloned.name.fontFamily} ${suffix}`
      cloned.name.fullName = `${cloned.name.fullName} ${suffix}`
      cloned.name.postScriptName = `${cloned.name.postScriptName}-${suffix.replace(/\s+/g, '-')}`
    }
  }

  return cloned
}

/**
 * Check whether a font is a variable font (has an fvar table).
 */
export function isVariableFont(ttf: TTFObject): boolean {
  return !!ttf.fvar && ttf.fvar.axes.length > 0
}

/**
 * List all axis tags in a variable font.
 */
export function listAxes(ttf: TTFObject): VariationAxis[] {
  return ttf.fvar?.axes ?? []
}

/**
 * List all named instances in a variable font.
 */
export function listNamedInstances(ttf: TTFObject): Array<{ name?: string, coordinates: Record<string, number> }> {
  return ttf.fvar?.instances.map(i => ({ name: i.name, coordinates: i.coordinates })) ?? []
}
