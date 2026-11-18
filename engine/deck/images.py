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
import math
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
    t, title = spec.picture_of(slide)   # a merged slide takes the slots of the picture slide it absorbed (deck-look)
    if t not in SLOT_TABLE or t not in spec.PICTURE_SLIDE_TYPES:
        return []
    out = []
    for name, aspect, n in SLOT_TABLE[t]:
        if t == "execution":
            aspect = EXECUTION_ASPECT[spec.frame_for(title)]
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

#: Words that end a company name and say nothing about which company: 'Acme Ltd' is named by 'Acme'.
GENERIC_NAME_WORDS = {"ltd", "limited", "inc", "incorporated", "group", "plc", "llc", "co", "company", "corp", "corporation", "gmbh", "ag", "sa", "the"}


def name_forms(name: str) -> list:
    """The forms of a name that may not appear in a label or alt text: the whole name without its generic suffix ('Acme Ltd' gives 'acme'),
    and, for a name of several words, its first distinctive word ('Lumen Water' gives 'lumen'; 'water' alone stays allowed)."""
    words = [w for w in re.findall(r"[\w&'-]+", str(name or "").lower()) if w not in GENERIC_NAME_WORDS]
    if not words or str(name).strip().startswith("["):
        return []
    forms = [" ".join(words)]
    if len(words) > 1 and len(words[0]) >= 3:
        forms.append(words[0])
    return [f for f in forms if len(f) >= 3]


def digits_or_name(text: str, names=()) -> str | None:
    """Why this text may not label or describe a picture: it holds a digit (it could read as a figure) or one of ``names`` (the client's name,
    the agency's, a brand name; see name_forms), case-insensitively. None when the text is clean."""
    if re.search(r"\d", text or ""):
        return "it holds a digit, which could be read as a figure"
    low = (text or "").lower()
    for n in names:
        for f in name_forms(n):
            if re.search(r"(?<!\w)" + re.escape(f) + r"(?!\w)", low):
                return f"it names '{str(n).strip()}'"
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
    if path.stat().st_size > MAX_BYTES:   # the size is read from the file system first: a huge file is never read into memory
        raise ImageError(f"{path.name} is {path.stat().st_size // 1_000_000} MB: pictures over {MAX_BYTES // 1_000_000} MB are refused")
    raw = path.read_bytes()
    head = raw[:512].lstrip().lower()
    if path.suffix.lower() in (".svg", ".svgz") or head.startswith(b"<svg") or (head.startswith(b"<?xml") and b"<svg" in raw[:4096].lower()):
        raise ImageError(f"{path.name} is an SVG: it can carry script and words, so it is refused. Give a PNG, JPEG or WEBP")
    try:
        with Image.open(path) as im:   # the header only: width and height are known before any pixel is decoded
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
    with Image.open(src) as im:
        if im.size[0] * im.size[1] > MAX_PIXELS:   # a local check of width times height before any pixel is decoded
            raise ImageError(f"{Path(src).name} is over {MAX_PIXELS // 1_000_000} million pixels")
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
        im.save(tmp, format="JPEG", quality=DERIVED_QUALITY, optimize=True)   # no exif=, no icc_profile=: nothing of the original's metadata is written
        tmp.replace(dst)
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


def territories_sha(territories) -> str:
    """12 hex of the SHA-256 of stage c's territories as canonical JSON: frames.json records it, so frames made for other territories are refused."""
    blob = json.dumps(territories or [], sort_keys=True, ensure_ascii=False, separators=(",", ":"))
    return hashlib.sha256(blob.encode()).hexdigest()[:12]


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


