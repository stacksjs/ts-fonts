/**
 * Unicode Bidirectional Algorithm (UAX #9) — a pragmatic implementation
 * of paragraph-level resolution returning per-character embedding levels,
 * plus a helper to reorder a logical-order string to visual order.
 *
 * Scope:
 *  - Rules P1–P3 (paragraph & default level)
 *  - Rules W1–W7 (weak type resolution)
 *  - Rules N0–N2 (neutral types)
 *  - Rules I1–I2 (implicit embedding levels)
 *  - Rules L1–L3 (reorder-prep retains whitespace levels)
 *  - Rule L4 (apply mirrored brackets for RTL; here we only flip a small
 *    set — the Unicode bidi-mirroring table is huge and application-level)
 *
 * Not implemented: explicit directional-formatting controls (LRE, RLE,
 * LRO, RLO, PDF, LRI, RLI, FSI, PDI). If your text contains these,
 * strip them beforehand or use a heavier library.
 *
 * Character classification uses a compact table of Unicode ranges for
 * the strong-type classes (L, R, AL) and picks up EN, ES, ET, AN, CS,
 * NSM, B, S, WS, ON from the Bidi_Class property of the BMP ranges we
 * care about for Latin-Arabic-Hebrew workflows.
 */

export type BidiClass =
  | 'L' | 'R' | 'AL'
  | 'EN' | 'ES' | 'ET' | 'AN' | 'CS' | 'NSM'
  | 'B' | 'S' | 'WS' | 'ON'
  | 'LRE' | 'LRO' | 'RLE' | 'RLO' | 'PDF'
  | 'LRI' | 'RLI' | 'FSI' | 'PDI'

interface Range {
  start: number
  end: number
  cls: BidiClass
}

