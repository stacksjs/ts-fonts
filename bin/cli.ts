import { readFileSync, writeFileSync } from 'node:fs'
import { CLI } from '@stacksjs/clapp'
import { version } from '../package.json'
import { optimizettf } from '../src/util/glyph-ops'
import { validateTTF } from '../src/util/validate'
import { createFont } from '../src/ttf/font'
import { listAxes, listNamedInstances } from '../src/variable/instance'
import { parseCollection } from '../src/ot/parse'
import { disassemble } from '../src/util/hinting'

const cli = new CLI('font-editor')

interface ConvertOptions {
  from?: string
  to?: string
  input: string
  output?: string
  subset?: string
  kerning?: boolean
  hinting?: boolean
}

interface SubsetOptions {
  output?: string
  unicodes?: string
  text?: string
  kerning?: boolean
  hinting?: boolean
}

interface InstanceCliOptions {
  output?: string
  axis?: string | string[]
}

interface OptimizeCliOptions {
  output?: string
}

function readBuffer(input: string): { buffer: ArrayBuffer, text: string } {
  const raw = readFileSync(input)
  const buffer = raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength) as ArrayBuffer
  return { buffer, text: raw.toString('utf8') }
}

function inferType(filename: string): 'ttf' | 'otf' | 'woff' | 'woff2' | 'eot' | 'svg' {
  const ext = filename.toLowerCase().split('.').pop() ?? ''
  if (ext === 'ttf' || ext === 'otf' || ext === 'woff' || ext === 'woff2' || ext === 'eot' || ext === 'svg')
    return ext as 'ttf'
  return 'ttf'
}

cli
  .command('convert <input>', 'Convert a font file between formats')
  .option('--from <type>', 'Source type (ttf, otf, woff, woff2, eot, svg); inferred from extension')
  .option('--to <type>', 'Target type (ttf, woff, woff2, eot, svg)')
  .option('-o, --output <path>', 'Output path; inferred from --to if omitted')
  .option('--subset <codes>', 'Comma-separated unicode code points to subset, e.g. 65,66,67')
  .option('--kerning', 'Preserve kerning table')
  .option('--hinting', 'Preserve hinting tables')
  .example('font-editor convert input.ttf --to woff2 -o out.woff2')
  .action(async (input: string, options: ConvertOptions) => {
    const fromType = (options.from ?? inferType(input)) as 'ttf' | 'otf' | 'woff' | 'woff2' | 'eot' | 'svg'
    const toType = (options.to ?? 'ttf') as 'ttf' | 'woff' | 'woff2' | 'eot' | 'svg'
    const outputPath = options.output ?? `out.${toType}`

    const { buffer, text } = readBuffer(input)
    const subset = options.subset ? options.subset.split(',').map(s => Number.parseInt(s.trim(), 10)) : undefined
    const font = createFont(fromType === 'svg' ? text : buffer, {
      type: fromType,
      subset,
      kerning: options.kerning,
      hinting: options.hinting,
    })

    const result = font.write({ type: toType, toBuffer: false })
    if (typeof result === 'string') writeFileSync(outputPath, result, 'utf8')
    else writeFileSync(outputPath, new Uint8Array(result as ArrayBuffer))
    console.log(`Wrote ${outputPath}`)
  })

cli
  .command('subset <input>', 'Subset a font to specific unicodes or a text string')
  .option('-o, --output <path>', 'Output path')
  .option('--unicodes <codes>', 'Comma-separated unicode code points (e.g. 65,66,67)')
  .option('--text <string>', 'Keep only glyphs needed to render this text')
  .option('--kerning', 'Preserve kerning tables')
  .option('--hinting', 'Preserve hinting tables')
  .example('font-editor subset Inter.ttf --text "Hello world" -o hello.ttf')
  .action(async (input: string, options: SubsetOptions) => {
    const outputPath = options.output ?? `subset-${input.split('/').pop() ?? 'out.ttf'}`
    const { buffer } = readBuffer(input)

    let codes: number[]
    if (options.unicodes) {
      codes = options.unicodes.split(',').map(s => Number.parseInt(s.trim(), 10))
    }
    else if (options.text) {
      codes = Array.from(options.text, ch => ch.codePointAt(0) ?? 0)
    }
    else {
      console.error('Provide either --unicodes or --text')
      process.exit(1)
    }

    const font = createFont(buffer, {
      type: inferType(input) as 'ttf',
      subset: codes,
      kerning: options.kerning,
      hinting: options.hinting,
    })
    const result = font.write({ type: 'ttf', toBuffer: false }) as ArrayBuffer
    writeFileSync(outputPath, new Uint8Array(result))
    console.log(`Wrote ${outputPath} (${result.byteLength} bytes, ${font.get().glyf.length} glyphs)`)
  })

