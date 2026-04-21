/**
 * Universal Shaping Engine (USE) — a cluster-based shaper for complex
 * Brahmi-derived scripts (Devanagari, Bengali, Gurmukhi, Gujarati,
 * Tamil, Telugu, Kannada, Malayalam, Sinhala, Khmer, Myanmar, Tibetan,
 * and others).
 *
 * USE works by:
 *   1. Classifying each character into a "USE category" (Base, Vowel,
 *      Halant, Nukta, Mark, VowelModifier, Zero-Width-Joiner, etc.)
 *   2. Grouping contiguous characters into clusters along boundaries
 *      defined by the USE cluster pattern.
 *   3. Reordering cluster contents (e.g. moving pre-base matras, Reph
 *      formation, halant-consonant rearrangement).
 *   4. Applying GSUB features in a specific order (ccmp, locl, rphf,
 *      nukt, akhn, abvf, blwf, half, pstf, vatu, cjct, then pres,
 *      blws, abvs, psts, haln).
 *
 * This implementation focuses on the cluster formation + reordering
 * phases. The GSUB application is delegated to the existing layout
 * pipeline; we just emit features in the right order for each cluster.
 */

export type UseCategory =
  | 'B'   // Base
  | 'BOT' // Base - other
  | 'CGJ' // Combining Grapheme Joiner
  | 'CM'  // Consonant Medial
  | 'CMAbv' // Medial above
  | 'CMBlw' // Medial below
  | 'CS'  // Consonant with stacker
  | 'FM'  // Final Mark
  | 'GB'  // Generic base (or base with no specific category)
  | 'H'   // Halant / Virama
  | 'HN'  // Halant Num
  | 'M'   // Medial consonant
  | 'MBlw' // Medial Blw
  | 'MPre' // Medial Pre
  | 'MPst' // Medial Post
  | 'N'   // Nukta
  | 'O'   // Other
  | 'R'   // Reph
  | 'S'   // Symbol
  | 'SB'  // Symbol Base
  | 'SM'  // Symbol Modifier
  | 'SUB' // Subjoined consonant
  | 'V'   // Vowel
  | 'VAbv' // Vowel Above
  | 'VBlw' // Vowel Below
  | 'VM'  // Vowel modifier
  | 'VMAbv' // Vowel Modifier Above
  | 'VMBlw' // Vowel Modifier Below
  | 'VMPst' // Vowel Modifier Post
  | 'VPre' // Vowel Pre
  | 'VPst' // Vowel Post
  | 'VS'  // Variation Selector
  | 'WJ'  // Word Joiner
  | 'ZWJ' // Zero-Width Joiner
  | 'ZWNJ'// Zero-Width Non-Joiner

/** Rough categorization by Unicode block + codepoint for the scripts we care about. */
export function useCategory(cp: number): UseCategory {
  // Common format controls
  if (cp === 0x200C) return 'ZWNJ'
  if (cp === 0x200D) return 'ZWJ'
  if (cp === 0x034F) return 'CGJ'
  if (cp === 0x2060) return 'WJ'
  if (cp >= 0xFE00 && cp <= 0xFE0F) return 'VS'
  if (cp >= 0xE0100 && cp <= 0xE01EF) return 'VS'

  // Devanagari (U+0900..097F)
  if (cp >= 0x0900 && cp <= 0x097F) return devanagariCategory(cp)
  // Bengali
  if (cp >= 0x0980 && cp <= 0x09FF) return bengaliCategory(cp)
  // Gurmukhi
  if (cp >= 0x0A00 && cp <= 0x0A7F) return gurmukhiCategory(cp)
  // Gujarati
  if (cp >= 0x0A80 && cp <= 0x0AFF) return bengaliCategory(cp) // similar
  // Tamil
  if (cp >= 0x0B80 && cp <= 0x0BFF) return tamilCategory(cp)
  // Telugu / Kannada / Malayalam / Sinhala
  if (cp >= 0x0C00 && cp <= 0x0DFF) return indicCategory(cp)
  // Thai (uses simpler model)
  if (cp >= 0x0E00 && cp <= 0x0E7F) return thaiCategory(cp)
  // Khmer
  if (cp >= 0x1780 && cp <= 0x17FF) return khmerCategory(cp)
  // Myanmar
  if (cp >= 0x1000 && cp <= 0x109F) return myanmarCategory(cp)
  // Tibetan
  if (cp >= 0x0F00 && cp <= 0x0FFF) return tibetanCategory(cp)

  return 'O'
}

