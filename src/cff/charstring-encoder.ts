/**
 * Type 2 charstring encoder.
 *
 * Converts a TT-style contour list (on-/off-curve points, implicit
 * quadratic Bezier midpoints, implicit close-loop) into the cubic-Bezier
 * Type 2 charstring bytecode used by CFF.
 *
 * The encoder emits only a minimal operator set:
 *   - `rmoveto`  (21)  for path opens
 *   - `rlineto`  (5)   for straight segments
 *   - `rrcurveto`(8)   for cubic curves (every quadratic input is
 *                      lifted to a cubic via the standard 2/3 rule)
 *   - `endchar`  (14)  to terminate
 *
 * A leading width operand is prefixed to every charstring, so the
 * Private DICT can use `defaultWidthX = 0` and `nominalWidthX = 0`
 * without per-glyph deltas.
 *
 * Type 2 spec: https://adobe-type-tools.github.io/font-tech-notes/pdfs/5177.Type2.pdf
 */

import type { Glyph } from '../types'

const OP_RMOVETO = 21
const OP_RLINETO = 5
const OP_RRCURVETO = 8
const OP_ENDCHAR = 14
const OP_HSTEM = 1
const OP_VSTEM = 3

interface PointXY { x: number, y: number, onCurve?: boolean }

/**
 * Convert a TT contour (potentially with consecutive off-curve points
 * implying interpolated on-curves) into a normalized list of explicit
 * on-curve and off-curve points where every off-curve sits between two
 * on-curve neighbours. The list represents a closed loop; the last
 * on-curve connects back to the first.
 */
function normalizeContour(contour: ReadonlyArray<PointXY>): PointXY[] {
  if (contour.length === 0) return []
  // Make a working copy with non-undefined onCurve.
  const pts = contour.map(p => ({ x: p.x, y: p.y, onCurve: p.onCurve !== false }))

  // Find first on-curve point. Rotate so we start there. (Some fonts begin
  // with off-curve, in which case a ghost on-curve point is produced.)
  let startIdx = pts.findIndex(p => p.onCurve)
  if (startIdx < 0) {
    // All off-curve: synthesise an on-curve midpoint and rotate so we start
    // on it. (Rare — only seen in some CJK fonts.)
    const a = pts[0]!, b = pts[pts.length - 1]!
    pts.unshift({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, onCurve: true })
    startIdx = 0
  }
  const rotated = [...pts.slice(startIdx), ...pts.slice(0, startIdx)]

  // Insert implicit on-curve midpoints between consecutive off-curves.
  const out: PointXY[] = []
  for (let i = 0; i < rotated.length; i++) {
    const cur = rotated[i]!
    out.push(cur)
    const next = rotated[(i + 1) % rotated.length]!
    if (!cur.onCurve && !next.onCurve) {
      out.push({ x: (cur.x + next.x) / 2, y: (cur.y + next.y) / 2, onCurve: true })
    }
  }

  return out
}

/** Encode a signed integer as Type 2 charstring operand bytes. */
function encodeOperand(n: number, out: number[]): void {
  // Type 2 supports arbitrary fractional values via a 5-byte fixed encoding,
  // but TT outlines coming through the TTF model are integer-rounded already.
  const v = Math.round(n)
  if (v >= -107 && v <= 107) {
    out.push(v + 139)
  }
  else if (v >= 108 && v <= 1131) {
    const adj = v - 108
    out.push(247 + (adj >> 8), adj & 0xFF)
  }
  else if (v >= -1131 && v <= -108) {
    const adj = -v - 108
    out.push(251 + (adj >> 8), adj & 0xFF)
  }
  else if (v >= -32768 && v <= 32767) {
    out.push(28, (v >> 8) & 0xFF, v & 0xFF)
  }
  else {
    // 5-byte 16.16 fixed
    const fixed = Math.round(v * 65536)
    out.push(255, (fixed >> 24) & 0xFF, (fixed >> 16) & 0xFF, (fixed >> 8) & 0xFF, fixed & 0xFF)
  }
}

