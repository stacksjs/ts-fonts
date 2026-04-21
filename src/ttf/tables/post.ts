import type { Reader } from '../../io/reader'
import type { Writer } from '../../io/writer'
import type { PostTable, TTFObject } from '../../types'

// Full list of 258 standard Mac glyph names (Apple TrueType post format 2)
export const STANDARD_MAC_NAMES: string[] = [
  '.notdef', '.null', 'nonmarkingreturn', 'space', 'exclam', 'quotedbl', 'numbersign',
  'dollar', 'percent', 'ampersand', 'quotesingle', 'parenleft', 'parenright', 'asterisk',
  'plus', 'comma', 'hyphen', 'period', 'slash', 'zero', 'one', 'two', 'three', 'four',
  'five', 'six', 'seven', 'eight', 'nine', 'colon', 'semicolon', 'less', 'equal',
  'greater', 'question', 'at', 'A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K',
  'L', 'M', 'N', 'O', 'P', 'Q', 'R', 'S', 'T', 'U', 'V', 'W', 'X', 'Y', 'Z',
  'bracketleft', 'backslash', 'bracketright', 'asciicircum', 'underscore', 'grave', 'a',
  'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j', 'k', 'l', 'm', 'n', 'o', 'p', 'q', 'r',
  's', 't', 'u', 'v', 'w', 'x', 'y', 'z', 'braceleft', 'bar', 'braceright', 'asciitilde',
  'Adieresis', 'Aring', 'Ccedilla', 'Eacute', 'Ntilde', 'Odieresis', 'Udieresis', 'aacute',
  'agrave', 'acircumflex', 'adieresis', 'atilde', 'aring', 'ccedilla', 'eacute', 'egrave',
  'ecircumflex', 'edieresis', 'iacute', 'igrave', 'icircumflex', 'idieresis', 'ntilde',
  'oacute', 'ograve', 'ocircumflex', 'odieresis', 'otilde', 'uacute', 'ugrave', 'ucircumflex',
  'udieresis', 'dagger', 'degree', 'cent', 'sterling', 'section', 'bullet', 'paragraph',
  'germandbls', 'registered', 'copyright', 'trademark', 'acute', 'dieresis', 'notequal',
  'AE', 'Oslash', 'infinity', 'plusminus', 'lessequal', 'greaterequal', 'yen', 'mu',
  'partialdiff', 'summation', 'product', 'pi', 'integral', 'ordfeminine', 'ordmasculine',
  'Omega', 'ae', 'oslash', 'questiondown', 'exclamdown', 'logicalnot', 'radical', 'florin',
  'approxequal', 'Delta', 'guillemotleft', 'guillemotright', 'ellipsis', 'nonbreakingspace',
  'Agrave', 'Atilde', 'Otilde', 'OE', 'oe', 'endash', 'emdash', 'quotedblleft',
  'quotedblright', 'quoteleft', 'quoteright', 'divide', 'lozenge', 'ydieresis', 'Ydieresis',
  'fraction', 'currency', 'guilsinglleft', 'guilsinglright', 'fi', 'fl', 'daggerdbl',
  'periodcentered', 'quotesinglbase', 'quotedblbase', 'perthousand', 'Acircumflex',
  'Ecircumflex', 'Aacute', 'Edieresis', 'Egrave', 'Iacute', 'Icircumflex', 'Idieresis',
  'Eth', 'eth', 'Yacute', 'yacute', 'Thorn', 'thorn', 'minus', 'multiply', 'onesuperior',
  'twosuperior', 'threesuperior', 'onehalf', 'onequarter', 'threequarters', 'franc',
  'Gbreve', 'gbreve', 'Idotaccent', 'Scedilla', 'scedilla', 'Cacute', 'cacute', 'Ccaron',
  'ccaron', 'dcroat',
]

const STANDARD_NAME_INDEX: Map<string, number> = new Map(
  STANDARD_MAC_NAMES.map((n, i) => [n, i] as const),
)

