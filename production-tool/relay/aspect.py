"""A job's true shape, and the centre crop that gives it back (features/frame-aspect.clan).

Runway's image models take a fixed list of sizes, so a 16:9 job comes back 1344x768 (1.75) and
a 4:5 one 896x1152. The relay asks for the nearest size (director.provider_ratio), then crops the
picture to the shape the person drew (`input.aspect`, else `input.ratio`): 1344x756 for 16:9.
The crop is done once, here, so every browser lands the same picture (the same sha256).

One case table, contracts/examples/aspect-cases.json, holds the tolerance and the cases; the web's
canvas/core/sketch.ts and this module are both tested against it. It is not in the Lambda bundle,
so TOLERANCE is repeated here and a test keeps the two equal.
"""

from __future__ import annotations

import io
import math
import re
from typing import Optional

# Two shapes are the same when their log ratios differ by no more than this (about 0.5%).
TOLERANCE = 0.005
# The image ops whose result is cropped to the job's shape; video ops are never touched.
CROP_OPS = ("generate", "view", "frame", "region_edit")
_RATIO = re.compile(r"^(\d{1,6}):(\d{1,6})$")

Shape = tuple[int, int]


def parse_ratio(ratio: Optional[str]) -> Optional[Shape]:
    """'16:9' or '1344:768' as (w, h); None for anything else."""
    m = _RATIO.match(ratio or "")
    if not m:
        return None
    w, h = int(m.group(1)), int(m.group(2))
    return (w, h) if w > 0 and h > 0 else None


def target_aspect(op: str, inp: dict) -> Optional[Shape]:
    """The shape an image op's result must have: `input.aspect` (a format's exact shape, or the
    picture's own for an edit), else `input.ratio`. None for video ops and jobs with neither."""
    if op not in CROP_OPS:
        return None
    a = inp.get("aspect") or {}
    if isinstance(a.get("w"), int) and isinstance(a.get("h"), int) and a["w"] > 0 and a["h"] > 0:
        return a["w"], a["h"]
    return parse_ratio(inp.get("ratio"))


def shape_distance(a: Shape, b: Shape) -> float:
    return abs(math.log(a[0] / a[1]) - math.log(b[0] / b[1]))


def same_shape(a: Shape, b: Shape) -> bool:
    return shape_distance(a, b) <= TOLERANCE


def _half_up(x: float) -> int:
    """Rounding as JavaScript's Math.round does (Python's round() rounds half to even)."""
    return math.floor(x + 0.5)


def centre_crop_box(w: int, h: int, tw: int, th: int) -> tuple[int, int, int, int]:
    """The largest centred box of shape tw:th inside a w x h picture, as (left, top, right, bottom).
    The long fit keeps the full width (a picture too tall) or the full height (too wide)."""
    if w * th > h * tw:  # too wide: keep the height
        cw = min(w, max(1, _half_up(h * tw / th)))
        left = (w - cw) // 2
        return left, 0, left + cw, h
    ch = min(h, max(1, _half_up(w * th / tw)))
    top = (h - ch) // 2
    return 0, top, w, top + ch


def measure(data: bytes) -> Optional[Shape]:
    """The picture's size, or None when Pillow cannot read it."""
    from PIL import Image
    try:
        with Image.open(io.BytesIO(data)) as img:
            return img.size
    except Exception:
        return None


def crop_png(data: bytes, target: Shape) -> Optional[tuple[bytes, Shape, Shape]]:
    """The picture centre-cropped to `target`, as (png, (w, h), (original w, h)). None when it is
    already that shape (within TOLERANCE) or cannot be read. Always PNG, so the bytes, and the
    sha256, are the same wherever it runs."""
    from PIL import Image
    try:
        img = Image.open(io.BytesIO(data))
        img.load()
    except Exception:
        return None
    size = img.size
    if same_shape(size, target):
        return None
    if getattr(img, "is_animated", False):
        return None
    alpha = img.mode in ("RGBA", "LA") or (img.mode == "P" and "transparency" in img.info)
    mode = "RGBA" if alpha else "RGB"
    box = centre_crop_box(size[0], size[1], target[0], target[1])
    out = io.BytesIO()
    img.convert(mode).crop(box).save(out, format="PNG", optimize=False)
    return out.getvalue(), (box[2] - box[0], box[3] - box[1]), size
