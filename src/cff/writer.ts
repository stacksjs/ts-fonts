/**
 * CFF (Compact Font Format) v1 table writer.
 *
 * Emits a complete CFF table for a single font: Header, Name INDEX, Top
 * DICT INDEX, String INDEX, Global Subroutine INDEX, Charset, CharStrings
 * INDEX, Private DICT, Local Subroutine INDEX. Charset format 2 (ranges)
 * is used for compactness; encoding is delegated to the cmap and the CFF
 * encoding offset is set to 0 (Standard Encoding) — modern shapers ignore
 * CFF encoding and consult cmap.
 *
 * Limitations vs full CFF:
 *   - No FDSelect / CIDFonts (single Private DICT per font).
 *   - No global or local subroutines (charstrings are inlined).
 *   - No hint-bearing operators (`hstem`, `vstem`, `hstemhm`, etc.); the
 *     emitted glyphs are unhinted, which is fine for any rasteriser that
 *     uses curve subdivision (every modern engine).
 *   - Strings are emitted as user strings (SID ≥ 391) — we don't try to
 *     reuse CFF Standard Strings (SID 0–390).
 *
 * Spec: https://adobe-type-tools.github.io/font-tech-notes/pdfs/5176.CFF.pdf
 */

import type { Glyph, TTFObject } from '../types'
import { encodeCharstring } from './charstring-encoder'

/** CFF DICT operator codes we emit. */
const DICT_OP = {
  version: 0,
  Notice: 1,
  FullName: 2,
  FamilyName: 3,
  Weight: 4,
  FontBBox: 5,
  charset: 15,
  Encoding: 16,
  CharStrings: 17,
  Private: 18,
  // 12-prefixed operators (encoded as 0x0C, then byte)
  Copyright12: 0,
  isFixedPitch12: 1,
  ItalicAngle12: 2,
  UnderlinePosition12: 3,
  UnderlineThickness12: 4,
  CharStringType12: 6, // default 2
  FontMatrix12: 7,
  ROS12: 30,
} as const

/** Type 2 (the default for CFF1) — we set this explicitly for clarity. */
const CHARSTRING_TYPE = 2

const FIRST_USER_SID = 391

/** Encode a CFF DICT integer operand. */
function encodeDictInt(n: number, out: number[]): void {
  const v = Math.round(n)
  if (v >= -107 && v <= 107) {
    out.push(v + 139)
  }
  else if (v >= 108 && v <= 1131) {
    const adj = v - 108
    out.push(247 + (adj >> 8), adj & 0xFF)
  }
  else if (v >= -1131 && v <= -108) {
    const adj = -v - 108
    out.push(251 + (adj >> 8), adj & 0xFF)
  }
  else if (v >= -32768 && v <= 32767) {
    out.push(28, (v >> 8) & 0xFF, v & 0xFF)
  }
  else {
    out.push(29, (v >>> 24) & 0xFF, (v >>> 16) & 0xFF, (v >>> 8) & 0xFF, v & 0xFF)
  }
}

/** Encode a real number as BCD (operator 30). Used for FontMatrix entries. */
function encodeDictReal(n: number, out: number[]): void {
  const str = n.toString()
  const nibbles: number[] = []
  for (let i = 0; i < str.length; i++) {
    const ch = str[i]!
    if (ch >= '0' && ch <= '9') nibbles.push(ch.charCodeAt(0) - 48)
    else if (ch === '.') nibbles.push(0xA)
    else if (ch === 'E' || ch === 'e') {
      const nx = str[i + 1]
      if (nx === '-') { nibbles.push(0xC); i++ }
      else { nibbles.push(0xB) }
    }
    else if (ch === '-') nibbles.push(0xE)
  }
  nibbles.push(0xF)
  if (nibbles.length & 1) nibbles.push(0xF)
  out.push(30)
  for (let i = 0; i < nibbles.length; i += 2) {
    out.push((nibbles[i]! << 4) | nibbles[i + 1]!)
  }
}

function encodeDictOp(op: number, out: number[]): void {
  if (op >= 1200) {
    out.push(12, op - 1200)
  }
  else {
    out.push(op)
  }
}

