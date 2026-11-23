"""Render deck.json to an editable .pptx with python-pptx (stage g). Deterministic, no model.

Why python-pptx rather than pptxgenjs: one language with the engine, no new tracked node
dependency, and it opens an agency .potx master directly when one is supplied (``--master``),
so designers keep their layouts. Charts are native PowerPoint charts built from fact values;
speaker notes carry the evidence; slides are grouped into PowerPoint sections.

Look: one theme object (``theme.py``: palette, type scale, spacing grid). The default theme
``napkin`` is cream, navy and rust in Cambria and Calibri; ``classic`` is the earlier white, navy and
amber look, drawn with the old single-column flow only. A brand JSON (``--brand``) or an agency
``--master`` is honoured exactly as before.

Layouts: with a layout theme every slide gets a NATIVE-SHAPE layout (rectangles, text boxes, native
tables and charts; no pictures, no icons, with ONE exception: the brand's own logo lockup
(``meta.brand.logo_dark_png``) on the title slide, supplied by the brand and never invented; it
carries alt text and the kicker label stays beside it) chosen by a written rule, ``choose_layout``, from the
slide type and the kinds of its blocks. First match wins:

=================  =========================================================================
layout             chosen when
=================  =========================================================================
cover              slide type ``title``
emphasis_bar       type ``real_question``, ``idea`` or ``appendix`` and its blocks are only
                   ``statement`` / ``text`` / ``small`` (title left, the statement in an accent bar)
chart              type ``chart`` with a ``chart`` block (one native bar chart on a fixed 0 to 100
                   scale with the hero bars in the accent, not repeated as number panels;
                   commentary as cards)
execution          type ``execution`` (role notes left, the copy in a channel frame right)
territory          type ``territory`` (reasons left, the illustrative sketch panel right)
placeholder_card   a bullets item is flagged ``human``, or the type is in HUMAN_ONLY_TYPES and
                   the slide ``needs_human``: dashed card, small ``PROPOSED`` tag, ``TO SUPPLY``
                   chip, never styled as finished; given facts stay solid cards
quote_cards        an ``insight`` slide with a ``quote`` and ``bullets``: quote panel left,
                   one card per bullet right
comparison         a ``fromto`` block: two panels (light From, dark To) with an arrow
objective_panel   an ``objective`` slide whose words hold a target figure (``_objective_facts``): a dark panel with the target as a big
                   figure, the baseline and the date beside it as small lines (pulled from the same sentence, never invented), the
                   objective's own blocks as cards on the right; an objective with no figure is drawn as ``cards``
risk_cards         a ``risks`` slide whose only block is ``kv`` (a risk and its mitigation per item): one card per risk, the risk as the
                   card's heading, the mitigation under it (up to four; more are rows)
comparison_grid    a ``competition`` slide with a three-column ``table`` flagged ``compare``: a dark cell for each alternative, beside
                   what makes the client pick it and how we win it (the header words as captions)
big_number         a ``stats`` block with one item: one dark panel with a large figure
kpi_row            a ``stats`` block with two to four items: a row of KPI cards
timeline_strip     a ``steps`` block on a ``timeline`` / ``process`` slide (and any ``steps``
                   block with stats or text around it): a rail with a marker per step
role_grid          a two-column ``table`` on ``channel_roles``, or ``steps`` on ``founders`` /
                   ``team``: a dark role cell beside the job it does
native_table       a ``table`` block: a clean native table, header in ink, thin rules (also the ``measurement_plan`` slide: KPI,
                   baseline, target, lag and confounders)
cards              only bullets, text, small, statement, callout, card or kv blocks: bullets
                   become one card each (one bullet becomes an emphasis bar)
flow               anything else (and the fallback below)
=================  =========================================================================

Balance (how a layout uses the height): ``stack(fill=True)`` sets the type as large as the slide allows
(up to 1.6 times; lead lines and quotes less), then hands what height is left to the cards and panels, so
a short slide ends on the foot of the content area; paired cards share one height, figures in a row share
one baseline, a short last row of cards spans the width (no empty cell), a table is as wide as its slot,
a dark panel and the cards beside it end on one line, and closing lines sit a fixed gap under their panel.
When a stack has nothing that can grow, it sits at the vertical middle of the area. The last two words of
a text are joined by a no-break space (``glue``) so a wrapped text never ends on a lone word; the words
are unchanged. Type floors (``theme.Scale``): body 12 pt, caption 10 pt, footer 9-10 pt, title 28 pt;
only a slide too dense to fit at them is set once more with body text down to the caption floor
(``Renderer._relaxed``), and stage h reports it.

Safe fallback: a layout raises ``NoFit`` when its words do not fit at its smallest sizes, or holds a
block kind it has no look for; the slide is then drawn by the earlier flow (``_flow``: one column,
heights estimated, font stepped down), which is how every slide was drawn before. ``Renderer.layouts``
records the layout each slide ended up with, by slide id.

Words are fixed: a layout may split a block into cards or bullets and change size and position, never
reword, shorten, drop or add words. The only added text is small fixed labels: the footer, the DRAFT
mark, the CHECK FAILED flag, ``PROPOSED`` / ``TO SUPPLY`` on placeholders, From / To on a comparison,
the objective panel's captions (THE TARGET, BASELINE, BY WHEN) and the labels the earlier renderer already drew (THE IDEA, THE REAL QUESTION, the kicker).

``animate`` (off by default) adds native PowerPoint motion: a fade transition on every slide and
entrance builds, the title first and then each content block in reading order. ``"auto"`` (or
True) plays the builds one after another with no clicks; ``"click"`` reveals each block on a click.
Footer, slide number, watermark and check flags never animate.
"""
from __future__ import annotations

import copy
import dataclasses
import itertools
import json
import re
from pathlib import Path
from types import SimpleNamespace

from lxml import etree
from pptx import Presentation
from pptx.chart.data import CategoryChartData
from pptx.dml.color import RGBColor
from pptx.enum.chart import XL_CHART_TYPE, XL_LABEL_POSITION
from pptx.enum.dml import MSO_LINE
from pptx.enum.shapes import MSO_SHAPE, MSO_SHAPE_TYPE
from pptx.enum.text import MSO_ANCHOR, PP_ALIGN
from pptx.oxml.ns import nsdecls, qn
from pptx.util import Emu, Inches, Pt

from . import export_clean, images, layouts, numfmt, spec
from . import theme as themes
from .refs import Resolver, fmt
from .spec import HUMAN_ONLY_TYPES, shown_blocks

#: The earlier (classic) palette as a dict. render_web imports it; the renderer itself reads a Theme.
THEME = {
    "ink": "1B2430", "paper": "FFFFFF", "accent": "E8A33D", "muted": "5B6773",
    "tint": "EEF1F4", "line": "D5DBE1", "dark_text": "F5F3EE",
    "head": "Cambria", "body": "Calibri",
}
DARK_TYPES = {"title", "real_question", "idea", "next_step", "appendix", "close"}
#: deck-look: the real question sits on paper (a band and a hero line), the rest keep their dark slides.
DARK_TYPES_V3 = DARK_TYPES - {"real_question"}
#: The section band (deck-look step 2), in inches: hairline, label, hairline across the content width; the title starts under it.
BAND_TOP, BAND_LABEL_Y, BAND_LABEL_H, BAND_BOTTOM, BAND_TITLE_Y = 0.50, 0.54, 0.24, 0.84, 0.94


def dark_types(v3: bool | None = None) -> set:
    """The slide types drawn on a dark ground (``spec.LOOK_V3`` moves the real question to paper)."""
    return DARK_TYPES_V3 if (spec.LOOK_V3 if v3 is None else v3) else DARK_TYPES
W, H = 13.333, 7.5
X0, X1 = 0.6, 12.73
Y_BODY, Y_END = 1.85, 6.75
#: Animate mode: effect length and the pause before each auto build (ms).
ANIM_DUR, ANIM_GAP = 450, 120
#: Entrance effects: PowerPoint preset id, subtype and filter.
EFFECTS = {"fade": (10, 0, "fade"), "wipe": (22, 8, "wipe(left)")}
#: Fixed labels a layout may add (everything else on a slide is the deck's own words).
TAG, CHIP = "PROPOSED", "TO SUPPLY"
#: Scales a layout is tried at, from full size down; below the last it falls back to the flow.
SCALES = (1.0, 0.92, 0.85, 0.78, 0.72)
#: The table style id for "no style, no grid" (borders and fills are set per cell).
NO_STYLE = "{2D5ABB26-0587-4C30-8999-92F81FD0307C}"
NUM = re.compile(r"^[<>~≈]?[€$£]?\d[\d,.]*(%|×|[kKMB])?$")
#: A numeric first word of a bullet is set large, the rest of the sentence beside it.


def band_label(s: dict, meta: dict) -> str:
    """The section topic for the band (pptx and web): the slide's section (sentence case), never the slide's title; when the section is
    the title, the deck's project; when that is the title too, nothing."""
    norm = lambda t: re.sub(r"\W+", " ", str(t or "")).strip().lower()
    title = norm(s.get("title"))
    for c in (s.get("section"), meta.get("project"), meta.get("title")):
        if c and norm(c) != title:
            return str(c)
    return ""


class NoFit(Exception):
    """A layout cannot hold the slide's words at its smallest sizes, or has no look for a block."""


def choose_layout(s: dict, audience: str = "review") -> str:
    """The layout name for one slide dict, by the rule table in the layout files (``layouts.pick``: pure, no drawing, no fit).
    Today's 17-rule table lives there as ``priority`` and ``when``; this stays as the one call the renderer and the tests make."""
    return layouts.pick(s, audience)


def _choose_layout_frozen(s: dict, audience: str = "review") -> str:
    """A frozen copy of the rule table as it stood before the layout library (parity tests compare ``layouts.pick`` with it)."""
    t, st = s["type"], s.get("status")
    bl = shown_blocks(s, audience)
    kinds = [b["kind"] for b in bl]
    human = any(isinstance(i, dict) and i.get("human") for b in bl if b["kind"] == "bullets" for i in b.get("items", []))
    if t == "title":
        return "cover"
    if t in ("real_question", "idea", "appendix") and set(kinds) <= {"statement", "text", "small"}:
        return "emphasis_bar"
    if t == "objective" and _objective_facts([x for b in bl for x in ([b.get("text", "")] + [i["text"] if isinstance(i, dict) else str(i) for i in b.get("items", []) if kinds and b["kind"] == "bullets"])]):
        return "objective_panel"
    if t == "risks" and kinds == ["kv"]:
        return "risk_cards"
    if t == "competition" and "table" in kinds and any(b.get("compare") and len(b["rows"][0]) == 3 for b in bl if b["kind"] == "table"):
        return "comparison_grid"
    if t == "chart" and "chart" in kinds:
        return "chart"
    if t == "execution":
        return "execution"
    if t == "territory":
        return "territory"
    if human or (t in HUMAN_ONLY_TYPES and st == "needs_human"):
        return "placeholder_card"
    if t == "insight" and "quote" in kinds and "bullets" in kinds:
        return "quote_cards"
    if "fromto" in kinds:
        return "comparison"
    if "stats" in kinds:
        n = len(next(b for b in bl if b["kind"] == "stats")["items"])
        return "big_number" if n == 1 else "kpi_row"
    if "steps" in kinds:
        return "role_grid" if t in ("founders", "team") else "timeline_strip"
    if "table" in kinds:
        tb = next(b for b in bl if b["kind"] == "table")
        return "role_grid" if t == "channel_roles" and len(tb["rows"][0]) == 2 else "native_table"
    if set(kinds) <= {"bullets", "text", "small", "statement", "callout", "card", "kv", "quote"}:
        return "cards"
    return "flow"


def _item_text(i) -> str:
    """The text of a bullets item (a string or a dict with ``text``)."""
    return str(i.get("text", "")) if isinstance(i, dict) else str(i)


def _rgb(h):
    """Hex string to RGBColor."""
    return RGBColor.from_string(h)


def _kicker(meta: dict) -> str:
    """The title slide's label: the responding agency when the prompt names one, never assumed."""
    if meta.get("kind") == "investor":
        return "Investor deck"
    ag = (meta.get("agency") or "").strip()
    return f"{ag} · response deck" if ag and not ag.startswith("[") else "Response deck"


