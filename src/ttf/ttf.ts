import type {
  FindCondition,
  Glyph,
  HeadTable,
  HheaTable,
  MergeOptions,
  Metrics,
  NameTable,
  OptimizeResult,
  OS2Table,
  PostTable,
  TTFObject,
} from '../types'

/**
 * TTFHelper — imperative manipulation API for a TTFObject.
 */
export class TTFHelper {
  ttf: TTFObject

  constructor(ttf: TTFObject) {
    this.ttf = ttf
  }

  set(ttf: TTFObject): this {
    this.ttf = ttf
    return this
  }

  get(): TTFObject {
    return this.ttf
  }

  codes(): string[] {
    return Object.keys(this.ttf.cmap).map(c => String.fromCodePoint(Number.parseInt(c, 10)))
  }

  getGlyfIndexByCode(c: string | number): number | undefined {
    const code = typeof c === 'string' ? c.codePointAt(0) : c
    if (code === undefined) return undefined
    return this.ttf.cmap[code]
  }

  getGlyfByIndex(i: number): Glyph | undefined {
    return this.ttf.glyf[i]
  }

  getGlyfByCode(c: string | number): Glyph | undefined {
    const i = this.getGlyfIndexByCode(c)
    return i === undefined ? undefined : this.getGlyfByIndex(i)
  }

  getGlyf(indexList?: number[]): Glyph[] {
    if (!indexList) return this.ttf.glyf.slice()
    return indexList.map(i => this.ttf.glyf[i]).filter(Boolean)
  }

  addGlyf(glyf: Glyph): [Glyph] {
    this.ttf.glyf.push(glyf)
    this.rebuildCmap()
    return [glyf]
  }

  insertGlyf(glyf: Glyph, insertIndex?: number): [Glyph] {
    if (insertIndex === undefined)
      this.ttf.glyf.push(glyf)
    else
      this.ttf.glyf.splice(insertIndex, 0, glyf)
    this.rebuildCmap()
    return [glyf]
  }

  replaceGlyf(glyf: Glyph, index: number): [Glyph] {
    this.ttf.glyf[index] = glyf
    this.rebuildCmap()
    return [glyf]
  }

  setGlyf(glyfList: Glyph[]): Glyph[] {
    this.ttf.glyf = glyfList
    this.rebuildCmap()
    return glyfList
  }

  removeGlyf(indexList: number[]): Glyph[] {
    const removed: Glyph[] = []
    const set = new Set(indexList)
    const keep: Glyph[] = []
    for (let i = 0; i < this.ttf.glyf.length; i++) {
      if (set.has(i))
        removed.push(this.ttf.glyf[i])
      else
        keep.push(this.ttf.glyf[i])
    }
    this.ttf.glyf = keep
    this.rebuildCmap()
    return removed
  }

  findGlyf(condition: FindCondition): number[] {
    const result: number[] = []
    const unicodes = condition.unicode === undefined
      ? undefined
      : Array.isArray(condition.unicode) ? condition.unicode : [condition.unicode]

    for (let i = 0; i < this.ttf.glyf.length; i++) {
      const g = this.ttf.glyf[i]
      if (unicodes && g.unicode && g.unicode.some(u => unicodes.includes(u))) {
        result.push(i)
        continue
      }
      if (condition.name && g.name) {
        if (g.name === condition.name || g.name.startsWith(condition.name)) {
          result.push(i)
          continue
        }
      }
      if (condition.filter && condition.filter(g)) {
        result.push(i)
      }
    }
    return result
  }

  setUnicode(unicode: string, indexList?: number[], isGenerateName?: boolean): Glyph[] {
    const codes = Array.from(unicode).map(c => c.codePointAt(0) ?? 0)
    const indices = indexList ?? this.ttf.glyf.map((_, i) => i).slice(1) // skip notdef
    const changed: Glyph[] = []
    for (let i = 0; i < indices.length && i < codes.length; i++) {
      const idx = indices[i]
      const g = this.ttf.glyf[idx]
      if (!g) continue
      g.unicode = [codes[i]]
      if (isGenerateName)
        g.name = `uni${codes[i].toString(16).toUpperCase().padStart(4, '0')}`
      changed.push(g)
    }
    this.rebuildCmap()
    return changed
  }

