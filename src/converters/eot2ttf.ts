import { Reader } from '../io/reader'

export function eot2ttf(buffer: ArrayBuffer): ArrayBuffer {
  const reader = new Reader(buffer, 0, undefined, true) // little-endian
  /* eotSize */ reader.readUint32()
  const fontDataSize = reader.readUint32()
  /* version */ reader.readUint32()
  /* flags */ reader.readUint32()
  // skip panose (10), charset, italic (1), weight (4), fsType (2), magicNumber (2)
  reader.offset += 10 + 1 + 1 + 4 + 2 + 2
  // skip unicodeRange (16) + codePageRange (8) + checkSumAdj (4) + reserved (16) + 2 padding
  reader.offset += 16 + 8 + 4 + 16 + 2

  const skipName = (): void => {
    const len = reader.readUint16()
    reader.offset += len
    reader.readUint16() // trailing padding
  }
  // FamilyName, StyleName, VersionName, FullName — pattern: length + bytes + padding
  // Structure (after the leading 2-byte padding consumed just above):
  // FamilyNameSize, FamilyName, Padding2, StyleNameSize, StyleName, ...
  const readName = (): void => {
    const size = reader.readUint16()
    reader.offset += size
  }
  // Adjust: we already consumed the leading padding (2 bytes). Now read name blocks.
  // Structure per name: size (2), bytes (size), padding (2) — except the last name has rootStringSize (2) following.
  readName() // family
  reader.offset += 2
  readName() // style
  reader.offset += 2
  readName() // version
  reader.offset += 2
  readName() // full
  reader.readUint16() // rootStringSize
  // (Rest of the variable header may contain rootString / signature / EUDC data; we skip to end — TTF data is at eotSize - fontDataSize)

  // Prefer using eotSize - fontDataSize for reliability
  const ttfStart = buffer.byteLength - fontDataSize
  return buffer.slice(ttfStart, ttfStart + fontDataSize)
  void skipName
}
