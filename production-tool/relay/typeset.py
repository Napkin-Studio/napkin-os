"""Type layers drawn over a size (features/campaign-formats.clan, phase 3): the brand line, the logo,
supers and legal, laid out per format by the web's one layout function (web/src/campaign/layout.ts)
and drawn here with Pillow. Words and the logo are never sent to a model.

The font is Pillow's own scalable default (FreeType); the Brand board's font family is the web's to
show on the tile, and a licensed font file joins once the Brand board carries one. Each line of words
is wrapped to its box and shrunk until it fits, so a long OOH line never runs outside its box.
"""

from __future__ import annotations

import io
from typing import Callable, Optional

from PIL import Image, ImageDraw, ImageFont

CAP = 0.72        # cap height as a share of the font size (the layout gives a cap height)
MIN_PX = 6        # never smaller than this
LEADING = 1.18


def _font(px: int) -> ImageFont.FreeTypeFont | ImageFont.ImageFont:
    return ImageFont.load_default(size=max(MIN_PX, px))


def _hex(c: Optional[str], default: tuple[int, int, int]) -> tuple[int, int, int]:
    if not c or len(c) != 7:
        return default
    return int(c[1:3], 16), int(c[3:5], 16), int(c[5:7], 16)


def wrap(text: str, font, width: float, draw: ImageDraw.ImageDraw, stroke: int = 0) -> list[str]:
    """Words into lines no wider than `width` (a single word wider than it stays on its own line)."""
    lines: list[str] = []
    for para in text.split("\n"):
        line = ""
        for word in para.split():
            trial = f"{line} {word}".strip()
            if not line or draw.textlength(trial, font=font) + 2 * stroke <= width:
                line = trial
            else:
                lines.append(line)
                line = word
        lines.append(line)
    return [ln for ln in lines if ln] or [""]


def fit(text: str, box: tuple[int, int, int, int], want_px: int, draw: ImageDraw.ImageDraw, bold: bool):
    """The font size (shrunk from want_px) and the lines that fit the box."""
    x0, y0, x1, y1 = box
    px = max(MIN_PX, want_px)
    while True:
        font = _font(px)
        stroke = max(0, round(px * 0.04)) if bold else 0
        lines = wrap(text, font, x1 - x0, draw, stroke)
        widest = max(draw.textlength(ln, font=font) + 2 * stroke for ln in lines)
        tall = len(lines) * px * LEADING
        if (widest <= (x1 - x0) and tall <= (y1 - y0)) or px <= MIN_PX:
            return font, px, lines, stroke
        px = max(MIN_PX, int(px * 0.9))


def draw(img: Image.Image, layers: list[dict], fetch: Optional[Callable[[str], bytes]] = None) -> int:
    """Draw each layer on `img` in place; returns how many were drawn."""
    w, h = img.size
    d = ImageDraw.Draw(img)
    drawn = 0
    for layer in layers:
        b = layer["box"]
        box = (round(b["x"] * w), round(b["y"] * h), round((b["x"] + b["w"]) * w), round((b["y"] + b["h"]) * h))
        if box[2] - box[0] < 2 or box[3] - box[1] < 2:
            continue
        if layer["kind"] == "logo":
            src = (layer.get("image") or {}).get("url")
            if not src or fetch is None:
                continue
            try:
                logo = Image.open(io.BytesIO(fetch(src)))
                logo.load()
            except Exception:
                continue
            logo = logo.convert("RGBA")
            s = min((box[2] - box[0]) / logo.width, (box[3] - box[1]) / logo.height)
            lw, lh = max(1, int(logo.width * s)), max(1, int(logo.height * s))
            logo = logo.resize((lw, lh), Image.LANCZOS)
            ax = {"left": box[0], "right": box[2] - lw}.get(layer.get("align") or "centre", box[0] + (box[2] - box[0] - lw) // 2)
            img.paste(logo, (ax, box[1] + (box[3] - box[1] - lh) // 2), logo)
            drawn += 1
            continue
        text = (layer.get("text") or "").strip()
        if not text:
            continue
        want = round((layer.get("sizeFrac") or 0.04) * h / CAP)
        bold = layer.get("weight") == "bold"
        font, px, lines, stroke = fit(text, box, want, d, bold)
        colour = _hex(layer.get("colour"), (255, 255, 255))
        line_h = px * LEADING
        top = box[1] + (box[3] - box[1] - line_h * len(lines)) / 2
        if layer.get("plate"):
            pad = round(px * 0.35)
            widest = max(d.textlength(ln, font=font) for ln in lines)
            align = layer.get("align") or "centre"
            px0 = box[0] if align == "left" else box[2] - widest if align == "right" else box[0] + (box[2] - box[0] - widest) / 2
            d.rectangle((px0 - pad, top - pad, px0 + widest + pad, top + line_h * len(lines) + pad), fill=_hex(layer["plate"], (0, 0, 0)))
        for i, ln in enumerate(lines):
            lw = d.textlength(ln, font=font)
            align = layer.get("align") or "centre"
            x = box[0] if align == "left" else box[2] - lw if align == "right" else box[0] + (box[2] - box[0] - lw) / 2
            d.text((x, top + i * line_h), ln, font=font, fill=colour, stroke_width=stroke, stroke_fill=colour)
        drawn += 1
    return drawn