export function readPost(reader: Reader, offset: number): PostTable {
  reader.seek(offset)
  const format = reader.readFixed()
  const italicAngle = reader.readFixed()
  const underlinePosition = reader.readInt16()
  const underlineThickness = reader.readInt16()
  const isFixedPitch = reader.readUint32()
  const minMemType42 = reader.readUint32()
  const maxMemType42 = reader.readUint32()
  const minMemType1 = reader.readUint32()
  const maxMemType1 = reader.readUint32()

  const post: PostTable = {
    format,
    italicAngle,
    underlinePosition,
    underlineThickness,
    isFixedPitch,
    minMemType42,
    maxMemType42,
    minMemType1,
    maxMemType1,
  }

  if (format === 2) {
    const numGlyphs = reader.readUint16()
    const glyphNameIndex: number[] = []
    for (let i = 0; i < numGlyphs; i++)
      glyphNameIndex.push(reader.readUint16())

    const maxCustomIndex = glyphNameIndex.reduce((m, v) => v > m ? v : m, 257) - 257
    const names: string[] = []
    while (names.length < maxCustomIndex) {
      const len = reader.readUint8()
      names.push(reader.readString(reader.offset, len))
    }
    post.glyphNameIndex = glyphNameIndex
    post.names = names
  }

  return post
}

/**
 * Decide whether any glyph in the font has a non-standard, meaningful name
 * worth preserving via post format 2.
 */
function hasCustomNames(ttf: TTFObject): boolean {
  for (let i = 0; i < ttf.glyf.length; i++) {
    const g = ttf.glyf[i]
    if (!g.name) continue
    if (STANDARD_NAME_INDEX.has(g.name)) continue
    return true
  }
  return false
}

export function writePost(writer: Writer, ttf: TTFObject): void {
  const p = ttf.post
  const shouldWriteFormat2 = hasCustomNames(ttf)

  writer.writeFixed(shouldWriteFormat2 ? 2 : 3)
  writer.writeFixed(p.italicAngle)
  writer.writeInt16(p.underlinePosition)
  writer.writeInt16(p.underlineThickness)
  writer.writeUint32(p.isFixedPitch)
  writer.writeUint32(p.minMemType42)
  writer.writeUint32(p.maxMemType42)
  writer.writeUint32(p.minMemType1)
  writer.writeUint32(p.maxMemType1)

  if (!shouldWriteFormat2)
    return

  const numGlyphs = ttf.glyf.length
  writer.writeUint16(numGlyphs)

  const customNames: string[] = []
  const indices: number[] = []
  for (let i = 0; i < numGlyphs; i++) {
    const g = ttf.glyf[i]
    const name = g.name
    if (!name) {
      indices.push(0) // .notdef
      continue
    }
    const stdIdx = STANDARD_NAME_INDEX.get(name)
    if (stdIdx !== undefined) {
      indices.push(stdIdx)
      continue
    }
    indices.push(258 + customNames.length)
    customNames.push(name)
  }

  for (const idx of indices)
    writer.writeUint16(idx)

  for (const name of customNames) {
    const truncated = name.length > 255 ? name.slice(0, 255) : name
    writer.writeUint8(truncated.length)
    writer.writeString(truncated, truncated.length)
  }
}

export function postSize(ttf: TTFObject): number {
  const base = 32
  if (!hasCustomNames(ttf))
    return base

  const numGlyphs = ttf.glyf.length
  let customNamesSize = 0
  for (let i = 0; i < numGlyphs; i++) {
    const name = ttf.glyf[i].name
    if (!name || STANDARD_NAME_INDEX.has(name)) continue
    const len = Math.min(name.length, 255)
    customNamesSize += 1 + len
  }
  return base + 2 + numGlyphs * 2 + customNamesSize
}

/**
 * Resolve post format 2 glyph-name indices after reading.
 * Writes resolved names onto each glyph object.
 */
export function applyPostFormat2Names(ttf: TTFObject): void {
  const post = ttf.post
  if (!post || post.format !== 2 || !post.glyphNameIndex) return
  const names = post.names ?? []
  for (let i = 0; i < ttf.glyf.length; i++) {
    const idx = post.glyphNameIndex[i]
    if (idx === undefined) continue
    if (idx < 258) {
      const std = STANDARD_MAC_NAMES[idx]
      if (std) ttf.glyf[i].name = std
    }
    else {
      const custom = names[idx - 258]
      if (custom) ttf.glyf[i].name = custom
    }
  }
}
