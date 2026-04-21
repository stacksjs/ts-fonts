/**
 * Shared low-level helpers for OpenType layout tables (GSUB/GPOS/GDEF).
 * Kept minimal — only what we need for kerning + ligatures.
 */

export function readUint16(view: DataView, offset: number): number {
  return view.getUint16(offset, false)
}

export function readInt16(view: DataView, offset: number): number {
  return view.getInt16(offset, false)
}

export function readUint32(view: DataView, offset: number): number {
  return view.getUint32(offset, false)
}

export function readTag(view: DataView, offset: number): string {
  let s = ''
  for (let i = 0; i < 4; i++) s += String.fromCharCode(view.getUint8(offset + i))
  return s
}

export interface ScriptTable {
  tag: string
  defaultLangSys?: LangSysTable
  langSysRecords: Array<{ tag: string, langSys: LangSysTable }>
}

export interface LangSysTable {
  requiredFeatureIndex: number
  featureIndexes: number[]
}

export interface FeatureTable {
  tag: string
  lookupListIndexes: number[]
}

export interface LookupTable {
  lookupType: number
  lookupFlag: number
  subTables: SubTableOffset[]
}

export interface SubTableOffset {
  offset: number
}

/** Parse the ScriptList → Scripts → Features → Lookups common header. */
export interface LayoutHeader {
  scriptList: ScriptTable[]
  featureList: FeatureTable[]
  lookupList: LookupTable[]
  /** Base offset within the table (absolute byte position). */
  baseOffset: number
}

export function readLayoutHeader(view: DataView, baseOffset: number): LayoutHeader {
  const major = readUint16(view, baseOffset)
  const minor = readUint16(view, baseOffset + 2)
  const scriptListOff = readUint16(view, baseOffset + 4)
  const featureListOff = readUint16(view, baseOffset + 6)
  const lookupListOff = readUint16(view, baseOffset + 8)
  let headerEnd = 10
  if (major === 1 && minor === 1) {
    /* const featureVariationsOff = */ readUint32(view, baseOffset + 10)
    headerEnd = 14
  }
  void headerEnd

  const scriptList = readScriptList(view, baseOffset + scriptListOff)
  const featureList = readFeatureList(view, baseOffset + featureListOff)
  const lookupList = readLookupList(view, baseOffset + lookupListOff)

  return { scriptList, featureList, lookupList, baseOffset }
}

function readScriptList(view: DataView, offset: number): ScriptTable[] {
  const count = readUint16(view, offset)
  const scripts: ScriptTable[] = []
  for (let i = 0; i < count; i++) {
    const recOff = offset + 2 + i * 6
    const tag = readTag(view, recOff)
    const scriptOff = readUint16(view, recOff + 4)
    scripts.push(readScript(view, offset + scriptOff, tag))
  }
  return scripts
}

function readScript(view: DataView, offset: number, tag: string): ScriptTable {
  const defaultLangSysOff = readUint16(view, offset)
  const langCount = readUint16(view, offset + 2)
  const defaultLangSys = defaultLangSysOff
    ? readLangSys(view, offset + defaultLangSysOff)
    : undefined
  const langSysRecords: ScriptTable['langSysRecords'] = []
  for (let i = 0; i < langCount; i++) {
    const recOff = offset + 4 + i * 6
    const lTag = readTag(view, recOff)
    const lOff = readUint16(view, recOff + 4)
    langSysRecords.push({ tag: lTag, langSys: readLangSys(view, offset + lOff) })
  }
  return { tag, defaultLangSys, langSysRecords }
}

function readLangSys(view: DataView, offset: number): LangSysTable {
  /* lookupOrder */ readUint16(view, offset)
  const required = readUint16(view, offset + 2)
  const featIndexCount = readUint16(view, offset + 4)
  const featureIndexes: number[] = []
  for (let i = 0; i < featIndexCount; i++)
    featureIndexes.push(readUint16(view, offset + 6 + i * 2))
  return { requiredFeatureIndex: required === 0xFFFF ? -1 : required, featureIndexes }
}

function readFeatureList(view: DataView, offset: number): FeatureTable[] {
  const count = readUint16(view, offset)
  const features: FeatureTable[] = []
  for (let i = 0; i < count; i++) {
    const recOff = offset + 2 + i * 6
    const tag = readTag(view, recOff)
    const featureOff = readUint16(view, recOff + 4)
    const featureStart = offset + featureOff
    /* featureParamsOff */ readUint16(view, featureStart)
    const lookupIdxCount = readUint16(view, featureStart + 2)
    const lookupListIndexes: number[] = []
    for (let j = 0; j < lookupIdxCount; j++)
      lookupListIndexes.push(readUint16(view, featureStart + 4 + j * 2))
    features.push({ tag, lookupListIndexes })
  }
  return features
}

