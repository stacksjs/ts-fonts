export type CodePoint = number

export type FontType = 'ttf' | 'otf' | 'eot' | 'woff' | 'woff2' | 'svg' | 'symbol'

export type FontInput = ArrayBuffer | Uint8Array | string | { nodeType: number }
export type FontOutput = ArrayBuffer | Uint8Array | Buffer | string

export interface Point {
  x: number
  y: number
  onCurve?: boolean
}

export type Contour = Point[]

export interface CompoundTransform {
  a: number
  b: number
  c: number
  d: number
  e: number
  f: number
}

export interface CompoundGlyphRef {
  glyphIndex: number
  transform: CompoundTransform
  useMyMetrics?: boolean
  overlapCompound?: boolean
  points?: [number, number]
}

export interface Glyph {
  contours?: Contour[]
  compound?: boolean
  glyfs?: CompoundGlyphRef[]
  instructions?: number[]
  xMin: number
  yMin: number
  xMax: number
  yMax: number
  advanceWidth: number
  leftSideBearing: number
  name?: string
  unicode?: CodePoint[]
}

export interface HeadTable {
  version: number
  fontRevision: number
  checkSumAdjustment: number
  magickNumber: number
  flags: number
  unitsPerEm: number
  created: Date | number
  modified: Date | number
  xMin: number
  yMin: number
  xMax: number
  yMax: number
  macStyle: number
  lowestRecPPEM: number
  fontDirectionHint: number
  indexToLocFormat: number
  glyphDataFormat: number
}

export interface HheaTable {
  version: number
  ascent: number
  descent: number
  lineGap: number
  advanceWidthMax: number
  minLeftSideBearing: number
  minRightSideBearing: number
  xMaxExtent: number
  caretSlopeRise: number
  caretSlopeRun: number
  caretOffset: number
  reserved0: number
  reserved1: number
  reserved2: number
  reserved3: number
  metricDataFormat: number
  numOfLongHorMetrics: number
}

export interface MaxpTable {
  version: number
  numGlyphs: number
  maxPoints: number
  maxContours: number
  maxCompositePoints: number
  maxCompositeContours: number
  maxZones: number
  maxTwilightPoints: number
  maxStorage: number
  maxFunctionDefs: number
  maxInstructionDefs: number
  maxStackElements: number
  maxSizeOfInstructions: number
  maxComponentElements: number
  maxComponentDepth: number
}

export interface OS2Table {
  version: number
  xAvgCharWidth: number
  usWeightClass: number
  usWidthClass: number
  fsType: number
  ySubscriptXSize: number
  ySubscriptYSize: number
  ySubscriptXOffset: number
  ySubscriptYOffset: number
  ySuperscriptXSize: number
  ySuperscriptYSize: number
  ySuperscriptXOffset: number
  ySuperscriptYOffset: number
  yStrikeoutSize: number
  yStrikeoutPosition: number
  sFamilyClass: number
  bFamilyType: number
  bSerifStyle: number
  bWeight: number
  bProportion: number
  bContrast: number
  bStrokeVariation: number
  bArmStyle: number
  bLetterform: number
  bMidline: number
  bXHeight: number
  ulUnicodeRange1: number
  ulUnicodeRange2: number
  ulUnicodeRange3: number
  ulUnicodeRange4: number
  achVendID: string
  fsSelection: number
  usFirstCharIndex: number
  usLastCharIndex: number
  sTypoAscender: number
  sTypoDescender: number
  sTypoLineGap: number
  usWinAscent: number
  usWinDescent: number
  ulCodePageRange1: number
  ulCodePageRange2: number
  sxHeight: number
  sCapHeight: number
  usDefaultChar: number
  usBreakChar: number
  usMaxContext: number
}

