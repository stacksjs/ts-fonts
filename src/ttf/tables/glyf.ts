import type { Reader } from '../../io/reader'
import type { Writer } from '../../io/writer'
import type { CompoundGlyphRef, Contour, Glyph, TTFObject } from '../../types'
import { ComponentFlag, GlyphFlag } from '../enum'

export function readGlyf(reader: Reader, glyfTableOffset: number, loca: number[]): Glyph[] {
  const numGlyphs = loca.length - 1
  const glyphs: Glyph[] = []
  for (let i = 0; i < numGlyphs; i++) {
    const start = loca[i]
    const end = loca[i + 1]
    if (start === end) {
      // Empty glyph
      glyphs.push({
        contours: [],
        xMin: 0,
        yMin: 0,
        xMax: 0,
        yMax: 0,
        advanceWidth: 0,
        leftSideBearing: 0,
      })
      continue
    }
    reader.seek(glyfTableOffset + start)
    glyphs.push(readSingleGlyph(reader))
  }
  return glyphs
}

export function readSingleGlyph(reader: Reader): Glyph {
  const numberOfContours = reader.readInt16()
  const xMin = reader.readInt16()
  const yMin = reader.readInt16()
  const xMax = reader.readInt16()
  const yMax = reader.readInt16()

  if (numberOfContours >= 0)
    return readSimpleGlyph(reader, numberOfContours, xMin, yMin, xMax, yMax)

  return readCompoundGlyph(reader, xMin, yMin, xMax, yMax)
}

function readSimpleGlyph(reader: Reader, numberOfContours: number, xMin: number, yMin: number, xMax: number, yMax: number): Glyph {
  const endPtsOfContours: number[] = []
  for (let i = 0; i < numberOfContours; i++)
    endPtsOfContours.push(reader.readUint16())

  const instructionLength = reader.readUint16()
  const instructions: number[] = reader.readBytes(reader.offset, instructionLength)

  const numPoints = numberOfContours === 0 ? 0 : endPtsOfContours[endPtsOfContours.length - 1] + 1
  const flags: number[] = []
  while (flags.length < numPoints) {
    const f = reader.readUint8()
    flags.push(f)
    if (f & GlyphFlag.REPEAT) {
      const count = reader.readUint8()
      for (let i = 0; i < count; i++)
        flags.push(f)
    }
  }

  const xs: number[] = []
  let prevX = 0
  for (const f of flags) {
    let x = 0
    if (f & GlyphFlag.XSHORT) {
      x = reader.readUint8()
      if (!(f & GlyphFlag.XSAME))
        x = -x
    }
    else if (!(f & GlyphFlag.XSAME)) {
      x = reader.readInt16()
    }
    prevX += x
    xs.push(prevX)
  }

  const ys: number[] = []
  let prevY = 0
  for (const f of flags) {
    let y = 0
    if (f & GlyphFlag.YSHORT) {
      y = reader.readUint8()
      if (!(f & GlyphFlag.YSAME))
        y = -y
    }
    else if (!(f & GlyphFlag.YSAME)) {
      y = reader.readInt16()
    }
    prevY += y
    ys.push(prevY)
  }

  const contours: Contour[] = []
  let ptIdx = 0
  for (let c = 0; c < numberOfContours; c++) {
    const endIdx = endPtsOfContours[c]
    const contour: Contour = []
    for (; ptIdx <= endIdx; ptIdx++) {
      contour.push({
        x: xs[ptIdx],
        y: ys[ptIdx],
        onCurve: (flags[ptIdx] & GlyphFlag.ONCURVE) !== 0,
      })
    }
    contours.push(contour)
  }

  return {
    contours,
    xMin,
    yMin,
    xMax,
    yMax,
    advanceWidth: 0,
    leftSideBearing: 0,
    ...(instructions.length > 0 ? { instructions } : {}),
  }
}

