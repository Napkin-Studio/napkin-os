"""Pitch-ready and evidence fixes (spec.PITCH_READY, ``DECK_PITCH_READY``; on by default, 0 in the test suite).

Blind judging of decks built from three real client briefs (20 Nov 2026) scored evidence 3-5/10 and take-to-pitch 3-6/10. What it named,
and what this module does about it (all plain code, no model, no network):

* evidence: no deck went beyond the brief. The research agent's evidence track (engine/agent-server/research.py ``evidence``) writes
  ``evidence.json``; ``--evidence`` reads it here into research facts (``f_ev<n>``, origin ``evidence``) with their sources. The insight,
  audience and proposition slides each carry one or two sourced figures with a short source tag (source, year, market): ``attach_evidence``.
  "To confirm" stays only beside a figure that is genuinely unverified (``clear_confirmed``); a claim about the market that cites nothing is
  softened to our read, and one that says what the inputs lack goes to "What the brief doesn't tell us" (``soften_uncited``), so the
  bare_claim check and the slides agree.
* a placeholder cover ("Brief N: Brief N", a "Response deck" label): ``cover`` names the client and the project or campaign from the
  brief, adds the agency when known and the month and year, and prints no placeholder.
* a DRAFT banner on every slide: the renderers draw a small footer tag (``DRAFT_TAG``) instead; ``needs_person`` puts the full list of what
  needs a person in the cover's speaker notes and an appendix slide.
* empty picture frames: picture slots on the cover, the idea and the work carry prompts drawn from the chosen territory
  (``territory_subject``, lint-checked; imagegen uses it before its code templates) and the work slide draws no empty card meanwhile.
* internal reference codes (prompt:43, brief:insight, req:R4, ic_feeling, T1, candidate B) leaking onto slides: ``scrub_deck`` takes them
  off every shown text (the notes keep them) and validate's ``code_leak`` and the rendered-slide QA fail on any left (``has_code``).
"""
from __future__ import annotations

import datetime as _dt
import json
import re
from pathlib import Path

from . import spec
from .refs import Resolver, numbers_in

# ---------------------------------------------------------------------------------------------------------- evidence in

#: Which findings an evidence slide prefers, by what they support (first match first).
SUPPORTS = {"insight": ("insight", "audience", "market"), "audience": ("audience", "insight", "market"),
            "proposition": ("proposition", "reasons_to_believe", "market")}
EVIDENCE_TYPES = tuple(SUPPORTS)
#: The most findings one slide carries, and the words an evidence line may take before it is cut to its figure's sentence.
EVIDENCE_PER_SLIDE = 2
EVIDENCE_WORDS = 22
_OFFICIAL = re.compile(r"statistic|regulator|census|government|ministry|department|authority|office", re.I)


def load_evidence(path) -> tuple[dict, dict]:
    """``evidence.json`` (research.py ``evidence``) as ``(facts, sources)`` keyed like a research CLAN's: ``f_ev<n>`` facts (entity the
    market, key the metric, value, unit, as_of the year, label the claim, origin ``evidence``) and ``src_ev<n>`` sources (publisher, title,
    year, URL). A finding without a claim or a URL is not read. A local official source is high confidence, anything else medium: no
    finding from the track is low (it has a URL), so nothing it supports is marked 'to confirm'."""
    ev = json.loads(Path(path).read_text())
    facts, sources = {}, {}
    for n, f in enumerate(ev.get("findings") or [], 1):
        if not isinstance(f, dict) or not f.get("claim") or not str(f.get("url") or "").startswith(("http://", "https://")):
            continue
        fid, sid = f"f_ev{n}", f"src_ev{n}"
        val = f.get("value") if isinstance(f.get("value"), (int, float)) and not isinstance(f.get("value"), bool) else (f.get("figure") or "")
        local = bool(f.get("local"))
        facts[fid] = {"id": fid, "entity": f.get("market") or ev.get("market") or "", "key": f.get("metric") or str(f["claim"])[:60],
                      "value": val, "unit": f.get("unit") or "", "as_of": str(f.get("year") or ""),
                      "confidence": "high" if local and _OFFICIAL.search(f"{f.get('source_kind', '')} {f.get('source', '')}") else "medium",
                      "sources": [sid], "label": f["claim"], "origin": "evidence", "market": f.get("market") or "", "local": local,
                      "supports": f.get("supports") or "market", "short": f.get("short") or "", "source_name": f.get("source") or ""}
        dom = re.sub(r"^https?://(www\.)?", "", f["url"]).split("/")[0]
        sources[sid] = {"id": sid, "publisher": f.get("source") or dom, "domain": dom, "title": f.get("metric") or str(f["claim"])[:90],
                        "published_at": str(f.get("year") or "n.d."), "uri": f["url"], "market": f.get("market") or ""}
    return facts, sources


def is_evidence(inp, ref: str) -> bool:
    return (inp.facts.get(ref) or {}).get("origin") == "evidence"


def source_tag(f: dict) -> str:
    """The short tag under a figure: source, year, market ('CSO, 2024, Ireland'; 'EPA, 2025, US')."""
    short = lambda x: re.split(r",|;|\s[-—–]\s", re.sub(r"\s*\([^()]*\)", "", str(x or "")))[0].strip()  # noqa: E731   'CSO (Census 2022)' -> 'CSO'
    mk = re.sub(r"\s*\b(?:figure|figures)\b", "", short(f.get("market"))).strip()
    return ", ".join(x for x in (short(f.get("source_name")), str(f.get("as_of") or "").strip(), mk) if x)


