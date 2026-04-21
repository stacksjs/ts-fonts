import type { Reader } from '../../io/reader'
import type { Writer } from '../../io/writer'
import type { MaxpTable, TTFObject } from '../../types'

export const MAXP_SIZE = 32

export function readMaxp(reader: Reader, offset: number): MaxpTable {
  reader.seek(offset)
  const version = reader.readFixed()
  const numGlyphs = reader.readUint16()

  // version 0.5 only has version + numGlyphs (for CFF fonts)
  if (version < 1) {
    return {
      version,
      numGlyphs,
      maxPoints: 0,
      maxContours: 0,
      maxCompositePoints: 0,
      maxCompositeContours: 0,
      maxZones: 2,
      maxTwilightPoints: 0,
      maxStorage: 0,
      maxFunctionDefs: 0,
      maxInstructionDefs: 0,
      maxStackElements: 0,
      maxSizeOfInstructions: 0,
      maxComponentElements: 0,
      maxComponentDepth: 0,
    }
  }

  return {
    version,
    numGlyphs,
    maxPoints: reader.readUint16(),
    maxContours: reader.readUint16(),
    maxCompositePoints: reader.readUint16(),
    maxCompositeContours: reader.readUint16(),
    maxZones: reader.readUint16(),
    maxTwilightPoints: reader.readUint16(),
    maxStorage: reader.readUint16(),
    maxFunctionDefs: reader.readUint16(),
    maxInstructionDefs: reader.readUint16(),
    maxStackElements: reader.readUint16(),
    maxSizeOfInstructions: reader.readUint16(),
    maxComponentElements: reader.readUint16(),
    maxComponentDepth: reader.readInt16(),
  }
}

export function writeMaxp(writer: Writer, ttf: TTFObject): void {
  const m = ttf.maxp
  writer.writeFixed(m.version)
  writer.writeUint16(m.numGlyphs)
  writer.writeUint16(m.maxPoints)
  writer.writeUint16(m.maxContours)
  writer.writeUint16(m.maxCompositePoints)
  writer.writeUint16(m.maxCompositeContours)
  writer.writeUint16(m.maxZones)
  writer.writeUint16(m.maxTwilightPoints)
  writer.writeUint16(m.maxStorage)
  writer.writeUint16(m.maxFunctionDefs)
  writer.writeUint16(m.maxInstructionDefs)
  writer.writeUint16(m.maxStackElements)
  writer.writeUint16(m.maxSizeOfInstructions)
  writer.writeUint16(m.maxComponentElements)
  writer.writeInt16(m.maxComponentDepth)
}

export function maxpSize(): number {
  return MAXP_SIZE
}
