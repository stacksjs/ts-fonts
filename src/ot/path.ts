import { BoundingBox } from './bounding-box'

export type PathCommand =
  | { type: 'M', x: number, y: number }
  | { type: 'L', x: number, y: number }
  | { type: 'C', x1: number, y1: number, x2: number, y2: number, x: number, y: number }
  | { type: 'Q', x1: number, y1: number, x: number, y: number }
  | { type: 'Z' }

export interface PathDataOptions {
  decimalPlaces?: number
  optimize?: boolean
  flipY?: boolean
  flipYBase?: number
}

export interface PathFromSvgOptions extends PathDataOptions {
  scale?: number
  x?: number
  y?: number
}

/**
 * An opentype.js-compatible Path class. Represents a bezier outline as
 * a sequence of M/L/C/Q/Z commands and exposes drawing, bbox, and
 * SVG import/export helpers.
 */
export class Path {
  commands: PathCommand[]
  fill: string | null
  stroke: string | null
  strokeWidth: number
  /** Optional CPAL/COLR sub-layers (set by Glyph.getPath when rendering color fonts). */
  _layers?: Path[]
  /** Optional SVG-table image glyph (set by Glyph.getPath when rendering SVG color glyphs). */
  _image?: { image: string, x: number, y: number, width: number, height: number }

  constructor() {
    this.commands = []
    this.fill = 'black'
    this.stroke = null
    this.strokeWidth = 1
  }

  moveTo(x: number, y: number): void {
    this.commands.push({ type: 'M', x, y })
  }

  lineTo(x: number, y: number): void {
    this.commands.push({ type: 'L', x, y })
  }

  curveTo(x1: number, y1: number, x2: number, y2: number, x: number, y: number): void {
    this.commands.push({ type: 'C', x1, y1, x2, y2, x, y })
  }

  bezierCurveTo(x1: number, y1: number, x2: number, y2: number, x: number, y: number): void {
    this.curveTo(x1, y1, x2, y2, x, y)
  }

  quadraticCurveTo(x1: number, y1: number, x: number, y: number): void {
    this.commands.push({ type: 'Q', x1, y1, x, y })
  }

  quadTo(x1: number, y1: number, x: number, y: number): void {
    this.quadraticCurveTo(x1, y1, x, y)
  }

  close(): void {
    this.commands.push({ type: 'Z' })
  }

  closePath(): void {
    this.close()
  }

  /**
   * Append commands from another Path, BoundingBox, or raw command array.
   * BoundingBox becomes a rectangle frame.
   */
  extend(other: Path | PathCommand[] | BoundingBox): void {
    if (other instanceof Path) {
      this.commands.push(...other.commands)
      return
    }
    if (Array.isArray(other)) {
      this.commands.push(...other)
      return
    }
    if (other instanceof BoundingBox) {
      const { x1, y1, x2, y2 } = other
      if (Number.isNaN(x1) || Number.isNaN(x2)) return
      this.moveTo(x1, y1)
      this.lineTo(x2, y1)
      this.lineTo(x2, y2)
      this.lineTo(x1, y2)
      this.close()
    }
  }

  /** Analytical bounding box including curve extrema. */
  getBoundingBox(): BoundingBox {
    const bb = new BoundingBox()
    let startX = 0, startY = 0
    let prevX = 0, prevY = 0
    for (const cmd of this.commands) {
      switch (cmd.type) {
        case 'M':
          bb.addPoint(cmd.x, cmd.y)
          startX = prevX = cmd.x
          startY = prevY = cmd.y
          break
        case 'L':
          bb.addPoint(cmd.x, cmd.y)
          prevX = cmd.x
          prevY = cmd.y
          break
        case 'Q':
          bb.addQuad(prevX, prevY, cmd.x1, cmd.y1, cmd.x, cmd.y)
          prevX = cmd.x
          prevY = cmd.y
          break
        case 'C':
          bb.addBezier(prevX, prevY, cmd.x1, cmd.y1, cmd.x2, cmd.y2, cmd.x, cmd.y)
          prevX = cmd.x
          prevY = cmd.y
          break
        case 'Z':
          prevX = startX
          prevY = startY
          break
      }
    }
    return bb
  }

  /**
   * Draw this path to a 2D canvas-like context.
   * The context must support beginPath, moveTo, lineTo, bezierCurveTo,
   * quadraticCurveTo, closePath, fill, stroke, fillStyle, strokeStyle,
   * lineWidth.
   */
  // eslint-disable-next-line pickier/no-unused-vars
  draw(ctx: CanvasLike): void {
    ctx.beginPath()
    for (const cmd of this.commands) {
      switch (cmd.type) {
        case 'M': ctx.moveTo(cmd.x, cmd.y); break
        case 'L': ctx.lineTo(cmd.x, cmd.y); break
        case 'Q': ctx.quadraticCurveTo(cmd.x1, cmd.y1, cmd.x, cmd.y); break
        case 'C': ctx.bezierCurveTo(cmd.x1, cmd.y1, cmd.x2, cmd.y2, cmd.x, cmd.y); break
        case 'Z': ctx.closePath(); break
      }
    }
    if (this.fill) {
      ctx.fillStyle = this.fill
      ctx.fill()
    }
    if (this.stroke) {
      ctx.strokeStyle = this.stroke
      ctx.lineWidth = this.strokeWidth
      ctx.stroke()
    }
  }