def _slug(s: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", str(s).lower()).strip("-")[:40] or "x"


def anchors(deck: dict, territories=None) -> dict:
    """``{slide id: {type, ref}}``: the slide type plus a stable reference (the territory id, the execution's channel, the divider's number), never
    a slide id or position, so a reorder cannot move a picture to another slide."""
    by_name = {f"Territory: {t.get('name')}": t.get("id") for t in territories or []}
    out, n_div = {}, 0
    for sid in deck["order"]:
        s = deck["slides"][sid]
        t, title = spec.picture_of(s)   # a merged slide keeps the anchor of the picture slide it absorbed (deck-look)
        if t == "territory":
            ref = by_name.get(s.get("title")) or _slug(s.get("title", ""))
        elif t == "execution":
            ref = _slug(title)
        elif t == "appendix":
            n_div += 1
            ref = f"divider-{n_div}"
        elif t == "title":
            ref = "cover"
        else:
            ref = t
        out[sid] = {"type": t, "ref": ref}
    return out


def anchor_key(anchor: dict, slot: str) -> str:
    return f"{anchor['type']}:{anchor['ref']}.{slot}"


# -------------------------------------------------------------------------------------------------- generated.json

def load_generated(stages: Path) -> dict | None:
    """``<stages>/generated.json`` (written by deck.imagegen), or None. Read only when run_deck is given --pictures."""
    p = Path(stages) / "generated.json"
    if not p.is_file():
        return None
    g = json.loads(p.read_text())
    if g.get("stage") != "generated" or not isinstance(g.get("pictures"), dict):
        raise ImageError(f"{p} is not a generated stage file")
    return g


def bind_generated(deck: dict, generated: dict, territories=None, names=(), words: str | None = None) -> dict:
    """Fill the EMPTY picture slots from generated.json, by anchor (the slide type and its stable reference). Frames and uploads placed
    earlier are never replaced. A hero (tier hero) becomes the slot's ``candidate``: the slot keeps its approved draft. Returns ``{bound, candidates}``."""
    anc = anchors(deck, territories)
    got = {"bound": 0, "candidates": 0}
    if generated.get("words") != words:   # ``words``: the deck's words hash, from the one shared function (the caller computes it)   # made for other words (a word was edited since): none of it is bound
        got["stale"] = len(generated.get("pictures") or {})
        return got
    by_anchor = {}
    for sid, a in anc.items():
        by_anchor.setdefault((a["type"], a["ref"]), sid)
    safe = (generated.get("safe_messaging") or {})
    style_hash = (generated.get("style") or {}).get("hash")
    items = sorted(generated["pictures"].values(), key=lambda x: 0 if x.get("tier") == "draft" else 1)
    for pic in items:
        sid = by_anchor.get((pic["anchor"]["type"], pic["anchor"]["ref"]))
        if sid is None:
            continue
        s = deck["slides"][sid]
        slots = _slots(s)
        slot = pic["slot"]
        aid = "img_" + pic["sha256"][:12]
        g = pic.get("guard") or {}
        rec = {"sha256": pic["sha256"], "file": pic["file"], "mime": pic["mime"], "width": pic["width"], "height": pic["height"], "rights": "generated",
               "guard": {"checked": bool(g.get("checked")), "by": "ollama:unrecorded" if g.get("checked") else "not checked", "flagged": bool(g.get("flagged")),
                         **({"found": g["found"]} if g.get("found") else {}), **({"reason": str(g["reason"])[:REASON_MAX]} if g.get("reason") else {})},
               "made": {k: v for k, v in (("provider", "runway"), ("model", pic.get("model")), ("task", pic.get("task")), ("at", pic.get("at")),
                                           ("credits", pic.get("credits"))) if v not in (None, "")}}
        cur = (slots.get(slot) or {}).get("image")
        if pic.get("tier") == "hero":
            if not (isinstance(cur, dict) and cur.get("asset") and cur["asset"] != aid and cur.get("from", {}).get("kind") == "generated"):
                continue
            register_assets(deck, {aid: rec})
            cur["candidate"] = {"asset": aid, "job": pic["job"]}
            got["candidates"] += 1
            continue
        if cur is not None and (cur.get("status") != "empty" or (cur.get("from") or {}).get("kind") in ("upload", "territory_frame", "brand", "production")):
            continue
        subject = str(pic.get("subject") or "")[:SUBJECT_MAX]
        try:
            alt = make_alt(f"{'Illustration' if pic.get('kind') == 'illustration' else 'Photo'}: " + (re.split(r"[,;.]", subject, 1)[0].strip()[:110] or "a picture"), names)
        except ImageError:
            alt = "An illustrative picture"
        image = {"kind": pic.get("kind") if pic.get("kind") in ("photo", "illustration") else "photo", "status": "flagged" if g.get("flagged") else "made",
                 "aspect": pic["aspect"], "basis": "creative", "asset": aid, "from": {"kind": "generated", "key": pic["job"]}, "alt": alt,
                 "attempts": min(2, int(pic.get("attempt") or 1))}
        if subject:
            image["subject"] = subject
        if pic.get("prompt") and len(pic["prompt"]) <= PROMPT_MAX:
            image["prompt"] = pic["prompt"]
        if g.get("flagged") and g.get("reason"):
            image["reason"] = str(g["reason"])[:REASON_MAX]
        sh = pic.get("style_hash") or style_hash
        if sh and re.fullmatch(r"[0-9a-f]{8}", str(sh)):
            image["style"] = {"hash": sh}
        if safe.get("applies"):
            image["guards"] = {"safe_messaging": {"packs": list(safe.get("packs") or []), "reviewed": safe.get("reviewed")}}
        register_assets(deck, {aid: rec})
        slots[slot] = {"kind": "image", "image": image}
        got["bound"] += 1
    return got


# -------------------------------------------------------------------------------------------------- production.json (deck-prod-assets)

PRODUCTION_APP = "ie.napkin.production-tool"
#: What an execution's channel accepts from Production's format channels (format-packs.json): a poster takes OOH or print.
PRODUCTION_ACCEPTS = {"social": ("social",), "ooh": ("ooh", "print"), "print": ("print", "ooh"), "display": ("display",)}
#: Every size, of the slot's channel or of a format the pinned packs do not know (fix 7), must sit within this ratio of the slot's aspect:
#: a 7.8:1 OOH banner never lands in a 4:5 poster slot, nor a 2:7 skyscraper in a 16:9 one. Nothing fits: the slot stays empty, with why.
ASPECT_TOL = 1.25
NEAREST_ASPECT_TOL = ASPECT_TOL
PRODUCTION_ALT = {"master": "The campaign's key visual", "size": "The campaign picture made for this channel", "frame": "A storyboard frame from the film"}
_FILM_WORDS = ("film", "tv", "television", "cinema", "broadcast", "bvod", "video", "youtube")
_PRINT_WORDS = ("print", "press", "magazine", "newspaper")
_DISPLAY_WORDS = ("display", "banner", "programmatic")


def load_production(stages: Path) -> dict | None:
    """``<stages>/production.json`` (written by deck.from_production), or None. Read only when run_deck is given --production."""
    p = Path(stages) / "production.json"
    if not p.is_file():
        return None
    f = json.loads(p.read_text())
    if f.get("stage") != "production" or not isinstance(f.get("items"), dict) or f.get("contract_version") != "3":
        raise ImageError(f"{p} is not a production stage file (contract 3)")
    return f


def execution_channel(title: str) -> str | None:
    """The Production channel an execution's title names: social (a phone frame), ooh (a poster frame), film, print or display; None for
    a channel Production has no picture for (search, audio) or a title that names none."""
    fr = spec.frame_for(title or "")
    if fr == "phone":
        return "social"
    if fr == "poster":
        return "ooh"
    if fr in ("search", "audio"):
        return None
    t = (title or "").lower()
    for ch, words in (("film", _FILM_WORDS), ("print", _PRINT_WORDS), ("display", _DISPLAY_WORDS)):
        if any(re.search(rf"(?<!\w){w}(?!\w)", t) for w in words):
            return ch
    return None


def _newest(keys):
    return max(keys) if keys else None   # ULIDs sort by the time they were made


def keeps_protected(it: dict, aspect) -> bool:
    """Whether cropping this item to ``aspect`` around its focal point (crop_box, as the renderer does) keeps the whole of its protect
    boxes (``keep``: their union, as fractions of the picture) in view. The boxes, not only their centre: a wide subject in a tall slot
    is cut even when its centre is kept. An item with no boxes keeps nothing in particular, so any crop is fine."""
    k, w, h = it.get("keep"), it.get("width"), it.get("height")
    if not isinstance(k, dict) or not w or not h:
        return True
    x0, y0, x1, y1 = crop_box(int(w), int(h), aspect, it.get("focal"))
    return k["x0"] * w >= x0 - 1 and k["y0"] * h >= y0 - 1 and k["x1"] * w <= x1 + 1 and k["y1"] * h <= y1 + 1


def choose_master(prod: dict, brief_document_id: str | None = None) -> tuple:
    """``(key, set, why)`` of the key visual (Q9): the newest Format set linked to the deck's brief; when none links to it, a placeable
    key visual before one waiting for its rights, newest first. ``(None, None, why)`` when no set has a master."""
    items = prod.get("items") or {}
    sets = {fid: r for fid, r in (prod.get("format_sets") or {}).items() if r.get("master") in items}
    if not sets:
        return None, None, "no Format set in the export has a key visual"
    linked = [fid for fid, r in sets.items() if brief_document_id and (r.get("brief") or {}).get("document_id") == brief_document_id]
    if linked:
        fid = _newest(linked)
        return sets[fid]["master"], fid, "the newest Format set linked to this deck's brief"
    placeable = [fid for fid in sets if items[sets[fid]["master"]].get("rights") != "reference_only"]
    if placeable:
        fid = _newest(placeable)
        why = "no Format set links to this deck's brief: the newest set whose key visual can be placed"
        if _newest(list(sets)) != fid:
            why += " (a newer set's key visual waits for its rights)"
        return sets[fid]["master"], fid, why
    fid = _newest(list(sets))
    return sets[fid]["master"], fid, "no Format set links to this deck's brief and every key visual waits for its rights: the newest set"


def production_master(prod: dict, brief_document_id: str | None = None) -> str | None:
    """The key visual's item key (see choose_master), or None."""
    return choose_master(prod, brief_document_id)[0]


def production_size(prod: dict, channel: str, aspect: str, prefer_set: str | None = None, any_shape: bool = False) -> tuple:
    """``(key, why)``: the size for an execution slot. Sizes whose channel the execution accepts (a size of a format the pinned packs do
    not know only when the channel has none), within ASPECT_TOL of the slot's aspect and whose protect boxes the slot's crop keeps whole;
    a placeable one before one waiting for its rights, ready before flagged ('look'), the key visual's own set first, nearest the slot's
    aspect, newest last. Stale sizes never. ``(None, why)`` when sizes of the channel exist and none fits (the slot is left empty with
    that reason, never filled with a wrong shape); ``(None, None)`` when Production made nothing for the channel.

    ``any_shape`` (deck-graphics, spec.GRAPHICS): the size is shown WHOLE in a frame whose window takes its own format's aspect, so no
    shape is too far and no crop can cut a protect box: every size of the channel is a candidate, nearest the slot's aspect first; a
    channel whose only sizes are out of date ('stale') is held with that reason, never passed to a generated picture."""
    want = ratio(aspect)
    tol = math.log(ASPECT_TOL) if not any_shape else float("inf")
    acc = PRODUCTION_ACCEPTS.get(channel) or ()
    matched, nearest, off_shape, cut, stale = [], [], set(), 0, 0
    for k, it in (prod.get("items") or {}).items():
        if any_shape and it.get("role") == "size" and it.get("status") == "stale" and it.get("channel") in acc:
            stale += 1
        if it.get("role") != "size" or it.get("status") not in ("ready", "look") or not it.get("aspect"):
            continue
        ours, unknown = it.get("channel") in acc, it.get("channel") is None
        if not (ours or unknown):
            continue
        r = it["aspect"]["w"] / it["aspect"]["h"]
        dist = abs(math.log(r / want))
        if dist > tol:
            if ours:
                off_shape.add(f"{it['aspect']['w']}:{it['aspect']['h']}")
            continue
        if not any_shape and not keeps_protected(it, aspect):
            cut += 1 if ours else 0
            continue
        row = (it.get("rights") == "reference_only", it.get("status") != "ready", it.get("set") != prefer_set, round(dist, 4), k)   # a placeable picture first
        (matched if ours else nearest).append(row)
    if any_shape and stale and not matched:   # the channel's own sizes are all out of date: held, never a size of another format
        pool = []
    else:
        pool = matched or nearest
    if not pool:
        if any_shape and stale:
            return None, (f"Out of date in Production: its {channel} size(s) changed since they were made. Make them again in Production, "
                          f"or supply a picture")
        if not off_shape and not cut:
            return None, None
        parts = []
        if off_shape:
            parts.append(f"its {channel} size(s) are {', '.join(sorted(off_shape))}, too far from this {aspect} slot")
        if cut:
            parts.append(f"{cut} {channel} size(s) would lose part of their protected area in a {aspect} crop")
        return None, "No Production size fits: " + "; ".join(parts) + ". Make one in this shape in Production, or supply a picture"
    best = min(p[:4] for p in pool)
    return _newest([p[4] for p in pool if p[:4] == best]), None


def production_frame(prod: dict) -> str | None:
    """The one picked storyboard frame a film execution shows in v1 (fix 3): the newest storyboard's first shot (by rank) with a picked frame."""
    frames = {k: it for k, it in (prod.get("items") or {}).items() if it.get("role") == "frame" and it.get("shot_kind", "shot") == "shot"}
    sb = _newest([it.get("storyboard") or "" for it in frames.values()])
    first = sorted((str(it.get("shot_rank") or ""), k) for k, it in frames.items() if (it.get("storyboard") or "") == sb)
    return first[0][1] if first else None


def production_shots(prod: dict) -> list:
    """The newest storyboard's picked shot frames in shot order (Production's ``shot.rank``, a fractional index that sorts as a string; end
    cards left out; mock frames never reach production.json): ``[(shot number from 1, item key, placeable)]``. A rights-pending frame keeps
    its number and is not placeable."""
    frames = {k: it for k, it in (prod.get("items") or {}).items() if it.get("role") == "frame" and it.get("shot_kind", "shot") == "shot"}
    sb = _newest([it.get("storyboard") or "" for it in frames.values()])
    ordered = sorted((str(it.get("shot_rank") or ""), k) for k, it in frames.items() if (it.get("storyboard") or "") == sb)
    return [(n, k, frames[k].get("rights") != "reference_only" and frames[k].get("status", "ready") == "ready") for n, (_, k) in enumerate(ordered, 1)]


def production_storyboard(prod: dict) -> list:
    """The placeable frames of production_shots, in shot order: ``[item key]``."""
    return [k for _, k, ok in production_shots(prod) if ok]


def production_slot(prod: dict, key: str, aspect: str, names=()) -> tuple:
    """The slot value for one Production item and its asset record (None when the picture waits for its rights: an empty slot with the
    reason 'Rights to supply', never placed silently). The slot keeps a focal point, not pixels."""
    it = prod["items"][key]
    run = str((prod.get("bundle") or {}).get("clan_sha256") or "")[:12]
    base = {"kind": "frame" if it["role"] == "frame" else "illustration", "aspect": aspect, "basis": "creative",
            "from": {"kind": "production", "key": key, **({"run": run} if run else {})}}
    if it.get("rights") == "reference_only":
        why = it.get("rights_why") or f"{it.get('origin')} picture with no stated licence"
        return {"kind": "image", "image": {**base, "status": "empty", "reason": f"{spec.RIGHTS_TO_SUPPLY}: {why} in Production. Set own, licensed or "
                                                                               f"client_supplied to place it"[:REASON_MAX]}}, None
    aid = "img_" + it["sha256"][:12]
    image = {**base, "status": "flagged" if it.get("status") == "look" else "made", "asset": aid, "alt": make_alt(PRODUCTION_ALT[it["role"]], names)}
    if it.get("focal"):
        image["focal"] = {"x": float(it["focal"]["x"]), "y": float(it["focal"]["y"])}
    if it.get("status") == "look":
        image["reason"] = str(it.get("reason") or "Flagged by review in Production")[:REASON_MAX]
    src = {"app": PRODUCTION_APP, "project_id": (prod.get("project") or {}).get("id"), "entity": it["entity"], "role": it["role"],
           "version": it.get("version"), "origin": it.get("origin"), "bundle_sha256": it.get("bundle_sha256")}
    if it.get("job_id"):
        src["job_id"] = it["job_id"]
    if it.get("format", {}).get("format_id"):
        src["format_id"] = it["format"]["format_id"]
    if it.get("channel"):
        src["channel"] = it["channel"]
    asset = {"sha256": it["sha256"], "file": it["file"], "mime": it["mime"], "width": it["width"], "height": it["height"], "bytes": it.get("bytes", 0),
             "rights": it["rights"], "guard": {"checked": False, "by": "not checked", "flagged": False},
             "source": {k: v for k, v in src.items() if v not in (None, "")}}
    return {"kind": "image", "image": image}, asset


def bind_production(deck: dict, prod: dict, pictures: str = "creative_cover", names=(), brief_document_id: str | None = None) -> dict:
    """Fill picture slots from production.json (deck-prod-assets slice 2), by slide type and channel, after the supplied pictures and before
    the empty slots and the image step, so a filled slot (or one waiting for its rights) never reaches the generation plan. Cover (only with
    ``creative_cover``) and idea take the key visual; each execution the size its channel and aspect match, a film one storyboard frame.
    Territory slides never; no slide is added. A person's own picture (upload, brand) is kept; a territory frame's proposal gives way.
    A slot Production has pictures for but none of the right shape (aspect, or a crop that would cut its protect boxes) is left empty
    with the reason. Stamps ``meta.production``. Returns ``{placed, held: [{slide, slot, message}], kept, master: {key, set, why}}``."""
    got = {"placed": 0, "held": [], "kept": 0, "master": None}
    if pictures == "none":
        return got
    master, mset, mwhy = choose_master(prod, brief_document_id)
    got["master"] = {"key": master, "set": mset, "why": mwhy}
    run = str((prod.get("bundle") or {}).get("clan_sha256") or "")[:12]

    def unfit(aspect, why):
        return {"kind": "image", "image": {"kind": "illustration", "status": "empty", "aspect": aspect, "basis": "creative", "reason": why[:REASON_MAX],
                                           "from": {"kind": "production", **({"run": run} if run else {})}}}
    for sid in deck["order"]:
        s = deck["slides"][sid]
        t, title = spec.picture_of(s)
        for slot, aspect in slot_specs(s):
            key, why = None, None
            if (t == "title" and pictures == "creative_cover") or t == "idea":
                key = master if slot == "picture" else None
                if key and not keeps_protected(prod["items"][key], aspect):
                    key, why = None, (f"The key visual would lose part of its protected area in a {aspect} crop. Make a {aspect} size of it in "
                                      f"Production, or supply a picture")
            elif t == "execution" and slot == "picture":
                ch = execution_channel(title)
                if ch == "film":
                    key = production_frame(prod)
                    own = ((((s.get("slots") or {}).get(slot) or {}).get("image") or {}).get("from") or {}).get("kind") in ("upload", "brand")
                    if spec.GRAPHICS and not own:   # deck-graphics slice 3: 3 or 4 Production frames in shot order make a strip, all Production or none
                        from .graphics import strip_picks   # noqa: PLC0415
                        shots = production_shots(prod)
                        number = {k: n for n, k, _ in shots}
                        picks, note = strip_picks([k for _, k, ok in shots if ok])
                        if picks:
                            key = picks[0]
                            for i, fk in enumerate(picks, 1):
                                val, asset = production_slot(prod, fk, aspect, names)
                                if asset:
                                    register_assets(deck, {val["image"]["asset"]: asset})
                                    got["placed"] += 1
                                _slots(s)[f"shot_{i}"] = val
                            if len(picks) < len(shots):   # fewer drawn than the storyboard has: say so on the slide ('4 of 9 shots')
                                note = f"{len(picks)} of {len(shots)} shots"
                            s["strip"] = {"shots": [number[k] for k in picks], "of": len(shots), **({"note": note} if note else {})}
                            got.setdefault("strips", []).append({"slide": sid, "shots": len(picks), "note": note})
                elif ch:
                    key, why = production_size(prod, ch, aspect, mset, any_shape=bool(spec.GRAPHICS))
            if not key and not why:
                continue
            cur = (s.get("slots") or {}).get(slot)
            cur_im = cur.get("image") if isinstance(cur, dict) else None
            if isinstance(cur_im, dict) and (cur_im.get("from") or {}).get("kind") in ("upload", "brand") and cur_im.get("status") != "empty":
                got["kept"] += 1   # a person's own picture stays
                continue
            if not key:   # Production has pictures for this slot, none of the right shape: empty, with why, never a wrong crop
                _slots(s)[slot] = unfit(aspect, why)
                got["held"].append({"slide": sid, "slot": slot, "message": why[:REASON_MAX]})
                continue
            val, asset = production_slot(prod, key, aspect, names)
            if asset:
                register_assets(deck, {val["image"]["asset"]: asset})
                got["placed"] += 1
            else:
                got["held"].append({"slide": sid, "slot": slot, "message": val["image"]["reason"]})
            _slots(s)[slot] = val
    deck["meta"]["production"] = {"project_id": (prod.get("project") or {}).get("id"), "title": (prod.get("project") or {}).get("title"),
                                  "data_sha256": (prod.get("bundle") or {}).get("clan_sha256"), "offer_sha256": prod.get("offer_sha256"),
                                  "taken": 1, "at": prod.get("taken_at"), "how": "bundle", "placed": got["placed"], "held": len(got["held"])}
    return got


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
    used = {im.get("asset") for _, _, im in image_slots(deck)} | {(im.get("candidate") or {}).get("asset") for _, _, im in image_slots(deck)}
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
        if spec.picture_of(s)[0] not in spec.PICTURE_SLIDE_TYPES or spec.picture_of(s)[0] not in SLOT_TABLE:
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
        if spec.picture_of(s)[0] not in types:
            continue
        for name, aspect in slot_specs(s):
            if name not in (s.get("slots") or {}):
                _slots(s)[name] = {"kind": "image", "image": {"kind": "illustration", "status": "empty", "aspect": aspect, "basis": "creative",
                                                               "reason": "no picture yet: the territory run has none for this slide and none was supplied"}}
                n += 1
    return n


def stamp_review(deck: dict, review: dict | None, approver: str | None) -> dict:
    """Stamp a person's decisions on the slots. A decision counts only when it is ``approve``, its ``by`` equals the deck's approver (a
    ``human:<id>``), it names the slot's own asset and ``at`` is not empty; then the slot is ``approved`` and holds ``approval``. A ``replace`` or
    ``remove`` for the slot's own asset marks it ``rejected``. Decisions are read per asset, from ``review.assets.<asset id>`` (new) and from the
    older ``review.images.<slide>.<slot>`` entry (one more decision for the asset it names); the latest by ``at`` wins. Anything else is ignored:
    a changed picture returns to ``made`` (it has no approval). A picture made on a safe-messaging deck that the guard did not check cannot be
    approved. A hero ``candidate`` approved the same way replaces the draft (promoted, with a new approval); removed or replaced, it is dropped.
    Returns ``{approved, rejected, ignored, promoted, dropped}`` counts. With no approver nothing is stamped."""
    got = {"approved": 0, "rejected": 0, "ignored": 0, "promoted": 0, "dropped": 0}
    r = review if isinstance(review, dict) else {}
    imgs, by_asset = r.get("images") or {}, r.get("assets") or {}
    assets = deck.get("assets") or {}

    def valid(d, aid):
        return (isinstance(d, dict) and approver and APPROVER.match(approver) and d.get("by") == approver and d.get("asset", aid) == aid and d.get("at")
                and d.get("decision") in spec.IMAGE_DECISIONS)

    def latest(aid, sid, name):
        c = [x for x in ((imgs.get(sid) or {}).get(name), by_asset.get(aid)) if isinstance(x, dict)]
        good = [x for x in c if valid(x, aid)]
        if good:
            return max(good, key=lambda x: str(x["at"])), True
        return (c[0] if c else None), False

    for sid, name, im in image_slots(deck):
        cand = im.get("candidate")
        if isinstance(cand, dict):   # a hero beside the approved draft: only a person's approval of the CANDIDATE's own asset promotes it
            d, ok = latest(cand["asset"], sid, name)
            ca = assets.get(cand["asset"]) or {}
            if d is not None and ok and d["decision"] == "approve":
                gd = ca.get("guard") or {}
                safe = (im.get("guards") or {}).get("safe_messaging") is not None
                if gd.get("flagged") or (safe and not gd.get("checked")):
                    got["ignored"] += 1
                else:
                    im["asset"], im["status"] = cand["asset"], "approved"
                    im["approval"] = {k: d[k] for k in ("decision", "by", "at", "note") if d.get(k)} | {"asset": cand["asset"]}
                    im.pop("candidate", None)
                    im.pop("reason", None)
                    im["from"] = {"kind": "generated", "key": cand["job"]}
                    got["promoted"] += 1
                    continue
            elif d is not None and ok and d["decision"] in ("remove", "replace"):
                im.pop("candidate", None)
                got["dropped"] += 1
        if im.get("status") not in ("made", "flagged"):
            continue
        d, ok = latest(im.get("asset"), sid, name)
        if d is None:
            continue
        if not ok or (d.get("asset") is not None and d.get("asset") != im.get("asset")):
            got["ignored"] += 1
            continue
        if d["decision"] == "approve":
            safe = (im.get("guards") or {}).get("safe_messaging") is not None
            if safe and not ((assets.get(im["asset"]) or {}).get("guard") or {}).get("checked"):
                got["ignored"] += 1   # an unchecked picture on a safe-messaging deck is never approved
                continue
            im["status"] = "approved"
            im["approval"] = {"asset": im["asset"], **{k: d[k] for k in ("decision", "by", "at", "note") if d.get(k)}}
            im.pop("reason", None)
            got["approved"] += 1
        else:
            im["status"] = "rejected"
            im["reason"] = f"a person asked to {d['decision']} this picture"
            got["rejected"] += 1
    for k in ("promoted", "dropped"):   # the older three counts stay as they were unless a candidate was decided
        if not got[k]:
            del got[k]
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


def stamp_preferences(deck: dict, pictures: str, label: str, approver: str | None, hold: dict | None = None, style_hash: str | None = None,
                      generated: bool = False, cap_usd: float | None = None) -> None:
    """Record what the build used in ``meta.preferences`` (source ``person`` for what a flag set, ``default`` for the rest): the pictures
    choice, the source (only existing pictures: nothing generated) and the label; with ``hold``, ``style_pack.hold`` too (a Style Pack
    that could not be read: the build went on and the frames keep the style they were made in)."""
    prefs = deck["meta"].setdefault("preferences", {})
    prefs["pictures"] = {"on": pictures, "source": "person" if pictures != "creative_cover" else "default"}
    prefs["picture_source"] = ({"allow": "generated", "cap_usd": cap_usd if cap_usd is not None else spec.PICTURE_CAP_USD_DEFAULT, "source": "person"} if generated
                               else {"allow": "existing", "source": "default"})
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


def picture_label(im: dict, default: str) -> str:
    """The label a review render draws on a picture not yet approved: the fixed ``Production`` for a Production Tool picture (deck-prod-assets Q2),
    else the deck's own label (``Illustrative`` unless the person set another). The renderers place it by deck-look's rule, whatever the word."""
    return spec.PRODUCTION_LABEL if (im.get("from") or {}).get("kind") == "production" else default


def approval_names_asset(im: dict) -> bool:
    a = im.get("approval")
    return isinstance(a, dict) and a.get("decision") == "approve" and bool(a.get("by")) and bool(a.get("at")) and a.get("asset") == im.get("asset")


def wipe_outputs(out_dir: Path) -> None:
    """Remove what an earlier build left in a reused ``--out`` that could hold a picture: assets/, hyperframes/, png/ and the PDF. A build never
    ships bytes from another build (a client render into a folder an earlier review render used must hold no unapproved picture)."""
    import shutil
    for name in ("assets", "hyperframes", "png"):
        shutil.rmtree(Path(out_dir) / name, ignore_errors=True)
    (Path(out_dir) / "deck.pdf").unlink(missing_ok=True)


def wipe_stale(out_dir: Path) -> None:
    """Remove the repair loop's and the checks' files from an earlier build in a reused ``--out``, at the start of EVERY build: ``repair/`` (round pptx and pdf
    files that can hold unapproved pictures), ``repair.json``, ``issues.json`` and ``qa.json``. A build writes the ones it makes; none survives from another.
    ``repair_record.json`` stays: it is the replay's record, not an output."""
    import shutil
    shutil.rmtree(Path(out_dir) / "repair", ignore_errors=True)
    for name in ("repair.json", "issues.json", "qa.json"):
        (Path(out_dir) / name).unlink(missing_ok=True)


def copy_assets(deck: dict, out_dir: Path, audience: str, src_dirs=(), sources: dict | None = None) -> dict:
    """Derive (and for a review, copy) ONLY the pictures a render of this audience draws. Derived JPEGs go to ``<out_dir>/assets/derived/``: one
    per asset, re-encoded, so no EXIF, XMP, ICC or PNG text chunk of the original comes with it. A review also copies the original to
    ``<out_dir>/assets/<sha256>.<ext>`` (the asset's ``file``); a CLIENT folder holds no original at all, because an original can carry
    metadata (GPS position, camera, comments) the deck never asked to send. Sources are looked for in ``src_dirs`` (the stages folder)
    by the asset's ``file``, or at the path recorded for a supplied picture. Returns ``{asset id: derived jpeg path}``."""
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
        if audience != "client":
            dst = Path(out_dir) / rec["file"]
            dst.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(src, dst)
        out[aid] = derived_jpeg(src, out_dir, rec["sha256"])
    return out


def derived_path(asset: dict) -> str:
    """Where an asset's derived JPEG lives in a run folder (relative)."""
    return f"assets/derived/{asset['sha256']}-{DERIVED_PX}.jpg"


# -------------------------------------------------------------------------------------------------- text on a picture (deck-look)
#: deck-look step 7 (spec.LOOK_V3, Fable's Q7): words are set over a picture only on a zone the finder measured calm enough, under a
#: scrim whose alpha is solved, never guessed. Every text-over slot gets at least SCRIM_FLOOR and at most SCRIM_CAP (a heavier wash makes
#: the picture murky). The floor is a visual default, NOT a readability guarantee: computed, light text on a 40% dark scrim over a white
#: picture is 2.26:1, dark text on a 40% light scrim over black 2.61:1, and even a 60% scrim gives 3.94:1, all under AA. So the only
#: guarantee is the check at RENDER time (qa_render's p10 on a text-free render, an error under LOOK_V3); a picture a person swaps in later
#: (in PowerPoint) is never re-measured and cannot be guaranteed readable. The target is AA for body text plus a
#: margin (4.5 + 0.3), held even for the display sizes, so the render (re-measured by qa_render at its 10th percentile) clears AA.
#: A zone whose luminance s.d. is over BUSY_SD takes the cap (texture under words harms reading even when contrast passes); one whose
#: texture is still over BUSY_SD under the cap's wash ((1 - SCRIM_CAP) x s.d.) is refused. No zone passes: the slide keeps its words
#: beside the picture (picture_column) and the plan says so.
TEXT_OVER_TYPES = ("title", "idea", "real_question")
SCRIM_FLOOR, SCRIM_CAP, SCRIM_STEP = 0.40, 0.60, 0.01
TEXT_ON_PICTURE_TARGET = 4.8
BUSY_SD = 0.12
#: The picture box of a bleed layout (inches): the full slide width, from the top edge to the footer rule's strip (the footer, the
#: section and the page number stay on the slide's ground, never on the picture). The margin and the block the finder measures.
BLEED_W, BLEED_H, BLEED_M = 13.333, 6.85, 0.65
ZONE_BLOCK = (6.6, 3.2)
#: Candidate zones in the order a tie is broken (design.pictures.zone_finder): text sits bottom-left first, as Gamma's cover does.
ZONES = ("bottom_left", "top_left", "middle_left", "bottom_right", "top_right", "middle_right")
#: How far the scrim stays solid past the text block, and how far it fades to nothing toward the picture's centre (inches).
SCRIM_PAD, SCRIM_FADE = 0.5, 3.0
_THUMB_W = 160


def zone_box(zone: str, block: tuple = ZONE_BLOCK, W: float = BLEED_W, H: float = BLEED_H, M: float = BLEED_M) -> tuple:
    """``(x, y, w, h)`` in inches of the text block for ``zone`` on a bleed picture of ``W`` by ``H`` (the top zones sit under the DRAFT mark)."""
    bw, bh = block
    x = M if zone.endswith("_left") else W - M - bw
    y = {"bottom": H - 0.45 - bh, "top": 0.75, "middle": (H - bh) / 2}[zone.split("_")[0]]
    return (x, y, bw, bh)


def scrim_geometry(zone: str, box: tuple, W: float = BLEED_W, H: float = BLEED_H) -> dict:
    """The scrim for a text block at ``box``: ``{solid: (x, y, w, h), fade: (x, y, w, h), toward}``. Solid under the block plus SCRIM_PAD,
    fading to nothing over SCRIM_FADE toward the picture's centre: a bottom zone fades upward across the full width, a top zone downward,
    a middle zone sideways over the full height (no hard band edge on the picture)."""
    x, y, w, h = box
    v = zone.split("_")[0]
    if v == "bottom":
        top = max(0.0, y - SCRIM_PAD)
        return {"solid": (0.0, top, W, H - top), "fade": (0.0, max(0.0, top - SCRIM_FADE), W, top - max(0.0, top - SCRIM_FADE)), "toward": "up"}
    if v == "top":
        bot = min(H, y + h + SCRIM_PAD)
        return {"solid": (0.0, 0.0, W, bot), "fade": (0.0, bot, W, min(H, bot + SCRIM_FADE) - bot), "toward": "down"}
    if zone.endswith("_left"):
        r = min(W, x + w + SCRIM_PAD)
        return {"solid": (0.0, 0.0, r, H), "fade": (r, 0.0, min(W, r + SCRIM_FADE) - r, H), "toward": "right"}
    l = max(0.0, x - SCRIM_PAD)
    return {"solid": (l, 0.0, W - l, H), "fade": (max(0.0, l - SCRIM_FADE), 0.0, l - max(0.0, l - SCRIM_FADE), H), "toward": "left"}


def label_corner(zone: str) -> str:
    """The picture label's corner: diagonal to the text block (Q8)."""
    v, side = zone.split("_")
    return ("top" if v in ("bottom", "middle") else "bottom") + "_" + ("right" if side == "left" else "left")


def _lin(c: float) -> float:
    c /= 255.0
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


_LIN = [_lin(i) for i in range(256)]


def _rel_lum(rgb) -> float:
    r, g, b = (_LIN[max(0, min(255, int(round(v))))] for v in rgb)
    return 0.2126 * r + 0.7152 * g + 0.0722 * b


def _hex_rgb(h: str) -> tuple:
    h = h.lstrip("#")
    return (int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16))


