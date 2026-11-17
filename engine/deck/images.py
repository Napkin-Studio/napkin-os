"""Pictures that already exist, on the slides: records, assets and approvals (deck-frames-in, contract section 4).

This module writes the deck's image slots and ``deck.assets``, stamps a person's decisions on them, and holds the one
crop function every renderer calls. It draws nothing (render_pptx, render_web and render_hyperframes do) and it sends
nothing out: no network, no model, no provider module is imported. Pillow is imported at module level on purpose: a
missing install fails loudly (deck-ci's rule), never as a silent skip.

    python3 -m deck.images approve --review FILE --deck deck.json --territory TID --by human:<id>

is the engine half of the one click: it writes one ``review.images`` entry for each CLEAN picture of that territory.
Models never write ``review.*``; this is run by the person's app or the person.

SLOT_TABLE is slice 4's to copy into its layout files: slide type -> slots (name, aspect). A slot with count n binds
``<name>_1`` to ``<name>_n`` (the territory's four frames are ``frame_1`` to ``frame_4``).
"""
from __future__ import annotations

import argparse
import hashlib
import json
import re
import sys
from datetime import datetime, timezone
from pathlib import Path

from PIL import Image, ImageOps

from . import spec

#: Longest side of the picture every renderer draws, and its JPEG quality. One derived file per asset, reused by all three.
DERIVED_PX, DERIVED_QUALITY = 1920, 85
#: Refuse a picture over this many pixels before it is decoded (a decompression bomb), and any file over this many bytes.
MAX_PIXELS, MAX_BYTES = 40_000_000, 25_000_000
ALT_MAX, SUBJECT_MAX, PROMPT_MAX, REASON_MAX = 140, 400, 2400, 300
#: Slide types a picture is drawn on without asking for one (the creative slides, and with --pictures creative_cover the cover and divider).
CREATIVE_TYPES = ("territory", "idea", "execution", "audience")
COVER_TYPES = ("title", "appendix")
_MIME = {"PNG": ("image/png", "png"), "JPEG": ("image/jpeg", "jpg"), "WEBP": ("image/webp", "webp")}
SHOTS = ("f1", "f2", "f3", "f4")
APPROVER = re.compile(r"^human:\S+$")


class ImageError(ValueError):
    """A picture, a slot or a label the engine refuses. The message says what to change."""


# -------------------------------------------------------------------------------------------------- the slot table

#: Slide type -> (slot name, aspect, count). Boxes are slice 4's: cover and section 16:9, image_text (idea, audience) 4:3, the
#: frame strip four 16:9 boxes, executions by spec.frame_for (phone 9:16, poster 4:5, no frame 16:9; search and audio take none).
SLOT_TABLE = {
    "title": [("picture", "16:9", 1)],
    "appendix": [("picture", "16:9", 1)],
    "territory": [("frame", "16:9", 4)],
    "idea": [("picture", "4:3", 1)],
    "audience": [("picture", "4:3", 1)],
    "execution": [("picture", "16:9", 1)],
    # allowed for a supplied picture (--image), asked for by nothing
    "real_question": [("picture", "16:9", 1)], "close": [("picture", "16:9", 1)],
    "solution": [("picture", "4:3", 1)], "product": [("picture", "4:3", 1)],
}
#: The slot an execution's channel frame gives, by spec.frame_for. None: no picture slot (a search ad or an audio spot is not pictured).
EXECUTION_ASPECT = {"phone": "9:16", "poster": "4:5", None: "16:9", "search": None, "audio": None}
SLOT_NAME = re.compile(r"^[a-z][a-z0-9_]{1,23}$")


def slot_specs(slide: dict) -> list:
    """The slots this slide takes: ``[(name, aspect)]``, a counted slot expanded (frame_1 ... frame_4). Empty for an evidence slide."""
    t = slide.get("type")
    if t not in SLOT_TABLE or t not in spec.PICTURE_SLIDE_TYPES:
        return []
    out = []
    for name, aspect, n in SLOT_TABLE[t]:
        if t == "execution":
            aspect = EXECUTION_ASPECT[spec.frame_for(slide.get("title") or "")]
            if aspect is None:
                continue
        out += [(f"{name}_{i}" if n > 1 else name, aspect) for i in range(1, n + 1)]
    return out


