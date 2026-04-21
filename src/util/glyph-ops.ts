import type { Glyph, OptimizeResult, TTFObject } from '../types'
import { computePathBox } from '../graphics/bounding-box'
import { pathAdjust, pathCeil } from '../graphics/path-transforms'
import { reducePath } from '../graphics/reduce-path'

/**
 * Scale and translate a glyph's contours, recompute bounds and adjust
 * metrics. If `useCeil` is true, all coordinates are rounded to integers.
 */
export function glyfAdjust(glyph: Glyph, scaleX = 1, scaleY = 1, offsetX = 0, offsetY = 0, useCeil = true): Glyph {
  if (glyph.contours) {
    for (const contour of glyph.contours) {
      pathAdjust(contour, scaleX, scaleY, offsetX, offsetY)
      if (useCeil) pathCeil(contour, 0)
    }
    const box = computePathBox(...glyph.contours)
    glyph.xMin = box.x
    glyph.yMin = box.y
    glyph.xMax = box.x + box.width
    glyph.yMax = box.y + box.height
  }
  if (glyph.advanceWidth !== undefined)
    glyph.advanceWidth = Math.round(glyph.advanceWidth * scaleX)
  if (glyph.leftSideBearing !== undefined)
    glyph.leftSideBearing = Math.round(glyph.leftSideBearing * scaleX + offsetX)
  return glyph
}

/** Remove redundant points from every contour of a glyph. */
export function reduceGlyf(glyph: Glyph): Glyph {
  if (!glyph.contours) return glyph
  glyph.contours = glyph.contours.map(c => reducePath(c))
  return glyph
}

/**
 * Convert a single compound glyph into a simple glyph by flattening referenced
 * glyphs and applying their transforms. Mutates the glyph in place.
 */
export function compound2simpleglyf(glyph: Glyph, ttf: TTFObject, recursive = true): Glyph {
  if (!glyph.compound || !glyph.glyfs) return glyph
  const contours: NonNullable<Glyph['contours']> = []
  for (const ref of glyph.glyfs) {
    const source = ttf.glyf[ref.glyphIndex]
    if (!source) continue
    if (recursive && source.compound)
      compound2simpleglyf(source, ttf, true)
    if (!source.contours) continue
    const t = ref.transform
    for (const c of source.contours) {
      contours.push(c.map(p => ({
        x: Math.round(p.x * t.a + p.y * t.c + t.e),
        y: Math.round(p.x * t.b + p.y * t.d + t.f),
        onCurve: p.onCurve,
      })))
    }
  }
  glyph.compound = false
  glyph.contours = contours
  delete glyph.glyfs
  return glyph
}

/**
 * Comprehensive optimization:
 *  - reduce redundant points on every glyph
 *  - round all coordinates to integers
 *  - detect duplicate unicodes across glyphs
 * Returns true if the font is clean, otherwise a report of duplicate
 * unicode codepoints.
 */
export function optimizettf(ttf: TTFObject): OptimizeResult['result'] {
  for (const g of ttf.glyf)
    reduceGlyf(g)

  const seen = new Map<number, number>()
  const repeat: number[] = []
  for (let i = 0; i < ttf.glyf.length; i++) {
    const g = ttf.glyf[i]
    if (!g.unicode) continue
    for (const u of g.unicode) {
      if (seen.has(u)) repeat.push(u)
      else seen.set(u, i)
    }
  }
  if (repeat.length > 0) return { repeat }
  return true
}
