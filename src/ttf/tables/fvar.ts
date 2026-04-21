import type { Reader } from '../../io/reader'
import type { Writer } from '../../io/writer'
import type { FvarTable, NamedInstance, TTFObject, VariationAxis } from '../../types'

export function readFvar(reader: Reader, offset: number): FvarTable {
  reader.seek(offset)
  const majorVersion = reader.readUint16()
  const minorVersion = reader.readUint16()
  const axesArrayOffset = reader.readUint16()
  /* reserved */ reader.readUint16()
  const axisCount = reader.readUint16()
  const axisSize = reader.readUint16()
  const instanceCount = reader.readUint16()
  const instanceSize = reader.readUint16()

  const axes: VariationAxis[] = []
  reader.seek(offset + axesArrayOffset)
  for (let i = 0; i < axisCount; i++) {
    const base = offset + axesArrayOffset + i * axisSize
    reader.seek(base)
    axes.push({
      tag: reader.readString(reader.offset, 4),
      minValue: reader.readFixed(),
      defaultValue: reader.readFixed(),
      maxValue: reader.readFixed(),
      flags: reader.readUint16(),
      nameID: reader.readUint16(),
    })
  }

  const instances: NamedInstance[] = []
  const instanceArrayOffset = axesArrayOffset + axisCount * axisSize
  const hasPSNameID = instanceSize === axisCount * 4 + 6
  for (let i = 0; i < instanceCount; i++) {
    const base = offset + instanceArrayOffset + i * instanceSize
    reader.seek(base)
    const subfamilyNameID = reader.readUint16()
    const flags = reader.readUint16()
    const coordinates: Record<string, number> = {}
    for (let j = 0; j < axisCount; j++)
      coordinates[axes[j].tag] = reader.readFixed()
    let postScriptNameID: number | undefined
    if (hasPSNameID)
      postScriptNameID = reader.readUint16()
    instances.push({ subfamilyNameID, flags, coordinates, postScriptNameID })
  }

  return { majorVersion, minorVersion, axes, instances }
}

export function writeFvar(writer: Writer, ttf: TTFObject): void {
  const f = ttf.fvar
  if (!f) return

  const axisCount = f.axes.length
  const instanceCount = f.instances.length
  const hasPSNameID = f.instances.some(i => i.postScriptNameID !== undefined)
  const axisSize = 20
  const instanceSize = 4 + axisCount * 4 + (hasPSNameID ? 2 : 0)

  writer.writeUint16(f.majorVersion || 1)
  writer.writeUint16(f.minorVersion || 0)
  writer.writeUint16(16) // axesArrayOffset
  writer.writeUint16(2) // reserved
  writer.writeUint16(axisCount)
  writer.writeUint16(axisSize)
  writer.writeUint16(instanceCount)
  writer.writeUint16(instanceSize)

  for (const a of f.axes) {
    writer.writeString(`${a.tag}    `.slice(0, 4), 4)
    writer.writeFixed(a.minValue)
    writer.writeFixed(a.defaultValue)
    writer.writeFixed(a.maxValue)
    writer.writeUint16(a.flags)
    writer.writeUint16(a.nameID)
  }

  for (const inst of f.instances) {
    writer.writeUint16(inst.subfamilyNameID)
    writer.writeUint16(inst.flags)
    for (const a of f.axes) {
      const val = inst.coordinates[a.tag] ?? a.defaultValue
      writer.writeFixed(val)
    }
    if (hasPSNameID)
      writer.writeUint16(inst.postScriptNameID ?? 0)
  }
}

export function fvarSize(ttf: TTFObject): number {
  const f = ttf.fvar
  if (!f) return 0
  const axisCount = f.axes.length
  const instanceCount = f.instances.length
  const hasPSNameID = f.instances.some(i => i.postScriptNameID !== undefined)
  const instanceSize = 4 + axisCount * 4 + (hasPSNameID ? 2 : 0)
  return 16 + axisCount * 20 + instanceCount * instanceSize
}
