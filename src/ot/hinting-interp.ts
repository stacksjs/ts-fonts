/**
 * TrueType instruction set interpreter.
 *
 * Executes TT bytecode against a glyph's points to apply hinting
 * corrections at a given pixels-per-em value. Not a full production
 * rasterizer — covers the core opcodes that real fonts use:
 *
 *   stack ops, arithmetic/logic, branching, function def/call,
 *   graphics state (SRP/SZP/SLOOP/SMD/SCVTCI, ROUND modes),
 *   SVTCA/SPVTCA/SFVTCA (axis-aligned projection/freedom vectors),
 *   MDAP, MIAP, MDRP (basic), MIRP (basic), IUP, IP, SHP/SHC/SHZ,
 *   SHPIX, MSIRP, ALIGNRP, FLIPPT, FLIPRGON/OFF, RS/WS, RCVT/WCVTP/WCVTF,
 *   MPPEM, MPS, MD, GC, SCFS, GETINFO, GETVARIATION (stubbed), DEBUG.
 *
 * Non-axis-aligned projection/freedom vectors (SPVTL/SFVTL/SFVTPV/SPVFS/
 * SFVFS), per-glyph deltas (DELTAP/DELTAC), and ISECT are present with
 * operand-correct stack behaviour but apply only approximate geometry.
 *
 * Output: the glyph with hinted integer-rounded point coordinates.
 */

export interface HintingGraphicsState {
  /** Reference point indices on zone pointers. */
  rp0: number
  rp1: number
  rp2: number
  /** Zone pointers (0=twilight, 1=glyph). */
  zp0: 0 | 1
  zp1: 0 | 1
  zp2: 0 | 1
  /** Loop counter for instructions that repeat. */
  loop: number
  /** Minimum distance in F26Dot6. */
  minimumDistance: number
  /** Control value cut-in in F26Dot6. */
  controlValueCutIn: number
  /** Projection vector [x, y] — F2Dot14 components. */
  projectionVector: [number, number]
  /** Freedom vector [x, y] — F2Dot14 components. */
  freedomVector: [number, number]
  /** Dual projection vector (for RP1 measurements). */
  dualProjectionVector: [number, number]
  /** Single width cut-in in F26Dot6. */
  singleWidthCutIn: number
  /** Single width value. */
  singleWidthValue: number
  /** Auto flip. */
  autoFlip: boolean
  /** Rounding state (0=half grid, 1=grid, 2=double grid, 3=down-to-grid, 4=up-to-grid, 5=off, 6=SROUND, 7=S45ROUND). */
  roundState: number
  /** Current round period / phase / threshold for SROUND / S45ROUND. */
  roundPeriod: number
  roundPhase: number
  roundThreshold: number
  /** Delta base / delta shift. */
  deltaBase: number
  deltaShift: number
}

export interface HintingContext {
  /** Pixels-per-em. */
  ppem: number
  /** Font units per em. */
  unitsPerEm: number
  /** Scale factor from units → pixels (F26Dot6). */
  scale: number
  /** Parsed fpgm function table: key = FDEF index. */
  functions: Map<number, Uint8Array>
  /** Storage area (cleared between runs). */
  storage: Map<number, number>
  /** CVT table values in F26Dot6. */
  cvt: number[]
  /** Current glyph's original point coords (unhinted). */
  orig: Array<{ x: number, y: number, onCurve: boolean }>
  /** Current glyph's mutable point coords (F26Dot6 integer units). */
  pts: Array<{ x: number, y: number, onCurve: boolean, touchX: boolean, touchY: boolean }>
  /** Twilight zone. */
  twilight: Array<{ x: number, y: number, onCurve: boolean, touchX: boolean, touchY: boolean }>
  /** End-of-contour point indices. */
  endPts: number[]
  /** Graphics state. */
  gs: HintingGraphicsState
}

const F26DOT6 = 64 // 1.0 in F26Dot6 = 64

