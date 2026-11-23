"""What a person downloads from Territories (feature territories-exports): the board, a one-pager per route, the JSON.

The files are made here and handed over by ``fetch_territories_file@1`` (``delivery.register_file`` / ``register_family``). The two documents are
HTML, not PDF: the app gives that HTML to the host's export (``clan.exportDoc('pdf', ...)``), and napkin-web prints it with Chromium, as it prints
a Brief or the Deck. So this module adds no renderer and no native dependency, and the person gets the file through the host's own download
path, never a blob link inside the app's sandboxed frame (which has no ``allow-downloads``). The JSON goes the same way (``exportDoc('json', ...)``).

What every file keeps to (the owner's rules for exports):
  * rank only: the judge's order as "Judge #n"; no /35 score, no marks, never a price or a cost;
  * a picture's rights as the screen says them, and an unknown or missing choice reads "Rights to supply";
  * a sketch is labelled "Mock-up" (the palette sketches, drawn the way the page draws them: ``scene`` below is the page's ``scene`` in Python,
    and ``test_territories_exports.py`` runs both and compares them);
  * no internal id, no markdown mark, no "(to confirm)", no bracket placeholder, no field name: ``clean`` drops what the page would not draw;
  * only the two cleared faces: Newsreader, and Geist at weight 800;
  * a client copy (``client=True``) leaves out the sources and the derived marks, the way a client review hides scores and sources.

Length is held in code (``LIMITS``): two routes to a page on the board, one page for a one-pager.
"""
from __future__ import annotations

import base64
import html as _html
import json
import re
from datetime import datetime

from . import delivery

BOARD = "territories-board.html"
BOARD_CLIENT = "territories-board-client.html"
ROUTE_PREFIX = "territories-route-"                 # + <route id> + ".html"
ROUTE_CLIENT_PREFIX = "territories-client-route-"   # the client copy of the same
JSON_FILE = "territories.json"

#: how much of each thing a page carries (the board holds two routes to a page, a one-pager is one page)
LIMITS = {"thought": 200, "why": 260, "line": 90, "lines": 3, "pic_board": 2, "pic_route": 4, "source": 150, "sources": 3,
          "risk": 180, "risks": 2, "frame": 110, "frames": 4, "radio": 3, "radio_text": 110}

BAND_WORDS = {"core": "Core", "stretch": "Stretch", "far_out": "Far out"}
TOUCH_NAMES = {"tv": "TV", "story": "Story", "poster": "Poster", "radio": "Radio", "seat": "Table card", "email": "Email"}
TRUSTED = ("generated", "own", "licensed")
RIGHTS_WORDS = {"generated": "Generated", "own": "Own", "licensed": "Licensed"}
BRIEF_LABELS = {"background": "Background", "objectives": "Objectives", "audience": "Audience", "competitor_context": "Competitors",
                "insight": "Insight", "smp": "Single-minded proposition", "reasons_to_believe": "Reasons to believe",
                "desired_response": "Desired response", "tone_world_assets": "Tone and world", "budget_scope": "Budget and scope",
                "mandatories": "Mandatories"}
_BRIEF_KEYS = {"smp": "single_minded_proposition", "tone_world_assets": "tone_and_world", "budget_scope": "budget_and_scope"}
HEX6 = re.compile(r"^#[0-9a-fA-F]{6}$")
#: what a person must never see (the page's own LEAK, plus brackets, snake_case keys and internal ids)
LEAK = re.compile(r"\(to confirm\)|\bTBC\b|\*\*|~~|\{\{|\}\}|\[[^\]]*\]|^#\s|field is null|^(none|null|undefined)$"
                  r"|\b[a-z]+(?:_[a-z0-9]+)+\b|\b(?:t|cr|ex|ck|ask|act|lq|nt|snd|pic|in|x|f|fi)_[0-9A-Za-z_]{2,}\b", re.I)
FONTS_LINK = ("https://fonts.googleapis.com/css2?family=Newsreader:ital,opsz,wght@0,6..72,400;0,6..72,500;0,6..72,600;1,6..72,400"
              "&family=Geist:wght@800&display=swap")
BRAND_LINE = "Made with Napkin"


def esc(s) -> str:
    return _html.escape(str(s if s is not None else ""), quote=True)


