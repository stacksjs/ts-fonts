import type { Reader } from '../../io/reader'
import type { Writer } from '../../io/writer'
import type { CmapFormat14, TTFObject, UVSRecord } from '../../types'

interface CmapEncoding {
  platformID: number
  encodingID: number
  offset: number
}

export interface CmapReadResult {
  cmap: Record<number, number>
  format14?: CmapFormat14
}

export function readCmapFormat14(reader: Reader, subtableStart: number): CmapFormat14 {
  reader.seek(subtableStart)
  /* format */ reader.readUint16()
  /* length */ reader.readUint32()
  const numVarSelectorRecords = reader.readUint32()

  interface Raw {
    varSelector: number
    defaultUVSOffset: number
    nonDefaultUVSOffset: number
  }
  const raws: Raw[] = []
  for (let i = 0; i < numVarSelectorRecords; i++) {
    raws.push({
      varSelector: reader.readUint24(),
      defaultUVSOffset: reader.readUint32(),
      nonDefaultUVSOffset: reader.readUint32(),
    })
  }

  const records: UVSRecord[] = []
  for (const r of raws) {
    const rec: UVSRecord = { selector: r.varSelector }
    if (r.defaultUVSOffset) {
      reader.seek(subtableStart + r.defaultUVSOffset)
      const numUnicodeValueRanges = reader.readUint32()
      const defaultUVS: Array<{ startUnicode: number, additionalCount: number }> = []
      for (let j = 0; j < numUnicodeValueRanges; j++) {
        const startUnicode = reader.readUint24()
        const additionalCount = reader.readUint8()
        defaultUVS.push({ startUnicode, additionalCount })
      }
      rec.defaultUVS = defaultUVS
    }
    if (r.nonDefaultUVSOffset) {
      reader.seek(subtableStart + r.nonDefaultUVSOffset)
      const numUVSMappings = reader.readUint32()
      const nonDefaultUVS: Array<{ unicode: number, glyphID: number }> = []
      for (let j = 0; j < numUVSMappings; j++) {
        const unicode = reader.readUint24()
        const glyphID = reader.readUint16()
        nonDefaultUVS.push({ unicode, glyphID })
      }
      rec.nonDefaultUVS = nonDefaultUVS
    }
    records.push(rec)
  }

  return { uvsRecords: records }
}

export function readCmapWithFormat14(reader: Reader, offset: number): CmapReadResult {
  const cmap = readCmap(reader, offset)
  // Re-scan to find format 14 subtable (Unicode platform, encoding 5)
  reader.seek(offset)
  /* version */ reader.readUint16()
  const numTables = reader.readUint16()
  for (let i = 0; i < numTables; i++) {
    const platformID = reader.readUint16()
    const encodingID = reader.readUint16()
    const subOffset = reader.readUint32()
    if (platformID === 0 && encodingID === 5) {
      const savedOff = reader.offset
      try {
        const fmt14 = readCmapFormat14(reader, offset + subOffset)
        return { cmap, format14: fmt14 }
      }
      catch {
        // ignore malformed
      }
      reader.seek(savedOff)
    }
  }
  return { cmap }
}

