import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { Font, parse, readGsubFeatures, readLayoutHeader, TTFReader, TTFWriter } from '../src'

/**
 * Round-trip GSUB authoring: build a font in memory, attach a `liga` rule
 * via `font.substitution.add()`, write to TTF, parse the result back,
 * walk the GSUB table, and verify the rule survived.
 *
 * Uses an existing fixture as the glyph donor (we just need a valid font
 * shape to attach GSUB to) — author-side correctness doesn't depend on
 * the donor's contents.
 */

function loadFixtureFont(): Font {
  const fixture = resolve(import.meta.dir, 'fixtures', 'baiduHealth.ttf')
  const buf = readFileSync(fixture)
  const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)
  return new Font(ab, { type: 'ttf' })
}

describe('GSUB authoring', () => {
  it('round-trips a single ligature rule via TTF write + read', () => {
    const font = loadFixtureFont()

    // Pick three valid glyph indices (any will do — we're testing serialisation).
    const a = 1, b = 2, lig = 3
    font.substitution.add('liga', { sub: [a, b], by: lig })

    expect(font.data.gsub).toBeDefined()
    expect(font.data.gsub!.features.liga?.ligatures).toHaveLength(1)

    // Serialise + reparse via the low-level reader so we read the actual GSUB bytes.
    const ttfBuf = new TTFWriter().write(font.data)
    const reparsed = new TTFReader().read(ttfBuf)

    // The reader doesn't lift GSUB into a structured field, but the raw bytes
    // are preserved on rawTables. Verify they appeared.
    expect(reparsed.rawTables?.GSUB).toBeDefined()
    expect(reparsed.rawTables!.GSUB!.length).toBeGreaterThan(20)

    // Parse via the opentype-compat layer to confirm the lookup is well-formed.
    const reparsedFont = parse(ttfBuf)
    const view = new DataView(ttfBuf)
    const tables = (reparsedFont as unknown as { tables: Record<string, { _offset?: number }> }).tables
    // We don't depend on parse() exposing GSUB directly; instead run the
    // module-level reader against raw bytes.
    const gsubBytes = reparsed.rawTables!.GSUB!
    const gsubBuf = new ArrayBuffer(gsubBytes.byteLength)
    new Uint8Array(gsubBuf).set(gsubBytes)
    const gsubView = new DataView(gsubBuf)
    const header = readLayoutHeader(gsubView, 0)
    const features = readGsubFeatures(gsubView, header, ['liga'])

    expect(features.ligatures).toHaveLength(1)
    expect(features.ligatures[0]).toMatchObject({ first: a, components: [b], by: lig })

    // Silence unused-binding lint
    void tables; void view
  })

  it('groups multiple ligatures sharing a first glyph into one LigatureSet', () => {
    const font = loadFixtureFont()
    // Three rules: two share first glyph 10, one starts with 20.
    font.substitution.add('liga', { sub: [10, 11], by: 100 })
    font.substitution.add('liga', { sub: [10, 12, 13], by: 101 })
    font.substitution.add('liga', { sub: [20, 21], by: 102 })

    const ttfBuf = new TTFWriter().write(font.data)
    const reparsed = new TTFReader().read(ttfBuf)
    const gsubBytes = reparsed.rawTables!.GSUB!
    const gsubBuf = new ArrayBuffer(gsubBytes.byteLength)
    new Uint8Array(gsubBuf).set(gsubBytes)
    const gsubView = new DataView(gsubBuf)
    const header = readLayoutHeader(gsubView, 0)
    const features = readGsubFeatures(gsubView, header, ['liga'])

    expect(features.ligatures).toHaveLength(3)
    // The 3-glyph rule should come first within the shared-first set
    // (the writer sorts longer matches first).
    const first10 = features.ligatures.filter(l => l.first === 10)
    expect(first10[0]!.components).toEqual([12, 13])
    expect(first10[1]!.components).toEqual([11])
  })

  it('rejects malformed input', () => {
    const font = loadFixtureFont()
    expect(() => font.substitution.add('liga', { sub: [1], by: 2 } as unknown as { sub: number[], by: number }))
      .toThrow()
    expect(() => font.substitution.add('liga', { sub: [], by: 2 }))
      .toThrow()
  })

  it('accepts single substitutions (lookup type 1)', () => {
    const font = loadFixtureFont()
    font.substitution.add('smcp', { sub: 5, by: 10 })
    expect(font.data.gsub!.features.smcp?.singles).toEqual([{ sub: 5, by: 10 }])
    const out = new TTFWriter().write(font.data)
    const reparsed = new TTFReader().read(out)
    expect(reparsed.rawTables?.GSUB?.byteLength ?? 0).toBeGreaterThan(20)
  })

  it('accepts multiple substitutions (lookup type 2)', () => {
    const font = loadFixtureFont()
    font.substitution.add('ccmp', { sub: 7, by: [8, 9, 10] })
    expect(font.data.gsub!.features.ccmp?.multiples).toEqual([{ sub: 7, by: [8, 9, 10] }])
    const out = new TTFWriter().write(font.data)
    expect(out.byteLength).toBeGreaterThan(0)
  })

  it('accepts alternate substitutions (lookup type 3)', () => {
    const font = loadFixtureFont()
    font.substitution.add('aalt', { sub: 11, alternates: [12, 13, 14] })
    expect(font.data.gsub!.features.aalt?.alternates).toEqual([{ sub: 11, alternates: [12, 13, 14] }])
    const out = new TTFWriter().write(font.data)
    expect(out.byteLength).toBeGreaterThan(0)
  })
})
