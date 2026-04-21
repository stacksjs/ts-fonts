import { Reader } from '../io/reader'
import { Writer } from '../io/writer'
import { EOT_MAGIC_NUMBER } from '../ttf/enum'

function readNameFromTtf(ttfBuffer: ArrayBuffer, nameID: number): string {
  // Minimal name-table reader to extract FamilyName, StyleName, VersionName, FullName for EOT header
  const reader = new Reader(ttfBuffer)
  reader.readUint32() // sfntVersion
  const numTables = reader.readUint16()
  reader.offset += 6

  let nameOffset = -1
  for (let i = 0; i < numTables; i++) {
    const tag = reader.readString(reader.offset, 4)
    reader.readUint32() // checksum
    const offset = reader.readUint32()
    reader.readUint32() // length
    if (tag === 'name') {
      nameOffset = offset
      break
    }
  }
  if (nameOffset < 0) return ''

  reader.seek(nameOffset)
  reader.readUint16() // format
  const count = reader.readUint16()
  const stringOffset = reader.readUint16()
  for (let i = 0; i < count; i++) {
    const platformID = reader.readUint16()
    const encodingID = reader.readUint16()
    const languageID = reader.readUint16()
    const id = reader.readUint16()
    const length = reader.readUint16()
    const off = reader.readUint16()
    if (id === nameID && platformID === 3) {
      const bytes = reader.readBytes(nameOffset + stringOffset + off, length)
      let s = ''
      for (let j = 0; j < bytes.length - 1; j += 2)
        s += String.fromCharCode((bytes[j] << 8) | bytes[j + 1])
      return s
      void encodingID; void languageID
    }
  }
  return ''
}

function readOS2Values(ttfBuffer: ArrayBuffer): {
  weight: number
  italic: number
  fsType: number
  panose: number[]
  ulUnicodeRange: [number, number, number, number]
  ulCodePageRange: [number, number]
} {
  const reader = new Reader(ttfBuffer)
  reader.readUint32()
  const numTables = reader.readUint16()
  reader.offset += 6
  let os2Offset = -1
  for (let i = 0; i < numTables; i++) {
    const tag = reader.readString(reader.offset, 4)
    reader.readUint32()
    const offset = reader.readUint32()
    reader.readUint32()
    if (tag === 'OS/2') {
      os2Offset = offset
      break
    }
  }
  const defaults = {
    weight: 400,
    italic: 0,
    fsType: 0,
    panose: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    ulUnicodeRange: [0, 0, 0, 0] as [number, number, number, number],
    ulCodePageRange: [0, 0] as [number, number],
  }
  if (os2Offset < 0) return defaults
  reader.seek(os2Offset)
  reader.readUint16() // version
  reader.readInt16() // xAvgCharWidth
  const weight = reader.readUint16()
  reader.readUint16() // widthClass
  const fsType = reader.readInt16()
  // skip subscript/superscript/strikeout (14 int16s)
  for (let i = 0; i < 10; i++) reader.readInt16()
  /* sFamilyClass */ reader.readInt16()
  const panose: number[] = []
  for (let i = 0; i < 10; i++) panose.push(reader.readUint8())
  const ur1 = reader.readUint32()
  const ur2 = reader.readUint32()
  const ur3 = reader.readUint32()
  const ur4 = reader.readUint32()
  reader.readString(reader.offset, 4) // vendID
  const fsSelection = reader.readUint16()
  reader.readUint16() // firstChar
  reader.readUint16() // lastChar
  // skip typo metrics + win metrics (5 × int16 + 2 × uint16)
  for (let i = 0; i < 3; i++) reader.readInt16()
  reader.readUint16(); reader.readUint16()
  const cr1 = reader.readUint32()
  const cr2 = reader.readUint32()
  return {
    weight,
    italic: (fsSelection & 0x01) ? 1 : 0,
    fsType,
    panose,
    ulUnicodeRange: [ur1, ur2, ur3, ur4],
    ulCodePageRange: [cr1, cr2],
  }
}

export function ttf2eot(ttfBuffer: ArrayBuffer): ArrayBuffer {
  const familyName = readNameFromTtf(ttfBuffer, 1)
  const styleName = readNameFromTtf(ttfBuffer, 2)
  const versionName = readNameFromTtf(ttfBuffer, 5)
  const fullName = readNameFromTtf(ttfBuffer, 4)
  const os2 = readOS2Values(ttfBuffer)

  const encodeStr = (s: string): ArrayBuffer => {
    const out = new ArrayBuffer(s.length * 2)
    const view = new DataView(out)
    for (let i = 0; i < s.length; i++)
      view.setUint16(i * 2, s.charCodeAt(i), true)
    return out
  }

  const familyBuf = encodeStr(familyName)
  const styleBuf = encodeStr(styleName)
  const versionBuf = encodeStr(versionName)
  const fullBuf = encodeStr(fullName)

  const fixedHeader = 82 // bytes before FamilyNameSize
  const variable =
    4 + familyBuf.byteLength + // padding + familyNameSize (2) + text + padding
    4 + styleBuf.byteLength +
    4 + versionBuf.byteLength +
    4 + fullBuf.byteLength +
    2 // rootStringSize (0, v1)

  const totalSize = fixedHeader + variable + ttfBuffer.byteLength
  const out = new ArrayBuffer(totalSize)
  const writer = new Writer(out, 0, totalSize, true) // little-endian for EOT

  writer.writeUint32(totalSize) // EOTSize
  writer.writeUint32(ttfBuffer.byteLength) // FontDataSize
  writer.writeUint32(0x00020001) // Version 0x00020001
  writer.writeUint32(0) // Flags
  // PANOSE (10 bytes — as bytes, not little-endian interpreted)
  for (const b of os2.panose) writer.writeUint8(b)
  writer.writeUint8(1) // Charset
  writer.writeUint8(os2.italic) // Italic
  writer.writeUint32(os2.weight) // Weight
  writer.writeUint16(os2.fsType) // fsType
  writer.writeUint16(EOT_MAGIC_NUMBER) // MagicNumber
  writer.writeUint32(os2.ulUnicodeRange[0])
  writer.writeUint32(os2.ulUnicodeRange[1])
  writer.writeUint32(os2.ulUnicodeRange[2])
  writer.writeUint32(os2.ulUnicodeRange[3])
  writer.writeUint32(os2.ulCodePageRange[0])
  writer.writeUint32(os2.ulCodePageRange[1])
  writer.writeUint32(0) // CheckSumAdjustment
  writer.writeUint32(0)
  writer.writeUint32(0)
  writer.writeUint32(0)
  writer.writeUint32(0)

  // Padding 1 + FamilyNameSize + FamilyName
  writer.writeUint16(0)
  writer.writeUint16(familyBuf.byteLength)
  writer.writeBytes(familyBuf)
  // Padding 2 + StyleNameSize + StyleName
  writer.writeUint16(0)
  writer.writeUint16(styleBuf.byteLength)
  writer.writeBytes(styleBuf)
  // Padding 3 + VersionNameSize + VersionName
  writer.writeUint16(0)
  writer.writeUint16(versionBuf.byteLength)
  writer.writeBytes(versionBuf)
  // Padding 4 + FullNameSize + FullName
  writer.writeUint16(0)
  writer.writeUint16(fullBuf.byteLength)
  writer.writeBytes(fullBuf)
  // rootStringSize (0)
  writer.writeUint16(0)

  // Append font data
  writer.writeBytes(ttfBuffer)

  return out
}
