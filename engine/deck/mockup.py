"""Execution mock-ups in situ (spec.MOCKUPS; blind judging of decks from real client briefs, round 4: "the work is shown almost entirely
as text": both executions in the first ten slides were text slides with no mock-up).

A presented execution is drawn as the work where it runs, not as words in a box. One scene per execution, picked by its channel:

- ``poster``: a poster in a shelter on a street (or on a plain wall when the channel names no street);
- ``billboard``: a roadside board on two posts over a low skyline;
- ``phone``: a phone showing a social post (the creative, then a caption);
- ``shelf``: a shelf of blank packs with a wobbler on its arm and a shelf strip;
- ``radio``: a script card with a waveform;
- ``film``: three or four storyboard frames, each with its line under it, the last an end card;
- ``print``: a printed page on a table (press, door drop, leaflet, letter, bill).

Inside the ad the execution's headline (its first copy line) and its line (its last) are typeset copy, the brand is the client label (a
neutral placeholder when the label is a job id), and the picture fills the ad's visual area. The picture is whatever the slot holds:
a Production final first (images.bind_production binds it before generation), then a generated picture from the execution's scene card
(stage g, scene.slots_for), and with neither a clean typographic ad: still designed, never an empty frame. Words never sit on the
picture: the copy has its own band, so contrast is known. Copy that does not fit the ad is never cut: it moves to the slide's left column.

The scene is pure geometry in inches on the 16:9 grid (``ops``); render_pptx paints it from native shapes and render_web from one inline
SVG, so both carry the same scene, and the pdf is the pptx's. 16:9 only: at 4:3 and A4 the execution keeps its earlier layout.
"""
from __future__ import annotations

import re

from . import spec

KINDS = ("poster", "billboard", "phone", "shelf", "radio", "film", "print")
#: Channel words -> scene, the earliest match in the execution's title wins ('Social video' is a post; 'TV and online video' is film).
CHANNEL_WORDS = (
    ("phone", r"social|instagram|tiktok|facebook|snapchat|stories|reels|feed|\bapp\b|apps\b|digital|mobile|messages?\b|sms|whatsapp|"
              r"e-?mail|newsletter|influencer|creator"),
    ("radio", r"radio|audio|podcast|spotify|sonic|jingle"),
    ("film", r"\btv\b|television|film|video|cinema|broadcast|youtube|\bvod\b|bvod|ctv|commercial"),
    ("shelf", r"in-store|in store|instore|shelf|shelves|wobbler|point of sale|\bpos\b|aisle|gondola|end ?cap|retail|shop window|"
              r"window display|checkout|\btill\b|packaging|sampling|in-shop"),
    ("billboard", r"billboard|48[- ]sheet|96[- ]sheet|large format|motorway|roadside|dooh|digital out"),
    ("poster", r"outdoor|\booh\b|poster|\bbus\b|bus-stop|shelter|6[- ]sheet|six[- ]sheet|transit|station|metro|tram|street|docking|"
               r"out of home|out-of-home"),
    ("print", r"press|print|newspaper|magazine|door ?drops?|door-drops?|leaflet|flyer|letter|direct mail|\bmail\b|\bbill\b|notice|"
              r"brochure|insert|noticeboard"),
)
#: Channel words that put a poster on a street (the default poster hangs on a plain wall: a workplace, a lobby).
STREET = r"outdoor|\booh\b|\bbus\b|bus-stop|shelter|street|station|docking|transit|tram|metro|out of home|out-of-home"
#: A spoken line's speaker ('VO:', 'SFX:', 'WOMAN:').
SPEAKER = re.compile(r"^\s*((?:SFX|VO|MVO|FVO|SUPER|SUPERS|ANNCR|[A-Z][A-Z .'-]{1,24}))\s*(\([^)]{1,40}\))?\s*:\s*(.+)$")
#: A copy line's own label ('Headline: ...', 'Strapline: ...'): the label is the writer's note, the words after it are the copy.
LABEL = re.compile(r"(?i)^\s*(?:headline|sub-?head(?:line)?|body(?: copy)?|copy|line|end ?line|strap ?line|tag ?line|sign-?off|cta|"
                   r"call to action|caption|super|title|header)\s*:\s*(.+)$")
#: The client label that names a job, not a brand ('Brief 1', 'Project X', 'Job 4512'): the ad then carries this neutral placeholder.
BRAND_PLACEHOLDER = "Your brand"
#: The wave's bar heights (fractions), fixed so a render is repeatable.
WAVE = (0.30, 0.73, 0.73, 0.41, 0.32, 0.46, 0.58, 0.30, 0.76, 0.87, 0.50, 0.46, 0.45, 0.34, 0.30, 0.65, 0.84, 0.53, 0.56, 0.73,
        0.49, 0.30, 0.43, 0.65, 0.49, 0.58, 0.88, 0.67, 0.32, 0.42, 0.35, 0.40, 0.52, 0.85, 0.73, 0.34, 0.66, 0.54, 0.31, 0.38)