def _obj(v) -> dict:
    return v if isinstance(v, dict) else {}


def _arr(v) -> list:
    return v if isinstance(v, list) else []


def text(v) -> str:
    if isinstance(v, dict) and "value" in v:
        v = v["value"]
    if isinstance(v, str):
        return v.strip()
    if isinstance(v, (int, float)) and not isinstance(v, bool):
        return str(v)
    return ""


def clean(v) -> str:
    """The text, or nothing when it is something a person must not see."""
    s = text(v)
    return "" if (not s or LEAK.search(s)) else s


def clip(s: str, n: int) -> str:
    """At most ``n`` characters, cut at a word, with an ellipsis."""
    s = " ".join((s or "").split())
    if len(s) <= n:
        return s
    cut = s[: n - 1].rsplit(" ", 1)[0].rstrip(",;:.- ")
    return (cut or s[: n - 1]) + "…"


# ---------------------------------------------------------------- the sketches: the page's `scene`, in Python


def _hills(y, amp, fill, op=None) -> str:
    return f'<path d="M0 {y} Q100 {y - amp} 200 {y} T400 {y} T600 {y} T800 {y} V300 H0Z" fill="{fill}" opacity="{1 if op is None else op}"/>'


def scene(k: str, p: dict) -> str:
    """One scene of the cleared list, drawn from the route's palette alone (the page's ``scene``: same shapes, same order)."""
    B, I, A, S = p["bg"], p["ink"], p["acc"], p["soft"]
    s = f'<rect width="400" height="300" fill="{B}"/>'
    n6 = range(6)

    def win(inner: str) -> str:
        return (f'<rect width="400" height="300" fill="{I}"/><svg x="40" y="28" width="320" height="196" viewBox="0 0 320 196"><rect width="320" height="196" fill="{B}"/>{inner}</svg>'
                f'<rect x="40" y="28" width="320" height="196" rx="26" fill="none" stroke="{S}" stroke-width="12"/><rect x="0" y="246" width="400" height="54" fill="{S}"/>'
                f'<rect x="292" y="222" width="28" height="26" rx="5" fill="{A}"/>')

    if k == "platform":
        s += (f'<circle cx="300" cy="86" r="46" fill="{A}"/><rect x="0" y="204" width="400" height="96" fill="{S}"/>'
              f'<rect x="-10" y="128" width="380" height="74" rx="20" fill="{I}"/>'
              + "".join(f'<rect x="{8 + i * 58}" y="146" width="40" height="26" rx="6" fill="{A}"/>' for i in n6)
              + f'<rect x="0" y="200" width="400" height="6" fill="{I}"/><line x1="0" y1="246" x2="400" y2="246" stroke="{I}" stroke-width="3" stroke-dasharray="16 12"/>'
              f'<g transform="translate(70,48)"><line y1="-24" y2="-48" stroke="{I}" stroke-width="3"/><circle r="24" fill="{A}" stroke="{I}" stroke-width="4"/><line y2="-15" stroke="{I}" stroke-width="3"/><line x2="11" y2="4" stroke="{I}" stroke-width="3"/></g>')
    elif k == "window":
        s = win(f'<circle cx="236" cy="56" r="26" fill="{A}"/>' + _hills(120, 26, S) + _hills(158, 18, I, 0.35))
    elif k == "sleep":
        s = win(f'<circle cx="236" cy="56" r="26" fill="{A}"/>' + _hills(124, 24, S) + _hills(160, 16, I, 0.35)) + (
            f'<path d="M60 84 h40 l-40 40 h40 M108 66 h26 l-26 26 h26" stroke="{A}" stroke-width="7" stroke-linejoin="round" stroke-linecap="round" fill="none"/>')
    elif k == "table":
        s = (f'<rect width="400" height="300" fill="{S}"/><rect x="56" y="34" width="288" height="232" rx="18" fill="{B}"/>'
             f'<circle cx="118" cy="96" r="22" fill="{I}"/><circle cx="118" cy="96" r="14" fill="{A}"/><circle cx="282" cy="204" r="22" fill="{I}"/><circle cx="282" cy="204" r="14" fill="{A}"/>'
             f'<rect x="170" y="120" width="96" height="64" rx="4" fill="{A}" transform="rotate(-8 218 152)"/><line x1="218" y1="114" x2="214" y2="186" stroke="{I}" stroke-width="2" transform="rotate(-8 218 152)"/>'
             f'<circle cx="120" cy="214" r="18" fill="{I}" opacity=".85"/><rect x="262" y="60" width="34" height="58" rx="7" fill="{I}"/>')
    elif k == "arrival":
        s += (f'<circle cx="210" cy="190" r="70" fill="{A}"/><rect x="0" y="190" width="400" height="110" fill="{S}"/>'
              + "".join(f'<line x1="{30 + i * 40}" y1="{214 + i * 18}" x2="{370 - i * 30}" y2="{214 + i * 18}" stroke="{B}" stroke-width="3" stroke-dasharray="30 18"/>' for i in range(4))
              + f'<path d="M0 190 L0 120 Q60 100 130 140 L160 190Z" fill="{I}"/>'
              + "".join(f'<rect x="{16 + i * 28}" y="{138 + (i % 2) * 8}" width="20" height="18" fill="{A}"/>' for i in range(4)))
    elif k == "car":
        s = (f'<rect width="400" height="300" fill="{I}"/><path d="M40 36 H360 L330 172 H70Z" fill="{S}"/><path d="M186 172 L200 70 L214 172Z" fill="{B}" opacity=".7"/>'
             f'<path d="M0 180 Q200 150 400 180 V300 H0Z" fill="{I}"/><circle cx="130" cy="262" r="70" fill="none" stroke="{A}" stroke-width="14"/>')
    elif k == "night":
        s += ("".join(f'<circle cx="{(i * 71) % 400}" cy="{(i * 37) % 140}" r="{1.2 if i % 3 else 2}" fill="{I}" opacity=".7"/>' for i in range(26))
              + f'<circle cx="330" cy="60" r="22" fill="{A}"/>' + _hills(214, 30, S) + f'<rect x="10" y="182" width="370" height="40" rx="12" fill="{I}" opacity=".95"/>'
              + "".join(f'<rect x="{22 + i * 44}" y="190" width="30" height="18" rx="3" fill="{A}"/>' for i in range(8))
              + f'<rect x="0" y="230" width="400" height="70" fill="{S}" opacity=".6"/>')
    elif k == "road":
        s += (f'<rect y="0" width="400" height="140" fill="{S}" opacity=".6"/><path d="M170 140 H230 L400 300 H0Z" fill="{S}"/>'
              + "".join(f'<rect x="{197 - i}" y="{150 + i * 36}" width="{4 + i * 2}" height="{10 + i * 6}" fill="{I}" opacity=".7"/>' for i in range(4)))
    elif k == "home":
        s += (f'<circle cx="320" cy="64" r="24" fill="{A}"/><rect x="0" y="228" width="400" height="72" fill="{S}"/><path d="M120 228 V150 L190 104 L260 150 V228Z" fill="{I}"/>'
              f'<rect x="150" y="160" width="34" height="30" fill="{A}"/><rect x="200" y="186" width="30" height="42" fill="{A}" opacity=".8"/>')
    else:
        hs, cs = [80, 104, 70, 118, 90, 76, 100], [A, S, I, S, A, I, S]
        s += (f'<circle cx="320" cy="70" r="30" fill="{A}" opacity=".85"/>'
              + "".join(f'<rect x="{i * 58}" y="{236 - hs[i]}" width="56" height="{hs[i]}" fill="{cs[i]}"/>' for i in range(7))
              + f'<rect x="0" y="236" width="400" height="64" fill="{S}"/>')
    return f'<svg viewBox="0 0 400 300" preserveAspectRatio="xMidYMid slice" aria-hidden="true">{s}</svg>'