def _est_h(text, width_in, size_pt, line=1.22):
    """Rough text height in inches for wrapped text (QA catches what this misses)."""
    cpl = max(8, int(width_in * 72 / (size_pt * 0.50)))
    lines = 0
    for para in str(text).split("\n"):
        lines += max(1, -(-len(para) // cpl))
    return lines * size_pt * line / 72 + 0.12


#: No-break space: joins two words without changing them (PowerPoint and LibreOffice both keep them together).
NBSP = "\u00a0"


def glue(text) -> str:
    """``text`` with its last two words joined by a no-break space, so the last line of a wrapped text never
    holds one word alone. Text of fewer than three words, or with a line break, is returned as it was; no word is
    added, dropped or changed (``\\s`` matches the no-break space, so word comparisons are unaffected)."""
    t = numfmt.format_text(str(text))   # money as people write it (numfmt): at render time only, the stored words stay as they were
    if "\n" in t or t.count(" ") < 2:
        return t
    head, _, last = t.rstrip().rpartition(" ")
    return head + NBSP + last if head.strip() and last.strip() and NBSP not in head[-1:] else t


def _half(v: float) -> float:
    """A point size rounded to the nearest half point (PowerPoint stores hundredths; halves stay tidy)."""
    return round(v * 2) / 2


def _kv_parts(val) -> list:
    """A key/value block's value as a list of strings: a list value is one paragraph per item."""
    return [str(v) for v in val] if isinstance(val, (list, tuple)) else [str(val)]


def _lead_number(text: str):
    """(figure, rest) when a sentence opens with a figure such as ``73%`` or ``€1.2M``; else None."""
    first, _, rest = str(text).partition(" ")
    return (first, rest.strip()) if rest.strip() and NUM.match(first) else None


_FIG = re.compile(r"[<>~≈]?(?:[€$£]|(?:EUR|USD|GBP)\s)\s?\d[\d,.]*(?:\s?(?:[kKmMbB]n?\b|million\b|billion\b))?|\d[\d,.]*\s?(?:%|per ?cent\b|×)")
_BY_DATE = re.compile(r"\b(?:by\s+(?:the end of\s+|end of\s+)?(?:\d{1,2}\s+)?(?:Q[1-4]\b(?:\s+\d{4})?|(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\w*(?:\s+\d{4})?|\d{4})"
                      r"|(?:in|within)\s+\d+\s+(?:months?|weeks?|years?|days?))", re.I)


_LIMIT_BEFORE = re.compile(r"(?:up to|capped at|no more than|at most|budget of|budget|cap|ceiling|limit|spend|fees?|costs?)[:\s]*$", re.I)
_LIMIT_AFTER = re.compile(r"^\s*(?:budget|cap|ceiling|limit|spend|fees?|costs?)\b", re.I)


def _is_limit_figure(t: str, m) -> bool:
    """True when a figure match ``m`` in sentence ``t`` is a budget or ceiling ("up to EUR 5m", "$5m budget"), not the target."""
    return bool(_LIMIT_BEFORE.search(t[:m.start()]) or _LIMIT_AFTER.match(t[m.end():]))


def _objective_facts(texts: list) -> dict | None:
    """The target figure, baseline and date an objective's own sentences state, pulled out for the objective panel (never invented):
    ``{"target", "baseline", "date"}`` (the last two may be empty), or None when no sentence holds a figure. The target is the figure
    after ``to`` in a "from X to Y" (else the first figure); the baseline is the figure after ``from``; the date is a "by ..." or
    "in/within N months" phrase."""
    for t in texts:
        t = str(t)
        figs = [m for m in _FIG.finditer(t) if not _is_limit_figure(t, m)]   # a budget or ceiling is never labelled the target
        if not figs:
            continue
        base = re.search(r"\bfrom\s+(" + _FIG.pattern + ")", t, re.I)
        to = next((m for m in re.finditer(r"\bto\s+(" + _FIG.pattern + ")", t, re.I) if not _is_limit_figure(t, m) and not _LIMIT_BEFORE.search(t[:m.start() + 2])), None)
        by = _BY_DATE.search(t)
        return {"target": (to.group(1) if to else figs[0].group(0)).strip(), "baseline": base.group(1).strip() if base else "", "date": by.group(0).strip() if by else ""}
    return None


def _effect_xml(ids, spid, effect, node, delay):
    """One entrance effect on one shape: make it visible, then fade or wipe it in."""
    pid, sub, flt = EFFECTS[effect]
    a, b, c = next(ids), next(ids), next(ids)
    tgt = f'<p:tgtEl><p:spTgt spid="{spid}"/></p:tgtEl>'
    return (f'<p:par><p:cTn id="{a}" presetID="{pid}" presetClass="entr" presetSubtype="{sub}" fill="hold" grpId="0" nodeType="{node}">'
            f'<p:stCondLst><p:cond delay="{delay}"/></p:stCondLst><p:childTnLst>'
            f'<p:set><p:cBhvr><p:cTn id="{b}" dur="1" fill="hold"><p:stCondLst><p:cond delay="0"/></p:stCondLst></p:cTn>{tgt}'
            '<p:attrNameLst><p:attrName>style.visibility</p:attrName></p:attrNameLst></p:cBhvr><p:to><p:strVal val="visible"/></p:to></p:set>'
            f'<p:animEffect transition="in" filter="{flt}"><p:cBhvr><p:cTn id="{c}" dur="{ANIM_DUR}"/>{tgt}</p:cBhvr></p:animEffect>'
            '</p:childTnLst></p:cTn></p:par>')


def _build_par(ids, steps, auto):
    """One click group: its steps play after one another (from slide start when ``auto``)."""
    top = next(ids)
    cond = '<p:cond delay="indefinite"/>' + ('<p:cond evt="onBegin" delay="0"><p:tn val="2"/></p:cond>' if auto else "")
    subs, t = [], 0
    for i, (spids, effect) in enumerate(steps):
        sub = next(ids)
        delay = ANIM_GAP if i else 0
        node = "afterEffect" if (auto or i) else "clickEffect"
        effs = "".join(_effect_xml(ids, sp, effect, node if j == 0 else "withEffect", delay) for j, sp in enumerate(spids))
        subs.append(f'<p:par><p:cTn id="{sub}" fill="hold"><p:stCondLst><p:cond delay="{t}"/></p:stCondLst>'
                    f'<p:childTnLst>{effs}</p:childTnLst></p:cTn></p:par>')
        t += delay + ANIM_DUR
    return (f'<p:par><p:cTn id="{top}" fill="hold"><p:stCondLst>{cond}</p:stCondLst>'
            f'<p:childTnLst>{"".join(subs)}</p:childTnLst></p:cTn></p:par>')


_XML_BAD = re.compile("[\x00-\x08\x0b\x0c\x0e-\x1f\ufffe\uffff\ud800-\udfff]")
_IMG_MAGIC = (b"\x89PNG\r\n\x1a\n", b"\xff\xd8\xff", b"GIF8", b"BM")


def _clean_xml(v):
    """A copy of ``v`` (nested dicts, lists, strings) with characters XML 1.0 forbids (NUL, most control
    characters, lone surrogates) removed, so one stray character cannot abort the build."""
    if isinstance(v, str):
        return _XML_BAD.sub("", v)
    if isinstance(v, dict):
        return {(_clean_xml(k)): _clean_xml(x) for k, x in v.items()}
    if isinstance(v, list):
        return [_clean_xml(x) for x in v]
    return v


def _is_image(path) -> bool:
    """True when ``path`` is a regular file whose first bytes are a PNG, JPEG, GIF or BMP signature."""
    try:
        p = Path(path)
        if not p.is_file():
            return False
        with p.open("rb") as f:
            head = f.read(8)
        return head.startswith(_IMG_MAGIC)
    except (OSError, TypeError, ValueError):
        return False


class Renderer:
    """Builds one Presentation from a deck dict."""

    def __init__(self, deck, inp, master: Path | None = None, findings: list | None = None, animate=False, theme=themes.DEFAULT,
                 pictures: dict | None = None):
        self.deck, self.inp = _clean_xml(deck), inp
        deck = self.deck
        # Pictures (deck-frames-in): ``pictures`` maps an asset id to its derived JPEG. None: nothing is drawn and nothing changes.
        self.pictures = pictures
        self.drawn = {k: v for k, v in images.drawn(deck, deck["meta"].get("audience", "review")).items() if v["asset"] in (pictures or {})} if pictures else {}
        self.pic_label = ((deck["meta"].get("preferences") or {}).get("picture_approval") or {}).get("label") or spec.PICTURE_LABEL
        self.picture_findings = []   # [{check, level, slide, message}]: a picture dropped because its slide would not fit it
        self.placed = set()          # (slide id, slot) of every picture this renderer really drew: the web outputs draw exactly these
        self.th = themes.get_theme(theme, (deck["meta"].get("brand") or {}))
        self.theme_problems = themes.check_palette(self.th)
        self.x0 = self.th.grid.M if self.th.layouts else X0
        self.x1 = W - self.x0
        # deck-slide-size: the deck's Canvas (meta.preferences.size, absent = 16:9). Layouts compose on the 16:9 grid; at 4:3 and A4 every
        # primitive draws through the canvas map (theme.Canvas.x / y: margins and type physical, the content box reflowed) and every text
        # measure runs at the reflowed width, so the plan's probe and the drawing agree. At 16:9 ``_cv`` is None and nothing below is read.
        self.cv = themes.canvas_of(deck)
        self._cv = None if self.cv.identity else self.cv
        if self._cv is not None and not self.th.layouts:
            raise ValueError(f"the classic theme draws 16:9 only, not {self.cv.name}: use the napkin theme or --size 16:9")
        self.animate = {True: "auto", False: None}.get(animate, animate)
        if self.animate not in (None, "auto", "click"):
            raise ValueError(f"animate must be False, True, 'auto' or 'click', not {animate!r}")
        self._cur, self.steps = None, []
        self.failed = {}
        self.layouts = {}   # slide id -> the layout it was drawn with
        self.fit_by_slide = {}   # slide id -> the plan's layout.fit, or None
        self.chosen = {}    # slide id -> the layout choose_layout picked (before any fallback)
        self.relaxed = {}   # slide id -> True when the layout fitted only with body text let down to the caption floor
        for f in findings or []:
            if f["level"] == "error" and f.get("slide"):
                self.failed.setdefault(f["slide"], []).append(f["check"])
        self.R = Resolver(inp, list(deck.get("requirements", {}).values()))
        self.prs = Presentation(str(master)) if master else Presentation()
        if not master:
            if self._cv is None:
                self.prs.slide_width, self.prs.slide_height = Inches(W), Inches(H)
            else:
                self.prs.slide_width, self.prs.slide_height = Emu(self._cv.emu[0]), Emu(self._cv.emu[1])
        self.blank = self._layout("Blank") or self.prs.slide_layouts[6]
        self.n_human = sum(1 for s in deck["slides"].values() if s["status"] == "needs_human")
        self.sections = []
        self._role = False
        self._kvcards = False   # territory's wide variant sets this: key/value pairs as cards side by side
        self._relaxed = False   # last resort for a slide too dense at the body floor: body text may go to the caption floor
        self._minh = 0.0        # the minimum height a stretchable look takes (set by ``stack``, 0 when measuring)
        self.p = self._palette(False)
        self.fg = self.p.fg
        # layout plan state (deck-layout-library): the density the deck was planned at, the layout being drawn or probed, the stamped
        # title sizes, the smallest stack scale used, a scale ceiling from a repair fix, and the picture slots of the slide in hand
        self.density = (((deck["meta"].get("preferences") or {}).get("density")) or {}).get("level")
        self._lid, self._tpt, self._min_sc, self._scale_cap, self._pics = None, dict(deck["meta"].get("layout_title_pt") or {}), 1.0, None, {}
        self.shapes_by_slide = {}   # slide id -> [{name, slot, blocks}]: what each slot shape is, for layouts.json
        self.no_plan = False        # --no-layout-plan: choose_layout on every slide, as before the library
        self.clean = False          # True: an export (render(clean=)): no DRAFT mark, no CHECK FAILED flag, no ids in the notes
        self.notes = True           # False: a notes-free export (no speaker notes at all, the moved points included)
        self._slotmap, self._shapes_now, self._sid = {}, [], None
        self._band_drawn = False
        self._foot = None           # deck-look: (x0, x1) of the text side when a picture column takes the rest (footer and DRAFT mark there)
        self._pic_side = {}         # deck-look: slide id -> the side its picture column takes (layouts.picture_sides)
        self._cpl = 48              # characters per line for body, small and lead text (fit.cpl widens it for a slide that fits no other way)
        self._bleed = False         # deck-look step 7: this slide's words sit on a full-bleed picture (the DRAFT mark then gets its own ground)
        self._acc = None            # deck-look (rea-full A3): the title's one accent phrase on the slide in hand (layouts.accent_phrase)
        self._acc_drawn = False
        self._ink = None            # the hole estimate (layouts' swap menu): boxes drawn, in inches, while it measures
        # deck-graphics slice 1: icons only under spec.GRAPHICS (graphics.icons_on); off, nothing below is read and nothing changes
        self._icons_on = False
        if spec.GRAPHICS:
            from . import graphics   # noqa: PLC0415
            self._icons_on = graphics.icons_on(deck)
        self.icons_drawn = {}       # slide id -> {"layout", "ids"}: the icons really drawn, in item order (the web draws exactly these)
        self._exec_title = None     # deck-graphics: the execution title whose picture this slide shows (frames), else None
        self._frame_blocked = None  # deck-graphics: a frame refused for contrast on the picture in hand (its shape is then checked plain)
        self.protect = {}           # deck-slide-size: asset id -> a Production picture's protect boxes ({x0, y0, x1, y1} fractions), read at 4:3 and A4

    def _layout(self, name):
        """A layout of the master by name, or None."""
        for l in self.prs.slide_layouts:
            if l.name == name:
                return l
        return None

    def _palette(self, dark: bool) -> SimpleNamespace:
        """The colours for text, cards and accents on a light or a dark slide (all from the theme)."""
        t = self.th
        if dark:
            card = themes.blend(t.ink, t.on_dark, 0.09)
            if t.v3:   # figures and labels wear the text colour on dark slides too
                return SimpleNamespace(dark=True, bg=t.ink, fg=t.on_dark, mute=t.on_dark_mute, acc_t=t.on_dark,
                                       acc_f=t.accent_on_dark, acc_l=t.accent_on_dark, card=card, card_fg=t.on_dark, card_mute=t.on_dark_mute,
                                       card_acc=t.on_dark, rule=themes.blend(t.ink, t.on_dark, 0.28), chip_fg=t.ink,
                                       inv=t.panel, inv_fg=t.ink, inv_acc=t.ink, inv_mute=t.mute)
            return SimpleNamespace(dark=True, bg=t.ink, fg=t.on_dark, mute=t.on_dark_mute, acc_t=t.accent_on_dark,
                                   acc_f=t.accent_on_dark, acc_l=t.accent_on_dark, card=card, card_fg=t.on_dark, card_mute=t.on_dark_mute,
                                   card_acc=t.accent_on_dark, rule=themes.blend(t.ink, t.on_dark, 0.28), chip_fg=t.ink,
                                   inv=t.panel, inv_fg=t.ink, inv_acc=t.accent_ink, inv_mute=t.mute)
        chip = "FFFFFF" if themes.contrast("FFFFFF", t.accent) >= themes.contrast(t.ink, t.accent) else t.ink
        if t.v3:   # deck-look: figures and labels wear ink, no filled dark panels (the 'inverse' ground is the paper itself)
            return SimpleNamespace(dark=False, bg=t.paper, fg=t.ink, mute=t.mute, acc_t=t.ink, acc_f=t.accent, acc_l=t.line_accent,
                                   card=t.panel, card_fg=t.ink, card_mute=t.mute, card_acc=t.ink, rule=t.rule,
                                   chip_fg=chip, inv=t.paper, inv_fg=t.ink, inv_acc=t.ink, inv_mute=t.mute)
        return SimpleNamespace(dark=False, bg=t.paper, fg=t.ink, mute=t.mute, acc_t=t.accent_ink, acc_f=t.accent, acc_l=t.line_accent,
                               card=t.panel, card_fg=t.ink, card_mute=t.mute, card_acc=t.accent_ink, rule=t.rule,
                               chip_fg=chip, inv=t.ink, inv_fg=t.on_dark, inv_acc=t.accent_on_dark, inv_mute=t.on_dark_mute)

    def sz(self, v: float, cap: bool = False) -> float:
        """A point size held to the theme's floors and to half points. In a layout theme body text is never
        set under ``Scale.body_floor`` (12 pt) and a caption (``cap=True``: a label, a tag, a kicker, footer
        furniture) never under ``Scale.caption_floor`` (10 pt); stage h reads the same numbers. The classic
        theme keeps the old behaviour (floor ``Scale.min``)."""
        S = self.th.scale
        if not self.th.layouts:
            return max(S.min, v)
        return max(S.caption_floor if (cap or self._relaxed) else S.body_floor, _half(v))

    # -- the canvas map (deck-slide-size) ------------------------------------------------------------------------------------------------
    def _g(self, x, y, w, h) -> tuple:
        """A box on the 16:9 grid as the four EMU lengths python-pptx takes, through the canvas map (identity at 16:9: today's Inches)."""
        if self._cv is None:
            return Inches(x), Inches(y), Inches(w), Inches(h)
        X, Y, W_, H_ = self._cv.box(x, y, w, h)
        return Inches(X), Inches(Y), Inches(W_), Inches(H_)

    def _gk(self, x, y, w, h) -> tuple:
        """A fixed-shape box (an icon, a node, a ring): its centre through the canvas map, its size physical (never squashed)."""
        if self._cv is None:
            return Inches(x), Inches(y), Inches(w), Inches(h)
        cx, cy = self._cv.x(x + w / 2), self._cv.y(y + h / 2)
        return Inches(cx - w / 2), Inches(cy - h / 2), Inches(w), Inches(h)

    def _kx(self, w: float) -> float:
        """A 16:9 width as drawn at this size, for measuring (content anchor: x ``k``)."""
        return w if self._cv is None else w * self._cv.k

    def _unk(self, w: float) -> float:
        """A physical width (inches of type) on the 16:9 grid: what a layout must ask for so that ``w`` is drawn at this size."""
        return w if self._cv is None else w / self._cv.k

    def _aspect_v(self, r: float, x, y, w, h) -> float:
        """The width/height a box must have on the 16:9 grid to be drawn at aspect ``r`` at this size (frames keep a format's aspect)."""
        if self._cv is None or w <= 0 or h <= 0:
            return r
        _, _, W_, H_ = self._cv.box(x, y, w, h)
        return r * (H_ / h) / (W_ / w)

    def _eh(self, text, width_in, size_pt, line=1.22):
        """``_est_h`` at the width drawn at this size."""
        return _est_h(text, self._kx(width_in), size_pt, line)

    def min_column(self, w: float, minimum: float, what: str = "text column") -> None:
        """deck-slide-size (Fable fix 3): NoFit when a column of ``w`` grid inches is drawn under ``minimum`` physical inches at this size, so
        the plan's switch rung takes the layout's alternatives. Never at 16:9 (every 16:9 column is what it was)."""
        if self._cv is not None and self._kx(w) < minimum - 1e-9:
            raise NoFit(f"{what} {self._kx(w):.2f} in at {self.cv.name}, under {minimum} in")

    # -- animate mode -------------------------------------------------------------------------
    @staticmethod
    def _mark(sl):
        """Shape count now, the start of a build step."""
        return len(sl.shapes)

    def _build(self, sl, start, effect="fade", title=False):
        """Record the shapes added since ``start`` as one build step (real slide, animate mode only)."""
        if not self.animate or sl is not self._cur:
            return
        ids = [sh.shape_id for sh in list(sl.shapes)[start:]]
        if ids:
            self.steps.append((ids, effect, title))

    def _animate(self, sl):
        """Write the fade transition and the build timeline (p:transition, p:timing) onto a slide."""
        el = sl._element
        anchor = el.find(qn("p:clrMapOvr"))
        anchor = anchor if anchor is not None else el.find(qn("p:cSld"))
        trans = etree.fromstring(f'<p:transition {nsdecls("p")} spd="fast"><p:fade/></p:transition>')
        anchor.addnext(trans)
        if not self.steps:
            return
        ids = itertools.count(3)
        auto = [(i, e) for i, e, t in self.steps if t or self.animate == "auto"]
        clicks = [(i, e) for i, e, t in self.steps if not t and self.animate == "click"]
        pars = (_build_par(ids, auto, True) if auto else "") + "".join(_build_par(ids, [s], False) for s in clicks)
        shapes = {sh.shape_id: sh for sh in sl.shapes}
        bld = []
        for spids, _, _ in self.steps:
            for sp in spids:
                sh = shapes[sp]
                if sh.shape_type in (MSO_SHAPE_TYPE.CHART, MSO_SHAPE_TYPE.TABLE):
                    bld.append(f'<p:bldGraphic spid="{sp}" grpId="0"><p:bldAsOne/></p:bldGraphic>')
                elif sh.has_text_frame:
                    bld.append(f'<p:bldP spid="{sp}" grpId="0"' + (' animBg="1"/>' if sh.shape_type == MSO_SHAPE_TYPE.AUTO_SHAPE else "/>"))
        timing = etree.fromstring(
            f'<p:timing {nsdecls("p")}><p:tnLst><p:par><p:cTn id="1" dur="indefinite" restart="never" nodeType="tmRoot"><p:childTnLst>'
            f'<p:seq concurrent="1" nextAc="seek"><p:cTn id="2" dur="indefinite" nodeType="mainSeq"><p:childTnLst>{pars}</p:childTnLst></p:cTn>'
            '<p:prevCondLst><p:cond evt="onPrev" delay="0"><p:tgtEl><p:sldTgt/></p:tgtEl></p:cond></p:prevCondLst>'
            '<p:nextCondLst><p:cond evt="onNext" delay="0"><p:tgtEl><p:sldTgt/></p:tgtEl></p:cond></p:nextCondLst></p:seq>'
            f'</p:childTnLst></p:cTn></p:par></p:tnLst><p:bldLst>{"".join(bld)}</p:bldLst></p:timing>')
        trans.addnext(timing)

    # -- primitives -------------------------------------------------------------------------
    def text(self, sl, x, y, w, h, text, size=16, color=None, bold=False, font=None, italic=False,
             align=PP_ALIGN.LEFT, anchor=MSO_ANCHOR.TOP, name=None, cap=False):
        """A text box with one paragraph per line of ``text``. ``cap``: a caption-role label (floor 10 pt)."""
        tb = sl.shapes.add_textbox(*self._g(x, y, w, h))
        if name:
            tb.name = name
        tf = tb.text_frame
        tf.word_wrap = True
        tf.margin_left = tf.margin_right = Inches(0.02)
        tf.margin_top = tf.margin_bottom = Inches(0.02)
        tf.vertical_anchor = anchor
        for i, line in enumerate(str(text).split("\n")):
            p = tf.paragraphs[0] if i == 0 else tf.add_paragraph()
            p.alignment = align
            r = p.add_run()
            r.text = glue(line) if self.th.layouts else line
            f = r.font
            f.size, f.bold, f.italic = Pt(self.sz(size, cap)), bold, italic
            f.name = font or self.th.body
            f.color.rgb = _rgb(color or self.fg)
        if cap and not name:
            tb.name = "Caption"
        return tb

    def box(self, sl, x, y, w, h, fill, line=None, shape=MSO_SHAPE.ROUNDED_RECTANGLE, name=None):
        """A filled rounded rectangle (cards, frames)."""
        s = sl.shapes.add_shape(shape, *self._g(x, y, w, h))
        s.fill.solid()
        s.fill.fore_color.rgb = _rgb(fill)
        if line:
            s.line.color.rgb = _rgb(line)
            s.line.width = Pt(0.75)
        else:
            s.line.fill.background()
        if shape == MSO_SHAPE.ROUNDED_RECTANGLE:
            s.adjustments[0] = 0.06
        s.shadow.inherit = False
        if name:
            s.name = name
        return s

    def rect(self, sl, x, y, w, h, fill=None, line=None, lw=0.75, dash=False, shape=MSO_SHAPE.RECTANGLE, name=None):
        """A plain native rectangle (or other shape) with no theme style: solid fill and/or outline, optionally dashed."""
        if sl is None:
            return None
        if (self.th.v3 and fill and shape == MSO_SHAPE.RECTANGLE and not line and min(w, h) <= 0.12
                and (fill.upper() in self._accent_fills() or (abs(w - 0.5) < 1e-6 and h <= 0.06))):
            return self._stripe_to_rule(sl, x, y, w, h, name)
        s = sl.shapes.add_shape(shape, *(self._gk(x, y, w, h) if shape == MSO_SHAPE.OVAL and abs(w - h) < 1e-6 else self._g(x, y, w, h)))
        st = s._element.find(qn("p:style"))
        if st is not None:
            s._element.remove(st)
        if fill:
            s.fill.solid()
            s.fill.fore_color.rgb = _rgb(fill)
        else:
            s.fill.background()
        if line:
            s.line.color.rgb = _rgb(line)
            s.line.width = Pt(lw)
            if dash:
                s.line.dash_style = MSO_LINE.DASH
        else:
            s.line.fill.background()
        if name:
            s.name = name
        return s

    # -- hairlines and the section band (deck-look, spec.LOOK_V3) ---------------------------------
    def _accent_fills(self) -> set:
        t = self.th
        return {c.upper() for c in (t.accent, t.accent_ink, t.accent_on_dark, t.line_accent)}

    def hairline(self, sl, x1, y1, x2, y2, color=None, name="Hairline", pt=None):
        """A native straight line at the look's rule weight (0.75 pt; ``pt`` for a heavier stop line), ink by default (light on a dark slide)."""
        if sl is None:
            return None
        from pptx.enum.shapes import MSO_CONNECTOR
        if self._cv is not None:
            x1, y1, x2, y2 = self._cv.x(x1), self._cv.y(y1), self._cv.x(x2), self._cv.y(y2)
        c = sl.shapes.add_connector(MSO_CONNECTOR.STRAIGHT, Inches(x1), Inches(y1), Inches(x2), Inches(y2))
        st = c._element.find(qn("p:style"))
        if st is not None:
            c._element.remove(st)
        c.line.color.rgb = _rgb(color or self.p.fg)
        c.line.width = Pt(pt or self.th.decor.rule_pt)
        c.name = name
        return c

    def _stripe_to_rule(self, sl, x, y, w, h, name=None):
        """An accent edge stripe or tick becomes a hairline (a tick above a title, 0.5 x 0.06 in, becomes nothing: the band is the mark)."""
        if abs(w - 0.5) < 1e-6 and h <= 0.06:
            return None
        if h > w:   # a vertical stripe at a card's or text's edge
            return self.hairline(sl, x + w / 2, y, x + w / 2, y + h, name=name or "Hairline")
        return self.hairline(sl, x, y + h / 2, x + w, y + h / 2, name=name or "Hairline")

    def band_label(self, s) -> str:
        """The band's section topic (see ``band_label``)."""
        return band_label(s, self.deck.get("meta") or {})

    def band(self, sl, s):
        """The section band: a hairline, the section topic, a hairline, across the content width. Drawn once per slide."""
        if sl is None or not (self.th.v3 and self.th.decor.band) or self._band_drawn:
            return
        self._band_drawn = True
        self.hairline(sl, self.x0, BAND_TOP, self.x1, BAND_TOP, name="BandRule")
        label = self.band_label(s)
        if label:
            self.ptext(sl, self.x0, BAND_LABEL_Y, self.x1 - self.x0, BAND_LABEL_H,
                       [self.para(label, self.th.decor.band_label_pt, self.p.fg, self.th.head, bold=True, cap=True)], anchor="middle", name="Band")
        self.hairline(sl, self.x0, BAND_BOTTOM, self.x1, BAND_BOTTOM, name="BandRule")

    def _mark_above_title(self, sl, s, color, band=True):
        """What sits above a title: the accent tick of the earlier look, or the section band of deck-look
        (the cover and the close carry none: their mark is the title itself)."""
        if self.th.v3:
            if band:
                self.band(sl, s)
        else:
            self.rect(sl, self.x0, self.th.grid.top, 0.5, 0.06, fill=color)

    # -- measuring and paragraph text (layout library) -----------------------------------------
    def _wf(self, bold=False, font=None, caps=False):
        """Average glyph width as a fraction of the size: a deliberately generous figure (QA catches the rest). ``caps``: the text is set in
        capitals (deck-look's caps statements), measured on the capitals' own widths."""
        if self.th.v3:   # measured (deck/fonts/widths.json): the wider of the font and its fallback, with a margin
            w = themes.fit_wf(font or self.th.body, bold, caps)
            if w:
                return w
        head = (font or self.th.body) == self.th.head
        return (0.55 if head else 0.50) + (0.03 if bold else 0)

    def wrap(self, text, w, size, bold=False, font=None, caps=False) -> list:
        """The lines a text wraps to in ``w`` inches at ``size`` pt, as lists of words: greedy word wrap on the
        estimated glyph width. A no-break space (``NBSP``) glues two words, as it does in PowerPoint, so a glued
        pair is one unit here. This is the renderer's own wrap estimate (the tests use it to look for orphans)."""
        per = max(1.0, self._kx(w) * 72 / (size * self._wf(bold, font, caps)))
        lines = []
        for para in str(text).split("\n"):
            cur, row = 0, []
            for word in para.split(" "):
                L = len(word)
                if not row:
                    cur, row = L, [word]
                elif cur + 1 + L <= per:
                    cur += 1 + L
                    row.append(word)
                else:
                    lines.append(row)
                    cur, row = L, [word]
                while cur > per:   # a word wider than the line breaks over more lines
                    lines.append([])
                    cur -= per
            lines.append(row)
        return lines

    def nlines(self, text, w, size, bold=False, font=None, caps=False) -> int:
        """Lines a text takes in ``w`` inches at ``size`` pt (the count of ``wrap``)."""
        return len(self.wrap(text, w, size, bold, font, caps))

    def balance_w(self, text, w, size, bold=False, font=None) -> float:
        """The narrowest width, between 62% of ``w`` and ``w``, at which ``text`` still wraps to as many lines
        as it does in ``w``: a two-line title then breaks near its middle instead of leaving a stub on the
        second line. The words are never touched; only the box is narrower."""
        n = self.nlines(text, w, size, bold, font)
        if n < 2:
            return w
        lo, hi = w * 0.62, w
        for _ in range(12):
            mid = (lo + hi) / 2
            if self.nlines(text, mid, size, bold, font) <= n:
                hi = mid
            else:
                lo = mid
        return hi

    def ph(self, paras, w) -> float:
        """Height in inches of a list of paragraph dicts (see ``ptext``) set in ``w`` inches."""
        h = 0.0
        w = self._clamp(paras, w, all(p_.get("align", "l") == "l" for p_ in paras))
        for p in paras:
            size = p.get("size", self.th.scale.body)
            n = self.nlines(p["t"], w - (0.3 if p.get("bullet") else 0), size, p.get("bold"), p.get("font"), bool(p.get("allcaps")))
            h += n * size * 1.2 * p.get("line", 1.0) / 72 + p.get("after", 0) / 72
        return h + 0.04

    def ptext(self, sl, x, y, w, h, paras, anchor="top", name=None):
        """A text box of paragraph dicts: t, size, color, font, bold, italic, align (l c r), line, after, track.
        Margins are zero so the box edge is the text edge; ``sl`` None measures only."""
        if sl is None:
            return None
        w = self._clamp(paras, w, all(p_.get("align", "l") == "l" for p_ in paras))
        tb = sl.shapes.add_textbox(*self._g(x, y, w, h))
        if name:
            tb.name = name
        elif paras and all(d.get("cap") for d in paras):
            tb.name = "Caption"   # a label: stage h holds it to the caption floor, not the body floor
        tf = tb.text_frame
        tf.word_wrap = True
        tf.margin_left = tf.margin_right = tf.margin_top = tf.margin_bottom = 0
        tf.vertical_anchor = {"top": MSO_ANCHOR.TOP, "middle": MSO_ANCHOR.MIDDLE, "bottom": MSO_ANCHOR.BOTTOM}[anchor]
        for i, d in enumerate(paras):
            para = tf.paragraphs[0] if i == 0 else tf.add_paragraph()
            para.alignment = {"l": PP_ALIGN.LEFT, "c": PP_ALIGN.CENTER, "r": PP_ALIGN.RIGHT}[d.get("align", "l")]
            if d.get("line"):
                para.line_spacing = d["line"]
            para.space_after = Pt(d.get("after", 0))
            txt = d["t"]
            psz = self.sz(d.get("size", self.th.scale.body), d.get("cap", False))
            if NBSP in txt and self.nlines(txt.replace(NBSP, " "), w, psz, d.get("bold"), d.get("font")) <= 1:
                txt = txt.replace(NBSP, " ")   # it fits on one line: no glue needed (a no-break space can set wider in some fonts)
            parts = [(txt, d.get("color") or self.p.fg)]
            acc = self._acc if (name == "Title" and i == 0 and not self._bleed) else None
            if acc:   # deck-look (rea-full A3): the one bound phrase of the title in the accent; the words and their order unchanged
                m = re.search(re.escape(acc).replace(r"\ ", "[ \u00a0]"), txt, flags=re.I)
                if m:
                    ac = self.th.accent_on_dark if self.p.dark else self.th.accent_ink
                    parts = [(txt[:m.start()], parts[0][1]), (txt[m.start():m.end()], ac), (txt[m.end():], parts[0][1])]
                    parts = [x for x in parts if x[0]]
                    self._acc_drawn = True
            for txt_, col_ in parts:
                run = para.add_run()
                run.text = txt_
                f = run.font
                f.size, f.name = Pt(psz), d.get("font") or self.th.body
                f.bold, f.italic = bool(d.get("bold")), bool(d.get("italic"))
                f.color.rgb = _rgb(col_)
                if d.get("track"):
                    run._r.get_or_add_rPr().set("spc", str(int(d["track"] * 100)))
                if d.get("allcaps"):   # set in capitals by the font (the words stay as written, so search and edit see them)
                    run._r.get_or_add_rPr().set("cap", "all")
            if d.get("bullet"):   # a real bullet, hanging indent
                pPr = para._p.get_or_add_pPr()
                pPr.set("marL", str(Inches(0.3)))
                pPr.set("indent", str(-Inches(0.25)))
                etree.SubElement(pPr, "{http://schemas.openxmlformats.org/drawingml/2006/main}buChar").set("char", "\u2022")
        return tb

    def para(self, t, size, color=None, font=None, cap=False, **kw) -> dict:
        """One paragraph dict for ``ptext`` / ``ph``; the size is held to the theme's floor (body 12 pt, or the
        caption floor when ``cap``). The last two words are joined by a no-break space (``glue``) so a text never
        ends a line on a single orphaned word; the words themselves are untouched."""
        d = dict(t=glue(t), size=self.sz(size, cap), color=color, font=font, cap=cap, **kw)
        if spec.LOOK_V2 and not cap and d["size"] <= 28 and "cpl" not in kw and not (kw.get("bold") and font == self.th.head):
            d["cpl"] = self._cpl   # body, small and lead lines run to about 48 characters (the plan may widen a slide to 60 before it relaxes type), whatever the size
        return d

    def _clamp(self, paras, w, left=True) -> float:
        """The box width for these paragraphs: ``w``, or less when they carry a ``cpl`` (characters per line): the width of that many glyphs at
        the largest such size. Only a left-aligned box is narrowed (a centred or right-aligned one keeps its place)."""
        if not spec.LOOK_V2 or not left:
            return w
        cw = [self._cpl_w(p_["size"], p_.get("bold"), p_.get("font"), p_["cpl"]) for p_ in paras if p_.get("cpl")]
        return min(w, max(cw)) if cw else w

    def fit(self, make, w, h, hi, lo):
        """The largest size in [lo, hi] (stepping 1 pt) at which ``make(size)`` (paragraph dicts) fits ``h`` inches
        in ``w``; raises NoFit when even ``lo`` is too big."""
        s = hi
        while s >= lo:
            if self.ph(make(s), w) <= h:
                return s
            s -= 1
        raise NoFit(f"text does not fit {w:.1f}x{h:.1f} in at {lo} pt")

    def bullets(self, sl, x, y, w, items, size=15, title=None):
        """A bulleted list as one text box (real bullets via XML, not literal characters)."""
        h = sum(self._eh(i, w - 0.3, size) for i in items) + (0.45 if title else 0)
        tb = sl.shapes.add_textbox(*self._g(x, y, w, h))
        tf = tb.text_frame
        tf.word_wrap = True
        first = True
        if title:
            p = tf.paragraphs[0]
            r = p.add_run(); r.text = title
            r.font.size, r.font.bold, r.font.name = Pt(self.sz(size)), True, self.th.body
            r.font.color.rgb = _rgb(self.fg)
            p.space_after = Pt(6)
            first = False
        for it in items:
            p = tf.paragraphs[0] if first else tf.add_paragraph()
            first = False
            pPr = p._p.get_or_add_pPr()
            pPr.set("marL", str(Inches(0.25))); pPr.set("indent", str(-Inches(0.22)))
            bu = etree.SubElement(pPr, "{http://schemas.openxmlformats.org/drawingml/2006/main}buChar")
            bu.set("char", "•")
            p.space_after = Pt(7)
            r = p.add_run(); r.text = glue(it) if self.th.layouts else it
            r.font.size, r.font.name = Pt(self.sz(size)), self.th.body
            r.font.color.rgb = _rgb(self.fg)
        return h

    def table(self, sl, x, y, w, rows, size=12):
        """A native table: header row in ink, body rows on the surface with thin rules (the flow's table)."""
        t_ = self.th
        nr, nc = len(rows), len(rows[0])
        rh = [max(self._eh(c, w / nc - 0.15, size) for c in r) for r in rows]
        gs = sl.shapes.add_table(nr, nc, *self._g(x, y, w, sum(rh)))
        t = gs.table
        widths = self._col_widths(rows, w)
        for j, cw in enumerate(widths):
            t.columns[j].width = Inches(self._kx(cw)) if self._cv is not None else Inches(cw)
        for i, r in enumerate(rows):
            t.rows[i].height = Inches(rh[i])
            for j, val in enumerate(r):
                c = t.cell(i, j)
                c.text = numfmt.format_text(str(val))
                c.margin_left = c.margin_right = Inches(0.08)
                c.margin_top = c.margin_bottom = Inches(0.03)
                c.fill.solid()
                c.fill.fore_color.rgb = _rgb(t_.ink if i == 0 else (t_.paper if i % 2 else t_.panel))
                for p in c.text_frame.paragraphs:
                    for run in p.runs:
                        run.font.size = Pt(self.sz(size))
                        run.font.name = t_.body
                        run.font.bold = i == 0
                        run.font.color.rgb = _rgb(t_.on_dark if i == 0 else t_.ink)
        tblPr = gs._element.graphic.graphicData.tbl.tblPr
        tblPr.set("bandRow", "0"); tblPr.set("firstRow", "1")
        return sum(rh)

    @staticmethod
    def _col_widths(rows, w):
        """Column widths proportional to the longest text in each column (bounded)."""
        nc = len(rows[0])
        lens = [max(8, min(60, max(len(str(r[j])) for r in rows))) for j in range(nc)]
        tot = sum(lens)
        return [w * l / tot for l in lens]

    def chart(self, sl, x, y, w, h, series, title=None, hero=None):
        """A native horizontal bar chart of percentages from fact / document-figure refs, every bar on one fixed
        0 to 100 scale. Bars named in ``hero`` (by label) take the accent and the rest a muted tone, so the chart
        itself carries the emphasis."""
        t_ = self.th
        cd = CategoryChartData()
        labels, vals = [], []
        for s in reversed(series):
            row = self.inp.doc_facts.get(s["ref"]) or self.inp.facts.get(s["ref"])
            v = row["value"] * 100 if row.get("unit") == "proportion" else row["value"]
            labels.append(s["label"]); vals.append(round(v, 1))
        cd.categories = labels
        cd.add_series("Share", vals)
        gf = sl.shapes.add_chart(XL_CHART_TYPE.BAR_CLUSTERED, *self._g(x, y, w, h), cd)
        ch = gf.chart
        ch.has_legend = False
        ch.has_title = bool(title)
        if title:
            ch.chart_title.text_frame.text = title
            for p in ch.chart_title.text_frame.paragraphs:
                for r in p.runs:
                    r.font.size, r.font.bold, r.font.name = Pt(self.sz(12)), False, t_.body
                    r.font.color.rgb = _rgb(t_.mute)
        plot = ch.plots[0]
        plot.gap_width = 55
        plot.has_data_labels = True
        dl = plot.data_labels
        dl.number_format, dl.number_format_is_linked = '0"%"', False
        dl.position = XL_LABEL_POSITION.OUTSIDE_END
        dl.font.size, dl.font.name, dl.font.bold = Pt(self.sz(16)), t_.body, True
        dl.font.color.rgb = _rgb(t_.ink)
        ser = plot.series[0]
        ser.format.fill.solid(); ser.format.fill.fore_color.rgb = _rgb(t_.line_accent)
        if hero:
            quiet = themes.blend(t_.mute, t_.paper, 0.45)
            for i, lab in enumerate(labels):
                pt = ser.points[i]
                pt.format.fill.solid()
                pt.format.fill.fore_color.rgb = _rgb(t_.line_accent if lab in hero else quiet)
        va = ch.value_axis
        va.visible = False
        va.has_major_gridlines = False
        va.minimum_scale = 0
        va.maximum_scale = 100
        ca = ch.category_axis
        ca.tick_labels.font.size, ca.tick_labels.font.name = Pt(self.sz(14)), t_.body
        ca.tick_labels.font.color.rgb = _rgb(t_.ink)
        ca.format.line.fill.background()
        return gf

    # -- layout library: block looks --------------------------------------------------------------
    # Every look takes (sl, block, x, y, w, sc) and returns its height in inches. With ``sl`` None it
    # only measures, so a layout can check that its words fit before anything is drawn. ``sc`` scales
    # the type (never below the theme's floor).

    def _gap(self, sc):
        """The gutter between cards at a scale."""
        return self.th.grid.G * min(1.0, sc + 0.1)

    def _b_statement(self, sl, bl, x, y, w, sc):
        """A statement: the lead size in the head font."""
        paras = [self.para(str(bl["text"]).strip(), self.th.scale.lead * min(sc, 1.25), self.p.fg, self.th.head, line=1.05)]
        h = self.ph(paras, w)
        self.ptext(sl, x, y, w, h, paras)
        return h

    def _b_text(self, sl, bl, x, y, w, sc):
        """Body text."""
        paras = [self.para(str(bl["text"]).strip(), self.th.scale.body * min(sc, 1.4), self.p.fg, line=1.05)]
        h = self.ph(paras, w)
        self.ptext(sl, x, y, w, h, paras)
        return h

    def _b_small(self, sl, bl, x, y, w, sc):
        """A caption line in the muted ink."""
        paras = [self.para(str(bl["text"]).strip(), (self.th.scale.caption + 1) * sc, self.p.mute)]
        h = self.ph(paras, w)
        self.ptext(sl, x, y, w, h, paras)
        return h

    def _bar(self, sl, text, x, y, w, size, font=None, italic=False, color=None, minh=0.0):
        """An emphasis bar: a vertical accent bar and the text beside it, anchored in the middle."""
        paras = [self.para(text, size, color or self.p.fg, font or self.th.head, italic=italic, line=1.1)]
        h = max(self.ph(paras, w - 0.32), minh)
        self.rect(sl, x, y, 0.09, h, fill=self.p.acc_l)
        self.ptext(sl, x + 0.32, y, w - 0.32, h, paras, anchor="middle")
        return h

    def _b_quote(self, sl, bl, x, y, w, sc):
        """A quote as an emphasis bar in italic head type."""
        return self._bar(sl, str(bl["text"]).strip(), x, y, w, self.th.scale.lead * 1.1 * min(sc, 1.2), italic=True, color=self.p.acc_t, minh=self._minh)

    def _b_callout(self, sl, bl, x, y, w, sc):
        """A callout: a panel with an accent edge and the text."""
        paras = [self.para(str(bl["text"]).strip(), self.th.scale.body * sc, self.p.card_fg, line=1.05)]
        h = self.ph(paras, w - 0.6) + 0.4
        self.rect(sl, x, y, w, h, fill=self.p.card)
        self.rect(sl, x, y, 0.07, h, fill=self.p.acc_l)
        self.ptext(sl, x + 0.35, y + 0.2, w - 0.6, h - 0.4, paras, anchor="middle")
        return h

    def _b_card(self, sl, bl, x, y, w, sc):
        """A titled card: small bold title over the text."""
        S = self.th.scale
        paras = [self.para(str(bl.get("title", "")), (S.caption + 1) * sc, self.p.card_mute, bold=True, after=4),
                 self.para(str(bl.get("text", "")).strip(), S.body * sc, self.p.card_fg, line=1.05)]
        if not bl.get("title"):
            paras = paras[1:]
        h = self.ph(paras, w - 0.6) + 0.5
        self.rect(sl, x, y, w, h, fill=self.p.card)
        self.rect(sl, x, y, w, 0.05, fill=self.p.acc_l)
        self.ptext(sl, x + 0.3, y + 0.3, w - 0.6, h - 0.5, paras)
        return h

    def _b_kv(self, sl, bl, x, y, w, sc):
        """Key and value rows: the key small and bold, the value beside it."""
        S, y0 = self.th.scale, y
        if self._kvcards and 1 < len(bl["items"]) <= 4:
            n, gap = len(bl["items"]), self._gap(sc)
            cw = (w - gap * (n - 1)) / n
            cards = [[self.para(str(k), (S.caption + 1) * sc, self.p.acc_t, bold=True, after=4),
                      *[self.para(t, (S.small - 1) * sc, self.p.card_fg, line=1.05, after=3) for t in _kv_parts(v)]] for k, v in bl["items"]]
            h = max(self.ph(c, cw - 0.5) for c in cards) + 0.45
            for i, c in enumerate(cards):
                cx = x + i * (cw + gap)
                self.rect(sl, cx, y, cw, h, fill=self.p.card)
                self.rect(sl, cx, y, cw, 0.05, fill=self.p.acc_l)
                self.ptext(sl, cx + 0.25, y + 0.25, cw - 0.5, h - 0.35, c)
            return h
        for key, val in bl["items"]:
            kp = [self.para(str(key), (S.caption + 1) * sc, self.p.mute, bold=True)]
            vp = [self.para(t, (S.body - 1) * sc, self.p.fg, line=1.05, after=3) for t in _kv_parts(val)]
            h = max(self.ph(vp, w - 1.9), self.ph(kp, 1.7))
            self.ptext(sl, x, y, 1.7, h, kp)
            self.ptext(sl, x + 1.9, y, w - 1.9, h, vp)
            y += h + 0.14
        return y - y0 - 0.14

    def _card_geo(self, items, cw, sc, numeric):
        """Per item: (kind, paragraphs, height) for a card ``cw`` inches wide. Kinds: plain, num, human."""
        S, out = self.th.scale, []
        for text, human in items:
            if human:
                body = [self.para(text, (S.small) * sc, self.p.fg, line=1.05)]
                out.append(("human", body, 0.55 * min(1.0, sc + 0.15) + self.ph(body, cw - 0.5) + 0.2))
            elif numeric and _lead_number(text):
                num, rest = _lead_number(text)
                np_ = [self.para(num, 32 * sc, self.p.card_acc, self.th.head, bold=True, after=2)]
                rp = [self.para(rest, S.small * sc, self.p.card_fg, line=1.05)]
                if self.nlines(num, cw - 0.5, self.sz(32 * sc), True, self.th.head) > 1:
                    raise NoFit("figure wider than its card")
                out.append(("num", np_ + rp, 0.3 + self.ph(np_ + rp, cw - 0.5) + 0.25))
            else:
                body = [self.para(text, S.body * sc, self.p.card_fg, line=1.05)]
                out.append(("plain", body, 0.3 + self.ph(body, cw - 0.5) + 0.25))
        return out

    def _b_bullets(self, sl, bl, x, y, w, sc, cols=None):
        """Bullets as cards, one per item: figure-led cards when every item opens with a figure, dashed
        placeholder cards for ``human`` items, an emphasis bar for a single item. A block title is a heading.
        Cards of a row share one height; the rows stretch to ``self._minh`` when the slide has height to spare.
        A last row with fewer cards than the others spans the full width, so no cell is left empty."""
        S, p = self.th.scale, self.p
        minh = self._minh
        items = [((i["text"], bool(i.get("human"))) if isinstance(i, dict) else (str(i), False)) for i in bl["items"]]
        items = [(t.strip(), hm) for t, hm in items if t and t.strip()]
        head_h = 0.0
        if bl.get("title"):
            hp = [self.para(str(bl["title"]), S.small * sc, p.fg, bold=True)]
            head_h = self.ph(hp, w) + 0.12
            self.ptext(sl, x, y, w, head_h - 0.12, hp)
        if not items:
            return head_h
        n, gap = len(items), self._gap(sc)
        if n == 1 and not items[0][1]:
            return head_h + self._bar(sl, items[0][0], x, y + head_h, w, S.lead * 0.9 * min(sc, 1.25), minh=max(0.0, minh - head_h))
        if n >= 8 and not any(hm for _, hm in items):
            return head_h + self._bullet_list(sl, [t for t, _ in items], x, y + head_h, w, sc)
        numeric = all(_lead_number(t) for t, hm in items if not hm) and n >= 2
        best = None
        for c in ([cols] if cols else [1, 2, 3, 4]):
            cw = (w - gap * (c - 1)) / c
            if c > n or cw < 2.5:
                continue
            try:
                geo = self._card_geo(items, cw, sc, numeric)
            except NoFit:
                continue
            rows = [geo[i:i + c] for i in range(0, n, c)]
            rh = [max(g[2] for g in r) for r in rows]
            total = sum(rh) + gap * (len(rows) - 1)
            cost = total + (0.35 if n % c else 0.0)   # a short last row reads as a gap: prefer even rows
            if best is None or cost < best[0] - 0.05:
                best = (cost, total, c, cw, geo, rows, rh)
        if best is None:
            raise NoFit("no card arrangement")
        _, total, c, cw, geo, rows, rh = best
        extra = max(0.0, minh - head_h - total) / len(rows)
        yy = y + head_h
        for r, row in enumerate(rows):
            k_n = len(row)
            rcw = (w - gap * (k_n - 1)) / k_n   # a short last row spans the full width
            hr = rh[r] + extra
            content = max((self.ph(g[1], rcw - 0.5) for g in row if g[0] == "num"), default=0.0)
            for k, (kind, paras, _) in enumerate(row):
                cx = x + k * (rcw + gap)
                if kind == "human":
                    self.rect(sl, cx, yy, rcw, hr, line=p.acc_t, lw=1.5, dash=True)
                    self.ptext(sl, cx + 0.25, yy + 0.2, 1.6, 0.25, [self.para(TAG, S.caption * sc, p.acc_t, bold=True, track=1.2, cap=True)])
                    self.rect(sl, cx + rcw - 1.35, yy + 0.16, 1.15, 0.3, fill=p.acc_f)
                    self.ptext(sl, cx + rcw - 1.35, yy + 0.16, 1.15, 0.3,
                               [self.para(CHIP, S.min, p.chip_fg, bold=True, align="c", track=1, cap=True)], anchor="middle")
                    self.ptext(sl, cx + 0.25, yy + 0.55 * min(1.0, sc + 0.15), rcw - 0.5, hr - 0.2 - 0.55 * min(1.0, sc + 0.15), paras)
                elif kind == "num":   # figure and its sentence, the figure on one baseline across the row
                    self.rect(sl, cx, yy, rcw, hr, fill=p.card)
                    self.rect(sl, cx, yy, rcw, 0.05, fill=p.acc_l)
                    top = yy + 0.05 + (hr - 0.05 - content) / 2
                    fh = self.ph(paras[:1], rcw - 0.5)
                    self.ptext(sl, cx + 0.25, top, rcw - 0.5, fh, paras[:1])
                    self.ptext(sl, cx + 0.25, top + fh, rcw - 0.5, content - fh, paras[1:])
                else:
                    self.rect(sl, cx, yy, rcw, hr, fill=p.card)
                    self.rect(sl, cx, yy, rcw, 0.05, fill=p.acc_l)
                    self.ptext(sl, cx + 0.25, yy + 0.05 + 0.15, rcw - 0.5, hr - 0.05 - 0.3, paras, anchor="middle")
            yy += hr + gap
        return head_h + total + extra * len(rows)

    def _bullet_list(self, sl, texts, x, y, w, sc):
        """A long list as real bullets in one or two columns (too many items for one card each)."""
        S, p = self.th.scale, self.p
        cols = 2 if len(texts) >= 6 else 1
        cw = (w - 0.5) / cols if cols == 2 else w
        per = -(-len(texts) // cols)
        groups = [texts[i:i + per] for i in range(0, len(texts), per)]
        size = S.small * sc
        paras = [[self.para(t, size, p.fg, line=1.05, after=6, bullet=True) for t in g] for g in groups]
        h = max(self.ph(pp, cw - 0.3) for pp in paras)
        for k, pp in enumerate(paras):
            self.ptext(sl, x + k * (cw + 0.5), y, cw, h, pp)
        return h

    def _b_stats(self, sl, bl, x, y, w, sc):
        """One stat: a dark big-number panel. Two to four: a row of KPI cards, figure large, label beneath. The
        figures of a row share one size and one baseline (each sits in a box of the same top and height) and
        the labels start at one line under them; the cards stretch to ``self._minh``."""
        S, p = self.th.scale, self.p
        items = bl["items"]
        n = len(items)
        if not 1 <= n <= 4:
            raise NoFit("stats row holds one to four figures")
        if n == 1:
            it = items[0]
            vw = min(5.4, w * 0.45)
            vs = 54 * sc
            while self.nlines(it["value"], vw - 0.6, self.sz(vs), True, self.th.head) > 1 and vs > 28:
                vs -= 1
            if self.nlines(it["value"], vw - 0.6, self.sz(vs), True, self.th.head) > 1:
                raise NoFit("figure too wide")
            lp = [self.para(it["label"], (S.body + 2) * sc, p.inv_fg, line=1.05)]
            h = max(1.5 * sc, self.ph(lp, w - vw - 0.9) + 0.5, self._minh)
            self.rect(sl, x, y, w, h, fill=p.inv)
            self.rect(sl, x, y, 0.09, h, fill=p.acc_l)
            self.ptext(sl, x + 0.4, y, vw - 0.6, h, [self.para(it["value"], vs, p.inv_acc, self.th.head, bold=True)], anchor="middle")
            self.ptext(sl, x + vw + 0.3, y, w - vw - 0.7, h, lp, anchor="middle")
            return h
        gap = self._gap(sc)
        cw = (w - gap * (n - 1)) / n
        tw = cw - 0.6
        vs = 40 * sc
        for it in items:
            while self.nlines(it["value"], tw, self.sz(vs), True, self.th.head) > 1 and vs > 24:
                vs -= 1
            if self.nlines(it["value"], tw, self.sz(vs), True, self.th.head) > 1:
                raise NoFit("figure wider than its card")
        fig = [self.para(it["value"], vs, p.card_acc, self.th.head, bold=True) for it in items]
        lab = [[self.para(it["label"], S.small * sc, p.card_fg, line=1.05)] for it in items]
        fig_h = self.ph(fig[:1], tw)
        lab_h = max(self.ph(lp, tw) for lp in lab)
        content = fig_h + 0.06 + lab_h
        h = max(content + 0.3, self._minh)
        top = y + (h - content) / 2
        for i in range(n):
            cx = x + i * (cw + gap)
            self.rect(sl, cx, y, cw, h, fill=p.card)
            self.rect(sl, cx, y, 0.07, h, fill=p.acc_l)
            self.ptext(sl, cx + 0.35, top, tw, fig_h, [fig[i]], anchor="bottom")
            self.ptext(sl, cx + 0.35, top + fig_h + 0.06, tw, lab_h, lab[i])
        return h

    def _b_steps(self, sl, bl, x, y, w, sc):
        """Steps as a timeline strip: a rail with a marker per step and a card under each marker, label over
        text. Five or fewer in a row; more are split over two rails, each row spread over the full width (no
        empty cell). The cards stretch to ``self._minh``. On founders and team slides each step is a role row."""
        S, p = self.th.scale, self.p
        items = [(str(it[0]), " ".join(str(c) for c in it[1:])) for it in bl["items"]]   # a third cell (deck-graphics journey: the channel) joins the line
        n = len(items)
        if self._role:
            return self._role_rows(sl, [list(i) for i in items], x, y, w, sc)
        if not 1 <= n <= 10:
            raise NoFit("too many steps")
        per = n if n <= 5 else -(-n // 2)
        gap = self._gap(sc)
        sc = min(sc, 1.25)   # a step is a short note under a marker: it never outgrows the headline above it
        rows = [items[r0:r0 + per] for r0 in range(0, n, per)]
        geo = []
        for row in rows:
            rcw = min((w - gap * (len(row) - 1)) / len(row), 4.2)
            cols = [([self.para(lab, S.small * sc, p.acc_t, bold=True, after=3)] if lab else []) + [self.para(val, S.small * sc, p.fg, line=1.05)] for lab, val in row]
            geo.append((rcw, cols, max(self.ph(ps, rcw - 0.4) for ps in cols) + 0.3))
        natural = sum(0.38 + g[2] for g in geo) + 0.3 * (len(geo) - 1)
        extra = max(0.0, self._minh - natural) / len(geo)
        yy = y
        for rcw, cols, ch in geo:
            ch += extra
            span = len(cols) * rcw + (len(cols) - 1) * gap
            self.rect(sl, x, yy + 0.095, span, 0.035, fill=p.acc_l)
            for k, ps in enumerate(cols):
                cx = x + k * (rcw + gap)
                self.rect(sl, cx, yy + 0.38, rcw, ch, fill=p.card)
                self.rect(sl, cx, yy, 0.22, 0.22, fill=p.acc_f, shape=MSO_SHAPE.OVAL)
                self.ptext(sl, cx + 0.2, yy + 0.38 + 0.15, rcw - 0.4, ch - 0.3, ps)
            yy += 0.38 + ch + 0.3
        return yy - y - 0.3

    def _role_rows(self, sl, rows, x, y, w, sc, header=None):
        """Role rows: a dark role cell (head type) beside a panel with the job it does. ``rows`` are [role, job].
        The rows stretch to ``self._minh``; every row has both cells."""
        S, p = self.th.scale, self.p
        rw = min(3.9, w * 0.33)
        yy, hh = y, 0.0
        if header:
            hp = [self.para(header[0], S.caption * sc, p.mute, bold=True, track=1.2, cap=True)]
            jp = [self.para(header[1], S.caption * sc, p.mute, bold=True, track=1.2, cap=True)]
            hh = max(self.ph(hp, rw), self.ph(jp, w - rw)) + 0.1
            self.ptext(sl, x + 0.3, yy, rw - 0.5, hh, hp)
            self.ptext(sl, x + rw + 0.4, yy, w - rw - 0.7, hh, jp)
            yy += hh
        geo = []
        for role, job in rows:
            rp = [self.para(role, 17 * sc, p.inv_fg, self.th.head, bold=True, line=1.05)]
            jp = [self.para(job, S.body * sc, p.card_fg, line=1.08)]
            geo.append((rp, jp, max(self.ph(rp, rw - 0.5), self.ph(jp, w - rw - 0.7)) + 0.3))
        natural = hh + sum(g[2] for g in geo) + 0.09 * (len(geo) - 1)
        extra = max(0.0, self._minh - natural) / max(1, len(geo))
        for rp, jp, h in geo:
            h += extra
            self.rect(sl, x, yy, rw, h, fill=p.inv)
            self.ptext(sl, x + 0.3, yy, rw - 0.5, h, rp, anchor="middle")
            self.rect(sl, x + rw, yy, w - rw, h, fill=p.card)
            self.rect(sl, x + rw, yy, 0.07, h, fill=p.acc_l)
            self.ptext(sl, x + rw + 0.4, yy, w - rw - 0.7, h, jp, anchor="middle")
            yy += h + 0.09
        return yy - y - 0.09

    def _b_fromto(self, sl, bl, x, y, w, sc):
        """A comparison: a light From panel and a dark To panel with an arrow between. Both panels share one
        height (stretched to ``self._minh``): the label at the top, the words in the middle of what is left."""
        S, p = self.th.scale, self.p
        cw = (w - 0.9) / 2
        sides = (("From", bl["from"], p.card, p.card_fg, p.card_mute), ("To", bl["to"], p.inv, p.inv_fg, p.inv_acc))
        labs = [self.para(lab.upper(), (S.caption + 1) * sc, lc, bold=True, track=1.2) for lab, val, _, fc, lc in sides]
        vals = [self.para(str(val), S.lead * sc, fc, self.th.head, line=1.08) for lab, val, _, fc, lc in sides]
        lh = max(self.ph([a], cw - 0.6) for a in labs) + 0.1
        h = max(max(self.ph([b], cw - 0.6) for b in vals) + lh + 0.6, self._minh)
        for i, (lab, val, fill, fc, lc) in enumerate(sides):
            bx = x + i * (cw + 0.9)
            self.rect(sl, bx, y, cw, h, fill=fill)
            self.ptext(sl, bx + 0.3, y + 0.28, cw - 0.6, lh, [labs[i]])
            self.ptext(sl, bx + 0.3, y + 0.28 + lh, cw - 0.6, h - 0.28 - lh - 0.3, [vals[i]], anchor="middle")
        self.rect(sl, x + cw + 0.2, y + h / 2 - 0.19, 0.5, 0.38, fill=p.acc_f, shape=MSO_SHAPE.RIGHT_ARROW)
        return h

    def _compare_rows(self, sl, rows, x, y, w, sc):
        """A comparison grid: ``rows`` are [alternative, why it is picked, how we win] under a header row of three captions. Each row is a
        dark cell (head type) for the alternative, a card for why the client might pick it and an accent-edged card for how we win. The
        rows stretch to ``self._minh``; every row has all three cells."""
        S, p = self.th.scale, self.p
        nw = min(3.0, w * 0.24)
        gap = 0.09
        cw = (w - nw - 2 * gap) / 2
        cols = [(x, nw), (x + nw + gap, cw), (x + nw + gap + cw + gap, cw)]
        heads = [[self.para(h, S.caption * sc, p.mute, bold=True, track=1.2, cap=True)] for h in rows[0]]
        hh = max(self.ph(hp, c[1] - 0.4) for hp, c in zip(heads, cols)) + 0.1
        if sl is not None:
            for hp, (cx, cwid) in zip(heads, cols):
                self.ptext(sl, cx + 0.2, y, cwid - 0.4, hh, hp)
        geo = []
        for name, why, win in rows[1:]:
            ps = ([self.para(name, 17 * sc, p.inv_fg, self.th.head, bold=True, line=1.05)], [self.para(why, S.body * sc, p.card_fg, line=1.08)],
                  [self.para(win, S.body * sc, p.card_fg, line=1.08, bold=False)])
            geo.append((ps, max(self.ph(pp, c[1] - 0.5) for pp, c in zip(ps, cols)) + 0.3))
        natural = hh + sum(g[1] for g in geo) + gap * (len(geo) - 1)
        extra = max(0.0, self._minh - natural) / max(1, len(geo))
        yy = y + hh
        for ps, h in geo:
            h += extra
            if sl is not None:
                self.rect(sl, cols[0][0], yy, nw, h, fill=p.inv)
                self.ptext(sl, cols[0][0] + 0.25, yy, nw - 0.45, h, ps[0], anchor="middle")
                self.rect(sl, cols[1][0], yy, cw, h, fill=p.card)
                self.ptext(sl, cols[1][0] + 0.25, yy, cw - 0.45, h, ps[1], anchor="middle")
                self.rect(sl, cols[2][0], yy, cw, h, fill=p.card)
                self.rect(sl, cols[2][0], yy, 0.07, h, fill=p.acc_l)
                self.ptext(sl, cols[2][0] + 0.3, yy, cw - 0.55, h, ps[2], anchor="middle")
            yy += h + gap
        return yy - y - gap

    @staticmethod
    def _border(cell, side, color, w_pt):
        """One cell border: none when ``color`` is None, else a line of ``w_pt`` points."""
        tcPr = cell._tc.get_or_add_tcPr()
        for old in tcPr.findall(qn("a:" + side)):
            tcPr.remove(old)
        ln = etree.SubElement(tcPr, qn("a:" + side))
        ln.set("w", str(int(w_pt * 12700)))
        if color is None:
            etree.SubElement(ln, qn("a:noFill"))
        else:
            etree.SubElement(etree.SubElement(ln, qn("a:solidFill")), qn("a:srgbClr")).set("val", color)
        for tag in ("a:solidFill", "a:noFill"):   # schema order: borders before the cell fill
            for el in tcPr.findall(qn(tag)):
                tcPr.remove(el)
                tcPr.append(el)

    def _table_nat(self, rows, size) -> float:
        """The width in inches a table needs to show its words without much wrapping at ``size`` pt: per column the
        longest line (capped at 4.2 in, floored at 1.2 in) plus the cell margins, summed. This is the content
        estimate a table's drawn width is never under."""
        nc = len(rows[0])
        tot = 0.0
        for j in range(nc):
            wid = max(len(str(r[j])) * size * (0.53 if j == 0 else 0.5) / 72 for r in rows)
            tot += min(4.2, max(1.2, wid)) + 0.28
        return self._unk(tot)

    def _table_geo(self, rows, w, size):
        """Column widths and row heights (inches) for a table of ``rows`` set ``w`` wide at ``size`` pt. The
        columns share ``w`` in proportion to the text each holds."""
        nc = len(rows[0])
        lens = [max(10, min(50, max(len(r[j]) for r in rows))) for j in range(nc)]
        cws = [w * l / sum(lens) for l in lens]
        rh = []
        for i, r in enumerate(rows):
            hs = [self.nlines(c, cws[j] - 0.3, size, i == 0 or j == 0) * size * 1.2 / 72 + 0.1 for j, c in enumerate(r)]
            rh.append(max(0.3, max(hs)))
        return cws, rh

    def _draw_table(self, sl, x, y, w, rows, size, cws, rh):
        """One native table at the given geometry: header in ink, first column bold, thin rules, banded rows."""
        p = self.p
        nr, nc = len(rows), len(rows[0])
        gs = sl.shapes.add_table(nr, nc, *self._g(x, y, w, sum(rh)))
        tbl = gs.table
        tblPr = tbl._tbl.tblPr
        for a in ("firstRow", "bandRow"):
            tblPr.set(a, "0")
        sid = tblPr.find(qn("a:tableStyleId"))
        if sid is not None:
            sid.text = NO_STYLE
        for j, cw_ in enumerate(cws):
            tbl.columns[j].width = Inches(self._kx(cw_)) if self._cv is not None else Inches(cw_)
        for i, r in enumerate(rows):
            tbl.rows[i].height = Inches(rh[i])
            for j, val in enumerate(r):
                c = tbl.cell(i, j)
                c.margin_left = c.margin_right = Inches(0.14)
                c.margin_top = c.margin_bottom = Inches(0.04)
                c.vertical_anchor = MSO_ANCHOR.MIDDLE
                c.text_frame.word_wrap = True
                run = c.text_frame.paragraphs[0].add_run()
                run.text = numfmt.format_text(val)
                f = run.font
                f.size, f.name = Pt(size), self.th.body
                f.bold = i == 0 or j == 0
                f.color.rgb = _rgb(p.inv_fg if i == 0 else p.fg)
                if i == 0:
                    c.fill.solid(); c.fill.fore_color.rgb = _rgb(p.inv)
                elif i % 2 == 0:
                    c.fill.solid(); c.fill.fore_color.rgb = _rgb(p.card)
                else:
                    c.fill.background()
                for side in ("lnL", "lnR", "lnT"):
                    self._border(c, side, None, 0)
                self._border(c, "lnB", p.rule, 0.75)

    def _b_table(self, sl, bl, x, y, w, sc):
        """A clean native table, as wide as its slot (the columns share the width by their text). A long table of
        up to three columns that would stand over 4 in tall is split into two side-by-side halves, the header
        row repeated over each. The body rows stretch to ``self._minh``."""
        S = self.th.scale
        rows = [[str(c) for c in r] for r in bl["rows"]]
        if bl.get("compare") and len(rows[0]) == 3 and len(rows) > 1:
            return self._compare_rows(sl, rows, x, y, w, sc)
        if self._role and len(rows[0]) == 2 and len(rows) > 1:
            return self._role_rows(sl, rows[1:], x, y, w, sc, header=rows[0])
        size = self.sz(max(S.caption + 1 if bl.get("small") else S.small, S.body_floor) * min(sc, 1.15))
        cws, rh = self._table_geo(rows, w, size)
        parts = [(rows, cws, rh, x, w)]
        if sum(rh) > 4.0 and len(rows) > 10 and len(rows[0]) <= 3:
            half = -(-(len(rows) - 1) // 2)
            hw = (w - 0.4) / 2
            parts = []
            for k, chunk in enumerate((rows[1:1 + half], rows[1 + half:])):
                rr = [rows[0]] + chunk
                c2, h2 = self._table_geo(rr, hw, size)
                parts.append((rr, c2, h2, x + k * (hw + 0.4), hw))
        nat = max(sum(pt[2]) for pt in parts)
        extra = max(0.0, self._minh - nat)
        if sl is not None:
            for rr, c2, h2, px, pw in parts:
                add = (nat + extra - sum(h2)) / max(1, len(h2) - 1)   # each half ends on the same line
                h2 = [h2[0]] + [h + add for h in h2[1:]]
                self._draw_table(sl, px, y, pw, rr, size, c2, h2)
        return nat + extra

    LOOKS = {"statement": "_b_statement", "text": "_b_text", "small": "_b_small", "quote": "_b_quote",
             "callout": "_b_callout", "card": "_b_card", "kv": "_b_kv", "bullets": "_b_bullets", "stats": "_b_stats",
             "steps": "_b_steps", "fromto": "_b_fromto", "table": "_b_table"}

    def _look(self, sl, bl, x, y, w, sc, **kw):
        """The look for one block (NoFit for a kind that has none, such as ``chart`` off a chart slide)."""
        fn = self.LOOKS.get(bl["kind"])
        if fn is None:
            raise NoFit(f"no look for a {bl['kind']} block")
        n0 = len(sl.shapes) if sl is not None else 0
        h = getattr(self, fn)(sl, bl, x, y, w, sc, **kw)
        if sl is not None and sl is self._cur and self._slotmap:
            self._tag_slot(sl, n0, bl)
        return h

    _DEFAULT_NAME = re.compile(r"^(TextBox|Rounded Rectangle|Rectangle|Oval|Table|Chart|Connector|Straight Connector|Graphic Frame|Group|Freeform|Shape)\b")

    def _tag_slot(self, sl, n0, bl):
        """Name the shapes a block's look just drew ``slot:<name>`` (those still carrying their default name; Title, Caption and the other
        fixed names stay), and record them for layouts.json: ``{name, slot, blocks}``."""
        slot = self._slotmap.get(id(bl))
        if not slot:
            return
        for sh in list(sl.shapes)[n0:]:
            if self._DEFAULT_NAME.match(sh.name or ""):
                sh.name = f"slot:{slot[0]}"
        self._shapes_now.append({"name": f"slot:{slot[0]}", "slot": slot[0], "blocks": [slot[1]]})

    #: Block kinds whose look can take a minimum height (``Renderer._minh``): cards, panels, rows.
    STRETCH = ("bullets", "stats", "steps", "fromto", "callout", "card", "table")
    #: Scales a filling stack tries above 1.0 (largest first) before it stretches what is left.
    UPSCALES = (1.6, 1.45, 1.3, 1.2, 1.1)

    def _upscales(self) -> tuple:
        """Scales a filling stack tries above 1.0: today's up to 1.6 for a detailed deck, and at most 1.2 under lean and standard (fix 5)."""
        return self.UPSCALES if self.density in (None, "detailed") else tuple(x for x in self.UPSCALES if x <= 1.2)

    def _stretches(self) -> bool:
        """Whether cards grow to the foot of the content area: yes for a detailed deck (today), no under lean and standard."""
        return self.density in (None, "detailed") or self._role   # rows (the role grid, the timeline rows) are not cards: they still fill the height

    @staticmethod
    def _stretchable(row, force=False) -> bool:
        """Whether a plan row (one block, or a table beside its bullets) is made of cards that can grow. A single
        bullet (an emphasis bar) and a single big number stay as they are unless ``force``."""
        b = row[0]
        if b["kind"] not in Renderer.STRETCH:
            return False
        if force:
            return True
        if len(row) == 1 and b["kind"] == "bullets":
            return len([i for i in b["items"] if (i["text"] if isinstance(i, dict) else i).strip()]) > 1 or any(isinstance(i, dict) and i.get("human") for i in b["items"])
        if len(row) == 1 and b["kind"] == "stats":
            return len(b["items"]) > 1
        return True

    def stack(self, sl, blocks, x, y, w, bottom, role=False, fill=False, stretch_all=False):
        """Lay blocks top to bottom with the block looks, stepping the scale down until they fit above
        ``bottom`` (NoFit if they never do). A table followed by a single bullets block share a row when the
        table's content takes under 60% of the width. Returns the final y. ``sl`` None measures only.

        ``fill`` makes the slide use its height on purpose: the type is set as large as it fits (up to 1.6 times; lead lines and quotes less),
        and what height is left over goes into the cards and panels (they stretch, so the last one ends on
        ``bottom``); when nothing in the stack can stretch, the stack sits at the vertical middle of the area
        (at most 1 in down), so the space left is margin and not a hole under the content. ``stretch_all``
        lets a single bar or number stretch too."""
        self._role = role
        bl = [b for b in blocks if not (b["kind"] in ("text", "small", "statement", "quote", "callout") and not str(b.get("text", "")).strip())]
        plan, i = [], 0
        S = self.th.scale
        while i < len(bl):
            nxt = bl[i + 1] if i + 1 < len(bl) else None
            pair = nxt is not None and {bl[i]["kind"], nxt["kind"]} == {"table", "bullets"}
            if pair:
                tb, bu = (bl[i], nxt) if bl[i]["kind"] == "table" else (nxt, bl[i])
                pair = len(bu["items"]) <= 2 and len(tb["rows"][0]) <= 3 and \
                    not any(isinstance(t, dict) and t.get("human") for t in bu["items"]) and \
                    self._table_nat([[str(c) for c in r] for r in tb["rows"]], S.small) <= w * 0.6
            if pair:
                plan.append((tb, bu)); i += 2
            else:
                plan.append((bl[i],)); i += 1

        def one(sl_, row, yy, sc, minh=0.0):
            """One plan row at a scale: a block, or a table beside its bullets (the table as wide as its content
            needs, the bullets in the rest, both as tall as the row)."""
            self._minh = minh
            try:
                if len(row) == 1:
                    return self._look(sl_, row[0], x, yy, w, sc)
                rows_ = [[str(c) for c in r] for r in row[0]["rows"]]
                tw = min(w * 0.6, max(w * 0.45, self._table_nat(rows_, S.small * min(sc, 1.15))))
                h1 = self._look(sl_, row[0], x, yy, tw, sc)
                h2 = self._look(sl_, row[1], x + tw + 0.3, yy, w - tw - 0.3, sc, cols=1)
                return max(h1, h2, minh)
            finally:
                self._minh = 0.0

        scales = (self._upscales() if fill else ()) + SCALES
        if self._scale_cap is not None:
            scales = tuple(x for x in scales if x <= self._scale_cap) or SCALES[-1:]
        for sc in scales:
            try:
                heights = [one(None, r, 0, sc) for r in plan]
            except NoFit:
                continue
            total = sum(heights) + 0.24 * sc * max(0, len(plan) - 1)
            if y + total <= bottom:
                break
        else:
            raise NoFit("blocks do not fit the slide")
        self._min_sc = min(self._min_sc, sc)
        gap = 0.24 * sc
        extra, off = [0.0] * len(plan), 0.0
        slack = bottom - (y + total)
        if fill and slack > 0.05 and plan:
            idx = [k for k, r in enumerate(plan) if self._stretchable(r, stretch_all)] if self._stretches() else []
            if idx:
                for k in idx:
                    extra[k] = slack / len(idx)
            else:
                sparse = total < 0.40 * (bottom - y)   # a sparse slide sits at the middle of the body; otherwise at most 1 in down
                off = slack / 2 if sparse else min(slack / 2, 1.0)
        yy = y + off
        for k, row in enumerate(plan):
            m = self._mark(sl) if sl is not None else 0
            h = one(sl, row, yy, sc, heights[k] + extra[k] if extra[k] else 0.0)
            if sl is not None:
                self._build(sl, m, "wipe" if row[0]["kind"] in ("fromto", "steps") else "fade")
            yy += max(h, heights[k] + extra[k]) + gap
        return yy - gap if plan else y

    # -- layout library: slide layouts ------------------------------------------------------------
    def head(self, sl, s, dense=False, y=None):
        """The kicker tick and the slide's takeaway title, sized by its length (36 pt down to the title floor,
        28 pt; two lines preferred; ``dense`` starts at the floor). A title of two or more lines is set in a box
        narrowed to the width that still gives that many lines (``balance_w``) so its lines come out even and the
        last never holds one word alone. Returns the y below it. ``sl`` None measures only."""
        S, g = self.th.scale, self.th.grid
        w = self.x1 - self.x0
        if spec.LOOK_V2:   # one stamped size per layout, in one fixed box (0.1 in higher than before, the geometry a dense slide had): a dense slide no longer shrinks or lifts its own title
            dense, fixed = False, True
            stamped = self._tpt.get(self._lid)
        else:
            stamped, fixed = None, False
        cands = ((S.title_min,) + ((24,) if self._relaxed else ())) if dense else ((stamped,) if stamped else (S.title, 32, S.title_long, S.title_min))   # relaxed: the last resort may go to 24 pt
        for want in ((1, 2) if dense else (2,)):   # dense: a one-line title if one fits at the floor size
            for size in cands:
                n = self.nlines(glue(s["title"]), w, size, True, self.th.head)
                if n <= want:
                    break
            if n <= want:
                break
        if n > 3:
            raise NoFit("title too long")
        top = (g.title_y - (0.1 if (dense or fixed) else 0.0)) if y is None else y
        if self.th.v3 and self.th.decor.band and y is None:
            top = BAND_TITLE_Y   # under the section band
        h = n * size * 1.2 / 72 + 0.04
        if sl is not None:
            m = self._mark(sl)
            self._mark_above_title(sl, s, self.p.acc_l)
            tp = self.para(s["title"], size, self.p.fg, self.th.head, bold=True)
            bw = self.balance_w(tp["t"], w, size, True, self.th.head)
            self.ptext(sl, self.x0, top, bw, h, [tp], name="Title")
            self._build(sl, m, title=True)
        return top + h + ((0.15 if self.th.v3 else 0.2) if (dense or fixed) else 0.3)

    def _lay_stack(self, sl, s, role=False):
        """The standard composition: title, then the blocks stacked with their looks (cards, KPI row, timeline
        strip, comparison, native table, placeholder cards, role rows), filling the height of the content area
        (``stack(fill=True)``). Tries a dense (smaller) title second."""
        g = self.th.grid
        for dense in (False, True):
            try:
                y = self.head(None, s, dense)
                self.stack(None, s["blocks"], self.x0, y, self.x1 - self.x0, g.body_end, role, fill=True)
            except NoFit:
                continue
            y = self.head(sl, s, dense)
            self.stack(sl, s["blocks"], self.x0, y, self.x1 - self.x0, g.body_end, role, fill=True)
            return
        raise NoFit("slide too dense for its layout")

    def _lay_role(self, sl, s):
        """Role grid: the standard composition with tables and steps drawn as role rows."""
        self._lay_stack(sl, s, role=True)

    def _lay_flow(self, sl, s):
        """No layout: the caller draws the earlier flow."""
        raise NoFit("flow")

    def _lay_cover(self, sl, s, panel=False):
        """Cover: dark, an accent rule, the title at display size, the lead text and caption under it."""
        S, p, g = self.th.scale, self.p, self.th.grid
        pw = 5.0 if panel else 0.0
        px = self.x1 - pw   # the panel keeps the right margin and sits under the DRAFT mark (y 0.62 to 6.67), so no text runs over the picture
        if panel:
            self._own_picture(None, "picture", px, 0, pw, 6.85)   # NoFit without a picture
        w = (px - 0.5 - self.x0) if panel else (self.x1 - self.x0 if spec.LOOK_V2 else min(10.4, self.x1 - self.x0))
        blocks = [b for b in s["blocks"] if str(b.get("text", "")).strip()]
        if any(b["kind"] not in ("text", "small", "statement") for b in blocks):
            raise NoFit("cover holds text only")
        paras = []
        for b in blocks:
            if b["kind"] == "small":
                paras.append((self.para(str(b["text"]).strip(), S.small, p.mute, line=1.05), b))
            else:
                paras.append((self.para(str(b["text"]).strip(), S.lead, p.fg, line=1.05), b))
        rest = sum(self.ph([pp], w) + 0.25 for pp, b in paras) - 0.25
        too_long = True
        for size in ((64, 60, 54, 48, 44) if (spec.LOOK_V2 or panel) else (S.display, 40, 36, 32, 28)):   # the largest size at which the title takes three lines and the whole cover fits
            if self._cv is None:
                n = self.nlines(s["title"], w, size, True, self.th.head)
            else:   # deck-slide-size: measured as drawn (the last two words glued), and no glued pair wider than 90% of the line by the glyph
                # estimate: at 64 pt 'awareness campaign' was 8.47 of 8.7 in by the estimate and broke inside the word in LibreOffice
                n = self.nlines(glue(s["title"]), w, size, True, self.th.head) if self._units_fit(s["title"], w * 0.9, size) else 99
            if n > 3:
                continue
            too_long = False
            th_ = n * size * 1.2 / 72 + 0.04
            block = th_ + 0.4 + rest
            if block <= g.body_end - 1.6 or not (spec.LOOK_V2 or panel):
                break
        if too_long:
            raise NoFit("title too long")
        if block > g.body_end - 1.6:
            raise NoFit("cover too full")
        # the title block sits at the optical middle of the slide (a little above centre), never above 1.6 in
        y = max(1.6, (g.body_end + 1.0 - block) / 2 - 0.25)
        if sl is None:
            return
        m = self._mark(sl)
        self._mark_above_title(sl, s, p.acc_l, band=False)
        lx = self._logo(sl, 0.8)   # the brand's lockup for a dark ground, with the kicker label kept beside it
        self.ptext(sl, lx, 0.8 if lx == self.x0 else 1.1, 8, 0.3, [self.para(_kicker(self.deck["meta"]).upper(), S.caption, p.acc_t, bold=True, track=1.2, cap=True)])
        self.ptext(sl, self.x0, y, w, th_, [self.para(s["title"], size, p.fg, self.th.head, bold=True, line=1.0)], name="Title")
        self._build(sl, m, title=True)
        if panel:
            self._own_picture(sl, "picture", px, self.PIC_TOP, pw, self.PIC_H)
        yy = y + th_ + 0.4
        for pp, b in paras:
            m = self._mark(sl)
            h = self.ph([pp], w)
            self.ptext(sl, self.x0, yy, w, h, [pp])
            self._build(sl, m)
            yy += h + 0.25

    def _lay_emphasis(self, sl, s):
        """Emphasis bar: dark slide, the title large on the left, the statement and text in an accent bar on the
        right (the title alone, full width, when there are no blocks)."""
        S, p, g = self.th.scale, self.p, self.th.grid
        label = {"idea": "THE IDEA", "real_question": "THE REAL QUESTION"}.get(s["type"])
        blocks = [b for b in s["blocks"] if str(b.get("text", "")).strip()]
        top, avail = 1.45, g.body_end - 1.45
        tw = (self.x1 - self.x0) if not blocks else 6.9
        for size in (S.display, 40, 36, 32, 30, 28):
            tp = [self.para(s["title"], size, p.fg, self.th.head, bold=True, line=1.0)]
            if self.ph(tp, tw) <= avail:
                break
        else:
            raise NoFit("title too long")
        bar = None
        if blocks:
            xr = self.x0 + tw + 0.9
            wr = self.x1 - xr
            for sc in (1.25, 1.12, 1.0, 0.9, 0.8, 0.7):
                bp = [self.para(str(b["text"]).strip(),
                                {"statement": S.lead, "text": S.body, "small": S.caption + 1}[b["kind"]] * sc,
                                p.mute if b["kind"] == "small" else p.fg,
                                self.th.head if b["kind"] == "statement" else None, line=1.1, after=10) for b in blocks]
                bh = self.ph(bp, wr - 0.32)
                if bh <= avail:
                    bar = (xr, wr, bp, bh)
                    break
            else:
                raise NoFit("statement too long")
        if sl is None:
            return
        # the title and its statement sit as one group at the vertical middle of the content area
        gh = max(self.ph(tp, tw), max(bar[3], 1.2) if bar else 0.0)
        top += 0.45 if spec.LOOK_V2 else max(0.0, (avail - gh) / 2) * 0.85   # look change 2: one baseline, not floating to the middle
        m = self._mark(sl)
        self._mark_above_title(sl, s, p.acc_l)
        if label and not self._band_drawn:   # the band carries the section label
            self.ptext(sl, self.x0, 0.8, 6, 0.3, [self.para(label, S.caption, p.acc_t, bold=True, track=1.2, cap=True)])
        self.ptext(sl, self.x0, top, tw, self.ph(tp, tw), tp, name="Title")
        self._build(sl, m, title=True)
        if bar:
            xr, wr, bp, bh = bar
            m = self._mark(sl)
            if not self.th.v3:
                self.rect(sl, xr - 0.45, top, 0.012, max(bh, 2.0), fill=p.rule)
            self.rect(sl, xr, top, 0.09, max(bh, 1.2), fill=p.acc_l)
            self.ptext(sl, xr + 0.32, top, wr - 0.32, max(bh, 1.2), bp, anchor="middle")
            self._build(sl, m)

    def _lay_quote(self, sl, s):
        """Quote and cards: a dark panel with the quote, its label and the lead text on the left; one card per
        bullet on the right. The panel and the cards start on one line and end on one line (the foot of the
        content area); the quote is set as large as it fits and sits at the middle of the panel."""
        S, p, g = self.th.scale, self.p, self.th.grid
        bl = [b for b in s["blocks"] if str(b.get("text", "")).strip() or b["kind"] == "bullets"]
        if any(b["kind"] not in ("quote", "small", "text", "bullets") for b in bl):
            raise NoFit("quote layout holds quote, text, bullets")
        left = [b for b in bl if b["kind"] != "bullets"]
        right = [b for b in bl if b["kind"] == "bullets"]
        lw = 4.8
        xr = self.x0 + lw + g.G
        wr = self.x1 - xr
        for dense in (False, True):
            try:
                y = self.head(None, s, dense)
            except NoFit:
                continue
            H = g.body_end - y
            for sc in (1.3, 1.2, 1.1) + SCALES:
                lp = []
                for b in left:
                    t = str(b["text"]).strip()
                    if b["kind"] == "quote":
                        lp.append(self.para(t, 24 * sc, p.inv_fg, self.th.head, italic=True, line=1.1, after=12))
                    elif b["kind"] == "small":
                        lp.append(self.para(t, (S.caption + 1) * sc, p.inv_mute, after=12))
                    else:
                        lp.append(self.para(t, S.small * sc, p.inv_mute, line=1.05, after=6))
                try:
                    lh = self.ph(lp, lw - 0.8) + 0.9
                    self.stack(None, right, xr, y, wr, g.body_end, fill=True, stretch_all=True)
                except NoFit:
                    continue
                if lh <= H:
                    break
            else:
                continue
            if sl is None:
                return
            y = self.head(sl, s, dense)
            m = self._mark(sl)
            self.rect(sl, self.x0, y, lw, H, fill=p.inv)
            block = self.ph(lp, lw - 0.8) + 0.3
            top = y + (H - block) / 2
            self.rect(sl, self.x0 + 0.4, top, 0.5, 0.05, fill=p.inv_acc)
            self.ptext(sl, self.x0 + 0.4, top + 0.3, lw - 0.8, block - 0.3, lp)
            self._build(sl, m)
            self.stack(sl, right, xr, y, wr, g.body_end, fill=True, stretch_all=True)
            return
        raise NoFit("quote slide too dense")

    def _lay_chart(self, sl, s):
        """Chart: one native bar chart on the left, on a shared 0 to 100 scale, the hero figures picked out in the
        accent (the other bars muted) instead of repeated as big-number panels beside the bars; the commentary as
        cards on the right. The chart runs the height of the content area."""
        if spec.GRAPHICS and self.th.v3:   # deck-graphics slice 4: the unit-aware chart, its source line, the v3 look
            return self._lay_chart_g(sl, s, full=False)
        S, p, g = self.th.scale, self.p, self.th.grid
        ch = next((b for b in s["blocks"] if b["kind"] == "chart"), None)
        rest = [b for b in s["blocks"] if b["kind"] != "chart"]
        for dense in (False, True):
            try:
                y = self.head(None, s, dense)
                if g.body_end - y < 2.4:
                    raise NoFit("no room for the chart")
                self.stack(None, rest, self.x0 + 7.6, y, self.x1 - self.x0 - 7.6, g.body_end, fill=True)
            except NoFit:
                continue
            if sl is None:
                return
            y = self.head(sl, s, dense)
            m = self._mark(sl)
            self.chart(sl, self.x0, y, 7.2, g.body_end - y, ch["chart"]["series"], ch["chart"].get("title"), hero=ch["chart"].get("hero"))
            self._build(sl, m, "wipe")
            self.stack(sl, rest, self.x0 + 7.6, y, self.x1 - self.x0 - 7.6, g.body_end, fill=True)
            return
        raise NoFit("chart slide too dense")

    def _lay_execution(self, sl, s):
        """Execution: role notes in a light card on the left, the copy set in a dark frame on the right. The two
        end on one line (the foot of the content area). In the frame the lines and the closing answer sit as one
        group at the vertical middle, the answer a fixed 0.4 in under the last line, so there is no gap
        between the copy and its closing line."""
        S, p, g = self.th.scale, self.p, self.th.grid
        cp = next((b for b in s["blocks"] if b["kind"] == "copy"), None)
        if cp is None:
            raise NoFit("no copy block")
        rest = [b for b in s["blocks"] if b["kind"] != "copy"]
        vis = s.get("visual") or {}
        GAP = 0.4   # the fixed gap between the last line of copy and the closing answer
        stacked = bool(self._pics)   # the picture takes the right half of the slide: the notes card and the copy frame stack in what is left
        if stacked:
            fw = lw = self.x1 - self.x0
            fx = self.x0
        else:
            fw = 5.9
            fx = self.x1 - fw
            lw = fx - self.x0 - g.G
        for dense in (False, True):
            try:
                y = self.head(None, s, dense)
                fh = g.body_end - y
                note = []
                nh = 0.0
                if vis.get("kind") == "image_prompt":
                    note = [self.para("Image prompt (" + vis.get("status", "illustrative") + "): " + vis.get("prompt", ""), S.caption, p.mute, italic=True, cap=True)]
                    nh = self.ph(note, lw - 0.6) + 0.25
                ch, cy, fy, ffh = fh, y, y, fh   # the card's height and top, the frame's top and height
                if stacked:
                    ch = None
                    for share in (0.24, 0.30, 0.36, 0.42):   # the smallest share of the height the notes fit in
                        try:
                            self.stack(None, rest, self.x0 + 0.3, y + 0.3, lw - 0.6, y + fh * share - 0.3 - nh, fill=False)
                            ch = fh * share
                            break
                        except NoFit:
                            continue
                    if ch is None:
                        raise NoFit("the notes do not fit above the copy")
                    fy, ffh = y + ch + 0.2, fh - ch - 0.2
                self.stack(None, rest, self.x0 + 0.3, cy + 0.3, lw - 0.6, cy + ch - 0.3 - nh, fill=True)
                for asz in (S.body, 15, S.small, 13, 12):
                    ans = [self.para(cp["answer"], asz, p.inv_acc, bold=True)]
                    ah = self.ph(ans, fw - 0.8)
                    try:
                        size = self.fit(lambda sz_: [self.para(l, sz_, p.inv_fg, self.th.head, line=1.1, after=10) for l in cp["lines"]], fw - 0.8, ffh - 0.8 - ah - GAP, 26, 12)
                        break
                    except NoFit:
                        continue
                else:
                    raise NoFit("copy and answer do not fit the frame")
            except NoFit:
                continue
            if sl is None:
                return
            y = self.head(sl, s, dense)
            m = self._mark(sl)
            self.rect(sl, self.x0, cy, lw, ch, fill=p.card)
            self.rect(sl, self.x0, cy, lw, 0.05, fill=p.acc_l)
            self.stack(sl, rest, self.x0 + 0.3, cy + 0.3, lw - 0.6, cy + ch - 0.3 - nh, fill=True)
            if note:
                self.ptext(sl, self.x0 + 0.3, cy + ch - 0.25 - (nh - 0.25), lw - 0.6, nh - 0.25, note, anchor="bottom")
            self._build(sl, m)
            m = self._mark(sl)
            lines = [self.para(l, size, p.inv_fg, self.th.head, line=1.1, after=10) for l in cp["lines"]]
            lh = self.ph(lines, fw - 0.8)
            self.rect(sl, fx, fy, fw, ffh, fill=p.inv)
            self.rect(sl, fx, fy, 0.09, ffh, fill=p.acc_l)
            top = fy + (ffh - (lh + GAP + ah)) / 2
            self.ptext(sl, fx + 0.4, top, fw - 0.8, lh, lines)
            self._build(sl, m)
            m = self._mark(sl)
            self.ptext(sl, fx + 0.4, top + lh + GAP, fw - 0.8, ah, ans)
            self._build(sl, m)
            return
        raise NoFit("execution slide too dense")

    def _lay_territory(self, sl, s, wide_only=False):
        """Territory: the thought and reasons on the left, an illustrative sketch panel on the right. When the
        reasons are too long for the left column, the statement sits beside the panel and the reasons run
        full width underneath as cards."""
        S, p, g = self.th.scale, self.p, self.th.grid
        if self._lid == "frames_strip" and self._cv is not None:   # deck-slide-size: four 16:9 frames in a row only while each is 2.4 in wide
            self.min_column((self.x1 - self.x0 - 3 * 0.2) / 4, spec.MIN_STRIP_FRAME_IN, "frames strip cell")   # 4:3 (2.07 in): NoFit, the alternatives
        sk = next((b for b in s["blocks"] if b["kind"] == "sketch"), None)
        rest = [b for b in s["blocks"] if b["kind"] != "sketch"]
        pw = 4.4
        px = self.x1 - pw
        lw = px - self.x0 - 0.4
        parts = [t for t in re.split(r"\s*->\s*", str(sk["text"])) if t.strip()] if sk else []

        def panel(sl_, y, h):
            """The sketch panel at y, h inches tall (text sized to fit)."""
            size = self.fit(lambda sz_: [self.para(t, sz_, p.inv_fg, self.th.head, line=1.1, after=8) for t in parts], pw - 0.8, h - 0.85, 26, 12)
            if sl_ is None:
                return
            m = self._mark(sl_)
            self.rect(sl_, px, y, pw, h, fill=p.inv)
            self.rect(sl_, px, y, 0.09, h, fill=p.acc_l)
            self.ptext(sl_, px + 0.4, y + 0.25, pw - 0.8, h - 0.85, [self.para(t, size, p.inv_fg, self.th.head, line=1.1, after=8) for t in parts], anchor="middle")
            self.ptext(sl_, px + 0.4, y + h - 0.5, pw - 0.8, 0.3, [self.para("Illustrative, not final", S.caption, p.inv_acc, italic=True, cap=True)])
            self._build(sl_, m)

        for dense in (() if wide_only else (False, True)):
            try:
                y = self.head(None, s, dense)
                self.stack(None, rest, self.x0, y, lw, g.body_end, fill=True)
                if sk:
                    panel(None, y, g.body_end - y)
            except NoFit:
                continue
            if sl is None:
                return
            y = self.head(sl, s, dense)
            self.stack(sl, rest, self.x0, y, lw, g.body_end, fill=True)
            if sk:
                panel(sl, y, g.body_end - y)
            return
        # wide variant: statement and panel on top, the kv cards full width below
        top = [b for b in rest if b["kind"] != "kv"]
        low = [b for b in rest if b["kind"] == "kv"]
        for dense in (False, True):
            try:
                y = self.head(None, s, dense)
                ey = self.stack(None, top, self.x0, y, lw, y + 1.9)
                pm = self.ph([self.para(t, 12, p.inv_fg, self.th.head, line=1.1, after=8) for t in parts], pw - 0.8) + 0.85 if sk else 0
                ph_ = max(ey - y, pm)
                if sk:
                    panel(None, y, ph_)
                self._kvcards = True
                try:
                    self.stack(None, low, self.x0, y + ph_ + 0.2, self.x1 - self.x0, g.body_end)
                finally:
                    self._kvcards = False
            except NoFit:
                continue
            if sl is None:
                return
            y = self.head(sl, s, dense)
            self.stack(sl, top, self.x0, y, lw, y + 1.9)
            if sk:
                panel(sl, y, ph_)
            self._kvcards = True
            try:
                self.stack(sl, low, self.x0, y + ph_ + 0.2, self.x1 - self.x0, g.body_end)
            finally:
                self._kvcards = False
            return
        raise NoFit("territory slide too dense")

    def _lay_risks(self, sl, s):
        """Risk cards: the standard composition with each (risk, mitigation) pair of the ``kv`` block as one card, the risk as its heading."""
        self._kvcards = True
        try:
            self._lay_stack(sl, s)
        finally:
            self._kvcards = False

    def _lay_objective(self, sl, s):
        """Objective: a dark big-number panel on the left holding the target figure, with the baseline and the date (pulled from the
        objective's own sentences by ``_objective_facts``) as small captioned lines under it; the slide's own blocks, whole, as cards
        on the right. The panel and the cards start and end on one line. NoFit when no figure is found or the words do not fit."""
        S, p, g = self.th.scale, self.p, self.th.grid
        texts = [b.get("text", "") for b in s["blocks"] if b["kind"] in ("callout", "text", "statement")] + \
                [i["text"] if isinstance(i, dict) else str(i) for b in s["blocks"] if b["kind"] == "bullets" for i in b["items"]]
        facts = _objective_facts(texts)
        if not facts:
            raise NoFit("no target figure in the objective")
        lw = 4.6
        xr = self.x0 + lw + g.G
        wr = self.x1 - xr
        for dense in (False, True):
            try:
                y = self.head(None, s, dense)
                self.stack(None, s["blocks"], xr, y, wr, g.body_end, fill=True, stretch_all=True)
            except NoFit:
                continue
            vs = 60.0
            while self.nlines(facts["target"], lw - 0.8, self.sz(vs), True, self.th.head) > 1 and vs > 28:
                vs -= 1
            if self.nlines(facts["target"], lw - 0.8, self.sz(vs), True, self.th.head) > 1:
                raise NoFit("target figure too wide for the panel")
            if sl is None:
                return
            y = self.head(sl, s, dense)
            H = g.body_end - y
            m = self._mark(sl)
            self.rect(sl, self.x0, y, lw, H, fill=p.inv)
            self.rect(sl, self.x0, y, 0.09, H, fill=p.acc_l)
            parts = [([self.para("THE TARGET", S.caption, p.inv_mute, bold=True, track=1.2, cap=True)], 0.08),
                     ([self.para(facts["target"], vs, p.inv_acc, self.th.head, bold=True)], 0.3)]
            for cap, key in (("BASELINE", "baseline"), ("BY WHEN", "date")):
                if facts[key]:
                    parts += [([self.para(cap, S.caption, p.inv_mute, bold=True, track=1.2, cap=True)], 0.04),
                              ([self.para(facts[key], S.body + 2, p.inv_fg, line=1.05)], 0.22)]
            heights = [self.ph(ps, lw - 0.8) + gap for ps, gap in parts]
            block = sum(heights) - parts[-1][1]
            yy = y + max(0.25, (H - block) / 2)
            for (ps, gap), h in zip(parts, heights):
                self.ptext(sl, self.x0 + 0.4, yy, lw - 0.8, h - gap, ps)
                yy += h
            self._build(sl, m)
            self.stack(sl, s["blocks"], xr, y, wr, g.body_end, fill=True, stretch_all=True)
            return
        raise NoFit("objective slide too dense")

    # -- the layouts the library adds (deck-layout-library): text layouts, the dark close, the picture layouts -------------------
    LEAD_KINDS = ("text", "small", "statement", "quote", "callout")
    #: Picture layouts that draw their own picture panel (the rest keep slice 3's carve: execution_visual, frames_strip).
    PIC_TOP, PIC_H = 0.62, 6.05   # the picture panel of the cover and the image layouts: inside the margins, under the DRAFT mark
    OWN_PICTURE = ("cover_image", "image_text", "image_left", "full_bleed_statement", "section", "image_grid", "picture_column", "cover_bleed")

    def _cpl_w(self, size, bold=False, font=None, cpl=48) -> float:
        """The width in inches of ``cpl`` characters at ``size`` pt (the renderer's glyph estimate): the 48-character line."""
        return self._unk(cpl * size * self._wf(bold, font) / 72)

    def _text_of(self, b) -> str:
        return str(b.get("text", "")).strip()

    def _own_picture(self, sl, slot, x, y, w, h, corner="left", label=True):
        """Draw the slide's picture for ``slot`` in the box (cropped to cover, never stretched). NoFit when there is none; measure-only and
        probes draw nothing (the hole estimate counts the box as ink). ``label`` False: the layout places the picture label itself."""
        im = self._pics.get(slot)
        if im is None:
            raise NoFit(f"no picture for {slot}")
        if sl is not None and self._ink is not None:
            self._ink.append(self._cv.box(x, y, w, h) if self._cv is not None else (x, y, w, h))
        if sl is None or im.get("probe"):
            return
        m = self._mark(sl)
        fr = self._frame_for(im)
        shots = self._strip_shots() if fr else []
        if shots:   # deck-graphics slice 3: a film execution's Production storyboard, all of it Production, in the picture's column
            self._strip_column(sl, x, y, w, h, shots)
        elif fr:   # deck-graphics: the execution's picture shown in place, in its frame on a panel the size of the picture's box
            self._framed(sl, x, y, w, h, im, fr, ground=self.th.panel)
        elif self._plain_ok(im, w, h):
            self.picture(sl, x, y, w, h, im, corner=corner, label=label)
        self._own_pics.add(slot)
        self.placed.add((self._sid, slot))
        self._build(sl, m)

    def _scrim(self, sl, x, y, w, h, color, alpha=0.72):
        """A solid rectangle at ``alpha`` opacity (a scrim under text over a picture)."""
        r = self.rect(sl, x, y, w, h, fill=color, name="Scrim")
        sf = r.fill._xPr.find(qn("a:solidFill"))
        clr = sf[0]
        a = etree.SubElement(clr, qn("a:alpha"))
        a.set("val", str(int(alpha * 100000)))
        return r

    # -- icons (deck-graphics slice 1) ---------------------------------------------------------------------------------------------
    def _icon_ids(self, headings) -> list | None:
        """The icons of one group (graphics.choose: every item a different icon, else None), or None when icons are off for this deck,
        the slide's ink is under 3:1 on its ground, or there is no group."""
        if not self._icons_on or not headings:
            return None
        from . import graphics   # noqa: PLC0415
        if not graphics.stroke_ok(self.p.fg, self.p.bg):
            return None
        return graphics.choose(list(headings))

    def _icon(self, sl, iid, x, y, size):
        """Draw one icon: a native stroke-only freeform (graphics.icon_xml) in the text token, at (x, y) inches, ``size`` inches square.
        Never on a measuring pass or the hole probe's scratch slide (so an icon cannot move a plan or a hole estimate)."""
        if sl is None or self._sid is None or sl is not self._cur:
            return
        from . import graphics   # noqa: PLC0415
        ex, ey, es, _ = self._gk(x, y, size, size)
        el = etree.fromstring(graphics.icon_xml(sl.shapes._next_shape_id, iid, int(ex), int(ey), int(es), self.p.fg, size))
        sl.shapes._spTree.append(el)

    def _record_icons(self, sl, sid, name):
        """After a slide is drawn: the icons it really carries (rolled-back attempts leave none), in drawing order."""
        if not self._icons_on:
            return
        ids = [sh.name[len("Icon: "):] for sh in sl.shapes if sh.name.startswith("Icon: ")]
        if ids:
            self.icons_drawn[sid] = {"layout": name, "ids": ids}

    # -- execution frames and the storyboard strip (deck-graphics slices 2-3) --------------------------------------------------------
    PILL_H = 0.28

    def _frame_for(self, im) -> dict | None:
        """The frame this slide's execution picture is shown in (graphics.frame_of), or None: graphics off, not an execution's picture,
        a channel with no frame, or ink under 3:1 on the slide's ground (then the picture is drawn plain, as before)."""
        self._frame_blocked = None
        if not spec.GRAPHICS or self._exec_title is None or not im:
            return None
        from . import graphics   # noqa: PLC0415
        if not graphics.part_on(self.deck, "mockups"):
            return None
        fr = graphics.frame_of(self.deck, self._exec_title, im)
        if fr and not (graphics.stroke_ok(self.p.fg, self.p.bg) and graphics.stroke_ok(self.p.fg, self.th.panel)):
            self._frame_blocked = fr   # the frame cannot be drawn on this ground: the plain picture only if its shape fits (_plain_ok)
            return None
        return fr

    def _plain_ok(self, im, w, h) -> bool:
        """When a frame was refused for contrast: the picture is drawn plain only if its own aspect is within images.ASPECT_TOL of the box
        (a Production size bound for a frame may be any shape, and the plain box would crop it); else it is left out with a finding."""
        fr = getattr(self, "_frame_blocked", None)
        if not fr:
            return True
        import math   # noqa: PLC0415
        if abs(math.log(fr["ratio"] / (w / h))) <= math.log(images.ASPECT_TOL):
            return True
        self.picture_findings.append({"check": "image_missing", "level": "warn", "slide": self._sid, "slot": "picture",
                                      "message": "picture is not drawn: its frame's ink is under 3:1 on this ground and its shape does not fit the plain box"})
        return False

    def _mockup_pill(self, sl, x, y):
        """The fixed 'Mock-up' label (spec.MOCKUP_LABEL): white bold 10 pt on an ink pill, beside the picture's own label. Returns its width."""
        pw = self._unk(0.24 + 0.085 * len(spec.MOCKUP_LABEL))
        self.rect(sl, x, y, pw, self.PILL_H, fill=self.th.ink, name="MockupPill")
        self.text(sl, x, y, pw, self.PILL_H, spec.MOCKUP_LABEL, size=10, color="FFFFFF", bold=True, align=PP_ALIGN.CENTER,
                  anchor=MSO_ANCHOR.MIDDLE, name="MockupLabel")
        return pw

    def _pills(self, sl, x, y, im):
        """The picture's own label (unless approved) and 'Mock-up', left to right from ``(x, y)``: always outside the frame."""
        if im.get("status") != "approved":
            pw = self._label_w(im, 3.0)
            self._label_pill(sl, x, y, im, pw)
            x += pw + 0.1
        return x + self._mockup_pill(sl, x, y)

    STRIP_CAP_H = 0.62   # the caption row under a strip's numbers (two lines of 11 pt)

    def _strip_info(self) -> tuple:
        """``(shot numbers, note, captions)`` of the slide's storyboard strip (images.bind_production: the storyboard's own shot numbers, when
        fewer frames are drawn than it has shots '4 of 9 shots', and each frame's caption from the slide's own 'Frame n:' line);
        ``(None, '', [])`` when the slide carries none."""
        st = ((self.deck.get("slides") or {}).get(self._sid) or {}).get("strip") or {}
        return st.get("shots"), str(st.get("note") or ""), list(st.get("captions") or [])

    def _strip_note(self, sl, x, y, note):
        if note:
            self.text(sl, x + 0.12, y, 2.4, self.PILL_H, note, size=12, color=self.p.mute, anchor=MSO_ANCHOR.MIDDLE, name="StripNote")

    def _framed(self, sl, x, y, w, h, im, fr, ground=None, pills=True):
        """An execution's picture in its drawn frame (graphics.frame_geometry) contained in the box: the frame's parts in the ink token
        (a blank screen in the paper, its bars in the rule token), the picture in the window at the window's exact aspect (a Production
        size: its own format's, so nothing is cut), then the labels in a row under the frame, never on it."""
        from . import graphics   # noqa: PLC0415
        if ground:
            self.rect(sl, x, y, w, h, fill=ground, name="FrameGround")
            if self._cv is not None and x <= 0.01:   # deck-slide-size: a column bleeding off the left keeps its labels 0.5 in in
                x, y, w, h = x + 0.55, y + 0.75, w - 1.0, h - 1.5
            else:
                x, y, w, h = x + 0.45, y + 0.75, w - 0.9, h - 1.5
        row = self.PILL_H + 0.18
        geo = graphics.frame_geometry(fr["kind"], self._aspect_v(fr["ratio"], x, y, w, h - row), x, y, w, h - row)   # the format's exact aspect at any size
        gutter = None
        for role, shape, px, py, pw, ph in geo["parts"]:
            name = f"Frame: {fr['kind']}"
            if shape == "rrect":
                s_ = self.rect(sl, px, py, pw, ph, fill=self.th.ink, shape=MSO_SHAPE.ROUNDED_RECTANGLE, name=name)
                s_.adjustments[0] = 0.12
            elif shape == "rect":
                self.rect(sl, px, py, pw, ph, fill=self.th.ink, name=name)
            elif shape == "screen":
                self.rect(sl, px, py, pw, ph, fill=self.th.paper, name=name)
            elif shape == "bar":
                self.rect(sl, px, py, pw, ph, fill=self.th.rule, name=name)
            elif shape == "gutter":
                gutter = (px, py, ph)
        wx, wy, ww, wh = geo["window"]
        self.picture(sl, wx, wy, ww, wh, im, name="Framed picture", label=False)
        if gutter:   # a magazine spread: the fold as a hairline over the two pages
            self.hairline(sl, gutter[0], gutter[1], gutter[0], gutter[1] + gutter[2], color=self.th.rule, name=f"Frame: {fr['kind']}")
        ox, oy, ow, oh = geo["outer"]
        if pills:
            self._pills(sl, ox, min(y + h - self.PILL_H, oy + oh + 0.18), im)
        return geo

    OOH_NAME_H = 0.36   # the format's name under its frame

    def _ooh_plan(self, sid, s):
        """The out-of-home slide's frames (images.bind_production wrote ``slide.ooh``): ``{body_end, cells, row}`` or None. Each frame at its own
        format's aspect, widths in proportion to the frames so a wide 48-sheet and a tall 6-sheet share the row at one height."""
        fm = (s.get("ooh") or {}).get("formats") or []
        got = {slot: im for (i, slot), im in self.drawn.items() if i == sid}
        cells = [(f, got[f["slot"]]) for f in fm if f.get("slot") in got]
        if not cells or not spec.GRAPHICS:
            return None
        from . import graphics   # noqa: PLC0415
        g = self.th.grid
        title = spec.picture_of(s)[1]
        frs = [graphics.frame_of(self.deck, title, im) for _, im in cells]
        if not all(frs):
            return None
        top = 3.2
        h = g.body_end - self.OOH_NAME_H - 0.1 - top
        gap = 0.45
        want = [fr["ratio"] * h + 0.6 for fr in frs]
        avail = (self.x1 - self.x0) - gap * (len(cells) - 1)
        k = min(1.0, avail / sum(want))
        ws = [w * k for w in want]
        x = self.x0 + (avail - sum(ws)) / 2
        out = []
        for (f, im), fr, w in zip(cells, frs, ws):
            out.append((f, im, fr, x, top, w, h))
            x += w + gap
        return {"body_end": top - self.PILL_H - 0.3, "cells": out}

    def _ooh_draw(self, sl, plan):
        """The frames, each named under it, and the labels (the picture's own, then 'Mock-up') above the row at its right end."""
        for f, im, fr, x, y, w, h in plan["cells"]:
            m = self._mark(sl)
            geo = self._framed(sl, x, y, w, h + self.OOH_NAME_H + 0.1, im, fr, pills=False)
            ox, oy, ow, oh = geo["outer"]
            self.text(sl, x - 0.2, oy + oh + 0.1, w + 0.4, self.OOH_NAME_H, str(f.get("name") or ""), size=14, bold=True, align=PP_ALIGN.CENTER,
                      name="FormatName")
            self._build(sl, m)
        f0, im0, fr0, *_ = plan["cells"][0]
        x_end = plan["cells"][-1][3] + plan["cells"][-1][5]
        lab = (self._label_w(im0, 3.0) + 0.1) if im0.get("status") != "approved" else 0.0
        py = plan["cells"][0][4] - self.PILL_H - 0.12
        self._pills(sl, x_end - lab - self._unk(0.24 + 0.085 * len(spec.MOCKUP_LABEL)), py, im0)

    def _strip_draw(self, sl, plan):
        """The storyboard strip (slice 3): each Production frame in a hairline window at its own aspect, numbered 1 to n under a hairline
        (numbers only: no shot caption is carried or written), the labels above the strip at its right end."""
        boxes = plan["boxes"]
        m = self._mark(sl)
        numbers, note, caps = self._strip_info()
        self._strip_cells(sl, boxes, numbers, caps)
        x_end = boxes[-1][1] + boxes[-1][3]
        im0 = boxes[0][5]
        lab = (self._label_w(im0, 3.0) + 0.1) if im0.get("status") != "approved" else 0.0
        py = boxes[0][2] - self.PILL_H - 0.12
        self._pills(sl, x_end - lab - self._unk(0.24 + 0.085 * len(spec.MOCKUP_LABEL)), py, im0)
        self._strip_note(sl, boxes[0][1] - 0.12, py, note)
        self._build(sl, m)

    def _strip_cells(self, sl, boxes, numbers=None, caps=None):
        """Each storyboard frame in a hairline window at its own aspect, numbered under it beside a hairline with its shot number in the
        storyboard (numbers only: no caption is carried or written)."""
        numbers = numbers if numbers and len(numbers) == len(boxes) else list(range(1, len(boxes) + 1))
        for n, (slot, x, y, w, h, im) in zip(numbers, boxes):
            self.picture(sl, x, y, w, h, im, name="Strip picture", label=False)
            self.rect(sl, x, y, w, h, line=self.p.fg, lw=0.75, name="Frame: storyboard")
            self.text(sl, x, y + h + 0.04, 0.3, 0.3, str(n), size=14, bold=True, font=self.th.head, name="StripNumber")
            self.hairline(sl, x + 0.32, y + h + 0.19, x + w, y + h + 0.19)
        if caps and len(caps) == len(boxes):   # the frame's own line from the idea stage, under its number
            for c, (slot, x, y, w, h, im) in zip(caps, boxes):
                if c:
                    self.text(sl, x, y + h + 0.26, w, self.STRIP_CAP_H - 0.06, c, size=11, color=self.p.fg, name="StripCaption")

    def _strip_shots(self) -> list:
        """``[(slot, image)]`` of the slide's drawn storyboard shots in order, when they make a strip (spec.STRIP_MIN or more), else []."""
        if not spec.GRAPHICS or self._exec_title is None:
            return []
        shots = sorted((k, im) for k, im in self._pics.items() if k.startswith("shot_") and not im.get("probe"))
        return shots if len(shots) >= spec.STRIP_MIN else []

    def _strip_column(self, sl, x, y, w, h, shots):
        """A picture column holding a film execution's storyboard: the frames stacked on a panel ground, numbered, the labels at the foot."""
        self.rect(sl, x, y, w, h, fill=self.th.panel, name="FrameGround")
        ix, iy, iw, ih = x + 0.5, y + 0.75, w - 1.0, h - 1.5 - self.PILL_H - 0.2
        n = len(shots)
        rs = [self._aspect_v(self._asset_ratio(im), ix, iy, iw, ih) for _, im in shots]
        gap, num = 0.2, 0.42   # between cells; the number row under each frame
        fh = min((ih - num * n - gap * (n - 1)) / n, iw / max(rs))
        top = iy + (ih - ((fh + num) * n + gap * (n - 1))) / 2
        boxes = []
        for i, ((k, im), r) in enumerate(zip(shots, rs)):
            fw = fh * r
            boxes.append((k, ix + (iw - fw) / 2, top + i * (fh + num + gap), fw, fh, im))
        numbers, note, caps = self._strip_info()
        self._strip_cells(sl, boxes, numbers)
        end = self._pills(sl, boxes[0][1], iy + ih + 0.2, shots[0][1])
        self._strip_note(sl, end, iy + ih + 0.2, note)
        for k, _ in shots:
            self._own_pics.add(k)
            self.placed.add((self._sid, k))

    # -- charts and diagrams (deck-graphics slices 4-7) -----------------------------------------------------------------------------
    def _g_title(self, s, w, sizes=(36, 32, 30, 28), lines=3) -> tuple:
        """The title as a v3 layout sets it at the top of the content: ``(paras, height)`` at the largest size that takes at most ``lines``."""
        p = self.p
        for tsize in sizes:
            tp = [self.para(s["title"], tsize, p.fg, self.th.head, bold=True, line=1.05)]
            if self.nlines(glue(s["title"]), w, tsize, True, self.th.head) <= lines:
                return tp, self.ph(tp, w)
        raise NoFit("the title does not fit")

    def _g_notes(self, bl, w, size) -> tuple:
        """The note lines under a diagram (its text, small and statement blocks, in order): ``(paras, height)``."""
        ps = [self.para(self._text_of(b), size, self.p.fg if b["kind"] != "small" else self.p.mute, line=1.2, after=4)
              for b in bl if b["kind"] in ("text", "small", "statement") and self._text_of(b)]
        return ps, (self.ph(ps, w) if ps else 0.0)

    def _named(self, shape, name):
        if shape is not None:
            shape.name = name
        return shape

    def _lay_process_chevrons(self, sl, s):
        """process_chevrons (deck-graphics slice 6): the title, then the steps as a row of native chevrons (the first ink-filled, the rest
        outlined on the panel), each step's label inside its chevron and its line under it, an icon above each when every step's label
        names a different one, the note at the foot. Every word is the steps block's own; the block is drawn once. NoFit under 3 or over 6
        steps, or when a label needs more than two lines or the lines do not fit at 12 pt (the ladder then takes timeline_rows)."""
        from . import graphics   # noqa: PLC0415
        items = graphics.steps_of(s["blocks"])
        if items is None or not graphics.PROCESS_MIN <= len(items) <= graphics.PROCESS_MAX:
            raise NoFit("process chevrons hold 3 to 6 steps")
        p, g = self.p, self.th.grid
        top, bottom, W_ = self.V3_TOP, g.body_end, self.x1 - self.x0
        tp, th_ = self._g_title(s, W_ * 0.8)
        n = len(items)
        gap = 0.06
        cw = (W_ - gap * (n - 1)) / n
        chev_h = 1.05
        lw = cw * 0.66
        icon = self._icon_ids([it[0] for it in items])
        ih = (graphics.ICON_STEP_IN + 0.2) if icon else 0.0
        fit = None
        for lsize in (20, 18, 16, 14):
            if not all(self.nlines(glue(it[0]), lw, lsize, True, self.th.head) <= 2 and self._units_fit(it[0], lw, lsize) for it in items):
                continue
            for bsize in (20, 18, 16, 14, 13, 12):
                texts = [[self.para(" ".join(c for c in it[1:] if c), bsize, p.fg, line=1.2)] if any(it[1:]) else [] for it in items]
                hs = [self.ph(t, cw - 0.12) if t else 0.0 for t in texts]
                notes, nh = self._g_notes(s["blocks"], W_, max(12, bsize - 2))
                need = th_ + 0.55 + ih + chev_h + 0.25 + max(hs) + (nh + 0.35 if nh else 0)
                if need <= bottom - top:
                    fit = (lsize, texts, hs, notes, nh, need)
                    break
            if fit:
                break
        if not fit:
            raise NoFit("the steps do not fit their chevrons")
        lsize, texts, hs, notes, nh, need = fit
        if sl is None:
            return
        self.band(sl, s)
        m = self._mark(sl)
        self.ptext(sl, self.x0, top + 0.15, W_ * 0.8, th_, tp, name="Title")
        self._build(sl, m, title=True)
        y = top + 0.15 + th_ + 0.55 + max(0.0, (bottom - top - need) * 0.5)
        m = self._mark(sl)
        for i, it in enumerate(items):
            x = self.x0 + i * (cw + gap)
            if icon:
                self._icon(sl, icon[i], x + 0.1, y, graphics.ICON_STEP_IN)
            cy = y + ih
            first = i == 0
            shp = sl.shapes.add_shape(MSO_SHAPE.PENTAGON if first else MSO_SHAPE.CHEVRON, *self._g(x, cy, cw + (0.18 if i < n - 1 else 0), chev_h))
            st = shp._element.find(qn("p:style"))
            if st is not None:
                shp._element.remove(st)
            shp.fill.solid()
            shp.fill.fore_color.rgb = _rgb(self.th.ink if first else self.th.panel)
            shp.line.color.rgb = _rgb(self.th.ink)
            shp.line.width = Pt(0.75)
            shp.name = "Diagram: process"
            lp = [self.para(it[0], lsize, self.th.on_dark if first else self.th.ink, self.th.head, bold=True, line=1.0, align="c")]
            lh = self.ph(lp, lw)
            self.ptext(sl, x + (cw - lw) / 2 + (0.0 if first else 0.12), cy + (chev_h - lh) / 2, lw, lh, lp, name="slot:steps")
            if texts[i]:
                self.ptext(sl, x + 0.06, cy + chev_h + 0.25, cw - 0.12, hs[i], texts[i], name="slot:steps")
        self._build(sl, m)
        self._rec_slot(sl, "steps")
        if notes:
            m = self._mark(sl)
            self.hairline(sl, self.x0, bottom - nh - 0.2, self.x1, bottom - nh - 0.2)
            self.ptext(sl, self.x0, bottom - nh - 0.05, W_, nh, notes, name="slot:note")
            self._build(sl, m)
            self._rec_slot(sl, "note")

    def _lay_timeline_strip(self, sl, s):
        """timeline_strip: under spec.GRAPHICS (slice 6) one hairline with a node per phase, EQUALLY spaced (no date is plotted to scale),
        the phase above its node and its time below; else the standard composition, as before."""
        from . import layouts as _L   # noqa: PLC0415
        if not spec.GRAPHICS or not _L.timed_3_8(s, s["blocks"]):
            return self._lay_stack(sl, s)
        from . import graphics   # noqa: PLC0415
        items = graphics.steps_of(s["blocks"])
        j = 1 if all(len(it) > 1 and graphics.is_time(it[1]) for it in items) else 0
        p, g = self.p, self.th.grid
        top, bottom, W_ = self.V3_TOP, g.body_end, self.x1 - self.x0
        tp, th_ = self._g_title(s, W_ * 0.8)
        n = len(items)
        cw = W_ / n
        fit = None
        for size in (28, 26, 24, 22, 20, 18, 16, 14, 13, 12):
            labs = [[self.para(" ".join(c for k, c in enumerate(it) if k != j and c), size, p.fg, self.th.head, bold=True, line=1.05, align="c")] for it in items]
            times = [[self.para(it[j], max(12, size - 2), p.fg, line=1.1, align="c")] for it in items]
            if not all(self._units_fit(" ".join(c for k, c in enumerate(it) if k != j), cw - 0.15, size) for it in items):
                continue
            ah = max(self.ph(x, cw - 0.15) for x in labs)
            bh = max(self.ph(x, cw - 0.15) for x in times)
            notes, nh = self._g_notes(s["blocks"], W_, max(12, size - 2))
            need = th_ + 0.6 + ah + 0.25 + 0.3 + 0.2 + bh + (nh + 0.35 if nh else 0)
            if need <= bottom - top:
                fit = (labs, times, ah, bh, notes, nh, need)
                break
        if not fit:
            raise NoFit("the phases do not fit the strip")
        labs, times, ah, bh, notes, nh, need = fit
        if sl is None:
            return
        self.band(sl, s)
        m = self._mark(sl)
        self.ptext(sl, self.x0, top + 0.15, W_ * 0.8, th_, tp, name="Title")
        self._build(sl, m, title=True)
        y = top + 0.15 + th_ + 0.6 + max(0.0, (bottom - top - need) * 0.5)
        ly = y + ah + 0.25 + 0.15
        m = self._mark(sl)
        self.hairline(sl, self.x0 + cw / 2, ly, self.x1 - cw / 2, ly, name="Diagram: timeline")
        for i in range(n):
            cx = self.x0 + cw * (i + 0.5)
            self.ptext(sl, cx - (cw - 0.15) / 2, y, cw - 0.15, ah, labs[i], anchor="bottom", name="slot:steps")
            node = sl.shapes.add_shape(MSO_SHAPE.OVAL, *self._gk(cx - 0.11, ly - 0.11, 0.22, 0.22))
            stl = node._element.find(qn("p:style"))
            if stl is not None:
                node._element.remove(stl)
            node.fill.solid()
            node.fill.fore_color.rgb = _rgb(self.th.ink if i == 0 else self.th.paper)
            node.line.color.rgb = _rgb(self.th.ink)
            node.line.width = Pt(1.5)
            node.name = "Diagram: timeline"
            self.ptext(sl, cx - (cw - 0.15) / 2, ly + 0.3, cw - 0.15, bh, times[i], name="slot:steps")
        self._build(sl, m)
        self._rec_slot(sl, "steps")
        if notes:
            m = self._mark(sl)
            self.ptext(sl, self.x0, bottom - nh - 0.05, W_, nh, notes, name="slot:note")
            self._build(sl, m)
            self._rec_slot(sl, "note")

    def _lay_journey(self, sl, s):
        """journey_row (slice 7): the stages as outlined pills on one connector line, the channel (the third cell) as a kicker under each
        with its icon when every channel names a different one, and the stage's line under that. Words: the steps block's own."""
        from . import graphics   # noqa: PLC0415
        items = graphics.steps_of(s["blocks"])
        if items is None or not graphics.JOURNEY_MIN <= len(items) <= graphics.JOURNEY_MAX or not all(len(it) >= 3 for it in items):
            raise NoFit("a journey holds 3 to 5 stages with a channel each")
        p, g = self.p, self.th.grid
        top, bottom, W_ = self.V3_TOP, g.body_end, self.x1 - self.x0
        tp, th_ = self._g_title(s, W_ * 0.8)
        n = len(items)
        cw = W_ / n
        pw, ph_ = cw * 0.78, 0.62
        icon = self._icon_ids([it[2] for it in items])
        ih = (graphics.ICON_STEP_IN + 0.12) if icon else 0.0
        fit = None
        for size in (20, 18, 16, 14, 13, 12):
            if not all(self.nlines(glue(it[0]), pw - 0.2, size, True, self.th.head) <= 1 for it in items):
                continue
            body = [[self._kick(it[2]), self.para(" ".join(c for c in [it[1]] + it[3:] if c), size, p.fg, line=1.2)] for it in items]
            hs = [self.ph(b, cw - 0.2) for b in body]
            notes, nh = self._g_notes(s["blocks"], W_, max(12, size - 2))
            need = th_ + 0.6 + ph_ + 0.3 + ih + max(hs) + (nh + 0.35 if nh else 0)
            if need <= bottom - top:
                fit = (size, body, hs, notes, nh, need)
                break
        if not fit:
            raise NoFit("the stages do not fit the row")
        size, body, hs, notes, nh, need = fit
        if sl is None:
            return
        self.band(sl, s)
        m = self._mark(sl)
        self.ptext(sl, self.x0, top + 0.15, W_ * 0.8, th_, tp, name="Title")
        self._build(sl, m, title=True)
        y = top + 0.15 + th_ + 0.6 + max(0.0, (bottom - top - need) * 0.35)
        m = self._mark(sl)
        self.hairline(sl, self.x0 + cw / 2, y + ph_ / 2, self.x1 - cw / 2, y + ph_ / 2, name="Diagram: journey")
        for i, it in enumerate(items):
            cx = self.x0 + cw * (i + 0.5)
            pill = sl.shapes.add_shape(MSO_SHAPE.ROUNDED_RECTANGLE, *self._g(cx - pw / 2, y, pw, ph_))
            stl = pill._element.find(qn("p:style"))
            if stl is not None:
                pill._element.remove(stl)
            pill.adjustments[0] = 0.5
            pill.fill.solid()
            pill.fill.fore_color.rgb = _rgb(self.th.paper)
            pill.line.color.rgb = _rgb(self.th.ink)
            pill.line.width = Pt(1.25)
            pill.name = "Diagram: journey"
            lp = [self.para(it[0], size, p.fg, self.th.head, bold=True, align="c")]
            self.ptext(sl, cx - pw / 2 + 0.1, y, pw - 0.2, ph_, lp, anchor="middle", name="slot:stages")
            yy = y + ph_ + 0.3
            if icon:
                self._icon(sl, icon[i], cx - (cw - 0.2) / 2, yy, graphics.ICON_STEP_IN)
            self.ptext(sl, cx - (cw - 0.2) / 2, yy + ih, cw - 0.2, hs[i], body[i], name="slot:stages")
        self._build(sl, m)
        self._rec_slot(sl, "stages")
        if notes:
            m = self._mark(sl)
            self.ptext(sl, self.x0, bottom - nh - 0.05, W_, nh, notes, name="slot:note")
            self._build(sl, m)
            self._rec_slot(sl, "note")

    def _lay_matrix(self, sl, s):
        """matrix_2x2 (slice 7): two sourced axes crossing (hairlines), each axis's low and high at its ends and its label at the high end,
        the items LISTED inside their quadrants (nothing at a coordinate: a dot's position is a number nobody sourced)."""
        from . import graphics   # noqa: PLC0415
        tb = next((b for b in s["blocks"] if b["kind"] == "table" and graphics.matrix_ok(b)), None)
        if tb is None:
            raise NoFit("no sourced two-axis table")
        mx = tb["matrix"]
        p, g = self.p, self.th.grid
        top, bottom, W_ = self.V3_TOP, g.body_end, self.x1 - self.x0
        tp, th_ = self._g_title(s, W_ * 0.8)
        notes_w = self._span(4)
        bx0 = self.x0 + 0.9
        bw = W_ - notes_w - 1.2
        y0 = top + 0.15 + th_ + 0.55
        bh = bottom - y0 - 0.55
        if bh < 2.6:
            raise NoFit("no room for the matrix")
        qw, qh = bw / 2 - 0.25, bh / 2 - 0.25
        cells = {k: [str(x) for x in mx["cells"].get(k) or []] for k in graphics.MATRIX_CELLS}
        fit = None
        for size in (18, 16, 14, 13, 12):
            qp = {k: [self.para(x, size, p.fg, line=1.15, after=4) for x in v] for k, v in cells.items()}
            if all(self.ph(v, qw) <= qh for v in qp.values() if v):
                fit = (size, qp)
                break
        if not fit:
            raise NoFit("the quadrants are too full")
        size, qp = fit
        notes, nh = self._g_notes(s["blocks"], notes_w - 0.2, 14)
        if nh > bh:
            raise NoFit("the note is too long")
        if sl is None:
            return
        self.band(sl, s)
        m = self._mark(sl)
        self.ptext(sl, self.x0, top + 0.15, W_ * 0.8, th_, tp, name="Title")
        self._build(sl, m, title=True)
        m = self._mark(sl)
        cx, cy = bx0 + bw / 2, y0 + bh / 2
        self.hairline(sl, bx0, cy, bx0 + bw, cy, name="Diagram: matrix", pt=1.25)
        self.hairline(sl, cx, y0, cx, y0 + bh, name="Diagram: matrix", pt=1.25)
        x, y = mx["x"], mx["y"]
        cap = lambda t, al="l": [self.para(str(t), 12, p.mute, bold=True, cap=True, align=al)]   # noqa: E731
        self.ptext(sl, bx0, cy + 0.06, 1.6, 0.3, cap(x["low"]), name="slot:matrix")
        self.ptext(sl, bx0 + bw - 2.4, cy + 0.06, 2.4, 0.3, cap(f"{x['high']} · {x['label']}", "r"), name="slot:matrix")
        self.ptext(sl, cx + 0.08, y0 - 0.32, 3.0, 0.3, cap(f"{y['high']} · {y['label']}"), name="slot:matrix")
        self.ptext(sl, cx + 0.08, y0 + bh + 0.04, 3.0, 0.3, cap(y["low"]), name="slot:matrix")
        pos = {"lh": (bx0 + 0.1, y0 + 0.1), "hh": (cx + 0.15, y0 + 0.1), "ll": (bx0 + 0.1, cy + 0.4), "hl": (cx + 0.15, cy + 0.4)}
        for k, (qx, qy) in pos.items():
            if qp[k]:
                self.ptext(sl, qx, qy, qw, self.ph(qp[k], qw), qp[k], name="slot:matrix")
        self._build(sl, m)
        self._rec_slot(sl, "matrix")
        if notes:
            m = self._mark(sl)
            self.ptext(sl, self.x1 - notes_w + 0.2, y0, notes_w - 0.2, nh, notes, name="slot:note")
            self._build(sl, m)
            self._rec_slot(sl, "note")

    def _lay_grid_points(self, sl, s):
        """grid_points (the deferred deck-look layout, built here so icons can land on it): 3 to 6 headed points in columns (3 across, 4 as
        2 x 2), a hairline over each, an icon above each heading when every heading names a different one. Words: the blocks' own."""
        from . import graphics, layouts as _L   # noqa: PLC0415
        pts = _L.statement_points(s["blocks"])
        if pts is None or not 3 <= len(pts) <= 6 or not all(x["heading"] for x in pts):
            raise NoFit("grid points hold 3 to 6 headed points")
        p, g = self.p, self.th.grid
        top, bottom, W_ = self.V3_TOP, g.body_end, self.x1 - self.x0
        tp, th_ = self._g_title(s, W_ * 0.8)
        n = len(pts)
        cols = 2 if n == 4 else 3
        rows = -(-n // cols)
        G = g.G
        cw = (W_ - G * (cols - 1)) / cols
        icon = self._icon_ids([x["heading"] for x in pts])
        ih = (graphics.ICON_POINT_IN + graphics.ICON_GAP_IN) if icon else 0.0
        fit = None
        for bsize in (22, 20, 18, 16, 14, 13, 12):
            cells = [[self.para(x["heading"], max(16, bsize + 2), p.fg, self.th.head, bold=True, line=1.05, after=6),
                      self.para(x["text"], bsize, p.fg, italic=x["italic"], line=1.2)] for x in pts]
            hs = [self.ph(c, cw) + ih for c in cells]
            rh = [max(hs[r * cols:(r + 1) * cols]) for r in range(rows)]
            need = th_ + 0.55 + sum(h + 0.45 for h in rh)
            if need <= bottom - top and all(self._units_fit(x["heading"], cw, max(16, bsize + 2)) for x in pts):
                fit = (cells, hs, rh, need)
                break
        if not fit:
            raise NoFit("the points do not fit the grid")
        cells, hs, rh, need = fit
        if sl is None:
            return
        self.band(sl, s)
        m = self._mark(sl)
        self.ptext(sl, self.x0, top + 0.15, W_ * 0.8, th_, tp, name="Title")
        self._build(sl, m, title=True)
        y = top + 0.15 + th_ + 0.55 + max(0.0, (bottom - top - need) * 0.5)
        for r in range(rows):
            for c in range(cols):
                i = r * cols + c
                if i >= n:
                    break
                x = self.x0 + c * (cw + G)
                m = self._mark(sl)
                self.hairline(sl, x, y, x + cw, y)
                if icon:
                    self._icon(sl, icon[i], x, y + 0.2, graphics.ICON_POINT_IN)
                self.ptext(sl, x, y + 0.2 + ih, cw, hs[i] - ih, cells[i], name="slot:points")
                self._build(sl, m)
            y += rh[r] + 0.45
        self._rec_slot(sl, "points")

    def _g_chart(self, sl, x, y, w, h, form, points, hero, title):
        """One native chart part (slices 4-5): bar (horizontal, ranked as given), column (periods), line (4 or more periods) or a 100%
        stacked bar (a stated whole's parts). Values from the ledger by ref, never computed; the value axis from zero and hidden (every mark
        is labelled), no gridlines, no legend for one series, labels in text tokens, marks per graphics.chart_marks, alt text naming every
        label and value. The embedded workbook keeps the data editable."""
        from . import graphics   # noqa: PLC0415
        t_ = self.th
        cd = CategoryChartData()
        order = list(reversed(points)) if form == "bar" else list(points)
        if form == "segmented":
            cd.categories = [title or ""]
            for pt in points:
                cd.add_series(pt["label"], [graphics.plot_value(pt)])
        else:
            cd.categories = [pt["label"] for pt in order]
            cd.add_series(title or "", [graphics.plot_value(pt) for pt in order])
        kind = {"bar": XL_CHART_TYPE.BAR_CLUSTERED, "column": XL_CHART_TYPE.COLUMN_CLUSTERED, "line": XL_CHART_TYPE.LINE_MARKERS,
                "segmented": XL_CHART_TYPE.BAR_STACKED_100}[form]
        gf = sl.shapes.add_chart(kind, *self._g(x, y, w, h), cd)
        gf.name = "Chart"
        gf._element.nvGraphicFramePr.cNvPr.set("descr", (title + ": " if title else "") + "; ".join(f"{pt['label']} {pt['shown']}" for pt in points))
        ch = gf.chart
        ch.has_title = False
        ch.has_legend = form == "segmented"
        if ch.has_legend:
            ch.legend.include_in_layout = False
            ch.legend.font.size, ch.legend.font.name = Pt(self.sz(14)), t_.body
            ch.legend.font.color.rgb = _rgb(t_.ink)
        plot = ch.plots[0]
        cols = graphics.chart_marks(form, order, hero, t_)
        fmt_ = graphics.number_format(points[0]["unit"])
        def label(pt, text, colour, pos):   # the ledger's own display ('45%', '€12,000'), never an Excel number format of the value
            dl_ = pt.data_label
            dl_.has_text_frame = True
            dl_.text_frame.text = text
            if pos is not None:
                dl_.position = pos
            dl_.font.size, dl_.font.name, dl_.font.bold = Pt(self.sz(14)), t_.body, True
            dl_.font.color.rgb = _rgb(colour)
        if form != "line":
            plot.gap_width = 80
            if form == "segmented":
                for i, (ser, pt_) in enumerate(zip(plot.series, points)):
                    fill = cols[i]   # graphics.chart_marks: ink steps, each 3:1 or better on the paper
                    ser.format.fill.solid()
                    ser.format.fill.fore_color.rgb = _rgb(fill)
                    ink = "FFFFFF" if themes.contrast("FFFFFF", fill) >= themes.contrast(t_.ink, fill) else t_.ink
                    label(ser.points[0], pt_["shown"], ink, XL_LABEL_POSITION.CENTER)
            else:
                ser = plot.series[0]
                for i, (c, pt_) in enumerate(zip(cols, order)):
                    pt = ser.points[i]
                    pt.format.fill.solid()
                    pt.format.fill.fore_color.rgb = _rgb(c)
                    label(pt, pt_["shown"], t_.ink, XL_LABEL_POSITION.OUTSIDE_END)
        else:
            ser = plot.series[0]
            ser.format.line.color.rgb = _rgb(t_.ink)
            ser.format.line.width = Pt(2)
            ser.smooth = False
            label(ser.points[len(order) - 1], order[-1]["shown"], t_.ink, XL_LABEL_POSITION.ABOVE)
        va = ch.value_axis
        va.has_major_gridlines = False
        va.visible = form == "line"
        if form in ("bar", "column"):
            va.minimum_scale = 0
        if form == "line":
            va.tick_labels.font.size, va.tick_labels.font.name = Pt(self.sz(12)), t_.body
            va.tick_labels.font.color.rgb = _rgb(t_.mute)
            va.format.line.fill.background()
            va.tick_labels.number_format, va.tick_labels.number_format_is_linked = fmt_, False
        ca = ch.category_axis
        ca.tick_labels.font.size, ca.tick_labels.font.name = Pt(self.sz(14)), t_.body
        ca.tick_labels.font.color.rgb = _rgb(t_.ink)
        ca.format.line.color.rgb = _rgb(t_.ink)
        if form == "segmented":
            ca.visible = False
        return gf

    def _lay_chart_g(self, sl, s, full=False):
        """chart / chart_full under spec.GRAPHICS (slice 4): the title (the claim) across the top, the plot in 7 (chart) or 8 (chart_full)
        of 12 columns, its commentary (1 to 3 points) between hairlines in the rest, the source line directly under the plot. The plot is
        never under graphics.CHART_MIN_PLOT_IN: the commentary shrinks first, then the fit ladder switches layout. No source line: no chart."""
        from . import graphics   # noqa: PLC0415
        ch = next((b for b in s["blocks"] if b["kind"] == "chart"), None)
        if ch is None:
            raise NoFit("no chart")
        if self.inp is None:   # the plan measures without the ledger: assemble's chart pass already kept only drawable charts
            got = {"form": "bar", "points": [{"label": x.get("label", "")} for x in ch["chart"].get("series") or []]}
            src = graphics.SOURCE_LABEL + " source"
        else:
            got = graphics.chart_form(ch["chart"], self.inp, self.R)
            if got["form"] not in graphics.CHART_FORMS:
                raise NoFit(f"not a chart: {got['why']}")
            src = graphics.source_line(got["points"], self.inp)
            if not src:
                raise NoFit("no source label for a chart point: no chart")
        rest = [b for b in s["blocks"] if b["kind"] != "chart" and (self._text_of(b) or b.get("items"))]
        p, g = self.p, self.th.grid
        top, bottom, W_ = self.V3_TOP, g.body_end, self.x1 - self.x0
        tp, th_ = self._g_title(s, W_ * 0.85)
        pw = self._span(8 if full else 7)
        rx = self.x0 + pw + g.G
        rw = self.x1 - rx
        sp = [self.para(src, self.th.scale.caption, p.mute, cap=True)]
        sh = self.ph(sp, pw)
        plot_h = bottom - (top + 0.15 + th_ + 0.4) - sh - 0.1
        if plot_h < graphics.CHART_MIN_PLOT_IN:
            raise NoFit("the plot would be under its floor")
        groups = None
        for bsize in (22, 20, 18, 16, 14):
            gs = self._aside_groups(rest, bsize, rw) if rest else []
            if sum(h for _, h in gs) + 0.5 * max(0, len(gs) - 1) <= plot_h + sh:
                groups = gs
                break
        if groups is None:
            raise NoFit("the commentary does not fit beside the chart")
        if sl is None:
            return
        self.band(sl, s)
        m = self._mark(sl)
        self.ptext(sl, self.x0, top + 0.15, W_ * 0.85, th_, tp, name="Title")
        self._build(sl, m, title=True)
        y = top + 0.15 + th_ + 0.4
        m = self._mark(sl)
        if self.inp is None:   # the hole probe's scratch slide: the plot's box as ink
            self.rect(sl, self.x0, y, pw, plot_h, fill=self.th.panel, name="Chart")
        else:
            self._g_chart(sl, self.x0, y, pw, plot_h, got["form"], got["points"], ch["chart"].get("hero"), ch["chart"].get("title") or "")
        self.ptext(sl, self.x0, y + plot_h + 0.1, pw, sh, sp, name="ChartSource")
        self._build(sl, m, "wipe")
        self._rec_slot(sl, "chart")
        if groups:
            self.hairline(sl, rx - g.G / 2, y, rx - g.G / 2, y + plot_h + sh)
            gy = y
            for i, (ps, h) in enumerate(groups):
                m = self._mark(sl)
                if i:
                    self.hairline(sl, rx, gy + 0.25, self.x1, gy + 0.25)
                    gy += 0.5
                self.ptext(sl, rx, gy, rw, h, ps, name="slot:commentary")
                self._build(sl, m)
                gy += h
            self._rec_slot(sl, "commentary")

    def _with_width(self, x0, x1, fn):
        """Run ``fn`` with the content area narrowed to ``x0..x1`` (the footer is drawn by the caller after, at the full width)."""
        saved = (self.x0, self.x1)
        self.x0, self.x1 = x0, x1
        try:
            return fn()
        finally:
            self.x0, self.x1 = saved

    def _lay_image_text(self, sl, s, mirror=False):
        """Image and text: the title and a short body on one side, one large picture panel on the other (4:3 slot, cropped to its box). The
        panel runs from the top edge to the footer rule and bleeds off the side, so the picture has a real share of the slide."""
        g = self.th.grid
        pw = 5.4
        if "picture" not in self._pics:
            raise NoFit("no picture")
        px = self.x0 if mirror else self.x1 - pw
        tx0, tx1 = (px + pw + 0.55, self.x1) if mirror else (self.x0, px - 0.55)
        blocks = [b for b in s["blocks"] if b["kind"] in ("text", "statement", "small", "bullets", "callout", "card") and (self._text_of(b) or b.get("items"))]
        if len(blocks) != len([b for b in s["blocks"] if self._text_of(b) or b.get("items")]):
            raise NoFit("image text holds text and bullets only")

        def run(draw):
            def body():
                for dense in (False, True):
                    try:
                        y = self.head(None, s, dense)
                        self.stack(None, blocks, self.x0, y, self.x1 - self.x0, g.body_end, fill=True)
                    except NoFit:
                        continue
                    if not draw:
                        return True
                    y = self.head(sl, s, dense)
                    self.stack(sl, blocks, self.x0, y, self.x1 - self.x0, g.body_end, fill=True)
                    return True
                raise NoFit("image text slide too dense")
            return self._with_width(tx0, tx1, body)
        run(sl is not None)
        label = {"idea": "THE IDEA", "real_question": "THE REAL QUESTION"}.get(s["type"])
        if label and sl is not None and not self._band_drawn:   # the kicker label an emphasis bar sets over its title, kept when the idea takes a picture panel (the band carries it under deck-look)
            S, p = self.th.scale, self.p
            self.ptext(sl, tx0 + 0.65, g.top - 0.05, 4.0, 0.25, [self.para(label, S.caption, p.acc_t, bold=True, track=1.2, cap=True)])
        self._own_picture(sl, "picture", px, self.PIC_TOP, pw, self.PIC_H)

    def _lay_image_left(self, sl, s):
        """Image and text, mirrored: the picture panel on the left."""
        self._lay_image_text(sl, s, mirror=True)

    def _lay_full_bleed(self, sl, s):
        """Full bleed statement: the picture fills the slide above the footer, the title and one statement are set on a dark scrim over it
        (under deck-look: on the zone the finder measured, under the solved scrim, ``_lay_bleed``)."""
        if self.th.v3:
            return self._lay_bleed(sl, s, cover=False)
        S, p, g = self.th.scale, self.p, self.th.grid
        if "picture" not in self._pics:
            raise NoFit("no picture")
        blocks = [b for b in s["blocks"] if self._text_of(b)]
        if any(b["kind"] not in ("statement", "text", "small") for b in blocks):
            raise NoFit("full bleed holds a statement")
        w = 8.4
        for size in (40, 36, 32, 28):
            tp = [self.para(s["title"], size, "FFFFFF", self.th.head, bold=True, line=1.0, after=10)]
            bp = [self.para(self._text_of(b), S.lead, "FFFFFF", line=1.1, after=8) for b in blocks]
            h = self.ph(tp, w - 0.8) + self.ph(bp, w - 0.8) + 0.8
            if h <= 4.6:
                break
        else:
            raise NoFit("statement too long for the picture")
        if sl is None:
            self._own_picture(None, "picture", 0, 0, 1, 1)
            return
        self._own_picture(sl, "picture", 0, 0, themes.Grid().W, 6.85)
        y = 6.85 - 0.5 - h
        m = self._mark(sl)
        self._scrim(sl, self.x0 - 0.4, y, w, h, p.inv if p.dark else "1B2430", 0.78)
        self.ptext(sl, self.x0, y + 0.4, w - 0.8, h - 0.8, tp, name="Title")
        self.ptext(sl, self.x0, y + 0.4 + self.ph(tp, w - 0.8), w - 0.8, self.ph(bp, w - 0.8), bp)
        self._build(sl, m, title=True)

    def _lay_cover_image(self, sl, s):
        """Cover with a picture: the title at display size set against a large picture panel that bleeds off the right edge (under
        deck-look: a full-height picture column, ``_lay_cover_column``)."""
        if self.th.v3:
            return self._lay_cover_column(sl, s)
        self._lay_cover(sl, s, panel=True)

    def _lay_section(self, sl, s):
        """Section break: the title large on a dark slide with an optional picture panel on the right."""
        self._lay_cover(sl, s, panel="picture" in self._pics)

    def _lay_image_grid(self, sl, s):
        """Image grid: two to four pictures in a row of squares with their captions beneath."""
        g = self.th.grid
        slots = [n for n in sorted(self._pics) if n.startswith("picture_")]
        if len(slots) < 2:
            raise NoFit("image grid needs two pictures")
        caps = [self._text_of(b) if b["kind"] == "small" else None for b in s["blocks"]]
        rest = [b for b in s["blocks"] if b["kind"] not in ("bullets", "small")]
        if rest:
            raise NoFit("image grid holds captions only")
        y = self.head(None, s, False)
        n = len(slots)
        cw = (self.x1 - self.x0 - g.G * (n - 1)) / n
        side = min(cw, g.body_end - y - 0.6)
        if side < 1.5:
            raise NoFit("no room for the pictures")
        if sl is None:
            return
        y = self.head(sl, s, False)
        for i, n_ in enumerate(slots):
            self._own_picture(sl, n_, self.x0 + i * (cw + g.G), y, side, side)

    def _two_col(self, sl, s, left_pred, frac=0.42, balance=False):
        """Title on top, the blocks ``left_pred`` takes in a text column on the left (48-character lines), the rest as cards on the right."""
        g = self.th.grid
        left = [b for b in s["blocks"] if left_pred(b)]
        right = [b for b in s["blocks"] if not left_pred(b)]
        if balance and left and not right and len(left) >= 2:   # everything is of the left kind: share the blocks between two columns
            half = (len(left) + 1) // 2
            left, right, frac = left[:half], left[half:], 0.5
        elif balance and len(left) == 1 and not right and len(left[0].get("items") or []) >= 2:   # one block: its items go half and half
            its, b0 = left[0]["items"], left[0]
            half = (len(its) + 1) // 2
            left, right, frac = [{**b0, "items": its[:half]}], [{**b0, "items": its[half:]}], 0.5
        if not left or not right:
            raise NoFit("two columns need blocks for both")
        lw = (self.x1 - self.x0 - g.G) * frac
        xr = self.x0 + lw + g.G
        wr = self.x1 - xr
        if self._cv is not None:   # deck-slide-size (Fable fix 3): the layout's own minimum text column, else the switch rung takes it
            mn = spec.MIN_COLUMN_IN.get(self._lid or "", spec.MIN_COLUMN_DEFAULT)
            self.min_column(lw, mn, f"{self._lid} left column")
            self.min_column(wr, mn, f"{self._lid} right column")
        for dense in (False, True):
            try:
                y = self.head(None, s, dense)
                self.stack(None, left, self.x0, y, lw, g.body_end)
                self.stack(None, right, xr, y, wr, g.body_end, fill=True)
            except NoFit:
                continue
            if sl is None:
                return
            y = self.head(sl, s, dense)
            self.stack(sl, left, self.x0, y, lw, g.body_end)
            self.stack(sl, right, xr, y, wr, g.body_end, fill=True)
            return
        raise NoFit("two columns too dense")

    def _lay_cards_split(self, sl, s):
        """Cards split: the lead text in a column on the left, the points, pairs, figures, steps or table as cards on the right."""
        self._two_col(sl, s, lambda b: b["kind"] in self.LEAD_KINDS)

    def _lay_placeholder_split(self, sl, s):
        """Placeholder split: the rows a person must supply on the left (dashed, PROPOSED, TO SUPPLY), what is given as solid cards on the right."""
        self._two_col(sl, s, lambda b: b["kind"] == "bullets" and any(isinstance(i, dict) and i.get("human") for i in b["items"]), 0.55, balance=True)

    def _lay_text_columns(self, sl, s):
        """Text columns: two to four open columns of text, an accent rule above each, no card fill (an open, typographic look)."""
        S, p, g = self.th.scale, self.p, self.th.grid
        cols = []
        bl = [b for b in s["blocks"] if self._text_of(b) or b.get("items")]
        if len(bl) == 1 and bl[0]["kind"] == "bullets" and 2 <= len(bl[0]["items"]) <= 6:
            cols = [[(_item_text(i), False)] for i in bl[0]["items"]]
        else:
            for b in bl:
                if b["kind"] == "bullets":
                    cols.append([(_item_text(i), True) for i in b["items"]])
                elif b["kind"] in ("text", "card", "small", "statement", "callout"):
                    cols.append([(self._text_of(b), False)])
                else:
                    raise NoFit("text columns hold text, cards and bullets")
        if not 2 <= len(cols) <= 6:
            raise NoFit("text columns need two to six columns")
        per = min(len(cols), 3)
        rows = [cols[i:i + per] for i in range(0, len(cols), per)]
        cw = (self.x1 - self.x0 - g.G * 1.6 * (per - 1)) / per
        for dense in (False, True):
            try:
                y = self.head(None, s, dense)
            except NoFit:
                continue
            for size in (18, 17, 16, 15, 14, 13, 12):
                hs = [[self.ph([self.para(t, size, None, bullet=bu, after=6) for t, bu in c], cw) for c in r] for r in rows]
                tot = sum(max(h) + 0.4 for h in hs)
                if y + tot <= g.body_end:
                    break
            else:
                continue
            if sl is None:
                return
            y = self.head(sl, s, dense)
            for r, rh in zip(rows, hs):
                m = self._mark(sl)
                for k, c in enumerate(r):
                    x = self.x0 + k * (cw + g.G * 1.6)
                    self.rect(sl, x, y, 0.5, 0.05, fill=p.acc_l)
                    self.ptext(sl, x, y + 0.2, cw, max(rh), [self.para(t, size, None, bullet=bu, after=6) for t, bu in c], name="slot:columns")
                self._build(sl, m)
                y += max(rh) + 0.4
            return
        raise NoFit("text columns too dense")

    def _lay_big_statement(self, sl, s):
        """Big statement: the title, then one statement set large in a 48-character measure, a line of support beneath."""
        S, p, g = self.th.scale, self.p, self.th.grid
        items = []   # (kind, text): a thin table or one-step timeline (layouts.thin_blocks) is its statement and its support lines
        for b in s["blocks"]:
            if b["kind"] in ("table", "steps"):
                tb = layouts.thin_blocks(b)
                if tb is None:
                    raise NoFit("big statement holds a statement")
                items += [("statement", tb[0]), *[("text", x) for x in tb[1]]]
            elif self._text_of(b):
                if b["kind"] not in ("statement", "text", "small"):
                    raise NoFit("big statement holds a statement")
                items.append((b["kind"], self._text_of(b)))
        if not items:
            raise NoFit("big statement holds a statement")
        main, rest = items[0], items[1:]
        for dense in (False, True):
            try:
                y = self.head(None, s, dense)
            except NoFit:
                continue
            for size in (36, 32, 30, 28, 26, 24):
                w = min(self.x1 - self.x0 - 0.35, self._cpl_w(size, False, self.th.head))   # the box starts 0.35 in in (the accent bar): it keeps the right margin
                sp = [self.para(main[1], size, p.fg, self.th.head, line=1.1)]
                su = [self.para(t_, S.body, p.mute, after=6) for _k, t_ in rest]
                h = self.ph(sp, w) + (0.3 + self.ph(su, min(self.x1 - self.x0, self._cpl_w(S.body))) if su else 0)
                if y + 0.3 + h <= g.body_end:
                    break
            else:
                continue
            if sl is None:
                return
            y = self.head(sl, s, dense)
            m = self._mark(sl)
            if h < 0.40 * (g.body_end - y):   # a sparse slide (the statement fills under about 40% of the body) sits at the middle, not under the title
                y += (g.body_end - y - (0.3 + h)) / 2
            self.rect(sl, self.x0, y + 0.3, 0.09, self.ph(sp, w), fill=p.acc_l)
            self.ptext(sl, self.x0 + 0.35, y + 0.3, w, self.ph(sp, w), sp, name="slot:statement")
            if su:
                self.ptext(sl, self.x0 + 0.35, y + 0.6 + self.ph(sp, w), min(self.x1 - self.x0, self._cpl_w(S.body)), self.ph(su, self._cpl_w(S.body)), su, name="slot:support")
            self._build(sl, m)
            return
        raise NoFit("big statement too long")

    def _lay_quote_full(self, sl, s):
        """Quote full: the quote set large and italic in a 48-character measure under the title, its source and a note beneath."""
        S, p, g = self.th.scale, self.p, self.th.grid
        bl = [b for b in s["blocks"] if self._text_of(b)]
        q = next((b for b in bl if b["kind"] == "quote"), None)
        if q is None or any(b["kind"] not in ("quote", "small", "text") for b in bl):
            raise NoFit("quote full holds a quote")
        rest = [b for b in bl if b is not q]
        for dense in (False, True):
            try:
                y = self.head(None, s, dense)
            except NoFit:
                continue
            for size in (34, 30, 28, 26, 24, 22):
                w = min(self.x1 - self.x0, self._cpl_w(size, False, self.th.head))
                qp = [self.para(self._text_of(q), size, p.fg, self.th.head, italic=True, line=1.1)]
                rp = [self.para(self._text_of(b), S.small, p.mute, after=6) for b in rest]
                h = self.ph(qp, w) + (0.3 + self.ph(rp, w) if rp else 0)
                if y + 0.3 + h <= g.body_end:
                    break
            else:
                continue
            if sl is None:
                return
            y = self.head(sl, s, dense)
            m = self._mark(sl)
            self.rect(sl, self.x0, y + 0.3, 0.09, self.ph(qp, w), fill=p.acc_l)
            self.ptext(sl, self.x0 + 0.35, y + 0.3, w, self.ph(qp, w), qp, name="slot:quote")
            if rp:
                self.ptext(sl, self.x0 + 0.35, y + 0.6 + self.ph(qp, w), w, self.ph(rp, w), rp, name="slot:source")
            self._build(sl, m)
            return
        raise NoFit("quote too long")

    def _lay_chart_full(self, sl, s):
        """Chart full: the chart across the width, its commentary as cards beneath."""
        if spec.GRAPHICS and self.th.v3:   # deck-graphics slice 4: plot in 8 columns, commentary in 4, the source line under the plot
            return self._lay_chart_g(sl, s, full=True)
        g = self.th.grid
        ch = next((b for b in s["blocks"] if b["kind"] == "chart"), None)
        rest = [b for b in s["blocks"] if b["kind"] != "chart"]
        if ch is None:
            raise NoFit("no chart")
        for dense in (False, True):
            try:
                y = self.head(None, s, dense)
                ch_h = 2.7 if rest else g.body_end - y
                if g.body_end - y < 2.6:
                    raise NoFit("no room")
                if rest:
                    self.stack(None, rest, self.x0, y + ch_h + 0.2, self.x1 - self.x0, g.body_end)
            except NoFit:
                continue
            if sl is None:
                return
            y = self.head(sl, s, dense)
            m = self._mark(sl)
            self.chart(sl, self.x0, y, self.x1 - self.x0, ch_h, ch["chart"]["series"], ch["chart"].get("title"), hero=ch["chart"].get("hero"))
            self._build(sl, m, "wipe")
            if rest:
                self.stack(sl, rest, self.x0, y + ch_h + 0.2, self.x1 - self.x0, g.body_end)
            return
        raise NoFit("chart too dense")

    def _lay_timeline_rows(self, sl, s):
        """Timeline rows: the steps as rows (a marker, a label and a line), the standard composition with its steps set as role rows."""
        if not any(b["kind"] == "steps" for b in s["blocks"]):
            raise NoFit("no steps")
        self._lay_stack(sl, s, role=True)

    def _lay_execution_stack(self, sl, s):
        """Execution stack: the copy in its dark frame across the top, the role and notes beneath in two columns."""
        S, p, g = self.th.scale, self.p, self.th.grid
        cp = next((b for b in s["blocks"] if b["kind"] == "copy"), None)
        if cp is None:
            raise NoFit("no copy block")
        rest = [b for b in s["blocks"] if b["kind"] != "copy"]
        half = max(1, (len(rest) + 1) // 2)
        cols = [rest[:half], rest[half:]] if len(rest) > 1 else [rest, []]
        cw = (self.x1 - self.x0 - g.G) / 2
        GAP = 0.3
        for dense in (False, True):
            try:
                y = self.head(None, s, dense)
                ans = [self.para(cp["answer"], S.body, p.inv_acc, bold=True)]
                fw = self.x1 - self.x0 - 0.8
                size = self.fit(lambda sz_: [self.para(l_, sz_, p.inv_fg, self.th.head, line=1.1, after=6) for l_ in cp["lines"]], fw, 2.0, 24, 12)
                lines = [self.para(l_, size, p.inv_fg, self.th.head, line=1.1, after=6) for l_ in cp["lines"]]
                fh = self.ph(lines, fw) + self.ph(ans, fw) + GAP + 0.6
                ty = y + fh + 0.25
                for k, c in enumerate(cols):
                    if c:
                        self.stack(None, c, self.x0 + k * (cw + g.G), ty, cw, g.body_end, fill=False)
            except NoFit:
                continue
            if sl is None:
                return
            y = self.head(sl, s, dense)
            m = self._mark(sl)
            self.rect(sl, self.x0, y, self.x1 - self.x0, fh, fill=p.inv)
            self.rect(sl, self.x0, y, 0.09, fh, fill=p.acc_l)
            self.ptext(sl, self.x0 + 0.4, y + 0.3, fw, self.ph(lines, fw), lines)
            self.ptext(sl, self.x0 + 0.4, y + 0.3 + self.ph(lines, fw) + GAP, fw, self.ph(ans, fw), ans)
            self._build(sl, m)
            for k, c in enumerate(cols):
                if c:
                    self.stack(sl, c, self.x0 + k * (cw + g.G), ty, cw, g.body_end, fill=False)
            return
        raise NoFit("execution too dense")

    def _lay_territory_wide(self, sl, s):
        """Territory wide: the thought and sketch on top, the reasons as cards across the width (the narrow variant skipped)."""
        self._lay_territory(sl, s, wide_only=True)

    def _lay_people_cards(self, sl, s):
        """People cards: each person (or role) a card with a heading and a short line, two or three to a row. A photo only when one is
        supplied, never generated (none is drawn here)."""
        S, p, g = self.th.scale, self.p, self.th.grid
        people = []
        for b in s["blocks"]:
            if b["kind"] in ("steps", "kv"):
                people += [(str(i[0]), str(i[1]) if len(i) > 1 else "") for i in b["items"]]
            elif b["kind"] == "bullets":
                people += [("", _item_text(i)) for i in b["items"]]
            elif b["kind"] == "card":
                people.append((str(b.get("title") or ""), self._text_of(b)))
            elif self._text_of(b):
                raise NoFit("people cards hold people")
        if not 2 <= len(people) <= 6:
            raise NoFit("people cards need two to six people")
        cols = 2 if len(people) == 4 else min(3, len(people))
        cw = (self.x1 - self.x0 - g.G * (cols - 1)) / cols
        rows = [people[i:i + cols] for i in range(0, len(people), cols)]
        for dense in (False, True):
            try:
                y = self.head(None, s, dense)
            except NoFit:
                continue
            for sc in (1.0, 0.92, 0.85, 0.78):
                def card(h_, b_):
                    ps = ([self.para(h_, S.body * sc, p.card_fg, bold=True, after=4)] if h_ else []) + [self.para(b_, S.small * sc, p.card_fg, line=1.05)]
                    return ps, self.ph(ps, cw - 0.5) + 0.5
                hs = [[card(h_, b_)[1] for h_, b_ in r] for r in rows]
                tot = sum(max(h) for h in hs) + 0.25 * (len(rows) - 1)
                if y + tot <= g.body_end:
                    break
            else:
                continue
            if sl is None:
                return
            y = self.head(sl, s, dense)
            for r, rh in zip(rows, hs):
                m = self._mark(sl)
                for k, (h_, b_) in enumerate(r):
                    x = self.x0 + k * (cw + g.G)
                    self.rect(sl, x, y, cw, max(rh), fill=p.card, name="slot:people")
                    self.rect(sl, x, y, 0.07, max(rh), fill=p.acc_l, name="slot:people")
                    self.ptext(sl, x + 0.3, y + 0.25, cw - 0.5, max(rh) - 0.4, card(h_, b_)[0], name="slot:people")
                self._build(sl, m)
                y += max(rh) + 0.25
            return
        raise NoFit("people cards too dense")

    def _lay_close(self, sl, s):
        """Close: dark, the title at display size, one statement and up to three next steps as rows. No contact line: nothing in the deck
        supplies one. Under deck-look the reworked close (``_lay_close_v3``)."""
        if self.th.v3:
            return self._lay_close_v3(sl, s)
        S, p, g = self.th.scale, self.p, self.th.grid
        bl = [b for b in s["blocks"] if self._text_of(b) or b.get("items")]
        lead = [b for b in bl if b["kind"] in ("statement", "text", "small")]
        steps = [(i_ if isinstance(i_, str) else (_item_text(i_) if isinstance(i_, dict) else ": ".join(str(z) for z in i_))) for b in bl if b["kind"] in ("bullets", "kv") for i_ in b["items"]]
        steps += [self._text_of(b) for b in bl if b["kind"] == "card"]
        if any(b["kind"] not in ("statement", "text", "small", "bullets", "kv", "card") for b in bl) or len(steps) > 3:
            raise NoFit("close holds a statement and up to three next steps")
        w = self.x1 - self.x0
        for size in (54, 48, 44, 40, 36):
            n = self.nlines(s["title"], w, size, True, self.th.head)
            if n <= 3:
                break
        else:
            raise NoFit("title too long")
        th_ = n * size * 1.2 / 72 + 0.04
        lp = [self.para(self._text_of(b), S.lead, p.fg, line=1.1, after=8) for b in lead]
        lw = min(w, self._cpl_w(S.lead))
        lh = self.ph(lp, lw) if lp else 0.0
        rows = [self.para(t, S.body, p.fg, line=1.05) for t in steps]
        rw = min(w - 0.5, self._cpl_w(S.body))
        rh = [self.ph([r], rw) + 0.28 for r in rows]
        total = th_ + 0.35 + lh + (0.35 if rows else 0) + sum(rh)
        if total > g.body_end - 1.5:
            raise NoFit("close too full")
        if sl is None:
            return
        y = max(1.5, (g.body_end + 1.0 - total) / 2 - 0.2)
        m = self._mark(sl)
        self._mark_above_title(sl, s, p.acc_l, band=False)
        self.ptext(sl, self.x0, y, w, th_, [self.para(s["title"], size, p.fg, self.th.head, bold=True, line=1.0)], name="Title")
        self._build(sl, m, title=True)
        y += th_ + 0.35
        if lp:
            m = self._mark(sl)
            self.ptext(sl, self.x0, y, lw, lh, lp, name="slot:statement")
            self._build(sl, m)
            y += lh + 0.35
        for r, h in zip(rows, rh):
            m = self._mark(sl)
            self.rect(sl, self.x0, y, 0.07, h - 0.2, fill=p.acc_l, name="slot:next")
            self.ptext(sl, self.x0 + 0.3, y, rw, h - 0.2, [r], name="slot:next")
            self._build(sl, m)
            y += h

    # -- deck-look steps 3-4 (spec.LOOK_V3): the statement layouts, the picture column, the reworked cover and close ----------------
    #: Content top under the band (its lower rule sits at 0.84 in), the text inset from a frame hairline, the hero ladder, the picture
    #: column (3/8 of the 13.333 in slide, floor 4.0 in: full height, bleeding top, bottom and its side) and the stop line's marks.
    V3_TOP, V3_PAD = 1.15, 0.2
    HERO_SIZES = (54, 48, 44, 40, 36)
    PIC_COL = max(4.0, W * 3 / 8)
    STOP_DOT, STOP_PT, STOP_STROKE = 0.17, 3.8, 1.5

    def _span(self, n: int, x0=None, x1=None) -> float:
        """The width of ``n`` of 12 columns on the content width ``x0..x1`` (gutter ``Grid.G`` between columns): design.grid."""
        x0 = self.x0 if x0 is None else x0
        x1 = self.x1 if x1 is None else x1
        G = self.th.grid.G
        return n * (x1 - x0 - 11 * G) / 12 + (n - 1) * G

    def _kick(self, text, size=13) -> dict:
        """A kicker (a slot label such as 'The target', 'From', 'Why they will believe it'): sentence case, Source Sans 3 bold, in accent ink
        (the light accent on a dark slide). Never tracked capitals (Q12)."""
        t = self.th
        return self.para(text, size, t.accent_on_dark if self.p.dark else t.accent_ink, bold=True, cap=True, after=3)

    def _hero(self, text, w, sizes=None, max_lines=3, color=None) -> tuple:
        """``(paras, height, size)`` for a hero statement in ``w`` inches: the largest size of the ladder at which it takes at most
        ``max_lines`` lines. Set in capitals (by the font, the words unchanged) only when it is short (``layouts.caps_ok``, about 40
        characters) and takes two lines at most; sentence case otherwise (Q10). NoFit when even the smallest size is too long."""
        mw = w * 0.95   # measured a little narrower than the box: a display line never breaks inside its last (glued) word
        for size in sizes or self.HERO_SIZES:
            caps = layouts.caps_ok(text) and self.nlines(glue(text), mw, size, True, self.th.head, True) <= 2 and self._units_fit(text, mw, size, True)
            if self.nlines(glue(text), mw, size, True, self.th.head, caps) <= max_lines and self._units_fit(text, mw, size, caps):
                ps = [self.para(text, size, color or self.p.fg, self.th.head, bold=True, line=0.95, allcaps=caps)]
                return ps, self.ph(ps, w), size
        raise NoFit("hero statement too long")

    def _units_fit(self, text, w, size, caps=False, bold=True, font=None) -> bool:
        """Every unbreakable unit of ``text`` (a word, or the last two words ``glue`` joins) fits one line of ``w`` inches at ``size``: a
        display line must never break inside a word."""
        per = self._kx(w) * 72 / (size * self._wf(bold, font or self.th.head, caps))
        return all(len(u) <= per for u in glue(str(text)).split(" "))

    def _frame(self, sl, xs, top, bottom):
        """Vertical hairlines at ``xs`` from ``top`` to ``bottom`` (the content frame and its column rules: open at top and bottom)."""
        for x in xs:
            self.hairline(sl, x, top, x, bottom, name="Hairline")

    def _rec_slot(self, sl, slot):
        """Record a slot this layout drew by hand for layouts.json (``{name, slot, blocks}``, the blocks the plan bound to it)."""
        if sl is not None and sl is self._cur:
            bis = sorted({bi for (sn, bi) in self._slotmap.values() if sn == slot})
            self._shapes_now.append({"name": f"slot:{slot}", "slot": slot, "blocks": bis})

    def _stack_paras(self, sl, x, y, w, groups, name):
        """Draw paragraph groups one under another from ``y`` (each ``(paras, gap after)``); returns the y below the last."""
        for ps, gap in groups:
            h = self.ph(ps, w)
            self.ptext(sl, x, y, w, h, ps, name=name)
            y += h + gap
        return y

    def _lay_statement_points(self, sl, s):
        """statement_points (G2): the title in a 5/12 column, with the target figure (ink) and its date under it on an objective; two or
        three points stacked in the 7/12 column, hairlines between them with equal space each side (the leftover height split evenly, never
        more than 0.6 in; a short list is centred). Content frame and a column rule in hairlines. NoFit for fewer than two points or more
        than three (another layout is picked: never padded), or when the words do not fit at 14 pt."""
        S, p, g = self.th.scale, self.p, self.th.grid
        pts = layouts.statement_points(s["blocks"])
        if pts is None or not 2 <= len(pts) <= 3:
            raise NoFit("statement points hold two or three points")
        facts = _objective_facts([x["text"] for x in pts]) if s["type"] == "objective" else None
        top, bottom, pad = self.V3_TOP, g.body_end, self.V3_PAD
        lw = self._span(5)
        rx = self.x0 + lw + g.G
        ltw, rtw = lw - pad - 0.15, self.x1 - rx - 2 * pad
        avail = bottom - top - 0.3
        fig = []
        if facts:
            vs = 110
            while vs > 48 and (self.nlines(facts["target"], ltw, vs, True, self.th.head) > 1 or not self._units_fit(facts["target"], ltw, vs)):
                vs -= 4
            fig = [([self._kick("The target")], 0.02), ([self.para(facts["target"], vs, p.fg, self.th.head, bold=True, line=0.9)], 0.2)]
            for lab, key in (("Baseline", "baseline"), ("By when", "date")):
                if facts.get(key):
                    fig += [([self._kick(lab)], 0.02),
                            ([self.para(facts[key], 30, p.fg, self.th.head, bold=True, line=1.0, allcaps=layouts.caps_ok(facts[key]))], 0.15)]
            fig[-1] = (fig[-1][0], 0.0)
        elif len(pts) >= 2:   # no figure (an insight, an audience): the first point anchors the left column's foot, so the title's column
            first, pts = pts[0], pts[1:]   # is not a hole (phase 13 s04); a quote stays italic with its Illustrative caption under it
            for fs in (30, 28, 26, 24, 22, 20, 18):
                ps = ([self._kick(first["heading"])] if first["heading"] else []) + \
                     [self.para(first["text"], fs, p.fg, self.th.head if not first["italic"] else None, bold=not first["italic"], italic=first["italic"], line=1.15)]
                if first["caption"]:
                    ps.append(self.para(first["caption"], S.body_floor, p.mute))
                if self.ph(ps, ltw) <= avail * 0.45 and self._units_fit(first["text"], ltw, fs, bold=not first["italic"], font=None if not first["italic"] else self.th.body):
                    break
            else:
                raise NoFit("the anchor point is too long for the title's column")
            fig = [(ps, 0.0)]
        fh = sum(self.ph(ps, ltw) + gap for ps, gap in fig)
        for tsize in (36, 32, 30, 28):
            tp = [self.para(s["title"], tsize, p.fg, self.th.head, bold=True, line=1.05)]
            th_ = self.ph(tp, ltw)
            if self.nlines(glue(s["title"]), ltw, tsize, True, self.th.head) <= 4 and th_ + (0.4 + fh if fig else 0) <= avail:
                break
        else:
            raise NoFit("title and figure do not fit the column")
        for bsize in (26, 24, 22, 20, 18, 16, 14):   # short points are set large (a lead), long ones step down to the body sizes
            groups = []
            for pt in pts:
                ps = []
                if pt["heading"]:
                    ps.append(self.para(pt["heading"], max(16, bsize - 2), p.fg, self.th.head, bold=True, after=4))
                ps.append(self.para(pt["text"], bsize, p.fg, italic=pt["italic"], line=1.2))
                if pt["caption"]:
                    ps.append(self.para(pt["caption"], S.body_floor, p.mute))
                groups.append(ps)
            hs = [self.ph(ps, rtw) for ps in groups]
            if sum(hs) + 2 * (len(hs) - 1) * 0.25 <= avail:
                break
        else:
            raise NoFit("points too long for the column")
        icon, ih, anchor = None, 0.0, bool(fig) and not facts
        if self._icons_on:   # deck-graphics: an icon above each point's words (the anchor's too), at the SAME sizes; else none
            from . import graphics   # noqa: PLC0415
            heads = graphics.point_headings(s["blocks"])
            icon = self._icon_ids(heads) if len(heads) == len(pts) + (1 if anchor else 0) else None
            if icon:
                ih = graphics.ICON_POINT_IN + graphics.ICON_GAP_IN
                n = len(hs)
                right_ok = sum(hs) + n * ih + 2 * (n - 1) * 0.25 <= avail
                left_ok = not anchor or th_ + 0.4 + fh + ih <= avail
                if right_ok and left_ok:
                    hs = [h + ih for h in hs]
                else:
                    icon, ih = None, 0.0
        gap = min(0.6, max(0.25, (avail - sum(hs)) / (2 * (len(hs) - 1)))) if len(hs) > 1 else 0.0
        total = sum(hs) + 2 * (len(hs) - 1) * gap
        if sl is None:
            return
        self.band(sl, s)
        m = self._mark(sl)
        self._frame(sl, (self.x0, self.x0 + lw + g.G / 2, self.x1), top, bottom)
        self.ptext(sl, self.x0 + pad, top + 0.15, ltw, th_, tp, name="Title")
        self._build(sl, m, title=True)
        if fig:
            m = self._mark(sl)
            if icon and anchor:
                self._icon(sl, icon[0], self.x0 + pad, bottom - 0.15 - fh - ih, graphics.ICON_POINT_IN)
            self._stack_paras(sl, self.x0 + pad, bottom - 0.15 - fh, ltw, fig, "slot:figure")
            self._build(sl, m)
            self._rec_slot(sl, "figure")
        y = top + 0.15 + (avail - total) / 2
        for i, (ps, h) in enumerate(zip(groups, hs)):
            m = self._mark(sl)
            if i:
                self.hairline(sl, rx + pad, y + gap, self.x1 - pad, y + gap)
                y += 2 * gap
            if icon:
                self._icon(sl, icon[i + (1 if anchor else 0)], rx + pad, y, graphics.ICON_POINT_IN)
            self.ptext(sl, rx + pad, y + ih, rtw, h - ih, ps, name="slot:points")
            self._build(sl, m)
            y += h
        self._rec_slot(sl, "points")

    def _lay_reframe(self, sl, s):
        """reframe (G3): the question as a hero line across the content frame (capitals only when short), the supporting line under it,
        and at the foot a hairline and a row of one or two labelled notes (7/12 + 5/12, a column rule between). NoFit when it does not fit."""
        S, p, g = self.th.scale, self.p, self.th.grid
        top, bottom, pad = self.V3_TOP, g.body_end, self.V3_PAD
        bl = [b for b in s["blocks"] if self._text_of(b) or b.get("items")]
        line = [b for b in bl if b["kind"] in ("statement", "text")]
        notes = []
        for b in bl:
            if b["kind"] == "kv":
                notes += [(str(k).strip(), str(v).strip()) for k, v in b["items"]]
            elif b["kind"] == "small":
                notes.append(("", self._text_of(b)))
            elif b["kind"] not in ("statement", "text"):
                raise NoFit("reframe holds a statement, a line and labelled notes")
        if not line or len(notes) > 2:
            raise NoFit("reframe needs a line and at most two notes")
        w = self.x1 - self.x0 - 2 * pad
        cws = ([self._span(7) - pad - 0.15, self._span(5) - pad] if len(notes) == 2 else [self._span(8) - pad])[:len(notes)]
        rowh, ngroups = 0.0, []
        for nsize in (18, 16, 14):
            ngroups = [([self._kick(k)] if k else []) + [self.para(v, nsize, p.fg, line=1.25)] for k, v in notes]
            rowh = max([self.ph(ps, cw) for ps, cw in zip(ngroups, cws)] or [0.0])
            if rowh <= 1.6:
                break
        else:
            raise NoFit("notes too long")
        row_top = bottom - 0.15 - rowh - 0.3 if notes else bottom
        avail = row_top - top - 0.4
        for lsize in (24, 22, 20):
            lp = [self.para(self._text_of(b), lsize, p.fg, line=1.2, after=6) for b in line]
            lh = self.ph(lp, min(w, self._cpl_w(lsize, cpl=60)))
            try:
                hp, hh, _ = self._hero(s["title"], w, max_lines=3)
            except NoFit:
                raise
            if hh + 0.35 + lh <= avail:
                break
            for size in self.HERO_SIZES[1:]:
                hp, hh, _ = self._hero(s["title"], w, sizes=(size,) + tuple(z for z in self.HERO_SIZES if z < size), max_lines=3)
                if hh + 0.35 + lh <= avail:
                    break
            if hh + 0.35 + lh <= avail:
                break
        else:
            raise NoFit("reframe too full")
        if sl is None:
            return
        self.band(sl, s)
        m = self._mark(sl)
        self._frame(sl, (self.x0, self.x1), top, bottom)
        y = top + max(0.35, (avail - hh - 0.35 - lh) * 0.5)
        self.ptext(sl, self.x0 + pad, y, w, hh, hp, name="Title")
        self._build(sl, m, title=True)
        m = self._mark(sl)
        self.ptext(sl, self.x0 + pad, y + hh + 0.35, min(w, self._cpl_w(lp[0]["size"], cpl=60)), lh, lp, name="slot:line")
        self._build(sl, m)
        self._rec_slot(sl, "line")
        if notes:
            m = self._mark(sl)
            self.hairline(sl, self.x0 + pad, row_top, self.x1 - pad, row_top)
            xs = [self.x0 + pad, self.x0 + self._span(7) + g.G + 0.05]
            for i, (ps, cw) in enumerate(zip(ngroups, cws)):
                self.ptext(sl, xs[i], row_top + 0.3, cw, self.ph(ps, cw), ps, name="slot:notes_row")
            if len(notes) == 2:
                self._frame(sl, (self.x0 + self._span(7) + g.G / 2,), row_top + 0.3, bottom - 0.15)
            self._build(sl, m)
            self._rec_slot(sl, "notes_row")

    def _lay_shift_line(self, sl, s):
        """shift_line (G4 stops): the single thought as a hero line, a two-stop line (an open ink dot for from, a filled accent dot for to: the
        slide's one accent mark), from and to in two 6/12 columns under it (from in mute, to in ink; capitals only when short), a sourced
        support line under from when there is one, and the reasons to believe under a hairline at the foot."""
        S, p, g = self.th.scale, self.p, self.th.grid
        top, bottom, pad = self.V3_TOP, g.body_end, self.V3_PAD
        bl = [b for b in s["blocks"] if self._text_of(b) or b.get("items") or b["kind"] == "fromto"]
        ft = [b for b in bl if b["kind"] == "fromto"]
        support = [b for b in bl if b["kind"] in ("text", "small")]
        rtb = [b for b in bl if b["kind"] == "bullets"]
        if len(ft) != 1 or any(b["kind"] not in ("fromto", "text", "small", "bullets") for b in bl):
            raise NoFit("shift line holds one from-to, a support line and reasons to believe")
        f, t_ = str(ft[0].get("from", "")).strip(), str(ft[0].get("to", "")).strip()
        w = self.x1 - self.x0 - 2 * pad
        half = self._span(6)
        lx, cw = self.x0 + pad, half - pad - 0.15
        rx = self.x0 + half + g.G + 0.05
        rw = self.x1 - pad - rx
        items = [_item_text(i).strip() for b in rtb for i in b["items"] if _item_text(i).strip()]
        if len(items) > 3:
            raise NoFit("at most three reasons to believe")
        kick_rtb = next((str(b.get("title") or "").strip() for b in rtb if b.get("title")), "")
        for bsize in (20, 18, 16):
            rp = ([self._kick(kick_rtb)] if kick_rtb else []) + [self.para(x, bsize, p.fg, line=1.2, after=4) for x in items]
            rh = self.ph(rp, w) if items else 0.0
            sp = [self.para(self._text_of(b), bsize - 2, p.fg, line=1.25) for b in support]
            sh = self.ph(sp, cw) if sp else 0.0
            fit = None
            for hs in self.HERO_SIZES:
                for vs in (40, 36, 32, 28):
                    hp, hh, _ = self._hero(s["title"], w, sizes=(hs,) + tuple(z for z in self.HERO_SIZES if z < hs), max_lines=3)
                    vals = []
                    for txt, col, cwid in ((f, p.mute, cw), (t_, p.fg, rw)):
                        caps = layouts.caps_ok(txt) and self.nlines(glue(txt), cwid, vs, True, self.th.head, True) <= 2 and self._units_fit(txt, cwid, vs, True)
                        vals.append([self.para(txt, vs, col, self.th.head, bold=True, line=0.95, allcaps=caps)])
                    if not (self._units_fit(f, cw, vs) and self._units_fit(t_, rw, vs)):
                        continue
                    kh = self.ph([self._kick("From")], cw)
                    colh = kh + max(self.ph(vals[0], cw) + (0.2 + sh if sp else 0), self.ph(vals[1], rw))
                    total = hh + 0.45 + self.STOP_DOT + 0.3 + colh + (0.45 + rh if items else 0)
                    if total <= bottom - top - 0.3:
                        fit = (hp, hh, vals, kh, colh, total)
                        break
                if fit:
                    break
            if fit:
                break
        else:
            raise NoFit("shift line too full")
        hp, hh, vals, kh, colh, total = fit
        if sl is None:
            return
        self.band(sl, s)
        m = self._mark(sl)
        self._frame(sl, (self.x0, self.x1), top, bottom)
        y = top + 0.3
        self.ptext(sl, lx, y, w, hh, hp, name="Title")
        self._build(sl, m, title=True)
        y += hh + 0.45
        m = self._mark(sl)
        d = self.STOP_DOT
        ya = y + d / 2
        xa, xb = lx + d / 2, self.x1 - pad - d / 2
        self.hairline(sl, xa + d / 2, ya, xb - d / 2, ya, color=p.fg, name="StopLine", pt=self.STOP_PT)
        a = self.rect(sl, xa - d / 2, y, d, d, fill=p.bg, line=p.fg, lw=self.STOP_STROKE, shape=MSO_SHAPE.OVAL, name="StopFrom")
        b_ = self.rect(sl, xb - d / 2, y, d, d, fill=self.th.accent_on_dark if p.dark else self.th.accent, shape=MSO_SHAPE.OVAL, name="StopTo")
        y += d + 0.3
        self.ptext(sl, lx, y, cw, kh, [self.para("From", 13, p.mute, bold=True, cap=True)], name="slot:pair")
        self.ptext(sl, rx, y, rw, kh, [self._kick("To")], name="slot:pair")
        vh0, vh1 = self.ph(vals[0], cw), self.ph(vals[1], rw)
        self.ptext(sl, lx, y + kh, cw, vh0, vals[0], name="slot:pair")
        self.ptext(sl, rx, y + kh, rw, vh1, vals[1], name="slot:pair")
        self._frame(sl, (self.x0 + half + g.G / 2,), y, y + colh)
        self._build(sl, m)
        self._rec_slot(sl, "pair")
        if sp:
            m = self._mark(sl)
            self.ptext(sl, lx, y + kh + vh0 + 0.2, cw, sh, sp, name="slot:support")
            self._build(sl, m)
            self._rec_slot(sl, "support")
        if items:
            m = self._mark(sl)
            yr = bottom - 0.15 - rh
            self.hairline(sl, lx, yr - 0.25, self.x1 - pad, yr - 0.25)
            self.ptext(sl, lx, yr, w, rh, rp, name="slot:rtb")
            self._build(sl, m)
            self._rec_slot(sl, "rtb")

    def _pic_box(self, side):
        """``(picture x, text x0, text x1)`` for a picture column on ``side`` (the text column starts one margin from its edge)."""
        M, pw = self.th.grid.M, self.PIC_COL
        return (0.0, pw + M, W - M) if side == "left" else (W - pw, M, W - pw - M)

    def _aside_groups(self, bl, size, w) -> list:
        """The paragraph groups of a rows_aside column (deck-look step 5), one per block, in order: a block's own title (the absorbed slide's
        title, or its list heading) as the kicker; bullets and kv items, a text line, ad copy (lines in the display face, the answer as its
        kicker after) at ``size``. The words are the blocks' own."""
        p, out = self.p, []
        for b in bl:
            ps = [self._kick(str(b["title"]).strip())] if str(b.get("title") or "").strip() else []
            k = b["kind"]
            if k == "bullets":
                ps += [self.para(_item_text(i).strip(), size, p.fg, line=1.2, after=6) for i in b.get("items") or [] if _item_text(i).strip()]
            elif k == "kv":
                for kk, v in b.get("items") or []:
                    ps += [self._kick(str(kk).strip()), self.para(str(v).strip(), size, p.fg, line=1.2, after=6)]
            elif k == "copy":
                ps += [self.para(str(x), size + 4, p.fg, self.th.head, bold=True, line=1.05, after=4) for x in b.get("lines") or []]
                if b.get("answer"):
                    ps.append(self._kick(str(b["answer"])))
            elif self._text_of(b):
                small = k == "small"
                ps.append(self.para(self._text_of(b), self.th.scale.small if small else size, p.mute if small else p.fg, line=1.2))
            if ps:
                out.append((ps, self.ph(ps, w)))
        return out

    def _lay_rows_aside(self, sl, s):
        """rows_aside (deck-look step 5, the merged slides 'how it runs' and 'how we will know'): the kept slide's title at the top of a
        7/12 column and its table under it as hairline rows (the header row as kickers, the first cell of a row in the display face); the
        absorbed slide's blocks in the 5/12 column beside it, centred, a hairline between blocks. Content frame and column rule in
        hairlines. NoFit when the words do not fit at 14 pt (the fit ladder then switches to an alternative: no point moves to the notes)."""
        S, p, g = self.th.scale, self.p, self.th.grid
        bl = [b for b in s["blocks"] if self._text_of(b) or b.get("items") or b.get("lines") or b.get("rows")]
        tables = [b for b in bl if b["kind"] == "table"]
        if not layouts.rows_aside(s, bl):
            raise NoFit("rows_aside holds one table and the blocks beside it")
        rows = [[str(c).strip() for c in r] for r in tables[0]["rows"]]
        head, body = rows[0], rows[1:]
        aside = [b for b in bl if b is not tables[0]]
        if self.th.v3 and len(body) == 1:   # one measure: a stat row under the title, the absorbed blocks at the foot (no empty middle)
            return self._rows_aside_one(sl, s, head, body[0], aside)
        top, bottom, pad = self.V3_TOP, g.body_end, self.V3_PAD
        lw = self._span(7)
        rx = self.x0 + lw + g.G
        ltw, rtw = lw - pad - 0.15, self.x1 - rx - 2 * pad
        avail = bottom - top - 0.3
        nc = len(head)
        cw0 = ltw * (0.4 if nc > 2 else 0.45)
        cws = [cw0] + [(ltw - cw0 - 0.2 * (nc - 1)) / (nc - 1)] * (nc - 1)
        fit = None
        for tsize in (36, 32, 30, 28):
            tp = [self.para(s["title"], tsize, p.fg, self.th.head, bold=True, line=1.05)]
            th_ = self.ph(tp, ltw)
            if self.nlines(glue(s["title"]), ltw, tsize, True, self.th.head) > 3:
                continue
            for bsize in (28, 26, 24, 22, 20, 18, 16, 14):
                hk = [[self._kick(h)] for h in head]
                hh = max(self.ph(x, w) for x, w in zip(hk, cws))
                cells = [[[self.para(c, bsize + 2, p.fg, self.th.head, bold=True, line=1.05)] if j == 0 else [self.para(c, bsize - 2, p.fg, line=1.2)]
                          for j, c in enumerate(r)] for r in body]
                if not all(self._units_fit(r[0], cws[0] * 0.95, bsize + 2) and all(self._units_fit(c, cws[j] * 0.95, bsize - 2, bold=False, font=self.th.body)
                                                                                   for j, c in enumerate(r) if j) for r in body):
                    continue   # no word may break inside itself in a narrow cell
                rhs = [max(self.ph(x, w) for x, w in zip(cr, cws)) for cr in cells]
                rows_h = hh + 0.15 + sum(h + 0.4 for h in rhs)
                groups = self._aside_groups(aside, bsize, rtw)
                gh = sum(h for _, h in groups) + 0.5 * (len(groups) - 1)
                if th_ + 0.45 + rows_h <= avail and gh <= avail:
                    fit = (tp, th_, hk, hh, cells, rhs, rows_h, groups, gh)
                    fit_b = bsize
                    break
            if fit:
                break
        if not fit:
            raise NoFit("rows and aside too full")
        tp, th_, hk, hh, cells, rhs, rows_h, groups, gh = fit
        icon, gut = None, 0.0
        if self._icons_on:   # deck-graphics: a row icon in front of each first cell, at the SAME type size (text never shrinks for an icon)
            from . import graphics   # noqa: PLC0415
            icon = self._icon_ids(graphics.row_headings(s, body))
            if icon:
                gut = graphics.ICON_ROW_IN + graphics.ICON_GAP_IN
                w0 = cws[0] - gut
                if w0 > 0.6 and all(self._units_fit(r[0], w0 * 0.95, fit_b + 2) for r in body):
                    rhs_i = [max([self.ph(cr[0], w0)] + [self.ph(x, w) for x, w in zip(cr[1:], cws[1:])]) for cr in cells]
                    rows_i = hh + 0.15 + sum(h + 0.4 for h in rhs_i)
                    if th_ + 0.45 + rows_i <= avail:
                        rhs, rows_h = rhs_i, rows_i
                    else:
                        icon = None
                else:
                    icon = None
        if sl is None:
            return
        self.band(sl, s)
        m = self._mark(sl)
        self._frame(sl, (self.x0, self.x0 + lw + g.G / 2, self.x1), top, bottom)
        self.ptext(sl, self.x0 + pad, top + 0.15, ltw, th_, tp, name="Title")
        self._build(sl, m, title=True)
        free = avail - th_ - rows_h
        y = top + 0.15 + th_ + max(0.45, free / 2)   # the rows sit in the middle of what the title leaves
        m = self._mark(sl)
        xs = [self.x0 + pad]
        for w in cws[:-1]:
            xs.append(xs[-1] + w + 0.2)
        for x, w, ps in zip(xs, cws, hk):
            self.ptext(sl, x, y, w, hh, ps, name="slot:rows")
        y += hh + 0.15
        for ri, (cr, h) in enumerate(zip(cells, rhs)):
            self.hairline(sl, self.x0 + pad, y, self.x0 + pad + ltw, y)
            for j, (x, w, ps) in enumerate(zip(xs, cws, cr)):
                if j == 0 and icon:   # the icon sits on the first line of the row's first cell; the cell moves right by the gutter
                    size = graphics.ICON_ROW_IN
                    lh = (fit_b + 2) * 1.05 / 72
                    self._icon(sl, icon[ri], x, y + 0.2 + max(0.0, (lh - size) / 2), size)
                    x, w = x + gut, w - gut
                self.ptext(sl, x, y + 0.2, w, h, ps, name="slot:rows")
            y += h + 0.4
        self._build(sl, m)
        self._rec_slot(sl, "rows")
        y = top + 0.15 + (avail - gh) / 2
        for i, (ps, h) in enumerate(groups):
            m = self._mark(sl)
            if i:
                self.hairline(sl, rx + pad, y + 0.25, self.x1 - pad, y + 0.25)
                y += 0.5
            self.ptext(sl, rx + pad, y, rtw, h, ps, name="slot:aside")
            self._build(sl, m)
            y += h
        self._rec_slot(sl, "aside")

    # -- the stat row (rea-full A1): figures on hairlines, label above, value in ink, source below --------------------------------------
    STAT_SIZES = (96, 84, 72, 64, 56, 48, 44, 40, 36, 32, 28, 26, 24)

    def _stat_fit(self, cols, w, max_lines=1, sizes=None):
        """``(size, [paras per column], height)`` for a stat row of ``cols`` [(label, value, source)] across ``w`` inches: the largest size
        of the ladder at which every value takes at most ``max_lines`` lines of its column without breaking a word. NoFit when none does."""
        n = len(cols)
        G = self.th.grid.G
        cw = (w - G * (n - 1)) / n - 0.1
        p = self.p
        for vs in sizes or self.STAT_SIZES:
            if not all(self.nlines(glue(v), cw * 0.95, vs, True, self.th.head) <= max_lines and self._units_fit(v, cw * 0.95, vs) for _, v, _ in cols):
                continue
            paras = []
            for lab, v, src in cols:
                ps = ([self.para(lab, 16, p.fg, bold=True, after=4)] if lab else []) + [self.para(v, vs, p.fg, self.th.head, bold=True, line=0.95, after=4)]
                if src:
                    ps.append(self.para(src, self.th.scale.caption, p.mute, cap=True))
                paras.append(ps)
            return vs, paras, max(self.ph(ps, cw) for ps in paras)
        raise NoFit("the figures do not fit their columns")

    def _draw_stat_row(self, sl, x, y, w, paras, h, name="slot:figures"):
        """Draw a fitted stat row: equal columns, a hairline in each gutter's middle (never a filled card), the words in text tokens."""
        n = len(paras)
        G = self.th.grid.G
        cw = (w - G * (n - 1)) / n
        for i, ps in enumerate(paras):
            cx = x + i * (cw + G)
            if i:
                self.hairline(sl, cx - G / 2, y, cx - G / 2, y + h)
            self.ptext(sl, cx, y, cw - 0.1, h, ps, name=name)

    def _src_label(self, refs) -> str:
        """'Source [n]' for a figure's refs, numbered as the deck's footnotes number them (assemble._sources_slide); '' when none resolves."""
        if not refs:
            return ""
        try:
            from .assemble import slide_refs   # late: assemble numbers the sources this way (its _sources_slide)
            keys = []
            for sid in self.deck["order"]:
                for ref in slide_refs(self.deck["slides"][sid]):
                    k = self.R.source_key(ref)[0]
                    if k != "unknown" and k not in keys:
                        keys.append(k)
            nums = sorted({keys.index(self.R.source_key(r)[0]) + 1 for r in refs if self.R.source_key(r)[0] in keys})
        except Exception:
            return ""
        return ("Source " + " ".join(f"[{n}]" for n in nums)) if nums else ""

    def _lay_kpi_row(self, sl, s):
        """kpi_row: the stack (the KPI cards) before the look; under deck-look a stat row (rea-full A1, Pitch template, Gamma D2): the title,
        then two to four figures in ink at display size in equal columns with hairlines between, each with its label above and its source
        below, any note under a hairline at the foot. No card fills, no accent on a figure (dataviz: figures wear text tokens)."""
        if not self.th.v3:
            return self._lay_stack(sl, s)
        S, p, g = self.th.scale, self.p, self.th.grid
        bl = [b for b in s["blocks"] if self._text_of(b) or b.get("items")]
        stats = [b for b in bl if b["kind"] == "stats"]
        notes = [b for b in bl if b["kind"] in ("text", "small", "statement")]
        if len(stats) != 1 or len(stats) + len(notes) != len(bl) or not 2 <= len(stats[0]["items"]) <= 4:
            raise NoFit("a stat row holds two to four figures and a note")
        top, bottom, pad = self.V3_TOP, g.body_end, self.V3_PAD
        w = self.x1 - self.x0 - 2 * pad
        cols = [(str(i.get("label", "")).strip(), str(i.get("value", "")).strip(), self._src_label(i.get("refs") or stats[0].get("refs")))
                for i in stats[0]["items"]]
        for tsize in (36, 32, 30, 28):
            tp = [self.para(s["title"], tsize, p.fg, self.th.head, bold=True, line=1.05)]
            if self.nlines(glue(s["title"]), w, tsize, True, self.th.head) <= 3:
                break
        th_ = self.ph(tp, w)
        npar = [self.para(self._text_of(b), S.body, p.fg, line=1.3) for b in notes]
        nh = self.ph(npar, w) if npar else 0.0
        vs, paras, rh = self._stat_fit(cols, w)
        if th_ + 0.5 + rh + (0.6 + nh if npar else 0) > bottom - top - 0.3:
            raise NoFit("stat row too full")
        if sl is None:
            return
        self.band(sl, s)
        m = self._mark(sl)
        self._frame(sl, (self.x0, self.x1), top, bottom)
        self.ptext(sl, self.x0 + pad, top + 0.15, w, th_, tp, name="Title")
        self._build(sl, m, title=True)
        ny = bottom - 0.15 - nh
        free_top, free_bot = top + 0.15 + th_, (ny - 0.3 if npar else bottom - 0.15)
        y = free_top + max(0.4, (free_bot - free_top - rh) / 2)
        m = self._mark(sl)
        self._draw_stat_row(sl, self.x0 + pad, y, w, paras, rh)
        self._build(sl, m)
        self._rec_slot(sl, "figures")
        if npar:
            m = self._mark(sl)
            self.hairline(sl, self.x0 + pad, ny - 0.25, self.x1 - pad, ny - 0.25)
            self.ptext(sl, self.x0 + pad, ny, w, nh, npar, name="slot:note")
            self._build(sl, m)
            self._rec_slot(sl, "note")

    def _rows_aside_one(self, sl, s, head, row, aside):
        """rows_aside with ONE measure (deck-look, phase 14's s09 left the middle empty): the title across the frame, the row as a stat row
        (each column's header above its value, hairlines between), and the absorbed blocks under a hairline at the foot, each block's own
        title as its kicker; the free height split evenly above and below the stat row. The words are the table's and the blocks' own."""
        S, p, g = self.th.scale, self.p, self.th.grid
        top, bottom, pad = self.V3_TOP, g.body_end, self.V3_PAD
        w = self.x1 - self.x0 - 2 * pad
        cols = [(h_, v, "") for h_, v in zip(head, row)]
        fit = None
        for tsize in (36, 32, 30, 28):
            if self.nlines(glue(s["title"]), w, tsize, True, self.th.head) > 2:
                continue
            tp = [self.para(s["title"], tsize, p.fg, self.th.head, bold=True, line=1.05)]
            th_ = self.ph(tp, w)
            for asize in (22, 20, 18, 16):
                groups = self._aside_groups(aside, asize, w)
                ah = sum(h for _, h in groups) + 0.4 * (len(groups) - 1)
                got = None
                for ml in (2, 3):   # two lines a value at most before three: a value never strands one word on a line of its own
                    try:
                        got = self._stat_fit(cols, w, max_lines=ml, sizes=(44, 40, 36, 32, 30, 28, 26, 24))
                        break
                    except NoFit:
                        continue
                if got is None:
                    raise NoFit("the measure does not fit a stat row")
                vs, paras, rh = got
                if th_ + 0.5 + rh + 0.6 + ah <= bottom - top - 0.3:
                    fit = (tp, th_, groups, ah, paras, rh)
                    break
            if fit:
                break
        if not fit:
            raise NoFit("rows and aside too full")
        tp, th_, groups, ah, paras, rh = fit
        if sl is None:
            return
        self.band(sl, s)
        m = self._mark(sl)
        self._frame(sl, (self.x0, self.x1), top, bottom)
        free = (bottom - top - 0.3) - (th_ + rh + 0.3 + ah)
        gap = min(0.7, max(0.4, free / 2))   # title, row and foot kept together, the group centred: no strip of empty paper across the slide
        ty = top + 0.15 + max(0.0, (free - 2 * gap) / 2)
        self.ptext(sl, self.x0 + pad, ty, w, th_, tp, name="Title")
        self._build(sl, m, title=True)
        y = ty + th_ + gap
        ay = y + rh + gap + 0.3
        m = self._mark(sl)
        self._draw_stat_row(sl, self.x0 + pad, y, w, paras, rh, name="slot:rows")
        self._build(sl, m)
        self._rec_slot(sl, "rows")
        self.hairline(sl, self.x0 + pad, ay - 0.3, self.x1 - pad, ay - 0.3)
        for i, (ps, h) in enumerate(groups):
            m = self._mark(sl)
            self.ptext(sl, self.x0 + pad, ay, w, h, ps, name="slot:aside")
            self._build(sl, m)
            ay += h + 0.4
        self._rec_slot(sl, "aside")

    def _column_points(self, bl):
        """The labelled points of a picture column: kv items (key as the kicker), bullets items, small and callout lines; a two-column table
        (deck-look step 5: 'how it runs') gives one point per row, its first cell the kicker, after a point of the header row's labels."""
        out = []
        for b in bl:
            if b["kind"] == "table":
                rows = [[str(c).strip() for c in r] for r in b.get("rows") or []]
                if rows and all(len(r) == 2 for r in rows):
                    out += [(r[0], r[1]) for r in rows]
            elif b["kind"] == "kv":
                out += [(str(k).strip(), str(v).strip()) for k, v in b["items"] if str(v).strip()]
            elif b["kind"] == "bullets":
                out += [(str(b.get("title") or "").strip() if n == 0 else "", _item_text(i).strip()) for n, i in enumerate(b["items"]) if _item_text(i).strip()]
            elif b["kind"] in ("small", "callout"):
                out.append(("", self._text_of(b)))
        return out

    def _lay_picture_column(self, sl, s):
        """picture_column (D1/D3, G9): the picture as a full-height column (3/8 of the width, floor 4 in) bleeding off its side, sides
        alternating across the deck; the band, a hero title (capitals only when short), the lead, the copy line and up to three labelled
        points (hairline above each) in the text column beside it. No text over the picture; the label sits at its outer bottom corner and
        the footer on the text side only."""
        S, p, g = self.th.scale, self.p, self.th.grid
        side = self._pic_side.get(self._sid, "left") if sl is not None else "left"
        px, tx0, tx1 = self._pic_box(side)
        self._own_picture(None, "picture", px, 0, self.PIC_COL, H)   # NoFit without a picture
        bl = [b for b in s["blocks"] if self._text_of(b) or b.get("items") or b.get("lines") or b.get("rows")]
        if any(b["kind"] not in ("statement", "text", "copy", "kv", "bullets", "small", "callout", "table") for b in bl):
            raise NoFit("picture column holds text, copy and labelled points")
        if any(b["kind"] == "table" and not all(len(r) == 2 for r in b.get("rows") or [[]]) for b in bl):
            raise NoFit("a picture column holds a two-column table only")
        lead = [b for b in bl if b["kind"] in ("statement", "text")]
        copy = [b for b in bl if b["kind"] == "copy"]
        pts = self._column_points([b for b in bl if b["kind"] != "table"])
        grid = self._column_points([b for b in bl if b["kind"] == "table"])   # deck-look step 5: a table's rows, a compact grid at the foot
        if len(pts) > 3 or len(grid) > 5 or (grid and pts):
            raise NoFit("at most three points beside a picture")
        tw = tx1 - tx0
        gw0 = tw * 0.4
        gw1 = tw - gw0 - 0.2
        top, bottom = BAND_TITLE_Y + 0.25, g.body_end
        for bsize in (22, 20, 18, 16, 14):
            lp = [x for b in lead for x in ([self._kick(str(b["title"]).strip())] if str(b.get("title") or "").strip() else [])   # a merged slide: the absorbed title heads its line
                  + [self.para(self._text_of(b), bsize, p.fg, line=1.25, after=6)]]
            cp = []
            for c in copy:
                cp += [self.para(str(x), bsize + 4, p.fg, self.th.head, bold=True, line=1.05, after=4) for x in c.get("lines") or []]
                if c.get("answer"):
                    cp.append(self._kick(str(c["answer"])))
            pg = [([self._kick(k)] if k else []) + [self.para(v, bsize - 2, p.fg, line=1.25)] for k, v in pts]
            lh = self.ph(lp, tw) if lp else 0.0
            ch = self.ph(cp, tw) if cp else 0.0
            ph_ = [self.ph(ps, tw) for ps in pg]
            gc = [([self._kick(a)], [self._kick(b)]) if n == 0 else ([self.para(a, bsize, p.fg, self.th.head, bold=True, line=1.05)], [self.para(b, bsize - 2, p.fg, line=1.2)])
                  for n, (a, b) in enumerate(grid)]
            gh = [max(self.ph(a, gw0), self.ph(b, gw1)) for a, b in gc]
            grid_h = sum(h + (0.15 if n == 0 else 0.35) for n, h in enumerate(gh))
            body = (lh + 0.3 if lp else 0) + (ch + 0.3 if cp else 0) + sum(h + 0.5 for h in ph_) + (grid_h + 0.2 if gc else 0) - (0.1 if gc else 0)   # rows: a tighter gap under the title
            try:
                hp, hh, _ = self._hero(s["title"], tw, max_lines=4)
            except NoFit:
                continue
            for hs in self.HERO_SIZES:
                hp, hh, _ = self._hero(s["title"], tw, sizes=(hs,) + tuple(z for z in self.HERO_SIZES if z < hs), max_lines=4)
                if hh + 0.45 + body <= bottom - top:
                    break
            if hh + 0.45 + body <= bottom - top:
                break
        else:
            raise NoFit("picture column too full")
        icon, gut = None, 0.0
        if self._icons_on and len(gc) > 1:   # deck-graphics: the table rows' icons, at the same type size, only when the column still fits
            from . import graphics   # noqa: PLC0415
            icon = self._icon_ids(graphics.row_headings(s, [[a] for a, _ in grid[1:]]))
            if icon:
                gut = graphics.ICON_ROW_IN + graphics.ICON_GAP_IN
                w0 = gw0 - gut
                if w0 > 0.6 and all(self._units_fit(a, w0 * 0.95, bsize) for a, _ in grid[1:]):
                    gh_i = [gh[0]] + [max(self.ph(a, w0), self.ph(b, gw1)) for a, b in gc[1:]]
                    grid_i = sum(h + (0.15 if n == 0 else 0.35) for n, h in enumerate(gh_i))
                    if hh + 0.45 + body - grid_h + grid_i <= bottom - top:
                        gh, grid_h = gh_i, grid_i
                    else:
                        icon = None
                else:
                    icon = None
        if sl is None:
            return
        self._own_picture(sl, "picture", px, 0, self.PIC_COL, H, corner="left" if side == "left" else "right")
        self._with_width(tx0, tx1, lambda: self.band(sl, s))
        self._foot = (tx0, tx1)
        m = self._mark(sl)
        used = hh + 0.45 + (lh + 0.3 if lp else 0) + (ch + 0.3 if cp else 0)
        tg = 0.35 if gc else 0.45
        y = top if (pg or gc) else top + max(0.0, (bottom - top - used) * 0.4)   # no points: the block sits a little above the column's middle
        self.ptext(sl, tx0, y, tw, hh, hp, name="Title")
        self._build(sl, m, title=True)
        y += hh + tg
        if lp:
            m = self._mark(sl)
            self.ptext(sl, tx0, y, tw, lh, lp, name="slot:lead")
            self._build(sl, m)
            self._rec_slot(sl, "lead")
            y += lh + 0.3
        if cp:
            m = self._mark(sl)
            self.ptext(sl, tx0, y, tw, ch, cp, name="slot:copy")
            self._build(sl, m)
            self._rec_slot(sl, "copy")
            y += ch + 0.3
        if pg:
            y = max(y, bottom - sum(h + 0.5 for h in ph_))   # the points sit at the foot of the column
            for ps, h in zip(pg, ph_):
                m = self._mark(sl)
                self.hairline(sl, tx0, y + 0.2, tx1, y + 0.2)
                self.ptext(sl, tx0, y + 0.45, tw, h, ps, name="slot:points")
                self._build(sl, m)
                y += h + 0.5
            self._rec_slot(sl, "points")
        if gc:
            y = max(y, bottom - grid_h)   # the rows sit at the foot of the column: the header's labels, then a hairline over each row
            m = self._mark(sl)
            for n, ((a, b), h) in enumerate(zip(gc, gh)):
                if n:
                    self.hairline(sl, tx0, y, tx1, y)
                    y += 0.1
                if n and icon:
                    size = graphics.ICON_ROW_IN
                    self._icon(sl, icon[n - 1], tx0, y + max(0.0, (bsize * 1.05 / 72 - size) / 2), size)
                    self.ptext(sl, tx0 + gut, y, gw0 - gut, h, a, name="slot:points")
                else:
                    self.ptext(sl, tx0, y, gw0, h, a, name="slot:points")
                self.ptext(sl, tx0 + gw0 + 0.2, y, gw1, h, b, name="slot:points")
                y += h + (0.15 if n == 0 else 0.25)
            self._build(sl, m)
            self._rec_slot(sl, "points")

    def _lay_cover_column(self, sl, s):
        """cover_image reworked (deck-look): the picture as a 3/8 full-height column bleeding off the right edge; the kicker (sentence case),
        the title at display size (capitals only when short) and the lead in the text column at the optical middle; the label at the
        picture's outer bottom corner and the footer on the text side."""
        S, p, g = self.th.scale, self.p, self.th.grid
        px, tx0, tx1 = self._pic_box("right")
        tx0 = self.x0
        self._own_picture(None, "picture", px, 0, self.PIC_COL, H)
        blocks = [b for b in s["blocks"] if self._text_of(b)]
        if any(b["kind"] not in ("text", "small", "statement") for b in blocks):
            raise NoFit("cover holds text only")
        tw = tx1 - tx0
        lp = [self.para(self._text_of(b), S.small if b["kind"] == "small" else S.lead, p.mute if b["kind"] == "small" else p.fg, line=1.1, after=8)
              for b in blocks]
        lh = self.ph(lp, tw) if lp else 0.0
        kp = [self._kick(_kicker(self.deck["meta"]), 14)]
        kh = self.ph(kp, tw)
        for size in (52, 48, 44, 40):
            hp, hh, _ = self._hero(s["title"], tw, sizes=(size,) + tuple(z for z in (52, 48, 44, 40) if z < size), max_lines=4)
            block = kh + 0.3 + hh + (0.4 + lh if lp else 0)
            if block <= g.body_end - 1.3:
                break
        else:
            raise NoFit("cover too full")
        if sl is None:
            return
        self._own_picture(sl, "picture", px, 0, self.PIC_COL, H, corner="right")
        self._foot = (tx0, tx1)
        y = max(1.3, (g.body_end + 0.6 - block) / 2)
        m = self._mark(sl)
        lx = self._logo(sl, 0.8)
        self.ptext(sl, tx0, y, tw, kh, kp)
        self.ptext(sl, tx0, y + kh + 0.3, tw, hh, hp, name="Title")
        self._build(sl, m, title=True)
        if lp:
            m = self._mark(sl)
            self.ptext(sl, tx0, y + kh + 0.3 + hh + 0.4, tw, lh, lp, name="slot:lead")
            self._build(sl, m)
            self._rec_slot(sl, "lead")

    _LABEL_VALUE = re.compile(r"^([^:]{2,40}):\s*(.+)$")

    def _lay_close_v3(self, sl, s):
        """close reworked (deck-look): the ask (the title) as a hero across the content width; under a hairline, the budget given as a figure
        in ink (a 'label: figure' line of the slide's own words) with any statement under it in a 4/12 column, and the next steps as
        hairline rows in the 8/12 column, each list's own heading kept as its kicker; a step a person must supply is a dashed row tagged
        'To supply' (review builds: a client build never shows one). At most five rows; the hero steps down before the rows do."""
        S, p, g = self.th.scale, self.p, self.th.grid
        bl = [b for b in s["blocks"] if self._text_of(b) or b.get("items")]
        if any(b["kind"] not in ("statement", "text", "small", "bullets", "kv", "card") for b in bl):
            raise NoFit("close holds a statement, a budget and next steps")
        stat, lead, rows = None, [], []   # rows: (text, human, heading of its list or "")
        for b in bl:
            if b["kind"] in ("statement", "text", "small"):
                mm = self._LABEL_VALUE.match(self._text_of(b))
                if stat is None and mm and _FIG.search(mm.group(2)):
                    stat = (mm.group(1).strip(), mm.group(2).strip())
                else:
                    lead.append(b)
            elif b["kind"] == "bullets":
                its = [i for i in b["items"] if _item_text(i).strip()]
                rows += [(_item_text(i).strip(), bool(isinstance(i, dict) and i.get("human")), str(b.get("title") or "").strip() if n == 0 else "")
                         for n, i in enumerate(its)]
            elif b["kind"] == "kv":
                rows += [(f"{k}: {v}", False, "") for k, v in b["items"]]
            else:
                rows.append((self._text_of(b), bool(b.get("human")), str(b.get("title") or "").strip()))
        if len(rows) > 5:
            raise NoFit("at most five next steps")
        lw = self._span(4)
        rx = self.x0 + lw + g.G
        rw = self.x1 - rx
        top = 0.75
        fit = None
        for size in (54, 48, 44, 40, 36, 32):
            hp, hh, _ = self._hero(s["title"], self.x1 - self.x0, sizes=(size,), max_lines=3) if self._hero_fits(s["title"], self.x1 - self.x0, size, 3) else (None, 0, 0)
            if hp is None:
                continue
            ctop = top + hh + 0.5
            avail = g.body_end - ctop
            for bsize in (16, 15, 14):
                left = []
                if stat:
                    vs = 44
                    while vs > 24 and (self.nlines(glue(stat[1]), lw - 0.15, vs, True, self.th.head) > 2 or not self._units_fit(stat[1], lw - 0.15, vs)):
                        vs -= 2
                    left += [([self._kick(stat[0])], 0.02), ([self.para(stat[1], vs, p.fg, self.th.head, bold=True, line=1.0)], 0.3)]
                left += [([self.para(self._text_of(b), S.lead - 2, p.fg, line=1.2)], 0.2) for b in lead]
                lh = sum(self.ph(ps, lw - 0.15) + gp for ps, gp in left)
                rps, rhs = [], []
                for t, hum, head in rows:
                    ps = ([self._kick(head)] if head else []) + ([self._kick("To supply", 12)] if hum else []) + [self.para(t, bsize, p.fg, line=1.15, cpl=64)]
                    rps.append(ps)
                    rhs.append(self.ph(ps, rw - 0.5) + (0.24 if hum else 0.0))
                need = sum(rhs) + 0.2 * max(0, len(rows) - 1)
                if lh <= avail and need <= avail:
                    fit = (hp, hh, ctop, left, rps, rhs)
                    break
            if fit:
                break
        if not fit:
            raise NoFit("close too full")
        hp, hh, ctop, left, rps, rhs = fit
        if sl is None:
            return
        m = self._mark(sl)
        self.ptext(sl, self.x0, top, self.x1 - self.x0, hh, hp, name="Title")
        self._build(sl, m, title=True)
        self.hairline(sl, self.x0, ctop - 0.25, self.x1, ctop - 0.25)
        if left:
            m = self._mark(sl)
            self._stack_paras(sl, self.x0, ctop, lw - 0.15, left, "slot:statement")
            self._build(sl, m)
            self._rec_slot(sl, "statement")
        if rows:
            self._frame(sl, (rx - g.G / 2,), ctop, g.body_end)
        y = ctop
        for i, ((t, hum, head), ps, h) in enumerate(zip(rows, rps, rhs)):
            m = self._mark(sl)
            if hum:
                self.rect(sl, rx + 0.1, y, rw - 0.1, h, line=self.th.accent_on_dark if p.dark else self.th.accent_ink, dash=True, name="slot:next")
                self.ptext(sl, rx + 0.3, y + 0.12, rw - 0.5, h - 0.24, ps, name="slot:next")
            else:
                if i:
                    self.hairline(sl, rx + 0.1, y - 0.1, self.x1, y - 0.1)
                self.ptext(sl, rx + 0.3, y, rw - 0.5, h, ps, name="slot:next")
            self._build(sl, m)
            y += h + 0.2
        self._rec_slot(sl, "next")

    # -- deck-look step 7: words on a picture (cover_bleed, full_bleed_statement), only on a measured zone under a solved scrim -------------
    @staticmethod
    def _tz(s) -> dict | None:
        """The finder's passing zone recorded on the slide's picture slot (``images.text_zone``), or None."""
        im = (((s.get("slots") or {}).get("picture") or {}).get("image")) or {}
        tz = im.get("text_zone") or {}
        return tz if tz.get("zone") else None

    def _fade(self, sl, x, y, w, h, color, alpha, toward):
        """A scrim's fade: a rectangle filled with a two-stop linear gradient from ``alpha`` at the solid side to nothing ``toward`` the picture's
        centre (up, down, left, right). Native DrawingML (a:gradFill with a:alpha stops): it stays editable in PowerPoint."""
        if w <= 0.01 or h <= 0.01:
            return None
        r = self.rect(sl, x, y, w, h, fill=color, name="ScrimFade")
        spPr = r.fill._xPr
        old = spPr.find(qn("a:solidFill"))
        ang = {"up": 16200000, "down": 5400000, "right": 0, "left": 10800000}[toward]
        a = int(alpha * 100000)
        grad = etree.fromstring(
            f'<a:gradFill {nsdecls("a")} rotWithShape="1"><a:gsLst>'
            f'<a:gs pos="0"><a:srgbClr val="{color}"><a:alpha val="{a}"/></a:srgbClr></a:gs>'
            f'<a:gs pos="100000"><a:srgbClr val="{color}"><a:alpha val="0"/></a:srgbClr></a:gs>'
            f'</a:gsLst><a:lin ang="{ang}" scaled="0"/></a:gradFill>')
        old.addprevious(grad)
        spPr.remove(old)
        return r

    def _lay_cover_bleed(self, sl, s):
        """cover_bleed (G1): the cover's picture full bleed, its kicker, title and lead on the finder's zone."""
        self._lay_bleed(sl, s, cover=True)

    def _lay_bleed(self, sl, s, cover=False):
        """A bleed (cover_bleed, and full_bleed_statement under deck-look): the picture fills the slide from the top edge to the footer's strip;
        the words sit in the zone ``images.text_zone`` measured (recorded on the slot: their colour, the scrim's colour and alpha), over a scrim
        solid under the block plus SCRIM_PAD and fading over SCRIM_FADE toward the picture's centre; the label in the corner diagonal to the
        words, 0.3 in clear of every text box. NoFit without a passing zone (the ladder sets the words beside the picture instead), with a
        logo on the cover (a logo is never set over a picture), or when the words do not fit the zone at the display sizes."""
        S = self.th.scale
        BW, BH = images.BLEED_W, images.BLEED_H
        self._own_picture(None, "picture", 0, 0, BW, BH)   # NoFit without a picture
        tz = self._tz(s)
        if not tz:
            raise NoFit("no zone of the picture reads at AA: the words go beside it")
        if cover and self._logo_file():
            raise NoFit("a logo is not set over a picture: the cover keeps the picture column")
        blocks = [b for b in s["blocks"] if self._text_of(b)]
        if any(b["kind"] not in ("text", "small", "statement") for b in blocks) or (not cover and len(blocks) > 2):
            raise NoFit("a bleed holds a title and a line")
        col = tz["text"]
        bx, by, bw, bh = images.zone_box(tz["zone"], images.zone_block(self._cv))
        tw = bw
        kp = [self.para(_kicker(self.deck["meta"]), 16, col, bold=True)] if cover else []
        kh = self.ph(kp, tw) if kp else 0.0
        sizes = (52, 48, 44, 40) if cover else self.HERO_SIZES
        fit = None
        for hs in sizes:
            try:
                hp, hh, _ = self._hero(s["title"], tw, sizes=(hs,) + tuple(z for z in sizes if z < hs), max_lines=4 if cover else 3, color=col)
            except NoFit:
                break
            for ls in (22, 20, 18):
                lp = [self.para(self._text_of(b), S.small if b["kind"] == "small" else ls, col, line=1.2, after=6) for b in blocks]
                lh = self.ph(lp, tw) if lp else 0.0
                total = (kh + 0.25 if kp else 0) + hh + (0.35 + lh if lp else 0)
                if total <= bh:
                    fit = (hp, hh, lp, lh, total)
                    break
            if fit:
                break
        if not fit:
            raise NoFit("the words do not fit the zone")
        hp, hh, lp, lh, total = fit
        if sl is None:
            return
        self._bleed = True
        self._own_picture(sl, "picture", 0, 0, BW, BH, label=False)
        geo = images.scrim_geometry(tz["zone"], (bx, by, bw, bh))
        m = self._mark(sl)
        alpha = max(images.SCRIM_FLOOR, min(images.SCRIM_CAP, float(tz.get("alpha", images.SCRIM_FLOOR))))
        self._scrim(sl, *geo["solid"], tz["colour"], alpha)
        self._fade(sl, *geo["fade"], tz["colour"], alpha, geo["toward"])
        self._build(sl, m)
        v = tz["zone"].split("_")[0]
        y = by + bh - total if v == "bottom" else by if v == "top" else by + (bh - total) / 2
        m = self._mark(sl)
        boxes = []
        if kp:
            self.ptext(sl, bx, y, tw, kh, kp, name="Kicker")
            boxes.append((bx, y, tw, kh))
            y += kh + 0.25
        self.ptext(sl, bx, y, tw, hh, hp, name="Title")
        boxes.append((bx, y, tw, hh))
        self._build(sl, m, title=True)
        y += hh + 0.35
        if lp:
            m = self._mark(sl)
            slot = "lead" if cover else "statement"
            self.ptext(sl, bx, y, tw, lh, lp, name=f"slot:{slot}")
            boxes.append((bx, y, tw, lh))
            self._build(sl, m)
            self._rec_slot(sl, slot)
        im = self._pics["picture"]
        if im.get("status") != "approved":   # the label: the corner diagonal to the words, clear of every text box by 0.3 in
            pw = self._label_w(im, BW)
            corner = images.label_corner(tz["zone"])
            lx = BW - 0.5 - pw if corner.endswith("right") else 0.5
            ly = 0.75 if corner.startswith("top") else BH - 0.38 - 0.28
            self._label_pill(sl, lx, ly, im, pw)

    def _hero_fits(self, text, w, size, max_lines) -> bool:
        """Whether a hero statement takes at most ``max_lines`` lines at ``size`` (as ``_hero`` measures it)."""
        try:
            self._hero(text, w, sizes=(size,), max_lines=max_lines)
            return True
        except NoFit:
            return False

    LAYOUT_FN = {"objective_panel": "_lay_objective", "risk_cards": "_lay_risks", "cover": "_lay_cover", "emphasis_bar": "_lay_emphasis", "chart": "_lay_chart", "execution": "_lay_execution",
                 "territory": "_lay_territory", "quote_cards": "_lay_quote", "role_grid": "_lay_role", "flow": "_lay_flow",
                 # the standard composition: the blocks stacked with their looks
                 "comparison_grid": "_lay_stack", "placeholder_card": "_lay_stack", "comparison": "_lay_stack", "big_number": "_lay_stack",
                 "kpi_row": "_lay_kpi_row", "timeline_strip": "_lay_timeline_strip", "native_table": "_lay_stack", "cards": "_lay_stack",
                 "cover_image": "_lay_cover_image", "section": "_lay_section", "image_text": "_lay_image_text", "image_left": "_lay_image_left",
                 "full_bleed_statement": "_lay_full_bleed", "frames_strip": "_lay_territory", "image_grid": "_lay_image_grid", "execution_visual": "_lay_execution",
                 "close": "_lay_close", "big_statement": "_lay_big_statement", "quote_full": "_lay_quote_full", "cards_split": "_lay_cards_split",
                 "text_columns": "_lay_text_columns", "placeholder_split": "_lay_placeholder_split", "chart_full": "_lay_chart_full",
                 "timeline_rows": "_lay_timeline_rows", "execution_stack": "_lay_execution_stack", "territory_wide": "_lay_territory_wide",
                 "people_cards": "_lay_people_cards",
                 # deck-look steps 3-4 (spec.LOOK_V3 only: layouts/v3)
                 "process_chevrons": "_lay_process_chevrons", "matrix_2x2": "_lay_matrix", "journey_row": "_lay_journey", "grid_points": "_lay_grid_points",
                 "statement_points": "_lay_statement_points", "reframe": "_lay_reframe", "shift_line": "_lay_shift_line",
                 "picture_column": "_lay_picture_column", "rows_aside": "_lay_rows_aside", "cover_bleed": "_lay_cover_bleed"}

    # -- the plan's measuring: the renderer's own measure-only mode ---------------------------------
    def probe(self, s: dict, name: str, relaxed: bool = False, scale_cap: float | None = None, title_pt: int | None = None, cpl: int = 48) -> dict:
        """Measure layout ``name`` for the slide dict ``s`` (blocks already shown) without drawing: ``{ok, scale, relaxed}``. The plan calls
        this, so the plan and the drawing cannot disagree about what fits. ``scale`` is the smallest stack scale used (1.0 when none)."""
        fn = getattr(self, self.LAYOUT_FN.get(name, "_lay_stack"))
        lib = layouts.load()
        if self.not_here(name, lib) or not self.cells_fit(s, name):   # deck-slide-size: not_at this size, or its cells under their minimum
            return {"ok": False, "scale": 1.0, "relaxed": relaxed}
        saved = (self._lid, self._min_sc, self._scale_cap, self._relaxed, self._tpt, self._pics, self.p, self._cpl)
        self._cpl = cpl
        self._lid, self._min_sc, self._scale_cap, self._relaxed = name, 1.0, scale_cap, relaxed
        self.p = self._palette(s["type"] in dark_types(self.th.v3) or name in ("close",))
        if title_pt:
            self._tpt = {**self._tpt, name: title_pt}
        self._pics = {n: {"aspect": sl["image"]["aspect"], "asset": None, "probe": True} for n, sl in layouts.image_slots(lib[name])} if name in lib else {}
        try:
            fn(None, s)
            ok = True
        except NoFit:
            ok = False
        finally:
            out_sc = self._min_sc
            self._lid, self._min_sc, self._scale_cap, self._relaxed, self._tpt, self._pics, self.p, self._cpl = saved
        return {"ok": ok, "scale": out_sc, "relaxed": relaxed}

    def hole_estimate(self, s: dict, name: str, title_pt: int | None = None, cpl: int = 48) -> float | None:
        """deck-look (rea-full A4): the largest empty rectangle layout ``name`` would leave on slide ``s`` (blocks already shown), estimated from
        the boxes it draws on a scratch slide (``qa_render.hole_of_boxes``, the q_no_hole grid), a picture box counted as ink. None when the
        layout does not hold the slide. The swap menu offers only layouts under spec.HOLE_GATE by it. Nothing of the real deck is touched."""
        from . import qa_render
        fn = getattr(self, self.LAYOUT_FN.get(name, "_lay_stack"))
        lib = layouts.load()
        if self.not_here(name, lib) or not self.cells_fit(s, name):
            return None
        scratch = Presentation()
        if self._cv is None:
            scratch.slide_width, scratch.slide_height = Inches(W), Inches(H)
        else:
            scratch.slide_width, scratch.slide_height = Emu(self._cv.emu[0]), Emu(self._cv.emu[1])
        sl = scratch.slides.add_slide(scratch.slide_layouts[6])
        keep = ("_lid", "_min_sc", "_scale_cap", "_relaxed", "_tpt", "_pics", "p", "_cpl", "_cur", "steps", "_ink", "_band_drawn", "_foot",
                "_shapes_now", "_slotmap", "_sid", "_bleed", "_own_pics", "_acc", "_acc_drawn", "placed")
        saved = {k: getattr(self, k, None) for k in keep}
        self._lid, self._min_sc, self._scale_cap, self._relaxed, self._cpl = name, 1.0, None, False, cpl
        self.p = self._palette(s["type"] in dark_types(self.th.v3) or name in ("close",))
        if title_pt:
            self._tpt = {**self._tpt, name: title_pt}
        self._pics = {n: {"aspect": x["image"]["aspect"], "asset": None, "probe": True} for n, x in layouts.image_slots(lib[name])} if name in lib else {}
        self._cur, self.steps, self._ink, self._band_drawn, self._foot, self._shapes_now, self._slotmap = sl, [], [], False, None, [], {}
        self._sid, self._bleed, self._own_pics, self._acc, self.placed = None, False, set(), None, set()
        try:
            fn(sl, s)
            boxes = [(Emu(sh.left).inches, Emu(sh.top).inches, Emu(sh.width).inches, Emu(sh.height).inches) for sh in sl.shapes
                     if sh.left is not None] + list(self._ink)
        except NoFit:
            return None
        finally:
            for k, v in saved.items():
                setattr(self, k, v)
        return qa_render.hole_of_boxes(boxes, W, H) if self._cv is None else qa_render.hole_of_boxes(boxes, self._cv.w_in, self._cv.h_in)

    def not_here(self, name: str, lib: dict | None = None) -> bool:
        """Whether layout ``name`` is listed ``not_at`` this deck's size (layout.schema.json; never at 16:9)."""
        if self._cv is None:
            return False
        return self.cv.name in ((lib or layouts.load()).get(name) or {}).get("not_at", [])

    def cells_fit(self, s: dict, name: str) -> bool:
        """deck-slide-size (review 8): the design's row minimums at 4:3 and A4. A KPI card under spec.MIN_KPI_CARD_IN (1.8 in) or a comparison
        cell under spec.MIN_COMPARE_CELL_IN (2.2 in) fails the layout, so the plan takes its alternatives (kpi_row: cards, cards_split;
        comparison: cards; comparison_grid: native_table). Always True at 16:9."""
        if self._cv is None:
            return True
        cw = self.x1 - self.x0
        if name == "kpi_row":
            n = max((len(b.get("items") or []) for b in s.get("blocks") or [] if b.get("kind") == "stats"), default=0)
            return n < 2 or self._kx((cw - 0.3 * (n - 1)) / n) >= spec.MIN_KPI_CARD_IN - 1e-9
        if name in ("comparison", "comparison_grid"):
            cols = max([len((b.get("rows") or [[]])[0]) for b in s.get("blocks") or [] if b.get("kind") == "table"]
                       + [2 for b in s.get("blocks") or [] if b.get("kind") == "fromto"] + [0])
            return cols < 2 or self._kx((cw - 0.25 * (cols - 1)) / cols) >= spec.MIN_COMPARE_CELL_IN - 1e-9
        return True

    def title_fits(self, title: str, pt: int, lines: int = 3) -> bool:
        """Whether a title takes at most ``lines`` lines at ``pt`` across the content width."""
        return self.nlines(glue(title), self.x1 - self.x0, pt, True, self.th.head) <= lines

    #: Roles' nominal sizes by name, and the box heights (inches) a slot of that role is given in a nominal arrangement.
    _ROLE_H = {"display": 1.8, "title": 1.0, "lead": 1.3, "body": 2.2, "small": 0.9, "caption": 0.5}
    _HALF = frozenset({"cards_split", "placeholder_split", "image_text", "image_left", "quote_cards", "execution", "territory",
                       "objective_panel", "chart", "execution_stack", "cover_image"})

    #: deck-slide-size (Fable fix 4): the narrowest text column each half layout really draws on the 16:9 grid, in inches (the nominal 45% is
    #: 5.41): cards_split's lead column is 42% of the content less the gutter, placeholder_split's narrow side 45%, image_text's text column
    #: what the 5.4 in panel and its 0.55 in gap leave, execution's text half 5.28. At 4:3 and A4 capacity reads these, k-scaled, so a limit
    #: never promises more than the drawn box holds; at 16:9 the nominal boxes stay (the layout files' max_chars are recorded from them).
    _DRAWN_W = {"cards_split": 4.949, "placeholder_split": 5.302, "image_text": 6.083, "image_left": 6.083, "execution": 5.28,
                "execution_stack": 5.28, ("close", "statement"): 3.69}   # a (layout, slot) key: one slot narrower than its layout (deck-look's close)

    @staticmethod
    def slot_boxes(layout_id: str, lay: dict | None = None, canvas=None) -> dict:
        """``{slot: (width in, height in)}`` of each text slot in the layout's nominal arrangement (the boxes ``layouts.capacity`` reads).
        The content width is the grid's; a layout that sets text beside a panel gets 45% of it. With a ``canvas`` (a theme.Canvas or a
        size name) other than 16:9: the width the renderer draws at that size, in physical inches (the narrowest drawn column, x ``k``)."""
        lay = lay or layouts.load()[layout_id]
        g = themes.Grid()
        cw = g.W - 2 * g.M
        w = cw * 0.45 if layout_id in Renderer._HALF else cw
        cv = themes.canvas(canvas) if isinstance(canvas, str) or canvas is None else canvas
        D = Renderer._DRAWN_W
        return {n: ((w if cv.identity else min(w, D.get((layout_id, n), D.get(layout_id, w))) * cv.k), Renderer._ROLE_H.get(sl.get("role", "body"), 1.0))
                for n, sl in lay["slots"].items() if sl["kind"] == "text"}

    @staticmethod
    def box_capacity(w: float, h: float, role: str, max_cpl: int | None = None) -> int:
        """floor(0.85 x characters per line x lines) for a box ``w`` x ``h`` inches at the role's size near its shrink floor, lines held to
        ``max_cpl`` (48 by default for body, small and lead text)."""
        S = themes.Scale()
        size = max(S.body_floor if role not in ("caption",) else S.caption_floor, getattr(S, role if role != "display" else "display") * 0.88)
        wf = 0.5 + (0.03 if role in ("display", "title") else 0)
        cpl = min(max_cpl or 48, w * 72 / (size * wf)) if role in ("body", "small", "lead", "caption") else w * 72 / (size * wf)
        lines = max(1, int(h * 72 / (size * 1.2)))
        return int(0.85 * cpl * lines)

    def _rollback(self, sl, n_shapes, n_steps):
        """Remove what a layout drew before it gave up (shapes past ``n_shapes``, build steps past ``n_steps``)."""
        for sh in list(sl.shapes)[n_shapes:]:
            sh._element.getparent().remove(sh._element)
        del self.steps[n_steps:]

    # -- slides -------------------------------------------------------------------------------
    def layout_record(self) -> dict:
        """What the renderer did, per slide id, in the names of contract section 3.1: ``{id, chosen, fallback, relaxed}``
        (``id`` the layout drawn, ``chosen`` the one the rules picked, ``fallback`` true when the flow drew a slide whose
        layout raised NoFit, ``relaxed`` true when it fitted only at the caption floor). Written beside the deck, never into it."""
        def one(sid, name):
            rec = {"id": name, "chosen": self.chosen.get(sid, name),
                   "fallback": self.chosen.get(sid, name) != "flow" and name == "flow",
                   "relaxed": bool(self.relaxed.get(sid))}
            if spec.LOOK_V2:   # fit (the plan's) and the slot shapes: what a QA finding maps back to
                rec["fit"] = self.fit_by_slide.get(sid)
                rec["shapes"] = self.shapes_by_slide.get(sid, [])
            return rec
        out = {"version": 1, "theme": "napkin" if self.th.layouts else "classic",
               "slides": {sid: one(sid, name) for sid, name in self.layouts.items()}}
        if self._cv is not None:   # deck-slide-size: named only when not 16:9 (a 16:9 layouts.json keeps its bytes)
            out["canvas"] = self.cv.to_dict()
        return out

    def render(self, out: Path, layouts_out: Path | None = None):
        """Render every slide in order and save the .pptx; with ``layouts_out``, also write the layout record there
        (after the save, so the .pptx is the same bytes either way)."""
        if layouts_out is not None:
            Path(layouts_out).unlink(missing_ok=True)   # a failed render must not leave an older record beside it
        self.assets_dir = Path(out).parent
        self._pic_side = layouts.picture_sides(self.deck) if self.th.v3 else {}
        nums = {sid: i for i, sid in enumerate(self.deck["order"], 1)}
        for sid in self.deck["order"]:
            self.slide(sid, self.deck["slides"][sid], nums[sid])
        self._sections()
        _strike_runs(self.prs)
        self.prs.core_properties.title = f"{self.deck['meta']['client']}: {self.deck['meta']['project']}"
        self.prs.core_properties.author = "Napkin Deck Maker"
        self.prs.save(str(out))
        if layouts_out is not None:
            Path(layouts_out).write_text(json.dumps(self.layout_record(), indent=1))
        return out

    def slide(self, sid, s, n):
        """One slide: background, then the layout chosen by ``choose_layout`` (the flow if it does not fit),
        footer, watermark, notes."""
        sl = self.prs.slides.add_slide(self.blank)
        dark = s["type"] in dark_types(self.th.v3)
        self._band_drawn = False
        self._foot = None
        self._bleed = False
        self.p = self._palette(dark)
        self.fg = self.p.fg
        bg = sl.background.fill
        bg.solid(); bg.fore_color.rgb = _rgb(self.p.bg)
        if not self.sections or self.sections[-1][0] != s["section"]:
            self.sections.append((s["section"], []))
        self.sections[-1][1].append(sl.slide_id)
        self._cur, self.steps = sl, []
        audience = self.deck["meta"].get("audience", "review")
        lib = layouts.load()
        want = {slot for (i, slot) in self.drawn if i == sid}
        planned = s.get("layout")
        if not (planned and self.th.layouts and not self.no_plan and planned.get("blocks_sha") == spec.blocks_sha(s, audience)
                and (planned["id"] in lib or planned["id"] == "flow")):
            planned = None   # absent or stale: the rules decide, as before the plan (contract 3.3 rule 4)
            s = {k: v for k, v in s.items() if k != "layout"}
        name = planned["id"] if planned else (choose_layout(s, audience) if self.th.layouts else "flow")
        self.chosen[sid] = name
        ldef = lib.get(name)
        if ldef and any(sl.get("required") for _, sl in layouts.image_slots(ldef)) and not layouts.image_ready(ldef, want):
            name = choose_layout({k: v for k, v in s.items() if k != "layout"}, audience)   # the picture cannot be drawn here: the rules' text-only choice
        s_full = s
        s = {**s, "blocks": shown_blocks(s, audience)}
        self._sid, self._pics = sid, {slot: im for (i, slot), im in self.drawn.items() if i == sid}
        self._exec_title = None
        if spec.GRAPHICS:   # deck-graphics: an execution's picture (its own, or the one a merged slide absorbed) is shown in a frame
            pt_, ptitle = spec.picture_of(s)
            self._exec_title = ptitle if pt_ == "execution" else None
        self._cpl = ((planned or {}).get("fit") or {}).get("cpl", 48)
        tpt_saved = self._tpt
        if ((planned or {}).get("fit") or {}).get("title_pt"):   # deck-slide-size: this slide's own title size (the plan's last rung at 4:3 / A4)
            self._tpt = {**self._tpt, name: planned["fit"]["title_pt"]}
        self._acc = layouts.accent_phrase(s, s["blocks"]) if self.th.v3 else None
        self._acc_drawn = False
        self._own_pics = set()
        self._slotmap, self._shapes_now = {}, []
        if spec.LOOK_V2 and name in lib:
            _slots, _ = layouts.bind(lib[name], s, s["blocks"])
            for slot, v in _slots.items():
                for bi in v.get("blocks", []):
                    self._slotmap[id(s["blocks"][bi])] = (slot, bi)
        plan, done = self._picture_plan(sid, s, name), False
        if spec.GRAPHICS and s["type"] == "execution" and sum(1 for k in want if k.startswith("shot_")) >= spec.STRIP_MIN:
            sp = self._picture_plan(sid, s, "execution")   # a storyboard: its own slide, the words above a strip of numbered, captioned frames
            if sp and sp.get("strip"):
                self._storyboard(sl, {**s, "visual": {}}, sp)
                self._draw_pictures(sl, sp)
                self.placed |= {(sid, b[0]) for b in sp["boxes"]}
                plan, done, name = sp, True, "flow"
        if spec.GRAPHICS and s["type"] == "execution" and (s.get("ooh") or {}).get("formats") and not done:
            op = self._ooh_plan(sid, s)   # out of home: every format Production made, each in its frame, named
            if op:
                self._storyboard(sl, {**s, "visual": {}}, op)
                self._ooh_draw(sl, op)
                self.placed |= {(sid, c[0]["slot"]) for c in op["cells"]}
                plan, done, name = {"boxes": [(c[0]["slot"],) for c in op["cells"]], "also": ["picture"]}, True, "flow"
        if plan and not done:   # one carve: x1 and body_end are narrowed before the layout runs, so the layout (its id) is the one it would pick anyway
            n_sh, n_st = len(sl.shapes), len(self.steps)
            cs = {**s, "visual": {}} if s["type"] == "execution" else s   # the picture replaces the 'Image prompt' note
            self._carve(plan)
            try:
                ok = self._try_layout(sl, cs, name, sid)
            finally:
                self._uncarve()
            if ok:
                self._draw_pictures(sl, plan)
                self.placed |= {(sid, b[0]) for b in plan["boxes"]}
            else:   # the narrowed layout does not fit: no picture, and a finding
                self._rollback(sl, n_sh, n_st)
                self.relaxed.pop(sid, None)
                plan = None
        if not plan:
            if name != "flow":
                n_sh, n_st = len(sl.shapes), len(self.steps)
                if not self._try_layout(sl, s, name, sid):
                    self._rollback(sl, n_sh, n_st)
                    name = "flow"
            if name == "flow":
                self._relaxed = True   # the last resort: stepped down as far as the caption floor, never under it
                try:
                    getattr(self, "_" + s["type"], self._generic)(sl, s)
                finally:
                    self._relaxed = False
        shots = {k for k in want if k.startswith("shot_")} if not (plan and plan.get("strip")) else set()   # strip slots: drawn only as a strip
        for slot in sorted(want - {b[0] for b in (plan or {}).get("boxes", [])} - set((plan or {}).get("also", [])) - self._own_pics - shots):   # asked for, not drawn: say so, for every slot
            why = ("the classic theme has no picture box" if not self.th.layouts else "the slide is drawn by the flow, which has no picture box" if name == "flow"
                   else f"the {name} layout does not fit beside its picture")
            self.picture_findings.append({"check": "image_missing", "level": "warn", "slide": sid, "slot": slot,
                                          "message": f"{slot} is not drawn: {why}, so no output carries it"})
        self._tpt = tpt_saved
        self.layouts[sid] = name
        self._record_icons(sl, sid, name)
        self.shapes_by_slide[sid] = self._shapes_now
        self.fit_by_slide[sid] = (planned or {}).get("fit")
        # footer: section label, footnote keys, slide number
        t, p = self.th, self.p
        foot = t.scale.foot
        fx0, fx1 = self._foot or (self.x0, self.x1)   # deck-look: beside a picture column the footer and the DRAFT mark keep to the text side
        if t.layouts:
            self.rect(sl, fx0, 6.9, fx1 - fx0, 0.01, fill=p.rule)
        side = self._foot is not None
        if not self._band_drawn:   # the band carries the section on a banded slide
            self.text(sl, fx0, 7.0, min(6, (fx1 - fx0) * 0.45) if side else 6, 0.3, s["section"].upper(), size=foot, cap=True, color=p.mute, name="Section")
        if s.get("footnotes"):
            nx, nw = (fx0 + (fx1 - fx0) * 0.45, fx1 - 0.63 - (fx0 + (fx1 - fx0) * 0.45)) if side else (6.2, 5.6)
            self.text(sl, nx, 7.0, nw, 0.3, "Sources " + " ".join(f"[{k}]" for k in s["footnotes"][:14]) + "  (appendix)", size=foot, cap=True, color=p.mute, align=PP_ALIGN.RIGHT, name="Footnotes")
        nx = fx1 - 0.63 if side else 12.1
        self.text(sl, nx, 7.0, fx1 - nx, 0.3, str(n), size=foot, cap=True, color=p.mute, align=PP_ALIGN.RIGHT, name="SlideNumber")
        if self.n_human and not self.clean:
            tag = "DRAFT · needs a person" if s["status"] == "needs_human" else f"DRAFT · {self.n_human} slides need a person"
            wx = 8.7 if self._foot is None else max(fx0, fx1 - 4.03)
            if self._bleed:   # on a full-bleed picture the mark sits on a pill of the slide's ground, its box no wider than the pill
                tw_ = self._unk(0.3 + len(tag) * self.th.scale.foot * 0.56 / 72)
                self.rect(sl, fx1 - tw_ + 0.1, 0.08, tw_, 0.38, fill=p.bg, name="MarkGround")
                wx = fx1 - tw_ + 0.15
            self.text(sl, wx, 0.12, fx1 - wx, 0.3, tag, size=foot, cap=True, color=p.acc_t, bold=True, align=PP_ALIGN.RIGHT, name="Watermark")
        if sid in self.failed and audience != "client" and not self.clean:   # a client slide never prints a check id (a failing client build is withheld by run_deck)
            red = "FF9B8E" if dark else "B03225"
            self.text(sl, 4.5, 0.12, 4.1, 0.3, "CHECK FAILED: " + ", ".join(sorted(set(self.failed[sid]))), size=foot, cap=True, color=red, bold=True, align=PP_ALIGN.RIGHT, name="CheckFailed")
        if self.notes:
            sl.notes_slide.notes_text_frame.text = (export_clean.notes_of(s.get("notes")) if self.clean else (s.get("notes") or "")) + ("" if self.clean else f"\n\nSlide id {sid} · status {s['status']} · requirements {', '.join(s.get('requirements') or []) or 'none'}")
            if t.layouts and s.get("claims"):   # the claims stay in the file, in the notes, word for word
                sl.notes_slide.notes_text_frame.text += "\n\nClaims:\n" + "\n".join("- " + c["text"] for c in s["claims"])
            if planned and spec.moved_map(s_full, audience):   # points the plan moved off the slide: verbatim, each with its refs, labelled
                sl.notes_slide.notes_text_frame.text += "\n\nMoved from the slide:\n" + "\n".join(layouts.moved_line(t_, r_) for t_, r_ in layouts.moved_texts(s_full) if not (self.clean and spec.unresolved_line(t_)))
        if s["type"] == "appendix":
            self.hiding = True
        if getattr(self, "hiding", False):   # the appendix stays in the file, hidden from the slideshow
            sl._element.set("show", "0")
        if self.animate:
            self._animate(sl)

    def _try_layout(self, sl, s, name, sid) -> bool:
        """Draw the layout ``name``; once more with body text allowed down to the caption floor when it is too dense. True when it drew;
        False when it raised NoFit twice (the caller rolls back and falls to the flow). Marks ``self.relaxed[sid]``."""
        n_sh, n_st = len(sl.shapes), len(self.steps)
        fn = getattr(self, self.LAYOUT_FN.get(name, "_lay_stack"))
        self._lid = name
        if self.not_here(name) or not self.cells_fit(s, name):
            return False
        try:
            try:
                fn(sl, s)
            except NoFit:
                self._rollback(sl, n_sh, n_st)
                self._relaxed = True
                try:
                    fn(sl, s)
                    self.relaxed[sid] = True
                finally:
                    self._relaxed = False
            return True
        except NoFit:
            self._rollback(sl, n_sh, n_st)
            return False

    # -- pictures: one carve, one draw helper (slice 4 moves the boxes into its layout files) --------
    #: Box sizes in inches per aspect for a picture beside the text, and the gap to it. Tall pictures are given a height.
    SIDE = {"16:9": (3.6, None), "4:3": (3.3, None), "4:5": (None, 3.6), "9:16": (None, 4.6)}
    SIDE_COVER = {"16:9": (4.4, None)}
    GAP_PIC = 0.35
    EXEC_TOP = 1.74   # an execution's picture starts level with its cards; the SIDE table does not apply to it (half the slide, full content height)
    BOTTOM_H = 2.2

    def _picture_plan(self, sid, s, name):
        """Where this slide's drawn pictures go, and how far the layout's area is narrowed to leave room: ``{x1, body_end, boxes}`` or None
        (no picture drawn on this slide, the classic theme, or the flow). The territory's four frames sit in a strip along the foot; the
        emphasis bar (idea, divider) takes its picture bottom right; every other layout narrows its right edge. The layouts that draw their
        own picture panel (``OWN_PICTURE``) take no carve."""
        if not self.th.layouts or name == "flow" or name in self.OWN_PICTURE:
            return None
        got = {slot: im for (i, slot), im in self.drawn.items() if i == sid}
        if not got:
            return None
        g, x0, x1 = self.th.grid, self.x0, self.x1
        gap = self.GAP_PIC
        boxes = []
        if s["type"] == "territory":
            w = (x1 - x0 - 3 * 0.2) / 4   # four 16:9 boxes across the content width
            h = w * 9 / 16
            y = g.body_end - h
            for i in range(1, 5):
                if f"frame_{i}" in got:
                    boxes.append((f"frame_{i}", x0 + (i - 1) * (w + 0.2), y, w, h, got[f"frame_{i}"]))
            return {"x1": x1, "body_end": g.body_end - h - 0.2, "boxes": boxes} if boxes else None
        slot = "picture" if (spec.GRAPHICS and "picture" in got) else next(iter(sorted(got)))
        im = got[slot]
        a = im["aspect"]
        if name == "emphasis_bar":
            h = self.BOTTOM_H
            w = h * images.ratio(a)
            return {"x1": x1, "body_end": g.body_end - h - 0.2, "boxes": [(slot, x1 - w, g.body_end - h, w, h, im)]}
        if s["type"] == "execution" and spec.GRAPHICS:
            shots = sorted(k for k in got if k.startswith("shot_"))
            if len(shots) >= spec.STRIP_MIN:   # deck-graphics slice 3: the storyboard strip along the foot, the words above it
                gx = 0.25
                ims = [got[k] for k in shots]
                rs = [self._asset_ratio(im) for im in ims]
                w = (x1 - x0 - gx * (len(shots) - 1)) / len(shots)
                caps = (self._strip_info()[2] or [])
                cap_h = self.STRIP_CAP_H if any(caps) else 0.0
                h = min(w / max(rs), (g.body_end - self.EXEC_TOP - cap_h) * 0.42)
                y = g.body_end - 0.36 - cap_h - h
                boxes, cx = [], x0
                for k, im, r in zip(shots, ims, rs):
                    bw = min(w, h * r)
                    boxes.append((k, cx + (w - bw) / 2, y, bw, h, im))
                    cx += w + gx
                return {"x1": x1, "body_end": y - self.PILL_H - 0.35, "boxes": boxes, "strip": True, "also": ["picture"], "caps": caps}
            if self._frame_for(im):   # the frame takes the whole right half and contains itself in it
                half = (x1 - x0 - gap) / 2
                return {"x1": x1 - half - gap, "body_end": g.body_end, "framed": True,
                        "boxes": [(slot, x1 - half, self.EXEC_TOP, half, g.body_end - self.EXEC_TOP, im)]}
        if s["type"] == "execution":   # the work shown as work: the right half of the slide, at the full height of the content (a tall picture keeps its shape, centred in the half)
            half = (x1 - x0 - gap) / 2
            top = self.EXEC_TOP
            h = g.body_end - top
            w = min(half, h * images.ratio(a)) if images.ratio(a) < half / h else half
            return {"x1": x1 - half - gap, "body_end": g.body_end, "boxes": [(slot, x1 - half + (half - w) / 2, top, w, h, im)]}
        table = self.SIDE_COVER if s["type"] == "title" else self.SIDE
        wv, hv = table.get(a) or self.SIDE[a]
        w, h = (wv, wv / images.ratio(a)) if wv else (hv * images.ratio(a), hv)
        top = 1.6
        y = top + max(0.0, (g.body_end - top - h) / 2)
        return {"x1": x1 - w - gap, "body_end": g.body_end, "boxes": [(slot, x1 - w, y, w, h, im)]}

    def _asset_ratio(self, im) -> float:
        """Width over height of an image's asset in pixels (deck.assets), else of its slot's aspect."""
        rec = (self.deck.get("assets") or {}).get(im.get("asset")) or {}
        if rec.get("width") and rec.get("height"):
            return rec["width"] / rec["height"]
        return images.ratio(im["aspect"])

    def _carve(self, plan):
        self._saved_carve = (self.x1, self.th)
        self.x1 = plan["x1"]
        self.th = dataclasses.replace(self.th, grid=dataclasses.replace(self.th.grid, body_end=plan["body_end"]))

    def _uncarve(self):
        self.x1, self.th = self._saved_carve

    def picture(self, sl, x, y, w, h, im, name="Picture", label=True, corner="left"):
        """One picture in the box ``x, y, w, h`` (inches): the asset's derived JPEG cropped to the box's aspect with cover (a:srcRect;
        never stretched), alt text through cNvPr descr, the name ``Picture``. A picture that is not approved carries the deck's label on a
        solid pill named ``Caption``; a flagged one also gets a red outline and the word Flagged. Returns the picture shape."""
        from PIL import Image
        path = self.pictures[im["asset"]]
        with Image.open(path) as pil:
            sw, sh = pil.size
        gx, gy, gw, gh = self._g(x, y, w, h)
        box = images.crop_box(sw, sh, (w / h) if self._cv is None else (gw / gh), im.get("focal"))   # deck-slide-size: re-cropped to the box drawn at this size, about its focal point
        keep = self.protect.get(im.get("asset")) if self._cv is not None else None   # a Production picture's protect boxes (run_deck reads them)
        if keep and not images.keeps_protected({"keep": keep, "focal": im.get("focal"), "width": sw, "height": sh}, gw / gh):
            self.picture_findings.append({"check": "image_crop", "level": "warn", "slide": self._sid, "slot": im.get("slot") or name,
                                          "message": f"at {self.cv.name} the picture's crop cuts part of its protected area: make a size of it for this box in Production"})
        l, t, r, b = images.src_rect(box, sw, sh)
        pic = sl.shapes.add_picture(str(path), gx, gy, gw, gh)
        pic.crop_left, pic.crop_top, pic.crop_right, pic.crop_bottom = l, t, r, b
        pic.name = name
        pic._element.nvPicPr.cNvPr.set("descr", im.get("alt") or "An illustrative picture")
        if im.get("scrim") in ("dark", "light"):   # the repair loop's scrim: a dark layer under light text, a light one under dark text
            self._scrim(sl, x, y, w, h, "1B2430" if im["scrim"] == "dark" else "FFFFFF", 0.45)
        if im.get("status") == "flagged":
            pic.line.color.rgb = _rgb("C0392B")
            pic.line.width = Pt(3)
        if label and im.get("status") != "approved":
            pw = self._label_w(im, w)
            bleed = self.th.v3 and (x <= 0.01 or x + w >= W - 0.01)   # deck-look: a bleeding column keeps its label inside the slide margin
            inset = 0.5 if bleed else 0.1
            lx = x + w - inset - pw if corner == "right" else x + inset
            ly = y + h - (0.78 if (self.th.v3 and y + h >= H - 0.01) else 0.38)
            self._label_pill(sl, lx, ly, im, pw)
        return pic

    def _label_text(self, im) -> str:
        lab = images.picture_label(im, self.pic_label)   # 'Production' for a Production Tool picture, at the same place
        return f"{lab} · Flagged" if im.get("status") == "flagged" else lab

    def _label_w(self, im, w) -> float:
        return min(w - 0.2, self._unk(0.24 + 0.085 * len(self._label_text(im))))

    def _label_pill(self, sl, lx, ly, im, pw):
        """The picture label (Illustrative, or Flagged): white bold 10 pt on a solid ink pill (red when flagged), at ``lx, ly``."""
        flagged = im.get("status") == "flagged"
        self.rect(sl, lx, ly, pw, 0.28, fill="B03225" if flagged else "1B2430", name="PictureLabel")
        self.text(sl, lx, ly, pw, 0.28, self._label_text(im), size=10, color="FFFFFF", bold=True, align=PP_ALIGN.CENTER,
                  anchor=MSO_ANCHOR.MIDDLE, name="Caption")

    def _draw_pictures(self, sl, plan):
        if plan.get("strip"):
            return self._strip_draw(sl, plan)
        for slot, x, y, w, h, im in plan["boxes"]:
            m = self._mark(sl)
            fr = self._frame_for(im) if (plan.get("framed") or spec.GRAPHICS) else None
            if fr and plan.get("framed"):
                self._framed(sl, x, y, w, h, im, fr)
            elif self._plain_ok(im, w, h) if spec.GRAPHICS else True:
                self.picture(sl, x, y, w, h, im)
            self._build(sl, m)

    # -- the earlier flow (the fallback, and every slide under the classic theme) ----------------
    def _title_text(self, sl, s, size=30, y=0.5, w=None):
        """The slide's takeaway title (a full sentence)."""
        w = w or (self.x1 - self.x0)
        h = self._eh(s["title"], w, size, 1.1)
        m = self._mark(sl)
        if self.th.v3 and self.th.decor.band and y == 0.5:   # the flow gets the band too: it is the same look, only the fit failed
            self.band(sl, s)
            y = BAND_TITLE_Y
        self.text(sl, self.x0, y, w, h, s["title"], size=size, bold=True, font=self.th.head, name="Title")
        self._build(sl, m, title=True)
        return y + h + 0.25

    def _flow(self, sl, blocks, x, y, w, scale=1.0):
        """Lay blocks top to bottom; returns the final y."""
        t, p = self.th, self.p
        for bl in blocks:
            k = bl["kind"]
            tx = str(bl.get("text", "")).strip()
            if k in ("text", "small", "statement", "quote", "callout") and not tx:
                continue
            m = self._mark(sl)
            if k == "statement":
                sz = 24 * scale; h = self._eh(tx, w, sz, 1.15)
                self.text(sl, x, y, w, h, tx, size=sz, font=t.head); y += h + 0.2
            elif k == "quote":
                sz = 26 * scale; h = self._eh(tx, w, sz, 1.15)
                self.text(sl, x, y, w, h, tx, size=sz, italic=True, font=t.head, color=p.acc_t); y += h + 0.2
            elif k == "text":
                sz = 18 * scale; h = self._eh(tx, w, sz)
                self.text(sl, x, y, w, h, tx, size=sz); y += h + 0.18
            elif k == "small":
                sz = 13 * scale; h = self._eh(tx, w, sz)
                self.text(sl, x, y, w, h, tx, size=sz, color=p.mute); y += h + 0.12
            elif k == "callout":
                sz = 17 * scale; h = self._eh(tx, w - 0.4, sz) + 0.3
                self.box(sl, x, y, w, h, t.panel)
                self.text(sl, x + 0.2, y + 0.12, w - 0.4, h - 0.2, tx, size=sz, color=t.ink, anchor=MSO_ANCHOR.MIDDLE); y += h + 0.2
            elif k == "card":
                sz = 16 * scale; h = self._eh(tx, w - 0.4, sz) + 0.6
                self.box(sl, x, y, w, h, t.panel)
                self.text(sl, x + 0.2, y + 0.12, w - 0.4, 0.35, bl.get("title", ""), size=12 * scale, bold=True, color=t.mute)
                self.text(sl, x + 0.2, y + 0.45, w - 0.4, h - 0.5, tx, size=sz, color=t.ink); y += h + 0.2
            elif k == "bullets":
                y += self._flow_bullets(sl, x, y, w, bl, 17 * scale)
            elif k == "table":
                y += self.table(sl, x, y, w, bl["rows"], size=(10.5 if bl.get("small") else 14) * scale) + 0.2
            elif k == "kv":
                for key, val in bl["items"]:
                    self.text(sl, x, y, 1.5, 0.35, key, size=12 * scale, bold=True, color=t.mute)
                    val = "\n".join(_kv_parts(val))
                    h = self._eh(val, w - 1.6, 15 * scale)
                    self.text(sl, x + 1.6, y, w - 1.6, h, val, size=15 * scale); y += max(h, 0.35) + 0.12
            elif k == "fromto":
                cw = (w - 0.8) / 2; sz = 16 * scale
                h = max(self._eh(bl["from"], cw - 0.4, sz), self._eh(bl["to"], cw - 0.4, sz)) + 0.5
                for i, (lab, val) in enumerate((("From", bl["from"]), ("To", bl["to"]))):
                    bx = x + i * (cw + 0.8)
                    self.box(sl, bx, y, cw, h, t.panel if i == 0 else t.ink)
                    col = t.ink if i == 0 else t.on_dark
                    self.text(sl, bx + 0.2, y + 0.1, cw - 0.4, 0.3, lab.upper(), size=10, bold=True, color=t.mute if i == 0 else t.accent_on_dark)
                    self.text(sl, bx + 0.2, y + 0.4, cw - 0.4, h - 0.45, val, size=sz, color=col)
                ar = sl.shapes.add_shape(MSO_SHAPE.RIGHT_ARROW, *self._gk(x + cw + 0.2, y + h / 2 - 0.15, 0.4, 0.3))
                ar.fill.solid(); ar.fill.fore_color.rgb = _rgb(p.acc_f); ar.line.fill.background()
                y += h + 0.25
            elif k == "stats":   # up to three big numbers, each with its label
                n = max(1, len(bl["items"])); gap = 0.3; cw = (w - gap * (n - 1)) / n
                for i, it in enumerate(bl["items"]):
                    bx = x + i * (cw + gap)
                    bar = sl.shapes.add_shape(MSO_SHAPE.RECTANGLE, *self._g(bx, y, cw, 0.06))
                    bar.fill.solid(); bar.fill.fore_color.rgb = _rgb(p.acc_f); bar.line.fill.background()
                    self.text(sl, bx, y + 0.15, cw, 0.8, it["value"], size=40 * scale, bold=True, font=t.head)
                    self.text(sl, bx, y + 0.95, cw, 0.6, it["label"], size=13 * scale, color=p.mute)
                y += 1.7
            elif k == "steps":
                n = len(bl["items"]); gap = 0.2; cw = (w - gap * (n - 1)) / n; sz = 15 * scale
                h = max(self._eh(v, cw - 0.3, sz) for _, v in bl["items"]) + 0.75
                for i, (lab, val) in enumerate(bl["items"]):
                    bx = x + i * (cw + gap)
                    self.box(sl, bx, y, cw, h, t.panel)
                    self.text(sl, bx + 0.15, y + 0.12, cw - 0.3, 0.3, f"{i + 1:02d}", size=11, bold=True, color=t.accent_ink)
                    self.text(sl, bx + 0.15, y + 0.38, cw - 0.3, 0.4, lab, size=13 * scale, bold=True, color=t.ink)
                    self.text(sl, bx + 0.15, y + 0.72, cw - 0.3, h - 0.8, val, size=sz, color=t.ink)
                y += h + 0.2
            self._build(sl, m, "wipe" if k in ("fromto", "steps") else "fade")
        return y

    def _logo_file(self):
        """The cover logo's file: the client's logo the look cleared (``meta.theme.logo.asset``, a deck asset under ``assets/`` in the run
        folder; placement ``none`` means no logo), else the ``--brand`` file's ``logo_dark_png``."""
        th = self.deck["meta"].get("theme") or {}
        lg = th.get("logo")
        if lg:
            if lg.get("placement") == "none":
                return None
            rec = (self.deck.get("assets") or {}).get(lg.get("asset")) or {}
            return (self.assets_dir / rec["file"]) if rec.get("file") and self.assets_dir else None
        return (self.deck["meta"].get("brand") or {}).get("logo_dark_png")

    def _logo(self, sl, y) -> float:
        """Place the brand's own dark-ground logo (``meta.brand.logo_dark_png``) at ``y`` with alt text and the
        name "Logo". Returns the x where the kicker label should start: beside the logo, or the left margin
        when the brand has no logo file."""
        logo = self._logo_file()
        if not (logo and _is_image(logo)):
            return self.x0
        try:
            pic = sl.shapes.add_picture(str(logo), *self._g(self.x0, y, 0, 0)[:2], height=Inches(0.9))
        except Exception:   # a corrupt image degrades to no logo
            return self.x0
        pic.name = "Logo"
        pic._element.nvPicPr.cNvPr.set("descr", f"{self.deck['meta'].get('client', 'Brand')} logo")
        return self.x0 + self._unk(Emu(pic.width).inches) + 0.3

    def _flow_human(self, sl, x, y, w, text, size) -> float:
        """One human-flagged bullet in the flow: a dashed card with the PROPOSED tag and the TO SUPPLY chip, so a
        placeholder is never styled as finished even when its layout fell back. Returns the height used."""
        p = self.p
        h = 0.55 + self._eh(text, w - 0.5, size) + 0.1
        self.rect(sl, x, y, w, h, line=p.acc_t, lw=1.5, dash=True, name="Placeholder")
        self.text(sl, x + 0.25, y + 0.15, 1.6, 0.3, TAG, size=11, bold=True, color=p.acc_t, cap=True)
        self.rect(sl, x + w - 1.35, y + 0.14, 1.15, 0.3, fill=p.acc_f)
        self.text(sl, x + w - 1.35, y + 0.14, 1.15, 0.3, CHIP, size=10, bold=True, color=p.chip_fg,
                  align=PP_ALIGN.CENTER, anchor=MSO_ANCHOR.MIDDLE, cap=True)
        self.text(sl, x + 0.25, y + 0.5, w - 0.5, h - 0.55, text, size=size, color=p.fg)
        return h

    def _flow_bullets(self, sl, x, y, w, bl, size) -> float:
        """A bullets block in the flow: plain items as one bulleted list, ``human`` items as marked placeholder
        cards, in the deck's order. Returns the height used."""
        y0, run, title = y, [], bl.get("title")

        def flush():
            """Draw the pending run of plain bullets."""
            nonlocal y, run, title
            if run:
                y += self.bullets(sl, x, y, w, run, size=size, title=title) + 0.1
                run, title = [], None

        for i in bl["items"]:
            if isinstance(i, dict) and i.get("human"):
                flush()
                if title:
                    y += self.bullets(sl, x, y, w, [], size=size, title=title)
                    title = None
                y += self._flow_human(sl, x, y, w, i["text"], size) + 0.12
            else:
                run.append(i["text"] if isinstance(i, dict) else i)
        flush()
        if title:   # no items at all: the title alone
            y += self.bullets(sl, x, y, w, [], size=size, title=title) + 0.1
        return y - y0

    def _fit_flow(self, sl, blocks, x, y, w, bottom=Y_END):
        """Flow blocks, stepping the scale down until the estimate fits above ``bottom``."""
        for scale in (1.0, 0.92, 0.85, 0.78, 0.72):
            probe = self.prs.slides.add_slide(self.blank)
            end = self._flow(probe, blocks, x, y, w, scale)
            self._drop_last()
            if end <= bottom:
                break
        return self._flow(sl, blocks, x, y, w, scale)

    def _drop_last(self):
        """Remove the probe slide added by _fit_flow."""
        sldIdLst = self.prs.slides._sldIdLst
        last = sldIdLst[-1]
        self.prs.part.drop_rel(last.rId)
        sldIdLst.remove(last)

    def _generic(self, sl, s):
        """Title and blocks in one column."""
        y = self._title_text(sl, s)
        self._fit_flow(sl, s["blocks"], self.x0, max(y, Y_BODY - 0.3), self.x1 - self.x0)

    def _title(self, sl, s):
        """Opening slide: big client and project, then who presents."""
        m = self._mark(sl)
        lx = self._logo(sl, 0.6)   # the brand's lockup for a dark ground, with the kicker label kept beside it
        self.text(sl, lx, 0.6 if lx == self.x0 else 0.95, 6, 0.4, _kicker(self.deck["meta"]).upper(), size=11, bold=True, color=self.p.acc_t, cap=True)
        self.text(sl, self.x0, 2.2, self.x1 - self.x0, 2.0, s["title"], size=44, bold=True, font=self.th.head)
        self._build(sl, m, title=True)
        self._flow(sl, s["blocks"], self.x0, 4.6, 9.5)

    def _real_question(self, sl, s):
        """Dark slide: one big line (the reframe, or the idea)."""
        m = self._mark(sl)
        self.text(sl, self.x0, 0.6, 6, 0.4, {"idea": "THE IDEA"}.get(s["type"], "THE REAL QUESTION"), size=11, bold=True, color=self.p.acc_t, cap=True)
        h = self._eh(s["title"], 11.5, 40, 1.1)
        self.text(sl, self.x0, 1.6, 11.5, h, s["title"], size=40, bold=True, font=self.th.head)
        self._build(sl, m, title=True)
        self._flow(sl, s["blocks"], self.x0, 1.6 + h + 0.4, 10.5)

    _idea = _real_question

    def _next_step(self, sl, s):
        """Dark closing slide."""
        y = self._title_text(sl, s, size=34, y=1.2)
        self._fit_flow(sl, s["blocks"], self.x0, y + 0.2, 10.5)

    def _chart(self, sl, s):
        """Chart left (native), under its hero numbers when it has them; commentary right."""
        if spec.GRAPHICS and self.inp is not None:   # deck-graphics: a chart that fits no layout becomes a table with every row, never a smaller chart
            from . import graphics   # noqa: PLC0415
            ch = next((b for b in s["blocks"] if b["kind"] == "chart"), None)
            if ch is not None:
                pts = graphics.chart_form(ch["chart"], self.inp, self.R)["points"]
                tb = {"kind": "table", "rows": [[str(ch["chart"].get("title") or ""), ""]] + [[p_["label"], p_["shown"]] for p_ in pts]}
                return self._generic(sl, {**s, "blocks": [tb if b is ch else b for b in s["blocks"]]})
        y = self._title_text(sl, s)
        ch = next((b for b in s["blocks"] if b["kind"] == "chart"), None)
        rest = [b for b in s["blocks"] if b["kind"] != "chart"]
        top = side = max(y, Y_BODY - 0.2)
        if ch and ch["chart"].get("hero"):   # the one or two numbers the title is about, big, above the chart
            m = self._mark(sl)
            rows = {x["label"]: self.inp.doc_facts.get(x["ref"]) or self.inp.facts.get(x["ref"]) or {} for x in ch["chart"]["series"]}
            for i, lab in enumerate(h for h in ch["chart"]["hero"] if h in rows):
                self.text(sl, self.x0 + i * 3.5, top, 3.3, 1.05, fmt(rows[lab]), size=60, bold=True, font=self.th.head)
                self.text(sl, self.x0 + i * 3.5, top + 1.05, 3.3, 0.4, lab, size=13, color=self.th.mute)
            self._build(sl, m)
            top += 1.65
        if ch:
            m = self._mark(sl)
            self.chart(sl, self.x0, top, 7.2, Y_END - top, ch["chart"]["series"], ch["chart"].get("title"))
            self._build(sl, m, "wipe")
            self._fit_flow(sl, rest, 8.2, side + 0.2, self.x1 - 8.2)
        else:
            self._fit_flow(sl, rest, self.x0, top, self.x1 - self.x0)

    def _territory(self, sl, s):
        """Thought and reasons left; an 'illustrative' frame with the sketch right."""
        t, p = self.th, self.p
        y = self._title_text(sl, s, size=28)
        sk = next((b for b in s["blocks"] if b["kind"] == "sketch"), None)
        self._fit_flow(sl, [b for b in s["blocks"] if b["kind"] != "sketch"], self.x0, y, 7.4)
        if sk:
            m = self._mark(sl)
            self.box(sl, 8.4, y, 4.33, 4.3, t.ink)
            self.text(sl, 8.7, y + 0.3, 3.73, 3.2, sk["text"].replace("  ->  ", "\n\n"), size=22, font=t.head, color=t.on_dark, anchor=MSO_ANCHOR.MIDDLE)
            self.text(sl, 8.7, y + 3.75, 3.73, 0.4, "Illustrative, not final", size=10, italic=True, color=t.accent_on_dark, cap=True)
            self._build(sl, m)

    def _storyboard(self, sl, s, plan):
        """A storyboard slide (deck-graphics slice 3): the title, the role and notes left and the lines of the film (voice-over, super, the
        answer) right, small, above the strip ``plan`` places along the foot. Never a dark card: the frames are the slide."""
        t = self.th
        y = self._title_text(sl, s, size=28)
        bottom = plan["body_end"]
        cps = [b for b in s["blocks"] if b["kind"] == "copy"]
        self._fit_flow(sl, [b for b in s["blocks"] if b["kind"] != "copy"], self.x0, y, 5.6, bottom=bottom)
        if cps:
            lines = "\n".join(str(x) for b in cps for x in b.get("lines") or [])
            answers = " ".join(str(b.get("answer") or "") for b in cps).strip()
            fx, fw = 6.7, self.x1 - 6.7
            m = self._mark(sl)
            h_ans = self._eh(answers, fw, 12, 1.1) if answers else 0.0
            if lines:
                self.text(sl, fx, y, fw, max(0.4, bottom - y - h_ans - 0.1), lines, size=13, color=self.p.fg, name="StoryboardLines")
            if answers:
                self.text(sl, fx, bottom - h_ans, fw, h_ans, answers, size=12, bold=True, color=self.p.acc_t, name="StoryboardAnswer")
            self._build(sl, m)

    def _execution(self, sl, s):
        """Role and notes left; the copy in a frame shaped by the channel right."""
        t = self.th
        y = self._title_text(sl, s, size=28)
        cp = next(b for b in s["blocks"] if b["kind"] == "copy")
        self._fit_flow(sl, [b for b in s["blocks"] if b["kind"] != "copy"], self.x0, y, 5.6)
        vis = s.get("visual") or {}
        if vis.get("kind") == "image_prompt":
            m = self._mark(sl)
            self.text(sl, self.x0, y + 1.2, 5.6, 1.5, "Image prompt (" + vis.get("status", "illustrative") + "): " + vis.get("prompt", ""), size=11, italic=True, color=t.mute)
            self._build(sl, m)
        fx, fw = 6.7, 6.03
        m = self._mark(sl)
        self.box(sl, fx, y, fw, Y_END - y, t.ink)
        lines = "\n\n".join(cp["lines"])
        self.text(sl, fx + 0.4, y + 0.35, fw - 0.8, Y_END - y - 1.6, lines, size=18 if len(lines) < 220 else 15, font=t.head, color=t.on_dark)
        self._build(sl, m)
        m = self._mark(sl)
        self.text(sl, fx + 0.4, Y_END - 1.1, fw - 0.8, 0.8, cp["answer"], size=15, bold=True, color=t.accent_on_dark)
        self._build(sl, m)

    def _sections(self):
        """Write PowerPoint sections (p14:sectionLst) so the deck opens grouped by part."""
        P14 = "http://schemas.microsoft.com/office/powerpoint/2010/main"
        P = "http://schemas.openxmlformats.org/presentationml/2006/main"
        pres = self.prs.part._element
        extLst = pres.find(f"{{{P}}}extLst")
        if extLst is None:
            extLst = etree.SubElement(pres, f"{{{P}}}extLst")
        ext = etree.SubElement(extLst, f"{{{P}}}ext")
        ext.set("uri", "{521415D9-36F7-43E2-AB2F-B90AF26B5E84}")
        lst = etree.SubElement(ext, f"{{{P14}}}sectionLst", nsmap={"p14": P14})
        for i, (name, ids) in enumerate(self.sections):
            sec = etree.SubElement(lst, f"{{{P14}}}section")
            sec.set("name", name)
            sec.set("id", "{%08X-0000-4000-8000-%012X}" % (i + 1, i + 1))
            sl = etree.SubElement(sec, f"{{{P14}}}sldIdLst")
            for sid in ids:
                etree.SubElement(sl, f"{{{P14}}}sldId").set("id", str(sid))


def _strike_runs(prs) -> None:
    """A ``~~word~~`` the copy wrote becomes a real strike-through run (``strike="sngStrike"``), the tildes gone, wherever the text sits (a
    text box, a card, a table cell). Speaker notes lose the tildes only. An odd tilde pair is dropped without a strike, never shown."""
    A = "http://schemas.openxmlformats.org/drawingml/2006/main"
    parts = [sl._element for sl in prs.slides]
    for el in parts:
        for r in list(el.iter(f"{{{A}}}r")):
            t = r.find(f"{{{A}}}t")
            if t is None or not t.text or "~~" not in t.text:
                continue
            segs = t.text.split("~~")
            if len(segs) % 2 == 0:   # unmatched marker: plain text without the tildes
                t.text = "".join(segs)
                continue
            parent, at = r.getparent(), r.getparent().index(r)
            parent.remove(r)
            for i, seg in enumerate(segs):
                if not seg:
                    continue
                n = copy.deepcopy(r)
                n.find(f"{{{A}}}t").text = seg
                if i % 2:
                    rpr = n.find(f"{{{A}}}rPr")
                    if rpr is None:
                        rpr = etree.Element(f"{{{A}}}rPr")
                        n.insert(0, rpr)
                    rpr.set("strike", "sngStrike")
                parent.insert(at, n)
                at += 1
    for sl in prs.slides:
        if sl.has_notes_slide:
            for r in sl.notes_slide._element.iter(f"{{{A}}}t"):
                if r.text and "~~" in r.text:
                    r.text = r.text.replace("~~", "")


def render(deck, inp, out: Path, master: Path | None = None, findings: list | None = None, animate=False, theme=themes.DEFAULT,
           layouts_out: Path | None = None, pictures: dict | None = None, picture_findings: list | None = None, placed: set | None = None,
           notes: bool = True, no_plan: bool = False, icons: dict | None = None, protect: dict | None = None, clean: bool = False) -> Path:
    """Render a deck to ``out`` (.pptx); slides with a failed check carry a visible flag.

    ``clean``: an export (``--clean-export``): no DRAFT mark, no CHECK FAILED flag and no slide id or status line in the notes.

    ``animate``: False (static), True or ``"auto"`` (builds play in order), ``"click"`` (one block per click).
    ``theme``: ``"napkin"`` (default, the layout library) or ``"classic"`` (the earlier look, flow only);
    the deck's brand JSON is applied over either, exactly as before.
    ``layouts_out``: a path for the layout record (``layouts.json``); the .pptx is byte-identical with or without it.
    ``pictures``: asset id -> derived JPEG for the pictures to draw (images.copy_assets); None draws none and changes nothing.
    ``picture_findings``: a list the renderer appends to when a slide had to be drawn without its picture.
    ``icons``: a dict the renderer fills with the icons it drew (deck-graphics; empty unless spec.GRAPHICS): ``{slide id: {layout, ids}}``.
    ``protect``: asset id -> a Production picture's protect boxes (deck-slide-size: a re-crop at 4:3 or A4 that cuts them is a finding).
    """
    r = Renderer(deck, inp, master, findings, animate, theme, pictures)
    r.notes, r.no_plan, r.protect, r.clean = notes, no_plan, dict(protect or {}), clean
    r.render(out, layouts_out)
    if picture_findings is not None:
        picture_findings.extend(r.picture_findings)
    if placed is not None:
        placed |= r.placed
    if icons is not None:
        icons.update(r.icons_drawn)
    return out
