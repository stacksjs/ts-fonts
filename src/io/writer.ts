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

export class Writer {
  offset: number
  length: number
  littleEndian: boolean
  view: DataView
  buffer: ArrayBuffer
  private _offset: number

  constructor(buffer: ArrayBuffer, offset = 0, length?: number, littleEndian = false) {
    this.offset = offset
    this.length = length ?? (buffer.byteLength - offset)
    this.littleEndian = littleEndian
    this.view = new DataView(buffer, offset, this.length)
    this.buffer = buffer
    this._offset = this.offset
  }

  write(type: string, value: number, offset?: number, littleEndian?: boolean): this {
    const off = offset === undefined ? this.offset : offset
    const le = littleEndian === undefined ? this.littleEndian : littleEndian

    const size = DATA_TYPE_SIZES[type]
    if (size === undefined) {
      const fn = (this as unknown as Record<string, (v: number, o?: number, le?: boolean) => this>)[`write${type}`]
      if (typeof fn === 'function')
        return fn.call(this, value, off, le)
      throw new Error(`unsupported type: ${type}`)
    }

    const key = `set${type}` as 'setInt8' | 'setInt16' | 'setInt32' | 'setUint8' | 'setUint16' | 'setUint32' | 'setFloat32' | 'setFloat64'
    // eslint-disable-next-line pickier/no-unused-vars
    ;(this.view[key] as (o: number, v: number, le: boolean) => void).call(this.view, off, value, le)
    this.offset = off + size
    return this
  }

  writeInt8(value: number, offset?: number, littleEndian?: boolean): this { return this.write('Int8', value, offset, littleEndian) }
  writeInt16(value: number, offset?: number, littleEndian?: boolean): this { return this.write('Int16', value, offset, littleEndian) }
  writeInt32(value: number, offset?: number, littleEndian?: boolean): this { return this.write('Int32', value, offset, littleEndian) }
  writeUint8(value: number, offset?: number, littleEndian?: boolean): this { return this.write('Uint8', value, offset, littleEndian) }
  writeUint16(value: number, offset?: number, littleEndian?: boolean): this { return this.write('Uint16', value, offset, littleEndian) }
  writeUint32(value: number, offset?: number, littleEndian?: boolean): this { return this.write('Uint32', value, offset, littleEndian) }
  writeFloat32(value: number, offset?: number, littleEndian?: boolean): this { return this.write('Float32', value, offset, littleEndian) }
  writeFloat64(value: number, offset?: number, littleEndian?: boolean): this { return this.write('Float64', value, offset, littleEndian) }

  writeBytes(value: ArrayBuffer | ArrayLike<number>, length?: number, offset?: number): this {
    const arr: ArrayLike<number> = value instanceof ArrayBuffer ? new Uint8Array(value) : value
    const len = length ?? arr.length
    const off = offset ?? this.offset
    for (let i = 0; i < len; i++)
      this.view.setUint8(off + i, arr[i] ?? 0)
    this.offset = off + len
    return this
  }

  writeEmpty(length: number, offset?: number): this {
    const off = offset ?? this.offset
    for (let i = 0; i < length; i++)
      this.view.setUint8(off + i, 0)
    this.offset = off + length
    return this
  }

  writeString(str = '', length?: number, offset?: number): this {
    const off = offset ?? this.offset
    const len = length ?? str.length
    for (let i = 0; i < len; i++) {
      const ch = i < str.length ? str.charCodeAt(i) : 0
      this.view.setUint8(off + i, ch & 0xFF)
    }
    this.offset = off + len
    return this
  }

  writeChar(value: string, offset?: number): this {
    return this.writeString(value, 1, offset)
  }

  writeUint24(value: number, offset?: number): this {
    const off = offset ?? this.offset
    this.view.setUint8(off, (value >>> 16) & 0xFF)
    this.view.setUint8(off + 1, (value >>> 8) & 0xFF)
    this.view.setUint8(off + 2, value & 0xFF)
    this.offset = off + 3
    return this
  }

  writeFixed(value: number, offset?: number): this {
    const off = offset ?? this.offset
    this.view.setInt32(off, Math.round(value * 65536), false)
    this.offset = off + 4
    return this
  }

  writeF2Dot14(value: number, offset?: number): this {
    const off = offset ?? this.offset
    this.view.setInt16(off, Math.round(value * 16384), false)
    this.offset = off + 2
    return this
  }

  writeLongDateTime(value: Date | number | string, offset?: number): this {
    const off = offset ?? this.offset
    const delta = -2077545600000
    let t: number
    if (value instanceof Date)
      t = value.getTime()
    else if (typeof value === 'number')
      t = value
    else
      t = new Date(value).getTime()
    const seconds = Math.round((t - delta) / 1000)
    // Write as 64-bit by hi/lo
    const hi = Math.floor(seconds / 0x100000000)
    const lo = seconds >>> 0
    this.view.setUint32(off, hi, false)
    this.view.setUint32(off + 4, lo, false)
    this.offset = off + 8
    return this
  }

  seek(offset?: number): this {
    if (offset === undefined) {
      this._offset = this.offset
      this.offset = 0
      return this
    }
    this._offset = this.offset
    this.offset = offset
    return this
  }

  head(): this {
    this.offset = this._offset
    return this
  }

  getBuffer(): ArrayBuffer {
    return this.buffer
  }

  dispose(): void {
    ;(this as unknown as { view?: DataView, buffer?: ArrayBuffer }).view = undefined as unknown as DataView
    ;(this as unknown as { buffer?: ArrayBuffer }).buffer = undefined
  }
}
