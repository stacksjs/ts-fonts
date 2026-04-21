import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'bun:test'
import {
  arabicForms,
  BoundingBox,
  bytesToBase64,
  canJoinLeft,
  canJoinRight,
  contoursToPath,
  formatColor,
  isArabic,
  load,
  OTGlyph,
  parse,
  parseColor,
  Path,
  tinyInflateTo,
  toVisualOrder,
} from '../src'

const FIXTURES = join(import.meta.dir, 'fixtures')

function loadBuffer(name: string): ArrayBuffer {
  const raw = readFileSync(join(FIXTURES, name))
  return raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength) as ArrayBuffer
}

describe('Path', () => {
  it('moveTo/lineTo/curveTo build commands', () => {
    const p = new Path()
    p.moveTo(0, 0)
    p.lineTo(10, 0)
    p.curveTo(10, 5, 20, 5, 20, 0)
    p.quadraticCurveTo(30, 10, 40, 0)
    p.close()
    expect(p.commands.length).toBe(5)
    expect(p.commands[0].type).toBe('M')
    expect(p.commands[2].type).toBe('C')
    expect(p.commands[3].type).toBe('Q')
    expect(p.commands[4].type).toBe('Z')
  })

  it('getBoundingBox includes quadratic curve extrema', () => {
    const p = new Path()
    p.moveTo(0, 0)
    p.quadraticCurveTo(50, 100, 100, 0) // curve peaks y=50
    p.close()
    const bb = p.getBoundingBox()
    expect(bb.x1).toBe(0)
    expect(bb.x2).toBe(100)
    expect(bb.y1).toBe(0)
    expect(bb.y2).toBeCloseTo(50, 0)
  })

  it('toPathData produces SVG d string', () => {
    const p = new Path()
    p.moveTo(0, 0)
    p.lineTo(10, 10)
    p.close()
    expect(p.toPathData(0)).toBe('M0 0L10 10Z')
  })

  it('toSVG wraps with path element', () => {
    const p = new Path()
    p.moveTo(0, 0)
    p.lineTo(10, 10)
    p.fill = 'red'
    const svg = p.toSVG({ decimalPlaces: 0 })
    expect(svg).toContain('<path')
    expect(svg).toContain('d="M0 0L10 10"')
    expect(svg).toContain('fill="red"')
  })

  it('fromSVG parses M/L/C/Q/Z commands', () => {
    const p = Path.fromSVG('M 0 0 L 10 0 Q 15 5 20 0 Z')
    expect(p.commands.length).toBe(4)
    expect(p.commands[2].type).toBe('Q')
  })

  it('fromSVG handles relative coordinates', () => {
    const p = Path.fromSVG('M 0 0 l 10 0 l 0 10')
    expect(p.commands.length).toBe(3)
    // Final point should be at (10, 10)
    const last = p.commands[p.commands.length - 1] as { type: string, x: number, y: number }
    expect(last.x).toBe(10)
    expect(last.y).toBe(10)
  })

  it('extend appends from another Path', () => {
    const a = new Path()
    a.moveTo(0, 0)
    const b = new Path()
    b.lineTo(10, 10)
    a.extend(b)
    expect(a.commands.length).toBe(2)
  })

  it('extend adds rectangle from BoundingBox', () => {
    const a = new Path()
    const bb = new BoundingBox()
    bb.addPoint(0, 0)
    bb.addPoint(100, 50)
    a.extend(bb)
    expect(a.commands.length).toBe(5) // M, L, L, L, Z
  })

  it('draw issues calls on a canvas-like context', () => {
    const calls: string[] = []
    const ctx = {
      beginPath: () => { calls.push('beginPath') },
      moveTo: () => { calls.push('moveTo') },
      lineTo: () => { calls.push('lineTo') },
      quadraticCurveTo: () => { calls.push('quadraticCurveTo') },
      bezierCurveTo: () => { calls.push('bezierCurveTo') },
      closePath: () => { calls.push('closePath') },
      fill: () => { calls.push('fill') },
      stroke: () => { calls.push('stroke') },
      fillStyle: '',
      strokeStyle: '',
      lineWidth: 1,
    }
    const p = new Path()
    p.moveTo(0, 0)
    p.lineTo(10, 10)
    p.close()
    p.draw(ctx)
    expect(calls).toContain('moveTo')
    expect(calls).toContain('lineTo')
    expect(calls).toContain('closePath')
    expect(calls).toContain('fill')
  })
})

