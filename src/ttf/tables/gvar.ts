import type { GvarGlyphVariation, GvarTable, GvarTuple, TTFObject } from '../../types'
import { Reader } from '../../io/reader'
import { Writer } from '../../io/writer'

// Tuple variation header flags (shared with gvar, cvar, and ItemVariationStore)
const EMBEDDED_PEAK_TUPLE = 0x8000
const INTERMEDIATE_REGION = 0x4000
const PRIVATE_POINT_NUMBERS = 0x2000
const TUPLE_INDEX_MASK = 0x0FFF

// Gvar glyph variation data header flag
const SHARED_POINT_NUMBERS = 0x8000
const GVAR_COUNT_MASK = 0x0FFF

// Packed point / delta run flags
const POINTS_ARE_WORDS = 0x80
const POINT_RUN_COUNT_MASK = 0x7F
const DELTAS_ARE_ZERO = 0x80
const DELTAS_ARE_WORDS = 0x40
const DELTA_RUN_COUNT_MASK = 0x3F

/**
 * Parse gvar with full tuple-level glyph variation decoding.
 *
 * gvar layout:
 *   header (majorVersion, minorVersion, axisCount, sharedTupleCount,
 *           sharedTuplesOffset, glyphCount, flags, glyphVariationDataArrayOffset)
 *   glyphVariationDataOffsets[glyphCount + 1]
 *   sharedTuples[sharedTupleCount]
 *   glyphVariationData[glyphCount]
 */
export function readGvar(buffer: ArrayBuffer, gvarOffset: number, gvarLength: number, glyphPointCounts: number[]): GvarTable {
  // Use a non-windowed Reader and absolute offsets; windowed Readers have
  // subtle offset semantics and we want precise control over bounds.
  const reader = new Reader(buffer)
  const gvarEnd = gvarOffset + gvarLength
  reader.seek(gvarOffset)

  const majorVersion = reader.readUint16()
  const minorVersion = reader.readUint16()
  const axisCount = reader.readUint16()
  const sharedTupleCount = reader.readUint16()
  const sharedTuplesOffset = reader.readUint32()
  const glyphCount = reader.readUint16()
  const flags = reader.readUint16()
  const glyphVariationDataArrayOffset = reader.readUint32()

  const isLongOffsets = (flags & 0x0001) !== 0
  const dataOffsets: number[] = []
  for (let i = 0; i <= glyphCount; i++) {
    if (isLongOffsets)
      dataOffsets.push(reader.readUint32())
    else
      dataOffsets.push(reader.readUint16() * 2)
  }

  // Shared tuples are absolute offset gvarOffset + sharedTuplesOffset
  const sharedTuples: number[][] = []
  reader.seek(gvarOffset + sharedTuplesOffset)
  for (let i = 0; i < sharedTupleCount; i++) {
    const tuple: number[] = []
    for (let j = 0; j < axisCount; j++)
      tuple.push(reader.readF2Dot14())
    sharedTuples.push(tuple)
  }

  const dataArrayBase = gvarOffset + glyphVariationDataArrayOffset
  const glyphVariations: GvarGlyphVariation[] = []
  for (let g = 0; g < glyphCount; g++) {
    const start = dataArrayBase + dataOffsets[g]
    const end = dataArrayBase + dataOffsets[g + 1]
    if (start === end || end > gvarEnd || start >= gvarEnd) {
      glyphVariations.push({ tuples: [] })
      continue
    }
    try {
      const pointCount = glyphPointCounts[g] ?? 0
      const phantomPoints = 4
      const totalPoints = pointCount + phantomPoints
      const gv = readGlyphVariationData(reader, start, end, axisCount, sharedTuples, totalPoints)
      glyphVariations.push(gv)
    }
    catch {
      glyphVariations.push({ tuples: [] })
    }
  }

  return {
    majorVersion,
    minorVersion,
    axisCount,
    sharedTuples,
    glyphVariations,
  }
}

