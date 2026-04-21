import type { Glyph as GlyphData, TTFObject } from '../types'
import type { CanvasLike } from './path'
import { BoundingBox } from './bounding-box'
import { Path } from './path'

export interface GlyphOptions {
  index?: number
  name?: string
  unicode?: number
  unicodes?: number[]
  advanceWidth?: number
  leftSideBearing?: number
  xMin?: number
  yMin?: number
  xMax?: number
  yMax?: number
  path?: Path
  data?: GlyphData
}

export interface GlyphRenderOptions {
  kerning?: boolean
  hinting?: boolean
  features?: Record<string, boolean>
  xScale?: number
  yScale?: number
  fill?: string
  drawLayers?: boolean
  drawSVG?: boolean
  usePalette?: number
}

export interface GlyphMetrics {
  xMin: number
  yMin: number
  xMax: number
  yMax: number
  leftSideBearing: number
  rightSideBearing: number
}

/**
 * An opentype.js-compatible Glyph class. Wraps a plain GlyphData record
 * (our TTF object shape) and provides rendering/introspection helpers.
 */
export class Glyph {
  index: number
  name?: string
  unicode?: number
  unicodes: number[]
  advanceWidth: number
  leftSideBearing: number
  xMin: number
  yMin: number
  xMax: number
  yMax: number
  path: Path
  /** The underlying data record (contours, metrics, compound info). */
  data?: GlyphData
  /** Back-reference to the owning font for rendering helpers. */
  font?: { unitsPerEm: number, ttf: TTFObject }

  constructor(options: GlyphOptions = {}) {
    this.index = options.index ?? 0
    this.name = options.name
    this.unicode = options.unicode ?? options.unicodes?.[0]
    this.unicodes = options.unicodes ?? (options.unicode !== undefined ? [options.unicode] : [])
    this.advanceWidth = options.advanceWidth ?? 0
    this.leftSideBearing = options.leftSideBearing ?? 0
    this.xMin = options.xMin ?? 0
    this.yMin = options.yMin ?? 0
    this.xMax = options.xMax ?? 0
    this.yMax = options.yMax ?? 0
    this.path = options.path ?? new Path()
    this.data = options.data
  }

  /**
   * Create a Glyph wrapper from a GlyphData record + index.
   * Builds the Path by walking contours (with implied on-curve points).
   */
  static fromData(data: GlyphData, index: number): Glyph {
    const path = contoursToPath(data)
    return new Glyph({
      index,
      name: data.name,
      unicode: data.unicode?.[0],
      unicodes: data.unicode?.slice() ?? [],
      advanceWidth: data.advanceWidth,
      leftSideBearing: data.leftSideBearing,
      xMin: data.xMin,
      yMin: data.yMin,
      xMax: data.xMax,
      yMax: data.yMax,
      path,
      data,
    })
  }

  /** Append a code point to this glyph's Unicode list. */
  addUnicode(u: number): void {
    if (!this.unicodes.includes(u))
      this.unicodes.push(u)
    if (this.unicode === undefined)
      this.unicode = u
  }

  /** Return a scaled, positioned copy of this glyph's Path. */
  getPath(x = 0, y = 0, fontSize = 72, options: GlyphRenderOptions = {}): Path {
    const unitsPerEm = this.font?.unitsPerEm ?? 1000
    const xScale = options.xScale ?? (fontSize / unitsPerEm)
    const yScale = options.yScale ?? (fontSize / unitsPerEm)

    const out = new Path()
    out.fill = options.fill ?? this.path.fill ?? 'black'
    out.stroke = this.path.stroke
    out.strokeWidth = this.path.strokeWidth

    for (const cmd of this.path.commands) {
      switch (cmd.type) {
        case 'M': out.moveTo(x + cmd.x * xScale, y - cmd.y * yScale); break
        case 'L': out.lineTo(x + cmd.x * xScale, y - cmd.y * yScale); break
        case 'Q':
          out.quadraticCurveTo(
            x + cmd.x1 * xScale, y - cmd.y1 * yScale,
            x + cmd.x * xScale, y - cmd.y * yScale,
          )
          break
        case 'C':
          out.curveTo(
            x + cmd.x1 * xScale, y - cmd.y1 * yScale,
            x + cmd.x2 * xScale, y - cmd.y2 * yScale,
            x + cmd.x * xScale, y - cmd.y * yScale,
          )
          break
        case 'Z': out.close(); break
      }
    }
    return out
  }

  /** Bounding box of the underlying (unscaled) path. */
  getBoundingBox(): BoundingBox {
    return this.path.getBoundingBox()
  }

  /** Compute simple metrics from path + advance/lsb. */
  getMetrics(): GlyphMetrics {
    const bb = this.getBoundingBox()
    const xMin = Number.isNaN(bb.x1) ? this.xMin : bb.x1
    const xMax = Number.isNaN(bb.x2) ? this.xMax : bb.x2
    return {
      xMin,
      xMax,
      yMin: Number.isNaN(bb.y1) ? this.yMin : bb.y1,
      yMax: Number.isNaN(bb.y2) ? this.yMax : bb.y2,
      leftSideBearing: this.leftSideBearing,
      rightSideBearing: this.advanceWidth - this.leftSideBearing - (xMax - xMin),
    }
  }

  /** Array of contours, each a list of points (on- and off-curve). */
  getContours(): Array<Array<{ x: number, y: number, onCurve?: boolean }>> {
    return this.data?.contours?.map(c => c.map(p => ({ ...p }))) ?? []
  }

