/**
 * Subpath entry: `ts-font-editor/opentype`.
 *
 * This re-exports the opentype.js-compatible API surface under the
 * same names so you can do:
 *
 *   import { parse, Font, Glyph, Path, BoundingBox } from 'ts-font-editor/opentype'
 */
export { Font } from './ttf/font'
export * from './ot'
