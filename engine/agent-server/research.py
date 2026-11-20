"""Research agent — grounds a Brief Maker draft before the engine runs.

Two tracks, one dossier:
  corpus  — precedent retrieval across the award corpora (ipa · cannes · effie ·
            dandad) + planner playbooks, via the engine's own rag/retrieve.py —
            the same retrieval every Brief Maker instance shares.
  web     — live context on the client/market/competitors, behind RESEARCH_WEB:
            "off" (default) or "claude" (reference impl: headless `claude -p`
            with WebSearch — dev-mode; slot a search API in here for production).

gather() returns (dossier_text, summary_markdown) or (None, None).

The dossier NEVER enters the engine input: Loop-1 capture must remain a
faithful no-loss record of the client's own brief (the one hard rule — and the
ledger measures it, so injected text craters coverage). Strategy grounding
comes from the engine's own Loops 3–7 retrieval over the same corpora; the
dossier's job is the planner-facing context panel (and, later, regen guidance).
"""

from __future__ import annotations

import json
import os
import re
import subprocess
import sys
import traceback
from pathlib import Path

HERE = Path(__file__).resolve().parent
ENGINE_ROOT = HERE.parent
sys.path.insert(0, str(ENGINE_ROOT))

import parse_brief  # noqa: E402

DOSSIER_HEADER = ("===== RESEARCH DOSSIER "
                  "(supporting context — not part of the client brief) =====")

_MAX_CORPUS_FINDINGS = 8
_SNIPPET_CHARS = 420

#: How the web track sources figures (the blind deck review of 19 Nov 2026: a regional Irish utility's case rested on US figures in
#: gallons). Local first, metric for a metric market, and a figure from elsewhere says where it is from.
SOURCING_RULES = (
    "Sourcing rules: prefer sources from the brief's own market (its country or region, its regulator, statistics office and local "
    "press) and metric figures. Use a figure from another market only when the brief's market has none, and say which market it is "
    "from in the claim and in \"market\" (e.g. \"US figure\"). For a market that uses metric units (Ireland, the UK, the EU), write "
    "every quantity in metric units (litres, kilometres, kilograms, degrees Celsius), converted from the source's units, and keep the "
    "source's own figure in brackets.\n"
)


def _gist(text: str) -> dict | None:
    """Summarise a client brief into a terse JSON gist (client/market/problem/objective/
    audience/competitors/category) via a model call, for use as query/filter material.
    Returns None if the call fails or produces no usable object."""
    # `category` is not decoration: it is the filter that decides whether an automotive
    # brief retrieves automotive precedent or the whole corpus. Constrained to the locked
    # contract list, and left empty rather than guessed — brief_context widens on its own
    # when the filter is too narrow, but it cannot un-guess a wrong category.
    try:
        sys.path.insert(0, str(ENGINE_ROOT / "rag"))
        from contract import SCHEMA  # noqa: PLC0415
        cats = ", ".join(SCHEMA.enum_values("category"))
    except Exception:
        cats = ""
    obj = parse_brief._json_call(
        "Summarise this client brief for a researcher. JSON only: "
        '{"client": "...", "market": "...", "problem": "...", "objective": "...", '
        '"audience": "...", "competitors": "...", "category": "..."}\n'
        + (f'`category` MUST be exactly one of: {cats}. Use "" if genuinely unclear.\n' if cats else "")
        + '\nBRIEF:\n' + text[:6000],
        system="You brief researchers. Terse, factual, JSON only.",
        max_tokens=300,
        accept=lambda o: isinstance(o, dict) and o.get("problem"),
    )
    return obj if isinstance(obj, dict) else None


def _digest_track() -> list[dict]:
    """No vector store? Ground the context panel on pack digests instead —
    paraphrased pattern notes distilled offline (scripts/distil_pack.py) and
    shipped as plain files. Static per pack, but honest grounding beats none."""
    findings = []
    for root in (ENGINE_ROOT / "packs_dist",):
        if not root.is_dir():
            continue
        for digest in sorted(root.glob("*/digest.md")):
            pack = digest.parent.name
            text = digest.read_text(errors="replace").strip()
            if text:
                findings.append({"citation": f"{pack} digest",
                                 "text": text[:_SNIPPET_CHARS * 3], "score": 0.0})
    return findings[:_MAX_CORPUS_FINDINGS]


