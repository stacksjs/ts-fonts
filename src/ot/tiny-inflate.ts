/**
 * Minimal RFC 1951 DEFLATE decompressor (tiny-inflate port).
 *
 * This is a JavaScript port of Devon Govett's tiny-inflate, itself based on
 * Joergen Ibsen's BSD-licensed pico-inflate. Used to decompress WOFF tables
 * in environments without a built-in zlib binding.
 *
 * Input must already be stripped of any zlib framing — the function takes
 * raw deflate-compressed data.
 */

const TINF_OK = 0
const TINF_DATA_ERROR = -3

interface Tree {
  table: Int32Array
  trans: Int32Array
}

interface Data {
  source: Uint8Array
  sourceIndex: number
  tag: number
  bitcount: number
  dest: Uint8Array
  destLen: number
  ltree: Tree
  dtree: Tree
}

const sltree: Tree = { table: new Int32Array(16), trans: new Int32Array(288) }
const sdtree: Tree = { table: new Int32Array(16), trans: new Int32Array(30) }

const lengthBits = new Uint8Array(30)
const lengthBase = new Uint16Array(30)
const distBits = new Uint8Array(30)
const distBase = new Uint16Array(30)
const clcidx = [16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15]
const codeTree: Tree = { table: new Int32Array(16), trans: new Int32Array(288) }
const lengths = new Uint8Array(288 + 32)

function tinfBuildBitsBase(bits: Uint8Array, base: Uint16Array, delta: number, first: number): void {
  for (let i = 0; i < delta; ++i) bits[i] = 0
  for (let i = 0; i < 30 - delta; ++i) bits[i + delta] = (i / delta) | 0
  let sum = first
  for (let i = 0; i < 30; ++i) {
    base[i] = sum
    sum += 1 << bits[i]
  }
}

function tinfBuildFixedTrees(lt: Tree, dt: Tree): void {
  for (let i = 0; i < 7; ++i) lt.table[i] = 0
  lt.table[7] = 24
  lt.table[8] = 152
  lt.table[9] = 112
  for (let i = 0; i < 24; ++i) lt.trans[i] = 256 + i
  for (let i = 0; i < 144; ++i) lt.trans[24 + i] = i
  for (let i = 0; i < 8; ++i) lt.trans[24 + 144 + i] = 280 + i
  for (let i = 0; i < 112; ++i) lt.trans[24 + 144 + 8 + i] = 144 + i
  for (let i = 0; i < 5; ++i) dt.table[i] = 0
  dt.table[5] = 32
  for (let i = 0; i < 32; ++i) dt.trans[i] = i
}

function tinfBuildTree(t: Tree, lens: Uint8Array, off: number, num: number): void {
  const offs = new Uint16Array(16)
  for (let i = 0; i < 16; ++i) t.table[i] = 0
  for (let i = 0; i < num; ++i) t.table[lens[off + i]]++
  t.table[0] = 0
  let sum = 0
  for (let i = 0; i < 16; ++i) {
    offs[i] = sum
    sum += t.table[i]
  }
  for (let i = 0; i < num; ++i) {
    if (lens[off + i]) t.trans[offs[lens[off + i]]++] = i
  }
}

function tinfGetBit(d: Data): number {
  if (!d.bitcount--) {
    d.tag = d.source[d.sourceIndex++]
    d.bitcount = 7
  }
  const bit = d.tag & 1
  d.tag >>>= 1
  return bit
}

function tinfReadBits(d: Data, num: number, base: number): number {
  if (!num) return base
  while (d.bitcount < 24) {
    d.tag |= d.source[d.sourceIndex++] << d.bitcount
    d.bitcount += 8
  }
  const val = d.tag & (0xFFFF >>> (16 - num))
  d.tag >>>= num
  d.bitcount -= num
  return val + base
}

function tinfDecodeSymbol(d: Data, t: Tree): number {
  while (d.bitcount < 24) {
    d.tag |= d.source[d.sourceIndex++] << d.bitcount
    d.bitcount += 8
  }
  let sum = 0, cur = 0, len = 0
  let tag = d.tag
  do {
    cur = 2 * cur + (tag & 1)
    tag >>>= 1
    ++len
    sum += t.table[len]
    cur -= t.table[len]
  } while (cur >= 0)
  d.tag = tag
  d.bitcount -= len
  return t.trans[sum + cur]
}

