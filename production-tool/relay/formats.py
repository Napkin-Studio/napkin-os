"""Make all sizes on the relay (features/campaign-formats.clan): the free methods of the resize op.

crop: the largest box of the size's shape inside the master, placed so every protected box (the
subject, the product) sits inside the format's safe area when the shape allows it, else centred on
them. The web works out the same box (web/src/campaign/crop.ts) to show a tile before anything is
sent; both are tested against one case table, contracts/examples/crop-cases.json.

layout (display banners): the brand colour field at the size's shape, the picture in its panel (a crop
of the master at the panel's own shape), the type layers on the field. Free, like crop.

extend and regenerate are paid (phase 4; the paid tests in
docs/production-tool/campaign-formats-tests-2026-10-16.md set them):
  extend      the master at its own pixels on a canvas of the size's shape, a blurred stretch of it
              round it, our mask white there (16 px over the master's edge); Ideogram 4.5 at high fills
              the padding (pad_plan, padded). The prompt asks for continuation only, never the scene.
  regenerate  Gemini 3 Pro with the master as the tagged reference @master at the nearest of its ratios.
Both results are cropped to the exact shape (finish).

Every result is scaled to the preview (the delivery shape, at most previewMaxPx on its longest side,
never larger than the delivery) and kept clean as the size's plate; the type layers are drawn over a
copy here (Pillow): words and the logo never go to a model. Export at full size upscales the plate
(Magnific) and draws the layers again at the delivery size (deliver).
"""

from __future__ import annotations

import io
import math
from typing import Callable, Optional

from aspect import _half_up

PREVIEW_MAX_PX = 2048
FREE_METHODS = ("crop", "layout")
PAID_METHODS = ("extend", "regenerate")

# The words a paid method sends: what to do with the picture, never what is in it (the paid tests: the
# picture dominates the words, so a scene description only risks a mismatch), and never a size's type.
EXTEND_PROMPT = ("Continue the scene beyond its edges; keep everything inside exactly as it is. "
                 "Match its light, colour, grain and perspective. No text, no letters, no logos.")
REGENERATE_PROMPT = ("Recreate @master for a {shape} format: the same people, objects, place, light and colours. "
                     "Recompose for the shape so nothing important is cut off. No text, no letters, no logos.")
# A scamp (a Drawing, a sketch area: features/resize-selection.clan) drawn as a finished picture at the shape.
REGENERATE_SKETCH_PROMPT = ("Turn the sketch @master into a finished, photographic picture for a {shape} format: keep its "
                            "layout, subjects and their poses. Recompose for the shape so nothing important is cut off. "
                            "No text, no letters, no logos.")
# A named picture's other views (features/resize-selection.clan): the same character or object, kept itself.
REGENERATE_REFS = " {tags} show the same {what} from other sides: keep them exactly themselves."
# At most this many other views go with a regenerate (Gemini 3 Pro takes 14 refs, 5 of them human).
REGENERATE_REFS_MAX = 4

# The padded canvas Ideogram edits: at most this long and this many pixels (a data URI is at most 5 MB).
EXTEND_MAX_SIDE = 3072
EXTEND_MAX_PX = 4_200_000
EXTEND_OVERLAP = 16   # the mask reaches this far over the master's edge, so the seam is redrawn
EXTEND_BLUR = 40

# Magnific's limits (Runway OpenAPI 2024-11-06, POST /v1/image_upscale): each input side 300-8000 px,
# the output at most 25,300,000 pixels. Export at full size picks x4, or x8 for the largest print sizes.
UPSCALE_MIN_IN = 300
UPSCALE_MAX_IN = 8000
UPSCALE_MAX_OUT_PX = 25_300_000
DELIVERY_SCALES = (4, 8)


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
           fetch: Optional[Callable[[str], bytes]] = None) -> tuple[bytes, bytes, int]:
    """The size as PNGs: the crop of the picture scaled to `out` (the clean plate), and the same with
    the type layers drawn over it. Returns (plate, typed, how many layers were drawn)."""
    from PIL import Image
    img = Image.open(io.BytesIO(data))
    img.load()
    rgb = img.convert("RGB")
    sx, sy = rgb.width / master_size["w"], rgb.height / master_size["h"]
    piece = rgb.crop(scaled(crop, sx, sy, rgb.width, rgb.height)).resize(out, Image.LANCZOS)
    plate = io.BytesIO()
    piece.save(plate, format="PNG", optimize=False)
    drawn = 0
    if layers:
        import typeset
        drawn = typeset.draw(piece, layers, fetch)
    buf = io.BytesIO()
    piece.save(buf, format="PNG", optimize=False)
    return plate.getvalue(), buf.getvalue(), drawn

