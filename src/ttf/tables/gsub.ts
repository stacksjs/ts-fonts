/**
 * GSUB table writer.
 *
 * Emits a minimal but spec-conformant GSUB 1.0 table that supports the set
 * of features authored via `Substitution.add()`: ligature substitution
 * (lookup type 4) and the layout common machinery (ScriptList, FeatureList,
 * LookupList) needed to expose them to a shaper.
 *
 * Future lookup types (single = 1, multiple = 2, alternate = 3, etc.) plug
 * in as new `kindWriters` entries — extend `gsubSize` and `writeGsub` in
 * lockstep.
 *
 * Spec: https://learn.microsoft.com/en-us/typography/opentype/spec/gsub
 */

import type { Writer } from '../../io/writer'
import type { GsubAlternateEntry, GsubAuthoring, GsubFeatureAuthoring, GsubLigatureEntry, GsubMultipleEntry, GsubSingleEntry, TTFObject } from '../../types'

/** Pad to 4-byte boundary; GSUB tables don't strictly require it but we keep
 * sub-table layout aligned for readability and round-trip stability. */
function pad2(n: number): number { return (n + 1) & ~1 }

interface LookupPlan {
  /** Lookup type (1, 2, 3, 4, ...). */
  type: number
  /** Lookup flag. We always emit 0. */
  flag: number
  /** Subtable byte sizes (already even-padded). */
  subtableSizes: number[]
  /** Function that writes each subtable into the writer at the right offset. */
  writeSubtable: (w: Writer, subtableIdx: number) => void
}

interface FeaturePlan {
  /** 4-character feature tag, e.g. "liga". */
  tag: string
  /** Indices into `lookups` that this feature activates. */
  lookupIndices: number[]
}

interface GsubPlan {
  script: string
  language: string
  lookups: LookupPlan[]
  features: FeaturePlan[]
}

function tagBytes(tag: string): [number, number, number, number] {
  const padded = `${tag}    `.slice(0, 4)
  return [padded.charCodeAt(0), padded.charCodeAt(1), padded.charCodeAt(2), padded.charCodeAt(3)]
}

/**
 * Build a Coverage Format 1 subtable for `glyphs` (must be sorted ascending).
 * Returns the byte size + a writer.
 */
function buildCoverageFormat1(glyphs: number[]): { size: number, write: (w: Writer) => void } {
  const size = 4 + glyphs.length * 2
  return {
    size,
    write: (w) => {
      w.writeUint16(1) // format
      w.writeUint16(glyphs.length)
      for (const g of glyphs) w.writeUint16(g)
    },
  }
}