#: Type sizes (pt): the floor is the body floor, so QA's min_font never fires on a mock-up.
MIN_PT = 12
LINE = 1.2


def is_job_label(name) -> bool:
    """True for a client label that is a job id rather than a brand ('Brief 1', 'Project X', 'Job 4512'): pitch_ready.is_job_label."""
    from . import pitch_ready   # noqa: PLC0415
    return pitch_ready.is_job_label(name)


def kind_of(title: str) -> str:
    """The scene for an execution, from its title (the channel): the earliest channel word wins; 'poster' when none is named."""
    t = str(title or "").lower()
    best = None
    for kind, pat in CHANNEL_WORDS:
        m = re.search(pat, t)
        if m and (best is None or m.start() < best[0]):
            best = (m.start(), kind)
    return best[1] if best else "poster"


def street(title: str) -> bool:
    return bool(re.search(STREET, str(title or "").lower()))


def applies(deck: dict, sid: str, s: dict | None = None) -> bool:
    """Whether slide ``sid`` is drawn as a mock-up: spec.MOCKUPS and the deck's mock-ups part on (graphics.part_on), an execution slide of
    its own (not one absorbed by a merge) with a copy block, in the presented story, at 16:9."""
    if not spec.MOCKUPS:
        return False
    s = s or deck["slides"].get(sid) or {}
    if s.get("type") != "execution" or not any(b.get("kind") == "copy" and b.get("lines") for b in s.get("blocks") or []):
        return False
    from . import graphics, validate   # noqa: PLC0415
    from . import theme as themes   # noqa: PLC0415
    if not graphics.part_on(deck, "mockups") or not themes.canvas_of(deck).identity:
        return False
    return sid in validate.presented(deck)


def brand_of(deck: dict) -> str:
    """The brand the ad carries: the client label, or the neutral placeholder when the label is a job id or a stand-in."""
    from . import pitch_ready   # noqa: PLC0415
    c = str((deck.get("meta") or {}).get("client") or "").strip()
    if not c or is_job_label(c) or pitch_ready.is_placeholder_name(c):
        return BRAND_PLACEHOLDER
    return c


def copy_of(deck: dict, cp: dict) -> dict:
    """``{headline, line, middle, lines, brand}`` of a copy block: the headline is the first line, the line the last (when there are two
    or more), the rest the middle. A placeholder line (a bracketed blank) never goes in the ad."""
    raw = [str(x).strip() for x in cp.get("lines") or [] if str(x).strip()]
    usable = [x for x in raw if not spec.unresolved_line(x)]
    head = usable[0] if usable else ""
    line = usable[-1] if len(usable) > 1 else ""
    middle = [x for x in raw if x not in (head, line)]
    return {"headline": _unspeak(head), "line": _unspeak(line), "middle": middle, "lines": raw, "brand": brand_of(deck),
            "answer": str(cp.get("answer") or "").strip()}


def _unspeak(t: str) -> str:
    """A line as the ad sets it: a voice-over's or a label's words without the 'VO:' or 'Headline:' in front."""
    m = LABEL.match(t or "")
    if m:
        return m.group(1).strip()
    m = SPEAKER.match(t or "")
    return m.group(3).strip() if m and m.group(1).strip().upper() in ("VO", "MVO", "FVO", "SUPER", "SUPERS", "ANNCR") else t


def _speaker(ln: str) -> tuple:
    """``(who, said)`` of a script line: 'WOMAN (wary): Free?' -> ('WOMAN', '(wary) Free?'); ('', line) when it names no speaker."""
    m = SPEAKER.match(ln or "")
    if not m:
        return "", ln
    return m.group(1).strip(), " ".join(x for x in (m.group(2) or "", m.group(3).strip()) if x)


# ------------------------------------------------------------------------------------------------------------------- type fitting

def _k(font: str, bold: bool, text: str) -> float:
    try:
        from .qa_render import glyph_k   # noqa: PLC0415  the QA's own estimate, so what fits here is what the QA measures
        return glyph_k(font or "", bold, text)
    except Exception:   # noqa: BLE001
        return 0.56 if bold else 0.5


def wrap(text: str, w: float, size: float, font: str = "", bold: bool = False) -> list | None:
    """``text`` greedily wrapped to ``w`` inches at ``size`` pt (a little narrower than the QA's own count, so the QA's estimate holds),
    or None when one word is wider than the line."""
    per = int(max(w - 0.06, 0.1) * 72 * 0.93 / (size * _k(font, bold, text)))
    if per < 1:
        return None
    lines, cur = [], ""
    for word in str(text).split():
        if len(word) > per:
            return None
        if cur and len(cur) + 1 + len(word) > per:
            lines.append(cur)
            cur = word
        else:
            cur = f"{cur} {word}" if cur else word
    if cur:
        lines.append(cur)
    return lines