def ratio(aspect: str) -> float:
    """Width over height of an aspect name like ``16:9``."""
    w, h = aspect.split(":")
    return int(w) / int(h)


def crop_box(src_w: int, src_h: int, aspect, focal: dict | None = None) -> tuple:
    """The part of a ``src_w`` by ``src_h`` picture to show in a box of ``aspect`` (a name like ``16:9`` or a width/height number),
    as ``(x0, y0, x1, y1)`` in source pixels: the largest such rectangle, centred on ``focal`` ({x, y} 0 to 1; centre when absent)
    and kept inside the picture. The box's own aspect is held to a pixel, so drawing it into the box never stretches."""
    want = ratio(aspect) if isinstance(aspect, str) else float(aspect)
    if src_w <= 0 or src_h <= 0 or want <= 0:
        raise ImageError("a picture needs a positive size and a positive aspect")
    if src_w / src_h >= want:   # wider than the box: keep the full height, trim the sides
        h = src_h
        w = min(src_w, max(1, round(h * want)))
    else:
        w = src_w
        h = min(src_h, max(1, round(w / want)))
    fx = 0.5 if not focal else min(1.0, max(0.0, float(focal.get("x", 0.5))))
    fy = 0.5 if not focal else min(1.0, max(0.0, float(focal.get("y", 0.5))))
    x0 = min(src_w - w, max(0, round(fx * src_w - w / 2)))
    y0 = min(src_h - h, max(0, round(fy * src_h - h / 2)))
    return (x0, y0, x0 + w, y0 + h)


def src_rect(box: tuple, src_w: int, src_h: int) -> tuple:
    """A crop box as the fractions PowerPoint's ``a:srcRect`` takes (left, top, right, bottom trimmed, each 0 to 1)."""
    x0, y0, x1, y1 = box
    return (x0 / src_w, y0 / src_h, (src_w - x1) / src_w, (src_h - y1) / src_h)


# -------------------------------------------------------------------------------------------------- words

def digits_or_name(text: str, names=()) -> str | None:
    """Why this text may not label or describe a picture: it holds a digit (it could read as a figure) or one of ``names``
    (the client's name, the agency's, a brand name). A whole name, case-insensitively, not a word of it: 'water' alone is allowed
    for a water utility. None when the text is clean."""
    if re.search(r"\d", text or ""):
        return "it holds a digit, which could be read as a figure"
    low = (text or "").lower()
    for n in names:
        n = str(n or "").strip()
        if len(n) >= 3 and not n.startswith("[") and re.search(r"(?<!\w)" + re.escape(n.lower()) + r"(?!\w)", low):
            return f"it names '{n}'"
    return None


def deck_names(deck: dict) -> list:
    """The names a label or alt text may not carry: the client, the agency and the brand's own name."""
    m = deck.get("meta") or {}
    return [x for x in (m.get("client"), m.get("agency"), (m.get("brand") or {}).get("name")) if x]


def clean_label(label: str, names=()) -> str:
    """The picture label (``--picture-label``): up to 30 characters, no digit, no name."""
    label = (label or "").strip()
    if not label or len(label) > 30:
        raise ImageError("the picture label is 1 to 30 characters")
    why = digits_or_name(label, names)
    if why:
        raise ImageError(f"the picture label {label!r} is refused: {why}")
    return label


def make_alt(subject: str, names=()) -> str:
    """Alt text written by code from the subject, cut at a word to 140 characters. Refused when it holds a digit or a name."""
    subject = re.sub(r"\s+", " ", (subject or "").strip())
    why = digits_or_name(subject, names)
    if why:
        raise ImageError(f"alt text from {subject[:60]!r} is refused: {why}")
    if len(subject) <= ALT_MAX:
        return subject
    cut = subject[:ALT_MAX].rsplit(" ", 1)[0].rstrip(",;:- ")
    return cut or subject[:ALT_MAX]


# -------------------------------------------------------------------------------------------------- files

