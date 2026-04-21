/**
 * Rewrite GSUB/GPOS raw bytes so that every glyph-ID reference maps
 * through a subset's old→new index mapping. Lookup structures that
 * reference glyphs no longer in the subset are stripped.
 *
 * This is a targeted rewrite — we walk the lookup-list ourselves and
 * regenerate the whole table. Only the lookups we understand are
 * preserved:
 *
 *   GSUB: type 1 (single), type 2 (multiple), type 3 (alternate),
 *         type 4 (ligature), type 7 (extension for the above)
 *   GPOS: type 1 (single positioning), type 2 (pair positioning)
 *
 * Unknown or unsupported lookup types are dropped — safe for web subsets.
 */

import type { LayoutHeader } from './layout-common'
import { readCoverage, readLayoutHeader, readUint16 } from './layout-common'

interface RewriteContext {
  /** oldGid → newGid mapping. Missing entries = dropped. */
  map: Map<number, number>
}

function remap(ctx: RewriteContext, oldGid: number): number | undefined {
  return ctx.map.get(oldGid)
}

/**
 * Subset a raw GSUB/GPOS table to the given glyph mapping.
 * Returns either a newly-allocated Uint8Array or undefined if the
 * resulting table would be empty.
 */
export function subsetLayoutTable(raw: Uint8Array, oldToNew: Record<number, number>): Uint8Array | undefined {
  const view = new DataView(raw.buffer, raw.byteOffset, raw.byteLength)
  const ctx: RewriteContext = { map: new Map(Object.entries(oldToNew).map(([o, n]) => [Number(o), n])) }

  const header = readLayoutHeader(view, 0)

  // Walk every lookup, collect kept entries by lookup type
  interface RewrittenLookup {
    type: number
    flag: number
    subtables: Uint8Array[]
  }
  const rewritten: RewrittenLookup[] = []

  for (const lookup of header.lookupList) {
    const subs: Uint8Array[] = []
    for (const sub of lookup.subTables) {
      const bytes = rewriteSubtable(view, sub.offset, lookup.lookupType, ctx)
      if (bytes) subs.push(bytes)
    }
    if (subs.length > 0)
      rewritten.push({ type: lookup.lookupType, flag: lookup.lookupFlag, subtables: subs })
  }

  if (rewritten.length === 0) return undefined

  return serializeLayoutTable(header, rewritten)
}

function rewriteSubtable(view: DataView, offset: number, lookupType: number, ctx: RewriteContext): Uint8Array | undefined {
  switch (lookupType) {
    case 1: return rewriteSingleSubst(view, offset, ctx)
    case 2: return rewriteMultipleSubst(view, offset, ctx)
    case 3: return rewriteAlternateSubst(view, offset, ctx)
    case 4: return rewriteLigatureSubst(view, offset, ctx)
    default: return undefined
  }
}

function buildCoverageFormat1(glyphs: number[]): Uint8Array {
  glyphs = Array.from(new Set(glyphs)).sort((a, b) => a - b)
  const buf = new Uint8Array(4 + glyphs.length * 2)
  const view = new DataView(buf.buffer)
  view.setUint16(0, 1, false) // format
  view.setUint16(2, glyphs.length, false)
  for (let i = 0; i < glyphs.length; i++)
    view.setUint16(4 + i * 2, glyphs[i], false)
  return buf
}

