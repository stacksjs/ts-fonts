import type { Reader } from '../../io/reader'
import type { Writer } from '../../io/writer'
import type { TTFObject } from '../../types'

export function readLoca(reader: Reader, offset: number, numGlyphs: number, indexToLocFormat: number): number[] {
  reader.seek(offset)
  const loca: number[] = []
  if (indexToLocFormat === 0) {
    for (let i = 0; i <= numGlyphs; i++)
      loca.push(reader.readUint16() * 2)
  }
  else {
    for (let i = 0; i <= numGlyphs; i++)
      loca.push(reader.readUint32())
  }
  return loca
}

export function writeLoca(writer: Writer, ttf: TTFObject, glyfOffsets: number[]): void {
  const format = ttf.head.indexToLocFormat
  if (format === 0) {
    for (const off of glyfOffsets)
      writer.writeUint16(Math.floor(off / 2))
  }
  else {
    for (const off of glyfOffsets)
      writer.writeUint32(off)
  }
}

export function locaSize(ttf: TTFObject): number {
  const entries = ttf.glyf.length + 1
  return ttf.head.indexToLocFormat === 0 ? entries * 2 : entries * 4
}