def inspect_file(path: Path) -> dict:
    """What a picture file is, checked before anything is written: ``{sha256, mime, ext, width, height, bytes, oriented}``. Width
    and height are the picture as it is SHOWN (after the EXIF turn). SVG is refused (it can carry script and text), as is any
    file that is not a PNG, JPEG or WEBP, an oversized file and a decompression bomb."""
    path = Path(path)
    if not path.is_file():
        raise ImageError(f"{path} is not a file")
    raw = path.read_bytes()
    if len(raw) > MAX_BYTES:
        raise ImageError(f"{path.name} is {len(raw) // 1_000_000} MB: pictures over {MAX_BYTES // 1_000_000} MB are refused")
    head = raw[:512].lstrip().lower()
    if path.suffix.lower() in (".svg", ".svgz") or head.startswith(b"<svg") or (head.startswith(b"<?xml") and b"<svg" in raw[:4096].lower()):
        raise ImageError(f"{path.name} is an SVG: it can carry script and words, so it is refused. Give a PNG, JPEG or WEBP")
    prior = Image.MAX_IMAGE_PIXELS
    Image.MAX_IMAGE_PIXELS = MAX_PIXELS
    try:
        with Image.open(path) as im:
            fmt = im.format
            if fmt not in _MIME:
                raise ImageError(f"{path.name} is not a PNG, JPEG or WEBP picture (Pillow read it as {fmt})")
            w, h = im.size
            if w * h > MAX_PIXELS:
                raise ImageError(f"{path.name} is {w} by {h} pixels: over {MAX_PIXELS // 1_000_000} million pixels is refused")
            turned = (im.getexif().get(0x0112) or 1) in (5, 6, 7, 8)
            im.load()
    except ImageError:
        raise
    except Image.DecompressionBombError as e:
        raise ImageError(f"{path.name} is refused as a decompression bomb: {e}") from None
    except Exception as e:   # a corrupt or truncated file
        raise ImageError(f"{path.name} cannot be read as a picture: {type(e).__name__}") from None
    finally:
        Image.MAX_IMAGE_PIXELS = prior
    if turned:
        w, h = h, w
    mime, ext = _MIME[fmt]
    return {"sha256": hashlib.sha256(raw).hexdigest(), "mime": mime, "ext": ext, "width": w, "height": h, "bytes": len(raw), "oriented": turned}


def derived_jpeg(src: Path, out_dir: Path, sha256: str) -> Path:
    """The one JPEG every renderer draws for an asset: ``<out_dir>/assets/derived/<sha256>-1920.jpg``, long side at most 1920 px,
    quality 85, the EXIF turn applied and any transparency flattened onto white. Made once and reused (cached by the file name)."""
    dst = Path(out_dir) / "assets" / "derived" / f"{sha256}-{DERIVED_PX}.jpg"
    if dst.is_file():
        return dst
    dst.parent.mkdir(parents=True, exist_ok=True)
    prior = Image.MAX_IMAGE_PIXELS
    Image.MAX_IMAGE_PIXELS = MAX_PIXELS
    try:
        with Image.open(src) as im:
            im = ImageOps.exif_transpose(im)
            if im.mode in ("RGBA", "LA", "P") or "transparency" in im.info:
                im = im.convert("RGBA")
                flat = Image.new("RGB", im.size, (255, 255, 255))
                flat.paste(im, mask=im.getchannel("A"))
                im = flat
            else:
                im = im.convert("RGB")
            if max(im.size) > DERIVED_PX:
                im.thumbnail((DERIVED_PX, DERIVED_PX), Image.LANCZOS)
            tmp = dst.with_suffix(".tmp")
            im.save(tmp, format="JPEG", quality=DERIVED_QUALITY, optimize=True)
            tmp.replace(dst)
    finally:
        Image.MAX_IMAGE_PIXELS = prior
    return dst


# -------------------------------------------------------------------------------------------------- frames.json

def load_frames(stages: Path) -> dict | None:
    """``<stages>/frames.json`` (written by from_territory), or None. Read only when run_deck is given --pictures."""
    p = Path(stages) / "frames.json"
    if not p.is_file():
        return None
    f = json.loads(p.read_text())
    if f.get("stage") != "frames" or not isinstance(f.get("frames"), dict):
        raise ImageError(f"{p} is not a frames stage file")
    return f