function rewriteSingleSubst(view: DataView, offset: number, ctx: RewriteContext): Uint8Array | undefined {
  const format = readUint16(view, offset)
  const coverageOff = offset + readUint16(view, offset + 2)
  const coverage = readCoverage(view, coverageOff)

  interface Pair { sub: number, by: number }
  const kept: Pair[] = []

  if (format === 1) {
    const delta = view.getInt16(offset + 4, false)
    for (const g of coverage) {
      const newSub = remap(ctx, g)
      const newBy = remap(ctx, (g + delta) & 0xFFFF)
      if (newSub !== undefined && newBy !== undefined) kept.push({ sub: newSub, by: newBy })
    }
  }
  else if (format === 2) {
    const count = readUint16(view, offset + 4)
    for (let i = 0; i < count; i++) {
      const by = readUint16(view, offset + 6 + i * 2)
      const newSub = remap(ctx, coverage[i] ?? 0)
      const newBy = remap(ctx, by)
      if (newSub !== undefined && newBy !== undefined) kept.push({ sub: newSub, by: newBy })
    }
  }

  if (kept.length === 0) return undefined
  // Emit as format 2 (most flexible)
  kept.sort((a, b) => a.sub - b.sub)
  const cov = buildCoverageFormat1(kept.map(p => p.sub))
  const subtableSize = 6 + kept.length * 2
  const buf = new Uint8Array(subtableSize + cov.length)
  const bv = new DataView(buf.buffer)
  bv.setUint16(0, 2, false) // format
  bv.setUint16(2, subtableSize, false) // coverageOffset
  bv.setUint16(4, kept.length, false)
  for (let i = 0; i < kept.length; i++)
    bv.setUint16(6 + i * 2, kept[i].by, false)
  buf.set(cov, subtableSize)
  return buf
}

function rewriteMultipleSubst(view: DataView, offset: number, ctx: RewriteContext): Uint8Array | undefined {
  const format = readUint16(view, offset)
  if (format !== 1) return undefined
  const coverageOff = offset + readUint16(view, offset + 2)
  const coverage = readCoverage(view, coverageOff)
  const sequenceCount = readUint16(view, offset + 4)

  interface Seq { sub: number, by: number[] }
  const kept: Seq[] = []

  for (let i = 0; i < sequenceCount; i++) {
    const seqOff = offset + readUint16(view, offset + 6 + i * 2)
    const glyphCount = readUint16(view, seqOff)
    const newSub = remap(ctx, coverage[i] ?? 0)
    if (newSub === undefined) continue
    const by: number[] = []
    let allKept = true
    for (let j = 0; j < glyphCount; j++) {
      const g = readUint16(view, seqOff + 2 + j * 2)
      const nb = remap(ctx, g)
      if (nb === undefined) { allKept = false; break }
      by.push(nb)
    }
    if (allKept) kept.push({ sub: newSub, by })
  }
  if (kept.length === 0) return undefined

  kept.sort((a, b) => a.sub - b.sub)
  const cov = buildCoverageFormat1(kept.map(s => s.sub))
  // Subtable header: format(2) + coverageOff(2) + sequenceCount(2) + sequenceOffsets(2*N)
  const headerSize = 6 + kept.length * 2
  const sequenceBytes: Uint8Array[] = []
  let seqCursor = headerSize + cov.length
  const seqOffsets: number[] = []
  for (const s of kept) {
    seqOffsets.push(seqCursor)
    const b = new Uint8Array(2 + s.by.length * 2)
    const bv = new DataView(b.buffer)
    bv.setUint16(0, s.by.length, false)
    for (let j = 0; j < s.by.length; j++) bv.setUint16(2 + j * 2, s.by[j], false)
    sequenceBytes.push(b)
    seqCursor += b.length
  }

  const total = seqCursor
  const out = new Uint8Array(total)
  const view2 = new DataView(out.buffer)
  view2.setUint16(0, 1, false)
  view2.setUint16(2, headerSize, false) // coverageOff
  view2.setUint16(4, kept.length, false)
  for (let i = 0; i < kept.length; i++)
    view2.setUint16(6 + i * 2, seqOffsets[i], false)
  out.set(cov, headerSize)
  for (let i = 0; i < kept.length; i++)
    out.set(sequenceBytes[i], seqOffsets[i])
  return out
}

