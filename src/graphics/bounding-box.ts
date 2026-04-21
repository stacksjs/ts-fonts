import type { Contour, Point } from '../types'

export interface BBox {
  x: number
  y: number
  width: number
  height: number
}

/** Compute bounding box of an array of raw points. */
export function computeBoundingBox(points: Array<{ x: number, y: number }>): BBox {
  if (points.length === 0) return { x: 0, y: 0, width: 0, height: 0 }
  let xMin = Infinity, yMin = Infinity, xMax = -Infinity, yMax = -Infinity
  for (const p of points) {
    if (p.x < xMin) xMin = p.x
    if (p.x > xMax) xMax = p.x
    if (p.y < yMin) yMin = p.y
    if (p.y > yMax) yMax = p.y
  }
  return { x: xMin, y: yMin, width: xMax - xMin, height: yMax - yMin }
}

/**
 * Compute the bounding box of one or more contours, considering only
 * point extrema (ignoring bezier curve bulges).
 */
export function computePathBox(...contours: Contour[]): BBox {
  const all: Point[] = []
  for (const c of contours) all.push(...c)
  return computeBoundingBox(all)
}

/** Alias for computePathBox with the rest-param accepted as a single argument. */
export function computePathBoxFromList(contours: Contour[]): BBox {
  return computePathBox(...contours)
}

/**
 * Compute bounding box of bezier curves including control-point bulges.
 * For quadratic curves, this visits curve extrema.
 */
export function computePath(...contours: Contour[]): BBox {
  let xMin = Infinity, yMin = Infinity, xMax = -Infinity, yMax = -Infinity
  const consider = (x: number, y: number): void => {
    if (x < xMin) xMin = x
    if (x > xMax) xMax = x
    if (y < yMin) yMin = y
    if (y > yMax) yMax = y
  }

  for (const contour of contours) {
    const n = contour.length
    if (n === 0) continue
    let prev = contour[n - 1]
    for (let i = 0; i < n; i++) {
      const curr = contour[i]
      if (curr.onCurve !== false) {
        consider(curr.x, curr.y)
      }
      else {
        const next = contour[(i + 1) % n]
        const end = next.onCurve === false
          ? { x: (curr.x + next.x) / 2, y: (curr.y + next.y) / 2 }
          : next
        const box = quadraticBezierBounds(prev, curr, end)
        consider(box.x, box.y)
        consider(box.x + box.width, box.y + box.height)
      }
      prev = curr
    }
  }

  if (!Number.isFinite(xMin)) return { x: 0, y: 0, width: 0, height: 0 }
  return { x: xMin, y: yMin, width: xMax - xMin, height: yMax - yMin }
}

/**
 * Bounding box of a single quadratic bezier (p0 → p1 → p2).
 */
export function quadraticBezierBounds(p0: { x: number, y: number }, p1: { x: number, y: number }, p2: { x: number, y: number }): BBox {
  const extrema = (a: number, b: number, c: number): number[] => {
    const result: number[] = [a, c]
    const denom = a - 2 * b + c
    if (denom !== 0) {
      const t = (a - b) / denom
      if (t > 0 && t < 1) {
        const value = (1 - t) * (1 - t) * a + 2 * (1 - t) * t * b + t * t * c
        result.push(value)
      }
    }
    return result
  }
  const xs = extrema(p0.x, p1.x, p2.x)
  const ys = extrema(p0.y, p1.y, p2.y)
  const xMin = Math.min(...xs)
  const xMax = Math.max(...xs)
  const yMin = Math.min(...ys)
  const yMax = Math.max(...ys)
  return { x: xMin, y: yMin, width: xMax - xMin, height: yMax - yMin }
}