def frame_for_shot(frames: dict, tid: str, shot: str) -> tuple:
    """``(key, frame)`` of the frame chosen for a territory's shot, or ``(None, None)``."""
    for k, f in (frames.get("frames") or {}).items():
        if f.get("territory") == tid and f.get("shot") == shot:
            return k, f
    return None, None


def _asset_guard(f: dict) -> dict:
    g = f.get("guard") or {}
    out = {"checked": bool(g.get("checked")), "by": "ollama:unrecorded" if g.get("checked") else "not checked", "flagged": bool(g.get("flagged"))}
    if g.get("found"):
        out["found"] = g["found"]
    if g.get("reason"):
        out["reason"] = str(g["reason"])[:REASON_MAX]
    return out


def frame_slot(frames: dict, key: str, f: dict, aspect: str, names=()) -> tuple:
    """The image slot value for one chosen frame, and its asset record (None for a refused frame, which has no file).
    A frame whose subject would give alt text with a digit or a name is held back: an empty slot with the reason."""
    run = (frames.get("run") or {}).get("sha256_12")
    subject = (f.get("subject") or "")[:SUBJECT_MAX]
    base = {"kind": "frame", "aspect": aspect, "basis": "creative", "from": {"kind": "territory_frame", "key": key, **({"run": run} if run else {})}}
    if f.get("status") == "refused" or not f.get("file"):
        return {**base, "status": "empty", "reason": (f.get("reason") or "the shot was refused and has no picture")[:REASON_MAX]}, None
    try:
        alt = make_alt(subject, names) if subject else "An illustrative frame"
    except ImageError as e:
        return {**base, "status": "empty", "reason": f"held back: {e}"[:REASON_MAX]}, None
    image = {**base, "status": "flagged" if f.get("status") == "flagged" else "made", "asset": "img_" + f["sha256"][:12], "alt": alt}
    if subject:
        image["subject"] = subject
    if f.get("prompt") and len(f["prompt"]) <= PROMPT_MAX:
        image["prompt"] = f["prompt"]
    if f.get("status") == "flagged" and f.get("reason"):
        image["reason"] = str(f["reason"])[:REASON_MAX]
    st = frames.get("style") or {}
    style = {k: st[k] for k in ("pack", "version", "hash") if st.get(k) not in (None, "")}
    if style.get("hash") and re.fullmatch(r"[0-9a-f]{8}", str(style["hash"])):
        image["style"] = style
    asset = {"sha256": f["sha256"], "file": f"assets/{f['sha256']}.{(f.get('file') or 'x.png').rsplit('.', 1)[-1]}", "mime": f["mime"],
             "width": f["width"], "height": f["height"], "rights": "generated", "guard": _asset_guard(f)}
    if f.get("model"):
        asset["made"] = {"provider": "runway", "model": f["model"]}
    return {"kind": "image", "image": image}, asset


def chosen_territory(c: dict) -> str | None:
    """The territory the cover and the idea picture follow: the pick in stage c, else the one the recommendation slide names (the first)."""
    ts = (c or {}).get("territories") or []
    ids = [t.get("id") for t in ts]
    return c.get("chosen") if c.get("chosen") in ids else (ids[0] if ids else None)


