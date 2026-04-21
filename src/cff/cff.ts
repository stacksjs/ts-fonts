import type { Glyph } from '../types'
import type { CharstringContext } from './charstring'
import { executeCharstring } from './charstring'
import { calcSubroutineBias, readDict, readIndex } from './dict'
import { getCFFString } from './standard-strings'

export interface CffParseResult {
  glyphs: Glyph[]
  charset: string[]
  encoding: Record<number, number>
  defaultWidthX: number
  nominalWidthX: number
}

/**
 * Parse a complete CFF table and return TTF-shaped glyph objects.
 */
export function parseCFF(buffer: ArrayBuffer, cffOffset: number, cffLength: number, numGlyphs: number): CffParseResult {
  const view = new DataView(buffer)

  // Header
  const formatMajor = view.getUint8(cffOffset)
  const formatMinor = view.getUint8(cffOffset + 1)
  const headerSize = view.getUint8(cffOffset + 2)
  /* const absOffSize = view.getUint8(cffOffset + 3) */
  void formatMajor; void formatMinor

  let cursor = cffOffset + headerSize

  // Name INDEX
  const nameIndex = readIndex(buffer, cursor)
  cursor = nameIndex.endOffset

  // Top DICT INDEX
  const topDictIndex = readIndex(buffer, cursor)
  cursor = topDictIndex.endOffset
  const topDictBytes = topDictIndex.objects[0]
  const topDict = topDictBytes ? readDict(topDictBytes) : {}

  // String INDEX
  const stringIndex = readIndex(buffer, cursor)
  cursor = stringIndex.endOffset
  const strings = stringIndex.objects.map(b => uint8ToString(b))

  // Global subroutine INDEX
  const gsubrsIndex = readIndex(buffer, cursor)
  cursor = gsubrsIndex.endOffset
  const gsubrs = gsubrsIndex.objects
  const gsubrsBias = calcSubroutineBias(gsubrs.length)

  // Top DICT pointers
  const charsetOff = (topDict[15]?.[0]) ?? 0
  const encodingOff = (topDict[16]?.[0]) ?? 0
  const charStringsOff = topDict[17]?.[0] ?? 0
  const privateInfo = topDict[18] ?? [0, 0]
  const privateSize = privateInfo[0]
  const privateOff = privateInfo[1]

  // Private DICT
  let defaultWidthX = 0
  let nominalWidthX = 0
  let subrs: Uint8Array[] = []
  let subrsBias = 107
  if (privateSize > 0 && privateOff > 0) {
    const privBytes = new Uint8Array(buffer, cffOffset + privateOff, privateSize)
    const privDict = readDict(privBytes)
    defaultWidthX = privDict[20]?.[0] ?? 0
    nominalWidthX = privDict[21]?.[0] ?? 0
    const subrsOff = privDict[19]?.[0]
    if (subrsOff) {
      const subrsIdx = readIndex(buffer, cffOffset + privateOff + subrsOff)
      subrs = subrsIdx.objects
      subrsBias = calcSubroutineBias(subrs.length)
    }
  }

  // CharStrings INDEX
  const charStringsIndex = charStringsOff > 0
    ? readIndex(buffer, cffOffset + charStringsOff)
    : { count: 0, objects: [], endOffset: cursor }
  const actualNumGlyphs = charStringsIndex.count || numGlyphs

  // Charset
  const charset = parseCharset(buffer, cffOffset + charsetOff, actualNumGlyphs, strings, charsetOff)

  // Encoding
  const encoding = parseEncoding(buffer, cffOffset + encodingOff, encodingOff)

  // Execute each charstring
  const ctx: CharstringContext = {
    subrs,
    gsubrs,
    subrsBias,
    gsubrsBias,
    defaultWidthX,
    nominalWidthX,
  }

  const glyphs: Glyph[] = []
  for (let i = 0; i < actualNumGlyphs; i++) {
    const bytecode = charStringsIndex.objects[i]
    if (!bytecode) {
      glyphs.push(emptyGlyph())
      continue
    }
    try {
      const r = executeCharstring(bytecode, ctx)
      const name = charset[i]
      glyphs.push({
        contours: r.contours,
        xMin: r.xMin,
        yMin: r.yMin,
        xMax: r.xMax,
        yMax: r.yMax,
        advanceWidth: r.advanceWidth,
        leftSideBearing: r.xMin,
        name,
      })
    }
    catch {
      glyphs.push(emptyGlyph())
    }
    void cffLength
  }

  return { glyphs, charset, encoding, defaultWidthX, nominalWidthX }
}