function readGlyphVariationData(
  reader: Reader,
  start: number,
  end: number,
  axisCount: number,
  sharedTuples: number[][],
  pointCount: number,
): GvarGlyphVariation {
  if (start >= end)
    return { tuples: [] }
  reader.seek(start)
  const tupleVariationCountRaw = reader.readUint16()
  const tupleCount = tupleVariationCountRaw & GVAR_COUNT_MASK
  const hasSharedPoints = (tupleVariationCountRaw & SHARED_POINT_NUMBERS) !== 0
  const dataOffsetFromHeader = reader.readUint16()

  interface TupleHeader {
    variationDataSize: number
    tupleIndex: number
    embeddedPeak?: number[]
    intermediateStart?: number[]
    intermediateEnd?: number[]
    privatePoints: boolean
  }

  const tupleHeaders: TupleHeader[] = []
  for (let t = 0; t < tupleCount; t++) {
    const variationDataSize = reader.readUint16()
    const tupleIndex = reader.readUint16()
    const header: TupleHeader = {
      variationDataSize,
      tupleIndex: tupleIndex & TUPLE_INDEX_MASK,
      privatePoints: (tupleIndex & PRIVATE_POINT_NUMBERS) !== 0,
    }
    if (tupleIndex & EMBEDDED_PEAK_TUPLE) {
      header.embeddedPeak = []
      for (let a = 0; a < axisCount; a++)
        header.embeddedPeak.push(reader.readF2Dot14())
    }
    if (tupleIndex & INTERMEDIATE_REGION) {
      header.intermediateStart = []
      for (let a = 0; a < axisCount; a++)
        header.intermediateStart.push(reader.readF2Dot14())
      header.intermediateEnd = []
      for (let a = 0; a < axisCount; a++)
        header.intermediateEnd.push(reader.readF2Dot14())
    }
    tupleHeaders.push(header)
  }

  // Serialized data section begins at `start + dataOffsetFromHeader`.
  const dataStart = start + dataOffsetFromHeader
  reader.seek(dataStart)

  let sharedPointIndices: number[] | undefined
  let cursor = dataStart
  if (hasSharedPoints) {
    const packed = unpackPointNumbers(reader, cursor, pointCount)
    sharedPointIndices = packed.points
    cursor = packed.endOffset
  }

  const tuples: GvarTuple[] = []
  for (const header of tupleHeaders) {
    const tupleDataEnd = cursor + header.variationDataSize

    let pointIndices: number[] | undefined
    if (header.privatePoints) {
      const packed = unpackPointNumbers(reader, cursor, pointCount)
      pointIndices = packed.points
      cursor = packed.endOffset
    }
    else {
      pointIndices = sharedPointIndices
    }

    const count = pointIndices?.length ?? pointCount
    const xDeltas = unpackDeltas(reader, cursor, count)
    cursor = xDeltas.endOffset
    const yDeltas = unpackDeltas(reader, cursor, count)
    cursor = yDeltas.endOffset

    const deltas: Array<{ x: number, y: number }> = []
    for (let i = 0; i < count; i++)
      deltas.push({ x: xDeltas.values[i] ?? 0, y: yDeltas.values[i] ?? 0 })

    const peakCoords = header.embeddedPeak ?? sharedTuples[header.tupleIndex] ?? new Array(axisCount).fill(0)

    tuples.push({
      peakCoords,
      intermediateStartCoords: header.intermediateStart,
      intermediateEndCoords: header.intermediateEnd,
      pointIndices,
      deltas,
    })

    cursor = tupleDataEnd
    if (cursor > end)
      break
  }

  return { tuples }
}

/**
 * Decode a "packed point numbers" array per TrueType gvar spec.
 * Returns an array of point indices (or undefined meaning "all points").
 */
function unpackPointNumbers(reader: Reader, startOff: number, fallbackPointCount: number): { points: number[] | undefined, endOffset: number } {
  reader.seek(startOff)
  const first = reader.readUint8()
  let count: number
  let cursor = startOff + 1
  if (first === 0) {
    // Means "apply to all points"
    const all: number[] = Array.from({ length: fallbackPointCount }, (_, i) => i)
    return { points: all, endOffset: cursor }
  }
  if (first & POINTS_ARE_WORDS) {
    const low = reader.readUint8()
    count = ((first & POINT_RUN_COUNT_MASK) << 8) | low
    cursor += 1
  }
  else {
    count = first
  }

  const points: number[] = []
  let last = 0
  reader.seek(cursor)
  while (points.length < count) {
    const runHeader = reader.readUint8()
    cursor += 1
    const useWords = (runHeader & POINTS_ARE_WORDS) !== 0
    const runLen = (runHeader & POINT_RUN_COUNT_MASK) + 1
    for (let i = 0; i < runLen && points.length < count; i++) {
      let delta: number
      if (useWords) {
        delta = reader.readUint16()
        cursor += 2
      }
      else {
        delta = reader.readUint8()
        cursor += 1
      }
      last += delta
      points.push(last)
    }
  }
  return { points, endOffset: cursor }
}

/**
 * Decode a "packed deltas" run per TrueType spec.
 */
