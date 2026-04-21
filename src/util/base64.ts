export function bytesToBase64(bytes: ArrayBuffer | Uint8Array | number[]): string {
  let view: Uint8Array
  if (bytes instanceof Uint8Array) view = bytes
  else if (bytes instanceof ArrayBuffer) view = new Uint8Array(bytes)
  else view = new Uint8Array(bytes)

  // Prefer Buffer in Node/Bun
  const g = globalThis as unknown as { Buffer?: { from: (b: Uint8Array) => { toString: (enc: string) => string } } }
  if (g.Buffer)
    return g.Buffer.from(view).toString('base64')

  let binary = ''
  for (let i = 0; i < view.byteLength; i++)
    binary += String.fromCharCode(view[i])
  // btoa available in browsers
  const globalWindow = globalThis as unknown as { btoa?: (s: string) => string }
  if (globalWindow.btoa)
    return globalWindow.btoa(binary)
  throw new Error('No base64 encoder available')
}

export function base64ToBytes(str: string): Uint8Array {
  const g = globalThis as unknown as { Buffer?: { from: (s: string, enc: string) => Uint8Array } }
  if (g.Buffer)
    return g.Buffer.from(str, 'base64')
  const globalWindow = globalThis as unknown as { atob?: (s: string) => string }
  if (globalWindow.atob) {
    const binary = globalWindow.atob(str)
    const out = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i++)
      out[i] = binary.charCodeAt(i)
    return out
  }
  throw new Error('No base64 decoder available')
}

export function ttf2base64(buffer: ArrayBuffer): string {
  return `data:font/ttf;charset=utf-8;base64,${bytesToBase64(buffer)}`
}

export function woff2base64(buffer: ArrayBuffer): string {
  return `data:font/woff;charset=utf-8;base64,${bytesToBase64(buffer)}`
}

export function woff22base64(buffer: ArrayBuffer | Uint8Array): string {
  return `data:font/woff2;charset=utf-8;base64,${bytesToBase64(buffer)}`
}

export function eot2base64(buffer: ArrayBuffer): string {
  return `data:application/vnd.ms-fontobject;charset=utf-8;base64,${bytesToBase64(buffer)}`
}

export function svg2base64(svg: string, mimeType = 'image/svg+xml'): string {
  const g = globalThis as unknown as { Buffer?: { from: (s: string) => { toString: (enc: string) => string } } }
  let b64: string
  if (g.Buffer)
    b64 = g.Buffer.from(svg).toString('base64')
  else if ((globalThis as unknown as { btoa?: (s: string) => string }).btoa)
    b64 = (globalThis as unknown as { btoa: (s: string) => string }).btoa(svg)
  else
    throw new Error('No base64 encoder available')
  return `data:${mimeType};charset=utf-8;base64,${b64}`
}