function readCompoundGlyph(reader: Reader, xMin: number, yMin: number, xMax: number, yMax: number): Glyph {
  const glyfs: CompoundGlyphRef[] = []
  let flags: number
  let hasInstructions = false
  do {
    flags = reader.readUint16()
    const glyphIndex = reader.readUint16()
    let arg1: number, arg2: number
    if (flags & ComponentFlag.ARG_1_AND_2_ARE_WORDS) {
      arg1 = reader.readInt16()
      arg2 = reader.readInt16()
    }
    else {
      arg1 = reader.readInt8()
      arg2 = reader.readInt8()
    }

    const transform: { a: number, b: number, c: number, d: number, e: number, f: number } = {
      a: 1,
      b: 0,
      c: 0,
      d: 1,
      e: 0,
      f: 0,
    }

    const ref: CompoundGlyphRef = {
      glyphIndex,
      transform,
    }

    if (flags & ComponentFlag.ARGS_ARE_XY_VALUES) {
      transform.e = arg1
      transform.f = arg2
    }
    else {
      ref.points = [arg1, arg2]
    }

    if (flags & ComponentFlag.WE_HAVE_A_SCALE) {
      const s = reader.readF2Dot14()
      transform.a = s
      transform.d = s
    }
    else if (flags & ComponentFlag.WE_HAVE_AN_X_AND_Y_SCALE) {
      transform.a = reader.readF2Dot14()
      transform.d = reader.readF2Dot14()
    }
    else if (flags & ComponentFlag.WE_HAVE_A_TWO_BY_TWO) {
      transform.a = reader.readF2Dot14()
      transform.b = reader.readF2Dot14()
      transform.c = reader.readF2Dot14()
      transform.d = reader.readF2Dot14()
    }

    if (flags & ComponentFlag.USE_MY_METRICS)
      ref.useMyMetrics = true
    if (flags & ComponentFlag.OVERLAP_COMPOUND)
      ref.overlapCompound = true
    if (flags & ComponentFlag.WE_HAVE_INSTRUCTIONS)
      hasInstructions = true

    glyfs.push(ref)
  } while (flags & ComponentFlag.MORE_COMPONENTS)

  let instructions: number[] | undefined
  if (hasInstructions) {
    const len = reader.readUint16()
    instructions = reader.readBytes(reader.offset, len)
  }

  return {
    compound: true,
    glyfs,
    xMin,
    yMin,
    xMax,
    yMax,
    advanceWidth: 0,
    leftSideBearing: 0,
    ...(instructions ? { instructions } : {}),
  }
}

// === Writing ===

export function writeGlyph(writer: Writer, glyph: Glyph): number {
  const start = writer.offset
  if (glyph.compound && glyph.glyfs)
    writeCompoundGlyph(writer, glyph)
  else
    writeSimpleGlyph(writer, glyph)
  return writer.offset - start
}

interface EncodedSimple {
  flags: number[]
  xs: Array<{ size: 1 | 2, value: number }>
  ys: Array<{ size: 1 | 2, value: number }>
}

function encodeSimpleCoords(allPoints: Array<{ x: number, y: number, onCurve: boolean }>): EncodedSimple {
  const flags: number[] = []
  const xs: Array<{ size: 1 | 2, value: number }> = []
  const ys: Array<{ size: 1 | 2, value: number }> = []
  let prevX = 0
  let prevY = 0

  for (const p of allPoints) {
    let flag = p.onCurve ? GlyphFlag.ONCURVE : 0
    const dx = p.x - prevX
    const dy = p.y - prevY

    if (dx === 0) {
      flag |= GlyphFlag.XSAME
    }
    else if (dx >= -255 && dx <= 255) {
      flag |= GlyphFlag.XSHORT
      if (dx > 0)
        flag |= GlyphFlag.XSAME
      xs.push({ size: 1, value: Math.abs(dx) })
    }
    else {
      xs.push({ size: 2, value: dx })
    }

    if (dy === 0) {
      flag |= GlyphFlag.YSAME
    }
    else if (dy >= -255 && dy <= 255) {
      flag |= GlyphFlag.YSHORT
      if (dy > 0)
        flag |= GlyphFlag.YSAME
      ys.push({ size: 1, value: Math.abs(dy) })
    }
    else {
      ys.push({ size: 2, value: dy })
    }

    flags.push(flag)
    prevX = p.x
    prevY = p.y
  }

  return { flags, xs, ys }
}

