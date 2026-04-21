import type { LayoutHeader } from './layout-common'
import { coverageIndex, lookupsForFeature, readCoverage, readUint16 } from './layout-common'

/** A ligature record: component chain (excluding first, which is the cover glyph) → replacement. */
export interface LigatureSub {
  /** First glyph (covered by this subtable). */
  first: number
  /** Component glyph chain (the sequence after `first` to match). */
  components: number[]
  /** Glyph id produced by the ligature. */
  by: number
}

/** Single substitution (lookup type 1): a single glyph is replaced with another. */
export interface SingleSub {
  sub: number
  by: number
}

/** Multiple substitution (lookup type 2): one glyph → sequence of glyphs. */
export interface MultipleSub {
  sub: number
  by: number[]
}

/** Alternate substitution (lookup type 3): one glyph → choose from a set. */
export interface AlternateSub {
  sub: number
  alternates: number[]
}

export interface GsubTables {
  singles: SingleSub[]
  multiples: MultipleSub[]
  alternates: AlternateSub[]
  ligatures: LigatureSub[]
}

/**
 * Parse GSUB tables for a font's active script/language, returning the
 * set of lookups most users need: single substitutions and ligatures.
 *
 * This is a focused port of opentype.js' GSUB handling — it doesn't
 * attempt full contextual / chained-context substitution, but it covers
 * the "liga", "rlig", "ss01..20", "calt", "aalt" features that matter
 * for Latin text rendering.
 */
export function readGsubFeatures(
  view: DataView,
  header: LayoutHeader,
  features: string[],
  script = 'DFLT',
  language = 'dflt',
): GsubTables {
  const singles: SingleSub[] = []
  const multiples: MultipleSub[] = []
  const alternates: AlternateSub[] = []
  const ligatures: LigatureSub[] = []
  const lookupIdxs = new Set<number>()
  for (const feat of features) {
    for (const idx of lookupsForFeature(header, feat, script, language))
      lookupIdxs.add(idx)
  }

  const process = (type: number, offset: number): void => {
    if (type === 1) parseSingleSubst(view, offset, singles)
    else if (type === 2) parseMultipleSubst(view, offset, multiples)
    else if (type === 3) parseAlternateSubst(view, offset, alternates)
    else if (type === 4) parseLigatureSubst(view, offset, ligatures)
    else if (type === 7) parseExtensionSubst(view, offset, singles, multiples, alternates, ligatures)
    // Types 5 (contextual) and 6 (chained context) are acknowledged but
    // not fully decoded here — they'd require a full rule-matching
    // pipeline. Callers that need them can extend with a custom walker.
  }

  for (const idx of lookupIdxs) {
    const lookup = header.lookupList[idx]
    if (!lookup) continue
    for (const sub of lookup.subTables)
      process(lookup.lookupType, sub.offset)
  }

  return { singles, multiples, alternates, ligatures }
}

function parseMultipleSubst(view: DataView, offset: number, out: MultipleSub[]): void {
  const format = readUint16(view, offset)
  if (format !== 1) return
  const coverageOff = offset + readUint16(view, offset + 2)
  const coverage = readCoverage(view, coverageOff)
  const sequenceCount = readUint16(view, offset + 4)
  for (let i = 0; i < sequenceCount; i++) {
    const seqOff = offset + readUint16(view, offset + 6 + i * 2)
    const glyphCount = readUint16(view, seqOff)
    const by: number[] = []
    for (let j = 0; j < glyphCount; j++)
      by.push(readUint16(view, seqOff + 2 + j * 2))
    out.push({ sub: coverage[i] ?? 0, by })
  }
}

function parseAlternateSubst(view: DataView, offset: number, out: AlternateSub[]): void {
  const format = readUint16(view, offset)
  if (format !== 1) return
  const coverageOff = offset + readUint16(view, offset + 2)
  const coverage = readCoverage(view, coverageOff)
  const altSetCount = readUint16(view, offset + 4)
  for (let i = 0; i < altSetCount; i++) {
    const setOff = offset + readUint16(view, offset + 6 + i * 2)
    const count = readUint16(view, setOff)
    const alts: number[] = []
    for (let j = 0; j < count; j++)
      alts.push(readUint16(view, setOff + 2 + j * 2))
    out.push({ sub: coverage[i] ?? 0, alternates: alts })
  }
}

function parseSingleSubst(view: DataView, offset: number, out: SingleSub[]): void {
  const format = readUint16(view, offset)
  const coverageOff = offset + readUint16(view, offset + 2)
  const coverage = readCoverage(view, coverageOff)
  if (format === 1) {
    const deltaGlyphId = view.getInt16(offset + 4, false)
    for (const g of coverage) out.push({ sub: g, by: (g + deltaGlyphId) & 0xFFFF })
  }
  else if (format === 2) {
    const count = readUint16(view, offset + 4)
    for (let i = 0; i < count; i++) {
      const by = readUint16(view, offset + 6 + i * 2)
      out.push({ sub: coverage[i] ?? 0, by })
    }
  }
}

function parseLigatureSubst(view: DataView, offset: number, out: LigatureSub[]): void {
  const format = readUint16(view, offset)
  if (format !== 1) return
  const coverageOff = offset + readUint16(view, offset + 2)
  const coverage = readCoverage(view, coverageOff)
  const ligSetCount = readUint16(view, offset + 4)
  for (let i = 0; i < ligSetCount; i++) {
    const setOff = offset + readUint16(view, offset + 6 + i * 2)
    const ligCount = readUint16(view, setOff)
    for (let j = 0; j < ligCount; j++) {
      const ligOff = setOff + readUint16(view, setOff + 2 + j * 2)
      const by = readUint16(view, ligOff)
      const compCount = readUint16(view, ligOff + 2)
      const components: number[] = []
      for (let k = 0; k < compCount - 1; k++)
        components.push(readUint16(view, ligOff + 4 + k * 2))
      out.push({ first: coverage[i] ?? 0, components, by })
    }
  }
}

function parseExtensionSubst(
  view: DataView,
  offset: number,
  singles: SingleSub[],
  multiples: MultipleSub[],
  alternates: AlternateSub[],
  ligs: LigatureSub[],
): void {
  const format = readUint16(view, offset)
  if (format !== 1) return
  const extensionLookupType = readUint16(view, offset + 2)
  const extensionOffset = offset + view.getUint32(offset + 4, false)
  if (extensionLookupType === 1) parseSingleSubst(view, extensionOffset, singles)
  else if (extensionLookupType === 2) parseMultipleSubst(view, extensionOffset, multiples)
  else if (extensionLookupType === 3) parseAlternateSubst(view, extensionOffset, alternates)
  else if (extensionLookupType === 4) parseLigatureSubst(view, extensionOffset, ligs)
}

void coverageIndex