def _corpus_track(gist: dict) -> list[dict]:
    """Precedent and craft for the planner's context panel, via the shared brief
    retrieval API (engine/rag/brief_context.py).

    This used to paste the gist into three sentence templates and take four hits each,
    unfiltered and unbudgeted. That searched all 7,315 chunks for every brief, so an
    automotive brief was as likely to surface semiotics and Bourdieu as a car launch.
    build() applies the contract's filters, keeps the panel inside a token budget, splits
    the findings into precedent / craft / pitfalls / brief standard, and gives every hit
    a citation id that check_grounding() can verify — which is also what lets a later
    human verdict be tied back to the precedent that informed it."""
    try:
        sys.path.insert(0, str(ENGINE_ROOT / "rag"))
        from brief_context import build  # noqa: PLC0415
        from retrieve import index_available  # noqa: PLC0415
    except Exception:
        traceback.print_exc()
        return _digest_track()
    if not index_available():
        return _digest_track()
    try:
        # `gist` is model output over raw attachment text, including its "client" key, so
        # it is passed as query/filter material ONLY. brand= is what unlocks brand-scoped
        # material and it stays None until there is an authenticated session to resolve it
        # from — otherwise a client name written inside an uploaded file would choose
        # whose private dossier this panel may read. House and category material only.
        ctx = build(gist, brand=None)
    except Exception:
        traceback.print_exc()
        return _digest_track()

    findings = []
    for bucket in ("exemplars", "craft", "rules", "instructions"):
        for h in ctx.blocks[bucket].hits:
            findings.append({"citation": h.cite, "bucket": bucket, "title": h.title,
                             "text": h.text, "score": h.score, "header": h.header,
                             "source": h.metadata.get("source"), "metadata": h.metadata})
    t = ctx.trace()
    print(f"[i] research corpus: {len(findings)} findings, {t['tokens']} tokens, "
          f"filters={t['filters'].get('exemplars', '')}, widened={t['widened'] or 'none'}",
          file=sys.stderr)
    return findings


def _web_track(gist: dict) -> list[dict]:
    """Return live web findings for the brief's client/market/problem/competitors, by shelling
    out to headless `claude -p` with WebSearch, when RESEARCH_WEB=claude; otherwise returns [].
    Parses the model's JSON array of {claim, url, date} findings, dropping any without a claim
    and url, and returns [] on a non-zero exit, timeout, or unparsable output."""
    mode = os.environ.get("RESEARCH_WEB", "off").strip().lower()
    if mode != "claude":
        return []
    sg = sanitise_gist(gist)   # the client's name, its rivals' names and every figure stay out of what goes to a search
    prompt = (
        "Research the current market context for an advertising brief. "
        f"Market: {sg['market'] or '?'}. Category: {sg['category'] or '?'}. "
        f"Problem: {sg['problem'] or '?'}.\n"
        + SOURCING_RULES +
        "Use web search. Return 3-6 findings as a JSON array ONLY: "
        '[{"claim": "...", "url": "...", "date": "...", "market": "..."}]. '
        "Only findings you can source; no speculation."
    )
    try:
        proc = subprocess.run(
            ["claude", "-p", prompt, "--output-format", "json",
             "--allowedTools", "WebSearch", "--max-turns", "6"],
            capture_output=True, text=True, timeout=180,
        )
        if proc.returncode != 0:
            print(f"[i] web track: claude exited {proc.returncode}", file=sys.stderr)
            return []
        result = json.loads(proc.stdout).get("result", "")
        start, end = result.find("["), result.rfind("]")
        items = json.loads(result[start:end + 1]) if start >= 0 <= end else []
        return [i for i in items if isinstance(i, dict) and i.get("claim") and i.get("url")][:6]
    except (subprocess.TimeoutExpired, FileNotFoundError, json.JSONDecodeError) as e:
        print(f"[i] web track unavailable: {e}", file=sys.stderr)
        return []