function tinfDecodeTrees(d: Data, lt: Tree, dt: Tree): void {
  const hlit = tinfReadBits(d, 5, 257)
  const hdist = tinfReadBits(d, 5, 1)
  const hclen = tinfReadBits(d, 4, 4)
  for (let i = 0; i < 19; ++i) lengths[i] = 0
  for (let i = 0; i < hclen; ++i) {
    const clen = tinfReadBits(d, 3, 0)
    lengths[clcidx[i]] = clen
  }
  tinfBuildTree(codeTree, lengths, 0, 19)
  for (let num = 0; num < hlit + hdist;) {
    const sym = tinfDecodeSymbol(d, codeTree)
    let length = 0, prev: number
    switch (sym) {
      case 16:
        prev = lengths[num - 1]
        for (length = tinfReadBits(d, 2, 3); length; --length) lengths[num++] = prev
        break
      case 17:
        for (length = tinfReadBits(d, 3, 3); length; --length) lengths[num++] = 0
        break
      case 18:
        for (length = tinfReadBits(d, 7, 11); length; --length) lengths[num++] = 0
        break
      default:
        lengths[num++] = sym
        break
    }
  }
  tinfBuildTree(lt, lengths, 0, hlit)
  tinfBuildTree(dt, lengths, hlit, hdist)
}

function tinfInflateBlockData(d: Data, lt: Tree, dt: Tree): number {
  while (true) {
    const sym = tinfDecodeSymbol(d, lt)
    if (sym === 256) return TINF_OK
    if (sym < 256) {
      d.dest[d.destLen++] = sym
    }
    else {
      const l = sym - 257
      const length = tinfReadBits(d, lengthBits[l], lengthBase[l])
      const distSym = tinfDecodeSymbol(d, dt)
      const offs = tinfReadBits(d, distBits[distSym], distBase[distSym])
      for (let i = d.destLen - offs, j = 0; j < length; ++j) d.dest[d.destLen++] = d.dest[i + j]
    }
  }
}

function tinfInflateUncompressedBlock(d: Data): number {
  while (d.bitcount > 8) {
    d.sourceIndex--
    d.bitcount -= 8
  }
  let length = d.source[d.sourceIndex + 1]
  length = 256 * length + d.source[d.sourceIndex]
  const invlength = d.source[d.sourceIndex + 3]
  // eslint-disable-next-line no-bitwise
  const invLen2 = 256 * invlength + d.source[d.sourceIndex + 2]
  if (length !== (~invLen2 & 0x0000FFFF)) return TINF_DATA_ERROR
  d.sourceIndex += 4
  for (let i = length; i; --i) d.dest[d.destLen++] = d.source[d.sourceIndex++]
  d.bitcount = 0
  return TINF_OK
}

// Initialise static tables once at module load
tinfBuildFixedTrees(sltree, sdtree)
tinfBuildBitsBase(lengthBits, lengthBase, 4, 3)
tinfBuildBitsBase(distBits, distBase, 2, 1)
lengthBits[28] = 0
lengthBase[28] = 258

/**
 * Decompress `source` (raw DEFLATE data) into `dest`. Returns the number
 * of bytes written into `dest`. Throws on malformed input.
 */
export function inflate(source: Uint8Array, dest: Uint8Array): Uint8Array {
  const d: Data = {
    source,
    sourceIndex: 0,
    tag: 0,
    bitcount: 0,
    dest,
    destLen: 0,
    ltree: { table: new Int32Array(16), trans: new Int32Array(288) },
    dtree: { table: new Int32Array(16), trans: new Int32Array(288) },
  }
  let bfinal: number
  let btype: number
  let res: number
  do {
    bfinal = tinfGetBit(d)
    btype = tinfReadBits(d, 2, 0)
    switch (btype) {
      case 0:
        res = tinfInflateUncompressedBlock(d)
        break
      case 1:
        res = tinfInflateBlockData(d, sltree, sdtree)
        break
      case 2:
        tinfDecodeTrees(d, d.ltree, d.dtree)
        res = tinfInflateBlockData(d, d.ltree, d.dtree)
        break
      default:
        res = TINF_DATA_ERROR
    }
    if (res !== TINF_OK) throw new Error('tiny-inflate: data error')
  } while (!bfinal)
  if (d.destLen < d.dest.length)
    return d.dest.subarray(0, d.destLen)
  return d.dest
}

/**
 * Simple wrapper: inflate `source` into a freshly-allocated buffer sized
 * to `destLen` (or grown dynamically if unknown).
 */
export function inflateTo(source: Uint8Array, destLen: number): Uint8Array {
  // Strip zlib framing (2-byte header, 4-byte adler) if present.
  let raw = source
  if (source.length > 6 && source[0] === 0x78 && ((source[0] * 256 + source[1]) % 31 === 0))
    raw = source.subarray(2, source.length - 4)
  const dest = new Uint8Array(destLen)
  return inflate(raw, dest)
}
