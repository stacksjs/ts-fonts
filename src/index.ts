export { config, defaultConfig, defineConfig, getConfig, resetConfig } from './config'
export { eot2ttf } from './converters/eot2ttf'
export { OTFReader } from './converters/otfreader'
export { otf2ttfobject } from './converters/otf2ttfobject'
export { svg2ttfobject } from './converters/svg2ttfobject'
export { ttf2eot } from './converters/ttf2eot'
export { ttf2icon } from './converters/ttf2icon'
export { ttf2svg } from './converters/ttf2svg'
export { ttf2symbol } from './converters/ttf2symbol'
export { ttf2woff } from './converters/ttf2woff'
export { ttf2woff2, woff22ttf } from './converters/ttf2woff2'
export { woff2ttf } from './converters/woff2ttf'

// Graphics / path utilities
export type { BBox } from './graphics/bounding-box'
export {
  computeBoundingBox,
  computePath,
  computePathBox,
  computePathBoxFromList,
  quadraticBezierBounds,
} from './graphics/bounding-box'
export type { Matrix } from './graphics/matrix'
export {
  identity as matrixIdentity,
  mul as matrixMul,
  multiply as matrixMultiply,
  rotate as matrixRotate,
  scale as matrixScale,
  translate as matrixTranslate,
} from './graphics/matrix'
export {
  pathAdjust,
  pathCeil,
  pathIterator,
  pathRotate,
  pathSkew,
  pathSkewX,
  pathSkewY,
  pathTransform,
} from './graphics/path-transforms'
export {
  flip as flipPaths,
  mirror as mirrorPaths,
  move as movePaths,
  rotate as rotatePaths,
} from './graphics/paths-util'
export { reducePath } from './graphics/reduce-path'

// Binary IO
export { Reader } from './io/reader'
export { Writer } from './io/writer'

// SVG
export { arcToQuadratics } from './svg/arc'
export { contours2svg, glyph2svg, path2contours } from './svg/path'
export { oval2contour, parsePolygonPoints, polygon2contour, rect2contour } from './svg/shapes'
export type { TransformOp } from './svg/transform'
export {
  composeTransforms,
  contoursTransform,
  parseParams,
  parseTransform,
  transformToMatrix,
} from './svg/transform'

// TTF core
export type { BuildFontOptions } from './ttf/build'
export { buildFontFromGlyphs } from './ttf/build'
export { getEmptyTTFObject } from './ttf/empty'
export * from './ttf/enum'
export { createFont, Font } from './ttf/font'
export { createTTFReader, TTFReader } from './ttf/reader'
export { TTFHelper } from './ttf/ttf'
export { createTTFWriter, TTFWriter } from './ttf/writer'

export * from './types'
export {
  base64ToBytes,
  bytesToBase64,
  eot2base64,
  svg2base64,
  ttf2base64,
  woff22base64,
  woff2base64,
} from './util/base64'
export { toArrayBuffer, toBuffer } from './util/buffer'
export type { BezPoint } from './util/bezier'
export { cubicToQuadratic } from './util/bezier'
export { compound2simpleglyf, glyfAdjust, optimizettf, reduceGlyf } from './util/glyph-ops'
export type { SubsetOptions } from './util/subset'
export { subsetGlyphs } from './util/subset'
export { unicode2esc, unicode2xml } from './util/unicode-xml'

// Variable fonts
export type {
  AxisInput,
  BuildVariableFontOptions,
  MasterInput,
  NamedInstanceInput,
} from './variable/build'
export { buildVariableFont } from './variable/build'
export {
  applyAvarMap,
  applyGvarToGlyph,
  createInstance,
  isVariableFont,
  listAxes,
  listNamedInstances,
  normalizeAxisValue,
  normalizeCoordinates,
  normalizedCoordsArray,
} from './variable/instance'

// CFF / OTF writing
export type { CffWriteOptions } from './cff/writer'
export { writeCFF } from './cff/writer'
export { encodeCharstring } from './cff/charstring-encoder'
export type { OTFWriterOptions } from './cff/otf-writer'
export { createOTFWriter, OTFWriter } from './cff/otf-writer'

