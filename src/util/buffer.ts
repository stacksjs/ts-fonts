export function toArrayBuffer(input: Uint8Array | number[] | ArrayBuffer): ArrayBuffer {
  if (input instanceof ArrayBuffer) return input
  if (input instanceof Uint8Array)
    return input.buffer.slice(input.byteOffset, input.byteOffset + input.byteLength) as ArrayBuffer
  return new Uint8Array(input).buffer as ArrayBuffer
}

export function toBuffer(input: ArrayBuffer | Uint8Array | number[]): Uint8Array {
  // Returns a Node Buffer when available, else Uint8Array
  const g = globalThis as unknown as { Buffer?: { from: (b: ArrayBuffer | Uint8Array | number[]) => Uint8Array } }
  if (g.Buffer) {
    if (input instanceof Uint8Array) return g.Buffer.from(input)
    if (input instanceof ArrayBuffer) return g.Buffer.from(input)
    return g.Buffer.from(input)
  }
  if (input instanceof Uint8Array) return input
  if (input instanceof ArrayBuffer) return new Uint8Array(input)
  return new Uint8Array(input)
}
