import type { IconObject, TTFObject } from '../types'

export interface Ttf2IconOptions {
  iconPrefix?: string
  metadata?: unknown
}

export function ttf2icon(ttf: TTFObject, options: Ttf2IconOptions = {}): IconObject {
  const iconPrefix = options.iconPrefix ?? 'icon'
  const glyfList: IconObject['glyfList'] = []

  for (let i = 1; i < ttf.glyf.length; i++) {
    const g = ttf.glyf[i]
    if (!g.unicode || g.unicode.length === 0) continue
    const code = g.unicode.map(u => `&#x${u.toString(16)};`).join('')
    const codeName = g.unicode.map(u => `\\${u.toString(16)}`).join(',')
    const name = g.name ?? `${iconPrefix}-${i}`
    glyfList.push({ code, codeName, name, id: name })
  }

  return {
    fontFamily: ttf.name.fontFamily || iconPrefix,
    iconPrefix,
    glyfList,
  }
}