export function readCmap(reader: Reader, offset: number): Record<number, number> {
  reader.seek(offset)
  /* const version = */ reader.readUint16()
  const numTables = reader.readUint16()
  const encodings: CmapEncoding[] = []
  for (let i = 0; i < numTables; i++) {
    encodings.push({
      platformID: reader.readUint16(),
      encodingID: reader.readUint16(),
      offset: reader.readUint32(),
    })
  }

  // Prefer Unicode encoding subtables: (3,10) > (0,4) > (3,1) > (0,3)
  const priority = (e: CmapEncoding): number => {
    if (e.platformID === 3 && e.encodingID === 10) return 0
    if (e.platformID === 0 && e.encodingID === 4) return 1
    if (e.platformID === 3 && e.encodingID === 1) return 2
    if (e.platformID === 0 && e.encodingID === 3) return 3
    if (e.platformID === 0) return 4
    return 5
  }
  encodings.sort((a, b) => priority(a) - priority(b))

  const cmap: Record<number, number> = {}

  for (const enc of encodings) {
    reader.seek(offset + enc.offset)
    const format = reader.readUint16()
    try {
      if (format === 0) {
        /* length */ reader.readUint16()
        /* language */ reader.readUint16()
        for (let i = 0; i < 256; i++) {
          const gi = reader.readUint8()
          if (gi !== 0 && !(i in cmap))
            cmap[i] = gi
        }
      }
      else if (format === 4) {
        const length = reader.readUint16()
        /* language */ reader.readUint16()
        const segCountX2 = reader.readUint16()
        const segCount = segCountX2 / 2
        /* searchRange */ reader.readUint16()
        /* entrySelector */ reader.readUint16()
        /* rangeShift */ reader.readUint16()

        const endCode: number[] = []
        for (let i = 0; i < segCount; i++)
          endCode.push(reader.readUint16())
        /* reservedPad */ reader.readUint16()
        const startCode: number[] = []
        for (let i = 0; i < segCount; i++)
          startCode.push(reader.readUint16())
        const idDelta: number[] = []
        for (let i = 0; i < segCount; i++)
          idDelta.push(reader.readInt16())
        const idRangeOffsetBase = reader.offset
        const idRangeOffset: number[] = []
        for (let i = 0; i < segCount; i++)
          idRangeOffset.push(reader.readUint16())

        const subtableEnd = offset + enc.offset + length
        for (let i = 0; i < segCount; i++) {
          if (endCode[i] === 0xFFFF)
            break
          for (let c = startCode[i]; c <= endCode[i]; c++) {
            let glyphIndex: number
            if (idRangeOffset[i] === 0) {
              glyphIndex = (c + idDelta[i]) & 0xFFFF
            }
            else {
              const addr = idRangeOffsetBase + i * 2 + idRangeOffset[i] + (c - startCode[i]) * 2
              if (addr + 2 > subtableEnd)
                continue
              const g = new DataView(reader.view.buffer, reader.view.byteOffset).getUint16(addr, false)
              glyphIndex = g === 0 ? 0 : (g + idDelta[i]) & 0xFFFF
            }
            if (glyphIndex !== 0 && !(c in cmap))
              cmap[c] = glyphIndex
          }
        }
      }
      else if (format === 6) {
        /* length */ reader.readUint16()
        /* language */ reader.readUint16()
        const firstCode = reader.readUint16()
        const entryCount = reader.readUint16()
        for (let i = 0; i < entryCount; i++) {
          const gi = reader.readUint16()
          if (gi !== 0 && !((firstCode + i) in cmap))
            cmap[firstCode + i] = gi
        }
      }
      else if (format === 12) {
        /* reserved */ reader.readUint16()
        /* length */ reader.readUint32()
        /* language */ reader.readUint32()
        const numGroups = reader.readUint32()
        for (let i = 0; i < numGroups; i++) {
          const startCharCode = reader.readUint32()
          const endCharCode = reader.readUint32()
          const startGlyphID = reader.readUint32()
          for (let c = startCharCode; c <= endCharCode; c++) {
            if (!(c in cmap))
              cmap[c] = startGlyphID + (c - startCharCode)
          }
        }
      }
    }
    catch {
      // skip broken subtable
    }
    if (Object.keys(cmap).length > 0)
      break
  }

  return cmap
}

// Build a Format 4 cmap from unicode->glyphIndex mapping.
interface Segment {
  start: number
  end: number
  delta: number
  useIdRange: boolean
  glyphIndices: number[]
}

function buildSegments(cmap: Record<number, number>): Segment[] {
  const codes = Object.keys(cmap).map(c => Number.parseInt(c, 10)).filter(c => c <= 0xFFFF).sort((a, b) => a - b)
  const segments: Segment[] = []
  let i = 0
  while (i < codes.length) {
    const start = codes[i]
    let end = start
    while (i + 1 < codes.length && codes[i + 1] === end + 1) {
      i++
      end = codes[i]
    }
    const firstGlyph = cmap[start]
    let canUseDelta = true
    for (let c = start; c <= end; c++) {
      if (cmap[c] !== ((firstGlyph + (c - start)) & 0xFFFF)) {
        canUseDelta = false
        break
      }
    }
    const glyphIndices: number[] = []
    for (let c = start; c <= end; c++)
      glyphIndices.push(cmap[c])
    if (canUseDelta) {
      segments.push({ start, end, delta: (firstGlyph - start) & 0xFFFF, useIdRange: false, glyphIndices })
    }
    else {
      segments.push({ start, end, delta: 0, useIdRange: true, glyphIndices })
    }
    i++
  }
  // Terminator segment
  segments.push({ start: 0xFFFF, end: 0xFFFF, delta: 1, useIdRange: false, glyphIndices: [] })
  return segments
}

function buildFormat4(cmap: Record<number, number>): { buffer: ArrayBuffer, length: number } {
  const segs = buildSegments(cmap)
  const segCount = segs.length

  // Compute idRangeOffset / glyphIdArray
  let glyphIdArrayLen = 0
  const glyphIdArray: number[] = []
  const idRangeOffset: number[] = Array.from({ length: segCount }).fill(0) as number[]
  for (let i = 0; i < segCount; i++) {
    if (segs[i].useIdRange) {
      idRangeOffset[i] = (segCount - i) * 2 + glyphIdArrayLen * 2
      for (const g of segs[i].glyphIndices)
        glyphIdArray.push(g)
      glyphIdArrayLen = glyphIdArray.length
    }
  }

  const length = 16 + 8 * segCount + 2 + glyphIdArrayLen * 2
  const buf = new ArrayBuffer(length)
  const view = new DataView(buf)
  let off = 0
  view.setUint16(off, 4); off += 2 // format
  view.setUint16(off, length); off += 2 // length
  view.setUint16(off, 0); off += 2 // language
  view.setUint16(off, segCount * 2); off += 2 // segCountX2
  const entrySelector = Math.floor(Math.log2(segCount))
  const searchRange = 2 * (2 ** entrySelector)
  view.setUint16(off, searchRange); off += 2
  view.setUint16(off, entrySelector); off += 2
  view.setUint16(off, segCount * 2 - searchRange); off += 2
  for (const s of segs) { view.setUint16(off, s.end); off += 2 }
  view.setUint16(off, 0); off += 2 // reservedPad
  for (const s of segs) { view.setUint16(off, s.start); off += 2 }
  for (const s of segs) { view.setInt16(off, s.delta & 0xFFFF, false); off += 2 }
  for (const r of idRangeOffset) { view.setUint16(off, r); off += 2 }
  for (const g of glyphIdArray) { view.setUint16(off, g); off += 2 }
  return { buffer: buf, length }
}

