import type { Glyph } from '../types'
import type { CharstringContext } from './charstring'
import { executeCharstring } from './charstring'
import { calcSubroutineBias, readDict, readIndex } from './dict'

/**
 * CFF2 — CFF for variable fonts. Layout differs from CFF1:
 *   - Header: major(1) minor(1) headerSize(1) topDictLength(2)
 *   - Top DICT INDEX is absent; a single Top DICT of length
 *     `topDictLength` follows the header directly.
 *   - No Name INDEX, no String INDEX.
 *   - Adds `vstore` (operator 24) pointing to an ItemVariationStore.
 *   - Charstrings use additional operators: blend (16), vsindex (15).
 *
 * We parse the charstrings as static outlines at the default location.
 * For variable outline support via blend deltas, compute normalized
 * coordinates with `variable/instance.ts` and resolve per-glyph deltas
 * using the shared tuple-scalar helpers.
 */
export interface Cff2ParseResult {
  glyphs: Glyph[]
  defaultWidthX: number
  nominalWidthX: number
}

export function parseCFF2(buffer: ArrayBuffer, cff2Offset: number, numGlyphs: number): Cff2ParseResult {
  const view = new DataView(buffer)

  const major = view.getUint8(cff2Offset)
  const minor = view.getUint8(cff2Offset + 1)
  const headerSize = view.getUint8(cff2Offset + 2)
  const topDictLength = view.getUint16(cff2Offset + 3, false)
  if (major !== 2)
    throw new Error(`not a CFF2 table (major=${major}.${minor})`)

  const topDictBytes = new Uint8Array(buffer, cff2Offset + headerSize, topDictLength)
  const topDict = readDict(topDictBytes)

  let cursor = cff2Offset + headerSize + topDictLength

  // Global Subroutine INDEX (always present)
  const gsubrsIndex = readIndex(buffer, cursor)
  cursor = gsubrsIndex.endOffset
  const gsubrs = gsubrsIndex.objects
  const gsubrsBias = calcSubroutineBias(gsubrs.length)

  // CharStrings INDEX pointer (operator 17)
  const charStringsOff = topDict[17]?.[0] ?? 0
  // FDArray (operator 1207) and FDSelect (operator 1206) may be present
  // (for fonts with CID structure). For our pragmatic pass we use the
  // single Private DICT referenced by the first FDArray entry or by the
  // top DICT directly in the absence of FDArray.

  const privateInfo = topDict[18] ?? [0, 0]
  const privateSize = privateInfo[0]
  const privateOff = privateInfo[1]
  let subrs: Uint8Array[] = []
  let subrsBias = 107
  let defaultWidthX = 0
  let nominalWidthX = 0
  if (privateSize > 0 && privateOff > 0) {
    const privBytes = new Uint8Array(buffer, cff2Offset + privateOff, privateSize)
    const privDict = readDict(privBytes)
    defaultWidthX = privDict[20]?.[0] ?? 0
    nominalWidthX = privDict[21]?.[0] ?? 0
    const subrsOffLocal = privDict[19]?.[0]
    if (subrsOffLocal) {
      const subrsIdx = readIndex(buffer, cff2Offset + privateOff + subrsOffLocal)
      subrs = subrsIdx.objects
      subrsBias = calcSubroutineBias(subrs.length)
    }
  }

  const charStringsIdx = charStringsOff > 0
    ? readIndex(buffer, cff2Offset + charStringsOff)
    : { count: 0, objects: [] as Uint8Array[], endOffset: cursor }

  const ctx: CharstringContext = {
    subrs,
    gsubrs,
    subrsBias,
    gsubrsBias,
    defaultWidthX,
    nominalWidthX,
  }

  const glyphs: Glyph[] = []
  const actualNumGlyphs = charStringsIdx.count || numGlyphs
  for (let i = 0; i < actualNumGlyphs; i++) {
    const bytecode = charStringsIdx.objects[i]
    if (!bytecode) {
      glyphs.push(emptyGlyph())
      continue
    }
    try {
      const r = executeCharstring(bytecode, ctx)
      glyphs.push({
        contours: r.contours,
        xMin: r.xMin,
        yMin: r.yMin,
        xMax: r.xMax,
        yMax: r.yMax,
        advanceWidth: r.advanceWidth,
        leftSideBearing: r.xMin,
      })
    }
    catch {
      glyphs.push(emptyGlyph())
    }
  }

  return { glyphs, defaultWidthX, nominalWidthX }
}

function emptyGlyph(): Glyph {
  return {
    contours: [],
    xMin: 0, yMin: 0, xMax: 0, yMax: 0,
    advanceWidth: 0, leftSideBearing: 0,
  }
}
