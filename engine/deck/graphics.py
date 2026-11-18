"""Deck graphics (features/deck-graphics.clan): native-shape graphics that only draw what the deck already says.

Slice 1 is icons. A Lucide icon (a 72-icon allow-list vendored as path data in vendor/icons/icons.json, lucide-static 1.75.0,
ISC + MIT for the Feather-derived ones) is drawn as ONE native PowerPoint freeform: a ``p:sp`` whose ``a:custGeom`` holds every
sub-path (moveTo, lnTo, cubicBezTo, close on a 24000 grid), no fill, a round-capped, round-joined line in the ink token, named
'Icon: <id>' and marked decorative. The web draws the same path data as inline SVG.

The icon is chosen by a FIXED keyword map (policy/icons.yaml), never by a model: whole words of an item's heading only, plurals
folded, a longer keyword winning over a shorter one inside it; a heading that matches two different icons gets none; and a group
gets icons only when every item matched and no two items share an icon (all-or-none, no fallback glyph). Icons are off unless
spec.GRAPHICS (DECK_GRAPHICS=1 with DECK_LOOK_V3=1); a deck type's recipe may turn them off (tender_response: ``graphics.icons:
false``), and so may the deck's own ``meta.preferences.look.graphics.icons``. Nothing in this module runs with the flag off.

Stdlib + PyYAML.
"""
from __future__ import annotations

import functools
import json
import re
from pathlib import Path

from . import spec
from . import theme as themes

DIR = Path(__file__).resolve().parent
ICONS_JSON = DIR / "vendor" / "icons" / "icons.json"
ICONS_POLICY = DIR / "policy" / "icons.yaml"

#: Never an icon: brands, platforms, products, awards and trophies (the vendor script refuses these ids and any id that starts with
#: one plus '-'; a test repeats it). Lucide 1.x ships no brand icon; this is the belt to that braces.
ICON_DENY = ("facebook", "instagram", "twitter", "x-twitter", "linkedin", "youtube", "tiktok", "snapchat", "pinterest", "whatsapp",
             "telegram", "reddit", "discord", "twitch", "spotify", "apple", "android", "google", "chrome", "chromium", "firefox", "safari",
             "microsoft", "windows", "amazon", "netflix", "slack", "figma", "framer", "github", "gitlab", "codepen", "codesandbox",
             "dribbble", "trello", "meta", "paypal", "stripe", "uber", "airbnb", "dropbox", "award", "trophy", "medal", "crown")
#: Sizes in inches (design.icons.size): table rows 0.42, statement / grid points 0.5, journey and process 0.36; never under 0.3.
ICON_ROW_IN, ICON_POINT_IN, ICON_STEP_IN, ICON_MIN_IN = 0.42, 0.5, 0.36, 0.3
#: The space between an icon and the words beside or under it.
ICON_GAP_IN = 0.15
#: Slide types whose table rows may carry icons (design.icons.layouts: channel roles). Never a table of numbers or measures.
ICON_ROW_TYPES = ("channel_roles",)
#: A group needs at least this many items: one icon beside one row is decoration, not a pattern.
ICON_GROUP_MIN = 2
#: WCAG non-text contrast: an icon stroke against its ground.
ICON_CONTRAST = 3.0
#: The decorative mark (Office 2019+): screen readers skip the shape; the words beside it carry the meaning.
DECORATIVE_URI = "{C183D7F6-B498-43B3-948B-1728B52AA6E4}"
DECORATIVE_NS = "http://schemas.microsoft.com/office/drawing/2017/decorative"
GRID = 24          # Lucide's grid
PATH_UNITS = 24000 # the custGeom path box (w = h)


# ---------------------------------------------------------------- the vendored icons and the keyword map

@functools.lru_cache(maxsize=1)
def icons() -> dict:
    """``{id: {"paths": [[cmd, ...], ...], "feather": bool}}`` (read once, only when an icon is wanted)."""
    return json.loads(ICONS_JSON.read_text(encoding="utf-8"))


@functools.lru_cache(maxsize=1)
def keyword_map() -> dict:
    """``{icon id: [keyword, ...]}`` from policy/icons.yaml."""
    import yaml   # noqa: PLC0415
    return dict(yaml.safe_load(ICONS_POLICY.read_text(encoding="utf-8"))["icons"])