function buildFormat14(fmt14: CmapFormat14): { buffer: ArrayBuffer, length: number } {
  const records = fmt14.uvsRecords
  // Compute total size
  const recordSize = 11
  let variableSize = 0
  for (const r of records) {
    if (r.defaultUVS) variableSize += 4 + r.defaultUVS.length * 4
    if (r.nonDefaultUVS) variableSize += 4 + r.nonDefaultUVS.length * 5
  }
  const length = 10 + records.length * recordSize + variableSize

  const buf = new ArrayBuffer(length)
  const view = new DataView(buf)
  let off = 0
  view.setUint16(off, 14); off += 2
  view.setUint32(off, length); off += 4
  view.setUint32(off, records.length); off += 4

  let varOff = 10 + records.length * recordSize
  const offsets: Array<{ dflt: number, nondflt: number }> = []
  for (const r of records) {
    let dflt = 0
    let nondflt = 0
    if (r.defaultUVS) {
      dflt = varOff
      varOff += 4 + r.defaultUVS.length * 4
    }
    if (r.nonDefaultUVS) {
      nondflt = varOff
      varOff += 4 + r.nonDefaultUVS.length * 5
    }
    offsets.push({ dflt, nondflt })
  }

  for (let i = 0; i < records.length; i++) {
    const r = records[i]
    const { dflt, nondflt } = offsets[i]
    // VarSelector uint24
    view.setUint8(off, (r.selector >>> 16) & 0xFF)
    view.setUint8(off + 1, (r.selector >>> 8) & 0xFF)
    view.setUint8(off + 2, r.selector & 0xFF)
    off += 3
    view.setUint32(off, dflt); off += 4
    view.setUint32(off, nondflt); off += 4
  }

  for (let i = 0; i < records.length; i++) {
    const r = records[i]
    if (r.defaultUVS) {
      view.setUint32(off, r.defaultUVS.length); off += 4
      for (const entry of r.defaultUVS) {
        view.setUint8(off, (entry.startUnicode >>> 16) & 0xFF)
        view.setUint8(off + 1, (entry.startUnicode >>> 8) & 0xFF)
        view.setUint8(off + 2, entry.startUnicode & 0xFF)
        off += 3
        view.setUint8(off, entry.additionalCount & 0xFF); off += 1
      }
    }
    if (r.nonDefaultUVS) {
      view.setUint32(off, r.nonDefaultUVS.length); off += 4
      for (const entry of r.nonDefaultUVS) {
        view.setUint8(off, (entry.unicode >>> 16) & 0xFF)
        view.setUint8(off + 1, (entry.unicode >>> 8) & 0xFF)
        view.setUint8(off + 2, entry.unicode & 0xFF)
        off += 3
        view.setUint16(off, entry.glyphID & 0xFFFF); off += 2
      }
    }
  }

  return { buffer: buf, length }
}

export function writeCmap(writer: Writer, ttf: TTFObject): void {
  const fmt4 = buildFormat4(ttf.cmap)
  const fmt14 = ttf.cmapFormat14 && ttf.cmapFormat14.uvsRecords.length > 0
    ? buildFormat14(ttf.cmapFormat14)
    : null
  const numTables = fmt14 ? 3 : 2

  writer.writeUint16(0) // version
  writer.writeUint16(numTables)

  const headerSize = 4 + numTables * 8
  writer.writeUint16(0) // Unicode platform
  writer.writeUint16(3) // Unicode 2.0 BMP
  writer.writeUint32(headerSize)

  writer.writeUint16(3) // Windows
  writer.writeUint16(1) // Unicode BMP
  writer.writeUint32(headerSize)

  if (fmt14) {
    writer.writeUint16(0) // Unicode
    writer.writeUint16(5) // UVS
    writer.writeUint32(headerSize + fmt4.length)
  }

  writer.writeBytes(fmt4.buffer)
  if (fmt14) writer.writeBytes(fmt14.buffer)
}

export function cmapSize(ttf: TTFObject): number {
  const fmt4 = buildFormat4(ttf.cmap)
  const fmt14 = ttf.cmapFormat14 && ttf.cmapFormat14.uvsRecords.length > 0
    ? buildFormat14(ttf.cmapFormat14)
    : null
  const numTables = fmt14 ? 3 : 2
  return 4 + numTables * 8 + fmt4.length + (fmt14 ? fmt14.length : 0)
}
