import type { TTFObject } from '../types'
import type { ColorFormat, ColorValue } from './colors'
import { formatColor, parseColor } from './colors'

export interface CpalData {
  version: number
  numPaletteEntries: number
  /** palettes[paletteIdx][colorSlot] = BGRA packed uint32. */
  palettes: number[][]
  /** CPAL v1 only — one bit-flag set per palette (LIGHT / DARK / etc.). */
  paletteTypes?: number[]
  /** CPAL v1 only — name table IDs per palette, 0xFFFF = none. */
  paletteLabelNameIDs?: number[]
  /** CPAL v1 only — name table IDs per color entry, 0xFFFF = none. */
  paletteEntryLabelNameIDs?: number[]
}

export const CPAL_PALETTE_TYPE = {
  USABLE_WITH_LIGHT_BACKGROUND: 0x0001,
  USABLE_WITH_DARK_BACKGROUND: 0x0002,
} as const

/**
 * Parse a CPAL table from its raw bytes. Supports both v0 (palette data
 * only) and v1 (additional palette-type / label / entry-label arrays).
 */
export function parseCPAL(raw: Uint8Array): CpalData {
  const view = new DataView(raw.buffer, raw.byteOffset, raw.byteLength)
  const version = view.getUint16(0, false)
  const numPaletteEntries = view.getUint16(2, false)
  const numPalettes = view.getUint16(4, false)
  const numColorRecords = view.getUint16(6, false)
  const colorRecordsArrayOffset = view.getUint32(8, false)
  const colorRecordIndices: number[] = []
  for (let i = 0; i < numPalettes; i++)
    colorRecordIndices.push(view.getUint16(12 + i * 2, false))

  const palettes: number[][] = []
  for (let i = 0; i < numPalettes; i++) {
    const start = colorRecordIndices[i]
    const colors: number[] = []
    for (let j = 0; j < numPaletteEntries; j++) {
      const off = colorRecordsArrayOffset + (start + j) * 4
      const b = view.getUint8(off)
      const g = view.getUint8(off + 1)
      const r = view.getUint8(off + 2)
      const a = view.getUint8(off + 3)
      colors.push((((a & 0xFF) << 24) | ((r & 0xFF) << 16) | ((g & 0xFF) << 8) | b) >>> 0)
    }
    palettes.push(colors)
  }

  const result: CpalData = { version, numPaletteEntries, palettes }

  // CPAL v1 extension: the three offsets come after the palette indices.
  if (version === 1) {
    const base = 12 + numPalettes * 2
    const typesOff = view.getUint32(base, false)
    const labelsOff = view.getUint32(base + 4, false)
    const entryLabelsOff = view.getUint32(base + 8, false)
    if (typesOff) {
      result.paletteTypes = []
      for (let i = 0; i < numPalettes; i++)
        result.paletteTypes.push(view.getUint32(typesOff + i * 4, false))
    }
    if (labelsOff) {
      result.paletteLabelNameIDs = []
      for (let i = 0; i < numPalettes; i++)
        result.paletteLabelNameIDs.push(view.getUint16(labelsOff + i * 2, false))
    }
    if (entryLabelsOff) {
      result.paletteEntryLabelNameIDs = []
      for (let i = 0; i < numPaletteEntries; i++)
        result.paletteEntryLabelNameIDs.push(view.getUint16(entryLabelsOff + i * 2, false))
    }
  }

  void numColorRecords
  return result
}

export function serializeCPAL(cpal: CpalData): Uint8Array {
  const numPalettes = cpal.palettes.length
  const numPaletteEntries = cpal.numPaletteEntries
  const numColorRecords = numPalettes * numPaletteEntries
  const isV1 = cpal.version === 1 || !!(cpal.paletteTypes || cpal.paletteLabelNameIDs || cpal.paletteEntryLabelNameIDs)
  const headerSize = 12 + numPalettes * 2 + (isV1 ? 12 : 0)
  const colorRecordsArrayOffset = headerSize
  let cursor = colorRecordsArrayOffset + numColorRecords * 4

  let typesOff = 0, labelsOff = 0, entryLabelsOff = 0
  if (isV1) {
    if (cpal.paletteTypes && cpal.paletteTypes.length > 0) {
      typesOff = cursor
      cursor += numPalettes * 4
    }
    if (cpal.paletteLabelNameIDs && cpal.paletteLabelNameIDs.length > 0) {
      labelsOff = cursor
      cursor += numPalettes * 2
    }
    if (cpal.paletteEntryLabelNameIDs && cpal.paletteEntryLabelNameIDs.length > 0) {
      entryLabelsOff = cursor
      cursor += numPaletteEntries * 2
    }
  }

  const totalSize = cursor
  const buf = new Uint8Array(totalSize)
  const view = new DataView(buf.buffer)
  view.setUint16(0, isV1 ? 1 : 0, false)
  view.setUint16(2, numPaletteEntries, false)
  view.setUint16(4, numPalettes, false)
  view.setUint16(6, numColorRecords, false)
  view.setUint32(8, colorRecordsArrayOffset, false)
  for (let i = 0; i < numPalettes; i++)
    view.setUint16(12 + i * 2, i * numPaletteEntries, false)

  if (isV1) {
    const base = 12 + numPalettes * 2
    view.setUint32(base, typesOff, false)
    view.setUint32(base + 4, labelsOff, false)
    view.setUint32(base + 8, entryLabelsOff, false)
  }

  for (let i = 0; i < numPalettes; i++) {
    const palette = cpal.palettes[i]
    for (let j = 0; j < numPaletteEntries; j++) {
      const col = palette[j] ?? 0
      const off = colorRecordsArrayOffset + (i * numPaletteEntries + j) * 4
      view.setUint8(off, col & 0xFF)
      view.setUint8(off + 1, (col >>> 8) & 0xFF)
      view.setUint8(off + 2, (col >>> 16) & 0xFF)
      view.setUint8(off + 3, (col >>> 24) & 0xFF)
    }
  }

  if (typesOff) {
    for (let i = 0; i < numPalettes; i++)
      view.setUint32(typesOff + i * 4, cpal.paletteTypes?.[i] ?? 0, false)
  }
  if (labelsOff) {
    for (let i = 0; i < numPalettes; i++)
      view.setUint16(labelsOff + i * 2, cpal.paletteLabelNameIDs?.[i] ?? 0xFFFF, false)
  }
  if (entryLabelsOff) {
    for (let i = 0; i < numPaletteEntries; i++)
      view.setUint16(entryLabelsOff + i * 2, cpal.paletteEntryLabelNameIDs?.[i] ?? 0xFFFF, false)
  }

  return buf
}

