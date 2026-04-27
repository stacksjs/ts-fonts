import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { Font, readGposKerning, readLayoutHeader, TTFReader, TTFWriter } from '../src'

function loadFontWith(): Font {
  const fixture = resolve(import.meta.dir, 'fixtures', 'baiduHealth.ttf')
  const buf = readFileSync(fixture)
  const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)
  return new Font(ab, { type: 'ttf' })
}

describe('GPOS authoring', () => {
  it('adds a kerning pair via positioning.addPair', () => {
    const font = loadFontWith()
    font.positioning.addPair('kern', 1, 2, { xAdvance: -50 })
    expect(font.data.gpos!.features.kern?.pairs).toEqual([
      { first: 1, second: 2, value1: { xAdvance: -50 } },
    ])
  })

  it('emits a GPOS table that re-reads as kerning pairs', () => {
    const font = loadFontWith()
    font.positioning.addPair('kern', 10, 20, { xAdvance: -42 })
    font.positioning.addPair('kern', 10, 25, { xAdvance: -10 })
    font.positioning.addPair('kern', 30, 40, { xAdvance: -100 })

    const ttfBuf = new TTFWriter().write(font.data)
    const reparsed = new TTFReader().read(ttfBuf)
    expect(reparsed.rawTables?.GPOS).toBeDefined()

    const gposBytes = reparsed.rawTables!.GPOS!
    const ab = new ArrayBuffer(gposBytes.byteLength)
    new Uint8Array(ab).set(gposBytes)
    const view = new DataView(ab)
    const header = readLayoutHeader(view, 0)
    const kern = readGposKerning(view, header)
    expect(kern).toBeDefined()
    expect(kern!.getKerningValue(10, 20)).toBe(-42)
    expect(kern!.getKerningValue(10, 25)).toBe(-10)
    expect(kern!.getKerningValue(30, 40)).toBe(-100)
    expect(kern!.getKerningValue(99, 99)).toBe(0)
  })

  it('addKernPairs bulk-adds triples', () => {
    const font = loadFontWith()
    font.positioning.addKernPairs([[1, 2, -10], [3, 4, -20]])
    expect(font.data.gpos!.features.kern?.pairs).toHaveLength(2)
  })
})
