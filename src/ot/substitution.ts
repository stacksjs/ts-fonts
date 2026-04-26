/**
 * Authoring API for GSUB substitution rules — opentype.js-compatible
 * surface so consumers that build fonts can write
 *
 *   font.substitution.add('liga', { sub: [a, b], by: c })
 *
 * and have the resulting font carry a real GSUB table on serialisation.
 *
 * Internally this just mutates `font.data.gsub` (a `GsubAuthoring` object);
 * the TTF writer takes care of serialising it via `tables/gsub.ts`.
 */

import type { GsubAuthoring, GsubLigatureEntry, TTFObject } from '../types'

export interface SubstitutionLigatureInput extends GsubLigatureEntry {}

/** A duck-typed Font reference — accepts anything with a `data: TTFObject`. */
interface FontLike {
  data: TTFObject
}

export class Substitution {
  constructor(private readonly font: FontLike) {}

  private ensure(): GsubAuthoring {
    if (!this.font.data.gsub) {
      this.font.data.gsub = { features: {} }
    }
    return this.font.data.gsub
  }

  /**
   * Add a substitution rule under `feature`. Today the supported
   * features are ligature-style (`liga`, `rlig`, `dlig`, `ss01`–`ss20`,
   * `calt`, `clig`); future kinds (singles, alternates) will land here.
   */
  add(feature: string, entry: SubstitutionLigatureInput): void {
    if (!entry || !Array.isArray(entry.sub) || entry.sub.length < 2 || typeof entry.by !== 'number')
      throw new TypeError(`substitution.add: expected { sub: number[], by: number } for feature '${feature}'`)
    const tag = feature.padEnd(4).slice(0, 4)
    const gsub = this.ensure()
    const f = (gsub.features[tag] ??= {})
    ;(f.ligatures ??= []).push({ sub: [...entry.sub], by: entry.by })
  }

  /**
   * Bulk-add a set of ligature rules — convenience for ingesting a list.
   */
  addLigatures(feature: string, entries: SubstitutionLigatureInput[]): void {
    for (const e of entries) this.add(feature, e)
  }

  /** Remove all authored content for a feature tag. */
  removeFeature(feature: string): void {
    const gsub = this.font.data.gsub
    if (!gsub) return
    delete gsub.features[feature.padEnd(4).slice(0, 4)]
  }

  /** Remove all authored GSUB content. */
  reset(): void {
    if (this.font.data.gsub) this.font.data.gsub = { features: {} }
  }

  /** Read the current authoring buffer (for tests / inspection). */
  get authoring(): GsubAuthoring | undefined {
    return this.font.data.gsub
  }
}