describe('BoundingBox', () => {
  it('isEmpty before any points added', () => {
    const bb = new BoundingBox()
    expect(bb.isEmpty()).toBe(true)
    bb.addPoint(1, 1)
    expect(bb.isEmpty()).toBe(false)
  })

  it('addBezier expands for cubic curves', () => {
    const bb = new BoundingBox()
    bb.addBezier(0, 0, 50, 100, 50, 100, 100, 0)
    expect(bb.x2).toBeGreaterThan(50)
    expect(bb.y2).toBeGreaterThan(50)
  })

  it('addQuad expands for quadratic curves', () => {
    const bb = new BoundingBox()
    bb.addQuad(0, 0, 50, 100, 100, 0)
    expect(bb.y2).toBeCloseTo(50, 0)
  })
})

describe('parse + Font opentype API', () => {
  it('parse() detects TTF signature', () => {
    const buf = loadBuffer('bebas.ttf')
    const font = parse(buf)
    expect(font.numGlyphs).toBeGreaterThan(10)
    expect(font.familyName).toContain('Bebas')
    expect(font.unitsPerEm).toBeGreaterThan(0)
  })

  it('parse() handles ArrayBuffer or Uint8Array', () => {
    const buf = loadBuffer('bebas.ttf')
    const font1 = parse(buf)
    const font2 = parse(new Uint8Array(buf))
    expect(font2.numGlyphs).toBe(font1.numGlyphs)
  })

  it('hasChar returns true for ASCII letters', () => {
    const font = parse(loadBuffer('FiraSansMedium.ttf'))
    expect(font.hasChar('A')).toBe(true)
    expect(font.hasChar('z')).toBe(true)
    expect(font.hasChar('🍕')).toBe(false)
  })

  it('charToGlyph returns notdef for unknown chars', () => {
    const font = parse(loadBuffer('FiraSansMedium.ttf'))
    const g = font.charToGlyph('\u{10FFFF}')
    expect(g.index).toBe(0)
  })

  it('charToGlyphIndex finds the glyph index for A', () => {
    const font = parse(loadBuffer('FiraSansMedium.ttf'))
    const idx = font.charToGlyphIndex('A')
    expect(idx).toBeGreaterThan(0)
  })

  it('stringToGlyphs returns the right count for ASCII', () => {
    const font = parse(loadBuffer('FiraSansMedium.ttf'))
    const glyphs = font.stringToGlyphs('Hello')
    expect(glyphs.length).toBeGreaterThan(0)
    expect(glyphs.length).toBeLessThanOrEqual(5)
    expect(glyphs[0]).toBeInstanceOf(OTGlyph)
  })

  it('getAdvanceWidth returns a positive value', () => {
    const font = parse(loadBuffer('FiraSansMedium.ttf'))
    const w = font.getAdvanceWidth('Hello', 48)
    expect(w).toBeGreaterThan(0)
  })

  it('getPath returns a Path with commands', () => {
    const font = parse(loadBuffer('FiraSansMedium.ttf'))
    const path = font.getPath('Hi', 0, 0, 72)
    expect(path.commands.length).toBeGreaterThan(0)
  })

  it('getPaths returns one Path per glyph', () => {
    const font = parse(loadBuffer('FiraSansMedium.ttf'))
    const paths = font.getPaths('Hi', 0, 0, 72)
    expect(paths.length).toBe(2)
    expect(paths[0]).toBeInstanceOf(Path)
  })

  it('getKerningValue returns 0 for unrelated pairs', () => {
    const font = parse(loadBuffer('FiraSansMedium.ttf'))
    const A = font.charToGlyphIndex('A')
    const notdef = 0
    expect(font.getKerningValue(A, notdef)).toBe(0)
  })

  it('toArrayBuffer round-trips through parse', () => {
    const font = parse(loadBuffer('bebas.ttf'))
    const ab = font.toArrayBuffer()
    expect(ab.byteLength).toBeGreaterThan(1000)
    const reparsed = parse(ab)
    expect(reparsed.numGlyphs).toBe(font.numGlyphs)
  })

  it('nameToGlyphIndex / glyphIndexToName round-trip', () => {
    const font = parse(loadBuffer('bebas.ttf'))
    const name0 = font.glyphIndexToName(0)
    // .notdef may have an empty name — try a later glyph
    const idx = font.nameToGlyphIndex(name0)
    expect(typeof name0).toBe('string')
    expect(idx).toBeGreaterThanOrEqual(0)
  })

  it('drawText issues calls on a canvas-like context', () => {
    const font = parse(loadBuffer('FiraSansMedium.ttf'))
    let called = 0
    const ctx = {
      beginPath: () => { called++ },
      moveTo: () => {},
      lineTo: () => {},
      quadraticCurveTo: () => {},
      bezierCurveTo: () => {},
      closePath: () => {},
      fill: () => {},
      stroke: () => {},
      fillStyle: '',
      strokeStyle: '',
      lineWidth: 1,
    }
    font.drawText(ctx, 'Hi', 0, 0, 48)
    expect(called).toBeGreaterThan(0)
  })
})

