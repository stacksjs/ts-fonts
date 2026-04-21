import type { BezPoint } from '../util/bezier'
import { cubicToQuadratic } from '../util/bezier'

/**
 * Type 2 charstring interpreter that produces a flat contour list
 * compatible with our TTF glyf model (array of contours, each a list
 * of on-/off-curve points).
 *
 * Cubic bezier segments are converted to quadratic via adaptive
 * subdivision so the output can round-trip through glyf.
 */

export interface CharstringResult {
  contours: Array<Array<{ x: number, y: number, onCurve?: boolean }>>
  advanceWidth: number
  xMin: number
  yMin: number
  xMax: number
  yMax: number
}

export interface CharstringContext {
  subrs: Uint8Array[]
  gsubrs: Uint8Array[]
  subrsBias: number
  gsubrsBias: number
  defaultWidthX: number
  nominalWidthX: number
}

// Width is resolved from the first operand of the first width-bearing operator.
// The number of operands preceding a width is >0 when the width is present.
const WIDTH_BEARING_OPS = new Set([1, 3, 4, 14, 18, 19, 20, 21, 22, 23])

export function executeCharstring(bytecode: Uint8Array, ctx: CharstringContext): CharstringResult {
  const stack: number[] = []
  const contours: Array<Array<{ x: number, y: number, onCurve?: boolean }>> = []
  let currentContour: Array<{ x: number, y: number, onCurve?: boolean }> = []
  let x = 0
  let y = 0
  let advanceWidth = ctx.defaultWidthX
  let widthResolved = false
  let hintCount = 0
  let xMin = Infinity, yMin = Infinity, xMax = -Infinity, yMax = -Infinity

  const track = (px: number, py: number): void => {
    if (px < xMin) xMin = px
    if (px > xMax) xMax = px
    if (py < yMin) yMin = py
    if (py > yMax) yMax = py
  }

  const closeContour = (): void => {
    if (currentContour.length > 0)
      contours.push(currentContour)
    currentContour = []
  }

  const moveTo = (dx: number, dy: number): void => {
    closeContour()
    x += dx; y += dy
    currentContour.push({ x, y, onCurve: true })
    track(x, y)
  }

  const lineTo = (dx: number, dy: number): void => {
    x += dx; y += dy
    currentContour.push({ x, y, onCurve: true })
    track(x, y)
  }

  const cubicTo = (dxa: number, dya: number, dxb: number, dyb: number, dxc: number, dyc: number): void => {
    const p1: BezPoint = { x, y }
    const c1: BezPoint = { x: x + dxa, y: y + dya }
    const c2: BezPoint = { x: c1.x + dxb, y: c1.y + dyb }
    const p2: BezPoint = { x: c2.x + dxc, y: c2.y + dyc }
    const quads = cubicToQuadratic(p1, c1, c2, p2)
    for (const [, control, end] of quads) {
      currentContour.push({ x: control.x, y: control.y, onCurve: false })
      currentContour.push({ x: end.x, y: end.y, onCurve: true })
      track(control.x, control.y)
      track(end.x, end.y)
    }
    x = p2.x
    y = p2.y
  }

  const resolveWidth = (argsExpected: number): void => {
    if (widthResolved) return
    widthResolved = true
    if (stack.length > argsExpected) {
      advanceWidth = ctx.nominalWidthX + (stack.shift() ?? 0)
    }
  }

  function run(bc: Uint8Array): boolean {
    let i = 0
    while (i < bc.length) {
      const b = bc[i]
      if (b >= 32 || b === 28 || b === 29 || b === 255) {
        const { value, next } = readCharstringOperand(bc, i)
        stack.push(value)
        i = next
        continue
      }

      // Operator
      let op = b
      if (b === 12) {
        op = 1200 + bc[i + 1]
        i += 2
      }
      else {
        i += 1
      }

      switch (op) {
        // --- hints ---
        case 1: // hstem
        case 3: // vstem
        case 18: // hstemhm
        case 23: // vstemhm
          resolveWidth(0)
          hintCount += stack.length >> 1
          stack.length = 0
          break
        case 19: // hintmask
        case 20: { // cntrmask
          resolveWidth(0)
          hintCount += stack.length >> 1
          stack.length = 0
          i += (hintCount + 7) >> 3
          break
        }

        // --- moves ---
        case 21: // rmoveto
          resolveWidth(2)
          moveTo(stack[0], stack[1])
          stack.length = 0
          break
        case 22: // hmoveto
          resolveWidth(1)
          moveTo(stack[0], 0)
          stack.length = 0
          break
        case 4: // vmoveto
          resolveWidth(1)
          moveTo(0, stack[0])
          stack.length = 0
          break

        // --- lines ---
        case 5: // rlineto
          for (let k = 0; k + 1 < stack.length; k += 2)
            lineTo(stack[k], stack[k + 1])
          stack.length = 0
          break
        case 6: { // hlineto
          let alt = 0
          for (let k = 0; k < stack.length; k++) {
            if ((alt++ & 1) === 0) lineTo(stack[k], 0)
            else lineTo(0, stack[k])
          }
          stack.length = 0
          break
        }
        case 7: { // vlineto
          let alt = 0
          for (let k = 0; k < stack.length; k++) {
            if ((alt++ & 1) === 0) lineTo(0, stack[k])
            else lineTo(stack[k], 0)
          }
          stack.length = 0
          break
        }

        // --- curves ---
        case 8: // rrcurveto
          for (let k = 0; k + 5 < stack.length; k += 6)
            cubicTo(stack[k], stack[k + 1], stack[k + 2], stack[k + 3], stack[k + 4], stack[k + 5])
          stack.length = 0
          break
        case 24: { // rcurveline
          let k = 0
          while (k + 5 < stack.length - 2) {
            cubicTo(stack[k], stack[k + 1], stack[k + 2], stack[k + 3], stack[k + 4], stack[k + 5])
            k += 6
          }
          lineTo(stack[k], stack[k + 1])
          stack.length = 0
          break
        }
        case 25: { // rlinecurve
          let k = 0
          while (k + 1 < stack.length - 6) {
            lineTo(stack[k], stack[k + 1])
            k += 2
          }
          cubicTo(stack[k], stack[k + 1], stack[k + 2], stack[k + 3], stack[k + 4], stack[k + 5])
          stack.length = 0
          break
        }
        case 26: { // vvcurveto
          let k = 0
          let dx1 = 0
          if (stack.length & 1) {
            dx1 = stack[0]
            k = 1
          }
          while (k + 3 < stack.length) {
            cubicTo(dx1, stack[k], stack[k + 1], stack[k + 2], 0, stack[k + 3])
            dx1 = 0
            k += 4
          }
          stack.length = 0
          break
        }
        case 27: { // hhcurveto
          let k = 0
          let dy1 = 0
          if (stack.length & 1) {
            dy1 = stack[0]
            k = 1
          }
          while (k + 3 < stack.length) {
            cubicTo(stack[k], dy1, stack[k + 1], stack[k + 2], stack[k + 3], 0)
            dy1 = 0
            k += 4
          }
          stack.length = 0
          break
        }
        case 30: { // vhcurveto
          let k = 0
          while (k < stack.length) {
            if (k + 4 > stack.length) break
            const dy1 = stack[k]
            const dx2 = stack[k + 1]
            const dy2 = stack[k + 2]
            const dx3 = stack[k + 3]
            const dy3 = (stack.length - k - 4 === 1) ? stack[k + 4] : 0
            cubicTo(0, dy1, dx2, dy2, dx3, dy3)
            k += (stack.length - k - 4 === 1) ? 5 : 4
            if (k >= stack.length) break
            if (k + 4 > stack.length) break
            const dx1 = stack[k]
            const dx2b = stack[k + 1]
            const dy2b = stack[k + 2]
            const dy3b = stack[k + 3]
            const dx3b = (stack.length - k - 4 === 1) ? stack[k + 4] : 0
            cubicTo(dx1, 0, dx2b, dy2b, dx3b, dy3b)
            void dx2b // linter
            k += (stack.length - k - 4 === 1) ? 5 : 4
          }
          stack.length = 0
          break
        }
        case 31: { // hvcurveto
          let k = 0
          while (k < stack.length) {
            if (k + 4 > stack.length) break
            const dx1 = stack[k]
            const dx2 = stack[k + 1]
            const dy2 = stack[k + 2]
            const dy3 = stack[k + 3]
            const dx3 = (stack.length - k - 4 === 1) ? stack[k + 4] : 0
            cubicTo(dx1, 0, dx2, dy2, dx3, dy3)
            k += (stack.length - k - 4 === 1) ? 5 : 4
            if (k >= stack.length) break
            if (k + 4 > stack.length) break
            const dy1 = stack[k]
            const dx2b = stack[k + 1]
            const dy2b = stack[k + 2]
            const dx3b = stack[k + 3]
            const dy3b = (stack.length - k - 4 === 1) ? stack[k + 4] : 0
            cubicTo(0, dy1, dx2b, dy2b, dx3b, dy3b)
            k += (stack.length - k - 4 === 1) ? 5 : 4
          }
          stack.length = 0
          break
        }

        // --- flex ---
        case 1234: // hflex
        case 1236: // hflex1
        case 1235: // flex
        case 1237: { // flex1
          // Approximate as two cubics using the flex operands
          // We handle the general case by reading 6 cubic-pair components
          // for flex / flex1, and synthesize y=0 for hflex / hflex1 anchors
          if (op === 1234 && stack.length >= 7) {
            // hflex: dx1 dx2 dy2 dx3 dx4 dx5 dx6
            cubicTo(stack[0], 0, stack[1], stack[2], stack[3], 0)
            cubicTo(stack[4], 0, stack[5], -stack[2], stack[6], 0)
          }
          else if (op === 1236 && stack.length >= 9) {
            // hflex1: dx1 dy1 dx2 dy2 dx3 dx4 dx5 dy5 dx6
            cubicTo(stack[0], stack[1], stack[2], stack[3], stack[4], 0)
            cubicTo(stack[5], 0, stack[6], stack[7], stack[8], -(stack[1] + stack[3] + stack[7]))
          }
          else if (op === 1235 && stack.length >= 13) {
            // flex: 12 deltas + fd
            cubicTo(stack[0], stack[1], stack[2], stack[3], stack[4], stack[5])
            cubicTo(stack[6], stack[7], stack[8], stack[9], stack[10], stack[11])
          }
          else if (op === 1237 && stack.length >= 11) {
            // flex1
            const dx = stack[0] + stack[2] + stack[4] + stack[6] + stack[8]
            const dy = stack[1] + stack[3] + stack[5] + stack[7] + stack[9]
            const d6 = stack[10]
            const absDx = Math.abs(dx)
            const absDy = Math.abs(dy)
            cubicTo(stack[0], stack[1], stack[2], stack[3], stack[4], stack[5])
            if (absDx > absDy)
              cubicTo(stack[6], stack[7], stack[8], stack[9], d6, -dy)
            else
              cubicTo(stack[6], stack[7], stack[8], stack[9], -dx, d6)
          }
          stack.length = 0
          break
        }

        // --- subroutines ---
        case 10: { // callsubr
          const index = (stack.pop() ?? 0) + ctx.subrsBias
          const sub = ctx.subrs[index]
          if (sub) {
            const stop = run(sub)
            if (stop) return true
          }
          break
        }
        case 29: { // callgsubr
          const index = (stack.pop() ?? 0) + ctx.gsubrsBias
          const sub = ctx.gsubrs[index]
          if (sub) {
            const stop = run(sub)
            if (stop) return true
          }
          break
        }
        case 11: // return
          return false

        // --- end ---
        case 14: // endchar
          resolveWidth(0)
          closeContour()
          return true

        default:
          // Unknown operator — abort
          stack.length = 0
          break
      }
    }
    return false
  }

  run(bytecode)
  closeContour()

  return {
    contours,
    advanceWidth: Math.round(advanceWidth),
    xMin: Number.isFinite(xMin) ? Math.round(xMin) : 0,
    yMin: Number.isFinite(yMin) ? Math.round(yMin) : 0,
    xMax: Number.isFinite(xMax) ? Math.round(xMax) : 0,
    yMax: Number.isFinite(yMax) ? Math.round(yMax) : 0,
  }
  void WIDTH_BEARING_OPS
}

function readCharstringOperand(bc: Uint8Array, i: number): { value: number, next: number } {
  const b = bc[i]
  if (b >= 32 && b <= 246)
    return { value: b - 139, next: i + 1 }
  if (b >= 247 && b <= 250)
    return { value: (b - 247) * 256 + bc[i + 1] + 108, next: i + 2 }
  if (b >= 251 && b <= 254)
    return { value: -(b - 251) * 256 - bc[i + 1] - 108, next: i + 2 }
  if (b === 28) {
    const v = (bc[i + 1] << 8) | bc[i + 2]
    return { value: v >= 0x8000 ? v - 0x10000 : v, next: i + 3 }
  }
  if (b === 255) {
    // 16.16 fixed
    const v = (bc[i + 1] << 24) | (bc[i + 2] << 16) | (bc[i + 3] << 8) | bc[i + 4]
    return { value: (v | 0) / 65536, next: i + 5 }
  }
  return { value: 0, next: i + 1 }
}
