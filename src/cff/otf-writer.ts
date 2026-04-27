/**
 * OTF (OpenType with CFF outlines) writer.
 *
 * Wraps `writeCFF` in a sfnt container with magic 'OTTO' and the standard
 * OpenType non-outline tables (head, hhea, maxp, OS/2, name, cmap, post,
 * hmtx, plus authored GSUB if present).
 *
 * Reuses the per-table writers from `tables/` so head / OS/2 / name / cmap /
 * GSUB serialisation matches `TTFWriter` byte-for-byte. Differences from
 * the TTF path:
 *   - sfnt magic: 'OTTO' instead of 0x00010000.
 *   - No `glyf` / `loca` tables — those are replaced by `CFF`.
 *   - `maxp` is the v0.5 subset (no glyf-derived counts).
 *   - `post` is format 3 (no glyph names), since CFF carries names itself.
 */

import type { TTFObject } from '../types'
import { Writer } from '../io/writer'
import { checkSum, pad4 } from '../ttf/checksum'
import { CHECKSUM_MAGIC } from '../ttf/enum'
import { cmapSize, writeCmap } from '../ttf/tables/cmap'
import { gposSize, writeGpos } from '../ttf/tables/gpos'
import { gsubSize, writeGsub } from '../ttf/tables/gsub'
import { HEAD_SIZE, writeHead } from '../ttf/tables/head'
import { HHEA_SIZE, writeHhea } from '../ttf/tables/hhea'
import { hmtxSize, writeHmtx } from '../ttf/tables/hmtx'
import { writeName as writeNameTable, nameSize } from '../ttf/tables/name'
import { os2Size, writeOS2 } from '../ttf/tables/os2'
import { writeCFF, type CffWriteOptions } from './writer'

const SFNT_MAGIC_OTTO = 0x4F54544F // 'OTTO'
const POST_FORMAT_3_SIZE = 32

/** Build a minimal post v3 table (no glyph-name overhead, since CFF has them). */
function writePostFormat3(writer: Writer, ttf: TTFObject): void {
  const post = ttf.post
  // Version 3.0
  writer.writeInt32(0x00030000)
  writer.writeInt32(Math.round(post.italicAngle ?? 0) << 16)
  writer.writeInt16(post.underlinePosition ?? 0)
  writer.writeInt16(post.underlineThickness ?? 0)
  writer.writeUint32(post.isFixedPitch ?? 0)
  writer.writeUint32(post.minMemType42 ?? 0)
  writer.writeUint32(post.maxMemType42 ?? 0)
  writer.writeUint32(post.minMemType1 ?? 0)
  writer.writeUint32(post.maxMemType1 ?? 0)
}

/** Build a minimal maxp v0.5 (CFF) — just numGlyphs. */
const MAXP_V05_SIZE = 6
function writeMaxpV05(writer: Writer, ttf: TTFObject): void {
  writer.writeInt32(0x00005000) // version 0.5
  writer.writeUint16(ttf.glyf.length)
}

interface TableSpec {
  tag: string
  size: number
  write: (writer: Writer, ttf: TTFObject, cffBytes: Uint8Array) => void
}

export interface OTFWriterOptions {
  /** PostScript-safe family name to embed in the CFF Name INDEX. */
  fontName?: string
  /** Optional human strings copied into the CFF Top DICT. */
  cffStrings?: CffWriteOptions['strings']
}

export class OTFWriter {
  constructor(private readonly options: OTFWriterOptions = {}) {}