/**
 * Run-length encode a flags array using the TrueType REPEAT (0x08) bit.
 * Returns the output byte sequence to emit.
 * Emitting { flag | REPEAT, count } takes 2 bytes and saves 1 byte per
 * additional repeat, so a repeat is only worth it if there are >= 2 copies.
 */
function compressFlags(flags: number[]): number[] {
  const out: number[] = []
  let i = 0
  while (i < flags.length) {
    const f = flags[i]
    // Count consecutive identical flags (up to 255 repeats after the initial)
    let runLen = 1
    while (i + runLen < flags.length && flags[i + runLen] === f && runLen < 256)
      runLen++

    if (runLen >= 3) {
      out.push((f | GlyphFlag.REPEAT) & 0xFF)
      out.push(runLen - 1)
      i += runLen
    }
    else {
      for (let j = 0; j < runLen; j++)
        out.push(f)
      i += runLen
    }
  }
  return out
}

function writeSimpleGlyph(writer: Writer, glyph: Glyph): void {
  const contours = glyph.contours ?? []
  if (contours.length === 0)
    return

  writer.writeInt16(contours.length)
  writer.writeInt16(glyph.xMin)
  writer.writeInt16(glyph.yMin)
  writer.writeInt16(glyph.xMax)
  writer.writeInt16(glyph.yMax)

  const endPtsOfContours: number[] = []
  const allPoints: Array<{ x: number, y: number, onCurve: boolean }> = []
  for (const c of contours) {
    for (const p of c)
      allPoints.push({ x: p.x, y: p.y, onCurve: p.onCurve !== false })
    endPtsOfContours.push(allPoints.length - 1)
  }
  for (const end of endPtsOfContours)
    writer.writeUint16(end)

  const instructions = glyph.instructions ?? []
  writer.writeUint16(instructions.length)
  if (instructions.length > 0)
    writer.writeBytes(instructions)

  const { flags, xs, ys } = encodeSimpleCoords(allPoints)
  const compressedFlags = compressFlags(flags)

  for (const f of compressedFlags)
    writer.writeUint8(f)

  for (const x of xs) {
    if (x.size === 1) writer.writeUint8(x.value)
    else writer.writeInt16(x.value)
  }
  for (const y of ys) {
    if (y.size === 1) writer.writeUint8(y.value)
    else writer.writeInt16(y.value)
  }
}

