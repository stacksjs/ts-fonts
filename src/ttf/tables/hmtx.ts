import type { Reader } from '../../io/reader'
import type { Writer } from '../../io/writer'
import type { TTFObject } from '../../types'

export interface HMetric {
  advanceWidth: number
  leftSideBearing: number
}

export function readHmtx(reader: Reader, offset: number, numOfLongHorMetrics: number, numGlyphs: number): HMetric[] {
  reader.seek(offset)
  const metrics: HMetric[] = []
  for (let i = 0; i < numOfLongHorMetrics; i++) {
    metrics.push({
      advanceWidth: reader.readUint16(),
      leftSideBearing: reader.readInt16(),
    })
  }
  const lastAdvance = metrics.length > 0 ? metrics[metrics.length - 1].advanceWidth : 0
  for (let i = numOfLongHorMetrics; i < numGlyphs; i++) {
    metrics.push({
      advanceWidth: lastAdvance,
      leftSideBearing: reader.readInt16(),
    })
  }
  return metrics
}

export function writeHmtx(writer: Writer, ttf: TTFObject): void {
  // Simple: write one long metric per glyph
  for (const g of ttf.glyf) {
    writer.writeUint16(g.advanceWidth ?? 0)
    writer.writeInt16(g.leftSideBearing ?? 0)
  }
}

export function hmtxSize(ttf: TTFObject): number {
  return ttf.glyf.length * 4
}
