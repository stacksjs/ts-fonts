import { Reader } from '../io/reader'

export interface CffIndex {
  count: number
  objects: Uint8Array[]
  endOffset: number
}

/**
 * Parse a CFF INDEX structure.
 * Returns the parsed objects as raw Uint8Array slices plus the absolute
 * byte offset immediately following the INDEX (useful for sequential reads).
 */
export function readIndex(buffer: ArrayBuffer, offset: number): CffIndex {
  const view = new DataView(buffer)
  const count = view.getUint16(offset, false)
  if (count === 0)
    return { count: 0, objects: [], endOffset: offset + 2 }

  const offSize = view.getUint8(offset + 2)
  const offsetsStart = offset + 3
  const offsets: number[] = []
  for (let i = 0; i <= count; i++) {
    let v = 0
    for (let b = 0; b < offSize; b++)
      v = (v << 8) | view.getUint8(offsetsStart + i * offSize + b)
    offsets.push(v)
  }
  const dataStart = offsetsStart + (count + 1) * offSize - 1 // offsets are 1-based relative to data
  const objects: Uint8Array[] = []
  for (let i = 0; i < count; i++) {
    const start = dataStart + offsets[i]
    const end = dataStart + offsets[i + 1]
    objects.push(new Uint8Array(buffer, start, end - start))
  }
  const endOffset = dataStart + offsets[count]
  return { count, objects, endOffset }
}

export type DictOperand = number
export type DictEntry = [operator: number, operands: DictOperand[]]

/**
 * Parse a CFF DICT.
 * Returns a keyed object where the key is the operator (2-byte operators
 * are encoded as 1200 + byte).
 */
export function readDict(bytes: Uint8Array): Record<number, DictOperand[]> {
  const result: Record<number, DictOperand[]> = {}
  const operands: DictOperand[] = []
  let i = 0
  while (i < bytes.length) {
    const b = bytes[i]
    if (b <= 21) {
      let op = b
      if (b === 12) {
        i++
        op = 1200 + bytes[i]
      }
      result[op] = operands.slice()
      operands.length = 0
      i++
    }
    else {
      const { value, next } = readOperand(bytes, i)
      operands.push(value)
      i = next
    }
  }
  return result
}

function readOperand(bytes: Uint8Array, i: number): { value: number, next: number } {
  const b = bytes[i]
  if (b >= 32 && b <= 246)
    return { value: b - 139, next: i + 1 }
  if (b >= 247 && b <= 250)
    return { value: (b - 247) * 256 + bytes[i + 1] + 108, next: i + 2 }
  if (b >= 251 && b <= 254)
    return { value: -(b - 251) * 256 - bytes[i + 1] - 108, next: i + 2 }
  if (b === 28) {
    // int16
    const v = (bytes[i + 1] << 8) | bytes[i + 2]
    return { value: v >= 0x8000 ? v - 0x10000 : v, next: i + 3 }
  }
  if (b === 29) {
    // int32
    const v = (bytes[i + 1] << 24) | (bytes[i + 2] << 16) | (bytes[i + 3] << 8) | bytes[i + 4]
    return { value: v | 0, next: i + 5 }
  }
  if (b === 30) {
    // Real number (BCD)
    let str = ''
    let j = i + 1
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const byte = bytes[j++]
      const n1 = (byte >> 4) & 0x0F
      const n2 = byte & 0x0F
      const append = (n: number): boolean => {
        if (n < 10) str += n
        else if (n === 10) str += '.'
        else if (n === 11) str += 'E'
        else if (n === 12) str += 'E-'
        else if (n === 14) str += '-'
        else if (n === 15) return true
        return false
      }
      if (append(n1)) break
      if (append(n2)) break
    }
    return { value: Number.parseFloat(str), next: j }
  }
  // Unknown / reserved — skip
  return { value: 0, next: i + 1 }
}

export function calcSubroutineBias(count: number): number {
  if (count < 1240) return 107
  if (count < 33900) return 1131
  return 32768
}

/** Reader-based INDEX parser (alternative form that uses the internal Reader). */
export function readIndexWithReader(reader: Reader, offset: number): CffIndex {
  return readIndex(reader.view.buffer as ArrayBuffer, offset)
}
