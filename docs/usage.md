# Usage

The library exposes both an imperative high-level `Font` class and a set of lower-level conversion/transform functions. Use whichever fits your task.

## Reading a font

```ts
import { readFileSync } from 'node:fs'
import { createFont } from 'ts-font-editor'

const raw = readFileSync('font.ttf')
const buffer = raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength) as ArrayBuffer

const font = createFont(buffer, {
  type: 'ttf',         // 'ttf' | 'otf' | 'woff' | 'woff2' | 'eot' | 'svg'
  subset: [0x41, 0x42], // optional: subset to specific unicodes
  kerning: true,        // optional: preserve kerning tables
  hinting: false,       // optional: preserve hinting tables
})

// Full parsed TTF object
const ttf = font.get()
console.log(ttf.name.fontFamily, ttf.glyf.length)
```

## Writing a font

```ts
// TTF (default)
const ttfBuf = font.write({ type: 'ttf' })

// WOFF (needs pako.deflate in Node; built-in in Bun)
const woffBuf = font.write({ type: 'woff' })

// WOFF2 (requires wasm init — see variable-fonts.md)
const woff2Buf = font.write({ type: 'woff2' })

// SVG font
const svg = font.write({ type: 'svg' }) as string

// EOT (for legacy IE)
const eot = font.write({ type: 'eot' })

// Data URI
const dataUri = font.toBase64({ type: 'woff' })
```

## Working with glyphs

```ts
const helper = font.getHelper()

// Find glyphs
const aIdx = helper.findGlyf({ unicode: [0x41] })
const named = helper.findGlyf({ name: 'icon-home' })

// Modify
helper.adjustGlyf([0, 1, 2], { scale: 0.5 })
helper.adjustGlyfPos([3], { leftSideBearing: 20, rightSideBearing: 40 })

// Replace unicodes
helper.setUnicode('abc', [1, 2, 3], true)

// Merge from another font
font.merge(otherFont, { scale: 1 })

// Sort + compress
font.sort()
font.compound2simple()

// Report duplicate unicodes
import { optimizettf } from 'ts-font-editor'
const result = optimizettf(font.get())
console.log(result)
```

## SVG / icon workflows

`createFont` accepts both SVG font files (`<font><glyph d=... /></font>`) and raw icon SVGs (`<path d=...>`). Raw icon SVGs are turned into single-glyph fonts automatically.

```ts
import { readFileSync } from 'node:fs'
import { createFont, ttf2icon, ttf2symbol } from 'ts-font-editor'

const svgText = readFileSync('icons.svg', 'utf8')
const font = createFont(svgText, { type: 'svg' })

// Standard icon-font CSS mapping
const icons = ttf2icon(font.get(), { iconPrefix: 'icon' })

// SVG sprite-sheet (<symbol>-per-glyph)
const sprite = ttf2symbol(font.get(), { symbolPrefix: 'icon-' })
```

## Lower-level transforms

Every graphics utility is available as a direct import:

```ts
import {
  computePathBox,
  pathRotate,
  pathTransform,
  reducePath,
  rotatePaths,
} from 'ts-font-editor'

// Rotate a contour 45° around origin
pathRotate(contour, Math.PI / 4)

// Compose affine transforms and bulk-apply
import { matrixMul, matrixRotate, matrixScale, matrixTranslate } from 'ts-font-editor'
const m = matrixMul(matrixTranslate(10, 10), matrixRotate(Math.PI / 2), matrixScale(2))
pathTransform(contour, m[0], m[1], m[2], m[3], m[4], m[5])
```

## CLI

```bash
# Convert between formats
font-editor convert input.ttf --to woff2 -o out.woff2
font-editor convert input.otf --to ttf -o out.ttf
font-editor convert input.svg --to ttf

# Inspect metadata and variable axes
font-editor inspect input.ttf
```

## Testing your workflow

```bash
bun test
```
