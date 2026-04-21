import type { Reader } from '../../io/reader'
import type { Writer } from '../../io/writer'
import type { StatAxis, StatAxisValue, StatTable, TTFObject } from '../../types'

export function readStat(reader: Reader, offset: number): StatTable {
  reader.seek(offset)
  const majorVersion = reader.readUint16()
  const minorVersion = reader.readUint16()
  const designAxisSize = reader.readUint16()
  const designAxisCount = reader.readUint16()
  const designAxesOffset = reader.readUint32()
  const axisValueCount = reader.readUint16()
  const offsetToAxisValueOffsets = reader.readUint32()
  let elidedFallbackNameID: number | undefined
  if (minorVersion >= 1)
    elidedFallbackNameID = reader.readUint16()

  const designAxes: StatAxis[] = []
  for (let i = 0; i < designAxisCount; i++) {
    reader.seek(offset + designAxesOffset + i * designAxisSize)
    designAxes.push({
      tag: reader.readString(reader.offset, 4),
      nameID: reader.readUint16(),
      ordering: reader.readUint16(),
    })
  }

  const axisValues: StatAxisValue[] = []
  const axisValueOffsetsBase = offset + offsetToAxisValueOffsets
  const offsets: number[] = []
  reader.seek(axisValueOffsetsBase)
  for (let i = 0; i < axisValueCount; i++)
    offsets.push(reader.readUint16())

  for (const relOff of offsets) {
    reader.seek(axisValueOffsetsBase + relOff)
    const format = reader.readUint16()
    if (format === 1) {
      const axisIndex = reader.readUint16()
      const flags = reader.readUint16()
      const valueNameID = reader.readUint16()
      const value = reader.readFixed()
      axisValues.push({ format, axisIndex, flags, valueNameID, value })
    }
    else if (format === 2) {
      const axisIndex = reader.readUint16()
      const flags = reader.readUint16()
      const valueNameID = reader.readUint16()
      const nominalValue = reader.readFixed()
      const rangeMinValue = reader.readFixed()
      const rangeMaxValue = reader.readFixed()
      axisValues.push({ format, axisIndex, flags, valueNameID, nominalValue, rangeMinValue, rangeMaxValue })
    }
    else if (format === 3) {
      const axisIndex = reader.readUint16()
      const flags = reader.readUint16()
      const valueNameID = reader.readUint16()
      const value = reader.readFixed()
      const linkedValue = reader.readFixed()
      axisValues.push({ format, axisIndex, flags, valueNameID, value, linkedValue })
    }
    else if (format === 4) {
      const axisCount = reader.readUint16()
      const flags = reader.readUint16()
      const valueNameID = reader.readUint16()
      const innerAxisValues: Array<{ axisIndex: number, value: number }> = []
      for (let j = 0; j < axisCount; j++) {
        innerAxisValues.push({
          axisIndex: reader.readUint16(),
          value: reader.readFixed(),
        })
      }
      axisValues.push({
        format,
        axisIndex: innerAxisValues[0]?.axisIndex ?? 0,
        flags,
        valueNameID,
        axisValues: innerAxisValues,
      })
    }
  }

  return { majorVersion, minorVersion, designAxes, axisValues, elidedFallbackNameID }
}

function axisValueSize(v: StatAxisValue): number {
  switch (v.format) {
    case 1: return 12
    case 2: return 20
    case 3: return 16
    case 4: return 8 + (v.axisValues?.length ?? 0) * 6
    default: return 0
  }
}

export function writeStat(writer: Writer, ttf: TTFObject): void {
  const s = ttf.STAT
  if (!s) return

  const designAxisSize = 8
  const headerSize = s.minorVersion >= 1 ? 22 : 20
  const designAxesOffset = headerSize
  const designAxesSize = s.designAxes.length * designAxisSize
  const offsetToAxisValueOffsets = designAxesOffset + designAxesSize
  const axisValuesCount = s.axisValues.length

  writer.writeUint16(s.majorVersion || 1)
  writer.writeUint16(s.minorVersion || 2)
  writer.writeUint16(designAxisSize)
  writer.writeUint16(s.designAxes.length)
  writer.writeUint32(designAxesOffset)
  writer.writeUint16(axisValuesCount)
  writer.writeUint32(offsetToAxisValueOffsets)
  if (s.minorVersion >= 1)
    writer.writeUint16(s.elidedFallbackNameID ?? 2)

  // Design axes
  for (const a of s.designAxes) {
    writer.writeString(`${a.tag}    `.slice(0, 4), 4)
    writer.writeUint16(a.nameID)
    writer.writeUint16(a.ordering)
  }

  // Offset table
  let cur = axisValuesCount * 2
  for (const v of s.axisValues) {
    writer.writeUint16(cur)
    cur += axisValueSize(v)
  }

  // Axis values
  for (const v of s.axisValues) {
    writer.writeUint16(v.format)
    if (v.format === 1) {
      writer.writeUint16(v.axisIndex)
      writer.writeUint16(v.flags)
      writer.writeUint16(v.valueNameID)
      writer.writeFixed(v.value ?? 0)
    }
    else if (v.format === 2) {
      writer.writeUint16(v.axisIndex)
      writer.writeUint16(v.flags)
      writer.writeUint16(v.valueNameID)
      writer.writeFixed(v.nominalValue ?? 0)
      writer.writeFixed(v.rangeMinValue ?? 0)
      writer.writeFixed(v.rangeMaxValue ?? 0)
    }
    else if (v.format === 3) {
      writer.writeUint16(v.axisIndex)
      writer.writeUint16(v.flags)
      writer.writeUint16(v.valueNameID)
      writer.writeFixed(v.value ?? 0)
      writer.writeFixed(v.linkedValue ?? 0)
    }
    else if (v.format === 4) {
      const vals = v.axisValues ?? []
      writer.writeUint16(vals.length)
      writer.writeUint16(v.flags)
      writer.writeUint16(v.valueNameID)
      for (const av of vals) {
        writer.writeUint16(av.axisIndex)
        writer.writeFixed(av.value)
      }
    }
  }
}

export function statSize(ttf: TTFObject): number {
  const s = ttf.STAT
  if (!s) return 0
  const headerSize = s.minorVersion >= 1 ? 22 : 20
  const designAxesSize = s.designAxes.length * 8
  const offsetTableSize = s.axisValues.length * 2
  let valuesSize = 0
  for (const v of s.axisValues)
    valuesSize += axisValueSize(v)
  return headerSize + designAxesSize + offsetTableSize + valuesSize
}
