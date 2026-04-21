import { describe, expect, it } from 'bun:test'
import {
  createFont,
  defaultConfig,
  Font,
  getEmptyTTFObject,
  path2contours,
  Reader,
  TTFHelper,
  TTFReader,
  TTFWriter,
  Writer,
} from '../src'

describe('binary Reader/Writer', () => {
  it('round-trips basic types', () => {
    const buf = new ArrayBuffer(32)
    const w = new Writer(buf)
    w.writeUint32(0x10203040)
    w.writeInt16(-12345)
    w.writeFixed(1.5)
    w.writeF2Dot14(0.5)
    w.writeString('TTCF', 4)

    const r = new Reader(buf)
    expect(r.readUint32()).toBe(0x10203040)
    expect(r.readInt16()).toBe(-12345)
    expect(r.readFixed()).toBeCloseTo(1.5, 3)
    expect(r.readF2Dot14()).toBeCloseTo(0.5, 3)
    expect(r.readString(r.offset, 4)).toBe('TTCF')
  })

  it('round-trips long date time', () => {
    const buf = new ArrayBuffer(8)
    const w = new Writer(buf)
    const d = new Date('2025-01-15T12:34:56Z')
    w.writeLongDateTime(d)

    const r = new Reader(buf)
    const parsed = r.readLongDateTime()
    expect(parsed.getTime()).toBe(d.getTime())
  })
})

describe('empty TTF object', () => {
  it('has required top-level tables', () => {
    const ttf = getEmptyTTFObject()
    expect(ttf.head).toBeDefined()
    expect(ttf.hhea).toBeDefined()
    expect(ttf.maxp).toBeDefined()
    expect(ttf['OS/2']).toBeDefined()
    expect(ttf.name.fontFamily).toBe('Untitled')
    expect(ttf.glyf.length).toBe(1)
    expect(ttf.glyf[0].name).toBe('.notdef')
  })
})

describe('TTFWriter / TTFReader round-trip', () => {
  it('writes and reads back an empty font', () => {
    const ttf = getEmptyTTFObject()
    const writer = new TTFWriter()
    const buffer = writer.write(ttf)
    expect(buffer.byteLength).toBeGreaterThan(0)

    const reader = new TTFReader()
    const parsed = reader.read(buffer)
    expect(parsed.head.unitsPerEm).toBe(1024)
    expect(parsed.name.fontFamily).toBe('Untitled')
    expect(parsed.glyf.length).toBeGreaterThan(0)
  })

  it('preserves glyphs with unicode mapping after a round-trip', () => {
    const ttf = getEmptyTTFObject()
    ttf.glyf.push({
      contours: [[
        { x: 0, y: 0, onCurve: true },
        { x: 500, y: 0, onCurve: true },
        { x: 500, y: 700, onCurve: true },
        { x: 0, y: 700, onCurve: true },
      ]],
      xMin: 0, yMin: 0, xMax: 500, yMax: 700,
      advanceWidth: 600, leftSideBearing: 50,
      unicode: [0x41], name: 'A',
    })
    ttf.cmap = { 0x41: 1 }

    const buffer = new TTFWriter().write(ttf)
    const parsed = new TTFReader().read(buffer)
    expect(parsed.glyf.length).toBe(2)
    expect(parsed.cmap[0x41]).toBe(1)
  })
})

describe('TTFHelper', () => {
  it('finds glyphs by unicode and name', () => {
    const ttf = getEmptyTTFObject()
    ttf.glyf.push({
      contours: [], xMin: 0, yMin: 0, xMax: 100, yMax: 100,
      advanceWidth: 100, leftSideBearing: 0,
      unicode: [0x41], name: 'A',
    })
    const helper = new TTFHelper(ttf)
    expect(helper.findGlyf({ unicode: [0x41] })).toEqual([1])
    expect(helper.findGlyf({ name: 'A' })).toEqual([1])
    expect(helper.findGlyf({ filter: g => g.advanceWidth === 100 })).toEqual([1])
  })

  it('computes metrics', () => {
    const ttf = getEmptyTTFObject()
    const m = new TTFHelper(ttf).calcMetrics()
    expect(m.ascent).toBe(824)
    expect(m.descent).toBe(-200)
  })
})

describe('Font class', () => {
  it('creates an empty font via createFont()', () => {
    const font = createFont()
    expect(font.get().glyf.length).toBe(1)
    expect(font.isVariable()).toBe(false)
  })

  it('round-trips through write() and read() for TTF', () => {
    const font = Font.create()
    const buf = font.write({ type: 'ttf', toBuffer: false }) as ArrayBuffer
    const loaded = createFont(buf, { type: 'ttf' })
    expect(loaded.get().name.fontFamily).toBe('Untitled')
  })

  it('produces an SVG string', () => {
    const font = createFont()
    const svg = font.write({ type: 'svg' }) as string
    expect(typeof svg).toBe('string')
    expect(svg).toContain('<font')
  })
})

describe('SVG path parsing', () => {
  it('parses a simple rectangle path', () => {
    const contours = path2contours('M 0 0 L 100 0 L 100 100 L 0 100 Z', false, 1024)
    expect(contours.length).toBe(1)
    expect(contours[0].length).toBe(4)
  })
})

describe('variable font API', () => {
  it('reports non-variable when no fvar', () => {
    const font = createFont()
    expect(font.isVariable()).toBe(false)
  })
})

describe('default config', () => {
  it('has sane defaults', () => {
    expect(defaultConfig.verbose).toBe(true)
    expect(defaultConfig.defaultFontType).toBe('ttf')
  })
})
