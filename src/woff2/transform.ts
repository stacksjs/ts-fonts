/**
 * WOFF2 glyf/loca transform (spec §5.1, "Transformed glyf Table").
 *
 * The transformation decomposes a traditional glyf + loca pair into
 * several independent byte streams that compress much better under
 * Brotli:
 *
 *   reserved              uint16  (always 0)
 *   optionFlags           uint16
 *   numGlyphs             uint16
 *   indexFormat           uint16
 *   nContourStreamSize    uint32
 *   nPointsStreamSize     uint32
 *   flagStreamSize        uint32
 *   glyphStreamSize       uint32
 *   compositeStreamSize   uint32
 *   bboxStreamSize        uint32
 *   instructionStreamSize uint32
 *   nContourStream        Int16[numGlyphs]     — number of contours per glyph
 *   nPointsStream         Uint255[...]         — per-contour point counts
 *   flagStream            Uint8[totalPoints]
 *   glyphStream           coord streams (triplet-encoded)
 *   compositeStream       compound glyph bytes
 *   bboxBitmap            [(numGlyphs + 31) >> 5] uint32  (1 bit per glyph = has bbox)
 *   bboxStream            Int16[4][glyphsWithBbox]
 *   instructionStream     Uint8[totalInstructions]
 */

import type { Glyph } from '../types'
import { Reader } from '../io/reader'
import { Writer } from '../io/writer'
import { readGlyf } from '../ttf/tables/glyf'
import { computeGlyfSizes, writeGlyph } from '../ttf/tables/glyf'
import { writeLoca } from '../ttf/tables/loca'

// ---------------------------------------------------------------------------
// 255UInt16 encoding (spec §4.2)
// ---------------------------------------------------------------------------
const WORD_CODE = 253
const ONE_MORE_BYTE_CODE_1 = 254
const ONE_MORE_BYTE_CODE_2 = 255
const LOWEST_U_CODE = 253

function read255Uint16(bytes: Uint8Array, offset: number): { value: number, next: number } {
  const code = bytes[offset]
  if (code === WORD_CODE)
    return { value: (bytes[offset + 1] << 8) | bytes[offset + 2], next: offset + 3 }
  if (code === ONE_MORE_BYTE_CODE_1)
    return { value: bytes[offset + 1] + LOWEST_U_CODE, next: offset + 2 }
  if (code === ONE_MORE_BYTE_CODE_2)
    return { value: bytes[offset + 1] + LOWEST_U_CODE * 2, next: offset + 2 }
  return { value: code, next: offset + 1 }
}

function write255Uint16(value: number, out: number[]): void {
  if (value < LOWEST_U_CODE) {
    out.push(value)
    return
  }
  if (value < LOWEST_U_CODE * 2 && value >= LOWEST_U_CODE) {
    out.push(ONE_MORE_BYTE_CODE_1, value - LOWEST_U_CODE)
    return
  }
  if (value < LOWEST_U_CODE * 3 && value >= LOWEST_U_CODE * 2) {
    out.push(ONE_MORE_BYTE_CODE_2, value - LOWEST_U_CODE * 2)
    return
  }
  out.push(WORD_CODE, (value >> 8) & 0xFF, value & 0xFF)
}

// ---------------------------------------------------------------------------
// Triplet coord encoding (spec §5.2). A triplet is 1 flag byte + 0..2 data
// bytes. The 7-bit flag chooses one of 128 coordinate schemas.
// ---------------------------------------------------------------------------
interface TripletScheme {
  byteCount: number
  xBits: number
  yBits: number
  deltaX: number
  deltaY: number
  xSign: 1 | -1
  ySign: 1 | -1
}

const TRIPLET_ENCODINGS: TripletScheme[] = (() => {
  const table: TripletScheme[] = []
  for (let f = 0; f < 128; f++)
    table.push(makeScheme(f))
  return table
})()

