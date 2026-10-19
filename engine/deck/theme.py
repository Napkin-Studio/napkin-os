"""One theme object for the Deck Maker's native-shape layouts (stage g).

A ``Theme`` is the single set of tokens the pptx layouts draw from: palette (dark ink, light
surface, panel, rule, muted caption ink, accent and an accessible ``accent_ink`` for accent-coloured
TEXT), type scale, spacing grid and margins. The default theme ``napkin`` is the cream / navy / rust
system of the slide bake-off, set in the two fonts render_pptx already names (Cambria and Calibri).
``classic`` is the look the renderer had before the layout library (white, navy, amber); with it the
renderer keeps the old single-column flow for every slide.

A brand JSON (``--brand``: ``{"colors": {...}, "head": ..., "body": ...}``) is applied on top of
either theme exactly as render_pptx applied it before: the legacy colour keys ``ink paper accent
muted tint line dark_text`` and the fonts ``head`` and ``body``. The new keys ``accent_ink panel rule
mute on_dark on_dark_mute accent_on_dark`` are accepted too. The brand's accent is always used as it
is for fills; for accent-coloured text a brand that gives no ``accent_ink`` gets one derived from its
accent (darkened until it reaches 4.5:1 on the surface; ``Theme.derived`` lists what was derived).
Nothing here fails on a poor brand palette: ``check_palette`` returns the problems and the renderer
keeps them on ``Renderer.theme_problems``.

Stdlib only.
"""
from __future__ import annotations

import re
from dataclasses import dataclass, field, replace

HEX = re.compile(r"^[0-9A-Fa-f]{6}$")
#: WCAG 2.x AA for normal text.
AA = 4.5

#: Legacy brand colour key -> Theme field (what render_pptx's THEME dict called each colour).
LEGACY_KEYS = {"ink": "ink", "paper": "paper", "accent": "accent", "muted": "mute", "tint": "panel",
               "line": "rule", "dark_text": "on_dark"}
#: Every colour key a brand may set: the legacy ones, the Theme field names themselves.
COLOR_FIELDS = ("ink", "paper", "panel", "rule", "mute", "accent", "accent_ink", "on_dark", "on_dark_mute", "accent_on_dark")


def _rgb(h: str) -> tuple:
    """Hex string (with or without ``#``) to an (r, g, b) tuple of 0-255 ints."""
    h = h.lstrip("#")
    return int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16)


def _hex(c) -> str:
    """(r, g, b) of 0-255 numbers to an upper-case hex string."""
    return "%02X%02X%02X" % tuple(max(0, min(255, round(v))) for v in c)


def luminance(h: str) -> float:
    """WCAG relative luminance of a hex colour (0 black, 1 white)."""
    def lin(v):
        v /= 255
        return v / 12.92 if v <= 0.03928 else ((v + 0.055) / 1.055) ** 2.4
    r, g, b = (lin(v) for v in _rgb(h))
    return 0.2126 * r + 0.7152 * g + 0.0722 * b


def contrast(a: str, b: str) -> float:
    """WCAG contrast ratio between two hex colours, 1.0 (same) to 21.0 (black on white)."""
    la, lb = luminance(a), luminance(b)
    hi, lo = max(la, lb), min(la, lb)
    return (hi + 0.05) / (lo + 0.05)


def blend(a: str, b: str, t: float) -> str:
    """``a`` moved ``t`` (0-1) of the way to ``b``, as hex."""
    ra, rb = _rgb(a), _rgb(b)
    return _hex(tuple(x + (y - x) * t for x, y in zip(ra, rb)))


def tune(color: str, against: str, minimum: float = AA, toward: str | None = None) -> str:
    """``color`` itself if it already reaches ``minimum``:1 on ``against``; otherwise the smallest
    step toward ``toward`` (default: black on a light ground, white on a dark one) that does."""
    if contrast(color, against) >= minimum:
        return color.upper()
    toward = toward or ("000000" if luminance(against) > 0.4 else "FFFFFF")
    for i in range(1, 101):
        c = blend(color, toward, i / 100)
        if contrast(c, against) >= minimum:
            return c
    return toward


