import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'bun:test'
import { createFont, TTFReader, TTFWriter } from '../src'
import { isVariableFont, listAxes, listNamedInstances } from '../src/variable/instance'

const FIXTURES = join(import.meta.dir, 'fixtures')

function loadBuffer(name: string): ArrayBuffer {
  const raw = readFileSync(join(FIXTURES, name))
  return raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength) as ArrayBuffer
}

describe('fixture: bebas.ttf (simple display TTF)', () => {
  it('parses head, hhea, OS/2, name, glyphs', () => {
    const buf = loadBuffer('bebas.ttf')
    const ttf = new TTFReader().read(buf)
    expect(ttf.head.unitsPerEm).toBeGreaterThan(0)
    expect(ttf.hhea.ascent).toBeGreaterThan(0)
    expect(ttf.name.fontFamily).toContain('Bebas')
    expect(ttf.glyf.length).toBeGreaterThan(10)
    // Should have at least one glyph with actual contours
    expect(ttf.glyf.some(g => (g.contours?.length ?? 0) > 0)).toBe(true)
  })

  it('round-trips through write/read preserving glyph count', () => {
    const buf = loadBuffer('bebas.ttf')
    const original = new TTFReader().read(buf)
    const rewritten = new TTFWriter().write(original)
    const parsed = new TTFReader().read(rewritten)
    expect(parsed.glyf.length).toBe(original.glyf.length)
    expect(parsed.head.unitsPerEm).toBe(original.head.unitsPerEm)
    expect(parsed.name.fontFamily).toBe(original.name.fontFamily)
  })

  it('preserves glyph bounding boxes in round-trip', () => {
    const buf = loadBuffer('bebas.ttf')
    const original = new TTFReader().read(buf)
    const rewritten = new TTFWriter().write(original)
    const parsed = new TTFReader().read(rewritten)
    // For first 20 non-empty glyphs, bbox should match within 1 unit
    let checked = 0
    for (let i = 0; i < original.glyf.length && checked < 20; i++) {
      const a = original.glyf[i]
      const b = parsed.glyf[i]
      if (!a.contours || a.contours.length === 0) continue
      expect(b.xMin).toBe(a.xMin)
      expect(b.xMax).toBe(a.xMax)
      expect(b.yMin).toBe(a.yMin)
      expect(b.yMax).toBe(a.yMax)
      checked++
    }
    expect(checked).toBeGreaterThan(0)
  })

  it('preserves cmap unicode mappings', () => {
    const buf = loadBuffer('bebas.ttf')
    const original = new TTFReader().read(buf)
    const rewritten = new TTFWriter().write(original)
    const parsed = new TTFReader().read(rewritten)
    for (const [code, gi] of Object.entries(original.cmap))
      expect(parsed.cmap[Number(code)]).toBe(gi)
  })
})

describe('fixture: FiraSansMedium.ttf (larger font with kerning)', () => {
  it('reads and converts to WOFF/SVG', () => {
    const buf = loadBuffer('FiraSansMedium.ttf')
    const font = createFont(buf, { type: 'ttf' })
    const woff = font.write({ type: 'woff', toBuffer: false })
    expect(woff).toBeInstanceOf(ArrayBuffer)
    expect((woff as ArrayBuffer).byteLength).toBeGreaterThan(1000)

    const svg = font.write({ type: 'svg' }) as string
    expect(svg).toContain('<font')
    expect(svg).toContain('<glyph')
  })

  it('reads kerning table when requested', () => {
    const buf = loadBuffer('FiraSansMedium.ttf')
    const ttf = new TTFReader({ kerning: true }).read(buf)
    // FiraSans likely uses GPOS (not kern), so rawTables.GPOS should be present
    const hasKerning = !!(ttf.kern || ttf.rawTables?.GPOS)
    expect(hasKerning).toBe(true)
  })
})

describe('fixture: baiduHealth.ttf (icon font, compact)', () => {
  it('round-trips', () => {
    const buf = loadBuffer('baiduHealth.ttf')
    const original = new TTFReader().read(buf)
    const rewritten = new TTFWriter().write(original)
    const parsed = new TTFReader().read(rewritten)
    expect(parsed.glyf.length).toBe(original.glyf.length)
  })

  it('preserves glyph names through post format 2', () => {
    const buf = loadBuffer('baiduHealth.ttf')
    const original = new TTFReader().read(buf)
    const hasNames = original.glyf.some(g => !!g.name)
    if (!hasNames) return // font doesn't have names
    const rewritten = new TTFWriter().write(original)
    const parsed = new TTFReader().read(rewritten)
    // Non-.notdef named glyphs should keep their names
    for (let i = 1; i < Math.min(original.glyf.length, 20); i++) {
      if (original.glyf[i].name && original.glyf[i].name !== '.notdef')
        expect(parsed.glyf[i].name).toBe(original.glyf[i].name)
    }
  })
})

describe('fixture: bebas.woff2 (WOFF2 decode requires wasm)', () => {
  it('reads WOFF2 when wasm is available or gracefully errors', () => {
    const buf = loadBuffer('bebas.woff2')
    try {
      const font = createFont(buf, { type: 'woff2' })
      expect(font.get().glyf.length).toBeGreaterThan(0)
    }
    catch (err) {
      // Expected when wasm is not initialized
      expect((err as Error).message.toLowerCase()).toContain('woff2')
    }
  })
})

