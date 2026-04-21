import type { Reader } from '../io/reader'
import type { Writer } from '../io/writer'

export interface TableEntry {
  tag: string
  checkSum: number
  offset: number
  length: number
}

export function readDirectory(reader: Reader): {
  sfntVersion: number
  numTables: number
  searchRange: number
  entrySelector: number
  rangeShift: number
  tables: Record<string, TableEntry>
} {
  reader.seek(0)
  const sfntVersion = reader.readUint32()
  const numTables = reader.readUint16()
  const searchRange = reader.readUint16()
  const entrySelector = reader.readUint16()
  const rangeShift = reader.readUint16()

  const tables: Record<string, TableEntry> = {}
  for (let i = 0; i < numTables; i++) {
    const tag = reader.readString(reader.offset, 4)
    const checkSum = reader.readUint32()
    const offset = reader.readUint32()
    const length = reader.readUint32()
    tables[tag] = { tag, checkSum, offset, length }
  }
  return { sfntVersion, numTables, searchRange, entrySelector, rangeShift, tables }
}

export function writeDirectory(writer: Writer, entries: TableEntry[]): void {
  // Tables must be sorted by tag (alphabetically) per spec
  const sorted = [...entries].sort((a, b) => a.tag < b.tag ? -1 : a.tag > b.tag ? 1 : 0)
  for (const t of sorted) {
    writer.writeString(`${t.tag}    `.slice(0, 4), 4)
    writer.writeUint32(t.checkSum)
    writer.writeUint32(t.offset)
    writer.writeUint32(t.length)
  }
}
