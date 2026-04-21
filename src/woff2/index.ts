/**
 * woff2 wasm bridge.
 *
 * WOFF2 uses Brotli compression and an ecosystem of transforms (glyf/gvar)
 * that realistically requires a WASM port of Google's woff2 library to
 * implement correctly. This module provides the same async init/encode/decode
 * surface as fonteditor-core's woff2 module, and will transparently use a
 * wasm module you load via `init()`. If you prefer to not depend on WASM,
 * provide your own encoder/decoder via `setEncoder`/`setDecoder`.
 */

type Bytes = ArrayBuffer | Uint8Array | Buffer | number[]

function toUint8Array(input: Bytes): Uint8Array {
  if (input instanceof Uint8Array) return input
  if (input instanceof ArrayBuffer) return new Uint8Array(input)
  if (Array.isArray(input)) return new Uint8Array(input)
  return new Uint8Array(input as ArrayBuffer)
}

interface Woff2Exports {
  _malloc?: (n: number) => number
  _free?: (p: number) => void
  _convert_ttf_to_woff2?: (inPtr: number, inLen: number, outPtr: number, outLenPtr: number) => number
  _convert_woff2_to_ttf?: (inPtr: number, inLen: number, outPtr: number, outLenPtr: number) => number
  HEAPU8?: Uint8Array
}

interface Woff2Module {
  isInited: () => boolean
  init: (wasmUrl?: string | ArrayBuffer) => Promise<Woff2Module>
  encode: (ttfBuffer: Bytes) => Uint8Array
  decode: (woff2Buffer: Bytes) => Uint8Array
  setEncoder: (fn: (data: Uint8Array) => Uint8Array) => void
  setDecoder: (fn: (data: Uint8Array) => Uint8Array) => void
}

let inited = false
// eslint-disable-next-line pickier/no-unused-vars
let customEncoder: ((data: Uint8Array) => Uint8Array) | null = null
// eslint-disable-next-line pickier/no-unused-vars
let customDecoder: ((data: Uint8Array) => Uint8Array) | null = null
let wasmExports: Woff2Exports | null = null

export const woff2: Woff2Module = {
  isInited(): boolean {
    return inited
  },

  async init(wasmUrl?: string | ArrayBuffer): Promise<Woff2Module> {
    if (inited) return woff2
    if (wasmUrl) {
      try {
        let wasmBytes: ArrayBuffer
        if (typeof wasmUrl === 'string') {
          const res = await fetch(wasmUrl)
          wasmBytes = await res.arrayBuffer()
        }
        else {
          wasmBytes = wasmUrl
        }
        const { instance } = await WebAssembly.instantiate(wasmBytes, {
          env: {
            memory: new WebAssembly.Memory({ initial: 256 }),
            abort: () => { throw new Error('woff2 wasm abort') },
          },
        })
        wasmExports = instance.exports as unknown as Woff2Exports
      }
      catch (err) {
        throw new Error(`Failed to init woff2 wasm: ${(err as Error).message}`)
      }
    }
    inited = true
    return woff2
  },

  encode(ttfBuffer: Bytes): Uint8Array {
    const data = toUint8Array(ttfBuffer)
    if (customEncoder) return customEncoder(data)
    if (wasmExports?._convert_ttf_to_woff2)
      return callWasm(wasmExports, '_convert_ttf_to_woff2', data)
    throw new Error('woff2 encoder not available. Call woff2.init(wasmUrl) or provide woff2.setEncoder(fn).')
  },

  decode(woff2Buffer: Bytes): Uint8Array {
    const data = toUint8Array(woff2Buffer)
    if (customDecoder) return customDecoder(data)
    if (wasmExports?._convert_woff2_to_ttf)
      return callWasm(wasmExports, '_convert_woff2_to_ttf', data)
    throw new Error('woff2 decoder not available. Call woff2.init(wasmUrl) or provide woff2.setDecoder(fn).')
  },

  setEncoder(fn: (data: Uint8Array) => Uint8Array): void {
    customEncoder = fn
    inited = true
  },

  setDecoder(fn: (data: Uint8Array) => Uint8Array): void {
    customDecoder = fn
    inited = true
  },
}

function callWasm(exports: Woff2Exports, fnName: '_convert_ttf_to_woff2' | '_convert_woff2_to_ttf', data: Uint8Array): Uint8Array {
  const { _malloc, _free, HEAPU8 } = exports
  const fn = exports[fnName]
  if (!_malloc || !_free || !HEAPU8 || !fn)
    throw new Error(`woff2 wasm missing required exports (${fnName})`)

  const inPtr = _malloc(data.length)
  HEAPU8.set(data, inPtr)
  // Allocate generous output buffer
  const outLenPtr = _malloc(4)
  const outCap = Math.max(data.length * 2, 1024)
  const outPtr = _malloc(outCap)
  new DataView(HEAPU8.buffer).setUint32(outLenPtr, outCap, true)

  const status = fn(inPtr, data.length, outPtr, outLenPtr)
  if (status !== 1) {
    _free(inPtr); _free(outPtr); _free(outLenPtr)
    throw new Error('woff2 wasm conversion failed')
  }
  const outLen = new DataView(HEAPU8.buffer).getUint32(outLenPtr, true)
  const result = new Uint8Array(HEAPU8.buffer.slice(outPtr, outPtr + outLen))
  _free(inPtr); _free(outPtr); _free(outLenPtr)
  return result
}

export default woff2