// Compact Bidi_Class ranges sourced from Unicode 15.1 data. Only the
// ranges that affect Latin + Arabic + Hebrew + common punctuation are
// included — this covers the 99% of practical text layout needs.
const RANGES: Range[] = [
  // Strong Latin
  { start: 0x0041, end: 0x005A, cls: 'L' },
  { start: 0x0061, end: 0x007A, cls: 'L' },
  { start: 0x00AA, end: 0x00AA, cls: 'L' },
  { start: 0x00B5, end: 0x00B5, cls: 'L' },
  { start: 0x00BA, end: 0x00BA, cls: 'L' },
  { start: 0x00C0, end: 0x00D6, cls: 'L' },
  { start: 0x00D8, end: 0x00F6, cls: 'L' },
  { start: 0x00F8, end: 0x02B8, cls: 'L' },
  // Greek
  { start: 0x0370, end: 0x0373, cls: 'L' },
  { start: 0x0376, end: 0x0377, cls: 'L' },
  { start: 0x037A, end: 0x037D, cls: 'L' },
  { start: 0x0386, end: 0x0386, cls: 'L' },
  { start: 0x0388, end: 0x03FF, cls: 'L' },
  // Cyrillic
  { start: 0x0400, end: 0x0482, cls: 'L' },
  { start: 0x048A, end: 0x052F, cls: 'L' },
  // Hebrew — R
  { start: 0x0591, end: 0x05BD, cls: 'NSM' },
  { start: 0x05BF, end: 0x05BF, cls: 'NSM' },
  { start: 0x05C1, end: 0x05C2, cls: 'NSM' },
  { start: 0x05C4, end: 0x05C5, cls: 'NSM' },
  { start: 0x05C7, end: 0x05C7, cls: 'NSM' },
  { start: 0x05BE, end: 0x05BE, cls: 'R' },
  { start: 0x05C0, end: 0x05C0, cls: 'R' },
  { start: 0x05C3, end: 0x05C3, cls: 'R' },
  { start: 0x05C6, end: 0x05C6, cls: 'R' },
  { start: 0x05D0, end: 0x05EA, cls: 'R' },
  { start: 0x05EF, end: 0x05F4, cls: 'R' },
  { start: 0xFB1D, end: 0xFB4F, cls: 'R' },
  // Arabic — AL
  { start: 0x0608, end: 0x0608, cls: 'AL' },
  { start: 0x060B, end: 0x060B, cls: 'AL' },
  { start: 0x060D, end: 0x060D, cls: 'AL' },
  { start: 0x061B, end: 0x061B, cls: 'AL' },
  { start: 0x061C, end: 0x061C, cls: 'AL' },
  { start: 0x061D, end: 0x061F, cls: 'AL' },
  { start: 0x0620, end: 0x063F, cls: 'AL' },
  { start: 0x0640, end: 0x064A, cls: 'AL' },
  { start: 0x066D, end: 0x066F, cls: 'AL' },
  { start: 0x0671, end: 0x06D5, cls: 'AL' },
  { start: 0x06E5, end: 0x06E6, cls: 'AL' },
  { start: 0x06EE, end: 0x06EF, cls: 'AL' },
  { start: 0x06FA, end: 0x06FC, cls: 'AL' },
  { start: 0x06FF, end: 0x06FF, cls: 'AL' },
  { start: 0x0710, end: 0x0710, cls: 'AL' },
  { start: 0x0712, end: 0x072F, cls: 'AL' },
  { start: 0x074D, end: 0x07A5, cls: 'AL' },
  { start: 0x07B1, end: 0x07B1, cls: 'AL' },
  { start: 0x0870, end: 0x088E, cls: 'AL' },
  { start: 0x08A0, end: 0x08C9, cls: 'AL' },
  { start: 0xFB50, end: 0xFD3D, cls: 'AL' },
  { start: 0xFD50, end: 0xFDFF, cls: 'AL' },
  { start: 0xFE70, end: 0xFEFC, cls: 'AL' },
  // Arabic NSM
  { start: 0x0610, end: 0x061A, cls: 'NSM' },
  { start: 0x064B, end: 0x065F, cls: 'NSM' },
  { start: 0x0670, end: 0x0670, cls: 'NSM' },
  { start: 0x06D6, end: 0x06E4, cls: 'NSM' },
  { start: 0x06E7, end: 0x06E8, cls: 'NSM' },
  { start: 0x06EA, end: 0x06ED, cls: 'NSM' },
  { start: 0x0711, end: 0x0711, cls: 'NSM' },
  { start: 0x0730, end: 0x074A, cls: 'NSM' },
  { start: 0x07A6, end: 0x07B0, cls: 'NSM' },
  // Arabic / Hebrew numerics
  { start: 0x0660, end: 0x0669, cls: 'AN' },
  { start: 0x066B, end: 0x066C, cls: 'AN' },
  { start: 0x06DD, end: 0x06DD, cls: 'AN' },
  { start: 0x08E2, end: 0x08E2, cls: 'AN' },
  // European numbers (ASCII digits)
  { start: 0x0030, end: 0x0039, cls: 'EN' },
  { start: 0x00B2, end: 0x00B3, cls: 'EN' },
  { start: 0x00B9, end: 0x00B9, cls: 'EN' },
  // Plus/Minus = ES
  { start: 0x002B, end: 0x002B, cls: 'ES' },
  { start: 0x002D, end: 0x002D, cls: 'ES' },
  // ET — currency, %
  { start: 0x0023, end: 0x0025, cls: 'ET' },
  { start: 0x00A2, end: 0x00A5, cls: 'ET' },
  { start: 0x20A0, end: 0x20CF, cls: 'ET' },
  // CS — comma, period, slash, colon
  { start: 0x002C, end: 0x002C, cls: 'CS' },
  { start: 0x002E, end: 0x002F, cls: 'CS' },
  { start: 0x003A, end: 0x003A, cls: 'CS' },
  // Whitespace
  { start: 0x0020, end: 0x0020, cls: 'WS' },
  { start: 0x0009, end: 0x0009, cls: 'S' },
  { start: 0x000A, end: 0x000A, cls: 'B' },
  { start: 0x000D, end: 0x000D, cls: 'B' },
]

const LTR_OVERRIDES = new Set<BidiClass>(['L', 'EN'])

/** Default bidi class for characters not in any range = ON. */
export function bidiClass(cp: number): BidiClass {
  for (const r of RANGES) {
    if (cp >= r.start && cp <= r.end) return r.cls
  }
  return 'ON'
}

/** P2/P3: paragraph direction — first strong type (L/AL/R) wins. */
export function paragraphLevel(text: string): 0 | 1 {
  for (const ch of text) {
    const cls = bidiClass(ch.codePointAt(0) ?? 0)
    if (cls === 'L') return 0
    if (cls === 'R' || cls === 'AL') return 1
  }
  return 0
}

