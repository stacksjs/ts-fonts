import type { Glyph, TTFObject } from '../types'
import { getEmptyTTFObject } from '../ttf/empty'
import { path2contours } from '../svg/path'

export interface Svg2TtfOptions {
  combinePath?: boolean
}

interface ParsedGlyph {
  unicode?: number[]
  name?: string
  advanceWidth?: number
  d: string
}
interface ParsedFontFace {
  unitsPerEm?: number
  ascent?: number
  descent?: number
  fontFamily?: string
  viewBox?: [number, number, number, number]
}

function parseSvgString(svg: string): { glyphs: ParsedGlyph[], fontFace?: ParsedFontFace } {
  const glyphs: ParsedGlyph[] = []

  // Preferred: <glyph> elements (SVG font format)
  const glyphRe = /<glyph\b([^>]*?)(?:\/>|>.*?<\/glyph>)/gs
  let match: RegExpExecArray | null
  // eslint-disable-next-line no-cond-assign
  while ((match = glyphRe.exec(svg)) !== null) {
    const attrs = match[1]
    const d = /\bd\s*=\s*"([^"]*)"/.exec(attrs)?.[1] ?? ''
    const unicode = /\bunicode\s*=\s*"([^"]*)"/.exec(attrs)?.[1]
    const name = /\b(?:glyph-name|name)\s*=\s*"([^"]*)"/.exec(attrs)?.[1]
    const adv = /\bhoriz-adv-x\s*=\s*"([^"]*)"/.exec(attrs)?.[1]

    let unicodes: number[] | undefined
    if (unicode) {
      unicodes = []
      for (const ch of Array.from(unicode))
        unicodes.push(ch.codePointAt(0) ?? 0)
    }

    glyphs.push({
      d,
      unicode: unicodes,
      name,
      advanceWidth: adv ? Number.parseInt(adv, 10) : undefined,
    })
  }

  // Fallback: raw <path> elements (SVG image) when no glyphs found
  if (glyphs.length === 0) {
    const pathRe = /<path\b([^>]*?)\/?>/gs
    // eslint-disable-next-line no-cond-assign
    while ((match = pathRe.exec(svg)) !== null) {
      const attrs = match[1]
      const d = /\bd\s*=\s*"([^"]*)"/.exec(attrs)?.[1] ?? ''
      if (!d) continue
      const name = /\bid\s*=\s*"([^"]*)"/.exec(attrs)?.[1]
      glyphs.push({ d, name })
    }
  }

  const fontFace: ParsedFontFace = {}
  const ffRe = /<font-face\b([^>]*?)(?:\/>|>)/s.exec(svg)
  if (ffRe) {
    const attrs = ffRe[1]
    const upe = /\bunits-per-em\s*=\s*"([^"]*)"/.exec(attrs)?.[1]
    const asc = /\bascent\s*=\s*"([^"]*)"/.exec(attrs)?.[1]
    const des = /\bdescent\s*=\s*"([^"]*)"/.exec(attrs)?.[1]
    const fam = /\bfont-family\s*=\s*"([^"]*)"/.exec(attrs)?.[1]
    if (upe) fontFace.unitsPerEm = Number.parseInt(upe, 10)
    if (asc) fontFace.ascent = Number.parseInt(asc, 10)
    if (des) fontFace.descent = Number.parseInt(des, 10)
    if (fam) fontFace.fontFamily = fam
  }

  // Pull viewBox from <svg> element for raw SVG icons
  const vbRe = /<svg\b[^>]*?\bviewBox\s*=\s*"([^"]*)"/.exec(svg)
  if (vbRe) {
    const parts = vbRe[1].split(/\s+|,/).map(Number)
    if (parts.length === 4 && parts.every(n => !Number.isNaN(n)))
      fontFace.viewBox = parts as [number, number, number, number]
  }

  return { glyphs, fontFace }
}

export function svg2ttfobject(input: string | { nodeType: number }, options: Svg2TtfOptions = {}): TTFObject {
  let svg: string
  if (typeof input === 'string') {
    svg = input
  }
  else {
    const g = globalThis as unknown as { XMLSerializer?: new () => { serializeToString: (node: unknown) => string } }
    if (g.XMLSerializer)
      svg = new g.XMLSerializer().serializeToString(input)
    else
      throw new Error('XMLSerializer not available; pass SVG as a string')
  }
  const { glyphs: rawGlyphs, fontFace } = parseSvgString(svg)
  const ff = fontFace ?? {}

  const ttf = getEmptyTTFObject()
  const unitsPerEm = ff.unitsPerEm ?? (ff.viewBox ? Math.max(ff.viewBox[2], ff.viewBox[3]) : 1024)
  ttf.head.unitsPerEm = unitsPerEm
  if (ff.ascent !== undefined) ttf.hhea.ascent = ff.ascent
  if (ff.descent !== undefined) ttf.hhea.descent = ff.descent
  if (ff.fontFamily) ttf.name.fontFamily = ff.fontFamily

  const notdef = ttf.glyf[0]
  const out: Glyph[] = [notdef]

  if (options.combinePath && rawGlyphs.length > 0) {
    const combined: Glyph = {
      contours: [],
      xMin: 0, yMin: 0, xMax: 0, yMax: 0,
      advanceWidth: unitsPerEm, leftSideBearing: 0,
    }
    let xMin = Infinity, yMin = Infinity, xMax = -Infinity, yMax = -Infinity
    for (const rg of rawGlyphs) {
      const contours = path2contours(rg.d, true, unitsPerEm)
      for (const c of contours) {
        combined.contours!.push(c)
        for (const p of c) {
          if (p.x < xMin) xMin = p.x
          if (p.x > xMax) xMax = p.x
          if (p.y < yMin) yMin = p.y
          if (p.y > yMax) yMax = p.y
        }
      }
    }
    if (Number.isFinite(xMin)) {
      combined.xMin = xMin; combined.xMax = xMax
      combined.yMin = yMin; combined.yMax = yMax
    }
    out.push(combined)
  }
  else {
    for (const rg of rawGlyphs) {
      const contours = path2contours(rg.d, true, unitsPerEm)
      let xMin = Infinity, yMin = Infinity, xMax = -Infinity, yMax = -Infinity
      for (const c of contours) {
        for (const p of c) {
          if (p.x < xMin) xMin = p.x
          if (p.x > xMax) xMax = p.x
          if (p.y < yMin) yMin = p.y
          if (p.y > yMax) yMax = p.y
        }
      }
      if (!Number.isFinite(xMin)) { xMin = 0; yMin = 0; xMax = 0; yMax = 0 }
      out.push({
        contours,
        xMin, xMax, yMin, yMax,
        advanceWidth: rg.advanceWidth ?? (xMax - xMin),
        leftSideBearing: xMin,
        unicode: rg.unicode,
        name: rg.name,
      })
    }
  }

  ttf.glyf = out
  ttf.maxp.numGlyphs = out.length
  const cmap: Record<number, number> = {}
  for (let i = 0; i < out.length; i++) {
    const g = out[i]
    if (!g.unicode) continue
    for (const u of g.unicode)
      cmap[u] = i
  }
  ttf.cmap = cmap
  return ttf
}
