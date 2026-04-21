import type {
  FindCondition,
  FontInput,
  FontReadOptions,
  FontWriteOptions,
  Glyph,
  InstanceOptions,
  MergeOptions,
  OptimizeResult,
  TTFObject,
} from '../types'
import { eot2ttf } from '../converters/eot2ttf'
import { otf2ttfobject } from '../converters/otf2ttfobject'
import { svg2ttfobject } from '../converters/svg2ttfobject'
import { ttf2eot } from '../converters/ttf2eot'
import { ttf2svg } from '../converters/ttf2svg'
import { ttf2woff } from '../converters/ttf2woff'
import { ttf2woff2, woff22ttf } from '../converters/ttf2woff2'
import { woff2ttf } from '../converters/woff2ttf'
import {
  bytesToBase64,
  eot2base64,
  svg2base64,
  ttf2base64,
  woff22base64,
  woff2base64,
} from '../util/base64'
import { toArrayBuffer, toBuffer } from '../util/buffer'
import type { ValidationWarning } from '../util/validate'
import { validateTTF } from '../util/validate'
import { createInstance as createVariableInstance } from '../variable/instance'
import { Glyph as OTGlyph } from '../ot/glyph'
import { buildKerningLookup } from '../ot/kerning'
import type { TextLayoutOptions } from '../ot/layout'
import {
  charToGlyph as otCharToGlyph,
  charToGlyphIndex as otCharToGlyphIndex,
  drawText,
  forEachGlyph as otForEachGlyph,
  getAdvanceWidth as otGetAdvanceWidth,
  stringToGlyphIndexes as otStringToGlyphIndexes,
  stringToGlyphs as otStringToGlyphs,
} from '../ot/layout'
import { LayerManager } from '../ot/layers'
import { PaletteManager } from '../ot/palettes'
import { Path } from '../ot/path'
import type { CanvasLike } from '../ot/path'
import { getEmptyTTFObject } from './empty'
import { TTFReader } from './reader'
import { TTFHelper } from './ttf'
import { TTFWriter } from './writer'

function isNodeOrBun(): boolean {
  const g = globalThis as unknown as { process?: { versions?: { node?: string, bun?: string } } }
  return !!(g.process?.versions?.node || g.process?.versions?.bun)
}

// eslint-disable-next-line pickier/no-unused-vars
type FontForEachGlyphCallback = (glyph: OTGlyph, x: number, y: number, fontSize: number, opts: TextLayoutOptions) => void

function normalizeInput(input: FontInput): ArrayBuffer | string | { nodeType: number } {
  if (typeof input === 'string') return input
  if (input instanceof ArrayBuffer) return input
  if (input instanceof Uint8Array) {
    return (input.buffer as ArrayBuffer).slice(input.byteOffset, input.byteOffset + input.byteLength)
  }
  // { nodeType: number }
  return input as { nodeType: number }
}

export class Font {
  data: TTFObject
  type?: string

  constructor(buffer?: FontInput | TTFObject, options: FontReadOptions = { type: 'ttf' }) {
    if (!buffer) {
      this.data = getEmptyTTFObject()
      return
    }
    // TTFObject
    if (typeof buffer === 'object' && 'glyf' in (buffer as object)) {
      this.data = buffer as TTFObject
      return
    }
    this.data = getEmptyTTFObject()
    this.read(buffer as FontInput, options)
  }

  static create(buffer?: FontInput, options?: FontReadOptions): Font {
    return new Font(buffer, options)
  }

  static toBase64(buffer: ArrayBuffer | Uint8Array | string): string {
    if (typeof buffer === 'string') {
      const g = globalThis as unknown as { Buffer?: { from: (s: string, enc: string) => { toString: (enc: string) => string } }, btoa?: (s: string) => string }
      if (g.Buffer) return g.Buffer.from(buffer, 'binary').toString('base64')
      if (g.btoa) return g.btoa(buffer)
      throw new Error('No base64 encoder available')
    }
    return bytesToBase64(buffer)
  }

