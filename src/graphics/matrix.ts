/**
 * 2D affine transform matrix represented as [a, b, c, d, e, f]
 * corresponding to:
 *   x' = a*x + c*y + e
 *   y' = b*x + d*y + f
 */
export type Matrix = [number, number, number, number, number, number]

/** Multiply two affine matrices: result = m1 * m2. */
export function multiply(m1: Matrix, m2: Matrix): Matrix {
  const [a1, b1, c1, d1, e1, f1] = m1
  const [a2, b2, c2, d2, e2, f2] = m2
  return [
    a1 * a2 + c1 * b2,
    b1 * a2 + d1 * b2,
    a1 * c2 + c1 * d2,
    b1 * c2 + d1 * d2,
    a1 * e2 + c1 * f2 + e1,
    b1 * e2 + d1 * f2 + f1,
  ]
}

/** Multiply a chain of matrices left-to-right. */
export function mul(...matrices: Matrix[]): Matrix {
  if (matrices.length === 0) return [1, 0, 0, 1, 0, 0]
  let result = matrices[0]
  for (let i = 1; i < matrices.length; i++)
    result = multiply(result, matrices[i])
  return result
}

export function identity(): Matrix {
  return [1, 0, 0, 1, 0, 0]
}

export function translate(tx: number, ty: number): Matrix {
  return [1, 0, 0, 1, tx, ty]
}

export function scale(sx: number, sy: number = sx): Matrix {
  return [sx, 0, 0, sy, 0, 0]
}

export function rotate(radians: number): Matrix {
  const c = Math.cos(radians)
  const s = Math.sin(radians)
  return [c, s, -s, c, 0, 0]
}