function writeCompoundGlyph(writer: Writer, glyph: Glyph): void {
  writer.writeInt16(-1) // compound marker
  writer.writeInt16(glyph.xMin)
  writer.writeInt16(glyph.yMin)
  writer.writeInt16(glyph.xMax)
  writer.writeInt16(glyph.yMax)

  const components = glyph.glyfs ?? []
  for (let i = 0; i < components.length; i++) {
    const ref = components[i]
    const t = ref.transform
    let flags = 0
    const isLast = i === components.length - 1
    if (!isLast)
      flags |= ComponentFlag.MORE_COMPONENTS

    const hasXYValues = !ref.points
    if (hasXYValues)
      flags |= ComponentFlag.ARGS_ARE_XY_VALUES

    const arg1 = hasXYValues ? t.e : ref.points![0]
    const arg2 = hasXYValues ? t.f : ref.points![1]
    const needWords = arg1 < -128 || arg1 > 127 || arg2 < -128 || arg2 > 127
    if (needWords)
      flags |= ComponentFlag.ARG_1_AND_2_ARE_WORDS

    const hasTwoByTwo = t.b !== 0 || t.c !== 0
    const hasXYScale = !hasTwoByTwo && t.a !== t.d
    const hasScale = !hasXYScale && !hasTwoByTwo && t.a !== 1

    if (hasTwoByTwo) flags |= ComponentFlag.WE_HAVE_A_TWO_BY_TWO
    else if (hasXYScale) flags |= ComponentFlag.WE_HAVE_AN_X_AND_Y_SCALE
    else if (hasScale) flags |= ComponentFlag.WE_HAVE_A_SCALE

    if (ref.useMyMetrics) flags |= ComponentFlag.USE_MY_METRICS
    if (ref.overlapCompound) flags |= ComponentFlag.OVERLAP_COMPOUND

    writer.writeUint16(flags)
    writer.writeUint16(ref.glyphIndex)
    if (needWords) {
      writer.writeInt16(arg1)
      writer.writeInt16(arg2)
    }
    else {
      writer.writeInt8(arg1)
      writer.writeInt8(arg2)
    }

    if (hasTwoByTwo) {
      writer.writeF2Dot14(t.a)
      writer.writeF2Dot14(t.b)
      writer.writeF2Dot14(t.c)
      writer.writeF2Dot14(t.d)
    }
    else if (hasXYScale) {
      writer.writeF2Dot14(t.a)
      writer.writeF2Dot14(t.d)
    }
    else if (hasScale) {
      writer.writeF2Dot14(t.a)
    }
  }
}

// Compute glyf table total size (without alignment between glyphs — loca expects 2-byte alignment)
export function computeGlyfSizes(ttf: TTFObject): { sizes: number[], totalSize: number, offsets: number[] } {
  const sizes: number[] = []
  const offsets: number[] = []
  let total = 0
  for (const g of ttf.glyf) {
    offsets.push(total)
    const size = estimateGlyphSize(g)
    sizes.push(size)
    total += size
    // Pad to 2-byte alignment
    if (total % 2 !== 0)
      total++
  }
  offsets.push(total) // terminal entry
  return { sizes, totalSize: total, offsets }
}

function estimateGlyphSize(glyph: Glyph): number {
  if (glyph.compound && glyph.glyfs) {
    let size = 10 // header
    for (let i = 0; i < glyph.glyfs.length; i++) {
      const ref = glyph.glyfs[i]
      size += 4 // flags + glyphIndex
      const t = ref.transform
      const hasXY = !ref.points
      const arg1 = hasXY ? t.e : ref.points![0]
      const arg2 = hasXY ? t.f : ref.points![1]
      const needWords = arg1 < -128 || arg1 > 127 || arg2 < -128 || arg2 > 127
      size += needWords ? 4 : 2
      const hasTwoByTwo = t.b !== 0 || t.c !== 0
      const hasXYScale = !hasTwoByTwo && t.a !== t.d
      const hasScale = !hasXYScale && !hasTwoByTwo && t.a !== 1
      if (hasTwoByTwo) size += 8
      else if (hasXYScale) size += 4
      else if (hasScale) size += 2
    }
    return size
  }

  const contours = glyph.contours ?? []
  if (contours.length === 0)
    return 0

  let size = 10 // header
  size += contours.length * 2 // endPtsOfContours
  size += 2 // instructionLength
  size += (glyph.instructions?.length ?? 0)

  const allPoints: Array<{ x: number, y: number, onCurve: boolean }> = []
  for (const c of contours) {
    for (const p of c)
      allPoints.push({ x: p.x, y: p.y, onCurve: p.onCurve !== false })
  }

  const { flags, xs, ys } = encodeSimpleCoords(allPoints)
  size += compressFlags(flags).length
  for (const x of xs) size += x.size
  for (const y of ys) size += y.size
  return size
}