  write(ttf: TTFObject): ArrayBuffer {
    this.prepareTTF(ttf)

    const fontName = this.options.fontName
      ?? (typeof ttf.name.postScriptName === 'string' ? ttf.name.postScriptName as string : undefined)
      ?? (typeof ttf.name.fontFamily === 'string' ? ttf.name.fontFamily as string : 'Untitled')
    const familyName = typeof ttf.name.fontFamily === 'string' ? ttf.name.fontFamily as string : undefined
    const fullName = typeof ttf.name.fullName === 'string' ? ttf.name.fullName as string : familyName
    const version = typeof ttf.name.version === 'string' ? ttf.name.version as string : undefined
    const copyright = typeof ttf.name.copyright === 'string' ? ttf.name.copyright as string : undefined

    // Build CFF bytes once; we reuse them for layout + write.
    const advanceWidths = ttf.glyf.map(g => g.advanceWidth ?? 0)
    const fontBBox: [number, number, number, number] = [
      ttf.head.xMin ?? 0,
      ttf.head.yMin ?? 0,
      ttf.head.xMax ?? 0,
      ttf.head.yMax ?? 0,
    ]
    const cffBytes = writeCFF({
      fontName,
      glyphs: ttf.glyf,
      advanceWidths,
      fontBBox,
      strings: { ...this.options.cffStrings, version, copyright, fullName, familyName, weight: undefined },
      italicAngle: ttf.post.italicAngle,
      underlinePosition: ttf.post.underlinePosition,
      underlineThickness: ttf.post.underlineThickness,
      isFixedPitch: !!ttf.post.isFixedPitch,
    })

    const tables = this.collectTables(ttf, cffBytes)

    // SFNT directory + tables
    const numTables = tables.length
    const headerSize = 12
    const dirSize = 16 * numTables
    let dataOffset = headerSize + dirSize
    const tableOffsets: number[] = []
    const tableSizes: number[] = []
    let totalSize = dataOffset
    for (const t of tables) {
      tableOffsets.push(totalSize)
      tableSizes.push(t.size)
      // pad4(n) returns the number of padding bytes (not the padded size).
      totalSize += t.size + pad4(t.size)
    }

    const buf = new ArrayBuffer(totalSize)
    const writer = new Writer(buf)

    // SFNT header
    writer.writeUint32(SFNT_MAGIC_OTTO)
    writer.writeUint16(numTables)
    const entrySelector = Math.floor(Math.log2(numTables))
    const searchRange = 16 * (2 ** entrySelector)
    writer.writeUint16(searchRange)
    writer.writeUint16(entrySelector)
    writer.writeUint16(numTables * 16 - searchRange)

    // Sort by tag for the directory (per spec).
    const order = tables.map((t, i) => i).sort((a, b) => tables[a]!.tag < tables[b]!.tag ? -1 : tables[a]!.tag > tables[b]!.tag ? 1 : 0)
    for (const i of order) {
      const t = tables[i]!
      writer.writeString(`${t.tag}    `.slice(0, 4), 4)
      writer.writeUint32(0) // checksum placeholder
      writer.writeUint32(tableOffsets[i]!)
      writer.writeUint32(tableSizes[i]!)
    }

    // Write each table at its assigned offset.
    for (let i = 0; i < tables.length; i++) {
      writer.seek(tableOffsets[i]!)
      const before = writer.offset
      tables[i]!.write(writer, ttf, cffBytes)
      const actual = writer.offset - before
      if (actual > tableSizes[i]!) {
        throw new Error(`OTFWriter: ${tables[i]!.tag} wrote ${actual} bytes but declared size ${tableSizes[i]!}`)
      }
      // Pad to 4-byte boundary
      const padTo = tableOffsets[i]! + tableSizes[i]! + pad4(tableSizes[i]!)
      while (writer.offset < padTo) writer.writeUint8(0)
    }

    // Compute checksums and patch the directory.
    const view = new DataView(buf)
    for (const i of order) {
      const cs = checkSum(buf, tableOffsets[i]!, tableSizes[i]!)
      // Find this table's directory entry — sorted index === order index.
      const dirIdx = order.indexOf(i)
      const dirOff = headerSize + dirIdx * 16 + 4
      view.setUint32(dirOff, cs, false)
    }

    // checkSumAdjustment in head
    const headIdx = tables.findIndex(t => t.tag === 'head')
    if (headIdx >= 0) {
      const headOff = tableOffsets[headIdx]!
      view.setUint32(headOff + 8, 0, false)
      const fileSum = checkSum(buf, 0, totalSize)
      const adjust = (CHECKSUM_MAGIC - fileSum) >>> 0
      view.setUint32(headOff + 8, adjust, false)
      ttf.head.checkSumAdjustment = adjust
    }

    return buf
  }

  protected prepareTTF(ttf: TTFObject): void {
    if (!ttf.head || !ttf.hhea || !ttf.maxp || !ttf['OS/2'] || !ttf.name || !ttf.post)
      throw new Error('OTFWriter: missing required tables (head/hhea/maxp/OS/2/name/post)')
    if (!ttf.cmap) ttf.cmap = {}
    ttf.maxp.numGlyphs = ttf.glyf.length
    ttf.hhea.numOfLongHorMetrics = ttf.glyf.length
  }

  private collectTables(ttf: TTFObject, cffBytes: Uint8Array): TableSpec[] {
    const list: TableSpec[] = []

    list.push({ tag: 'CFF ', size: cffBytes.length, write: (w, _t, c) => w.writeBytes(c) })
    list.push({ tag: 'OS/2', size: os2Size(ttf), write: (w, t) => writeOS2(w, t) })
    list.push({ tag: 'cmap', size: cmapSize(ttf), write: (w, t) => writeCmap(w, t) })
    list.push({ tag: 'head', size: HEAD_SIZE, write: (w, t) => writeHead(w, t) })
    list.push({ tag: 'hhea', size: HHEA_SIZE, write: (w, t) => writeHhea(w, t) })
    list.push({ tag: 'hmtx', size: hmtxSize(ttf), write: (w, t) => writeHmtx(w, t) })
    list.push({ tag: 'maxp', size: MAXP_V05_SIZE, write: (w, t) => writeMaxpV05(w, t) })
    list.push({ tag: 'name', size: nameSize(ttf), write: (w, t) => writeNameTable(w, t) })
    list.push({ tag: 'post', size: POST_FORMAT_3_SIZE, write: (w, t) => writePostFormat3(w, t) })

    if (ttf.gsub) {
      const gs = gsubSize(ttf)
      if (gs > 0) list.push({ tag: 'GSUB', size: gs, write: (w, t) => writeGsub(w, t) })
    }
    if (ttf.gpos) {
      const gp = gposSize(ttf)
      if (gp > 0) list.push({ tag: 'GPOS', size: gp, write: (w, t) => writeGpos(w, t) })
    }

    return list
  }
}

export function createOTFWriter(options?: OTFWriterOptions): OTFWriter {
  return new OTFWriter(options)
}
