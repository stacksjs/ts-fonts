import type { TTFObject } from '../types'
import { parseCFF } from '../cff/cff'
import { parseCFF2 } from '../cff/cff2'
import { Reader } from '../io/reader'
import { readDirectory } from '../ttf/directory'
import { SFNT_VERSION_OTF } from '../ttf/enum'
import { readCmap } from '../ttf/tables/cmap'
import { readHead } from '../ttf/tables/head'
import { readHhea } from '../ttf/tables/hhea'
import { readHmtx } from '../ttf/tables/hmtx'
import { readMaxp } from '../ttf/tables/maxp'
import { readName } from '../ttf/tables/name'
import { readOS2 } from '../ttf/tables/os2'
import { readPost } from '../ttf/tables/post'

export interface Otf2TtfOptions {
  subset?: number[]
}

/**
 * Parse an OTF (OpenType with CFF outlines) into a TTF-shaped object.
 * Performs full CFF parsing: charstring interpretation + cubic→quadratic
 * conversion so the resulting glyphs are valid TrueType outlines.
 */
export function otf2ttfobject(buffer: ArrayBuffer, options: Otf2TtfOptions = {}): TTFObject {
  const reader = new Reader(buffer)
  const dir = readDirectory(reader)
  if (dir.sfntVersion !== SFNT_VERSION_OTF && dir.sfntVersion !== 0x10000)
    throw new Error('not an OTF font')

  const ttf = {} as TTFObject
  if (dir.tables.head) ttf.head = readHead(reader, dir.tables.head.offset)
  if (dir.tables.maxp) ttf.maxp = readMaxp(reader, dir.tables.maxp.offset)
  if (dir.tables.hhea) ttf.hhea = readHhea(reader, dir.tables.hhea.offset)
  if (dir.tables.hmtx && ttf.hhea && ttf.maxp)
    ttf.hmtx = readHmtx(reader, dir.tables.hmtx.offset, ttf.hhea.numOfLongHorMetrics, ttf.maxp.numGlyphs)
  if (dir.tables['OS/2']) ttf['OS/2'] = readOS2(reader, dir.tables['OS/2'].offset)
  if (dir.tables.name) ttf.name = readName(reader, dir.tables.name.offset)
  if (dir.tables.post) ttf.post = readPost(reader, dir.tables.post.offset)
  if (dir.tables.cmap) ttf.cmap = readCmap(reader, dir.tables.cmap.offset)
  if (!ttf.cmap) ttf.cmap = {}

  const numGlyphs = ttf.maxp?.numGlyphs ?? 0
  const cff1Entry = dir.tables['CFF ']
  const cff2Entry = dir.tables.CFF2

  if (cff1Entry) {
    const result = parseCFF(buffer, cff1Entry.offset, cff1Entry.length, numGlyphs)
    ttf.glyf = result.glyphs
  }
  else if (cff2Entry) {
    const result = parseCFF2(buffer, cff2Entry.offset, numGlyphs)
    ttf.glyf = result.glyphs
  }

  // Fill advance/LSB from hmtx if available (CFF widths sometimes differ from hmtx)
  if ((cff1Entry || cff2Entry) && ttf.hmtx) {
    for (let i = 0; i < ttf.glyf.length; i++) {
      const m = ttf.hmtx[i]
      if (m) {
        ttf.glyf[i].advanceWidth = m.advanceWidth
        ttf.glyf[i].leftSideBearing = m.leftSideBearing
      }
    }
  }

  if (!cff1Entry && !cff2Entry) {
    ttf.glyf = []
    for (let i = 0; i < numGlyphs; i++) {
      const m = ttf.hmtx?.[i]
      ttf.glyf.push({
        contours: [],
        xMin: 0, yMin: 0, xMax: 0, yMax: 0,
        advanceWidth: m?.advanceWidth ?? 0,
        leftSideBearing: m?.leftSideBearing ?? 0,
      })
    }
  }

  // Attach cmap unicodes to glyphs
  for (const [codeStr, gi] of Object.entries(ttf.cmap)) {
    const g = ttf.glyf[gi]
    if (!g) continue
    if (!g.unicode) g.unicode = []
    g.unicode.push(Number.parseInt(codeStr, 10))
  }

  // Force to TTF sfnt version
  ttf.version = 0x10000

  void options
  return ttf
}