function devanagariCategory(cp: number): UseCategory {
  if (cp === 0x094D) return 'H' // Virama
  if (cp === 0x093C) return 'N' // Nukta
  if (cp >= 0x0915 && cp <= 0x0939) return 'B' // Consonants
  if (cp >= 0x0958 && cp <= 0x095F) return 'B'
  if (cp === 0x0930) return 'B' // RA (has special REPH behaviour)
  if (cp >= 0x093E && cp <= 0x094C) return cp === 0x093F ? 'VPre' : 'VPst' // Matras
  if (cp === 0x0902 || cp === 0x0903) return 'VM' // Anusvara / visarga
  if (cp === 0x0901) return 'VMAbv'
  if (cp === 0x0900 || cp === 0x0953 || cp === 0x0954) return 'FM'
  if (cp >= 0x0951 && cp <= 0x0954) return 'VMAbv'
  if (cp >= 0x0966 && cp <= 0x096F) return 'GB' // Digits
  return 'O'
}

function bengaliCategory(cp: number): UseCategory {
  if (cp === 0x09CD) return 'H'
  if (cp === 0x09BC) return 'N'
  if (cp >= 0x0995 && cp <= 0x09B9) return 'B'
  if (cp === 0x09C7 || cp === 0x09C8) return 'VPre'
  if (cp >= 0x09BE && cp <= 0x09CC) return 'VPst'
  if (cp === 0x0982 || cp === 0x0983) return 'VM'
  return 'O'
}

function gurmukhiCategory(cp: number): UseCategory {
  if (cp === 0x0A4D) return 'H'
  if (cp === 0x0A3C) return 'N'
  if (cp >= 0x0A15 && cp <= 0x0A39) return 'B'
  if (cp >= 0x0A3E && cp <= 0x0A4C) return 'VPst'
  return 'O'
}

function tamilCategory(cp: number): UseCategory {
  if (cp === 0x0BCD) return 'H'
  if (cp >= 0x0B95 && cp <= 0x0BB9) return 'B'
  if (cp >= 0x0BBE && cp <= 0x0BCC) return 'VPst'
  if (cp === 0x0BC6 || cp === 0x0BC7 || cp === 0x0BC8) return 'VPre'
  return 'O'
}

function indicCategory(cp: number): UseCategory {
  // Telugu U+0C00..0C7F, Kannada U+0C80..0CFF, Malayalam U+0D00..0D7F, Sinhala U+0D80..0DFF
  const loByte = cp & 0xFF
  if (loByte === 0x4D || loByte === 0xCD) return 'H'
  if (loByte === 0x3C || loByte === 0xBC) return 'N'
  if (loByte >= 0x15 && loByte <= 0x39) return 'B'
  if (loByte >= 0x95 && loByte <= 0xB9) return 'B'
  if ((loByte >= 0x3E && loByte <= 0x4C) || (loByte >= 0xBE && loByte <= 0xCC)) return 'VPst'
  return 'O'
}

function thaiCategory(cp: number): UseCategory {
  if (cp === 0x0E3A || cp === 0x0E4D) return 'VM'
  if (cp === 0x0E4E) return 'VMAbv'
  if (cp >= 0x0E40 && cp <= 0x0E44) return 'VPre'
  if (cp >= 0x0E30 && cp <= 0x0E3F) return 'VPst'
  if (cp >= 0x0E01 && cp <= 0x0E2E) return 'B'
  return 'O'
}

function khmerCategory(cp: number): UseCategory {
  if (cp === 0x17D2) return 'H' // Sign Coeng (virama-like)
  if (cp >= 0x1780 && cp <= 0x17B3) return 'B'
  if (cp >= 0x17B6 && cp <= 0x17C5) return 'VPst'
  if (cp === 0x17C6) return 'VM'
  return 'O'
}

function myanmarCategory(cp: number): UseCategory {
  if (cp === 0x1039) return 'H'
  if (cp === 0x103A) return 'H' // Asat
  if (cp >= 0x1000 && cp <= 0x102A) return 'B'
  if (cp >= 0x102B && cp <= 0x1032) return 'VPst'
  if (cp >= 0x1036 && cp <= 0x1038) return 'VM'
  return 'O'
}