# ---------------------------------------------------------------------------------------------- evidence for the deck's argument
# The blind judging of decks built from real client briefs (20 Nov 2026) scored evidence 3-5/10: no deck went beyond the brief, and the one
# research run that did quoted another market's figures. The evidence track below is market-aware (the brief's own country or region first:
# its statistics office, regulator, trade bodies and local press; an international source only as a fallback, labelled with its market) and
# argument-led (it searches for support of the claims the deck makes: insight, audience, proposition, reasons to believe), and every finding
# carries its market, year, metric units and source URL. Queries are built from a sanitised gist only: never the client's name, a rival's
# name or a figure from the brief.

#: Where a local figure comes from, in the order the track asks for them.
LOCAL_SOURCE_KINDS = ("national statistics office", "regulator", "trade body or industry association", "local press")
#: The deck claims research is asked to support, and the slides they sit on.
CLAIM_ROLES = ("insight", "audience", "proposition", "reasons_to_believe", "market")
#: Aim: at least this many findings from the brief's own market per run (fewer is reported, never padded).
MIN_LOCAL = 3
_MAX_CLAIMS = 8
_MAX_FINDINGS = 10
_STOP = set("""a an the and or but so of to in on for with at by from as is are was were be been being it its this that these those their
their them they we our you your he she his her not no do does did can could will would should may might must than then there here about into
over under more most less least very just also only own same such each every any some all both either neither who whom whose which what when
where why how have has had because while yet still even though if per via up down out off again new""".split())
_GENERIC_PLACE = {"regional", "national", "local", "global", "international", "the", "a", "single", "unspecified", "urban", "rural", "city",
                  "county", "region", "area", "market", "service", "domestic", "home"}
_SKIP_GIST = {"", "?", "unknown", "unspecified", "not stated", "n/a", "none"}


def _common() -> frozenset:
    """Common English words (the picture lint's list): a word of a name that is one of them ('Water' of 'Lumen Water') is not a name alone."""
    try:
        from visuals import lint  # noqa: PLC0415
        return lint.allowed()
    except Exception:  # noqa: BLE001
        return frozenset()


def _names(gist: dict, extra=()) -> list[str]:
    """The client's name and its rivals' names (split on commas, slashes, 'and'), longest first: what a query may never carry."""
    out = []
    for raw in [gist.get("client"), gist.get("competitors"), *extra]:
        for part in re.split(r"[,;/&]|\band\b|\bvs\.?\b", str(raw or ""), flags=re.I):
            p = part.strip(" .'\"()")
            if len(p) >= 2 and p.lower() not in _SKIP_GIST and not p.lower().startswith(("not ", "no ", "none")):
                out.append(p)
                out += [w for w in p.split() if len(w) >= 4 and w[0].isupper() and w.lower() not in _common()]   # 'Lumen' of 'Lumen Water' on its own, never 'Water'
    return sorted(set(out), key=len, reverse=True)


def scrub(text: str, names=()) -> str:
    """``text`` with every name in ``names`` (whole words, any case, possessive too) and every figure removed: query material only."""
    t = str(text or "")
    for n in names:
        t = re.sub(rf"(?i)\b{re.escape(n)}(?:'s|’s)?\b", " ", t)
    t = re.sub(r"[$€£]?\d[\d,.]*\s*%?", " ", t)   # a figure in the brief may be confidential (sales, budgets): never searched for
    return " ".join(t.split()).strip(" ,;:.")


def sanitise_gist(gist: dict, names=()) -> dict:
    """The gist a query may be built from: market, category, audience, problem and objective, with the client's and the rivals' names and
    every figure removed. The client name and the competitors themselves are dropped (they stay in the full gist for the planner's panel)."""
    nm = _names(gist or {}, names)
    out = {}
    for k in ("market", "category", "audience", "problem", "objective"):
        v = scrub(str((gist or {}).get(k) or ""), nm)
        out[k] = "" if v.lower() in _SKIP_GIST else v
    return out


