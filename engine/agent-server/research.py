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
import unicodedata
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


def cli_env() -> dict:
    """The environment for this tool-using `claude -p` run: the parent's, minus the variables that
    point the engine's own Messages calls at the local model backend (scripts/model-local) or bill a
    key. The CLI runs on the developer's Claude Code login, and a WebSearch run cannot go through
    the backend, which refuses tools."""
    env = {**os.environ}
    for k in ("ANTHROPIC_BASE_URL", "ANTHROPIC_API_KEY"):
        env.pop(k, None)
    return env


def _web_track(gist: dict, brief_object: dict | None = None) -> list[dict]:
    """Return live web findings for the brief's client/market/problem/competitors, by shelling
    out to headless `claude -p` with WebSearch, when RESEARCH_WEB=claude; otherwise returns [].
    Parses the model's JSON array of {claim, url, date} findings, dropping any without a claim
    and url, and returns [] on a non-zero exit, timeout, or unparsable output."""
    mode = os.environ.get("RESEARCH_WEB", "off").strip().lower()
    if mode != "claude":
        return []
    nm = _names(gist, (), brief_object)
    sg = sanitise_gist(gist, (), brief_object)   # the client's name, its rivals' names and every figure stay out of what goes to a search
    mk = market_of(sg, brief_object)
    for k in ("category", "problem"):   # the allowlist guard: no proper noun the blocklist did not know
        sg[k] = proper_guard(sg.get(k) or "", mk)
    try:
        assert_clean([sg["market"], sg["category"], sg["problem"]], nm)
    except NameLeak as e:
        print(f"[!] web track refused: {e}", file=sys.stderr)
        return []
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
            capture_output=True, text=True, timeout=180, env=cli_env(),
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


#: Corporate suffixes: part of a name, never a name on their own.
_CORP = {"ltd", "plc", "inc", "llc", "gmbh", "srl", "sa", "ag", "dac", "limited", "group", "holdings", "company", "co", "corp", "the"}
#: brief_object keys whose values are names (a client, a brand, a product, a rival); paragraph fields give their capitalised non-common words.
_NAME_KEYS = ("client", "brand", "brands", "brand_name", "client_name", "project", "competitors", "competitor",
              "competitors_market", "competition")
#: What separates two names in a field: commas, slashes, brackets, quotes, 'and', 'vs', a spaced dash, a colon.
_SPLIT = re.compile(r"[,;/&|()\[\]{}\"“”«»„‹›:+]|\band\b|\bvs\.?\b|\bversus\b|\bincluding\b|\bsuch as\b|\s[-–—]\s", re.I)
_EDGE = " .'\"‘’`*-–—_!?"


#: A market's own adjectives, kept by the guard ('Irish households').
DEMONYMS = {"ireland": ("irish",), "romania": ("romanian", "romanians"), "united kingdom": ("british", "uk"), "britain": ("british",),
            "germany": ("german",), "france": ("french",), "spain": ("spanish",), "italy": ("italian",), "poland": ("polish",),
            "netherlands": ("dutch",), "belgium": ("belgian",), "sweden": ("swedish",), "norway": ("norwegian",), "denmark": ("danish",),
            "finland": ("finnish",), "portugal": ("portuguese",), "austria": ("austrian",), "switzerland": ("swiss",), "greece": ("greek",),
            "bulgaria": ("bulgarian",), "hungary": ("hungarian",), "czech": ("czech",), "croatia": ("croatian",), "serbia": ("serbian",),
            "slovakia": ("slovak",), "slovenia": ("slovenian",), "ukraine": ("ukrainian",), "turkey": ("turkish",),
            "lithuania": ("lithuanian",), "latvia": ("latvian",), "estonia": ("estonian",), "united states": ("american",),
            "england": ("english",), "scotland": ("scottish",), "wales": ("welsh",), "europe": ("european",)}