  readEmpty(): this {
    this.data = getEmptyTTFObject()
    return this
  }

  read(input: FontInput, options: FontReadOptions): this {
    const buffer = normalizeInput(input)
    const type = options.type

    if (type === 'svg') {
      this.data = svg2ttfobject(buffer as string | { nodeType: number }, { combinePath: options.combinePath ?? false })
    }
    else if (type === 'ttf') {
      this.data = new TTFReader(options).read(buffer as ArrayBuffer)
    }
    else if (type === 'otf') {
      this.data = otf2ttfobject(buffer as ArrayBuffer, { subset: options.subset })
    }
    else if (type === 'eot') {
      const ttf = eot2ttf(buffer as ArrayBuffer)
      this.data = new TTFReader(options).read(ttf)
    }
    else if (type === 'woff') {
      const ttf = woff2ttf(buffer as ArrayBuffer, { inflate: options.inflate })
      this.data = new TTFReader(options).read(ttf)
    }
    else if (type === 'woff2') {
      const ttf = woff22ttf(buffer as ArrayBuffer)
      const ab = (ttf.buffer as ArrayBuffer).slice(ttf.byteOffset, ttf.byteOffset + ttf.byteLength)
      this.data = new TTFReader(options).read(ab)
    }
    else {
      throw new Error(`unsupported font type: ${type}`)
    }

    this.type = type
    return this
  }

  write(options: FontWriteOptions = {}): ArrayBuffer | Uint8Array | Buffer | string {
    const type = options.type ?? (this.type as FontWriteOptions['type']) ?? 'ttf'

    let result: ArrayBuffer | Uint8Array | string
    if (type === 'ttf') {
      result = new TTFWriter(options).write(this.data)
    }
    else if (type === 'eot') {
      const ttf = new TTFWriter(options).write(this.data)
      result = ttf2eot(ttf)
    }
    else if (type === 'woff') {
      const ttf = new TTFWriter(options).write(this.data)
      result = ttf2woff(ttf, { metadata: options.metadata, deflate: options.deflate })
    }
    else if (type === 'woff2') {
      const ttf = new TTFWriter(options).write(this.data)
      result = ttf2woff2(ttf)
    }
    else if (type === 'svg') {
      return ttf2svg(this.data, { metadata: options.metadata })
    }
    else if (type === 'symbol') {
      return ttf2svg(this.data, { metadata: options.metadata })
    }
    else {
      throw new Error(`unsupported font type: ${type}`)
    }

    if (options.toBuffer !== false && isNodeOrBun() && result instanceof ArrayBuffer)
      return toBuffer(result)
    if (options.toBuffer === true && isNodeOrBun() && result instanceof Uint8Array)
      return toBuffer(result)

    return result
  }

  toBase64(options: FontWriteOptions = {}, buffer?: FontInput): string {
    const type = options.type ?? (this.type as FontWriteOptions['type']) ?? 'ttf'
    let data: ArrayBuffer | Uint8Array | string
    if (buffer) {
      data = normalizeInput(buffer) as ArrayBuffer
    }
    else {
      data = this.write({ ...options, toBuffer: false }) as ArrayBuffer | Uint8Array | string
    }

    if (type === 'svg' || type === 'symbol')
      return svg2base64(data as string, type === 'symbol' ? 'image/svg+xml' : 'image/svg+xml')
    if (type === 'ttf') return ttf2base64(toArrayBuffer(data as ArrayBuffer))
    if (type === 'woff') return woff2base64(toArrayBuffer(data as ArrayBuffer))
    if (type === 'woff2') return woff22base64(data as ArrayBuffer | Uint8Array)
    if (type === 'eot') return eot2base64(toArrayBuffer(data as ArrayBuffer))
    throw new Error(`unsupported type: ${type}`)
  }

  set(data: TTFObject): this {
    this.data = data
    return this
  }

  get(): TTFObject {
    return this.data
  }

  optimize(out?: OptimizeResult): this {
    const result = this.getHelper().optimize()
    if (out)
      out.result = result.result
    return this
  }

