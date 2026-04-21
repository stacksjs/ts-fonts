import type { TTFObject } from '../types'
import { Writer } from '../io/writer'
import { checkSum, pad4 } from './checksum'
import { CHECKSUM_MAGIC, SFNT_VERSION_TTF } from './enum'
import { avarSize, writeAvar } from './tables/avar'
import { cmapSize, writeCmap } from './tables/cmap'
import { fvarSize, writeFvar } from './tables/fvar'
import { computeGlyfSizes, writeGlyph } from './tables/glyf'
import { gvarSize, writeGvar } from './tables/gvar'
import { HEAD_SIZE, writeHead } from './tables/head'
import { HHEA_SIZE, writeHhea } from './tables/hhea'
import { hmtxSize, writeHmtx } from './tables/hmtx'
import { kernSize, writeKern } from './tables/kern'
import { locaSize, writeLoca } from './tables/loca'
import { MAXP_SIZE, writeMaxp } from './tables/maxp'
import { nameSize, writeName } from './tables/name'
import { os2Size, writeOS2 } from './tables/os2'
import { postSize, writePost } from './tables/post'
import { statSize, writeStat } from './tables/stat'

export interface TTFWriterOptions {
  writeZeroContoursGlyfData?: boolean
  hinting?: boolean
  kerning?: boolean
  support?: Record<string, unknown>
}

interface TableSpec {
  tag: string
  size: number
  write: (writer: Writer, ttf: TTFObject) => void
}

export class TTFWriter {
  private options: TTFWriterOptions

  constructor(options: TTFWriterOptions = {}) {
    this.options = options
  }

  write(ttf: TTFObject): ArrayBuffer {
    this.prepareDump(ttf)
    this.resolveTTF(ttf)
    return this.dump(ttf)
  }

  protected prepareDump(ttf: TTFObject): void {
    // Ensure essentials exist
    if (!ttf.head || !ttf.hhea || !ttf.maxp || !ttf['OS/2'] || !ttf.name || !ttf.post)
      throw new Error('missing required tables')
    if (!ttf.cmap)
      ttf.cmap = {}

    // Apply support overrides
    const support = this.options.support as { head?: Record<string, number>, hhea?: Record<string, number> } | undefined
    if (support?.head)
      Object.assign(ttf.head, support.head)
    if (support?.hhea)
      Object.assign(ttf.hhea, support.hhea)
  }

  protected resolveTTF(ttf: TTFObject): void {
    // Recompute numGlyphs
    ttf.maxp.numGlyphs = ttf.glyf.length
    // numOfLongHorMetrics: write all as long metrics
    ttf.hhea.numOfLongHorMetrics = ttf.glyf.length

    // Recompute bounding box across glyphs
    if (ttf.glyf.length > 0) {
      let xMin = Infinity, yMin = Infinity, xMax = -Infinity, yMax = -Infinity
      let maxPoints = 0, maxContours = 0, advMax = 0
      for (const g of ttf.glyf) {
        if (g.contours && g.contours.length > 0) {
          if (g.xMin < xMin) xMin = g.xMin
          if (g.yMin < yMin) yMin = g.yMin
          if (g.xMax > xMax) xMax = g.xMax
          if (g.yMax > yMax) yMax = g.yMax
          maxContours = Math.max(maxContours, g.contours.length)
          maxPoints = Math.max(maxPoints, g.contours.reduce((s, c) => s + c.length, 0))
        }
        advMax = Math.max(advMax, g.advanceWidth ?? 0)
      }
      if (Number.isFinite(xMin)) {
        ttf.head.xMin = xMin
        ttf.head.yMin = yMin
        ttf.head.xMax = xMax
        ttf.head.yMax = yMax
      }
      ttf.maxp.maxPoints = maxPoints
      ttf.maxp.maxContours = maxContours
      ttf.hhea.advanceWidthMax = advMax
    }

    // Use long loca
    ttf.head.indexToLocFormat = 1
    ttf.head.checkSumAdjustment = 0
  }

  protected dump(ttf: TTFObject): ArrayBuffer {
    const specs = this.collectTables(ttf)

    const numTables = specs.length
    const headerSize = 12 + numTables * 16

    // Pre-compute each table's padded size and offset
    const tableInfo = specs.map(spec => ({
      spec,
      size: spec.size,
      paddedSize: spec.size + pad4(spec.size),
    }))

    let currentOffset = headerSize
    const offsets: number[] = []
    for (const t of tableInfo) {
      offsets.push(currentOffset)
      currentOffset += t.paddedSize
    }
    const totalSize = currentOffset

    const buffer = new ArrayBuffer(totalSize)
    const writer = new Writer(buffer)

    // Write header
    writer.writeUint32(SFNT_VERSION_TTF)
    const entrySelector = Math.floor(Math.log2(numTables))
    const searchRange = 16 * (2 ** entrySelector)
    writer.writeUint16(numTables)
    writer.writeUint16(searchRange)
    writer.writeUint16(entrySelector)
    writer.writeUint16(numTables * 16 - searchRange)

    // Reserve directory; write table data first, then rewrite directory
    // Write placeholder directory
    const dirStart = writer.offset
    for (let i = 0; i < numTables; i++) {
      writer.writeString('    ', 4)
      writer.writeUint32(0)
      writer.writeUint32(0)
      writer.writeUint32(0)
    }

    // Write each table
    const checksums: number[] = []
    for (let i = 0; i < tableInfo.length; i++) {
      const t = tableInfo[i]
      const startOff = offsets[i]
      writer.seek(startOff)
      t.spec.write(writer, ttf)
      // Zero-pad to 4-byte alignment
      const endOff = writer.offset
      const pad = t.paddedSize - (endOff - startOff)
      for (let p = 0; p < pad; p++)
        writer.writeUint8(0)
      // Compute checksum
      const cs = checkSum(buffer, startOff, t.paddedSize)
      checksums.push(cs)
    }

    // Rewrite directory entries with checksums sorted by tag
    const sortedIndices = tableInfo
      .map((t, i) => ({ tag: t.spec.tag, i }))
      .sort((a, b) => a.tag < b.tag ? -1 : a.tag > b.tag ? 1 : 0)
    writer.seek(dirStart)
    for (const { i } of sortedIndices) {
      const t = tableInfo[i]
      writer.writeString(`${t.spec.tag}    `.slice(0, 4), 4)
      writer.writeUint32(checksums[i])
      writer.writeUint32(offsets[i])
      writer.writeUint32(t.size)
    }

    // Compute checkSumAdjustment across full file
    const fileChecksum = checkSum(buffer)
    const adjust = (CHECKSUM_MAGIC - fileChecksum) >>> 0
    // find head offset
    const headIndex = tableInfo.findIndex(t => t.spec.tag === 'head')
    if (headIndex >= 0) {
      const headOff = offsets[headIndex]
      // checkSumAdjustment is at byte offset 8 in head table
      new DataView(buffer).setUint32(headOff + 8, adjust, false)
      ttf.head.checkSumAdjustment = adjust
    }

    return buffer
  }