@dataclass(frozen=True)
class Scale:
    """Type scale in points. ``min`` is the floor no text may go below; the three ``*_floor`` fields are
    the stage h floors by role (body, caption, footer), recorded here once and read by qa_render."""
    display: int = 44      # cover and idea titles
    title: int = 36        # a slide's takeaway title
    title_long: int = 30   # titles over ~60 characters
    title_min: int = 28    # the floor when a title is very long (never below this; stage h's title floor)
    lead: int = 22         # emphasis bars, quotes
    body: int = 16
    small: int = 14
    caption: int = 11
    foot: int = 10         # footer, slide number, status marks
    min: int = 10
    # Floors (points) that stage h (qa_render) reads, so the renderer and the QA agree by construction.
    # A presented slide's body text is never under ``body_floor``; a caption (a label over a card, a tag,
    # a kicker) is never under ``caption_floor``; footer and source lines (slide number, section label,
    # source keys, DRAFT / CHECK FAILED marks) may be as small as ``foot_floor`` and are exempt from the two
    # above under a named allowance in qa_render (CHROME); a title is never under ``title_min``.
    body_floor: int = 12
    caption_floor: int = 10
    foot_floor: int = 9


@dataclass(frozen=True)
class Grid:
    """Spacing grid in inches. Margins are never under 0.5 in."""
    W: float = 13.333
    H: float = 7.5
    M: float = 0.65        # left and right margin
    G: float = 0.25        # gutter between cards
    unit: float = 0.125    # base step
    top: float = 0.55      # kicker tick
    title_y: float = 0.8
    body_top: float = 2.0
    body_end: float = 6.75 # last y of content; the footer sits below
    foot_y: float = 7.0


@dataclass(frozen=True)
class Theme:
    """The one token object the layouts read. See the module docstring."""
    name: str
    ink: str            # dark text and dark slides
    paper: str          # the light surface (slide background)
    panel: str          # card fill on the surface
    rule: str           # hairlines
    mute: str           # caption text on the surface
    accent: str         # fills, bars, chips
    accent_ink: str     # accent-coloured TEXT on paper and panel (>= 4.5:1)
    on_dark: str        # text on ink
    on_dark_mute: str   # caption text on ink
    accent_on_dark: str  # accent text and fills on ink
    head: str = "Cambria"
    body: str = "Calibri"
    scale: Scale = field(default_factory=Scale)
    grid: Grid = field(default_factory=Grid)
    layouts: bool = True      # False: the old single-column flow for every slide
    derived: tuple = ()       # names of tokens derived from a brand rather than given

    def legacy(self) -> dict:
        """The tokens under the old THEME dict's keys (ink paper accent muted tint line dark_text head body)."""
        return {"ink": self.ink, "paper": self.paper, "accent": self.accent, "muted": self.mute, "tint": self.panel,
                "line": self.rule, "dark_text": self.on_dark, "head": self.head, "body": self.body}

    def with_brand(self, brand: dict | None) -> "Theme":
        """This theme with a brand JSON applied: its colours and fonts win; missing accessible tokens are derived."""
        brand = brand or {}
        colors = {k: str(v).lstrip("#") for k, v in (brand.get("colors") or {}).items()}
        upd = {}
        for k, v in colors.items():
            f = LEGACY_KEYS.get(k, k if k in COLOR_FIELDS else None)
            if f and HEX.match(v):
                upd[f] = v.upper()
        for k in ("head", "body"):
            v = brand.get(k)
            if isinstance(v, str) and v.strip() and not _FONT_BAD.search(v):
                upd[k] = v.strip()
        if not upd:
            return self
        t = replace(self, **upd)
        derived = list(self.derived)
        if self.layouts and set(upd) & {"accent", "paper", "panel", "ink", "on_dark"}:   # classic stays exactly as it was
            def derive(field_, value):
                """Set a token that the brand did not give."""
                nonlocal t
                if field_ not in upd:
                    t = replace(t, **{field_: value})
                    derived.append(field_)
            derive("accent_ink", tune(t.accent, t.paper))
            if "accent_ink" not in upd and contrast(t.accent_ink, t.panel) < AA:
                t = replace(t, accent_ink=tune(t.accent, t.panel))
            derive("accent_on_dark", tune(t.accent, t.ink, toward="FFFFFF"))
            derive("on_dark_mute", blend(t.on_dark, t.ink, 0.25))
        return replace(t, derived=tuple(derived))


