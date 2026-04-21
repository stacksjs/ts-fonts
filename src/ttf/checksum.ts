export function checkSum(buffer: ArrayBuffer, offset = 0, length?: number): number {
  const view = new DataView(buffer)
  const end = offset + (length ?? buffer.byteLength - offset)
  let sum = 0
  let i = offset
  const fullEnd = end - (end - offset) % 4
  for (; i < fullEnd; i += 4)
    sum = (sum + view.getUint32(i, false)) >>> 0

  // Handle trailing bytes (0-padded)
  if (i < end) {
    let tail = 0
    let shift = 24
    for (; i < end; i++, shift -= 8)
      tail |= (view.getUint8(i) << shift)
    sum = (sum + tail) >>> 0
  }

  return sum
}

export function pad4(n: number): number {
  return (4 - (n % 4)) % 4
}