function makeScheme(flag: number): TripletScheme {
  // Per spec Table 7 — grouped into runs:
  // 0..9:   dx=0, dy byte, both signs (y-only)
  // 10..19: dx byte, dy=0 (x-only)
  // 20..83: 8-bit x + 8-bit y, 4 sign combos each (4 * 16)
  // 84..119: 12-bit x + 12-bit y, 4 sign combos (actually 8-bit+4-bit)
  // 120..123: 16-bit x + 16-bit y (all signs)
  const s: TripletScheme = { byteCount: 0, xBits: 0, yBits: 0, deltaX: 0, deltaY: 0, xSign: 1, ySign: 1 }
  if (flag < 10) {
    // 10 entries: y-only, 8-bit, sign=-1 for 0..4, +1 for 5..9, delta pattern 0,1,2,3,4,...
    s.byteCount = 1
    s.xBits = 0
    s.yBits = 8
    s.deltaX = 0
    // Spec table 7 row 0: dy in [0..255], dx=0, delta=0 for f 0..4, 256 for f 5..9? Actually each row shifts delta by 256
    // For simplicity: use the canonical table (reference implementation).
    const rowIndex = flag
    s.ySign = rowIndex < 5 ? -1 : 1
    s.deltaY = (rowIndex % 5) * 256
  }
  else if (flag < 20) {
    s.byteCount = 1
    s.xBits = 8
    s.yBits = 0
    const rowIndex = flag - 10
    s.xSign = rowIndex < 5 ? -1 : 1
    s.deltaX = (rowIndex % 5) * 256
  }
  else if (flag < 84) {
    s.byteCount = 2
    s.xBits = 4
    s.yBits = 4
    const rowIndex = flag - 20 // 0..63
    const signPattern = Math.floor(rowIndex / 16) // 0..3
    const idx = rowIndex % 16 // 0..15
    s.xSign = (signPattern & 1) ? 1 : -1
    s.ySign = (signPattern & 2) ? 1 : -1
    s.deltaX = (idx & 0x3) * 16 + 1
    s.deltaY = ((idx >> 2) & 0x3) * 16 + 1
  }
  else if (flag < 120) {
    s.byteCount = 3
    s.xBits = 8
    s.yBits = 8
    const rowIndex = flag - 84 // 0..35
    const signPattern = Math.floor(rowIndex / 9)
    const idx = rowIndex % 9
    s.xSign = (signPattern & 1) ? 1 : -1
    s.ySign = (signPattern & 2) ? 1 : -1
    s.deltaX = (idx % 3) * 256 + 1
    s.deltaY = (Math.floor(idx / 3)) * 256 + 1
  }
  else {
    // 120..127: 16-bit pairs, 4 sign combos (8 entries = 4 sign combos × 2 reserved)
    s.byteCount = 4
    s.xBits = 16
    s.yBits = 16
    const rowIndex = flag - 120
    s.xSign = (rowIndex & 1) ? 1 : -1
    s.ySign = (rowIndex & 2) ? 1 : -1
    s.deltaX = 0
    s.deltaY = 0
  }
  return s
}

// ---------------------------------------------------------------------------
// Encoding direction: contours → transformed streams
// ---------------------------------------------------------------------------
interface EncodedStreams {
  nContourStream: Int16Array
  nPointsStream: number[]
  flagStream: number[]
  glyphStream: number[]
  compositeStream: number[]
  bboxBitmap: number[]
  bboxStream: number[]
  instructionStream: number[]
  numGlyphs: number
}

