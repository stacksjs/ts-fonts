import type { TTFObject } from '../types'

export interface ValidationWarning {
  severity: 'warn' | 'error'
  field: string
  message: string
}

/**
 * Structural validation for a TTFObject. Returns a list of warnings —
 * an empty array means "no issues detected". Does not throw.
 */
export function validateTTF(ttf: TTFObject): ValidationWarning[] {
  const out: ValidationWarning[] = []
  const warn = (field: string, message: string): void => {
    out.push({ severity: 'warn', field, message })
  }
  const err = (field: string, message: string): void => {
    out.push({ severity: 'error', field, message })
  }

  // head
  if (!ttf.head) err('head', 'missing head table')
  else {
    if (ttf.head.unitsPerEm <= 0 || ttf.head.unitsPerEm > 16384)
      err('head.unitsPerEm', `invalid unitsPerEm=${ttf.head.unitsPerEm} (expected 16..16384)`)
    if (ttf.head.magickNumber !== 0x5F0F3CF5)
      warn('head.magickNumber', `unexpected magic number 0x${ttf.head.magickNumber.toString(16)}`)
  }

  // name
  if (!ttf.name) err('name', 'missing name table')
  else {
    for (const required of ['fontFamily', 'fontSubFamily']) {
      const v = ttf.name[required as keyof typeof ttf.name]
      if (!v || (typeof v === 'string' && v.trim() === ''))
        warn(`name.${required}`, 'missing or empty')
    }
  }

  // hhea
  if (!ttf.hhea) err('hhea', 'missing hhea table')

  // maxp
  if (!ttf.maxp) err('maxp', 'missing maxp table')
  else if (ttf.maxp.numGlyphs !== ttf.glyf.length) {
    warn('maxp.numGlyphs', `does not match glyf count (${ttf.maxp.numGlyphs} vs ${ttf.glyf.length})`)
  }

  // OS/2
  if (!ttf['OS/2']) err('OS/2', 'missing OS/2 table')
  else {
    const o = ttf['OS/2']
    if (o.usWeightClass < 1 || o.usWeightClass > 1000)
      warn('OS/2.usWeightClass', `out of range: ${o.usWeightClass}`)
    if (o.usWidthClass < 1 || o.usWidthClass > 9)
      warn('OS/2.usWidthClass', `out of range: ${o.usWidthClass}`)
  }

  // cmap: duplicate unicode → glyph mappings
  if (ttf.cmap) {
    const seen = new Set<number>()
    for (const key of Object.keys(ttf.cmap)) {
      const n = Number.parseInt(key, 10)
      if (seen.has(n))
        warn('cmap', `duplicate unicode ${n}`)
      seen.add(n)
      if (n < 0 || n > 0x10FFFF)
        warn('cmap', `unicode codepoint out of range: ${n}`)
    }
  }

  // Glyphs: cross-check bounding box
  for (let i = 0; i < ttf.glyf.length; i++) {
    const g = ttf.glyf[i]
    if (!g.contours || g.contours.length === 0) continue
    let xMin = Infinity, yMin = Infinity, xMax = -Infinity, yMax = -Infinity
    for (const c of g.contours) {
      for (const p of c) {
        if (p.x < xMin) xMin = p.x
        if (p.x > xMax) xMax = p.x
        if (p.y < yMin) yMin = p.y
        if (p.y > yMax) yMax = p.y
      }
    }
    if (Number.isFinite(xMin)) {
      if (g.xMin !== xMin || g.xMax !== xMax || g.yMin !== yMin || g.yMax !== yMax) {
        warn(`glyf[${i}]`, `bounding box mismatch: stored=(${g.xMin},${g.yMin},${g.xMax},${g.yMax}) actual=(${xMin},${yMin},${xMax},${yMax})`)
      }
    }
  }

  // Compound glyphs referencing missing indices
  for (let i = 0; i < ttf.glyf.length; i++) {
    const g = ttf.glyf[i]
    if (!g.compound || !g.glyfs) continue
    for (const ref of g.glyfs) {
      if (ref.glyphIndex < 0 || ref.glyphIndex >= ttf.glyf.length)
        err(`glyf[${i}]`, `compound reference to non-existent glyph ${ref.glyphIndex}`)
    }
  }

  // COLR: baseGlyphRecords sorted by glyphID?
  if (ttf.rawTables?.COLR) {
    const raw = ttf.rawTables.COLR
    try {
      const view = new DataView(raw.buffer, raw.byteOffset, raw.byteLength)
      const version = view.getUint16(0, false)
      if (version === 0) {
        const num = view.getUint16(2, false)
        const off = view.getUint32(4, false)
        let prev = -1
        for (let i = 0; i < num; i++) {
          const gid = view.getUint16(off + i * 6, false)
          if (gid <= prev)
            warn('COLR.baseGlyphRecords', 'not sorted by glyphID')
          prev = gid
        }
      }
    }
    catch {
      warn('COLR', 'could not validate (malformed?)')
    }
  }

  // Variable fonts: axes present but gvar tuple count mismatches glyph count
  if (ttf.fvar) {
    if (ttf.gvar && ttf.gvar.glyphVariations.length !== ttf.glyf.length) {
      warn('gvar', `variation count (${ttf.gvar.glyphVariations.length}) != glyph count (${ttf.glyf.length})`)
    }
  }

  return out
}