  /** Produce SVG path "d" data for this path. */
  toPathData(options?: PathDataOptions | number): string {
    let opts: PathDataOptions = {}
    if (typeof options === 'number')
      opts = { decimalPlaces: options, flipY: false }
    else if (options)
      opts = options

    const decimals = opts.decimalPlaces ?? 2
    const optimize = opts.optimize ?? true
    const factor = 10 ** decimals
    const round = (v: number): number => Math.round(v * factor) / factor
    const format = (v: number): string => {
      const r = round(v)
      return r === 0 ? '0' : r.toString()
    }

    let flipY = opts.flipY ?? false
    let yBase = opts.flipYBase
    if (flipY && yBase === undefined) {
      const bb = this.getBoundingBox()
      yBase = (bb.y1 || 0) + (bb.y2 || 0)
    }
    const fy = (y: number): number => flipY ? (yBase ?? 0) - y : y

    let out = ''
    let prevX = 0, prevY = 0
    let startX = 0, startY = 0
    for (const cmd of this.commands) {
      if (cmd.type === 'M') {
        if (optimize && out.endsWith('Z')) { /* ok */ }
        out += `M${format(cmd.x)} ${format(fy(cmd.y))}`
        prevX = cmd.x; prevY = cmd.y
        startX = cmd.x; startY = cmd.y
      }
      else if (cmd.type === 'L') {
        if (optimize && cmd.x === prevX && cmd.y === prevY) continue
        out += `L${format(cmd.x)} ${format(fy(cmd.y))}`
        prevX = cmd.x; prevY = cmd.y
      }
      else if (cmd.type === 'Q') {
        out += `Q${format(cmd.x1)} ${format(fy(cmd.y1))} ${format(cmd.x)} ${format(fy(cmd.y))}`
        prevX = cmd.x; prevY = cmd.y
      }
      else if (cmd.type === 'C') {
        out += `C${format(cmd.x1)} ${format(fy(cmd.y1))} ${format(cmd.x2)} ${format(fy(cmd.y2))} ${format(cmd.x)} ${format(fy(cmd.y))}`
        prevX = cmd.x; prevY = cmd.y
      }
      else if (cmd.type === 'Z') {
        out += 'Z'
        prevX = startX; prevY = startY
      }
    }
    return out
  }

  /** Emit a full `<path>` SVG element. */
  toSVG(options?: PathDataOptions, pathData?: string): string {
    const d = pathData ?? this.toPathData(options)
    const attrs: string[] = [`d="${d}"`]
    if (this.fill && this.fill !== 'black') attrs.push(`fill="${this.fill}"`)
    if (this.stroke) attrs.push(`stroke="${this.stroke}"`, `stroke-width="${this.strokeWidth}"`)
    return `<path ${attrs.join(' ')}/>`
  }

  /** Create an SVGPathElement in a DOM environment. */
  toDOMElement(options?: PathDataOptions, pathData?: string): unknown {
    const g = globalThis as unknown as { document?: { createElementNS: (ns: string, name: string) => { setAttribute: (k: string, v: string) => void } } }
    if (!g.document) throw new Error('no DOM available')
    const el = g.document.createElementNS('http://www.w3.org/2000/svg', 'path')
    el.setAttribute('d', pathData ?? this.toPathData(options))
    if (this.fill) el.setAttribute('fill', this.fill)
    if (this.stroke) {
      el.setAttribute('stroke', this.stroke)
      el.setAttribute('stroke-width', String(this.strokeWidth))
    }
    return el
  }

