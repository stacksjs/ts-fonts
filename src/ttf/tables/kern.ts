import type { Reader } from '../../io/reader'
import type { Writer } from '../../io/writer'
import type { KernTable, TTFObject } from '../../types'

export function readKern(reader: Reader, offset: number): KernTable {
  reader.seek(offset)
  const version = reader.readUint16()
  const nTables = reader.readUint16()
  const subtables: KernTable['subtables'] = []

  for (let i = 0; i < nTables; i++) {
    const subVersion = reader.readUint16()
    const length = reader.readUint16()
    const coverage = reader.readUint16()
    const format = coverage >> 8
    if (format === 0) {
      const nPairs = reader.readUint16()
      /* searchRange */ reader.readUint16()
      /* entrySelector */ reader.readUint16()
      /* rangeShift */ reader.readUint16()
      const pairs: Array<{ left: number, right: number, value: number }> = []
      for (let j = 0; j < nPairs; j++) {
        pairs.push({
          left: reader.readUint16(),
          right: reader.readUint16(),
          value: reader.readInt16(),
        })
      }
      subtables.push({ version: subVersion, length, coverage, format, pairs })
    }
    else {
      // Unsupported format — skip
      reader.offset += length - 6
    }
  }

  return { version, subtables }
}

export function writeKern(writer: Writer, ttf: TTFObject): void {
  const k = ttf.kern
  if (!k) return
  writer.writeUint16(k.version)
  writer.writeUint16(k.subtables.length)
  for (const sub of k.subtables) {
    const nPairs = sub.pairs.length
    const length = 14 + nPairs * 6
    writer.writeUint16(sub.version ?? 0)
    writer.writeUint16(length)
    writer.writeUint16(sub.coverage)
    writer.writeUint16(nPairs)
    const entrySelector = Math.floor(Math.log2(nPairs || 1))
    const searchRange = 6 * (2 ** entrySelector)
    writer.writeUint16(searchRange)
    writer.writeUint16(entrySelector)
    writer.writeUint16(nPairs * 6 - searchRange)
    for (const p of sub.pairs) {
      writer.writeUint16(p.left)
      writer.writeUint16(p.right)
      writer.writeInt16(p.value)
    }
  }
}

export function kernSize(ttf: TTFObject): number {
  const k = ttf.kern
  if (!k) return 0
  let total = 4
  for (const sub of k.subtables)
    total += 14 + sub.pairs.length * 6
  return total
}
