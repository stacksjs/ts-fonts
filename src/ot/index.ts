/**
 * opentype.js-compatible API surface. Import via:
 *
 *   import { parse, Font, Glyph, Path, BoundingBox } from 'ts-font-editor'
 *
 * (Or the subpath: `import { parse } from 'ts-font-editor/opentype'`.)
 */

export type { ArabicForm } from './bidi'
export { arabicForms, canJoinLeft, canJoinRight, isArabic, toVisualOrder } from './bidi'
export { BoundingBox } from './bounding-box'
export type { ColorStop, ColrV1Data, ColrV1Record, Paint } from './colr-v1'
export { parseCOLRv1 } from './colr-v1'
export type { BGRA, ColorFormat, ColorValue } from './colors'
export { bgraToObject, formatColor, objectToBgra, parseColor } from './colors'
export type { GlyphMetrics, GlyphOptions, GlyphRenderOptions } from './glyph'
export { Glyph, contoursToPath } from './glyph'
export type { GposKerning, SinglePos } from './gpos'
export { readGposKerning, readGposSinglePositioning } from './gpos'
export type { AlternateSub, GsubTables, LigatureSub, MultipleSub, SingleSub } from './gsub'
export { readGsubFeatures } from './gsub'
export { buildKerningLookup } from './kerning'
export type { FeatureTable, LangSysTable, LayoutHeader, LookupTable, ScriptTable } from './layout-common'
export { coverageIndex, lookupsForFeature, readClassDef, readCoverage, readLayoutHeader } from './layout-common'
export type { TextLayoutOptions } from './layout'
export {
  charToGlyph,
  charToGlyphIndex,
  drawText,
  forEachGlyph,
  getAdvanceWidth,
  stringToGlyphIndexes,
  stringToGlyphs,
} from './layout'
export type { ColrBaseGlyphRecord, ColrData, ColrLayer } from './layers'
export { LayerManager, parseCOLR, serializeCOLR } from './layers'
export type { CpalData } from './palettes'
export { CPAL_PALETTE_TYPE, PaletteManager, parseCPAL, serializeCPAL } from './palettes'
export { load, loadCollection, parse, parseCollection } from './parse'
export type { CanvasLike, PathCommand, PathDataOptions, PathFromSvgOptions } from './path'
export { Path } from './path'
export type { PdfFontDescriptor } from './pdf'
export { buildCidToGidMap, buildFontDescriptor, buildPdfEmbedding, buildToUnicodeCMap, buildWidthsArray } from './pdf'
export type { Script } from './shaping'
export { defaultFeaturesForScript, detectDominantScript, detectScript, reorderDevanagari, reorderThai } from './shaping'
export { subsetLayoutTable } from './subset-layout'
export { inflate as tinyInflate, inflateTo as tinyInflateTo } from './tiny-inflate'
export type { BidiClass, BidiResult } from './uax9'
export { bidi, bidiClass, paragraphLevel } from './uax9'

// USE shaper
export type { UseCategory, UseCluster } from './use'
export { formUseClusters, USE_FEATURE_ORDER, useCategory, useShape } from './use'

// TT hinting interpreter
export type { HintFontTables, HintGlyphInput, HintingContext, HintingGraphicsState } from './hinting-interp'
export { execute as executeHintingBytecode, hintGlyph } from './hinting-interp'
