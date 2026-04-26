import type { FontReadOptions, NamedInstance, TTFObject } from '../types'
import { Reader } from '../io/reader'
import { readDirectory } from './directory'
import { NAME_ID_TO_KEY } from './enum'
import { readAvar } from './tables/avar'
import { readCmapWithFormat14 } from './tables/cmap'
import { readFvar } from './tables/fvar'
import { readGlyf } from './tables/glyf'
import { readHead } from './tables/head'
import { readHhea } from './tables/hhea'
import { readHmtx } from './tables/hmtx'
import { readKern } from './tables/kern'
import { readLoca } from './tables/loca'
import { readMaxp } from './tables/maxp'
import { readName } from './tables/name'
import { readOS2 } from './tables/os2'
import { readGvar } from './tables/gvar'
import { readHvar, readMvar, readRawTable } from './tables/passthrough'
import { applyPostFormat2Names, readPost } from './tables/post'
import { readStat } from './tables/stat'

export interface TTFReaderOptions {
  subset?: number[]
  hinting?: boolean
  /** Preserve `kern` table (legacy kerning). Default off. */
  kerning?: boolean
  /**
   * Preserve OpenType layout tables (`GSUB`, `GPOS`, `GDEF`) as raw bytes
   * on `ttf.rawTables`. Default `true`.
   *
   * Historically this was tied to the `kerning` flag; that coupling was
   * surprising — fonts with ligatures should round-trip GSUB whether or
   * not the caller cares about kerning. Pass `false` if you specifically
   * want a layout-table-stripped TTF (e.g. before re-authoring GSUB from
   * scratch via `Substitution`).
   */
  preserveLayout?: boolean
  compound2simple?: boolean
}

export class TTFReader {
  private options: TTFReaderOptions

  constructor(options: TTFReaderOptions = {}) {
    this.options = options
  }

  read(buffer: ArrayBuffer): TTFObject {
    const ttf = this.readBuffer(buffer)
    this.resolveGlyf(ttf)
    this.cleanTables(ttf)
    return ttf
  }

