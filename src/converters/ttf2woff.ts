import { Reader } from '../io/reader'
import { Writer } from '../io/writer'
import { WOFF_SIGNATURE } from '../ttf/enum'

export interface Ttf2WoffOptions {
  metadata?: string
  deflate?: (data: Uint8Array) => Uint8Array
}

interface WoffTableEntry {
  tag: string
  origOffset: number
  origLength: number
  origChecksum: number
  compOffset: number
  compLength: number
  compData: Uint8Array
}

function defaultDeflate(data: Uint8Array): Uint8Array {
  // Use Bun's built-in deflateSync when available (zlib-compatible)
  const g = globalThis as unknown as { Bun?: { deflateSync?: (d: Uint8Array) => Uint8Array } }
  if (g.Bun?.deflateSync)
    return g.Bun.deflateSync(data)
  throw new Error('No deflate function available. Pass `options.deflate` (e.g. pako.deflate).')
}

export function ttf2woff(ttfBuffer: ArrayBuffer, options: Ttf2WoffOptions = {}): ArrayBuffer {
  const deflate = options.deflate ?? defaultDeflate
  const reader = new Reader(ttfBuffer)
  const sfntVersion = reader.readUint32()
  const numTables = reader.readUint16()
  reader.offset += 6 // searchRange, entrySelector, rangeShift

  const entries: WoffTableEntry[] = []
  for (let i = 0; i < numTables; i++) {
    const tag = reader.readString(reader.offset, 4)
    const checksum = reader.readUint32()
    const offset = reader.readUint32()
    const length = reader.readUint32()
    const bytes = new Uint8Array(ttfBuffer, offset, length)
    const compressed = deflate(bytes)
    // If compression doesn't help, store uncompressed
    const compData = compressed.length < bytes.length ? compressed : bytes
    entries.push({
      tag,
      origOffset: offset,
      origLength: length,
      origChecksum: checksum,
      compOffset: 0,
      compLength: compData.length,
      compData,
    })
  }

  const headerSize = 44
  const tableDirSize = entries.length * 20
  let currentOffset = headerSize + tableDirSize
  for (const e of entries) {
    e.compOffset = currentOffset
    currentOffset += e.compLength
    // 4-byte alignment
    currentOffset = (currentOffset + 3) & ~3
  }

  const metaOffset = options.metadata ? currentOffset : 0
  const metaOrigLength = options.metadata ? options.metadata.length : 0
  let metaCompLength = 0
  let metaBytes: Uint8Array | null = null
  if (options.metadata) {
    const metaSrc = new TextEncoder().encode(options.metadata)
    metaBytes = deflate(metaSrc)
    metaCompLength = metaBytes.length
    currentOffset += metaCompLength
  }

  const totalSize = currentOffset
  const buffer = new ArrayBuffer(totalSize)
  const writer = new Writer(buffer)

  writer.writeUint32(WOFF_SIGNATURE)
  writer.writeUint32(sfntVersion)
  writer.writeUint32(totalSize)
  writer.writeUint16(entries.length)
  writer.writeUint16(0) // reserved
  writer.writeUint32(12 + numTables * 16 + entries.reduce((s, e) => s + ((e.origLength + 3) & ~3), 0)) // totalSfntSize approximation
  writer.writeUint16(1) // majorVersion
  writer.writeUint16(0) // minorVersion
  writer.writeUint32(metaOffset)
  writer.writeUint32(metaCompLength)
  writer.writeUint32(metaOrigLength)
  writer.writeUint32(0) // privOffset
  writer.writeUint32(0) // privLength

  for (const e of entries) {
    writer.writeString(`${e.tag}    `.slice(0, 4), 4)
    writer.writeUint32(e.compOffset)
    writer.writeUint32(e.compLength)
    writer.writeUint32(e.origLength)
    writer.writeUint32(e.origChecksum)
  }

  for (const e of entries) {
    writer.seek(e.compOffset)
    writer.writeBytes(e.compData)
  }

  if (metaBytes) {
    writer.seek(metaOffset)
    writer.writeBytes(metaBytes)
  }

  return buffer
}
