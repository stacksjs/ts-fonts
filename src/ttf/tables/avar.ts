import type { Reader } from '../../io/reader'
import type { Writer } from '../../io/writer'
import type { AvarTable, TTFObject } from '../../types'

export function readAvar(reader: Reader, offset: number, axisTags?: string[]): AvarTable {
  reader.seek(offset)
  const majorVersion = reader.readUint16()
  const minorVersion = reader.readUint16()
  /* reserved */ reader.readUint16()
  const axisCount = reader.readUint16()

  const axisSegmentMaps: AvarTable['axisSegmentMaps'] = []
  for (let i = 0; i < axisCount; i++) {
    const positionMapCount = reader.readUint16()
    const correspondence: Array<{ fromCoordinate: number, toCoordinate: number }> = []
    for (let j = 0; j < positionMapCount; j++) {
      correspondence.push({
        fromCoordinate: reader.readF2Dot14(),
        toCoordinate: reader.readF2Dot14(),
      })
    }
    axisSegmentMaps.push({
      axisTag: axisTags?.[i],
      correspondence,
    })
  }

  return { majorVersion, minorVersion, axisSegmentMaps }
}

export function writeAvar(writer: Writer, ttf: TTFObject): void {
  const a = ttf.avar
  if (!a) return
  writer.writeUint16(a.majorVersion || 1)
  writer.writeUint16(a.minorVersion || 0)
  writer.writeUint16(0) // reserved
  writer.writeUint16(a.axisSegmentMaps.length)
  for (const m of a.axisSegmentMaps) {
    writer.writeUint16(m.correspondence.length)
    for (const c of m.correspondence) {
      writer.writeF2Dot14(c.fromCoordinate)
      writer.writeF2Dot14(c.toCoordinate)
    }
  }
}

export function avarSize(ttf: TTFObject): number {
  const a = ttf.avar
  if (!a) return 0
  let size = 8
  for (const m of a.axisSegmentMaps)
    size += 2 + m.correspondence.length * 4
  return size
}