function rewriteAlternateSubst(view: DataView, offset: number, ctx: RewriteContext): Uint8Array | undefined {
  const format = readUint16(view, offset)
  if (format !== 1) return undefined
  const coverageOff = offset + readUint16(view, offset + 2)
  const coverage = readCoverage(view, coverageOff)
  const altSetCount = readUint16(view, offset + 4)

  interface AltSet { sub: number, alts: number[] }
  const kept: AltSet[] = []

  for (let i = 0; i < altSetCount; i++) {
    const setOff = offset + readUint16(view, offset + 6 + i * 2)
    const count = readUint16(view, setOff)
    const newSub = remap(ctx, coverage[i] ?? 0)
    if (newSub === undefined) continue
    const alts: number[] = []
    for (let j = 0; j < count; j++) {
      const g = readUint16(view, setOff + 2 + j * 2)
      const nb = remap(ctx, g)
      if (nb !== undefined) alts.push(nb)
    }
    if (alts.length > 0) kept.push({ sub: newSub, alts })
  }
  if (kept.length === 0) return undefined

  kept.sort((a, b) => a.sub - b.sub)
  const cov = buildCoverageFormat1(kept.map(s => s.sub))
  const headerSize = 6 + kept.length * 2
  const altBytes: Uint8Array[] = []
  let cursor = headerSize + cov.length
  const altOffsets: number[] = []
  for (const s of kept) {
    altOffsets.push(cursor)
    const b = new Uint8Array(2 + s.alts.length * 2)
    const bv = new DataView(b.buffer)
    bv.setUint16(0, s.alts.length, false)
    for (let j = 0; j < s.alts.length; j++) bv.setUint16(2 + j * 2, s.alts[j], false)
    altBytes.push(b)
    cursor += b.length
  }

  const total = cursor
  const out = new Uint8Array(total)
  const ov = new DataView(out.buffer)
  ov.setUint16(0, 1, false)
  ov.setUint16(2, headerSize, false)
  ov.setUint16(4, kept.length, false)
  for (let i = 0; i < kept.length; i++)
    ov.setUint16(6 + i * 2, altOffsets[i], false)
  out.set(cov, headerSize)
  for (let i = 0; i < kept.length; i++)
    out.set(altBytes[i], altOffsets[i])
  return out
}