def fold(word: str) -> str:
    """A word with its plural folded (stories -> story, boxes -> box, channels -> channel); words of three letters or fewer and words
    ending in 'ss' or 'us' are kept as they are (press, bus, campus)."""
    w = word.lower()
    if len(w) <= 3 or w.endswith(("ss", "us", "is")):
        return w
    if w.endswith("ies") and len(w) > 4:
        return w[:-3] + "y"
    if w.endswith(("ches", "shes", "xes", "sses")):
        return w[:-2]
    if w.endswith("s"):
        return w[:-1]
    return w


def words(text: str) -> list:
    """Whole words of ``text``, lower-cased, split on anything that is not a letter or a digit, plurals folded."""
    return [fold(w) for w in re.findall(r"[a-z0-9]+", str(text).lower())]


@functools.lru_cache(maxsize=1)
def _phrases() -> list:
    """``[(word tuple, icon id)]`` for every keyword, longest first."""
    out = []
    for iid, kws in keyword_map().items():
        for k in kws:
            w = tuple(words(k))
            if w:
                out.append((w, iid))
    return sorted(out, key=lambda x: -len(x[0]))


def icon_for(heading: str) -> str | None:
    """The one icon a heading names, or None (no keyword, or keywords of two different icons: ambiguous). A keyword inside a longer
    matched keyword does not count on its own ('out of home' is outdoor, not home)."""
    ws = words(heading)
    if not ws:
        return None
    taken = [False] * len(ws)
    hits = set()
    for kw, iid in _phrases():
        n = len(kw)
        for i in range(len(ws) - n + 1):
            if tuple(ws[i:i + n]) == kw and not any(taken[i:i + n]):
                hits.add(iid)
                for j in range(i, i + n):
                    taken[j] = True
    return next(iter(hits)) if len(hits) == 1 else None


def choose(headings: list) -> list | None:
    """All-or-none for one group: the icons of ``headings`` in order, or None when any heading has none, two share one, or the group
    is smaller than ICON_GROUP_MIN."""
    if len(headings) < ICON_GROUP_MIN:
        return None
    got = [icon_for(h) for h in headings]
    if any(g is None for g in got) or len(set(got)) != len(got):
        return None
    return got


# ---------------------------------------------------------------- when icons are on

def deck_type(deck: dict) -> str | None:
    meta = deck.get("meta") or {}
    return ((meta.get("built_from") or {}).get("type")) or ((meta.get("profile") or {}).get("id"))


@functools.lru_cache(maxsize=16)
def _type_icons(pid: str | None) -> bool:
    """A deck type's recipe preference ``graphics.icons`` (default on). tender_response sets it off (evaluators read; decoration
    costs room). Read from the profile itself, so it holds with or without spec.RECIPES."""
    if not pid:
        return True
    try:
        from . import profiles   # noqa: PLC0415
        g = ((profiles.load(pid).get("recipe") or {}).get("graphics")) or {}
    except Exception:
        return True
    return bool(g.get("icons", True))


def icons_on(deck: dict) -> bool:
    """Icons are drawn: spec.GRAPHICS, the deck type's recipe allows them, and the deck's own preference does not turn them off."""
    if not spec.GRAPHICS:
        return False
    pref = (((deck.get("meta") or {}).get("preferences") or {}).get("look") or {}).get("graphics") or {}
    if pref.get("icons") is False:
        return False
    return _type_icons(deck_type(deck))


def row_headings(s: dict, rows: list) -> list | None:
    """The headings of a table's body rows (each row's first cell) when the slide type takes row icons, else None."""
    if s.get("type") not in ICON_ROW_TYPES or not rows:
        return None
    return [str(r[0]).strip() if r else "" for r in rows]


def point_headings(bl: list) -> list:
    """One heading per statement point, in layouts.statement_points' order: a kv key, a card's title, a bullet's first four words;
    a text, statement or quote point has none (so its group takes no icons). The 'Illustrative line' caption is not a point."""
    out, last_italic = [], False
    for b in bl:
        k = b.get("kind")
        if k == "small" and b.get("basis") == "meta" and b.get("text") == spec.ILLUSTRATIVE_QUOTE and out and last_italic:
            continue
        if k == "bullets":
            for i in b.get("items") or []:
                t = (i.get("text") if isinstance(i, dict) else i) or ""
                if str(t).strip():
                    out.append(" ".join(str(t).split()[:4]))
                    last_italic = False
        elif k == "kv":
            for i in b.get("items") or []:
                if str(i[1]).strip():
                    out.append(str(i[0]).strip())
                    last_italic = False
        elif str(b.get("text", "")).strip():
            out.append(str(b.get("title", "")).strip() if k == "card" else "")
            last_italic = k == "quote"
    return out