EVIDENCE_WORDS_TIGHT = 9


def evidence_line(f: dict, tight: bool = False, cap: int = EVIDENCE_WORDS_TIGHT) -> str:
    """One evidence line: the finding's short form (or its claim, cut to the sentence holding its figure) and its source tag. ``tight`` (a
    slide near its word budget): at most EVIDENCE_WORDS_TIGHT words before the tag, cut after the figure."""
    t = str(f.get("short") or "").strip()
    if tight:
        t = t if re.search(r"\d", t) else str(f.get("label") or "")
        w = t.split()
        if len(w) > cap:
            at = next((i for i, x in enumerate(w) if re.search(r"\d", x)), 0)
            lo = 0 if at < cap else max(0, min(at - 3, len(w) - cap))
            w = w[lo:lo + cap]
            while len(w) > 3 and w[-1].lower().strip(",;:") in ("over", "of", "in", "on", "at", "as", "into", "per", "by", "a", "an", "the", "and", "or", "to", "for", "from", "with", "than"):
                w.pop()
            t = " ".join(w).rstrip(",;:")
        tag = source_tag(f)
        return f"{t.rstrip('. ')} ({tag})" if tag else t.rstrip(". ")
    if not t or not re.search(r"\d", t):
        t = str(f.get("label") or "").strip()
    if len(t.split()) > EVIDENCE_WORDS:
        sents = [s for s in re.split(r"(?<=[.!?])\s+", t) if s.strip()]
        t = next((s for s in sents if re.search(r"\d", s)), sents[0] if sents else t)
        if len(t.split()) > EVIDENCE_WORDS:
            t = " ".join(t.split()[:EVIDENCE_WORDS]).rstrip(",;:") + "…"
    t = t.rstrip(". ")
    tag = source_tag(f)
    return f"{t} ({tag})" if tag else t


def presented(deck) -> list:
    from .validate import presented as _p   # noqa: PLC0415
    return _p(deck)


def _slide_text(s) -> str:
    from .validate import _texts   # noqa: PLC0415
    return " ".join(str(t) for t, _ in _texts(s))


def _words(t: str) -> set:
    return {w for w in re.findall(r"[a-z]{4,}", str(t).lower())}


def attach_evidence(deck: dict, inp) -> list:
    """Give each presented insight, audience and proposition slide one or two sourced figures from the evidence, with a source tag. A slide
    already citing an evidence figure counts it. Findings are picked by what they support, local first, then by the words they share with
    the slide; one finding is never used twice. Returns ``[{slide, refs}]``."""
    ev = {k: f for k, f in inp.facts.items() if f.get("origin") == "evidence" and k not in inp.rejected_pins}
    if not ev:
        return []
    from .assemble import slide_refs   # noqa: PLC0415
    used = {r for sid in deck["order"] for r in slide_refs(deck["slides"][sid]) if r in ev}
    from .validate import words as _wc   # noqa: PLC0415
    slides = [sid for sid in presented(deck) if deck["slides"][sid]["type"] in SUPPORTS]
    added = {sid: [] for sid in slides}
    for rnd in range(EVIDENCE_PER_SLIDE):   # one figure for every slide first, then a second where there is room
        for sid in slides:
            s = deck["slides"][sid]
            have = len([r for r in slide_refs(s) if r in ev])
            room = spec.SLIDE_TYPES[s["type"]]["words"] * 1.15 - _wc(s)
            if have > rnd or (rnd and room < EVIDENCE_WORDS * 1.5):   # a full slide takes one figure; it never goes without one
                continue
            mine = _words(_slide_text(s))
            order = SUPPORTS[s["type"]]
            pool = sorted((k for k in ev if k not in used),
                          key=lambda k: (order.index(ev[k]["supports"]) if ev[k]["supports"] in order else len(order),
                                         not ev[k].get("local"), -len(mine & _words(ev[k]["label"])), k))
            if rnd and pool and ev[pool[0]]["supports"] not in order:
                continue   # a second figure only when it supports what the slide argues
            for k in pool[:1]:
                f = ev[k]
                line = evidence_line(f)
                budget = spec.SLIDE_TYPES[s["type"]]["words"]
                if _wc(s) + len(line.split()) > budget * 1.2:   # near the budget: the short form, kept under validate's error line (125%)
                    cap = min(EVIDENCE_WORDS_TIGHT, int(budget * 1.25) - _wc(s) - len(source_tag(f).split()))
                    line = evidence_line(f, tight=True, cap=max(4, cap))
                s["blocks"].append({"kind": "small", "text": line, "refs": [k], "basis": "sourced", "evidence": True})
                s.setdefault("claims", []).append({"text": f["label"], "refs": [k], "basis": "sourced"})
                used.add(k)
                added[sid].append(k)
    out = [{"slide": sid, "refs": ks} for sid, ks in added.items() if ks]
    if out:
        refresh_sources(deck, inp)
    return out


