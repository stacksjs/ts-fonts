/**
 * TrueType instruction set helpers. We don't execute hinting bytecode
 * (that's a full stack VM — hundreds of opcodes), but we do preserve it
 * on round-trip and expose:
 *
 *   - disassemble(bytecode) — human-readable listing of instructions
 *   - countInstructions(bytecode) — static instruction count for maxp
 *   - validateInstructions(bytecode) — returns warnings for malformed/
 *     unknown opcodes or stray IF/EIF pairs
 */

export const TT_INSTRUCTIONS: Record<number, { name: string, args?: number }> = {
  0x00: { name: 'SVTCA[0]' },
  0x01: { name: 'SVTCA[1]' },
  0x02: { name: 'SPVTCA[0]' },
  0x03: { name: 'SPVTCA[1]' },
  0x04: { name: 'SFVTCA[0]' },
  0x05: { name: 'SFVTCA[1]' },
  0x06: { name: 'SPVTL[0]' },
  0x07: { name: 'SPVTL[1]' },
  0x08: { name: 'SFVTL[0]' },
  0x09: { name: 'SFVTL[1]' },
  0x0A: { name: 'SPVFS' },
  0x0B: { name: 'SFVFS' },
  0x0C: { name: 'GPV' },
  0x0D: { name: 'GFV' },
  0x0E: { name: 'SFVTPV' },
  0x0F: { name: 'ISECT' },
  0x10: { name: 'SRP0' },
  0x11: { name: 'SRP1' },
  0x12: { name: 'SRP2' },
  0x13: { name: 'SZP0' },
  0x14: { name: 'SZP1' },
  0x15: { name: 'SZP2' },
  0x16: { name: 'SZPS' },
  0x17: { name: 'SLOOP' },
  0x18: { name: 'RTG' },
  0x19: { name: 'RTHG' },
  0x1A: { name: 'SMD' },
  0x1B: { name: 'ELSE' },
  0x1C: { name: 'JMPR' },
  0x1D: { name: 'SCVTCI' },
  0x1E: { name: 'SSWCI' },
  0x1F: { name: 'SSW' },
  0x20: { name: 'DUP' },
  0x21: { name: 'POP' },
  0x22: { name: 'CLEAR' },
  0x23: { name: 'SWAP' },
  0x24: { name: 'DEPTH' },
  0x25: { name: 'CINDEX' },
  0x26: { name: 'MINDEX' },
  0x27: { name: 'ALIGNPTS' },
  0x29: { name: 'UTP' },
  0x2A: { name: 'LOOPCALL' },
  0x2B: { name: 'CALL' },
  0x2C: { name: 'FDEF' },
  0x2D: { name: 'ENDF' },
  0x2E: { name: 'MDAP[0]' },
  0x2F: { name: 'MDAP[1]' },
  0x30: { name: 'IUP[0]' },
  0x31: { name: 'IUP[1]' },
  0x32: { name: 'SHP[0]' },
  0x33: { name: 'SHP[1]' },
  0x34: { name: 'SHC[0]' },
  0x35: { name: 'SHC[1]' },
  0x36: { name: 'SHZ[0]' },
  0x37: { name: 'SHZ[1]' },
  0x38: { name: 'SHPIX' },
  0x39: { name: 'IP' },
  0x3A: { name: 'MSIRP[0]' },
  0x3B: { name: 'MSIRP[1]' },
  0x3C: { name: 'ALIGNRP' },
  0x3D: { name: 'RTDG' },
  0x3E: { name: 'MIAP[0]' },
  0x3F: { name: 'MIAP[1]' },
  0x40: { name: 'NPUSHB' }, // followed by N then N bytes
  0x41: { name: 'NPUSHW' }, // followed by N then 2N bytes
  0x42: { name: 'WS' },
  0x43: { name: 'RS' },
  0x44: { name: 'WCVTP' },
  0x45: { name: 'RCVT' },
  0x46: { name: 'GC[0]' },
  0x47: { name: 'GC[1]' },
  0x48: { name: 'SCFS' },
  0x49: { name: 'MD[0]' },
  0x4A: { name: 'MD[1]' },
  0x4B: { name: 'MPPEM' },
  0x4C: { name: 'MPS' },
  0x4D: { name: 'FLIPON' },
  0x4E: { name: 'FLIPOFF' },
  0x4F: { name: 'DEBUG' },
  0x50: { name: 'LT' },
  0x51: { name: 'LTEQ' },
  0x52: { name: 'GT' },
  0x53: { name: 'GTEQ' },
  0x54: { name: 'EQ' },
  0x55: { name: 'NEQ' },
  0x56: { name: 'ODD' },
  0x57: { name: 'EVEN' },
  0x58: { name: 'IF' },
  0x59: { name: 'EIF' },
  0x5A: { name: 'AND' },
  0x5B: { name: 'OR' },
  0x5C: { name: 'NOT' },
  0x5D: { name: 'DELTAP1' },
  0x5E: { name: 'SDB' },
  0x5F: { name: 'SDS' },
  0x60: { name: 'ADD' },
  0x61: { name: 'SUB' },
  0x62: { name: 'DIV' },
  0x63: { name: 'MUL' },
  0x64: { name: 'ABS' },
  0x65: { name: 'NEG' },
  0x66: { name: 'FLOOR' },
  0x67: { name: 'CEILING' },
  0x68: { name: 'ROUND[0]' },
  0x69: { name: 'ROUND[1]' },
  0x6A: { name: 'ROUND[2]' },
  0x6B: { name: 'ROUND[3]' },
  0x6C: { name: 'NROUND[0]' },
  0x6D: { name: 'NROUND[1]' },
  0x6E: { name: 'NROUND[2]' },
  0x6F: { name: 'NROUND[3]' },
  0x70: { name: 'WCVTF' },
  0x71: { name: 'DELTAP2' },
  0x72: { name: 'DELTAP3' },
  0x73: { name: 'DELTAC1' },
  0x74: { name: 'DELTAC2' },
  0x75: { name: 'DELTAC3' },
  0x76: { name: 'SROUND' },
  0x77: { name: 'S45ROUND' },
  0x78: { name: 'JROT' },
  0x79: { name: 'JROF' },
  0x7A: { name: 'ROFF' },
  0x7C: { name: 'RUTG' },
  0x7D: { name: 'RDTG' },
  0x7E: { name: 'SANGW' },
  0x7F: { name: 'AA' },
  0x80: { name: 'FLIPPT' },
  0x81: { name: 'FLIPRGON' },
  0x82: { name: 'FLIPRGOFF' },
  0x85: { name: 'SCANCTRL' },
  0x86: { name: 'SDPVTL[0]' },
  0x87: { name: 'SDPVTL[1]' },
  0x88: { name: 'GETINFO' },
  0x89: { name: 'IDEF' },
  0x8A: { name: 'ROLL' },
  0x8B: { name: 'MAX' },
  0x8C: { name: 'MIN' },
  0x8D: { name: 'SCANTYPE' },
  0x8E: { name: 'INSTCTRL' },
  0x8F: { name: 'ADJUST' },
}

