# Configuration

`ts-font-editor` auto-loads configuration from `./font-editor.config.ts` (or `.js`) via `bunfig`. Drop a file at your project root and it will be picked up the first time you call `getConfig()`.

```ts
// font-editor.config.ts
import type { FontEditorConfig } from 'ts-font-editor'

const config: FontEditorConfig = {
  /** Enable verbose console output (default true). */
  verbose: true,

  /** Default type assumed when a file extension can't be inferred. */
  defaultFontType: 'ttf',

  /** Default options applied when reading fonts. */
  readOptions: {
    hinting: false,
    kerning: false,
    compound2simple: false,
  },

  /** Default options applied when writing fonts. */
  writeOptions: {
    hinting: false,
    kerning: false,
  },

  /** Optional: point at a WASM binary for woff2 encode/decode. */
  woff2WasmUrl: '/path/to/woff2.wasm',
}

export default config
```

Then, at runtime:

```ts
import { getConfig } from 'ts-font-editor'

const config = await getConfig()
console.log(config.defaultFontType) // 'ttf'
```

## Override or reset

```ts
import { defaultConfig, resetConfig } from 'ts-font-editor'

// Reset the cached config (e.g. in tests)
resetConfig()

// Use the default config directly
console.log(defaultConfig)
```

## Typed helper

```ts
import { defineConfig } from 'ts-font-editor'

export default defineConfig({
  verbose: false,
  readOptions: { kerning: true },
})
```

## WOFF2 WASM

WOFF2 uses Brotli + glyph/gvar transforms. To enable WOFF2 encode/decode in the browser or environments without a bundled WASM, either:

1. Point `woff2WasmUrl` at your WASM binary — the library will call `woff2.init(url)` on first use.
2. Provide your own encoder/decoder:

   ```ts
   import { woff2 } from 'ts-font-editor'
   woff2.setEncoder(myEncoder)
   woff2.setDecoder(myDecoder)
   ```
