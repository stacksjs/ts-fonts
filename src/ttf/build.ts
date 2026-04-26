/**
 * Procedural font construction.
 *
 * Build a complete `TTFObject` from a list of glyphs + family metadata,
 * suitable for handing to `TTFWriter` (TrueType outlines) or `OTFWriter`
 * (CFF outlines). This is the ts-fonts equivalent of opentype.js's
 *
 *   new opentype.Font({ familyName, styleName, glyphs, ... })
 *
 * It populates a sensible default for every required SFNT table so
 * consumers only have to supply what they care about.
 */

import type { Glyph, NameTable, OS2Table, PostTable, TTFObject } from '../types'
import { getEmptyTTFObject } from './empty'

export interface BuildFontOptions {
  /** Glyph list. Index 0 must be `.notdef`. */
  glyphs: Glyph[]
  /** UPM (units per em). Default 1000. */
  unitsPerEm?: number
  /** Hhea / OS-2 ascent. Default 0.8 × UPM. */
  ascender?: number
  /** Hhea / OS-2 descent (negative). Default −0.2 × UPM. */
  descender?: number
  /** OS/2 cap-height (default 0.7 × UPM). */
  capHeight?: number
  /** OS/2 x-height (default 0.5 × UPM). */
  xHeight?: number
  /** Italic angle in degrees (default 0). */
  italicAngle?: number
  /** Underline position (default −0.075 × UPM). */
  underlinePosition?: number
  /** Underline thickness (default 0.05 × UPM). */
  underlineThickness?: number
  /** OS/2 weight class (default 400). */
  weightClass?: number
  /** OS/2 width class (default 5). */
  widthClass?: number
  /** OS/2 vendor ID (4 ASCII chars; default 'NONE'). */
  vendorID?: string
  /** Family name (name ID 1). */
  familyName: string
  /** Style name (name ID 2). Default 'Regular'. */
  styleName?: string
  /** PostScript name (name ID 6). Default familyName + style joined. */
  postScriptName?: string
  /** Full name (name ID 4). Default familyName + style. */
  fullName?: string
  /** Version string (name ID 5). Default 'Version 1.000'. */
  version?: string
  /** Copyright (name ID 0). */
  copyright?: string
  /** License text (name ID 13). */
  license?: string
  /** License URL (name ID 14). */
  licenseURL?: string
  /** Designer (name ID 9). */
  designer?: string
  /** Designer URL (name ID 12). */
  designerURL?: string
  /** Manufacturer (name ID 8). */
  manufacturer?: string
  /** Trademark (name ID 7). */
  trademark?: string
  /** Description (name ID 10). */
  description?: string
}

/**
 * Build a complete TTFObject from a glyph list + branding metadata.
 * Pass the result to `TTFWriter` for TrueType output or `OTFWriter` for
 * CFF output; both consume the same TTFObject.
 */
