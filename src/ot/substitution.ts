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

import type { GsubAlternateEntry, GsubAuthoring, GsubLigatureEntry, GsubMultipleEntry, GsubSingleEntry, TTFObject } from '../types'

export interface SubstitutionLigatureInput extends GsubLigatureEntry {}
export interface SubstitutionSingleInput extends GsubSingleEntry {}
export interface SubstitutionMultipleInput extends GsubMultipleEntry {}
export interface SubstitutionAlternateInput extends GsubAlternateEntry {}

export type SubstitutionInput =
  | SubstitutionLigatureInput
  | SubstitutionSingleInput
  | SubstitutionMultipleInput
  | SubstitutionAlternateInput

/** A duck-typed Font reference — accepts anything with a `data: TTFObject`. */
interface FontLike {
  data: TTFObject
}

function classify(entry: SubstitutionInput): 'liga' | 'single' | 'multiple' | 'alternate' {
  if (Array.isArray((entry as SubstitutionLigatureInput).sub) && typeof (entry as SubstitutionLigatureInput).by === 'number') {
    return 'liga'
  }
  if (typeof (entry as SubstitutionSingleInput).sub === 'number' && typeof (entry as SubstitutionSingleInput).by === 'number') {
    return 'single'
  }
  if (typeof (entry as SubstitutionMultipleInput).sub === 'number' && Array.isArray((entry as SubstitutionMultipleInput).by)) {
    return 'multiple'
  }
  if (typeof (entry as SubstitutionAlternateInput).sub === 'number' && Array.isArray((entry as SubstitutionAlternateInput).alternates)) {
    return 'alternate'
  }
  throw new TypeError('substitution.add: unrecognised entry shape')
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
   * Add a substitution rule under `feature`. The rule's lookup type is
   * inferred from its shape:
   *
   *   - `{ sub: number[], by: number }`    → ligature  (lookup type 4)
   *   - `{ sub: number,   by: number }`    → single    (lookup type 1)
   *   - `{ sub: number,   by: number[] }`  → multiple  (lookup type 2)
   *   - `{ sub: number,   alternates: number[] }` → alternate (lookup type 3)
   */
  add(feature: string, entry: SubstitutionInput): void {
    const kind = classify(entry)
    const tag = feature.padEnd(4).slice(0, 4)
    const f = (this.ensure().features[tag] ??= {})
    if (kind === 'liga') {
      const e = entry as SubstitutionLigatureInput
      if (e.sub.length < 2) throw new TypeError('substitution.add: liga requires sub.length ≥ 2')
      ;(f.ligatures ??= []).push({ sub: [...e.sub], by: e.by })
    }
    else if (kind === 'single') {
      const e = entry as SubstitutionSingleInput
      ;(f.singles ??= []).push({ sub: e.sub, by: e.by })
    }
    else if (kind === 'multiple') {
      const e = entry as SubstitutionMultipleInput
      if (e.by.length === 0) throw new TypeError('substitution.add: multiple requires by.length ≥ 1')
      ;(f.multiples ??= []).push({ sub: e.sub, by: [...e.by] })
    }
    else if (kind === 'alternate') {
      const e = entry as SubstitutionAlternateInput
      if (e.alternates.length === 0) throw new TypeError('substitution.add: alternate requires alternates.length ≥ 1')
      ;(f.alternates ??= []).push({ sub: e.sub, alternates: [...e.alternates] })
    }
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