def bind_frames(deck_slides: dict | None, frames: dict, c: dict, pictures: str = "creative_cover", names=()):
    """Plan the frame slots at assembly time, by territory id (never by a slide's title or place): returns
    ``{"territory": {tid: {slot: value}}, "title": {slot: value}, "idea": {slot: value}, "assets": {asset id: record}}``.
    Territory slides take frame_1..frame_4 (shots f1..f4); the cover the chosen territory's f1 (only with ``creative_cover``);
    the idea slide its f4, the payoff shot. A shot with no usable frame is an empty slot with the reason."""
    out = {"territory": {}, "title": {}, "idea": {}, "assets": {}}

    def one(tid, shot, slot, aspect):
        key, f = frame_for_shot(frames, tid, shot)
        if not f:
            return {"kind": "image", "image": {"kind": "frame", "status": "empty", "aspect": aspect, "basis": "creative",
                                               "reason": f"the territory run has no frame for {shot}"}}
        val, asset = frame_slot(frames, key, f, aspect, names)
        if val.get("kind") != "image":   # an empty slot with its reason
            val = {"kind": "image", "image": val}
        if asset:
            out["assets"]["img_" + asset["sha256"][:12]] = asset
        return val

    if pictures == "none":
        return out
    for t in (c or {}).get("territories") or []:
        out["territory"][t["id"]] = {f"frame_{i + 1}": one(t["id"], SHOTS[i], f"frame_{i + 1}", "16:9") for i in range(4)}
    tid = chosen_territory(c or {})
    if tid:
        out["idea"] = {"picture": one(tid, "f4", "picture", "4:3")}
        if pictures == "creative_cover":
            out["title"] = {"picture": one(tid, "f1", "picture", "16:9")}
    return out


# -------------------------------------------------------------------------------------------------- the images pass

def _slots(slide: dict) -> dict:
    return slide.setdefault("slots", {})


def image_slots(deck: dict):
    """Every image slot of the deck in order: ``(slide id, slot name, image dict)``."""
    for sid in deck.get("order") or []:
        for name, v in ((deck["slides"].get(sid) or {}).get("slots") or {}).items():
            if isinstance(v, dict) and v.get("kind") == "image" and isinstance(v.get("image"), dict):
                yield sid, name, v["image"]


def register_assets(deck: dict, assets: dict) -> None:
    """Add asset records to ``deck.assets``. One file is one asset (its id is its sha256's first 12 hex); two different files with one
    id stop the build."""
    cur = deck.setdefault("assets", {})
    for aid, rec in assets.items():
        if aid in cur and cur[aid]["sha256"] != rec["sha256"]:
            raise ImageError(f"two different pictures share the asset id {aid}")
        cur.setdefault(aid, rec)


def prune_assets(deck: dict) -> None:
    """Drop asset records no slot holds (a supplied picture can replace a frame): one record per picture in use, none left over."""
    used = {im.get("asset") for _, _, im in image_slots(deck)}
    for aid in [k for k in (deck.get("assets") or {}) if k not in used]:
        del deck["assets"][aid]
    if "assets" in deck and not deck["assets"]:
        del deck["assets"]


def parse_image_args(items: list, rights: list) -> dict:
    """``--image SLIDE.SLOT=FILE`` and ``--image-rights SLIDE.SLOT=RIGHTS`` into ``{(slide id, slot): {"file": Path, "rights": str|None}}``.
    Refused here, before anything is written: a bad form, a slot called ``logo`` (a logo is meta.theme.logo), unknown rights."""
    out = {}
    for it in items or []:
        target, eq, path = it.partition("=")
        sid, dot, slot = target.partition(".")
        if not (eq and dot and sid and slot and path):
            raise ImageError(f"--image needs SLIDE.SLOT=FILE, got {it!r}")
        if slot == "logo":
            raise ImageError("the slot 'logo' is not placed with --image: a logo comes from the theme (meta.theme.logo)")
        if not SLOT_NAME.match(slot):
            raise ImageError(f"{slot!r} is not a slot name (lower case, digits and _, 2 to 24 characters)")
        if (sid, slot) in out:
            raise ImageError(f"--image {sid}.{slot} is given twice")
        out[(sid, slot)] = {"file": Path(path).expanduser(), "rights": None}
    for it in rights or []:
        target, eq, r = it.partition("=")
        sid, dot, slot = target.partition(".")
        if not (eq and dot):
            raise ImageError(f"--image-rights needs SLIDE.SLOT=RIGHTS, got {it!r}")
        if r not in ("own", "licensed", "client_supplied"):
            raise ImageError(f"--image-rights {r!r}: use own, licensed or client_supplied (a picture with no stated right is reference_only and not placed)")
        if (sid, slot) not in out:
            raise ImageError(f"--image-rights {sid}.{slot} names a picture that --image does not give")
        out[(sid, slot)]["rights"] = r
    return out


