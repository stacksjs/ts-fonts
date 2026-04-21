import type { Contour } from '../types'
import { computePathBox } from './bounding-box'
import { pathRotate } from './path-transforms'

/**
 * Rotate multiple contours around the centroid of their combined bounding box.
 */
export function rotate(paths: Contour[], angle: number): Contour[] {
  const box = computePathBox(...paths)
  const cx = box.x + box.width / 2
  const cy = box.y + box.height / 2
  for (const path of paths)
    pathRotate(path, angle, cx, cy)
  return paths
}

/** Translate all contours by (dx, dy). */
export function move(paths: Contour[], dx: number, dy: number): Contour[] {
  for (const path of paths) {
    for (const p of path) {
      p.x += dx
      p.y += dy
    }
  }
  return paths
}

/** Mirror contours horizontally across their combined centroid. */
export function mirror(paths: Contour[]): Contour[] {
  const box = computePathBox(...paths)
  const cx = box.x + box.width / 2
  for (const path of paths) {
    for (const p of path)
      p.x = 2 * cx - p.x
    path.reverse()
  }
  return paths
}

/** Flip contours vertically across their combined centroid. */
export function flip(paths: Contour[]): Contour[] {
  const box = computePathBox(...paths)
  const cy = box.y + box.height / 2
  for (const path of paths) {
    for (const p of path)
      p.y = 2 * cy - p.y
    path.reverse()
  }
  return paths
}
