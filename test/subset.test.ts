import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { OTFWriter, subsetGlyphs, TTFReader } from '../src'

function loadFixture() {
  const fixture = resolve(import.meta.dir, 'fixtures', 'baiduHealth.ttf')
  const buf = readFileSync(fixture)
  const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)
  return new TTFReader().read(ab)
}

describe('subsetGlyphs', () => {
  it('keeps only the requested codepoints + .notdef', () => {
    const ttf = loadFixture()
    const sub = subsetGlyphs(ttf, { codepoints: [0xE65A] })
    // .notdef + at most one other glyph.
    expect(sub.glyf.length).toBeLessThanOrEqual(2)
    expect(sub.glyf[0]!.name).toBe('.notdef')
  })

  it('resulting font writes as a valid OTF with reduced glyph count', () => {
    const ttf = loadFixture()
    const original = ttf.glyf.length
    const sub = subsetGlyphs(ttf, { codepoints: [0xE65A, 0xE678] })
    expect(sub.glyf.length).toBeLessThan(original)
    const ab = new OTFWriter().write(sub)
    expect(ab.byteLength).toBeGreaterThan(100)
    // OTTO magic
    const view = new DataView(ab)
    expect(view.getUint32(0, false)).toBe(0x4F54544F)
  })

  it('rebuilds cmap referring only to surviving glyphs', () => {
    const ttf = loadFixture()
    const sub = subsetGlyphs(ttf, { codepoints: [0xE65A] })
    const cmap = sub.cmap as Record<number, number>
    for (const cpStr of Object.keys(cmap)) {
      const gid = cmap[Number(cpStr)]!
      expect(gid).toBeLessThan(sub.glyf.length)
    }
  })

  it('records the old→new mapping in subsetMap', () => {
    const ttf = loadFixture()
    const sub = subsetGlyphs(ttf, { codepoints: [0xE65A, 0xE678] })
    expect(sub.subsetMap).toBeDefined()
    // .notdef always maps to 0.
    expect(sub.subsetMap![0]).toBe(0)
  })
})
