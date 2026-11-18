# Vendored fonts (deck-look)

| Family | File | Licence | Source |
|---|---|---|---|
| Archivo (Omnibus-Type) | `Archivo/Archivo[wdth,wght].ttf` | SIL Open Font License 1.1 (`Archivo/OFL.txt`) | https://github.com/google/fonts/tree/7af0d90b4d532ffa4b041937b560c6df4e7b1e95/ofl/archivo |
| Source Sans 3 (Adobe) | `SourceSans3/SourceSans3[wght].ttf` | SIL Open Font License 1.1 (`SourceSans3/OFL.txt`) | https://github.com/google/fonts/tree/7af0d90b4d532ffa4b041937b560c6df4e7b1e95/ofl/sourcesans3 |

Fetched 2026-11-18 from the google/fonts repository at the commit above, byte for byte. The files are **unmodified**: Source Sans 3
reserves the name "Source", so no static instances are cut from it. They are variable fonts (weight, and width for Archivo).

- `widths.json`: average glyph widths (measured by `measure_widths.py`, which needs fontTools) of both fonts and of Arial, the
  fallback. `theme.fit_wf` fits text under the wider of a font and its fallback.
- The pptx names the fonts; it does **not** embed them. A machine without them substitutes Arial, which fit is checked against.
- LibreOffice 7.4 on macOS does not read a profile fonts folder: install both files (Font Book or `~/Library/Fonts`) on the machine
  that renders PDFs and PNGs. `run_deck.to_pdf` also copies them into its private profile for LibreOffice versions that read it.