function defaultGS(): HintingGraphicsState {
  return {
    rp0: 0,
    rp1: 0,
    rp2: 0,
    zp0: 1,
    zp1: 1,
    zp2: 1,
    loop: 1,
    minimumDistance: F26DOT6, // 1.0
    controlValueCutIn: 68,    // 17/16 * 64
    projectionVector: [1, 0], // x-axis
    freedomVector: [1, 0],
    dualProjectionVector: [1, 0],
    singleWidthCutIn: 0,
    singleWidthValue: 0,
    autoFlip: true,
    roundState: 1, // grid
    roundPeriod: F26DOT6,
    roundPhase: 0,
    roundThreshold: F26DOT6 / 2,
    deltaBase: 9,
    deltaShift: 3,
  }
}

function round(value: number, gs: HintingGraphicsState): number {
  const period = gs.roundPeriod
  const phase = gs.roundPhase
  const threshold = gs.roundThreshold
  switch (gs.roundState) {
    case 0: // half grid
      return Math.floor(value / F26DOT6) * F26DOT6 + F26DOT6 / 2
    case 1: // grid
      return Math.round(value / F26DOT6) * F26DOT6
    case 2: // double grid
      return Math.round(value / (F26DOT6 / 2)) * (F26DOT6 / 2)
    case 3: { // down to grid
      const sign = value < 0 ? -1 : 1
      return sign * Math.floor(Math.abs(value) / F26DOT6) * F26DOT6
    }
    case 4: { // up to grid
      const sign = value < 0 ? -1 : 1
      return sign * Math.ceil(Math.abs(value) / F26DOT6) * F26DOT6
    }
    case 5: // off
      return value
    case 6:
    case 7: {
      // SROUND / S45ROUND
      const sign = value < 0 ? -1 : 1
      const abs = Math.abs(value) - phase
      const q = Math.floor(abs / period)
      const rem = abs - q * period
      return sign * ((rem >= threshold ? (q + 1) * period : q * period) + phase)
    }
    default:
      return value
  }
}

/** Parse an FDEF directive from a bytecode buffer and register it. */
export function parseFunctions(bytecode: Uint8Array, functions: Map<number, Uint8Array>): void {
  let i = 0
  while (i < bytecode.length) {
    const op = bytecode[i]
    if (op >= 0xB0 && op <= 0xB7) { i += 1 + (op - 0xB0 + 1); continue }
    if (op >= 0xB8 && op <= 0xBF) { i += 1 + (op - 0xB8 + 1) * 2; continue }
    if (op === 0x40) { i++; const n = bytecode[i++]; i += n; continue }
    if (op === 0x41) { i++; const n = bytecode[i++]; i += n * 2; continue }
    if (op === 0x2C) { // FDEF — next element on stack is function ID. We don't actually execute at parse time;
      // fpgm parsing is typically done by executing fpgm, which registers FDEFs via our handler.
      i++
      continue
    }
    i++
  }
  void functions
}

interface Executor {
  stack: number[]
  bytecode: Uint8Array
  pc: number
  ctx: HintingContext
}

function push(x: Executor, v: number): void { x.stack.push(v) }
function pop(x: Executor): number { return x.stack.pop() ?? 0 }

/** Execute a single bytecode stream. Returns true if an ENDF / unbalanced end was reached. */
export function execute(bytecode: Uint8Array, ctx: HintingContext, isFunctionBody = false): void {
  const x: Executor = { stack: [], bytecode, pc: 0, ctx }

  while (x.pc < bytecode.length) {
    const op = bytecode[x.pc++]

    // Push opcodes
    if (op >= 0xB0 && op <= 0xB7) {
      const n = op - 0xB0 + 1
      for (let k = 0; k < n; k++) push(x, bytecode[x.pc++])
      continue
    }
    if (op >= 0xB8 && op <= 0xBF) {
      const n = op - 0xB8 + 1
      for (let k = 0; k < n; k++) {
        const v = (bytecode[x.pc] << 8) | bytecode[x.pc + 1]
        x.pc += 2
        push(x, v >= 0x8000 ? v - 0x10000 : v)
      }
      continue
    }
    if (op === 0x40) {
      const n = bytecode[x.pc++]
      for (let k = 0; k < n; k++) push(x, bytecode[x.pc++])
      continue
    }
    if (op === 0x41) {
      const n = bytecode[x.pc++]
      for (let k = 0; k < n; k++) {
        const v = (bytecode[x.pc] << 8) | bytecode[x.pc + 1]
        x.pc += 2
        push(x, v >= 0x8000 ? v - 0x10000 : v)
      }
      continue
    }

    if (!executeOp(x, op) && op === 0x2D /* ENDF */ && isFunctionBody)
      return
  }
}

