/**
 * Authoring API for GPOS positioning rules. Mirrors `Substitution` in
 * shape — populate `font.data.gpos` and let the writer serialise it.
 *
 *   font.positioning.addPair('kern', glyphA, glyphB, { xAdvance: -50 })
 */

import type { GposAuthoring, GposPairEntry, GposValueRecord, TTFObject } from '../types'

interface FontLike {
  data: TTFObject
}

export class Positioning {
  constructor(private readonly font: FontLike) {}

  private ensure(): GposAuthoring {
    if (!this.font.data.gpos) {
      this.font.data.gpos = { features: {} }
    }
    return this.font.data.gpos
  }

  /**
   * Add a pair-positioning rule: when `first` is followed by `second`,
   * apply `value1` to the first glyph and (optionally) `value2` to the
   * second. The most common use is kerning:
   *
   *   font.positioning.addPair('kern', a, b, { xAdvance: -40 })
   *
   * means "tighten the gap between glyph `a` and glyph `b` by 40 units".
   */
  addPair(feature: string, first: number, second: number, value1: GposValueRecord, value2?: GposValueRecord): void {
    const tag = feature.padEnd(4).slice(0, 4)
    const f = (this.ensure().features[tag] ??= {})
    const entry: GposPairEntry = { first, second, value1, ...(value2 ? { value2 } : {}) }
    ;(f.pairs ??= []).push(entry)
  }

  /**
   * Bulk-add kerning pairs as `[first, second, xAdvance]` triples.
   */
  addKernPairs(triples: ReadonlyArray<readonly [number, number, number]>, feature = 'kern'): void {
    for (const [a, b, x] of triples) this.addPair(feature, a, b, { xAdvance: x })
  }

  removeFeature(feature: string): void {
    const gpos = this.font.data.gpos
    if (!gpos) return
    delete gpos.features[feature.padEnd(4).slice(0, 4)]
  }

  reset(): void {
    if (this.font.data.gpos) this.font.data.gpos = { features: {} }
  }

  get authoring(): GposAuthoring | undefined {
    return this.font.data.gpos
  }
}
