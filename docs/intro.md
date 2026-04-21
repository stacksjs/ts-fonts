# ts-font-editor

A fully-typed TypeScript font editor library for Bun, Node, and the browser. Read, write, and transform SFNT fonts — TTF, OTF (with full CFF → TTF conversion), WOFF, WOFF2, EOT, and SVG — with first-class variable font support.

## Why?

Existing JavaScript font libraries either target a single format, ship legacy CommonJS bundles that don't tree-shake, or skip variable-font features entirely. `ts-font-editor` aims to cover the surface of `fonteditor-core` while giving you a modern, typed, modular API.

## Features

- **SFNT parse & serialize** — TTF read/write with correct checksums, post format 2 glyph names, REPEAT flag compression
- **Format converters**
  - TTF ⇄ WOFF (zlib deflate, built-in in Bun; bring your own for Node)
  - TTF ⇄ WOFF2 via pluggable WASM bridge
  - TTF → EOT / SVG / SVG symbol sprite
  - OTF → TTF with full CFF charstring interpreter and cubic → quadratic bezier conversion
  - SVG → TTF (SVG font and raw-path icon SVG)
- **Glyph editing** — add, remove, replace, reorder, subset, merge, compound → simple, adjust metrics
- **Variable font support** — fvar, avar, STAT, full gvar tuple decoding with delta interpolation; `createInstance()` produces real static instances; `buildVariableFont()` produces VFs from point-compatible masters
- **Graphics utilities** — affine transforms (`pathTransform`, `pathRotate`, `pathSkewX/Y`, `pathAdjust`), bounding-box calc (on-curve & curve-aware), `reducePath`, multi-path utilities (move, mirror, flip, rotate)
- **SVG helpers** — `path2contours` with full grammar (M L H V Q T C S A Z), `oval2contour`, `rect2contour`, `polygon2contour`, `parseTransform`
- **Round-trip preservation** — GSUB, GPOS, GDEF, BASE, JSTF, MATH, COLR, CPAL, SVG, DSIG, vhea/vmtx, and other layout/color tables passed through as raw bytes
- **Binary Reader/Writer** — typed `DataView` helpers (Fixed, LongDateTime, F2Dot14, Uint24, …)
- **bunfig-powered config** — auto-loads `./font-editor.config.ts`
- **CLI** — `font-editor convert` and `font-editor inspect`

## Install

```bash
bun add ts-font-editor
```

## Get started

```ts
import { readFileSync } from 'node:fs'
import { createFont } from 'ts-font-editor'

const raw = readFileSync('Inter.ttf')
const font = createFont(raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength), {
  type: 'ttf',
})

console.log('Family:', font.get().name.fontFamily)
console.log('Glyphs:', font.get().glyf.length)

// Subset to just `A`, `B`, `C`
const subsetFont = createFont(raw.buffer.slice(0), {
  type: 'ttf',
  subset: [0x41, 0x42, 0x43],
})

// Write WOFF2
await import('ts-font-editor').then(({ woff2 }) => woff2.init('/path/to/woff2.wasm'))
const woff2Buffer = subsetFont.write({ type: 'woff2' })
```

## License

MIT