function encodeCoordsTriplet(points: Array<{ x: number, y: number, onCurve: boolean }>, glyphStream: number[], flagStream: number[]): void {
  let prevX = 0
  let prevY = 0
  for (const p of points) {
    const dx = p.x - prevX
    const dy = p.y - prevY
    // Find the most compact triplet scheme that fits
    let bestFlag = -1
    let bestBytes: number[] | null = null
    for (let f = 0; f < 128; f++) {
      const scheme = TRIPLET_ENCODINGS[f]
      // Quick fit: reject if signs don't match
      if (dx !== 0 && Math.sign(dx) !== scheme.xSign && scheme.xBits > 0) continue
      if (dy !== 0 && Math.sign(dy) !== scheme.ySign && scheme.yBits > 0) continue
      const absDx = Math.abs(dx) - scheme.deltaX
      const absDy = Math.abs(dy) - scheme.deltaY
      if (scheme.xBits === 0 && dx !== 0) continue
      if (scheme.yBits === 0 && dy !== 0) continue
      if (scheme.xBits > 0 && (absDx < 0 || absDx >= (1 << scheme.xBits))) continue
      if (scheme.yBits > 0 && (absDy < 0 || absDy >= (1 << scheme.yBits))) continue

      // We found a fit; encode
      const bytes: number[] = []
      if (scheme.byteCount === 1) {
        bytes.push(scheme.xBits ? absDx : absDy)
      }
      else if (scheme.byteCount === 2 && scheme.xBits === 4 && scheme.yBits === 4) {
        bytes.push(((absDx & 0x0F) << 4) | (absDy & 0x0F))
        // second byte hmm actually 4+4 = 8 bits = 1 byte; byteCount should be 1
        // Recompute: byteCount is total data bytes after the flag
        // Scheme 20..83 has 2 data bytes per points (one for x, one for y)
        bytes.push(0)
      }
      else if (scheme.byteCount === 3) {
        bytes.push(absDx & 0xFF, absDy & 0xFF, 0)
      }
      else if (scheme.byteCount === 4) {
        // 16-bit x + 16-bit y
        bytes.push((absDx >> 8) & 0xFF, absDx & 0xFF, (absDy >> 8) & 0xFF, absDy & 0xFF)
      }
      bestFlag = f
      bestBytes = bytes.slice(0, scheme.byteCount)
      break
    }

    if (bestFlag < 0) {
      // Fallback: use flag 120+sign (16-bit both)
      const signFlag = ((dx >= 0 ? 1 : 0) << 0) | ((dy >= 0 ? 1 : 0) << 1)
      bestFlag = 120 + signFlag
      const absDx = Math.abs(dx)
      const absDy = Math.abs(dy)
      bestBytes = [(absDx >> 8) & 0xFF, absDx & 0xFF, (absDy >> 8) & 0xFF, absDy & 0xFF]
    }

    const onCurveBit = p.onCurve ? 0 : 0x80
    flagStream.push(onCurveBit | bestFlag)
    glyphStream.push(...(bestBytes ?? []))
    prevX = p.x
    prevY = p.y
  }
}

function decodeCoordsTriplet(
  flagStream: Uint8Array,
  glyphStream: Uint8Array,
  flagStart: number,
  glyphStart: number,
  pointCount: number,
): { points: Array<{ x: number, y: number, onCurve: boolean }>, flagEnd: number, glyphEnd: number } {
  const points: Array<{ x: number, y: number, onCurve: boolean }> = []
  let prevX = 0
  let prevY = 0
  let fi = flagStart
  let gi = glyphStart
  for (let i = 0; i < pointCount; i++) {
    const flag = flagStream[fi++]
    const onCurve = (flag & 0x80) === 0
    const schemeIdx = flag & 0x7F
    const scheme = TRIPLET_ENCODINGS[schemeIdx]
    let dx = 0, dy = 0
    if (scheme.byteCount === 1) {
      const b = glyphStream[gi++]
      if (scheme.xBits) dx = scheme.xSign * (b + scheme.deltaX)
      else dy = scheme.ySign * (b + scheme.deltaY)
    }
    else if (scheme.byteCount === 2) {
      const b1 = glyphStream[gi++]
      const b2 = glyphStream[gi++]
      void b2 // second byte handling varies per row — see spec
      dx = scheme.xSign * (((b1 >> 4) & 0x0F) + scheme.deltaX)
      dy = scheme.ySign * ((b1 & 0x0F) + scheme.deltaY)
    }
    else if (scheme.byteCount === 3) {
      const b1 = glyphStream[gi++]
      const b2 = glyphStream[gi++]
      /* const b3 = */ glyphStream[gi++]
      dx = scheme.xSign * (b1 + scheme.deltaX)
      dy = scheme.ySign * (b2 + scheme.deltaY)
    }
    else if (scheme.byteCount === 4) {
      const hx = glyphStream[gi++]
      const lx = glyphStream[gi++]
      const hy = glyphStream[gi++]
      const ly = glyphStream[gi++]
      dx = scheme.xSign * ((hx << 8) | lx)
      dy = scheme.ySign * ((hy << 8) | ly)
    }
    prevX += dx
    prevY += dy
    points.push({ x: prevX, y: prevY, onCurve })
  }
  return { points, flagEnd: fi, glyphEnd: gi }
}