  genGlyfName(indexList?: number[]): Glyph[] {
    const indices = indexList ?? this.ttf.glyf.map((_, i) => i)
    const changed: Glyph[] = []
    for (const i of indices) {
      const g = this.ttf.glyf[i]
      if (!g || !g.unicode || g.unicode.length === 0) continue
      g.name = `uni${g.unicode[0].toString(16).toUpperCase().padStart(4, '0')}`
      changed.push(g)
    }
    return changed
  }

  clearGlyfName(indexList?: number[]): Glyph[] {
    const indices = indexList ?? this.ttf.glyf.map((_, i) => i)
    const changed: Glyph[] = []
    for (const i of indices) {
      const g = this.ttf.glyf[i]
      if (!g) continue
      delete g.name
      changed.push(g)
    }
    return changed
  }

  appendGlyf(glyfList: Glyph[], indexList?: number[]): Glyph[] {
    if (!indexList || indexList.length === 0) {
      this.ttf.glyf.push(...glyfList)
      this.rebuildCmap()
      return glyfList
    }
    for (let i = 0; i < indexList.length && i < glyfList.length; i++)
      this.ttf.glyf[indexList[i]] = glyfList[i]
    if (glyfList.length > indexList.length)
      this.ttf.glyf.push(...glyfList.slice(indexList.length))
    this.rebuildCmap()
    return glyfList
  }

  adjustGlyfPos(indexList: number[] | undefined, setting: { leftSideBearing?: number, rightSideBearing?: number, verticalAlign?: number }): Glyph[] {
    const indices = indexList ?? this.ttf.glyf.map((_, i) => i)
    const changed: Glyph[] = []
    const unitsPerEm = this.ttf.head.unitsPerEm
    for (const i of indices) {
      const g = this.ttf.glyf[i]
      if (!g || !g.contours) continue
      const dx = setting.leftSideBearing !== undefined ? setting.leftSideBearing - g.xMin : 0
      const dy = setting.verticalAlign !== undefined ? setting.verticalAlign - g.yMin : 0
      if (dx !== 0 || dy !== 0) {
        for (const c of g.contours) {
          for (const p of c) { p.x += dx; p.y += dy }
        }
        g.xMin += dx; g.xMax += dx
        g.yMin += dy; g.yMax += dy
      }
      if (setting.rightSideBearing !== undefined)
        g.advanceWidth = g.xMax + setting.rightSideBearing
      void unitsPerEm
      changed.push(g)
    }
    return changed
  }

  adjustGlyf(indexList: number[] | undefined, setting: { reverse?: boolean, mirror?: boolean, scale?: number, adjustToEmBox?: boolean, adjustToEmPadding?: number }): Glyph[] {
    const indices = indexList ?? this.ttf.glyf.map((_, i) => i)
    const changed: Glyph[] = []
    const unitsPerEm = this.ttf.head.unitsPerEm
    for (const i of indices) {
      const g = this.ttf.glyf[i]
      if (!g || !g.contours) continue
      if (setting.reverse) {
        for (const c of g.contours) c.reverse()
      }
      if (setting.mirror) {
        for (const c of g.contours) {
          for (const p of c) p.x = -p.x
        }
        const oldXMin = g.xMin
        g.xMin = -g.xMax
        g.xMax = -oldXMin
      }
      if (setting.scale && setting.scale !== 1) {
        const s = setting.scale
        for (const c of g.contours) {
          for (const p of c) { p.x = Math.round(p.x * s); p.y = Math.round(p.y * s) }
        }
        g.xMin = Math.round(g.xMin * s); g.xMax = Math.round(g.xMax * s)
        g.yMin = Math.round(g.yMin * s); g.yMax = Math.round(g.yMax * s)
        g.advanceWidth = Math.round((g.advanceWidth ?? 0) * s)
      }
      if (setting.adjustToEmBox) {
        const padding = setting.adjustToEmPadding ?? 0
        const target = unitsPerEm - padding * 2
        const curWidth = g.xMax - g.xMin
        const curHeight = g.yMax - g.yMin
        const scale = Math.min(target / curWidth, target / curHeight)
        if (!Number.isFinite(scale) || scale <= 0) continue
        const offX = -g.xMin
        const offY = -g.yMin
        for (const c of g.contours) {
          for (const p of c) {
            p.x = Math.round((p.x + offX) * scale) + padding
            p.y = Math.round((p.y + offY) * scale) + padding
          }
        }
        g.xMin = padding; g.xMax = Math.round(curWidth * scale) + padding
        g.yMin = padding; g.yMax = Math.round(curHeight * scale) + padding
      }
      changed.push(g)
    }
    return changed
  }

