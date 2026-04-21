# Advanced features

## Font collections (TTC)

```ts
import { isTTC, parseCollection, readTTCHeader, buildTTC, extractTTCFont } from 'ts-font-editor'

// Detect a .ttc
isTTC(buffer) // boolean

// Read every sub-font
const fonts = parseCollection(buffer)
fonts.forEach(f => console.log(f.familyName, f.styleName))

// Or pick one member by index
import { parse } from 'ts-font-editor'
const fira = parse(buffer, { ttcIndex: 1 })

// Build a TTC from two or more standalone TTFs
const ttc = buildTTC([ttfBuffer1, ttfBuffer2])
```

## CFF2 (variable font PostScript outlines)

OTFs with a `CFF2` table (Adobe Source Sans 3 VF and similar) are parsed automatically via `otf2ttfobject`. Glyph outlines are pulled at the default location — to render a specific instance, use `createInstance({ coordinates: ... })` on the returned Font.

## Subsetting with layout-aware rewriting

The default subset stream strips GSUB/GPOS when `kerning: false`. To keep ligatures/kerning valid after subsetting:

```ts
import { createFont, subsetLayoutTable } from 'ts-font-editor'

const font = createFont(buffer, { type: 'ttf', subset: [0x41, 0x42, 0x43], kerning: true })
const ttf = font.get()

// If the font originally had GSUB/GPOS, rewrite them against the new glyph IDs
if (ttf.rawTables?.GSUB && ttf.subsetMap) {
  const subsetted = subsetLayoutTable(ttf.rawTables.GSUB, ttf.subsetMap as Record<number, number>)
  if (subsetted) ttf.rawTables.GSUB = subsetted
}
```

`subsetLayoutTable` keeps only the lookups we understand (single/multiple/alternate/ligature substitution for GSUB; pair positioning for GPOS) and drops the rest. Output is a valid layout table referencing only subset glyphs.

## Extended GSUB/GPOS lookups

The shaping pipeline understands:

- GSUB type 1 (single), type 2 (multiple), type 3 (alternate — picks first), type 4 (ligature), type 7 (extension)
- GPOS type 1 (single positioning), type 2 (pair positioning, formats 1 and 2)

Call `readGsubFeatures` / `readGposKerning` / `readGposSinglePositioning` directly for low-level access.

## UAX #9 bidi

```ts
import { bidi, bidiClass, paragraphLevel } from 'ts-font-editor'

const result = bidi('Hello مرحبا world')
result.levels  // per-character embedding levels
result.visual  // visually-reordered string (for left-to-right rendering buffers)
result.types   // resolved Bidi_Class per character
```

## Script detection and pre-shaping

```ts
import { detectDominantScript, defaultFeaturesForScript, reorderThai, reorderDevanagari } from 'ts-font-editor'

const script = detectDominantScript(text)
const features = defaultFeaturesForScript(script)

// Pre-reorder for Thai or Devanagari before shaping
const cps = Array.from(text, ch => ch.codePointAt(0)!)
const prepared = script === 'thai' ? reorderThai(cps) : script === 'deva' ? reorderDevanagari(cps) : cps
```

## Color fonts (CPAL v1 + COLR v1)

`PaletteManager` transparently handles both v0 and v1 CPAL. For v1, you can set palette types and name-ID labels:

```ts
font.palettes.ensureCPAL(['#000', '#fff', '#f00'])
const cpal = font.palettes.cpal()
if (cpal) {
  cpal.paletteTypes = [CPAL_PALETTE_TYPE.USABLE_WITH_LIGHT_BACKGROUND]
  cpal.paletteLabelNameIDs = [256]
}
font.palettes.flush()
```

For COLR v1 paint trees, `parseCOLRv1(raw)` returns a walkable Paint graph (solid, linear/radial/sweep gradients, transforms, composites). v0 records are still preserved for compatibility.

## Font validation

```ts
import { validateTTF } from 'ts-font-editor'

const warnings = font.validate() // or validateTTF(font.get())
warnings.forEach(w => console.log(`${w.severity} [${w.field}] ${w.message}`))
```

Checks include: required tables, unitsPerEm range, name fields, OS/2 weight/width class, glyph bbox stored-vs-actual match, compound glyph reference integrity, COLR baseGlyphRecords sorting, gvar/glyph-count parity.

## Native WOFF2

WOFF2 read/write without the WASM bridge uses Node's built-in Brotli when available:

```ts
import { encodeWOFF2Native, decodeWOFF2Native, setBrotli } from 'ts-font-editor'

// Auto-picks node:zlib on Node; provide your own in other environments
setBrotli({ compress: myBrotliCompressor, decompress: myBrotliDecompressor })

const woff2 = await encodeWOFF2Native(ttfBuffer)
const ttfBack = await decodeWOFF2Native(woff2)
```

Note: uses the null glyf/loca transform (`transformVersion = 3`) — output is valid WOFF2 but ~10–15% larger than Google's transformed encoder.

## TrueType hinting helpers

```ts
import { disassemble, validateInstructions, countInstructions } from 'ts-font-editor'

// Parse TTF with hinting preserved
const font = createFont(buffer, { type: 'ttf', hinting: true })
const fpgm = font.get().fpgm
if (fpgm) {
  console.log(disassemble(fpgm))
  console.log('Instructions:', countInstructions(fpgm))
  console.log('Warnings:', validateInstructions(fpgm))
}
```

## PDF embedding

Generate the pieces you need to embed a font in a PDF document:

```ts
import { buildPdfEmbedding } from 'ts-font-editor'

const pdf = buildPdfEmbedding(font.get())
pdf.descriptor.fontName       // PostScript name
pdf.descriptor.ascent          // metrics in 1000-em
pdf.widths                     // /W array for CID widths
pdf.cidToGidMap                // 2-byte BE Uint8Array
pdf.toUnicodeCMap              // /ToUnicode CMap string
```

Combine with a PDF library (pdfkit, pdf-lib, etc.) to assemble the complete `/Font` dictionary.

## CLI extras

```bash
# Subset by text
font-editor subset Inter.ttf --text "Hello world" -o hello.ttf

# Variable font instance
font-editor instance Inter-VF.ttf --axis wght=700 --axis slnt=-10 -o bold.ttf

# Optimize
font-editor optimize Inter.ttf -o clean.ttf

# Validate
font-editor validate Inter.ttf

# Inspect a TTC
font-editor collection SFPro.ttc

# Disassemble hinting
font-editor disasm Inter.ttf --table fpgm
```
