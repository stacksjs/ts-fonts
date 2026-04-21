import type { FontEditorConfig } from './types'
import { loadConfig } from 'bunfig'

export const defaultConfig: FontEditorConfig = {
  verbose: true,
  defaultFontType: 'ttf',
  writeOptions: {},
  readOptions: {},
}

let _config: FontEditorConfig | null = null

export async function getConfig(): Promise<FontEditorConfig> {
  if (!_config) {
    _config = await loadConfig({
      name: 'font-editor',
      defaultConfig,
    })
  }
  return _config
}

export function resetConfig(): void {
  _config = null
}

export function defineConfig(config: Partial<FontEditorConfig>): Partial<FontEditorConfig> {
  return config
}

export const config: FontEditorConfig = defaultConfig