  protected readBuffer(buffer: ArrayBuffer): TTFObject {
    const reader = new Reader(buffer)
    const dir = readDirectory(reader)

    const ttf = {
      version: dir.sfntVersion,
      numTables: dir.numTables,
      searchRange: dir.searchRange,
      entrySelector: dir.entrySelector,
      rangeShift: dir.rangeShift,
    } as unknown as TTFObject

    if (dir.tables.head)
      ttf.head = readHead(reader, dir.tables.head.offset)
    if (dir.tables.maxp)
      ttf.maxp = readMaxp(reader, dir.tables.maxp.offset)
    if (dir.tables.hhea)
      ttf.hhea = readHhea(reader, dir.tables.hhea.offset)
    if (dir.tables.hmtx && ttf.hhea && ttf.maxp) {
      ttf.hmtx = readHmtx(reader, dir.tables.hmtx.offset, ttf.hhea.numOfLongHorMetrics, ttf.maxp.numGlyphs)
    }
    if (dir.tables['OS/2'])
      ttf['OS/2'] = readOS2(reader, dir.tables['OS/2'].offset)
    if (dir.tables.name)
      ttf.name = readName(reader, dir.tables.name.offset)
    if (dir.tables.post)
      ttf.post = readPost(reader, dir.tables.post.offset)
    if (dir.tables.cmap) {
      const result = readCmapWithFormat14(reader, dir.tables.cmap.offset)
      ttf.cmap = result.cmap
      if (result.format14)
        ttf.cmapFormat14 = result.format14
    }

    // loca + glyf
    if (dir.tables.loca && ttf.head && ttf.maxp) {
      const loca = readLoca(reader, dir.tables.loca.offset, ttf.maxp.numGlyphs, ttf.head.indexToLocFormat)
      ttf.loca = loca
      if (dir.tables.glyf)
        ttf.glyf = readGlyf(reader, dir.tables.glyf.offset, loca)
    }
    if (!ttf.glyf)
      ttf.glyf = []

    if (this.options.kerning && dir.tables.kern)
      ttf.kern = readKern(reader, dir.tables.kern.offset)

    if (this.options.hinting) {
      if (dir.tables.fpgm)
        ttf.fpgm = reader.readBytes(dir.tables.fpgm.offset, dir.tables.fpgm.length)
      if (dir.tables.cvt)
        ttf.cvt = reader.readBytes(dir.tables.cvt.offset, dir.tables.cvt.length)
      if (dir.tables.prep)
        ttf.prep = reader.readBytes(dir.tables.prep.offset, dir.tables.prep.length)
      if (dir.tables.gasp)
        ttf.gasp = reader.readBytes(dir.tables.gasp.offset, dir.tables.gasp.length)
    }

    // Preserve OpenType layout / color / vertical-metrics tables as raw bytes
    const PRESERVED_RAW_TAGS = [
      'GSUB', 'GPOS', 'GDEF', 'BASE', 'JSTF', 'MATH',
      'COLR', 'CPAL', 'SVG ', 'sbix', 'CBDT', 'CBLC',
      'DSIG', 'meta', 'VORG', 'VVAR', 'VDMX', 'LTSH',
      'PCLT', 'hdmx', 'vhea', 'vmtx', 'EBDT', 'EBLC', 'EBSC',
    ]
    const rawTables: Record<string, Uint8Array> = {}
    for (const tag of PRESERVED_RAW_TAGS) {
      const entry = dir.tables[tag]
      if (!entry) continue
      rawTables[tag] = new Uint8Array(reader.readBytes(entry.offset, entry.length))
    }
    if (Object.keys(rawTables).length > 0)
      ttf.rawTables = rawTables

    // Variable font tables
    if (dir.tables.fvar)
      ttf.fvar = readFvar(reader, dir.tables.fvar.offset)
    if (dir.tables.avar) {
      const axisTags = ttf.fvar?.axes.map(a => a.tag)
      ttf.avar = readAvar(reader, dir.tables.avar.offset, axisTags)
    }
    if (dir.tables.STAT)
      ttf.STAT = readStat(reader, dir.tables.STAT.offset)
    if (dir.tables.gvar) {
      const glyphPointCounts = ttf.glyf.map((g) => {
        if (g.compound) return 0
        let count = 0
        for (const contour of g.contours ?? [])
          count += contour.length
        return count
      })
      const bufferForGvar = (buffer instanceof ArrayBuffer)
        ? buffer
        : ((buffer as ArrayBuffer))
      ttf.gvar = readGvar(bufferForGvar, dir.tables.gvar.offset, dir.tables.gvar.length, glyphPointCounts)
    }
    if (dir.tables.HVAR)
      ttf.HVAR = readHvar(reader, dir.tables.HVAR.offset, dir.tables.HVAR.length)
    if (dir.tables.MVAR)
      ttf.MVAR = readMvar(reader, dir.tables.MVAR.offset, dir.tables.MVAR.length)

    // Keep support metadata
    ttf.support = { tables: Object.values(dir.tables).map(t => ({ name: t.tag.trim(), checkSum: t.checkSum, offset: t.offset, length: t.length, size: t.length })) }

    // Resolve post format 2 names onto each glyph
    applyPostFormat2Names(ttf)

    // Resolve named instance names from the name table
    if (ttf.fvar && ttf.name) {
      const getNameByID = (id: number): string | undefined => {
        const key = NAME_ID_TO_KEY[id]
        if (key) {
          const v = ttf.name[key]
          if (typeof v === 'string') return v
        }
        const extra = ttf.name.extra?.find(e => e.nameID === id)
        return extra?.value
      }
      for (const axis of ttf.fvar.axes)
        axis.name = getNameByID(axis.nameID)
      for (const inst of ttf.fvar.instances as NamedInstance[]) {
        inst.name = getNameByID(inst.subfamilyNameID)
        if (inst.postScriptNameID !== undefined)
          inst.postScriptName = getNameByID(inst.postScriptNameID)
      }
    }

    void readRawTable // silence unused when not used
    return ttf
  }

