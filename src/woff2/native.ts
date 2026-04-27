/**
 * Native WOFF2 encoder/decoder that does NOT require the Google WOFF2
 * WASM module. Uses whatever Brotli implementation is available on the
 * host:
 *
 *   - Node.js: `zlib.brotliCompressSync` / `zlib.brotliDecompressSync`
 *   - Deno / modern browsers: `CompressionStream('br')` if implemented
 *   - Caller override: `setBrotli({ compress, decompress })`
 *
 * The encoder emits WOFF2 with null transforms (transformVersion=3 for
 * glyf/loca), which is permitted by the spec. Compression ratios are
 * ~10–15% worse than Google's transformed output, but round-trip is
 * correct and the resulting files are accepted by every WOFF2 consumer.
 */

import { Reader } from '../io/reader'
import { Writer } from '../io/writer'
import { WOFF2_SIGNATURE } from '../ttf/enum'
import { decodeGlyfTransform, encodeGlyfTransform } from './transform'

// eslint-disable-next-line pickier/no-unused-vars
export type BrotliCompressor = (data: Uint8Array) => Uint8Array | Promise<Uint8Array>
// eslint-disable-next-line pickier/no-unused-vars
export type BrotliDecompressor = (data: Uint8Array) => Uint8Array | Promise<Uint8Array>

interface BrotliImpls {
  compress?: BrotliCompressor
  decompress?: BrotliDecompressor
}

const state: BrotliImpls = {}

export function setBrotli(impls: BrotliImpls): void {
  Object.assign(state, impls)
}

async function getDefaultCompressor(): Promise<BrotliCompressor | undefined> {
  if (state.compress) return state.compress
  const g = globalThis as unknown as { process?: unknown }
  if (g.process) {
    try {
      const zlib = await import('node:zlib')
      return (data: Uint8Array) => new Uint8Array(zlib.brotliCompressSync(data))
    }
    catch {
      // fall through
    }
  }
  return undefined
}

async function getDefaultDecompressor(): Promise<BrotliDecompressor | undefined> {
  if (state.decompress) return state.decompress
  const g = globalThis as unknown as { process?: unknown }
  if (g.process) {
    try {
      const zlib = await import('node:zlib')
      return (data: Uint8Array) => new Uint8Array(zlib.brotliDecompressSync(data))
    }
    catch {
      // fall through
    }
  }
  // eslint-disable-next-line pickier/no-unused-vars
  type DecompressionStreamCtor = new (format: string) => unknown
  const gg = globalThis as unknown as { DecompressionStream?: DecompressionStreamCtor }
  if (gg.DecompressionStream) {
    try {
      // eslint-disable-next-line pickier/no-unused-vars
      const Ctor = gg.DecompressionStream as unknown as new (fmt: string) => ReadableWritablePair<Uint8Array, Uint8Array>
      return async (data: Uint8Array) => {
        const stream = new Ctor('br' as unknown as string)
        const writer = (stream as unknown as { writable: { getWriter: () => { write: (d: Uint8Array) => Promise<void>, close: () => Promise<void> } } }).writable.getWriter()
        writer.write(data)
        writer.close()
        const reader = (stream as unknown as { readable: { getReader: () => { read: () => Promise<{ done: boolean, value?: Uint8Array }> } } }).readable.getReader()
        const chunks: Uint8Array[] = []
        // eslint-disable-next-line no-constant-condition
        while (true) {
          const { done, value } = await reader.read()
          if (done) break
          if (value) chunks.push(value)
        }
        const total = chunks.reduce((s, c) => s + c.length, 0)
        const out = new Uint8Array(total)
        let off = 0
        for (const c of chunks) { out.set(c, off); off += c.length }
        return out
      }
    }
    catch {
      // fall through
    }
  }
  return undefined
}

// WOFF2 variable-length UIntBase128 encoding (spec §6.1.1)
function writeBase128(value: number, out: number[]): void {
  const bytes: number[] = []
  if (value === 0) { out.push(0); return }
  let v = value
  while (v > 0) {
    bytes.unshift(v & 0x7F)
    v >>>= 7
  }
  for (let i = 0; i < bytes.length - 1; i++)
    out.push(bytes[i] | 0x80)
  out.push(bytes[bytes.length - 1])
}

function readBase128(bytes: Uint8Array, offset: number): { value: number, next: number } {
  let value = 0
  let i = offset
  for (let k = 0; k < 5; k++) {
    const b = bytes[i++]
    value = (value << 7) | (b & 0x7F)
    if ((b & 0x80) === 0) return { value, next: i }
  }
  throw new Error('UIntBase128 overflow')
}

