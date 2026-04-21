import type { Contour } from '../types'

/**
 * Build a quadratic-bezier approximation of an ellipse centered at (cx, cy)
 * with radii (rx, ry). Returns a single closed contour with 8 on-curve and
 * 8 off-curve points (16 total), adequate for most icon/font use cases.
 */
export function oval2contour(cx: number, cy: number, rx: number, ry?: number): Contour {
  const ryVal = ry ?? rx
  // Magic constant to approximate a circle with 4 quadratics.
  // See https://pomax.github.io/bezierinfo/#circles_cubic for derivation;
  // for quadratics we use k = 4/3 * (sqrt(2) - 1) ≈ 0.5522847498
  const k = 4 / 3 * (Math.SQRT2 - 1)
  const ox = k * rx
  const oy = k * ryVal

  // 8 segments: on -> off -> on around the ellipse
  return [
    { x: cx + rx, y: cy, onCurve: true },
    { x: cx + rx, y: cy + oy, onCurve: false },
    { x: cx + ox, y: cy + ryVal, onCurve: false },
    { x: cx, y: cy + ryVal, onCurve: true },
    { x: cx - ox, y: cy + ryVal, onCurve: false },
    { x: cx - rx, y: cy + oy, onCurve: false },
    { x: cx - rx, y: cy, onCurve: true },
    { x: cx - rx, y: cy - oy, onCurve: false },
    { x: cx - ox, y: cy - ryVal, onCurve: false },
    { x: cx, y: cy - ryVal, onCurve: true },
    { x: cx + ox, y: cy - ryVal, onCurve: false },
    { x: cx + rx, y: cy - oy, onCurve: false },
  ]
}

/** Axis-aligned rectangle contour (clockwise, starting at top-left). */
export function rect2contour(x: number, y: number, width: number, height: number): Contour {
  return [
    { x, y, onCurve: true },
    { x: x + width, y, onCurve: true },
    { x: x + width, y: y + height, onCurve: true },
    { x, y: y + height, onCurve: true },
  ]
}

/** Polygon contour from a list of points (SVG polygon/polyline points attr). */
export function polygon2contour(points: Array<{ x: number, y: number }>): Contour {
  return points.map(p => ({ x: p.x, y: p.y, onCurve: true }))
}

/** Parse "x1,y1 x2,y2" or "x1 y1 x2 y2" into point pairs. */
export function parsePolygonPoints(str: string): Array<{ x: number, y: number }> {
  const nums = str
    .split(/[\s,]+/)
    .filter(s => s.length > 0)
    .map(Number)
  const result: Array<{ x: number, y: number }> = []
  for (let i = 0; i + 1 < nums.length; i += 2)
    result.push({ x: nums[i], y: nums[i + 1] })
  return result
}
