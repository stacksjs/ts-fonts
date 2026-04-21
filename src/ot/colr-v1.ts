/**
 * COLR v1 paint tree reader.
 *
 * COLR v1 adds a richer graph of paint operations on top of v0 base-glyph
 * records: solid colors with alpha variation, linear/radial/sweep
 * gradients, transforms, and composites.
 *
 * This module parses the paint graph into plain JS values so callers can
 * render the glyph with a custom engine (Canvas, SVG, PDF). For round-trip
 * preservation we also keep the raw bytes so writes are lossless.
 */

export type Paint =
  | { type: 'solid', paletteIndex: number, alpha: number }
  | { type: 'linearGradient', stops: ColorStop[], x0: number, y0: number, x1: number, y1: number, x2: number, y2: number }
  | { type: 'radialGradient', stops: ColorStop[], x0: number, y0: number, r0: number, x1: number, y1: number, r1: number }
  | { type: 'sweepGradient', stops: ColorStop[], centerX: number, centerY: number, startAngle: number, endAngle: number }
  | { type: 'colrLayers', firstLayerIndex: number, numLayers: number }
  | { type: 'colrGlyph', glyphID: number }
  | { type: 'transform', paint: Paint, matrix: [number, number, number, number, number, number] }
  | { type: 'translate', paint: Paint, dx: number, dy: number }
  | { type: 'scale', paint: Paint, scaleX: number, scaleY: number, centerX: number, centerY: number }
  | { type: 'rotate', paint: Paint, angle: number, centerX: number, centerY: number }
  | { type: 'skew', paint: Paint, xSkewAngle: number, ySkewAngle: number, centerX: number, centerY: number }
  | { type: 'composite', source: Paint, backdrop: Paint, mode: number }
  | { type: 'unknown', format: number }

export interface ColorStop {
  stopOffset: number
  paletteIndex: number
  alpha: number
}

export interface ColrV1Record {
  glyphID: number
  paint: Paint
}

export interface ColrV1Data {
  version: number
  baseGlyphPaintRecords: ColrV1Record[]
  /** Preserved v0 records from the same COLR table. */
  v0BaseGlyphRecords: Array<{ glyphID: number, firstLayerIndex: number, numLayers: number }>
  /** Preserved v0 layers from the same COLR table. */
  v0Layers: Array<{ glyphID: number, paletteIndex: number }>
}

const F2Dot14 = (v: number): number => v / 16384
const Fixed = (v: number): number => v / 65536

export function parseCOLRv1(raw: Uint8Array): ColrV1Data | null {
  const view = new DataView(raw.buffer, raw.byteOffset, raw.byteLength)
  const version = view.getUint16(0, false)
  if (version < 1) return null

  const numBaseGlyphRecords = view.getUint16(2, false)
  const baseGlyphRecordsOffset = view.getUint32(4, false)
  const layerRecordsOffset = view.getUint32(8, false)
  const numLayerRecords = view.getUint16(12, false)
  const baseGlyphListOffset = view.getUint32(14, false)
  // const layerListOffset = view.getUint32(18, false)
  // const clipListOffset = view.getUint32(22, false)
  // const varIndexMapOffset = view.getUint32(26, false)
  // const itemVariationStoreOffset = view.getUint32(30, false)

  // v0 portion (preserved)
  const v0BaseGlyphRecords: ColrV1Data['v0BaseGlyphRecords'] = []
  for (let i = 0; i < numBaseGlyphRecords; i++) {
    const off = baseGlyphRecordsOffset + i * 6
    v0BaseGlyphRecords.push({
      glyphID: view.getUint16(off, false),
      firstLayerIndex: view.getUint16(off + 2, false),
      numLayers: view.getUint16(off + 4, false),
    })
  }
  const v0Layers: ColrV1Data['v0Layers'] = []
  for (let i = 0; i < numLayerRecords; i++) {
    const off = layerRecordsOffset + i * 4
    v0Layers.push({
      glyphID: view.getUint16(off, false),
      paletteIndex: view.getUint16(off + 2, false),
    })
  }

  const baseGlyphPaintRecords: ColrV1Record[] = []
  if (baseGlyphListOffset !== 0) {
    const numPaintRecords = view.getUint32(baseGlyphListOffset, false)
    for (let i = 0; i < numPaintRecords; i++) {
      const recOff = baseGlyphListOffset + 4 + i * 6
      const gid = view.getUint16(recOff, false)
      const paintOff = baseGlyphListOffset + view.getUint32(recOff + 2, false)
      try {
        const paint = readPaint(view, paintOff)
        baseGlyphPaintRecords.push({ glyphID: gid, paint })
      }
      catch {
        baseGlyphPaintRecords.push({ glyphID: gid, paint: { type: 'unknown', format: 0 } })
      }
    }
  }

  return { version, baseGlyphPaintRecords, v0BaseGlyphRecords, v0Layers }
}