# ---------------------------------------------------------------- reading the document the way the page does


def palette(t: dict) -> dict:
    p = _obj(_obj(t.get("world")).get("palette"))

    def g(k, d):
        return p[k] if HEX6.match(str(p.get(k) or "")) else d
    return {"bg": g("bg", "#F3ECDC"), "ink": g("ink", "#141413"), "acc": g("acc", "#FFFFFF"), "soft": g("soft", "#C9C0AE")}


def headline(t: dict) -> str:
    w = _obj(t.get("world"))
    d, h = _obj(w.get("dial")), _obj(w.get("headlines"))
    lead = clean(w.get("lead"))
    if lead:
        return lead
    tone, energy = d.get("tone"), d.get("energy")
    key = ("w" if isinstance(tone, (int, float)) and tone < 50 else "s") + ("q" if isinstance(energy, (int, float)) and energy < 50 else "l")
    return clean(h.get(key)) or clean(h.get("wq")) or clean(h.get("sq")) or clean(t.get("name"))


_NO_RANK = 10 ** 9


def _rank(t: dict) -> int:
    r = t.get("rank")
    return r if isinstance(r, int) and not isinstance(r, bool) else _NO_RANK


def greenlit_routes(data: dict) -> list[dict]:
    """The greenlit routes that are still live, in the judge's order (unranked last), each once."""
    by_id = {t.get("id"): t for t in _arr(data.get("territories")) if isinstance(t, dict)}
    out, seen = [], set()
    for g in _arr(data.get("greenlit")):
        t = by_id.get(_obj(g).get("territory_id"))
        if t and t["id"] not in seen and t.get("status", "live") != "killed":
            seen.add(t["id"])
            out.append(t)
    return sorted(out, key=_rank)   # stable: the order they were greenlit in breaks a tie


