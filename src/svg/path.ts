import type { Contour, Glyph } from '../types'
import { arcToQuadratics } from './arc'

/**
 * Convert a glyph's contours to an SVG path string.
 * Flips Y axis (SVG uses top-left origin).
 */
export function contours2svg(contours: Contour[], flipY = true, unitsPerEm = 1024): string {
  const parts: string[] = []
  for (const contour of contours) {
    if (contour.length === 0) continue
    const y = (v: number) => flipY ? (unitsPerEm - v) : v

    // Start at first on-curve point if present, else at first point
    let startIdx = 0
    for (let i = 0; i < contour.length; i++) {
      if (contour[i].onCurve !== false) {
        startIdx = i
        break
      }
    }

    parts.push(`M${contour[startIdx].x} ${y(contour[startIdx].y)}`)

    const n = contour.length
    for (let i = 1; i <= n; i++) {
      const curr = contour[(startIdx + i) % n]
      const prev = contour[(startIdx + i - 1) % n]
      const currOn = curr.onCurve !== false
      const prevOn = prev.onCurve !== false

      if (currOn && prevOn) {
        parts.push(`L${curr.x} ${y(curr.y)}`)
      }
      else if (!currOn && prevOn) {
        // Off-curve after on-curve → start of quadratic; look ahead for end point
        const next = contour[(startIdx + i + 1) % n]
        const nextOn = next.onCurve !== false
        let endX: number, endY: number
        if (nextOn) {
          endX = next.x; endY = next.y
          i++
        }
        else {
          endX = (curr.x + next.x) / 2
          endY = (curr.y + next.y) / 2
        }
        parts.push(`Q${curr.x} ${y(curr.y)} ${endX} ${y(endY)}`)
      }
      else if (!currOn && !prevOn) {
        // Implied on-curve between two off-curves — continue quadratic
        const next = contour[(startIdx + i + 1) % n]
        const nextOn = next.onCurve !== false
        let endX: number, endY: number
        if (nextOn) {
          endX = next.x; endY = next.y
          i++
        }
        else {
          endX = (curr.x + next.x) / 2
          endY = (curr.y + next.y) / 2
        }
        parts.push(`Q${curr.x} ${y(curr.y)} ${endX} ${y(endY)}`)
      }
    }
    parts.push('Z')
  }
  return parts.join('')
}

export function glyph2svg(glyph: Glyph, unitsPerEm = 1024): string {
  if (!glyph.contours) return ''
  return contours2svg(glyph.contours, true, unitsPerEm)
}

/**
 * Parse an SVG path "d" string to a list of contours.
 * Supports M, L, H, V, Z, Q, T, C, S commands (absolute + relative).
 * Cubic curves are approximated by a single quadratic.
 */
