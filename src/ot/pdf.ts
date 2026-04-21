import type { TTFObject } from '../types'

/**
 * PDF embedding helpers.
 *
 * Produces data needed to embed a TrueType/CFF font as a Type 0 CID font
 * in a PDF document:
 *
 *   - `FontDescriptor` metrics (ascent, descent, italic angle, stem values)
 *   - `/CIDToGIDMap` (uint16 BE) for subsetted fonts
 *   - `/W` widths array (glyph index → advance in 1/1000 em)
 *   - `/ToUnicode` CMap string mapping glyph indexes back to Unicode
 *
 * You still need a PDF library to wrap these into a `/Font` dictionary
 * and stream — this module just produces the font-side bits.
 */

export interface PdfFontDescriptor {
  /** PostScript name from the name table. */
  fontName: string
  /** Full font family name. */
  familyName: string
  /** Font flags (bit 0 = fixed-pitch, bit 1 = serif, bit 18 = nonsymbolic). */
  flags: number
  /** Font bounding box [llx, lly, urx, ury] in glyph-space units. */
  fontBBox: [number, number, number, number]
  /** Italic angle in degrees (0 = upright, negative = clockwise tilt). */
  italicAngle: number
  /** Ascent in units. */
  ascent: number
  /** Descent in units (negative). */
  descent: number
  /** Cap height in units. */
  capHeight: number
  /** x-height in units. */
  xHeight: number
  /** Dominant vertical stem width. */
  stemV: number
  /** Dominant horizontal stem width. */
  stemH: number
  /** Average glyph advance width. */
  avgWidth: number
  /** Maximum glyph advance width. */
  maxWidth: number
  /** Missing-glyph advance (".notdef"). */
  missingWidth: number
}

/** Derive a PDF FontDescriptor from a TTFObject. */
export function buildFontDescriptor(ttf: TTFObject): PdfFontDescriptor {
  const unitsPerEm = ttf.head.unitsPerEm
  const os2 = ttf['OS/2']
  const post = ttf.post
  const hhea = ttf.hhea

  // Scale head bbox to 1000-unit space for PDF
  const scale = 1000 / unitsPerEm
  const bbox = [
    Math.round(ttf.head.xMin * scale),
    Math.round(ttf.head.yMin * scale),
    Math.round(ttf.head.xMax * scale),
    Math.round(ttf.head.yMax * scale),
  ] as [number, number, number, number]

  let flags = 0
  if (post.isFixedPitch) flags |= 1 // fixed pitch
  flags |= 1 << 5 // nonsymbolic (bit 6, but PDF uses bit 5 = 0x20... spec says bit 6)
  // Italic: fsSelection & ITALIC
  if ((os2.fsSelection & 0x01) !== 0) flags |= 1 << 6

  const advs = ttf.glyf.map(g => g.advanceWidth * scale)
  const avgWidth = advs.length > 0 ? Math.round(advs.reduce((a, b) => a + b, 0) / advs.length) : 0
  const maxWidth = advs.length > 0 ? Math.round(Math.max(...advs)) : 0

  return {
    fontName: ttf.name.postScriptName || ttf.name.fontFamily,
    familyName: ttf.name.fontFamily,
    flags,
    fontBBox: bbox,
    italicAngle: post.italicAngle,
    ascent: Math.round(hhea.ascent * scale),
    descent: Math.round(hhea.descent * scale),
    capHeight: Math.round(os2.sCapHeight * scale),
    xHeight: Math.round(os2.sxHeight * scale),
    stemV: Math.round(os2.usWeightClass / 65 + 50),
    stemH: Math.round(os2.usWeightClass / 65 + 50),
    avgWidth,
    maxWidth,
    missingWidth: ttf.glyf[0] ? Math.round(ttf.glyf[0].advanceWidth * scale) : 0,
  }
}

/**
 * Produce a PDF /W array with run-length grouping:
 *   [gid [w1 w2 w3] gid [wN] ...]
 *
 * Widths are in 1000-em units (the PDF default).
 */
export function buildWidthsArray(ttf: TTFObject): Array<number | number[]> {
  const scale = 1000 / ttf.head.unitsPerEm
  const widths = ttf.glyf.map(g => Math.round(g.advanceWidth * scale))
  const out: Array<number | number[]> = []
  let i = 0
  while (i < widths.length) {
    // Group consecutive widths into runs
    const start = i
    const run: number[] = [widths[i]]
    i++
    while (i < widths.length && run.length < 64) {
      run.push(widths[i])
      i++
    }
    out.push(start, run)
  }
  return out
}

/**
 * Build a CID-to-GID mapping as a big-endian uint16 byte stream.
 * For non-subsetted fonts this is the identity: cid N → gid N.
 * For subsetted fonts, caller passes an explicit mapping.
 */
export function buildCidToGidMap(cidMap?: Record<number, number>, maxCid?: number): Uint8Array {
  const size = (maxCid ?? (cidMap ? Math.max(...Object.keys(cidMap).map(Number)) : 0xFFFF)) + 1
  const buf = new Uint8Array(size * 2)
  const view = new DataView(buf.buffer)
  for (let cid = 0; cid < size; cid++) {
    const gid = cidMap ? cidMap[cid] ?? 0 : cid
    view.setUint16(cid * 2, gid, false)
  }
  return buf
}

/**
 * Produce a /ToUnicode CMap stream mapping glyph indexes back to Unicode
 * code points for PDF text extraction / searching.
 */
export function buildToUnicodeCMap(ttf: TTFObject, fontName = 'Font'): string {
  const ranges: Array<{ gid: number, cp: number }> = []
  for (let i = 0; i < ttf.glyf.length; i++) {
    const g = ttf.glyf[i]
    if (!g.unicode || g.unicode.length === 0) continue
    ranges.push({ gid: i, cp: g.unicode[0] })
  }
  ranges.sort((a, b) => a.gid - b.gid)

  let body = ''
  // Emit as bfchar entries — each <gidHex> <unicodeHex>
  const CHUNK = 100
  for (let i = 0; i < ranges.length; i += CHUNK) {
    const slice = ranges.slice(i, i + CHUNK)
    body += `${slice.length} beginbfchar\n`
    for (const { gid, cp } of slice)
      body += `<${gid.toString(16).padStart(4, '0')}> <${cp.toString(16).padStart(4, '0')}>\n`
    body += 'endbfchar\n'
  }

  return `/CIDInit /ProcSet findresource begin
12 dict begin
begincmap
/CIDSystemInfo
<< /Registry (Adobe)
/Ordering (UCS)
/Supplement 0
>> def
/CMapName /${fontName}-UCS def
/CMapType 2 def
1 begincodespacerange
<0000> <FFFF>
endcodespacerange
${body}endcmap
CMapName currentdict /CMap defineresource pop
end
end
`
}

/**
 * Build complete embedding info for a TTF/OTF font. Returns the PDF
 * dictionary values you need to write a Type 0 CID font.
 */
export function buildPdfEmbedding(ttf: TTFObject): {
  descriptor: PdfFontDescriptor
  widths: Array<number | number[]>
  cidToGidMap: Uint8Array
  toUnicodeCMap: string
} {
  return {
    descriptor: buildFontDescriptor(ttf),
    widths: buildWidthsArray(ttf),
    cidToGidMap: buildCidToGidMap(undefined, ttf.glyf.length - 1),
    toUnicodeCMap: buildToUnicodeCMap(ttf),
  }
}