def height(n: int, size: float) -> float:
    return n * size * LINE / 72 + 0.06


def fit(text: str, w: float, h: float, hi: float, lo: float = MIN_PT, font: str = "", bold: bool = False, max_lines: int = 99):
    """``(size, lines)``: the largest size from ``hi`` down to ``lo`` (whole points) at which ``text`` fits the box; None when it cannot."""
    if not str(text or "").strip():
        return None
    s = float(int(hi))
    while s >= lo:
        ln = wrap(text, w, s, font, bold)
        if ln and len(ln) <= max_lines and height(len(ln), s) <= h:
            return s, ln
        s -= 1
    return None


# ------------------------------------------------------------------------------------------------------------------- the ops

class Scene:
    """The scene's drawing operations in paint order, plus what it holds and what it could not hold."""

    def __init__(self, kind: str, box: tuple, fonts: dict):
        self.kind, self.box, self.fonts = kind, box, fonts
        self.ops: list = []
        self.spill: list = []    # copy lines that did not fit the ad: the slide's left column carries them
        self.used: set = set()   # copy lines the ad carries
        self.slots: list = []    # picture slots drawn

    def rect(self, x, y, w, h, fill=None, line=None, name="Mock-up shape", shape="rect", r=0.1):
        if w > 0.005 and h > 0.005:
            self.ops.append({"op": shape, "x": x, "y": y, "w": w, "h": h, "fill": fill, "line": line, "name": name, "r": r})

    def pic(self, x, y, w, h, slot):
        self.ops.append({"op": "pic", "x": x, "y": y, "w": w, "h": h, "slot": slot, "name": "Mock-up picture"})
        self.slots.append(slot)

    def text(self, x, y, w, h, text, hi, color="ink", head=False, bold=False, align="l", anchor="t", lo=MIN_PT, max_lines=99,
             src=None, name="Mock-up copy") -> float:
        """Typeset ``text`` in the box at the largest size that fits; returns the height used (0 when it did not fit: the line spills)."""
        font = self.fonts.get("head" if head else "body", "")
        got = fit(text, w, h, hi, lo, font, bold, max_lines)
        if not got:
            if src:
                self.spill.append(src)
            return 0.0
        size, lines = got
        hh = height(len(lines), size)
        self.ops.append({"op": "text", "x": x, "y": y, "w": w, "h": max(hh, min(h, hh)) if anchor == "t" else h, "lines": lines,
                         "size": size, "color": color, "font": "head" if head else "body", "bold": bold, "align": align, "anchor": anchor,
                         "name": name})
        if src:
            self.used.add(src)
        return hh


def _ad(sc: Scene, x, y, w, h, cp: dict, pic: bool, slot: str = "picture", band_frac: float = 0.40, small: bool = False,
        brand: bool = True, dark: bool = False) -> None:
    """The ad face, its copy band grown (the picture area shrunk) until the headline and the line fit, up to 0.62 of the ad; a typographic
    ad gives the headline the whole face when it and the line cannot share it. What still cannot fit spills to the left column."""
    tries = [min(band_frac + d, 0.62) for d in (0.0, 0.08, 0.16, 0.24)] if pic else [band_frac]
    hl = cp["headline"]
    key = lambda s_: (bool(hl) and hl not in s_.used, len(s_.spill))   # noqa: E731  the headline first, then the fewest lines spilled
    best = None
    for c_ in ([cp, {**cp, "line": ""}] if cp.get("line") else [cp]):
        for frac in dict.fromkeys(tries):
            sub = Scene(sc.kind, sc.box, sc.fonts)
            _ad_face(sub, x, y, w, h, c_, pic, slot, frac, small, brand, dark)
            if c_ is not cp:
                sub.spill.append(cp["line"])   # the line given up so the headline fits: it goes to the left column
            if best is None or key(sub) < key(best):
                best = sub
            if not key(best)[0] and not best.spill:
                break
        if not key(best)[0]:
            break
    sc.ops += best.ops
    sc.spill += best.spill
    sc.used |= best.used
    sc.slots += best.slots