def market_of(gist: dict) -> str:
    """The brief's market (a country or region) as one short phrase; '' when the brief gives none."""
    m = str((gist or {}).get("market") or "").strip()
    m = re.split(r"[;(,]|\s[-—–]\s|—|–", m)[0].strip(" .,")
    if m.lower() in _SKIP_GIST or m.lower().startswith(("unspecified", "unknown", "not ")):
        return ""
    named = [w for w in m.split() if w[:1].isupper() and w.lower() not in _GENERIC_PLACE]
    return m if named else ""   # 'Regional utility service area' names no place: the track then goes international, labelled


def _topic(text: str, names=(), n: int = 8) -> str:
    """A claim as search words: lower case, no stop words, no names, no figures, at most ``n`` words."""
    t = scrub(text, names)
    t = re.sub(r"(?<!^)(?<![.!?]\s)\b[A-Z][a-z]+\b", " ", t)   # a capital in mid-sentence reads as a name: it never reaches a search
    words = [w for w in re.findall(r"[a-z][a-z'-]+", t.lower()) if w not in _STOP and len(w) > 2]
    return " ".join(list(dict.fromkeys(words))[:n])


def _as_text(v) -> str:
    """A brief field value (a string, a list, a dict of strings) as one string."""
    if isinstance(v, dict):
        return " ".join(_as_text(x) for x in v.values())
    if isinstance(v, list):
        return " ".join(_as_text(x) for x in v)
    return str(v or "")


def deck_claims(brief_object: dict | None = None, storyline: dict | None = None, names=()) -> list[dict]:
    """The claims the deck makes that need support: ``[{role, claim}]`` from the brief's insight, audience, proposition and reasons to believe
    and from stage b's insight, audience, from/to and proposition RTBs. Names and figures are scrubbed; at most _MAX_CLAIMS, no repeats."""
    out = []
    add = lambda role, text: out.append({"role": role, "claim": scrub(text, names)[:240]}) if scrub(text, names) else None  # noqa: E731
    golden = ((brief_object or {}).get("loop2_golden") or {}).get("fields") or {}
    for fid, role in (("insight", "insight"), ("audience", "audience"), ("smp", "proposition"), ("reasons_to_believe", "reasons_to_believe")):
        v = (golden.get(fid) or {}).get("value")
        for part in (v if isinstance(v, list) else [v]):
            if _as_text(part).strip():
                add(role, _as_text(part))
    b = storyline or {}
    ins = b.get("insight") or {}
    if ins.get("title"):
        add("insight", ins["title"])
    for e in (ins.get("evidence") or [])[:2]:
        add("insight", (e or {}).get("text") if isinstance(e, dict) else e)
    au = b.get("audience") or {}
    if au.get("primary") or au.get("title"):
        add("audience", au.get("primary") or au.get("title"))
    ft = b.get("from_to") or {}
    if ft.get("to"):
        add("proposition", ft["to"])
    for r in ((b.get("proposition") or {}).get("rtbs") or [])[:3]:
        add("reasons_to_believe", (r or {}).get("text") if isinstance(r, dict) else r)
    seen, uniq = set(), []
    for c in out:
        k = _topic(c["claim"], names, 6)
        if k and k not in seen:
            seen.add(k)
            uniq.append(c)
    return uniq[:_MAX_CLAIMS]