export interface NameTable {
  fontFamily: string
  fontSubFamily: string
  uniqueSubFamily: string
  fullName: string
  version: string
  postScriptName: string
  copyright?: string
  trademark?: string
  manufacturer?: string
  designer?: string
  description?: string
  vendorURL?: string
  designerURL?: string
  license?: string
  licenseURL?: string
  preferredFamily?: string
  preferredSubFamily?: string
  compatibleFull?: string
  sampleText?: string
  /**
   * Arbitrary numeric nameIDs (typically 256+) for use by fvar axes and
   * named instances. Each entry becomes a name record at the given ID.
   */
  extra?: Array<{ nameID: number, value: string }>
  [k: string]: string | undefined | Array<{ nameID: number, value: string }>
}

export interface PostTable {
  format: number
  italicAngle: number
  underlinePosition: number
  underlineThickness: number
  isFixedPitch: number
  minMemType42: number
  maxMemType42: number
  minMemType1: number
  maxMemType1: number
  glyphNameIndex?: number[]
  names?: string[]
}

export interface Metrics {
  ascent: number
  descent: number
  sTypoAscender: number
  sTypoDescender: number
  usWinAscent: number
  usWinDescent: number
  sxHeight: number
  sCapHeight: number
}

export interface VariationAxis {
  tag: string
  minValue: number
  defaultValue: number
  maxValue: number
  flags: number
  nameID: number
  name?: string
}

export interface NamedInstance {
  subfamilyNameID: number
  postScriptNameID?: number
  flags: number
  coordinates: Record<string, number>
  name?: string
  postScriptName?: string
}

export interface FvarTable {
  majorVersion: number
  minorVersion: number
  axes: VariationAxis[]
  instances: NamedInstance[]
}

export interface AvarSegmentMap {
  axisTag?: string
  correspondence: Array<{ fromCoordinate: number, toCoordinate: number }>
}

export interface AvarTable {
  majorVersion: number
  minorVersion: number
  axisSegmentMaps: AvarSegmentMap[]
}

export interface StatAxis {
  tag: string
  nameID: number
  ordering: number
  name?: string
}

export interface StatAxisValue {
  format: number
  axisIndex: number
  flags: number
  valueNameID: number
  value?: number
  nominalValue?: number
  rangeMinValue?: number
  rangeMaxValue?: number
  linkedValue?: number
  name?: string
  axisValues?: Array<{ axisIndex: number, value: number }>
}

export interface StatTable {
  majorVersion: number
  minorVersion: number
  designAxes: StatAxis[]
  axisValues: StatAxisValue[]
  elidedFallbackNameID?: number
}

export interface GvarTuple {
  /** Peak coordinates in normalized (-1..1) space, indexed by axis. */
  peakCoords: number[]
  /** Intermediate tuple start (if non-default region). */
  intermediateStartCoords?: number[]
  /** Intermediate tuple end (if non-default region). */
  intermediateEndCoords?: number[]
  /**
   * Per-point deltas aligned with pointIndices.
   * If pointIndices is undefined, deltas apply to every point in order.
   */
  deltas: Array<{ x: number, y: number }>
  /** Explicit point indices this tuple affects (sparse tuple), or undefined for all points. */
  pointIndices?: number[]
}

export interface GvarGlyphVariation {
  tuples: GvarTuple[]
}

export interface GvarTable {
  majorVersion: number
  minorVersion: number
  axisCount: number
  sharedTuples: number[][]
  glyphVariations: GvarGlyphVariation[]
  /** Kept when parsing cannot fully decode tuples; preserves bytes for round-trip. */
  raw?: Uint8Array
}

export interface HvarTable {
  majorVersion: number
  minorVersion: number
  itemVariationStore?: unknown
  advanceWidthMapping?: unknown
  lsbMapping?: unknown
  rsbMapping?: unknown
  raw?: Uint8Array
}

export interface MvarTable {
  majorVersion: number
  minorVersion: number
  valueRecords: Array<{ tag: string, deltaSetOuterIndex: number, deltaSetInnerIndex: number }>
  raw?: Uint8Array
}

