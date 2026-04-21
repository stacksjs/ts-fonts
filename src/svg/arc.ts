import type { Point } from '../types'

/**
 * Convert an SVG elliptical arc to an array of cubic bezier segments,
 * then approximate each cubic with two quadratics. The result is a
 * flat array of points that can be appended to a contour directly.
 *
 * Per SVG spec: https://www.w3.org/TR/SVG11/implnote.html#ArcImplementationNotes
 */
export function arcToQuadratics(
  x1: number,
  y1: number,
  rx: number,
  ry: number,
  xAxisRotationDeg: number,
  largeArc: boolean,
  sweep: boolean,
  x2: number,
  y2: number,
): Point[] {
  if (x1 === x2 && y1 === y2) return []
  if (rx === 0 || ry === 0) {
    // Degenerate — straight line
    return [{ x: x2, y: y2, onCurve: true }]
  }

  const phi = (xAxisRotationDeg * Math.PI) / 180
  const cosPhi = Math.cos(phi)
  const sinPhi = Math.sin(phi)

  // Compute centre and angles per SVG conversion spec
  const dx = (x1 - x2) / 2
  const dy = (y1 - y2) / 2
  const x1p = cosPhi * dx + sinPhi * dy
  const y1p = -sinPhi * dx + cosPhi * dy

  let rxSq = rx * rx
  let rySq = ry * ry
  const x1pSq = x1p * x1p
  const y1pSq = y1p * y1p
  const radiiCheck = x1pSq / rxSq + y1pSq / rySq
  if (radiiCheck > 1) {
    const s = Math.sqrt(radiiCheck)
    rx *= s
    ry *= s
    rxSq = rx * rx
    rySq = ry * ry
  }

  const sign = largeArc === sweep ? -1 : 1
  const sq = Math.max(0, (rxSq * rySq - rxSq * y1pSq - rySq * x1pSq) / (rxSq * y1pSq + rySq * x1pSq))
  const coef = sign * Math.sqrt(sq)
  const cxp = coef * (rx * y1p) / ry
  const cyp = coef * -(ry * x1p) / rx

  const cx = cosPhi * cxp - sinPhi * cyp + (x1 + x2) / 2
  const cy = sinPhi * cxp + cosPhi * cyp + (y1 + y2) / 2

  const angle = (ux: number, uy: number, vx: number, vy: number): number => {
    const dot = ux * vx + uy * vy
    const len = Math.hypot(ux, uy) * Math.hypot(vx, vy)
    let a = Math.acos(Math.max(-1, Math.min(1, dot / len)))
    if (ux * vy - uy * vx < 0) a = -a
    return a
  }

  const theta1 = angle(1, 0, (x1p - cxp) / rx, (y1p - cyp) / ry)
  let deltaTheta = angle(
    (x1p - cxp) / rx,
    (y1p - cyp) / ry,
    (-x1p - cxp) / rx,
    (-y1p - cyp) / ry,
  )
  if (!sweep && deltaTheta > 0) deltaTheta -= 2 * Math.PI
  else if (sweep && deltaTheta < 0) deltaTheta += 2 * Math.PI

  // Subdivide into segments of at most π/2
  const segments = Math.ceil(Math.abs(deltaTheta) / (Math.PI / 2))
  const segAngle = deltaTheta / segments

  const out: Point[] = []
  for (let i = 0; i < segments; i++) {
    const a0 = theta1 + i * segAngle
    const a1 = a0 + segAngle
    // Approximate each arc segment as a single quadratic bezier using
    // the tangent intersection (good enough for icon-font purposes).
    const p0x = cx + rx * Math.cos(a0)
    const p0y = cy + ry * Math.sin(a0)
    const p2x = cx + rx * Math.cos(a1)
    const p2y = cy + ry * Math.sin(a1)
    // Tangent at a0 and a1; intersect
    const t0x = -rx * Math.sin(a0)
    const t0y = ry * Math.cos(a0)
    const t1x = -rx * Math.sin(a1)
    const t1y = ry * Math.cos(a1)
    const denom = t0x * t1y - t0y * t1x
    let cxCtrl: number, cyCtrl: number
    if (Math.abs(denom) < 1e-6) {
      cxCtrl = (p0x + p2x) / 2
      cyCtrl = (p0y + p2y) / 2
    }
    else {
      const u = ((p2x - p0x) * t1y - (p2y - p0y) * t1x) / denom
      cxCtrl = p0x + u * t0x
      cyCtrl = p0y + u * t0y
    }
    // Apply rotation and translation
    const rotate = (x: number, y: number): { x: number, y: number } => {
      const dx = x - cx
      const dy = y - cy
      return { x: cosPhi * dx - sinPhi * dy + cx, y: sinPhi * dx + cosPhi * dy + cy }
    }
    const ctl = rotate(cxCtrl, cyCtrl)
    const end = rotate(p2x, p2y)
    out.push({ x: ctl.x, y: ctl.y, onCurve: false })
    out.push({ x: end.x, y: end.y, onCurve: true })
  }
  return out
}