def stroke_ok(stroke: str, ground: str) -> bool:
    """WCAG non-text contrast: the icon's stroke is 3:1 or better against its ground."""
    return themes.contrast(stroke, ground) >= ICON_CONTRAST


def line_pt(size_in: float) -> float:
    """The stroke weight for an icon ``size_in`` inches wide: Lucide's 2 on 24 at 1.75 / 2 of it, floor 1 pt, cap 2 pt."""
    return round(max(1.0, min(2.0, size_in * 72 / GRID * 1.75)), 2)


# ---------------------------------------------------------------- drawing: one native freeform (pptx), inline SVG (web)

def _u(v: float) -> int:
    return int(round(v * PATH_UNITS / GRID))


def path_xml(iid: str) -> str:
    """The ``a:pathLst`` of one icon: an ``a:path`` per sub-path (w = h = 24000, fill none), absolute moveTo / lnTo / cubicBezTo / close."""
    out = []
    for sub in icons()[iid]["paths"]:
        segs = []
        for c in sub:
            op, v = c[0], c[1:]
            if op == "M":
                segs.append(f'<a:moveTo><a:pt x="{_u(v[0])}" y="{_u(v[1])}"/></a:moveTo>')
            elif op == "L":
                segs.append(f'<a:lnTo><a:pt x="{_u(v[0])}" y="{_u(v[1])}"/></a:lnTo>')
            elif op == "C":
                segs.append("<a:cubicBezTo>" + "".join(f'<a:pt x="{_u(v[j])}" y="{_u(v[j + 1])}"/>' for j in (0, 2, 4)) + "</a:cubicBezTo>")
            elif op == "Z":
                segs.append("<a:close/>")
        out.append(f'<a:path w="{PATH_UNITS}" h="{PATH_UNITS}" fill="none">{"".join(segs)}</a:path>')
    return "<a:pathLst>" + "".join(out) + "</a:pathLst>"


def icon_xml(shape_id: int, iid: str, x_emu: int, y_emu: int, size_emu: int, color: str, size_in: float) -> str:
    """One icon as a ``p:sp`` element (XML text, namespaces declared): custGeom stroke-only freeform, decorative, named 'Icon: <id>'."""
    if iid not in icons():
        raise KeyError(f"no vendored icon {iid!r}")
    w = int(round(line_pt(size_in) * 12700))
    color = color.lstrip("#").upper()
    return (
        '<p:sp xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" '
        'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">'
        f'<p:nvSpPr><p:cNvPr id="{shape_id}" name="Icon: {iid}" descr="">'
        f'<a:extLst><a:ext uri="{DECORATIVE_URI}"><adec:decorative xmlns:adec="{DECORATIVE_NS}" val="1"/></a:ext></a:extLst>'
        '</p:cNvPr><p:cNvSpPr/><p:nvPr/></p:nvSpPr>'
        f'<p:spPr><a:xfrm><a:off x="{x_emu}" y="{y_emu}"/><a:ext cx="{size_emu}" cy="{size_emu}"/></a:xfrm>'
        '<a:custGeom><a:avLst/><a:gdLst/><a:ahLst/><a:cxnLst/><a:rect l="l" t="t" r="r" b="b"/>'
        f'{path_xml(iid)}</a:custGeom><a:noFill/>'
        f'<a:ln w="{w}" cap="rnd"><a:solidFill><a:srgbClr val="{color}"/></a:solidFill><a:round/></a:ln>'
        '</p:spPr></p:sp>')


def svg_d(iid: str) -> str:
    """The icon's path data as one SVG ``d`` (absolute commands, the same numbers the pptx draws)."""
    parts = []
    for sub in icons()[iid]["paths"]:
        for c in sub:
            parts.append(c[0] + " ".join(f"{v:g}" for v in c[1:]))
    return "".join(parts)


def icon_svg(iid: str, size_in: float, cls: str = "icon") -> str:
    """Inline SVG for the web: the same path data, stroke=currentColor (the text token), the same weight, aria-hidden."""
    sw = round(line_pt(size_in) / 72 / size_in * GRID, 3)
    px = round(size_in * 144)
    return (f'<svg class="{cls}" data-icon="{iid}" width="{px}" height="{px}" viewBox="0 0 24 24" fill="none" stroke="currentColor" '
            f'stroke-width="{sw:g}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">'
            f'<path d="{svg_d(iid)}"/></svg>')