def _ad_face(sc: Scene, x, y, w, h, cp: dict, pic: bool, slot: str, band_frac: float, small: bool, brand: bool, dark: bool = False) -> None:
    """One ad face in the box: with a picture, the picture fills the visual area (the top, or the left of a wide ad) and the copy sits
    on an ink band; with none, a typographic ad on paper (headline large, an accent block, the line, the brand)."""
    pad = max(0.07, 0.06 * min(w, h))
    wide = w / h >= 1.4
    hl, ln, br = cp["headline"], cp["line"], cp["brand"]
    big = (30 if not small else 18) if min(w, h) > 2.2 else (22 if not small else 16)
    if pic:
        if wide:
            pw = w * (1 - band_frac)
            sc.pic(x, y, pw, h, slot)
            bx, by, bw, bh = x + pw, y, w - pw, h
        else:
            ph = h * (1 - band_frac)
            sc.pic(x, y, w, ph, slot)
            bx, by, bw, bh = x, y + ph, w, h - ph
        sc.rect(bx, by, bw, bh, fill="ink", name="Mock-up band")
        ix, iw = bx + pad, bw - 2 * pad
        brand_h = height(1, MIN_PT) if brand else 0.0
        room = bh - 2 * pad - brand_h - (0.04 if brand else 0.0)
        used = sc.text(ix, by + pad, iw, room * (0.62 if ln else 1.0), hl, big, "on_dark", head=True, bold=True, src=hl, name="Mock-up headline")
        if ln:
            sc.text(ix, by + pad + used + 0.04, iw, max(room - used - 0.04, 0.0), ln, max(MIN_PT, big * 0.55), "on_dark", src=ln, name="Mock-up line")
        if brand:
            sc.text(ix, by + bh - pad - brand_h, iw, brand_h, br, MIN_PT, "on_dark", bold=True, max_lines=1, name="Mock-up brand")
        return
    ground, ink = ("ink", "on_dark") if dark else ("paper", "ink")
    sc.rect(x, y, w, h, fill=ground, name="Mock-up face")
    ix, iw = x + pad * 1.4, w - 2.8 * pad
    brand_h = height(1, MIN_PT)
    top = y + pad * 1.4
    room = h - 2.8 * pad - brand_h - 0.25
    used = sc.text(ix, top, iw, room * (0.66 if ln else 1.0), hl, big * 1.35, ink, head=True, bold=True, src=hl, name="Mock-up headline")
    yy = top + used + 0.08
    sc.rect(ix, yy, min(iw * 0.22, 0.9), 0.14, fill="accent", name="Mock-up accent")
    yy += 0.26
    if ln:
        sc.text(ix, yy, iw, max(y + h - pad * 1.4 - brand_h - 0.06 - yy, 0.0), ln, max(MIN_PT, big * 0.6), ink, src=ln, name="Mock-up line")
    if brand:
        sc.text(ix, y + h - pad * 1.4 - brand_h, iw, brand_h, br, MIN_PT, ink, bold=True, max_lines=1, name="Mock-up brand")


def _buildings(sc: Scene, x, y, w, base, top_frac=(0.30, 0.55, 0.22, 0.45, 0.35, 0.60, 0.28)) -> None:
    """A low skyline of plain blocks (the rule token) standing on ``base``, each with a grid of small windows (the panel token)."""
    n = len(top_frac)
    bw = w / n
    for i, f in enumerate(top_frac):
        bh = (base - y) * (1 - f)
        bx = x + i * bw + 0.04
        sc.rect(bx, base - bh, bw - 0.08, bh, fill="rule", name="Mock-up street")
        cols, rows = 3, max(1, int(bh / 0.42))
        ww, wh = (bw - 0.08) / (cols * 2 + 1), 0.16
        for r in range(rows):
            for c in range(cols):
                sc.rect(bx + ww * (1 + 2 * c), base - bh + 0.2 + r * 0.42, ww, wh, fill="panel", name="Mock-up street")


def _poster(sc: Scene, cp: dict, pic: bool, on_street: bool) -> None:
    x, y, w, h = sc.box
    ground = y + h * 0.9
    sc.rect(x, y, w, h, fill="panel", name="Mock-up ground")
    if on_street:
        _buildings(sc, x, y + h * 0.04, w, ground)
    sc.rect(x, ground, w, y + h - ground, fill="rule", name="Mock-up street")
    sc.rect(x, ground, w, 0.05, fill="ink", name="Mock-up street")
    b = 0.09
    ay = y + (0.45 if on_street else 0.2)
    ah = ground - 0.3 - ay
    aw = ah * 2 / 3
    ax = x + (w - aw) / 2
    if on_street:   # a shelter: a roof over the panel and two posts to the pavement
        sc.rect(ax - 0.55, ay - b - 0.2, aw + 1.1, 0.13, fill="ink", name="Mock-up shelter")
        for px in (ax - 0.5, ax + aw + 0.42):
            sc.rect(px, ay - b - 0.08, 0.08, ground - ay + b + 0.08, fill="ink", name="Mock-up shelter")
    else:
        sc.rect(ax + aw * 0.35, ay + ah + b, aw * 0.3, ground - ay - ah - b, fill="ink", name="Mock-up stand")
    sc.rect(ax - b, ay - b, aw + 2 * b, ah + 2 * b, fill="ink", name="Mock-up frame")
    _ad(sc, ax, ay, aw, ah, cp, pic, band_frac=0.46)


