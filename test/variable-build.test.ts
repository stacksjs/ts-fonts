import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  buildVariableFont,
  createFont,
  createInstance,
  isVariableFont,
  TTFReader,
  TTFWriter,
} from '../src'

const FIXTURES = resolve(import.meta.dir, 'fixtures')

function loadTtf(name: string) {
  const buf = readFileSync(resolve(FIXTURES, name))
  const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer
  return new TTFReader().read(ab)
}

describe('variable: gvar roundtrip', () => {
  it('parses and re-serializes Inter-VariableFont.ttf preserving gvar on one glyph', () => {
    const ttf = loadTtf('Inter-VariableFont.ttf')
    expect(isVariableFont(ttf)).toBe(true)
    expect(ttf.gvar).toBeDefined()
    expect(ttf.gvar!.glyphVariations.length).toBe(ttf.glyf.length)

    const outBuf = new TTFWriter().write(ttf)
    const roundTripped = new TTFReader().read(outBuf)
    expect(roundTripped.gvar).toBeDefined()
    expect(roundTripped.gvar!.glyphVariations.length).toBe(ttf.gvar!.glyphVariations.length)
  })
})

describe('variable: buildVariableFont', () => {
  // Create a synthetic master pair by translating every point of every glyph.
  // The default and "heavier" master differ by a fixed per-point offset —
  // enough to exercise gvar encoding without depending on font-production tooling.
  function buildSyntheticMaster(base: ReturnType<typeof loadTtf>, shift: number) {
    const clone = JSON.parse(JSON.stringify(base)) as typeof base
    for (const g of clone.glyf) {
      if (!g.contours) continue
      for (const c of g.contours)
        for (const p of c) p.x += shift
      g.xMin += shift
      g.xMax += shift
      g.leftSideBearing += shift
    }
    return clone
  }

  it('merges two synthetic masters into a variable font with wght axis', () => {
    const base = loadTtf('bebas.ttf')
    const regular = base
    const bold = buildSyntheticMaster(base, 10)

    const vf = buildVariableFont({
      axes: [{ tag: 'wght', name: 'Weight', minValue: 400, defaultValue: 400, maxValue: 900 }],
      masters: [
        { location: { wght: 400 }, font: regular },
        { location: { wght: 900 }, font: bold },
      ],
      instances: [
        { name: 'Regular', location: { wght: 400 } },
        { name: 'Black', location: { wght: 900 } },
      ],
    })

    expect(vf.fvar).toBeDefined()
    expect(vf.fvar!.axes).toHaveLength(1)
    expect(vf.fvar!.axes[0].tag).toBe('wght')
    expect(vf.fvar!.instances).toHaveLength(2)
    expect(vf.gvar).toBeDefined()
    expect(vf.gvar!.glyphVariations.length).toBe(vf.glyf.length)

    // Round-trip to bytes and back — must still parse as a valid variable font.
    const buf = new TTFWriter().write(vf)
    const parsed = new TTFReader().read(buf)
    expect(isVariableFont(parsed)).toBe(true)
    expect(parsed.fvar!.axes[0].tag).toBe('wght')
    expect(parsed.fvar!.instances).toHaveLength(2)
  })

  it('instantiating the variable font at default axis value matches the default master', () => {
    const base = loadTtf('bebas.ttf')
    const regular = base
    const bold = buildSyntheticMaster(base, 25)

    const vf = buildVariableFont({
      axes: [{ tag: 'wght', name: 'Weight', minValue: 400, defaultValue: 400, maxValue: 900 }],
      masters: [
        { location: { wght: 400 }, font: regular },
        { location: { wght: 900 }, font: bold },
      ],
    })

    const staticAtDefault = createInstance(vf, { coordinates: { wght: 400 }, updateName: false })

    // Picked glyph to diff: first glyph with contours > 0.
    const idx = vf.glyf.findIndex(g => g.contours && g.contours.length > 0)
    expect(idx).toBeGreaterThanOrEqual(0)
    const a = regular.glyf[idx]
    const b = staticAtDefault.glyf[idx]
    expect(a.advanceWidth).toBe(b.advanceWidth)
    expect(a.contours!.length).toBe(b.contours!.length)
    for (let ci = 0; ci < a.contours!.length; ci++) {
      const ac = a.contours![ci]
      const bc = b.contours![ci]
      expect(ac.length).toBe(bc.length)
      for (let pi = 0; pi < ac.length; pi++) {
        expect(ac[pi].x).toBe(bc[pi].x)
        expect(ac[pi].y).toBe(bc[pi].y)
      }
    }
  })

  it('instantiating at the far axis end reproduces the far master', () => {
    const base = loadTtf('bebas.ttf')
    const regular = base
    const bold = buildSyntheticMaster(base, 25)

    const vf = buildVariableFont({
      axes: [{ tag: 'wght', name: 'Weight', minValue: 400, defaultValue: 400, maxValue: 900 }],
      masters: [
        { location: { wght: 400 }, font: regular },
        { location: { wght: 900 }, font: bold },
      ],
    })

    const staticAtMax = createInstance(vf, { coordinates: { wght: 900 }, updateName: false })
    const idx = vf.glyf.findIndex(g => g.contours && g.contours.length > 0)
    expect(idx).toBeGreaterThanOrEqual(0)
    const a = bold.glyf[idx]
    const b = staticAtMax.glyf[idx]
    // x positions should land within ±1 em of the synthetic master (rounding).
    for (let ci = 0; ci < a.contours!.length; ci++) {
      for (let pi = 0; pi < a.contours![ci].length; pi++) {
        expect(Math.abs(a.contours![ci][pi].x - b.contours![ci][pi].x)).toBeLessThanOrEqual(1)
      }
    }
  })

  it('rejects masters with mismatched point counts', () => {
    const base = loadTtf('bebas.ttf')
    const bad = JSON.parse(JSON.stringify(base)) as typeof base
    // Inject an extra point into the first contour of the first glyph.
    const victim = bad.glyf.find(g => g.contours && g.contours.length > 0)!
    victim.contours![0].push({ x: 0, y: 0, onCurve: true })

    expect(() => buildVariableFont({
      axes: [{ tag: 'wght', name: 'Weight', minValue: 400, defaultValue: 400, maxValue: 900 }],
      masters: [
        { location: { wght: 400 }, font: base },
        { location: { wght: 900 }, font: bad },
      ],
    })).toThrow(/point/)
  })

  it('requires a master at the default axis location', () => {
    const base = loadTtf('bebas.ttf')
    expect(() => buildVariableFont({
      axes: [{ tag: 'wght', name: 'Weight', minValue: 100, defaultValue: 400, maxValue: 900 }],
      masters: [
        { location: { wght: 100 }, font: base },
        { location: { wght: 900 }, font: base },
      ],
    })).toThrow(/default/)
  })
})

describe('variable: name.extra round-trip', () => {
  it('preserves arbitrary nameIDs through write/read', () => {
    const f = createFont().get()
    f.name.extra = [
      { nameID: 256, value: 'Weight' },
      { nameID: 257, value: 'Thin' },
      { nameID: 258, value: 'Black' },
    ]

    const buf = new TTFWriter().write(f)
    const parsed = new TTFReader().read(buf)
    expect(parsed.name.extra).toBeDefined()
    const extraMap = Object.fromEntries(parsed.name.extra!.map(e => [e.nameID, e.value]))
    expect(extraMap[256]).toBe('Weight')
    expect(extraMap[257]).toBe('Thin')
    expect(extraMap[258]).toBe('Black')
  })
})
