"""Render deck.json to one self-contained, animated web deck (deck.html). Deterministic, no model.

The web twin of render_pptx: same slide order, layouts per slide type, theme, footer, DRAFT and
failed-check flags, and the evidence notes. One file with inline CSS and JS and no network
requests, so it can be emailed, attached or hosted as is.

Motion: each block reveals in reading order when its slide enters (rise and fade, list items and
table rows staggered, bars grow with counting values, the from/to arrow draws). Press B for build
mode, where each block waits for a click like a PowerPoint build. Delays are fixed in the markup
(``--d``), so the same deck.json always gives the same choreography.

Keys: arrows / space / page keys to move (a pitch's story ends at its last presented slide; A opens
the appendix and returns), B build mode, O overview, N notes, P presenter view
(opens an audience window kept in sync), F fullscreen. Printing gives one slide per page.

``slide_views`` is shared with render_hyperframes, which drives the same markup with GSAP.
"""
from __future__ import annotations

import base64
import html
import json
import re
from pathlib import Path

from . import export_clean, images, numfmt, spec
from . import theme as themes
from .refs import fmt
from .layouts import picture_sides as _pic_sides
from .render_pptx import DARK_TYPES, THEME, _kicker, band_label, dark_types
from .spec import blocks_sha, frame_for, shown_blocks

#: The accent is 2.2:1 on white, so accent-coloured text on light slides uses a darker amber
#: (--accent-ink, 5.9:1 on white, 5.2:1 on the tint); dark slides keep the accent (7.3:1 on ink).
KICKERS = {"title": None, "real_question": "The real question", "idea": "The idea"}   # title: _kicker(meta)
HEAD_FONT = "Cambria, Charter, 'Iowan Old Style', Georgia, serif"
BODY_FONT = "Calibri, Carlito, 'Segoe UI', 'Helvetica Neue', Arial, sans-serif"


_STRIKE = re.compile(r"~~(.+?)~~", re.S)


def _a(t) -> str:
    """Escape text for an HTML attribute or the page title: money as people write it, a ``~~struck~~`` word plain (no markup in an attribute)."""
    return _STRIKE.sub(r"\1", html.escape(numfmt.format_text(str(t)), quote=True))


def _e(t) -> str:
    """Escape text for HTML. A ``~~word~~`` the copy wrote is a real strike-through (``<s>``), never the tildes."""
    return _STRIKE.sub(r"<s>\1</s>", html.escape(numfmt.format_text(str(t)), quote=True)).replace("~~", "")   # money as people write it, at render time only


def chart_rows(series: list, inp) -> list:
    """(label, display value, bar width 0-100, number, suffix) per bar, values from fact refs."""
    rows = []
    for s in series:
        row = inp.doc_facts.get(s["ref"]) or inp.facts.get(s["ref"]) or {}
        v = row.get("value")
        if not isinstance(v, (int, float)) or isinstance(v, bool):
            rows.append((s["label"], "n/a", 0, None, ""))
            continue
        pct = row.get("unit") == "proportion"
        rows.append((s["label"], fmt(row), v * 100 if pct else v, round(v * 100 if pct else v, 1), "%" if pct else ""))
    top = max([r[2] for r in rows] + [0])
    if any(r[4] != "%" for r in rows) and top:   # not all shares: scale to the largest bar
        rows = [(a, b, w * 100 / top, n, sfx) for a, b, w, n, sfx in rows]
    return rows


class _Slide:
    """Builds one slide's markup, handing out reveal delays (ms) and build steps (one per block)."""

    def __init__(self, inp):
        self.inp, self.t, self.f = inp, 0, 0
        self.last = {0: 0}   # build step -> latest reveal delay in it (ms)
        self.icons = None    # deck-graphics: the ids of the icons the pptx drew on this slide, in item order (None: none)

    def icon(self, i: int, n: int, size_in: float) -> str:
        """The inline SVG of item ``i`` of ``n`` when the pptx drew an icon group of exactly ``n`` here, else ''."""
        if not self.icons or len(self.icons) != n:
            return ""
        from . import graphics   # noqa: PLC0415
        return graphics.icon_svg(self.icons[i], size_in)

    def rv(self, cls, inner, tag="div", gap=140, attrs=""):
        """One revealing element: delay from the running clock, build step from the current block."""
        d = self.t
        self.t += gap
        self.last[self.f] = max(self.last.get(self.f, 0), d)
        return f'<{tag} class="rv {cls}" style="--d:{d}ms" data-d="{d}" data-f="{self.f}"{attrs}>{inner}</{tag}>'

    def words(self, text, cls, tag="p", gap=38):
        """Text revealed word by word (big statements and dark-slide titles)."""
        out = []
        for w in str(text).split():
            out.append(f'<span class="w" style="--d:{self.t}ms" data-d="{self.t}">{_e(w)}</span>')
            self.last[self.f] = max(self.last.get(self.f, 0), self.t)
            self.t += gap
        self.t += 120
        return f'<{tag} class="ws {cls}" data-f="{self.f}">{" ".join(out)}</{tag}>'

    def blocks(self, blocks):
        """Markup for a list of blocks, each its own build step."""
        return "".join(self.block(b) for b in blocks)

    def block(self, b):
        """One block by kind (mirrors render_pptx._flow)."""
        k, t = b["kind"], str(b.get("text", "")).strip()
        if k in ("text", "small", "statement", "quote", "callout") and not t:
            return ""
        self.f += 1
        hum = (" human" if b.get("human") else "") + (" internal" if b.get("internal") else "")
        if k == "statement":
            return self.words(t, "b-statement" + hum)
        if k == "quote":
            return self.rv("b-quote" + hum, _e(t), "blockquote", 200)
        if k in ("text", "small", "callout"):
            return self.rv(f"b-{k}{hum}", _e(t), "div" if k == "callout" else "p")
        if k == "card":
            return self.rv("b-card" + hum, f'<div class="cap">{_e(b.get("title", ""))}</div><p>{_e(t)}</p>')
        if k == "bullets":
            head = self.rv("b-cap", _e(b["title"]), "p", 100) if b.get("title") else ""
            items = "".join(
                self.rv("human" if isinstance(i, dict) and i.get("human") else "", _e(i["text"] if isinstance(i, dict) else i), "li", 90)
                for i in b["items"])
            return f'<div class="b-bullets{hum}">{head}<ul>{items}</ul></div>'
        if k == "table":
            rows = b["rows"]
            head = self.rv("", "".join(f"<th>{_e(c)}</th>" for c in rows[0]), "tr", 80)
            body = "".join(self.rv("", "".join(f"<td>{self._row_icon(n, len(rows) - 1) if j == 0 else ''}{_e(c)}</td>" for j, c in enumerate(r)), "tr", 55)
                           for n, r in enumerate(rows[1:]))
            return f'<table class="b-table{" small" if b.get("small") else ""}{hum}"><thead>{head}</thead><tbody>{body}</tbody></table>'
        if k == "kv":
            return '<dl class="b-kv">' + "".join(
                self.rv("", f"<dt>{_e(key)}</dt><dd>{_e(val)}</dd>", gap=120) for key, val in b["items"]) + "</dl>"
        if k == "fromto":
            a = self.rv("ft from", f'<div class="cap">From</div><p>{_e(b["from"])}</p>', gap=260)
            arrow = self.rv("ft-arrow", '<svg viewBox="0 0 80 40" aria-hidden="true"><path d="M4 20H70M54 6l16 14-16 14"/></svg>', gap=260)
            z = self.rv("ft to", f'<div class="cap">To</div><p>{_e(b["to"])}</p>')
            return f'<div class="b-fromto{hum}">{a}{arrow}{z}</div>'
        if k == "steps":
            cells = "".join(
                self.rv("step", f'<div class="no">{i + 1:02d}</div><div class="lab">{_e(lab)}</div><p>{_e(" ".join(map(str, val)))}</p>', gap=120)
                for i, (lab, *val) in enumerate(b["items"]))
            return f'<div class="b-steps" style="--n:{len(b["items"])}">{cells}</div>'
        if k == "chart":
            ch = b["chart"]
            cap = self.rv("b-cap", _e(ch["title"]), "p", 100) if ch.get("title") else ""
            rows = {r[0]: r for r in chart_rows(ch["series"], self.inp)}
            hero = "".join(
                self.rv("hero", f'<b class="big val"{"" if rows[h][3] is None else f" data-v={rows[h][3]:g} data-sfx={rows[h][4]!r}"}>{_e(rows[h][1])}</b>'
                                f'<span>{_e(h)}</span>', gap=420)
                for h in ch.get("hero") or [] if h in rows)
            cap = (f'<div class="b-hero">{hero}</div>' if hero else "") + cap
            bars = "".join(
                self.rv("bar", f'<span class="lab">{_e(lab)}</span><span class="track"><i style="width:{w:.1f}%"></i></span>'
                               f'<b class="val"{"" if n is None else f" data-v={n:g} data-sfx={sfx!r}"}>{_e(shown)}</b>', gap=110)
                for lab, shown, w, n, sfx in chart_rows(ch["series"], self.inp))
            return f'<div class="b-chart">{cap}{bars}</div>'
        if k == "stats":
            cells = "".join(self.rv("stat", f'<b class="big">{_e(x.get("value", ""))}</b><span>{_e(x.get("label", ""))}</span>', gap=220) for x in b["items"])
            return f'<div class="b-stats" style="--n:{max(1, len(b["items"]))}">{cells}</div>'
        if k == "sketch":
            lines = "".join(f"<p>{_e(x)}</p>" for x in t.split("  ->  "))
            return self.rv("frame sketch", f'{lines}<div class="note">Illustrative, not final</div>', gap=200)
        if k == "copy":
            return self.mock(b)
        return self.rv("b-text" + hum, _e(t), "p") if t else ""


    def _row_icon(self, i: int, n: int) -> str:
        if not self.icons:
            return ""
        from . import graphics   # noqa: PLC0415
        return self.icon(i, n, graphics.ICON_ROW_IN)

    def mock(self, b):
        """The copy in the frame of its channel (b["frame"]: phone, search, audio, poster)."""
        fr, lines, ans = b.get("frame"), b["lines"], b["answer"]
        note = '<div class="mock-note">Illustrative, not final</div>'
        if fr == "phone":
            body = "".join(self.rv("", _e(x), "p", 220) for x in lines) + self.rv("answer", _e(ans), "p")
            return f'<div class="mock-wrap"><div class="phone"><div class="notch"></div><div class="screen">{body}</div></div>{note}</div>'
        if fr == "search":
            q = next((x.split(":", 1)[1].strip(" '\"") for x in lines if x.lower().startswith("query:")), "")
            ad = [x for x in lines if not x.lower().startswith("query:")]
            heads = [x.split(":", 1)[1].strip() for x in ad if x.lower().startswith("headline:")]
            rest = [x.split(":", 1)[1].strip() if x.lower().split(":")[0] in ("ad", "description") else x for x in ad if not x.lower().startswith("headline:")]
            ad = ([" | ".join(heads)] if heads else []) + rest
            bar = self.rv("q", '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="10" cy="10" r="6.5"/><path d="M15 15l6 6"/></svg>' + _e(q), gap=260)
            card = self.rv("ad", '<span class="sp">Sponsored</span>' + "".join(f'<p class="{"h" if i == 0 and heads else "d"}">{_e(x)}</p>' for i, x in enumerate(ad))
                           + f'<p class="lp">{_e(ans)}</p>', gap=200)
            return f'<div class="mock-wrap"><div class="serp">{bar}{card}</div>{note}</div>'
        if fr == "audio":
            secs = next((int(w) for w in str(ans).split() if w.isdigit()), None)
            bars = "".join(f'<i style="height:{h}%"></i>' for h in "30 73 73 41 32 46 58 30 76 87 50 46 45 34 30 65 84 53 56 73 49 30 43 65 49 58 88 67 32 42 35 40 52 85 73 34 66 54 31 38 66 66 35 79".split())
            head = self.rv("wave", bars, gap=200) + self.rv("time", f"<span>0:00</span><span>{f'0:{secs:02d}' if secs else ''}</span>", gap=160)
            body = "".join(self.rv("", _e(x), "p", 200) for x in lines)
            return f'<div class="mock-wrap"><div class="audio">{head}<div class="script">{body}</div>{self.rv("answer", _e(ans), "p")}</div>{note}</div>'
        if fr == "poster":
            body = "".join(self.rv("line", _e(x), "p", 260) for x in lines) + self.rv("answer", _e(ans), "p")
            return f'<div class="mock-wrap"><div class="poster">{body}</div>{note}</div>'
        body = "".join(self.rv("", _e(x), "p", 160) for x in lines)
        return f'<div class="frame copy">{body}{self.rv("answer", _e(ans), "p")}</div>'