def p10_contrast(pixels: list, text_rgb: tuple, scrim_rgb: tuple | None = None, alpha: float = 0.0) -> float:
    """The 10th-percentile WCAG contrast of ``text_rgb`` against ``pixels`` ((r, g, b) 0-255) under a scrim of ``scrim_rgb`` at ``alpha``,
    composited per channel in sRGB (as the PDF renderers composite a transparent fill), so the finder predicts what the render shows."""
    lt = _rel_lum(text_rgb)
    cs = []
    for px in pixels:
        c = px if not scrim_rgb or alpha <= 0 else tuple((1 - alpha) * p + alpha * s for p, s in zip(px, scrim_rgb))
        lb = _rel_lum(c)
        hi, lo = (lt, lb) if lt >= lb else (lb, lt)
        cs.append((hi + 0.05) / (lo + 0.05))
    if not cs:
        return 0.0
    cs.sort()
    return cs[int(0.10 * (len(cs) - 1))]


def _thumb(src, box_w: float, box_h: float, focal: dict | None):
    """The picture as it is cropped to a ``box_w`` by ``box_h`` box (cover, the recorded focal point), ``_THUMB_W`` pixels wide, RGB."""
    with Image.open(src) as im:
        im = ImageOps.exif_transpose(im).convert("RGB")
        c = im.crop(crop_box(im.width, im.height, box_w / box_h, focal))
        th = max(1, round(_THUMB_W * box_h / box_w))
        return c.resize((_THUMB_W, th), Image.BILINEAR)