/** Build a single Ligature Substitution Format 1 subtable. */
function buildLigatureSubtable(ligs: GsubLigatureEntry[]): { size: number, write: (w: Writer) => void } {
  // Group by first glyph (the "covered" glyph)
  const byFirst = new Map<number, GsubLigatureEntry[]>()
  for (const lig of ligs) {
    if (!lig.sub || lig.sub.length < 2) continue
    const first = lig.sub[0]!
    let arr = byFirst.get(first)
    if (!arr) { arr = []; byFirst.set(first, arr) }
    arr.push(lig)
  }
  // Coverage glyphs (sorted)
  const firsts = [...byFirst.keys()].sort((a, b) => a - b)

  // Within a LigatureSet, longer matches must come first (the shaper
  // greedy-matches in declaration order). Ties: stable.
  for (const arr of byFirst.values()) {
    arr.sort((a, b) => b.sub.length - a.sub.length)
  }

  // Layout planning:
  //   [subtable header: format(2) + coverageOffset(2) + ligatureSetCount(2) + offsets(2*n)]
  //   [coverage table]
  //   [ligature sets...] — each: [count(2) + offsets(2*ligCount) + ligature records]
  //   [ligature records...] — each: [ligGlyph(2) + componentCount(2) + components((cc-1)*2)]

  const headerSize = 6 + firsts.length * 2
  const coverage = buildCoverageFormat1(firsts)

  // Ligature record sizes per first-glyph
  const setRecordSizes: number[][] = firsts.map(g => byFirst.get(g)!.map(l => 4 + (l.sub.length - 1) * 2))
  // Ligature set sizes
  const setSizes: number[] = firsts.map((_, i) => 2 + setRecordSizes[i]!.length * 2 + setRecordSizes[i]!.reduce((s, n) => s + n, 0))

  const subtableSize = headerSize + coverage.size + setSizes.reduce((s, n) => s + n, 0)

  return {
    size: pad2(subtableSize),
    write: (w) => {
      const subStart = w.offset
      // Header
      w.writeUint16(1) // substFormat = 1
      const coverageOffsetPos = w.offset
      w.writeUint16(0) // coverageOffset placeholder
      w.writeUint16(firsts.length) // ligatureSetCount
      const ligSetOffsetsPos = w.offset
      for (let i = 0; i < firsts.length; i++) w.writeUint16(0) // placeholders

      // Coverage immediately after header
      const coverageOff = w.offset - subStart
      coverage.write(w)

      // Patch coverageOffset
      const savedEnd = w.offset
      w.seek(coverageOffsetPos)
      w.writeUint16(coverageOff)
      w.seek(savedEnd)

      // Ligature sets
      const setOffs: number[] = []
      for (let i = 0; i < firsts.length; i++) {
        const setStart = w.offset
        setOffs.push(setStart - subStart)
        const records = byFirst.get(firsts[i]!)!
        // Set header
        w.writeUint16(records.length) // ligatureCount
        const recOffsetsPos = w.offset
        for (let j = 0; j < records.length; j++) w.writeUint16(0) // placeholders

        // Records
        const recOffs: number[] = []
        for (const rec of records) {
          recOffs.push(w.offset - setStart)
          w.writeUint16(rec.by)
          w.writeUint16(rec.sub.length) // componentCount = total length
          for (let k = 1; k < rec.sub.length; k++) w.writeUint16(rec.sub[k]!)
        }

        // Patch record offsets
        const setEnd = w.offset
        w.seek(recOffsetsPos)
        for (const off of recOffs) w.writeUint16(off)
        w.seek(setEnd)
      }

      // Patch lig-set offsets
      const subEnd = w.offset
      w.seek(ligSetOffsetsPos)
      for (const off of setOffs) w.writeUint16(off)
      w.seek(subEnd)

      // Pad to even boundary
      const padded = subStart + pad2(subtableSize)
      while (w.offset < padded) w.writeUint8(0)
    },
  }
}

/**
 * Single Substitution Format 2 subtable.
 *
 * Format 2 lists a coverage of input glyphs and a parallel list of output
 * glyphs. Format 1 (delta-only) is more compact for evenly-spaced subs but
 * we use format 2 for generality.
 */
function buildSingleSubtable(entries: GsubSingleEntry[]): { size: number, write: (w: Writer) => void } {
  // Sort by `sub` so coverage is ascending.
  const sorted = [...entries].sort((a, b) => a.sub - b.sub)
  const subs = sorted.map(e => e.sub)
  const bys = sorted.map(e => e.by)
  const coverage = buildCoverageFormat1(subs)
  const headerSize = 6 + bys.length * 2
  const subtableSize = headerSize + coverage.size

  return {
    size: pad2(subtableSize),
    write: (w) => {
      const subStart = w.offset
      w.writeUint16(2) // substFormat = 2
      const coverageOffsetPos = w.offset
      w.writeUint16(0)
      w.writeUint16(bys.length)
      for (const by of bys) w.writeUint16(by)
      const coverageOff = w.offset - subStart
      coverage.write(w)
      const end = w.offset
      w.seek(coverageOffsetPos); w.writeUint16(coverageOff); w.seek(end)
      const padded = subStart + pad2(subtableSize)
      while (w.offset < padded) w.writeUint8(0)
    },
  }
}

