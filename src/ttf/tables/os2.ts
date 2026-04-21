import type { Reader } from '../../io/reader'
import type { Writer } from '../../io/writer'
import type { OS2Table, TTFObject } from '../../types'

export function readOS2(reader: Reader, offset: number): OS2Table {
  reader.seek(offset)
  const version = reader.readUint16()
  const xAvgCharWidth = reader.readInt16()
  const usWeightClass = reader.readUint16()
  const usWidthClass = reader.readUint16()
  const fsType = reader.readInt16()
  const ySubscriptXSize = reader.readInt16()
  const ySubscriptYSize = reader.readInt16()
  const ySubscriptXOffset = reader.readInt16()
  const ySubscriptYOffset = reader.readInt16()
  const ySuperscriptXSize = reader.readInt16()
  const ySuperscriptYSize = reader.readInt16()
  const ySuperscriptXOffset = reader.readInt16()
  const ySuperscriptYOffset = reader.readInt16()
  const yStrikeoutSize = reader.readInt16()
  const yStrikeoutPosition = reader.readInt16()
  const sFamilyClass = reader.readInt16()
  // panose (10 bytes)
  const bFamilyType = reader.readUint8()
  const bSerifStyle = reader.readUint8()
  const bWeight = reader.readUint8()
  const bProportion = reader.readUint8()
  const bContrast = reader.readUint8()
  const bStrokeVariation = reader.readUint8()
  const bArmStyle = reader.readUint8()
  const bLetterform = reader.readUint8()
  const bMidline = reader.readUint8()
  const bXHeight = reader.readUint8()
  const ulUnicodeRange1 = reader.readUint32()
  const ulUnicodeRange2 = reader.readUint32()
  const ulUnicodeRange3 = reader.readUint32()
  const ulUnicodeRange4 = reader.readUint32()
  const achVendID = reader.readString(reader.offset, 4)
  const fsSelection = reader.readUint16()
  const usFirstCharIndex = reader.readUint16()
  const usLastCharIndex = reader.readUint16()
  const sTypoAscender = reader.readInt16()
  const sTypoDescender = reader.readInt16()
  const sTypoLineGap = reader.readInt16()
  const usWinAscent = reader.readUint16()
  const usWinDescent = reader.readUint16()

  let ulCodePageRange1 = 0
  let ulCodePageRange2 = 0
  let sxHeight = 0
  let sCapHeight = 0
  let usDefaultChar = 0
  let usBreakChar = 0
  let usMaxContext = 0

  if (version >= 1) {
    ulCodePageRange1 = reader.readUint32()
    ulCodePageRange2 = reader.readUint32()
  }
  if (version >= 2) {
    sxHeight = reader.readInt16()
    sCapHeight = reader.readInt16()
    usDefaultChar = reader.readUint16()
    usBreakChar = reader.readUint16()
    usMaxContext = reader.readUint16()
  }

  return {
    version,
    xAvgCharWidth,
    usWeightClass,
    usWidthClass,
    fsType,
    ySubscriptXSize,
    ySubscriptYSize,
    ySubscriptXOffset,
    ySubscriptYOffset,
    ySuperscriptXSize,
    ySuperscriptYSize,
    ySuperscriptXOffset,
    ySuperscriptYOffset,
    yStrikeoutSize,
    yStrikeoutPosition,
    sFamilyClass,
    bFamilyType,
    bSerifStyle,
    bWeight,
    bProportion,
    bContrast,
    bStrokeVariation,
    bArmStyle,
    bLetterform,
    bMidline,
    bXHeight,
    ulUnicodeRange1,
    ulUnicodeRange2,
    ulUnicodeRange3,
    ulUnicodeRange4,
    achVendID,
    fsSelection,
    usFirstCharIndex,
    usLastCharIndex,
    sTypoAscender,
    sTypoDescender,
    sTypoLineGap,
    usWinAscent,
    usWinDescent,
    ulCodePageRange1,
    ulCodePageRange2,
    sxHeight,
    sCapHeight,
    usDefaultChar,
    usBreakChar,
    usMaxContext,
  }
}

export function writeOS2(writer: Writer, ttf: TTFObject): void {
  const o = ttf['OS/2']
  writer.writeUint16(o.version)
  writer.writeInt16(o.xAvgCharWidth)
  writer.writeUint16(o.usWeightClass)
  writer.writeUint16(o.usWidthClass)
  writer.writeInt16(o.fsType)
  writer.writeInt16(o.ySubscriptXSize)
  writer.writeInt16(o.ySubscriptYSize)
  writer.writeInt16(o.ySubscriptXOffset)
  writer.writeInt16(o.ySubscriptYOffset)
  writer.writeInt16(o.ySuperscriptXSize)
  writer.writeInt16(o.ySuperscriptYSize)
  writer.writeInt16(o.ySuperscriptXOffset)
  writer.writeInt16(o.ySuperscriptYOffset)
  writer.writeInt16(o.yStrikeoutSize)
  writer.writeInt16(o.yStrikeoutPosition)
  writer.writeInt16(o.sFamilyClass)
  writer.writeUint8(o.bFamilyType)
  writer.writeUint8(o.bSerifStyle)
  writer.writeUint8(o.bWeight)
  writer.writeUint8(o.bProportion)
  writer.writeUint8(o.bContrast)
  writer.writeUint8(o.bStrokeVariation)
  writer.writeUint8(o.bArmStyle)
  writer.writeUint8(o.bLetterform)
  writer.writeUint8(o.bMidline)
  writer.writeUint8(o.bXHeight)
  writer.writeUint32(o.ulUnicodeRange1)
  writer.writeUint32(o.ulUnicodeRange2)
  writer.writeUint32(o.ulUnicodeRange3)
  writer.writeUint32(o.ulUnicodeRange4)
  writer.writeString(o.achVendID || '    ', 4)
  writer.writeUint16(o.fsSelection)
  writer.writeUint16(o.usFirstCharIndex)
  writer.writeUint16(o.usLastCharIndex)
  writer.writeInt16(o.sTypoAscender)
  writer.writeInt16(o.sTypoDescender)
  writer.writeInt16(o.sTypoLineGap)
  writer.writeUint16(o.usWinAscent)
  writer.writeUint16(o.usWinDescent)
  if (o.version >= 1) {
    writer.writeUint32(o.ulCodePageRange1)
    writer.writeUint32(o.ulCodePageRange2)
  }
  if (o.version >= 2) {
    writer.writeInt16(o.sxHeight)
    writer.writeInt16(o.sCapHeight)
    writer.writeUint16(o.usDefaultChar)
    writer.writeUint16(o.usBreakChar)
    writer.writeUint16(o.usMaxContext)
  }
}

export function os2Size(ttf: TTFObject): number {
  const v = ttf['OS/2'].version
  if (v >= 2)
    return 96
  if (v >= 1)
    return 86
  return 78
}