def greenlit_of(data: dict, tid: str) -> dict:
    return next((g for g in _arr(data.get("greenlit")) if _obj(g).get("territory_id") == tid), {})


def run_date(data: dict) -> str:
    """The latest greenlight's day, as people write it (the document's date); empty when nothing is greenlit."""
    days = [str(_obj(g).get("at") or "")[:10] for g in _arr(data.get("greenlit"))]
    days = [d for d in days if re.fullmatch(r"\d{4}-\d{2}-\d{2}", d)]
    if not days:
        return ""
    d = datetime.strptime(max(days), "%Y-%m-%d")
    return f"{d.day} {d.strftime('%B %Y')}"


def rank_words(t: dict) -> str:
    r = _rank(t)
    return f"Judge #{r}" if r != _NO_RANK else "Not ranked"


def rights_word(v) -> str:
    return RIGHTS_WORDS.get(v, "Rights to supply")


def _upstream(data: dict) -> tuple[dict | None, dict, dict, str]:
    """(the brief, pins, findings, research title) as the page's ``upstreamOf`` reads them."""
    brief, rdoc = None, {}
    for _id, src in _obj(data.get("upstream")).items():
        if not isinstance(src, dict) or not src or isinstance(src.get("kit"), dict):
            continue
        is_brief = any(text(src.get(k)) for k in ("single_minded_proposition", "objectives", "audience", "insight", "background"))
        if is_brief and brief is None:
            brief = src
        elif not is_brief and not rdoc:
            rdoc = src
    own, proj = _obj(rdoc.get("projection")), _obj(data.get("projection"))
    pins = _obj(proj.get("pins")) or _obj(own.get("pins"))
    found = _obj(proj.get("findings")) or _obj(own.get("findings"))
    rtitle = clean(rdoc.get("title")) or clean(_obj(rdoc.get("campaign")).get("name")) or "Research"
    return brief, pins, found, rtitle


def source_lines(t: dict, data: dict) -> list[dict]:
    """What the route rests on, in words: ``{label, text, derived}`` for each cite this document carries (an id that does not resolve is left out;
    it is never printed)."""
    brief, pins, found, rtitle = _upstream(data)
    out = []
    for cite in _arr(t.get("evidence")):
        cite = str(cite)
        m = re.fullmatch(r"brief:([a-z_]+)", cite)
        if m:
            name = m.group(1)
            val = text(_obj(brief).get(name)) or text(_obj(brief).get(_BRIEF_KEYS.get(name, name)))
            if brief is not None and val and name in BRIEF_LABELS:
                out.append({"label": "Brief: " + BRIEF_LABELS[name], "text": clean(val), "derived": False})
        elif cite.startswith("f_") and cite in pins:
            p = _obj(pins[cite])
            unit = text(p.get("unit"))
            out.append({"label": "Fact in " + rtitle, "text": clean(text(p.get("value")) + (" " + unit if unit and unit != "text" else "")), "derived": False})
        elif cite.startswith("fi_") and cite in found:
            f = _obj(found[cite])
            out.append({"label": "Finding in " + rtitle, "text": clean(f.get("statement")), "derived": f.get("status") == "proposed"})
    return [s for s in out if s["text"]]


