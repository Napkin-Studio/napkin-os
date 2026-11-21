"""Deck graphics (features/deck-graphics.clan): native-shape graphics that only draw what the deck already says.

Slice 1 is icons. A Lucide icon (a 72-icon allow-list vendored as path data in vendor/icons/icons.json, lucide-static 1.75.0,
ISC + MIT for the Feather-derived ones) is drawn as ONE native PowerPoint freeform: a ``p:sp`` whose ``a:custGeom`` holds every
sub-path (moveTo, lnTo, cubicBezTo, close on a 24000 grid), no fill, a round-capped, round-joined line in the ink token, named
'Icon: <id>' and marked decorative. The web draws the same path data as inline SVG.

The icon is chosen by a FIXED keyword map (policy/icons.yaml), never by a model: whole words of an item's heading only, plurals
folded, a longer keyword winning over a shorter one inside it; a heading that matches two different icons gets none; and a group
gets icons only when every item matched and no two items share an icon (all-or-none, no fallback glyph). Icons are off unless
spec.GRAPHICS (DECK_GRAPHICS, on by default, read only with DECK_LOOK_V3 on); a deck type's recipe may turn them off (tender_response: ``graphics.icons:
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
#: Never an icon that makes a claim the words beside it do not (review fix): a direction, a verdict or an approval. Refused by the vendor
#: script and by a test, whatever the keyword map says.
ICON_CLAIMS = ("trending-up", "trending-down", "chart-line", "chart-no-axes-combined", "arrow-up", "arrow-down", "arrow-up-right", "arrow-down-right",
               "move-up", "move-down", "check", "circle-check", "square-check", "shield-check", "badge-check", "list-checks", "x", "circle-x", "ban",
               "thumbs-up", "thumbs-down", "star", "heart-crack", "circle-alert-check")
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


@functools.lru_cache(maxsize=32)
def _type_part(pid: str | None, part: str) -> bool:
    """A deck type's recipe switch ``graphics.<part>`` (default on). tender_response sets icons off (evaluators read; decoration costs
    room). Read from the profile itself, so it holds with or without spec.RECIPES."""
    if not pid:
        return True
    try:
        from . import profiles   # noqa: PLC0415
        g = ((profiles.load(pid).get("recipe") or {}).get("graphics")) or {}
    except Exception:
        return True
    return bool(g.get(part, True))


def part_on(deck: dict, part: str) -> bool:
    """A switchable part (profiles.GRAPHICS_PARTS: icons, mockups) is drawn: spec.GRAPHICS, the deck type's recipe allows it, and the
    deck's own ``meta.preferences.look.graphics.<part>`` does not turn it off. Charts and diagrams have no switch: they follow the deck's
    own data (a chart block, a steps block) and the fit, never a preference."""
    if not spec.GRAPHICS:
        return False
    pref = (((deck.get("meta") or {}).get("preferences") or {}).get("look") or {}).get("graphics") or {}
    if pref.get(part) is False:
        return False
    return _type_part(deck_type(deck), part)


def icons_on(deck: dict) -> bool:
    """Icons are drawn (part_on for 'icons')."""
    return part_on(deck, "icons")


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


# ================================================================================================ charts (slices 4-5)
# A chart is built ONLY from values the ledger holds: each point is {label, ref} with ref of kind fact or docfig; the value and unit
# are read from inp.facts / inp.doc_facts, never from stage text. Verified in code (slice 4): a research fact row is {id, version,
# status, entity, key, value, unit, as_of, sources} (research_facts.py, foundation-spec storage_model) and a document figure is
# {value, unit, label, as_of, page} (inputs.Inputs.doc_facts). Neither has a 'measure' or 'period' field: the measure is a fact's
# ``key`` and, for document figures, the document they come from; the period is the label (a year, a quarter, a month).

#: A category label that is a period: then the chart is a column (2 to 6) or a line (more), in the order the stage gave.
TIME_LABEL = re.compile(r"^(?:(?:19|20)\d\d(?:[/-]\d{2,4})?|(?:Q|H)[1-4](?:\s*(?:19|20)?\d\d)?|FY\s?\d{2,4}|"
                        r"(?:january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sep|sept|oct|nov|dec)\.?(?:\s+(?:19|20)?\d\d)?|"
                        r"(?:week|month|year|quarter|day|phase|stage)\s+\d{1,2})$", re.I)
CHART_FORMS = ("bar", "column", "line", "segmented")
CHART_MAX_CATEGORIES, CHART_MAX_SERIES, CHART_HERO_MAX = 8, 3, 2
#: The chart is never shrunk under this plot height (inches) or this label size (pt): the fit ladder switches first.
CHART_MIN_PLOT_IN, CHART_MIN_LABEL_PT = 3.0, 12
SOURCE_LABEL = "Source:"


def _numeric(v) -> bool:
    return isinstance(v, (int, float)) and not isinstance(v, bool)


def _measure(ref: str, row: dict) -> str | None:
    if ref.startswith("doc:"):
        return "doc:" + ref[4:].split("#")[0]
    return str(row.get("key")) if row.get("key") else None


def chart_points(chart: dict, inp, resolver) -> tuple:
    """``(points, why)``: the chart's points read from the ledger, ``[{label, ref, value, unit, measure, shown}]``; ``why`` is '' when
    every point is a numeric ledger value with a unit, else the reason (the points that resolved are still returned)."""
    from .refs import fmt   # noqa: PLC0415
    pts, why = [], ""
    for s in (chart or {}).get("series") or []:
        ref, label = s.get("ref"), str(s.get("label") or "").strip()
        if not ref or resolver.kind(ref) not in ("fact", "docfig"):
            why = why or f"{label or ref}: not a fact or a document figure"
            continue
        row = inp.doc_facts.get(ref) or inp.facts.get(ref) or {}
        if not _numeric(row.get("value")):
            why = why or f"{label}: the ledger value is not a number"
            continue
        if not row.get("unit"):
            why = why or f"{label}: no unit in the ledger"
        pts.append({"label": label, "ref": ref, "value": row["value"], "unit": row.get("unit"), "measure": _measure(ref, row), "shown": fmt(row)})
    return pts, why


def chart_form(chart: dict, inp, resolver) -> dict:
    """What a chart block becomes (design.charts.types): ``{form, points, why}`` with form one of bar, column, line, segmented (drawn),
    hero (one value: a hero figure), stat_row (2 to 4 unlike figures), table (more than 8, or unlike beyond 4), or none (nothing sourced).
    Never a computed value, never an 'Other'."""
    pts, why = chart_points(chart, inp, resolver)
    n = len(pts)
    if n == 0:
        return {"form": "none", "points": [], "why": why or "no sourced figure"}
    if n == 1:
        return {"form": "hero", "points": pts, "why": "one value: a hero figure, not a one-bar chart"}
    same = len({p["unit"] for p in pts}) == 1 and pts[0]["unit"] and len({p["measure"] for p in pts}) == 1 and pts[0]["measure"]
    if why or not same:
        why = why or "unlike figures (more than one unit or measure)"
        return {"form": "stat_row" if n <= 4 else "table", "points": pts, "why": why}
    if n > CHART_MAX_CATEGORIES:
        return {"form": "table", "points": pts, "why": f"{n} categories: a table holds every row (more than {CHART_MAX_CATEGORIES} is never folded)"}
    if chart.get("type") == "stack":   # a segmented bar only when the source states the whole and the parts sum to it within rounding
        ok, swhy = whole_ok(chart, pts, inp, resolver)
        if ok:
            return {"form": "segmented", "points": pts, "why": ""}
        why = swhy
    if all(TIME_LABEL.match(p["label"]) for p in pts):
        return {"form": "column" if n <= 6 else "line", "points": pts, "why": why}
    return {"form": "bar", "points": pts, "why": why}


def whole_ok(chart: dict, pts: list, inp, resolver) -> tuple:
    """``(ok, why)``: the chart's ``whole`` is a numeric ledger value (fact or docfig) of the parts' own unit and measure, and the parts sum
    to it within rounding (1 percentage point for proportions, 1% of the whole otherwise). A 100% bar stretches its parts to the whole, so
    without that check 0.3 and 0.2 would be drawn as 60 / 40: then the parts are a plain bar."""
    ref = chart.get("whole")
    if not ref or resolver.kind(ref) not in ("fact", "docfig"):
        return False, "no stated whole in the ledger: a bar, not a segmented bar"
    row = inp.doc_facts.get(ref) or inp.facts.get(ref) or {}
    if not _numeric(row.get("value")) or row.get("unit") != pts[0]["unit"] or _measure(ref, row) != pts[0]["measure"]:
        return False, "the stated whole is not a value of the parts' unit and measure: a bar"
    whole = float(row["value"])
    total = sum(float(p["value"]) for p in pts)
    tol = 0.01 if pts[0]["unit"] == "proportion" else 0.01 * abs(whole)
    if abs(total - whole) > tol + 1e-9:
        return False, "the parts do not sum to the stated whole: a bar"
    return True, ""


def plot_value(p: dict) -> float:
    """The number a mark is drawn at: a proportion in percent (the way the ledger's display shows it), anything else as it is."""
    v = float(p["value"])
    return round(v * 100, 6) if p["unit"] == "proportion" else v


def number_format(unit: str) -> str:
    """The number format of a line chart's value-axis ticks (the marks themselves carry the ledger's own display as their label text)."""
    return {"proportion": '0"%"', "%": '0"%"', "eur": '"€"#,##0', "gbp": '"£"#,##0', "usd": '"$"#,##0'}.get(str(unit or "").lower(), "#,##0")


def source_line(points: list, inp) -> str | None:
    """'Source: <document or source label>, <locator>' for each distinct ref (at most two, then '+ n more in the appendix'), built from the
    refs' own ledger rows; None when any point's source has no label (then no chart is drawn)."""
    labels = []
    for p in points:
        ref = p["ref"]
        if ref.startswith("doc:"):
            key = ref[4:].split("#")[0]
            name = ((inp.docs or {}).get(key) or {}).get("name")
            page = (inp.doc_facts.get(ref) or {}).get("page")
            lab = f"{name}, p. {page}" if name and page else name
        else:
            row = inp.facts.get(ref) or {}
            src = next((s for s in row.get("sources") or [] if isinstance(s, dict)), None)
            if src is None and row.get("sources"):
                sid = next((s for s in row["sources"] if isinstance(s, str)), None)
                src = (inp.sources or {}).get(sid) if sid else None
            lab = (src or {}).get("title") or (src or {}).get("name") or (src or {}).get("uri")
        if not lab:
            return None
        if lab not in labels:
            labels.append(str(lab))
    shown = labels[:2]
    more = len(labels) - len(shown)
    return f"{SOURCE_LABEL} " + "; ".join(shown) + (f" (+ {more} more in the appendix)" if more else "")


def chart_marks(form: str, points: list, hero: list, th) -> list:
    """The fill of each mark (design.charts.rules, dataviz: form first, colour last): one series = the accent on the hero bars (at most
    two) and a mute tint on the rest; no hero = ink. Every mark is 3:1 or better on the paper, else ink."""
    quiet = themes.blend(th.mute, th.paper, 0.35)
    if not themes.contrast(quiet, th.paper) >= ICON_CONTRAST:
        quiet = th.mute
    acc = th.accent if themes.contrast(th.accent, th.paper) >= ICON_CONTRAST else th.ink
    hero = [h for h in (hero or [])][:CHART_HERO_MAX]
    if form == "line":
        return [th.ink] * len(points)
    if form == "segmented":   # one hue in steps (ink 100 / 60 / 30 on the paper), as the pptx; a step under 3:1 falls back to ink
        steps = [th.ink, themes.blend(th.ink, th.paper, 0.4), themes.blend(th.ink, th.paper, 0.7)]
        return [s if themes.contrast(s, th.paper) >= ICON_CONTRAST else th.ink for s in (steps[i % 3] for i in range(len(points)))]
    if not hero:
        return [th.ink] * len(points)
    return [acc if p["label"] in hero else quiet for p in points]


def chart_svg(form: str, points: list, colours: list, source: str, title: str = "") -> str:
    """The web twin of a native chart (no library, no network): inline SVG from the same points, one <title> per mark (label, value), the
    values in text tokens, the source line as text and the data as a real table under 'Show data'."""
    import html as _h   # noqa: PLC0415
    e = lambda t: _h.escape(str(t), quote=True)   # noqa: E731
    n = len(points)
    vals = [plot_value(p) for p in points]
    top = max(vals + [0.0]) or 1.0
    W_, H_ = 1000, 520
    marks = []
    if form == "bar":
        lab_w, bar_h = 260, min(56, (H_ - 20) / n * 0.62)
        step = (H_ - 20) / n
        for i, (p, v, c) in enumerate(zip(points, vals, colours)):
            y = 10 + i * step + (step - bar_h) / 2
            w = (W_ - lab_w - 140) * v / top
            marks.append(f'<text x="{lab_w - 16}" y="{y + bar_h / 2:.1f}" text-anchor="end" dominant-baseline="middle" class="cl">{e(p["label"])}</text>'
                         f'<rect x="{lab_w}" y="{y:.1f}" width="{w:.1f}" height="{bar_h:.1f}" rx="4" fill="#{c}"><title>{e(p["label"])}: {e(p["shown"])}</title></rect>'
                         f'<text x="{lab_w + w + 12:.1f}" y="{y + bar_h / 2:.1f}" dominant-baseline="middle" class="cv">{e(p["shown"])}</text>')
    elif form == "segmented":   # one bar, the parts side by side in the ledger's order (they sum to the stated whole: whole_ok)
        total = sum(vals) or 1.0
        x, y, h = 20.0, H_ / 2 - 60, 120
        for p, v, c in zip(points, vals, colours):
            w = (W_ - 40) * v / total
            marks.append(f'<rect x="{x:.1f}" y="{y}" width="{max(0.0, w - 2):.1f}" height="{h}" fill="#{c}"><title>{e(p["label"])}: {e(p["shown"])}</title></rect>'
                         f'<text x="{x + w / 2:.1f}" y="{y + h + 40}" text-anchor="middle" class="cv">{e(p["shown"])}</text>'
                         f'<text x="{x + w / 2:.1f}" y="{y - 22}" text-anchor="middle" class="cl">{e(p["label"])}</text>')
            x += w
    elif form == "column":
        step = (W_ - 40) / n
        col_w = min(110, step * 0.55)
        base = H_ - 60
        for i, (p, v, c) in enumerate(zip(points, vals, colours)):
            x = 20 + i * step + (step - col_w) / 2
            h = (base - 50) * v / top
            marks.append(f'<rect x="{x:.1f}" y="{base - h:.1f}" width="{col_w:.1f}" height="{h:.1f}" rx="4" fill="#{c}"><title>{e(p["label"])}: {e(p["shown"])}</title></rect>'
                         f'<text x="{x + col_w / 2:.1f}" y="{base - h - 12:.1f}" text-anchor="middle" class="cv">{e(p["shown"])}</text>'
                         f'<text x="{x + col_w / 2:.1f}" y="{base + 34}" text-anchor="middle" class="cl">{e(p["label"])}</text>')
        marks.append(f'<line x1="20" x2="{W_ - 20}" y1="{base}" y2="{base}" class="base"/>')
    else:   # line
        step = (W_ - 120) / max(1, n - 1)
        base = H_ - 60
        xy = [(60 + i * step, base - (base - 50) * v / top) for i, v in enumerate(vals)]
        marks.append('<polyline fill="none" stroke="#{}" stroke-width="3" points="{}"/>'.format(colours[0] if colours else "1B2430",
                                                                                         " ".join(f"{x:.1f},{y:.1f}" for x, y in xy)))
        for (x, y), p in zip(xy, points):
            marks.append(f'<circle cx="{x:.1f}" cy="{y:.1f}" r="7" fill="#{colours[0] if colours else "1B2430"}"><title>{e(p["label"])}: {e(p["shown"])}</title></circle>'
                         f'<text x="{x:.1f}" y="{base + 34}" text-anchor="middle" class="cl">{e(p["label"])}</text>')
        x, y = xy[-1]
        marks.append(f'<text x="{x:.1f}" y="{y - 18:.1f}" text-anchor="middle" class="cv">{e(points[-1]["shown"])}</text>')
        marks.append(f'<line x1="40" x2="{W_ - 40}" y1="{base}" y2="{base}" class="base"/>')
    rows = "".join(f"<tr><td>{e(p['label'])}</td><td>{e(p['shown'])}</td></tr>" for p in points)
    return (f'<figure class="g-chart" data-form="{e(form)}"><svg viewBox="0 0 {W_} {H_}" role="img" aria-label="{e(title or "Chart")}">'
            f'{"".join(marks)}</svg><figcaption class="g-src">{e(source)}</figcaption>'
            f'<details class="g-data"><summary>Show data</summary><table><tbody>{rows}</tbody></table></details></figure>')


# ================================================================================================ diagrams (slices 6-7)
# A diagram binds an existing block's items and nothing else: every word in it is a word of the block, the block is drawn once (the
# diagram replaces its rows), and no step, arrow label, phase name, quadrant name or marker is written by code.

PROCESS_MIN, PROCESS_MAX = 3, 6
TIMELINE_MIN, TIMELINE_MAX = 3, 8
JOURNEY_MIN, JOURNEY_MAX = 3, 5
GRID_MIN, GRID_MAX = 3, 6
CHEVRON_LABEL_MAX = 22
#: A step's second cell that is a time: the timeline's strip (equal spacing always: dates are never plotted to scale).
TIME_CELL = re.compile(r"(?i)^(?:(?:week|wk|month|day|year|quarter|phase|sprint)s?\s*\d|q[1-4]\b|h[12]\b|(?:19|20)\d\d\b|"
                       r"(?:january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sep|sept|oct|nov|dec)\b)")   # real month names and abbreviations as whole words only (never 'Marketing', 'Decide', 'By ...')


def steps_of(bl: list) -> list | None:
    """The one steps block's items as lists of strings, or None when the slide has none or more than one."""
    st = [b for b in bl if b.get("kind") == "steps"]
    if len(st) != 1:
        return None
    return [[str(c).strip() for c in (it if isinstance(it, (list, tuple)) else [it])] for it in st[0].get("items") or []]


def is_time(cell: str) -> bool:
    return bool(TIME_CELL.match(str(cell or "").strip()))


def diagram_miss(s: dict, bl: list) -> str | None:
    """A near miss for the report (d_min_items): a steps block just under a diagram's minimum ('2 steps, needs 3'); None otherwise."""
    items = steps_of(bl)
    if items is None:
        return None
    n = len(items)
    if n < PROCESS_MIN:
        return f"{n} step{'s' if n != 1 else ''}, needs {PROCESS_MIN}"
    return None


MATRIX_CELLS = ("hh", "hl", "lh", "ll")


def matrix_ok(b: dict) -> bool:
    """A table block's ``matrix`` is drawable as a 2x2: x and y each {label, low, high, refs} with refs (the basis sourced), every cell
    named hh / hl / lh / ll holding items, at least one item. Items are listed inside quadrants; nothing is placed at a coordinate."""
    m = b.get("matrix") if isinstance(b, dict) else None
    if not isinstance(m, dict):
        return False
    for ax in ("x", "y"):
        a = m.get(ax)
        if not (isinstance(a, dict) and all(str(a.get(k) or "").strip() for k in ("label", "low", "high")) and a.get("refs")):
            return False
    cells = m.get("cells")
    if not isinstance(cells, dict) or not set(cells) <= set(MATRIX_CELLS):
        return False
    return any(isinstance(v, list) and v for v in cells.values()) and all(isinstance(v, list) and all(str(i).strip() for i in v) for v in cells.values())


def charts_pass(S: list, inp, resolver) -> list:
    """Under spec.GRAPHICS, before the slides are arranged: what each chart block becomes (chart_form). A drawn chart keeps its block; a
    single value becomes a hero figure and 2 to 4 unlike figures a stat row (a stats block, each value as the ledger shows it, with its ref);
    more becomes a table with every row; a block with nothing sourced is removed. A chart with no source label is not drawn. Nothing is
    computed and no word is added: labels are the block's own, values the ledger's display. Returns the records for meta.graphics.charts."""
    recs = []
    for sl in S:
        out = []
        for b in sl.get("blocks") or []:
            if b.get("kind") != "chart":
                out.append(b)
                continue
            got = chart_form(b.get("chart") or {}, inp, resolver)
            form, why, pts = got["form"], got["why"], got["points"]
            src = source_line(pts, inp) if form in CHART_FORMS else None
            if form in CHART_FORMS and not src:
                form, why = ("hero" if len(pts) == 1 else "stat_row" if len(pts) <= 4 else "table"), "no source label for a point: no chart"
            refs = [p["ref"] for p in pts]
            if form in CHART_FORMS:
                out.append(b)
            elif form in ("hero", "stat_row"):
                out.append({"kind": "stats", "items": [{"value": p["shown"], "label": p["label"], "refs": [p["ref"]]} for p in pts], "refs": refs,
                            "basis": "sourced"})
            elif form == "table":
                out.append({"kind": "table", "rows": [[str((b.get("chart") or {}).get("title") or ""), ""]] + [[p["label"], p["shown"]] for p in pts],
                            "refs": refs, "basis": "sourced"})
            recs.append({"slide": sl.get("title"), "form": form, "why": why, "source": src,
                         "points": [{"label": p["label"], "ref": p["ref"], "value": plot_value(p), "shown": p["shown"], "unit": p["unit"]} for p in pts]})
        sl["blocks"] = out
    return recs


def report(deck: dict, layouts_json=None, pptx=None) -> dict:
    """report.json's ``graphics``: the charts (what each chart block became, and why), the diagrams and icons the final render really drew
    (``layouts_json``: the renderer's layouts.json; ``pptx``: the deck it wrote), and the near misses ('2 steps, needs 3'), so a deck with
    no chart and no diagram says why. Without the files, the plan's layouts stand in."""
    from . import spec as _spec   # noqa: PLC0415
    from .validate import presented   # noqa: PLC0415
    charts = ((deck.get("meta") or {}).get("graphics") or {}).get("charts") or []
    try:
        drawn = {k: (v or {}).get("id") for k, v in json.loads(Path(layouts_json).read_text())["slides"].items()} if layouts_json else {}
    except (OSError, ValueError, KeyError, TypeError, AttributeError):
        drawn = {}
    icons = {}
    if pptx and Path(pptx).is_file():
        from pptx import Presentation   # noqa: PLC0415
        for sid, sl in zip(deck["order"], Presentation(str(pptx)).slides):
            ids = [sh.name[len("Icon: "):] for sh in sl.shapes if (sh.name or "").startswith("Icon: ")]
            if ids:
                icons[sid] = ids
    diagrams, misses = [], []
    fam = {"process_chevrons": "process", "timeline_strip": "timeline", "matrix_2x2": "matrix", "journey_row": "journey"}
    for sid in deck["order"]:
        s = deck["slides"][sid]
        lid = drawn.get(sid) or (s.get("layout") or {}).get("id")
        bl = _spec.shown_blocks(s)
        from . import layouts as _L   # noqa: PLC0415
        if lid in fam and (lid != "timeline_strip" or _L.timed_3_8(s, bl)):
            diagrams.append({"slide": sid, "diagram": fam[lid], "items": len(steps_of(bl) or [])})
        else:
            miss = diagram_miss(s, bl)
            if miss:
                misses.append({"slide": sid, "type": s["type"], "why": f"no diagram: {miss}"})
    pres = set(presented(deck))
    return {"charts": charts or [{"chart": None, "why": "no chart: the stages wrote no chart block (no series of sourced figures)"}],
            "diagrams": diagrams, "diagram_misses": misses,
            "presented_with_diagram": sum(1 for d in diagrams if d["slide"] in pres), "icons": icons}
