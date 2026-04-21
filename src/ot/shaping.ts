/**
 * Simple complex-script shapers.
 *
 * These helpers return a list of OpenType feature tags that should be
 * enabled for a text run in each script, plus any script-specific
 * pre-shaping reordering. Callers invoke these before running
 * `stringToGlyphs` so GSUB sees the right features.
 *
 * This is a pragmatic subset — full shaping (Harfbuzz-level) for
 * Devanagari / Khmer / Burmese / Tibetan requires a rule engine.
 */

/** Which script does this character belong to? */
export type Script = 'latn' | 'arab' | 'hebr' | 'thai' | 'deva' | 'cyrl' | 'grek' | 'other'

export function detectScript(cp: number): Script {
  if ((cp >= 0x0041 && cp <= 0x007A) || (cp >= 0x00C0 && cp <= 0x024F)) return 'latn'
  if (cp >= 0x0370 && cp <= 0x03FF) return 'grek'
  if (cp >= 0x0400 && cp <= 0x04FF) return 'cyrl'
  if ((cp >= 0x0590 && cp <= 0x05FF) || (cp >= 0xFB1D && cp <= 0xFB4F)) return 'hebr'
  if ((cp >= 0x0600 && cp <= 0x06FF) || (cp >= 0xFB50 && cp <= 0xFEFC)) return 'arab'
  if (cp >= 0x0E00 && cp <= 0x0E7F) return 'thai'
  if (cp >= 0x0900 && cp <= 0x097F) return 'deva'
  return 'other'
}

export function detectDominantScript(text: string): Script {
  const counts = new Map<Script, number>()
  for (const ch of text) {
    const s = detectScript(ch.codePointAt(0) ?? 0)
    counts.set(s, (counts.get(s) ?? 0) + 1)
  }
  let best: Script = 'latn'
  let bestN = 0
  for (const [s, n] of counts) {
    if (s === 'other') continue
    if (n > bestN) { best = s; bestN = n }
  }
  return best
}

/** Default OT feature set per script — applied in addition to user overrides. */
export function defaultFeaturesForScript(script: Script): Record<string, boolean> {
  switch (script) {
    case 'arab':
      return { init: true, medi: true, fina: true, isol: true, rlig: true, liga: true, calt: true, ccmp: true }
    case 'thai':
      return { ccmp: true, liga: true, rlig: true, calt: true, mark: true, mkmk: true }
    case 'deva':
      return { nukt: true, akhn: true, rphf: true, blwf: true, half: true, vatu: true, pres: true, blws: true, abvs: true, psts: true, haln: true, ccmp: true, liga: true }
    case 'hebr':
      return { ccmp: true, rlig: true, liga: true, mark: true }
    default:
      return { ccmp: true, liga: true, rlig: true, calt: true, kern: true, mark: true, mkmk: true }
  }
}

// ----- Thai-specific preprocessing -----

const THAI_LEADING_VOWELS = new Set([0x0E40, 0x0E41, 0x0E42, 0x0E43, 0x0E44])

/**
 * Thai requires leading vowels (SARA E / AE / O / AI-MAIMUAN / AI-MAIMALAI)
 * to be visually reordered after their consonant at render time. Since
 * Thai is logical-LTR, swap the vowel with its preceding consonant so
 * that cmap lookup + basic ligatures work on the visually correct pair.
 */
export function reorderThai(codepoints: number[]): number[] {
  const out = codepoints.slice()
  for (let i = 0; i < out.length - 1; i++) {
    if (THAI_LEADING_VOWELS.has(out[i]) && isThaiConsonant(out[i + 1])) {
      const tmp = out[i]
      out[i] = out[i + 1]
      out[i + 1] = tmp
      i++ // skip past the swapped pair
    }
  }
  return out
}

function isThaiConsonant(cp: number): boolean {
  return cp >= 0x0E01 && cp <= 0x0E2E
}

// ----- Devanagari-specific preprocessing -----

const DEVANAGARI_VIRAMA = 0x094D
const DEVANAGARI_RA = 0x0930
const DEVANAGARI_I_MATRA = 0x093F // vocalic i — reorders before consonant cluster

/**
 * Devanagari REPH formation: the sequence RA + VIRAMA at the start of a
 * syllable cluster becomes a REPH that renders above the following
 * consonant. Here we just mark the reordering boundary and move RA+VIRAMA
 * to the end of the cluster so the GSUB 'rphf' feature can produce the
 * correct mark glyph.
 *
 * Similarly, short-i matra reorders to precede its consonant cluster.
 *
 * This is a minimal approximation — not a full shaper.
 */
export function reorderDevanagari(codepoints: number[]): number[] {
  const out: number[] = []
  let i = 0
  while (i < codepoints.length) {
    // REPH detection: RA + VIRAMA + consonant
    if (
      codepoints[i] === DEVANAGARI_RA
      && codepoints[i + 1] === DEVANAGARI_VIRAMA
      && isDevanagariConsonant(codepoints[i + 2])
    ) {
      // Find end of cluster (consonants + viramas)
      let end = i + 2
      while (end < codepoints.length && (isDevanagariConsonant(codepoints[end]) || codepoints[end] === DEVANAGARI_VIRAMA))
        end++
      // Emit cluster body first, then RA+VIRAMA as reph
      out.push(...codepoints.slice(i + 2, end))
      out.push(DEVANAGARI_RA, DEVANAGARI_VIRAMA)
      i = end
      continue
    }

    // Short-i matra reorder: if next char is short-i matra, emit it first
    if (isDevanagariConsonant(codepoints[i]) && codepoints[i + 1] === DEVANAGARI_I_MATRA) {
      out.push(DEVANAGARI_I_MATRA, codepoints[i])
      i += 2
      continue
    }

    out.push(codepoints[i])
    i++
  }
  return out
}

function isDevanagariConsonant(cp: number): boolean {
  return (cp >= 0x0915 && cp <= 0x0939) || (cp >= 0x0958 && cp <= 0x095F)
}
