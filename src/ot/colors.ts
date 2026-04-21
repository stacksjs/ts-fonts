/**
 * Color conversion helpers for CPAL (BGRA Uint32) ↔ CSS-like strings.
 */

export type ColorFormat = 'hexa' | 'hex' | 'rgba' | 'rgb' | 'hsl' | 'hsla' | 'bgra' | 'raw'
export type BGRA = { r: number, g: number, b: number, a: number }
export type ColorValue = number | string | BGRA | [number, number, number, number?]

/** CPAL stores one color as BBGGRRAA (little-endian UInt32). */
export function bgraToObject(packed: number): BGRA {
  return {
    b: packed & 0xFF,
    g: (packed >>> 8) & 0xFF,
    r: (packed >>> 16) & 0xFF,
    a: (packed >>> 24) & 0xFF,
  }
}

export function objectToBgra({ r, g, b, a }: BGRA): number {
  return (((a & 0xFF) << 24) | ((r & 0xFF) << 16) | ((g & 0xFF) << 8) | (b & 0xFF)) >>> 0
}

export function formatColor(packed: number, format: ColorFormat = 'hexa'): string | number | BGRA {
  if (format === 'raw') return packed
  const { r, g, b, a } = bgraToObject(packed)
  if (format === 'bgra') return { r, g, b, a }
  const alphaFloat = a / 255
  if (format === 'rgba') return `rgba(${r},${g},${b},${alphaFloat})`
  if (format === 'rgb') return `rgb(${r},${g},${b})`
  if (format === 'hex') return `#${[r, g, b].map(v => v.toString(16).padStart(2, '0')).join('')}`
  if (format === 'hexa') return `#${[r, g, b, a].map(v => v.toString(16).padStart(2, '0')).join('')}`
  if (format === 'hsl' || format === 'hsla') {
    const { h, s, l } = rgbToHsl(r, g, b)
    if (format === 'hsl') return `hsl(${h},${s}%,${l}%)`
    return `hsla(${h},${s}%,${l}%,${alphaFloat})`
  }
  return packed
}

export function parseColor(input: ColorValue): number {
  if (typeof input === 'number') return input >>> 0
  if (Array.isArray(input)) {
    const [r, g, b, a = 255] = input
    return objectToBgra({ r, g, b, a })
  }
  if (typeof input === 'object' && input && 'r' in input)
    return objectToBgra(input as BGRA)

  const str = (input as string).trim()
  // #rgb / #rgba / #rrggbb / #rrggbbaa
  const hex = /^#([0-9a-fA-F]+)$/.exec(str)
  if (hex) {
    const h = hex[1]
    const expand = (v: string): number => Number.parseInt(v.length === 1 ? v + v : v, 16)
    if (h.length === 3) return objectToBgra({ r: expand(h[0]), g: expand(h[1]), b: expand(h[2]), a: 255 })
    if (h.length === 4) return objectToBgra({ r: expand(h[0]), g: expand(h[1]), b: expand(h[2]), a: expand(h[3]) })
    if (h.length === 6) return objectToBgra({ r: Number.parseInt(h.slice(0, 2), 16), g: Number.parseInt(h.slice(2, 4), 16), b: Number.parseInt(h.slice(4, 6), 16), a: 255 })
    if (h.length === 8) return objectToBgra({ r: Number.parseInt(h.slice(0, 2), 16), g: Number.parseInt(h.slice(2, 4), 16), b: Number.parseInt(h.slice(4, 6), 16), a: Number.parseInt(h.slice(6, 8), 16) })
  }
  // rgb() / rgba()
  const rgb = /^rgba?\(([^)]+)\)$/.exec(str)
  if (rgb) {
    const parts = rgb[1].split(',').map(s => s.trim())
    const r = Number.parseInt(parts[0], 10)
    const g = Number.parseInt(parts[1], 10)
    const b = Number.parseInt(parts[2], 10)
    const a = parts.length === 4 ? Math.round(Number.parseFloat(parts[3]) * 255) : 255
    return objectToBgra({ r, g, b, a })
  }
  throw new Error(`Unsupported color value: ${str}`)
}

function rgbToHsl(r: number, g: number, b: number): { h: number, s: number, l: number } {
  r /= 255; g /= 255; b /= 255
  const max = Math.max(r, g, b), min = Math.min(r, g, b)
  const l = (max + min) / 2
  let h = 0, s = 0
  if (max !== min) {
    const d = max - min
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
    switch (max) {
      case r: h = ((g - b) / d + (g < b ? 6 : 0)); break
      case g: h = ((b - r) / d + 2); break
      case b: h = ((r - g) / d + 4); break
    }
    h *= 60
  }
  return { h: Math.round(h), s: Math.round(s * 100), l: Math.round(l * 100) }
}