def _zone_pixels(thumb, box: tuple, W: float, H: float) -> list:
    x, y, w, h = box
    tw, th = thumb.size
    x0, x1 = max(0, int(x / W * tw)), min(tw, int(round((x + w) / W * tw)))
    y0, y1 = max(0, int(y / H * th)), min(th, int(round((y + h) / H * th)))
    px = thumb.load()
    return [px[i, j] for j in range(y0, y1) for i in range(x0, x1)]


def text_zone(src, box: tuple = (BLEED_W, BLEED_H), focal: dict | None = None, block: tuple = ZONE_BLOCK, zones=ZONES,
              ink: str = "1B2430", paper: str = "FAF7F1", target: float = TEXT_ON_PICTURE_TARGET) -> dict:
    """The calm-zone finder and scrim solver (design.pictures.zone_finder), pure Pillow on a 160 px thumbnail, deterministic.

    For each candidate zone of the picture as cropped to ``box`` (inches): the words take the colour the zone already favours (ink on a
    light zone under a paper scrim, paper on a dark one under an ink scrim: the wash deepens the picture, never flips it), then the least
    scrim alpha from SCRIM_FLOOR to SCRIM_CAP at which the 10th-percentile per-pixel contrast under the block reaches ``target``. A zone
    whose luminance s.d. is over BUSY_SD starts at the cap; one still over BUSY_SD under the cap's wash is refused. Score = alpha + 2 x s.d., lowest wins, ties in
    ``zones`` order. Returns ``{zone, text, colour, alpha, p10, busy_sd, by}`` or, when no zone passes, ``{none: True, reason, best, by}``."""
    W, H = box
    thumb = _thumb(src, W, H, focal)
    ink_rgb, paper_rgb = _hex_rgb(ink), _hex_rgb(paper)
    best, tried = None, []
    for z in zones:
        pix = _zone_pixels(thumb, zone_box(z, block, W, H), W, H)
        if not pix:
            continue
        lums = [_rel_lum(p) for p in pix]
        mean = sum(lums) / len(lums)
        sd = (sum((v - mean) ** 2 for v in lums) / len(lums)) ** 0.5
        lp, li = _rel_lum(paper_rgb), _rel_lum(ink_rgb)   # the words take the colour with more contrast against the zone's mean luminance
        on_paper = (lp + 0.05) / (mean + 0.05) >= (mean + 0.05) / (li + 0.05)
        text, scrim = (paper, ink) if on_paper else (ink, paper)
        t_rgb, s_rgb = (paper_rgb, ink_rgb) if on_paper else (ink_rgb, paper_rgb)
        rec = {"zone": z, "text": text, "colour": scrim, "busy_sd": round(sd, 3)}
        if (1 - SCRIM_CAP) * sd > BUSY_SD:
            tried.append({**rec, "alpha": SCRIM_CAP, "p10": round(p10_contrast(pix, t_rgb, s_rgb, SCRIM_CAP), 2), "why": "too busy"})
            continue
        a = SCRIM_CAP if sd > BUSY_SD else SCRIM_FLOOR
        got = None
        while a <= SCRIM_CAP + 1e-9:
            c = p10_contrast(pix, t_rgb, s_rgb, a)
            if c >= target:
                got = (round(a, 2), round(c, 2))
                break
            a += SCRIM_STEP
        if got is None:
            tried.append({**rec, "alpha": SCRIM_CAP, "p10": round(p10_contrast(pix, t_rgb, s_rgb, SCRIM_CAP), 2), "why": "contrast"})
            continue
        cand = {**rec, "alpha": got[0], "p10": got[1], "by": "finder"}
        score = got[0] + 2 * sd
        if best is None or score < best[0] - 1e-9:
            best = (score, cand)
    if best:
        return best[1]
    top = max(tried, key=lambda r: r["p10"]) if tried else {}
    why = ("every zone is too busy under the words" if tried and all(t["why"] == "too busy" for t in tried)
           else f"no zone reaches {target:g}:1 at the {SCRIM_CAP:.0%} cap")
    return {"none": True, "reason": why, "best": {k: top[k] for k in ("zone", "text", "p10", "busy_sd") if k in top}, "by": "finder"}