def shape_words(w: int, h: int) -> str:
    """The size's shape in words for the regenerate prompt ("tall 9:16", "wide 4:1")."""
    g = math.gcd(int(w), int(h)) or 1
    a, b = int(w) // g, int(h) // g
    ratio = f"{a}:{b}" if max(a, b) <= 32 else f"{w / h:.2f}:1" if w >= h else f"1:{h / w:.2f}"
    r = w / h
    kind = "very wide" if r >= 2.5 else "wide" if r >= 1.2 else "square" if r > 0.84 else "tall" if r > 0.4 else "very tall"
    return f"{kind} {ratio}"


def pad_plan(mw: int, mh: int, aw: int, ah: int, protect: list[dict] | None = None,
             fracs: tuple[float, float, float, float] = (0.0, 0.0, 0.0, 0.0)) -> dict:
    """Where the master sits on the canvas an extend fills: the canvas of shape aw:ah round the master at
    its own pixels (scaled down only to stay under EXTEND_MAX_SIDE and EXTEND_MAX_PX), the master placed
    along the padded side so the protected boxes sit in the middle of the safe area, else centred.
    {canvas: {w, h}, scale, at: {x, y, w, h}} in canvas pixels."""
    if mw * ah > mh * aw:  # the master is wider than the size: pad above and below
        cw, ch = mw, max(mh, _half_up(mw * ah / aw))
    else:
        cw, ch = max(mw, _half_up(mh * aw / ah)), mh
    s = min(1.0, EXTEND_MAX_SIDE / max(cw, ch), math.sqrt(EXTEND_MAX_PX / (cw * ch)))
    cw, ch = max(1, _half_up(cw * s)), max(1, _half_up(ch * s))
    w, h = min(cw, max(1, _half_up(mw * s))), min(ch, max(1, _half_up(mh * s)))
    boxes = [b for b in (protect or []) if b.get("w", 0) > 0 and b.get("h", 0) > 0]
    left, top, right, bottom = fracs

    def along(room: int, total: int, lo: float, hi: float, a: float, b: float) -> int:
        if room <= 0:
            return 0
        if not boxes:
            return room // 2
        ideal = (a + (1 - a - b) / 2) * total - (lo + hi) / 2 * s
        return int(min(max(_half_up(ideal), 0), room))

    x0 = min((b["x"] for b in boxes), default=0)
    x1 = max((b["x"] + b["w"] for b in boxes), default=mw)
    y0 = min((b["y"] for b in boxes), default=0)
    y1 = max((b["y"] + b["h"] for b in boxes), default=mh)
    x = along(cw - w, cw, x0, x1, left, right)
    y = along(ch - h, ch, y0, y1, top, bottom)
    return {"canvas": {"w": cw, "h": ch}, "scale": s, "at": {"x": x, "y": y, "w": w, "h": h}}


def padded(data: bytes, plan: dict) -> tuple[bytes, bytes]:
    """The canvas an extend sends (JPEG): the master at plan['at'] over a blurred stretch of itself;
    and our mask (PNG, white = change): white everywhere but the master, less EXTEND_OVERLAP px."""
    from PIL import Image, ImageFilter
    img = Image.open(io.BytesIO(data))
    img.load()
    rgb = img.convert("RGB")
    cw, ch = plan["canvas"]["w"], plan["canvas"]["h"]
    at = plan["at"]
    master = rgb.resize((at["w"], at["h"]), Image.LANCZOS) if rgb.size != (at["w"], at["h"]) else rgb
    bg = rgb.resize((cw, ch), Image.BILINEAR).filter(ImageFilter.GaussianBlur(EXTEND_BLUR))
    bg.paste(master, (at["x"], at["y"]))
    mask = Image.new("L", (cw, ch), 255)
    o = EXTEND_OVERLAP
    # Where the master meets the canvas edge there is nothing to blend: keep it to the edge.
    x0 = at["x"] + (o if at["x"] > 0 else 0)
    y0 = at["y"] + (o if at["y"] > 0 else 0)
    x1 = at["x"] + at["w"] - (o if at["x"] + at["w"] < cw else 0)
    y1 = at["y"] + at["h"] - (o if at["y"] + at["h"] < ch else 0)
    if x1 > x0 and y1 > y0:
        mask.paste(0, (x0, y0, x1, y1))
    b1, b2 = io.BytesIO(), io.BytesIO()
    bg.save(b1, format="JPEG", quality=90)
    mask.save(b2, format="PNG")
    return b1.getvalue(), b2.getvalue()