  mergeGlyf(imported: TTFObject, options?: MergeOptions): Glyph[] {
    const scale = options?.scale ?? (this.ttf.head.unitsPerEm / imported.head.unitsPerEm)
    const imported_ = imported.glyf.slice(1) // skip notdef
    const merged: Glyph[] = []
    for (const src of imported_) {
      if (!src.contours) continue
      const g: Glyph = {
        contours: src.contours.map(c => c.map(p => ({ x: Math.round(p.x * scale), y: Math.round(p.y * scale), onCurve: p.onCurve }))),
        xMin: Math.round(src.xMin * scale),
        xMax: Math.round(src.xMax * scale),
        yMin: Math.round(src.yMin * scale),
        yMax: Math.round(src.yMax * scale),
        advanceWidth: Math.round((src.advanceWidth ?? 0) * scale),
        leftSideBearing: Math.round((src.leftSideBearing ?? 0) * scale),
        name: src.name,
        unicode: src.unicode?.slice(),
      }
      merged.push(g)
      this.ttf.glyf.push(g)
    }
    this.rebuildCmap()
    return merged
  }

  sortGlyf(): Glyph[] | -1 | -2 {
    const hasCompound = this.ttf.glyf.some(g => g.compound)
    if (hasCompound) return -2

    const notdef = this.ttf.glyf[0]
    const rest = this.ttf.glyf.slice(1).sort((a, b) => {
      const au = a.unicode?.[0] ?? Infinity
      const bu = b.unicode?.[0] ?? Infinity
      return au - bu
    })
    this.ttf.glyf = [notdef, ...rest]
    this.rebuildCmap()
    return this.ttf.glyf
  }

  compound2simple(indexList?: number[]): Glyph[] {
    const indices = indexList ?? this.ttf.glyf.map((_, i) => i)
    const changed: Glyph[] = []
    const flatten = (idx: number, visited = new Set<number>()): void => {
      if (visited.has(idx)) return
      visited.add(idx)
      const g = this.ttf.glyf[idx]
      if (!g || !g.compound || !g.glyfs) return
      const contours: NonNullable<Glyph['contours']> = []
      for (const ref of g.glyfs) {
        flatten(ref.glyphIndex, visited)
        const source = this.ttf.glyf[ref.glyphIndex]
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
      changed.push(g)
    }
    for (const i of indices) flatten(i)
    return changed
  }

  setName(name: Partial<NameTable>): NameTable {
    Object.assign(this.ttf.name, name)
    return this.ttf.name
  }

  setHead(head: Partial<HeadTable>): HeadTable {
    Object.assign(this.ttf.head, head)
    return this.ttf.head
  }

  setHhea(fields: Partial<HheaTable>): HheaTable {
    Object.assign(this.ttf.hhea, fields)
    return this.ttf.hhea
  }

  setOS2(fields: Partial<OS2Table>): OS2Table {
    Object.assign(this.ttf['OS/2'], fields)
    return this.ttf['OS/2']
  }

  setPost(fields: Partial<PostTable>): PostTable {
    Object.assign(this.ttf.post, fields)
    return this.ttf.post
  }

  calcMetrics(): Metrics {
    const hhea = this.ttf.hhea
    const os2 = this.ttf['OS/2']
    return {
      ascent: hhea.ascent,
      descent: hhea.descent,
      sTypoAscender: os2.sTypoAscender,
      sTypoDescender: os2.sTypoDescender,
      usWinAscent: os2.usWinAscent,
      usWinDescent: os2.usWinDescent,
      sxHeight: os2.sxHeight,
      sCapHeight: os2.sCapHeight,
    }
  }

  optimize(): OptimizeResult {
    // Detect duplicate unicode assignments across glyphs
    const seen = new Map<number, number>()
    const repeat: number[] = []
    for (let i = 0; i < this.ttf.glyf.length; i++) {
      const g = this.ttf.glyf[i]
      if (!g.unicode) continue
      for (const u of g.unicode) {
        if (seen.has(u)) repeat.push(u)
        else seen.set(u, i)
      }
    }
    if (repeat.length > 0)
      return { result: { repeat } }
    return { result: true }
  }

  private rebuildCmap(): void {
    const cmap: Record<number, number> = {}
    for (let i = 0; i < this.ttf.glyf.length; i++) {
      const g = this.ttf.glyf[i]
      if (!g.unicode) continue
      for (const u of g.unicode)
        cmap[u] = i
    }
    this.ttf.cmap = cmap
  }
}
