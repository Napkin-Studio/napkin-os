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
import itertools
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


class NoFit(Exception):
    """A layout cannot hold the slide's words at its smallest sizes, or has no look for a block."""


def choose_layout(s: dict, audience: str = "review") -> str:
    """The layout name for one slide dict, by the rule table in the module docstring (pure, no drawing)."""
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
    t = str(text)
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

    def __init__(self, deck, inp, master: Path | None = None, findings: list | None = None, animate=False, theme=themes.DEFAULT):
        self.deck, self.inp = _clean_xml(deck), inp
        deck = self.deck
        self.th = themes.get_theme(theme, (deck["meta"].get("brand") or {}))
        self.theme_problems = themes.check_palette(self.th)
        self.x0 = self.th.grid.M if self.th.layouts else X0
        self.x1 = W - self.x0
        self.animate = {True: "auto", False: None}.get(animate, animate)
        if self.animate not in (None, "auto", "click"):
            raise ValueError(f"animate must be False, True, 'auto' or 'click', not {animate!r}")
        self._cur, self.steps = None, []
        self.failed = {}
        self.layouts = {}   # slide id -> the layout it was drawn with
        for f in findings or []:
            if f["level"] == "error" and f.get("slide"):
                self.failed.setdefault(f["slide"], []).append(f["check"])
        self.R = Resolver(inp, list(deck.get("requirements", {}).values()))
        self.prs = Presentation(str(master)) if master else Presentation()
        if not master:
            self.prs.slide_width, self.prs.slide_height = Inches(W), Inches(H)
        self.blank = self._layout("Blank") or self.prs.slide_layouts[6]
        self.n_human = sum(1 for s in deck["slides"].values() if s["status"] == "needs_human")
        self.sections = []
        self._role = False
        self._kvcards = False   # territory's wide variant sets this: key/value pairs as cards side by side
        self._relaxed = False   # last resort for a slide too dense at the body floor: body text may go to the caption floor
        self._minh = 0.0        # the minimum height a stretchable look takes (set by ``stack``, 0 when measuring)
        self.p = self._palette(False)
        self.fg = self.p.fg

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
            return SimpleNamespace(dark=True, bg=t.ink, fg=t.on_dark, mute=t.on_dark_mute, acc_t=t.accent_on_dark,
                                   acc_f=t.accent_on_dark, card=card, card_fg=t.on_dark, card_mute=t.on_dark_mute,
                                   card_acc=t.accent_on_dark, rule=themes.blend(t.ink, t.on_dark, 0.28), chip_fg=t.ink,
                                   inv=t.panel, inv_fg=t.ink, inv_acc=t.accent_ink, inv_mute=t.mute)
        chip = "FFFFFF" if themes.contrast("FFFFFF", t.accent) >= themes.contrast(t.ink, t.accent) else t.ink
        return SimpleNamespace(dark=False, bg=t.paper, fg=t.ink, mute=t.mute, acc_t=t.accent_ink, acc_f=t.accent,
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
        tb = sl.shapes.add_textbox(Inches(x), Inches(y), Inches(w), Inches(h))
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
        s = sl.shapes.add_shape(shape, Inches(x), Inches(y), Inches(w), Inches(h))
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
        s = sl.shapes.add_shape(shape, Inches(x), Inches(y), Inches(w), Inches(h))
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

    # -- measuring and paragraph text (layout library) -----------------------------------------
    def _wf(self, bold=False, font=None):
        """Average glyph width as a fraction of the size: a deliberately generous figure (QA catches the rest)."""
        head = (font or self.th.body) == self.th.head
        return (0.55 if head else 0.50) + (0.03 if bold else 0)

    def wrap(self, text, w, size, bold=False, font=None) -> list:
        """The lines a text wraps to in ``w`` inches at ``size`` pt, as lists of words: greedy word wrap on the
        estimated glyph width. A no-break space (``NBSP``) glues two words, as it does in PowerPoint, so a glued
        pair is one unit here. This is the renderer's own wrap estimate (the tests use it to look for orphans)."""
        per = max(1.0, w * 72 / (size * self._wf(bold, font)))
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

    def nlines(self, text, w, size, bold=False, font=None) -> int:
        """Lines a text takes in ``w`` inches at ``size`` pt (the count of ``wrap``)."""
        return len(self.wrap(text, w, size, bold, font))

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
        for p in paras:
            size = p.get("size", self.th.scale.body)
            n = self.nlines(p["t"], w - (0.3 if p.get("bullet") else 0), size, p.get("bold"), p.get("font"))
            h += n * size * 1.2 * p.get("line", 1.0) / 72 + p.get("after", 0) / 72
        return h + 0.04

    def ptext(self, sl, x, y, w, h, paras, anchor="top", name=None):
        """A text box of paragraph dicts: t, size, color, font, bold, italic, align (l c r), line, after, track.
        Margins are zero so the box edge is the text edge; ``sl`` None measures only."""
        if sl is None:
            return None
        tb = sl.shapes.add_textbox(Inches(x), Inches(y), Inches(w), Inches(h))
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
            run = para.add_run()
            txt = d["t"]
            psz = self.sz(d.get("size", self.th.scale.body), d.get("cap", False))
            if NBSP in txt and self.nlines(txt.replace(NBSP, " "), w, psz, d.get("bold"), d.get("font")) <= 1:
                txt = txt.replace(NBSP, " ")   # it fits on one line: no glue needed (a no-break space can set wider in some fonts)
            run.text = txt
            f = run.font
            f.size, f.name = Pt(psz), d.get("font") or self.th.body
            f.bold, f.italic = bool(d.get("bold")), bool(d.get("italic"))
            f.color.rgb = _rgb(d.get("color") or self.p.fg)
            if d.get("track"):
                run._r.get_or_add_rPr().set("spc", str(int(d["track"] * 100)))
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
        return dict(t=glue(t), size=self.sz(size, cap), color=color, font=font, cap=cap, **kw)

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
        h = sum(_est_h(i, w - 0.3, size) for i in items) + (0.45 if title else 0)
        tb = sl.shapes.add_textbox(Inches(x), Inches(y), Inches(w), Inches(h))
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
        rh = [max(_est_h(c, w / nc - 0.15, size) for c in r) for r in rows]
        gs = sl.shapes.add_table(nr, nc, Inches(x), Inches(y), Inches(w), Inches(sum(rh)))
        t = gs.table
        widths = self._col_widths(rows, w)
        for j, cw in enumerate(widths):
            t.columns[j].width = Inches(cw)
        for i, r in enumerate(rows):
            t.rows[i].height = Inches(rh[i])
            for j, val in enumerate(r):
                c = t.cell(i, j)
                c.text = str(val)
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
        gf = sl.shapes.add_chart(XL_CHART_TYPE.BAR_CLUSTERED, Inches(x), Inches(y), Inches(w), Inches(h), cd)
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
        ser.format.fill.solid(); ser.format.fill.fore_color.rgb = _rgb(t_.accent)
        if hero:
            quiet = themes.blend(t_.mute, t_.paper, 0.45)
            for i, lab in enumerate(labels):
                pt = ser.points[i]
                pt.format.fill.solid()
                pt.format.fill.fore_color.rgb = _rgb(t_.accent if lab in hero else quiet)
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
        self.rect(sl, x, y, 0.09, h, fill=self.p.acc_f)
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
        self.rect(sl, x, y, 0.07, h, fill=self.p.acc_f)
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
        self.rect(sl, x, y, w, 0.05, fill=self.p.acc_f)
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
                self.rect(sl, cx, y, cw, 0.05, fill=self.p.acc_f)
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
                    self.rect(sl, cx, yy, rcw, 0.05, fill=p.acc_f)
                    top = yy + 0.05 + (hr - 0.05 - content) / 2
                    fh = self.ph(paras[:1], rcw - 0.5)
                    self.ptext(sl, cx + 0.25, top, rcw - 0.5, fh, paras[:1])
                    self.ptext(sl, cx + 0.25, top + fh, rcw - 0.5, content - fh, paras[1:])
                else:
                    self.rect(sl, cx, yy, rcw, hr, fill=p.card)
                    self.rect(sl, cx, yy, rcw, 0.05, fill=p.acc_f)
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
            self.rect(sl, x, y, 0.09, h, fill=p.acc_f)
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
            self.rect(sl, cx, y, 0.07, h, fill=p.acc_f)
            self.ptext(sl, cx + 0.35, top, tw, fig_h, [fig[i]], anchor="bottom")
            self.ptext(sl, cx + 0.35, top + fig_h + 0.06, tw, lab_h, lab[i])
        return h

    def _b_steps(self, sl, bl, x, y, w, sc):
        """Steps as a timeline strip: a rail with a marker per step and a card under each marker, label over
        text. Five or fewer in a row; more are split over two rails, each row spread over the full width (no
        empty cell). The cards stretch to ``self._minh``. On founders and team slides each step is a role row."""
        S, p = self.th.scale, self.p
        items = [(str(a), str(b)) for a, b in bl["items"]]
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
            self.rect(sl, x, yy + 0.095, span, 0.035, fill=p.acc_f)
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
            self.rect(sl, x + rw, yy, 0.07, h, fill=p.acc_f)
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
                self.rect(sl, cols[2][0], yy, 0.07, h, fill=p.acc_f)
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
        return tot

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
        gs = sl.shapes.add_table(nr, nc, Inches(x), Inches(y), Inches(w), Inches(sum(rh)))
        tbl = gs.table
        tblPr = tbl._tbl.tblPr
        for a in ("firstRow", "bandRow"):
            tblPr.set(a, "0")
        sid = tblPr.find(qn("a:tableStyleId"))
        if sid is not None:
            sid.text = NO_STYLE
        for j, cw_ in enumerate(cws):
            tbl.columns[j].width = Inches(cw_)
        for i, r in enumerate(rows):
            tbl.rows[i].height = Inches(rh[i])
            for j, val in enumerate(r):
                c = tbl.cell(i, j)
                c.margin_left = c.margin_right = Inches(0.14)
                c.margin_top = c.margin_bottom = Inches(0.04)
                c.vertical_anchor = MSO_ANCHOR.MIDDLE
                c.text_frame.word_wrap = True
                run = c.text_frame.paragraphs[0].add_run()
                run.text = val
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
        return getattr(self, fn)(sl, bl, x, y, w, sc, **kw)

    #: Block kinds whose look can take a minimum height (``Renderer._minh``): cards, panels, rows.
    STRETCH = ("bullets", "stats", "steps", "fromto", "callout", "card", "table")
    #: Scales a filling stack tries above 1.0 (largest first) before it stretches what is left.
    UPSCALES = (1.6, 1.45, 1.3, 1.2, 1.1)

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

        scales = (self.UPSCALES if fill else ()) + SCALES
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
        gap = 0.24 * sc
        extra, off = [0.0] * len(plan), 0.0
        slack = bottom - (y + total)
        if fill and slack > 0.05 and plan:
            idx = [k for k, r in enumerate(plan) if self._stretchable(r, stretch_all)]
            if idx:
                for k in idx:
                    extra[k] = slack / len(idx)
            else:
                off = min(slack / 2, 1.0)
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
        cands = ((S.title_min,) + ((24,) if self._relaxed else ())) if dense else (S.title, 32, S.title_long, S.title_min)   # relaxed: the last resort may go to 24 pt
        for want in ((1, 2) if dense else (2,)):   # dense: a one-line title if one fits at the floor size
            for size in cands:
                n = self.nlines(glue(s["title"]), w, size, True, self.th.head)
                if n <= want:
                    break
            if n <= want:
                break
        if n > 3:
            raise NoFit("title too long")
        top = (g.title_y - (0.1 if dense else 0.0)) if y is None else y
        h = n * size * 1.2 / 72 + 0.04
        if sl is not None:
            m = self._mark(sl)
            self.rect(sl, self.x0, g.top, 0.5, 0.06, fill=self.p.acc_f)
            tp = self.para(s["title"], size, self.p.fg, self.th.head, bold=True)
            bw = self.balance_w(tp["t"], w, size, True, self.th.head)
            self.ptext(sl, self.x0, top, bw, h, [tp], name="Title")
            self._build(sl, m, title=True)
        return top + h + (0.2 if dense else 0.3)

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

    def _lay_cover(self, sl, s):
        """Cover: dark, an accent rule, the title at display size, the lead text and caption under it."""
        S, p, g = self.th.scale, self.p, self.th.grid
        w = min(10.4, self.x1 - self.x0)
        blocks = [b for b in s["blocks"] if str(b.get("text", "")).strip()]
        if any(b["kind"] not in ("text", "small", "statement") for b in blocks):
            raise NoFit("cover holds text only")
        for size in (S.display, 40, 36, 32, 28):
            n = self.nlines(s["title"], w, size, True, self.th.head)
            if n <= 3:
                break
        else:
            raise NoFit("title too long")
        th_ = n * size * 1.2 / 72 + 0.04
        paras = []
        for b in blocks:
            if b["kind"] == "small":
                paras.append((self.para(str(b["text"]).strip(), S.small, p.mute, line=1.05), b))
            else:
                paras.append((self.para(str(b["text"]).strip(), S.lead, p.fg, line=1.05), b))
        block = th_ + 0.4 + sum(self.ph([pp], w) + 0.25 for pp, b in paras) - 0.25
        if block > g.body_end - 1.6:
            raise NoFit("cover too full")
        # the title block sits at the optical middle of the slide (a little above centre), never above 1.6 in
        y = max(1.6, (g.body_end + 1.0 - block) / 2 - 0.25)
        if sl is None:
            return
        m = self._mark(sl)
        logo = (self.deck["meta"].get("brand") or {}).get("logo_dark_png")
        self.rect(sl, self.x0, g.top, 0.5, 0.06, fill=p.acc_f)
        lx = self._logo(sl, 0.8)   # the brand's lockup for a dark ground, with the kicker label kept beside it
        self.ptext(sl, lx, 0.8 if lx == self.x0 else 1.1, 8, 0.3, [self.para(_kicker(self.deck["meta"]).upper(), S.caption, p.acc_t, bold=True, track=1.2, cap=True)])
        self.ptext(sl, self.x0, y, w, th_, [self.para(s["title"], size, p.fg, self.th.head, bold=True, line=1.0)], name="Title")
        self._build(sl, m, title=True)
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
        top += max(0.0, (avail - gh) / 2) * 0.85
        m = self._mark(sl)
        self.rect(sl, self.x0, g.top, 0.5, 0.06, fill=p.acc_f)
        if label:
            self.ptext(sl, self.x0, 0.8, 6, 0.3, [self.para(label, S.caption, p.acc_t, bold=True, track=1.2, cap=True)])
        self.ptext(sl, self.x0, top, tw, self.ph(tp, tw), tp, name="Title")
        self._build(sl, m, title=True)
        if bar:
            xr, wr, bp, bh = bar
            m = self._mark(sl)
            self.rect(sl, xr - 0.45, top, 0.012, max(bh, 2.0), fill=p.rule)
            self.rect(sl, xr, top, 0.09, max(bh, 1.2), fill=p.acc_f)
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
        fw = 5.9
        fx = self.x1 - fw
        lw = fx - self.x0 - g.G
        GAP = 0.4   # the fixed gap between the last line of copy and the closing answer
        for dense in (False, True):
            try:
                y = self.head(None, s, dense)
                fh = g.body_end - y
                note = []
                nh = 0.0
                if vis.get("kind") == "image_prompt":
                    note = [self.para("Image prompt (" + vis.get("status", "illustrative") + "): " + vis.get("prompt", ""), S.caption, p.mute, italic=True, cap=True)]
                    nh = self.ph(note, lw - 0.6) + 0.25
                self.stack(None, rest, self.x0 + 0.3, y + 0.3, lw - 0.6, g.body_end - 0.3 - nh, fill=True)
                for asz in (S.body, 15, S.small, 13, 12):
                    ans = [self.para(cp["answer"], asz, p.inv_acc, bold=True)]
                    ah = self.ph(ans, fw - 0.8)
                    try:
                        size = self.fit(lambda sz_: [self.para(l, sz_, p.inv_fg, self.th.head, line=1.1, after=10) for l in cp["lines"]], fw - 0.8, fh - 0.8 - ah - GAP, 26, 12)
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
            self.rect(sl, self.x0, y, lw, fh, fill=p.card)
            self.rect(sl, self.x0, y, lw, 0.05, fill=p.acc_f)
            self.stack(sl, rest, self.x0 + 0.3, y + 0.3, lw - 0.6, g.body_end - 0.3 - nh, fill=True)
            if note:
                self.ptext(sl, self.x0 + 0.3, g.body_end - 0.25 - (nh - 0.25), lw - 0.6, nh - 0.25, note, anchor="bottom")
            self._build(sl, m)
            m = self._mark(sl)
            lines = [self.para(l, size, p.inv_fg, self.th.head, line=1.1, after=10) for l in cp["lines"]]
            lh = self.ph(lines, fw - 0.8)
            self.rect(sl, fx, y, fw, fh, fill=p.inv)
            self.rect(sl, fx, y, 0.09, fh, fill=p.acc_f)
            top = y + (fh - (lh + GAP + ah)) / 2
            self.ptext(sl, fx + 0.4, top, fw - 0.8, lh, lines)
            self._build(sl, m)
            m = self._mark(sl)
            self.ptext(sl, fx + 0.4, top + lh + GAP, fw - 0.8, ah, ans)
            self._build(sl, m)
            return
        raise NoFit("execution slide too dense")

    def _lay_territory(self, sl, s):
        """Territory: the thought and reasons on the left, an illustrative sketch panel on the right. When the
        reasons are too long for the left column, the statement sits beside the panel and the reasons run
        full width underneath as cards."""
        S, p, g = self.th.scale, self.p, self.th.grid
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
            self.rect(sl_, px, y, 0.09, h, fill=p.acc_f)
            self.ptext(sl_, px + 0.4, y + 0.25, pw - 0.8, h - 0.85, [self.para(t, size, p.inv_fg, self.th.head, line=1.1, after=8) for t in parts], anchor="middle")
            self.ptext(sl_, px + 0.4, y + h - 0.5, pw - 0.8, 0.3, [self.para("Illustrative, not final", S.caption, p.inv_acc, italic=True, cap=True)])
            self._build(sl_, m)

        for dense in (False, True):
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
            self.rect(sl, self.x0, y, 0.09, H, fill=p.acc_f)
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

    LAYOUT_FN = {"objective_panel": "_lay_objective", "risk_cards": "_lay_risks", "cover": "_lay_cover", "emphasis_bar": "_lay_emphasis", "chart": "_lay_chart", "execution": "_lay_execution",
                 "territory": "_lay_territory", "quote_cards": "_lay_quote", "role_grid": "_lay_role", "flow": "_lay_flow"}

    def _rollback(self, sl, n_shapes, n_steps):
        """Remove what a layout drew before it gave up (shapes past ``n_shapes``, build steps past ``n_steps``)."""
        for sh in list(sl.shapes)[n_shapes:]:
            sh._element.getparent().remove(sh._element)
        del self.steps[n_steps:]

    # -- slides -------------------------------------------------------------------------------
    def render(self, out: Path):
        """Render every slide in order and save the .pptx."""
        nums = {sid: i for i, sid in enumerate(self.deck["order"], 1)}
        for sid in self.deck["order"]:
            self.slide(sid, self.deck["slides"][sid], nums[sid])
        self._sections()
        self.prs.core_properties.title = f"{self.deck['meta']['client']}: {self.deck['meta']['project']}"
        self.prs.core_properties.author = "Napkin Deck Maker"
        self.prs.save(str(out))
        return out

    def slide(self, sid, s, n):
        """One slide: background, then the layout chosen by ``choose_layout`` (the flow if it does not fit),
        footer, watermark, notes."""
        sl = self.prs.slides.add_slide(self.blank)
        dark = s["type"] in DARK_TYPES
        self.p = self._palette(dark)
        self.fg = self.p.fg
        bg = sl.background.fill
        bg.solid(); bg.fore_color.rgb = _rgb(self.p.bg)
        if not self.sections or self.sections[-1][0] != s["section"]:
            self.sections.append((s["section"], []))
        self.sections[-1][1].append(sl.slide_id)
        self._cur, self.steps = sl, []
        audience = self.deck["meta"].get("audience", "review")
        name = choose_layout(s, audience) if self.th.layouts else "flow"
        s = {**s, "blocks": shown_blocks(s, audience)}
        if name != "flow":
            n_sh, n_st = len(sl.shapes), len(self.steps)
            try:
                try:
                    getattr(self, self.LAYOUT_FN.get(name, "_lay_stack"))(sl, s)
                except NoFit:   # too dense at the body floor: once more with body text allowed down to the caption floor
                    self._rollback(sl, n_sh, n_st)
                    self._relaxed = True
                    try:
                        getattr(self, self.LAYOUT_FN.get(name, "_lay_stack"))(sl, s)
                    finally:
                        self._relaxed = False
            except NoFit:
                self._rollback(sl, n_sh, n_st)
                name = "flow"
        if name == "flow":
            self._relaxed = True   # the last resort: stepped down as far as the caption floor, never under it
            try:
                getattr(self, "_" + s["type"], self._generic)(sl, s)
            finally:
                self._relaxed = False
        self.layouts[sid] = name
        # footer: section label, footnote keys, slide number
        t, p = self.th, self.p
        foot = t.scale.foot
        if t.layouts:
            self.rect(sl, self.x0, 6.9, self.x1 - self.x0, 0.01, fill=p.rule)
        self.text(sl, self.x0, 7.0, 6, 0.3, s["section"].upper(), size=foot, cap=True, color=p.mute, name="Section")
        if s.get("footnotes"):
            self.text(sl, 6.2, 7.0, 5.6, 0.3, "Sources " + " ".join(f"[{k}]" for k in s["footnotes"][:14]) + "  (appendix)", size=foot, cap=True, color=p.mute, align=PP_ALIGN.RIGHT, name="Footnotes")
        self.text(sl, 12.1, 7.0, self.x1 - 12.1, 0.3, str(n), size=foot, cap=True, color=p.mute, align=PP_ALIGN.RIGHT, name="SlideNumber")
        if self.n_human:
            tag = "DRAFT · needs a person" if s["status"] == "needs_human" else f"DRAFT · {self.n_human} slides need a person"
            self.text(sl, 8.7, 0.12, self.x1 - 8.7, 0.3, tag, size=foot, cap=True, color=p.acc_t, bold=True, align=PP_ALIGN.RIGHT, name="Watermark")
        if sid in self.failed:
            red = "FF9B8E" if dark else "B03225"
            self.text(sl, 4.5, 0.12, 4.1, 0.3, "CHECK FAILED: " + ", ".join(sorted(set(self.failed[sid]))), size=foot, cap=True, color=red, bold=True, align=PP_ALIGN.RIGHT, name="CheckFailed")
        sl.notes_slide.notes_text_frame.text = (s.get("notes") or "") + f"\n\nSlide id {sid} · status {s['status']} · requirements {', '.join(s.get('requirements') or []) or 'none'}"
        if t.layouts and s.get("claims"):   # the claims stay in the file, in the notes, word for word
            sl.notes_slide.notes_text_frame.text += "\n\nClaims:\n" + "\n".join("- " + c["text"] for c in s["claims"])
        if s["type"] == "appendix":
            self.hiding = True
        if getattr(self, "hiding", False):   # the appendix stays in the file, hidden from the slideshow
            sl._element.set("show", "0")
        if self.animate:
            self._animate(sl)

    # -- the earlier flow (the fallback, and every slide under the classic theme) ----------------
    def _title_text(self, sl, s, size=30, y=0.5, w=None):
        """The slide's takeaway title (a full sentence)."""
        w = w or (self.x1 - self.x0)
        h = _est_h(s["title"], w, size, 1.1)
        m = self._mark(sl)
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
                sz = 24 * scale; h = _est_h(tx, w, sz, 1.15)
                self.text(sl, x, y, w, h, tx, size=sz, font=t.head); y += h + 0.2
            elif k == "quote":
                sz = 26 * scale; h = _est_h(tx, w, sz, 1.15)
                self.text(sl, x, y, w, h, tx, size=sz, italic=True, font=t.head, color=p.acc_t); y += h + 0.2
            elif k == "text":
                sz = 18 * scale; h = _est_h(tx, w, sz)
                self.text(sl, x, y, w, h, tx, size=sz); y += h + 0.18
            elif k == "small":
                sz = 13 * scale; h = _est_h(tx, w, sz)
                self.text(sl, x, y, w, h, tx, size=sz, color=p.mute); y += h + 0.12
            elif k == "callout":
                sz = 17 * scale; h = _est_h(tx, w - 0.4, sz) + 0.3
                self.box(sl, x, y, w, h, t.panel)
                self.text(sl, x + 0.2, y + 0.12, w - 0.4, h - 0.2, tx, size=sz, color=t.ink, anchor=MSO_ANCHOR.MIDDLE); y += h + 0.2
            elif k == "card":
                sz = 16 * scale; h = _est_h(tx, w - 0.4, sz) + 0.6
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
                    h = _est_h(val, w - 1.6, 15 * scale)
                    self.text(sl, x + 1.6, y, w - 1.6, h, val, size=15 * scale); y += max(h, 0.35) + 0.12
            elif k == "fromto":
                cw = (w - 0.8) / 2; sz = 16 * scale
                h = max(_est_h(bl["from"], cw - 0.4, sz), _est_h(bl["to"], cw - 0.4, sz)) + 0.5
                for i, (lab, val) in enumerate((("From", bl["from"]), ("To", bl["to"]))):
                    bx = x + i * (cw + 0.8)
                    self.box(sl, bx, y, cw, h, t.panel if i == 0 else t.ink)
                    col = t.ink if i == 0 else t.on_dark
                    self.text(sl, bx + 0.2, y + 0.1, cw - 0.4, 0.3, lab.upper(), size=10, bold=True, color=t.mute if i == 0 else t.accent_on_dark)
                    self.text(sl, bx + 0.2, y + 0.4, cw - 0.4, h - 0.45, val, size=sz, color=col)
                ar = sl.shapes.add_shape(MSO_SHAPE.RIGHT_ARROW, Inches(x + cw + 0.2), Inches(y + h / 2 - 0.15), Inches(0.4), Inches(0.3))
                ar.fill.solid(); ar.fill.fore_color.rgb = _rgb(p.acc_f); ar.line.fill.background()
                y += h + 0.25
            elif k == "stats":   # up to three big numbers, each with its label
                n = max(1, len(bl["items"])); gap = 0.3; cw = (w - gap * (n - 1)) / n
                for i, it in enumerate(bl["items"]):
                    bx = x + i * (cw + gap)
                    bar = sl.shapes.add_shape(MSO_SHAPE.RECTANGLE, Inches(bx), Inches(y), Inches(cw), Inches(0.06))
                    bar.fill.solid(); bar.fill.fore_color.rgb = _rgb(p.acc_f); bar.line.fill.background()
                    self.text(sl, bx, y + 0.15, cw, 0.8, it["value"], size=40 * scale, bold=True, font=t.head)
                    self.text(sl, bx, y + 0.95, cw, 0.6, it["label"], size=13 * scale, color=p.mute)
                y += 1.7
            elif k == "steps":
                n = len(bl["items"]); gap = 0.2; cw = (w - gap * (n - 1)) / n; sz = 15 * scale
                h = max(_est_h(v, cw - 0.3, sz) for _, v in bl["items"]) + 0.75
                for i, (lab, val) in enumerate(bl["items"]):
                    bx = x + i * (cw + gap)
                    self.box(sl, bx, y, cw, h, t.panel)
                    self.text(sl, bx + 0.15, y + 0.12, cw - 0.3, 0.3, f"{i + 1:02d}", size=11, bold=True, color=t.accent_ink)
                    self.text(sl, bx + 0.15, y + 0.38, cw - 0.3, 0.4, lab, size=13 * scale, bold=True, color=t.ink)
                    self.text(sl, bx + 0.15, y + 0.72, cw - 0.3, h - 0.8, val, size=sz, color=t.ink)
                y += h + 0.2
            self._build(sl, m, "wipe" if k in ("fromto", "steps") else "fade")
        return y

    def _logo(self, sl, y) -> float:
        """Place the brand's own dark-ground logo (``meta.brand.logo_dark_png``) at ``y`` with alt text and the
        name "Logo". Returns the x where the kicker label should start: beside the logo, or the left margin
        when the brand has no logo file."""
        logo = (self.deck["meta"].get("brand") or {}).get("logo_dark_png")
        if not (logo and _is_image(logo)):
            return self.x0
        try:
            pic = sl.shapes.add_picture(str(logo), Inches(self.x0), Inches(y), height=Inches(0.9))
        except Exception:   # a corrupt image degrades to no logo
            return self.x0
        pic.name = "Logo"
        pic._element.nvPicPr.cNvPr.set("descr", f"{self.deck['meta'].get('client', 'Brand')} logo")
        return self.x0 + Emu(pic.width).inches + 0.3

    def _flow_human(self, sl, x, y, w, text, size) -> float:
        """One human-flagged bullet in the flow: a dashed card with the PROPOSED tag and the TO SUPPLY chip, so a
        placeholder is never styled as finished even when its layout fell back. Returns the height used."""
        p = self.p
        h = 0.55 + _est_h(text, w - 0.5, size) + 0.1
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
        h = _est_h(s["title"], 11.5, 40, 1.1)
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


def render(deck, inp, out: Path, master: Path | None = None, findings: list | None = None, animate=False, theme=themes.DEFAULT) -> Path:
    """Render a deck to ``out`` (.pptx); slides with a failed check carry a visible flag.

    ``animate``: False (static), True or ``"auto"`` (builds play in order), ``"click"`` (one block per click).
    ``theme``: ``"napkin"`` (default, the layout library) or ``"classic"`` (the earlier look, flow only);
    the deck's brand JSON is applied over either, exactly as before.
    """
    return Renderer(deck, inp, master, findings, animate, theme).render(out)