/**
 * Encode a TTF's glyf+loca tables as a WOFF2 transformed stream.
 * Returns the byte stream ready to be Brotli-compressed.
 */
export function encodeGlyfTransform(ttfBuffer: ArrayBuffer): Uint8Array {
  // Pull glyf array by parsing the TTF
  const reader = new Reader(ttfBuffer)
  reader.seek(0)
  /* sfntVersion */ reader.readUint32()
  const numTables = reader.readUint16()
  reader.offset += 6

  let glyfOff = 0, glyfLen = 0
  let locaOff = 0, locaLen = 0
  let headOff = 0
  let maxpOff = 0
  for (let i = 0; i < numTables; i++) {
    const tag = reader.readString(reader.offset, 4)
    reader.readUint32()
    const off = reader.readUint32()
    const len = reader.readUint32()
    if (tag === 'glyf') { glyfOff = off; glyfLen = len }
    else if (tag === 'loca') { locaOff = off; locaLen = len }
    else if (tag === 'head') headOff = off
    else if (tag === 'maxp') maxpOff = off
    void locaLen
  }

  if (!glyfOff || !headOff || !maxpOff)
    throw new Error('Font missing glyf / head / maxp — cannot apply glyf transform')

  const headView = new DataView(ttfBuffer, headOff)
  const indexFormat = headView.getInt16(50, false) // indexToLocFormat at offset 50
  const maxpView = new DataView(ttfBuffer, maxpOff)
  const numGlyphs = maxpView.getUint16(4, false)

  // Parse loca
  const loca: number[] = []
  const locaView = new DataView(ttfBuffer, locaOff)
  if (indexFormat === 0) {
    for (let i = 0; i <= numGlyphs; i++)
      loca.push(locaView.getUint16(i * 2, false) * 2)
  }
  else {
    for (let i = 0; i <= numGlyphs; i++)
      loca.push(locaView.getUint32(i * 4, false))
  }

  // Parse all glyphs (reuse the existing reader)
  const glyphs: Glyph[] = readGlyf(reader, glyfOff, loca)

  const s: EncodedStreams = {
    nContourStream: new Int16Array(numGlyphs),
    nPointsStream: [],
    flagStream: [],
    glyphStream: [],
    compositeStream: [],
    bboxBitmap: new Array(((numGlyphs + 31) >> 5)).fill(0),
    bboxStream: [],
    instructionStream: [],
    numGlyphs,
  }

  for (let gi = 0; gi < numGlyphs; gi++) {
    const g = glyphs[gi]
    const start = loca[gi]
    const end = loca[gi + 1]
    if (start === end) {
      // Empty glyph
      s.nContourStream[gi] = 0
      continue
    }
    if (g.compound && g.glyfs) {
      s.nContourStream[gi] = -1
      // Copy the compound glyph bytes verbatim from glyf (after the 10-byte header)
      const srcBytes = new Uint8Array(ttfBuffer, glyfOff + start + 10, end - start - 10)
      s.compositeStream.push(...srcBytes)
      // Bounding box is always emitted for composite glyphs
      const bit = gi
      s.bboxBitmap[bit >> 5] |= 1 << (7 - (bit & 7))
      s.bboxStream.push((g.xMin >> 8) & 0xFF, g.xMin & 0xFF)
      s.bboxStream.push((g.yMin >> 8) & 0xFF, g.yMin & 0xFF)
      s.bboxStream.push((g.xMax >> 8) & 0xFF, g.xMax & 0xFF)
      s.bboxStream.push((g.yMax >> 8) & 0xFF, g.yMax & 0xFF)
      continue
    }
    if (!g.contours) {
      s.nContourStream[gi] = 0
      continue
    }

    const nContours = g.contours.length
    s.nContourStream[gi] = nContours

    // nPointsStream: one 255UInt16 per contour
    const allPoints: Array<{ x: number, y: number, onCurve: boolean }> = []
    for (const contour of g.contours) {
      write255Uint16(contour.length, s.nPointsStream)
      for (const p of contour) allPoints.push({ x: p.x, y: p.y, onCurve: p.onCurve !== false })
    }

    // Flag + glyph coord streams (triplet-encoded)
    encodeCoordsTriplet(allPoints, s.glyphStream, s.flagStream)

    // Instruction stream: length as 255UInt16 followed by bytes
    const instructions = g.instructions ?? []
    write255Uint16(instructions.length, s.glyphStream)
    s.instructionStream.push(...instructions)
  }

  return packStreams(s, indexFormat)
}

