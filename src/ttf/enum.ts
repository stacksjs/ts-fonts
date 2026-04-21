export const GlyphFlag = {
  ONCURVE: 0x01,
  XSHORT: 0x02,
  YSHORT: 0x04,
  REPEAT: 0x08,
  XSAME: 0x10,
  YSAME: 0x20,
} as const

export const ComponentFlag = {
  ARG_1_AND_2_ARE_WORDS: 0x0001,
  ARGS_ARE_XY_VALUES: 0x0002,
  ROUND_XY_TO_GRID: 0x0004,
  WE_HAVE_A_SCALE: 0x0008,
  MORE_COMPONENTS: 0x0020,
  WE_HAVE_AN_X_AND_Y_SCALE: 0x0040,
  WE_HAVE_A_TWO_BY_TWO: 0x0080,
  WE_HAVE_INSTRUCTIONS: 0x0100,
  USE_MY_METRICS: 0x0200,
  OVERLAP_COMPOUND: 0x0400,
  SCALED_COMPONENT_OFFSET: 0x0800,
  UNSCALED_COMPONENT_OFFSET: 0x1000,
} as const

export const NameID = {
  COPYRIGHT: 0,
  FONT_FAMILY: 1,
  FONT_SUB_FAMILY: 2,
  UNIQUE_SUB_FAMILY: 3,
  FULL_NAME: 4,
  VERSION: 5,
  POST_SCRIPT_NAME: 6,
  TRADEMARK: 7,
  MANUFACTURER: 8,
  DESIGNER: 9,
  DESCRIPTION: 10,
  VENDOR_URL: 11,
  DESIGNER_URL: 12,
  LICENSE: 13,
  LICENSE_URL: 14,
  PREFERRED_FAMILY: 16,
  PREFERRED_SUB_FAMILY: 17,
  COMPATIBLE_FULL: 18,
  SAMPLE_TEXT: 19,
  POST_SCRIPT_CID_FIND_FONT_NAME: 20,
  WWS_FAMILY_NAME: 21,
  WWS_SUB_FAMILY_NAME: 22,
} as const

export const NAME_ID_TO_KEY: Record<number, string> = {
  0: 'copyright',
  1: 'fontFamily',
  2: 'fontSubFamily',
  3: 'uniqueSubFamily',
  4: 'fullName',
  5: 'version',
  6: 'postScriptName',
  7: 'trademark',
  8: 'manufacturer',
  9: 'designer',
  10: 'description',
  11: 'vendorURL',
  12: 'designerURL',
  13: 'license',
  14: 'licenseURL',
  16: 'preferredFamily',
  17: 'preferredSubFamily',
  18: 'compatibleFull',
  19: 'sampleText',
}

export const KEY_TO_NAME_ID: Record<string, number> = Object.fromEntries(
  Object.entries(NAME_ID_TO_KEY).map(([k, v]) => [v, Number(k)]),
)

export const MAGIC_NUMBER = 0x5F0F3CF5
export const CHECKSUM_MAGIC = 0xB1B0AFBA
export const WOFF_SIGNATURE = 0x774F4646
export const WOFF2_SIGNATURE = 0x774F4632
export const EOT_MAGIC_NUMBER = 0x504C
export const SFNT_VERSION_TTF = 0x00010000
export const SFNT_VERSION_OTF = 0x4F54544F
export const SFNT_VERSION_TRUE = 0x74727565
