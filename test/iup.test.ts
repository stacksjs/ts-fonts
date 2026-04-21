import { describe, expect, it } from 'bun:test'
import {
  compressTupleDeltas,
  iupDelta,
  optimizeContourReferences,
  type IupDelta,
} from '../src/variable/iup'

/**
 * Exercise IUP — the OpenType "Interpolate Untouched Points" rules used
 * to compress gvar. Covers per-axis linear interpolation, clamp-to-nearer-
 * flank for out-of-range points, the special case of equal flanking
 * deltas, and the greedy optimizer's ability to strip redundant points.
 */

describe('iup: per-axis interpolation rules', () => {
  const flankA = { pos: { x: 0, y: 0 }, delta: { x: 0, y: 0 } }
  const flankB = { pos: { x: 100, y: 100 }, delta: { x: 10, y: 20 } }

  it('linearly interpolates when target coord is between flanks', () => {
    const d = iupDelta({ x: 50, y: 50 }, flankA, flankB)
    expect(d.x).toBeCloseTo(5, 5) // midway of 0..10
    expect(d.y).toBeCloseTo(10, 5) // midway of 0..20
  })

  it('clamps to the nearer flank when target is outside the range', () => {
    // x < min(0, 100) = 0 → use flankA (x=0, closer to target x=-10)
    const belowLo = iupDelta({ x: -10, y: 50 }, flankA, flankB)
    expect(belowLo.x).toBe(0)
    // x > max → use flankB
    const aboveHi = iupDelta({ x: 200, y: 50 }, flankA, flankB)
    expect(aboveHi.x).toBe(10)
  })

  it('uses flankA\'s delta when flanks have equal coords on that axis', () => {
    const flanksEqX = { pos: { x: 50, y: 0 }, delta: { x: 3, y: 0 } }
    const flanksEqX2 = { pos: { x: 50, y: 100 }, delta: { x: 7, y: 20 } }
    const d = iupDelta({ x: 50, y: 25 }, flanksEqX, flanksEqX2)
    expect(d.x).toBe(3) // equal-x rule returns flank A's delta
    expect(d.y).toBeCloseTo(5, 5) // y is still linearly interpolated
  })
})

describe('iup: optimizeContourReferences (greedy compression)', () => {
  it('drops all references if every delta is zero', () => {
    const contour = [
      { x: 0, y: 0, onCurve: true },
      { x: 100, y: 0, onCurve: true },
      { x: 100, y: 100, onCurve: true },
      { x: 0, y: 100, onCurve: true },
    ]
    const deltas: IupDelta[] = [
      { x: 0, y: 0 }, { x: 0, y: 0 }, { x: 0, y: 0 }, { x: 0, y: 0 },
    ]
    expect(optimizeContourReferences(contour, deltas)).toEqual([])
  })

  it('keeps all refs when deltas are arbitrary / non-interpolatable', () => {
    const contour = [
      { x: 0, y: 0, onCurve: true },
      { x: 100, y: 0, onCurve: true },
      { x: 100, y: 100, onCurve: true },
      { x: 0, y: 100, onCurve: true },
    ]
    const deltas: IupDelta[] = [
      { x: 5, y: -3 }, { x: 0, y: 17 }, { x: -20, y: 4 }, { x: 11, y: 0 },
    ]
    // No structural pattern: the greedy optimizer can't remove anything.
    const refs = optimizeContourReferences(contour, deltas)
    expect(refs.length).toBeGreaterThan(0)
  })

  it('removes middle points on a linear-delta run', () => {
    // 5 diagonally-arranged points — positions and deltas both linear so
    // IUP's per-axis linear interpolation can reconstruct the middle ones.
    const contour = [
      { x: 0, y: 0, onCurve: true },
      { x: 100, y: 100, onCurve: true },
      { x: 200, y: 200, onCurve: true },
      { x: 300, y: 300, onCurve: true },
      { x: 400, y: 400, onCurve: true },
    ]
    const deltas: IupDelta[] = [
      { x: 0, y: 0 }, { x: 10, y: 10 }, { x: 20, y: 20 }, { x: 30, y: 30 }, { x: 40, y: 40 },
    ]
    const refs = optimizeContourReferences(contour, deltas)
    // Greedy should keep only the endpoints since the middle points are
    // exactly the linear interpolation between them on both axes.
    expect(refs).toEqual([0, 4])
  })

  it('preserves points whose deltas deviate from linear', () => {
    const contour = [
      { x: 0, y: 0, onCurve: true },
      { x: 100, y: 100, onCurve: true },
      { x: 200, y: 200, onCurve: true },
      { x: 300, y: 300, onCurve: true },
      { x: 400, y: 400, onCurve: true },
    ]
    // Middle point breaks the line.
    const deltas: IupDelta[] = [
      { x: 0, y: 0 }, { x: 10, y: 10 }, { x: 50, y: 50 }, { x: 30, y: 30 }, { x: 40, y: 40 },
    ]
    const refs = optimizeContourReferences(contour, deltas)
    // The deviant midpoint (index 2) must remain referenced.
    expect(refs).toContain(2)
  })

  it('tolerance ≥ deviation lets marginal points be dropped', () => {
    const contour = [
      { x: 0, y: 0, onCurve: true },
      { x: 100, y: 100, onCurve: true },
      { x: 200, y: 200, onCurve: true },
    ]
    // Middle delta is 11 where linear interp would be 10 — deviation of 1 em.
    const deltas: IupDelta[] = [
      { x: 0, y: 0 }, { x: 11, y: 11 }, { x: 20, y: 20 },
    ]
    // Default tolerance (0.5) → middle point kept.
    expect(optimizeContourReferences(contour, deltas, 0.5)).toEqual([0, 1, 2])
    // Tolerance 2 → middle can be dropped.
    expect(optimizeContourReferences(contour, deltas, 2)).toEqual([0, 2])
  })
})