def place_supplied(deck: dict, supplied: dict, names=(), sources: dict | None = None) -> list:
    """Place pictures a person supplied (``parse_image_args``) on slides, by slide id. Returns the findings-to-be, ``[{slide, slot,
    message}]``, for pictures not placed: a picture with no stated right is recorded as ``reference_only`` and not placed.
    Refused (raises, nothing written): an unknown slide id, an evidence slide, a slot the slide's type does not take, an unreadable
    or oversized or SVG file. ``sources`` (when given) is filled with ``{asset id: the file it came from}`` for copy_assets."""
    held, work = [], []
    for (sid, slot), a in supplied.items():
        s = (deck.get("slides") or {}).get(sid)
        if s is None:
            raise ImageError(f"--image {sid}.{slot}: the deck has no slide {sid}")
        if s["type"] not in spec.PICTURE_SLIDE_TYPES or s["type"] not in SLOT_TABLE:
            raise ImageError(f"--image {sid}.{slot}: a {s['type']} slide is an evidence slide and takes no picture")
        want = dict(slot_specs(s))
        if slot not in want and not (s["type"] == "execution" and EXECUTION_ASPECT[spec.frame_for(s.get("title") or "")] is None):
            raise ImageError(f"--image {sid}.{slot}: a {s['type']} slide has the slots {', '.join(want) or 'none'}")
        if slot not in want:
            raise ImageError(f"--image {sid}.{slot}: this execution is a channel with no picture slot")
        info = inspect_file(a["file"])
        work.append((sid, slot, want[slot], a, info))
    for sid, slot, aspect, a, info in work:
        aid = "img_" + info["sha256"][:12]
        rights = a["rights"] or "reference_only"
        register_assets(deck, {aid: {"sha256": info["sha256"], "file": f"assets/{info['sha256']}.{info['ext']}", "mime": info["mime"],
                                     "width": info["width"], "height": info["height"], "bytes": info["bytes"], "rights": rights,
                                     "guard": {"checked": False, "by": "not checked", "flagged": False}}})
        if sources is not None:
            sources[aid] = Path(a["file"])   # where the engine copies it from (it never leaves the machine)
        s = deck["slides"][sid]
        alt = SUPPLIED_ALT.get(s["type"], "A picture for this slide")
        image = {"kind": "illustration", "status": "made", "aspect": aspect, "basis": "creative", "asset": aid,
                 "from": {"kind": "upload"}, "alt": alt, "subject": alt}
        if rights == "reference_only":
            image["status"] = "empty"
            image.pop("asset")
            image["reason"] = "image_rights: no right was stated for this picture, so it is a reference only and is not placed"
            held.append({"slide": sid, "slot": slot, "message": image["reason"]})
        _slots(s)[slot] = {"kind": "image", "image": image}
    return held


SUPPLIED_ALT = {"title": "A picture for the cover", "appendix": "A picture for the section break", "territory": "A picture for the territory",
                "idea": "A picture for the idea", "execution": "A picture for the execution", "audience": "A picture for the audience",
                "real_question": "A picture for the real question", "close": "A picture for the close",
                "solution": "A picture for the solution", "product": "A picture for the product"}


def add_empty_slots(deck: dict, pictures: str) -> int:
    """With ``--pictures``, give every slide of the asked types the slots it takes, empty with a reason, where nothing was placed.
    Territory, idea and audience and execution slides always (the creative slides); the cover and the divider with ``creative_cover``.
    Returns the number added. An empty slot is never drawn."""
    if pictures == "none":
        return 0
    types = CREATIVE_TYPES + (COVER_TYPES if pictures == "creative_cover" else ())
    n = 0
    for sid in deck["order"]:
        s = deck["slides"][sid]
        if s["type"] not in types:
            continue
        for name, aspect in slot_specs(s):
            if name not in (s.get("slots") or {}):
                _slots(s)[name] = {"kind": "image", "image": {"kind": "illustration", "status": "empty", "aspect": aspect, "basis": "creative",
                                                               "reason": "no picture yet: the territory run has none for this slide and none was supplied"}}
                n += 1
    return n