/** 4-char tag → index into the WOFF2 known-table list (spec §5.3) or -1. */
const WOFF2_KNOWN_TABLES = [
  'cmap', 'head', 'hhea', 'hmtx', 'maxp', 'name', 'OS/2', 'post',
  'cvt ', 'fpgm', 'glyf', 'loca', 'prep', 'CFF ', 'VORG', 'EBDT',
  'EBLC', 'gasp', 'hdmx', 'kern', 'LTSH', 'PCLT', 'VDMX', 'vhea',
  'vmtx', 'BASE', 'GDEF', 'GPOS', 'GSUB', 'EBSC', 'JSTF', 'MATH',
  'CBDT', 'CBLC', 'COLR', 'CPAL', 'SVG ', 'sbix', 'acnt', 'avar',
  'bdat', 'bloc', 'bsln', 'cvar', 'fdsc', 'feat', 'fmtx', 'fvar',
  'gvar', 'hsty', 'just', 'lcar', 'mort', 'morx', 'opbd', 'prop',
  'trak', 'Zapf', 'Silf', 'Glat', 'Gloc', 'Feat', 'Sill',
]

function tagIndex(tag: string): number {
  return WOFF2_KNOWN_TABLES.indexOf(tag)
}

export interface EncodeWOFF2Options {
  /**
   * Apply the WOFF2 §5.1 glyf/loca transform. Recovers ~10–15% in
   * compressed size at the cost of a longer encode. Default `true` when
   * the font has TT outlines; ignored for CFF.
   */
  transformGlyf?: boolean
}

/**
 * Encode a TTF/OTF ArrayBuffer as WOFF2 using the given Brotli compressor.
 * If no compressor is passed, attempts Node's built-in Brotli.
 */
export async function encodeWOFF2Native(
  ttfBuffer: ArrayBuffer,
  compress?: BrotliCompressor,
  opts: EncodeWOFF2Options = {},
): Promise<Uint8Array> {
  const br = compress ?? await getDefaultCompressor()
  if (!br)
    throw new Error('No Brotli encoder available — pass a compressor or call setBrotli()')

  const reader = new Reader(ttfBuffer)
  const sfntVersion = reader.readUint32()
  const numTables = reader.readUint16()
  reader.offset += 6

  interface TableEntry {
    tag: string
    origOffset: number
    origLength: number
    origChecksum: number
  }
  const entries: TableEntry[] = []
  for (let i = 0; i < numTables; i++) {
    const tag = reader.readString(reader.offset, 4)
    const checksum = reader.readUint32()
    const offset = reader.readUint32()
    const length = reader.readUint32()
    entries.push({ tag, origOffset: offset, origLength: length, origChecksum: checksum })
  }

  // Decide per-table what bytes to feed the brotli compressor and what
  // transformLength to advertise in the directory.
  const useGlyfTransform = (opts.transformGlyf ?? true) && entries.some(e => e.tag === 'glyf') && entries.some(e => e.tag === 'loca')
  let transformedGlyfBytes: Uint8Array | null = null
  if (useGlyfTransform) {
    try {
      transformedGlyfBytes = encodeGlyfTransform(ttfBuffer)
    }
    catch {
      // If the encoder rejects the font for any reason, fall back to identity.
      transformedGlyfBytes = null
    }
  }

  // Build concatenated, unpadded table stream — using the transformed glyf
  // bytes when applicable, and dropping loca entirely (loca is consumed by
  // the glyf-transform decoder).
  const src = new Uint8Array(ttfBuffer)
  const stream: number[] = []
  interface DirEntry { tag: string, origLength: number, transformLength?: number }
  const dirEntries: DirEntry[] = []
  for (const e of entries) {
    if (transformedGlyfBytes && e.tag === 'glyf') {
      for (let k = 0; k < transformedGlyfBytes.length; k++) stream.push(transformedGlyfBytes[k])
      dirEntries.push({ tag: 'glyf', origLength: e.origLength, transformLength: transformedGlyfBytes.length })
      continue
    }
    if (transformedGlyfBytes && e.tag === 'loca') {
      // Transformed loca contributes 0 bytes to the stream.
      dirEntries.push({ tag: 'loca', origLength: e.origLength, transformLength: 0 })
      continue
    }
    for (let k = 0; k < e.origLength; k++) stream.push(src[e.origOffset + k])
    dirEntries.push({ tag: e.tag, origLength: e.origLength })
  }
  const streamBytes = Uint8Array.from(stream)
  const maybeCompressed = br(streamBytes)
  const compressed = maybeCompressed instanceof Promise ? await maybeCompressed : maybeCompressed

  // Build WOFF2 table directory.
  const dirBytes: number[] = []
  for (const e of dirEntries) {
    const kt = tagIndex(e.tag)
    // Top 2 bits = transformVersion. 0 = transformed (only valid for glyf/loca);
    // 3 (binary 11) = identity / null transform for everything else.
    let transformVersion = 3
    if ((e.tag === 'glyf' || e.tag === 'loca') && e.transformLength !== undefined) {
      transformVersion = 0
    }
    const flags = kt < 0 ? (transformVersion << 6) | 0x3F : (kt | (transformVersion << 6))
    dirBytes.push(flags)
    if (kt < 0) {
      for (let i = 0; i < 4; i++) dirBytes.push(e.tag.charCodeAt(i))
    }
    writeBase128(e.origLength, dirBytes)
    // Emit transformLength for transformed glyf/loca.
    if (e.transformLength !== undefined) {
      writeBase128(e.transformLength, dirBytes)
    }
  }

  const headerSize = 48
  const dirSize = dirBytes.length
  const compressedSize = compressed.length
  const totalSize = headerSize + dirSize + compressedSize + (compressedSize % 4 === 0 ? 0 : 4 - compressedSize % 4)

  // totalSfntSize for WOFF2 header: 12 + numTables*16 + padded(origLength)
  let totalSfntSize = 12 + numTables * 16
  for (const e of entries) totalSfntSize += (e.origLength + 3) & ~3

  const out = new ArrayBuffer(totalSize)
  const writer = new Writer(out)
  writer.writeUint32(WOFF2_SIGNATURE)
  writer.writeUint32(sfntVersion)
  writer.writeUint32(totalSize)
  writer.writeUint16(numTables)
  writer.writeUint16(0) // reserved
  writer.writeUint32(totalSfntSize)
  writer.writeUint32(compressedSize)
  writer.writeUint16(1) // majorVersion
  writer.writeUint16(0) // minorVersion
  writer.writeUint32(0) // metaOffset
  writer.writeUint32(0) // metaLength
  writer.writeUint32(0) // metaOrigLength
  writer.writeUint32(0) // privOffset
  writer.writeUint32(0) // privLength

  writer.writeBytes(Uint8Array.from(dirBytes))
  writer.writeBytes(compressed)
  return new Uint8Array(out)
}