def refresh_sources(deck: dict, inp) -> None:
    """Footnote keys and the Sources appendix again, after slides gained refs (assemble._sources_slide's numbering, without touching notes
    other than an Evidence line for each new evidence ref)."""
    R = Resolver(inp, list((deck.get("requirements") or {}).values()))
    from .assemble import slide_refs   # noqa: PLC0415
    keys, labels = [], {}
    for sid in deck["order"]:
        sl = deck["slides"][sid]
        foot = []
        for ref in slide_refs(sl):
            k, lab, url = R.source_key(ref)
            if k == "unknown":
                continue
            if k not in labels:
                keys.append(k)
                labels[k] = lab + (f" {url}" if url else "")
            n = keys.index(k) + 1
            if n not in foot:
                foot.append(n)
        sl["footnotes"] = sorted(foot)
        new = [r for r in slide_refs(sl) if is_evidence(inp, r) and f"[{r}]" not in str(sl.get("notes") or "")]
        if new:
            sl["notes"] = (str(sl.get("notes") or "") + "\n" + "\n".join(R.describe(r) + f" {inp.sources.get(inp.facts[r]['sources'][0], {}).get('uri', '')}"
                                                                            for r in new)).strip()
    src = next((deck["slides"][x] for x in deck["order"] if deck["slides"][x]["type"] == "appendix_sources"), None)
    if src is not None:
        src["blocks"] = [{"kind": "table", "rows": [["#", "Source"]] + [[f"[{i}]", labels[k]] for i, k in enumerate(keys, 1)], "small": True,
                          "basis": "meta"}]


# ---------------------------------------------------------------------------------------------------------- "to confirm" only when unverified

_TO_CONFIRM = re.compile(r"\s*\((?:[^()]{0,40}?,\s*)?(?:figure |number )?to confirm\)|,\s*to confirm\b(?=[.;]?\s*$)", re.I)


def _verified(R: Resolver, inp, ref: str, nums: set) -> bool:
    """A ref that verifies a figure: a research fact that is not low confidence, a client-document figure, or a document line holding the
    figure beside a source URL (a research report attached as a document)."""
    k = R.kind(ref)
    if k == "fact":
        return str(inp.facts[ref].get("confidence")) != "low" and bool(R.numbers(ref) & nums)
    if k == "docfig":
        return bool(R.numbers(ref) & nums)
    if k == "doc":
        for line in str(inp.docs[ref[4:].split("#")[0]]["text"]).splitlines():
            if "http" in line and numbers_in(line) & nums:
                return True
    return False


def clear_confirmed(deck: dict, inp) -> int:
    """'(to confirm)' comes off a shown figure that a cited source verifies; it stays on anything genuinely unverified. Returns the count."""
    R = Resolver(inp, list((deck.get("requirements") or {}).values()))
    n = 0

    def fix(holder, key, refs):
        nonlocal n
        t = holder.get(key)
        if not isinstance(t, str) or not _TO_CONFIRM.search(t):
            return
        nums = {x for x in numbers_in(t) if x not in (0.0, 1.0)}
        if nums and any(_verified(R, inp, r, nums) for r in refs or []):
            holder[key] = _TO_CONFIRM.sub("", t).rstrip(" ,;")
            n += 1
            return
        figs = {x for x in nums if not 1900 <= x <= 2100}   # the figures, years aside
        by = next((fid for fid, f in inp.facts.items() if f.get("origin") == "evidence" and str(f.get("confidence")) != "low"
                   and fid not in inp.rejected_pins and figs and figs <= R.numbers(fid)), None) if figs else None
        if by:   # the evidence track verified this very figure: it is cited, and it is no longer 'to confirm'
            holder[key] = _TO_CONFIRM.sub("", t).rstrip(" ,;")
            holder["refs"] = list(holder.get("refs") or []) + [by]
            n += 1
    for sid in deck["order"]:
        s = deck["slides"][sid]
        for b in s.get("blocks") or []:
            if b.get("kind") in ("copy", "sketch") or b.get("basis") == "creative":
                continue   # the work's own words are not evidence
            fix(b, "text", b.get("refs"))
            for it in b.get("items") or []:
                if isinstance(it, dict):
                    fix(it, "text", (it.get("refs") or []) + (b.get("refs") or []))
        for cl in s.get("claims") or []:
            fix(cl, "text", cl.get("refs"))
    return n


# ---------------------------------------------------------------------------------------------------------- uncited market claims

#: Slides that argue from the market: an uncited claim there is softened to our read.
ARGUMENT_TYPES = ("insight", "audience", "proposition", "real_question", "barrier", "chart", "brief_restated", "objection")
_MARKET_CLAIM = re.compile(r"\b(?:most|majority|many|nearly|almost all|typically|tend to|research shows|studies show|data shows|"
                           r"(?:people|shoppers|consumers|customers|households|employers|buyers|parents|drivers|users) (?:say|feel|think|believe|want|"
                           r"prefer|choose|buy|expect|trust|know)|the market|the category|is growing|are growing|is falling|are falling)\b", re.I)
_GAP_CLAIM = re.compile(r"\b(?:not in the (?:inputs|brief)|the inputs (?:do not|don't|give no|have no)|the brief (?:does not|doesn't|gives no|has no|"
                        r"never)|no (?:data|evidence|figure|baseline) (?:on|for|is given)|is not stated|are not stated|unknown)\b", re.I)
SOFT_PREFIX = "Our read: "


