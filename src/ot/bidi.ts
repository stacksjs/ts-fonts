/**
 * Minimal bidi helpers for Arabic text shaping.
 *
 * OpenType Arabic text uses GSUB features (`init`, `medi`, `fina`, `isol`)
 * to select contextual glyph forms for each character. This module tells
 * you which form each character should take given its neighbors.
 *
 * Full bidi reordering (UAX #9) is beyond this module's scope — most
 * callers render logical-order text and handle visual reversal at layout.
 */

export type ArabicForm = 'isol' | 'init' | 'medi' | 'fina'

/** Is the code point in any Arabic block? */
export function isArabic(cp: number): boolean {
  return (
    (cp >= 0x0600 && cp <= 0x06FF) // Arabic
    || (cp >= 0x0750 && cp <= 0x077F) // Arabic Supplement
    || (cp >= 0x08A0 && cp <= 0x08FF) // Arabic Extended-A
    || (cp >= 0xFB50 && cp <= 0xFDFF) // Arabic Presentation Forms-A
    || (cp >= 0xFE70 && cp <= 0xFEFF) // Arabic Presentation Forms-B
  )
}

/**
 * Whether an Arabic code point is "joining" on its left (can connect to
 * the *next* letter visually).
 *
 * This uses a lightweight heuristic: most Arabic letters are dual-joining
 * (connect on both sides) but a handful are right-joining only (alef, dal,
 * thal, reh, zain, waw, and the Hebrew/Syriac-like letters).
 */
const RIGHT_JOINING = new Set<number>([
  0x0622, 0x0623, 0x0624, 0x0625, 0x0627, // alef variants
  0x062F, 0x0630, // dal, thal
  0x0631, 0x0632, // reh, zain
  0x0648, // waw
  0x0671, 0x0672, 0x0673, // other alef forms
  0x0698, 0x06C0, 0x06C1, 0x06C2, 0x06C3, 0x06C4, 0x06C5, 0x06C6, 0x06C7,
  0x06C8, 0x06C9, 0x06CA, 0x06CB, 0x06CD, 0x06CF, 0x06D2, 0x06D3,
])

/** Returns true if the char can join to the previous letter. */
export function canJoinRight(cp: number): boolean {
  return isArabic(cp)
}

/** Returns true if the char can join to the next letter. */
export function canJoinLeft(cp: number): boolean {
  return isArabic(cp) && !RIGHT_JOINING.has(cp)
}

/**
 * Classify each character's Arabic contextual form. Returns an array
 * aligned with the input codepoints.
 */
export function arabicForms(codepoints: number[]): ArabicForm[] {
  const forms: ArabicForm[] = []
  for (let i = 0; i < codepoints.length; i++) {
    const cp = codepoints[i]
    if (!isArabic(cp)) {
      forms.push('isol')
      continue
    }
    const prev = i > 0 ? codepoints[i - 1] : 0
    const next = i + 1 < codepoints.length ? codepoints[i + 1] : 0
    const prevJoin = canJoinLeft(prev) // previous letter connects forward?
    const nextJoin = canJoinRight(next) // next letter can accept join from us?

    const canJoinPrev = prevJoin && canJoinRight(cp)
    const canJoinNext = canJoinLeft(cp) && nextJoin

    if (canJoinPrev && canJoinNext) forms.push('medi')
    else if (canJoinPrev) forms.push('fina')
    else if (canJoinNext) forms.push('init')
    else forms.push('isol')
  }
  return forms
}

/**
 * Convenience: given a text string, produce its visual-order codepoints
 * (reversing runs of RTL characters).
 *
 * This is NOT a full UAX #9 implementation — it handles the common case
 * of pure-Arabic text or Arabic embedded at the start/end of a line.
 */
export function toVisualOrder(text: string): number[] {
  const cps: number[] = []
  for (const ch of text) cps.push(ch.codePointAt(0) ?? 0)

  // Reverse each contiguous run of RTL characters (Arabic + Hebrew)
  const isRtl = (cp: number): boolean => isArabic(cp) || (cp >= 0x0590 && cp <= 0x05FF)
  const out: number[] = []
  let i = 0
  while (i < cps.length) {
    if (isRtl(cps[i])) {
      let j = i
      while (j < cps.length && (isRtl(cps[j]) || cps[j] === 0x20))
        j++
      const segment = cps.slice(i, j).reverse()
      out.push(...segment)
      i = j
    }
    else {
      out.push(cps[i])
      i++
    }
  }
  return out
}