function tibetanCategory(cp: number): UseCategory {
  if (cp === 0x0F84) return 'H'
  if (cp >= 0x0F40 && cp <= 0x0F6C) return 'B'
  if (cp >= 0x0F71 && cp <= 0x0F7D) return 'VPst'
  return 'O'
}

/** A cluster is a contiguous run of codepoints that belong to one grapheme. */
export interface UseCluster {
  /** Original codepoints (in logical order). */
  codepoints: number[]
  /** Original start index within the source string. */
  start: number
  /** Categories aligned with codepoints. */
  categories: UseCategory[]
  /** The reordered sequence, ready for GSUB application. */
  reordered: number[]
}

/** Split codepoints into USE clusters. */
export function formUseClusters(codepoints: number[]): UseCluster[] {
  const clusters: UseCluster[] = []
  const categories = codepoints.map(useCategory)

  let i = 0
  while (i < codepoints.length) {
    const start = i
    const first = categories[i]
    // A cluster starts with a Base/Consonant/Symbol-Base; capture it
    // plus all subsequent combining marks (VM, VPre, VPst, H, N, etc.).
    // A following Base is included in the same cluster when preceded by
    // a halant — this handles Virama-joined consonant clusters (REPH +
    // conjunct) as a single logical unit.
    const members: number[] = [codepoints[i]]
    const cats: UseCategory[] = [first]
    let prev = first
    i++
    while (i < codepoints.length) {
      const c = categories[i]
      const isBaseLike = c === 'B' || c === 'BOT' || c === 'S' || c === 'SB' || c === 'GB' || c === 'O'
      if (isBaseLike && prev !== 'H') break
      members.push(codepoints[i])
      cats.push(c)
      prev = c
      i++
    }
    clusters.push({
      codepoints: members,
      start,
      categories: cats,
      reordered: reorderCluster(members, cats),
    })
  }

  return clusters
}

/**
 * Per-cluster reordering. Implements the subset of the USE reordering
 * rules that matter for Devanagari/Indic fonts:
 *   - VPre (pre-base matra) moves to the front of the cluster.
 *   - For REPH: if cluster starts with RA + Halant + Base, move the
 *     RA+Halant pair to the end (conceptually they'll be rendered as a
 *     superscript reph).
 */
function reorderCluster(cps: number[], cats: UseCategory[]): number[] {
  if (cps.length === 0) return cps

  // Copy
  const out = cps.slice()
  const catArr = cats.slice()

  // REPH formation: first two chars are RA (0x0930) + Halant, followed by a
  // consonant — move the pair to the end.
  if (out.length >= 3 && isRa(out[0]) && catArr[1] === 'H' && catArr[2] === 'B') {
    const ra = out.shift()!
    const halant = out.shift()!
    catArr.shift(); catArr.shift()
    out.push(ra, halant)
    catArr.push('B', 'H')
  }

  // Pre-base matra: any VPre moves to the very front.
  for (let i = out.length - 1; i > 0; i--) {
    if (catArr[i] === 'VPre') {
      const m = out.splice(i, 1)[0]
      const c = catArr.splice(i, 1)[0]
      out.unshift(m)
      catArr.unshift(c)
    }
  }

  return out
}

function isRa(cp: number): boolean {
  return (
    cp === 0x0930 // Devanagari RA
    || cp === 0x09B0 // Bengali RA
    || cp === 0x09F0 // Bengali Assamese RA
    || cp === 0x0AB0 // Gujarati RA
    || cp === 0x0BB0 // Tamil RA
  )
}

/** Apply USE to a whole string; returns the reordered codepoint sequence. */
export function useShape(text: string): number[] {
  const cps: number[] = []
  for (const ch of text) cps.push(ch.codePointAt(0) ?? 0)
  const clusters = formUseClusters(cps)
  const out: number[] = []
  for (const c of clusters) out.push(...c.reordered)
  return out
}

/**
 * The canonical USE feature ordering. Caller can iterate `applyFeatures`
 * over GSUB in this order, one feature at a time, to produce correct
 * shaping for complex Brahmic scripts.
 */
export const USE_FEATURE_ORDER: string[] = [
  'locl', 'ccmp', 'rvrn', // default features
  'rphf',                       // REPH form
  'pref',                       // pre-base reordering forms
  'blwf', 'abvf', 'pstf', 'half', 'vatu', 'cjct',
  'pres', 'abvs', 'blws', 'psts', 'haln',
  'calt', 'clig', 'liga', 'rlig',
]