def finish(data: bytes, aspect: tuple[int, int], out: tuple[int, int], layers: list[dict] | None = None,
           fetch: Optional[Callable[[str], bytes]] = None) -> tuple[bytes, bytes, tuple[int, int], int]:
    """A paid method's picture as the size: centre-cropped to the exact shape (Gemini returns sizes a
    little off its ratio; an extend's canvas is rounded), scaled to `out`. Returns (the clean plate PNG,
    the PNG with the type layers drawn, the provider's own size, how many layers were drawn)."""
    from PIL import Image
    img = Image.open(io.BytesIO(data))
    img.load()
    rgb = img.convert("RGB")
    box, _ = crop_box(rgb.width, rgb.height, aspect[0], aspect[1])
    piece = rgb.crop((box["x"], box["y"], box["x"] + box["w"], box["y"] + box["h"])).resize(out, Image.LANCZOS)
    plate = io.BytesIO()
    piece.save(plate, format="PNG", optimize=False)
    drawn = 0
    if layers:
        import typeset
        drawn = typeset.draw(piece, layers, fetch)
    typed = io.BytesIO()
    piece.save(typed, format="PNG", optimize=False)
    return plate.getvalue(), typed.getvalue(), rgb.size, drawn


def layout_render(data: bytes, master_size: dict, crop: dict, out: tuple[int, int], panel: dict,
                  background: str | None, layers: list[dict] | None = None,
                  fetch: Optional[Callable[[str], bytes]] = None) -> tuple[bytes, bytes, int]:
    """layout: the brand colour field at `out`, the crop of the picture in `panel` (0-1 of the size),
    the type layers over it. Returns (the plate PNG, the PNG with the layers, how many were drawn)."""
    from PIL import Image
    import typeset
    img = Image.open(io.BytesIO(data))
    img.load()
    rgb = img.convert("RGB")
    field = Image.new("RGB", out, typeset._hex(background, (17, 17, 17)))
    px = (_half_up(panel["x"] * out[0]), _half_up(panel["y"] * out[1]))
    pw = max(1, min(out[0] - px[0], _half_up(panel["w"] * out[0])))
    ph = max(1, min(out[1] - px[1], _half_up(panel["h"] * out[1])))
    sx, sy = rgb.width / master_size["w"], rgb.height / master_size["h"]
    piece = rgb.crop(scaled(crop, sx, sy, rgb.width, rgb.height)).resize((pw, ph), Image.LANCZOS)
    field.paste(piece, px)
    plate = io.BytesIO()
    field.save(plate, format="PNG", optimize=False)
    drawn = typeset.draw(field, layers, fetch) if layers else 0
    typed = io.BytesIO()
    field.save(typed, format="PNG", optimize=False)
    return plate.getvalue(), typed.getvalue(), drawn


def delivery_input(plate: tuple[int, int], delivery: tuple[int, int], k: int) -> tuple[int, int]:
    """The size the plate goes to Magnific at for scale k: no larger than it is, no larger than the
    delivery needs (the output just covers it), and small enough that the output stays under 25.3 MP."""
    w, h = plate
    s = min(1.0, max(delivery[0] / (k * w), delivery[1] / (k * h)))
    s = min(s, math.sqrt(UPSCALE_MAX_OUT_PX / (k * k * w * h)))
    return max(1, math.floor(w * s)), max(1, math.floor(h * s))


def delivery_scale(plate: tuple[int, int], delivery: tuple[int, int]) -> Optional[int]:
    """The Magnific scale Export at full size uses for a plate: x4 when it reaches the delivery size, else
    x8; when neither does (a delivery over 25.3 MP, the 96-sheet), the one with the larger output. None
    when no upscale is needed (the plate is the delivery size) or Magnific cannot take it (a side under
    300 or over 8000 px)."""
    w, h = plate
    if w >= delivery[0] and h >= delivery[1]:
        return None
    best, area = None, 0
    for k in DELIVERY_SCALES:
        iw, ih = delivery_input(plate, delivery, k)
        if min(iw, ih) < UPSCALE_MIN_IN or max(iw, ih) > UPSCALE_MAX_IN:
            continue
        if iw * k >= delivery[0] and ih * k >= delivery[1]:
            return k
        if iw * ih * k * k > area:
            best, area = k, iw * ih * k * k
    return best


def deliver(data: bytes, delivery: tuple[int, int], layers: list[dict] | None = None,
            fetch: Optional[Callable[[str], bytes]] = None) -> tuple[bytes, int]:
    """An upscaled plate as the delivery file: scaled to exactly the delivery size (Magnific's output is
    at least as large, or as large as its 25.3 MP allows), the type layers drawn at that size."""
    from PIL import Image
    img = Image.open(io.BytesIO(data))
    img.load()
    rgb = img.convert("RGB")
    box, _ = crop_box(rgb.width, rgb.height, delivery[0], delivery[1])
    full = rgb.crop((box["x"], box["y"], box["x"] + box["w"], box["y"] + box["h"]))
    if full.size != delivery:
        full = full.resize(delivery, Image.LANCZOS)
    drawn = 0
    if layers:
        import typeset
        drawn = typeset.draw(full, layers, fetch)
    buf = io.BytesIO()
    full.save(buf, format="PNG", optimize=False, compress_level=3)
    return buf.getvalue(), drawn
