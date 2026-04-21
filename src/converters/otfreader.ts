import type { TTFObject } from '../types'
import { otf2ttfobject } from './otf2ttfobject'

export interface OTFReaderOptions {
  subset?: number[]
}

export class OTFReader {
  private options: OTFReaderOptions

  constructor(options: OTFReaderOptions = {}) {
    this.options = options
  }

  read(buffer: ArrayBuffer): TTFObject {
    return otf2ttfobject(buffer, this.options)
  }

  dispose(): void {
    this.options = {}
  }
}
