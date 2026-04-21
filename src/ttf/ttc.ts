import { Reader } from '../io/reader'
import { Writer } from '../io/writer'

/**
 * TTC (TrueType Collection) header — packs multiple fonts into a single
 * file, each with its own table directory but sharing underlying table
 * data when possible.
 *
 * Header layout:
 *   'ttcf' (4 bytes)
 *   majorVersion uint16 (1 or 2)
 *   minorVersion uint16 (0)
 *   numFonts uint32
 *   offsetTable uint32[numFonts]  — each points at a per-font SFNT header
 *   (v2 only) DSIG data trailing
 */

export const TTC_TAG = 0x74746366 // 'ttcf'

export interface TTCInfo {
  majorVersion: number
  minorVersion: number
  fontOffsets: number[]
}

/**
 * Check whether a buffer is a TTC by looking for the 'ttcf' magic.
 */
export function isTTC(buffer: ArrayBuffer): boolean {
  if (buffer.byteLength < 4) return false
  const view = new DataView(buffer)
  return view.getUint32(0, false) === TTC_TAG
}

/**
 * Parse the TTC header and return the list of per-font offsets plus
 * version metadata.
 */
export function readTTCHeader(buffer: ArrayBuffer): TTCInfo {
  const reader = new Reader(buffer)
  const tag = reader.readUint32()
  if (tag !== TTC_TAG)
    throw new Error('not a TTC font collection')
  const majorVersion = reader.readUint16()
  const minorVersion = reader.readUint16()
  const numFonts = reader.readUint32()
  const fontOffsets: number[] = []
  for (let i = 0; i < numFonts; i++)
    fontOffsets.push(reader.readUint32())
  return { majorVersion, minorVersion, fontOffsets }
}

/**
 * Extract one sub-font from a TTC buffer, starting at the given per-font
 * offset. Returns a standalone TTF ArrayBuffer by copying the referenced
 * tables into a new SFNT wrapper.
 */
export function extractTTCFont(buffer: ArrayBuffer, fontOffset: number): ArrayBuffer {
  const reader = new Reader(buffer)
  reader.seek(fontOffset)
  const sfntVersion = reader.readUint32()
  const numTables = reader.readUint16()
  reader.offset += 6 // searchRange + entrySelector + rangeShift

  interface Entry {
    tag: string
    checksum: number
    offset: number
    length: number
  }
  const entries: Entry[] = []
  for (let i = 0; i < numTables; i++) {
    const tag = reader.readString(reader.offset, 4)
    const checksum = reader.readUint32()
    const tableOffset = reader.readUint32()
    const length = reader.readUint32()
    entries.push({ tag, checksum, offset: tableOffset, length })
  }

  // Compute new offsets with 4-byte alignment between tables.
  const headerSize = 12 + numTables * 16
  let cursor = headerSize
  const newOffsets: number[] = []
  for (const e of entries) {
    newOffsets.push(cursor)
    cursor += e.length + ((4 - e.length % 4) % 4)
  }
  const totalSize = cursor

  const out = new ArrayBuffer(totalSize)
  const writer = new Writer(out)
  writer.writeUint32(sfntVersion)
  const entrySelector = Math.floor(Math.log2(numTables))
  const searchRange = 16 * (2 ** entrySelector)
  writer.writeUint16(numTables)
  writer.writeUint16(searchRange)
  writer.writeUint16(entrySelector)
  writer.writeUint16(numTables * 16 - searchRange)

  const sortedIdx = entries
    .map((e, i) => ({ tag: e.tag, i }))
    .sort((a, b) => a.tag < b.tag ? -1 : a.tag > b.tag ? 1 : 0)
    .map(x => x.i)

  for (const i of sortedIdx) {
    const e = entries[i]
    writer.writeString(`${e.tag}    `.slice(0, 4), 4)
    writer.writeUint32(e.checksum)
    writer.writeUint32(newOffsets[i])
    writer.writeUint32(e.length)
  }

  // Copy table bodies
  const srcView = new Uint8Array(buffer)
  const dstView = new Uint8Array(out)
  for (let i = 0; i < entries.length; i++) {
    const e = entries[i]
    dstView.set(srcView.subarray(e.offset, e.offset + e.length), newOffsets[i])
  }

  return out
}

/**
 * Compose N standalone TTF buffers into a single TTC. Tables are simply
 * laid out sequentially — no deduplication is performed (each sub-font
 * keeps its own bytes).
 */
export function buildTTC(fontBuffers: ArrayBuffer[]): ArrayBuffer {
  const headerSize = 12 + fontBuffers.length * 4
  let cursor = headerSize
  const fontOffsets: number[] = []
  for (const fb of fontBuffers) {
    const pad = (4 - (cursor % 4)) % 4
    cursor += pad
    fontOffsets.push(cursor)
    cursor += fb.byteLength
  }

  const totalSize = cursor
  const out = new ArrayBuffer(totalSize)
  const writer = new Writer(out)
  writer.writeUint32(TTC_TAG)
  writer.writeUint16(1) // majorVersion
  writer.writeUint16(0) // minorVersion
  writer.writeUint32(fontBuffers.length)
  for (const o of fontOffsets) writer.writeUint32(o)

  const dst = new Uint8Array(out)
  for (let i = 0; i < fontBuffers.length; i++) {
    const base = fontOffsets[i]
    dst.set(new Uint8Array(fontBuffers[i]), base)
    // Rewrite each embedded sub-font's table directory so the `offset`
    // field of every entry is absolute within the TTC (per spec).
    const subView = new DataView(out, base)
    const numTables = subView.getUint16(4, false)
    for (let t = 0; t < numTables; t++) {
      const dirEntryOff = 12 + t * 16
      const oldOff = subView.getUint32(dirEntryOff + 8, false)
      subView.setUint32(dirEntryOff + 8, base + oldOff, false)
    }
  }

  return out
}