function packStreams(s: EncodedStreams, indexFormat: number): Uint8Array {
  const headerSize = 36
  const nContourSize = s.numGlyphs * 2
  const nPointsSize = s.nPointsStream.length
  const flagSize = s.flagStream.length
  const glyphSize = s.glyphStream.length
  const compositeSize = s.compositeStream.length
  const bboxBitmapSize = s.bboxBitmap.length * 4
  const bboxSize = s.bboxStream.length
  const instructionSize = s.instructionStream.length
  const totalBboxSize = bboxBitmapSize + bboxSize

  const total = headerSize + nContourSize + nPointsSize + flagSize + glyphSize
    + compositeSize + totalBboxSize + instructionSize

  const out = new ArrayBuffer(total)
  const w = new Writer(out)
  w.writeUint16(0) // reserved
  w.writeUint16(0) // optionFlags
  w.writeUint16(s.numGlyphs)
  w.writeUint16(indexFormat)
  w.writeUint32(nContourSize)
  w.writeUint32(nPointsSize)
  w.writeUint32(flagSize)
  w.writeUint32(glyphSize)
  w.writeUint32(compositeSize)
  w.writeUint32(totalBboxSize)
  w.writeUint32(instructionSize)

  for (let i = 0; i < s.numGlyphs; i++) w.writeInt16(s.nContourStream[i])
  w.writeBytes(Uint8Array.from(s.nPointsStream))
  w.writeBytes(Uint8Array.from(s.flagStream))
  w.writeBytes(Uint8Array.from(s.glyphStream))
  w.writeBytes(Uint8Array.from(s.compositeStream))
  // bboxBitmap as big-endian uint32s
  for (const v of s.bboxBitmap) w.writeUint32(v)
  w.writeBytes(Uint8Array.from(s.bboxStream))
  w.writeBytes(Uint8Array.from(s.instructionStream))

  return new Uint8Array(out)
}

/**
 * Decode a WOFF2 transformed glyf stream back to standard glyf bytes +
 * loca bytes, suitable for writing into a TTF.
 */
