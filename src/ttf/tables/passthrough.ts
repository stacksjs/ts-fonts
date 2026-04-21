import type { Reader } from '../../io/reader'
import type { Writer } from '../../io/writer'
import type { HvarTable, MvarTable, TTFObject } from '../../types'

/**
 * Read a raw table as Uint8Array. Used for tables we don't fully parse
 * but want to round-trip (hinting tables, complex variable font tables).
 */
export function readRawTable(reader: Reader, offset: number, length: number): Uint8Array {
  const bytes = reader.readBytes(offset, length)
  return new Uint8Array(bytes)
}

export function writeRawTable(writer: Writer, data: Uint8Array | number[] | undefined): void {
  if (!data) return
  writer.writeBytes(data)
}

export function readHvar(reader: Reader, offset: number, length: number): HvarTable {
  const raw = readRawTable(reader, offset, length)
  const view = new DataView(raw.buffer, raw.byteOffset, raw.byteLength)
  return {
    majorVersion: view.getUint16(0, false),
    minorVersion: view.getUint16(2, false),
    raw,
  }
}

export function readMvar(reader: Reader, offset: number, length: number): MvarTable {
  const raw = readRawTable(reader, offset, length)
  const view = new DataView(raw.buffer, raw.byteOffset, raw.byteLength)
  const majorVersion = view.getUint16(0, false)
  const minorVersion = view.getUint16(2, false)
  /* reserved */ view.getUint16(4, false)
  const valueRecordSize = view.getUint16(6, false)
  const valueRecordCount = view.getUint16(8, false)
  const itemVariationStoreOffset = view.getUint16(10, false)

  const valueRecords: MvarTable['valueRecords'] = []
  let off = 12
  for (let i = 0; i < valueRecordCount; i++) {
    const tag = String.fromCharCode(view.getUint8(off), view.getUint8(off + 1), view.getUint8(off + 2), view.getUint8(off + 3))
    const deltaSetOuterIndex = view.getUint16(off + 4, false)
    const deltaSetInnerIndex = view.getUint16(off + 6, false)
    valueRecords.push({ tag, deltaSetOuterIndex, deltaSetInnerIndex })
    off += valueRecordSize
  }
  void itemVariationStoreOffset
  return { majorVersion, minorVersion, valueRecords, raw }
}
