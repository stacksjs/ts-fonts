# Variable fonts

`ts-font-editor` fully parses the OpenType variable-font tables (`fvar`, `avar`, `STAT`, `gvar`, `HVAR`, `MVAR`) and can create static instances from a variable font or build a variable font from a set of point-compatible master fonts.

## Inspecting a variable font

```ts
import { readFileSync } from 'node:fs'
import { createFont, isVariableFont, listAxes, listNamedInstances } from 'ts-font-editor'

const raw = readFileSync('Inter-VariableFont.ttf')
const font = createFont(raw.buffer.slice(0), { type: 'ttf' })

if (isVariableFont(font.get())) {
  for (const axis of listAxes(font.get())) {
    console.log(`${axis.tag}: ${axis.minValue} → ${axis.maxValue} (default ${axis.defaultValue})`)
  }

  for (const instance of listNamedInstances(font.get())) {
    console.log(instance.name, instance.coordinates)
  }
}
```

## Creating a static instance

Bake axis coordinates into glyph outlines by applying gvar deltas:

```ts
import { listAxes } from 'ts-font-editor'

const axes = listAxes(font.get())
const coordinates: Record<string, number> = {}
for (const axis of axes)
  coordinates[axis.tag] = axis.tag === 'wght' ? 700 : axis.defaultValue

const bold = font.createInstance({
  coordinates,
  updateName: true,   // append axis values to family/full name
})

// If every axis is specified, the result is a pure static font:
console.log(bold.isVariable()) // false

// Write as a regular TTF
const ttfBuf = bold.write({ type: 'ttf' })
```

If only a subset of axes are specified, the remaining axes stay variable and their ranges are preserved.

## Normalizing coordinates

For advanced use, access the normalization helpers directly:

```ts
import { normalizeAxisValue, normalizeCoordinates, normalizedCoordsArray } from 'ts-font-editor'

// For one axis:
const n = normalizeAxisValue(axis, 700) // 0..1

// For every axis (axis-tag keyed):
const coords = normalizeCoordinates(font.get(), { wght: 700, slnt: -10 })
// { wght: 1, slnt: -1 }

// As an array aligned with fvar.axes order:
const coordsArr = normalizedCoordsArray(font.get(), { wght: 700 })
```

The `avar` segment map is automatically applied when present.

## Building a variable font from masters

```ts
import { buildVariableFont } from 'ts-font-editor'

// Each master must share the same point counts per glyph
const variable = buildVariableFont({
  axes: [
    { tag: 'wght', name: 'Weight', minValue: 100, defaultValue: 400, maxValue: 900 },
  ],
  masters: [
    { location: { wght: 400 }, font: regularTtf },
    { location: { wght: 700 }, font: boldTtf },
    { location: { wght: 900 }, font: blackTtf },
  ],
  instances: [
    { name: 'Regular', location: { wght: 400 } },
    { name: 'Bold', location: { wght: 700 } },
    { name: 'Black', location: { wght: 900 } },
  ],
  emitStat: true,
})

// `variable` is a TTFObject with fvar + gvar
import { TTFWriter } from 'ts-font-editor'
const buf = new TTFWriter().write(variable)
```

## Applying gvar deltas manually

For low-level use (e.g. writing your own instancer or renderer):

```ts
import { applyGvarToGlyph, normalizedCoordsArray } from 'ts-font-editor'

const normalized = normalizedCoordsArray(ttf, { wght: 700 })
const glyph = ttf.glyf[65] // 'A'
const variation = ttf.gvar!.glyphVariations[65]

const variedGlyph = applyGvarToGlyph(glyph, variation, normalized)
```

## Name records and `name.extra`

Variable fonts typically use name records at IDs 256+ for axis and instance labels. These are stored on the parsed object as `name.extra`:

```ts
const ttf = font.get()
for (const entry of ttf.name.extra ?? [])
  console.log(entry.nameID, entry.value)

// Round-tripped through write/read
```
