import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'bun:test'
import {
  arabicForms,
  bidi,
  bidiClass,
  buildCidToGidMap,
  buildFontDescriptor,
  buildPdfEmbedding,
  buildTTC,
  buildToUnicodeCMap,
  buildWidthsArray,
  countInstructions,
  CPAL_PALETTE_TYPE,
  decodeWOFF2Native,
  defaultFeaturesForScript,
  detectDominantScript,
  detectScript,
  disassemble,
  encodeWOFF2Native,
  extractTTCFont,
  isTTC,
  otf2ttfobject,
  paragraphLevel,
  parse,
  parseCollection,
  parseCPAL,
  readTTCHeader,
  reorderDevanagari,
  reorderThai,
  serializeCPAL,
  TTFReader,
  TTFWriter,
  validateInstructions,
  validateTTF,
} from '../src'

const FIXTURES = join(import.meta.dir, 'fixtures')

function loadBuffer(name: string): ArrayBuffer {
  const raw = readFileSync(join(FIXTURES, name))
  return raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength) as ArrayBuffer
}

describe('TTC collections', () => {
  it('buildTTC + extractTTCFont round-trip', () => {
    const a = loadBuffer('bebas.ttf')
    const b = loadBuffer('FiraSansMedium.ttf')
    const ttc = buildTTC([a, b])
    expect(isTTC(ttc)).toBe(true)

    const info = readTTCHeader(ttc)
    expect(info.fontOffsets.length).toBe(2)

    const first = extractTTCFont(ttc, info.fontOffsets[0])
    const parsedA = parse(first)
    expect(parsedA.familyName).toContain('Bebas')

    const second = extractTTCFont(ttc, info.fontOffsets[1])
    const parsedB = parse(second)
    expect(parsedB.familyName).toContain('Fira')
  })

  it('parseCollection returns every sub-font', () => {
    const a = loadBuffer('bebas.ttf')
    const b = loadBuffer('FiraSansMedium.ttf')
    const ttc = buildTTC([a, b])
    const fonts = parseCollection(ttc)
    expect(fonts.length).toBe(2)
    expect(fonts[0].familyName).toContain('Bebas')
    expect(fonts[1].familyName).toContain('Fira')
  })

  it('parse() with ttcIndex picks a specific member', () => {
    const a = loadBuffer('bebas.ttf')
    const b = loadBuffer('FiraSansMedium.ttf')
    const ttc = buildTTC([a, b])
    expect(parse(ttc, { ttcIndex: 1 }).familyName).toContain('Fira')
  })
})

describe('validateTTF', () => {
  it('returns empty array for a valid font', () => {
    const font = parse(loadBuffer('bebas.ttf'))
    const warnings = validateTTF(font.get())
    const errors = warnings.filter(w => w.severity === 'error')
    expect(errors.length).toBe(0)
  })

  it('flags bad unitsPerEm', () => {
    const font = parse(loadBuffer('bebas.ttf'))
    const ttf = font.get()
    ttf.head.unitsPerEm = -5
    const warnings = validateTTF(ttf)
    expect(warnings.some(w => w.field === 'head.unitsPerEm')).toBe(true)
  })

  it('flags missing required name fields', () => {
    const font = parse(loadBuffer('bebas.ttf'))
    const ttf = font.get()
    ttf.name.fontFamily = ''
    const warnings = validateTTF(ttf)
    expect(warnings.some(w => w.field === 'name.fontFamily')).toBe(true)
  })

  it('Font#validate() proxies the function', () => {
    const font = parse(loadBuffer('bebas.ttf'))
    expect(Array.isArray(font.validate())).toBe(true)
  })
})

describe('otf2ttfobject preserves OpenType layout tables', () => {
  it('captures GSUB/GPOS/meta as raw bytes when present in source OTF', () => {
    const buf = loadBuffer('SFNSDisplayCondensed-Black.otf')
    const ttf = otf2ttfobject(buf)
    expect(ttf.rawTables).toBeDefined()
    const tags = Object.keys(ttf.rawTables ?? {})
    expect(tags).toContain('GSUB')
    expect(tags).toContain('GPOS')
    // Each preserved table must carry non-empty bytes.
    for (const tag of tags) {
      expect(ttf.rawTables![tag]!.length).toBeGreaterThan(0)
    }
  })

  it('omits rawTables when the OTF has none of the preserved tags', () => {
    const buf = loadBuffer('BalladeContour.otf')
    const ttf = otf2ttfobject(buf)
    // BalladeContour is a minimal OTF with no GSUB/GPOS/etc.
    expect(ttf.rawTables).toBeUndefined()
  })
})

