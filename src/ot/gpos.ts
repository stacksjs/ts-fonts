import type { LayoutHeader } from './layout-common'
import { coverageIndex, lookupsForFeature, readClassDef, readUint16 } from './layout-common'

/**
 * Simple kerning lookup table parsed from GPOS pair-positioning subtables.
 * Only covers the common "kern" feature with pair-positioning (lookup type 2).
 */
export interface GposKerning {
  getKerningValue: (left: number, right: number) => number
}

interface PairFormat1 {
  kind: 1
  cov: (g: number) => number
  pairSets: Array<Map<number, number>>
}

interface PairFormat2 {
  kind: 2
  cov: (g: number) => number
  classDef1Off: number
  classDef2Off: number
  class1Count: number
  class2Count: number
  values: Int32Array
  view: DataView
}

type PairLookup = PairFormat1 | PairFormat2

/** A single-glyph positioning adjustment (GPOS lookup type 1). */
export interface SinglePos {
  glyph: number
  xPlacement: number
  yPlacement: number
  xAdvance: number
  yAdvance: number
}

/** Read all type-1 (single positioning) lookups for a given feature. */
export function readGposSinglePositioning(
  view: DataView,
  header: LayoutHeader,
  feature: string,
  script = 'DFLT',
  language = 'dflt',
): SinglePos[] {
  const out: SinglePos[] = []
  const lookupIdxs = lookupsForFeature(header, feature, script, language)
  for (const idx of lookupIdxs) {
    const lookup = header.lookupList[idx]
    if (!lookup || lookup.lookupType !== 1) continue
    for (const sub of lookup.subTables)
      parseSinglePos(view, sub.offset, out)
  }
  return out
}

function parseSinglePos(view: DataView, offset: number, out: SinglePos[]): void {
  const format = readUint16(view, offset)
  const coverageOff = offset + readUint16(view, offset + 2)
  const valueFormat = readUint16(view, offset + 4)
  const glyphs: number[] = []
  const formatCov = readUint16(view, coverageOff)
  if (formatCov === 1) {
    const count = readUint16(view, coverageOff + 2)
    for (let i = 0; i < count; i++) glyphs.push(readUint16(view, coverageOff + 4 + i * 2))
  }
  else if (formatCov === 2) {
    const count = readUint16(view, coverageOff + 2)
    for (let i = 0; i < count; i++) {
      const recOff = coverageOff + 4 + i * 6
      const start = readUint16(view, recOff)
      const end = readUint16(view, recOff + 2)
      for (let g = start; g <= end; g++) glyphs.push(g)
    }
  }

  if (format === 1) {
    const v = readValueRecord(view, offset + 6, valueFormat)
    for (const g of glyphs) out.push({ glyph: g, ...v })
  }
  else if (format === 2) {
    const valueCount = readUint16(view, offset + 6)
    const vrSize = valueFormatSize(valueFormat)
    for (let i = 0; i < valueCount && i < glyphs.length; i++) {
      const v = readValueRecord(view, offset + 8 + i * vrSize, valueFormat)
      out.push({ glyph: glyphs[i], ...v })
    }
  }
}

export function readGposKerning(
  view: DataView,
  header: LayoutHeader,
  script = 'DFLT',
  language = 'dflt',
): GposKerning | undefined {
  const lookupIdxs = lookupsForFeature(header, 'kern', script, language)
  if (lookupIdxs.length === 0) return undefined

  const pairs: PairLookup[] = []
  for (const idx of lookupIdxs) {
    const lookup = header.lookupList[idx]
    if (!lookup) continue
    if (lookup.lookupType !== 2) continue
    for (const sub of lookup.subTables)
      parsePairAdjustment(view, sub.offset, pairs)
  }

  if (pairs.length === 0) return undefined

  const getKerningValue = (left: number, right: number): number => {
    for (const p of pairs) {
      const covIdx = p.cov(left)
      if (covIdx < 0) continue
      if (p.kind === 1) {
        const set = p.pairSets[covIdx]
        if (!set) continue
        const v = set.get(right)
        if (v !== undefined) return v
      }
      else {
        const cls1 = readClassDef(p.view, p.classDef1Off, left)
        const cls2 = readClassDef(p.view, p.classDef2Off, right)
        if (cls1 >= p.class1Count || cls2 >= p.class2Count) continue
        const v = p.values[cls1 * p.class2Count + cls2]
        if (v !== 0) return v
      }
    }
    return 0
  }

  return { getKerningValue }
}

function parsePairAdjustment(view: DataView, offset: number, pairs: PairLookup[]): void {
  const format = readUint16(view, offset)
  const coverageOff = offset + readUint16(view, offset + 2)
  const valueFormat1 = readUint16(view, offset + 4)
  const valueFormat2 = readUint16(view, offset + 6)

  // Coverage lookup fn
  const cov = (g: number): number => coverageIndex(view, coverageOff, g)

  if (format === 1) {
    const pairSetCount = readUint16(view, offset + 8)
    const pairSets: Array<Map<number, number>> = []
    for (let i = 0; i < pairSetCount; i++) {
      const setOff = offset + readUint16(view, offset + 10 + i * 2)
      const pairCount = readUint16(view, setOff)
      const map = new Map<number, number>()
      const recordSize = 2 + valueFormatSize(valueFormat1) + valueFormatSize(valueFormat2)
      for (let j = 0; j < pairCount; j++) {
        const recOff = setOff + 2 + j * recordSize
        const secondGlyph = readUint16(view, recOff)
        const v1 = readValueRecord(view, recOff + 2, valueFormat1)
        map.set(secondGlyph, v1.xAdvance)
        // v2 is the adjustment to the second glyph — not used for kerning pairs
        void valueFormat2
      }
      pairSets.push(map)
    }
    pairs.push({ kind: 1, cov, pairSets })
  }
  else if (format === 2) {
    const classDef1Off = offset + readUint16(view, offset + 8)
    const classDef2Off = offset + readUint16(view, offset + 10)
    const class1Count = readUint16(view, offset + 12)
    const class2Count = readUint16(view, offset + 14)
    const recordSize = valueFormatSize(valueFormat1) + valueFormatSize(valueFormat2)
    const values = new Int32Array(class1Count * class2Count)
    for (let c1 = 0; c1 < class1Count; c1++) {
      for (let c2 = 0; c2 < class2Count; c2++) {
        const idx = c1 * class2Count + c2
        const recOff = offset + 16 + idx * recordSize
        const v1 = readValueRecord(view, recOff, valueFormat1)
        values[idx] = v1.xAdvance
      }
    }
    pairs.push({ kind: 2, cov, classDef1Off, classDef2Off, class1Count, class2Count, values, view })
  }
}

interface ValueRecord {
  xPlacement: number
  yPlacement: number
  xAdvance: number
  yAdvance: number
}

function readValueRecord(view: DataView, offset: number, format: number): ValueRecord {
  let off = offset
  const vr: ValueRecord = { xPlacement: 0, yPlacement: 0, xAdvance: 0, yAdvance: 0 }
  if (format & 0x0001) { vr.xPlacement = view.getInt16(off, false); off += 2 }
  if (format & 0x0002) { vr.yPlacement = view.getInt16(off, false); off += 2 }
  if (format & 0x0004) { vr.xAdvance = view.getInt16(off, false); off += 2 }
  if (format & 0x0008) { vr.yAdvance = view.getInt16(off, false); off += 2 }
  return vr
}

function valueFormatSize(format: number): number {
  let count = 0
  for (let i = 0; i < 8; i++)
    if (format & (1 << i)) count++
  return count * 2
}