  compound2simple(): this {
    const helper = this.getHelper()
    helper.compound2simple()
    this.data = helper.get()
    return this
  }

  sort(): this {
    const helper = this.getHelper()
    helper.sortGlyf()
    this.data = helper.get()
    return this
  }

  find(condition: FindCondition): Glyph[] {
    const helper = this.getHelper()
    const indexList = helper.findGlyf(condition)
    return indexList.length ? helper.getGlyf(indexList) : []
  }

  merge(font: Font, options?: MergeOptions): this {
    const helper = this.getHelper()
    helper.mergeGlyf(font.get(), options)
    this.data = helper.get()
    return this
  }

  getHelper(): TTFHelper {
    return new TTFHelper(this.data)
  }

  /**
   * Produce a static instance from a variable font by baking in axis coordinates.
   */
  createInstance(options: InstanceOptions): Font {
    const instanced = createVariableInstance(this.data, options)
    return new Font(instanced)
  }

  /**
   * Returns true if the font has an fvar table (is a variable font).
   */
  isVariable(): boolean {
    return !!this.data.fvar && this.data.fvar.axes.length > 0
  }

  // ========================================================================
  // opentype.js-compatible API
  // ========================================================================

  /** Font's em square size. */
  get unitsPerEm(): number {
    return this.data.head.unitsPerEm
  }

  /** Ascender metric. */
  get ascender(): number {
    return this.data.hhea?.ascent ?? 0
  }

  /** Descender metric (typically negative). */
  get descender(): number {
    return this.data.hhea?.descent ?? 0
  }

  /** Number of glyphs in the font. */
  get numGlyphs(): number {
    return this.data.glyf.length
  }

  /** Font family name (from the name table). */
  get familyName(): string {
    return this.data.name.fontFamily
  }

  /** Font style name (Regular / Bold / Italic / ...). */
  get styleName(): string {
    return this.data.name.fontSubFamily
  }

  /** CPAL palette manager. */
  get palettes(): PaletteManager {
    if (!this._palettes) this._palettes = new PaletteManager(this.data)
    return this._palettes
  }

  /** COLR color layer manager. */
  get layers(): LayerManager {
    if (!this._layers) this._layers = new LayerManager(this.data)
    return this._layers
  }

  private _palettes?: PaletteManager
  private _layers?: LayerManager

  /** Convert a single character to its glyph (falls back to .notdef). */
  charToGlyph(ch: string): OTGlyph {
    const g = otCharToGlyph(this.data, ch)
    return g
  }

  /** Convert a single character to its glyph index. */
  charToGlyphIndex(ch: string): number {
    return otCharToGlyphIndex(this.data, ch)
  }

  /** Whether the font contains a glyph for this character. */
  hasChar(ch: string): boolean {
    const cp = ch.codePointAt(0) ?? 0
    return cp in this.data.cmap
  }

  /** Shape a string into a list of Glyph objects, applying ligatures. */
  stringToGlyphs(text: string, options?: TextLayoutOptions): OTGlyph[] {
    return otStringToGlyphs(this.data, text, options)
  }

  /** Shape a string into a list of glyph indexes. */
  stringToGlyphIndexes(text: string, options?: TextLayoutOptions): number[] {
    return otStringToGlyphIndexes(this.data, text, options)
  }

  /** Find a glyph by its name. Falls back to .notdef. */
  nameToGlyph(name: string): OTGlyph {
    const i = this.nameToGlyphIndex(name)
    const g = OTGlyph.fromData(this.data.glyf[i] ?? this.data.glyf[0], i)
    g.font = { unitsPerEm: this.data.head.unitsPerEm, ttf: this.data }
    return g
  }

  /** Find a glyph index by name. Returns 0 on miss. */
  nameToGlyphIndex(name: string): number {
    for (let i = 0; i < this.data.glyf.length; i++) {
      if (this.data.glyf[i].name === name) return i
    }
    return 0
  }