# ================================================================================================ execution frames (slice 2)
# A pictured execution is shown in place: a frame DRAWN by us from a few native shapes in the ink token (no licensed template, no real
# device, street, shop or logo), whose window takes the picture's format aspect exactly. A Production typed size keeps its own format's
# aspect (vendor/format-packs.json, else its own pixels), so it is never cropped; a generated or supplied picture takes the frame's
# default format (spec.FRAME_FORMATS) and is cropped to it around its focal point. The frame carries the fixed label spec.MOCKUP_LABEL.

PACKS_JSON = DIR / "vendor" / "format-packs.json"
FRAME_KINDS = tuple(spec.FRAME_FORMATS)
#: Window aspects within this ratio of 9:16 fill a phone's screen; any other social or film shape sits as a feed card on a blank screen.
PHONE_FILL_TOL = 1.06


@functools.lru_cache(maxsize=1)
def pack_formats() -> dict:
    """``{format id: {channel, kind, w, h}}`` from the pinned format packs (the copy deck.from_production already reads)."""
    out = {}
    for p in json.loads(PACKS_JSON.read_text(encoding="utf-8")).get("packs") or []:
        for f in p.get("formats") or []:
            if f.get("width") and f.get("height"):
                out.setdefault(f["id"], {"channel": f.get("channel"), "kind": f.get("kind"), "w": float(f["width"]), "h": float(f["height"])})
    return out


def frame_kind(channel: str | None, ratio: float, format_id: str | None = None) -> str | None:
    """The frame a picture of ``ratio`` (width / height) for ``channel`` is shown in (design.mockups.frames), or None (no frame)."""
    fid = (format_id or "").lower()
    if channel == "ooh":
        if ratio >= 3.0 or "bus" in fid:
            return "strip"
        return "billboard" if ratio >= 1.3 else "poster_portrait"
    if channel in ("social", "film"):
        if channel == "film" and ratio >= 1.3:
            return "screen"
        return "phone" if ratio < 1.3 else "screen"
    if channel == "print":
        return "spread" if ratio >= 1.2 or "dps" in fid else "poster_portrait"
    if channel == "display":
        return "strip"
    return None


def frame_of(deck: dict, title: str, im: dict) -> dict | None:
    """``{kind, ratio, production, format_id}`` for an execution's picture, or None when it takes no frame (a channel with no frame, or
    no channel named). A Production picture: its format's aspect from the packs (else its own pixels), never cropped. Anything else: the
    default format of the frame its channel takes (spec.FRAME_OF_CHANNEL, spec.FRAME_FORMATS)."""
    from . import images   # noqa: PLC0415
    rec = (deck.get("assets") or {}).get(im.get("asset")) or {}
    src = rec.get("source") or {}
    prod = (im.get("from") or {}).get("kind") == "production"
    if prod:
        fid = src.get("format_id")
        f = pack_formats().get(fid or "")
        if f:
            ratio, ch = f["w"] / f["h"], src.get("channel") or f["channel"]
        elif rec.get("width") and rec.get("height"):
            ratio, ch = rec["width"] / rec["height"], src.get("channel") or images.execution_channel(title)
        else:
            return None
        if src.get("role") == "frame":
            ch = "film"
        kind = frame_kind(ch or images.execution_channel(title), ratio, fid)
        return {"kind": kind, "ratio": ratio, "production": True, "format_id": fid} if kind else None
    ch = images.execution_channel(title)
    kind = spec.FRAME_OF_CHANNEL.get(ch or "")
    if not kind:
        return None
    f = pack_formats()[spec.FRAME_FORMATS[kind]]
    return {"kind": kind, "ratio": f["w"] / f["h"], "production": False, "format_id": spec.FRAME_FORMATS[kind]}