describe('TrueType hinting helpers', () => {
  it('disassemble handles push/pop opcodes', () => {
    const bc = [0xB0, 0x05, 0x20, 0x21] // PUSHB[1] 5, DUP, POP
    const lines = disassemble(bc)
    expect(lines.length).toBe(3)
    expect(lines[0]).toBe('PUSHB[1] 5')
    expect(lines[1]).toBe('DUP')
    expect(lines[2]).toBe('POP')
  })

  it('countInstructions counts correctly', () => {
    expect(countInstructions([0xB0, 0x01, 0x20, 0x21])).toBe(3)
  })

  it('validateInstructions catches unbalanced IF/EIF', () => {
    const bc = [0x58] // IF with no EIF
    const warnings = validateInstructions(bc)
    expect(warnings.some(w => w.includes('IF'))).toBe(true)
  })
})

describe('CPAL v1 metadata', () => {
  it('parseCPAL / serializeCPAL round-trip with paletteTypes', () => {
    const original = {
      version: 1,
      numPaletteEntries: 2,
      palettes: [[0xFF000000, 0xFFFFFFFF]],
      paletteTypes: [CPAL_PALETTE_TYPE.USABLE_WITH_LIGHT_BACKGROUND],
      paletteLabelNameIDs: [256],
      paletteEntryLabelNameIDs: [257, 258],
    }
    const serialized = serializeCPAL(original)
    const reparsed = parseCPAL(serialized)
    expect(reparsed.version).toBe(1)
    expect(reparsed.paletteTypes).toEqual(original.paletteTypes)
    expect(reparsed.paletteLabelNameIDs).toEqual(original.paletteLabelNameIDs)
    expect(reparsed.paletteEntryLabelNameIDs).toEqual(original.paletteEntryLabelNameIDs)
  })

  it('default serialization stays v0 when no metadata', () => {
    const original = {
      version: 0,
      numPaletteEntries: 1,
      palettes: [[0xFF000000]],
    }
    const bytes = serializeCPAL(original)
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
    expect(view.getUint16(0, false)).toBe(0)
  })
})

describe('UAX #9 bidi', () => {
  it('paragraphLevel picks first strong', () => {
    expect(paragraphLevel('Hello world')).toBe(0)
    expect(paragraphLevel('مرحبا')).toBe(1)
  })

  it('bidiClass returns correct classes', () => {
    expect(bidiClass('A'.codePointAt(0)!)).toBe('L')
    expect(bidiClass('ا'.codePointAt(0)!)).toBe('AL')
    expect(bidiClass('א'.codePointAt(0)!)).toBe('R')
    expect(bidiClass('5'.codePointAt(0)!)).toBe('EN')
  })

  it('bidi returns per-char levels with RTL runs at level 1', () => {
    const result = bidi('abc مرحبا def', 0)
    expect(result.levels.length).toBe(result.codepoints.length)
    // At least some Arabic chars should be at an odd level
    let hasOdd = false
    for (let i = 0; i < result.levels.length; i++) {
      const cls = result.types[i]
      if ((cls === 'R' || cls === 'AL') && (result.levels[i] & 1) === 1) hasOdd = true
    }
    expect(hasOdd).toBe(true)
  })

  it('bidi reverses simple Hebrew text', () => {
    const result = bidi('שלום', 1)
    const expectedFirst = 'ם'.codePointAt(0)!
    const expectedLast = 'ש'.codePointAt(0)!
    expect(result.visualCodepoints[0]).toBe(expectedFirst)
    expect(result.visualCodepoints[result.visualCodepoints.length - 1]).toBe(expectedLast)
  })

  it('mirrors paired brackets on RTL levels', () => {
    // Per UAX #9: "(a)" in RTL paragraph is reversed to ")a(" then mirrored
    // back to "(a)" — the final visual string reads the same as the input.
    // The right test is on an explicitly-RTL run with a neutral bracket.
    const result = bidi('([)', 1)
    // The second token '[' is a neutral that resolves to base dir (R).
    // After reorder + mirror, the bracket characters should swap identity
    // because they occur at odd levels.
    expect(result.visual).not.toBe('([)')
  })
})

describe('Arabic shaping', () => {
  it('arabicForms classifies three-letter word correctly', () => {
    const cps = [0x0643, 0x062A, 0x0628] // kaf-teh-beh
    const forms = arabicForms(cps)
    expect(forms[0]).toBe('init')
    expect(forms[1]).toBe('medi')
    expect(forms[2]).toBe('fina')
  })
})