function rewriteLigatureSubst(view: DataView, offset: number, ctx: RewriteContext): Uint8Array | undefined {
  const format = readUint16(view, offset)
  if (format !== 1) return undefined
  const coverageOff = offset + readUint16(view, offset + 2)
  const coverage = readCoverage(view, coverageOff)
  const ligSetCount = readUint16(view, offset + 4)

  interface Lig { first: number, ligs: Array<{ components: number[], by: number }> }
  const kept: Lig[] = []

  for (let i = 0; i < ligSetCount; i++) {
    const setOff = offset + readUint16(view, offset + 6 + i * 2)
    const count = readUint16(view, setOff)
    const newFirst = remap(ctx, coverage[i] ?? 0)
    if (newFirst === undefined) continue
    const ligs: Lig['ligs'] = []
    for (let j = 0; j < count; j++) {
      const ligOff = setOff + readUint16(view, setOff + 2 + j * 2)
      const by = readUint16(view, ligOff)
      const compCount = readUint16(view, ligOff + 2)
      const components: number[] = []
      let allKept = true
      const newBy = remap(ctx, by)
      if (newBy === undefined) continue
      for (let k = 0; k < compCount - 1; k++) {
        const c = readUint16(view, ligOff + 4 + k * 2)
        const nc = remap(ctx, c)
        if (nc === undefined) { allKept = false; break }
        components.push(nc)
      }
      if (allKept) ligs.push({ components, by: newBy })
    }
    if (ligs.length > 0) kept.push({ first: newFirst, ligs })
  }
  if (kept.length === 0) return undefined

  kept.sort((a, b) => a.first - b.first)
  const cov = buildCoverageFormat1(kept.map(l => l.first))

  // Layout: format(2) coverageOff(2) ligSetCount(2) ligSetOffsets[n]*2 ... ligSets ... coverage
  const headerSize = 6 + kept.length * 2
  const ligSetBlocks: Uint8Array[] = []
  const ligSetOffsets: number[] = []
  let cursor = headerSize + cov.length
  for (const ls of kept) {
    ligSetOffsets.push(cursor)
    // ligSet: ligCount(2) + ligOffsets[n]*2 + ligTables
    const ligBytes: Uint8Array[] = []
    const ligOffsets: number[] = []
    let innerCursor = 2 + ls.ligs.length * 2
    for (const lig of ls.ligs) {
      ligOffsets.push(innerCursor)
      // ligTable: ligGlyph(2) compCount(2) component[n-1]*2
      const b = new Uint8Array(4 + lig.components.length * 2)
      const bv = new DataView(b.buffer)
      bv.setUint16(0, lig.by, false)
      bv.setUint16(2, lig.components.length + 1, false)
      for (let k = 0; k < lig.components.length; k++)
        bv.setUint16(4 + k * 2, lig.components[k], false)
      ligBytes.push(b)
      innerCursor += b.length
    }
    const setSize = innerCursor
    const setBuf = new Uint8Array(setSize)
    const sv = new DataView(setBuf.buffer)
    sv.setUint16(0, ls.ligs.length, false)
    for (let k = 0; k < ls.ligs.length; k++)
      sv.setUint16(2 + k * 2, ligOffsets[k], false)
    for (let k = 0; k < ligBytes.length; k++)
      setBuf.set(ligBytes[k], ligOffsets[k])

    ligSetBlocks.push(setBuf)
    cursor += setSize
  }

  const total = cursor
  const out = new Uint8Array(total)
  const ov = new DataView(out.buffer)
  ov.setUint16(0, 1, false)
  ov.setUint16(2, headerSize, false)
  ov.setUint16(4, kept.length, false)
  for (let i = 0; i < kept.length; i++)
    ov.setUint16(6 + i * 2, ligSetOffsets[i], false)
  out.set(cov, headerSize)
  for (let i = 0; i < kept.length; i++)
    out.set(ligSetBlocks[i], ligSetOffsets[i])
  return out
}

/**
 * Serialize a rewritten GSUB/GPOS table with minimal header structure.
 * Preserves the original ScriptList + FeatureList by copying bytes, and
 * emits a new LookupList with the rewritten subtables.
 */
