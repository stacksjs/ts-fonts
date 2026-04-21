import type { FontEditorConfig } from './src/types'

const config: FontEditorConfig = {
  verbose: true,
  defaultFontType: 'ttf',
  readOptions: {
    hinting: false,
    kerning: false,
    compound2simple: false,
  },
  writeOptions: {
    hinting: false,
    kerning: false,
  },
}

export default config