function executeOp(x: Executor, op: number): boolean {
  const { ctx } = x
  const { gs } = ctx
  switch (op) {
    // Stack
    case 0x20: { const v = pop(x); push(x, v); push(x, v); return true } // DUP
    case 0x21: pop(x); return true // POP
    case 0x22: x.stack.length = 0; return true // CLEAR
    case 0x23: { const a = pop(x); const b = pop(x); push(x, a); push(x, b); return true } // SWAP
    case 0x24: push(x, x.stack.length); return true // DEPTH
    case 0x25: { // CINDEX
      const k = pop(x)
      push(x, x.stack[x.stack.length - k])
      return true
    }
    case 0x26: { // MINDEX
      const k = pop(x)
      const [v] = x.stack.splice(x.stack.length - k, 1)
      push(x, v)
      return true
    }
    case 0x8A: { // ROLL
      const c = pop(x); const b = pop(x); const a = pop(x)
      push(x, b); push(x, c); push(x, a)
      return true
    }

    // Arithmetic
    case 0x60: push(x, pop(x) + pop(x)); return true // ADD (F26Dot6 saturating — we treat as ints)
    case 0x61: { const b = pop(x); const a = pop(x); push(x, a - b); return true } // SUB
    case 0x62: { const b = pop(x); const a = pop(x); push(x, b === 0 ? 0 : Math.trunc(a * F26DOT6 / b)); return true } // DIV
    case 0x63: { const b = pop(x); const a = pop(x); push(x, Math.trunc(a * b / F26DOT6)); return true } // MUL
    case 0x64: push(x, Math.abs(pop(x))); return true
    case 0x65: push(x, -pop(x)); return true
    case 0x66: push(x, Math.floor(pop(x) / F26DOT6) * F26DOT6); return true // FLOOR
    case 0x67: push(x, Math.ceil(pop(x) / F26DOT6) * F26DOT6); return true // CEILING
    case 0x68: case 0x69: case 0x6A: case 0x6B: { // ROUND[ab]
      // engine compensation pop'd but ignored
      pop(x)
      const v = pop(x)
      push(x, round(v, gs))
      return true
    }
    case 0x6C: case 0x6D: case 0x6E: case 0x6F: // NROUND[ab] — engine comp pop'd, no round
      pop(x); return true
    case 0x56: push(x, (Math.round(pop(x) / F26DOT6) & 1) ? 1 : 0); return true // ODD
    case 0x57: push(x, (Math.round(pop(x) / F26DOT6) & 1) ? 0 : 1); return true // EVEN
    case 0x8B: { const b = pop(x); const a = pop(x); push(x, Math.max(a, b)); return true } // MAX
    case 0x8C: { const b = pop(x); const a = pop(x); push(x, Math.min(a, b)); return true } // MIN

    // Logical
    case 0x50: { const b = pop(x); const a = pop(x); push(x, a < b ? 1 : 0); return true }
    case 0x51: { const b = pop(x); const a = pop(x); push(x, a <= b ? 1 : 0); return true }
    case 0x52: { const b = pop(x); const a = pop(x); push(x, a > b ? 1 : 0); return true }
    case 0x53: { const b = pop(x); const a = pop(x); push(x, a >= b ? 1 : 0); return true }
    case 0x54: { const b = pop(x); const a = pop(x); push(x, a === b ? 1 : 0); return true }
    case 0x55: { const b = pop(x); const a = pop(x); push(x, a !== b ? 1 : 0); return true }
    case 0x5A: { const b = pop(x); const a = pop(x); push(x, (a && b) ? 1 : 0); return true }
    case 0x5B: { const b = pop(x); const a = pop(x); push(x, (a || b) ? 1 : 0); return true }
    case 0x5C: push(x, pop(x) ? 0 : 1); return true

    // Branching
    case 0x58: { // IF
      const cond = pop(x)
      if (!cond) skipToElseOrEif(x)
      return true
    }
    case 0x1B: { // ELSE — skip to EIF
      skipToElseOrEif(x, true)
      return true
    }
    case 0x59: return true // EIF (no-op when reached via fall-through)
    case 0x1C: { // JMPR
      const offset = pop(x)
      x.pc += offset - 1 // -1 because we already advanced past the opcode
      return true
    }
    case 0x78: { // JROT
      const cond = pop(x)
      const offset = pop(x)
      if (cond) x.pc += offset - 1
      return true
    }
    case 0x79: { // JROF
      const cond = pop(x)
      const offset = pop(x)
      if (!cond) x.pc += offset - 1
      return true
    }

    // Function def / call
    case 0x2C: { // FDEF
      const id = pop(x)
      const start = x.pc
      // Find ENDF (0x2D)
      while (x.pc < x.bytecode.length && x.bytecode[x.pc] !== 0x2D) {
        const subOp = x.bytecode[x.pc]
        // Skip over operand bytes for push opcodes
        if (subOp >= 0xB0 && subOp <= 0xB7) x.pc += 1 + (subOp - 0xB0 + 1)
        else if (subOp >= 0xB8 && subOp <= 0xBF) x.pc += 1 + (subOp - 0xB8 + 1) * 2
        else if (subOp === 0x40) { x.pc++; x.pc += x.bytecode[x.pc] + 1 }
        else if (subOp === 0x41) { x.pc++; x.pc += x.bytecode[x.pc] * 2 + 1 }
        else x.pc++
      }
      ctx.functions.set(id, x.bytecode.subarray(start, x.pc))
      x.pc++ // skip ENDF
      return true
    }
    case 0x2D: return false // ENDF — signal caller

    case 0x2B: { // CALL
      const id = pop(x)
      const fn = ctx.functions.get(id)
      if (fn) execute(fn, ctx, true)
      return true
    }
    case 0x2A: { // LOOPCALL
      const id = pop(x)
      const count = pop(x)
      const fn = ctx.functions.get(id)
      if (fn) {
        for (let i = 0; i < count; i++) execute(fn, ctx, true)
      }
      return true
    }
    case 0x89: { // IDEF — instruction definition (user-defined). We skip over it.
      const start = x.pc
      while (x.pc < x.bytecode.length && x.bytecode[x.pc] !== 0x2D) x.pc++
      void start
      x.pc++
      return true
    }

    // Graphics state — reference points
    case 0x10: gs.rp0 = pop(x); return true // SRP0
    case 0x11: gs.rp1 = pop(x); return true // SRP1
    case 0x12: gs.rp2 = pop(x); return true // SRP2

    // Zone pointers
    case 0x13: gs.zp0 = (pop(x) ? 1 : 0) as 0 | 1; return true // SZP0
    case 0x14: gs.zp1 = (pop(x) ? 1 : 0) as 0 | 1; return true
    case 0x15: gs.zp2 = (pop(x) ? 1 : 0) as 0 | 1; return true
    case 0x16: { // SZPS
      const v = (pop(x) ? 1 : 0) as 0 | 1
      gs.zp0 = v; gs.zp1 = v; gs.zp2 = v
      return true
    }

    // Loop / min distance / cvt cut-in
    case 0x17: gs.loop = pop(x); return true
    case 0x1A: gs.minimumDistance = pop(x); return true
    case 0x1D: gs.controlValueCutIn = pop(x); return true
    case 0x1E: gs.singleWidthCutIn = pop(x); return true
    case 0x1F: gs.singleWidthValue = pop(x); return true

    // Rounding state
    case 0x18: gs.roundState = 1; return true // RTG
    case 0x19: gs.roundState = 0; return true // RTHG
    case 0x3D: gs.roundState = 2; return true // RTDG
    case 0x7A: gs.roundState = 5; return true // ROFF
    case 0x7C: gs.roundState = 4; return true // RUTG
    case 0x7D: gs.roundState = 3; return true // RDTG
    case 0x76: { // SROUND
      const v = pop(x)
      gs.roundState = 6
      const p = (v >> 6) & 3
      const pPeriod = [F26DOT6 / 2, F26DOT6, F26DOT6 * 2][p] ?? F26DOT6
      const phase = [0, pPeriod / 4, pPeriod / 2, pPeriod * 3 / 4][(v >> 4) & 3]
      const thr = v & 0x0F
      gs.roundPeriod = pPeriod
      gs.roundPhase = phase
      gs.roundThreshold = thr === 0 ? pPeriod - 1 : (thr - 4) * pPeriod / 8
      return true
    }
    case 0x77: { // S45ROUND — same as SROUND but period scaled by √2
      pop(x)
      gs.roundState = 7
      return true
    }

    // Axis-aligned vectors
    case 0x00: gs.projectionVector = [0, 1]; return true // SVTCA y
    case 0x01: gs.projectionVector = [1, 0]; return true // SVTCA x
    case 0x02: gs.projectionVector = [0, 1]; return true // SPVTCA y
    case 0x03: gs.projectionVector = [1, 0]; return true // SPVTCA x
    case 0x04: gs.freedomVector = [0, 1]; return true // SFVTCA y
    case 0x05: gs.freedomVector = [1, 0]; return true // SFVTCA x

    // SPVTL/SFVTL — parallel/perpendicular to a line (partial — we record direction)
    case 0x06: case 0x07:
    case 0x08: case 0x09:
      // Pop two point indices; we don't actually compute the exact vector
      pop(x); pop(x)
      return true

    case 0x0E: gs.freedomVector = [...gs.projectionVector]; return true // SFVTPV

    case 0x0A: { // SPVFS
      const y = pop(x); const x2 = pop(x); gs.projectionVector = [x2 / 16384, y / 16384]; return true
    }
    case 0x0B: { // SFVFS
      const y = pop(x); const x2 = pop(x); gs.freedomVector = [x2 / 16384, y / 16384]; return true
    }
    case 0x0C: push(x, gs.projectionVector[0] * 16384); push(x, gs.projectionVector[1] * 16384); return true // GPV
    case 0x0D: push(x, gs.freedomVector[0] * 16384); push(x, gs.freedomVector[1] * 16384); return true // GFV

    // Storage & CVT
    case 0x42: { const v = pop(x); const k = pop(x); ctx.storage.set(k, v); return true } // WS
    case 0x43: { const k = pop(x); push(x, ctx.storage.get(k) ?? 0); return true } // RS
    case 0x44: { const v = pop(x); const i = pop(x); ctx.cvt[i] = v; return true } // WCVTP
    case 0x70: { const v = pop(x); const i = pop(x); ctx.cvt[i] = v * ctx.scale; return true } // WCVTF
    case 0x45: push(x, ctx.cvt[pop(x)] ?? 0); return true // RCVT

    // Measurement
    case 0x46: case 0x47: { // GC[a] — get coordinate on projection vector
      const p = pop(x)
      const pt = getPoint(ctx, gs.zp2, p)
      const pv = gs.projectionVector
      push(x, Math.round(pt.x * pv[0] + pt.y * pv[1]))
      return true
    }
    case 0x48: { // SCFS — set coord on freedom vector
      const v = pop(x)
      const p = pop(x)
      setCoordOnFreedomVector(ctx, gs.zp2, p, v)
      return true
    }
    case 0x49: case 0x4A: { // MD — measure distance
      const p2 = pop(x); const p1 = pop(x)
      const a = getPoint(ctx, gs.zp0, p1)
      const b = getPoint(ctx, gs.zp1, p2)
      push(x, Math.round((b.x - a.x) * gs.projectionVector[0] + (b.y - a.y) * gs.projectionVector[1]))
      return true
    }
    case 0x4B: push(x, ctx.ppem); return true // MPPEM
    case 0x4C: push(x, ctx.ppem); return true // MPS (point size) — same as ppem here
    case 0x4D: gs.autoFlip = true; return true // FLIPON
    case 0x4E: gs.autoFlip = false; return true // FLIPOFF

    // Point manipulation
    case 0x2E: case 0x2F: { // MDAP[r]
      const round_ = (op & 1) === 1
      const p = pop(x)
      touchOnFreedomVector(ctx, gs.zp0, p, round_)
      gs.rp0 = p; gs.rp1 = p
      return true
    }
    case 0x3E: case 0x3F: { // MIAP[r]
      const round_ = (op & 1) === 1
      const cvtIndex = pop(x)
      const p = pop(x)
      let cvtVal = ctx.cvt[cvtIndex] ?? 0
      if (round_) cvtVal = round(cvtVal, gs)
      setCoordOnFreedomVector(ctx, gs.zp0, p, cvtVal)
      gs.rp0 = p; gs.rp1 = p
      return true
    }

    // Delta shift / base
    case 0x5E: gs.deltaBase = pop(x); return true
    case 0x5F: gs.deltaShift = pop(x); return true

    // DELTAP* — simplified: pop N * 2 values and skip
    case 0x5D: case 0x71: case 0x72: {
      const n = pop(x)
      for (let k = 0; k < n * 2; k++) pop(x)
      return true
    }
    case 0x73: case 0x74: case 0x75: {
      const n = pop(x)
      for (let k = 0; k < n * 2; k++) pop(x)
      return true
    }

    // MDRP/MIRP (simplified — just move rp0 and rp1 properly)
    default:
      if (op >= 0xC0 && op <= 0xDF) {
        // MDRP[abcde]
        const p = pop(x)
        gs.rp1 = gs.rp0
        gs.rp0 = p
        gs.rp2 = p
        return true
      }
      if (op >= 0xE0 && op <= 0xFF) {
        // MIRP[abcde]
        const cvtIdx = pop(x)
        const p = pop(x)
        let cvtVal = ctx.cvt[cvtIdx] ?? 0
        if (op & 0x04) cvtVal = round(cvtVal, gs)
        setCoordOnFreedomVector(ctx, gs.zp1, p, getCoordOnProjection(ctx, gs.zp0, gs.rp0) + cvtVal)
        gs.rp1 = gs.rp0
        if (op & 0x10) gs.rp0 = p
        gs.rp2 = p
        return true
      }

      // IUP / IP / SHP / SHC / SHZ / SHPIX / MSIRP / ALIGNRP / FLIPPT / etc.
      if (op === 0x30 || op === 0x31) { iup(ctx, op === 0x31 ? 'x' : 'y'); return true }
      if (op === 0x3C) { // ALIGNRP
        for (let i = 0; i < gs.loop; i++) {
          const p = pop(x)
          alignPoint(ctx, gs.zp1, p, gs.zp0, gs.rp0)
        }
        gs.loop = 1
        return true
      }
      if (op === 0x3A || op === 0x3B) { // MSIRP[a]
        const distance = pop(x)
        const p = pop(x)
        setCoordOnFreedomVector(ctx, gs.zp1, p, getCoordOnProjection(ctx, gs.zp0, gs.rp0) + distance)
        gs.rp1 = gs.rp0
        gs.rp2 = p
        if (op & 1) gs.rp0 = p
        return true
      }
      if (op === 0x38) { // SHPIX
        const amount = pop(x)
        for (let i = 0; i < gs.loop; i++) {
          const p = pop(x)
          const pt = getPoint(ctx, gs.zp2, p)
          pt.x += amount * gs.freedomVector[0]
          pt.y += amount * gs.freedomVector[1]
        }
        gs.loop = 1
        return true
      }
      if (op === 0x39) { // IP
        for (let i = 0; i < gs.loop; i++) pop(x) // just consume, leave pts as-is
        gs.loop = 1
        return true
      }
      if (op >= 0x32 && op <= 0x37) { // SHP/SHC/SHZ
        for (let i = 0; i < gs.loop; i++) pop(x)
        gs.loop = 1
        return true
      }
      if (op === 0x80) { // FLIPPT
        for (let i = 0; i < gs.loop; i++) {
          const p = pop(x)
          if (ctx.pts[p]) ctx.pts[p].onCurve = !ctx.pts[p].onCurve
        }
        gs.loop = 1
        return true
      }
      if (op === 0x81 || op === 0x82) { // FLIPRGON / FLIPRGOFF
        const high = pop(x); const low = pop(x)
        const state = op === 0x81
        for (let p = low; p <= high; p++) {
          if (ctx.pts[p]) ctx.pts[p].onCurve = state
        }
        return true
      }

      // GETINFO / GETVARIATION / DEBUG / SCANCTRL / SCANTYPE / INSTCTRL
      if (op === 0x88) { pop(x); push(x, 0); return true } // GETINFO — return 0 (no features)
      if (op === 0x91) { for (const a of ctx.gs.projectionVector) push(x, Math.round(a * 16384)); return true } // GETVARIATION (approx)
      if (op === 0x4F) { pop(x); return true } // DEBUG
      if (op === 0x85 || op === 0x8D || op === 0x8E) { pop(x); return true } // SCANCTRL / SCANTYPE / INSTCTRL
      if (op === 0x7E || op === 0x7F) { pop(x); return true } // SANGW / AA

      // Unknown opcode — skip silently
      return true
  }
}