function buildMultipleSubtable(entries: GsubMultipleEntry[]): { size: number, write: (w: Writer) => void } {
  // Group by `sub` glyph, keeping first occurrence's `by` (multi sub doesn't
  // alternate per glyph; one input maps to one fixed output sequence).
  const sorted = [...entries].sort((a, b) => a.sub - b.sub)
  const subs = sorted.map(e => e.sub)
  const sequences = sorted.map(e => e.by)
  const coverage = buildCoverageFormat1(subs)
  // Sequence sub-records are separate sub-tables-within-subtable.
  const sequenceSizes = sequences.map(seq => 2 + seq.length * 2)
  const headerSize = 6 + sequences.length * 2
  const subtableSize = headerSize + coverage.size + sequenceSizes.reduce((a, b) => a + b, 0)
  return {
    size: pad2(subtableSize),
    write: (w) => {
      const subStart = w.offset
      w.writeUint16(1) // format
      const coverageOffsetPos = w.offset
      w.writeUint16(0)
      w.writeUint16(sequences.length)
      const seqOffsetsPos = w.offset
      for (let i = 0; i < sequences.length; i++) w.writeUint16(0)
      const coverageOff = w.offset - subStart
      coverage.write(w)
      const seqOffs: number[] = []
      for (const seq of sequences) {
        seqOffs.push(w.offset - subStart)
        w.writeUint16(seq.length)
        for (const g of seq) w.writeUint16(g)
      }
      const end = w.offset
      w.seek(coverageOffsetPos); w.writeUint16(coverageOff)
      w.seek(seqOffsetsPos); for (const o of seqOffs) w.writeUint16(o)
      w.seek(end)
      const padded = subStart + pad2(subtableSize)
      while (w.offset < padded) w.writeUint8(0)
    },
  }
}

function buildAlternateSubtable(entries: GsubAlternateEntry[]): { size: number, write: (w: Writer) => void } {
  const sorted = [...entries].sort((a, b) => a.sub - b.sub)
  const subs = sorted.map(e => e.sub)
  const altSets = sorted.map(e => e.alternates)
  const coverage = buildCoverageFormat1(subs)
  const altSetSizes = altSets.map(set => 2 + set.length * 2)
  const headerSize = 6 + altSets.length * 2
  const subtableSize = headerSize + coverage.size + altSetSizes.reduce((a, b) => a + b, 0)
  return {
    size: pad2(subtableSize),
    write: (w) => {
      const subStart = w.offset
      w.writeUint16(1) // format
      const coverageOffsetPos = w.offset
      w.writeUint16(0)
      w.writeUint16(altSets.length)
      const setOffsetsPos = w.offset
      for (let i = 0; i < altSets.length; i++) w.writeUint16(0)
      const coverageOff = w.offset - subStart
      coverage.write(w)
      const setOffs: number[] = []
      for (const set of altSets) {
        setOffs.push(w.offset - subStart)
        w.writeUint16(set.length)
        for (const g of set) w.writeUint16(g)
      }
      const end = w.offset
      w.seek(coverageOffsetPos); w.writeUint16(coverageOff)
      w.seek(setOffsetsPos); for (const o of setOffs) w.writeUint16(o)
      w.seek(end)
      const padded = subStart + pad2(subtableSize)
      while (w.offset < padded) w.writeUint8(0)
    },
  }
}

function planFeature(tag: string, feat: GsubFeatureAuthoring): { lookups: LookupPlan[], featureLookupIndices: number[] } {
  const lookups: LookupPlan[] = []
  const featureLookupIndices: number[] = []

  if (feat.singles && feat.singles.length > 0) {
    const sub = buildSingleSubtable(feat.singles)
    lookups.push({
      type: 1, flag: 0, subtableSizes: [sub.size],
      writeSubtable: (w, idx) => { if (idx === 0) sub.write(w) },
    })
    featureLookupIndices.push(lookups.length - 1)
  }
  if (feat.multiples && feat.multiples.length > 0) {
    const sub = buildMultipleSubtable(feat.multiples)
    lookups.push({
      type: 2, flag: 0, subtableSizes: [sub.size],
      writeSubtable: (w, idx) => { if (idx === 0) sub.write(w) },
    })
    featureLookupIndices.push(lookups.length - 1)
  }
  if (feat.alternates && feat.alternates.length > 0) {
    const sub = buildAlternateSubtable(feat.alternates)
    lookups.push({
      type: 3, flag: 0, subtableSizes: [sub.size],
      writeSubtable: (w, idx) => { if (idx === 0) sub.write(w) },
    })
    featureLookupIndices.push(lookups.length - 1)
  }
  if (feat.ligatures && feat.ligatures.length > 0) {
    const sub = buildLigatureSubtable(feat.ligatures)
    lookups.push({
      type: 4, flag: 0, subtableSizes: [sub.size],
      writeSubtable: (w, idx) => { if (idx === 0) sub.write(w) },
    })
    featureLookupIndices.push(lookups.length - 1)
  }

  void tag
  return { lookups, featureLookupIndices }
}