def build_queries(sg: dict, claims: list[dict], names=()) -> list[dict]:
    """The searches, local first: ``[{query, kind, role}]``. One per local source kind for the market and category, one per claim in the
    market, then an international fallback per claim (its findings are labelled with their own market). Never a name, never a figure."""
    market, cat = sg.get("market") or "", (sg.get("category") or "").replace("_", " ")
    topic = _topic(" ".join(filter(None, [sg.get("problem"), sg.get("audience")])), names, 6)
    qs = []
    where = market or "the brief's market"
    for kind in LOCAL_SOURCE_KINDS:
        qs.append({"query": " ".join(filter(None, [market, kind, cat, topic])), "kind": "local", "role": "market", "source_kind": kind})
    for c in claims:
        t = _topic(c["claim"], names)
        if t:
            qs.append({"query": " ".join(filter(None, [market, cat, t, "statistics survey"])), "kind": "local", "role": c["role"]})
    for c in claims[:4]:
        t = _topic(c["claim"], names, 6)
        if t:
            qs.append({"query": " ".join(filter(None, [cat, t, "study"])), "kind": "fallback", "role": c["role"]})
    for q in qs:   # belt and braces: a name that slipped through any path is taken out here
        q["query"] = scrub(q["query"], names) or where
    return qs


_YEAR = re.compile(r"\b(19|20)\d\d\b")


def normalise_finding(item: dict, market: str) -> dict | None:
    """One finding in the deck's shape, or None without a claim and a URL: ``{claim, figure, value, unit, metric, market, local, year, source,
    url, supports, for_claim}``. ``local`` is True when its market is the brief's; a finding from elsewhere keeps its own market label."""
    if not isinstance(item, dict):
        return None
    claim, url = str(item.get("claim") or "").strip(), str(item.get("url") or "").strip()
    if not claim or not url.startswith(("http://", "https://")):
        return None
    mk = str(item.get("market") or "").strip() or "unstated market"
    yr = _YEAR.search(str(item.get("year") or item.get("date") or ""))
    year = yr.group(0) if yr else ""
    dom = re.sub(r"^https?://(www\.)?", "", url).split("/")[0]
    src = str(item.get("source") or item.get("publisher") or "").strip() or dom
    m = market.lower().strip()
    local = bool(m) and (m in mk.lower() or mk.lower() in m) and not re.search(r"\bfigure\b|\bfallback\b", mk, re.I)
    if item.get("local") is False:
        local = False
    sup = str(item.get("supports") or "market").strip().lower().replace(" ", "_")
    sup = sup if sup in CLAIM_ROLES else ("reasons_to_believe" if sup in ("rtb", "rtbs") else "market")
    value = item.get("value")
    if not isinstance(value, (int, float)) or isinstance(value, bool):
        nm = re.search(r"\d[\d,]*(?:\.\d+)?", str(item.get("figure") or claim))
        try:
            value = float(nm.group(0).replace(",", "")) if nm else None
        except ValueError:
            value = None
    return {"claim": claim[:300], "short": str(item.get("short") or "").strip()[:140], "figure": str(item.get("figure") or "").strip()[:40],
            "value": value, "unit": str(item.get("unit") or item.get("units") or "").strip()[:30], "metric": str(item.get("metric") or "").strip()[:80],
            "market": mk[:60], "local": local, "year": year, "source": src[:80], "source_kind": str(item.get("source_kind") or "").strip()[:40],
            "url": url[:400], "supports": sup, "for_claim": str(item.get("for_claim") or "").strip()[:240]}


def evidence_prompt(sg: dict, claims: list[dict], queries: list[dict]) -> str:
    """The one request the evidence track sends (headless ``claude -p`` with WebSearch): the market, the claims, the searches, the rules."""
    market = sg.get("market") or "not stated"
    lines = "\n".join(f"- [{c['role']}] {c['claim']}" for c in claims) or "- [market] the category in this market"
    qlines = "\n".join(f"- {q['query']}" for q in queries)
    return ("Find evidence for the argument of an advertising pitch deck. "
            f"Market: {market}. Category: {(sg.get('category') or 'not stated').replace('_', ' ')}.\n"
            f"Claims the deck makes that need support:\n{lines}\n"
            f"Searches to run (local first; adapt the words, never add a brand or company name):\n{qlines}\n"
            "Source order: the market's national statistics office, then its regulator, then trade bodies or industry associations, then "
            "local press; an international source only when the market has none, and then say which market it is from.\n"
            + SOURCING_RULES +
            f"Aim for at least {MIN_LOCAL} findings from {market}. Each finding is one figure that supports one claim.\n"
            "Return 4-10 findings as a JSON array ONLY: "
            '[{"claim": "one sentence with the figure", "short": "the same in at most 12 words, figure included", "figure": "8.5%", '
            '"value": 8.5, "unit": "percent", "metric": "what is measured", "market": "the country or region the figure is about", '
            '"year": "2024", "source": "publisher name", "source_kind": "statistics office|regulator|trade body|press|study", '
            '"url": "https://...", "supports": "insight|audience|proposition|reasons_to_believe|market", "for_claim": "the claim it supports"}]. '
            "Only findings you can source with a working URL; no speculation.")