def soften_uncited(deck: dict) -> dict:
    """An uncited claim about the market on an argument slide is softened (``Our read:``, basis opinion); a claim that only says what the
    inputs lack goes to the "What the brief doesn't tell us" slide when it has room (basis opinion where it was). A claim with no refs and
    no basis that is a proposal says so (basis proposal). Returns ``{softened, moved, based}`` counts."""
    out = {"softened": 0, "moved": 0, "based": 0}
    pres = presented(deck)
    gaps = next((deck["slides"][x] for x in pres if deck["slides"][x].get("role") == "brief_gaps"), None)
    gap_list = next((b for b in (gaps or {}).get("blocks", []) if b["kind"] == "bullets"), None) if gaps else None
    for sid in pres:
        s = deck["slides"][sid]
        if s["type"] not in ARGUMENT_TYPES:
            continue
        for b in s.get("blocks") or []:
            if b.get("refs") or b.get("human") or b.get("internal") or b.get("evidence") or b.get("basis") in ("creative", "proposal", "opinion", "meta"):
                continue
            t = str(b.get("text") or "")
            if b["kind"] in ("text", "small", "statement", "callout", "card") and _MARKET_CLAIM.search(t) and not t.startswith(SOFT_PREFIX):
                b["text"], b["basis"] = SOFT_PREFIX + t, "opinion"
                out["softened"] += 1
            for it in b.get("items") or []:
                if isinstance(it, dict) and not it.get("refs") and not it.get("human") and it.get("basis") not in ("creative", "proposal", "opinion", "meta"):
                    tt = str(it.get("text") or "")
                    if _MARKET_CLAIM.search(tt) and not tt.startswith(SOFT_PREFIX):
                        it["text"], it["basis"] = SOFT_PREFIX + tt, "opinion"
                        out["softened"] += 1
    for sid in deck["order"]:
        s = deck["slides"][sid]
        for cl in s.get("claims") or []:
            if cl.get("refs") or cl.get("basis") in ("creative", "opinion", "proposal"):
                continue
            t = str(cl.get("text") or "")
            if re.match(r"\s*(?:Proposal|Proposed)\b", t):
                cl["basis"] = "proposal"
                out["based"] += 1
            elif _GAP_CLAIM.search(t):
                cl["basis"] = "opinion"
                if gap_list is not None and sid in pres and len(gap_list.get("items") or []) < spec.BRIEF_GAPS_MAX + 1 \
                        and not any(str((i or {}).get("text") if isinstance(i, dict) else i) == t for i in gap_list.get("items") or []):
                    gap_list.setdefault("items", []).append({"text": t, "basis": "meta"})
                    out["moved"] += 1
                else:
                    out["based"] += 1
            elif _MARKET_CLAIM.search(t) or s["type"] in ARGUMENT_TYPES:
                cl["basis"] = "opinion"   # what the slide shows of it is our read (above), and the claim says so too
                out["based"] += 1
    return out


# ---------------------------------------------------------------------------------------------------------- internal codes off the slides

_REFCOLON = r"\b(?:prompt|brief|req|answer|doc|calc):[A-Za-z0-9_.#/-]*[A-Za-z0-9]"
_SNAKE = r"\b[a-z][a-z0-9]*_[a-z0-9_]*[a-z0-9]\b"
_LABEL = r"\b(?:IC|ic|[TCtc])\d{1,2}\b"   # territory, candidate and insight-candidate labels: T1, C2, IC1, c3
_CAND = r"\b(?:[Cc]andidate|[Ii]nsight|[Rr]oute|[Tt]erritory)\s+(?:[A-E]|IC?\d{1,2}|[CTct]\d{1,2})\b(?![\w-])"
_SLIDE = r"\bs\d{2}\b"
_STAGE = r"\b(?:[Ss]tage [a-i]0?|Loop[- ]?\d)\b"
CODE = re.compile("|".join((_REFCOLON, _SNAKE, _LABEL, _CAND, _SLIDE, _STAGE)))
_URL = re.compile(r"https?://\S+|www\.\S+|\S+@\S+")
_SEP = re.compile(r"^(?:[\s,;/&+]|\band\b|\bvia\b|\bsee\b|\bfrom\b|\bcf\.?|\be\.g\.?|\bi\.e\.?|\bper\b)*$", re.I)


def has_code(text: str) -> str | None:
    """The first internal reference code in a shown text (URLs and emails excepted), or None."""
    m = CODE.search(_URL.sub(" ", str(text or "")))
    return m.group(0) if m else None