_DEMONYM_WORDS = frozenset(d for ds in DEMONYMS.values() for d in ds) - {"uk"}
#: Every sovereign country (English short names) and the common short forms: a market a query may name, never a client's name.
_COUNTRIES = """afghanistan|albania|algeria|andorra|angola|antigua and barbuda|argentina|armenia|australia|austria|azerbaijan|bahamas|bahrain|
bangladesh|barbados|belarus|belgium|belize|benin|bhutan|bolivia|bosnia and herzegovina|bosnia|botswana|brazil|brunei|bulgaria|burkina faso|
burundi|cabo verde|cape verde|cambodia|cameroon|canada|central african republic|chad|chile|china|colombia|comoros|congo|costa rica|croatia|
cuba|cyprus|czechia|czech republic|czech|denmark|djibouti|dominica|dominican republic|ecuador|egypt|el salvador|equatorial guinea|eritrea|
estonia|eswatini|swaziland|ethiopia|fiji|finland|france|gabon|gambia|georgia|germany|ghana|greece|grenada|guatemala|guinea|guinea-bissau|
guyana|haiti|honduras|hungary|iceland|india|indonesia|iran|iraq|ireland|israel|italy|ivory coast|cote d'ivoire|jamaica|japan|jordan|
kazakhstan|kenya|kiribati|kosovo|kuwait|kyrgyzstan|laos|latvia|lebanon|lesotho|liberia|libya|liechtenstein|lithuania|luxembourg|madagascar|
malawi|malaysia|maldives|mali|malta|marshall islands|mauritania|mauritius|mexico|micronesia|moldova|monaco|mongolia|montenegro|morocco|
mozambique|myanmar|burma|namibia|nauru|nepal|netherlands|holland|new zealand|nicaragua|niger|nigeria|north korea|north macedonia|macedonia|
norway|oman|pakistan|palau|palestine|panama|papua new guinea|paraguay|peru|philippines|poland|portugal|qatar|romania|russia|rwanda|
saint kitts and nevis|saint lucia|saint vincent and the grenadines|samoa|san marino|sao tome and principe|saudi arabia|senegal|serbia|
seychelles|sierra leone|singapore|slovakia|slovenia|solomon islands|somalia|south africa|south korea|south sudan|spain|sri lanka|sudan|
suriname|sweden|switzerland|syria|taiwan|tajikistan|tanzania|thailand|timor-leste|togo|tonga|trinidad and tobago|tunisia|turkey|turkiye|
turkmenistan|tuvalu|uganda|ukraine|united arab emirates|uae|united kingdom|uk|united states|united states of america|usa|us|america|uruguay|
uzbekistan|vanuatu|vatican city|venezuela|vietnam|yemen|zambia|zimbabwe|republic of ireland|northern ireland|england|scotland|wales|
great britain|britain|british isles|hong kong|puerto rico|ireland and uk|uk and ireland""".replace("\n", "")
#: Regions a market may be: continents, trading blocs, sub-regions and the agency regions (EMEA, APAC).
_REGIONS = """europe|european union|eu|western europe|eastern europe|central europe|northern europe|southern europe|southeast europe|
central and eastern europe|cee|dach|nordics|nordic countries|scandinavia|benelux|balkans|baltics|baltic states|iberia|latin america|latam|
north america|south america|central america|caribbean|middle east|mena|gcc|emea|apac|asia|southeast asia|south asia|east asia|asia pacific|
africa|sub-saharan africa|north africa|oceania|australasia|worldwide|global""".replace("\n", "")
_PLACE_PHRASES = frozenset(" ".join(x.split()) for x in (_COUNTRIES + "|" + _REGIONS).split("|") if x.strip()) - {"worldwide", "global"}
_PLACE_MAXWORDS = max(len(x.split()) for x in _PLACE_PHRASES)
_PLACE_FILLER = frozenset({"the", "of", "and", "republic"})
_MARKET_KEYS = ("market", "markets", "country", "countries", "geography", "region", "territory")
#: Capitalised terms a query may keep although they are not common words: generic statistics and market words, never a brand.
GENERIC_TERMS = frozenset("""uk eu us usa un oecd gdp cpi vat sme smes diy gen z nhs hse ons cso eurostat ngo ngos covid tv dooh ooh pos
fmcg b2b b2c ai esg co2 kpi kpis""".split())


class NameLeak(ValueError):
    """A query or prompt bound for a web search still carries a scrubbed name: it is never sent."""


def _fold(text: str) -> str:
    """``text`` NFC-composed, lower case and without diacritics, one character for one character (so a match's span maps back)."""
    out = []
    for c in unicodedata.normalize("NFC", str(text or "")):
        d = "".join(x for x in unicodedata.normalize("NFKD", c) if not unicodedata.combining(x)).lower()
        out.append(d[:1] or c.lower()[:1] or c)
    return "".join(out)