def _mockup(im: dict | None = None, label: str = "") -> str:
    """The labels under a frame or a strip: the picture's own (unless approved), then the fixed 'Mock-up'."""
    own = ""
    if im is not None and im.get("status") != "approved":
        flagged = im.get("status") == "flagged"
        own = f'<span class="mockup own{" flagged" if flagged else ""}">{_e(images.picture_label(im, label) + (" · Flagged" if flagged else ""))}</span>'
    return own + f'<span class="mockup">{_e(spec.MOCKUP_LABEL)}</span>'


def _framed_markup(s: dict, got: list, deck: dict, fig, label: str) -> tuple | None:
    """deck-graphics on the web: the storyboard strip (3 or 4 shots, numbered, 'Mock-up') or the picture in its drawn frame (CSS boxes
    around the picture at the window's exact aspect, the labels under the frame). None: no frame for this picture (drawn as before)."""
    from . import graphics   # noqa: PLC0415
    if not graphics.part_on(deck, "mockups"):
        return None
    fm = (s.get("ooh") or {}).get("formats") or []
    cells = [(f, im) for f in fm for slot, im in got if slot == f.get("slot")]
    if cells and spec.GRAPHICS:   # out of home: every format Production made, each in its own frame at its own aspect, named under it
        frs = [graphics.frame_of(deck, spec.picture_of(s)[1], im) for _, im in cells]
        if all(frs):
            hpx = min(330.0, 1500.0 / sum(fr["ratio"] for fr in frs))
            html_cells = ""
            for (f, im), fr in zip(cells, frs):
                figure = fig(f["slot"], im, f"width:100%;aspect-ratio:{fr['ratio']:.4f}").replace('class="pic', 'class="pic framed', 1)
                html_cells += (f'<div class="ooh-cell" style="width:{fr["ratio"] * hpx:.0f}px"><div class="frame-wrap f-{fr["kind"]}">{figure}<i class="f-stand"></i></div>'
                               f'<p class="ooh-name">{_e(f.get("name") or "")}</p></div>')
            return (f'<div class="pics ooh-row">{html_cells}</div><div class="pics sb-pills f-pills">{_mockup(cells[0][1], label)}</div>', "pic-ooh")
    shots = [(slot, im) for slot, im in got if slot.startswith("shot_")]
    if len(shots) >= spec.STRIP_MIN:   # a strip across the foot of the slide: each frame at its own aspect, numbered, with its caption
        st = s.get("strip") or {}
        nums = st.get("shots") if len(st.get("shots") or []) == len(shots) else list(range(1, len(shots) + 1))
        caps = st.get("captions") if len(st.get("captions") or []) == len(shots) else [""] * len(shots)
        assets = deck.get("assets") or {}

        def ratio(im):   # each frame keeps its own aspect, as the pptx draws it
            a = assets.get(im.get("asset")) or {}
            return f'{a["width"] / a["height"]:.4f}' if a.get("width") and a.get("height") else im["aspect"].replace(":", "/")
        cells = "".join(f'<div class="sb-cell">{fig(slot, im, "width:100%;aspect-ratio:" + ratio(im))}<div class="sb-n"><b>{n}</b><i></i></div>'
                        f'<p class="sb-cap">{_e(c)}</p></div>' for n, c, (slot, im) in zip(nums, caps, shots))
        note = f'<span class="sb-note">{_e(st["note"])}</span>' if st.get("note") else ""
        return (f'<div class="pics strip sb-strip" style="grid-template-columns:repeat({len(shots)},1fr)">{cells}</div>'
                f'<div class="pics sb-pills f-pills">{_mockup(shots[0][1], label)}{note}</div>', "pic-sb")
    pic = next(((slot, im) for slot, im in got if slot == "picture"), None)
    fr = graphics.frame_of(deck, spec.picture_of(s)[1], pic[1]) if pic else None
    if not fr:
        return None
    slot, im = pic
    r = fr["ratio"]
    w = 360 if r < 0.8 else 460   # the frame's bezel and labels take the class's extra 100 px (PIC_CSS pw460 / pw560)
    style = f"width:{w}px;aspect-ratio:{r:.4f}"
    figure = fig(slot, im, style).replace('class="pic', 'class="pic framed', 1)
    return (f'<div class="pics side"><div class="frame-wrap f-{fr["kind"]}">{figure}'
            f'<i class="f-stand"></i><div class="f-pills">{_mockup(im, label)}</div></div></div>', f"pic-side pw{w + 100}")


def data_uri(aid: str, path: Path) -> str:
    """A picture inline (deck.html stays one self-contained file): the derived JPEG as a data URI."""
    return "data:image/jpeg;base64," + base64.b64encode(Path(path).read_bytes()).decode()


#: Side picture widths in px on the 1920 by 1080 stage, by aspect (tall pictures are given a height): the web twin of render_pptx.SIDE.
PIC_SIDE = {"16:9": 560, "4:3": 500, "4:5": 460, "9:16": 360}


def picture_markup(sid: str, s: dict, drawn: dict, pictures: dict, src, label: str, deck: dict | None = None) -> tuple:
    """The picture figures for one slide and the class the slide takes: ``(html, class)``, or ``("", "")`` when nothing is drawn. One
    markup for deck.html and HyperFrames (``src`` makes the image address). Cover-crop with object-fit, alt text, and the label on every
    picture not yet approved (a flagged one also named Flagged and outlined)."""
    got = sorted((slot, im) for (i, slot), im in drawn.items() if i == sid and im["asset"] in pictures)
    if not got:
        return "", ""

    def fig(slot, im, style=""):
        flagged = im.get("status") == "flagged"
        pos = f' style="object-position:{round(im["focal"]["x"] * 100)}% {round(im["focal"]["y"] * 100)}%"' if im.get("focal") else ""
        tag = ""
        if im.get("status") != "approved":
            tag = f'<figcaption class="plabel{" flagged" if flagged else ""}">{_e(images.picture_label(im, label) + (" · Flagged" if flagged else ""))}</figcaption>'
        return (f'<figure class="pic{" flagged" if flagged else ""}" data-slot="{_a(slot)}" style="{style}">'
                f'<img src="{_a(src(im["asset"], pictures[im["asset"]]))}" alt="{_a(im.get("alt") or "An illustrative picture")}"{pos}>{tag}</figure>')

    if s["type"] == "territory":
        return '<div class="pics strip">' + "".join(fig(slot, im) for slot, im in got) + "</div>", "pic-strip"
    if spec.GRAPHICS and deck is not None and spec.picture_of(s)[0] == "execution":   # deck-graphics: frames and the storyboard strip
        got_framed = _framed_markup(s, got, deck, fig, label)
        if got_framed:
            return got_framed
    slot, im = got[0]
    a = im["aspect"]
    w = PIC_SIDE[a]
    ar = images.ratio(a)
    style = f"width:{w}px;aspect-ratio:{a.replace(':', '/')}"
    return f'<div class="pics side">{fig(slot, im, style)}</div>', f"pic-side pw{w}"


def _body(s, b: _Slide, blocks: list, pictured: bool = False) -> str:
    """The slide body for its type (mirrors render_pptx's per-type layouts)."""
    typ = s["type"]
    pick = lambda kind: next((x for x in blocks if x["kind"] == kind), None)
    rest = lambda kind: [x for x in blocks if x["kind"] != kind]
    if typ == "chart" and pick("chart"):
        left = b.blocks([pick("chart")])
        return f'<div class="body split chart"><div class="col">{left}</div><div class="col">{b.blocks(rest("chart"))}</div></div>'
    if typ in ("territory", "territory_choice") and pick("sketch"):
        left = b.blocks(rest("sketch"))
        return f'<div class="body split side"><div class="col">{left}</div><div class="col">{b.blocks([pick("sketch")])}</div></div>'
    if typ == "execution" and pick("copy"):
        left = b.blocks(rest("copy"))
        copy = {**pick("copy"), "frame": None if (s.get("ooh") or s.get("strip")) else frame_for(s["title"])}   # a slide with its own frames (out of home, a strip) sets its copy as plain text: a poster or phone beside them took the frames' ground
        vis = s.get("visual") or {}
        if vis.get("kind") == "image_prompt" and not pictured:   # a drawn picture takes the place of the 'Image prompt' note
            b.f += 1
            left += b.rv("b-prompt", _e(f"Image prompt ({vis.get('status', 'illustrative')}): {vis.get('prompt', '')}"), "p")
        return f'<div class="body split exec{" framed" if copy["frame"] else ""}"><div class="col">{left}</div><div class="col">{b.blocks([copy])}</div></div>'
    return f'<div class="body col">{b.blocks(blocks)}</div>'


# ---- deck-look steps 3-4 on the web (spec.LOOK_V3): the same layouts as render_pptx, in CSS ------------------------------------------
#: The layouts the web draws with their own markup under LOOK_V3 (the rest keep the per-type bodies until step 9 paints from plan boxes).
V3_WEB = ("statement_points", "reframe", "shift_line", "picture_column", "cover_image", "close", "cover_bleed", "full_bleed_statement")
PX_IN = 144   # px per inch on the 1920 x 1080 web slide


#: deck-graphics (slices 4-8): the chart and diagram layouts the web draws with their own markup under spec.GRAPHICS.
GRAPHICS_WEB = ("chart", "chart_full", "process_chevrons", "timeline_strip", "matrix_2x2", "journey_row", "grid_points")


def _web_ids() -> tuple:
    return V3_WEB + (GRAPHICS_WEB if spec.GRAPHICS else ())


def _graphics_body(s, b: "_Slide", bl: list, lid: str, deck: dict | None = None) -> str:
    """deck-graphics on the web: the same chart (inline SVG from the same ledger points, its source line, a 'Show data' table) and the same
    diagrams (boxes with real, selectable text) as the pptx, from the slide's own blocks. '' when the slide does not hold one (the caller
    then draws the blocks as before)."""
    from . import graphics, layouts   # noqa: PLC0415
    from .refs import Resolver   # noqa: PLC0415
    t = s["title"]
    title = b.rv("title", _e(t), "h1", 220)
    notes = "".join(b.rv("g-note", _e(str(x.get("text", "")).strip()), "p", 100) for x in bl
                    if x["kind"] in ("text", "small", "statement") and str(x.get("text", "")).strip())
    icon = lambda i, n, sz: b.icon(i, n, sz) if b.icons else ""   # noqa: E731
    if lid in ("chart", "chart_full"):
        ch = next((x for x in bl if x["kind"] == "chart"), None)
        if ch is None:
            return ""
        got = graphics.chart_form(ch["chart"], b.inp, Resolver(b.inp))
        src = graphics.source_line(got["points"], b.inp) if got["form"] in graphics.CHART_FORMS else None
        if not src:
            return ""
        from .theme import DEFAULT as _D, get_theme   # noqa: PLC0415
        th = get_theme(_D, ((deck or {}).get("meta") or {}).get("brand") or {})   # the deck's own theme, as the pptx; chart_marks checks 3:1
        cols = graphics.chart_marks(got["form"], got["points"], ch["chart"].get("hero"), th)
        b.f += 1
        svg = b.rv("", graphics.chart_svg(got["form"], got["points"], cols, src, ch["chart"].get("title") or t), "div", 300)
        side = "".join(b.rv("g-cm", _e(str(x.get("text") or "")), "p", 120) for x in bl if x["kind"] in ("text", "small", "statement", "callout") and str(x.get("text") or "").strip())
        side += "".join(b.rv("g-cm", _e(layouts._item_text(i)), "p", 100) for x in bl if x["kind"] == "bullets" for i in x["items"] if layouts._item_text(i).strip())
        return f'<div class="body v3 g-chartsl{" full" if lid == "chart_full" else ""}">{title}<div class="g-cols"><div>{svg}</div><div class="g-side">{side}</div></div></div>'
    items = graphics.steps_of(bl)
    if lid == "process_chevrons" and items:
        b.f += 1
        cells = "".join(f'<div class="g-step">{icon(i, len(items), graphics.ICON_STEP_IN)}<div class="g-chev{" first" if i == 0 else ""}">{_e(it[0])}</div>'
                        f'<p>{_e(" ".join(c for c in it[1:] if c))}</p></div>' for i, it in enumerate(items))
        return f'<div class="body v3 g-diag">{title}<div class="g-proc" style="--n:{len(items)}">{b.rv("g-in", cells, "div", 300)}</div>{notes}</div>'
    if lid == "timeline_strip" and items and layouts.timed_3_8(s, bl):
        j = 1 if all(len(it) > 1 and graphics.is_time(it[1]) for it in items) else 0
        b.f += 1
        cells = "".join(f'<div class="g-ph"><b>{_e(" ".join(c for k, c in enumerate(it) if k != j and c))}</b><i class="g-node{" first" if i == 0 else ""}"></i>'
                        f'<span>{_e(it[j])}</span></div>' for i, it in enumerate(items))
        return f'<div class="body v3 g-diag">{title}<div class="g-tl" style="--n:{len(items)}">{b.rv("g-in", cells, "div", 300)}</div>{notes}</div>'
    if lid == "journey_row" and items:
        b.f += 1
        cells = "".join(f'<div class="g-stage"><div class="g-pill">{_e(it[0])}</div>{icon(i, len(items), graphics.ICON_STEP_IN)}'
                        f'<div class="kick">{_e(it[2] if len(it) > 2 else "")}</div><p>{_e(" ".join(c for c in [it[1]] + it[3:] if c))}</p></div>'
                        for i, it in enumerate(items))
        return f'<div class="body v3 g-diag">{title}<div class="g-jr" style="--n:{len(items)}">{b.rv("g-in", cells, "div", 300)}</div>{notes}</div>'
    if lid == "matrix_2x2":
        tb = next((x for x in bl if x["kind"] == "table" and graphics.matrix_ok(x)), None)
        if tb is None:
            return ""
        m = tb["matrix"]
        q = lambda k: "".join(f"<p>{_e(i)}</p>" for i in m["cells"].get(k) or [])   # noqa: E731
        b.f += 1
        grid = (f'<div class="g-q lh">{q("lh")}</div><div class="g-q hh">{q("hh")}</div><div class="g-q ll">{q("ll")}</div><div class="g-q hl">{q("hl")}</div>'
                f'<span class="g-ax xl">{_e(m["x"]["low"])}</span><span class="g-ax xh">{_e(m["x"]["high"])} · {_e(m["x"]["label"])}</span>'
                f'<span class="g-ax yh">{_e(m["y"]["high"])} · {_e(m["y"]["label"])}</span><span class="g-ax yl">{_e(m["y"]["low"])}</span>')
        return f'<div class="body v3 g-diag">{title}<div class="g-mx-wrap">{b.rv("g-mx", grid, "div", 300)}<div class="g-side">{notes}</div></div></div>'
    if lid == "grid_points":
        pts = layouts.statement_points(bl) or []
        if not pts:
            return ""
        cells = ""
        for i, x in enumerate(pts):
            b.f += 1
            cells += b.rv("g-gp", icon(i, len(pts), graphics.ICON_POINT_IN) + f'<b>{_e(x["heading"])}</b><p>{_e(x["text"])}</p>', "div", 140)
        return f'<div class="body v3 g-diag">{title}<div class="g-grid{" two" if len(pts) == 4 else ""}">{cells}</div></div>'
    return ""