def frame_geometry(kind: str, ratio: float, x: float, y: float, w: float, h: float) -> dict:
    """The frame of ``kind`` around a window of aspect ``ratio``, contained in the box ``x, y, w, h`` (inches) and centred in it:
    ``{"window": (x, y, w, h), "outer": (x, y, w, h), "parts": [(role, shape, x, y, w, h)]}`` where shape is ``rect``, ``rrect`` (a
    rounded body) or ``screen`` (the blank screen behind a feed card) and role names the part. Pure geometry: the window's aspect is
    exactly ``ratio``; the frame never leaves the box."""
    ww, wh = (ratio, 1.0)   # window in units: height 1
    parts, win = [], (0.0, 0.0, ww, wh)
    b = 0.045 * min(ww, wh)
    if kind == "phone":
        if 9 / 16 / PHONE_FILL_TOL < ratio < 9 / 16 * PHONE_FILL_TOL:   # a 9:16 picture fills the screen
            sw, sh, screen = ww, wh, None
        else:   # a feed card on a blank 9:16 screen with two grey bars (no platform chrome, no words)
            sw, sh = 1.0, 16 / 9
            cw = 0.92
            ch_ = cw / ratio
            if ch_ > sh * 0.66:
                ch_ = sh * 0.66
                cw = ch_ * ratio
            win = ((sw - cw) / 2, (sh - ch_) / 2, cw, ch_)
            screen = (0.0, 0.0, sw, sh)
        b = 0.07 * sw
        parts.append(("bezel", "rrect", -b, -b, sw + 2 * b, sh + 2 * b))
        if screen:
            parts.append(("screen", "screen", *screen))
            parts.append(("bar", "bar", win[0], win[1] - 0.06 * sh, sw * 0.38, 0.025 * sh))
            parts.append(("bar", "bar", win[0], win[1] + win[3] + 0.035 * sh, sw * 0.6, 0.025 * sh))
    elif kind == "poster_portrait":
        parts.append(("bezel", "rect", -b, -b, ww + 2 * b, wh + 2 * b))
        nw, nh = 0.3 * ww, 0.14 * wh
        parts.append(("stand", "rect", (ww - nw) / 2, wh + b, nw, nh))
        parts.append(("foot", "rect", -0.1 * ww, wh + b + nh, 1.2 * ww, max(b * 0.6, 0.018 * wh)))
    elif kind == "billboard":
        parts.append(("bezel", "rect", -b, -b, ww + 2 * b, wh + 2 * b))
        pw, ph = 0.03 * ww, 0.24 * wh
        for fx in (0.17, 0.8):
            parts.append(("post", "rect", fx * ww, wh + b, pw, ph))
    elif kind == "screen":
        parts.append(("bezel", "rect", -b, -b, ww + 2 * b, wh + 2 * b))
        parts.append(("stand", "rect", ww * 0.46, wh + b, ww * 0.08, 0.07 * wh))
        parts.append(("foot", "rect", ww * 0.36, wh + b + 0.07 * wh, ww * 0.28, max(b * 0.6, 0.025 * wh)))
    elif kind == "spread":
        b = 0.018 * min(ww, wh)
        parts.append(("bezel", "rect", -b, -b, ww + 2 * b, wh + 2 * b))
        parts.append(("gutter", "gutter", ww / 2, 0.0, 0.0, wh))
    else:   # strip: a plain bezel at the true aspect (no bus, no web page)
        b = 0.06 * min(ww, wh)
        parts.append(("bezel", "rect", -b, -b, ww + 2 * b, wh + 2 * b))
    xs = [p[2] for p in parts] + [win[0]]
    ys = [p[3] for p in parts] + [win[1]]
    xe = [p[2] + p[4] for p in parts] + [win[0] + win[2]]
    ye = [p[3] + p[5] for p in parts] + [win[1] + win[3]]
    x0, y0, x1, y1 = min(xs), min(ys), max(xe), max(ye)
    s = min(w / (x1 - x0), h / (y1 - y0))
    ox = x + (w - (x1 - x0) * s) / 2 - x0 * s
    oy = y + (h - (y1 - y0) * s) / 2 - y0 * s
    tf = lambda px, py, pw, ph: (ox + px * s, oy + py * s, pw * s, ph * s)   # noqa: E731
    return {"window": tf(*win), "outer": tf(x0, y0, x1 - x0, y1 - y0), "parts": [(r, sh, *tf(*p)) for r, sh, *p in parts]}


# ================================================================================================ the storyboard strip (slice 3)

def strip_picks(frames: list) -> tuple:
    """``(picked, note)`` from a storyboard's placeable frames in shot order: all of them when 3 or 4; the first, the last and evenly
    spaced ones between when more (the note says '4 of 9 shots'); ``([], why)`` when fewer than spec.STRIP_MIN."""
    n = len(frames)
    if n < spec.STRIP_MIN:
        return [], f"{n} placeable storyboard frame(s): a strip needs {spec.STRIP_MIN}"
    if n <= spec.STRIP_MAX:
        return list(frames), ""
    k = spec.STRIP_MAX
    idx = sorted({round(i * (n - 1) / (k - 1)) for i in range(k)})
    return [frames[i] for i in idx], f"{k} of {n} shots"