cli
  .command('instance <input>', 'Create a static instance from a variable font')
  .option('-o, --output <path>', 'Output path')
  .option('--axis <spec...>', 'Axis value (repeat for each, e.g. --axis wght=700 --axis wdth=100)')
  .example('font-editor instance Inter-VF.ttf --axis wght=700 --axis slnt=-10 -o bold.ttf')
  .action(async (input: string, options: InstanceCliOptions) => {
    const outputPath = options.output ?? `instance-${input.split('/').pop() ?? 'out.ttf'}`
    const { buffer } = readBuffer(input)
    const font = createFont(buffer, { type: inferType(input) as 'ttf' })
    if (!font.isVariable()) {
      console.error('Font is not a variable font (no fvar table).')
      process.exit(1)
    }
    const axisSpecs = Array.isArray(options.axis) ? options.axis : options.axis ? [options.axis] : []
    const coordinates: Record<string, number> = {}
    for (const spec of axisSpecs) {
      const [tag, v] = spec.split('=')
      coordinates[tag.trim()] = Number.parseFloat(v)
    }
    const instance = font.createInstance({ coordinates, updateName: true })
    const result = instance.write({ type: 'ttf', toBuffer: false }) as ArrayBuffer
    writeFileSync(outputPath, new Uint8Array(result))
    console.log(`Wrote ${outputPath} (${result.byteLength} bytes)`)
  })

cli
  .command('optimize <input>', 'Reduce redundant points and round coordinates')
  .option('-o, --output <path>', 'Output path')
  .action(async (input: string, options: OptimizeCliOptions) => {
    const outputPath = options.output ?? `opt-${input.split('/').pop() ?? 'out.ttf'}`
    const { buffer } = readBuffer(input)
    const font = createFont(buffer, { type: inferType(input) as 'ttf' })
    const ttf = font.get()
    const result = optimizettf(ttf)
    if (result !== true) {
      console.warn('Duplicate unicodes detected:', result)
    }
    const buf = font.write({ type: 'ttf', toBuffer: false }) as ArrayBuffer
    writeFileSync(outputPath, new Uint8Array(buf))
    console.log(`Wrote ${outputPath} (${buf.byteLength} bytes)`)
  })

cli
  .command('validate <input>', 'Report structural warnings/errors for a font')
  .action(async (input: string) => {
    const { buffer } = readBuffer(input)
    const font = createFont(buffer, { type: inferType(input) as 'ttf' })
    const warnings = validateTTF(font.get())
    if (warnings.length === 0) {
      console.log('✓ No issues detected')
      return
    }
    for (const w of warnings) {
      const prefix = w.severity === 'error' ? '✗' : '⚠'
      console.log(`${prefix} [${w.field}] ${w.message}`)
    }
  })

cli
  .command('collection <input>', 'List sub-fonts in a TTC (.ttc) collection')
  .action(async (input: string) => {
    const { buffer } = readBuffer(input)
    const fonts = parseCollection(buffer)
    console.log(`${fonts.length} sub-font${fonts.length === 1 ? '' : 's'}:`)
    fonts.forEach((f, i) => {
      console.log(`  [${i}] ${f.familyName} ${f.styleName} — ${f.numGlyphs} glyphs, units/em=${f.unitsPerEm}`)
    })
  })

cli
  .command('disasm <input>', 'Disassemble TrueType hinting instructions (fpgm/prep)')
  .option('--table <name>', 'Which table to disassemble: fpgm | prep | cvt', { default: 'fpgm' })
  .action(async (input: string, options: { table?: string }) => {
    const { buffer } = readBuffer(input)
    const font = createFont(buffer, { type: inferType(input) as 'ttf', hinting: true })
    const ttf = font.get()
    const tableName = options.table ?? 'fpgm'
    const bc = (ttf as unknown as Record<string, number[] | undefined>)[tableName]
    if (!bc) {
      console.error(`No ${tableName} table.`)
      process.exit(1)
    }
    for (const line of disassemble(bc))
      console.log(line)
  })

cli
  .command('inspect <input>', 'Print font metadata (name, metrics, axes)')
  .action(async (input: string) => {
    const { buffer, text } = readBuffer(input)
    const type = inferType(input)
    const font = createFont(type === 'svg' ? text : buffer, { type: type as 'ttf' })
    const t = font.get()
    console.log('Font Family :', t.name.fontFamily)
    console.log('Sub Family  :', t.name.fontSubFamily)
    console.log('Version     :', t.name.version)
    console.log('Units per em:', t.head.unitsPerEm)
    console.log('Ascent      :', t.hhea.ascent)
    console.log('Descent     :', t.hhea.descent)
    console.log('Glyph count :', t.glyf.length)
    if (font.isVariable()) {
      console.log('\nVariable font axes:')
      for (const ax of listAxes(t))
        console.log(`  ${ax.tag}: ${ax.minValue} ↔ ${ax.maxValue} (default ${ax.defaultValue})`)
      console.log('\nNamed instances:')
      for (const inst of listNamedInstances(t))
        console.log(`  ${inst.name ?? '(unnamed)'}: ${JSON.stringify(inst.coordinates)}`)
    }
  })

cli.command('version', 'Show the version').action(() => {
  console.log(version)
})

cli.version(version)
cli.help()
cli.parse()