def pictures(t: dict, reader=None) -> list[dict]:
    """The route's picture slots as the screen shows them; a route with no slots yet shows the sketches of its own world (the page's four touchpoints)."""
    slots = [p for p in _arr(t.get("pictures")) if isinstance(p, dict) and p.get("id")]
    if not slots:
        sc = _obj(_obj(t.get("world")).get("scenes"))
        slots = [{"kind": "sketch", "touchpoint": k, "scene": sc.get(k) or "platform"} for k in ("poster", "story", "seat", "email")]
    out = []
    for s in slots:
        kind = s.get("kind")
        row = {"kind": kind, "touchpoint": TOUCH_NAMES.get(s.get("touchpoint"), "Picture"), "scene": s.get("scene") or "platform", "final": bool(s.get("final"))}
        if kind == "gap":
            row.update(gap=clean(s.get("gap_reason")) or "No picture yet.", label=None)
        elif kind == "frame":
            r = s.get("rights") if s.get("rights") in TRUSTED else "unknown"
            src, sha = None, str(s.get("sha256") or "")
            if reader and re.fullmatch(r"[0-9a-f]{64}", sha):
                try:
                    raw = reader(sha)
                except Exception:   # noqa: BLE001 - a picture that will not read is a tile without it, never a failed file
                    raw = None
                if raw:
                    src = ("data:image/png;base64," if raw[:4] == b"\x89PNG" else "data:image/jpeg;base64,") + base64.b64encode(raw).decode()
            row.update(label="Illustrative", rights_word=rights_word(r), trusted=r in TRUSTED, src=src)
        else:
            row.update(kind="sketch", label="Mock-up")
        out.append(row)
    return sorted(out, key=lambda r: r["kind"] == "gap")   # a gap only says why a place is empty; sketches and frames lead


# ---------------------------------------------------------------- drawing

