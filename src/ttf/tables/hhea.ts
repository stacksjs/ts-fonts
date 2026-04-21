import type { Reader } from '../../io/reader'
import type { Writer } from '../../io/writer'
import type { HheaTable, TTFObject } from '../../types'

export const HHEA_SIZE = 36

export function readHhea(reader: Reader, offset: number): HheaTable {
  reader.seek(offset)
  return {
    version: reader.readFixed(),
    ascent: reader.readInt16(),
    descent: reader.readInt16(),
    lineGap: reader.readInt16(),
    advanceWidthMax: reader.readUint16(),
    minLeftSideBearing: reader.readInt16(),
    minRightSideBearing: reader.readInt16(),
    xMaxExtent: reader.readInt16(),
    caretSlopeRise: reader.readInt16(),
    caretSlopeRun: reader.readInt16(),
    caretOffset: reader.readInt16(),
    reserved0: reader.readInt16(),
    reserved1: reader.readInt16(),
    reserved2: reader.readInt16(),
    reserved3: reader.readInt16(),
    metricDataFormat: reader.readInt16(),
    numOfLongHorMetrics: reader.readUint16(),
  }
}

export function writeHhea(writer: Writer, ttf: TTFObject): void {
  const h = ttf.hhea
  writer.writeFixed(h.version)
  writer.writeInt16(h.ascent)
  writer.writeInt16(h.descent)
  writer.writeInt16(h.lineGap)
  writer.writeUint16(h.advanceWidthMax)
  writer.writeInt16(h.minLeftSideBearing)
  writer.writeInt16(h.minRightSideBearing)
  writer.writeInt16(h.xMaxExtent)
  writer.writeInt16(h.caretSlopeRise)
  writer.writeInt16(h.caretSlopeRun)
  writer.writeInt16(h.caretOffset)
  writer.writeInt16(h.reserved0)
  writer.writeInt16(h.reserved1)
  writer.writeInt16(h.reserved2)
  writer.writeInt16(h.reserved3)
  writer.writeInt16(h.metricDataFormat)
  writer.writeUint16(h.numOfLongHorMetrics)
}

export function hheaSize(): number {
  return HHEA_SIZE
}