export function buildFontFromGlyphs(opts: BuildFontOptions): TTFObject {
  const upm = opts.unitsPerEm ?? 1000
  const ascender = opts.ascender ?? Math.round(0.8 * upm)
  const descender = opts.descender ?? -Math.round(0.2 * upm)
  const capHeight = opts.capHeight ?? Math.round(0.7 * upm)
  const xHeight = opts.xHeight ?? Math.round(0.5 * upm)
  const styleName = opts.styleName ?? 'Regular'
  const postScriptName = opts.postScriptName
    ?? `${opts.familyName.replace(/\s+/g, '')}-${styleName.replace(/\s+/g, '')}`
  const fullName = opts.fullName ?? (styleName === 'Regular' ? opts.familyName : `${opts.familyName} ${styleName}`)
  const version = opts.version ?? 'Version 1.000'

  const glyphs = opts.glyphs
  if (glyphs.length === 0 || glyphs[0]!.name !== '.notdef') {
    throw new Error('buildFontFromGlyphs: first glyph must be .notdef')
  }

  // Aggregate font-wide bounds + max contour/point counts.
  let xMin = Infinity, yMin = Infinity, xMax = -Infinity, yMax = -Infinity
  let maxContours = 0, maxPoints = 0, advMax = 0, advMin = Infinity
  for (const g of glyphs) {
    if (g.contours && g.contours.length > 0) {
      if (g.xMin < xMin) xMin = g.xMin
      if (g.yMin < yMin) yMin = g.yMin
      if (g.xMax > xMax) xMax = g.xMax
      if (g.yMax > yMax) yMax = g.yMax
      maxContours = Math.max(maxContours, g.contours.length)
      maxPoints = Math.max(maxPoints, g.contours.reduce((s, c) => s + c.length, 0))
    }
    const aw = g.advanceWidth ?? 0
    if (aw > advMax) advMax = aw
    if (aw < advMin) advMin = aw
  }
  if (!Number.isFinite(xMin)) { xMin = 0; yMin = 0; xMax = 0; yMax = 0 }

  const ttf = getEmptyTTFObject()
  ttf.glyf = glyphs

  // Build cmap from glyph .unicode entries.
  const cmap: Record<number, number> = {}
  for (let i = 0; i < glyphs.length; i++) {
    const g = glyphs[i]!
    if (Array.isArray(g.unicode)) {
      for (const cp of g.unicode) cmap[cp] = i
    }
    else if (typeof (g as Glyph & { unicode?: number }).unicode === 'number') {
      cmap[(g as Glyph & { unicode?: number }).unicode!] = i
    }
  }
  ttf.cmap = cmap

  // head
  ttf.head = {
    ...(ttf.head ?? {}),
    version: 1.0,
    fontRevision: 1.0,
    checkSumAdjustment: 0,
    magicNumber: 0x5F0F3CF5,
    flags: 0x000B,
    unitsPerEm: upm,
    created: ttf.head?.created ?? 0,
    modified: ttf.head?.modified ?? 0,
    xMin, yMin, xMax, yMax,
    macStyle: ttf.head?.macStyle ?? 0,
    lowestRecPPEM: 6,
    fontDirectionHint: 2,
    indexToLocFormat: 0,
    glyphDataFormat: 0,
  } as TTFObject['head']

  // hhea
  ttf.hhea = {
    ...(ttf.hhea ?? {}),
    version: 1.0,
    ascent: ascender,
    descent: descender,
    lineGap: 0,
    advanceWidthMax: advMax,
    minLeftSideBearing: 0,
    minRightSideBearing: 0,
    xMaxExtent: xMax,
    caretSlopeRise: 1,
    caretSlopeRun: 0,
    caretOffset: 0,
    metricDataFormat: 0,
    numOfLongHorMetrics: glyphs.length,
  } as TTFObject['hhea']

  // maxp (v1.0 with TT-specific counts; OTF writer downgrades to v0.5).
  ttf.maxp = {
    ...(ttf.maxp ?? {}),
    version: 1.0,
    numGlyphs: glyphs.length,
    maxPoints,
    maxContours,
    maxComponentPoints: 0,
    maxComponentContours: 0,
    maxZones: 2,
    maxTwilightPoints: 0,
    maxStorage: 0,
    maxFunctionDefs: 0,
    maxInstructionDefs: 0,
    maxStackElements: 0,
    maxSizeOfInstructions: 0,
    maxComponentElements: 0,
    maxComponentDepth: 0,
  } as TTFObject['maxp']

  // OS/2
  const os2: Partial<OS2Table> = {
    version: 4,
    xAvgCharWidth: Math.round(advMin === Infinity ? upm / 2 : (advMax + advMin) / 2),
    usWeightClass: opts.weightClass ?? 400,
    usWidthClass: opts.widthClass ?? 5,
    fsType: 0,
    ySubscriptXSize: Math.round(0.65 * upm),
    ySubscriptYSize: Math.round(0.7 * upm),
    ySubscriptXOffset: 0,
    ySubscriptYOffset: Math.round(0.14 * upm),
    ySuperscriptXSize: Math.round(0.65 * upm),
    ySuperscriptYSize: Math.round(0.7 * upm),
    ySuperscriptXOffset: 0,
    ySuperscriptYOffset: Math.round(0.48 * upm),
    yStrikeoutSize: Math.round(0.05 * upm),
    yStrikeoutPosition: Math.round(0.26 * upm),
    sFamilyClass: 0,
    bFamilyType: 0,
    bSerifStyle: 0,
    bWeight: 0,
    bProportion: 0,
    bContrast: 0,
    bStrokeVariation: 0,
    bArmStyle: 0,
    bLetterform: 0,
    bMidline: 0,
    bXHeight: 0,
    ulUnicodeRange1: 0xFFFFFFFF,
    ulUnicodeRange2: 0xFFFFFFFF,
    ulUnicodeRange3: 0xFFFFFFFF,
    ulUnicodeRange4: 0xFFFFFFFF,
    achVendID: opts.vendorID ?? 'NONE',
    fsSelection: styleName.toLowerCase().includes('italic') ? 0x01 : (styleName === 'Regular' ? 0xC0 : 0x80),
    usFirstCharIndex: 0x0020,
    usLastCharIndex: 0xFFFF,
    sTypoAscender: ascender,
    sTypoDescender: descender,
    sTypoLineGap: 0,
    usWinAscent: ascender,
    usWinDescent: -descender,
    ulCodePageRange1: 1,
    ulCodePageRange2: 0,
    sxHeight: xHeight,
    sCapHeight: capHeight,
    usDefaultChar: 0,
    usBreakChar: 0x20,
    usMaxContext: 1,
  }
  ttf['OS/2'] = os2 as OS2Table

  // post (v3 — no glyph names)
  const post: Partial<PostTable> = {
    format: 3,
    italicAngle: opts.italicAngle ?? 0,
    underlinePosition: opts.underlinePosition ?? -Math.round(0.075 * upm),
    underlineThickness: opts.underlineThickness ?? Math.round(0.05 * upm),
    isFixedPitch: 0,
    minMemType42: 0,
    maxMemType42: 0,
    minMemType1: 0,
    maxMemType1: 0,
  }
  ttf.post = post as PostTable

  // name
  const name: NameTable = {
    copyright: opts.copyright ?? '',
    fontFamily: opts.familyName,
    fontSubFamily: styleName,
    uniqueSubFamily: `${opts.familyName} ${styleName} ${version}`,
    fullName,
    version,
    postScriptName,
    trademark: opts.trademark ?? '',
    manufacturer: opts.manufacturer ?? '',
    designer: opts.designer ?? '',
    description: opts.description ?? '',
    vendorURL: '',
    designerURL: opts.designerURL ?? '',
    license: opts.license ?? '',
    licenseURL: opts.licenseURL ?? '',
    preferredFamily: opts.familyName,
    preferredSubFamily: styleName,
    compatibleFull: fullName,
    sampleText: '',
  } as unknown as NameTable
  ttf.name = name

  // hmtx (parallel to glyf)
  ttf.hmtx = glyphs.map(g => ({
    advanceWidth: g.advanceWidth ?? 0,
    leftSideBearing: g.leftSideBearing ?? 0,
  }))

  return ttf
}