SANS = "'Geist', sans-serif"
SERIF = "'Newsreader', serif"
CSS = """
@page { size: A4; margin: 14mm 14mm 16mm; }
* { box-sizing: border-box; }
html { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
body { margin: 0; font: 400 10.2pt/1.45 SERIF; color: #14161B; background: #fff; }
.eyebrow, .tag, .lab, .lab2, .chip, .fin, .foot, .cap, .src b, .rl b { font-family: SANS; font-weight: 800; }
.eyebrow { font-size: 7.6pt; text-transform: uppercase; letter-spacing: .12em; color: #5a5e66; }
h1 { font: 600 24pt/1.1 SERIF; margin: 2mm 0 1mm; }
h2 { font: 600 17pt/1.15 SERIF; margin: 1.2mm 0 1mm; }
p { margin: 0 0 1.6mm; }
.meta { font: 400 8.6pt SANS; color: #5a5e66; }
.head { padding-bottom: 4mm; border-bottom: .6pt solid #14161B; margin-bottom: 5mm; }
.route { break-inside: avoid; page-break-inside: avoid; height: 112mm; overflow: hidden; padding-bottom: 4mm; margin-bottom: 4mm; border-bottom: .4pt solid #c9ccd2; }
.board .route:nth-of-type(2n) { break-after: page; page-break-after: always; border-bottom: 0; }
.board .route:last-of-type { break-after: auto; page-break-after: auto; border-bottom: 0; }
.top { display: flex; gap: 3mm; align-items: baseline; font: 800 8.4pt SANS; letter-spacing: .02em; color: #5a5e66; }
.top .tag { color: #14161B; }
.thought { font-style: italic; font-size: 11pt; margin: 0 0 2.4mm; }
.cols { display: flex; gap: 5mm; }
.cols > div { flex: 1 1 0; min-width: 0; }
.hero { border-radius: 2mm; padding: 4mm 4.4mm; margin-bottom: 2.4mm; }
.hero .hl { font: 600 15pt/1.15 SERIF; }
.hero.ff .hl { font: 800 14pt/1.15 SANS; }
.hero.it .hl { font-style: italic; }
.sw { display: flex; gap: 1.4mm; margin: 0 0 2.4mm; }
.sw i { display: block; width: 9mm; height: 5mm; border-radius: 1mm; border: .4pt solid rgba(20,22,27,.25); }
.pics { display: grid; grid-template-columns: repeat(2, 1fr); gap: 2.4mm; margin-bottom: 2.4mm; }
.pic { position: relative; margin: 0; }
.pic .face { position: relative; aspect-ratio: 4 / 3; border-radius: 1.6mm; overflow: hidden; border: .4pt solid rgba(20,22,27,.25); }
.pic .face svg, .pic .face img { width: 100%; height: 100%; display: block; object-fit: cover; }
.pic .face.gap { display: flex; align-items: center; justify-content: center; text-align: center; padding: 3mm; background: #f1f2f4; font-size: 8.4pt; color: #5a5e66; }
.pic .lab { position: absolute; left: 1.4mm; top: 1.4mm; background: #14161B; color: #fff; font-size: 7pt; letter-spacing: .02em; padding: .5mm 1.6mm; border-radius: .8mm; }
.pic .cap { margin-top: .8mm; font-size: 7.4pt; }
.chip, .fin { display: inline-block; font-size: 7pt; letter-spacing: .02em; border-radius: 4mm; padding: .4mm 2mm; border: .5pt solid #14161B; margin-left: 1.4mm; }
.chip.sup { background: #FBE9D0; border-color: #A25A00; color: #6e3d00; }
.chip.ok { background: #DCEFE3; border-color: #1B6B3B; color: #134d2a; }
.chip.der { background: #EFE4F7; border-color: #6a3d96; color: #4a2870; }
.fin { background: #14161B; color: #fff; }
.lines { margin: 0 0 2.2mm; padding: 0 0 0 4mm; }
.lines li { margin-bottom: .8mm; }
.lab2 { display: block; font-size: 7pt; text-transform: uppercase; letter-spacing: .1em; color: #5a5e66; margin: 2.2mm 0 .8mm; }
.src { font-size: 8.8pt; margin: 0 0 1.2mm; }
.src b { font-size: 6.8pt; text-transform: uppercase; letter-spacing: .06em; margin-right: 1mm; }
.rl { font-size: 9pt; margin: 0 0 .8mm; }
.rl b { font-size: 7pt; margin-right: 1.4mm; }
.foot { margin-top: 5mm; font-size: 7.2pt; letter-spacing: .06em; color: #5a5e66; text-transform: uppercase; }
.one .page { height: 264mm; overflow: hidden; }
.one .hero { padding: 6mm; }
.one .hero .hl { font-size: 20pt; }
.one .hero.ff .hl { font-size: 18pt; }
""".replace("SERIF", SERIF).replace("SANS", SANS)


def _head(tag: str, title: str, sub: str) -> str:
    return f'<div class="head"><div class="eyebrow">{esc(tag)}</div><h1>{esc(title)}</h1><div class="meta">{esc(sub)}</div></div>'


def _hero(t: dict) -> str:
    w = _obj(t.get("world"))
    p = palette(t)
    ty = _obj(w.get("type"))
    ff = " ff" if ty.get("font") == "geist_extra_bold" else ""
    it = " it" if ty.get("italic") and not ff else ""
    sw = "".join(f'<i style="background:{p[k]}"></i>' for k in ("bg", "ink", "acc", "soft"))
    return f'<div class="hero{ff}{it}" style="background:{p["bg"]};color:{p["ink"]}"><div class="hl">{esc(headline(t))}</div></div><div class="sw">{sw}</div>'


def _picture(row: dict, p: dict) -> str:
    chips = ""
    if row["kind"] == "frame":
        chips = f'<span class="chip {"ok" if row["trusted"] else "sup"}">{esc(row["rights_word"])}</span>'
    if row.get("final"):
        chips += '<span class="fin">Final</span>'
    if row["kind"] == "gap":
        face = f'<div class="face gap"><span>{esc(row["gap"])}</span></div>'
    elif row["kind"] == "sketch":
        face = f'<div class="face" style="background:{p["bg"]}">{scene(row["scene"], p)}<span class="lab">{esc(row["label"])}</span></div>'
    else:
        img = f'<img src="{row["src"]}" alt="">' if row.get("src") else ""
        face = f'<div class="face gap" style="background:{p["bg"]}">{img}<span class="lab">{esc(row["label"])}</span></div>'
    return f'<figure class="pic">{face}<div class="cap">{esc(row["touchpoint"])}{chips}</div></figure>'