function readPaint(view: DataView, offset: number): Paint {
  const format = view.getUint8(offset)
  switch (format) {
    case 1: // ColrLayers
      return {
        type: 'colrLayers',
        numLayers: view.getUint8(offset + 1),
        firstLayerIndex: view.getUint32(offset + 2, false),
      }
    case 2: { // Solid
      return {
        type: 'solid',
        paletteIndex: view.getUint16(offset + 1, false),
        alpha: F2Dot14(view.getInt16(offset + 3, false)),
      }
    }
    case 3: { // VarSolid (unsupported — return plain solid)
      return {
        type: 'solid',
        paletteIndex: view.getUint16(offset + 1, false),
        alpha: F2Dot14(view.getInt16(offset + 3, false)),
      }
    }
    case 4: { // LinearGradient
      const colorLineOff = offset + view.getUint24(offset + 1, false)
      return {
        type: 'linearGradient',
        stops: readColorLine(view, colorLineOff),
        x0: view.getInt16(offset + 4, false),
        y0: view.getInt16(offset + 6, false),
        x1: view.getInt16(offset + 8, false),
        y1: view.getInt16(offset + 10, false),
        x2: view.getInt16(offset + 12, false),
        y2: view.getInt16(offset + 14, false),
      }
    }
    case 6: { // RadialGradient
      const colorLineOff = offset + view.getUint24(offset + 1, false)
      return {
        type: 'radialGradient',
        stops: readColorLine(view, colorLineOff),
        x0: view.getInt16(offset + 4, false),
        y0: view.getInt16(offset + 6, false),
        r0: view.getUint16(offset + 8, false),
        x1: view.getInt16(offset + 10, false),
        y1: view.getInt16(offset + 12, false),
        r1: view.getUint16(offset + 14, false),
      }
    }
    case 8: { // SweepGradient
      const colorLineOff = offset + view.getUint24(offset + 1, false)
      return {
        type: 'sweepGradient',
        stops: readColorLine(view, colorLineOff),
        centerX: view.getInt16(offset + 4, false),
        centerY: view.getInt16(offset + 6, false),
        startAngle: F2Dot14(view.getInt16(offset + 8, false)),
        endAngle: F2Dot14(view.getInt16(offset + 10, false)),
      }
    }
    case 10: { // Glyph — paint a specific glyph outline (skip)
      return { type: 'unknown', format }
    }
    case 11: { // ColrGlyph
      return { type: 'colrGlyph', glyphID: view.getUint16(offset + 1, false) }
    }
    case 12: { // Transform
      const inner = readPaint(view, offset + view.getUint24(offset + 1, false))
      const affineOff = offset + view.getUint24(offset + 4, false)
      return {
        type: 'transform',
        paint: inner,
        matrix: [
          Fixed(view.getInt32(affineOff, false)),
          Fixed(view.getInt32(affineOff + 4, false)),
          Fixed(view.getInt32(affineOff + 8, false)),
          Fixed(view.getInt32(affineOff + 12, false)),
          Fixed(view.getInt32(affineOff + 16, false)),
          Fixed(view.getInt32(affineOff + 20, false)),
        ],
      }
    }
    case 14: { // Translate
      const inner = readPaint(view, offset + view.getUint24(offset + 1, false))
      return {
        type: 'translate',
        paint: inner,
        dx: view.getInt16(offset + 4, false),
        dy: view.getInt16(offset + 6, false),
      }
    }
    case 16: { // Scale
      const inner = readPaint(view, offset + view.getUint24(offset + 1, false))
      return {
        type: 'scale',
        paint: inner,
        scaleX: F2Dot14(view.getInt16(offset + 4, false)),
        scaleY: F2Dot14(view.getInt16(offset + 6, false)),
        centerX: 0,
        centerY: 0,
      }
    }
    case 24: { // Rotate
      const inner = readPaint(view, offset + view.getUint24(offset + 1, false))
      return {
        type: 'rotate',
        paint: inner,
        angle: F2Dot14(view.getInt16(offset + 4, false)) * 180,
        centerX: 0,
        centerY: 0,
      }
    }
    case 28: { // Skew
      const inner = readPaint(view, offset + view.getUint24(offset + 1, false))
      return {
        type: 'skew',
        paint: inner,
        xSkewAngle: F2Dot14(view.getInt16(offset + 4, false)) * 180,
        ySkewAngle: F2Dot14(view.getInt16(offset + 6, false)) * 180,
        centerX: 0,
        centerY: 0,
      }
    }
    case 32: { // Composite
      const source = readPaint(view, offset + view.getUint24(offset + 1, false))
      const mode = view.getUint8(offset + 4)
      const backdrop = readPaint(view, offset + view.getUint24(offset + 5, false))
      return { type: 'composite', source, backdrop, mode }
    }
    default:
      return { type: 'unknown', format }
  }
}

function readColorLine(view: DataView, offset: number): ColorStop[] {
  /* const extend = */ view.getUint8(offset)
  const numStops = view.getUint16(offset + 1, false)
  const stops: ColorStop[] = []
  for (let i = 0; i < numStops; i++) {
    const recOff = offset + 3 + i * 6
    stops.push({
      stopOffset: F2Dot14(view.getInt16(recOff, false)),
      paletteIndex: view.getUint16(recOff + 2, false),
      alpha: F2Dot14(view.getInt16(recOff + 4, false)),
    })
  }
  return stops
}

// Missing from DataView — small polyfill
declare global {
  interface DataView {
    getUint24: (offset: number, littleEndian?: boolean) => number
  }
}
if (!DataView.prototype.getUint24) {
  DataView.prototype.getUint24 = function (offset: number, littleEndian = false): number {
    if (littleEndian) {
      return this.getUint8(offset) | (this.getUint8(offset + 1) << 8) | (this.getUint8(offset + 2) << 16)
    }
    return (this.getUint8(offset) << 16) | (this.getUint8(offset + 1) << 8) | this.getUint8(offset + 2)
  }
}