function unpackDeltas(reader: Reader, startOff: number, count: number): { values: number[], endOffset: number } {
  const values: number[] = []
  let cursor = startOff
  reader.seek(cursor)
  while (values.length < count) {
    const runHeader = reader.readUint8()
    cursor += 1
    const runLen = (runHeader & DELTA_RUN_COUNT_MASK) + 1
    if (runHeader & DELTAS_ARE_ZERO) {
      for (let i = 0; i < runLen && values.length < count; i++)
        values.push(0)
    }
    else if (runHeader & DELTAS_ARE_WORDS) {
      for (let i = 0; i < runLen && values.length < count; i++) {
        values.push(reader.readInt16())
        cursor += 2
      }
    }
    else {
      for (let i = 0; i < runLen && values.length < count; i++) {
        values.push(reader.readInt8())
        cursor += 1
      }
    }
  }
  return { values, endOffset: cursor }
}

/**
 * Compute the scalar multiplier a tuple contributes at the given
 * normalized coordinate vector, per the TrueType tuple scalar formula.
 *
 * If the coord is outside the region ([start..peak..end] or [-peak..peak]),
 * returns 0 (tuple does not apply).
 */
export function tupleScalar(
  tuple: GvarTuple,
  normalizedCoords: number[],
): number {
  let scalar = 1
  for (let a = 0; a < tuple.peakCoords.length; a++) {
    const coord = normalizedCoords[a] ?? 0
    const peak = tuple.peakCoords[a]
    if (peak === 0) continue

    let start: number, end: number
    if (tuple.intermediateStartCoords && tuple.intermediateEndCoords) {
      start = tuple.intermediateStartCoords[a]
      end = tuple.intermediateEndCoords[a]
    }
    else {
      // Default symmetric region: from 0 through peak (peak sign determines direction)
      start = peak < 0 ? peak : 0
      end = peak > 0 ? peak : 0
    }

    if (coord === peak)
      continue
    if (coord <= start || coord >= end)
      return 0
    if (coord < peak)
      scalar *= (coord - start) / (peak - start)
    else
      scalar *= (end - coord) / (end - peak)
  }
  return scalar
}

// -----------------------------------------------------------------------
// Writer
// -----------------------------------------------------------------------

/**
 * Pack a sorted point-index array using TrueType's incremental-delta encoding.
 * Leading "0" means "apply to every point"; otherwise we emit a count
 * (1 or 2 bytes), then runs of up to 128 deltas.
 */
export function packPointNumbers(points: number[] | undefined): Uint8Array {
  if (points === undefined) return new Uint8Array([0])
  const count = points.length
  const header: number[] = []
  if (count < 128) header.push(count)
  else header.push(((count >> 8) & 0x7F) | 0x80, count & 0xFF)

  const useWords = points.some((p, i) => {
    const prev = i === 0 ? 0 : points[i - 1]!
    const delta = p - prev
    return delta < 0 || delta > 0xFF
  })

  const body: number[] = []
  let remaining = count
  let idx = 0
  let last = 0
  while (remaining > 0) {
    const runLen = Math.min(remaining, 128)
    let runHeader = (runLen - 1) & 0x7F
    if (useWords) runHeader |= POINTS_ARE_WORDS
    body.push(runHeader)
    for (let i = 0; i < runLen; i++) {
      const p = points[idx++]!
      const delta = p - last
      if (useWords) body.push((delta >> 8) & 0xFF, delta & 0xFF)
      else body.push(delta & 0xFF)
      last = p
    }
    remaining -= runLen
  }
  return new Uint8Array([...header, ...body])
}

/**
 * Pack a deltas array using run-length encoding per TrueType spec.
 * Emits zero-runs, int8 runs, and int16 runs — whichever is shortest.
 */
export function packDeltas(values: number[]): Uint8Array {
  const out: number[] = []
  let i = 0
  while (i < values.length) {
    // Zero run
    let zeros = 0
    while (i + zeros < values.length && values[i + zeros] === 0 && zeros < 64) zeros++
    if (zeros > 0) {
      out.push(DELTAS_ARE_ZERO | ((zeros - 1) & 0x3F))
      i += zeros
      continue
    }
    // Non-zero run. Pick 8-bit or 16-bit based on first value; extend while consistent.
    const firstNeedsWord = values[i]! < -128 || values[i]! > 127
    let runLen = 0
    const maxRun = 64
    while (i + runLen < values.length && runLen < maxRun) {
      const v = values[i + runLen]!
      if (v === 0) break
      const vNeedsWord = v < -128 || v > 127
      if (vNeedsWord !== firstNeedsWord) break
      runLen++
    }
    let header = (runLen - 1) & 0x3F
    if (firstNeedsWord) header |= DELTAS_ARE_WORDS
    out.push(header)
    for (let j = 0; j < runLen; j++) {
      const v = values[i + j]!
      if (firstNeedsWord) out.push((v >> 8) & 0xFF, v & 0xFF)
      else out.push(v & 0xFF)
    }
    i += runLen
  }
  return new Uint8Array(out)
}