def stamp_review(deck: dict, review: dict | None, approver: str | None) -> dict:
    """Stamp a person's ``review.images`` decisions on the slots. A decision counts only when it is ``approve``, its ``by`` equals the
    deck's approver (a ``human:<id>``), its ``asset`` equals the slot's own asset and ``at`` is not empty; then the slot is ``approved``
    and holds ``approval``. A ``replace`` or ``remove`` for the slot's own asset marks it ``rejected``. Anything else is ignored: a
    changed picture returns to ``made`` (it has no approval). Returns ``{approved, rejected, ignored}`` counts. With no approver
    nothing is stamped."""
    got = {"approved": 0, "rejected": 0, "ignored": 0}
    imgs = ((review or {}).get("images") or {}) if isinstance(review, dict) else {}
    for sid, name, im in image_slots(deck):
        d = (imgs.get(sid) or {}).get(name)
        if not isinstance(d, dict) or im.get("status") not in ("made", "flagged"):
            continue
        if not (approver and APPROVER.match(approver) and d.get("by") == approver and d.get("asset") == im.get("asset") and d.get("at")):
            got["ignored"] += 1
            continue
        if d.get("decision") == "approve":
            im["status"] = "approved"
            im["approval"] = {k: d[k] for k in ("asset", "decision", "by", "at", "note") if d.get(k)}
            im.pop("reason", None)
            got["approved"] += 1
        elif d.get("decision") in ("replace", "remove"):
            im["status"] = "rejected"
            im["reason"] = f"a person asked to {d['decision']} this picture"
            got["rejected"] += 1
    return got


def approve_territory(review: dict, deck: dict, tid: str, by: str, at: str | None = None) -> dict:
    """The engine half of the one click. Writes ``review.images[slide][slot]`` (approve, the slot's asset, ``by``, ``at``) for every slot
    holding one of territory ``tid``'s frames that is CLEAN: made, its guard ran and flagged nothing. Skips and lists the rest (a
    flagged frame stays flagged, a frame no guard looked at and a slot with no picture wait for a person). ``by`` must be a
    ``human:<id>``: a model never approves. Returns ``{approved: [(slide, slot)], skipped: [(slide, slot, reason)]}``."""
    if not (isinstance(by, str) and APPROVER.match(by)):
        raise ImageError("approve needs --by human:<id>: only a person approves a picture")
    at = at or datetime.now(timezone.utc).isoformat(timespec="seconds")
    assets = deck.get("assets") or {}
    out = {"approved": [], "skipped": []}
    for sid, name, im in image_slots(deck):
        frm = im.get("from") or {}
        if frm.get("kind") != "territory_frame" or str(frm.get("key", "")).rsplit("-", 2)[0] != tid:
            continue
        g = (assets.get(im.get("asset")) or {}).get("guard") or {}
        if im.get("status") != "made":
            out["skipped"].append((sid, name, f"status is {im.get('status')}"))
        elif g.get("flagged"):
            out["skipped"].append((sid, name, "the guard flagged it"))
        elif not g.get("checked"):
            out["skipped"].append((sid, name, "no guard has looked at it"))
        else:
            review.setdefault("images", {}).setdefault(sid, {})[name] = {"asset": im["asset"], "decision": "approve", "by": by, "at": at}
            out["approved"].append((sid, name))
    return out


def stamp_preferences(deck: dict, pictures: str, label: str, approver: str | None, hold: dict | None = None, style_hash: str | None = None) -> None:
    """Record what the build used in ``meta.preferences`` (source ``person`` for what a flag set, ``default`` for the rest): the pictures
    choice, the source (only existing pictures: nothing generated) and the label; with ``hold``, ``style_pack.hold`` too (a Style Pack
    that could not be read: the build went on and the frames keep the style they were made in)."""
    prefs = deck["meta"].setdefault("preferences", {})
    prefs["pictures"] = {"on": pictures, "source": "person" if pictures != "creative_cover" else "default"}
    prefs["picture_source"] = {"allow": "existing", "source": "default"}
    pa = {"approver": "named" if approver else "owner", "label": label, "source": "person" if label != spec.PICTURE_LABEL or approver else "default"}
    if approver:
        pa["user"] = approver
    prefs["picture_approval"] = pa
    if hold or style_hash:
        sp = {"use": "territory", "source": "default"}
        if style_hash:
            sp["hash"] = style_hash
        if hold:
            sp["hold"] = True
            sp["hold_reason"] = str(hold.get("reason", ""))[:REASON_MAX]
        prefs["style_pack"] = sp