def _depossess(w: str) -> str:
    return re.sub(r"(?:['’]s|s['’])$", "", w.strip(_EDGE)).strip(_EDGE)


def _name_values(obj, keys=_NAME_KEYS, depth=0) -> list:
    """Every value under a name key anywhere in a brief object (meta, upstream facets, loop1/loop2 fields with ``value``)."""
    out = []
    if depth > 6:
        return out
    if isinstance(obj, dict):
        for k, v in obj.items():
            if str(k).lower() in keys:
                out.append(v.get("value") if isinstance(v, dict) and "value" in v else v)
            elif isinstance(v, (dict, list)):
                out += _name_values(v, keys, depth + 1)
    elif isinstance(obj, list):
        for v in obj:
            out += _name_values(v, keys, depth + 1)
    return out


def brief_names(brief_object: dict | None) -> list[str]:
    """The names a brief object holds: its client, project, brand, products and competitors (meta, upstream facets, captured and golden
    fields). A paragraph field (competitors_market) gives its capitalised words that are not common words."""
    raw = []
    for v in _name_values(brief_object or {}):
        for x in (v if isinstance(v, list) else [v]):
            x = x.get("value") or x.get("name") or "" if isinstance(x, dict) else x
            s = str(x or "")
            if len(s.split()) > 8:   # a paragraph: only its name-like words
                raw += [w for w in re.findall(r"\b[A-Z][\w’'-]{2,}", s) if _fold(_depossess(w)) not in _common()]
            else:
                raw.append(s)
    return raw


def _names(gist: dict, extra=(), brief_object: dict | None = None) -> list[str]:
    """The client's, brands' and rivals' names, longest first: what a query may never carry. Robust to wrappers: a name in brackets
    ('Pet Foods (Tabbel)'), in quotes, possessive ('Tabbel's'), in any case or with diacritics is split out on its own, and so is each
    of its words that is not a common word ('Lumen' of 'Lumen Water', never 'Water'). A word of the brief's market is never a name."""
    g = gist or {}
    market = set(_fold(g.get("market") or "").split())   # and any country or region, at every split level (_is_place)
    raws = [g.get(k) for k in ("client", "brand", "brands", "product", "competitors")] + list(extra or ()) + brief_names(brief_object)
    out = []
    for raw in raws:
        for item in (raw if isinstance(raw, (list, tuple, set)) else [raw]):
            for part in _SPLIT.split(_drop_split_places(str(item or ""))):
                p = _depossess(" ".join(part.split()))
                fp = _fold(p)
                if len(p) < 2 or fp in _SKIP_GIST or fp in _CORP or fp.startswith(("not ", "no ", "none")) or _is_place(p):
                    continue
                out.append(p)
                bare = re.sub(r"(?:[\s,.]+(?:" + "|".join(sorted(_CORP)) + r")\.?)+$", "", p, flags=re.I).strip()
                if bare and bare != p and len(bare) >= 2 and not _is_place(bare):
                    out.append(bare)   # 'Pet Foods' of 'Pet Foods Ltd': the suffix is dropped as often as it is written
                for w in re.split(r"[\s-]+", p):
                    w = _depossess(w)
                    fw = _fold(w)
                    if len(w) >= 3 and fw not in _CORP and fw not in market and not _is_place(w) and fw not in _common() and not fw.isdigit():
                        out.append(w)   # 'Lumen' of 'Lumen Water' on its own, never 'Water'
    seen, uniq = set(), []
    for n in sorted(out, key=len, reverse=True):
        if _fold(n) not in seen:
            seen.add(_fold(n))
            uniq.append(n)
    return uniq


def _place_spans(text: str, demonyms: bool = False) -> list[tuple[int, int, bool]]:
    """Where ``text`` names a country or region: ``(start, end, is_phrase)`` spans on its NFC form, the longest phrase first at each
    position ('Northern Ireland' before 'Ireland'). With ``demonyms``, 'Irish' counts too."""
    f = _fold(unicodedata.normalize("NFC", str(text or "")))
    toks = [(m.group(0), m.start(), m.end()) for m in re.finditer(r"[\w'-]+", f)]
    out, i = [], 0
    while i < len(toks):
        for n in range(min(_PLACE_MAXWORDS, len(toks) - i), 0, -1):
            ph = " ".join(t[0] for t in toks[i:i + n])
            if ph in _PLACE_PHRASES or (demonyms and n == 1 and ph in _DEMONYM_WORDS):
                out.append((toks[i][1], toks[i + n - 1][2], True))
                i += n
                break
        else:
            out.append((toks[i][1], toks[i][2], False))
            i += 1
    return out


