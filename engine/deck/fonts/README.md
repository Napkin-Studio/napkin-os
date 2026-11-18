# Vendored fonts (deck-look)

| Family | Files | Licence | Source |
|---|---|---|---|
| Archivo (Omnibus-Type) | `Archivo/Archivo[wdth,wght].ttf` (variable) | SIL Open Font License 1.1 (`Archivo/OFL.txt`) | https://github.com/google/fonts/tree/7af0d90b4d532ffa4b041937b560c6df4e7b1e95/ofl/archivo |
| Archivo, static | `Archivo/static/Archivo-{Regular,Bold,Italic,BoldItalic}.ttf` | same | https://github.com/Omnibus-Type/Archivo/tree/211127690e8ff106c36c935f7e5e697114cff103/fonts/ttf |
| Source Sans 3 (Adobe) | `SourceSans3/SourceSans3[wght].ttf` (variable) | SIL Open Font License 1.1 (`SourceSans3/OFL.txt`) | https://github.com/google/fonts/tree/7af0d90b4d532ffa4b041937b560c6df4e7b1e95/ofl/sourcesans3 |
| Source Sans 3, static | `SourceSans3/static/SourceSans3-{Regular,Bold,It,BoldIt}.ttf` | same | https://github.com/adobe-fonts/source-sans/releases/tag/3.052R (TTF-source-sans-3.052R.zip) |

Every file is the upstream file, byte for byte and **unmodified** (fetched 2026-11-18): Source Sans 3 reserves the name "Source", so
nothing is cut or renamed here; the static faces are Adobe's and Omnibus-Type's own releases.

**Why both.** The web deck uses the variable files (CSS picks the weight). The pptx, its PDF and PNGs must be drawn from the
**static** faces: LibreOffice and PowerPoint draw a variable font at its default instance, and Source Sans 3's default is ExtraLight
(wght 200). Under the variable file every Source Sans 3 line rendered as a faint hairline (the phase-12 contrast regression: "in 12
months" measured 4.9:1 on the render, the sources line 2.2:1; with the static faces 14.9:1 and 5.8:1). `run_deck.to_pdf` copies only
`*/static/*.ttf` into its LibreOffice profile; `tests/test_look_v3_layouts.py` holds that.

- `widths.json`: average glyph widths (measured by `measure_widths.py`, which needs fontTools) of both fonts and of Arial, the
  fallback. `theme.fit_wf` fits text under the wider of a font and its fallback.
- The pptx names the fonts; it does **not** embed them. A machine without them substitutes Arial, which fit is checked against.
- LibreOffice 7.4 on macOS does not read a profile fonts folder: install the **static** files (Font Book or `~/Library/Fonts`), and
  not the variable ones, on the machine that renders PDFs and PNGs. `run_deck.to_pdf` also copies them into its private profile for
  LibreOffice versions that read it.