function f2dot14Bytes(v: number): [number, number] {
  const raw = Math.round(v * 16384)
  const clamped = Math.max(-32768, Math.min(32767, raw))
  const u = clamped < 0 ? clamped + 0x10000 : clamped
  return [(u >> 8) & 0xFF, u & 0xFF]
}

/**
 * Serialize one tuple into { headerBytes (peak + optional intermediate),
 * dataBytes (optional private points + x deltas + y deltas), flags } so
 * the caller can compose the per-glyph block correctly.
 */
function serializeTuple(
  tuple: GvarTuple,
  axisCount: number,
  sharedTuples: number[][],
): { headerBytes: Uint8Array, dataBytes: Uint8Array, flags: number } {
  let sharedIndex = -1
  for (let i = 0; i < sharedTuples.length; i++) {
    const s = sharedTuples[i]!
    if (s.length !== axisCount) continue
    let match = true
    for (let a = 0; a < axisCount; a++) {
      if (Math.abs((s[a] ?? 0) - (tuple.peakCoords[a] ?? 0)) > 1e-6) { match = false; break }
    }
    if (match) { sharedIndex = i; break }
  }

  let flags = 0
  const headerParts: number[] = []
  if (sharedIndex < 0) {
    flags |= EMBEDDED_PEAK_TUPLE
    for (let a = 0; a < axisCount; a++) {
      const [hi, lo] = f2dot14Bytes(tuple.peakCoords[a] ?? 0)
      headerParts.push(hi, lo)
    }
  }
  else {
    flags |= sharedIndex & 0x0FFF
  }
  if (tuple.intermediateStartCoords && tuple.intermediateEndCoords) {
    flags |= INTERMEDIATE_REGION
    for (let a = 0; a < axisCount; a++) {
      const [hi, lo] = f2dot14Bytes(tuple.intermediateStartCoords[a] ?? 0)
      headerParts.push(hi, lo)
    }
    for (let a = 0; a < axisCount; a++) {
      const [hi, lo] = f2dot14Bytes(tuple.intermediateEndCoords[a] ?? 0)
      headerParts.push(hi, lo)
    }
  }

  const dataParts: number[] = []
  if (tuple.pointIndices !== undefined) {
    flags |= PRIVATE_POINT_NUMBERS
    for (const b of packPointNumbers(tuple.pointIndices)) dataParts.push(b)
  }
  const xs = tuple.deltas.map(d => Math.round(d.x))
  const ys = tuple.deltas.map(d => Math.round(d.y))
  for (const b of packDeltas(xs)) dataParts.push(b)
  for (const b of packDeltas(ys)) dataParts.push(b)

  return {
    headerBytes: new Uint8Array(headerParts),
    dataBytes: new Uint8Array(dataParts),
    flags,
  }
}

function serializeGlyphVariationData(
  gv: GvarGlyphVariation,
  axisCount: number,
  sharedTuples: number[][],
): Uint8Array {
  const serialized = gv.tuples.map(t => serializeTuple(t, axisCount, sharedTuples))
  const tupleCount = serialized.length

  let headerSize = 4 // tupleVariationCount + dataOffset
  for (const s of serialized) {
    headerSize += 4 // variationDataSize + tupleIndex
    headerSize += s.headerBytes.length
  }

  const out: number[] = []
  // tupleVariationCount: bits 15-12 reserved, bits 11-0 = count. We don't set
  // SHARED_POINT_NUMBERS (we always use private points).
  out.push((tupleCount >> 8) & 0x0F, tupleCount & 0xFF)
  out.push((headerSize >> 8) & 0xFF, headerSize & 0xFF)
  for (const s of serialized) {
    const size = s.dataBytes.length
    out.push((size >> 8) & 0xFF, size & 0xFF)
    out.push((s.flags >> 8) & 0xFF, s.flags & 0xFF)
    for (const b of s.headerBytes) out.push(b)
  }
  for (const s of serialized) for (const b of s.dataBytes) out.push(b)
  return new Uint8Array(out)
}