  protected resolveGlyf(ttf: TTFObject): void {
    // Attach unicodes from cmap
    const cmap = ttf.cmap ?? {}
    for (const [codeStr, glyphIndex] of Object.entries(cmap)) {
      const code = Number.parseInt(codeStr, 10)
      const g = ttf.glyf[glyphIndex]
      if (!g) continue
      if (!g.unicode)
        g.unicode = []
      if (!g.unicode.includes(code))
        g.unicode.push(code)
    }

    // Attach hmtx to glyphs
    if (ttf.hmtx) {
      for (let i = 0; i < ttf.glyf.length; i++) {
        const m = ttf.hmtx[i]
        if (m) {
          ttf.glyf[i].advanceWidth = m.advanceWidth
          ttf.glyf[i].leftSideBearing = m.leftSideBearing
        }
      }
    }

    // Apply subset filter if specified
    if (this.options.subset && this.options.subset.length > 0) {
      const subset = new Set(this.options.subset)
      const keepIndices = new Set<number>([0]) // always keep .notdef
      for (const [codeStr, gi] of Object.entries(cmap)) {
        const code = Number.parseInt(codeStr, 10)
        if (subset.has(code))
          keepIndices.add(gi)
      }
      // Include compound references recursively
      let changed = true
      while (changed) {
        changed = false
        for (const idx of Array.from(keepIndices)) {
          const g = ttf.glyf[idx]
          if (g && g.compound && g.glyfs) {
            for (const ref of g.glyfs) {
              if (!keepIndices.has(ref.glyphIndex)) {
                keepIndices.add(ref.glyphIndex)
                changed = true
              }
            }
          }
        }
      }
      // Build subsetMap old -> new
      const sortedIndices = Array.from(keepIndices).sort((a, b) => a - b)
      const subsetMap: Record<number, number> = {}
      sortedIndices.forEach((oldIdx, newIdx) => (subsetMap[oldIdx] = newIdx))
      ttf.subsetMap = subsetMap

      // Filter glyphs
      ttf.glyf = sortedIndices.map(i => ttf.glyf[i]).filter(Boolean)
      // Rewrite cmap indices
      const newCmap: Record<number, number> = {}
      for (const [codeStr, gi] of Object.entries(cmap)) {
        const code = Number.parseInt(codeStr, 10)
        if (subsetMap[gi] !== undefined)
          newCmap[code] = subsetMap[gi]
      }
      ttf.cmap = newCmap
      // Update compound references
      for (const g of ttf.glyf) {
        if (g.compound && g.glyfs) {
          for (const ref of g.glyfs)
            ref.glyphIndex = subsetMap[ref.glyphIndex] ?? 0
        }
      }
      if (ttf.maxp)
        ttf.maxp.numGlyphs = ttf.glyf.length
    }

    // Compound-to-simple conversion
    if (this.options.compound2simple)
      compound2simpleAll(ttf)
  }

  protected cleanTables(ttf: TTFObject): void {
    delete ttf.hmtx
    delete ttf.loca
    if (!this.options.hinting) {
      delete ttf.fpgm
      delete ttf.cvt
      delete ttf.prep
      delete ttf.gasp
      for (const g of ttf.glyf)
        delete g.instructions
    }
    if (!this.options.kerning) {
      delete ttf.kern
    }
    // Default: preserve layout tables. Pass `preserveLayout: false` to drop them.
    if (this.options.preserveLayout === false) {
      delete ttf.GPOS
      if (ttf.rawTables) {
        delete ttf.rawTables.GPOS
        delete ttf.rawTables.GSUB
        delete ttf.rawTables.GDEF
      }
    }
  }

  dispose(): void {
    this.options = {}
  }
}

// Helper: naive compound-to-simple (copy contours from referenced glyph, apply transform)
function compound2simpleAll(ttf: TTFObject): void {
  const flatten = (idx: number, visited = new Set<number>()): void => {
    if (visited.has(idx)) return
    visited.add(idx)
    const g = ttf.glyf[idx]
    if (!g || !g.compound || !g.glyfs) return
    const contours: Array<Array<{ x: number, y: number, onCurve?: boolean }>> = []
    for (const ref of g.glyfs) {
      flatten(ref.glyphIndex, visited)
      const source = ttf.glyf[ref.glyphIndex]
      if (!source.contours) continue
      const t = ref.transform
      for (const contour of source.contours) {
        contours.push(contour.map(p => ({
          x: Math.round(p.x * t.a + p.y * t.c + t.e),
          y: Math.round(p.x * t.b + p.y * t.d + t.f),
          onCurve: p.onCurve,
        })))
      }
    }
    g.compound = false
    g.contours = contours
    delete g.glyfs
  }
  for (let i = 0; i < ttf.glyf.length; i++)
    flatten(i)
}

export function createTTFReader(options?: TTFReaderOptions): TTFReader {
  return new TTFReader(options)
}

export function toFontReadOptions(options: FontReadOptions): TTFReaderOptions {
  return {
    subset: options.subset,
    hinting: options.hinting,
    kerning: options.kerning,
    compound2simple: options.compound2simple,
  }
}