export function path2contours(d: string, flipY = true, unitsPerEm = 1024): Contour[] {
  const tokens = tokenize(d)
  const contours: Contour[] = []
  let current: Contour = []
  let x = 0, y = 0
  let startX = 0, startY = 0
  let i = 0
  let lastControlX = 0, lastControlY = 0
  let lastCommand = ''

  const flip = (v: number): number => flipY ? unitsPerEm - v : v

  while (i < tokens.length) {
    const cmd = tokens[i++] as string
    const isRelative = cmd === cmd.toLowerCase()
    const command = cmd.toUpperCase()

    const num = (): number => Number.parseFloat(tokens[i++] as string)

    switch (command) {
      case 'M': {
        if (current.length > 0) contours.push(current)
        current = []
        let nx = num(), ny = num()
        if (isRelative) { nx += x; ny += y }
        x = nx; y = ny
        startX = x; startY = y
        current.push({ x, y: flip(y), onCurve: true })
        // Subsequent pairs treated as L
        while (i < tokens.length && !Number.isNaN(Number.parseFloat(tokens[i] as string))) {
          let lx = num(), ly = num()
          if (isRelative) { lx += x; ly += y }
          x = lx; y = ly
          current.push({ x, y: flip(y), onCurve: true })
        }
        break
      }
      case 'L': {
        while (i < tokens.length && !Number.isNaN(Number.parseFloat(tokens[i] as string))) {
          let lx = num(), ly = num()
          if (isRelative) { lx += x; ly += y }
          x = lx; y = ly
          current.push({ x, y: flip(y), onCurve: true })
        }
        break
      }
      case 'H': {
        while (i < tokens.length && !Number.isNaN(Number.parseFloat(tokens[i] as string))) {
          let lx = num()
          if (isRelative) lx += x
          x = lx
          current.push({ x, y: flip(y), onCurve: true })
        }
        break
      }
      case 'V': {
        while (i < tokens.length && !Number.isNaN(Number.parseFloat(tokens[i] as string))) {
          let ly = num()
          if (isRelative) ly += y
          y = ly
          current.push({ x, y: flip(y), onCurve: true })
        }
        break
      }
      case 'Q': {
        while (i < tokens.length && !Number.isNaN(Number.parseFloat(tokens[i] as string))) {
          let cx = num(), cy = num(), ex = num(), ey = num()
          if (isRelative) { cx += x; cy += y; ex += x; ey += y }
          current.push({ x: cx, y: flip(cy), onCurve: false })
          current.push({ x: ex, y: flip(ey), onCurve: true })
          lastControlX = cx; lastControlY = cy
          x = ex; y = ey
        }
        break
      }
      case 'T': {
        while (i < tokens.length && !Number.isNaN(Number.parseFloat(tokens[i] as string))) {
          let ex = num(), ey = num()
          if (isRelative) { ex += x; ey += y }
          const cx = lastCommand === 'Q' || lastCommand === 'T' ? 2 * x - lastControlX : x
          const cy = lastCommand === 'Q' || lastCommand === 'T' ? 2 * y - lastControlY : y
          current.push({ x: cx, y: flip(cy), onCurve: false })
          current.push({ x: ex, y: flip(ey), onCurve: true })
          lastControlX = cx; lastControlY = cy
          x = ex; y = ey
        }
        break
      }
      case 'C': {
        // Cubic → approximate as a single quadratic (lossy but acceptable for TT)
        while (i < tokens.length && !Number.isNaN(Number.parseFloat(tokens[i] as string))) {
          let c1x = num(), c1y = num(), c2x = num(), c2y = num(), ex = num(), ey = num()
          if (isRelative) {
            c1x += x; c1y += y
            c2x += x; c2y += y
            ex += x; ey += y
          }
          // Approximate control: average of the two cubic controls
          const cx = (3 * c1x - x + 3 * c2x - ex) / 4
          const cy = (3 * c1y - y + 3 * c2y - ey) / 4
          current.push({ x: cx, y: flip(cy), onCurve: false })
          current.push({ x: ex, y: flip(ey), onCurve: true })
          lastControlX = c2x; lastControlY = c2y
          x = ex; y = ey
        }
        break
      }
      case 'S': {
        while (i < tokens.length && !Number.isNaN(Number.parseFloat(tokens[i] as string))) {
          let c2x = num(), c2y = num(), ex = num(), ey = num()
          if (isRelative) { c2x += x; c2y += y; ex += x; ey += y }
          const c1x = lastCommand === 'C' || lastCommand === 'S' ? 2 * x - lastControlX : x
          const c1y = lastCommand === 'C' || lastCommand === 'S' ? 2 * y - lastControlY : y
          const cx = (3 * c1x - x + 3 * c2x - ex) / 4
          const cy = (3 * c1y - y + 3 * c2y - ey) / 4
          current.push({ x: cx, y: flip(cy), onCurve: false })
          current.push({ x: ex, y: flip(ey), onCurve: true })
          lastControlX = c2x; lastControlY = c2y
          x = ex; y = ey
        }
        break
      }
      case 'A': {
        while (i + 6 < tokens.length && !Number.isNaN(Number.parseFloat(tokens[i] as string))) {
          const rx = num()
          const ry = num()
          const xRot = num()
          const largeArc = num() !== 0
          const sweep = num() !== 0
          let ex = num(), ey = num()
          if (isRelative) { ex += x; ey += y }
          const quads = arcToQuadratics(x, y, rx, ry, xRot, largeArc, sweep, ex, ey)
          for (const pt of quads)
            current.push({ x: pt.x, y: flip(pt.y), onCurve: pt.onCurve })
          x = ex; y = ey
        }
        break
      }
      case 'Z': {
        x = startX; y = startY
        if (current.length > 0) contours.push(current)
        current = []
        break
      }
    }
    lastCommand = command
  }
  if (current.length > 0) contours.push(current)
  return contours
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