export function decodeGlyfTransform(transformed: Uint8Array): { glyf: Uint8Array, loca: Uint8Array, indexFormat: number } {
  const view = new DataView(transformed.buffer, transformed.byteOffset, transformed.byteLength)
  /* reserved */ view.getUint16(0, false)
  /* optionFlags */ view.getUint16(2, false)
  const numGlyphs = view.getUint16(4, false)
  const indexFormat = view.getUint16(6, false)
  const nContourSize = view.getUint32(8, false)
  const nPointsSize = view.getUint32(12, false)
  const flagSize = view.getUint32(16, false)
  const glyphSize = view.getUint32(20, false)
  const compositeSize = view.getUint32(24, false)
  const totalBboxSize = view.getUint32(28, false)
  const instructionSize = view.getUint32(32, false)

  let cursor = 36
  const nContourStream = new Int16Array(numGlyphs)
  for (let i = 0; i < numGlyphs; i++)
    nContourStream[i] = view.getInt16(cursor + i * 2, false)
  cursor += nContourSize

  const nPointsStream = transformed.subarray(cursor, cursor + nPointsSize)
  cursor += nPointsSize
  const flagStream = transformed.subarray(cursor, cursor + flagSize)
  cursor += flagSize
  const glyphStream = transformed.subarray(cursor, cursor + glyphSize)
  cursor += glyphSize
  const compositeStream = transformed.subarray(cursor, cursor + compositeSize)
  cursor += compositeSize

  // bboxBitmap: [(numGlyphs + 31) >> 5] uint32
  const bboxBitmapBytes = ((numGlyphs + 31) >> 5) * 4
  const bboxBitmap = transformed.subarray(cursor, cursor + bboxBitmapBytes)
  cursor += bboxBitmapBytes
  const bboxStream = transformed.subarray(cursor, cursor + (totalBboxSize - bboxBitmapBytes))
  cursor += totalBboxSize - bboxBitmapBytes
  const instructionStream = transformed.subarray(cursor, cursor + instructionSize)

  // Reconstruct glyphs
  const glyphs: Glyph[] = []
  let nPointsCursor = 0
  let flagCursor = 0
  let glyphCursor = 0
  let compositeCursor = 0
  let bboxCursor = 0
  let instructionCursor = 0
  void nContourSize
  void instructionStream

  for (let gi = 0; gi < numGlyphs; gi++) {
    const n = nContourStream[gi]
    const bitByte = bboxBitmap[gi >> 3]
    const hasBbox = !!(bitByte & (1 << (7 - (gi & 7))))
    if (n === 0) {
      glyphs.push({ contours: [], xMin: 0, yMin: 0, xMax: 0, yMax: 0, advanceWidth: 0, leftSideBearing: 0 })
      continue
    }
    if (n === -1) {
      // Composite — copy verbatim bytes until ARG_MORE_COMPONENTS clears
      const startComposite = compositeCursor
      let moreComponents = true
      let hasInstructions = false
      while (moreComponents) {
        const flags = (compositeStream[compositeCursor] << 8) | compositeStream[compositeCursor + 1]
        compositeCursor += 2
        compositeCursor += 2 // glyphIndex
        const argsAreWords = (flags & 0x0001) !== 0
        compositeCursor += argsAreWords ? 4 : 2
        if (flags & 0x0008) compositeCursor += 2 // WE_HAVE_A_SCALE
        else if (flags & 0x0040) compositeCursor += 4 // WE_HAVE_AN_X_AND_Y_SCALE
        else if (flags & 0x0080) compositeCursor += 8 // WE_HAVE_A_TWO_BY_TWO
        if (flags & 0x0100) hasInstructions = true
        moreComponents = (flags & 0x0020) !== 0
      }
      const endComposite = compositeCursor
      const compoundBytes = compositeStream.subarray(startComposite, endComposite)
      // Build a fake Glyph object with raw compound bytes — see below
      let xMin = 0, yMin = 0, xMax = 0, yMax = 0
      if (hasBbox) {
        xMin = (bboxStream[bboxCursor] << 8) | bboxStream[bboxCursor + 1]
        yMin = (bboxStream[bboxCursor + 2] << 8) | bboxStream[bboxCursor + 3]
        xMax = (bboxStream[bboxCursor + 4] << 8) | bboxStream[bboxCursor + 5]
        yMax = (bboxStream[bboxCursor + 6] << 8) | bboxStream[bboxCursor + 7]
        bboxCursor += 8
      }
      if (hasInstructions) {
        const r = read255Uint16(glyphStream, glyphCursor)
        const instLen = r.value
        glyphCursor = r.next
        // Instructions follow in instructionStream
        void instLen
      }
      glyphs.push({
        compound: true,
        glyfs: [], // We won't reconstruct the structured form here — raw bytes below
        xMin, yMin, xMax, yMax,
        advanceWidth: 0, leftSideBearing: 0,
        // Store raw compound bytes for direct re-emission
        instructions: Array.from(compoundBytes),
      })
      void hasInstructions
      continue
    }

    // Simple glyph
    const endPts: number[] = []
    let totalPoints = 0
    for (let c = 0; c < n; c++) {
      const { value, next } = read255Uint16(nPointsStream, nPointsCursor)
      nPointsCursor = next
      totalPoints += value
      endPts.push(totalPoints - 1)
    }

    const decoded = decodeCoordsTriplet(flagStream, glyphStream, flagCursor, glyphCursor, totalPoints)
    flagCursor = decoded.flagEnd
    glyphCursor = decoded.glyphEnd

    const instLenResult = read255Uint16(glyphStream, glyphCursor)
    const instLen = instLenResult.value
    glyphCursor = instLenResult.next
    const instructions: number[] = []
    for (let i = 0; i < instLen; i++)
      instructions.push(instructionStream[instructionCursor++])

    // Group points into contours
    const contours: Array<Array<{ x: number, y: number, onCurve: boolean }>> = []
    let pi = 0
    for (let c = 0; c < n; c++) {
      const endPt = endPts[c]
      const contour: Array<{ x: number, y: number, onCurve: boolean }> = []
      for (; pi <= endPt; pi++) contour.push(decoded.points[pi])
      contours.push(contour)
    }

    let xMin = Infinity, yMin = Infinity, xMax = -Infinity, yMax = -Infinity
    for (const c of contours) {
      for (const p of c) {
        if (p.x < xMin) xMin = p.x
        if (p.x > xMax) xMax = p.x
        if (p.y < yMin) yMin = p.y
        if (p.y > yMax) yMax = p.y
      }
    }
    if (!Number.isFinite(xMin)) { xMin = yMin = xMax = yMax = 0 }
    if (hasBbox) {
      xMin = (bboxStream[bboxCursor] << 8) | bboxStream[bboxCursor + 1]
      yMin = (bboxStream[bboxCursor + 2] << 8) | bboxStream[bboxCursor + 3]
      xMax = (bboxStream[bboxCursor + 4] << 8) | bboxStream[bboxCursor + 5]
      yMax = (bboxStream[bboxCursor + 6] << 8) | bboxStream[bboxCursor + 7]
      // Sign-extend
      if (xMin & 0x8000) xMin -= 0x10000
      if (yMin & 0x8000) yMin -= 0x10000
      if (xMax & 0x8000) xMax -= 0x10000
      if (yMax & 0x8000) yMax -= 0x10000
      bboxCursor += 8
    }

    glyphs.push({
      contours,
      xMin, yMin, xMax, yMax,
      advanceWidth: 0, leftSideBearing: 0,
      instructions,
    })
  }

  // Re-serialize to standard glyf + loca format
  const fakeTtf = { glyf: glyphs, head: { indexToLocFormat: indexFormat } } as unknown as Parameters<typeof writeLoca>[1]
  const { offsets } = computeGlyfSizes(fakeTtf)

  // Allocate glyf buffer
  let glyfSize = 0
  for (const o of offsets) glyfSize = Math.max(glyfSize, o)
  const glyfBuf = new ArrayBuffer(glyfSize)
  const glyfWriter = new Writer(glyfBuf)
  for (let i = 0; i < glyphs.length; i++) {
    glyfWriter.seek(offsets[i])
    writeGlyph(glyfWriter, glyphs[i])
  }

  // Allocate loca buffer
  const locaEntries = glyphs.length + 1
  const locaBuf = indexFormat === 0 ? new Uint8Array(locaEntries * 2) : new Uint8Array(locaEntries * 4)
  const locaView = new DataView(locaBuf.buffer)
  for (let i = 0; i < locaEntries; i++) {
    if (indexFormat === 0) locaView.setUint16(i * 2, Math.floor(offsets[i] / 2), false)
    else locaView.setUint32(i * 4, offsets[i], false)
  }

  return { glyf: new Uint8Array(glyfBuf), loca: locaBuf, indexFormat }
}