def scrub_codes(text: str) -> str:
    """``text`` with every internal code taken off: a bracket holding only codes goes whole; a ref left in a sentence reads as what it
    points to ('than prompt:32 wants' -> 'than the brief wants'); ids and labels go; spacing and punctuation are tidied."""
    t = str(text or "")
    if not has_code(t):
        return t
    urls = {}

    def keep(m):
        urls[f"\x00{len(urls)}\x00"] = m.group(0)
        return f"\x00{len(urls) - 1}\x00"
    t = _URL.sub(keep, t)

    def bracket(m):
        inner = CODE.sub(" ", m.group(2))
        return "" if _SEP.fullmatch(inner) else m.group(0)
    t = re.sub(r"(\s*)\(([^()]*)\)", lambda m: bracket(m) if CODE.search(m.group(2)) else m.group(0), t)
    t = re.sub(r"(\s*)\[([^\[\]]*)\]", lambda m: bracket(m) if CODE.search(m.group(2)) else m.group(0), t)

    def inline(m):
        g = m.group(0)
        if re.match(r"(?:prompt|brief|req|answer):", g):
            return "the brief"
        if g.startswith("doc:"):
            return "the client's documents"
        if re.match(r"(?i)insight\s", g):
            return "the insight" if g[0].islower() else "The insight"
        if re.match(r"(?i)(?:candidate|route|territory)\s", g):
            return "an option" if g[0].islower() else "One option"
        return ""
    t = CODE.sub(inline, t)
    t = re.sub(r"\b(the brief)(?:\s*(?:,|and|/)\s*the brief)+", r"\1", t)
    t = re.sub(r"\(\s*[,;]?\s*\)", "", t)
    t = re.sub(r"\s+([,.;:!?)])", r"\1", t)
    t = re.sub(r"([(])\s+", r"\1", t)
    t = re.sub(r"([,;:])(?:\s*[,;:])+", r"\1", t)
    t = re.sub(r"\s{2,}", " ", t).strip()
    t = re.sub(r"^[,;:]\s*", "", t)
    for k, v in urls.items():
        t = t.replace(k, v)
    return t


_SKIP_KEYS = {"refs", "ref", "kind", "basis", "id", "icon", "layout", "asset", "src", "uri", "url", "slot", "status", "chart_id", "sha"}


def _scrub_obj(x, n: list):
    if isinstance(x, str):
        y = scrub_codes(x)
        if y != x:
            n[0] += 1
        return y
    if isinstance(x, list):
        return [_scrub_obj(v, n) for v in x]
    if isinstance(x, dict):
        return {k: (v if k in _SKIP_KEYS else _scrub_obj(v, n)) for k, v in x.items()}
    return x


def scrub_deck(deck: dict) -> int:
    """Internal codes off every shown text of every slide (title, label, blocks); the notes and the claims keep them. Returns how many
    texts changed."""
    n = [0]
    for sid in deck["order"]:
        s = deck["slides"][sid]
        for k in ("title", "label"):
            if isinstance(s.get(k), str):
                s[k] = _scrub_obj(s[k], n)
        s["blocks"] = _scrub_obj(s.get("blocks") or [], n)
    return n[0]


def code_findings(deck: dict) -> list:
    """validate ``code_leak``: an internal code on a shown text of a presented or appendix slide (the notes are not shown). An error."""
    from .validate import _texts   # noqa: PLC0415
    out = []
    for sid in deck["order"]:
        s = deck["slides"][sid]
        for t, _ in _texts(s, internal=False):
            c = has_code(t)
            if c:
                out.append({"check": "code_leak", "level": "error", "slide": sid, "message": f"an internal code on screen: '{c}' in \"{str(t)[:60]}\""})
                break
    return out


# ---------------------------------------------------------------------------------------------------------- the cover

_PLACEHOLDER_NAME = re.compile(r"\s*(?:\[[^\]]*\]|(?:brief|client|project|deck|campaign)\s*#?\d*|response deck|untitled[\w ]*|tbc|tbd|n/?a|-+|\?+)?\s*", re.I)


def is_placeholder_name(name) -> bool:
    """True for a missing or stand-in name: empty, bracketed ('[Agency]'), 'Brief 2', 'Client', 'Response deck', TBD."""
    return bool(_PLACEHOLDER_NAME.fullmatch(str(name or "")))


_JOB_LABEL = re.compile(r"(?i)\s*(?:brief|project|job|client|campaign|deck|pitch|rfp|tender|account)\s*[#:no.-]*\s*(?:[a-z]{1,2}|[a-z]?\d[a-z0-9]{0,5})\s*"
                        r"|\s*[A-Z]{1,5}[-_ ]?\d{2,}(?:[-_/]\d+)*\s*")


def is_job_label(name) -> bool:
    """True for a client or project label that names a job, not a brand: 'Brief 1', 'Project X', 'Job 4512', 'BR-2026-01'."""
    return bool(_JOB_LABEL.fullmatch(str(name or "")))


def _same(a, b) -> bool:
    """Two names that say the same thing, ignoring case, spacing and the words pitch, response and deck."""
    f = lambda s: " ".join(w for w in re.findall(r"[\w']+", str(s or "").lower()) if w not in ("pitch", "response", "deck"))   # noqa: E731
    return bool(f(a)) and f(a) == f(b)


def undouble(title: str) -> str:
    """A cover title said once: 'Brief 1: Brief 1' -> 'Brief 1', 'Brief 1 Pitch: Brief 1 pitch' -> 'Brief 1 Pitch'."""
    parts = [x.strip() for x in str(title or "").split(":")]
    out = []
    for x in parts:
        if x and not any(_same(x, y) for y in out):
            out.append(x)
    return ": ".join(out) if out else str(title or "")


def month_year(deck: dict) -> str:
    try:
        d = _dt.datetime.fromisoformat(str(deck["meta"].get("built_at") or ""))
    except ValueError:
        d = _dt.datetime.now()
    return d.strftime("%B %Y")


def campaign_name(st: dict) -> str:
    """The campaign's own name: the chosen territory's name, else stage d's campaign line (its first sentence)."""
    c = st.get("c") or {}
    t = next((x for x in c.get("territories") or [] if x.get("id") == c.get("chosen")), None)
    if t and str(t.get("name") or "").strip():
        return str(t["name"]).strip()
    line = str((st.get("d") or {}).get("campaign_line") or "").strip()
    return re.split(r"(?<=[.!?])\s", line)[0].strip(" .") if line else ""


