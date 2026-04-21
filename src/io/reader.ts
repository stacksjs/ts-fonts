const DATA_TYPE_SIZES: Record<string, number> = {
  Int8: 1,
  Int16: 2,
  Int32: 4,
  Uint8: 1,
  Uint16: 2,
  Uint32: 4,
  Float32: 4,
  Float64: 8,
}

export class Reader {
  offset: number
  length: number
  littleEndian: boolean
  view: DataView

  constructor(buffer: ArrayBuffer | ArrayLike<number>, offset = 0, length?: number, littleEndian = false) {
    const ab: ArrayBuffer = buffer instanceof ArrayBuffer
      ? buffer
      : new Uint8Array(buffer as ArrayLike<number>).buffer as ArrayBuffer

    const bufferLength = (ab as ArrayBuffer).byteLength
    this.offset = offset
    this.length = length ?? (bufferLength - offset)
    this.littleEndian = littleEndian
    this.view = new DataView(ab, offset, this.length)
  }

  read(type: string, offset?: number, littleEndian?: boolean): number {
    const off = offset === undefined ? this.offset : offset
    const le = littleEndian === undefined ? this.littleEndian : littleEndian

    const size = DATA_TYPE_SIZES[type]
    if (size === undefined) {
      const fn = (this as unknown as Record<string, (o?: number, le?: boolean) => number>)[`read${type}`]
      if (typeof fn === 'function')
        return fn.call(this, off, le)
      throw new Error(`unsupported type: ${type}`)
    }

    this.offset = off + size
    const key = `get${type}` as 'getInt8' | 'getInt16' | 'getInt32' | 'getUint8' | 'getUint16' | 'getUint32' | 'getFloat32' | 'getFloat64'
    // eslint-disable-next-line pickier/no-unused-vars
    return (this.view[key] as (o: number, le: boolean) => number).call(this.view, off, le)
  }

  readInt8(offset?: number, littleEndian?: boolean): number { return this.read('Int8', offset, littleEndian) }
  readInt16(offset?: number, littleEndian?: boolean): number { return this.read('Int16', offset, littleEndian) }
  readInt32(offset?: number, littleEndian?: boolean): number { return this.read('Int32', offset, littleEndian) }
  readUint8(offset?: number, littleEndian?: boolean): number { return this.read('Uint8', offset, littleEndian) }
  readUint16(offset?: number, littleEndian?: boolean): number { return this.read('Uint16', offset, littleEndian) }
  readUint32(offset?: number, littleEndian?: boolean): number { return this.read('Uint32', offset, littleEndian) }
  readFloat32(offset?: number, littleEndian?: boolean): number { return this.read('Float32', offset, littleEndian) }
  readFloat64(offset?: number, littleEndian?: boolean): number { return this.read('Float64', offset, littleEndian) }

  readBytes(offset: number, length?: number): number[] {
    let off = offset
    let len = length
    if (len === undefined) {
      len = off
      off = this.offset
    }
    if (len < 0 || off + len > this.length)
      throw new Error(`read out of range: length=${this.length}, offset=${off + len}`)

    const buffer: number[] = Array.from({ length: len })
    for (let i = 0; i < len; i++)
      buffer[i] = this.view.getUint8(off + i)

    this.offset = off + len
    return buffer
  }

  readString(offset: number, length?: number): string {
    let off = offset
    let len = length
    if (len === undefined) {
      len = off
      off = this.offset
    }
    if (len < 0 || off + len > this.length)
      throw new Error(`read out of range: length=${this.length}, offset=${off + len}`)

    let value = ''
    for (let i = 0; i < len; i++)
      value += String.fromCharCode(this.view.getUint8(off + i))

    this.offset = off + len
    return value
  }

  readChar(offset: number): string {
    return this.readString(offset, 1)
  }

  readUint24(offset?: number): number {
    const off = offset ?? this.offset
    const b = this.readBytes(off, 3)
    return (b[0] << 16) + (b[1] << 8) + b[2]
  }

  readFixed(offset?: number): number {
    const off = offset ?? this.offset
    const val = this.readInt32(off, false) / 65536.0
    return Math.ceil(val * 100000) / 100000
  }

  readF2Dot14(offset?: number): number {
    const off = offset ?? this.offset
    return this.readInt16(off, false) / 16384.0
  }

  readLongDateTime(offset?: number): Date {
    const off = offset ?? this.offset
    const delta = -2077545600000
    const hi = this.view.getUint32(off, false)
    const lo = this.view.getUint32(off + 4, false)
    const seconds = hi * 0x100000000 + lo
    this.offset = off + 8
    const date = new Date()
    date.setTime(seconds * 1000 + delta)
    return date
  }

  readTag(offset?: number): string {
    const off = offset ?? this.offset
    return this.readString(off, 4)
  }

  seek(offset?: number): this {
    if (offset === undefined) {
      this.offset = 0
      return this
    }
    if (offset < 0 || offset > this.length)
      throw new Error(`seek out of range: length=${this.length}, offset=${offset}`)
    this.offset = offset
    return this
  }

  dispose(): void {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(this as unknown as { view?: DataView }).view = undefined as unknown as DataView
  }
}
