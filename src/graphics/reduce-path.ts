import type { Contour, Point } from '../types'

/**
 * Remove redundant points from a contour:
 *  - consecutive coincident points
 *  - three consecutive collinear on-curve points (middle point removed)
 * Returns the same contour instance (mutated in-place).
 */
export function reducePath(contour: Contour, epsilon = 0.5): Contour {
  if (contour.length < 3) return contour

  // Deduplicate coincident points
  for (let i = contour.length - 1; i > 0; i--) {
    const a = contour[i]
    const b = contour[i - 1]
    if (Math.abs(a.x - b.x) < epsilon && Math.abs(a.y - b.y) < epsilon)
      contour.splice(i, 1)
  }
  if (contour.length >= 2) {
    const first = contour[0]
    const last = contour[contour.length - 1]
    if (Math.abs(first.x - last.x) < epsilon && Math.abs(first.y - last.y) < epsilon)
      contour.pop()
  }

  if (contour.length < 3) return contour

  // Remove collinear on-curve triples (iterate in reverse so splicing is safe)
  for (let i = contour.length - 1; i >= 0; i--) {
    const n = contour.length
    const prev = contour[(i - 1 + n) % n]
    const curr = contour[i]
    const next = contour[(i + 1) % n]
    if (curr.onCurve === false) continue
    if (prev.onCurve === false || next.onCurve === false) continue
    if (isCollinear(prev, curr, next, epsilon))
      contour.splice(i, 1)
  }
  return contour
}

function isCollinear(a: Point, b: Point, c: Point, epsilon: number): boolean {
  // Cross product of (b-a) × (c-a)
  const cross = (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x)
  return Math.abs(cross) < epsilon
}