def cover(deck: dict, st: dict, client: str = "", project: str = "", agency: str = "", brief_meta: dict | None = None,
          names: dict | None = None) -> dict:
    """The cover a client could be shown: the client and the project (or the campaign) as the title, from the run's names when they are
    real, else the brief tool's, else the intake's (``names``: a0 ``names``); the agency and the month and year as its label; no placeholder
    line (the presenter and date to-do goes to the notes and the needs-a-person list). Returns what it did."""
    sl = next((deck["slides"][x] for x in deck["order"] if deck["slides"][x]["type"] == "title"), None)
    if sl is None:
        return {}
    stand_in = lambda x: is_placeholder_name(x) or is_job_label(re.sub(r"(?i)\b(?:pitch|response|deck)\b", " ", str(x or "")))   # noqa: E731  'Brief 1 Pitch': a job, not a name
    pick = lambda *xs: next((str(x).strip() for x in xs if not stand_in(x)), "")  # noqa: E731
    bm, nm = brief_meta or {}, names or {}
    c = pick(client, bm.get("client"), nm.get("client"))
    p = pick(project, bm.get("project"), nm.get("project"))
    if p and c and _same(p, c):
        p = ""   # a project named as its client says nothing more
    camp = campaign_name(st)
    job = "" if c else next((" ".join(str(x).split()) for x in (client, bm.get("client"), nm.get("client"))
                             if str(x or "").strip() and not str(x).strip().startswith("[")), "")   # the client label, kept as the label
    if c and not stand_in(project) and not stand_in(client):
        title = sl["title"]   # the run named both: assemble's title stands (finish has held its scope words to the brief)
    elif c and p:
        title = f"{c}: {p}"
    elif c:
        title = f"{c}: {camp}" if camp else c
    else:   # no real client name: the campaign (or the project) is the title, and the job label goes in the kicker, never doubled
        title = f"{p}: {camp}" if p and camp and not _same(p, camp) else (camp or p or sl["title"])
    if stand_in(title.split(":")[0]) or re.search(r"(?i)\bresponse deck\b", title):
        title = camp or title
    title = undouble(title)
    ag = "" if is_placeholder_name(agency) else str(agency).strip()
    when = month_year(deck)
    if job and not _same(job, title):
        when = f"{job} · {when}"
    todo = [b for b in sl["blocks"] if b.get("human") or spec.unresolved_line(b.get("text"))]
    sl["title"] = sl["label"] = title
    sl["blocks"] = [{"kind": "text", "text": f"A response from {ag}", "basis": "meta"}] if ag else []
    deck["meta"]["cover_kicker"] = f"{ag} · {when}" if ag else when
    lines = ["To confirm before this is shown: who presents, and the date."] if todo else []
    if lines:
        sl["notes"] = "\n\n".join(x for x in [str(sl.get("notes") or "").strip(), *lines] if x)
    if sl.get("status") == "needs_human":
        sl["status"] = "drafted"
    if not isinstance(sl.get("slots"), dict):
        sl["slots"] = {}
    sl["slots"].setdefault("picture", {"kind": "image", "image": {"kind": "illustration", "status": "empty", "aspect": "16:9",
                                                                                  "basis": "creative", "reason": "no picture yet"}})
    return {"title": title, "kicker": deck["meta"]["cover_kicker"], "agency": bool(ag),
            "from": "run" if not (is_placeholder_name(client) or is_placeholder_name(project)) else "brief"}


# ---------------------------------------------------------------------------------------------------------- what needs a person

NEEDS_PERSON_TITLE = "What still needs a person"
NEEDS_PERSON_MAX = 8
#: The quiet footer tag of a draft (the renderers draw it in the footer, muted; the full list is in the notes and the appendix).
DRAFT_TAG = "Draft"


def _what(texts) -> str:
    t = " ".join(str(x) for x in texts if str(x).strip())
    t = re.sub(re.escape(spec.PLACEHOLDER_PREFIX), "", t)
    m = re.search(r"To confirm:\s*(.+?)(?:$|(?<=\.)\s)", t)
    t = m.group(1) if m else t
    t = re.sub(r"\[([^\]]{2,60})\]", r"\1", t)
    t = re.sub(r"(?i)\bto confirm\b[:,]?\s*", "", t)
    return " ".join(t.split()).strip(" .")[:110]