function readLookupList(view: DataView, offset: number): LookupTable[] {
  const count = readUint16(view, offset)
  const lookups: LookupTable[] = []
  for (let i = 0; i < count; i++) {
    const lookupOff = readUint16(view, offset + 2 + i * 2)
    const lookupStart = offset + lookupOff
    const lookupType = readUint16(view, lookupStart)
    const lookupFlag = readUint16(view, lookupStart + 2)
    const subCount = readUint16(view, lookupStart + 4)
    const subTables: SubTableOffset[] = []
    for (let j = 0; j < subCount; j++) {
      const subOff = readUint16(view, lookupStart + 6 + j * 2)
      subTables.push({ offset: lookupStart + subOff })
    }
    lookups.push({ lookupType, lookupFlag, subTables })
  }
  return lookups
}

/** Read a CoverageTable. Returns the list of glyph IDs in coverage order. */
export function readCoverage(view: DataView, offset: number): number[] {
  const format = readUint16(view, offset)
  const result: number[] = []
  if (format === 1) {
    const count = readUint16(view, offset + 2)
    for (let i = 0; i < count; i++) result.push(readUint16(view, offset + 4 + i * 2))
  }
  else if (format === 2) {
    const count = readUint16(view, offset + 2)
    for (let i = 0; i < count; i++) {
      const recOff = offset + 4 + i * 6
      const start = readUint16(view, recOff)
      const end = readUint16(view, recOff + 2)
      for (let g = start; g <= end; g++) result.push(g)
    }
  }
  return result
}

/** Coverage → glyphId → coverageIndex map. */
export function coverageIndex(view: DataView, offset: number, glyphId: number): number {
  const format = readUint16(view, offset)
  if (format === 1) {
    const count = readUint16(view, offset + 2)
    // binary search
    let lo = 0, hi = count - 1
    while (lo <= hi) {
      const mid = (lo + hi) >> 1
      const g = readUint16(view, offset + 4 + mid * 2)
      if (g === glyphId) return mid
      if (g < glyphId) lo = mid + 1
      else hi = mid - 1
    }
    return -1
  }
  if (format === 2) {
    const count = readUint16(view, offset + 2)
    for (let i = 0; i < count; i++) {
      const recOff = offset + 4 + i * 6
      const start = readUint16(view, recOff)
      const end = readUint16(view, recOff + 2)
      const startIdx = readUint16(view, recOff + 4)
      if (glyphId >= start && glyphId <= end)
        return startIdx + (glyphId - start)
    }
  }
  return -1
}

export function readClassDef(view: DataView, offset: number, glyphId: number): number {
  const format = readUint16(view, offset)
  if (format === 1) {
    const startGlyphId = readUint16(view, offset + 2)
    const count = readUint16(view, offset + 4)
    if (glyphId >= startGlyphId && glyphId < startGlyphId + count)
      return readUint16(view, offset + 6 + (glyphId - startGlyphId) * 2)
    return 0
  }
  if (format === 2) {
    const count = readUint16(view, offset + 2)
    for (let i = 0; i < count; i++) {
      const recOff = offset + 4 + i * 6
      const start = readUint16(view, recOff)
      const end = readUint16(view, recOff + 2)
      const cls = readUint16(view, recOff + 4)
      if (glyphId >= start && glyphId <= end) return cls
    }
  }
  return 0
}

/** Find the lookups for a specific feature in a given script+language. */
export function lookupsForFeature(
  header: LayoutHeader,
  featureTag: string,
  script = 'DFLT',
  language = 'dflt',
): number[] {
  const scriptObj = header.scriptList.find(s => s.tag.trim() === script)
    ?? header.scriptList.find(s => s.tag.trim() === 'DFLT')
    ?? header.scriptList.find(s => s.tag.trim() === 'latn')
  if (!scriptObj) return []
  let langSys: LangSysTable | undefined
  if (language !== 'dflt')
    langSys = scriptObj.langSysRecords.find(l => l.tag.trim() === language)?.langSys
  langSys = langSys ?? scriptObj.defaultLangSys
  if (!langSys) return []

  const out: number[] = []
  for (const idx of langSys.featureIndexes) {
    const feat = header.featureList[idx]
    if (!feat) continue
    if (feat.tag.trim() === featureTag)
      out.push(...feat.lookupListIndexes)
  }
  return out
}