  draw(ctx: CanvasLike, x = 0, y = 0, fontSize = 72, options?: GlyphRenderOptions): void {
    this.getPath(x, y, fontSize, options).draw(ctx)
  }

  /** Visualize control points — on-curve blue, off-curve red. */
  drawPoints(ctx: CanvasLike, x = 0, y = 0, fontSize = 72): void {
    const unitsPerEm = this.font?.unitsPerEm ?? 1000
    const scale = fontSize / unitsPerEm
    const drawCircles = (
      points: Array<{ x: number, y: number }>,
      color: string,
    ): void => {
      if (!ctx.arc) return
      ctx.fillStyle = color
      for (const p of points) {
        ctx.beginPath()
        ctx.arc(x + p.x * scale, y - p.y * scale, 2, 0, Math.PI * 2)
        ctx.fill()
      }
    }
    const onCurve: Array<{ x: number, y: number }> = []
    const offCurve: Array<{ x: number, y: number }> = []
    for (const contour of this.getContours()) {
      for (const p of contour) {
        if (p.onCurve !== false) onCurve.push(p)
        else offCurve.push(p)
      }
    }
    drawCircles(onCurve, 'blue')
    drawCircles(offCurve, 'red')
  }

  /** Draw metric reference lines (origin/advance/bbox). */
  drawMetrics(ctx: CanvasLike, x = 0, y = 0, fontSize = 72): void {
    const unitsPerEm = this.font?.unitsPerEm ?? 1000
    const scale = fontSize / unitsPerEm
    const line = (x1: number, y1: number, x2: number, y2: number, color: string): void => {
      ctx.strokeStyle = color
      ctx.lineWidth = 1
      ctx.beginPath()
      ctx.moveTo(x1, y1)
      ctx.lineTo(x2, y2)
      ctx.stroke()
    }
    // Origin (black)
    line(x - 10, y, x + 10, y, 'black')
    line(x, y - 10, x, y + 10, 'black')
    // Bounding box (blue)
    const bb = this.getBoundingBox()
    if (!bb.isEmpty()) {
      const bx1 = x + bb.x1 * scale
      const by1 = y - bb.y2 * scale
      const bx2 = x + bb.x2 * scale
      const by2 = y - bb.y1 * scale
      line(bx1, by1, bx2, by1, 'blue')
      line(bx2, by1, bx2, by2, 'blue')
      line(bx2, by2, bx1, by2, 'blue')
      line(bx1, by2, bx1, by1, 'blue')
    }
    // Advance (green)
    const ax = x + this.advanceWidth * scale
    line(ax, y - 100, ax, y + 100, 'green')
  }

  toPathData(options?: Parameters<Path['toPathData']>[0]): string {
    return this.path.toPathData(options)
  }

  toSVG(options?: Parameters<Path['toSVG']>[0], pathData?: string): string {
    return this.path.toSVG(options, pathData)
  }

  toDOMElement(options?: Parameters<Path['toDOMElement']>[0], pathData?: string): unknown {
    return this.path.toDOMElement(options, pathData)
  }

  fromSVG(d: string, options?: Parameters<Path['fromSVG']>[1]): this {
    this.path.fromSVG(d, options)
    return this
  }
}

/**
 * Convert a font's contour list (with on-/off-curve points) to a
 * quadratic-bezier Path.
 */
export function contoursToPath(glyph: GlyphData): Path {
  const path = new Path()
  if (!glyph.contours) return path
  for (const contour of glyph.contours) {
    if (contour.length === 0) continue

    // Find starting on-curve point; insert implied start if all off-curve.
    let start = 0
    for (let i = 0; i < contour.length; i++) {
      if (contour[i].onCurve !== false) {
        start = i
        break
      }
    }
    const firstOnCurve = contour[start].onCurve !== false
    let sx: number, sy: number
    if (firstOnCurve) {
      sx = contour[start].x
      sy = contour[start].y
    }
    else {
      // All off-curve — use midpoint of first and last
      const a = contour[0], b = contour[contour.length - 1]
      sx = (a.x + b.x) / 2
      sy = (a.y + b.y) / 2
    }
    path.moveTo(sx, sy)

    const n = contour.length
    for (let i = 1; i <= n; i++) {
      const prev = contour[(start + i - 1) % n]
      const curr = contour[(start + i) % n]
      const prevOn = prev.onCurve !== false
      const currOn = curr.onCurve !== false

      if (prevOn && currOn) {
        path.lineTo(curr.x, curr.y)
      }
      else if (prevOn && !currOn) {
        // Start of a quadratic — look ahead for the end anchor
        const next = contour[(start + i + 1) % n]
        const nextOn = next.onCurve !== false
        const ex = nextOn ? next.x : (curr.x + next.x) / 2
        const ey = nextOn ? next.y : (curr.y + next.y) / 2
        path.quadraticCurveTo(curr.x, curr.y, ex, ey)
        if (nextOn) i++
      }
      else if (!prevOn && !currOn) {
        // Implied on-curve already emitted; continue next curve
        const next = contour[(start + i + 1) % n]
        const nextOn = next.onCurve !== false
        const ex = nextOn ? next.x : (curr.x + next.x) / 2
        const ey = nextOn ? next.y : (curr.y + next.y) / 2
        path.quadraticCurveTo(curr.x, curr.y, ex, ey)
        if (nextOn) i++
      }
    }
    path.close()
  }
  return path
}