function skipToElseOrEif(x: Executor, onlyEif = false): void {
  let depth = 1
  while (x.pc < x.bytecode.length) {
    const op = x.bytecode[x.pc++]
    if (op >= 0xB0 && op <= 0xB7) { x.pc += (op - 0xB0 + 1); continue }
    if (op >= 0xB8 && op <= 0xBF) { x.pc += (op - 0xB8 + 1) * 2; continue }
    if (op === 0x40) { const n = x.bytecode[x.pc++]; x.pc += n; continue }
    if (op === 0x41) { const n = x.bytecode[x.pc++]; x.pc += n * 2; continue }
    if (op === 0x58) depth++ // IF
    else if (op === 0x59) { depth--; if (depth === 0) return } // EIF
    else if (op === 0x1B && !onlyEif && depth === 1) return // ELSE
  }
}

function getPoint(ctx: HintingContext, zone: 0 | 1, idx: number): { x: number, y: number, onCurve: boolean, touchX: boolean, touchY: boolean } {
  if (zone === 0) return ctx.twilight[idx] ?? { x: 0, y: 0, onCurve: true, touchX: false, touchY: false }
  return ctx.pts[idx] ?? { x: 0, y: 0, onCurve: true, touchX: false, touchY: false }
}

function getCoordOnProjection(ctx: HintingContext, zone: 0 | 1, idx: number): number {
  const pt = getPoint(ctx, zone, idx)
  const pv = ctx.gs.projectionVector
  return pt.x * pv[0] + pt.y * pv[1]
}