def _evidence_track(sg: dict, claims: list[dict], queries: list[dict]) -> list[dict]:
    """Live findings for the deck's claims, by one headless ``claude -p`` call with WebSearch when RESEARCH_WEB=claude; [] otherwise or on
    any failure. Normalised with normalise_finding, local ones first."""
    if os.environ.get("RESEARCH_WEB", "off").strip().lower() != "claude":
        return []
    try:
        proc = subprocess.run(["claude", "-p", evidence_prompt(sg, claims, queries), "--output-format", "json",
                               "--allowedTools", "WebSearch", "--max-turns", "12"], capture_output=True, text=True, timeout=420)
        if proc.returncode != 0:
            print(f"[i] evidence track: claude exited {proc.returncode}", file=sys.stderr)
            return []
        result = json.loads(proc.stdout).get("result", "")
        start, end = result.find("["), result.rfind("]")
        items = json.loads(result[start:end + 1]) if start >= 0 <= end else []
    except (subprocess.TimeoutExpired, FileNotFoundError, json.JSONDecodeError) as e:
        print(f"[i] evidence track unavailable: {e}", file=sys.stderr)
        return []
    found = [f for f in (normalise_finding(i, sg.get("market") or "") for i in items) if f]
    found.sort(key=lambda f: (not f["local"],))
    return found[:_MAX_FINDINGS]


def gather_evidence(gist: dict, brief_object: dict | None = None, storyline: dict | None = None, names=()) -> dict:
    """Evidence for the deck's argument: ``{version, market, category, claims, queries, findings, local, short_of_local}``. ``gist`` is the
    researcher's gist (its client name and competitors are scrubbed before anything is built from it); ``names`` any further names to keep
    out. The deck reads the result with ``--evidence`` (engine/deck/pitch_ready.load_evidence)."""
    nm = _names(gist or {}, names)
    sg = sanitise_gist(gist or {}, names)
    sg["market"] = market_of(sg)
    claims = deck_claims(brief_object, storyline, nm)
    queries = build_queries(sg, claims, nm)
    findings = _evidence_track(sg, claims, queries)
    local = sum(1 for f in findings if f["local"])
    return {"version": 1, "market": sg["market"], "category": sg.get("category", ""), "claims": claims, "queries": [q["query"] for q in queries],
            "findings": findings, "local": local, "short_of_local": local < MIN_LOCAL}


def evidence_markdown(ev: dict) -> str:
    """The evidence as a planner reads it: one line per finding with its market, year, source and URL."""
    rows = [f"# Evidence for the argument\n\nMarket: {ev.get('market') or 'not stated'}. Local findings: {ev.get('local', 0)}"
            + (f" (under the aim of {MIN_LOCAL})" if ev.get("short_of_local") else "") + ".\n"]
    for f in ev.get("findings") or []:
        rows.append(f"- [{f['supports']}] {f['claim']} ({f['source']}, {f['year'] or 'n.d.'}, {f['market']}"
                    + ("" if f["local"] else ", not local") + f") {f['url']}")
    return "\n".join(rows) + "\n"