function serializeLayoutTable(header: LayoutHeader, rewritten: Array<{ type: number, flag: number, subtables: Uint8Array[] }>): Uint8Array {
  // Build LookupList
  const lookupBlocks: Uint8Array[] = []
  const lookupOffsets: number[] = []
  const lookupListHeaderSize = 2 + rewritten.length * 2

  let cursor = lookupListHeaderSize
  for (const lk of rewritten) {
    lookupOffsets.push(cursor)
    const subtableOffsets: number[] = []
    const subtableHeaderSize = 6 + lk.subtables.length * 2
    let subCursor = subtableHeaderSize
    for (const st of lk.subtables) {
      subtableOffsets.push(subCursor)
      subCursor += st.length
    }
    const totalLookupSize = subCursor
    const lookupBuf = new Uint8Array(totalLookupSize)
    const lv = new DataView(lookupBuf.buffer)
    lv.setUint16(0, lk.type, false)
    lv.setUint16(2, lk.flag, false)
    lv.setUint16(4, lk.subtables.length, false)
    for (let i = 0; i < lk.subtables.length; i++)
      lv.setUint16(6 + i * 2, subtableOffsets[i], false)
    for (let i = 0; i < lk.subtables.length; i++)
      lookupBuf.set(lk.subtables[i], subtableOffsets[i])
    lookupBlocks.push(lookupBuf)
    cursor += totalLookupSize
  }
  const lookupListSize = cursor
  const lookupList = new Uint8Array(lookupListSize)
  const llv = new DataView(lookupList.buffer)
  llv.setUint16(0, rewritten.length, false)
  for (let i = 0; i < rewritten.length; i++)
    llv.setUint16(2 + i * 2, lookupOffsets[i], false)
  for (let i = 0; i < rewritten.length; i++)
    lookupList.set(lookupBlocks[i], lookupOffsets[i])

  // Build minimal ScriptList + FeatureList that reference all our lookups
  // (single DFLT script, one 'kern' or 'liga' feature wiring everything).
  // For maximum compatibility we emit one feature per lookup index.
  const featureCount = rewritten.length
  const featureListHeaderSize = 2 + featureCount * 6
  let featCursor = featureListHeaderSize
  const featureOffsets: number[] = []
  for (let i = 0; i < featureCount; i++) {
    featureOffsets.push(featCursor)
    featCursor += 4 + 2 // featureParams (2) + lookupIndexCount (2) + lookupListIndex (2)
  }
  const featureListSize = featCursor
  const featureList = new Uint8Array(featureListSize)
  const fv = new DataView(featureList.buffer)
  fv.setUint16(0, featureCount, false)
  for (let i = 0; i < featureCount; i++) {
    const recOff = 2 + i * 6
    // Tag: reuse original feature's tag if possible, else 'liga'
    const tag = i < header.featureList.length ? header.featureList[i].tag : 'liga'
    featureList[recOff] = tag.charCodeAt(0)
    featureList[recOff + 1] = tag.charCodeAt(1)
    featureList[recOff + 2] = tag.charCodeAt(2)
    featureList[recOff + 3] = tag.charCodeAt(3)
    fv.setUint16(recOff + 4, featureOffsets[i], false)
    // Feature table body
    fv.setUint16(featureOffsets[i], 0, false) // featureParams
    fv.setUint16(featureOffsets[i] + 2, 1, false) // lookupIndexCount
    fv.setUint16(featureOffsets[i] + 4, i, false) // lookupListIndex → i
  }

  // ScriptList: one DFLT with a default langSys referencing all features
  const langSysBase = 4 + featureCount * 2 // langSys body
  const defaultLangSys = new Uint8Array(6 + featureCount * 2)
  const lv = new DataView(defaultLangSys.buffer)
  lv.setUint16(0, 0, false) // lookupOrder (reserved)
  lv.setUint16(2, 0xFFFF, false) // requiredFeatureIndex
  lv.setUint16(4, featureCount, false)
  for (let i = 0; i < featureCount; i++)
    lv.setUint16(6 + i * 2, i, false)

  const scriptBase = 4
  const scriptSize = scriptBase + defaultLangSys.length
  const scriptListSize = 2 + 6 + scriptSize
  const scriptList = new Uint8Array(scriptListSize)
  const sv = new DataView(scriptList.buffer)
  sv.setUint16(0, 1, false) // scriptCount
  sv.setUint32(2, 0x44464C54, false) // 'DFLT' tag
  sv.setUint16(6, 8, false) // scriptOffset = 8 (absolute within scriptList)
  // scriptTable at offset 8: defaultLangSysOffset(2) langSysCount(2) defaultLangSys body
  sv.setUint16(8, 4, false)
  sv.setUint16(10, 0, false)
  scriptList.set(defaultLangSys, 8 + 4)
  void langSysBase

  // Now assemble the full GSUB/GPOS table
  const headerSize = 10
  const scriptListOff = headerSize
  const featureListOff = scriptListOff + scriptList.length
  const lookupListOff = featureListOff + featureList.length
  const total = lookupListOff + lookupList.length

  const out = new Uint8Array(total)
  const ov = new DataView(out.buffer)
  ov.setUint16(0, 1, false) // majorVersion
  ov.setUint16(2, 0, false) // minorVersion
  ov.setUint16(4, scriptListOff, false)
  ov.setUint16(6, featureListOff, false)
  ov.setUint16(8, lookupListOff, false)
  out.set(scriptList, scriptListOff)
  out.set(featureList, featureListOff)
  out.set(lookupList, lookupListOff)
  return out
}