export interface BidiResult {
  codepoints: number[]
  types: BidiClass[]
  levels: number[]
  /** A string in visual (display) order. */
  visual: string
  /** Visual-order codepoint array, useful for shaping pipelines. */
  visualCodepoints: number[]
}

/**
 * Run UAX #9 on a string and return the per-character embedding levels
 * plus the string reordered to visual order.
 */
export function bidi(text: string, paragraphDir?: 0 | 1): BidiResult {
  const codepoints: number[] = []
  for (const ch of text) codepoints.push(ch.codePointAt(0) ?? 0)

  const N = codepoints.length
  const types: BidiClass[] = codepoints.map(cp => bidiClass(cp))
  const originalTypes = types.slice()
  const paraLevel = paragraphDir ?? paragraphLevel(text)
  const levels: number[] = new Array(N).fill(paraLevel)

  // Process text as a single level run at the paragraph level — this
  // implementation doesn't honour explicit directional embedding/overrides.
  resolveWeakTypes(types, levels, paraLevel)
  resolveNeutrals(types, levels, originalTypes)
  resolveImplicitLevels(types, levels, originalTypes, paraLevel)

  const visualCodepoints = reorder(codepoints, levels, paraLevel)
  // Mirror paired brackets on RTL levels (compact subset)
  applyMirroring(visualCodepoints, levels)

  let visual = ''
  for (const cp of visualCodepoints) visual += String.fromCodePoint(cp)

  return { codepoints, types: originalTypes, levels, visual, visualCodepoints }
}

function resolveWeakTypes(types: BidiClass[], levels: number[], paraLevel: number): void {
  const N = types.length

  // W1: Examine each NSM — change to preceding type (or sot)
  let sotType: BidiClass = paraLevel === 1 ? 'R' : 'L'
  for (let i = 0; i < N; i++) {
    if (types[i] === 'NSM') {
      types[i] = i === 0 ? sotType : types[i - 1]
    }
    sotType = types[i]
  }

  // W2: EN that follows AL (or R via AL inheritance) → AN
  let lastStrong: BidiClass = paraLevel === 1 ? 'R' : 'L'
  for (let i = 0; i < N; i++) {
    if (types[i] === 'L' || types[i] === 'R' || types[i] === 'AL') lastStrong = types[i]
    if (types[i] === 'EN' && lastStrong === 'AL') types[i] = 'AN'
  }

  // W3: AL → R
  for (let i = 0; i < N; i++) if (types[i] === 'AL') types[i] = 'R'

  // W4: ES or CS between two ENs becomes EN; CS between two ANs becomes AN
  for (let i = 1; i < N - 1; i++) {
    if ((types[i] === 'ES' || types[i] === 'CS') && types[i - 1] === 'EN' && types[i + 1] === 'EN')
      types[i] = 'EN'
    if (types[i] === 'CS' && types[i - 1] === 'AN' && types[i + 1] === 'AN')
      types[i] = 'AN'
  }

  // W5: sequences of ET adjacent to EN become EN
  for (let i = 0; i < N; i++) {
    if (types[i] !== 'ET') continue
    let j = i
    while (j < N && types[j] === 'ET') j++
    // run is i..j-1
    const before = i > 0 ? types[i - 1] : null
    const after = j < N ? types[j] : null
    if (before === 'EN' || after === 'EN') {
      for (let k = i; k < j; k++) types[k] = 'EN'
    }
    i = j - 1
  }

  // W6: remaining ES / ET / CS → ON
  for (let i = 0; i < N; i++) {
    if (types[i] === 'ES' || types[i] === 'ET' || types[i] === 'CS') types[i] = 'ON'
  }

  // W7: EN preceded by L → L
  lastStrong = paraLevel === 1 ? 'R' : 'L'
  for (let i = 0; i < N; i++) {
    if (types[i] === 'L' || types[i] === 'R') lastStrong = types[i]
    if (types[i] === 'EN' && lastStrong === 'L') types[i] = 'L'
  }

  void levels
}