#: deck-graphics chart and diagram styles: added ONLY when one is drawn (a deck with none keeps its exact bytes).
GRAPHICS_CSS = """
.g-chartsl h1.title,.g-diag h1.title{max-width:1500px;font:700 64px/1.05 var(--head)}
.g-cols{display:grid;grid-template-columns:7fr 5fr;gap:48px;margin-top:28px}.g-chartsl.full .g-cols{grid-template-columns:8fr 4fr}
.g-side{border-left:1.5px solid var(--ink);padding-left:36px;display:flex;flex-direction:column;gap:22px}.g-side p{font-size:30px;line-height:1.25}
.g-chart svg{width:100%;height:auto;display:block}.g-chart .cl{font:400 26px var(--body);fill:var(--ink)}.g-chart .cv{font:700 26px var(--body);fill:var(--ink)}
.g-chart .base{stroke:var(--ink);stroke-width:1.5}.g-src{font-size:22px;color:var(--muted);margin-top:10px}
.g-data summary{font-size:20px;color:var(--muted);cursor:pointer}.g-data table{font-size:22px;border-collapse:collapse}.g-data td{padding:4px 18px 4px 0}
.g-diag{display:flex;flex-direction:column}.g-diag .g-note{font-size:26px;color:var(--muted);margin-top:auto;border-top:1.5px solid var(--ink);padding-top:16px}
.g-proc>.g-in{display:grid;grid-template-columns:repeat(var(--n),1fr);gap:8px;margin-top:56px}
.g-chev{background:var(--tint);border:1.5px solid var(--ink);clip-path:polygon(0 0,88% 0,100% 50%,88% 100%,0 100%,12% 50%);padding:30px 18% 30px 16%;font:700 30px/1.05 var(--head);text-align:center;min-height:150px;display:flex;align-items:center;justify-content:center}
.g-chev.first{background:var(--ink);color:var(--paper);clip-path:polygon(0 0,88% 0,100% 50%,88% 100%,0 100%)}.g-step p{font-size:28px;line-height:1.25;margin-top:22px;padding:0 8px}
.g-step svg.icon{margin:0 0 14px 12px}
.g-tl>.g-in{display:grid;grid-template-columns:repeat(var(--n),1fr);margin-top:90px;position:relative}
.g-tl>.g-in:before{content:"";position:absolute;left:calc(50% / var(--n));right:calc(50% / var(--n));top:calc(1.05em * 2 + 62px);height:1.5px;background:var(--ink)}
.g-ph{display:flex;flex-direction:column;align-items:center;text-align:center;gap:16px}.g-ph b{font:700 32px/1.05 var(--head);min-height:2.1em;display:flex;align-items:flex-end}
.g-node{width:30px;height:30px;border-radius:50%;border:3px solid var(--ink);background:var(--paper);position:relative;z-index:1}.g-node.first{background:var(--ink)}
.g-ph span{font-size:28px}
.g-jr>.g-in{display:grid;grid-template-columns:repeat(var(--n),1fr);gap:24px;margin-top:64px}.g-pill{border:2px solid var(--ink);border-radius:999px;padding:18px;text-align:center;font:700 30px var(--head)}
.g-stage p{font-size:28px;line-height:1.25}.g-stage .kick{margin-top:18px}
.g-mx-wrap{display:grid;grid-template-columns:8fr 4fr;gap:48px;margin-top:40px}
.g-mx{position:relative;display:grid;grid-template-columns:1fr 1fr;grid-template-rows:1fr 1fr;min-height:620px;margin:40px 0 40px 0}
.g-mx:before,.g-mx:after{content:"";position:absolute;background:var(--ink)}.g-mx:before{left:0;right:0;top:50%;height:2px}.g-mx:after{top:0;bottom:0;left:50%;width:2px}
.g-q{padding:22px}.g-q p{font-size:28px;line-height:1.2;margin-bottom:8px}.g-ax{position:absolute;font:700 20px var(--body);color:var(--muted)}
.g-ax.xl{left:0;top:calc(50% + 8px)}.g-ax.xh{right:0;top:calc(50% + 8px)}.g-ax.yh{left:calc(50% + 10px);top:-34px}.g-ax.yl{left:calc(50% + 10px);bottom:-34px}
.g-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:48px;margin-top:48px}.g-grid.two{grid-template-columns:repeat(2,1fr)}
.g-gp{border-top:1.5px solid var(--ink);padding-top:22px}.g-gp b{display:block;font:700 34px/1.1 var(--head);margin:14px 0 10px}.g-gp p{font-size:28px;line-height:1.25}
"""


def _tz(s) -> dict | None:
    im = (((s.get("slots") or {}).get("picture") or {}).get("image")) or {}
    tz = im.get("text_zone") or {}
    return tz if tz.get("zone") else None


def _bleed_geo(cv=None) -> tuple:
    """deck-slide-size: the bleed's box and text block in inches at the deck's size (W, H, block); 16:9: BLEED_W, BLEED_H, ZONE_BLOCK."""
    if cv is None or cv.identity:
        return images.BLEED_W, images.BLEED_H, images.ZONE_BLOCK
    return cv.w_in, cv.y(images.BLEED_H), images.zone_block(cv, physical=True)


def _scrim_css(tz: dict, cv=None) -> str:
    """The pptx scrim as one CSS gradient (deck-look step 7): solid at the recorded alpha under the block plus its pad, fading to nothing."""
    BW, BH, blk = _bleed_geo(cv)
    g = images.scrim_geometry(tz["zone"], images.zone_box(tz["zone"], blk, BW, BH), BW, BH)
    r, g_, b_ = (int(tz["colour"][i:i + 2], 16) for i in (0, 2, 4))
    a = max(images.SCRIM_FLOOR, min(images.SCRIM_CAP, float(tz.get("alpha", images.SCRIM_FLOOR))))
    sx, sy, sw, sh = g["solid"]
    fx, fy, fw, fh = g["fade"]
    solid, end = {"up": (BH - sy, BH - fy), "down": (sy + sh, fy + fh), "right": (sx + sw, fx + fw), "left": (BW - sx, BW - fx)}[g["toward"]]
    to = {"up": "top", "down": "bottom", "right": "right", "left": "left"}[g["toward"]]
    c = f"{r},{g_},{b_}"
    return (f"linear-gradient(to {to},rgba({c},{a}) 0,rgba({c},{a}) {round(solid * PX_IN)}px,rgba({c},0) {round(end * PX_IN)}px)")


def _caps(text) -> str:
    """' caps' when a statement is short enough to set in capitals (the pptx rule, ``layouts.caps_ok``)."""
    from . import layouts
    t = str(text).strip()
    return " caps" if (layouts.caps_ok(t) and len(t) <= 32 and len(t.split()) <= 5) else ""   # the pptx also asks for two lines at most


def _kick(b: "_Slide", text, cls="") -> str:
    return b.rv("kick" + (" " + cls if cls else ""), _e(text), "div", 60) if str(text).strip() else ""


def _v3_points(bl: list) -> list:
    """(heading, text, italic, caption) for statement_points, as layouts.statement_points reads them."""
    from . import layouts
    return [(p["heading"], p["text"], p["italic"], p["caption"]) for p in (layouts.statement_points(bl) or [])]