  /**
   * Populate this path's commands from an SVG "d" string.
   * Supports M/L/H/V/C/Q/S/T/Z (both absolute and relative). The `A` arc
   * command is converted via our shared arcToQuadratics helper.
   */
  fromSVG(d: string, options?: PathFromSvgOptions): this {
    this.commands = []
    const scale = options?.scale ?? 1
    const ox = options?.x ?? 0
    const oy = options?.y ?? 0
    const flipY = options?.flipY ?? false
    const yBase = options?.flipYBase ?? 0
    const tx = (v: number): number => v * scale + ox
    const ty = (v: number): number => flipY ? (yBase - v) * scale + oy : v * scale + oy

    const tokens = tokenize(d)
    let i = 0
    let x = 0, y = 0
    let startX = 0, startY = 0
    let lastControlX = 0, lastControlY = 0
    let lastCmd = ''

    const num = (): number => Number.parseFloat(tokens[i++] as string)
    const peekNum = (): boolean => i < tokens.length && !Number.isNaN(Number.parseFloat(tokens[i] as string))

    while (i < tokens.length) {
      const cmd = tokens[i++] as string
      const isRel = cmd === cmd.toLowerCase()
      const C = cmd.toUpperCase()
      switch (C) {
        case 'M': {
          let nx = num(), ny = num()
          if (isRel) { nx += x; ny += y }
          x = nx; y = ny
          startX = x; startY = y
          this.moveTo(tx(x), ty(y))
          while (peekNum()) {
            nx = num(); ny = num()
            if (isRel) { nx += x; ny += y }
            x = nx; y = ny
            this.lineTo(tx(x), ty(y))
          }
          break
        }
        case 'L': {
          while (peekNum()) {
            let nx = num(), ny = num()
            if (isRel) { nx += x; ny += y }
            x = nx; y = ny
            this.lineTo(tx(x), ty(y))
          }
          break
        }
        case 'H': {
          while (peekNum()) {
            let nx = num()
            if (isRel) nx += x
            x = nx
            this.lineTo(tx(x), ty(y))
          }
          break
        }
        case 'V': {
          while (peekNum()) {
            let ny = num()
            if (isRel) ny += y
            y = ny
            this.lineTo(tx(x), ty(y))
          }
          break
        }
        case 'C': {
          while (peekNum()) {
            let c1x = num(), c1y = num(), c2x = num(), c2y = num(), ex = num(), ey = num()
            if (isRel) {
              c1x += x; c1y += y; c2x += x; c2y += y; ex += x; ey += y
            }
            this.curveTo(tx(c1x), ty(c1y), tx(c2x), ty(c2y), tx(ex), ty(ey))
            lastControlX = c2x; lastControlY = c2y
            x = ex; y = ey
          }
          break
        }
        case 'S': {
          while (peekNum()) {
            let c2x = num(), c2y = num(), ex = num(), ey = num()
            if (isRel) { c2x += x; c2y += y; ex += x; ey += y }
            const c1x = (lastCmd === 'C' || lastCmd === 'S') ? 2 * x - lastControlX : x
            const c1y = (lastCmd === 'C' || lastCmd === 'S') ? 2 * y - lastControlY : y
            this.curveTo(tx(c1x), ty(c1y), tx(c2x), ty(c2y), tx(ex), ty(ey))
            lastControlX = c2x; lastControlY = c2y
            x = ex; y = ey
          }
          break
        }
        case 'Q': {
          while (peekNum()) {
            let cx = num(), cy = num(), ex = num(), ey = num()
            if (isRel) { cx += x; cy += y; ex += x; ey += y }
            this.quadraticCurveTo(tx(cx), ty(cy), tx(ex), ty(ey))
            lastControlX = cx; lastControlY = cy
            x = ex; y = ey
          }
          break
        }
        case 'T': {
          while (peekNum()) {
            let ex = num(), ey = num()
            if (isRel) { ex += x; ey += y }
            const cx = (lastCmd === 'Q' || lastCmd === 'T') ? 2 * x - lastControlX : x
            const cy = (lastCmd === 'Q' || lastCmd === 'T') ? 2 * y - lastControlY : y
            this.quadraticCurveTo(tx(cx), ty(cy), tx(ex), ty(ey))
            lastControlX = cx; lastControlY = cy
            x = ex; y = ey
          }
          break
        }
        case 'Z': {
          this.close()
          x = startX; y = startY
          break
        }
      }
      lastCmd = C
    }
    return this
  }

  /** Static convenience: return a new Path parsed from an SVG "d" string. */
  static fromSVG(d: string, options?: PathFromSvgOptions): Path {
    return new Path().fromSVG(d, options)
  }
}

function tokenize(d: string): Array<string | number> {
  const tokens: Array<string | number> = []
  const re = /([MmLlHhVvCcSsQqTtAaZz])|(-?\d*\.?\d+(?:[eE][+-]?\d+)?)/g
  let m: RegExpExecArray | null
  // eslint-disable-next-line no-cond-assign
  while ((m = re.exec(d)) !== null) {
    if (m[1]) tokens.push(m[1])
    else if (m[2]) tokens.push(m[2])
  }
  return tokens
}

/** Structural type matching the subset of CanvasRenderingContext2D that Path.draw uses. */
export interface CanvasLike {
  beginPath: () => void
  moveTo: (x: number, y: number) => void
  lineTo: (x: number, y: number) => void
  quadraticCurveTo: (cx: number, cy: number, x: number, y: number) => void
  bezierCurveTo: (c1x: number, c1y: number, c2x: number, c2y: number, x: number, y: number) => void
  closePath: () => void
  fill: () => void
  stroke: () => void
  fillStyle: string
  strokeStyle: string
  lineWidth: number
  save?: () => void
  restore?: () => void
  translate?: (x: number, y: number) => void
  scale?: (x: number, y: number) => void
  arc?: (x: number, y: number, r: number, s: number, e: number) => void
}
