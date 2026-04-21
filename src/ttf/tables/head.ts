import type { Reader } from '../../io/reader'
import type { Writer } from '../../io/writer'
import type { HeadTable, TTFObject } from '../../types'

export const HEAD_SIZE = 54

export function readHead(reader: Reader, offset: number): HeadTable {
  reader.seek(offset)
  const version = reader.readFixed()
  const fontRevision = reader.readFixed()
  const checkSumAdjustment = reader.readUint32()
  const magickNumber = reader.readUint32()
  const flags = reader.readUint16()
  const unitsPerEm = reader.readUint16()
  const created = reader.readLongDateTime()
  const modified = reader.readLongDateTime()
  const xMin = reader.readInt16()
  const yMin = reader.readInt16()
  const xMax = reader.readInt16()
  const yMax = reader.readInt16()
  const macStyle = reader.readUint16()
  const lowestRecPPEM = reader.readUint16()
  const fontDirectionHint = reader.readInt16()
  const indexToLocFormat = reader.readInt16()
  const glyphDataFormat = reader.readInt16()

  return {
    version,
    fontRevision,
    checkSumAdjustment,
    magickNumber,
    flags,
    unitsPerEm,
    created,
    modified,
    xMin,
    yMin,
    xMax,
    yMax,
    macStyle,
    lowestRecPPEM,
    fontDirectionHint,
    indexToLocFormat,
    glyphDataFormat,
  }
}

export function writeHead(writer: Writer, ttf: TTFObject): void {
  const h = ttf.head
  writer.writeFixed(h.version)
  writer.writeFixed(h.fontRevision)
  writer.writeUint32(h.checkSumAdjustment)
  writer.writeUint32(h.magickNumber)
  writer.writeUint16(h.flags)
  writer.writeUint16(h.unitsPerEm)
  writer.writeLongDateTime(h.created)
  writer.writeLongDateTime(h.modified)
  writer.writeInt16(h.xMin)
  writer.writeInt16(h.yMin)
  writer.writeInt16(h.xMax)
  writer.writeInt16(h.yMax)
  writer.writeUint16(h.macStyle)
  writer.writeUint16(h.lowestRecPPEM)
  writer.writeInt16(h.fontDirectionHint)
  writer.writeInt16(h.indexToLocFormat)
  writer.writeInt16(h.glyphDataFormat)
}

export function headSize(): number {
  return HEAD_SIZE
}
