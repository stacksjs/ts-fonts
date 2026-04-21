import { dts } from 'bun-plugin-dtsx'

await Bun.build({
  entrypoints: ['src/index.ts', 'src/opentype.ts'],
  outdir: './dist',
  target: 'bun',
  plugins: [dts()],
})
