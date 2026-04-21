/**
 * An opentype.js-compatible BoundingBox class. Accumulates extrema for
 * points and bezier curves and supports the same method surface.
 */
export class BoundingBox {
  x1: number
  y1: number
  x2: number
  y2: number

  constructor() {
    this.x1 = Number.NaN
    this.y1 = Number.NaN
    this.x2 = Number.NaN
    this.y2 = Number.NaN
  }

  isEmpty(): boolean {
    return Number.isNaN(this.x1) || Number.isNaN(this.y1) || Number.isNaN(this.x2) || Number.isNaN(this.y2)
  }

  addPoint(x: number, y: number): void {
    if (typeof x === 'number') {
      if (Number.isNaN(this.x1) || Number.isNaN(this.x2)) {
        this.x1 = x
        this.x2 = x
      }
      if (x < this.x1) this.x1 = x
      if (x > this.x2) this.x2 = x
    }
    if (typeof y === 'number') {
      if (Number.isNaN(this.y1) || Number.isNaN(this.y2)) {
        this.y1 = y
        this.y2 = y
      }
      if (y < this.y1) this.y1 = y
      if (y > this.y2) this.y2 = y
    }
  }

  addX(x: number): void {
    this.addPoint(x, Number.NaN)
  }

  addY(y: number): void {
    this.addPoint(Number.NaN, y)
  }

  /** Add a cubic bezier (p0 → c1, c2 → p1) to the bounding box. */
  addBezier(x0: number, y0: number, x1: number, y1: number, x2: number, y2: number, x: number, y: number): void {
    // Endpoints are always included
    this.addPoint(x0, y0)
    this.addPoint(x, y)

    // Derivative extrema: d/dt of B(t)
    const addExtrema = (p0: number, p1: number, p2: number, p3: number, axis: 'x' | 'y'): void => {
      const a = -p0 + 3 * p1 - 3 * p2 + p3
      const b = 2 * p0 - 4 * p1 + 2 * p2
      const c = -p0 + p1
      const solve = (t: number): void => {
        if (t > 0 && t < 1) {
          const u = 1 - t
          const v = u * u * u * p0 + 3 * u * u * t * p1 + 3 * u * t * t * p2 + t * t * t * p3
          if (axis === 'x') this.addX(v)
          else this.addY(v)
        }
      }
      if (a === 0) {
        if (b !== 0) solve(-c / b)
        return
      }
      const disc = b * b - 4 * a * c
      if (disc < 0) return
      const sq = Math.sqrt(disc)
      solve((-b + sq) / (2 * a))
      solve((-b - sq) / (2 * a))
    }

    addExtrema(x0, x1, x2, x, 'x')
    addExtrema(y0, y1, y2, y, 'y')
  }

  /** Add a quadratic bezier (p0 → c, p1) — converted to cubic internally. */
  addQuad(x0: number, y0: number, x1: number, y1: number, x: number, y: number): void {
    const cx1 = x0 + 2 / 3 * (x1 - x0)
    const cy1 = y0 + 2 / 3 * (y1 - y0)
    const cx2 = x + 2 / 3 * (x1 - x)
    const cy2 = y + 2 / 3 * (y1 - y)
    this.addBezier(x0, y0, cx1, cy1, cx2, cy2, x, y)
  }
}
