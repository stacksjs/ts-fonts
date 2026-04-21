import type { TTFObject } from '../types'
import type { GlyphRenderOptions } from './glyph'
import type { CanvasLike } from './path'
import { Glyph } from './glyph'
import { readGsubFeatures } from './gsub'
import { buildKerningLookup } from './kerning'
import { readLayoutHeader } from './layout-common'

export interface TextLayoutOptions extends GlyphRenderOptions {
  features?: Record<string, boolean>
  script?: string
  language?: string
  /** Letter spacing (additive, in font units) applied between every pair. */
  letterSpacing?: number
  /** Tracking (applied as a factor of the advance width). */
  tracking?: number
}

const DEFAULT_LIGATURE_FEATURES = ['liga', 'rlig']
const DEFAULT_RENDER_OPTIONS: TextLayoutOptions = {
  kerning: true,
  features: { liga: true, rlig: true },
}

/**
 * Text-to-glyphs shaper. Applies basic GSUB ligatures (liga, rlig),
 * falls back to cmap lookup for non-ligatured runs.
 */
export function stringToGlyphIndexes(ttf: TTFObject, text: string, options: TextLayoutOptions = {}): number[] {
  const cmap = ttf.cmap
  const notdef = 0
  const raw: number[] = []
  for (const ch of text) {
    const cp = ch.codePointAt(0) ?? 0
    raw.push(cmap[cp] ?? notdef)
  }

  const opts = { ...DEFAULT_RENDER_OPTIONS, ...options }
  const gsubRaw = ttf.rawTables?.GSUB
  if (!gsubRaw) return raw

  const featureTags = DEFAULT_LIGATURE_FEATURES.filter(tag => opts.features?.[tag] !== false)
  if (featureTags.length === 0) return raw

  try {
    const view = new DataView(gsubRaw.buffer, gsubRaw.byteOffset, gsubRaw.byteLength)
    const header = readLayoutHeader(view, 0)
    const { singles, multiples, alternates, ligatures } = readGsubFeatures(view, header, featureTags, opts.script ?? 'DFLT', opts.language ?? 'dflt')
    if (singles.length === 0 && multiples.length === 0 && alternates.length === 0 && ligatures.length === 0) return raw

    const singleMap = new Map<number, number>()
    for (const s of singles) singleMap.set(s.sub, s.by)
    const multipleMap = new Map<number, number[]>()
    for (const m of multiples) multipleMap.set(m.sub, m.by)
    // Alternate: deterministically pick the first alternate by default
    const alternateMap = new Map<number, number>()
    for (const a of alternates) if (a.alternates[0] !== undefined) alternateMap.set(a.sub, a.alternates[0])

    const ligsByFirst = new Map<number, typeof ligatures>()
    for (const lig of ligatures) {
      if (!ligsByFirst.has(lig.first)) ligsByFirst.set(lig.first, [])
      ligsByFirst.get(lig.first)!.push(lig)
    }
    for (const bucket of ligsByFirst.values())
      bucket.sort((a, b) => b.components.length - a.components.length)

    const out: number[] = []
    let i = 0
    while (i < raw.length) {
      const g = raw[i]
      const bucket = ligsByFirst.get(g)
      let matched = false
      if (bucket) {
        for (const lig of bucket) {
          const len = lig.components.length
          if (i + len >= raw.length) continue
          let ok = true
          for (let k = 0; k < len; k++) {
            if (raw[i + 1 + k] !== lig.components[k]) {
              ok = false
              break
            }
          }
          if (ok) {
            out.push(lig.by)
            i += len + 1
            matched = true
            break
          }
        }
      }
      if (!matched) {
        const mul = multipleMap.get(g)
        if (mul) {
          out.push(...mul)
        }
        else {
          out.push(alternateMap.get(g) ?? singleMap.get(g) ?? g)
        }
        i++
      }
    }
    return out
  }
  catch {
    return raw
  }
}

/** Build Glyph wrapper instances for a text string. */
export function stringToGlyphs(ttf: TTFObject, text: string, options?: TextLayoutOptions): Glyph[] {
  const indexes = stringToGlyphIndexes(ttf, text, options)
  return indexes.map(i => {
    const g = Glyph.fromData(ttf.glyf[i] ?? ttf.glyf[0], i)
    g.font = { unitsPerEm: ttf.head.unitsPerEm, ttf }
    return g
  })
}

/** Look up a glyph by a single character. Returns notdef on miss. */
export function charToGlyphIndex(ttf: TTFObject, ch: string): number {
  const cp = ch.codePointAt(0) ?? 0
  return ttf.cmap[cp] ?? 0
}

export function charToGlyph(ttf: TTFObject, ch: string): Glyph {
  const i = charToGlyphIndex(ttf, ch)
  const g = Glyph.fromData(ttf.glyf[i] ?? ttf.glyf[0], i)
  g.font = { unitsPerEm: ttf.head.unitsPerEm, ttf }
  return g
}

/**
 * Walk glyphs for a text string, calling `callback(glyph, x, y, fontSize, options)`
 * for each. Returns the final x position (useful for measurement).
 */
// eslint-disable-next-line pickier/no-unused-vars
type ForEachGlyphCallback = (glyph: Glyph, x: number, y: number, fontSize: number, opts: TextLayoutOptions) => void

export function forEachGlyph(
  ttf: TTFObject,
  text: string,
  x: number,
  y: number,
  fontSize: number,
  options: TextLayoutOptions,
  callback: ForEachGlyphCallback,
): number {
  const unitsPerEm = ttf.head.unitsPerEm
  const scale = fontSize / unitsPerEm
  const glyphs = stringToGlyphs(ttf, text, options)
  const useKerning = options.kerning !== false
  const kernLookup = useKerning ? buildKerningLookup(ttf) : undefined
  const letterSpacing = options.letterSpacing ?? 0
  const tracking = options.tracking ?? 0

  let cursor = x
  for (let i = 0; i < glyphs.length; i++) {
    const g = glyphs[i]
    callback(g, cursor, y, fontSize, options)
    cursor += g.advanceWidth * scale
    if (kernLookup && i < glyphs.length - 1) {
      const kern = kernLookup(g.index, glyphs[i + 1].index)
      cursor += kern * scale
    }
    cursor += letterSpacing * scale
    cursor += tracking * g.advanceWidth * scale
  }
  return cursor
}

export function getAdvanceWidth(ttf: TTFObject, text: string, fontSize = 72, options: TextLayoutOptions = {}): number {
  return forEachGlyph(ttf, text, 0, 0, fontSize, options, () => { }) - 0
}

export function drawText(ttf: TTFObject, ctx: CanvasLike, text: string, x = 0, y = 0, fontSize = 72, options: TextLayoutOptions = {}): void {
  forEachGlyph(ttf, text, x, y, fontSize, options, (glyph, gx, gy, fs, opts) => {
    glyph.draw(ctx, gx, gy, fs, opts)
  })
}