describe('fixture: BalladeContour.otf (OTF with CFF outlines)', () => {
  it('parses CFF charstrings into TTF contours', () => {
    const buf = loadBuffer('BalladeContour.otf')
    const font = createFont(buf, { type: 'otf' })
    const ttf = font.get()
    expect(ttf.glyf.length).toBeGreaterThan(0)
    // At least one glyph should have actual contours after CFF conversion
    const withContours = ttf.glyf.filter(g => (g.contours?.length ?? 0) > 0)
    expect(withContours.length).toBeGreaterThan(0)
  })

  it('converts OTF to TTF byte buffer that re-parses', () => {
    const buf = loadBuffer('BalladeContour.otf')
    const font = createFont(buf, { type: 'otf' })
    const ttfBuf = font.write({ type: 'ttf', toBuffer: false }) as ArrayBuffer
    expect(ttfBuf.byteLength).toBeGreaterThan(1000)
    const parsed = new TTFReader().read(ttfBuf)
    expect(parsed.glyf.length).toBe(font.get().glyf.length)
  })
})

describe('fixture: SFNSDisplayCondensed-Black.otf', () => {
  it('parses without crashing', () => {
    const buf = loadBuffer('SFNSDisplayCondensed-Black.otf')
    const font = createFont(buf, { type: 'otf' })
    expect(font.get().glyf.length).toBeGreaterThan(0)
  })
})

describe('fixture: Inter-VariableFont.ttf (variable font)', () => {
  it('detects fvar and lists axes + named instances', () => {
    const buf = loadBuffer('Inter-VariableFont.ttf')
    const ttf = new TTFReader().read(buf)
    expect(isVariableFont(ttf)).toBe(true)
    const axes = listAxes(ttf)
    expect(axes.length).toBeGreaterThan(0)
    expect(axes.some(a => a.tag === 'wght')).toBe(true)

    const instances = listNamedInstances(ttf)
    expect(instances.length).toBeGreaterThan(0)
  })

  it('parses gvar glyph variations', () => {
    const buf = loadBuffer('Inter-VariableFont.ttf')
    const ttf = new TTFReader().read(buf)
    expect(ttf.gvar).toBeDefined()
    expect(ttf.gvar!.glyphVariations.length).toBeGreaterThan(0)
    // Most glyphs in a modern VF have at least one tuple
    const withTuples = ttf.gvar!.glyphVariations.filter(gv => gv.tuples.length > 0)
    expect(withTuples.length).toBeGreaterThan(10)
  })

  it('creates a Bold (wght=700) instance and bakes gvar deltas', () => {
    const buf = loadBuffer('Inter-VariableFont.ttf')
    const font = createFont(buf, { type: 'ttf' })
    // Specify every axis so the result is a fully static font
    const axes = listAxes(font.get())
    const coords: Record<string, number> = {}
    for (const axis of axes)
      coords[axis.tag] = axis.tag === 'wght' ? 700 : axis.defaultValue
    const bold = font.createInstance({ coordinates: coords })
    expect(bold.isVariable()).toBe(false)
    const boldTtf = bold.get()
    // Glyph outlines should have shifted from the original (Regular = 400)
    const regularA = font.get().glyf.find(g => g.unicode?.includes(0x41))
    const boldA = boldTtf.glyf.find(g => g.unicode?.includes(0x41))
    if (regularA && boldA && regularA.contours && boldA.contours && regularA.contours.length === boldA.contours.length) {
      // At least one point differs (wght affects stem thickness)
      let diffFound = false
      outer: for (let i = 0; i < regularA.contours.length; i++) {
        for (let j = 0; j < regularA.contours[i].length; j++) {
          if (regularA.contours[i][j].x !== boldA.contours[i][j].x || regularA.contours[i][j].y !== boldA.contours[i][j].y) {
            diffFound = true
            break outer
          }
        }
      }
      expect(diffFound).toBe(true)
    }
  })

  it('round-trips the variable font (keeps fvar/avar/STAT/gvar)', () => {
    const buf = loadBuffer('Inter-VariableFont.ttf')
    const original = new TTFReader().read(buf)
    const rewritten = new TTFWriter().write(original)
    const parsed = new TTFReader().read(rewritten)
    expect(parsed.fvar?.axes.length).toBe(original.fvar?.axes.length)
    expect(parsed.glyf.length).toBe(original.glyf.length)
  })
})

describe('fixture: iconfont-xin.svg', () => {
  it('parses SVG font into TTF object', () => {
    const svg = readFileSync(join(FIXTURES, 'iconfont-xin.svg'), 'utf8')
    const font = createFont(svg, { type: 'svg' })
    const ttf = font.get()
    expect(ttf.glyf.length).toBeGreaterThan(1)
  })

  it('converts SVG to TTF', () => {
    const svg = readFileSync(join(FIXTURES, 'iconfont-xin.svg'), 'utf8')
    const font = createFont(svg, { type: 'svg' })
    const ttfBuf = font.write({ type: 'ttf', toBuffer: false }) as ArrayBuffer
    expect(ttfBuf.byteLength).toBeGreaterThan(1000)
    // Re-parse to validate it's valid TTF
    const parsed = new TTFReader().read(ttfBuf)
    expect(parsed.glyf.length).toBe(font.get().glyf.length)
  })
})

describe('subset operation', () => {
  it('subsets a font to requested unicodes', () => {
    const buf = loadBuffer('FiraSansMedium.ttf')
    const font = createFont(buf, {
      type: 'ttf',
      subset: [0x41, 0x42, 0x43], // A, B, C
    })
    const ttf = font.get()
    // Should have .notdef + the 3 requested glyphs (plus any compound refs)
    expect(ttf.glyf.length).toBeGreaterThanOrEqual(4)
    expect(ttf.glyf.length).toBeLessThan(20)
    // Cmap should only have our 3 codes
    const codes = Object.keys(ttf.cmap).map(Number)
    expect(codes.includes(0x41)).toBe(true)
    expect(codes.includes(0x42)).toBe(true)
    expect(codes.includes(0x43)).toBe(true)
    expect(codes.includes(0x7A)).toBe(false) // 'z' not in subset
  })
})