def _v3_body(s, b: "_Slide", bl: list, lid: str, deck: dict) -> str:
    """The body markup of a deck-look layout (the title is part of it: these layouts place the title themselves)."""
    from .render_pptx import _FIG, _item_text, _objective_facts
    t = s["title"]
    text = lambda x: str(x.get("text", "")).strip()
    hero = b.rv("title hero" + _caps(t), _e(t), "h1", 220)   # the title first: it is the first thing revealed
    if lid == "statement_points":
        title = hero.replace("title hero" + _caps(t), "title", 1)
        pts = _v3_points(bl)
        facts = _objective_facts([p[1] for p in pts]) if s["type"] == "objective" else None
        fig = ""
        if facts:
            b.f += 1
            fig = _kick(b, "The target") + b.rv("fig-v", _e(facts["target"]), "b", 200)
            for lab, key in (("Baseline", "baseline"), ("By when", "date")):
                if facts.get(key):
                    fig += _kick(b, lab) + b.rv("fig-d" + _caps(facts[key]), _e(facts[key]), "b", 120)
            fig = f'<div class="fig">{fig}</div>'
        rows = ""
        for i, (h, x, it, cap) in enumerate(pts):
            b.f += 1
            inner = (b.icon(i, len(pts), 0.5) if b.icons else "") + (_kick(b, h) if h else "") + b.rv("pt-t" + (" it" if it else ""), _e(x), "p", 120) + (f'<p class="capn">{_e(cap)}</p>' if cap else "")
            rows += f'<div class="pt">{inner}</div>'
        return (f'<div class="body v3 v3sp"><div class="sp-l">{title}{fig}</div>'
                f'<div class="sp-r">{rows}</div></div>')
    if lid == "reframe":
        line = "".join(b.rv("lead", _e(text(x)), "p", 160) for x in bl if x["kind"] in ("statement", "text") and text(x))
        notes = [(k, v) for x in bl if x["kind"] == "kv" for k, v in x["items"]] + [("", text(x)) for x in bl if x["kind"] == "small" and text(x)]
        b.f += 1
        row = "".join(f'<div class="note">{_kick(b, k)}{b.rv("", _e(v), "p", 120)}</div>' for k, v in notes)
        return (f'<div class="body v3 v3rf">{hero}{line}'
                + (f'<div class="row n{len(notes)}">{row}</div>' if notes else "") + "</div>")
    if lid == "shift_line":
        ft = next(x for x in bl if x["kind"] == "fromto")
        sup = "".join(b.rv("sup", _e(text(x)), "p", 100) for x in bl if x["kind"] in ("text", "small") and text(x))
        b.f += 1
        stops = b.rv("stops", '<i class="dot from"></i><i class="bar"></i><i class="dot to"></i>', "div", 260)
        cols = (f'<div class="cols"><div>{_kick(b, "From", "mute")}{b.rv("val from" + _caps(ft["from"]), _e(ft["from"]), "p", 160)}{sup}</div>'
                f'<div>{_kick(b, "To")}{b.rv("val" + _caps(ft["to"]), _e(ft["to"]), "p", 160)}</div></div>')
        rtb = ""
        for x in bl:
            if x["kind"] == "bullets":
                b.f += 1
                rtb += _kick(b, x.get("title") or "") + "".join(b.rv("", _e(_item_text(i)), "p", 90) for i in x["items"] if _item_text(i).strip())
        return (f'<div class="body v3 v3sl">{hero}{stops}{cols}'
                + (f'<div class="rtb">{rtb}</div>' if rtb else "") + "</div>")
    if lid == "picture_column":
        out = hero
        for x in bl:
            k = x["kind"]
            if k in ("statement", "text") and text(x):
                b.f += 1
                out += b.rv("lead", _e(text(x)), "p", 140)
            elif k == "copy":
                b.f += 1
                out += "".join(b.rv("copyline", _e(c), "p", 140) for c in x.get("lines") or []) + _kick(b, x.get("answer") or "")
        pts = []
        for x in bl:
            if x["kind"] == "kv":
                pts += [(k, v) for k, v in x["items"]]
            elif x["kind"] == "bullets":
                pts += [((x.get("title") or "") if n == 0 else "", _item_text(i)) for n, i in enumerate(x["items"])]
            elif x["kind"] in ("small", "callout") and text(x):
                pts.append(("", text(x)))
        for k, v in pts:
            b.f += 1
            out += f'<div class="pt">{_kick(b, k)}{b.rv("", _e(v), "p", 120)}</div>'
        grid = ""
        if spec.GRAPHICS:   # deck-graphics: a two-column table's rows at the column's foot, as the pptx draws them (and its icons)
            from .graphics import ICON_ROW_IN
            for x in bl:
                rows = x.get("rows") or []
                if x["kind"] != "table" or len(rows) < 2 or not all(len(r) == 2 for r in rows):
                    continue
                b.f += 1
                cells = f'<div class="pc-gr pc-gh">{_kick(b, rows[0][0])}{_kick(b, rows[0][1])}</div>'
                for n, r in enumerate(rows[1:]):
                    ic = b.icon(n, len(rows) - 1, ICON_ROW_IN) if b.icons else ""
                    cells += f'<div class="pc-gr">{b.rv("pc-k", ic + _e(r[0]), "div", 90)}{b.rv("", _e(r[1]), "p", 90)}</div>'
                grid += f'<div class="pc-grid">{cells}</div>'
        out += grid
        return f'<div class="body v3 v3pc{" nopts" if not (pts or grid) else ""}">{out}</div>'
    if spec.GRAPHICS and lid in GRAPHICS_WEB:
        return _graphics_body(s, b, bl, lid, deck)
    if lid in ("cover_bleed", "full_bleed_statement"):   # the words on the picture's measured zone, in the recorded colour
        tz = _tz(s) or {"zone": "bottom_left", "text": "FAF7F1"}
        BW, BH, blk = _bleed_geo(themes.canvas_of(deck))
        x, y, w, h = images.zone_box(tz["zone"], blk, BW, BH)
        v = tz["zone"].split("_")[0]
        pos = f"left:{round(x * PX_IN)}px;width:{round(w * PX_IN)}px;" + (f"bottom:{round((BH - y - h) * PX_IN)}px" if v == "bottom" else f"top:{round(y * PX_IN)}px" if v == "top" else f"top:{round(y * PX_IN)}px;height:{round(h * PX_IN)}px;justify-content:center")
        lead = "".join(b.rv("lead", _e(text(x_)), "p", 160) for x_ in bl if text(x_))
        kick = _kick(b, _kicker(deck["meta"])) if lid == "cover_bleed" else ""
        return f'<div class="body v3 v3bl" style="{pos};color:#{tz["text"]};--fg:#{tz["text"]}">{kick}{hero}{lead}</div>'
    if lid == "cover_image":
        lead = "".join(b.rv("lead" + (" small" if x["kind"] == "small" else ""), _e(text(x)), "p", 160) for x in bl if text(x))
        return f'<div class="body v3 v3cv">{_kick(b, _kicker(deck["meta"]))}{hero}{lead}</div>'
    if lid == "close":
        import re as _re
        stat, lead, rows = None, "", ""
        for x in bl:
            if x["kind"] in ("statement", "text", "small") and text(x):
                mm = _re.match(r"^([^:]{2,40}):\s*(.+)$", text(x))
                if stat is None and mm and _FIG.search(mm.group(2)):
                    b.f += 1
                    stat = _kick(b, mm.group(1)) + b.rv("fig-v sm", _e(mm.group(2)), "b", 200)
                else:
                    lead += b.rv("lead", _e(text(x)), "p", 140)
            elif x["kind"] in ("bullets", "kv", "card"):
                items = x.get("items") or [{"text": text(x), "human": x.get("human")}]
                for n, i in enumerate(items):
                    b.f += 1
                    hum = isinstance(i, dict) and i.get("human")
                    words = f"{i[0]}: {i[1]}" if isinstance(i, (list, tuple)) else _item_text(i)
                    head = _kick(b, x.get("title") or "") if n == 0 and x.get("title") else ""
                    rows += f'<div class="row{" todo" if hum else ""}">{head}{_kick(b, "To supply") if hum else ""}{b.rv("", _e(words), "p", 100)}</div>'
        return (f'<div class="body v3 v3cl">{hero}'
                f'<div class="grid"><div class="l">{stat or ""}{lead}</div><div class="r">{rows}</div></div></div>')
    return ""


LOOK_V3_LAYOUT_CSS = """
.v3 .kick{font:700 26px/1.25 var(--body);color:var(--accent-ink);margin-bottom:6px}.dark .v3 .kick{color:var(--accent)}.v3 .kick.mute{color:var(--muted)}
.v3 h1.title{max-width:none;text-wrap:balance}.v3 .hero{font:700 104px/.95 var(--head);letter-spacing:0}.v3 .caps{text-transform:uppercase}
.v3sp,.v3rf,.v3sl{border-left:1.5px solid var(--ink);border-right:1.5px solid var(--ink);margin-top:-14px}
.v3sp{display:grid;grid-template-columns:5fr 7fr}
.v3sp .sp-l{display:flex;flex-direction:column;justify-content:space-between;padding:20px 36px 20px 29px;border-right:1.5px solid var(--ink)}
.v3sp .sp-l h1.title{font:700 64px/1.05 var(--head)}
.v3 .fig-v{display:block;font:700 200px/.9 var(--head);letter-spacing:-.01em}.v3 .fig-v.sm{font-size:80px;line-height:1}.v3 .fig-d{display:block;font:700 56px/1 var(--head)}
.v3sp .sp-r{display:flex;flex-direction:column;justify-content:center;padding:0 29px 0 36px}
.v3sp .pt{padding:34px 0}.v3sp .pt+.pt{border-top:1.5px solid var(--ink)}
.v3sp .pt-t{font-size:44px;line-height:1.2}.v3sp .pt-t.it{font-style:italic}.v3 .capn{font-size:24px;color:var(--muted);margin-top:8px}
.v3rf{display:flex;flex-direction:column;padding:56px 29px 24px}
.v3rf .lead{font-size:46px;line-height:1.2;margin-top:44px;max-width:1500px}
.v3rf .row{margin-top:auto;border-top:1.5px solid var(--ink);padding-top:34px;display:grid;grid-template-columns:7fr 5fr;gap:48px}
.v3rf .row.n1{grid-template-columns:8fr 4fr}.v3rf .row .note+.note{border-left:1.5px solid var(--ink);padding-left:36px}
.v3rf .note p{font-size:34px;line-height:1.3}
.v3sl{display:flex;flex-direction:column;padding:40px 29px 24px}
.v3sl .stops{display:flex;align-items:center;margin:56px 0 40px}.v3sl .bar{flex:1;height:8px;background:var(--ink)}
.v3sl .dot{width:24px;height:24px;border-radius:50%;flex:none}.v3sl .dot.from{border:3px solid var(--ink);background:var(--paper)}.v3sl .dot.to{background:var(--accent)}
.v3sl .cols{display:grid;grid-template-columns:1fr 1fr}.v3sl .cols>div+div{border-left:1.5px solid var(--ink);padding-left:36px}
.v3sl .val{font:700 76px/.95 var(--head)}.v3sl .val.from{color:var(--muted)}.v3sl .sup{font-size:32px;line-height:1.3;margin-top:20px}
.v3sl .rtb{margin-top:auto;border-top:1.5px solid var(--ink);padding-top:30px}.v3sl .rtb p{font-size:38px;line-height:1.25}
.v3pc{display:flex;flex-direction:column}.v3pc.nopts{justify-content:safe center;padding-bottom:120px}
.v3pc .lead{font-size:calc(var(--s)*44px);line-height:1.25;margin-top:calc(var(--s)*48px)}.v3pc .copyline{font:700 calc(var(--s)*52px)/1.05 var(--head);margin-top:calc(var(--s)*36px)}
.v3pc .pt{border-top:1.5px solid var(--ink);padding-top:28px;margin-top:auto}.v3pc .pt+.pt{margin-top:36px}.v3pc .pt p{font-size:36px;line-height:1.25}
.dark .v3pc .pt{border-color:var(--dark-text)}
.v3cv{display:flex;flex-direction:column;justify-content:center;padding-bottom:80px}.v3cv .hero{font-size:100px;margin:24px 0 44px}
.v3cv .lead{font-size:44px;line-height:1.2}.v3cv .lead.small{font-size:28px;color:var(--muted)}
.v3cl .hero{font-size:84px;margin:24px 0 36px}.v3cl .grid{display:grid;grid-template-columns:4fr 8fr;border-top:1.5px solid var(--ink);padding-top:36px}
.v3cl .r{border-left:1.5px solid var(--ink);padding-left:36px;display:flex;flex-direction:column;gap:22px}
.v3cl .row p{font-size:30px;line-height:1.25}.v3cl .row.todo{outline:2px dashed var(--accent-ink);outline-offset:0;padding:18px 24px}
.v3cl .lead{font-size:36px;line-height:1.25;margin-top:24px}
.pics.col{position:absolute;top:0;bottom:0;width:720px;z-index:1}.pics.col.left{left:0}.pics.col.right{right:0}
.pics.col .pic{height:100%;aspect-ratio:auto;border-radius:0}
.pics.col .plabel{bottom:112px;left:72px}.pics.col.right .plabel{left:auto;right:72px}
.pic-col-left{padding-left:814px}.pic-col-right{padding-right:814px}.pic-col-right .flags{right:814px}
.v3.v3cv h1.title,.v3.v3pc h1.title{max-width:none}
.pics.bleed{position:absolute;left:0;top:0;width:1920px;height:986px;z-index:1}.pics.bleed .pic{width:100%;height:100%;aspect-ratio:auto;border-radius:0}
.pics.bleed .scrim{position:absolute;inset:0;z-index:2;pointer-events:none}.pics.bleed .plabel{z-index:3}
.pics.bleed.lab-top-right .plabel{top:108px;right:72px;left:auto;bottom:auto}.pics.bleed.lab-top-left .plabel{top:108px;left:72px;bottom:auto}
.pics.bleed.lab-bottom-right .plabel{bottom:72px;right:72px;left:auto}.pics.bleed.lab-bottom-left .plabel{bottom:72px;left:72px}
.v3bl{position:absolute;z-index:4;display:flex;flex-direction:column}.v3bl .hero{font-size:100px;margin:16px 0 36px;color:inherit}.v3bl .lead{font-size:44px;line-height:1.2;color:inherit}
.v3bl .kick{color:inherit}.pic-bleed .flags{z-index:5}
"""


def _cover_logo(deck, assets_dir) -> str | None:
    """The cover's logo markup: the client's logo the look cleared (``meta.theme.logo``, a PNG deck asset, as an image with alt text), else the
    ``--brand`` file's inline SVG. Placement ``none`` means no logo."""
    lg = (deck["meta"].get("theme") or {}).get("logo")
    if lg:
        rec = (deck.get("assets") or {}).get(lg.get("asset")) or {}
        f = Path(assets_dir) / rec["file"] if assets_dir and rec.get("file") else None
        if lg.get("placement") == "none" or not (f and f.is_file()):
            return None
        import base64   # noqa: PLC0415
        return (f'<img alt="{_a(deck["meta"].get("client", "Client"))} logo" style="height:110px;width:auto;display:block" '
                f'src="data:image/png;base64,{base64.b64encode(f.read_bytes()).decode()}">')
    return (deck["meta"].get("brand") or {}).get("logo_dark_svg")


