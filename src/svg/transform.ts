import type { Contour } from '../types'
import type { Matrix } from '../graphics/matrix'
import { identity, mul, rotate as rotMat, scale as scaleMat, translate as transMat } from '../graphics/matrix'
import { pathTransform } from '../graphics/path-transforms'

export interface TransformOp {
  name: 'matrix' | 'translate' | 'scale' | 'rotate' | 'skewX' | 'skewY'
  params: number[]
}

/**
 * Parse an SVG transform attribute string like:
 *   "translate(10,20) rotate(45) scale(2)"
 * into an ordered list of operations.
 */
export function parseTransform(str: string): TransformOp[] {
  const result: TransformOp[] = []
  const re = /(matrix|translate|scale|rotate|skewX|skewY)\s*\(([^)]*)\)/g
  let m: RegExpExecArray | null
  // eslint-disable-next-line no-cond-assign
  while ((m = re.exec(str)) !== null) {
    const name = m[1] as TransformOp['name']
    const params = parseParams(m[2])
    result.push({ name, params })
  }
  return result
}

/** Parse a whitespace/comma-separated numeric parameter list. */
export function parseParams(str: string): number[] {
  return str
    .split(/[\s,]+/)
    .filter(s => s.length > 0)
    .map(Number)
    .filter(n => !Number.isNaN(n))
}

/** Convert a single TransformOp into an affine 3x3 matrix (stored as 6 values). */
export function transformToMatrix(op: TransformOp): Matrix {
  switch (op.name) {
    case 'matrix':
      return op.params.slice(0, 6) as Matrix
    case 'translate':
      return transMat(op.params[0] ?? 0, op.params[1] ?? 0)
    case 'scale':
      return scaleMat(op.params[0] ?? 1, op.params[1] ?? op.params[0] ?? 1)
    case 'rotate': {
      const rad = ((op.params[0] ?? 0) * Math.PI) / 180
      if (op.params.length > 1) {
        const cx = op.params[1] ?? 0
        const cy = op.params[2] ?? 0
        return mul(transMat(cx, cy), rotMat(rad), transMat(-cx, -cy))
      }
      return rotMat(rad)
    }
    case 'skewX': {
      const t = Math.tan(((op.params[0] ?? 0) * Math.PI) / 180)
      return [1, 0, t, 1, 0, 0]
    }
    case 'skewY': {
      const t = Math.tan(((op.params[0] ?? 0) * Math.PI) / 180)
      return [1, t, 0, 1, 0, 0]
    }
  }
}

/** Compose a sequence of transforms left-to-right into a single matrix. */
export function composeTransforms(ops: TransformOp[]): Matrix {
  if (ops.length === 0) return identity()
  return mul(...ops.map(transformToMatrix))
}

/** Apply a sequence of SVG transforms to a list of contours. */
export function contoursTransform(contours: Contour[], ops: TransformOp[]): Contour[] {
  if (ops.length === 0) return contours
  const m = composeTransforms(ops)
  for (const contour of contours)
    pathTransform(contour, m[0], m[1], m[2], m[3], m[4], m[5])
  return contours
}
