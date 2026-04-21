import type { TTFObject } from '../types'
import { glyph2svg } from '../svg/path'

export interface Ttf2SvgOptions {
  metadata?: string
}

export function ttf2svg(ttf: TTFObject, options: Ttf2SvgOptions = {}): string {
  const name = ttf.name
  const unitsPerEm = ttf.head.unitsPerEm
  const ascent = ttf.hhea.ascent
  const descent = ttf.hhea.descent

  const metadata = options.metadata ? `\n<metadata>${escapeXml(options.metadata)}</metadata>` : ''

  const header = `<?xml version="1.0" standalone="no"?>
<!DOCTYPE svg PUBLIC "-//W3C//DTD SVG 1.1//EN" "http://www.w3.org/Graphics/SVG/1.1/DTD/svg11.dtd" >
<svg xmlns="http://www.w3.org/2000/svg">${metadata}
<defs>
<font id="${escapeAttr(name.fontFamily)}" horiz-adv-x="${ttf.hhea.advanceWidthMax}">
<font-face
    font-family="${escapeAttr(name.fontFamily)}"
    font-weight="${ttf['OS/2'].usWeightClass}"
    font-stretch="normal"
    units-per-em="${unitsPerEm}"
    ascent="${ascent}"
    descent="${descent}" />
<missing-glyph horiz-adv-x="${ttf.glyf[0]?.advanceWidth ?? 0}" />`

  const parts: string[] = [header]
  for (let i = 1; i < ttf.glyf.length; i++) {
    const g = ttf.glyf[i]
    const path = glyph2svg(g, unitsPerEm)
    const unicodeAttr = g.unicode && g.unicode.length > 0
      ? ` unicode="${g.unicode.map(u => `&#x${u.toString(16)};`).join('')}"`
      : ''
    const nameAttr = g.name ? ` glyph-name="${escapeAttr(g.name)}"` : ''
    const advAttr = g.advanceWidth !== undefined ? ` horiz-adv-x="${g.advanceWidth}"` : ''
    parts.push(`<glyph${unicodeAttr}${nameAttr}${advAttr} d="${path}" />`)
  }
  parts.push('</font>\n</defs>\n</svg>')
  return parts.join('\n')
}

function escapeAttr(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function escapeXml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}
