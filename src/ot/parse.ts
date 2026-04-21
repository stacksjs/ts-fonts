import type { FontReadOptions } from '../types'
import { eot2ttf } from '../converters/eot2ttf'
import { otf2ttfobject } from '../converters/otf2ttfobject'
import { SFNT_VERSION_OTF, SFNT_VERSION_TTF, WOFF_SIGNATURE } from '../ttf/enum'
import { Font } from '../ttf/font'
import { extractTTCFont, isTTC, readTTCHeader } from '../ttf/ttc'

/**
 * opentype.js-compatible `parse(buffer, options?)` entry point.
 *
 * Accepts an ArrayBuffer (TTF/OTF/WOFF/EOT/TTC) and returns a Font.
 * Auto-detects the format by reading the SFNT signature.
 *
 * For a TTC (font collection), returns the first sub-font by default;
 * pass `{ ttcIndex: N }` to pick a different member, or use
 * `parseCollection(buffer)` to load every sub-font at once.
 */
export function parse(buffer: ArrayBuffer | Uint8Array, options: Partial<FontReadOptions> & { ttcIndex?: number } = {}): Font {
  const ab = buffer instanceof Uint8Array
    ? (buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) as ArrayBuffer)
    : buffer

  if (isTTC(ab)) {
    const info = readTTCHeader(ab)
    const idx = options.ttcIndex ?? 0
    if (idx < 0 || idx >= info.fontOffsets.length)
      throw new Error(`ttcIndex ${idx} out of range (font has ${info.fontOffsets.length} members)`)
    const subBuffer = extractTTCFont(ab, info.fontOffsets[idx])
    return parse(subBuffer, { ...options, ttcIndex: undefined })
  }

  const view = new DataView(ab)
  const sig = view.getUint32(0, false)

  if (sig === WOFF_SIGNATURE) {
    return new Font(ab, { type: 'woff', ...options })
  }
  if (sig === SFNT_VERSION_OTF) {
    const ttf = otf2ttfobject(ab, { subset: options.subset })
    return new Font(ttf)
  }
  if (sig === SFNT_VERSION_TTF) {
    return new Font(ab, { type: 'ttf', ...options })
  }
  try {
    const ttf = eot2ttf(ab)
    return new Font(ttf, { type: 'ttf', ...options })
  }
  catch {
    // fallthrough
  }
  throw new Error('Unsupported font format — must be TTF, OTF, WOFF, EOT, or TTC.')
}

/**
 * Parse a TTC buffer and return every sub-font as a Font.
 * Returns a single-element array for a non-TTC buffer.
 */
export function parseCollection(buffer: ArrayBuffer | Uint8Array, options: Partial<FontReadOptions> = {}): Font[] {
  const ab = buffer instanceof Uint8Array
    ? (buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) as ArrayBuffer)
    : buffer
  if (!isTTC(ab)) return [parse(ab, options)]
  const info = readTTCHeader(ab)
  return info.fontOffsets.map(off => parse(extractTTCFont(ab, off), options))
}

/**
 * Asynchronous load from a URL or a filesystem path. Mirrors the
 * opentype.js signature — a Promise-returning helper.
 */
export async function load(urlOrPath: string, options: Partial<FontReadOptions> & { ttcIndex?: number } = {}): Promise<Font> {
  if (typeof urlOrPath === 'string' && /^https?:/.test(urlOrPath)) {
    const res = await fetch(urlOrPath)
    const buf = await res.arrayBuffer()
    return parse(buf, options)
  }
  const g = globalThis as unknown as { process?: unknown }
  if (g.process) {
    const { readFile } = await import('node:fs/promises')
    const buf = await readFile(urlOrPath)
    const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer
    return parse(ab, options)
  }
  throw new Error(`Cannot load ${urlOrPath} — no fetch or filesystem available.`)
}

/** Async version of parseCollection — fetches/reads the file, then parses. */
export async function loadCollection(urlOrPath: string, options: Partial<FontReadOptions> = {}): Promise<Font[]> {
  if (typeof urlOrPath === 'string' && /^https?:/.test(urlOrPath)) {
    const res = await fetch(urlOrPath)
    const buf = await res.arrayBuffer()
    return parseCollection(buf, options)
  }
  const g = globalThis as unknown as { process?: unknown }
  if (g.process) {
    const { readFile } = await import('node:fs/promises')
    const buf = await readFile(urlOrPath)
    const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer
    return parseCollection(ab, options)
  }
  throw new Error(`Cannot load ${urlOrPath} — no fetch or filesystem available.`)
}
