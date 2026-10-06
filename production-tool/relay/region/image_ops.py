"""Pure image code for region edits (no provider calls).

A region is common.schema.json#/$defs/region: 0-1 x, y, w, h of the image, origin
top-left. Our mask convention is white = change; to_endpoint_mask converts it to
what an endpoint wants. Everything outside the box (plus margin) must stay the
original's pixels, which paste_back guarantees and pixel_diff measures.
"""

from __future__ import annotations

import io
from typing import Optional

from PIL import Image, ImageChops, ImageDraw, ImageOps

# A pixel counts as changed when any channel differs by more than this (of 255).
CHANGE_TOLERANCE = 8

# Defaults for inside_box_ok; tune against the 10 test edits (gate.py).
DEFAULT_THRESHOLDS = {
    "max_outside_changed_fraction": 0.005,
    "max_outside_mean_abs_diff": 1.0,
    "min_inside_changed_fraction": 0.02,
}


def _load(png: bytes) -> Image.Image:
    return Image.open(io.BytesIO(png)).convert("RGB")


def _png(img: Image.Image) -> bytes:
    out = io.BytesIO()
    img.save(out, format="PNG")
    return out.getvalue()


def _pixel_box(size: tuple[int, int], region: dict, margin_px: int = 0) -> tuple[int, int, int, int]:
    """The region in pixels (left, top, right, bottom), grown by the margin and kept on the image."""
    w, h = size
    left = max(0, round(region["x"] * w) - margin_px)
    top = max(0, round(region["y"] * h) - margin_px)
    right = min(w, round((region["x"] + region["w"]) * w) + margin_px)
    bottom = min(h, round((region["y"] + region["h"]) * h) + margin_px)
    return left, top, max(left + 1, right), max(top + 1, bottom)


def _fit(img: Image.Image, size: tuple[int, int]) -> Image.Image:
    """Resize to `size`, centre-cropping first if the ratio differs."""
    if img.size == size:
        return img
    w, h = size
    sw, sh = img.size
    if sw * h != sh * w:
        scale = max(w / sw, h / sh)
        cw, ch = min(sw, round(w / scale)), min(sh, round(h / scale))
        left, top = (sw - cw) // 2, (sh - ch) // 2
        img = img.crop((left, top, left + cw, top + ch))
    return img.resize(size, Image.LANCZOS)


def draw_box(png_bytes: bytes, region: dict, colour, width_px: int) -> bytes:
    """A copy with the box outlined just outside the region's edge (the box itself stays clean,
    so an outline the model keeps lands outside it, where it counts as a leak and is never pasted back)."""
    img = _load(png_bytes)
    left, top, right, bottom = _pixel_box(img.size, region)
    ImageDraw.Draw(img).rectangle(
        (left - width_px, top - width_px, right - 1 + width_px, bottom - 1 + width_px), outline=colour, width=width_px)
    return _png(img)


def paste_back(original: bytes, edited: bytes, region: dict, margin_px: int = 0) -> bytes:
    """The original with only the box (plus margin) taken from the edit."""
    base = _load(original)
    box = _pixel_box(base.size, region, margin_px)
    patch = _fit(_load(edited), base.size).crop(box)
    base.paste(patch, box[:2])
    return _png(base)


def _box_mask(size: tuple[int, int], box: tuple[int, int, int, int]) -> Image.Image:
    img = Image.new("L", size, 0)
    ImageDraw.Draw(img).rectangle((box[0], box[1], box[2] - 1, box[3] - 1), fill=255)
    return img


def mask_png(size: tuple[int, int], region: dict) -> bytes:
    """Our convention: black everywhere, white (255) in the box = change."""
    return _png(_box_mask(size, _pixel_box(size, region)))


def to_endpoint_mask(mask: bytes, polarity: str) -> bytes:
    """'white_edit' keeps ours; 'black_edit' flips it (the area to change becomes black)."""
    img = Image.open(io.BytesIO(mask)).convert("L")
    if polarity == "white_edit":
        return _png(img)
    if polarity == "black_edit":
        return _png(ImageOps.invert(img))
    raise ValueError(f"unknown mask polarity {polarity!r}")


def _changed_hist(diff: Image.Image, where: Image.Image) -> tuple[int, int, float]:
    """(pixels in `where`, changed pixels among them, sum of the diff) over the masked area."""
    hist = diff.histogram(mask=where)
    return sum(hist), sum(hist[CHANGE_TOLERANCE + 1:]), sum(i * n for i, n in enumerate(hist))


def pixel_diff(original: bytes, result: bytes, region: dict, margin_px: int = 0) -> dict:
    """How far a result strays from the original, outside and inside the box.

    A result of another size is fitted to the original first, as paste_back does.
    Margin pixels count as inside (they may change). A pixel's diff is its largest channel difference.
    """
    base = _load(original)
    other = _fit(_load(result), base.size)
    r, g, b = ImageChops.difference(base, other).split()
    diff = ImageChops.lighter(ImageChops.lighter(r, g), b)
    inside = _box_mask(base.size, _pixel_box(base.size, region, margin_px))
    outside = ImageOps.invert(inside)
    n_out, changed_out, sum_out = _changed_hist(diff, outside)
    n_in, changed_in, _ = _changed_hist(diff, inside)
    return {
        "outside_changed_fraction": changed_out / n_out if n_out else 0.0,
        "mean_abs_diff": sum_out / n_out if n_out else 0.0,
        "inside_changed_fraction": changed_in / n_in if n_in else 0.0,
    }


def inside_box_ok(metrics: dict, thresholds: Optional[dict] = None) -> bool:
    """The edit stayed in the box, and did something there."""
    t = {**DEFAULT_THRESHOLDS, **(thresholds or {})}
    return (metrics["outside_changed_fraction"] <= t["max_outside_changed_fraction"]
            and metrics["mean_abs_diff"] <= t["max_outside_mean_abs_diff"]
            and metrics["inside_changed_fraction"] >= t["min_inside_changed_fraction"])
