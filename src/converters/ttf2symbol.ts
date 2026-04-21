import type { Glyph, TTFObject } from '../types'
import { flip } from '../graphics/paths-util'
import { glyph2svg } from '../svg/path'

export interface Ttf2SymbolOptions {
  /** Prefix for each symbol's id attribute (default 'icon-'). */
  symbolPrefix?: string
  /** Optional viewBox size; defaults to the font's unitsPerEm. */
  viewBox?: [number, number, number, number]
}

function getSymbolId(glyph: Glyph, index: number, prefix: string): string {
  if (glyph.name && glyph.name !== '.notdef') return `${prefix}${glyph.name}`
  if (glyph.unicode && glyph.unicode.length > 0)
    return `${prefix}${glyph.unicode[0].toString(16)}`
  return `${prefix}${index}`
}

/**
 * Convert a font to a single SVG file containing one <symbol> element per
 * glyph, suitable for sprite-sheet use with <use href="#icon-foo" />.
 */
export function ttf2symbol(ttf: TTFObject, options: Ttf2SymbolOptions = {}): string {
  const prefix = options.symbolPrefix ?? 'icon-'
  const unitsPerEm = ttf.head.unitsPerEm
  const vb = options.viewBox ?? [0, 0, unitsPerEm, unitsPerEm]

  const parts: string[] = []
  parts.push('<?xml version="1.0" encoding="UTF-8"?>')
  parts.push('<svg xmlns="http://www.w3.org/2000/svg" style="position:absolute;width:0;height:0;overflow:hidden;">')
  parts.push('<defs>')

  for (let i = 1; i < ttf.glyf.length; i++) {
    const g = ttf.glyf[i]
    if (!g.contours || g.contours.length === 0) continue
    const id = getSymbolId(g, i, prefix)
    // Flip Y for SVG coordinates (font Y-up → SVG Y-down)
    const clone: Glyph = { ...g, contours: g.contours.map(c => c.map(p => ({ ...p }))) }
    if (clone.contours) flip(clone.contours)
    const d = glyph2svg(clone, unitsPerEm)
    parts.push(`<symbol id="${id}" viewBox="${vb.join(' ')}"><path d="${d}" /></symbol>`)
  }

  parts.push('</defs>')
  parts.push('</svg>')
  return parts.join('\n')
}