def slide_views(deck, inp, findings: list | None = None, assets_dir=None, pictures: dict | None = None, src=None, placed: set | None = None,
                icons: dict | None = None, clean: bool = False) -> list:
    """Per slide, in order: id, number, type, dark, inner markup, notes, build-step count and, per
    step, the latest reveal delay (ms) up to and including it."""
    failed = {}
    for f in findings or []:
        if f["level"] == "error" and f.get("slide"):
            failed.setdefault(f["slide"], set()).add(f["check"])
    n_human = sum(1 for s in deck["slides"].values() if s["status"] == "needs_human")
    audience = deck["meta"].get("audience", "review")
    out = []
    # Pictures (deck-frames-in): the same slots the pptx draws; with pictures None nothing is drawn and the markup is as it was.
    drawn = {k: v for k, v in images.drawn(deck, audience).items() if placed is None or k in placed} if pictures else {}   # only what the pptx drew: one content in every format
    plabel = ((deck["meta"].get("preferences") or {}).get("picture_approval") or {}).get("label") or "Illustrative"
    src = src or data_uri
    for n, sid in enumerate(deck["order"], 1):
        s = deck["slides"][sid]
        pic_html, pic_cls = picture_markup(sid, s, drawn, pictures or {}, src, plabel, deck=deck) if drawn else ("", "")
        b = _Slide(inp)
        if icons and sid in icons:   # deck-graphics: exactly the icons the pptx drew (render_pptx's ``icons``)
            b.icons = list(icons[sid]["ids"])
        v3 = bool(spec.LOOK_V3)
        dark = s["type"] in (dark_types(v3) if v3 else DARK_TYPES)
        logo = _cover_logo(deck, assets_dir) if s["type"] == "title" else None
        kick = (b.rv("brand-logo", logo, "div", 160) if logo else
                b.rv("kicker", _e(KICKERS[s["type"]] or _kicker(deck["meta"])), "div", 120) if s["type"] in KICKERS else "")
        if v3 and s["type"] != "title":   # deck-look: the section band replaces the kicker (and the accent tick): a topic, never the title
            lab = band_label(s, deck["meta"])
            kick = f'<div class="band">{_e(lab)}</div>' if lab else '<div class="band empty"></div>'
        lay = s.get("layout") or {}
        planned = bool(lay.get("blocks_sha") and lay["blocks_sha"] == blocks_sha(s, audience))
        v3lid = lay["id"] if (v3 and planned and lay.get("id") in _web_ids()) else None
        if v3lid in GRAPHICS_WEB and spec.GRAPHICS:   # a chart or diagram the slide cannot hold here: the blocks as before
            probe = _Slide(inp)
            probe.icons = b.icons
            if not _graphics_body(s, probe, shown_blocks(s, audience), v3lid, deck):
                v3lid = None
        if v3lid:   # deck-look: the layout places its own title; the band stays in the header (none on the cover and the close)
            if v3lid in ("cover_image", "close"):
                kick = ""
            title = ""
            body = _v3_body(s, b, shown_blocks(s, audience), v3lid, deck)
            if pic_html and v3lid in ("cover_bleed", "full_bleed_statement"):
                import re as _re
                tz = _tz(s) or {"zone": "bottom_left", "colour": "1B2430", "alpha": images.SCRIM_FLOOR}
                corner = images.label_corner(tz["zone"]).replace("_", "-")
                pic_html = _re.sub(r' style="width:\d+px;aspect-ratio:[\d/]+"', "", pic_html.replace(
                    '<div class="pics side">', f'<div class="pics bleed lab-{corner}"><i class="scrim" style="background:{_scrim_css(tz, themes.canvas_of(deck))}"></i>', 1), count=1)
                pic_cls = "pic-bleed"
                kick = ""
            elif pic_html and v3lid in ("picture_column", "cover_image"):
                side = "right" if v3lid == "cover_image" else _pic_sides(deck).get(sid, "left")
                import re as _re
                pic_html = _re.sub(r' style="width:\d+px;aspect-ratio:[\d/]+"', "", pic_html.replace('<div class="pics side">', f'<div class="pics col {side}">', 1), count=1)
                pic_cls = f"pic-col pic-col-{side}"
        else:
            title = b.words(s["title"], "title", "h1") if dark else b.rv("title", _e(s["title"]), "h1", 220)
            body = _body(s, b, shown_blocks(s, audience), bool(pic_html))
        foot = "" if (v3 and s["type"] != "title") else f'<span>{_e(s["section"])}</span>'   # the band carries the section
        if s.get("footnotes"):
            foot += f'<span class="src">Sources {" ".join(f"[{k}]" for k in s["footnotes"][:14])} (appendix)</span>'
        foot += f'<span class="num">{n}</span>'
        flags = ""
        if n_human and not clean:
            flags += f'<span class="draft">DRAFT · {"needs a person" if s["status"] == "needs_human" else f"{n_human} slides need a person"}</span>'
        if sid in failed and audience != "client" and not clean:
            flags += f'<span class="failed">CHECK FAILED: {_e(", ".join(sorted(failed[sid])))}</span>'
        head = f"<header>{kick}{title}</header>" if (kick or title) else ""
        inner = (f'<div class="flags">{flags}</div>{head}{body}{pic_html}'
                 f'<footer>{foot}</footer>')
        notes = (export_clean.notes_of(s.get("notes")) if clean else (s.get("notes") or "")) + ("" if clean else f"\n\nSlide id {sid} · status {s['status']} · requirements {', '.join(s.get('requirements') or []) or 'none'}")
        if planned and spec.moved_map(s, audience):   # the points the plan moved off the slide: verbatim, with their refs, as in the pptx notes
            from . import layouts
            notes += "\n\nMoved from the slide:\n" + "\n".join(layouts.moved_line(t_, r_) for t_, r_ in layouts.moved_texts(s) if not (clean and spec.unresolved_line(t_)))
        pt = (deck["meta"].get("layout_title_pt") or {}).get(lay.get("id")) if planned else None
        out.append({"layout": lay["id"] if planned else None, "tpt": f' style="--tpt:{pt * 2}px"' if (spec.LOOK_V2 and pt) else "", "id": sid, "n": n, "type": s["type"], "section": s["section"], "dark": dark, "cls": pic_cls,
                    "title": s["title"], "html": inner, "notes": notes, "steps": b.f, "status": s["status"],
                    "last": [max(v for k, v in b.last.items() if k <= f) for f in range(b.f + 1)]})
    return out


#: deck-graphics icon styles: added ONLY when an icon is drawn (a deck with none keeps its exact bytes). The stroke is currentColor: the text token.
ICON_CSS = """
svg.icon{display:block;color:inherit;flex:none}
.b-table td svg.icon{display:inline-block;vertical-align:middle;margin:-6px 22px 0 0}
.v3sp .pt svg.icon{margin-bottom:22px}
.v3pc .pc-grid{margin-top:auto}.v3pc .pc-gr{display:grid;grid-template-columns:2fr 3fr;gap:28px;align-items:center;padding:22px 0}
.v3pc .pc-gr+.pc-gr{border-top:1.5px solid var(--ink)}.v3pc .pc-gh{padding-top:0}
.v3pc .pc-k{display:flex;align-items:center;gap:22px;font:700 44px/1.05 var(--head)}.v3pc .pc-gr p{font-size:38px;line-height:1.2}
"""

def graphics_css(markup: str) -> str:
    """The deck-graphics styles the markup needs, each ONLY when its markup is present (a deck with none keeps its exact bytes). One rule for
    deck.html and the HyperFrames project."""
    return ((ICON_CSS if ('data-icon="' in markup or 'class="pc-grid"' in markup) else "")
            + (FRAME_CSS if 'class="mockup"' in markup else "")
            + (GRAPHICS_CSS if ('class="body v3 g-diag"' in markup or 'class="body v3 g-chartsl' in markup) else ""))


#: deck-graphics frame and strip styles: added ONLY when a frame is drawn. Bezels in the ink token; the window keeps the picture's aspect.
FRAME_CSS = """
.mockup{display:inline-block;background:var(--ink);color:#fff;font:700 20px/1 var(--body);padding:9px 14px;letter-spacing:.02em}
.frame-wrap{position:relative;display:flex;flex-direction:column;align-items:center}
.frame-wrap .pic.framed{border:14px solid var(--ink);border-radius:0;box-sizing:content-box}
.frame-wrap.f-phone .pic.framed{border-width:22px;border-radius:44px}
.frame-wrap .f-stand{display:block;width:30%;height:44px;background:var(--ink)}
.frame-wrap.f-phone .f-stand,.frame-wrap.f-strip .f-stand,.frame-wrap.f-spread .f-stand{display:none}
.frame-wrap.f-billboard .f-stand{width:70%;height:60px;background:linear-gradient(90deg,var(--ink) 0 6%,transparent 6% 94%,var(--ink) 94%)}
.frame-wrap.f-screen .f-stand{width:12%;height:36px}
.frame-wrap .f-pills{margin-top:22px;display:flex;gap:12px}
.frame-wrap .pic .plabel{display:none}
.pics.col:has(.frame-wrap){display:flex;align-items:center;justify-content:center;background:var(--tint)}
.pics.col .frame-wrap .pic{height:auto}
.mockup.own{background:transparent;color:var(--ink);outline:1.5px solid var(--ink);outline-offset:-1.5px}.mockup.own.flagged{color:#B03225;outline-color:#B03225}
.sb-col{gap:18px}.sb-col .sb-cell{width:100%}.sb-col .pic{border:1.5px solid var(--ink);border-radius:0}.sb-col .pic .plabel{display:none}
.sb-n{display:flex;align-items:center;gap:14px;margin-top:8px}.sb-note{font-size:20px;color:var(--muted);align-self:center}
.sb-n b{font:700 30px/1 var(--head)}.sb-n i{flex:1;height:1.5px;background:var(--ink)}
.sb-strip .pic .plabel{display:none}.sb-strip{align-items:start}.sb-strip .pic{aspect-ratio:auto;height:auto}.sb-cap{margin:8px 0 0;font-size:22px;line-height:1.3;color:var(--ink)}
.sb-pills{display:flex;gap:12px;right:112px;bottom:auto;top:560px;left:auto}
.ooh-row{left:112px;right:112px;bottom:70px;display:flex;justify-content:center;align-items:flex-end;gap:56px}
.ooh-cell{display:flex;flex-direction:column;align-items:stretch}.ooh-cell .pic.framed{box-sizing:border-box}
.ooh-name{margin:14px 0 0;text-align:center;font:700 26px/1.2 var(--head);color:var(--ink)}
.pic-ooh .sb-pills{top:440px}.pic-ooh .body{padding-bottom:600px}.pic-ooh .body.exec{grid-template-columns:5fr 6fr}.pic-ooh .body.exec .copy{max-height:180px;overflow:hidden}
.pic-sb .body{padding-bottom:470px}.pic-sb .body.exec{grid-template-columns:5fr 6fr}.pic-sb .body.exec .copy{max-height:230px;overflow:hidden}
"""

#: Picture styles: added to the stylesheet ONLY when a picture is drawn, so a deck with none keeps its exact bytes.
PIC_CSS = """
.pics{position:absolute;z-index:1}
.pics.side{right:112px;top:230px}
.pw560 header,.pw560 .body{margin-right:630px}.pw500 header,.pw500 .body{margin-right:570px}.pw460 header,.pw460 .body{margin-right:530px}.pw360 header,.pw360 .body{margin-right:430px}
.pics.strip{left:112px;right:112px;bottom:90px;display:grid;grid-template-columns:repeat(4,1fr);gap:28px}
.pic-strip .body{padding-bottom:300px}
.pic{position:relative;margin:0;overflow:hidden;border-radius:6px;background:var(--tint);aspect-ratio:16/9}
.pics.side .pic{aspect-ratio:auto}
.pic img{display:block;width:100%;height:100%;object-fit:cover}
.pic.flagged{outline:6px solid #c0392b;outline-offset:-6px}
.plabel{position:absolute;left:14px;bottom:14px;background:#1B2430;color:#fff;font:700 18px/1 var(--body);letter-spacing:.04em;padding:10px 16px;border-radius:4px}
.plabel.flagged{background:#B03225}
"""