def source_paths(deck: dict, audience: str, src_dirs=(), sources: dict | None = None) -> dict:
    """``{asset id: path}`` of the source file of every picture a render of this audience draws (found as ``copy_assets`` finds it; nothing
    is copied). A picture not on disk is left out (``copy_assets`` refuses it later, loudly)."""
    assets, out = deck.get("assets") or {}, {}
    for (_sid, _name), im in sorted(drawn(deck, audience).items()):
        aid = im["asset"]
        rec = assets.get(aid) or {}
        cands = ([Path((sources or {})[aid])] if aid in (sources or {}) else []) + [Path(d) / rec.get("file", "") for d in src_dirs if rec.get("file")]
        src = next((c for c in cands if c.is_file()), None)
        if src is not None:
            out[aid] = src
    return out


def solve_text_zones(deck: dict, paths: dict, ink: str = "1B2430", paper: str = "FAF7F1") -> list:
    """Run the finder on the picture slot of every slide of TEXT_OVER_TYPES whose picture is drawable (``paths`` holds its file) and record
    the answer on the slot as ``image.text_zone``; a slot already holding one keeps it (a repair or a person may pin it). Returns
    ``[(slide id, record)]``. The layout picker reads the record: a zone puts the words on the picture (cover_bleed, full_bleed_statement),
    none keeps them beside it and the plan reports the fallback."""
    out = []
    for sid in deck["order"]:
        s = deck["slides"][sid]
        sl = (s.get("slots") or {}).get("picture")
        im = (sl or {}).get("image") if isinstance(sl, dict) else None
        if s["type"] not in TEXT_OVER_TYPES or not isinstance(im, dict) or im.get("asset") not in paths:
            continue
        if not im.get("text_zone"):
            im["text_zone"] = text_zone(paths[im["asset"]], focal=im.get("focal"), ink=ink, paper=paper)
        out.append((sid, im["text_zone"]))
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