/**
 * Detect approximate horizontal/vertical stems from a glyph's contours.
 *
 * Strategy: walk each contour looking for consecutive edges that are
 * nearly horizontal (or vertical) AND face opposite normals — those mark
 * the two edges of a stem. We collect all such candidates and dedupe by
 * stem position.
 *
 * This is a coarse auto-hinter; it won't catch every nuance a designer
 * would mark by hand, but it produces enough hints for grid-fitters to
 * align dominant stems at small sizes — meaningfully better than emitting
 * no hints at all.
 */
interface Stem { edge: number, span: number }

interface XY { x: number, y: number, onCurve?: boolean }

function detectStems(contours: ReadonlyArray<ReadonlyArray<XY>>): { hstems: Stem[], vstems: Stem[] } {
  // Edges that are "near-horizontal" (dy small) → tops/bottoms of bars.
  // Group those edges by y-coordinate; pairs of groups form bars.
  interface HEdge { y: number, xMin: number, xMax: number, normalSign: number }
  interface VEdge { x: number, yMin: number, yMax: number, normalSign: number }
  const hEdges: HEdge[] = []
  const vEdges: VEdge[] = []
  const TOL_HORIZ = 5
  const TOL_VERT = 5
  for (const con of contours) {
    if (con.length < 2) continue
    for (let i = 0; i < con.length; i++) {
      const a = con[i]!, b = con[(i + 1) % con.length]!
      if (a.onCurve === false || b.onCurve === false) continue // skip off-curve segments
      const dx = b.x - a.x, dy = b.y - a.y
      if (Math.abs(dy) <= TOL_HORIZ && Math.abs(dx) > 4 * Math.abs(dy)) {
        hEdges.push({
          y: (a.y + b.y) / 2,
          xMin: Math.min(a.x, b.x),
          xMax: Math.max(a.x, b.x),
          normalSign: dx > 0 ? 1 : -1,
        })
      }
      else if (Math.abs(dx) <= TOL_VERT && Math.abs(dy) > 4 * Math.abs(dx)) {
        vEdges.push({
          x: (a.x + b.x) / 2,
          yMin: Math.min(a.y, b.y),
          yMax: Math.max(a.y, b.y),
          normalSign: dy > 0 ? -1 : 1,
        })
      }
    }
  }

  // Pair edges into stems: opposite-normal edges with overlapping perpendicular
  // extent and a small parallel gap form a stem.
  const hstems: Stem[] = []
  const seenH = new Set<string>()
  for (let i = 0; i < hEdges.length; i++) {
    for (let j = i + 1; j < hEdges.length; j++) {
      const a = hEdges[i]!, b = hEdges[j]!
      if (a.normalSign === b.normalSign) continue
      const yLow = Math.min(a.y, b.y)
      const yHigh = Math.max(a.y, b.y)
      const span = yHigh - yLow
      if (span < 4 || span > 250) continue // ignore degenerate or oversized "stems"
      const overlap = Math.min(a.xMax, b.xMax) - Math.max(a.xMin, b.xMin)
      if (overlap < 10) continue
      const key = `${Math.round(yLow)}_${Math.round(span)}`
      if (seenH.has(key)) continue
      seenH.add(key)
      hstems.push({ edge: yLow, span })
    }
  }
  const vstems: Stem[] = []
  const seenV = new Set<string>()
  for (let i = 0; i < vEdges.length; i++) {
    for (let j = i + 1; j < vEdges.length; j++) {
      const a = vEdges[i]!, b = vEdges[j]!
      if (a.normalSign === b.normalSign) continue
      const xLow = Math.min(a.x, b.x)
      const xHigh = Math.max(a.x, b.x)
      const span = xHigh - xLow
      if (span < 4 || span > 250) continue
      const overlap = Math.min(a.yMax, b.yMax) - Math.max(a.yMin, b.yMin)
      if (overlap < 10) continue
      const key = `${Math.round(xLow)}_${Math.round(span)}`
      if (seenV.has(key)) continue
      seenV.add(key)
      vstems.push({ edge: xLow, span })
    }
  }

  // Sort stems by edge position (Type 2 requires ascending order).
  hstems.sort((a, b) => a.edge - b.edge)
  vstems.sort((a, b) => a.edge - b.edge)
  return { hstems, vstems }
}

