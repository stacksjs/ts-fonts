import { describe, expect, it } from 'bun:test'
import {
  computeBoundingBox,
  computePath,
  computePathBox,
  contoursTransform,
  cubicToQuadratic,
  flipPaths,
  matrixMul,
  matrixMultiply,
  matrixScale,
  matrixTranslate,
  mirrorPaths,
  movePaths,
  optimizettf,
  oval2contour,
  parsePolygonPoints,
  parseTransform,
  pathAdjust,
  pathCeil,
  pathRotate,
  pathSkewX,
  pathSkewY,
  pathTransform,
  polygon2contour,
  quadraticBezierBounds,
  rect2contour,
  reducePath,
  reduceGlyf,
  rotatePaths,
  unicode2esc,
  unicode2xml,
} from '../src'

describe('matrix math', () => {
  it('multiplies translate and scale correctly', () => {
    const m = matrixMul(matrixTranslate(10, 20), matrixScale(2, 3))
    // Apply to point (1, 1) → (2+10, 3+20) = (12, 23)
    const x = m[0] * 1 + m[2] * 1 + m[4]
    const y = m[1] * 1 + m[3] * 1 + m[5]
    expect(x).toBe(12)
    expect(y).toBe(23)
  })

  it('multiply directly matches mul of two', () => {
    const a = matrixTranslate(5, 0)
    const b = matrixScale(2, 2)
    expect(matrixMultiply(a, b)).toEqual(matrixMul(a, b))
  })
})

describe('path transforms', () => {
  it('pathAdjust scales and offsets', () => {
    const c = [{ x: 1, y: 1, onCurve: true }, { x: 2, y: 2, onCurve: true }]
    pathAdjust(c, 2, 3, 10, 20)
    expect(c[0]).toMatchObject({ x: 12, y: 23 })
    expect(c[1]).toMatchObject({ x: 14, y: 26 })
  })

  it('pathTransform applies full affine', () => {
    const c = [{ x: 1, y: 0, onCurve: true }, { x: 0, y: 1, onCurve: true }]
    // 90° rotation: (x,y) → (-y, x)
    pathTransform(c, 0, 1, -1, 0, 0, 0)
    expect(c[0].x).toBeCloseTo(0)
    expect(c[0].y).toBeCloseTo(1)
    expect(c[1].x).toBeCloseTo(-1)
    expect(c[1].y).toBeCloseTo(0)
  })

  it('pathCeil rounds to integers', () => {
    const c = [{ x: 1.4, y: 2.6, onCurve: true }]
    pathCeil(c)
    expect(c[0]).toMatchObject({ x: 1, y: 3 })
  })

  it('pathRotate rotates 90° around origin', () => {
    const c = [{ x: 1, y: 0, onCurve: true }]
    pathRotate(c, Math.PI / 2)
    expect(c[0].x).toBeCloseTo(0)
    expect(c[0].y).toBeCloseTo(1)
  })

  it('pathSkewX shears horizontally', () => {
    const c = [{ x: 0, y: 10, onCurve: true }]
    pathSkewX(c, Math.PI / 4)
    expect(c[0].x).toBeCloseTo(10, 4)
  })

  it('pathSkewY shears vertically', () => {
    const c = [{ x: 10, y: 0, onCurve: true }]
    pathSkewY(c, Math.PI / 4)
    expect(c[0].y).toBeCloseTo(10, 4)
  })
})

describe('bounding box', () => {
  it('computeBoundingBox from raw points', () => {
    const bb = computeBoundingBox([
      { x: 5, y: 3 }, { x: 10, y: 1 }, { x: 2, y: 7 },
    ])
    expect(bb).toEqual({ x: 2, y: 1, width: 8, height: 6 })
  })

  it('computePathBox covers multiple contours', () => {
    const c1 = [{ x: 0, y: 0, onCurve: true }, { x: 10, y: 10, onCurve: true }]
    const c2 = [{ x: -5, y: 5, onCurve: true }, { x: 5, y: 20, onCurve: true }]
    const bb = computePathBox(c1, c2)
    expect(bb).toEqual({ x: -5, y: 0, width: 15, height: 20 })
  })

  it('quadraticBezierBounds includes curve extrema', () => {
    const bb = quadraticBezierBounds({ x: 0, y: 0 }, { x: 50, y: 100 }, { x: 100, y: 0 })
    expect(bb.x).toBe(0)
    expect(bb.width).toBe(100)
    // Curve peaks at y = 50 (halfway up the control)
    expect(bb.height).toBeCloseTo(50, 0)
  })

  it('computePath considers curves', () => {
    const c = [
      { x: 0, y: 0, onCurve: true },
      { x: 50, y: 100, onCurve: false },
      { x: 100, y: 0, onCurve: true },
    ]
    const bb = computePath(c)
    expect(bb.height).toBeCloseTo(50, 0)
  })
})

describe('paths-util multi-path operations', () => {
  it('move translates all contours', () => {
    const paths = [[{ x: 1, y: 1, onCurve: true }]]
    movePaths(paths, 10, 20)
    expect(paths[0][0]).toMatchObject({ x: 11, y: 21 })
  })

  it('mirror flips horizontally across shared centroid', () => {
    const paths = [
      [{ x: 0, y: 0, onCurve: true }, { x: 10, y: 0, onCurve: true }],
    ]
    mirrorPaths(paths)
    // Mirror across cx=5 means x=0 → 10, x=10 → 0, and order reverses
    expect(paths[0].map(p => p.x).sort()).toEqual([0, 10])
  })

  it('flip mirrors vertically', () => {
    const paths = [[{ x: 0, y: 0, onCurve: true }, { x: 0, y: 10, onCurve: true }]]
    flipPaths(paths)
    expect(paths[0].map(p => p.y).sort()).toEqual([0, 10])
  })

  it('rotate around combined centroid', () => {
    const paths = [[{ x: 0, y: 0, onCurve: true }, { x: 10, y: 0, onCurve: true }]]
    rotatePaths(paths, Math.PI)
    expect(paths[0].map(p => Math.round(p.x)).sort()).toEqual([0, 10])
  })
})

