import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  encodeCharstring,
  Font,
  OTFReader,
  OTFWriter,
  parse,
  TTFReader,
} from '../src'

/**
 * CFF writer round-trip: ingest a TTF, emit it as a CFF .otf, parse it back,
 * and verify glyph paths + name table survive.
 */

function loadTtfFont(): Font {
  const fixture = resolve(import.meta.dir, 'fixtures', 'baiduHealth.ttf')
  const buf = readFileSync(fixture)
  const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)
  return new Font(ab, { type: 'ttf' })
}

describe('CFF writer', () => {
  it('encodes a non-trivial glyph as a multi-byte Type 2 charstring', () => {
    const font = loadTtfFont()
    // Find the first glyph with actual contours.
    const g = font.data.glyf.find(x => x.contours && x.contours.length > 0 && x.contours[0]!.length > 0)
    expect(g).toBeDefined()
    const cs = encodeCharstring(g!, g!.advanceWidth ?? 0)
    // width + at least one moveto (2 operands + opcode) + endchar = ≥ 5 bytes.
    expect(cs.length).toBeGreaterThan(4)
    expect(cs[cs.length - 1]).toBe(14)
  })

  it('writes a valid OTTO sfnt with a CFF table', () => {
    const font = loadTtfFont()
    const ab = new OTFWriter().write(font.data)
    const view = new DataView(ab)
    // Magic = 'OTTO'
    expect(view.getUint32(0, false)).toBe(0x4F54544F)
    // Has at least 8 tables
    const numTables = view.getUint16(4, false)
    expect(numTables).toBeGreaterThanOrEqual(8)
    // Find CFF table
    let foundCFF = false
    for (let i = 0; i < numTables; i++) {
      const off = 12 + i * 16
      const tag = String.fromCharCode(view.getUint8(off), view.getUint8(off + 1), view.getUint8(off + 2), view.getUint8(off + 3))
      if (tag === 'CFF ') foundCFF = true
    }
    expect(foundCFF).toBe(true)
  })

  it('round-trips glyph count + advance widths through OTF parse', () => {
    const font = loadTtfFont()
    const ab = new OTFWriter().write(font.data)
    // Reparse via OTFReader (this is the existing CFF-aware reader).
    const reparsed = new OTFReader().read(ab)
    expect(reparsed.glyf.length).toBe(font.data.glyf.length)
    // Compare advance widths for a handful of glyphs (writer order preserves them).
    for (let i = 0; i < Math.min(5, font.data.glyf.length); i++) {
      const orig = font.data.glyf[i]!.advanceWidth ?? 0
      const got = reparsed.glyf[i]!.advanceWidth ?? 0
      expect(got).toBe(orig)
    }
  })

  it('preserves authored GSUB liga in the OTF output', () => {
    const font = loadTtfFont()
    font.substitution.add('liga', { sub: [1, 2], by: 3 })
    const ab = new OTFWriter().write(font.data)

    // OTFReader currently stubs GSUB into rawTables only; we just check it's there.
    const view = new DataView(ab)
    const numTables = view.getUint16(4, false)
    let foundGSUB = false
    for (let i = 0; i < numTables; i++) {
      const off = 12 + i * 16
      const tag = String.fromCharCode(view.getUint8(off), view.getUint8(off + 1), view.getUint8(off + 2), view.getUint8(off + 3))
      if (tag === 'GSUB') foundGSUB = true
    }
    expect(foundGSUB).toBe(true)
  })

  it('reparses CFF outlines into non-empty contours', () => {
    const font = loadTtfFont()
    const ab = new OTFWriter().write(font.data)
    // Reparse via OTFReader → TTFObject. The CFF charstrings are decoded
    // back into the same on-/off-curve contour model.
    const reparsed = new OTFReader().read(ab)
    // Find a glyph that had contours in the source.
    const originalIdx = font.data.glyf.findIndex(x => x.contours && x.contours.length > 0 && x.contours[0]!.length > 0)
    expect(originalIdx).toBeGreaterThanOrEqual(0)
    const orig = font.data.glyf[originalIdx]!
    const reread = reparsed.glyf[originalIdx]!
    expect(reread.contours).toBeDefined()
    expect(reread.contours!.length).toBeGreaterThan(0)
    // Bounding box should overlap (CFF curve flattening will not be pixel-
    // identical, but the outer extents are within a few units).
    const tol = 4
    expect(Math.abs(reread.xMin - orig.xMin)).toBeLessThanOrEqual(tol)
    expect(Math.abs(reread.xMax - orig.xMax)).toBeLessThanOrEqual(tol)
    expect(Math.abs(reread.yMin - orig.yMin)).toBeLessThanOrEqual(tol)
    expect(Math.abs(reread.yMax - orig.yMax)).toBeLessThanOrEqual(tol)
  })
})
