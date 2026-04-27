/**
 * GPOS table writer. Currently emits Pair Positioning Format 1 (lookup
 * type 2) — the standard "kerning pairs" path that web/desktop type
 * engines consume by default.
 *
 * The implementation mirrors `tables/gsub.ts` in shape and machinery so
 * the layout-common offsets / ScriptList / FeatureList code can stay
 * focused.
 */

import type { Writer } from '../../io/writer'
import type { GposAuthoring, GposPairEntry, GposValueRecord, TTFObject } from '../../types'

function pad2(n: number): number { return (n + 1) & ~1 }
function tagBytes(tag: string): [number, number, number, number] {
  const padded = `${tag}    `.slice(0, 4)
  return [padded.charCodeAt(0), padded.charCodeAt(1), padded.charCodeAt(2), padded.charCodeAt(3)]
}

/** Coverage Format 1 — sorted ascending. */
function buildCoverageFormat1(glyphs: number[]): { size: number, write: (w: Writer) => void } {
  const size = 4 + glyphs.length * 2
  return {
    size,
    write: (w) => {
      w.writeUint16(1)
      w.writeUint16(glyphs.length)
      for (const g of glyphs) w.writeUint16(g)
    },
  }
}

/** Bit layout for valueFormat: bit0=xPlacement, 1=yPlacement, 2=xAdvance, 3=yAdvance, … */
function valueFormatBits(v: GposValueRecord): number {
  let bits = 0
  if (v.xPlacement) bits |= 0x0001
  if (v.yPlacement) bits |= 0x0002
  if (v.xAdvance)   bits |= 0x0004
  if (v.yAdvance)   bits |= 0x0008
  return bits
}

function valueFormatSize(bits: number): number {
  let n = 0
  for (let b = bits; b !== 0; b >>>= 1) if (b & 1) n += 2
  return n
}

function writeValueRecord(w: Writer, v: GposValueRecord, bits: number): void {
  if (bits & 0x0001) w.writeInt16(Math.round(v.xPlacement ?? 0))
  if (bits & 0x0002) w.writeInt16(Math.round(v.yPlacement ?? 0))
  if (bits & 0x0004) w.writeInt16(Math.round(v.xAdvance ?? 0))
  if (bits & 0x0008) w.writeInt16(Math.round(v.yAdvance ?? 0))
}

interface PairSetEntry {
  second: number
  v1: GposValueRecord
  v2: GposValueRecord
}