def _billboard(sc: Scene, cp: dict, pic: bool) -> None:
    x, y, w, h = sc.box
    ground = y + h * 0.9
    sc.rect(x, y, w, h, fill="panel", name="Mock-up ground")
    _buildings(sc, x, y + h * 0.5, w, ground, (0.55, 0.30, 0.62, 0.40, 0.70, 0.35, 0.50, 0.25))
    sc.rect(x, ground, w, y + h - ground, fill="rule", name="Mock-up street")
    aw = min(w * 0.86, (h * 0.62) * 2)
    ah = aw / 2
    b = 0.09
    ax = x + (w - aw) / 2
    ay = y + h * 0.06
    for fx in (0.2, 0.75):
        sc.rect(ax + aw * fx, ay + ah, 0.12, ground - ay - ah, fill="ink", name="Mock-up posts")
    sc.rect(ax - b, ay - b, aw + 2 * b, ah + 2 * b, fill="ink", name="Mock-up frame")
    _ad(sc, ax, ay, aw, ah, cp, pic, band_frac=0.42, dark=True)


def _phone(sc: Scene, cp: dict, pic: bool) -> None:
    x, y, w, h = sc.box
    sc.rect(x, y, w, h, fill="panel", name="Mock-up ground")
    ph = h
    pw = min(ph * 0.5, w * 0.6)
    px = x + (w - pw) / 2
    b = pw * 0.06
    sc.rect(px, y, pw, ph, fill="ink", name="Mock-up phone", shape="rrect", r=0.12)
    sx, sy, sw, sh = px + b, y + b * 1.6, pw - 2 * b, ph - 3.2 * b
    sc.rect(sx, sy, sw, sh, fill="paper", name="Mock-up screen")
    row = 0.36
    d = row * 0.62
    sc.rect(sx + 0.08, sy + (row - d) / 2, d, d, fill="accent", name="Mock-up avatar", shape="oval")
    sc.text(sx + 0.16 + d, sy + (row - height(1, MIN_PT)) / 2, sw - 0.3 - d, height(1, MIN_PT), cp["brand"], MIN_PT, "ink", bold=True,
            max_lines=1, name="Mock-up brand")
    ch = min(sw * 1.25, sh - row - 0.9)
    _ad(sc, sx, sy + row, sw, ch, {**cp, "line": ""}, pic, band_frac=0.42, small=True, brand=False, dark=True)
    iy = sy + row + ch + 0.08
    for i in range(3):
        sc.rect(sx + 0.1 + i * 0.26, iy, 0.16, 0.16, fill="rule", name="Mock-up icons", shape="oval")
    if cp["line"]:
        sc.text(sx + 0.1, iy + 0.26, sw - 0.2, sy + sh - iy - 0.3, cp["line"], 13, "ink", src=cp["line"], name="Mock-up caption")


def _shelf(sc: Scene, cp: dict, pic: bool) -> None:
    x, y, w, h = sc.box
    sc.rect(x, y, w, h, fill="panel", name="Mock-up ground")
    shelves = [y + h * f for f in (0.31, 0.62, 0.93)]
    tones = ("rule", "paper", "rule", "mute", "paper", "rule")
    top = y + 0.06
    for i, sy in enumerate(shelves):
        pk_h = (sy - top) * 0.82
        cx, k = x + 0.08, i
        while cx + 0.44 < x + w - 0.08:
            sc.rect(cx, sy - pk_h, 0.42, pk_h, fill=tones[k % len(tones)], line="rule", name="Mock-up packs", shape="rrect", r=0.06)
            cx += 0.5
            k += 1
        sc.rect(x, sy, w, min(0.1, y + h - sy), fill="mute", name="Mock-up shelf")
        top = sy + 0.12
    aw = min(w * 0.4, h * 0.62)
    ah = aw * 1.2
    ax = x + w * 0.52
    ay = y + h * 0.06
    sc.rect(ax + aw * 0.47, ay + ah, 0.06, shelves[1] - ay - ah + 0.02, fill="ink", name="Mock-up arm")
    sc.rect(ax - 0.06, ay - 0.06, aw + 0.12, ah + 0.12, fill="ink", name="Mock-up frame")
    _ad(sc, ax, ay, aw, ah, {**cp, "line": ""}, pic, band_frac=0.42, small=True)
    if cp["line"]:   # the shelf strip along the lowest shelf edge carries the line
        sx, sw = x + w * 0.06, w * 0.62
        sy = shelves[2] - 0.5
        sc.rect(sx, sy, sw, 0.5, fill="paper", line="ink", name="Mock-up strip")
        sc.text(sx + 0.12, sy + 0.04, sw - 0.24, 0.42, cp["line"], 16, "ink", bold=True, anchor="m", src=cp["line"], name="Mock-up strip line")


