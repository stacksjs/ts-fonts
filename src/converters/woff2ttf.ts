import { Reader } from '../io/reader'
import { Writer } from '../io/writer'
import { inflateTo } from '../ot/tiny-inflate'
import { WOFF_SIGNATURE } from '../ttf/enum'

export interface Woff2TtfOptions {
  inflate?: (data: Uint8Array) => Uint8Array
  /** Expected uncompressed size, used with the bundled tiny-inflate fallback. */
  origLength?: number
}

function defaultInflate(data: Uint8Array, origLength?: number): Uint8Array {
  const g = globalThis as unknown as { Bun?: { inflateSync?: (d: Uint8Array) => Uint8Array } }
  if (g.Bun?.inflateSync)
    return g.Bun.inflateSync(data)
  if (origLength !== undefined)
    return inflateTo(data, origLength)
  throw new Error('No inflate function available. Pass `options.inflate` (e.g. pako.inflate).')
}

export function woff2ttf(buffer: ArrayBuffer, options: Woff2TtfOptions = {}): ArrayBuffer {
  const reader = new Reader(buffer)
  const signature = reader.readUint32()
  if (signature !== WOFF_SIGNATURE)
    throw new Error('not a WOFF font')
  const sfntVersion = reader.readUint32()
  /* length */ reader.readUint32()
  const numTables = reader.readUint16()
  /* reserved */ reader.readUint16()
  /* totalSfntSize */ reader.readUint32()
  /* majorVersion */ reader.readUint16()
  /* minorVersion */ reader.readUint16()
  /* metaOffset */ reader.readUint32()
  /* metaLength */ reader.readUint32()
  /* metaOrigLength */ reader.readUint32()
  /* privOffset */ reader.readUint32()
  /* privLength */ reader.readUint32()

  interface Entry {
    tag: string
    origLength: number
    origChecksum: number
    compOffset: number
    compLength: number
    data: Uint8Array
  }

  const entries: Entry[] = []
  for (let i = 0; i < numTables; i++) {
    const tag = reader.readString(reader.offset, 4)
    const offset = reader.readUint32()
    const compLength = reader.readUint32()
    const origLength = reader.readUint32()
    const checksum = reader.readUint32()
    const raw = new Uint8Array(buffer, offset, compLength)
    const data = compLength === origLength
      ? raw
      : (options.inflate ? options.inflate(raw) : defaultInflate(raw, origLength))
    entries.push({ tag, origLength, origChecksum: checksum, compOffset: offset, compLength, data })
  }

  const headerSize = 12 + entries.length * 16
  let currentOffset = headerSize
  const offsets: number[] = []
  for (const e of entries) {
    offsets.push(currentOffset)
    currentOffset += e.origLength
    currentOffset = (currentOffset + 3) & ~3
  }

  const totalSize = currentOffset
  const out = new ArrayBuffer(totalSize)
  const writer = new Writer(out)

  writer.writeUint32(sfntVersion)
  const entrySelector = Math.floor(Math.log2(numTables))
  const searchRange = 16 * (2 ** entrySelector)
  writer.writeUint16(numTables)
  writer.writeUint16(searchRange)
  writer.writeUint16(entrySelector)
  writer.writeUint16(numTables * 16 - searchRange)

  const sortedIndices = entries.map((e, i) => ({ tag: e.tag, i })).sort((a, b) => a.tag < b.tag ? -1 : 1)
  for (const { i } of sortedIndices) {
    const e = entries[i]
    writer.writeString(`${e.tag}    `.slice(0, 4), 4)
    writer.writeUint32(e.origChecksum)
    writer.writeUint32(offsets[i])
    writer.writeUint32(e.origLength)
  }

  for (let i = 0; i < entries.length; i++) {
    writer.seek(offsets[i])
    writer.writeBytes(entries[i].data)
  }

  return out
}