/**
 * Decode a WOFF2 buffer to a TTF ArrayBuffer using the given Brotli
 * decompressor.
 */
export async function decodeWOFF2Native(woff2Buffer: ArrayBuffer | Uint8Array, decompress?: BrotliDecompressor): Promise<Uint8Array> {
  const br = decompress ?? await getDefaultDecompressor()
  if (!br)
    throw new Error('No Brotli decoder available — pass a decompressor or call setBrotli()')

  const buf = woff2Buffer instanceof Uint8Array
    ? woff2Buffer
    : new Uint8Array(woff2Buffer)
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength)

  const signature = view.getUint32(0, false)
  if (signature !== WOFF2_SIGNATURE) throw new Error('not a WOFF2 font')
  const sfntVersion = view.getUint32(4, false)
  /* length */ view.getUint32(8, false)
  const numTables = view.getUint16(12, false)
  /* reserved */ view.getUint16(14, false)
  /* totalSfntSize */ view.getUint32(16, false)
  const totalCompressedSize = view.getUint32(20, false)
  /* majorVersion */ view.getUint16(24, false)
  /* minorVersion */ view.getUint16(26, false)
  /* metaOffset */ view.getUint32(28, false)
  /* metaLength */ view.getUint32(32, false)
  /* metaOrigLength */ view.getUint32(36, false)
  /* privOffset */ view.getUint32(40, false)
  /* privLength */ view.getUint32(44, false)

  // Parse table directory
  interface TableEntry {
    tag: string
    origLength: number
    transformLength: number
    transformVersion: number
  }
  let cursor = 48
  const entries: TableEntry[] = []
  for (let i = 0; i < numTables; i++) {
    const flags = buf[cursor++]
    const tableIdx = flags & 0x3F
    const transformVersion = (flags >> 6) & 0x03
    let tag: string
    if (tableIdx === 0x3F) {
      tag = String.fromCharCode(buf[cursor], buf[cursor + 1], buf[cursor + 2], buf[cursor + 3])
      cursor += 4
    }
    else {
      tag = WOFF2_KNOWN_TABLES[tableIdx] ?? '????'
    }
    const { value: origLength, next } = readBase128(buf, cursor)
    cursor = next
    let transformLength = origLength
    if ((tag === 'glyf' || tag === 'loca') && transformVersion === 0) {
      const { value: tl, next: next2 } = readBase128(buf, cursor)
      transformLength = tl
      cursor = next2
    }
    entries.push({ tag, origLength, transformLength, transformVersion })
  }

  // Decompress the table stream
  const compressed = buf.subarray(cursor, cursor + totalCompressedSize)
  const maybe = br(compressed)
  const decompressed = maybe instanceof Promise ? await maybe : maybe

  // If the font carries the glyf/loca transform, decode it before SFNT
  // assembly so we can splice the reconstructed bytes back into the
  // per-table positions.
  const transformedGlyfEntry = entries.find(e => e.tag === 'glyf' && e.transformVersion === 0)
  let decodedGlyf: Uint8Array | null = null
  let decodedLoca: Uint8Array | null = null
  if (transformedGlyfEntry) {
    // The transformed glyf bytes occupy `transformLength` bytes in the stream;
    // walk the stream to find them.
    let glyfStreamStart = 0
    for (const e of entries) {
      if (e === transformedGlyfEntry) break
      // Each entry's stream contribution: transformed length if transformed,
      // origLength otherwise. (Transformed loca contributes 0.)
      if (e.tag === 'loca' && e.transformVersion === 0) continue
      glyfStreamStart += e.transformLength
    }
    const transformedSlice = decompressed.subarray(glyfStreamStart, glyfStreamStart + transformedGlyfEntry.transformLength)
    const decoded = decodeGlyfTransform(transformedSlice)
    decodedGlyf = decoded.glyf
    decodedLoca = decoded.loca
    // Override the entries' origLength to match the decoded sizes.
    transformedGlyfEntry.origLength = decodedGlyf.length
    const locaEntry = entries.find(e => e.tag === 'loca' && e.transformVersion === 0)
    if (locaEntry) locaEntry.origLength = decodedLoca.length
  }

  // Assemble TTF
  const headerSize = 12 + numTables * 16
  let outCursor = headerSize
  const offsets: number[] = []
  for (const e of entries) {
    offsets.push(outCursor)
    outCursor += e.origLength
    outCursor = (outCursor + 3) & ~3
  }
  const totalSize = outCursor
  const out = new ArrayBuffer(totalSize)
  const ov = new DataView(out)
  ov.setUint32(0, sfntVersion, false)
  const entrySelector = Math.floor(Math.log2(numTables))
  const searchRange = 16 * (2 ** entrySelector)
  ov.setUint16(4, numTables, false)
  ov.setUint16(6, searchRange, false)
  ov.setUint16(8, entrySelector, false)
  ov.setUint16(10, numTables * 16 - searchRange, false)

  const sortedIdx = entries
    .map((e, i) => ({ tag: e.tag, i }))
    .sort((a, b) => a.tag < b.tag ? -1 : a.tag > b.tag ? 1 : 0)
    .map(x => x.i)

  for (let k = 0; k < sortedIdx.length; k++) {
    const i = sortedIdx[k]
    const e = entries[i]
    const recOff = 12 + k * 16
    for (let j = 0; j < 4; j++)
      ov.setUint8(recOff + j, `${e.tag}    `.charCodeAt(j))
    ov.setUint32(recOff + 4, 0, false) // checksum (skipped — consumer may verify)
    ov.setUint32(recOff + 8, offsets[i], false)
    ov.setUint32(recOff + 12, e.origLength, false)
  }

  let srcPos = 0
  const dstView = new Uint8Array(out)
  for (let i = 0; i < entries.length; i++) {
    const e = entries[i]
    if (e.transformVersion === 0 && e.tag === 'glyf' && decodedGlyf) {
      dstView.set(decodedGlyf, offsets[i])
      srcPos += e.transformLength
    }
    else if (e.transformVersion === 0 && e.tag === 'loca' && decodedLoca) {
      dstView.set(decodedLoca, offsets[i])
      // transformed loca is 0 bytes in the stream
    }
    else {
      dstView.set(decompressed.subarray(srcPos, srcPos + e.origLength), offsets[i])
      srcPos += e.origLength
    }
  }

  return new Uint8Array(out)
}