function emptyGlyph(): Glyph {
  return {
    contours: [],
    xMin: 0, yMin: 0, xMax: 0, yMax: 0,
    advanceWidth: 0, leftSideBearing: 0,
  }
}

function uint8ToString(bytes: Uint8Array): string {
  let s = ''
  for (let i = 0; i < bytes.length; i++)
    s += String.fromCharCode(bytes[i])
  return s
}

function parseCharset(buffer: ArrayBuffer, offset: number, numGlyphs: number, fontStrings: string[], rawOffset: number): string[] {
  // Predefined charsets
  if (rawOffset === 0) return charsetISO()
  if (rawOffset === 1) return charsetExpert()
  if (rawOffset === 2) return charsetExpertSubset()

  const view = new DataView(buffer)
  const format = view.getUint8(offset)
  const charset: string[] = ['.notdef']

  if (format === 0) {
    for (let i = 1; i < numGlyphs; i++) {
      const sid = view.getUint16(offset + 1 + (i - 1) * 2, false)
      charset.push(getCFFString(fontStrings, sid) ?? '')
    }
  }
  else if (format === 1) {
    let cursor = offset + 1
    while (charset.length < numGlyphs) {
      const firstSid = view.getUint16(cursor, false)
      const nLeft = view.getUint8(cursor + 2)
      cursor += 3
      for (let j = 0; j <= nLeft && charset.length < numGlyphs; j++)
        charset.push(getCFFString(fontStrings, firstSid + j) ?? '')
    }
  }
  else if (format === 2) {
    let cursor = offset + 1
    while (charset.length < numGlyphs) {
      const firstSid = view.getUint16(cursor, false)
      const nLeft = view.getUint16(cursor + 2, false)
      cursor += 4
      for (let j = 0; j <= nLeft && charset.length < numGlyphs; j++)
        charset.push(getCFFString(fontStrings, firstSid + j) ?? '')
    }
  }

  return charset
}

function parseEncoding(buffer: ArrayBuffer, offset: number, rawOffset: number): Record<number, number> {
  // Predefined encodings — return empty (cmap usually supersedes)
  if (rawOffset === 0 || rawOffset === 1)
    return {}

  const view = new DataView(buffer)
  const format = view.getUint8(offset)
  const encoding: Record<number, number> = {}

  if ((format & 0x7F) === 0) {
    const nCodes = view.getUint8(offset + 1)
    for (let i = 0; i < nCodes; i++)
      encoding[view.getUint8(offset + 2 + i)] = i + 1
  }
  else if ((format & 0x7F) === 1) {
    const nRanges = view.getUint8(offset + 1)
    let gid = 1
    let cursor = offset + 2
    for (let i = 0; i < nRanges; i++) {
      const first = view.getUint8(cursor)
      const nLeft = view.getUint8(cursor + 1)
      cursor += 2
      for (let j = 0; j <= nLeft; j++)
        encoding[first + j] = gid++
    }
  }
  return encoding
}

// Minimal stubs — predefined charsets are rarely encountered outside niche fonts
function charsetISO(): string[] { return ['.notdef'] }
function charsetExpert(): string[] { return ['.notdef'] }
function charsetExpertSubset(): string[] { return ['.notdef'] }
