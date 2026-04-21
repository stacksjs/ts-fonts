import type { TTFObject } from '../types'

export interface ColrBaseGlyphRecord {
  glyphID: number
  firstLayerIndex: number
  numLayers: number
}

export interface ColrLayer {
  glyphID: number
  paletteIndex: number
}

export interface ColrData {
  version: number
  baseGlyphRecords: ColrBaseGlyphRecord[]
  layers: ColrLayer[]
}

/** Parse COLR v0 (we don't parse v1 gradient paint trees — they pass through as raw bytes). */
export function parseCOLR(raw: Uint8Array): ColrData | null {
  const view = new DataView(raw.buffer, raw.byteOffset, raw.byteLength)
  const version = view.getUint16(0, false)
  if (version !== 0) return null

  const numBaseGlyphRecords = view.getUint16(2, false)
  const baseGlyphRecordsOffset = view.getUint32(4, false)
  const layerRecordsOffset = view.getUint32(8, false)
  const numLayerRecords = view.getUint16(12, false)

  const baseGlyphRecords: ColrBaseGlyphRecord[] = []
  for (let i = 0; i < numBaseGlyphRecords; i++) {
    const off = baseGlyphRecordsOffset + i * 6
    baseGlyphRecords.push({
      glyphID: view.getUint16(off, false),
      firstLayerIndex: view.getUint16(off + 2, false),
      numLayers: view.getUint16(off + 4, false),
    })
  }
  const layers: ColrLayer[] = []
  for (let i = 0; i < numLayerRecords; i++) {
    const off = layerRecordsOffset + i * 4
    layers.push({
      glyphID: view.getUint16(off, false),
      paletteIndex: view.getUint16(off + 2, false),
    })
  }
  return { version, baseGlyphRecords, layers }
}

export function serializeCOLR(colr: ColrData): Uint8Array {
  const headerSize = 14
  const baseGlyphRecordsOffset = headerSize
  const baseGlyphRecordsSize = colr.baseGlyphRecords.length * 6
  const layerRecordsOffset = baseGlyphRecordsOffset + baseGlyphRecordsSize
  const layerRecordsSize = colr.layers.length * 4
  const totalSize = layerRecordsOffset + layerRecordsSize

  const buf = new Uint8Array(totalSize)
  const view = new DataView(buf.buffer)
  view.setUint16(0, 0, false)
  view.setUint16(2, colr.baseGlyphRecords.length, false)
  view.setUint32(4, baseGlyphRecordsOffset, false)
  view.setUint32(8, layerRecordsOffset, false)
  view.setUint16(12, colr.layers.length, false)

  for (let i = 0; i < colr.baseGlyphRecords.length; i++) {
    const r = colr.baseGlyphRecords[i]
    const off = baseGlyphRecordsOffset + i * 6
    view.setUint16(off, r.glyphID, false)
    view.setUint16(off + 2, r.firstLayerIndex, false)
    view.setUint16(off + 4, r.numLayers, false)
  }
  for (let i = 0; i < colr.layers.length; i++) {
    const l = colr.layers[i]
    const off = layerRecordsOffset + i * 4
    view.setUint16(off, l.glyphID, false)
    view.setUint16(off + 2, l.paletteIndex, false)
  }
  return buf
}

/**
 * High-level wrapper for COLR layer management (v0 only).
 */
export class LayerManager {
  private ttf: TTFObject
  private data: ColrData | null

  constructor(ttf: TTFObject) {
    this.ttf = ttf
    const raw = ttf.rawTables?.COLR
    this.data = raw ? parseCOLR(raw) : null
  }

  colr(): ColrData | false {
    return this.data ?? false
  }

  ensureCOLR(): boolean {
    if (this.data) return false
    this.data = { version: 0, baseGlyphRecords: [], layers: [] }
    this.flush()
    return true
  }

  get(glyphIndex: number): ColrLayer[] {
    if (!this.data) return []
    const record = this.data.baseGlyphRecords.find(r => r.glyphID === glyphIndex)
    if (!record) return []
    return this.data.layers.slice(record.firstLayerIndex, record.firstLayerIndex + record.numLayers)
  }

  add(glyphIndex: number, layers: ColrLayer | ColrLayer[], position?: number): void {
    if (!this.data) this.ensureCOLR()
    const toAdd = Array.isArray(layers) ? layers : [layers]
    const existing = this.get(glyphIndex)
    const combined = [...existing]
    if (position === undefined || position > existing.length)
      combined.push(...toAdd)
    else
      combined.splice(position, 0, ...toAdd)
    this.updateColrTable(glyphIndex, combined)
  }

  remove(glyphIndex: number, start: number, end: number = start): void {
    const layers = this.get(glyphIndex)
    layers.splice(start, end - start + 1)
    this.updateColrTable(glyphIndex, layers)
  }

  setPaletteIndex(glyphIndex: number, layerIndex: number, paletteIndex: number): void {
    const layers = this.get(glyphIndex)
    if (layers[layerIndex])
      layers[layerIndex].paletteIndex = paletteIndex
    this.updateColrTable(glyphIndex, layers)
  }

  updateColrTable(glyphIndex: number, layers: ColrLayer[]): void {
    if (!this.data) this.ensureCOLR()
    // Remove existing entry
    const idx = this.data!.baseGlyphRecords.findIndex(r => r.glyphID === glyphIndex)
    if (idx >= 0) {
      const rec = this.data!.baseGlyphRecords[idx]
      this.data!.layers.splice(rec.firstLayerIndex, rec.numLayers)
      this.data!.baseGlyphRecords.splice(idx, 1)
      // Shift firstLayerIndex for records after the removed range
      for (const r of this.data!.baseGlyphRecords) {
        if (r.firstLayerIndex > rec.firstLayerIndex)
          r.firstLayerIndex -= rec.numLayers
      }
    }
    if (layers.length > 0) {
      const insertPos = this.data!.baseGlyphRecords.findIndex(r => r.glyphID > glyphIndex)
      const at = insertPos === -1 ? this.data!.baseGlyphRecords.length : insertPos
      const firstLayerIndex = this.data!.layers.length
      this.data!.layers.push(...layers)
      this.data!.baseGlyphRecords.splice(at, 0, {
        glyphID: glyphIndex,
        firstLayerIndex,
        numLayers: layers.length,
      })
    }
    this.flush()
  }

  flush(): void {
    if (!this.data) return
    if (!this.ttf.rawTables) this.ttf.rawTables = {}
    this.ttf.rawTables.COLR = serializeCOLR(this.data)
  }
}