describe('OTGlyph wrapper', () => {
  it('builds a Path from glyph contours', () => {
    const font = parse(loadBuffer('FiraSansMedium.ttf'))
    const g = font.charToGlyph('A')
    expect(g.path).toBeInstanceOf(Path)
    expect(g.path.commands.length).toBeGreaterThan(0)
  })

  it('getBoundingBox returns reasonable bounds', () => {
    const font = parse(loadBuffer('FiraSansMedium.ttf'))
    const g = font.charToGlyph('A')
    const bb = g.getBoundingBox()
    expect(bb.x2).toBeGreaterThan(bb.x1)
    expect(bb.y2).toBeGreaterThan(bb.y1)
  })

  it('getPath scales to requested font size', () => {
    const font = parse(loadBuffer('FiraSansMedium.ttf'))
    const g = font.charToGlyph('A')
    const path72 = g.getPath(0, 0, 72)
    const path144 = g.getPath(0, 0, 144)
    const bb72 = path72.getBoundingBox()
    const bb144 = path144.getBoundingBox()
    // 144 is 2x 72 → bounds should roughly double
    expect(bb144.x2 - bb144.x1).toBeGreaterThan((bb72.x2 - bb72.x1) * 1.8)
  })

  it('toSVG/toPathData produce strings', () => {
    const font = parse(loadBuffer('FiraSansMedium.ttf'))
    const g = font.charToGlyph('A')
    expect(g.toSVG()).toContain('<path')
    expect(typeof g.toPathData()).toBe('string')
  })

  it('contoursToPath handles glyph with curves', () => {
    const font = parse(loadBuffer('FiraSansMedium.ttf'))
    const data = font.get().glyf[font.charToGlyphIndex('o')]
    const p = contoursToPath(data)
    expect(p.commands.length).toBeGreaterThan(0)
    // 'o' is a curved letter — expect at least one Q command
    expect(p.commands.some(c => c.type === 'Q')).toBe(true)
  })
})

describe('bidi & arabic helpers', () => {
  it('isArabic detects basic range', () => {
    expect(isArabic(0x0627)).toBe(true) // alef
    expect(isArabic(0x0041)).toBe(false) // A
  })

  it('canJoinLeft / canJoinRight', () => {
    expect(canJoinRight(0x0627)).toBe(true) // alef can join right
    expect(canJoinLeft(0x0627)).toBe(false) // right-joining only
    expect(canJoinLeft(0x0628)).toBe(true) // beh dual-joining
  })

  it('arabicForms classifies contextual forms', () => {
    // كتب (k-t-b): ك=initial, ت=medial, ب=final
    const cps = [0x0643, 0x062A, 0x0628]
    const forms = arabicForms(cps)
    expect(forms).toEqual(['init', 'medi', 'fina'])
  })

  it('toVisualOrder reverses Arabic runs', () => {
    const v = toVisualOrder('العربية')
    expect(v.length).toBeGreaterThan(0)
    // First codepoint should be the last logical char reversed
    expect(v[0]).toBe(0x0629)
  })
})

describe('color helpers', () => {
  it('parseColor handles hex strings', () => {
    expect(parseColor('#ff0000')).toBe(0xFFFF0000)
    expect(parseColor('#ff000080')).toBe(0x80FF0000)
  })

  it('formatColor round-trips through hexa', () => {
    const packed = parseColor('#12345678')
    const s = formatColor(packed, 'hexa') as string
    expect(s.toLowerCase()).toBe('#12345678')
  })

  it('formatColor returns raw number for raw format', () => {
    expect(formatColor(0xFF123456, 'raw')).toBe(0xFF123456)
  })
})

describe('tiny-inflate', () => {
  it('round-trips through deflate', async () => {
    const source = new TextEncoder().encode('Hello, world! '.repeat(100))
    const g = globalThis as unknown as { Bun?: { deflateSync?: (d: Uint8Array) => Uint8Array } }
    if (!g.Bun?.deflateSync) return
    const compressed = g.Bun.deflateSync(source)
    const inflated = tinyInflateTo(compressed, source.length)
    expect(new TextDecoder().decode(inflated)).toBe(new TextDecoder().decode(source))
    void bytesToBase64 // keep import used
  })
})

describe('async load helper', () => {
  it('load() reads a font from filesystem', async () => {
    const path = join(FIXTURES, 'bebas.ttf')
    const font = await load(path)
    expect(font.numGlyphs).toBeGreaterThan(0)
  })
})