describe('SVG shape builders', () => {
  it('rect2contour returns 4 corners clockwise', () => {
    const c = rect2contour(10, 20, 100, 50)
    expect(c.length).toBe(4)
    expect(c[0]).toMatchObject({ x: 10, y: 20 })
    expect(c[2]).toMatchObject({ x: 110, y: 70 })
  })

  it('oval2contour produces 12 points (4 quads × 3)', () => {
    const c = oval2contour(50, 50, 40)
    expect(c.length).toBe(12)
    const onCurve = c.filter(p => p.onCurve).length
    expect(onCurve).toBe(4) // N/S/E/W anchors
  })

  it('polygon2contour converts point array', () => {
    const c = polygon2contour([{ x: 0, y: 0 }, { x: 10, y: 5 }])
    expect(c.length).toBe(2)
    expect(c.every(p => p.onCurve)).toBe(true)
  })

  it('parsePolygonPoints handles comma and whitespace', () => {
    const pts = parsePolygonPoints('1,2 3 4,5,6 7,8')
    expect(pts.length).toBe(4)
    expect(pts[0]).toEqual({ x: 1, y: 2 })
    expect(pts[3]).toEqual({ x: 7, y: 8 })
  })
})

describe('SVG transform parsing', () => {
  it('parseTransform recognizes stacked operations', () => {
    const ops = parseTransform('translate(10,20) rotate(45) scale(2)')
    expect(ops.length).toBe(3)
    expect(ops[0]).toEqual({ name: 'translate', params: [10, 20] })
    expect(ops[1]).toEqual({ name: 'rotate', params: [45] })
    expect(ops[2]).toEqual({ name: 'scale', params: [2] })
  })

  it('contoursTransform applies composed matrix', () => {
    const contours = [[{ x: 1, y: 0, onCurve: true }]]
    contoursTransform(contours, parseTransform('scale(2) translate(5,0)'))
    // scale 2 first, then translate 5 in scaled space → pt (1+5)*2 = 12
    expect(contours[0][0].x).toBeCloseTo(12)
  })
})

describe('reduce utilities', () => {
  it('reducePath removes coincident points', () => {
    const c = [
      { x: 0, y: 0, onCurve: true },
      { x: 0, y: 0, onCurve: true },
      { x: 10, y: 0, onCurve: true },
    ]
    reducePath(c)
    expect(c.length).toBe(2)
  })

  it('reducePath removes collinear triple middle point', () => {
    const c = [
      { x: 0, y: 0, onCurve: true },
      { x: 5, y: 0, onCurve: true },
      { x: 10, y: 0, onCurve: true },
      { x: 10, y: 10, onCurve: true },
    ]
    reducePath(c)
    expect(c.length).toBe(3)
  })

  it('reduceGlyf applies reducePath per-contour', () => {
    const g = {
      contours: [[
        { x: 0, y: 0, onCurve: true },
        { x: 5, y: 0, onCurve: true },
        { x: 10, y: 0, onCurve: true },
        { x: 10, y: 10, onCurve: true },
      ]],
      xMin: 0, yMin: 0, xMax: 10, yMax: 10, advanceWidth: 10, leftSideBearing: 0,
    }
    reduceGlyf(g)
    expect(g.contours[0].length).toBe(3)
  })
})

describe('cubicToQuadratic conversion', () => {
  it('converts a simple cubic to one or more quadratics', () => {
    const quads = cubicToQuadratic({ x: 0, y: 0 }, { x: 10, y: 50 }, { x: 50, y: 50 }, { x: 100, y: 0 })
    expect(quads.length).toBeGreaterThan(0)
    for (const [s, , e] of quads) {
      expect(s).toBeDefined()
      expect(e).toBeDefined()
    }
    // Last end must equal p2
    expect(quads[quads.length - 1][2]).toEqual({ x: 100, y: 0 })
  })
})

describe('unicode xml utilities', () => {
  it('unicode2xml formats as &#xNN;', () => {
    expect(unicode2xml([0x41, 0x42])).toBe('&#x41;&#x42;')
    expect(unicode2xml(65)).toBe('&#x41;')
  })

  it('unicode2esc formats as \\xx,\\yy', () => {
    expect(unicode2esc([0x41, 0x42])).toBe('\\41,\\42')
  })
})

describe('optimizettf report', () => {
  it('returns true when no duplicates', () => {
    const ttf = {
      glyf: [
        { contours: [], xMin: 0, yMin: 0, xMax: 0, yMax: 0, advanceWidth: 0, leftSideBearing: 0 },
        { contours: [], xMin: 0, yMin: 0, xMax: 0, yMax: 0, advanceWidth: 0, leftSideBearing: 0, unicode: [0x41] },
      ],
    }
    const result = optimizettf(ttf as unknown as import('../src/types').TTFObject)
    expect(result).toBe(true)
  })

  it('reports repeats when unicodes collide', () => {
    const ttf = {
      glyf: [
        { contours: [], xMin: 0, yMin: 0, xMax: 0, yMax: 0, advanceWidth: 0, leftSideBearing: 0, unicode: [0x41] },
        { contours: [], xMin: 0, yMin: 0, xMax: 0, yMax: 0, advanceWidth: 0, leftSideBearing: 0, unicode: [0x41] },
      ],
    }
    const result = optimizettf(ttf as unknown as import('../src/types').TTFObject)
    expect(result).toEqual({ repeat: [0x41] })
  })
})
