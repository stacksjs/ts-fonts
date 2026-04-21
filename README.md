<p align="center"><img src=".github/art/cover.jpg" alt="Social Card of this repo"></p>

[![npm version][npm-version-src]][npm-version-href]
[![GitHub Actions][github-actions-src]][github-actions-href]
[![Commitizen friendly](https://img.shields.io/badge/commitizen-friendly-brightgreen.svg)](http://commitizen.github.io/cz-cli/)
<!-- [![npm downloads][npm-downloads-src]][npm-downloads-href] -->
<!-- [![Codecov][codecov-src]][codecov-href] -->

# ts-font-editor

A fully-typed TypeScript font editor library. Read, write, and transform SFNT fonts (TTF, OTF, WOFF, WOFF2, EOT, SVG) with first-class variable font support.

## Features

- **SFNT parse & serialize** — TTF read/write, round-trip compatible
- **Format converters** — TTF ⇄ WOFF, TTF ⇄ WOFF2 (wasm), TTF → EOT / SVG, EOT / WOFF / OTF → TTF
- **OTF → TTF** — full CFF charstring interpreter with cubic→quadratic bezier conversion
- **Text layout** — `getPath`, `getAdvanceWidth`, `stringToGlyphs` with ligatures and kerning
- **Glyph editing** — add, remove, replace, reorder, subset, merge, compound → simple
- **Variable font support** — fvar, avar, STAT, full gvar delta interpolation, HVAR, MVAR
- **Color fonts** — COLR v0 layers + CPAL palettes (read/write/manipulate)
- **opentype.js-compatible API** — `Path`, `Glyph`, `BoundingBox`, `parse()`, `load()` (via `ts-font-editor/opentype`)
- **Bidi helpers** — Arabic contextual shaping (init / medi / fina / isol)
- **Binary Reader/Writer** — typed `DataView` helpers (Fixed, LongDateTime, F2Dot14, Uint24, …)
- **bunfig-powered config** — auto-loads `./font-editor.config.ts`
- **CLI** — `font-editor convert` and `font-editor inspect`

## Install

```bash
bun add ts-font-editor
```

## Usage

```ts
import { readFileSync } from 'node:fs'
import { createFont, woff2 } from 'ts-font-editor'

// Read a font
const buffer = readFileSync('font.ttf')
const font = createFont(buffer.buffer, {
  type: 'ttf',
  subset: [0x41, 0x42], // only `A` and `B`
  kerning: true,
  hinting: true,
})

// Inspect
console.log(font.get().name.fontFamily)
console.log(font.get().glyf.length)

// Convert to WOFF
const woffBuffer = font.write({ type: 'woff' })

// Base64 data URI
const dataUri = font.toBase64({ type: 'woff' })

// WOFF2 (requires wasm)
await woff2.init('/path/to/woff2.wasm')
const woff2Buffer = font.write({ type: 'woff2' })
```

### Variable fonts

```ts
import { createFont, listAxes, listNamedInstances } from 'ts-font-editor'

const font = createFont(buffer, { type: 'ttf' })
if (font.isVariable()) {
  console.log(listAxes(font.get()))          // [{tag: 'wght', minValue, ...}]
  console.log(listNamedInstances(font.get()))
}

// Create a static instance by baking in axis values
const bold = font.createInstance({
  coordinates: { wght: 700 },
  updateName: true,
})
```

### Config

Create `font-editor.config.ts` in your project root — it auto-loads via `bunfig`:

```ts
import type { FontEditorConfig } from 'ts-font-editor'

const config: FontEditorConfig = {
  verbose: true,
  defaultFontType: 'ttf',
  readOptions: { kerning: true, hinting: false },
  writeOptions: { kerning: true },
}
export default config
```

### CLI

```bash
# Convert
font-editor convert input.ttf --to woff2 -o out.woff2
font-editor convert input.otf --to ttf -o out.ttf

# Inspect metadata (name, metrics, variable axes)
font-editor inspect input.ttf
```

## Development

```bash
bun i              # install deps
bun test           # run tests
bun run lint       # pickier
bun run build      # builds dist/
```

## Testing

```bash
bun test
```

## Changelog

Please see our [releases](https://github.com/stackjs/ts-font-editor/releases) page for more information on what has changed recently.

## Contributing

Please see [CONTRIBUTING](.github/CONTRIBUTING.md) for details.

## Community

For help, discussion about best practices, or any other conversation that would benefit from being searchable:

[Discussions on GitHub](https://github.com/stacksjs/ts-starter/discussions)

For casual chit-chat with others using this package:

[Join the Stacks Discord Server](https://discord.gg/stacksjs)

## Postcardware

“Software that is free, but hopes for a postcard.” We love receiving postcards from around the world showing where Stacks is being used! We showcase them on our website too.

Our address: Stacks.js, 12665 Village Ln #2306, Playa Vista, CA 90094, United States 🌎

## Sponsors

We would like to extend our thanks to the following sponsors for funding Stacks development. If you are interested in becoming a sponsor, please reach out to us.

- [JetBrains](https://www.jetbrains.com/)
- [The Solana Foundation](https://solana.com/)

## License

The MIT License (MIT). Please see [LICENSE](LICENSE.md) for more information.

Made with 💙

<!-- Badges -->
[npm-version-src]: https://img.shields.io/npm/v/ts-font-editor?style=flat-square
[npm-version-href]: https://npmjs.com/package/ts-font-editor
[github-actions-src]: https://img.shields.io/github/actions/workflow/status/stacksjs/ts-starter/ci.yml?style=flat-square&branch=main
[github-actions-href]: https://github.com/stacksjs/ts-starter/actions?query=workflow%3Aci

<!-- [codecov-src]: https://img.shields.io/codecov/c/gh/stacksjs/ts-starter/main?style=flat-square
[codecov-href]: https://codecov.io/gh/stacksjs/ts-starter -->
