# Migrating from opentype.js

`ts-font-editor` exposes a drop-in opentype.js-compatible API. Most common workflows can be migrated by changing the import.

## Imports

```diff
- import opentype from 'opentype.js'
+ import { parse, Font, Glyph, Path, BoundingBox } from 'ts-font-editor/opentype'

- opentype.parse(buffer)
+ parse(buffer)
```

If you prefer the main package:

```ts
import { parse, OTGlyph as Glyph, Path, BoundingBox } from 'ts-font-editor'
```

## Loading

```ts
// Async — works in browsers (fetch) and Node/Bun (fs)
import { load } from 'ts-font-editor/opentype'
const font = await load('/fonts/Inter.ttf')

// Sync — from an existing ArrayBuffer
import { parse } from 'ts-font-editor/opentype'
const font = parse(buffer)
```

`parse()` auto-detects TTF / OTF / WOFF / EOT from the SFNT signature. WOFF tables are decompressed with a built-in tiny-inflate implementation — no external dependency required.

For WOFF2, initialise the WASM bridge once then pass `type: 'woff2'` through the `Font` constructor, or call `woff2.decode(buffer)` and feed the decompressed TTF bytes to `parse()`.

## Text layout

```ts
const font = parse(buffer)

// Drop-in equivalents
font.charToGlyph('A')
font.charToGlyphIndex('A')
font.hasChar('A')
font.stringToGlyphs('Hello')
font.getPath('Hello', 0, 0, 72)
font.getPaths('Hello', 0, 0, 72)
font.getAdvanceWidth('Hello', 72)
font.getKerningValue(leftGlyph, rightGlyph)

// Canvas drawing
font.drawText(ctx, 'Hello', 0, 0, 72)
font.drawPoints(ctx, 'Hello', 0, 0, 72)
font.drawMetrics(ctx, 'Hello', 0, 0, 72)

// For each glyph
font.forEachGlyph('Hello', 0, 0, 72, {}, (glyph, x, y, fs) => {
  // ...
})
```

## Path API

```ts
import { Path, BoundingBox } from 'ts-font-editor/opentype'

const p = new Path()
p.moveTo(0, 0)
p.lineTo(100, 0)
p.quadraticCurveTo(150, 50, 200, 0)
p.curveTo(210, 10, 220, 10, 230, 0)
p.close()

const bb = p.getBoundingBox()  // cubic/quadratic curve extrema considered
const svg = p.toPathData()
const el = p.toSVG()

// Parse SVG-path "d" back into commands
const loaded = Path.fromSVG('M0 0L10 10Z')
```

## Color fonts (COLR/CPAL)

```ts
// Palette manager
font.palettes.getAll('hexa')
font.palettes.get(0, 'rgba')
font.palettes.getColor(2, 0, 'rgb')
font.palettes.add(['#ff0000', '#00ff00'])
font.palettes.setColor(0, '#123456', 0)

// Layer manager
font.layers.get(glyphIndex)
font.layers.add(glyphIndex, { glyphID: 42, paletteIndex: 0 })
font.layers.remove(glyphIndex, 0)
font.layers.setPaletteIndex(glyphIndex, 0, 1)
```

Both managers write changes back to the font via `font.rawTables.COLR` / `font.rawTables.CPAL`, so the font round-trips through `write({ type: 'ttf' })` correctly.

## Kerning

The library looks up kerning first via GPOS pair positioning (format 1 or 2) and falls back to the `kern` table. Call `font.getKerningValue(left, right)` with either a `Glyph` object or glyph index.

## Ligatures

`stringToGlyphs` applies OpenType `liga` and `rlig` features from the GSUB table. Disable explicitly:

```ts
font.stringToGlyphs('office', { features: { liga: false } })
```

Single substitution (lookup type 1) and ligature substitution (lookup type 4) are supported; extension lookups (type 7) are unwrapped automatically.

## Arabic / bidi

Basic contextual shaping is provided as standalone helpers:

```ts
import { arabicForms, isArabic, toVisualOrder } from 'ts-font-editor/opentype'

const cps = Array.from('كتب', ch => ch.codePointAt(0)!)
const forms = arabicForms(cps)  // ['init', 'medi', 'fina']
```

Full bidi reordering (UAX #9) is beyond scope — combine with an external bidi library if you need complex mixed-direction layout.

## Variable fonts

Variable-font APIs live in the main package (see [Variable fonts](./variable-fonts.md)):

```ts
import { createInstance, listAxes } from 'ts-font-editor'

const bold = font.createInstance({ coordinates: { wght: 700 } })
```

## Feature parity

| Feature | opentype.js | ts-font-editor |
| --- | --- | --- |
| TTF/OTF/WOFF parsing | ✅ | ✅ |
| WOFF2 parsing | ❌ (external) | ⚠️ (WASM bridge required) |
| CFF → quadratic outlines | ✅ | ✅ |
| Text layout + ligatures | ✅ | ✅ (liga, rlig) |
| Kerning (kern + GPOS) | ✅ | ✅ |
| Variable fonts (fvar/gvar) | ✅ | ✅ (with real gvar interpolation) |
| Color palettes (CPAL) | ✅ | ✅ |
| Color layers (COLR v0) | ✅ | ✅ |
| Color layers (COLR v1 paints) | ✅ | ⚠️ (raw passthrough only) |
| Canvas drawing | ✅ | ✅ |
| SVG export | ✅ | ✅ |
| Arabic basic shaping | ✅ | ✅ |
| TrueType hinting | ✅ | ❌ |
| Full OpenType shaping (Thai, etc.) | ⚠️ | ❌ |