def gather(text: str, clan_data: dict | None = None) -> tuple[str | None, str | None]:
    """Build the research dossier for a client brief: gist the brief, pull corpus precedent and
    (if enabled) live web findings, and render both a full dossier (grouped by bucket, for the
    engine's context panel) and a short markdown summary. Returns (None, None) when no gist can
    be produced or neither track yields anything — i.e. no research is possible."""
    gist = _gist(text)
    if not gist:  # keyless mode — no research possible
        return None, None
    corpus = _corpus_track(gist)
    web = _web_track(gist)
    if not corpus and not web:
        return None, None

    dossier = [DOSSIER_HEADER]
    summary = []
    if corpus:
        # Grouped, not flattened: a planner needs to see at a glance which of these is a
        # proven case and which is a textbook warning. Falls back to one list for the
        # digest track, which has no buckets.
        headings = {"exemplars": "Precedent — comparable work",
                    "craft": "Craft — how planners approach this",
                    "rules": "Pitfalls — common mistakes in this kind of work",
                    "instructions": "Brief standard — what a good brief contains"}
        grouped: dict[str, list] = {}
        for h in corpus:
            grouped.setdefault(h.get("bucket") or "_", []).append(h)
        for bucket, heading in headings.items():
            if grouped.get(bucket):
                dossier.append(f"{heading}:")
                for h in grouped[bucket]:
                    dossier.append(f"- [{h['citation']}] {h['text'][:_SNIPPET_CHARS].strip()}")
        if grouped.get("_"):
            dossier.append("Precedent from the effectiveness/creative corpora:")
            for h in grouped["_"]:
                dossier.append(f"- [{h['citation']}] {h['text'][:_SNIPPET_CHARS].strip()}")
        top = grouped.get("exemplars") or corpus
        summary.append("Precedent: " + "; ".join(h["citation"] for h in top[:4]))
    if web:
        dossier.append("Live market context (web):")
        for w in web:   # a figure from another market keeps its market beside it
            mk = str(w.get("market") or "").strip()
            dossier.append(f"- {w['claim']}" + (f" [{mk}]" if mk else "") + f" ({w['url']})")
        summary.append("Web: " + "; ".join(f"{w['claim'][:80]} ({w['url']})" for w in web[:3]))

    print(f"[✓] research: {len(corpus)} corpus + {len(web)} web findings")
    return "\n".join(dossier), "\n".join(f"- {s}" for s in summary)


def main(argv=None) -> int:
    """``python3 research.py evidence --gist GIST.json [--brief brief_object.json] [--storyline b_storyline.json] --out DIR``: evidence for a
    deck's argument, written to DIR/evidence.json (what the deck's ``--evidence`` reads) and DIR/evidence.md. ``--gist`` takes a gist or a
    research.json holding one; ``--text FILE`` makes the gist from the brief text instead (one model call). Live web only with RESEARCH_WEB=claude."""
    import argparse
    ap = argparse.ArgumentParser(prog="research.py")
    ap.add_argument("cmd", choices=("evidence",))
    ap.add_argument("--gist", type=Path)
    ap.add_argument("--text", type=Path)
    ap.add_argument("--brief", type=Path)
    ap.add_argument("--storyline", type=Path)
    ap.add_argument("--name", action="append", default=[], help="a further name no query may carry (repeatable)")
    ap.add_argument("--out", type=Path, required=True)
    a = ap.parse_args(argv)
    if a.gist:
        g = json.loads(a.gist.read_text())
        gist = g.get("gist", g) if isinstance(g, dict) else {}
    elif a.text:
        gist = _gist(a.text.read_text()) or {}
    else:
        ap.error("give --gist or --text")
    brief = json.loads(a.brief.read_text()) if a.brief else None
    if brief and isinstance(brief.get("meta"), dict):   # the brief tool's own client and project names stay out of every query too
        a.name += [str(brief["meta"].get(k) or "") for k in ("client", "project")]
    story = json.loads(a.storyline.read_text()) if a.storyline else None
    ev = gather_evidence(gist, brief, story, a.name)
    a.out.mkdir(parents=True, exist_ok=True)
    (a.out / "evidence.json").write_text(json.dumps(ev, indent=1, ensure_ascii=False))
    (a.out / "evidence.md").write_text(evidence_markdown(ev))
    print(f"[✓] evidence: {len(ev['findings'])} findings, {ev['local']} local ({ev['market'] or 'no market'})")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
