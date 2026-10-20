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

import html
import json
from pathlib import Path

from .refs import fmt
from .render_pptx import DARK_TYPES, THEME, _kicker
from .spec import frame_for, shown_blocks

#: The accent is 2.2:1 on white, so accent-coloured text on light slides uses a darker amber
#: (--accent-ink, 5.9:1 on white, 5.2:1 on the tint); dark slides keep the accent (7.3:1 on ink).
KICKERS = {"title": None, "real_question": "The real question", "idea": "The idea"}   # title: _kicker(meta)
HEAD_FONT = "Cambria, Charter, 'Iowan Old Style', Georgia, serif"
BODY_FONT = "Calibri, Carlito, 'Segoe UI', 'Helvetica Neue', Arial, sans-serif"


def _e(t) -> str:
    """Escape text for HTML."""
    return html.escape(str(t), quote=True)


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
            body = "".join(self.rv("", "".join(f"<td>{_e(c)}</td>" for c in r), "tr", 55) for r in rows[1:])
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
                self.rv("step", f'<div class="no">{i + 1:02d}</div><div class="lab">{_e(lab)}</div><p>{_e(val)}</p>', gap=120)
                for i, (lab, val) in enumerate(b["items"]))
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


def _body(s, b: _Slide, blocks: list) -> str:
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
        copy = {**pick("copy"), "frame": frame_for(s["title"])}
        vis = s.get("visual") or {}
        if vis.get("kind") == "image_prompt":
            b.f += 1
            left += b.rv("b-prompt", _e(f"Image prompt ({vis.get('status', 'illustrative')}): {vis.get('prompt', '')}"), "p")
        return f'<div class="body split exec{" framed" if copy["frame"] else ""}"><div class="col">{left}</div><div class="col">{b.blocks([copy])}</div></div>'
    return f'<div class="body col">{b.blocks(blocks)}</div>'


def slide_views(deck, inp, findings: list | None = None) -> list:
    """Per slide, in order: id, number, type, dark, inner markup, notes, build-step count and, per
    step, the latest reveal delay (ms) up to and including it."""
    failed = {}
    for f in findings or []:
        if f["level"] == "error" and f.get("slide"):
            failed.setdefault(f["slide"], set()).add(f["check"])
    n_human = sum(1 for s in deck["slides"].values() if s["status"] == "needs_human")
    audience = deck["meta"].get("audience", "review")
    out = []
    for n, sid in enumerate(deck["order"], 1):
        s = deck["slides"][sid]
        b = _Slide(inp)
        dark = s["type"] in DARK_TYPES
        logo = (deck["meta"].get("brand") or {}).get("logo_dark_svg") if s["type"] == "title" else None
        kick = (b.rv("brand-logo", logo, "div", 160) if logo else
                b.rv("kicker", _e(KICKERS[s["type"]] or _kicker(deck["meta"])), "div", 120) if s["type"] in KICKERS else "")
        title = b.words(s["title"], "title", "h1") if dark else b.rv("title", _e(s["title"]), "h1", 220)
        body = _body(s, b, shown_blocks(s, audience))
        foot = f'<span>{_e(s["section"])}</span>'
        if s.get("footnotes"):
            foot += f'<span class="src">Sources {" ".join(f"[{k}]" for k in s["footnotes"][:14])} (appendix)</span>'
        foot += f'<span class="num">{n}</span>'
        flags = ""
        if n_human:
            flags += f'<span class="draft">DRAFT · {"needs a person" if s["status"] == "needs_human" else f"{n_human} slides need a person"}</span>'
        if sid in failed:
            flags += f'<span class="failed">CHECK FAILED: {_e(", ".join(sorted(failed[sid])))}</span>'
        inner = (f'<div class="flags">{flags}</div><header>{kick}{title}</header>{body}'
                 f'<footer>{foot}</footer>')
        notes = (s.get("notes") or "") + f"\n\nSlide id {sid} · status {s['status']} · requirements {', '.join(s.get('requirements') or []) or 'none'}"
        out.append({"id": sid, "n": n, "type": s["type"], "section": s["section"], "dark": dark,
                    "title": s["title"], "html": inner, "notes": notes, "steps": b.f, "status": s["status"],
                    "last": [max(v for k, v in b.last.items() if k <= f) for f in range(b.f + 1)]})
    return out