describe('iup: compressTupleDeltas full-tuple API', () => {
  it('concatenates refs across multiple contours and always keeps moving phantoms', () => {
    const contours = [
      // Contour 0: diagonal linear-delta run — middle point should drop.
      [
        { x: 0, y: 0, onCurve: true },
        { x: 100, y: 100, onCurve: true },
        { x: 200, y: 200, onCurve: true },
      ],
      // Contour 1: all-zero — drops entirely.
      [
        { x: 500, y: 500, onCurve: true },
        { x: 600, y: 500, onCurve: true },
      ],
    ]
    // total real points = 5. phantom order: [5..8] = [lsb, rsb, top, bottom]
    const deltas: IupDelta[] = [
      { x: 0, y: 0 }, { x: 10, y: 10 }, { x: 20, y: 20 }, // contour 0
      { x: 0, y: 0 }, { x: 0, y: 0 }, // contour 1 (zero)
      { x: 5, y: 0 }, { x: 7, y: 0 }, { x: 0, y: 0 }, { x: 0, y: 0 }, // phantoms
    ]
    const r = compressTupleDeltas(contours, deltas)
    // Expect contour-0 endpoints (indices 0, 2), no contour-1 points,
    // and phantoms 5 and 6 (the non-zero ones).
    expect(r.pointIndices).toEqual([0, 2, 5, 6])
    expect(r.deltas).toEqual([
      { x: 0, y: 0 }, { x: 20, y: 20 }, { x: 5, y: 0 }, { x: 7, y: 0 },
    ])
  })

  it('preserves the full delta array when contours have no redundancy', () => {
    const contours = [[
      { x: 0, y: 0, onCurve: true },
      { x: 100, y: 0, onCurve: true },
      { x: 50, y: 100, onCurve: true },
    ]]
    const deltas: IupDelta[] = [
      { x: 5, y: -3 }, { x: -10, y: 20 }, { x: 0, y: 0 },
      { x: 0, y: 0 }, { x: 0, y: 0 }, { x: 0, y: 0 }, { x: 0, y: 0 }, // phantoms
    ]
    const r = compressTupleDeltas(contours, deltas)
    // All three real points are references (none interpolate from the others);
    // phantoms are all zero so omitted.
    expect(r.pointIndices).toEqual([0, 1, 2])
  })
})
