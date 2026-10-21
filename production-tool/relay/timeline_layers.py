"""What the relay draws for a timeline render (features/make-and-edit.clan): each text of the Edit room's
Text row as a transparent PNG, and the person's end card as a PNG, at the film's shape, with typeset.py
(Pillow; no model ever sees the words or the logo). stitch's timeline mode (stitch/timeline.py) scales
them to the film's size and lays them in. Also the plan's own arithmetic, checked before anything runs:
V1 never overlaps, and its length is its last clip's end plus the end card (clan-store compileTimeline)."""

from __future__ import annotations

import io
from typing import Callable, Optional

LONG_SIDE = 1280  # stitch.MAX_SIDE: the PNGs are drawn at the size the film is rendered at
EPS = 1e-3

# Where each text style sits, in 0-1 of the film (the Inspector's Caption, Centre title and Lower third).
STYLE = {
    "caption": {"kind": "captions", "box": {"x": 0.08, "y": 0.80, "w": 0.84, "h": 0.12}, "sizeFrac": 0.04,
                "align": "centre", "weight": "regular", "plate": "#000000"},
    "title": {"kind": "line", "box": {"x": 0.10, "y": 0.38, "w": 0.80, "h": 0.24}, "sizeFrac": 0.08,
              "align": "centre", "weight": "bold"},
    "super": {"kind": "supers", "box": {"x": 0.06, "y": 0.68, "w": 0.62, "h": 0.14}, "sizeFrac": 0.05,
              "align": "left", "weight": "bold"},
}


def film_size(ratio: str | None) -> tuple[int, int]:
    """The film's size for a ratio ("16:9"), its long side LONG_SIDE, even; 16:9 when it has none."""
    try:
        a, b = (float(x) for x in str(ratio or "16:9").split(":"))
    except ValueError:
        a, b = 16.0, 9.0
    if a <= 0 or b <= 0:
        a, b = 16.0, 9.0
    k = LONG_SIDE / max(a, b)
    return max(2, int(a * k) // 2 * 2), max(2, int(b * k) // 2 * 2)


def clip_length(c: dict) -> float:
    return max(0.0, float(c["outS"]) - float(c.get("inS") or 0)) / float(c.get("speed") or 1) + float(c.get("holdS") or 0)


def plan_problem(plan: dict) -> str | None:
    """Why a TimelinePlan cannot be rendered as given, in the person's words, or None."""
    clips = sorted(plan["clips"], key=lambda c: float(c["startS"]))
    end = 0.0
    for c in clips:
        if float(c["outS"]) <= float(c.get("inS") or 0):
            return "A clip in the cut ends before it starts."
        if float(c["startS"]) < end - EPS:
            return "Two clips on the main track overlap; move one so they meet."
        end = float(c["startS"]) + clip_length(c)
    want = end + float((plan.get("endCard") or {}).get("s") or 0)
    if abs(want - float(plan["lengthS"])) > 0.05:
        return f"The cut is {want:g} s long, not the {float(plan['lengthS']):g} s it says. Reload and render again."
    for t in plan.get("texts") or []:
        if float(t["toS"]) <= float(t["fromS"]):
            return "A text ends before it starts."
    return None


def _png(img) -> bytes:
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return buf.getvalue()


def text_png(text: dict, size: tuple[int, int]) -> bytes:
    """One text of the Text row, alone on a transparent PNG at the film's size, in its style's place."""
    from PIL import Image

    import typeset

    img = Image.new("RGBA", size, (0, 0, 0, 0))
    style = STYLE.get(text.get("style") or "caption", STYLE["caption"])
    typeset.draw(img, [{**style, "text": text["words"], "colour": "#FFFFFF"}])
    return _png(img)


def _ink(bg: str) -> str:
    """White words on a dark card, ink on a light one."""
    r, g, b = (int(bg[i:i + 2], 16) for i in (1, 3, 5))
    return "#FFFFFF" if 0.2126 * r + 0.7152 * g + 0.0722 * b < 140 else "#14161B"


def end_card_png(card: dict, size: tuple[int, int], fetch: Optional[Callable[[str], bytes]] = None) -> bytes:
    """The person's end card at the film's size: its colour, the logo, the headline, the line and the call
    to action, stacked in the middle."""
    from PIL import Image

    import typeset

    bg = card["bg"]
    img = Image.new("RGBA", size, tuple(int(bg[i:i + 2], 16) for i in (1, 3, 5)) + (255,))
    ink = _ink(bg)
    layers = []
    if card.get("logo"):
        layers.append({"kind": "logo", "box": {"x": 0.38, "y": 0.14, "w": 0.24, "h": 0.18}, "image": card["logo"], "align": "centre"})
    if card.get("headline"):
        layers.append({"kind": "line", "box": {"x": 0.08, "y": 0.34, "w": 0.84, "h": 0.18}, "text": card["headline"],
                       "sizeFrac": 0.08, "align": "centre", "weight": "bold", "colour": ink})
    layers.append({"kind": "line", "box": {"x": 0.08, "y": 0.54, "w": 0.84, "h": 0.14}, "text": card["line"],
                   "sizeFrac": 0.05, "align": "centre", "weight": "regular", "colour": ink})
    if card.get("cta"):
        layers.append({"kind": "legal", "box": {"x": 0.08, "y": 0.72, "w": 0.84, "h": 0.08}, "text": card["cta"],
                       "sizeFrac": 0.03, "align": "centre", "weight": "regular", "colour": ink})
    typeset.draw(img, layers, fetch)
    return _png(img.convert("RGB"))