export interface KernTable {
  version: number
  subtables: Array<{
    version?: number
    length?: number
    coverage: number
    format: number
    pairs: Array<{ left: number, right: number, value: number }>
  }>
}

export interface GPOSTable {
  version: number
  raw?: Uint8Array
}

/**
 * A raw-bytes table that we preserve on round-trip without fully parsing.
 * Used for OpenType layout tables (GSUB, GPOS, GDEF, BASE, JSTF, MATH),
 * color tables (COLR, CPAL, SVG), and others.
 */
export interface RawTable {
  raw: Uint8Array
}

export interface UVSRecord {
  selector: number
  defaultUVS?: Array<{ startUnicode: number, additionalCount: number }>
  nonDefaultUVS?: Array<{ unicode: number, glyphID: number }>
}

export interface CmapFormat14 {
  uvsRecords: UVSRecord[]
}

export interface TTFObject {
  version: number
  numTables: number
  searchRange: number
  entrySelector: number
  rangeShift: number
  head: HeadTable
  glyf: Glyph[]
  cmap: Record<number, number>
  cmapFormat14?: CmapFormat14
  name: NameTable
  hhea: HheaTable
  post: PostTable
  maxp: MaxpTable
  'OS/2': OS2Table
  hmtx?: Array<{ advanceWidth: number, leftSideBearing: number }>
  loca?: number[]
  kern?: KernTable
  GPOS?: GPOSTable
  fpgm?: number[]
  cvt?: number[]
  prep?: number[]
  gasp?: number[]
  fvar?: FvarTable
  avar?: AvarTable
  STAT?: StatTable
  gvar?: GvarTable
  HVAR?: HvarTable
  MVAR?: MvarTable
  /**
   * Raw layout/color tables preserved on round-trip but not parsed
   * (GSUB, GPOS, GDEF, BASE, JSTF, MATH, COLR, CPAL, SVG, DSIG, meta, VORG, VVAR, VDMX, LTSH, PCLT, hdmx, vhea, vmtx).
   */
  rawTables?: Record<string, Uint8Array>
  support?: {
    tables?: Array<{ name: string, checkSum: number, offset: number, length: number, size: number }>
    head?: Partial<HeadTable>
    hhea?: Partial<HheaTable>
    [k: string]: unknown
  }
  subsetMap?: Record<number, number>
}

export interface FontReadOptions {
  type: FontType
  subset?: CodePoint[]
  hinting?: boolean
  kerning?: boolean
  compound2simple?: boolean
  inflate?: (data: Uint8Array) => Uint8Array
  combinePath?: boolean
}

export interface FontWriteOptions {
  type?: FontType
  toBuffer?: boolean
  hinting?: boolean
  kerning?: boolean
  writeZeroContoursGlyfData?: boolean
  metadata?: string
  deflate?: (data: Uint8Array) => Uint8Array
  support?: {
    head?: Partial<HeadTable>
    hhea?: Partial<HheaTable>
  }
}

export interface FindCondition {
  unicode?: CodePoint[] | CodePoint
  name?: string
  filter?: (glyph: Glyph) => boolean
}

export interface MergeOptions {
  scale?: number
  adjustGlyf?: boolean
}

export interface OptimizeResult {
  result: true | { repeat: number[] }
}

export interface IconObject {
  fontFamily: string
  iconPrefix: string
  glyfList: Array<{ code: string, codeName: string, name: string, id: string }>
}

export interface InstanceOptions {
  coordinates: Record<string, number>
  updateName?: boolean
  axisLimits?: Record<string, number | [number, number]>
}

export interface FontEditorConfig {
  verbose: boolean
  defaultFontType?: FontType
  writeOptions?: Partial<FontWriteOptions>
  readOptions?: Partial<Omit<FontReadOptions, 'type'>>
  woff2WasmUrl?: string
}