CSS_LAYOUT = """
:root{--ink:#INK;--paper:#PAPER;--accent:#ACCENT;--accent-line:#ACCENTL;--accent-ink:#8A5A10;--muted:#MUTED;--tint:#TINT;--line:#LINE;--dark-text:#DARK;
--head:HEAD;--body:BODY;--ease:cubic-bezier(.2,.75,.25,1)}
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:var(--body);-webkit-font-smoothing:antialiased}
.slide{position:absolute;inset:0;display:flex;flex-direction:column;padding:72px 112px 0;background:var(--paper);color:var(--ink);--s:1}
.slide.dark{background:var(--ink);color:var(--dark-text)}
.flags{position:absolute;top:22px;right:112px;display:flex;gap:28px;font:700 18px/1 var(--body);letter-spacing:.04em}
.flags .draft{color:var(--accent-ink)}.dark .flags .draft{color:var(--accent)}.flags .failed{color:#c0392b}
header{margin-bottom:calc(var(--s)*44px)}
.kicker{font:700 22px/1 var(--body);letter-spacing:.14em;text-transform:uppercase;color:var(--accent);margin-bottom:56px}
h1.title{font:700 calc(var(--s)*60px)/1.12 var(--head);letter-spacing:-.01em;max-width:1650px;text-wrap:balance}
.t-title h1.title{font-size:96px;margin-top:150px;max-width:1500px}
.t-real_question h1.title,.t-idea h1.title{font-size:84px;margin-top:70px;max-width:1550px}
.t-next_step h1.title{font-size:72px;margin-top:80px}
.t-territory h1.title,.t-execution h1.title{font-size:calc(var(--s)*56px)}
.body{flex:1;min-height:0;overflow:hidden;padding-bottom:12px}
.col{display:flex;flex-direction:column;gap:calc(var(--s)*26px);min-width:0}
.split{display:grid;gap:80px;align-items:start}
.split.chart{grid-template-columns:1.25fr 1fr}.split.side{grid-template-columns:1.55fr 1fr}.split.exec{grid-template-columns:.95fr 1fr;height:100%}
.split.exec>.col:last-child{height:100%}
footer{display:flex;gap:40px;align-items:center;height:72px;font:400 18px/1 var(--body);letter-spacing:.06em;color:var(--muted);text-transform:uppercase}
footer .src{margin-left:auto;text-transform:none;letter-spacing:0}footer .num{margin-left:auto}footer .src+.num{margin-left:0}
.dark footer{color:#a9b3bd}
.b-statement{font:400 calc(var(--s)*48px)/1.25 var(--head);max-width:1500px}
.b-quote{font:italic 400 calc(var(--s)*54px)/1.2 var(--head);color:var(--accent-ink);max-width:1400px}
.b-text{font-size:calc(var(--s)*36px);line-height:1.38}
.b-small{font-size:calc(var(--s)*26px);line-height:1.4;color:var(--muted)}.dark .b-small{color:#a9b3bd}
.b-callout{background:var(--tint);color:var(--ink);border-left:8px solid var(--accent-line);padding:calc(var(--s)*26px) 36px;font-size:calc(var(--s)*34px);line-height:1.35;border-radius:10px}
.b-card{background:var(--tint);color:var(--ink);padding:calc(var(--s)*28px) 36px;border-radius:12px}
.cap,.b-cap{font:700 calc(var(--s)*22px)/1.2 var(--body);letter-spacing:.1em;text-transform:uppercase;color:var(--muted);margin-bottom:10px}
.b-card p{font-size:calc(var(--s)*32px);line-height:1.38}
.b-bullets ul{list-style:none;display:flex;flex-direction:column;gap:calc(var(--s)*14px)}
.b-bullets li{position:relative;padding-left:40px;font-size:calc(var(--s)*34px);line-height:1.34}
.b-bullets li:before{content:"";position:absolute;left:4px;top:.55em;width:14px;height:14px;border-radius:50%;background:var(--accent)}
.human{outline:3px dashed var(--accent-line);outline-offset:8px;border-radius:6px}
.human:after{content:"needs a person";display:inline-block;margin-left:16px;font:700 16px/1 var(--body);letter-spacing:.08em;text-transform:uppercase;color:var(--accent-ink);vertical-align:middle}.dark .human:after,.dark .b-quote{color:var(--accent)}
.b-table{width:100%;border-collapse:collapse;font-size:calc(var(--s)*27px);line-height:1.3}
.b-table.small{font-size:calc(var(--s)*20px)}
.b-table th{background:var(--ink);color:var(--dark-text);text-align:left;font-weight:700;padding:14px 18px}
.b-table td{padding:12px 18px;border-bottom:1px solid var(--line);vertical-align:top}
.b-table tbody tr:nth-child(even) td{background:var(--tint)}
.b-kv{display:flex;flex-direction:column;gap:calc(var(--s)*22px)}
.b-kv>div{display:grid;grid-template-columns:240px 1fr;gap:28px}
.b-kv dt{font:700 calc(var(--s)*22px)/1.5 var(--body);letter-spacing:.08em;text-transform:uppercase;color:var(--muted)}
.b-kv dd{font-size:calc(var(--s)*30px);line-height:1.35}
.b-fromto{display:grid;grid-template-columns:1fr 110px 1fr;align-items:stretch;gap:20px}
.ft{padding:calc(var(--s)*28px) 36px;border-radius:12px;background:var(--tint);color:var(--ink)}
.ft p{font-size:calc(var(--s)*32px);line-height:1.34}.ft.to{background:var(--ink);color:var(--dark-text)}.ft.to .cap{color:var(--accent)}
.dark .ft.to{background:#2a3644}
.ft-arrow{display:grid;place-items:center}.ft-arrow svg{width:90px;fill:none;stroke:var(--accent-line);stroke-width:6;stroke-linecap:round;stroke-linejoin:round}
.ft-arrow path{stroke-dasharray:120;stroke-dashoffset:0}
.b-steps{display:grid;grid-template-columns:repeat(var(--n),1fr);gap:20px;position:relative}
.step{background:var(--tint);color:var(--ink);border-radius:12px;padding:calc(var(--s)*26px) 26px;border-top:6px solid var(--accent-line)}
.step .no{font:700 22px/1 var(--body);color:var(--accent-ink);margin-bottom:14px}
.step .lab{font:700 calc(var(--s)*27px)/1.2 var(--body);margin-bottom:12px}.step p{font-size:calc(var(--s)*27px);line-height:1.34}
.b-chart{display:flex;flex-direction:column;gap:calc(var(--s)*22px)}
.bar{display:grid;grid-template-columns:330px 1fr 110px;align-items:center;gap:22px}
.bar .lab{font-size:calc(var(--s)*26px);line-height:1.2;text-align:right}
.bar .track{height:calc(var(--s)*54px);background:var(--tint);border-radius:6px;overflow:hidden}
.bar i{display:block;height:100%;background:var(--accent-line);border-radius:6px;transform-origin:0 50%}
.bar .val{font:700 calc(var(--s)*34px)/1 var(--body);font-variant-numeric:tabular-nums}
.frame{background:var(--ink);color:var(--dark-text);border-radius:14px;padding:56px 52px;display:flex;flex-direction:column;gap:30px}
.dark .frame{background:#2a3644}
.sketch{min-height:600px;justify-content:center}.sketch p{font:400 44px/1.25 var(--head)}
.sketch .note{font:italic 20px/1 var(--body);color:var(--accent);margin-top:auto}
.copy{height:100%}.copy p{font:400 calc(var(--s)*38px)/1.3 var(--head)}
.copy .answer{margin-top:auto;font:700 calc(var(--s)*32px)/1.3 var(--body);color:var(--accent)}
.b-prompt{font:italic calc(var(--s)*22px)/1.4 var(--body);color:var(--muted)}
.internal{outline:2px dashed var(--muted);outline-offset:8px;color:var(--muted)!important;background:transparent!important;border:0!important}
.b-hero{display:flex;gap:72px;margin-bottom:calc(var(--s)*18px)}
.hero{display:flex;flex-direction:column;gap:8px;max-width:340px}
.hero .big{font:700 calc(var(--s)*150px)/.9 var(--head);font-variant-numeric:tabular-nums;letter-spacing:-.02em}
.hero span{font-size:calc(var(--s)*26px);line-height:1.25;color:var(--muted)}
.dark .hero span{color:#a9b3bd}
.b-hero~.bar{grid-template-columns:300px 1fr 96px}.b-hero~.bar .track{height:calc(var(--s)*34px)}.b-hero~.bar .val{font-size:calc(var(--s)*26px)}
.split.exec.framed{grid-template-columns:1fr 1fr}
.mock-wrap{height:100%;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:30px}
.mock-note{font:italic 18px/1 var(--body);color:#46505b}
.phone{position:relative;width:400px;height:720px;border-radius:56px;background:#0d1117;padding:16px;box-shadow:0 16px 32px rgba(27,36,48,.18)}
.phone .notch{position:absolute;top:26px;left:50%;width:110px;height:26px;margin-left:-55px;border-radius:14px;background:#0d1117;z-index:1}
.phone .screen{height:100%;border-radius:42px;background:linear-gradient(170deg,#241b36 0%,#5a3142 55%,#99503a 100%);color:#fbf4ec;
  display:flex;flex-direction:column;justify-content:center;gap:22px;padding:60px 38px}
.phone .screen p{font:400 34px/1.25 var(--head)}.phone .screen .answer{margin-top:40px;font:700 22px/1.35 var(--body);color:#ffd9a8}
.serp{width:100%;max-width:820px;background:#fff;border:1px solid var(--line);border-radius:18px;padding:30px;box-shadow:0 20px 50px rgba(27,36,48,.12);color:#1f1f1f}
.serp .q{display:flex;align-items:center;gap:16px;border:1px solid #dfe1e5;border-radius:40px;padding:16px 26px;font-size:28px;margin-bottom:28px}
.serp .q svg{width:28px;flex:none;fill:none;stroke:#5f6368;stroke-width:2.4;stroke-linecap:round}
.serp .ad{display:flex;flex-direction:column;gap:10px}.serp .sp{font:700 18px/1 var(--body);color:#1f1f1f}
.serp .ad p{font-size:26px;line-height:1.35;color:#4d5156}.serp .ad p.h{font-size:32px;color:#1a0dab}.serp .ad .lp{font-size:22px;color:#4d5156}
.audio{width:100%;max-width:820px;background:var(--ink);color:var(--dark-text);border-radius:18px;padding:40px 44px;display:flex;flex-direction:column;gap:20px}
.audio .wave{display:flex;align-items:center;gap:6px;height:90px}.audio .wave i{flex:1;background:var(--accent);border-radius:3px;opacity:.85}
.audio .time{display:flex;justify-content:space-between;font:600 18px/1 var(--body);color:#a9b3bd}
.audio .script p{font:italic 400 30px/1.35 var(--head)}.audio .answer{font:700 24px/1.35 var(--body);color:var(--accent)}
.poster{width:440px;height:660px;background:#f3ede4;border:14px solid #1b2430;border-radius:6px;padding:52px 40px;display:flex;flex-direction:column;justify-content:space-between;color:var(--ink)}
.poster .line{font:700 64px/1.05 var(--head)}.poster .answer{font:700 26px/1.3 var(--body);color:var(--accent-ink)}
.b-stats{display:grid;grid-template-columns:repeat(var(--n),1fr);gap:48px;margin:calc(var(--s)*10px) 0}
.stat{border-top:8px solid var(--accent-line);padding-top:22px;display:flex;flex-direction:column;gap:10px}
.stat .big{font:700 calc(var(--s)*104px)/1 var(--head);letter-spacing:-.02em}.stat span{font-size:calc(var(--s)*26px);line-height:1.3;color:var(--muted)}
.dark .stat span{color:#a9b3bd}
.brand-logo{margin-bottom:48px}.brand-logo svg{height:110px;width:auto;display:block}
"""