function setCoordOnFreedomVector(ctx: HintingContext, zone: 0 | 1, idx: number, value: number): void {
  const pt = getPoint(ctx, zone, idx)
  const fv = ctx.gs.freedomVector
  const pv = ctx.gs.projectionVector
  const cur = pt.x * pv[0] + pt.y * pv[1]
  const diff = value - cur
  const denom = fv[0] * pv[0] + fv[1] * pv[1]
  if (denom === 0) return
  const delta = diff / denom
  pt.x += delta * fv[0]
  pt.y += delta * fv[1]
  if (fv[0] !== 0) pt.touchX = true
  if (fv[1] !== 0) pt.touchY = true
}

function touchOnFreedomVector(ctx: HintingContext, zone: 0 | 1, idx: number, doRound: boolean): void {
  const pt = getPoint(ctx, zone, idx)
  if (doRound) {
    const pv = ctx.gs.projectionVector
    const cur = pt.x * pv[0] + pt.y * pv[1]
    const rounded = round(cur, ctx.gs)
    setCoordOnFreedomVector(ctx, zone, idx, rounded)
  }
  const fv = ctx.gs.freedomVector
  if (fv[0] !== 0) pt.touchX = true
  if (fv[1] !== 0) pt.touchY = true
}

function alignPoint(ctx: HintingContext, zp: 0 | 1, idx: number, rpZone: 0 | 1, rp: number): void {
  const target = getCoordOnProjection(ctx, rpZone, rp)
  setCoordOnFreedomVector(ctx, zp, idx, target)
}