// GSUB authoring
export type { SubstitutionAlternateInput, SubstitutionInput, SubstitutionLigatureInput, SubstitutionMultipleInput, SubstitutionSingleInput } from './ot/substitution'
export { Substitution } from './ot/substitution'
export type { GsubAlternateEntry, GsubAuthoring, GsubFeatureAuthoring, GsubLigatureEntry, GsubMultipleEntry, GsubSingleEntry } from './types'

// GPOS authoring
export { Positioning } from './ot/positioning'
export type { GposAuthoring, GposFeatureAuthoring, GposPairEntry, GposValueRecord } from './types'

// WOFF2 bridge
export { woff2 } from './woff2'

// opentype.js-compatible layer (Path, Glyph, BoundingBox, parse, etc.)
export type {
  AlternateSub,
  ArabicForm,
  BGRA,
  BidiClass,
  BidiResult,
  CanvasLike,
  ColorFormat,
  ColorStop,
  ColorValue,
  ColrBaseGlyphRecord,
  ColrData,
  ColrLayer,
  ColrV1Data,
  ColrV1Record,
  CpalData,
  FeatureTable,
  GlyphMetrics,
  GlyphOptions,
  GlyphRenderOptions,
  GposKerning,
  GsubTables,
  LangSysTable,
  LayoutHeader,
  LigatureSub,
  LookupTable,
  MultipleSub,
  Paint,
  PathCommand,
  PathDataOptions,
  PathFromSvgOptions,
  PdfFontDescriptor,
  Script,
  ScriptTable,
  SingleSub,
  SinglePos,
  TextLayoutOptions,
} from './ot'
export {
  BoundingBox,
  CPAL_PALETTE_TYPE,
  Glyph as OTGlyph,
  LayerManager,
  PaletteManager,
  Path,
  arabicForms,
  bgraToObject,
  bidi,
  bidiClass,
  buildCidToGidMap,
  buildFontDescriptor,
  buildKerningLookup,
  buildPdfEmbedding,
  buildToUnicodeCMap,
  buildWidthsArray,
  canJoinLeft,
  canJoinRight,
  charToGlyph,
  charToGlyphIndex,
  contoursToPath,
  coverageIndex,
  defaultFeaturesForScript,
  detectDominantScript,
  detectScript,
  drawText,
  forEachGlyph,
  formatColor,
  getAdvanceWidth,
  isArabic,
  load,
  loadCollection,
  lookupsForFeature,
  objectToBgra,
  paragraphLevel,
  parse,
  parseCOLR,
  parseCOLRv1,
  parseCPAL,
  parseCollection,
  parseColor,
  readClassDef,
  readCoverage,
  readGposKerning,
  readGposSinglePositioning,
  readGsubFeatures,
  readLayoutHeader,
  reorderDevanagari,
  reorderThai,
  serializeCOLR,
  serializeCPAL,
  stringToGlyphIndexes,
  stringToGlyphs,
  subsetLayoutTable,
  tinyInflate,
  tinyInflateTo,
  toVisualOrder,
} from './ot'

// TTC / validation / hinting
export type { TTCInfo } from './ttf/ttc'
export { buildTTC, extractTTCFont, isTTC, readTTCHeader } from './ttf/ttc'
export type { ValidationWarning } from './util/validate'
export { validateTTF } from './util/validate'
export { countInstructions, disassemble, TT_INSTRUCTIONS, validateInstructions } from './util/hinting'

// Native WOFF2
export type { BrotliCompressor, BrotliDecompressor } from './woff2/native'
export { decodeWOFF2Native, encodeWOFF2Native, setBrotli } from './woff2/native'
export { decodeGlyfTransform, encodeGlyfTransform } from './woff2/transform'

// USE shaper + TT hinting interpreter (re-exported from ./ot)
export type {
  HintFontTables,
  HintGlyphInput,
  HintingContext,
  HintingGraphicsState,
  UseCategory,
  UseCluster,
} from './ot'
export {
  executeHintingBytecode,
  formUseClusters,
  hintGlyph,
  USE_FEATURE_ORDER,
  useCategory,
  useShape,
} from './ot'
