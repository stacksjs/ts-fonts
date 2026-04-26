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
 * Encode a single glyph as a Type 2 charstring (returns the bytecode
 * including a leading width operand and trailing `endchar`). Coordinates
 * are emitted relative to the running pen position.
 */
export function encodeCharstring(glyph: Glyph, advanceWidth: number): Uint8Array {
  const out: number[] = []

  // Width prefix (since defaultWidthX/nominalWidthX are both 0).
  encodeOperand(advanceWidth, out)

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
