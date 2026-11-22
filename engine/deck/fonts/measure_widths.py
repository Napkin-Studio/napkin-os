"""Measure average glyph widths of the vendored fonts (and the Arial fallback) and write widths.json.

    python3 engine/deck/fonts/measure_widths.py            # rewrite widths.json
    python3 engine/deck/fonts/measure_widths.py --check    # exit 1 when widths.json no longer matches the font files

Widths are the average advance of a character, as a fraction of the font size, over a fixed English sample
(mixed case, spaces counted) and over the same sample in capitals. Variable fonts are instanced in memory at the
weight asked (400 or 700); the files are never modified (the Source family reserves its name). The fallback
factors come from Arial, the font a machine without the vendored fonts substitutes; ``render_pptx`` fits text
under the wider of a font and its fallback, so a deck fits whichever one draws it.
Needs fontTools (a dev-time tool; the renderer reads widths.json only).
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
SAMPLE = ("Every drop has a story. The real question is how to make the tap feel personal. Households who never think "
          "about the tap are loved and ignored in the same breath. We will measure what changes, by how much and by when. "
          "Five per cent more households choose to save water within twelve months of the campaign launching nationally.")
FONTS = {   # name -> (file, family it falls back to)
    "Archivo": ("Archivo/Archivo[wdth,wght].ttf", "Arial"),
    "Source Sans 3": ("SourceSans3/SourceSans3[wght].ttf", "Arial"),
}
ARIAL = ("/System/Library/Fonts/Supplemental/Arial.ttf", "/System/Library/Fonts/Supplemental/Arial Bold.ttf")


def _avg(font, text: str) -> float:
    cmap, hmtx, upm = font.getBestCmap(), font["hmtx"], font["head"].unitsPerEm
    return sum(hmtx[cmap[ord(c)]][0] for c in text) / len(text) / upm


def _instance(path: Path, wght: int):
    from fontTools.ttLib import TTFont
    from fontTools.varLib import instancer
    f = TTFont(str(path))
    axes = {"wght": wght}
    if "wdth" in {a.axisTag for a in f["fvar"].axes}:
        axes["wdth"] = 100
    return instancer.instantiateVariableFont(f, axes)


def measure() -> dict:
    from fontTools.ttLib import TTFont
    out = {"sample": SAMPLE, "fonts": {}}
    for name, (rel, fb) in FONTS.items():
        row = {}
        for label, w in (("regular", 400), ("bold", 700)):
            f = _instance(HERE / rel, w)
            row[label] = {"mixed": round(_avg(f, SAMPLE), 4), "caps": round(_avg(f, SAMPLE.upper()), 4)}
        out["fonts"][name] = {"file": rel, "fallback": fb, **row}
    arial = {}
    for label, p in zip(("regular", "bold"), ARIAL):
        f = TTFont(p)
        arial[label] = {"mixed": round(_avg(f, SAMPLE), 4), "caps": round(_avg(f, SAMPLE.upper()), 4)}
    out["fonts"]["Arial"] = {"file": "(system)", **arial}
    return out


if __name__ == "__main__":
    new = measure()
    target = HERE / "widths.json"
    if "--check" in sys.argv:
        old = json.loads(target.read_text())
        sys.exit(0 if old == new else 1)
    target.write_text(json.dumps(new, indent=1) + "\n")
    print(json.dumps(new["fonts"], indent=1))