def _radio(sc: Scene, cp: dict) -> None:
    x, y, w, h = sc.box
    sc.rect(x, y, w, h, fill="panel", name="Mock-up ground")
    cx, cy, cw, ch = x + 0.25, y + 0.2, w - 0.5, h - 0.4
    sc.rect(cx, cy, cw, ch, fill="paper", line="ink", name="Mock-up script card")
    pad = 0.3
    sc.text(cx + pad, cy + 0.18, cw * 0.5, height(1, MIN_PT), "Radio", MIN_PT, "ink", bold=True, max_lines=1, name="Mock-up kind")
    sc.text(cx + cw * 0.5, cy + 0.18, cw * 0.5 - pad, height(1, MIN_PT), cp["brand"], MIN_PT, "ink", bold=True, align="r", max_lines=1,
            name="Mock-up brand")
    wy, wh = cy + 0.55, 0.62
    n = len(WAVE)
    bw = (cw - 2 * pad) / n
    for i, f in enumerate(WAVE):
        sc.rect(cx + pad + i * bw + bw * 0.2, wy + wh * (1 - f) / 2, bw * 0.6, wh * f, fill="mute" if i < n * 0.35 else "ink",
                name="Mock-up wave")
    yy = wy + wh + 0.25
    bottom = cy + ch - 0.22
    lines = [ln for ln in cp["lines"] if ln]
    for size in (16, 15, 14, 13, 12):
        lw = _who_w(sc, lines, size)
        ok, hh = _script_height(sc, lines, cw - 2 * pad, size, lw)
        if ok and yy + hh <= bottom:
            break
    for ln in lines:
        who, said = _speaker(ln)
        got = fit(said, cw - 2 * pad - lw, max(bottom - yy, 0), size, size, sc.fonts.get("body", ""))
        if got and who and not fit(who, lw - 0.1, height(2, size), size, size, sc.fonts.get("body", ""), True, 2):
            got = None
        if not got:
            sc.spill.append(ln)
            continue
        hh = height(len(got[1]), size)
        if who:
            sc.text(cx + pad, yy, lw - 0.1, hh, who, size, "accent_ink", bold=True, lo=size, max_lines=2, name="Mock-up speaker")
        sc.ops.append({"op": "text", "x": cx + pad + lw, "y": yy, "w": cw - 2 * pad - lw, "h": hh, "lines": got[1], "size": size,
                       "color": "ink", "font": "body", "bold": False, "align": "l", "anchor": "t", "name": "Mock-up script"})
        sc.used.add(ln)
        yy += hh + 0.08


def _who_w(sc: Scene, lines: list, size: float) -> float:
    """The speaker column's width at ``size``: the widest speaker's name on one line, at most 1.9 in (a longer one takes two lines)."""
    widest = max((len(_speaker(ln)[0]) for ln in lines), default=0)
    if not widest:
        return 0.0
    return min(1.9, widest * size * _k(sc.fonts.get("body", ""), True, "") / 72 / 0.9 + 0.2)


def _script_height(sc: Scene, lines: list, w: float, size: float, lw: float = 0.0) -> tuple:
    tot = 0.0
    for ln in lines:
        who, said = _speaker(ln)
        got = wrap(said, w - (lw if who else 0), size, sc.fonts.get("body", ""))
        if not got:
            return False, 0.0
        tot += height(len(got), size) + 0.08
    return True, tot