CSS_UI = """
html,body{height:100%;background:#0e1319;overflow:hidden}
#app{position:fixed;inset:0;display:grid;grid-template-columns:1fr;grid-template-rows:1fr}
#view{position:relative;overflow:hidden}
#stage{position:absolute;left:50%;top:50%;width:1920px;height:1080px;transform-origin:50% 50%}
.slide{opacity:0;visibility:hidden;pointer-events:none;transform:translateX(calc(var(--dir,1) * 60px));
  transition:opacity .55s var(--ease),transform .7s var(--ease),visibility 0s .7s}
.slide.cur{opacity:1;visibility:visible;pointer-events:auto;transform:none;transition:opacity .55s var(--ease),transform .7s var(--ease)}
.slide.past{transform:translateX(calc(var(--dir,1) * -60px))}
/* motion: everything in .rv / .w waits, then plays when its slide is .on */
.rv,.w{opacity:0}.w{display:inline-block}
.on .rv,.on .w{animation:rise .75s var(--ease) both;animation-delay:var(--d)}
.on .bar.rv i{animation:grow 1.1s var(--ease) both;animation-delay:calc(var(--d) + 120ms)}
.on .ft-arrow.rv path{animation:draw .8s var(--ease) both;animation-delay:calc(var(--d) + 100ms)}
.on .b-quote.rv{animation-name:quote}
.on .w{animation-name:word;animation-duration:.6s}
.on .done,.on .done .w,.on .done i,.on .done path{animation:none;opacity:1}
.on .held,.on .held .w,.on .held i,.on .held path{animation:none!important;opacity:0}
@keyframes rise{from{opacity:0;transform:translateY(26px)}to{opacity:1;transform:none}}
@keyframes word{from{opacity:0;transform:translateY(.45em)}to{opacity:1;transform:none}}
@keyframes quote{from{opacity:0;transform:scale(.96);filter:blur(6px)}to{opacity:1;transform:none;filter:none}}
@keyframes grow{from{transform:scaleX(0)}to{transform:scaleX(1)}}
@keyframes draw{from{stroke-dashoffset:120}to{stroke-dashoffset:0}}
.still .rv,.still .w{opacity:1!important;animation:none!important}
#bar{position:absolute;left:0;top:0;height:5px;background:var(--accent-line);transition:width .5s var(--ease);z-index:3}
#ui{position:absolute;right:22px;bottom:18px;display:flex;gap:6px;align-items:center;z-index:4;opacity:0;transition:opacity .3s;
  background:rgba(14,19,25,.82);border-radius:999px;padding:6px 10px;color:#fff;font:600 14px/1 var(--body)}
#app.mouse #ui{opacity:1}
#ui button{all:unset;cursor:pointer;padding:8px 12px;border-radius:999px}#ui button:hover,#ui button.on{background:rgba(255,255,255,.16)}
#count{padding:0 8px;font-variant-numeric:tabular-nums}
#side{display:none}
.presenter #app{grid-template-columns:1.7fr 1fr;gap:20px;padding:20px;background:#0e1319}
.presenter #side{display:grid;grid-template-rows:auto 1fr auto;gap:16px;color:#e9edf1;min-height:0}
#nextbox{position:relative;height:0;padding-bottom:56.25%;overflow:hidden;border-radius:8px;background:#000}
#nextbox .slide{transform-origin:0 0;opacity:1;visibility:visible;transition:none}
#nextbox .slide,.thumb .slide{inset:auto;left:0;top:0;width:1920px;height:1080px}
#notes{overflow:auto;white-space:pre-wrap;font:17px/1.5 var(--body);background:#17202a;border-radius:8px;padding:18px 20px}
#clock{display:flex;justify-content:space-between;font:600 20px/1 var(--body);font-variant-numeric:tabular-nums}
.label{font:700 12px/1 var(--body);letter-spacing:.12em;text-transform:uppercase;color:#8d99a6;margin-bottom:8px}
#ov{display:none;position:absolute;inset:0;overflow:auto;background:#0e1319;z-index:5;padding:30px;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:22px}
.overview #ov{display:grid}
.ov-head{grid-column:1/-1;color:#a9b3bd;font:700 13px/1 var(--body);letter-spacing:.12em;text-transform:uppercase;padding-top:14px;border-top:1px solid #2a3644}
.thumb{position:relative;height:0;padding-bottom:56.25%;overflow:hidden;border-radius:6px;cursor:pointer;outline:3px solid transparent}
.thumb:hover,.thumb.cur{outline-color:var(--accent-line)}
.thumb .slide{transform-origin:0 0;opacity:1;visibility:visible;transition:none}
.thumb .n{position:absolute;left:8px;bottom:6px;font:700 13px/1 var(--body);color:var(--accent);z-index:2}
.audience #ui,.audience #bar{display:none}
@media (prefers-reduced-motion:reduce){.rv,.w{opacity:1!important;animation:none!important}.slide{transition:opacity .2s}}
@media print{@page{size:1920px 1080px;margin:0}html,body{overflow:visible;background:#fff}
  #app{position:static;display:block}#view{overflow:visible}#ui,#bar,#side,#ov{display:none!important}
  #stage{position:static;transform:none!important;width:1920px;height:auto}
  .slide{position:relative;width:1920px;height:1080px;opacity:1;visibility:visible;transform:none;page-break-after:always;break-after:page}
  .rv,.w{opacity:1!important;animation:none!important}}
"""

JS = r"""
(()=>{
const app=document.getElementById('app'),stage=document.getElementById('stage'),view=document.getElementById('view');
const S=[...stage.querySelectorAll('.slide')],N=S.length,meta=JSON.parse(document.getElementById('deck-meta').textContent);
const M=(k=>k<0?N:k)(S.findIndex(s=>s.classList.contains('t-appendix')));   // the presented story is S[0..M); the appendix is for questions
let back=null;
const label=n=>n<M?`${n+1} / ${M}`:n===M?'Appendix':`Appendix ${n-M} / ${N-M-1}`;
const qs=new URLSearchParams(location.search);let i=0,f=0,build=qs.get('build')==='step',peer=null,quiet=false;
const reduce=matchMedia('(prefers-reduced-motion: reduce)').matches;
if(qs.has('audience'))document.body.classList.add('audience');
function scale(box,el){const r=box.getBoundingClientRect(),k=Math.min(r.width/1920,r.height/1080);
  el.style.transform=box===view?`translate(-50%,-50%) scale(${k})`:`scale(${r.width/1920})`;}
function fit(s){const b=s.querySelector('.body');if(!b)return;const was=s.style.visibility;s.style.visibility='hidden';s.style.opacity='0';
  const inside=()=>{const r=b.getBoundingClientRect(),pb=parseFloat(getComputedStyle(b).paddingBottom)||0;   // content never above the body, nor below its padding (a frame's ground is reserved there)
    return [...b.children].every(c=>{const q=c.getBoundingClientRect();return q.top>=r.top-2&&q.bottom<=r.bottom-pb+2;});};
  for(const k of [1.16,1.08,1,.93,.86,.8,.74,.68,.62,.56,.5,.45]){s.style.setProperty('--s',k);if(b.scrollHeight<=b.clientHeight+2&&b.scrollWidth<=b.clientWidth+2&&inside())break;}
  s.style.visibility=was;s.style.opacity='';}
function count(el,delay){const v=parseFloat(el.dataset.v),sfx=el.dataset.sfx||'',dec=(el.dataset.v.split('.')[1]||'').length;
  if(reduce||isNaN(v))return;const t0=performance.now()+delay+120,dur=1100;el.textContent=(0).toFixed(dec)+sfx;
  const tick=now=>{const p=Math.min(1,Math.max(0,(now-t0)/dur)),e=1-Math.pow(1-p,3);el.textContent=(v*e).toFixed(dec)+sfx;if(p<1)requestAnimationFrame(tick);};
  requestAnimationFrame(tick);}
function steps(s){return +s.dataset.steps||0}
const parts=el=>el.classList.contains('ws')?[...el.querySelectorAll('.w')]:[el];
const stepEls=(s,k)=>[...s.querySelectorAll(`[data-f="${k}"]`)];
function play(els,rel){ // start these elements' reveal; rel: delays relative to the first of them
  const ps=els.flatMap(parts),base=rel?Math.min(...ps.map(x=>+x.dataset.d)):0;
  ps.forEach(x=>x.style.setProperty('--d',(+x.dataset.d-base)+'ms'));
  els.forEach(el=>el.querySelectorAll('.val[data-v]').forEach(v=>count(v,+el.dataset.d-base)));}
function enter(s,dir,upto){ // forward: play steps <= upto; backward: show them built, no replay
  s.classList.remove('on','still');s.querySelectorAll('.done,.held').forEach(x=>x.classList.remove('done','held'));
  void s.offsetWidth;s.classList.add('on');const all=[...s.querySelectorAll('[data-f]')];
  all.forEach(el=>{if(build&&+el.dataset.f>upto)el.classList.add('held')});
  const vis=all.filter(el=>!el.classList.contains('held'));
  if(dir<0)vis.forEach(el=>el.classList.add('done'));else play(vis,false);}
function reveal(s,k){const els=stepEls(s,k);els.forEach(el=>el.classList.remove('held','done'));play(els,true);}
function conceal(s,k){stepEls(s,k).forEach(el=>{el.classList.add('held');el.classList.remove('done')});}
function go(n,ff,dir){n=Math.max(0,Math.min(N-1,n));dir=dir||(n>=i?1:-1);
  S.forEach((s,k)=>{s.style.setProperty('--dir',dir);s.classList.toggle('cur',k===n);s.classList.toggle('past',k<n);if(k!==n)s.classList.remove('on')});
  i=n;f=build?Math.min(ff==null?0:ff,steps(S[n])):steps(S[n]);enter(S[n],dir,f);sync();}
function apply(n,ff){ // a remote position: step within the slide when possible
  if(n===i&&build){while(f<ff){f++;reveal(S[i],f)}while(f>ff){conceal(S[i],f);f--}sync();}
  else go(n,ff,n>=i?1:-1);}
function next(){const s=S[i];if(build&&f<steps(s)){f++;reveal(s,f);sync();}else if(i<N-1&&i!==M-1)go(i+1,0,1);}   // the story ends at M; A opens the appendix
function prev(){const s=S[i];if(build&&f>0){conceal(s,f);f--;sync();}else if(i>0)go(i-1,steps(S[i-1]),-1);}
function sync(){document.getElementById('bar').style.width=(i<M?(i+1)/M*100:100)+'%';document.getElementById('count').textContent=label(i);
  history.replaceState(null,'',location.pathname+location.search+'#'+(i+1));
  document.getElementById('btn-build').classList.toggle('on',build);
  if(document.body.classList.contains('presenter'))side();
  if(peer&&!quiet){try{peer.postMessage({napkinDeck:1,i,f,build},'*')}catch(e){}}
  if(qs.has('audience')&&window.opener&&!quiet){try{window.opener.postMessage({napkinDeck:1,i,f,build},'*')}catch(e){}}}
function clone(n,box){box.innerHTML='';if(n>=N||n===M){box.innerHTML=`<div style="color:#8d99a6;font:600 18px/1 sans-serif;padding:20px">${n===M?'End of the presentation (A: appendix)':'End of deck'}</div>`;return;}
  const c=S[n].cloneNode(true);c.classList.add('still');c.classList.remove('cur','past','on');box.appendChild(c);scale(box,c);}
let t0=null;
function side(){clone(i+1,document.getElementById('nextbox'));document.getElementById('notes').textContent=meta[i].notes;
  document.getElementById('where').textContent=`${label(i)}${build?` · step ${f}/${steps(S[i])}`:''} · ${meta[i].section}`;}
setInterval(()=>{if(!t0)return;const s=Math.floor((Date.now()-t0)/1000);document.getElementById('timer').textContent=`${String(Math.floor(s/60)).padStart(2,'0')}:${String(s%60).padStart(2,'0')}`},500);
function presenter(){if(qs.has('audience'))return;if(window.name==='napkin-audience')window.name='';   // never open the audience into this tab
  document.body.classList.add('presenter');t0=t0||Date.now();
  peer=window.open(location.pathname+'?audience'+(build?'&build=step':'')+'#'+(i+1),'napkin-audience');layout();side();setTimeout(sync,600);}
function overview(){const ov=document.getElementById('ov');document.body.classList.toggle('overview');if(!document.body.classList.contains('overview'))return;
  ov.innerHTML='';S.forEach((s,k)=>{if(k===M){const h=document.createElement('div');h.className='ov-head';h.textContent='Appendix: for questions, not presented';ov.appendChild(h);}
    const t=document.createElement('div');t.className='thumb'+(k===i?' cur':'');t.innerHTML=`<span class="n">${k<M?k+1:k===M?'A':'A'+(k-M)}</span>`;
    ov.appendChild(t);const c=s.cloneNode(true);c.classList.add('still');c.classList.remove('cur','past','on');t.appendChild(c);scale(t,c);
    t.onclick=()=>{document.body.classList.remove('overview');go(k)};});
  ov.querySelector('.cur')?.scrollIntoView({block:'center'});}
function layout(){scale(view,stage);if(document.body.classList.contains('presenter'))side();}
addEventListener('message',e=>{const d=e.data;if(!d||!d.napkinDeck)return;
  if(e.source!==peer&&e.source!==window.opener)return;   // only the paired presenter or audience window
  quiet=true;
  if(build!==d.build){build=d.build;go(d.i,d.f);}else apply(d.i,d.f);quiet=false;});
addEventListener('keydown',e=>{if(e.metaKey||e.ctrlKey||e.altKey)return;const k=e.key;
  if(['ArrowRight','ArrowDown',' ','PageDown','Enter'].includes(k)){e.preventDefault();next();}
  else if(['ArrowLeft','ArrowUp','PageUp','Backspace'].includes(k)){e.preventDefault();prev();}
  else if(k==='Home')go(0);else if(k==='End')go(i<M?M-1:N-1);
  else if((k==='a'||k==='A')&&M<N){if(i<M){back=i;go(M,null,1);}else go(back??M-1,null,-1);}
  else if(k==='b'||k==='B'){build=!build;go(i,build?0:null);}
  else if(k==='o'||k==='O')overview();else if(k==='Escape')document.body.classList.remove('overview');
  else if(k==='n'||k==='N'){if(document.body.classList.contains('presenter'))document.body.classList.remove('presenter');else{document.body.classList.add('presenter');t0=t0||Date.now();}layout();}
  else if(k==='p'||k==='P')presenter();
  else if(k==='f'||k==='F'){document.fullscreenElement?document.exitFullscreen():document.documentElement.requestFullscreen?.();}});
let tx=null;view.addEventListener('touchstart',e=>{tx=e.touches[0].clientX},{passive:true});
view.addEventListener('touchend',e=>{if(tx==null)return;const dx=e.changedTouches[0].clientX-tx;if(Math.abs(dx)>40)(dx<0?next:prev)();tx=null;});
view.addEventListener('click',e=>{if(e.target.closest('a,button')||String(getSelection()))return;(e.clientX>innerWidth*0.25?next:prev)();});
let hide;addEventListener('mousemove',()=>{app.classList.add('mouse');clearTimeout(hide);hide=setTimeout(()=>app.classList.remove('mouse'),1800)});
document.getElementById('btn-prev').onclick=prev;document.getElementById('btn-next').onclick=next;
document.getElementById('btn-ov').onclick=overview;document.getElementById('btn-build').onclick=()=>{build=!build;go(i,build?0:null)};
document.getElementById('btn-pres').onclick=presenter;
addEventListener('resize',layout);
addEventListener('hashchange',()=>{const n=(parseInt(location.hash.slice(1))||1)-1;if(n!==i){document.body.classList.remove('overview');go(n,build?0:null);}});
const start=()=>{S.forEach(fit);layout();go((parseInt(location.hash.slice(1))||1)-1,build?0:null);};
document.fonts&&document.fonts.ready?document.fonts.ready.then(start):start();
addEventListener('beforeprint',()=>S.forEach(s=>s.classList.add('still')));addEventListener('afterprint',()=>S.forEach(s=>s.classList.remove('still')));
})();
"""