def _drop_split_places(text: str) -> str:
    """``text`` with every country or region phrase that holds a separator ('Central and Eastern Europe', 'Bosnia and Herzegovina')
    replaced by a comma, so the split never cuts it into a part that reads as a name ('Central')."""
    t = unicodedata.normalize("NFC", str(text or ""))
    for a, b, ok in reversed(_place_spans(t)):
        if ok and _SPLIT.search(t[a:b]):
            t = t[:a] + "," + t[b:]
    return t


def _is_place(text: str) -> bool:
    """True when ``text`` is nothing but country or region names (and 'the', 'of', 'and', 'Republic'): 'Ireland', 'the UK', 'Republic of
    Ireland', 'Central and Eastern Europe', 'Irish'. Such a part of a client field is the market, never a name."""
    f = _fold(unicodedata.normalize("NFC", str(text or "")))
    spans = _place_spans(text, demonyms=True)
    if not any(sp[2] for sp in spans):
        return False
    return all(sp[2] or f[sp[0]:sp[1]] in _PLACE_FILLER for sp in spans)


def _places_in(text: str) -> list[str]:
    """The country and region phrases ``text`` names, in order, as written, no repeats."""
    t = unicodedata.normalize("NFC", str(text or ""))
    seen, out = set(), []
    for a, b, ok in _place_spans(t):
        ph = " ".join(t[a:b].split())
        if ok and _fold(ph) not in seen:
            seen.add(_fold(ph))
            out.append(ph)
    return out


def resolve_market(market_text: str = "", brief_object: dict | None = None) -> str:
    """The market a query may name: the countries and regions in the gist's market field (inside brackets or not; a category there, as
    in 'Pet food (Romania)', is dropped); when it names none, the brief object's own market, country, geography or region fields. Several
    places are joined with ', '; '' when nothing validates (the track then goes international, labelled)."""
    places = _places_in(market_text)
    if not places:
        for v in _name_values(brief_object or {}, _MARKET_KEYS):
            places = _places_in(_as_text(v))
            if places:
                break
    return ", ".join(places[:4])


def _name_re(name: str):
    """A pattern for one name on folded text: its words with any spacing, hyphen, dot or none between them, whole words only, possessive
    too. None for a name with no letters."""
    toks = re.findall(r"\w+", _fold(name))
    if not toks:
        return None
    tok = lambda t: r"\.?".join(map(re.escape, t)) if len(t) <= 6 else re.escape(t)   # noqa: E731  'D.I.Y.' against 'DIY'
    body = r"[\s\-_.'’]*".join(tok(t) for t in toks)
    return re.compile(rf"(?<!\w){body}(?:['’]s|s['’]|['’])?(?!\w)")


def leaks(text: str, names=()) -> list[str]:
    """The names in ``names`` that ``text`` still carries (any case, any diacritics, bracketed, quoted or possessive)."""
    f = _fold(text)
    return [n for n in names if (r := _name_re(n)) and r.search(f)]


def assert_clean(texts, names=()) -> None:
    """The last gate before a web search: raise NameLeak when any of ``texts`` carries a scrubbed name. The message never repeats it."""
    for t in ([texts] if isinstance(texts, str) else texts):
        if leaks(t, names):
            raise NameLeak("a query bound for a web search carries a client, brand or rival name; it was not sent")