/** Disassemble a chunk of TrueType instruction bytecode. */
export function disassemble(bytecode: number[] | Uint8Array): string[] {
  const out: string[] = []
  const bc = bytecode instanceof Uint8Array ? bytecode : new Uint8Array(bytecode)
  let i = 0
  while (i < bc.length) {
    const op = bc[i++]
    // PUSHB/PUSHW — opcodes 0xB0..0xB7 = PUSHB[1..8], 0xB8..0xBF = PUSHW[1..8]
    if (op >= 0xB0 && op <= 0xB7) {
      const n = op - 0xB0 + 1
      const args: number[] = []
      for (let j = 0; j < n; j++) args.push(bc[i++])
      out.push(`PUSHB[${n}] ${args.join(' ')}`)
      continue
    }
    if (op >= 0xB8 && op <= 0xBF) {
      const n = op - 0xB8 + 1
      const args: number[] = []
      for (let j = 0; j < n; j++) {
        const v = (bc[i] << 8) | bc[i + 1]
        i += 2
        args.push(v >= 0x8000 ? v - 0x10000 : v)
      }
      out.push(`PUSHW[${n}] ${args.join(' ')}`)
      continue
    }
    if (op === 0x40) {
      const n = bc[i++]
      const args: number[] = []
      for (let j = 0; j < n; j++) args.push(bc[i++])
      out.push(`NPUSHB ${n} ${args.join(' ')}`)
      continue
    }
    if (op === 0x41) {
      const n = bc[i++]
      const args: number[] = []
      for (let j = 0; j < n; j++) {
        const v = (bc[i] << 8) | bc[i + 1]
        i += 2
        args.push(v >= 0x8000 ? v - 0x10000 : v)
      }
      out.push(`NPUSHW ${n} ${args.join(' ')}`)
      continue
    }
    const def = TT_INSTRUCTIONS[op]
    out.push(def ? def.name : `UNKNOWN 0x${op.toString(16)}`)
  }
  return out
}

/** Count the number of instructions (not bytes) in a bytecode stream. */
export function countInstructions(bytecode: number[] | Uint8Array): number {
  return disassemble(bytecode).length
}

/** Simple bytecode validation — unknown opcodes + balanced IF/EIF + FDEF/ENDF. */
export function validateInstructions(bytecode: number[] | Uint8Array): string[] {
  const warnings: string[] = []
  const bc = bytecode instanceof Uint8Array ? bytecode : new Uint8Array(bytecode)
  let ifDepth = 0
  let fdefDepth = 0
  let i = 0
  while (i < bc.length) {
    const op = bc[i++]
    if (op >= 0xB0 && op <= 0xB7) { i += (op - 0xB0 + 1); continue }
    if (op >= 0xB8 && op <= 0xBF) { i += (op - 0xB8 + 1) * 2; continue }
    if (op === 0x40) { const n = bc[i++]; i += n; continue }
    if (op === 0x41) { const n = bc[i++]; i += n * 2; continue }
    if (op === 0x58) ifDepth++ // IF
    if (op === 0x59) ifDepth-- // EIF
    if (op === 0x2C) fdefDepth++ // FDEF
    if (op === 0x2D) fdefDepth-- // ENDF
    if (!TT_INSTRUCTIONS[op] && !(op >= 0xB0 && op <= 0xBF))
      warnings.push(`unknown opcode 0x${op.toString(16)} at byte ${i - 1}`)
  }
  if (ifDepth !== 0) warnings.push(`unbalanced IF/EIF (${ifDepth} open)`)
  if (fdefDepth !== 0) warnings.push(`unbalanced FDEF/ENDF (${fdefDepth} open)`)
  return warnings
}