def _pictures(t: dict, n: int, reader) -> str:
    rows, p = pictures(t, reader)[:n], palette(t)
    return f'<div class="pics">{"".join(_picture(r, p) for r in rows)}</div>' if rows else ""


def _lines(t: dict, n: int) -> str:
    seen, out = {headline(t)}, []
    for s in [clean(x) for x in _arr(_obj(t.get("world")).get("lines"))]:
        if s and s not in seen:
            seen.add(s)
            out.append(clip(s, LIMITS["line"]))
        if len(out) == n:
            break
    items = "".join(f"<li>{esc(s)}</li>" for s in out)
    return f'<ul class="lines">{items}</ul>' if out else ""


def _sources(t: dict, data: dict, client: bool, n: int) -> str:
    rows = [] if client else source_lines(t, data)[:n]
    if not rows:
        return ""
    der = '<span class="chip der">Derived</span>'
    body = "".join(f'<p class="src"><b>{esc(r["label"])}</b>{der if r["derived"] else ""} {esc(clip(r["text"], LIMITS["source"]))}</p>' for r in rows)
    return f'<span class="lab2">What it rests on</span>{body}'


def _top(t: dict) -> str:
    band = BAND_WORDS.get(t.get("band"), "")
    return f'<div class="top"><span class="tag">{esc(rank_words(t))}</span>' + (f"<span>{esc(band)}</span>" if band else "") + "</div>"


def _doc(title: str, body: str, cls: str) -> str:
    return (f'<!doctype html><html lang="en"><head><meta charset="utf-8"><title>{esc(title)}</title>'
            f'<link rel="stylesheet" href="{FONTS_LINK}"><style>{CSS}</style></head><body class="{cls}">{body}</body></html>')


def _foot(data: dict) -> str:
    d = run_date(data)
    return f'<div class="foot">{BRAND_LINE} · powered by CLAN' + (f" · {esc(d)}" if d else "") + "</div>"


def board_html(data: dict, client: bool = False, reader=None) -> str:
    """The territory board: every greenlit route, two to a page, in the judge's order."""
    routes = greenlit_routes(data)
    title = clean(data.get("title")) or "Territories"
    d = run_date(data)
    sub = f"{len(routes)} greenlit route{'' if len(routes) == 1 else 's'}" + (f" · {d}" if d else "")
    secs = []
    for t in routes:
        thought = clip(clean(t.get("thought")), LIMITS["thought"])
        why = clip(clean(t.get("why")), LIMITS["why"])
        left = (_top(t) + f'<h2>{esc(clean(t.get("name")))}</h2>' + (f'<p class="thought">{esc(thought)}</p>' if thought else "")
                + _hero(t) + _lines(t, LIMITS["lines"]))
        right = _pictures(t, LIMITS["pic_board"], reader) + (f"<p>{esc(why)}</p>" if why else "") + _sources(t, data, client, LIMITS["sources"])
        secs.append(f'<section class="route"><div class="cols"><div>{left}</div><div>{right}</div></div></section>')
    head = _head("Territory board" + (" · client copy" if client else ""), title, sub)
    return _doc(title + " · board", head + "".join(secs) + _foot(data), "board")


