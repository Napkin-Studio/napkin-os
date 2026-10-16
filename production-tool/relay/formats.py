"""Make all sizes on the relay (features/campaign-formats.clan): the free methods of the resize op.

crop: the largest box of the size's shape inside the master, placed so every protected box (the
subject, the product) sits inside the format's safe area when the shape allows it, else centred on
them. The web works out the same box (web/src/campaign/crop.ts) to show a tile before anything is
sent; both are tested against one case table, contracts/examples/crop-cases.json.

The result is scaled to the preview (the delivery shape, at most previewMaxPx on its longest side,
never larger than the delivery) and the type layers are drawn over it here (Pillow): words and the
logo never go to a model. No provider, no spend.
"""

from __future__ import annotations

import io
import math
from typing import Callable, Optional

from aspect import _half_up

PREVIEW_MAX_PX = 2048
FREE_METHODS = ("crop",)  # layout joins in phase 4, with the brand colour field


def safe_fracs(safe: Optional[dict], delivery: Optional[dict] = None) -> tuple[float, float, float, float]:
    """The safe area as (left, top, right, bottom) shares of the size. % and px are exact; mm needs the
    format's physical size, which only the web has (it sends the crop), so mm counts as no inset here."""
    if not safe:
        return 0.0, 0.0, 0.0, 0.0
    unit = safe.get("unit")
    w = (delivery or {}).get("width") or 0
    h = (delivery or {}).get("height") or 0
    if safe.get("type") == "insets":
        if unit == "%":
            return safe["left"] / 100, safe["top"] / 100, safe["right"] / 100, safe["bottom"] / 100
        if unit == "px" and w and h:
            return safe["left"] / w, safe["top"] / h, safe["right"] / w, safe["bottom"] / h
        return 0.0, 0.0, 0.0, 0.0
    if safe.get("type") == "box":
        if unit == "%":
            sx, sy = (1 - safe["width"] / 100) / 2, (1 - safe["height"] / 100) / 2
        elif unit == "px" and w and h:
            sx, sy = (1 - safe["width"] / w) / 2, (1 - safe["height"] / h) / 2
        else:
            return 0.0, 0.0, 0.0, 0.0
        sx, sy = max(0.0, sx), max(0.0, sy)
        return sx, sy, sx, sy
    return 0.0, 0.0, 0.0, 0.0


def _place(lo: float, hi: float, size: float, total: float, a: float, b: float) -> tuple[float, bool]:
    """Where a crop of `size` starts along one axis of `total`, so [lo, hi] (the protected span) sits
    inside the safe span [start + a*size, start + b*size]; and whether it does."""
    ideal = (lo + hi) / 2 - (a + b) / 2 * size
    first = hi - b * size   # the earliest start that keeps hi inside
    last = lo - a * size    # the latest start that keeps lo inside
    room = max(0.0, total - size)
    if first <= last + 1e-9:
        start = min(max(ideal, first), last)
        start = min(max(start, 0.0), room)
        fits = start >= first - 1e-6 and start <= last + 1e-6
        return start, fits
    return min(max(ideal, 0.0), room), False


def crop_box(mw: int, mh: int, aw: int, ah: int, protect: list[dict] | None = None,
             fracs: tuple[float, float, float, float] = (0.0, 0.0, 0.0, 0.0)) -> tuple[dict, bool]:
    """The crop of shape aw:ah in a mw x mh master, in master pixels, and whether every protected box is
    inside the safe area. With no protected box it is the centre crop (and fits)."""
    if mw * ah > mh * aw:  # the master is wider: keep its height
        cw, ch = min(mw, max(1, _half_up(mh * aw / ah))), mh
    else:
        cw, ch = mw, min(mh, max(1, _half_up(mw * ah / aw)))
    boxes = [b for b in (protect or []) if b.get("w", 0) > 0 and b.get("h", 0) > 0]
    if not boxes:
        return {"x": (mw - cw) // 2, "y": (mh - ch) // 2, "w": cw, "h": ch}, True
    x0 = min(b["x"] for b in boxes)
    y0 = min(b["y"] for b in boxes)
    x1 = max(b["x"] + b["w"] for b in boxes)
    y1 = max(b["y"] + b["h"] for b in boxes)
    left, top, right, bottom = fracs
    x, fx = _place(x0, x1, cw, mw, left, 1 - right)
    y, fy = _place(y0, y1, ch, mh, top, 1 - bottom)
    return {"x": _half_up(x), "y": _half_up(y), "w": cw, "h": ch}, fx and fy


def preview_size(delivery: dict, max_px: int | None = None) -> tuple[int, int]:
    """The delivery shape, at most max_px on its longest side and never larger than the delivery."""
    w, h = int(delivery["width"]), int(delivery["height"])
    cap = max_px or PREVIEW_MAX_PX
    s = min(1.0, cap / max(w, h))
    return max(1, _half_up(w * s)), max(1, _half_up(h * s))


def scaled(box: dict, sx: float, sy: float, w: int, h: int) -> tuple[int, int, int, int]:
    """A master-pixel box in the picture's own pixels (it may have been fitted for sending), clamped."""
    left = max(0, min(w - 1, math.floor(box["x"] * sx)))
    top = max(0, min(h - 1, math.floor(box["y"] * sy)))
    right = max(left + 1, min(w, math.ceil((box["x"] + box["w"]) * sx)))
    bottom = max(top + 1, min(h, math.ceil((box["y"] + box["h"]) * sy)))
    return left, top, right, bottom


def render(data: bytes, master_size: dict, crop: dict, out: tuple[int, int], layers: list[dict] | None = None,
           fetch: Optional[Callable[[str], bytes]] = None) -> tuple[bytes, int]:
    """The size as a PNG: the crop of the picture scaled to `out`, the type layers drawn over it. Returns
    (png, how many layers were drawn)."""
    from PIL import Image
    img = Image.open(io.BytesIO(data))
    img.load()
    rgb = img.convert("RGB")
    sx, sy = rgb.width / master_size["w"], rgb.height / master_size["h"]
    piece = rgb.crop(scaled(crop, sx, sy, rgb.width, rgb.height)).resize(out, Image.LANCZOS)
    drawn = 0
    if layers:
        import typeset
        drawn = typeset.draw(piece, layers, fetch)
    buf = io.BytesIO()
    piece.save(buf, format="PNG", optimize=False)
    return buf.getvalue(), drawn