  /** Look up a glyph's name by index. */
  glyphIndexToName(index: number): string {
    return this.data.glyf[index]?.name ?? ''
  }

  /** Pair-kerning value (GPOS or kern table). */
  getKerningValue(left: OTGlyph | number, right: OTGlyph | number): number {
    if (!this._kerningLookup)
      this._kerningLookup = buildKerningLookup(this.data)
    const li = typeof left === 'number' ? left : left.index
    const ri = typeof right === 'number' ? right : right.index
    return this._kerningLookup(li, ri)
  }

  private _kerningLookup?: (l: number, r: number) => number

  /** Walk each glyph in a text string. */
  forEachGlyph(
    text: string,
    x: number,
    y: number,
    fontSize: number,
    options: TextLayoutOptions,
    callback: FontForEachGlyphCallback,
  ): number {
    return otForEachGlyph(this.data, text, x, y, fontSize, options, callback)
  }

  /** Build a combined Path for the given text. */
  getPath(text: string, x = 0, y = 0, fontSize = 72, options: TextLayoutOptions = {}): Path {
    const path = new Path()
    this.forEachGlyph(text, x, y, fontSize, options, (glyph, gx, gy, fs, opts) => {
      path.extend(glyph.getPath(gx, gy, fs, opts))
    })
    return path
  }

  /** Build one Path per glyph for the given text. */
  getPaths(text: string, x = 0, y = 0, fontSize = 72, options: TextLayoutOptions = {}): Path[] {
    const paths: Path[] = []
    this.forEachGlyph(text, x, y, fontSize, options, (glyph, gx, gy, fs, opts) => {
      paths.push(glyph.getPath(gx, gy, fs, opts))
    })
    return paths
  }

  /** Total advance width for a laid-out text string. */
  getAdvanceWidth(text: string, fontSize = 72, options: TextLayoutOptions = {}): number {
    return otGetAdvanceWidth(this.data, text, fontSize, options)
  }

  /** Draw text onto a 2D-canvas-compatible context. */
  drawText(ctx: CanvasLike, text: string, x = 0, y = 0, fontSize = 72, options: TextLayoutOptions = {}): void {
    drawText(this.data, ctx, text, x, y, fontSize, options)
  }

  /** Draw on-curve / off-curve points for a text run. */
  drawPoints(ctx: CanvasLike, text: string, x = 0, y = 0, fontSize = 72, options: TextLayoutOptions = {}): void {
    this.forEachGlyph(text, x, y, fontSize, options, (glyph, gx, gy, fs) => {
      glyph.drawPoints(ctx, gx, gy, fs)
    })
  }

  /** Draw metric lines for a text run. */
  drawMetrics(ctx: CanvasLike, text: string, x = 0, y = 0, fontSize = 72, options: TextLayoutOptions = {}): void {
    this.forEachGlyph(text, x, y, fontSize, options, (glyph, gx, gy, fs) => {
      glyph.drawMetrics(ctx, gx, gy, fs)
    })
  }

  /**
   * Serialize this font to a TTF ArrayBuffer. opentype.js-compat shortcut
   * for `font.write({ type: 'ttf', toBuffer: false })`.
   */
  toArrayBuffer(): ArrayBuffer {
    return this.write({ type: 'ttf', toBuffer: false }) as ArrayBuffer
  }

  /**
   * Return a localised English-language name for the given nameId.
   * Accepts numeric ID or well-known key (e.g. 'fontFamily', 'version').
   */
  getEnglishName(id: number | string): string | undefined {
    if (typeof id === 'string') {
      const v = this.data.name[id]
      return typeof v === 'string' ? v : undefined
    }
    const entry = this.data.name.extra?.find(e => e.nameID === id)
    return entry?.value
  }

  /**
   * Structural validation — returns an array of warnings/errors. Empty
   * array means "no issues". Does not throw.
   */
  validate(): ValidationWarning[] {
    return validateTTF(this.data)
  }
}

export function createFont(buffer?: FontInput, options?: FontReadOptions): Font {
  return new Font(buffer, options)
}