def needs_person(deck: dict) -> list:
    """What still needs a person, slide by slide (``[text]``): every slide marked needs_human and every human placeholder on a slide, plus
    the cover's notes to-do and every slide the figure guard took a figure off (meta.figures_removed). The list goes in the cover's speaker notes (whole) and an appendix slide (the first NEEDS_PERSON_MAX; the rest
    in its notes); each such slide's notes say what it needs."""
    from . import figures   # noqa: PLC0415
    items = []
    cut = {x.get("slide") for x in (deck.get("meta") or {}).get("figures_removed") or []}
    for sid in deck["order"]:
        s = deck["slides"][sid]
        if s.get("role") == "needs_person":
            return []   # already listed (an idempotent pass)
        hum = [b.get("text") for b in s.get("blocks") or [] if b.get("human")]
        hum += [i.get("text") for b in s.get("blocks") or [] for i in b.get("items") or [] if isinstance(i, dict) and i.get("human")]
        if s["type"] == "title" and "To confirm before this is shown" in str(s.get("notes") or ""):
            items.append("Cover: who presents, and the date")
            continue
        if sid in cut and not (s.get("status") == "needs_human" or hum):   # the figure guard (deck/figures.py) took a figure off this slide
            items.append(f"{s['title']}: {figures.NEEDS}")
            continue
        if s.get("status") == "needs_human" or hum:
            what = _what(hum) or "a person writes or supplies this slide"
            items.append(f"{s['title']}: {what}")
            line = f"Needs a person: {what}."
            if line not in str(s.get("notes") or ""):
                s["notes"] = "\n\n".join(x for x in [str(s.get("notes") or "").strip(), line] if x)
    items = list(dict.fromkeys(items))
    if not items:
        return []
    cov = next((deck["slides"][x] for x in deck["order"] if deck["slides"][x]["type"] == "title"), None)
    if cov is not None:
        cov["notes"] = "\n\n".join(x for x in [str(cov.get("notes") or "").strip(), "What still needs a person:\n" + "\n".join(f"- {i}" for i in items)] if x)
    shown, rest = items[:NEEDS_PERSON_MAX], items[NEEDS_PERSON_MAX:]
    sl = {"type": "questions", "section": "Appendix", "title": NEEDS_PERSON_TITLE, "label": NEEDS_PERSON_TITLE,
          "blocks": [{"kind": "bullets", "items": [{"text": i, "basis": "meta"} for i in shown]}], "claims": [], "status": "from_source",
          "requirements": [], "footnotes": [], "visual": {"kind": "layout", "hint": "cards"}, "role": "needs_person",
          "notes": "Everything the deck still needs from a person before it is shown." + ("\nAlso:\n" + "\n".join(f"- {i}" for i in rest) if rest else "")}
    n = 1 + max(int(x[1:]) for x in deck["order"] if re.fullmatch(r"s\d+", x)) if deck["order"] else 1
    sid = f"s{n:02d}"
    at = next((i for i, x in enumerate(deck["order"]) if deck["slides"][x]["type"] in ("requirement_trace", "appendix_sources")), len(deck["order"]))
    deck["slides"][sid] = sl
    deck["order"].insert(at, sid)
    return items


def list_removed_figures(deck: dict) -> list:
    """Put the slides the figure guard took a figure off (meta.figures_removed, deck/figures.py) on the needs-a-person list, after
    needs_person built it: onto its appendix slide (past NEEDS_PERSON_MAX, into that slide's notes) and the cover's notes. With no
    list yet, needs_person builds one (it reads meta.figures_removed too). Returns the lines added."""
    from . import figures   # noqa: PLC0415
    cut = list(dict.fromkeys(x.get("slide") for x in (deck.get("meta") or {}).get("figures_removed") or []))
    lines = [f"{deck['slides'][sid]['title']}: {figures.NEEDS}" for sid in cut if sid in deck["slides"]]
    page = next((deck["slides"][x] for x in deck["order"] if deck["slides"][x].get("role") == "needs_person"), None)
    if page is None:
        return [x for x in needs_person(deck) if x in lines]
    bl = page["blocks"][0]
    have = {str(i.get("text")) for i in bl.get("items") or [] if isinstance(i, dict)} | set(str(page.get("notes") or "").split("\n- "))
    new = [x for x in lines if x not in have and f"- {x}" not in str(page.get("notes") or "")]
    room = max(0, NEEDS_PERSON_MAX - len(bl.get("items") or []))
    bl.setdefault("items", []).extend({"text": x, "basis": "meta"} for x in new[:room])
    if new[room:]:
        page["notes"] = str(page.get("notes") or "") + ("\nAlso:" if "\nAlso:" not in str(page.get("notes") or "") else "") + "".join(f"\n- {x}" for x in new[room:])
    cov = next((deck["slides"][x] for x in deck["order"] if deck["slides"][x]["type"] == "title"), None)
    if cov is not None and new:
        cov["notes"] = str(cov.get("notes") or "").rstrip() + "".join(f"\n- {x}" for x in new)
    return new


def draft_tag(deck: dict) -> str:
    """The footer tag of a deck that still needs a person ('' when nothing does)."""
    return DRAFT_TAG if any(s.get("status") == "needs_human" for s in deck["slides"].values()) else ""


# ---------------------------------------------------------------------------------------------------------- picture subjects

#: Words that make a sentence a poor picture subject: it talks about type, sound, charts or the words of the work, not a scene.
_NOT_A_SCENE = re.compile(r"\b(?:chart|charts|graph|diagram|number|numbers|figure|figures|count|counter|type|typography|font|word|words|copy|"
                          r"headline|line|lines|voice|voiceover|sound|music|narrator|logo|text|caption|letter|claim|claims|tone|brand|route|"
                          r"campaign|insight|brief|client|ask|asks|asking|target|data|report|update|media|channel|budget)\b", re.I)


def _sentences(*texts) -> list:
    out = []
    for t in texts:
        if isinstance(t, list):
            out += _sentences(*t)
            continue
        t = re.sub(r"\([^()]*\)|\[[^\]]*\]", " ", str(t or ""))
        out += [" ".join(s.split()).strip() for s in re.split(r"(?<=[.!?])\s+|;\s*", t) if s.strip()]
    return out


