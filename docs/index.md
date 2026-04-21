---
layout: home

hero:
  name: "ts-font-editor"
  text: "Fully-typed font editor for TypeScript."
  tagline: "Read, write, convert, and transform TTF / OTF / WOFF / WOFF2 / EOT / SVG — with variable-font support."
  actions:
    - theme: brand
      text: Get Started
      link: /intro
    - theme: alt
      text: Variable fonts
      link: /variable-fonts

features:
  - title: "SFNT Parser & Writer"
    icon: "🔤"
    details: "Faithful TTF round-trip: glyf, cmap, hmtx, post format 2, REPEAT flag compression, checksum."
  - title: "OTF → TTF"
    icon: "✏️"
    details: "Full CFF Type 2 charstring interpreter with cubic-to-quadratic bezier conversion."
  - title: "WOFF / WOFF2 / EOT / SVG"
    icon: "🌐"
    details: "Convert freely between formats. WOFF2 via pluggable WASM. SVG in both font and raw-icon flavors."
  - title: "Variable Fonts"
    icon: "🎛"
    details: "Parse fvar / avar / STAT / gvar with delta interpolation. Create static instances and build VFs from masters."
  - title: "Graphics Utilities"
    icon: "📐"
    details: "Affine transforms, path reducers, bounding-box (on-curve and curve-aware), SVG path parser with arc support."
  - title: "Zero-Config"
    icon: "⚙️"
    details: "Auto-loads font-editor.config.ts via bunfig. Ships a CLI: font-editor convert / inspect."
---

<Home />