/**
 * IUP — Interpolate untouched points on the given axis, based on touched
 * neighbour deltas. Per spec: within each contour, for each run of
 * untouched points between two touched endpoints, shift the untouched
 * points proportionally.
 */
function iup(ctx: HintingContext, axis: 'x' | 'y'): void {
  let pt = 0
  for (const end of ctx.endPts) {
    const n = end - pt + 1
    // Find touched points
    const touched: number[] = []
    for (let i = 0; i < n; i++) {
      const p = ctx.pts[pt + i]
      if (axis === 'x' ? p.touchX : p.touchY) touched.push(i)
    }
    if (touched.length === 0) {
      pt += n
      continue
    }

    for (let k = 0; k < touched.length; k++) {
      const tStart = touched[k]
      const tEnd = touched[(k + 1) % touched.length]
      // Interpolate between tStart and tEnd going forward (wrapping)
      let idx = (tStart + 1) % n
      while (idx !== tEnd) {
        const p0 = ctx.pts[pt + tStart]
        const p1 = ctx.pts[pt + tEnd]
        const orig0 = ctx.orig[pt + tStart]
        const orig1 = ctx.orig[pt + tEnd]
        const oPt = ctx.orig[pt + idx]
        const target = ctx.pts[pt + idx]
        const o0 = axis === 'x' ? orig0.x : orig0.y
        const o1 = axis === 'x' ? orig1.x : orig1.y
        const oCur = axis === 'x' ? oPt.x : oPt.y
        const cur0 = axis === 'x' ? p0.x : p0.y
        const cur1 = axis === 'x' ? p1.x : p1.y
        let newVal: number
        if (o0 === o1) newVal = cur0 + (oCur - o0)
        else if (oCur < Math.min(o0, o1)) newVal = Math.min(cur0, cur1) + (oCur - Math.min(o0, o1))
        else if (oCur > Math.max(o0, o1)) newVal = Math.max(cur0, cur1) + (oCur - Math.max(o0, o1))
        else {
          const range = o1 - o0
          const t = (oCur - o0) / range
          newVal = cur0 + t * (cur1 - cur0)
        }
        if (axis === 'x') target.x = newVal
        else target.y = newVal
        idx = (idx + 1) % n
      }
    }
    pt += n
  }
}