#: Nouns that put a picture somewhere: a sentence needs one to count as a scene, and a built subject names up to two.
_SCENE = set("""home homes house houses household households kitchen kitchens sink tap taps garden gardens street streets road roads city town
village neighbourhood bike bikes bicycle bicycles cyclist cyclists commuter commuters bus buses station shop shops store aisle shelf shelves
door doors doorstep window windows attic attics wall walls radiator radiators heater radio letter letters envelope table family families
parent parents child children neighbour neighbours people person woman man office desk phone van field farm park rain weather morning
evening cup water bottle bathroom shower garage hallway queue market pet pets cat cats dog dogs bowl food car cars train""".split())
_FIRST_PERSON = re.compile(r"\b(?:you|your|yours|we|our|us|i|my|me)\b", re.I)
#: Where a slide type looks first for its scene: the work its own hint, the idea the territory's thought, the cover its mood.
_LOOK_FIRST = {"execution": ("hint", "sketch", "mood", "thought"), "idea": ("thought", "sketch", "mood"), "title": ("mood", "thought", "sketch")}


def territory_subject(slide: dict, territory: dict | None, banned=(), deny: dict | None = None) -> str:
    """A picture subject drawn from the chosen territory and the slide: the first sentence (the work: its own visual hint first; the idea:
    the territory's thought; the cover: its mood) that shows a scene (a place or a person, no 'you' or 'we', no chart, type or sound) and
    passes the picture lint (allow-listed words, no name, no digit, no banned imagery, nothing marked Confidential); else a scene built from
    the nouns the slide and the territory name and the mood's first words. '' when nothing passes (the caller falls back to its template)."""
    from visuals import lint   # noqa: PLC0415
    t = territory or {}
    src = {"hint": (slide.get("visual") or {}).get("hint") or "", "mood": t.get("mood") or "", "sketch": t.get("sketch") or "",
           "thought": t.get("thought") or ""}
    for key in _LOOK_FIRST.get(slide.get("type"), ("mood", "thought", "sketch")):
        for c in _sentences(src[key]):
            c = c.strip(" .,:") + "."
            words = set(re.findall(r"[a-z]+", c.lower()))
            if (5 <= len(c.split()) <= 40 and words & _SCENE and not _FIRST_PERSON.search(c) and not _NOT_A_SCENE.search(c)
                    and not lint.lint_text(c, banned, deny)):
                return c[:images_subject_max()]
    own = " ".join([str(slide.get("title") or "")] + [str(b.get("text") or "") for b in slide.get("blocks") or []])
    nouns = []
    for text in (own, src["hint"], src["thought"], src["sketch"], src["mood"]):
        for w in re.findall(r"[a-z]+", str(text).lower()):
            if w in _SCENE and w not in nouns and w.rstrip("s") not in [n.rstrip("s") for n in nouns] and not lint.lint_text(w, banned, deny):
                nouns.append(w)
    feel = ""
    first = _sentences(src["mood"])
    if first:
        f = re.split(r"[:;]|\blike\b", first[0])[0]
        f = re.sub(r"[^A-Za-z ,'-]", " ", f).strip(" ,").lower()
        if 1 <= len(f.split()) <= 6 and not _NOT_A_SCENE.search(f) and not lint.lint_text(f, banned, deny):
            feel = f
    mass = {"water", "weather", "rain", "food", "people", "morning", "evening"}
    np_ = lambda w: w if (w in mass or w.endswith("s")) else (("an " if w[0] in "aeiou" else "a ") + w)  # noqa: E731
    where = (" with " + " and ".join(np_(w) for w in nouns[:2])) if nouns else ""
    built = f"An everyday scene{where}, in soft natural light." + (f" Mood: {feel}." if feel else "")
    return built if not lint.lint_text(built, banned, deny) else ""


def images_subject_max() -> int:
    from . import images   # noqa: PLC0415
    return images.SUBJECT_MAX


def chosen_territory(territories, deck: dict | None = None) -> dict | None:
    """The chosen territory of a run: deck.territories.chosen (or the first)."""
    ts = list(territories or [])
    chosen = ((deck or {}).get("territories") or {}).get("chosen") if isinstance((deck or {}).get("territories"), dict) else None
    return next((x for x in ts if x.get("id") == chosen), ts[0] if ts else None)


# ---------------------------------------------------------------------------------------------------------- the pass

def apply(deck: dict, inp, st: dict, *, client: str = "", project: str = "", agency: str = "", brief_meta: dict | None = None) -> dict:
    """Every pitch-ready fix, in order, on an assembled deck (after stage e and the red team, before the pictures and the layout plan).
    Returns the record that goes in ``meta.pitch_ready``."""
    rec = {"codes": scrub_deck(deck)}
    rec["to_confirm_cleared"] = clear_confirmed(deck, inp)
    rec["softened"] = soften_uncited(deck)
    rec["evidence"] = attach_evidence(deck, inp)
    if rec["to_confirm_cleared"] and not rec["evidence"]:
        refresh_sources(deck, inp)   # a figure the evidence verified now cites it
    rec["cover"] = cover(deck, st, client, project, agency, brief_meta, ((st.get("a0") or {}).get("names") or {}))
    rec["needs_person"] = len(needs_person(deck))
    rec["codes"] += scrub_deck(deck)   # the lines added above carry no code, but a moved claim might
    deck["meta"]["pitch_ready"] = rec
    return rec