CSS_LAYOUT = """
:root{--ink:#INK;--paper:#PAPER;--accent:#ACCENT;--accent-ink:#8A5A10;--muted:#MUTED;--tint:#TINT;--line:#LINE;--dark-text:#DARK;
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
.b-callout{background:var(--tint);color:var(--ink);border-left:8px solid var(--accent);padding:calc(var(--s)*26px) 36px;font-size:calc(var(--s)*34px);line-height:1.35;border-radius:10px}
.b-card{background:var(--tint);color:var(--ink);padding:calc(var(--s)*28px) 36px;border-radius:12px}
.cap,.b-cap{font:700 calc(var(--s)*22px)/1.2 var(--body);letter-spacing:.1em;text-transform:uppercase;color:var(--muted);margin-bottom:10px}
.b-card p{font-size:calc(var(--s)*32px);line-height:1.38}
.b-bullets ul{list-style:none;display:flex;flex-direction:column;gap:calc(var(--s)*14px)}
.b-bullets li{position:relative;padding-left:40px;font-size:calc(var(--s)*34px);line-height:1.34}
.b-bullets li:before{content:"";position:absolute;left:4px;top:.55em;width:14px;height:14px;border-radius:50%;background:var(--accent)}
.human{outline:3px dashed var(--accent);outline-offset:8px;border-radius:6px}
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
.ft-arrow{display:grid;place-items:center}.ft-arrow svg{width:90px;fill:none;stroke:var(--accent);stroke-width:6;stroke-linecap:round;stroke-linejoin:round}
.ft-arrow path{stroke-dasharray:120;stroke-dashoffset:0}
.b-steps{display:grid;grid-template-columns:repeat(var(--n),1fr);gap:20px;position:relative}
.step{background:var(--tint);color:var(--ink);border-radius:12px;padding:calc(var(--s)*26px) 26px;border-top:6px solid var(--accent)}
.step .no{font:700 22px/1 var(--body);color:var(--accent-ink);margin-bottom:14px}
.step .lab{font:700 calc(var(--s)*27px)/1.2 var(--body);margin-bottom:12px}.step p{font-size:calc(var(--s)*27px);line-height:1.34}
.b-chart{display:flex;flex-direction:column;gap:calc(var(--s)*22px)}
.bar{display:grid;grid-template-columns:330px 1fr 110px;align-items:center;gap:22px}
.bar .lab{font-size:calc(var(--s)*26px);line-height:1.2;text-align:right}
.bar .track{height:calc(var(--s)*54px);background:var(--tint);border-radius:6px;overflow:hidden}
.bar i{display:block;height:100%;background:var(--accent);border-radius:6px;transform-origin:0 50%}
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
.stat{border-top:8px solid var(--accent);padding-top:22px;display:flex;flex-direction:column;gap:10px}
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
#bar{position:absolute;left:0;top:0;height:5px;background:var(--accent);transition:width .5s var(--ease);z-index:3}
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
.thumb:hover,.thumb.cur{outline-color:var(--accent)}
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
  for(const k of [1.16,1.08,1,.93,.86,.8,.74,.68,.62]){s.style.setProperty('--s',k);if(b.scrollHeight<=b.clientHeight+2&&b.scrollWidth<=b.clientWidth+2)break;}
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


def theme_css(css: str | None = None, head: str = HEAD_FONT, body: str = BODY_FONT, colors: dict | None = None) -> str:
    """A stylesheet with the deck theme filled in (default: the whole web deck's); ``colors``: a brand's
    overrides by THEME key (accent_ink too)."""
    css = (css or CSS_LAYOUT + CSS_UI).replace("HEAD", head).replace("BODY", body)
    T = {**THEME, **{k: v.lstrip("#") for k, v in (colors or {}).items()}}
    if T.get("accent_ink"):
        css = css.replace("--accent-ink:#8A5A10", "--accent-ink:#" + T["accent_ink"])
    for k, v in (("INK", "ink"), ("PAPER", "paper"), ("ACCENT", "accent"), ("MUTED", "muted"), ("TINT", "tint"),
                 ("LINE", "line"), ("DARK", "dark_text")):
        css = css.replace("#" + k, "#" + T[v])
    return css


def _brand_css(meta: dict) -> dict:
    """theme_css arguments from a brand (meta.brand: colors, head and body font stacks)."""
    b = meta.get("brand") or {}
    return {k: v for k, v in (("head", b.get("head")), ("body", b.get("body")), ("colors", b.get("colors"))) if v}


def render(deck, inp, out: Path, findings: list | None = None) -> Path:
    """Write the deck as one self-contained HTML file at ``out``."""
    views = slide_views(deck, inp, findings)
    m = deck["meta"]
    slides = "\n".join(
        f'<section class="slide t-{v["type"]}{" dark" if v["dark"] else ""}" id="{v["id"]}" data-steps="{v["steps"]}" '
        f'aria-label="Slide {v["n"]}: {_e(v["title"])}">{v["html"]}</section>' for v in views)
    meta = json.dumps([{"id": v["id"], "section": v["section"], "notes": v["notes"]} for v in views], ensure_ascii=False)
    page = f"""<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>{_e(m["client"])}: {_e(m["project"])}</title>
<meta name="generator" content="Napkin Deck Maker (render_web)"><link rel="icon" href="data:,">
<style>{theme_css(**_brand_css(m))}</style></head>
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
<script>{JS}</script></body></html>
"""
    out.write_text(page, encoding="utf-8")
    return out