def proper_guard(text: str, market: str = "") -> str:
    """``text`` with every proper-noun-like word taken out unless it is a word of the market, a common word or a generic term: a capitalised
    word (not a sentence's first word that is a common word), an all-capitals word, a word with a capital inside (CamelCase) or a dotted
    acronym. The blocklist (``_names``) only knows the names the gist and the brief's name fields hold; a product or sub-brand named only
    in the brief's prose, and from there in a stage b claim, is caught here (an allowlist on what reaches the web)."""
    keep = set(_fold(market).split()) | GENERIC_TERMS | {d for k, ds in DEMONYMS.items() if k in _fold(market) for d in ds}
    common = _common()
    t = re.sub(r"\b(?:[A-Za-z]\.){2,}", lambda m: m.group(0).replace(".", ""), unicodedata.normalize("NFC", str(text or "")))   # D.I.Y. -> DIY

    def judge(m):
        w = m.group(0)
        f = _fold(_depossess(w))
        if not f or f in keep:
            return w
        if (w.isupper() and len(w) > 1) or re.search(r"[a-z][A-Z]", w):
            return " "   # an acronym or a CamelCase word: a brand shape
        if w[:1].isupper():
            return w if f in common else " "   # 'Households', 'Water' pass; 'Purrline' does not
        return w
    out = re.sub(r"\b[\w’'-]*[A-Za-z][\w’'-]*\b", judge, t)
    out = re.sub(r"[(\[{]\s*[)\]}]", " ", out)
    return " ".join(out.split()).strip(" ,;:.")


def scrub(text: str, names=()) -> str:
    """``text`` with every name in ``names`` (whole words, any case or diacritics, bracketed, quoted, possessive) and every figure
    removed: query material only."""
    t = unicodedata.normalize("NFC", str(text or ""))
    f = _fold(t)
    chars = list(t)
    for n in names:
        r = _name_re(n)
        for m in (r.finditer(f) if r else ()):
            chars[m.start():m.end()] = " " * (m.end() - m.start())
    t = "".join(chars)
    t = re.sub(r"[$€£]?\d[\d,.]*\s*%?", " ", t)   # a figure in the brief may be confidential (sales, budgets): never searched for
    t = re.sub(r"[(\[{]\s*[)\]}]|[\"“”«»]\s*[\"“”«»]|(?<!\w)['‘’]\s*['‘’](?!\w)", " ", t)   # the empty wrapper a name leaves behind
    return " ".join(t.split()).strip(" ,;:.")


def sanitise_gist(gist: dict, names=(), brief_object: dict | None = None) -> dict:
    """The gist a query may be built from: market, category, audience, problem and objective, with the client's and the rivals' names and
    every figure removed. The client name and the competitors themselves are dropped (they stay in the full gist for the planner's panel)."""
    nm = _names(gist or {}, names, brief_object)
    out = {}
    for k in ("market", "category", "audience", "problem", "objective"):
        raw = resolve_market(str((gist or {}).get("market") or ""), brief_object) if k == "market" else str((gist or {}).get(k) or "")
        v = scrub(raw, nm)
        out[k] = "" if v.lower() in _SKIP_GIST else v
    return out


def market_of(gist: dict, brief_object: dict | None = None) -> str:
    """The brief's market as one short phrase made of countries and regions only: the gist's market field validated against the country
    and region list (a category there is dropped), else the brief object's market or country fields; '' when none validates."""
    return resolve_market(str((gist or {}).get("market") or ""), brief_object)


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
    return [q for q in qs if not leaks(q["query"], names)]


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


def _evidence_track(sg: dict, claims: list[dict], queries: list[dict], names=()) -> list[dict]:
    """Live findings for the deck's claims, by one headless ``claude -p`` call with WebSearch when RESEARCH_WEB=claude; [] otherwise or on
    any failure. Normalised with normalise_finding, local ones first."""
    if os.environ.get("RESEARCH_WEB", "off").strip().lower() != "claude":
        return []
    try:   # the last gate: nothing from the brief that still carries a name is sent
        assert_clean([sg.get("market") or "", sg.get("category") or "", *(c["claim"] for c in claims), *(q["query"] for q in queries)], names)
    except NameLeak as e:
        print(f"[!] evidence track refused: {e}", file=sys.stderr)
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
    nm = _names(gist or {}, names, brief_object)
    sg = sanitise_gist(gist or {}, names, brief_object)
    sg["market"] = market_of(sg, brief_object)
    for k in ("category", "audience", "problem", "objective"):   # the allowlist guard: no proper noun the blocklist did not know
        sg[k] = proper_guard(sg.get(k) or "", sg["market"])
    claims = [{**c, "claim": proper_guard(c["claim"], sg["market"])} for c in deck_claims(brief_object, storyline, nm)]
    claims = [c for c in claims if c["claim"]]
    queries = build_queries(sg, claims, nm)
    for q in queries:
        q["query"] = proper_guard(q["query"], sg["market"]) or sg["market"] or "the market"
    findings = _evidence_track(sg, claims, queries, nm)
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
