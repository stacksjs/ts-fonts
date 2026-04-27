/**
 * Glyph subsetter.
 *
 * Takes a TTFObject + a set of codepoints to keep and returns a new
 * TTFObject containing only the matching glyphs (plus .notdef and any
 * components referenced by the kept glyphs). The cmap is rewritten,
 * hmtx/loca are rebuilt by the writer.
 *
 * Useful before emitting a small WOFF2 (e.g. only the Latin-1 subset of
 * a 1000-glyph CJK font).
 */

import type { Glyph, TTFObject } from '../types'

export interface SubsetOptions {
  /** Codepoints (numbers) to retain. */
  codepoints: Iterable<number>
  /** Also retain glyphs referenced by GSUB ligatures? Default `true`. */
  includeLigatures?: boolean
  /** Also retain glyphs referenced as components of compound glyphs? Default `true`. */
  includeComponents?: boolean
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type CompoundGlyph = Glyph & { compound?: boolean, glyfs?: any[] }

/**
 * Build a glyph-keep set from cmap + codepoints + transitive references
 * (ligature components, compound components).
 */
function collectKeepers(ttf: TTFObject, opts: SubsetOptions): Set<number> {
  const keep = new Set<number>([0]) // .notdef
  const cmap = (ttf.cmap ?? {}) as Record<number, number>
  for (const cp of opts.codepoints) {
    const gid = cmap[cp]
    if (typeof gid === 'number') keep.add(gid)
  }

  // Transitively include compound components.
  if (opts.includeComponents !== false) {
    let changed = true
    while (changed) {
      changed = false
      for (const gid of [...keep]) {
        const g = ttf.glyf[gid] as CompoundGlyph | undefined
        if (!g?.compound || !g.glyfs) continue
        for (const ref of g.glyfs) {
          if (typeof ref.glyphIndex === 'number' && !keep.has(ref.glyphIndex)) {
            keep.add(ref.glyphIndex)
            changed = true
          }
        }
      }
    }
  }

  // Include ligature output glyphs whose components are all kept.
  if (opts.includeLigatures !== false && ttf.gsub?.features) {
    for (const feat of Object.values(ttf.gsub.features)) {
      for (const lig of feat.ligatures ?? []) {
        if (lig.sub.every(gid => keep.has(gid))) keep.add(lig.by)
      }
    }
  }

  return keep
}

/**
 * Subset a font to a specific codepoint set. Returns a new TTFObject.
 *
 * Glyph indices are renumbered densely starting at 0 (.notdef stays at 0).
 * cmap, GSUB ligature references, and compound-glyph component indices are
 * remapped to the new numbering.
 */
export function subsetGlyphs(ttf: TTFObject, opts: SubsetOptions): TTFObject {
  const keep = collectKeepers(ttf, opts)
  // Build old → new index mapping (keepers in original order).
  const oldToNew = new Map<number, number>()
  const keptGlyphs: Glyph[] = []
  for (let oldIdx = 0; oldIdx < ttf.glyf.length; oldIdx++) {
    if (!keep.has(oldIdx)) continue
    oldToNew.set(oldIdx, keptGlyphs.length)
    // Clone glyph; remap component indices if compound.
    const orig = ttf.glyf[oldIdx]!
    const cloned: Glyph = { ...orig }
    const cg = cloned as CompoundGlyph
    if (cg.compound && cg.glyfs) {
      cg.glyfs = cg.glyfs.map(ref => ({ ...ref, glyphIndex: ref.glyphIndex != null ? (oldToNew.get(ref.glyphIndex) ?? 0) : 0 }))
    }
    keptGlyphs.push(cloned)
  }

  // Rebuild cmap: only keep entries whose target glyph survived.
  const oldCmap = (ttf.cmap ?? {}) as Record<number, number>
  const newCmap: Record<number, number> = {}
  for (const cpStr of Object.keys(oldCmap)) {
    const cp = Number(cpStr)
    const oldGid = oldCmap[cp]!
    const newGid = oldToNew.get(oldGid)
    if (typeof newGid === 'number') newCmap[cp] = newGid
  }

  // Remap GSUB ligature references.
  const newGsub = ttf.gsub
    ? {
        ...ttf.gsub,
        features: Object.fromEntries(Object.entries(ttf.gsub.features).map(([tag, feat]) => [tag, {
          ...feat,
          ligatures: feat.ligatures?.map(lig => ({
            sub: lig.sub.map(gid => oldToNew.get(gid) ?? 0).filter(g => g !== 0),
            by: oldToNew.get(lig.by) ?? 0,
          })).filter(lig => lig.sub.length > 1 && lig.by !== 0),
        }])),
      }
    : undefined

  // Update glyph .unicode arrays so brandNameTable and others see consistent state.
  for (const g of keptGlyphs) {
    if (Array.isArray(g.unicode)) {
      g.unicode = g.unicode.filter(cp => newCmap[cp] != null)
    }
  }

  // Update hmtx (parallel to glyf).
  const oldHmtx = ttf.hmtx
  const newHmtx = oldHmtx
    ? Array.from(oldToNew.entries()).sort((a, b) => a[1] - b[1]).map(([oldI]) => oldHmtx[oldI] ?? { advanceWidth: 0, leftSideBearing: 0 })
    : undefined

  return {
    ...ttf,
    glyf: keptGlyphs,
    cmap: newCmap as never,
    hmtx: newHmtx,
    gsub: newGsub,
    maxp: { ...ttf.maxp, numGlyphs: keptGlyphs.length },
    hhea: { ...ttf.hhea, numOfLongHorMetrics: keptGlyphs.length },
    // subsetMap records the old→new mapping so callers can introspect.
    subsetMap: Object.fromEntries(oldToNew.entries()),
  }
}
