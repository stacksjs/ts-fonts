/**
 * Interpolate Untouched Points (IUP) — the OpenType gvar optimization that
 * lets glyph variation data omit deltas for points whose movement can be
 * interpolated from adjacent reference points.
 *
 * Spec: OpenType "Tuple Variation Store" section, interpolation algorithm
 * as implemented by fontTools.varLib.iup.
 *
 * For a non-reference point P flanked by reference points R1 and R2 (in
 * contour traversal order), the x-delta of P is computed per-axis as:
 *
 *   if x(R1) == x(R2): d_x(P) = d_x(R1)   [or R2, they're equal]
 *   else if x(P) is in [min(x(R1), x(R2)), max(x(R1), x(R2))]:
 *     t = (x(P) - x(R1)) / (x(R2) - x(R1))
 *     d_x(P) = d_x(R1) + t * (d_x(R2) - d_x(R1))
 *   else: d_x(P) = delta of whichever flank has the x-coord closer to x(P)
 *
 * Same rule for y (per-axis, independent). A point is "omittable" when
 * the IUP-computed delta matches its actual delta within a small tolerance.
 */

import type { Contour } from '../types'

export interface IupDelta { x: number, y: number }

/** Linear interpolation of one axis per OpenType IUP rules. */
function iupAxis(
  targetCoord: number,
  refA: number,
  refB: number,
  deltaA: number,
  deltaB: number,
): number {
  if (refA === refB) return deltaA
  const lo = Math.min(refA, refB)
  const hi = Math.max(refA, refB)
  if (targetCoord >= lo && targetCoord <= hi) {
    const t = (targetCoord - refA) / (refB - refA)
    return deltaA + t * (deltaB - deltaA)
  }
  // Clamp: use the delta of the flank whose coord is closer to targetCoord.
  return Math.abs(targetCoord - refA) <= Math.abs(targetCoord - refB) ? deltaA : deltaB
}

/**
 * Compute the IUP-reconstructed delta for `point` flanked by two references.
 * The two flanks are assumed to be the nearest referenced points on either
 * side of `point` in contour-traversal order (wrap-around OK).
 */
export function iupDelta(
  point: { x: number, y: number },
  flankA: { pos: { x: number, y: number }, delta: IupDelta },
  flankB: { pos: { x: number, y: number }, delta: IupDelta },
): IupDelta {
  return {
    x: iupAxis(point.x, flankA.pos.x, flankB.pos.x, flankA.delta.x, flankB.delta.x),
    y: iupAxis(point.y, flankA.pos.y, flankB.pos.y, flankA.delta.y, flankB.delta.y),
  }
}

/**
 * For a single contour, return the indices of points whose deltas must be
 * retained as explicit references. All other points can be omitted and
 * reconstructed via IUP at render time.
 *
 * Uses a greedy pass: start with every point as a reference, then try to
 * drop each one; keep it only if dropping would lose information beyond
 * `tolerance` em units on either axis.
 *
 * Special cases:
 *   - If every point's delta is zero, no references are needed (returns []).
 *   - If all points have identical non-zero delta, one reference suffices.
 *   - Degenerate contours (0 or 1 point) emit themselves as references.
 */
export function optimizeContourReferences(
  contour: Contour,
  deltas: IupDelta[],
  tolerance = 0.5,
): number[] {
  const n = contour.length
  if (n === 0) return []
  if (n === 1) return hasMotion(deltas[0]!, tolerance) ? [0] : []

  const allZero = deltas.every(d => Math.abs(d.x) <= tolerance && Math.abs(d.y) <= tolerance)
  if (allZero) return []

  // Start with every point referenced.
  const isRef = new Array(n).fill(true) as boolean[]

  // Greedy drop — iterate and attempt to remove each point. Order matters
  // for compression ratio; a two-pass approach (forward then backward)
  // finds slightly more omittable points than one pass.
  for (let pass = 0; pass < 2; pass++) {
    for (let step = 0; step < n; step++) {
      const i = pass === 0 ? step : (n - 1 - step)
      if (!isRef[i]) continue

      // Find nearest refs on either side (wrap-around).
      const before = findNeighborRef(isRef, i, -1, n)
      const after = findNeighborRef(isRef, i, +1, n)
      if (before < 0 || after < 0) continue // not enough refs to interpolate

      const predicted = iupDelta(
        contour[i]!,
        { pos: contour[before]!, delta: deltas[before]! },
        { pos: contour[after]!, delta: deltas[after]! },
      )
      const actual = deltas[i]!
      if (Math.abs(predicted.x - actual.x) <= tolerance && Math.abs(predicted.y - actual.y) <= tolerance) {
        isRef[i] = false
      }
    }
  }

  const refs: number[] = []
  for (let i = 0; i < n; i++) if (isRef[i]) refs.push(i)
  return refs
}

function findNeighborRef(isRef: boolean[], i: number, step: number, n: number): number {
  for (let k = 1; k < n; k++) {
    const j = ((i + step * k) % n + n) % n
    if (isRef[j]) return j
  }
  return -1
}

function hasMotion(d: IupDelta, tol: number): boolean {
  return Math.abs(d.x) > tol || Math.abs(d.y) > tol
}

/**
 * Compress one tuple's deltas against contour topology.
 *
 * Input:
 *   - contours: the glyph's contour structure (shape of the *default* master)
 *   - deltas: (totalRealPoints + 4) deltas in the order [contour0 pts..., contour1 pts..., phantoms x4]
 *   - tolerance: max allowable deviation per-axis between actual and IUP-predicted delta (default 0.5 em)
 *
 * Output:
 *   - pointIndices: explicit indices of points to keep (in ascending order)
 *   - deltas: just those points' deltas, in the same order as pointIndices
 *
 * Phantom points (advance-width and side-bearing variations) are always
 * retained because they aren't part of a contour and IUP can't reconstruct them.
 */
export function compressTupleDeltas(
  contours: Contour[],
  deltas: IupDelta[],
  tolerance = 0.5,
): { pointIndices: number[], deltas: IupDelta[] } {
  const totalRealPoints = contours.reduce((s, c) => s + c.length, 0)
  const pointIndices: number[] = []
  const compressedDeltas: IupDelta[] = []

  let cursor = 0
  for (const contour of contours) {
    const contourDeltas = deltas.slice(cursor, cursor + contour.length)
    const localRefs = optimizeContourReferences(contour, contourDeltas, tolerance)
    for (const localIdx of localRefs) {
      pointIndices.push(cursor + localIdx)
      compressedDeltas.push(contourDeltas[localIdx]!)
    }
    cursor += contour.length
  }

  // Phantom points — always include if they have motion; omitting them is
  // legal (they default to 0) but small savings.
  for (let i = 0; i < 4; i++) {
    const phantomIdx = totalRealPoints + i
    const d = deltas[phantomIdx]
    if (d && hasMotion(d, tolerance)) {
      pointIndices.push(phantomIdx)
      compressedDeltas.push(d)
    }
  }

  return { pointIndices, deltas: compressedDeltas }
}