function planGsub(authored: GsubAuthoring): GsubPlan {
  const script = authored.script ?? 'DFLT'
  const language = authored.language ?? 'dflt'
  const lookups: LookupPlan[] = []
  const features: FeaturePlan[] = []

  for (const tag of Object.keys(authored.features)) {
    const feat = authored.features[tag]!
    const planned = planFeature(tag, feat)
    if (planned.lookups.length === 0) continue
    const baseIdx = lookups.length
    lookups.push(...planned.lookups)
    features.push({
      tag,
      lookupIndices: planned.featureLookupIndices.map(i => baseIdx + i),
    })
  }

  return { script, language, lookups, features }
}

/** ScriptList byte size for a single script with default-language only. */
function scriptListSize(): number {
  // ScriptList: count(2) + ScriptRecord(6) → ScriptList header
  // ScriptRecord points to a Script table:
  //   defaultLangSysOffset(2) + langSysCount(2) → 4
  //   then a LangSys table: lookupOrderOffset(2) + reqIdx(2) + featCount(2) + featIndices(2*n)
  // We only fill featCount + indices; sized in featureListSize-aware caller.
  return 0 // computed in writeScriptList directly using feature count
}

function totalGsubSize(plan: GsubPlan): number {
  // Header
  let n = 10 // 4 bytes version + 3*2 offsets (script/feature/lookup lists)

  // ScriptList
  // header(2) + ScriptRecord(6) = 8
  // Script table: defaultLangSysOffset(2) + langSysCount(2) = 4
  // LangSys table: lookupOrder(2) + reqIdx(2) + featCount(2) + featIndices(2 * features.length)
  const scriptListBytes = 2 + 6 + 4 + (6 + 2 * plan.features.length)
  n += scriptListBytes

  // FeatureList
  // header(2) + FeatureRecord(6) per feature
  // Feature table per feature: featureParamsOffset(2) + lookupIndexCount(2) + lookupIndices(2*n)
  let featureListBytes = 2 + 6 * plan.features.length
  for (const f of plan.features) featureListBytes += 4 + 2 * f.lookupIndices.length
  n += featureListBytes

  // LookupList
  // header(2) + lookupOffset(2) per lookup
  let lookupListBytes = 2 + 2 * plan.lookups.length
  for (const lk of plan.lookups) {
    // Lookup table: type(2) + flag(2) + subtableCount(2) + subtableOffsets(2 * cnt)
    lookupListBytes += 6 + 2 * lk.subtableSizes.length
    for (const s of lk.subtableSizes) lookupListBytes += s
  }
  n += lookupListBytes

  return pad2(n)
}

/** Total size of a serialised GSUB table for the authored content on `ttf`. */
export function gsubSize(ttf: TTFObject): number {
  if (!ttf.gsub) return 0
  const plan = planGsub(ttf.gsub)
  if (plan.features.length === 0 || plan.lookups.length === 0) return 0
  return totalGsubSize(plan)
}