describe('Script detection & shaping', () => {
  it('detects Latin / Arabic / Thai / Devanagari', () => {
    expect(detectScript('A'.codePointAt(0)!)).toBe('latn')
    expect(detectScript(0x0627)).toBe('arab')
    expect(detectScript(0x0E01)).toBe('thai')
    expect(detectScript(0x0915)).toBe('deva')
  })

  it('detectDominantScript picks majority', () => {
    expect(detectDominantScript('Hello world')).toBe('latn')
    expect(detectDominantScript('مرحبا')).toBe('arab')
  })

  it('defaultFeaturesForScript returns expected feature tags', () => {
    const f = defaultFeaturesForScript('arab')
    expect(f.init).toBe(true)
    expect(f.medi).toBe(true)
    expect(f.fina).toBe(true)
    expect(defaultFeaturesForScript('deva').rphf).toBe(true)
  })

  it('reorderThai swaps leading-vowel + consonant pairs', () => {
    // SARA E + KO KAI (ก) → should become ก + SARA E
    const result = reorderThai([0x0E40, 0x0E01])
    expect(result).toEqual([0x0E01, 0x0E40])
  })

  it('reorderDevanagari moves RA+VIRAMA to end for REPH', () => {
    // RA + VIRAMA + KA → KA + RA + VIRAMA
    const result = reorderDevanagari([0x0930, 0x094D, 0x0915])
    expect(result).toEqual([0x0915, 0x0930, 0x094D])
  })
})

describe('PDF embedding helpers', () => {
  it('buildFontDescriptor extracts metrics scaled to 1000-em', () => {
    const font = parse(loadBuffer('bebas.ttf'))
    const desc = buildFontDescriptor(font.get())
    expect(desc.fontName).toBeDefined()
    expect(desc.familyName).toBeDefined()
    expect(desc.ascent).toBeGreaterThan(0)
    expect(desc.descent).toBeLessThan(0)
    expect(desc.fontBBox.length).toBe(4)
  })

  it('buildWidthsArray emits alternating [gid, run] pairs', () => {
    const font = parse(loadBuffer('bebas.ttf'))
    const widths = buildWidthsArray(font.get())
    expect(widths.length % 2).toBe(0)
    expect(typeof widths[0]).toBe('number')
    expect(Array.isArray(widths[1])).toBe(true)
  })

  it('buildCidToGidMap produces 2-byte-BE mapping', () => {
    const map = buildCidToGidMap(undefined, 5)
    expect(map.length).toBe(12) // 6 entries × 2 bytes
    // Identity mapping: cid=3 → gid=3 → bytes [0x00, 0x03]
    expect(map[6]).toBe(0)
    expect(map[7]).toBe(3)
  })

  it('buildToUnicodeCMap produces a valid CMap string', () => {
    const font = parse(loadBuffer('bebas.ttf'))
    const cmap = buildToUnicodeCMap(font.get(), 'TestFont')
    expect(cmap).toContain('/CIDInit')
    expect(cmap).toContain('beginbfchar')
    expect(cmap).toContain('endcmap')
  })

  it('buildPdfEmbedding returns the whole bundle', () => {
    const font = parse(loadBuffer('bebas.ttf'))
    const pdf = buildPdfEmbedding(font.get())
    expect(pdf.descriptor).toBeDefined()
    expect(pdf.widths.length).toBeGreaterThan(0)
    expect(pdf.cidToGidMap.length).toBeGreaterThan(0)
    expect(pdf.toUnicodeCMap.length).toBeGreaterThan(0)
  })
})

describe('Native WOFF2 encoder/decoder', () => {
  it('round-trips via Node brotli', async () => {
    const ttf = loadBuffer('bebas.ttf')
    const woff2 = await encodeWOFF2Native(ttf)
    expect(woff2[0]).toBe(0x77) // 'w'
    expect(woff2[1]).toBe(0x4F) // 'O'

    const decoded = await decodeWOFF2Native(woff2)
    const parsed = new TTFReader().read(decoded.buffer.slice(decoded.byteOffset, decoded.byteOffset + decoded.byteLength) as ArrayBuffer)
    const original = new TTFReader().read(ttf)
    expect(parsed.glyf.length).toBe(original.glyf.length)
    expect(parsed.name.fontFamily).toBe(original.name.fontFamily)
  })
})

describe('Font.validate() end-to-end', () => {
  it('returns no errors for real fonts', () => {
    for (const name of ['bebas.ttf', 'FiraSansMedium.ttf', 'baiduHealth.ttf']) {
      const font = parse(loadBuffer(name))
      const warnings = font.validate()
      const errs = warnings.filter(w => w.severity === 'error')
      expect(errs.length).toBe(0)
    }
  })
})

describe('Round-trip after new improvements', () => {
  it('FiraSans still round-trips', () => {
    const buf = loadBuffer('FiraSansMedium.ttf')
    const ttf = new TTFReader().read(buf)
    const rewritten = new TTFWriter().write(ttf)
    const parsed = new TTFReader().read(rewritten)
    expect(parsed.glyf.length).toBe(ttf.glyf.length)
  })
})