def _film(sc: Scene, cp: dict, shots: list, pic: bool) -> None:
    """Three or four storyboard frames in a row or a grid: Production shots when there are three or more, else the picture in the first
    frame and drawn sketch frames after it; the last frame is the end card (the brand and the line). Each frame's line sits under it."""
    x, y, w, h = sc.box
    lines = [ln for ln in cp["lines"] if ln]
    end_line = cp["line"] or (lines[-1] if len(lines) > 1 else "")
    body = [ln for ln in lines if _unspeak(ln) != end_line] if end_line else list(lines)
    n = 4 if len(shots) >= 4 else 3
    content = n - 1 if not shots else min(n, len(shots))
    frames = []
    for i in range(content):
        frames.append(("shot", shots[i]) if shots else (("pic", "picture") if (i == 0 and pic) else ("sketch", i)))
    if len(frames) < n:
        frames.append(("end", None))
    per = [[] for _ in frames]
    holders = [i for i, f in enumerate(frames) if f[0] != "end"] or [0]
    for j, ln in enumerate(body):
        per[holders[min(j * len(holders) // max(len(body), 1), len(holders) - 1)]].append(ln)
    if frames[-1][0] != "end" and end_line:
        per[-1].append(end_line)
    gy = 0.16
    fh = (h - gy * (n - 1)) / n   # the frames stacked down the left, each line beside its frame, as a storyboard sheet reads
    fw = min(fh * 16 / 9, w * 0.42)
    fh = fw * 9 / 16
    gy = (h - fh * n) / max(n - 1, 1)
    tx = x + fw + 0.62
    tw = x + w - tx
    for i, (kind, ref) in enumerate(frames):
        fx, fy = x + 0.3, y + i * (fh + gy)
        if kind in ("shot", "pic"):
            sc.pic(fx, fy, fw, fh, ref if kind == "shot" else "picture")
        elif kind == "sketch":
            sc.rect(fx, fy, fw, fh, fill="panel", name="Mock-up sketch")
            sc.rect(fx, fy + fh * 0.7, fw, fh * 0.3, fill="rule", name="Mock-up sketch")
            hx = fx + fw * (0.35 + 0.25 * (ref % 2))
            sc.rect(hx, fy + fh * 0.22, fh * 0.16, fh * 0.16, fill="mute", name="Mock-up sketch", shape="oval")
            sc.rect(hx - fh * 0.06, fy + fh * 0.4, fh * 0.28, fh * 0.42, fill="mute", name="Mock-up sketch", shape="rrect", r=0.3)
        else:
            sc.rect(fx, fy, fw, fh, fill="ink", name="Mock-up end card")
            used = sc.text(fx + 0.12, fy + 0.1, fw - 0.24, fh * 0.45, cp["brand"], 16, "on_dark", head=True, bold=True, max_lines=2,
                           name="Mock-up brand")
            if end_line:
                sc.text(fx + 0.12, fy + 0.14 + used, fw - 0.24, fh - used - 0.24, end_line, 14, "on_dark", src=end_line, name="Mock-up line")
        sc.rect(fx, fy, fw, fh, line="ink", name="Mock-up storyboard")
        sc.text(x, fy, 0.28, height(1, MIN_PT), str(i + 1), MIN_PT, "ink", bold=True, max_lines=1, name="Mock-up shot")
        cy = fy
        for ln in per[i]:
            used = sc.text(tx, cy, tw, fy + fh - cy, ln, 16, "ink", src=ln, name="Mock-up frame line")
            cy += used + 0.04 if used else 0.0


def _print(sc: Scene, cp: dict, pic: bool) -> None:
    x, y, w, h = sc.box
    sc.rect(x, y, w, h, fill="panel", name="Mock-up ground")
    ah = h * 0.94
    aw = ah / 1.414
    ax, ay = x + (w - aw) / 2, y + h * 0.02
    sc.rect(ax + 0.08, ay + 0.08, aw, ah, fill="rule", name="Mock-up shadow")
    sc.rect(ax, ay, aw, ah, fill="paper", line="rule", name="Mock-up page")
    if not pic:
        _ad(sc, ax, ay, aw, ah, cp, False)
        return
    best = None
    for frac in (0.46, 0.38, 0.3):   # the picture gives way until the headline (then the line) fits the page
        sub = Scene(sc.kind, sc.box, sc.fonts)
        _page(sub, ax, ay, aw, ah, cp, frac)
        k = (bool(cp["headline"]) and cp["headline"] not in sub.used, len(sub.spill))
        if best is None or k < best[0]:
            best = (k, sub)
        if k == (False, 0):
            break
    sub = best[1]
    sc.ops += sub.ops
    sc.spill += sub.spill
    sc.used |= sub.used
    sc.slots += sub.slots


def _page(sc: Scene, ax, ay, aw, ah, cp: dict, frac: float) -> None:
    pad = aw * 0.07
    ph = ah * frac
    sc.pic(ax + pad, ay + pad, aw - 2 * pad, ph, "picture")
    yy = ay + pad + ph + 0.14
    brand_h = height(1, MIN_PT)
    room = ay + ah - pad - brand_h - 0.1 - yy
    used = sc.text(ax + pad, yy, aw - 2 * pad, room * (0.6 if cp["line"] else 1.0), cp["headline"], 24, "ink", head=True, bold=True,
                   src=cp["headline"], name="Mock-up headline")
    if cp["line"]:
        sc.text(ax + pad, yy + used + 0.06, aw - 2 * pad, max(room - used - 0.06, 0.0), cp["line"], 14, "ink", src=cp["line"], name="Mock-up line")
    sc.text(ax + pad, ay + ah - pad - brand_h, aw - 2 * pad, brand_h, cp["brand"], MIN_PT, "ink", bold=True, align="r", max_lines=1,
            name="Mock-up brand")


def scene(title: str, box: tuple, cp: dict, pics: dict, fonts: dict) -> Scene:
    """The mock-up of one execution in ``box`` (x, y, w, h inches): its ops, the slots drawn, the copy it holds and the copy that spilled.
    ``cp`` is ``copy_of``; ``pics`` the slide's drawn pictures by slot (``picture``, ``shot_*``); ``fonts`` ``{head, body}`` names."""
    kind = kind_of(title)
    sc = Scene(kind, box, fonts)
    pic = "picture" in pics
    if kind == "radio":
        _radio(sc, cp)
    elif kind == "film":
        shots = sorted(k for k in pics if k.startswith("shot_"))
        _film(sc, cp, shots if len(shots) >= spec.STRIP_MIN else [], pic)
    elif kind == "phone":
        _phone(sc, cp, pic)
    elif kind == "shelf":
        _shelf(sc, cp, pic)
    elif kind == "billboard":
        _billboard(sc, cp, pic)
    elif kind == "print":
        _print(sc, cp, pic)
    else:
        _poster(sc, cp, pic, street(title))
    return sc


def left_blocks(sc: Scene, cp: dict) -> list:
    """What the slide's left column adds under the role: the copy the ad does not carry (the middle lines and any that spilled), as the
    copy it is (basis creative), and the closing answer. Nothing is cut: every line of the copy is on the slide, once."""
    out = []
    rest = [ln for ln in cp["lines"] if ln not in sc.used and _unspeak(ln) not in sc.used]
    if rest:
        out.append({"kind": "bullets", "items": [{"text": ln, "basis": "creative"} for ln in rest], "basis": "creative"})
    if cp.get("answer"):
        out.append({"kind": "small", "text": cp["answer"], "basis": "creative"})
    return out


# ------------------------------------------------------------------------------------------------------------------- the web twin

#: Token -> CSS custom property (render_web's :root).
CSS_VAR = {"ink": "--ink", "paper": "--paper", "panel": "--tint", "rule": "--line", "mute": "--muted", "accent": "--accent",
           "accent_ink": "--accent-ink", "on_dark": "--dark-text"}
PX = 144   # px per inch on the 1920 x 1080 stage


def svg(sc: Scene, src_of) -> str:
    """The scene as one inline SVG positioned on the stage (absolute, px), ``src_of(slot)`` giving a drawn picture's address."""
    from html import escape as _e
    x0, y0, w0, h0 = sc.box
    v = lambda a: f"{a * PX:.1f}"   # noqa: E731
    out = []
    for i, o in enumerate(sc.ops):
        x, y, w, h = o["x"] - x0, o["y"] - y0, o["w"], o["h"]
        if o["op"] in ("rect", "rrect", "oval"):
            st = f'fill:var({CSS_VAR[o["fill"]]})' if o.get("fill") else "fill:none"
            if o.get("line"):
                st += f';stroke:var({CSS_VAR[o["line"]]});stroke-width:1.5'
            if o["op"] == "oval":
                out.append(f'<ellipse cx="{v(x + w / 2)}" cy="{v(y + h / 2)}" rx="{v(w / 2)}" ry="{v(h / 2)}" style="{st}"/>')
            else:
                rr = f' rx="{v(min(w, h) * o.get("r", 0.1))}"' if o["op"] == "rrect" else ""
                out.append(f'<rect x="{v(x)}" y="{v(y)}" width="{v(w)}" height="{v(h)}"{rr} style="{st}"/>')
        elif o["op"] == "pic":
            href = src_of(o["slot"])
            if href:
                out.append(f'<image href="{_e(href)}" x="{v(x)}" y="{v(y)}" width="{v(w)}" height="{v(h)}" preserveAspectRatio="xMidYMid slice"/>')
        elif o["op"] == "text":
            px = o["size"] * 2   # 2 px per point on the stage
            lh = px * LINE
            n = len(o["lines"])
            ty = y * PX + 0.03 * PX
            if o["anchor"] == "m":
                ty = y * PX + (h * PX - n * lh) / 2
            anchor = {"l": "start", "c": "middle", "r": "end"}[o["align"]]
            tx = {"l": x, "c": x + w / 2, "r": x + w}[o["align"]] * PX
            font = "var(--head)" if o["font"] == "head" else "var(--body)"
            spans = "".join(f'<tspan x="{tx:.1f}" y="{ty + lh * (k + 0.8):.1f}">{_e(t)}</tspan>' for k, t in enumerate(o["lines"]))
            out.append(f'<text text-anchor="{anchor}" style="font:{700 if o["bold"] else 400} {px:.0f}px {font};fill:var({CSS_VAR[o["color"]]})">'
                       f'{spans}</text>')
    return (f'<svg class="mock-svg" width="{v(w0)}" height="{v(h0)}" viewBox="0 0 {v(w0)} {v(h0)}" role="img" '
            f'aria-label="{_e("Mock-up of the work")}">{"".join(out)}</svg>')
