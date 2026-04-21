# API reference

A flat catalog of public exports. Grouped by domain.

## Font class

| Export | Signature | Description |
| --- | --- | --- |
| `createFont` | `(buffer?, options?) => Font` | Create a Font from TTF/OTF/WOFF/WOFF2/EOT/SVG bytes or an empty font. |
| `Font` | class | High-level font wrapper: read/write/convert/find/merge. |
| `Font#read` | `(input, options)` | Parse font bytes into this instance. |
| `Font#write` | `(options)` | Serialize to TTF/WOFF/WOFF2/EOT/SVG bytes. |
| `Font#toBase64` | `(options)` | Serialize and encode as a data URI. |
| `Font#get` | `() => TTFObject` | Access the raw parsed object. |
| `Font#set` | `(ttf)` | Replace the underlying object. |
| `Font#optimize` | `(out?)` | Reduce redundant points, report duplicate unicodes. |
| `Font#compound2simple` | `()` | Flatten all compound glyphs. |
| `Font#sort` | `()` | Sort glyphs by unicode. |
| `Font#find` | `(condition)` | Find glyphs by unicode/name/filter. |
| `Font#merge` | `(otherFont, options?)` | Merge glyphs from another font. |
| `Font#createInstance` | `(options)` | Create a static instance of a variable font. |
| `Font#isVariable` | `() => boolean` | Whether the font has an `fvar` table. |
| `Font#getHelper` | `() => TTFHelper` | Imperative glyph-editing API. |

## TTF helper / readers / writers

| Export | Description |
| --- | --- |
| `TTFHelper` | Imperative glyph operations (addGlyf, removeGlyf, adjustGlyf, mergeGlyf, ...). |
| `TTFReader` | Low-level TTF reader class. |
| `TTFWriter` | Low-level TTF writer class. |
| `createTTFReader` / `createTTFWriter` | Factory helpers. |
| `getEmptyTTFObject` | Minimal TTF object (one `.notdef` glyph). |

## Converters

| Export | Description |
| --- | --- |
| `ttf2woff` / `woff2ttf` | TTF ⇄ WOFF. |
| `ttf2woff2` / `woff22ttf` | TTF ⇄ WOFF2 (via the pluggable `woff2` bridge). |
| `ttf2eot` / `eot2ttf` | TTF ⇄ EOT. |
| `ttf2svg` / `svg2ttfobject` | TTF ⇄ SVG (font and raw-path icon SVG). |
| `otf2ttfobject` | OTF → TTF with full CFF charstring interpreter. |
| `OTFReader` | Stream-style OTF reader class. |
| `ttf2icon` | Build an icon-font manifest (`iconPrefix`, `glyfList`). |
| `ttf2symbol` | Build an SVG sprite-sheet (`<symbol>` per glyph). |

## Base64 helpers

`ttf2base64`, `woff2base64`, `woff22base64`, `eot2base64`, `svg2base64`, `bytesToBase64`, `base64ToBytes`.

## Variable fonts

| Export | Description |
| --- | --- |
| `isVariableFont` | `(ttf) => boolean`. |
| `listAxes` / `listNamedInstances` | Introspection helpers. |
| `normalizeAxisValue` | Normalize a user-space coord to `-1..1`. |
| `normalizeCoordinates` | Normalize a coord map. |
| `normalizedCoordsArray` | Same, but as an axis-order array. |
| `applyAvarMap` | Apply avar segment map to a normalized coord. |
| `applyGvarToGlyph` | Bake gvar deltas onto a single glyph. |
| `createInstance` | Create a static instance from a variable font. |
| `buildVariableFont` | Build a variable font from N point-compatible masters. |

## Graphics utilities

`pathTransform`, `pathAdjust`, `pathCeil`, `pathRotate`, `pathSkew`, `pathSkewX`, `pathSkewY`, `pathIterator`.

`computeBoundingBox`, `computePath`, `computePathBox`, `quadraticBezierBounds`.

`reducePath`.

`movePaths`, `rotatePaths`, `mirrorPaths`, `flipPaths`.

`matrixMul`, `matrixMultiply`, `matrixTranslate`, `matrixScale`, `matrixRotate`, `matrixIdentity`.

## SVG helpers

`path2contours`, `contours2svg`, `glyph2svg`.

`oval2contour`, `rect2contour`, `polygon2contour`, `parsePolygonPoints`, `arcToQuadratics`.

`parseTransform`, `parseParams`, `transformToMatrix`, `composeTransforms`, `contoursTransform`.

## Glyph utilities

`glyfAdjust`, `reduceGlyf`, `compound2simpleglyf`, `optimizettf`.

`unicode2xml`, `unicode2esc`.

## Binary IO

`Reader`, `Writer` — typed DataView helpers for Fixed, LongDateTime, F2Dot14, Uint24, etc.

## Buffer helpers

`toArrayBuffer`, `toBuffer`.

## Config

`getConfig`, `defaultConfig`, `resetConfig`, `defineConfig`, `config` — all built on `bunfig`.

## WOFF2 bridge

`woff2` — `init(wasmUrl?)`, `encode(buffer)`, `decode(buffer)`, `setEncoder(fn)`, `setDecoder(fn)`, `isInited()`.