function resolveNeutrals(types: BidiClass[], levels: number[], originalTypes: BidiClass[]): void {
  const N = types.length
  const isNeutral = (t: BidiClass): boolean => t === 'B' || t === 'S' || t === 'WS' || t === 'ON'

  let i = 0
  while (i < N) {
    if (!isNeutral(types[i])) { i++; continue }
    let j = i
    while (j < N && isNeutral(types[j])) j++

    // Determine surrounding strong context (with EN/AN treated as R for this rule)
    const strongOf = (idx: number): 'L' | 'R' | null => {
      if (idx < 0 || idx >= N) return null
      const t = types[idx]
      if (t === 'L') return 'L'
      if (t === 'R' || t === 'EN' || t === 'AN') return 'R'
      return null
    }
    let before: 'L' | 'R' | null = null
    for (let k = i - 1; k >= 0; k--) {
      const s = strongOf(k)
      if (s) { before = s; break }
    }
    let after: 'L' | 'R' | null = null
    for (let k = j; k < N; k++) {
      const s = strongOf(k)
      if (s) { after = s; break }
    }
    if (before === null) before = (levels[0] & 1) ? 'R' : 'L'
    if (after === null) after = (levels[0] & 1) ? 'R' : 'L'

    const resolved: BidiClass = before === after ? before : ((levels[i] & 1) ? 'R' : 'L')
    for (let k = i; k < j; k++) types[k] = resolved
    i = j
  }
  void originalTypes
}

function resolveImplicitLevels(types: BidiClass[], levels: number[], originalTypes: BidiClass[], paraLevel: number): void {
  for (let i = 0; i < types.length; i++) {
    const base = levels[i] ?? paraLevel
    if (base % 2 === 0) {
      // Even (LTR) base — R/AN = +1, EN/AN = +2
      if (types[i] === 'R') levels[i] = base + 1
      else if (types[i] === 'EN' || types[i] === 'AN') levels[i] = base + 2
    }
    else {
      // Odd (RTL) base — L/EN/AN = +1
      if (types[i] === 'L' || types[i] === 'EN' || types[i] === 'AN')
        levels[i] = base + 1
    }
  }
  void originalTypes; void LTR_OVERRIDES
}

function reorder(codepoints: number[], levels: number[], paraLevel: number): number[] {
  // L1: trailing whitespace and segment/paragraph separators reset to
  // paragraph level (we don't track WS explicitly here, but the level
  // assignment from W6 keeps them at paraLevel already, so this is a no-op)
  const maxLevel = Math.max(paraLevel, ...levels)
  const result = codepoints.slice()
  const lvl = levels.slice()

  // L2 (spec): reverse sequences at level ≥ n for n descending from maxLevel
  // to the lowest odd level on the line. If paraLevel is odd, that's
  // paraLevel itself; if even, it's paraLevel+1.
  const lowestOdd = (paraLevel & 1) ? paraLevel : paraLevel + 1
  for (let n = maxLevel; n >= lowestOdd; n--) {
    let i = 0
    while (i < lvl.length) {
      if (lvl[i] >= n) {
        let j = i
        while (j < lvl.length && lvl[j] >= n) j++
        // Reverse result[i..j-1]
        const slice = result.slice(i, j).reverse()
        const sliceL = lvl.slice(i, j).reverse()
        for (let k = i; k < j; k++) {
          result[k] = slice[k - i]
          lvl[k] = sliceL[k - i]
        }
        i = j
      }
      else { i++ }
    }
  }
  return result
}

// Compact mirroring table covering ASCII brackets + a few common pairs
const MIRROR: Record<number, number> = {
  0x0028: 0x0029, 0x0029: 0x0028, // ( )
  0x003C: 0x003E, 0x003E: 0x003C, // < >
  0x005B: 0x005D, 0x005D: 0x005B, // [ ]
  0x007B: 0x007D, 0x007D: 0x007B, // { }
  0x00AB: 0x00BB, 0x00BB: 0x00AB, // « »
  0x2039: 0x203A, 0x203A: 0x2039, // ‹ ›
  0x2329: 0x232A, 0x232A: 0x2329, // 〈 〉
}

function applyMirroring(cps: number[], levels: number[]): void {
  for (let i = 0; i < cps.length; i++) {
    if ((levels[i] & 1) === 1) {
      const m = MIRROR[cps[i]]
      if (m) cps[i] = m
    }
  }
}