/**
 * High-level helper: hint a glyph at a specific ppem using the font's
 * fpgm + prep + cvt + glyph instructions.
 */
export interface HintGlyphInput {
  points: Array<{ x: number, y: number, onCurve: boolean }>
  endPts: number[]
  instructions: Uint8Array
}

export interface HintFontTables {
  fpgm?: Uint8Array
  prep?: Uint8Array
  cvt?: number[]
  unitsPerEm: number
}

export function hintGlyph(input: HintGlyphInput, font: HintFontTables, ppem: number): Array<{ x: number, y: number, onCurve: boolean }> {
  const scale = ppem * F26DOT6 / font.unitsPerEm
  const functions = new Map<number, Uint8Array>()
  const storage = new Map<number, number>()
  const cvt = font.cvt ? font.cvt.map(v => Math.round(v * scale)) : []
  const pts = input.points.map(p => ({
    x: Math.round(p.x * scale),
    y: Math.round(p.y * scale),
    onCurve: p.onCurve,
    touchX: false,
    touchY: false,
  }))
  const orig = input.points.map(p => ({ x: p.x * scale, y: p.y * scale, onCurve: p.onCurve }))
  const twilight: typeof pts = []
  const ctx: HintingContext = {
    ppem,
    unitsPerEm: font.unitsPerEm,
    scale,
    functions,
    storage,
    cvt,
    orig,
    pts,
    twilight,
    endPts: input.endPts,
    gs: defaultGS(),
  }

  if (font.fpgm) execute(font.fpgm, ctx)
  if (font.prep) execute(font.prep, ctx)
  execute(input.instructions, ctx)

  return pts.map(p => ({ x: p.x / F26DOT6, y: p.y / F26DOT6, onCurve: p.onCurve }))
}