/** Serialise the GSUB table to `writer`. */
export function writeGsub(writer: Writer, ttf: TTFObject): void {
  if (!ttf.gsub) return
  const plan = planGsub(ttf.gsub)
  if (plan.features.length === 0 || plan.lookups.length === 0) return

  const tableStart = writer.offset

  // ---- Header ----
  writer.writeUint16(1) // majorVersion
  writer.writeUint16(0) // minorVersion
  const scriptListOffPos = writer.offset; writer.writeUint16(0)
  const featureListOffPos = writer.offset; writer.writeUint16(0)
  const lookupListOffPos = writer.offset; writer.writeUint16(0)

  // ---- ScriptList ----
  const scriptListOff = writer.offset - tableStart
  writer.writeUint16(1) // scriptCount
  // ScriptRecord
  const [s0, s1, s2, s3] = tagBytes(plan.script)
  writer.writeUint8(s0); writer.writeUint8(s1); writer.writeUint8(s2); writer.writeUint8(s3)
  const scriptOffPos = writer.offset; writer.writeUint16(0)
  const scriptOff = writer.offset - tableStart - scriptListOff
  // Patch the script offset (relative to start of ScriptList)
  {
    const saved = writer.offset
    writer.seek(scriptOffPos)
    writer.writeUint16(scriptOff)
    writer.seek(saved)
  }
  // Script table
  writer.writeUint16(4) // defaultLangSys offset (immediately after Script header)
  writer.writeUint16(0) // langSysCount
  // LangSys table
  writer.writeUint16(0) // lookupOrderOffset = NULL
  writer.writeUint16(0xFFFF) // requiredFeatureIndex = none
  writer.writeUint16(plan.features.length) // featureIndexCount
  for (let i = 0; i < plan.features.length; i++) writer.writeUint16(i)

  // ---- FeatureList ----
  const featureListOff = writer.offset - tableStart
  writer.writeUint16(plan.features.length)
  // FeatureRecords
  const featureRecOffsetPositions: number[] = []
  for (const f of plan.features) {
    const [t0, t1, t2, t3] = tagBytes(f.tag)
    writer.writeUint8(t0); writer.writeUint8(t1); writer.writeUint8(t2); writer.writeUint8(t3)
    featureRecOffsetPositions.push(writer.offset)
    writer.writeUint16(0) // placeholder featureOffset
  }
  // Feature tables
  for (let fi = 0; fi < plan.features.length; fi++) {
    const featAbs = writer.offset - tableStart
    const featRel = featAbs - featureListOff
    {
      const saved = writer.offset
      writer.seek(featureRecOffsetPositions[fi]!)
      writer.writeUint16(featRel)
      writer.seek(saved)
    }
    writer.writeUint16(0) // featureParamsOffset = NULL
    const f = plan.features[fi]!
    writer.writeUint16(f.lookupIndices.length)
    for (const idx of f.lookupIndices) writer.writeUint16(idx)
  }

  // ---- LookupList ----
  const lookupListOff = writer.offset - tableStart
  writer.writeUint16(plan.lookups.length)
  const lookupOffsetPositions: number[] = []
  for (let i = 0; i < plan.lookups.length; i++) {
    lookupOffsetPositions.push(writer.offset)
    writer.writeUint16(0) // placeholder lookupOffset
  }
  // Lookup tables
  for (let li = 0; li < plan.lookups.length; li++) {
    const lookupAbs = writer.offset - tableStart
    const lookupRel = lookupAbs - lookupListOff
    {
      const saved = writer.offset
      writer.seek(lookupOffsetPositions[li]!)
      writer.writeUint16(lookupRel)
      writer.seek(saved)
    }
    const lk = plan.lookups[li]!
    const lookupTableStart = writer.offset
    writer.writeUint16(lk.type)
    writer.writeUint16(lk.flag)
    writer.writeUint16(lk.subtableSizes.length)
    const subtableOffsetPositions: number[] = []
    for (let s = 0; s < lk.subtableSizes.length; s++) {
      subtableOffsetPositions.push(writer.offset)
      writer.writeUint16(0)
    }
    // Subtables
    for (let s = 0; s < lk.subtableSizes.length; s++) {
      const subAbs = writer.offset - tableStart
      const subRel = subAbs - (lookupTableStart - tableStart)
      {
        const saved = writer.offset
        writer.seek(subtableOffsetPositions[s]!)
        writer.writeUint16(subRel)
        writer.seek(saved)
      }
      lk.writeSubtable(writer, s)
    }
  }

  // Patch top-level offsets
  const tableEnd = writer.offset
  writer.seek(scriptListOffPos); writer.writeUint16(scriptListOff)
  writer.seek(featureListOffPos); writer.writeUint16(featureListOff)
  writer.seek(lookupListOffPos); writer.writeUint16(lookupListOff)
  writer.seek(tableEnd)

  // Pad table to even boundary
  if ((writer.offset - tableStart) & 1) writer.writeUint8(0)
}
