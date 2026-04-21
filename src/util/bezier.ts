export interface BezPoint {
  x: number
  y: number
}

/**
 * Convert a single cubic bezier (p1 → c1, c2 → p2) into one or more
 * quadratic beziers using adaptive recursive subdivision.
 *
 * Returns an array of [startPt, controlPt, endPt] triples.
 *
 * Threshold: the squared magnitude of the second-difference vector
 * between cubic and its implied quadratic control must be <= 4 (pixel²).
 */
export function cubicToQuadratic(p1: BezPoint, c1: BezPoint, c2: BezPoint, p2: BezPoint, errorThreshold = 4): Array<[BezPoint, BezPoint, BezPoint]> {
  return recurse(p1, c1, c2, p2, errorThreshold, 0)
}

function recurse(p1: BezPoint, c1: BezPoint, c2: BezPoint, p2: BezPoint, threshold: number, depth: number): Array<[BezPoint, BezPoint, BezPoint]> {
  // Degenerate — no control, midpoint quad
  if (p1.x === c1.x && p1.y === c1.y && c2.x === p2.x && c2.y === p2.y) {
    const mid = { x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 }
    return [[p1, mid, p2]]
  }

  // Second-difference error metric
  const mx = p2.x - 3 * c2.x + 3 * c1.x - p1.x
  const my = p2.y - 3 * c2.y + 3 * c1.y - p1.y
  const error = mx * mx + my * my

  // Bail out at recursion depth 8 (256× subdivisions) to avoid runaway
  if (error <= threshold || depth >= 8) {
    const qx = (3 * c2.x - p2.x + 3 * c1.x - p1.x) / 4
    const qy = (3 * c2.y - p2.y + 3 * c1.y - p1.y) / 4
    return [[p1, { x: qx, y: qy }, p2]]
  }

  // de Casteljau subdivision at t=0.5
  const mid = {
    x: (p2.x + 3 * c2.x + 3 * c1.x + p1.x) / 8,
    y: (p2.y + 3 * c2.y + 3 * c1.y + p1.y) / 8,
  }
  const a1 = { x: (p1.x + c1.x) / 2, y: (p1.y + c1.y) / 2 }
  const a2 = { x: (p1.x + 2 * c1.x + c2.x) / 4, y: (p1.y + 2 * c1.y + c2.y) / 4 }
  const b1 = { x: (p2.x + c1.x + 2 * c2.x) / 4, y: (p2.y + c1.y + 2 * c2.y) / 4 }
  const b2 = { x: (p2.x + c2.x) / 2, y: (p2.y + c2.y) / 2 }

  return [
    ...recurse(p1, a1, a2, mid, threshold, depth + 1),
    ...recurse(mid, b1, b2, p2, threshold, depth + 1),
  ]
}