/**
 * High-level wrapper for CPAL color palette management.
 */
export class PaletteManager {
  private ttf: TTFObject
  private data: CpalData | null

  constructor(ttf: TTFObject) {
    this.ttf = ttf
    const raw = ttf.rawTables?.CPAL
    this.data = raw ? parseCPAL(raw) : null
  }

  cpal(): CpalData | false {
    return this.data ?? false
  }

  ensureCPAL(colors?: ColorValue[]): boolean {
    if (this.data) return false
    const base = colors?.map(parseColor) ?? [0x000000FF] // black by default
    this.data = {
      version: 0,
      numPaletteEntries: base.length,
      palettes: [base],
    }
    this.flush()
    return true
  }

  getAll(format: ColorFormat = 'hexa'): Array<Array<string | number | object>> {
    if (!this.data) return []
    return this.data.palettes.map(p => p.map(c => formatColor(c, format)))
  }

  get(paletteIndex: number, format: ColorFormat = 'hexa'): Array<string | number | object> {
    if (!this.data) return []
    return (this.data.palettes[paletteIndex] ?? []).map(c => formatColor(c, format))
  }

  getColor(colorIndex: number, paletteIndex = 0, format: ColorFormat = 'hexa'): string | number | object | undefined {
    const p = this.data?.palettes[paletteIndex]
    if (!p) return undefined
    const c = p[colorIndex]
    if (c === undefined) return undefined
    return formatColor(c, format)
  }

  setColor(colorIndex: number, color: ColorValue | ColorValue[], paletteIndex = 0): void {
    if (!this.data) this.ensureCPAL()
    const palette = this.data!.palettes[paletteIndex]
    if (!palette) throw new Error(`No palette at index ${paletteIndex}`)
    const colors: ColorValue[] = Array.isArray(color) ? color as ColorValue[] : [color as ColorValue]
    for (let i = 0; i < colors.length; i++) {
      const target = colorIndex + i
      if (target >= this.data!.numPaletteEntries)
        this.extend(target - this.data!.numPaletteEntries + 1)
      const c = colors[i]
      if (c !== undefined)
        palette[target] = parseColor(c)
    }
    this.flush()
  }

  add(colors?: ColorValue[]): number {
    if (!this.data) this.ensureCPAL(colors)
    else {
      const pal = new Array(this.data.numPaletteEntries).fill(0x000000FF)
      if (colors) {
        for (let i = 0; i < colors.length && i < pal.length; i++)
          pal[i] = parseColor(colors[i])
      }
      this.data.palettes.push(pal)
    }
    this.flush()
    return this.data!.palettes.length - 1
  }

  delete(paletteIndex: number): void {
    if (!this.data) return
    this.data.palettes.splice(paletteIndex, 1)
    this.flush()
  }

  deleteColor(colorIndex: number, replacementIndex = 0): void {
    if (!this.data) return
    for (const pal of this.data.palettes)
      pal.splice(colorIndex, 1)
    this.data.numPaletteEntries--
    // COLR layer indices referencing this color need remapping; caller
    // should use LayerManager for that. We expose replacementIndex for
    // API parity only.
    void replacementIndex
    this.flush()
  }

  extend(slots: number): void {
    if (!this.data) return
    for (const pal of this.data.palettes) {
      for (let i = 0; i < slots; i++) pal.push(0x000000FF)
    }
    this.data.numPaletteEntries += slots
    this.flush()
  }

  /** Convert a user-supplied color to the CPAL packed integer. */
  toCPALcolor(color: ColorValue): number | number[] {
    if (Array.isArray(color) && color.every(v => typeof v === 'number') && color.length <= 4)
      return parseColor(color as [number, number, number, number?])
    if (Array.isArray(color))
      return (color as ColorValue[]).map(c => parseColor(c))
    return parseColor(color)
  }

  /** Re-serialize the CPAL table back to raw bytes for round-trip. */
  flush(): void {
    if (!this.data) return
    if (!this.ttf.rawTables) this.ttf.rawTables = {}
    this.ttf.rawTables.CPAL = serializeCPAL(this.data)
  }
}
