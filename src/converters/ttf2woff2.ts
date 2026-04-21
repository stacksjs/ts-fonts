import { woff2 } from '../woff2'

export function ttf2woff2(ttfBuffer: ArrayBuffer | Uint8Array): Uint8Array {
  return woff2.encode(ttfBuffer as ArrayBuffer)
}

export function woff22ttf(woff2Buffer: ArrayBuffer | Uint8Array): Uint8Array {
  return woff2.decode(woff2Buffer as ArrayBuffer)
}