/**
 * Emit hstem/vstem hint operators. Operands are delta-encoded: first stem's
 * edge is absolute, subsequent stems are deltas from the previous stem's
 * edge+span (top of previous to bottom of next).
 */
function encodeStemHints(stems: ReadonlyArray<Stem>, op: number, out: number[]): void {
  if (stems.length === 0) return
  let prevTop = 0
  for (const s of stems) {
    const delta = s.edge - prevTop
    encodeOperand(delta, out)
    encodeOperand(s.span, out)
    prevTop = s.edge + s.span
  }
  out.push(op)
}

/**
 * Encode a single glyph as a Type 2 charstring (returns the bytecode
 * including a leading width operand, optional hstem/vstem hints, and
 * trailing `endchar`). Coordinates are emitted relative to the running
 * pen position.
 */
export function encodeCharstring(glyph: Glyph, advanceWidth: number): Uint8Array {
  const out: number[] = []

  // Width prefix (since defaultWidthX/nominalWidthX are both 0).
  encodeOperand(advanceWidth, out)

  // Auto-detect dominant stems and emit them as hint hints. Hinting engines
  // can ignore these or use them for grid-fitting at small sizes.
  if (glyph.contours && glyph.contours.length > 0) {
    const { hstems, vstems } = detectStems(glyph.contours as ReadonlyArray<ReadonlyArray<XY>>)
    encodeStemHints(hstems, OP_HSTEM, out)
    encodeStemHints(vstems, OP_VSTEM, out)
  }

  let penX = 0
  let penY = 0

  if (glyph.contours && glyph.contours.length > 0) {
    for (const raw of glyph.contours) {
      const pts = normalizeContour(raw as ReadonlyArray<PointXY>)
      if (pts.length === 0) continue

      // moveto to first on-curve
      const start = pts[0]!
      const dx0 = start.x - penX
      const dy0 = start.y - penY
      encodeOperand(dx0, out)
      encodeOperand(dy0, out)
      out.push(OP_RMOVETO)
      penX = start.x
      penY = start.y

      // Walk segments. Each segment is either:
      //   on → on        : line
      //   on → off → on  : quadratic curve (lift to cubic)
      // Segments wrap around to close the loop.
      const n = pts.length
      let i = 0
      while (i < n) {
        const cur = pts[i]!
        const nxt = pts[(i + 1) % n]!
        if (nxt.onCurve) {
          // Straight line cur → nxt
          const dx = nxt.x - cur.x
          const dy = nxt.y - cur.y
          if (dx !== 0 || dy !== 0) {
            encodeOperand(dx, out)
            encodeOperand(dy, out)
            out.push(OP_RLINETO)
          }
          penX = nxt.x
          penY = nxt.y
          i++
        }
        else {
          // cur (on) → nxt (off, control) → after (on)
          const after = pts[(i + 2) % n]!
          // Lift quadratic to cubic.
          //   C1 = cur + 2/3 (control - cur)
          //   C2 = after + 2/3 (control - after)
          const c1x = cur.x + (2 / 3) * (nxt.x - cur.x)
          const c1y = cur.y + (2 / 3) * (nxt.y - cur.y)
          const c2x = after.x + (2 / 3) * (nxt.x - after.x)
          const c2y = after.y + (2 / 3) * (nxt.y - after.y)
          encodeOperand(c1x - penX, out); encodeOperand(c1y - penY, out)
          encodeOperand(c2x - c1x, out); encodeOperand(c2y - c1y, out)
          encodeOperand(after.x - c2x, out); encodeOperand(after.y - c2y, out)
          out.push(OP_RRCURVETO)
          penX = after.x
          penY = after.y
          i += 2
        }
      }
    }
  }

  out.push(OP_ENDCHAR)
  return Uint8Array.from(out)
}
