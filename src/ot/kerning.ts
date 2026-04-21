import type { TTFObject } from '../types'
import type { GposKerning } from './gpos'
import { readLayoutHeader } from './layout-common'
import { readGposKerning } from './gpos'

/**
 * Unified kerning lookup across the kern table and GPOS 'kern' feature.
 * Returns a function that resolves kerning for a pair of glyph indexes.
 */
export function buildKerningLookup(ttf: TTFObject): (left: number, right: number) => number {
  // Legacy kern table: construct a fast map
  const kernMap = new Map<number, number>()
  if (ttf.kern) {
    for (const sub of ttf.kern.subtables) {
      if (sub.format !== 0) continue
      for (const pair of sub.pairs) {
        const key = (pair.left << 16) | pair.right
        if (!kernMap.has(key)) kernMap.set(key, pair.value)
      }
    }
  }

  let gposKerning: GposKerning | undefined
  const gposRaw = ttf.rawTables?.GPOS
  if (gposRaw) {
    try {
      const view = new DataView(gposRaw.buffer, gposRaw.byteOffset, gposRaw.byteLength)
      const header = readLayoutHeader(view, 0)
      gposKerning = readGposKerning(view, header)
    }
    catch {
      // Malformed GPOS → ignore
    }
  }

  return (left: number, right: number): number => {
    if (gposKerning) {
      const v = gposKerning.getKerningValue(left, right)
      if (v !== 0) return v
    }
    const key = (left << 16) | right
    return kernMap.get(key) ?? 0
  }
}
