/**
 * Convert an array of unicode codepoints to an XML entity string
 * (e.g. [0x41, 0x42] → "&#x41;&#x42;").
 */
export function unicode2xml(codes: number[] | number): string {
  const arr = Array.isArray(codes) ? codes : [codes]
  return arr.map(c => `&#x${c.toString(16).toUpperCase()};`).join('')
}

/** Convert unicode codepoints to an escape sequence like "\61,\62". */
export function unicode2esc(codes: number[] | number): string {
  const arr = Array.isArray(codes) ? codes : [codes]
  return arr.map(c => `\\${c.toString(16).toLowerCase()}`).join(',')
}