/** Build the byte stream for a Top DICT given operator → operand list. */
function encodeDict(entries: Array<{ op: number, operands: Array<{ kind: 'int' | 'real', value: number }> }>): Uint8Array {
  const out: number[] = []
  for (const e of entries) {
    for (const v of e.operands) {
      if (v.kind === 'real') encodeDictReal(v.value, out)
      else encodeDictInt(v.value, out)
    }
    encodeDictOp(e.op, out)
  }
  return Uint8Array.from(out)
}

/** Smallest offSize (1..4) sufficient to encode `value`. */
function offSizeFor(value: number): number {
  if (value <= 0xFF) return 1
  if (value <= 0xFFFF) return 2
  if (value <= 0xFFFFFF) return 3
  return 4
}

/** Serialise a CFF INDEX (count + offSize + offsets[] + concatenated objects). */
function writeIndex(objects: Uint8Array[]): Uint8Array {
  if (objects.length === 0) {
    return new Uint8Array([0, 0]) // count = 0
  }
  // Compute offsets (1-based, into a virtual buffer just after the offsets).
  const offsets: number[] = [1]
  let cursor = 1
  for (const o of objects) {
    cursor += o.length
    offsets.push(cursor)
  }
  const offSize = offSizeFor(offsets[offsets.length - 1]!)
  const offsetTableSize = (offsets.length) * offSize
  const totalSize = 3 + offsetTableSize + (cursor - 1)

  const buf = new Uint8Array(totalSize)
  // count
  buf[0] = (objects.length >> 8) & 0xFF
  buf[1] = objects.length & 0xFF
  // offSize
  buf[2] = offSize
  // offsets
  let p = 3
  for (const off of offsets) {
    for (let i = offSize - 1; i >= 0; i--) {
      buf[p++] = (off >> (i * 8)) & 0xFF
    }
  }
  // data
  for (const o of objects) {
    buf.set(o, p)
    p += o.length
  }
  return buf
}

/** Build a charset (format 2) for `count` glyphs starting at SID `firstSid`. */
function buildCharsetFormat2(numGlyphs: number, firstSid: number): Uint8Array {
  // Format 2: format(1) + Range2[] (each: SID(2), nLeft(2)). One range covers all non-.notdef glyphs.
  const numRangesGlyphs = numGlyphs - 1 // .notdef is glyph 0, not in charset
  if (numRangesGlyphs <= 0) return new Uint8Array([2])
  const buf = new Uint8Array(1 + 4)
  buf[0] = 2
  buf[1] = (firstSid >> 8) & 0xFF
  buf[2] = firstSid & 0xFF
  const nLeft = numRangesGlyphs - 1
  buf[3] = (nLeft >> 8) & 0xFF
  buf[4] = nLeft & 0xFF
  return buf
}

/** Build the simplest valid Private DICT: defaultWidthX = 0, nominalWidthX = 0. */
function buildPrivateDict(): Uint8Array {
  // Empty private DICT is technically allowed; default values apply.
  return new Uint8Array(0)
}

/** Inputs to the CFF writer. */
export interface CffWriteOptions {
  /** PostScript font name (becomes the single entry in Name INDEX). */
  fontName: string
  /** Glyph list. Index 0 must be .notdef. */
  glyphs: Glyph[]
  /** Per-glyph advance widths in font units (parallel to `glyphs`). */
  advanceWidths: number[]
  /** Optional FontBBox: [xMin, yMin, xMax, yMax]. */
  fontBBox?: [number, number, number, number]
  /** Optional human-readable strings copied into Top DICT (SIDs auto-assigned). */
  strings?: { version?: string, notice?: string, copyright?: string, fullName?: string, familyName?: string, weight?: string }
  /** Italic angle in degrees (default 0). */
  italicAngle?: number
  /** Underline position / thickness (font units, default 0 / 50). */
  underlinePosition?: number
  underlineThickness?: number
  /** isFixedPitch flag (default 0). */
  isFixedPitch?: boolean
}

/** Sanitised fontName: limited to printable ASCII excluding the few CFF-disallowed chars. */
function sanitizeFontName(name: string): string {
  const out: string[] = []
  for (const ch of name) {
    const c = ch.charCodeAt(0)
    if (c < 33 || c > 126) continue
    // Disallow: ( ) [ ] { } < > / %
    if ('()[]{}<>/%'.includes(ch)) continue
    out.push(ch)
  }
  const result = out.join('')
  return result.length > 0 ? result : 'Untitled'
}

