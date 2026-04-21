import type { Contour, Point } from '../types'

/**
 * Apply a 2D affine transform [a, b, c, d, e, f] to every point in a contour.
 *   x' = a*x + c*y + e
 *   y' = b*x + d*y + f
 */
export function pathTransform(contour: Contour, a: number, b: number, c: number, d: number, e: number, f: number): Contour {
  for (const p of contour) {
    const nx = a * p.x + c * p.y + e
    const ny = b * p.x + d * p.y + f
    p.x = nx
    p.y = ny
  }
  return contour
}

/** Scale + translate: x' = x*sx + ox; y' = y*sy + oy. */
export function pathAdjust(contour: Contour, scaleX = 1, scaleY = 1, offsetX = 0, offsetY = 0): Contour {
  for (const p of contour) {
    p.x = p.x * scaleX + offsetX
    p.y = p.y * scaleY + offsetY
  }
  return contour
}

/** Round every coordinate to the nearest integer (or to `precision` decimals). */
export function pathCeil(contour: Contour, precision = 0): Contour {
  const factor = 10 ** precision
  for (const p of contour) {
    p.x = Math.round(p.x * factor) / factor
    p.y = Math.round(p.y * factor) / factor
  }
  return contour
}

/** Rotate contour around (cx, cy); angle in radians. */
export function pathRotate(contour: Contour, angle: number, cx = 0, cy = 0): Contour {
  const cos = Math.cos(angle)
  const sin = Math.sin(angle)
  for (const p of contour) {
    const dx = p.x - cx
    const dy = p.y - cy
    p.x = cos * dx - sin * dy + cx
    p.y = sin * dx + cos * dy + cy
  }
  return contour
}

/** Skew along X axis by `angle` radians, anchored at (ox, oy). */
export function pathSkewX(contour: Contour, angle: number, oy = 0): Contour {
  const t = Math.tan(angle)
  for (const p of contour)
    p.x = p.x + (p.y - oy) * t
  return contour
}

/** Skew along Y axis by `angle` radians, anchored at (ox, oy). */
export function pathSkewY(contour: Contour, angle: number, ox = 0): Contour {
  const t = Math.tan(angle)
  for (const p of contour)
    p.y = p.y + (p.x - ox) * t
  return contour
}

/** Combined skew along X or Y; positive angle values skew right (X) or up (Y). */
export function pathSkew(contour: Contour, angleX: number, angleY = 0, ox = 0, oy = 0): Contour {
  const tx = Math.tan(angleX)
  const ty = Math.tan(angleY)
  for (const p of contour) {
    const nx = p.x + (p.y - oy) * tx
    const ny = p.y + (p.x - ox) * ty
    p.x = nx
    p.y = ny
  }
  return contour
}

/**
 * Iterate through a contour as a sequence of segments. For each segment
 * the callback receives:
 *   ('L', from, to, i)          — straight line
 *   ('Q', from, control, to, i) — quadratic bezier
 */
// eslint-disable-next-line pickier/no-unused-vars
export type SegmentCallback = (cmd: 'L' | 'Q', from: Point, p1: Point, p2OrI: Point | number, iOrNone?: number) => void

export function pathIterator(contour: Contour, callback: SegmentCallback): void {
  const n = contour.length
  if (n === 0) return
  let prev = contour[n - 1]
  for (let i = 0; i < n; i++) {
    const curr = contour[i]
    const currOn = curr.onCurve !== false
    const prevOn = prev.onCurve !== false
    if (currOn && prevOn) {
      callback('L', prev, curr, i, undefined)
    }
    else if (!currOn) {
      // Quadratic: prev is anchor, curr is control, next on-curve is end
      const next = contour[(i + 1) % n]
      const end = (next.onCurve !== false)
        ? next
        : { x: (curr.x + next.x) / 2, y: (curr.y + next.y) / 2, onCurve: true }
      callback('Q', prev, curr, end, i)
      if (next.onCurve !== false)
        i++ // consumed next
    }
    prev = contour[i]
    void prevOn
  }
}