_FONT_BAD = re.compile("[\x00-\x1f<>&\"]")


NAPKIN = Theme(
    name="napkin", ink="1B2430", paper="FAF7F1", panel="F0EADD", rule="D8D0BF", mute="566070",
    accent="A8431D", accent_ink="A8431D", on_dark="FAF7F1", on_dark_mute="C9C2B2", accent_on_dark="F0A27C")

#: The look before the layout library: white, navy, amber (render_pptx's THEME). Its amber is a fill
#: colour; as text on white it is below 4.5:1, which ``check_palette`` reports on purpose.
CLASSIC = Theme(
    name="classic", ink="1B2430", paper="FFFFFF", panel="EEF1F4", rule="D5DBE1", mute="5B6773",
    accent="E8A33D", accent_ink="E8A33D", on_dark="F5F3EE", on_dark_mute="A9B3BD", accent_on_dark="E8A33D",
    scale=Scale(foot=9, min=0), layouts=False)

THEMES = {"napkin": NAPKIN, "classic": CLASSIC}
DEFAULT = "napkin"


def get_theme(name: str | Theme = DEFAULT, brand: dict | None = None) -> Theme:
    """The named theme (or the Theme given) with the brand JSON applied. Unknown names raise ValueError."""
    if isinstance(name, Theme):
        base = name
    elif name in THEMES:
        base = THEMES[name]
    else:
        raise ValueError(f"unknown theme {name!r}; choose one of {', '.join(THEMES)}")
    return base.with_brand(brand)


def check_palette(t: Theme) -> list:
    """Problems with a theme, as readable strings (empty: fine). Checks every text/ground pair at 4.5:1,
    colour syntax, the type scale ranges (title 36-44, body 14-16, caption 10-12), the font floor of 10 pt
    and margins of at least 0.5 in."""
    problems = []
    for f in COLOR_FIELDS:
        if not HEX.match(getattr(t, f)):
            problems.append(f"{f} is not a 6-digit hex colour: {getattr(t, f)!r}")
    if problems:
        return problems
    pairs = (("ink", "paper"), ("ink", "panel"), ("mute", "paper"), ("mute", "panel"),
             ("accent_ink", "paper"), ("accent_ink", "panel"),
             ("on_dark", "ink"), ("on_dark_mute", "ink"), ("accent_on_dark", "ink"))
    for fg, bg in pairs:
        r = contrast(getattr(t, fg), getattr(t, bg))
        if r < AA:
            problems.append(f"{fg} on {bg} is {r:.2f}:1, under {AA}:1")
    s, g = t.scale, t.grid
    if t.layouts:
        if not 36 <= s.title <= 44:
            problems.append(f"title size {s.title} pt outside 36-44")
        if not 14 <= s.body <= 16:
            problems.append(f"body size {s.body} pt outside 14-16")
        if not 10 <= s.caption <= 12:
            problems.append(f"caption size {s.caption} pt outside 10-12")
        if s.min < 10:
            problems.append(f"font floor {s.min} pt is under 10")
        if s.caption < s.caption_floor:
            problems.append(f"caption size {s.caption} pt is under the caption floor {s.caption_floor}")
        if s.foot < s.foot_floor:
            problems.append(f"footer size {s.foot} pt is under the footer floor {s.foot_floor}")
        if not s.foot_floor <= s.caption_floor <= s.body_floor <= s.body:
            problems.append("floors out of order: need foot <= caption <= body floor <= body size")
    if g.M < 0.5:
        problems.append(f"margin {g.M} in is under 0.5")
    if not (t.head and t.body):
        problems.append("a font name is empty")
    return problems