function buildPairPosFormat1(entries: GposPairEntry[]): { size: number, write: (w: Writer) => void } {
  // Group entries by `first` glyph. Each group is a "PairSet" pointed to
  // from the coverage at the first-glyph's index.
  const groups = new Map<number, PairSetEntry[]>()
  for (const e of entries) {
    let arr = groups.get(e.first)
    if (!arr) { arr = []; groups.set(e.first, arr) }
    arr.push({ second: e.second, v1: e.value1, v2: e.value2 ?? {} })
  }
  // Sort within each pair-set by `second` glyph.
  for (const arr of groups.values()) arr.sort((a, b) => a.second - b.second)

  // Determine value formats (uniform across the table).
  let format1 = 0, format2 = 0
  for (const arr of groups.values()) {
    for (const p of arr) {
      format1 |= valueFormatBits(p.v1)
      format2 |= valueFormatBits(p.v2)
    }
  }
  const valueFormat1Size = valueFormatSize(format1)
  const valueFormat2Size = valueFormatSize(format2)

  const firsts = [...groups.keys()].sort((a, b) => a - b)
  const coverage = buildCoverageFormat1(firsts)

  // Layout planning
  const headerSize = 10 + firsts.length * 2 // format(2) + cov(2) + vf1(2) + vf2(2) + count(2) + offsets(2*n)
  const pairSetSizes: number[] = firsts.map((f) => {
    const arr = groups.get(f)!
    return 2 + arr.length * (2 + valueFormat1Size + valueFormat2Size)
  })
  const subtableSize = headerSize + coverage.size + pairSetSizes.reduce((a, b) => a + b, 0)

  return {
    size: pad2(subtableSize),
    write: (w) => {
      const subStart = w.offset
      w.writeUint16(1) // posFormat = 1
      const coverageOffsetPos = w.offset; w.writeUint16(0)
      w.writeUint16(format1)
      w.writeUint16(format2)
      w.writeUint16(firsts.length)
      const setOffsetsPos = w.offset
      for (let i = 0; i < firsts.length; i++) w.writeUint16(0)
      // Coverage
      const coverageOff = w.offset - subStart
      coverage.write(w)
      // PairSets
      const setOffs: number[] = []
      for (const f of firsts) {
        setOffs.push(w.offset - subStart)
        const arr = groups.get(f)!
        w.writeUint16(arr.length)
        for (const p of arr) {
          w.writeUint16(p.second)
          writeValueRecord(w, p.v1, format1)
          writeValueRecord(w, p.v2, format2)
        }
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

interface LookupPlan {
  type: number
  flag: number
  subtableSizes: number[]
  writeSubtable: (w: Writer, idx: number) => void
}

interface FeaturePlan {
  tag: string
  lookupIndices: number[]
}

interface GposPlan {
  script: string
  language: string
  lookups: LookupPlan[]
  features: FeaturePlan[]
}

function planGpos(authored: GposAuthoring): GposPlan {
  const script = authored.script ?? 'DFLT'
  const language = authored.language ?? 'dflt'
  const lookups: LookupPlan[] = []
  const features: FeaturePlan[] = []

  for (const tag of Object.keys(authored.features)) {
    const feat = authored.features[tag]!
    const indices: number[] = []
    if (feat.pairs && feat.pairs.length > 0) {
      const sub = buildPairPosFormat1(feat.pairs)
      lookups.push({
        type: 2, flag: 0,
        subtableSizes: [sub.size],
        writeSubtable: (w, idx) => { if (idx === 0) sub.write(w) },
      })
      indices.push(lookups.length - 1)
    }
    if (indices.length > 0) features.push({ tag, lookupIndices: indices })
  }

  return { script, language, lookups, features }
}

function totalGposSize(plan: GposPlan): number {
  let n = 10 // header
  // ScriptList
  n += 2 + 6 + 4 + (6 + 2 * plan.features.length)
  // FeatureList
  let featureListBytes = 2 + 6 * plan.features.length
  for (const f of plan.features) featureListBytes += 4 + 2 * f.lookupIndices.length
  n += featureListBytes
  // LookupList
  let lookupListBytes = 2 + 2 * plan.lookups.length
  for (const lk of plan.lookups) {
    lookupListBytes += 6 + 2 * lk.subtableSizes.length
    for (const s of lk.subtableSizes) lookupListBytes += s
  }
  n += lookupListBytes
  return pad2(n)
}

export function gposSize(ttf: TTFObject): number {
  if (!ttf.gpos) return 0
  const plan = planGpos(ttf.gpos)
  if (plan.features.length === 0 || plan.lookups.length === 0) return 0
  return totalGposSize(plan)
}

export function writeGpos(writer: Writer, ttf: TTFObject): void {
  if (!ttf.gpos) return
  const plan = planGpos(ttf.gpos)
  if (plan.features.length === 0 || plan.lookups.length === 0) return

  const tableStart = writer.offset

  // Header
  writer.writeUint16(1)
  writer.writeUint16(0)
  const scriptListOffPos = writer.offset; writer.writeUint16(0)
  const featureListOffPos = writer.offset; writer.writeUint16(0)
  const lookupListOffPos = writer.offset; writer.writeUint16(0)

  // ScriptList
  const scriptListOff = writer.offset - tableStart
  writer.writeUint16(1)
  const [s0, s1, s2, s3] = tagBytes(plan.script)
  writer.writeUint8(s0); writer.writeUint8(s1); writer.writeUint8(s2); writer.writeUint8(s3)
  const scriptOffPos = writer.offset; writer.writeUint16(0)
  const scriptOff = writer.offset - tableStart - scriptListOff
  {
    const s = writer.offset; writer.seek(scriptOffPos); writer.writeUint16(scriptOff); writer.seek(s)
  }
  writer.writeUint16(4)
  writer.writeUint16(0)
  writer.writeUint16(0)
  writer.writeUint16(0xFFFF)
  writer.writeUint16(plan.features.length)
  for (let i = 0; i < plan.features.length; i++) writer.writeUint16(i)

  // FeatureList
  const featureListOff = writer.offset - tableStart
  writer.writeUint16(plan.features.length)
  const featureRecOffsetPositions: number[] = []
  for (const f of plan.features) {
    const [t0, t1, t2, t3] = tagBytes(f.tag)
    writer.writeUint8(t0); writer.writeUint8(t1); writer.writeUint8(t2); writer.writeUint8(t3)
    featureRecOffsetPositions.push(writer.offset)
    writer.writeUint16(0)
  }
  for (let fi = 0; fi < plan.features.length; fi++) {
    const featAbs = writer.offset - tableStart
    const featRel = featAbs - featureListOff
    {
      const s = writer.offset; writer.seek(featureRecOffsetPositions[fi]!); writer.writeUint16(featRel); writer.seek(s)
    }
    writer.writeUint16(0) // featureParams
    const f = plan.features[fi]!
    writer.writeUint16(f.lookupIndices.length)
    for (const idx of f.lookupIndices) writer.writeUint16(idx)
  }

  // LookupList
  const lookupListOff = writer.offset - tableStart
  writer.writeUint16(plan.lookups.length)
  const lookupOffsetPositions: number[] = []
  for (let i = 0; i < plan.lookups.length; i++) {
    lookupOffsetPositions.push(writer.offset)
    writer.writeUint16(0)
  }
  for (let li = 0; li < plan.lookups.length; li++) {
    const lookupAbs = writer.offset - tableStart
    const lookupRel = lookupAbs - lookupListOff
    {
      const s = writer.offset; writer.seek(lookupOffsetPositions[li]!); writer.writeUint16(lookupRel); writer.seek(s)
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
    for (let s = 0; s < lk.subtableSizes.length; s++) {
      const subAbs = writer.offset - tableStart
      const subRel = subAbs - (lookupTableStart - tableStart)
      {
        const sv = writer.offset; writer.seek(subtableOffsetPositions[s]!); writer.writeUint16(subRel); writer.seek(sv)
      }
      lk.writeSubtable(writer, s)
    }
  }

  const end = writer.offset
  writer.seek(scriptListOffPos); writer.writeUint16(scriptListOff)
  writer.seek(featureListOffPos); writer.writeUint16(featureListOff)
  writer.seek(lookupListOffPos); writer.writeUint16(lookupListOff)
  writer.seek(end)
  if ((writer.offset - tableStart) & 1) writer.writeUint8(0)
}