/**
 * Serialize a gvar table. Layout follows the TrueType spec:
 *
 *   header (20 bytes)
 *   glyphVariationDataOffsets[glyphCount + 1]  (u16 or u32)
 *   sharedTuples[sharedTupleCount]             (f2dot14 per axis)
 *   glyphVariationData[glyphCount]             (variable)
 *
 * Writer is expected to be positioned at the start of the gvar table.
 */
export function writeGvar(writer: Writer, ttf: TTFObject): void {
  const g = ttf.gvar
  if (!g) return

  const axisCount = g.axisCount
  const glyphCount = ttf.glyf.length

  // Serialize each glyph's block first so we know sizes / total length.
  const glyphBlocks: Uint8Array[] = []
  for (let gi = 0; gi < glyphCount; gi++) {
    const gv = g.glyphVariations[gi]
    if (!gv || gv.tuples.length === 0) {
      glyphBlocks.push(new Uint8Array(0))
      continue
    }
    glyphBlocks.push(serializeGlyphVariationData(gv, axisCount, g.sharedTuples))
  }

  // Align per-glyph data to 2-byte boundaries so short offsets (offset/2) work.
  for (let i = 0; i < glyphBlocks.length; i++) {
    if (glyphBlocks[i]!.length & 1) {
      const padded = new Uint8Array(glyphBlocks[i]!.length + 1)
      padded.set(glyphBlocks[i]!)
      glyphBlocks[i] = padded
    }
  }

  const dataTotal = glyphBlocks.reduce((s, b) => s + b.length, 0)
  // Short offsets encode offset/2 as u16 — range 0..131070.
  const useLongOffsets = dataTotal > 131070

  const gvarStart = writer.offset

  // Header
  writer.writeUint16(g.majorVersion || 1)
  writer.writeUint16(g.minorVersion || 0)
  writer.writeUint16(axisCount)
  writer.writeUint16(g.sharedTuples.length)
  const sharedTuplesOffsetPos = writer.offset
  writer.writeUint32(0) // placeholder
  writer.writeUint16(glyphCount)
  writer.writeUint16(useLongOffsets ? 1 : 0)
  const dataArrayOffsetPos = writer.offset
  writer.writeUint32(0) // placeholder

  // Offsets array (filled below)
  const offsetsPos = writer.offset
  for (let i = 0; i <= glyphCount; i++) {
    if (useLongOffsets) writer.writeUint32(0)
    else writer.writeUint16(0)
  }

  // Shared tuples
  const sharedTuplesStart = writer.offset
  for (const st of g.sharedTuples) {
    for (let a = 0; a < axisCount; a++) {
      const [hi, lo] = f2dot14Bytes(st[a] ?? 0)
      writer.writeUint8(hi); writer.writeUint8(lo)
    }
  }

  // Glyph variation data blocks
  const dataArrayStart = writer.offset
  const actualOffsets: number[] = []
  for (const block of glyphBlocks) {
    actualOffsets.push(writer.offset - dataArrayStart)
    writer.writeBytes(block)
  }
  actualOffsets.push(writer.offset - dataArrayStart)

  // Patch placeholders
  const saved = writer.offset
  writer.seek(sharedTuplesOffsetPos)
  writer.writeUint32(sharedTuplesStart - gvarStart)
  writer.seek(dataArrayOffsetPos)
  writer.writeUint32(dataArrayStart - gvarStart)
  writer.seek(offsetsPos)
  for (const off of actualOffsets) {
    if (useLongOffsets) writer.writeUint32(off)
    else writer.writeUint16(off >> 1)
  }
  writer.seek(saved)
}

/** Compute serialized byte length of the gvar table. */
export function gvarSize(ttf: TTFObject): number {
  const g = ttf.gvar
  if (!g) return 0
  const axisCount = g.axisCount
  const glyphCount = ttf.glyf.length

  const blockLens: number[] = []
  for (let gi = 0; gi < glyphCount; gi++) {
    const gv = g.glyphVariations[gi]
    if (!gv || gv.tuples.length === 0) { blockLens.push(0); continue }
    const block = serializeGlyphVariationData(gv, axisCount, g.sharedTuples)
    blockLens.push(block.length + (block.length & 1 ? 1 : 0))
  }
  const dataTotal = blockLens.reduce((s, b) => s + b, 0)
  const useLongOffsets = dataTotal > 131070

  const headerSize = 20
  const offsetsSize = (glyphCount + 1) * (useLongOffsets ? 4 : 2)
  const sharedTuplesSize = g.sharedTuples.length * axisCount * 2
  return headerSize + offsetsSize + sharedTuplesSize + dataTotal
}