#: The look of deck-layout-library on the web: a stamped title size per layout (``--tpt``, px = pt x 2 on the 1920 canvas, not scaled with the body),
#: body, small and lead text held to 48 characters a line, and the new layout ids sharing the column composition until each has its own grid.
LOOK_CSS = """
.slide[style*="--tpt"] h1.title{font-size:var(--tpt) !important}
.slide .body p,.slide .body li,.slide .body blockquote{max-inline-size:48ch}
.l-close .body,.l-big_statement .body,.l-quote_full .body{max-width:1200px}
.l-text_columns .col,.l-cards_split .col{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:56px}
"""


#: deck-look on the web (spec.LOOK_V3): the sans pair, the section band, 0.75 pt hairlines (1.5 px on the 1920 canvas) instead of the
#: accent edge stripes and tick, figures in ink. The fonts load from the machine, else from ``fonts/`` beside the page, else Arial.
LOOK_V3_FONTS = "'Archivo', Arial, 'Helvetica Neue', sans-serif"
LOOK_V3_BODY = "'Source Sans 3', Arial, 'Helvetica Neue', sans-serif"
LOOK_V3_CSS = """
@font-face{font-family:'Archivo';font-weight:100 900;font-stretch:62% 125%;src:local('Archivo'),url('fonts/Archivo/Archivo%5Bwdth,wght%5D.ttf') format('truetype')}
@font-face{font-family:'Source Sans 3';font-weight:200 900;src:local('Source Sans 3'),url('fonts/SourceSans3/SourceSans3%5Bwght%5D.ttf') format('truetype')}
.band{border-top:1.5px solid var(--ink);border-bottom:1.5px solid var(--ink);padding:12px 0 10px;margin:-12px 0 36px;font:700 24px/1.2 var(--head)}
.band.empty{height:16px;padding:0}
.dark .band{border-color:var(--dark-text)}
.kicker{display:none}
.b-callout{border-left:0;border-top:1.5px solid var(--ink);border-radius:0}
.b-quote{color:var(--ink)}.dark .b-quote{color:var(--dark-text)}
.step{border-top:1.5px solid var(--ink);border-radius:0}.step .no{color:var(--ink)}
.stat{border-top:1.5px solid var(--ink)}
.b-bullets li:before{background:var(--ink)}.dark .b-bullets li:before{background:var(--dark-text)}
.ft.to{background:var(--tint);color:var(--ink);border-top:1.5px solid var(--ink)}.dark .ft.to{background:#2a3644;color:var(--dark-text)}.ft.to .cap{color:var(--muted)}
.frame{border-radius:0;border-top:1.5px solid var(--dark-text)}
.pic,.b-card,.ft{border-radius:0}
"""


def theme_css(css: str | None = None, head: str | None = None, body: str | None = None, colors: dict | None = None, look: bool = True) -> str:
    """A stylesheet with the deck theme filled in (default: the whole web deck's); ``colors``: a brand's
    overrides by THEME key (accent_ink too). Under ``spec.LOOK_V3`` the default fonts are the sans pair and the band CSS is added."""
    v3 = bool(spec.LOOK_V3) and css is None
    head = head or (LOOK_V3_FONTS if v3 else HEAD_FONT)
    body = body or (LOOK_V3_BODY if v3 else BODY_FONT)
    css = (css or CSS_LAYOUT + (LOOK_CSS if (spec.LOOK_V2 and look) else "") + CSS_UI + (LOOK_V3_CSS + LOOK_V3_LAYOUT_CSS if v3 else "")).replace("HEAD", head).replace("BODY", body)
    T = {**THEME, **{k: v.lstrip("#") for k, v in (colors or {}).items()}}
    if T.get("panel"):   # a brand may name the card fill by its Theme field as well as by the legacy key
        T["tint"] = T["panel"]
    css = css.replace("#ACCENTL", "#" + (T.get("accent_line") or T["accent"]))
    if T.get("accent_ink"):
        css = css.replace("--accent-ink:#8A5A10", "--accent-ink:#" + T["accent_ink"])
    for k, v in (("INK", "ink"), ("PAPER", "paper"), ("ACCENT", "accent"), ("MUTED", "muted"), ("TINT", "tint"),
                 ("LINE", "line"), ("DARK", "dark_text")):
        css = css.replace("#" + k, "#" + T[v])
    return css


def size_css(cv) -> str:
    """deck-slide-size: the stage at 4:3 and A4 (2 px per pt: 1440 x 1080, 1684 x 1191), emitted only then, so a 16:9 deck.html keeps its bytes.
    The slide's paddings are physical px and stay; the flex layout reflows the width. The picture column and the bleed take the canvas map
    (theme.Canvas), and the print page is the canvas: px at 4:3, true A4 (297 x 210 mm, the stage zoomed to the page) on A4."""
    if cv is None or cv.identity:
        return ""
    W, H = cv.px
    px = lambda inch: round(inch * 144)   # noqa: E731
    col = max(360, px(cv.w_in - cv.x(13.333 - 5.0)))   # render_pptx.PIC_COL (5 in) through the map
    bleed = px(cv.y(6.85))
    page = ("@page{size:297mm 210mm;margin:0}" if cv.name == "a4" else f"@page{{size:{W}px {H}px;margin:0}}")
    zoom = f";zoom:{297 / 25.4 * 96 / W:.4f}" if cv.name == "a4" else ""
    side = ""
    for w in sorted({*PIC_SIDE.values(), 460, 560}, reverse=True):   # the side pictures and frames (pw<w> classes) narrow by k, never under 360 px
        z = max(cv.k, 360 / w)
        side += f".pw{w} .pics.side{{zoom:{z:.4f}}}.pw{w} header,.pw{w} .body{{margin-right:{round(w * z) + 70}px}}"
    return (f"\n#stage{{width:{W}px;height:{H}px}}#nextbox .slide,.thumb .slide{{width:{W}px;height:{H}px}}{side}"
            f"#nextbox,.thumb{{padding-bottom:{H / W * 100:.3f}%}}"
            f".pics.col{{width:{col}px}}.pic-col-left{{padding-left:{col + 94}px}}.pic-col-right{{padding-right:{col + 94}px}}.pic-col-right .flags{{right:{col + 94}px}}"
            f".pics.bleed{{width:{W}px;height:{bleed}px}}"
            f"@media print{{{page}#stage{{width:{W}px}}.slide{{width:{W}px;height:{H}px{zoom}}}}}\n")


def size_js(js: str, cv) -> str:
    """The deck's JS with the stage size the scale() function divides by (unchanged at 16:9)."""
    if cv is None or cv.identity:
        return js
    W, H = cv.px
    return js.replace("r.width/1920,r.height/1080", f"r.width/{W},r.height/{H}").replace("scale(${r.width/1920})", f"scale(${{r.width/{W}}})")


def _brand_css(meta: dict) -> dict:
    """theme_css arguments from a brand (meta.brand: colors, head and body font stacks)."""
    b = meta.get("brand") or {}
    return {k: v for k, v in (("head", b.get("head")), ("body", b.get("body")), ("colors", b.get("colors"))) if v}


def render(deck, inp, out: Path, findings: list | None = None, pictures: dict | None = None, placed: set | None = None, look: bool = True,
           icons: dict | None = None, clean: bool = False) -> Path:
    """Write the deck as one self-contained HTML file at ``out`` (pictures, when given, inline as data URIs). ``icons``: the icons the
    pptx drew (deck-graphics), drawn here as inline SVG at the same items; None or empty draws none and changes nothing."""
    views = slide_views(deck, inp, findings, Path(out).parent, pictures, placed=placed, icons=icons, clean=clean)
    m = deck["meta"]
    cv = themes.canvas_of(deck)   # deck-slide-size: the stage at the deck's size (16:9: nothing added)
    slides = "\n".join(
        f'<section class="slide t-{v["type"]}{" dark" if v["dark"] else ""}{" " + v["cls"] if v["cls"] else ""}{" l-" + v["layout"] if (spec.LOOK_V2 and v["layout"]) else ""}" id="{v["id"]}" data-steps="{v["steps"]}"{" data-layout=" + chr(34) + v["layout"] + chr(34) if (spec.LOOK_V2 and v["layout"]) else ""}{v["tpt"]} '
        f'aria-label="Slide {v["n"]}: {_a(v["title"])}">{v["html"]}</section>' for v in views)
    meta = json.dumps([{"id": v["id"], "section": v["section"], "notes": v["notes"]} for v in views], ensure_ascii=False)
    page = f"""<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>{_a(m["client"])}: {_a(m["project"])}</title>
<meta name="generator" content="Napkin Deck Maker (render_web)"><link rel="icon" href="data:,">
<style>{theme_css(**_brand_css(m), look=look)}{PIC_CSS if any(v["cls"] for v in views) else ""}{graphics_css(slides)}{size_css(cv)}</style></head>
<body><div id="app"><div id="view"><div id="bar"></div><div id="stage">
{slides}
</div><div id="ov"></div>
<div id="ui"><button id="btn-prev" title="Previous (←)">←</button><span id="count"></span><button id="btn-next" title="Next (→)">→</button>
<button id="btn-build" title="Build mode: reveal block by block (B)">Build</button><button id="btn-ov" title="Overview (O)">Overview</button>
<button id="btn-pres" title="Presenter view and audience window (P)">Present</button></div></div>
<aside id="side"><div><div class="label">Next</div><div id="nextbox"></div></div>
<div style="display:flex;flex-direction:column;min-height:0"><div class="label">Notes and evidence</div><div id="notes"></div></div>
<div id="clock"><span id="where"></span><span id="timer">00:00</span></div></aside></div>
<script type="application/json" id="deck-meta">{meta.replace("</", "<\\/")}</script>
<script>{size_js(JS, cv)}</script></body></html>
"""
    out.write_text(page, encoding="utf-8")
    if spec.LOOK_V3:   # the fonts folder beside the page (OFL, vendored): the page reads them when the machine has none
        import shutil
        shutil.copytree(Path(__file__).resolve().parent / "fonts", Path(out).parent / "fonts", dirs_exist_ok=True,
                        ignore=shutil.ignore_patterns("*.py", "widths.json", "__pycache__"))
    return out