def route_html(data: dict, tid: str, client: bool = False, reader=None) -> str:
    """One route on one page. A route that is not greenlit has none (``KeyError``)."""
    t = next((r for r in greenlit_routes(data) if r.get("id") == tid), None)
    if t is None:
        raise KeyError(tid)
    w = _obj(t.get("world"))
    title = clean(data.get("title")) or "Territories"
    by, d = clean(greenlit_of(data, tid).get("by")), run_date(data)
    thought = clip(clean(t.get("thought")), LIMITS["thought"])
    why = clip(clean(t.get("why")), LIMITS["why"])
    risks = [r for r in (clip(clean(x), LIMITS["risk"]) for x in _arr(t.get("risks"))) if r][: LIMITS["risks"]]
    frames = [clip(f, LIMITS["frame"]) for f in (clean(_obj(x).get("text")) for x in _arr(w.get("tv"))) if f][: LIMITS["frames"]]
    radio = [(v, clip(x, LIMITS["radio_text"])) for v, x in ((clean(_obj(r).get("voice")), clean(_obj(r).get("text"))) for r in _arr(w.get("radio"))) if v and x][: LIMITS["radio"]]
    li = lambda xs: "".join(f"<li>{esc(x)}</li>" for x in xs)   # noqa: E731
    left = (_top(t) + (f'<p class="thought">{esc(thought)}</p>' if thought else "") + _hero(t) + (f"<p>{esc(why)}</p>" if why else "") + _lines(t, 4)
            + (f'<span class="lab2">Risks to watch</span><ul class="lines">{li(risks)}</ul>' if risks else ""))
    rl = "".join(f'<p class="rl"><b>{esc(v)}</b>{esc(x)}</p>' for v, x in radio)
    right = (_pictures(t, LIMITS["pic_route"], reader)
             + (f'<span class="lab2">On TV</span><ol class="lines">{li(frames)}</ol>' if frames else "")
             + (f'<span class="lab2">On the radio</span>{rl}' if radio else "")
             + _sources(t, data, client, LIMITS["sources"]))
    sub = " · ".join(x for x in (title, f"greenlit by {by}" if by and not client else "", d) if x)
    head = _head("Territory one-pager" + (" · client copy" if client else ""), clean(t.get("name")), sub)
    body = f'<div class="page">{head}<div class="cols"><div>{left}</div><div>{right}</div></div>{_foot(data)}</div>'
    return _doc(clean(t.get("name")) + " · one-pager", body, "one")


# ---------------------------------------------------------------- the JSON


def routes_json(data: dict) -> dict:
    """The greenlit routes in the contract's shape (``schema.json`` ``definitions.territory``), in the judge's order, with each greenlight's own record.
    The judge's /35 score (``blind``) is left out: a rank is what people are shown, and it is in ``rank``."""
    routes = [{k: v for k, v in t.items() if k != "blind"} for t in greenlit_routes(data)]
    ids = {t["id"] for t in routes}
    return {"title": clean(data.get("title")) or "Territories", "date": run_date(data), "routes": routes,
            "greenlit": [g for g in _arr(data.get("greenlit")) if _obj(g).get("territory_id") in ids]}


# ---------------------------------------------------------------- the registry


def _reader(doc_id: str, data: dict):
    return delivery.ASSET_READER(doc_id, data) if delivery.ASSET_READER else None


def _need_routes(data: dict) -> None:
    from ..util import TaskError
    if not greenlit_routes(data):
        raise TaskError(409, "nothing_greenlit", "Nothing is greenlit yet, so there is nothing to export. Greenlight a route first.")


def make_board(client: bool):
    def make(doc_id: str, data: dict) -> bytes:
        _need_routes(data)
        return board_html(data, client, _reader(doc_id, data)).encode("utf-8")
    return make


def make_json(doc_id: str, data: dict) -> bytes:
    _need_routes(data)
    return (json.dumps(routes_json(data), indent=2, ensure_ascii=False) + "\n").encode("utf-8")


def make_route(client: bool):
    """A family maker: ``name`` (``territories-route-<id>.html``) -> the ``make`` for that route; a route that is not greenlit is refused in words."""
    prefix = ROUTE_CLIENT_PREFIX if client else ROUTE_PREFIX

    def for_name(name: str):
        tid = name[len(prefix):-len(".html")]

        def make(doc_id: str, data: dict) -> bytes:
            from ..util import TaskError
            _need_routes(data)
            try:
                return route_html(data, tid, client, _reader(doc_id, data)).encode("utf-8")
            except KeyError:
                raise TaskError(409, "not_greenlit", "That route is not greenlit, so it has no one-pager.") from None
        return make
    return for_name


def register() -> None:
    delivery.register_file(BOARD, "text/html", make_board(False))
    delivery.register_file(BOARD_CLIENT, "text/html", make_board(True))
    delivery.register_file(JSON_FILE, "application/json", make_json)
    delivery.register_family(ROUTE_PREFIX, ".html", "text/html", make_route(False))
    delivery.register_family(ROUTE_CLIENT_PREFIX, ".html", "text/html", make_route(True))