def drawn(deck: dict, audience: str) -> dict:
    """The slots a render draws, ``{(slide id, slot): image dict}``. A review render draws made, flagged and approved pictures; a client
    render draws only approved ones whose approval names the slot's own asset. A ``reference_only`` asset is drawn in neither."""
    assets = deck.get("assets") or {}
    ok = ("approved",) if audience == "client" else ("made", "flagged", "approved")
    out = {}
    for sid, name, im in image_slots(deck):
        if im.get("status") not in ok or im.get("asset") not in assets or assets[im["asset"]].get("rights") == "reference_only":
            continue
        if audience == "client" and not approval_names_asset(im):
            continue
        out[(sid, name)] = im
    return out


def approval_names_asset(im: dict) -> bool:
    a = im.get("approval")
    return isinstance(a, dict) and a.get("decision") == "approve" and bool(a.get("by")) and bool(a.get("at")) and a.get("asset") == im.get("asset")


def copy_assets(deck: dict, out_dir: Path, audience: str, src_dirs=(), sources: dict | None = None) -> dict:
    """Copy and derive ONLY the pictures a render of this audience draws (a client folder holds no byte of an unapproved or flagged
    picture). Originals go to ``<out_dir>/assets/<sha256>.<ext>`` (the asset's ``file``), derived JPEGs to ``assets/derived/``. Sources
    are looked for in ``src_dirs`` (the stages folder) by the asset's ``file``, or at the path recorded for a supplied picture. Returns
    ``{asset id: derived jpeg path}``."""
    import shutil
    assets, out = deck.get("assets") or {}, {}
    sources = sources or {}
    for (sid, name), im in sorted(drawn(deck, audience).items()):
        aid = im["asset"]
        if aid in out:
            continue
        rec = assets[aid]
        cands = [Path(sources[aid])] if aid in sources else []
        cands += [Path(d) / rec["file"] for d in src_dirs]
        src = next((c for c in cands if c.is_file()), None)
        if src is None:
            raise ImageError(f"the picture for {sid}.{name} ({rec['file']}) is not on disk: looked in {', '.join(map(str, cands)) or 'nowhere'}")
        if hashlib.sha256(src.read_bytes()).hexdigest() != rec["sha256"]:
            raise ImageError(f"{src} is not the picture the deck recorded for {aid} (its sha256 differs)")
        dst = Path(out_dir) / rec["file"]
        dst.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(src, dst)
        out[aid] = derived_jpeg(src, out_dir, rec["sha256"])
    return out


# -------------------------------------------------------------------------------------------------- CLI

def main(argv=None) -> int:
    ap = argparse.ArgumentParser(prog="python3 -m deck.images", description="Pictures on a Deck Maker deck (engine half).")
    sub = ap.add_subparsers(dest="cmd", required=True)
    ap_a = sub.add_parser("approve", help="the one click: approve every clean picture of one territory, by a person")
    ap_a.add_argument("--review", required=True, type=Path, help="the review JSON to write (created when missing): {pinned, images}")
    ap_a.add_argument("--deck", required=True, type=Path, help="deck.json of a build made with --pictures")
    ap_a.add_argument("--territory", required=True, help="the territory id, as in c_territories.json")
    ap_a.add_argument("--by", required=True, help="the approver: human:<id>")
    a = ap.parse_args(argv)
    try:
        deck = json.loads(a.deck.read_text())
        review = json.loads(a.review.read_text()) if a.review.is_file() else {}
        res = approve_territory(review, deck, a.territory, a.by)
    except ImageError as e:
        print(f"refused: {e}", file=sys.stderr)
        return 2
    a.review.write_text(json.dumps(review, indent=1, ensure_ascii=False))
    print(f"approved {len(res['approved'])} picture(s) of {a.territory}: " + ", ".join(f"{s}.{n}" for s, n in res["approved"]))
    for s, n, why in res["skipped"]:
        print(f"  skipped {s}.{n}: {why}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