/** Number of bytes a name array adds to the String INDEX given `count` items. */
function asciiBytes(s: string): Uint8Array {
  // CFF strings are Latin-1; outside that range we substitute '?'.
  const out = new Uint8Array(s.length)
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i)
    out[i] = c < 256 ? c : 0x3F
  }
  return out
}

/** Encode a CFF table from `opts`. */
export function writeCFF(opts: CffWriteOptions): Uint8Array {
  if (opts.glyphs.length !== opts.advanceWidths.length) {
    throw new Error(`writeCFF: glyphs/advanceWidths length mismatch (${opts.glyphs.length} vs ${opts.advanceWidths.length})`)
  }

  const fontName = sanitizeFontName(opts.fontName)

  // ----- String INDEX (user strings) -----
  // Build the list of strings referenced by Top DICT. SIDs are sequential
  // starting at FIRST_USER_SID. We also need glyph-name strings for the
  // charset, which appear here too.
  const stringObjects: Uint8Array[] = []
  function addString(s: string): number {
    stringObjects.push(asciiBytes(s))
    return FIRST_USER_SID + stringObjects.length - 1
  }

  const strs = opts.strings ?? {}
  let versionSid: number | null = null
  let noticeSid: number | null = null
  let copyrightSid: number | null = null
  let fullNameSid: number | null = null
  let familyNameSid: number | null = null
  let weightSid: number | null = null

  if (strs.version) versionSid = addString(strs.version)
  if (strs.notice) noticeSid = addString(strs.notice)
  if (strs.copyright) copyrightSid = addString(strs.copyright)
  if (strs.fullName) fullNameSid = addString(strs.fullName)
  if (strs.familyName) familyNameSid = addString(strs.familyName)
  if (strs.weight) weightSid = addString(strs.weight)

  // Glyph-name strings (charset format 2 references SIDs starting at firstGlyphSid).
  // We name non-.notdef glyphs after their `name` field, falling back to "glyph<index>".
  const firstGlyphSid = FIRST_USER_SID + stringObjects.length
  for (let i = 1; i < opts.glyphs.length; i++) {
    const g = opts.glyphs[i]!
    const nm = g.name && g.name.length > 0 ? g.name : `glyph${i}`
    addString(nm)
  }

  // ----- CharStrings INDEX -----
  const charstringObjects: Uint8Array[] = []
  for (let i = 0; i < opts.glyphs.length; i++) {
    charstringObjects.push(encodeCharstring(opts.glyphs[i]!, opts.advanceWidths[i]!))
  }

  // ----- Charset (format 2) -----
  const charsetBytes = buildCharsetFormat2(opts.glyphs.length, firstGlyphSid)

  // ----- Private DICT (empty: defaults are fine) -----
  const privateBytes = buildPrivateDict()

  // ----- Top DICT -----
  // We need final byte offsets for charset, CharStrings, Private. CFF DICT
  // operands are variable-width (1–5 bytes per int), so the Top DICT size
  // depends on the offsets it encodes — chicken-and-egg. We solve it by
  // pre-encoding with placeholder big offsets (5-byte int29 for everything),
  // then patching the actual values into the same byte positions. As long
  // as we always emit operands as 5-byte int29 here, sizes are fixed.
  function intOp(value: number) { return { op: 0, operands: [{ kind: 'int' as const, value }] } }
  function realOp(value: number) { return { op: 0, operands: [{ kind: 'real' as const, value }] } }
  void realOp

  // Pre-encode offsets as 5-byte ints to make positions deterministic.
  // We'll patch them after layout.
  function placeholderInt(): { kind: 'int', value: number } {
    return { kind: 'int', value: 0x7FFFFFFF } // forces 5-byte encoding
  }

  const topDictEntries: Array<{ op: number, operands: Array<{ kind: 'int' | 'real', value: number }> }> = []
  if (versionSid !== null) topDictEntries.push({ op: DICT_OP.version, operands: [{ kind: 'int', value: versionSid }] })
  if (noticeSid !== null) topDictEntries.push({ op: DICT_OP.Notice, operands: [{ kind: 'int', value: noticeSid }] })
  if (copyrightSid !== null) topDictEntries.push({ op: 1200 + DICT_OP.Copyright12, operands: [{ kind: 'int', value: copyrightSid }] })
  if (fullNameSid !== null) topDictEntries.push({ op: DICT_OP.FullName, operands: [{ kind: 'int', value: fullNameSid }] })
  if (familyNameSid !== null) topDictEntries.push({ op: DICT_OP.FamilyName, operands: [{ kind: 'int', value: familyNameSid }] })
  if (weightSid !== null) topDictEntries.push({ op: DICT_OP.Weight, operands: [{ kind: 'int', value: weightSid }] })
  if (opts.fontBBox) {
    topDictEntries.push({
      op: DICT_OP.FontBBox,
      operands: opts.fontBBox.map(v => ({ kind: 'int' as const, value: Math.round(v) })),
    })
  }
  topDictEntries.push({ op: 1200 + DICT_OP.CharStringType12, operands: [{ kind: 'int', value: CHARSTRING_TYPE }] })
  if (opts.italicAngle && opts.italicAngle !== 0) {
    topDictEntries.push({ op: 1200 + DICT_OP.ItalicAngle12, operands: [{ kind: 'int', value: Math.round(opts.italicAngle) }] })
  }
  topDictEntries.push({ op: 1200 + DICT_OP.UnderlinePosition12, operands: [{ kind: 'int', value: opts.underlinePosition ?? -100 }] })
  topDictEntries.push({ op: 1200 + DICT_OP.UnderlineThickness12, operands: [{ kind: 'int', value: opts.underlineThickness ?? 50 }] })
  if (opts.isFixedPitch) {
    topDictEntries.push({ op: 1200 + DICT_OP.isFixedPitch12, operands: [{ kind: 'int', value: 1 }] })
  }
  // charset, CharStrings, Encoding, Private — placeholders patched after layout.
  const charsetEntry = { op: DICT_OP.charset, operands: [placeholderInt()] }
  const encodingEntry = { op: DICT_OP.Encoding, operands: [{ kind: 'int' as const, value: 0 }] } // standard
  const charStringsEntry = { op: DICT_OP.CharStrings, operands: [placeholderInt()] }
  const privateEntry = {
    op: DICT_OP.Private,
    operands: [{ kind: 'int' as const, value: privateBytes.length }, placeholderInt()],
  }
  topDictEntries.push(charsetEntry, encodingEntry, charStringsEntry, privateEntry)
  void intOp

  const topDictBytes = encodeDict(topDictEntries)

  // Build INDEXes that don't depend on offsets yet
  const nameIndex = writeIndex([asciiBytes(fontName)])
  const topDictIndex = writeIndex([topDictBytes])
  const stringIndex = writeIndex(stringObjects)
  const gsubrIndex = writeIndex([])
  const charStringsIndex = writeIndex(charstringObjects)

  // Header (4 bytes): major=1, minor=0, hdrSize=4, offSize=4 (we use 4-byte int29 placeholders).
  const headerBytes = new Uint8Array([1, 0, 4, 4])

  // ----- Layout -----
  // Layout order:
  //   Header
  //   Name INDEX
  //   Top DICT INDEX
  //   String INDEX
  //   Global Subr INDEX
  //   Encoding (skipped — using StandardEncoding offset 0)
  //   Charset
  //   CharStrings INDEX
  //   Private DICT
  //   Local Subr INDEX (empty, after Private)
  //
  // The Top DICT INDEX wraps `topDictBytes`, which holds the patched offsets.

  let cursor = 0
  cursor += headerBytes.length
  cursor += nameIndex.length
  const topDictIndexOff = cursor
  cursor += topDictIndex.length
  cursor += stringIndex.length
  cursor += gsubrIndex.length
  const charsetOff = cursor
  cursor += charsetBytes.length
  const charStringsOff = cursor
  cursor += charStringsIndex.length
  const privateOff = cursor
  cursor += privateBytes.length
  const localSubrIndex = writeIndex([])
  cursor += localSubrIndex.length
  const totalSize = cursor

  // Patch the Top DICT byte stream in place (offsets are stored in the
  // operand bytes immediately preceding their operator; since all our
  // placeholders are 5-byte int29, byte positions are stable).
  function patchInt29(buf: Uint8Array, opByte: number, opByte12: number | null, value: number): void {
    // Walk the dict, find the entry with this operator, then write the
    // last 5-byte int29 operand that preceded it.
    let i = 0
    // Track every operand start in the current sequence; reset at operator.
    let placeholderOff = -1
    while (i < buf.length) {
      const b = buf[i]!
      if (b <= 21) {
        let isMatch = false
        if (opByte12 == null && b === opByte) isMatch = true
        if (opByte12 != null && b === 12 && i + 1 < buf.length && buf[i + 1] === opByte12) isMatch = true
        if (isMatch) {
          if (placeholderOff < 0) {
            throw new Error(`CFF top-dict patch: no 5-byte placeholder before operator ${opByte}/${opByte12}`)
          }
          buf[placeholderOff + 1] = (value >>> 24) & 0xFF
          buf[placeholderOff + 2] = (value >>> 16) & 0xFF
          buf[placeholderOff + 3] = (value >>> 8) & 0xFF
          buf[placeholderOff + 4] = value & 0xFF
          return
        }
        i = b === 12 ? i + 2 : i + 1
        placeholderOff = -1
      }
      else {
        // operand — note its start, then skip its bytes. If it's a 5-byte
        // int29 (b===29) we mark it as a candidate placeholder; later
        // operands within the same entry overwrite the candidate.
        if (b === 29) placeholderOff = i
        // skip operand
        if (b === 29) i += 5
        else if (b === 28) i += 3
        else if (b >= 32 && b <= 246) i += 1
        else if (b >= 247 && b <= 254) i += 2
        else if (b === 30) {
          i++
          // eslint-disable-next-line no-constant-condition
          while (true) {
            const nx = buf[i++]!
            if ((nx & 0x0F) === 0xF || (nx >> 4) === 0xF) break
          }
        }
        else if (b === 255) i += 5
        else i += 1
      }
    }
    throw new Error(`CFF top-dict patch: operator ${opByte}/${opByte12} not found in DICT`)
  }

  // For Private DICT operator (18), the second operand is the offset; we
  // pre-pushed [size(int), offset(placeholder)] in that order, so the LAST
  // operand before the operator is the placeholder we want to patch.
  patchInt29(topDictBytes, DICT_OP.charset, null, charsetOff)
  patchInt29(topDictBytes, DICT_OP.CharStrings, null, charStringsOff)
  patchInt29(topDictBytes, DICT_OP.Private, null, privateOff)

  // Re-wrap top dict (its byte length is unchanged).
  const topDictIndexFinal = writeIndex([topDictBytes])
  if (topDictIndexFinal.length !== topDictIndex.length) {
    throw new Error('CFF: Top DICT INDEX size changed after patching — unexpected.')
  }

  // ----- Concatenate -----
  const out = new Uint8Array(totalSize)
  let p = 0
  out.set(headerBytes, p); p += headerBytes.length
  out.set(nameIndex, p); p += nameIndex.length
  out.set(topDictIndexFinal, p); p += topDictIndexFinal.length
  out.set(stringIndex, p); p += stringIndex.length
  out.set(gsubrIndex, p); p += gsubrIndex.length
  // Encoding is StandardEncoding (offset 0 in Top DICT) — nothing to write.
  out.set(charsetBytes, p); p += charsetBytes.length
  out.set(charStringsIndex, p); p += charStringsIndex.length
  out.set(privateBytes, p); p += privateBytes.length
  out.set(localSubrIndex, p); p += localSubrIndex.length

  if (p !== totalSize) throw new Error(`CFF writer: layout size mismatch (${p} vs ${totalSize})`)

  // Sanity: charsetOff in topDictIndexFinal must point to '02' (charset format 2)
  if (out[charsetOff] !== 2) {
    throw new Error(`CFF writer: charset offset mis-aligned (got ${out[charsetOff]} at ${charsetOff})`)
  }

  // Touch unused TTF reference to keep tree-shaking honest.
  void (null as unknown as TTFObject)

  return out
}
