import type { Reader } from '../../io/reader'
import type { Writer } from '../../io/writer'
import type { NameTable, TTFObject } from '../../types'
import { KEY_TO_NAME_ID, NAME_ID_TO_KEY } from '../enum'

interface NameRecord {
  platformID: number
  encodingID: number
  languageID: number
  nameID: number
  length: number
  offset: number
}

function decodeString(bytes: number[], platformID: number): string {
  // Windows (3) uses UTF-16BE, Mac (1) uses MacRoman (approximate as latin-1)
  if (platformID === 3 || platformID === 0) {
    let s = ''
    for (let i = 0; i < bytes.length - 1; i += 2)
      s += String.fromCharCode((bytes[i] << 8) | bytes[i + 1])
    return s
  }
  return bytes.map(b => String.fromCharCode(b)).join('')
}

function encodeStringUtf16BE(str: string): number[] {
  const bytes: number[] = []
  for (let i = 0; i < str.length; i++) {
    const c = str.charCodeAt(i)
    bytes.push((c >> 8) & 0xFF, c & 0xFF)
  }
  return bytes
}

export function readName(reader: Reader, offset: number): NameTable {
  reader.seek(offset)
  /* const format = */ reader.readUint16()
  const count = reader.readUint16()
  const stringOffset = reader.readUint16()
  const records: NameRecord[] = []
  for (let i = 0; i < count; i++) {
    records.push({
      platformID: reader.readUint16(),
      encodingID: reader.readUint16(),
      languageID: reader.readUint16(),
      nameID: reader.readUint16(),
      length: reader.readUint16(),
      offset: reader.readUint16(),
    })
  }

  const name: NameTable = {
    fontFamily: '',
    fontSubFamily: '',
    uniqueSubFamily: '',
    fullName: '',
    version: '',
    postScriptName: '',
  }

  const preferredPlatform = 3 // Windows preferred
  const seen = new Set<number>()
  // First pass: preferred platform for known name IDs
  for (const rec of records) {
    if (rec.platformID !== preferredPlatform)
      continue
    const key = NAME_ID_TO_KEY[rec.nameID]
    if (!key || seen.has(rec.nameID))
      continue
    const bytes = reader.readBytes(offset + stringOffset + rec.offset, rec.length)
    name[key] = decodeString(bytes, rec.platformID)
    seen.add(rec.nameID)
  }
  // Fallback pass: other platform for known IDs
  for (const rec of records) {
    const key = NAME_ID_TO_KEY[rec.nameID]
    if (!key || seen.has(rec.nameID))
      continue
    const bytes = reader.readBytes(offset + stringOffset + rec.offset, rec.length)
    name[key] = decodeString(bytes, rec.platformID)
    seen.add(rec.nameID)
  }
  // Extra pass: arbitrary numeric nameIDs (e.g. 256+ used by fvar)
  const extra: Array<{ nameID: number, value: string }> = []
  const extraSeen = new Set<number>()
  // Preferred Windows entries first
  for (const rec of records) {
    if (NAME_ID_TO_KEY[rec.nameID] !== undefined) continue
    if (extraSeen.has(rec.nameID)) continue
    if (rec.platformID !== preferredPlatform) continue
    const bytes = reader.readBytes(offset + stringOffset + rec.offset, rec.length)
    extra.push({ nameID: rec.nameID, value: decodeString(bytes, rec.platformID) })
    extraSeen.add(rec.nameID)
  }
  for (const rec of records) {
    if (NAME_ID_TO_KEY[rec.nameID] !== undefined) continue
    if (extraSeen.has(rec.nameID)) continue
    const bytes = reader.readBytes(offset + stringOffset + rec.offset, rec.length)
    extra.push({ nameID: rec.nameID, value: decodeString(bytes, rec.platformID) })
    extraSeen.add(rec.nameID)
  }
  if (extra.length > 0) name.extra = extra

  return name
}

interface WriteRec {
  platformID: number
  encodingID: number
  languageID: number
  nameID: number
  bytes: number[]
}

function buildRecords(name: NameTable): WriteRec[] {
  const records: WriteRec[] = []
  const emit = (nameID: number, val: string) => {
    if (!val) return
    const macBytes: number[] = []
    for (let i = 0; i < val.length; i++)
      macBytes.push(val.charCodeAt(i) & 0xFF)
    records.push({ platformID: 1, encodingID: 0, languageID: 0, nameID, bytes: macBytes })
    records.push({ platformID: 3, encodingID: 1, languageID: 0x409, nameID, bytes: encodeStringUtf16BE(val) })
  }
  for (const [key, val] of Object.entries(name)) {
    if (key === 'extra') continue
    if (typeof val !== 'string' || val === '') continue
    const nameID = KEY_TO_NAME_ID[key]
    if (nameID === undefined) continue
    emit(nameID, val)
  }
  if (Array.isArray(name.extra)) {
    for (const e of name.extra) emit(e.nameID, e.value)
  }
  records.sort((a, b) => {
    if (a.platformID !== b.platformID) return a.platformID - b.platformID
    if (a.encodingID !== b.encodingID) return a.encodingID - b.encodingID
    if (a.languageID !== b.languageID) return a.languageID - b.languageID
    return a.nameID - b.nameID
  })
  return records
}

export function writeName(writer: Writer, ttf: TTFObject): void {
  const records = buildRecords(ttf.name)
  const count = records.length
  writer.writeUint16(0) // format
  writer.writeUint16(count)
  const stringOffset = 6 + count * 12
  writer.writeUint16(stringOffset)

  let curOffset = 0
  for (const rec of records) {
    writer.writeUint16(rec.platformID)
    writer.writeUint16(rec.encodingID)
    writer.writeUint16(rec.languageID)
    writer.writeUint16(rec.nameID)
    writer.writeUint16(rec.bytes.length)
    writer.writeUint16(curOffset)
    curOffset += rec.bytes.length
  }

  for (const rec of records)
    writer.writeBytes(rec.bytes)
}

export function nameSize(ttf: TTFObject): number {
  const records = buildRecords(ttf.name)
  let total = 6 + records.length * 12
  for (const rec of records)
    total += rec.bytes.length
  return total
}
