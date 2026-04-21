# Complex features

Features that were previously documented as "known limitations" are now implemented.

## TrueType hinting interpreter

Executes TT bytecode to apply hinting corrections at a specific pixels-per-em. Useful for rasterizers, outline extractors, and fonts that rely on hints to preserve stem weights / baseline alignment at small sizes.

```ts
import { hintGlyph, createFont } from 'ts-font-editor'

const font = createFont(buffer, { type: 'ttf', hinting: true })
const ttf = font.get()
const glyphIndex = font.charToGlyphIndex('A')
const g = ttf.glyf[glyphIndex]

if (g.contours && g.instructions) {
  const allPoints: Array<{ x: number, y: number, onCurve: boolean }> = []
  const endPts: number[] = []
  for (const contour of g.contours) {
    for (const p of contour) allPoints.push({ x: p.x, y: p.y, onCurve: p.onCurve !== false })
    endPts.push(allPoints.length - 1)
  }

  const hintedPoints = hintGlyph(
    { points: allPoints, endPts, instructions: Uint8Array.from(g.instructions) },
    { unitsPerEm: ttf.head.unitsPerEm, fpgm: ttf.fpgm ? Uint8Array.from(ttf.fpgm) : undefined, prep: ttf.prep ? Uint8Array.from(ttf.prep) : undefined, cvt: ttf.cvt },
    16, // ppem
  )
  // hintedPoints contains integer-rounded, hinted coordinates
}
```

Supported opcodes: stack (DUP/POP/SWAP/DEPTH/CINDEX/MINDEX/ROLL), arithmetic (ADD/SUB/MUL/DIV/ABS/NEG/FLOOR/CEILING/MAX/MIN/ROUND/NROUND/ODD/EVEN), logical (LT/LTEQ/GT/GTEQ/EQ/NEQ/AND/OR/NOT), branching (IF/ELSE/EIF/JMPR/JROT/JROF), function definition (FDEF/ENDF/CALL/LOOPCALL/IDEF), graphics state (SRP0-2, SZP0-2, SZPS, SLOOP, SMD, SCVTCI, SSWCI, SSW, SVTCA/SPVTCA/SFVTCA, SPVFS/SFVFS/GPV/GFV/SFVTPV), rounding (RTG/RTHG/RTDG/RUTG/RDTG/ROFF/SROUND/S45ROUND), storage/CVT (RS/WS/RCVT/WCVTP/WCVTF), measurement (GC/SCFS/MD/MPPEM/MPS), point manipulation (MDAP/MIAP/MDRP/MIRP/MSIRP/ALIGNRP/IUP/IP/SHP/SHC/SHZ/SHPIX/FLIPPT/FLIPRGON/FLIPRGOFF), and control-flow stubs (SCANCTRL/SCANTYPE/INSTCTRL/GETINFO/GETVARIATION/DEBUG).

## WOFF2 glyf/loca transforms

The native WOFF2 encoder/decoder now supports the spec-compliant glyf transform (§5.1), producing output that matches Google's reference tool byte-for-byte for most inputs.

```ts
import { encodeGlyfTransform, decodeGlyfTransform } from 'ts-font-editor'

// Transform glyf+loca into a WOFF2-compatible byte stream
const transformed = encodeGlyfTransform(ttfBuffer)

// Reverse: recover glyf + loca from a transformed stream
const { glyf, loca, indexFormat } = decodeGlyfTransform(transformed)
```

Encoding uses the triplet-encoded coordinate scheme (§5.2) with adaptive flag selection, 255UInt16 packing for point counts, and bbox bitmap for composite glyphs. The encoded stream is what gets fed to Brotli.

## Universal Shaping Engine (USE)

Cluster-based shaper for Brahmi-derived scripts (Devanagari, Bengali, Gurmukhi, Gujarati, Tamil, Telugu, Kannada, Malayalam, Sinhala, Khmer, Myanmar, Tibetan):

```ts
import { formUseClusters, useCategory, useShape, USE_FEATURE_ORDER } from 'ts-font-editor'

// Classify a single codepoint
useCategory(0x094D) // 'H' (Virama)
useCategory(0x0915) // 'B' (Base: KA)
useCategory(0x093F) // 'VPre' (pre-base matra)

// Form clusters from a codepoint array
const clusters = formUseClusters([0x0930, 0x094D, 0x0915, 0x093F]) // RA + HALANT + KA + short-i
// → one cluster (RA+HALANT extends via halant to next base)
// → reordered: [0x093F, 0x0915, 0x0930, 0x094D] (pre-matra first, REPH at end)

// Shape a whole string
const reordered = useShape('र्कि') // returns the visually-ordered codepoint array

// Feature ordering for the GSUB application
for (const tag of USE_FEATURE_ORDER) {
  // Apply each feature in canonical USE order
}
```

The shaper covers:
- **Character categorization** for all major Brahmic scripts into USE categories (B, H, N, VPre, VPst, VM, etc.)
- **Cluster formation** with halant-joined consonant runs (conjuncts stay together)
- **Reordering**: pre-base matras moved to front, RA + Virama moved to end for REPH formation
- **Feature ordering**: `USE_FEATURE_ORDER` gives the canonical 18-feature sequence for GSUB application

The full USE spec has additional reordering rules (nukta ordering, pre-base halant consonants, main consonant detection, vowel clusters) that would need per-script tuning. Our categorization + cluster + reorder rules cover the common patterns that matter for Devanagari/Bengali/Gurmukhi/Gujarati/Tamil/Telugu/Kannada text rendering.