  private collectTables(ttf: TTFObject): TableSpec[] {
    const list: TableSpec[] = []

    list.push({ tag: 'head', size: HEAD_SIZE, write: writeHead })
    list.push({ tag: 'hhea', size: HHEA_SIZE, write: writeHhea })
    list.push({ tag: 'maxp', size: MAXP_SIZE, write: writeMaxp })
    list.push({ tag: 'OS/2', size: os2Size(ttf), write: writeOS2 })
    list.push({ tag: 'name', size: nameSize(ttf), write: writeName })
    list.push({ tag: 'cmap', size: cmapSize(ttf), write: writeCmap })
    list.push({ tag: 'post', size: postSize(ttf), write: writePost })
    list.push({ tag: 'hmtx', size: hmtxSize(ttf), write: writeHmtx })

    // glyf + loca
    const { totalSize: glyfSize, offsets: glyfOffsets } = computeGlyfSizes(ttf)
    list.push({
      tag: 'loca',
      size: locaSize(ttf),
      write: (w, t) => writeLoca(w, t, glyfOffsets),
    })
    list.push({
      tag: 'glyf',
      size: glyfSize,
      write: (w, t) => writeGlyfAll(w, t, glyfOffsets),
    })

    // Optional tables
    if (this.options.kerning && ttf.kern && ttf.kern.subtables.length > 0) {
      list.push({ tag: 'kern', size: kernSize(ttf), write: writeKern })
    }
    if (this.options.hinting) {
      if (ttf.fpgm) list.push({ tag: 'fpgm', size: ttf.fpgm.length, write: w => w.writeBytes(ttf.fpgm!) })
      if (ttf.cvt) list.push({ tag: 'cvt ', size: ttf.cvt.length, write: w => w.writeBytes(ttf.cvt!) })
      if (ttf.prep) list.push({ tag: 'prep', size: ttf.prep.length, write: w => w.writeBytes(ttf.prep!) })
      if (ttf.gasp) list.push({ tag: 'gasp', size: ttf.gasp.length, write: w => w.writeBytes(ttf.gasp!) })
    }

    // Variable font tables
    if (ttf.fvar) list.push({ tag: 'fvar', size: fvarSize(ttf), write: writeFvar })
    if (ttf.avar) list.push({ tag: 'avar', size: avarSize(ttf), write: writeAvar })
    if (ttf.STAT) list.push({ tag: 'STAT', size: statSize(ttf), write: writeStat })
    if (ttf.gvar) list.push({ tag: 'gvar', size: gvarSize(ttf), write: writeGvar })
    // HVAR and MVAR as raw passthrough (if present from read)
    if (ttf.HVAR?.raw) list.push({ tag: 'HVAR', size: ttf.HVAR.raw.length, write: w => w.writeBytes(ttf.HVAR!.raw!) })
    if (ttf.MVAR?.raw) list.push({ tag: 'MVAR', size: ttf.MVAR.raw.length, write: w => w.writeBytes(ttf.MVAR!.raw!) })

    // Preserved raw OpenType / vertical-metrics / color tables
    if (ttf.rawTables) {
      const emitRaw = this.options.kerning
        ? Object.keys(ttf.rawTables)
        : Object.keys(ttf.rawTables).filter(t => t !== 'GPOS' && t !== 'GSUB' && t !== 'GDEF')
      for (const tag of emitRaw) {
        const data = ttf.rawTables[tag]
        if (!data || data.length === 0) continue
        list.push({ tag, size: data.length, write: w => w.writeBytes(data) })
      }
    }

    return list
  }

  dispose(): void {
    this.options = {}
  }
}

function writeGlyfAll(writer: Writer, ttf: TTFObject, offsets: number[]): void {
  const baseOff = writer.offset
  for (let i = 0; i < ttf.glyf.length; i++) {
    writer.seek(baseOff + offsets[i])
    writeGlyph(writer, ttf.glyf[i])
  }
  writer.seek(baseOff + offsets[offsets.length - 1])
}

export function createTTFWriter(options?: TTFWriterOptions): TTFWriter {
  return new TTFWriter(options)
}
