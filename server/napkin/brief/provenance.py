"""Provenance: what each part of a planned brief rests on, worked out AFTER Dara wrote it
(brief-fact-provenance, the owner 2026-10-19).

Dara drafts as she always has. Then one cleaner, `clean_parts`, runs after every draft and every
rewrite (draft, review revise, the check loop's rewrite, fix_parts, EngineCheckedBriefJob):

  1. the value is split into sentence-sized claims; the must-tie spans of each (figures, dates,
     durations, prices; rules/derive.py) are found in code, and in a research or client part a
     sentence naming a brand is a claim too (the net);
  2. each claim is tied in code to the part's own cites (and, in a client part, to the client's
     words): every span a cited input states, or one worked out from them and recomputed here
     ("15 Oct 2026 - 5 Oct 2026 = 10 days");
  3. what is left goes to one `tie_claims` call, which names ids and a calc. A tie it names stands
     only when the code checks it span by span, the names in the sentence match the inputs'
     entities, and every input it names is used; otherwise the ids are only a suggestion;
  4. anything still untied is `to_confirm`, and its sentence goes to the decision's attention.

The owner's rule: a value is NEVER edited, reworded, stripped or rejected here, and nothing here
narrows what Dara sees. A worked-out conclusion is a claim like any other, tied to its inputs.
No claim's kind or verdict sends a part to a rewrite. The basis of a part follows from its
claims; "client" only when a capture item is mapped to the part (the client guard).

Evidence (`evidence`) is the one facts block the plan, the draft, every rewrite and the tie call
read: every pin the brief holds and may use (this job's new and kept pins first), each with the
quote and the source it was read from, the findings and the research upstream.
"""
from __future__ import annotations

import datetime as _dt
import itertools
import re

from .. import reasoning as rsn
from .. import runlog
from ..doc import ctx_data, ctx_facts, ctx_findings, ctx_sources
from ..rules import derive
from ..rules.quotes import contains_word
from ..util import slug
from . import capture as cap_stage
from . import fill as fill_stage
from .fields import ARRAY_KEYS, KEYS, clean

# The facts the plan, the draft and the judge read (every fact the brief holds, up to this many).
FACTS_MAX = 400
BASES = ("client", "research", "library", "assumption")
KINDS = ("fact", "derived", "client", "to_confirm")
PROMPT_TEXT_MAX = 4000

# The client guard's mapping (open question 5, the proposed table): beyond working_brief()'s captured
# parts, the drafted parts and the capture keys a client basis for them may rest on.
EXTRA_MAP = {
    "single_minded_proposition": ("key_message", "strategic_angle"),
    "reasons_to_believe": ("proof_points",),
    "insight": ("strategic_angle", "business_problem"),
    "desired_response.think": ("objective:attitudinal", "success_metrics"),
    "desired_response.feel": ("objective:attitudinal", "success_metrics"),
    "desired_response.do": ("objective:behavioural", "success_metrics"),
}
_GENERIC = {"the", "and", "group", "ireland", "irish", "mobile", "limited", "brand", "company", "store", "stores"}


# =============================================================================================
# What the document's own schemas allow
# =============================================================================================
def _resolve(schema: dict, node):
    for _ in range(4):
        if isinstance(node, dict) and isinstance(node.get("$ref"), str) and node["$ref"].startswith("#/"):
            cur = schema
            for part in node["$ref"][2:].split("/"):
                cur = cur.get(part) if isinstance(cur, dict) else None
            node = cur
        else:
            break
    return node if isinstance(node, dict) else {}


def doc_allows(clan: dict, what: str) -> bool:
    """Whether the document's embedded schema takes a write this feature adds. `prompt_text`: a
    material's `text` (an older brief's schema refuses it, and pack would refuse the document).
    `kept_pins`: a document-only pin. The host does not send the embedded facts schema, and both
    schemas are embedded together from one template version at creation, so a brief whose data
    schema takes the prompt's text holds the facts schema with the kept_in_document branch."""
    schema = clan.get("schema") if isinstance(clan.get("schema"), dict) else None
    if not schema or what not in ("prompt_text", "kept_pins"):
        return False
    mats = _resolve(schema, (schema.get("properties") or {}).get("materials"))
    item = _resolve(schema, mats.get("additionalProperties"))
    return "text" in (item.get("properties") or {})


# =============================================================================================
# Evidence: the facts block every call reads
# =============================================================================================
def held(clan: dict, new_pins=()) -> list:
    """Every fact the brief holds and may use: this job's new and kept pins first (so the cap never cuts
    them), then the document's (those carried from the research included); never one a person marked
    wrong, never one superseded."""
    excluded = {e.get("fact_id") for e in ((ctx_data(clan).get("selection") or {}).get("excluded") or [])
                if isinstance(e, dict)}
    seen, out = set(), []
    for f in list(new_pins) + list(ctx_facts(clan)):
        fid = f.get("id")
        if isinstance(fid, str) and fid not in seen and fid not in excluded and f.get("status") != "superseded":
            seen.add(fid)
            out.append(f)
    return out


def evidence(clan: dict, data0: dict, new_pins=(), new_sources=(), unpinned=()) -> dict:
    """The facts (each with its first quote, cut, and its source), the findings and the research
    upstream, as every call sees them; and, under `_`-keys the calls never get, the full pins, source
    records and findings the tie code reads (every quote of every source, whole)."""
    view = fill_stage.research_view(clan, data0)
    srcs = {**ctx_sources(clan), **{s["id"]: s for s in new_sources}}
    pins = held(clan, new_pins)[:FACTS_MAX]
    facts = []
    for f in pins:
        sid = next((s for s in f.get("sources") or [] if s in srcs), next(iter(f.get("sources") or []), None))
        s = srcs.get(sid) or {}
        q = next(iter((f.get("quotes") or {}).values()), None)
        facts.append({"id": f["id"], "entity": f.get("entity"), "key": f.get("key"), "value": f.get("value"),
                      "unit": f.get("unit"), "market": f.get("market"), "as_of": f.get("as_of"),
                      "quote": q[:240] if isinstance(q, str) else None,
                      "source": {k: s.get(k) for k in ("publisher", "title", "uri", "published_at") if s.get(k)}
                      or None})
    found = [x for x in ctx_findings(clan)
             if isinstance(x.get("id"), str) and x.get("status") not in ("rejected", "superseded")][:60]
    findings = [{"id": x["id"], "statement": x.get("statement"), "status": x.get("status")} for x in found]
    return {"facts": facts, "findings": findings, "research": view["research"],
            "_pins": {f["id"]: f for f in pins}, "_sources": srcs, "_findings": {x["id"]: x for x in found},
            "_unpinned": list(unpinned)}


def ev_ids(ev: dict) -> set:
    return {f["id"] for f in ev["facts"]} | {x["id"] for x in ev["findings"]}


# =============================================================================================
# The client's words
# =============================================================================================
class ClientWords:
    """The capture items (the document's data.capture.items and this job's), the named client and
    project, and the readable materials. `mapped(k)`: the capture items a client basis for part k
    may rest on (working_brief() and EXTRA_MAP)."""

    def __init__(self, items: dict, named: dict, mats: dict):
        self.items = {c: i for c, i in (items or {}).items() if isinstance(i, dict) and i.get("key")}
        self.named = named or {}
        self.mats = {m: t for m, t in (mats or {}).items() if isinstance(t, str) and t.strip()}
        self.wb = cap_stage.working_brief(self.items, self.named)

    def mapped(self, k: str) -> list:
        got = list((self.wb.get(k) or {}).get("caps") or [])
        for want in EXTRA_MAP.get(k, ()):
            key, _, otype = want.partition(":")
            got += [c for c, i in self.items.items() if i["key"] == key and (not otype or
                                                                            i.get("objective_type") == otype)]
        return list(dict.fromkeys(got))

    def named_mat(self, k: str, value=None) -> str | None:
        """The material that names the client or the project: the capture's, else a material whose text
        holds the value word for word."""
        if k not in ("client", "project_name"):
            return None
        if k in self.named and self.named[k].get("material_id"):
            return self.named[k]["material_id"]
        v = value if isinstance(value, str) else None
        return next((m for m, t in self.mats.items() if v and contains_word(t, v)), None)

    def mats_of(self, caps) -> list:
        return sorted({self.items[c]["material_id"] for c in caps if c in self.items
                       and self.items[c].get("material_id")})

    def text_of(self, cid: str) -> str:
        i = self.items.get(cid) or {}
        return str(i.get("quote") or i.get("value") or "")

    def payload(self) -> list:
        """The client's words with their ids, for Dara and the tie call."""
        return [{"id": c, "key": i["key"], "words": self.text_of(c)[:400], "status": i.get("status")}
                for c, i in list(self.items.items())[:120]]


def client_words(W: dict, capture: dict | None, mats) -> ClientWords:
    items = dict(((W.get("capture") or {}).get("items") or {}))
    items.update((capture or {}).get("items") or {})
    return ClientWords(items, (capture or {}).get("named") or {},
                       {m.id: m.text for m in mats or [] if getattr(m, "readable", False)})


# =============================================================================================
# Inputs: what a claim may rest on, read in full
# =============================================================================================
class Input:
    def __init__(self, iid, kind, texts, entity=None, confidence="medium", stale=False):
        self.id, self.kind, self.entity, self.confidence, self.stale = iid, kind, entity, confidence, stale
        self.texts = texts  # [(text, anchor date | None, relative dates trusted)]
        self.numbers, self.dates, self.durations = [], [], []
        for t, anchor, trusted in texts:
            self.numbers += derive.numbers(t)
            self.durations += [s.value for s in derive.durations_in(t)]
            for s in derive.dates_in(t, anchor):
                rel = bool(s.extra.get("relative"))
                self.dates.append((s.date, s.month_day, s.anchored and (trusted or not rel)))

    def all_text(self) -> str:
        return " ".join(t for t, _, _ in self.texts)


def _date(s):
    return derive.parse_iso(str(s)[:10]) if s else None


def pin_input(pin: dict, srcs: dict) -> Input:
    as_of = _date(pin.get("as_of"))
    texts = []
    v = pin.get("value")
    if isinstance(v, (int, float)) and not isinstance(v, bool):
        vt = derive.fmt_num(float(v))
    else:
        vt = str(v)
    texts.append((vt, as_of, False))
    for sid, q in (pin.get("quotes") or {}).items():
        if not isinstance(q, str):
            continue
        rec = srcs.get(sid) or {}
        pub = _date(rec.get("published_at"))
        # "today" in a quote is the day the page says it was published; a date the search service
        # guessed is not trusted for that (doc source records carry no basis: their date is the page's)
        trusted = pub is not None and rec.get("published_basis") in (None, "page_metadata")
        texts.append((q, pub or as_of, trusted))
    inp = Input(pin["id"], "pin", texts, entity=pin.get("entity"), confidence=pin.get("confidence") or "medium",
                stale=bool(pin.get("stale")))
    if isinstance(v, (int, float)) and not isinstance(v, bool):
        inp.numbers.append(float(v))
        if pin.get("unit") == "proportion":
            inp.numbers += [v * 100, float(round(v * 100))]
    if as_of:
        inp.numbers.append(float(as_of.year))
    if pin.get("unit") == "date" and _date(v):
        d = _date(v)
        inp.dates.append((d, (d.month, d.day), True))
    return inp


class Inputs:
    """Every input in the evidence and the client's words, built once per clean."""

    def __init__(self, ev: dict, client: ClientWords, lib: dict | None):
        self.ev, self.client, self.lib = ev, client, lib or {}
        self._cache = {}
        self.pins = ev.get("_pins") or {}
        self.srcs = ev.get("_sources") or {}
        self.findings = ev.get("_findings") or {}
        self.unpinned = {u["id"]: u for u in ev.get("_unpinned") or [] if isinstance(u, dict) and u.get("id")}

    def known(self) -> set:
        return set(self.pins) | set(self.findings) | set(self.client.items) | set(self.lib) | set(self.client.mats)

    def get(self, iid: str) -> Input | None:
        if iid in self._cache:
            return self._cache[iid]
        inp = None
        if iid in self.pins:
            inp = pin_input(self.pins[iid], self.srcs)
        elif iid in self.unpinned:
            inp = pin_input(self.unpinned[iid], self.srcs)
        elif iid in self.findings:
            f = self.findings[iid]
            inp = Input(iid, "finding", [(str(f.get("statement") or ""), None, False)],
                        confidence=f.get("confidence") or "medium")
        elif iid in self.client.items:
            inp = Input(iid, "cap", [(self.client.text_of(iid), None, False)])
        elif iid in self.client.mats:
            inp = Input(iid, "mat", [(self.client.mats[iid], None, False)])
        self._cache[iid] = inp
        return inp


# =============================================================================================
# Claims
# =============================================================================================
_SENT = re.compile(r"(?<=[.!?])[\"”’')]*\s+(?=[\"“‘'(]?[A-Z0-9€£$])")


def sentences(value) -> list[str]:
    """The value's sentence-sized claims, each verbatim in it: a list's items, each split into sentences."""
    items = value if isinstance(value, list) else [value]
    out = []
    for it in items:
        if not isinstance(it, str):
            continue
        pos = 0
        for m in list(_SENT.finditer(it)) + [None]:
            end = m.start() if m else len(it)
            s = it[pos:end].strip()
            if s:
                out.append(s)
            pos = m.end() if m else len(it)
    return out


def _entity_name(entity: str) -> tuple[str, str]:
    kind, _, rest = str(entity or "").partition("/")
    leaf = rest.split(".")[-1]
    return kind, re.sub(r"[-_.]+", " ", leaf).strip()


def _states_entity(text: str, inp) -> bool:
    """The sentence names the input pin's entity outright."""
    kind, name = _entity_name(inp.entity)
    return _names(text, name, long_only=kind == "category")


def _names(text: str, name: str, long_only=False) -> bool:
    if not name:
        return False
    if contains_word(text, name):
        return True
    toks = [t for t in name.split() if t.lower() not in _GENERIC and len(t) >= (5 if long_only else 4)]
    return bool(toks) and contains_word(text, toks[0])


class Brands:
    """The brands the brief knows: the plan's brand and competitors, and every brand or org a pin is about."""

    def __init__(self, brand: str | None, competitors, pins: dict):
        self.brand = (brand or "").strip()
        self.brand_entity = f"brand/{slug(self.brand)}" if self.brand and slug(self.brand) else None
        names = [self.brand] + [c for c in competitors or [] if isinstance(c, str)]
        for p in pins.values():
            kind, n = _entity_name(p.get("entity"))
            if kind in ("brand", "org") and n:
                names.append(n)
        self.names = [n for n in dict.fromkeys(x.strip() for x in names if x and x.strip())]

    def named_in(self, text: str) -> list[str]:
        return [n for n in self.names if _names(text, n)]

    def is_brief_brand(self, entity) -> bool:
        if not entity or not self.brand_entity:
            return False
        return slug(_entity_name(entity)[1]) == slug(self.brand) or entity == self.brand_entity

    def agrees(self, inp: Input, sentence: str) -> bool:
        """The sentence names what the input is about: the input's entity (or it is the brief's brand),
        or a brand its own words name."""
        if inp.kind in ("cap", "mat"):
            return True
        quoted = [n for n in self.names if _names(inp.all_text(), n)]
        if inp.kind == "finding":
            return not quoted or any(_names(sentence, n) for n in quoted)
        if self.is_brief_brand(inp.entity):
            return True
        kind, name = _entity_name(inp.entity)
        if _names(sentence, name, long_only=kind == "category"):
            return True
        return any(_names(sentence, n) for n in quoted)


# -- tying one claim to a set of inputs ---------------------------------------------------------
def _direct(span, inp: Input) -> bool:
    if span.kind in ("number", "price"):
        return derive.number_supported(span, inp.numbers)
    if span.kind == "duration":
        return span.value in inp.durations
    if span.kind == "date":
        return any(derive.same_date(span, d) for d, _, _ in inp.dates if d) or \
            (span.date is None and any(md == span.month_day for _, md, _ in inp.dates))
    return False


def _with_year(a, b):
    """Two input dates as full dates, a year-less one taking the other's year."""
    (da, mda, ta), (db, mdb, tb) = a, b
    if da is None and db is not None and mda:
        da = derive._safe_date(db.year, *mda)
    if db is None and da is not None and mdb:
        db = derive._safe_date(da.year, *mdb)
    return da, db, ta and tb


def _date_pairs(inps):
    out = []
    flat = [(inp.id, d) for inp in inps for d in inp.dates]
    for (ia, a), (ib, b) in itertools.combinations(flat, 2):
        da, db, trusted = _with_year(a, b)
        if da and db and da != db:
            out.append((ia, da, ib, db, trusted))
    return out


def _derive_span(span, inps, ops=("difference", "sum", "percent_change", "ratio")):
    """A working that gives the span from the inputs: {op, inputs, working, trusted}, or None."""
    if span.kind == "duration":
        for ia, da, ib, db, trusted in _date_pairs(inps):
            if derive.compute("days_between", [da, db]) == span.value:
                lo, hi = sorted([(da, ia), (db, ib)])
                return {"op": "days_between", "inputs": list(dict.fromkeys([lo[1], hi[1]])),
                        "working": f"{derive.fmt_date(hi[0])} - {derive.fmt_date(lo[0])} = "
                                   f"{derive.fmt_num(span.value)} days", "trusted": trusted}
        return None
    if span.kind not in ("number", "price"):
        return None
    flat = [(inp.id, x) for inp in inps for x in dict.fromkeys(inp.numbers) if not (1900 <= x <= 2100 and x == int(x))]
    for (ia, a), (ib, b) in itertools.permutations(flat[:60], 2):
        for op in ops:
            r = derive.compute(op, [a, b])
            if r is not None and derive.number_supported(span, [r]):
                sym = {"difference": "-", "sum": "+", "ratio": "/", "percent_change": "% change"}[op]
                w = (f"({derive.fmt_num(b)} - {derive.fmt_num(a)}) / {derive.fmt_num(a)} = {derive.fmt_num(round(r, 2))}%"
                     if op == "percent_change" else
                     f"{derive.fmt_num(a)} {sym} {derive.fmt_num(b)} = {derive.fmt_num(round(r, 4))}")
                return {"op": op, "inputs": list(dict.fromkeys([ia, ib])), "working": w, "trusted": True}
    return None


def tie(text: str, sp: list, inps: list, *, derive_ok=True) -> dict | None:
    """The claim tied to `inps` in code: every span stated by an input, or worked out from them.
    -> {kind: fact|client|derived, cites, working?, calc?, check?} or None."""
    if not inps:
        return None
    if not sp:
        return None
    cites, derived = [], None
    for s in sp:
        sup = [i for i in inps if _direct(s, i)]
        if sup:
            pick = next((i for i in sup if i.id in cites), sup[0])
            cites.append(pick.id)
            continue
        if not derive_ok or derived is not None:
            return None
        d = _derive_span(s, inps)
        if d is None:
            return None
        derived = {**d, "span": s.text}
        cites += d["inputs"]
    cites = list(dict.fromkeys(cites))
    if derived:
        return {"kind": "derived", "cites": cites, "working": derived["working"],
                "calc": {"op": derived["op"], "inputs": derived["inputs"], "result": derived["span"]},
                "check": "recomputed" if derived["trusted"] else "stated"}
    by = {i.id: i for i in inps}
    kind = "client" if all(by[c].kind in ("cap", "mat") for c in cites) else "fact"
    return {"kind": kind, "cites": cites}


def _recompute(op, ids, span, IN: Inputs) -> tuple[str, str | None]:
    """A named calc, recomputed: ("recomputed" | "false" | "stated", working)."""
    inps = [IN.get(i) for i in ids]
    if not op or op not in derive.OPS or any(i is None for i in inps):
        return "stated", None
    if op == "days_between" and span.kind == "duration":
        if len(inps) == 1:
            pairs = _date_pairs(inps)
        elif len(inps) == 2:
            pairs = [p for p in _date_pairs(inps) if {p[0], p[2]} == {inps[0].id, inps[1].id}]
        else:
            pairs = []
        if not pairs:
            return "stated", None
        best = None
        for ia, da, ib, db, trusted in pairs:
            r = derive.compute("days_between", [da, db])
            lo, hi = sorted([da, db])
            w = f"{derive.fmt_date(hi)} - {derive.fmt_date(lo)} = {derive.fmt_num(r)} days"
            if r == span.value:
                return ("recomputed" if trusted else "stated"), w
            best = best or ((("stated" if not trusted else "false"), w))
        return best
    if span.kind in ("number", "price"):
        d = _derive_span(span, inps, ops=(op,) if op in ("difference", "sum", "ratio", "percent_change") else ())
        if d:
            return "recomputed", d["working"]
        nums = [x for i in inps for x in i.numbers]
        return ("false" if nums else "stated"), None
    return "stated", None


# =============================================================================================
# The tie call
# =============================================================================================
TIE_SYSTEM = """You link each sentence of a creative brief to what it rests on. You get the sentences (each
with its part and number) and what the writer had: the facts (ids f_..., each with its value, the quote it
was read from and its source), the findings (fi_...) and the client's own words (cap_...).

For each sentence, name in `cites` the ids it rests on. When it states something no single fact states but
that follows from several (the days between two dates, a difference, a total, a ratio, a change in
percent), give the calc: its op and, in order, the ids of its inputs. Name only ids given to you, and name
nothing for a sentence nothing given supports. Never rewrite a sentence."""


def tie_schema(keys) -> dict:
    s = {"type": "string"}
    return {"type": "object", "additionalProperties": False, "required": ["ties"], "properties": {"ties": {
        "type": "array", "items": {"type": "object", "additionalProperties": False,
                                   "required": ["part", "n", "cites", "calc"], "properties": {
                                       "part": {"type": "string", "enum": list(keys)}, "n": {"type": "integer"},
                                       "cites": {"type": "array", "items": s},
                                       "calc": {"anyOf": [{"type": "null"}, {
                                           "type": "object", "additionalProperties": False,
                                           "required": ["op", "inputs"], "properties": {
                                               "op": {"type": "string", "enum": list(derive.OPS)},
                                               "inputs": {"type": "array", "items": s}}}]}}}}}}


# =============================================================================================
# The cleaner
# =============================================================================================
class Ctx:
    """What the cleaner reads: the evidence, the client's words, the library, the plan's brand and
    competitors, the model (for the tie call) and the run log."""

    def __init__(self, ev, client: ClientWords, lib=None, brand=None, competitors=(), model=None, rl=None):
        self.ev, self.client, self.lib = ev, client, lib or {}
        self.brand, self.competitors = brand, list(competitors or [])
        self.model, self.rl = model, rl or runlog.NULL


def _short(s, n=200):
    s = " ".join(str(s or "").split())
    return s if len(s) <= n else s[:n - 1] + "…"


def _value_text(v) -> str:
    return "\n".join(v) if isinstance(v, list) else str(v or "")


def _certainty(claims: list, IN: Inputs) -> tuple[str, str]:
    """campaign-clan §6.1, per claim, then the lowest: a fact or worked-out claim takes the lowest
    confidence among its pins, one level lower for a single pin or a stale one; a working that recomputes
    adds nothing, one only stated is a level lower, one that does not recompute is low. The client's words
    take capture_certainty. A claim to confirm is low."""
    levels, whys = [], []
    for c in claims:
        if c["kind"] == "to_confirm":
            levels.append("low")
            whys.append("a claim nothing given supports, to confirm")
            continue
        if c.get("check") == "false":
            levels.append("low")
            whys.append("a figure that does not match what it cites")
            continue
        if c["kind"] == "client":
            caps = [x for x in c["cites"] if x in IN.client.items]
            levels.append(cap_stage.capture_certainty(IN.client.items, caps, {})[0])
            continue
        inps = [IN.get(x) for x in c["cites"]]
        conf = [i.confidence for i in inps if i is not None and i.kind in ("pin", "finding")]
        caps = [i.id for i in inps if i is not None and i.kind == "cap"]
        if caps:
            conf.append(cap_stage.capture_certainty(IN.client.items, caps, {})[0])
        lvl = rsn.lowest(conf, default="medium")
        if len([i for i in inps if i is not None and i.kind == "pin"]) == 1 and not caps or \
                any(i.stale for i in inps if i is not None):
            lvl = rsn.step_down(lvl)
        if c.get("check") == "stated":
            lvl = rsn.step_down(lvl)
        levels.append(lvl)
    if not levels:
        return None, None
    lvl = rsn.lowest(levels)
    why = next((w for l, w in zip(levels, whys + [None] * len(levels)) if l == lvl and w), None) or \
        "the facts its claims rest on, by their sources (campaign-clan §6.1)"
    return lvl, why


def clean_parts(out: dict, ctx: Ctx, *, stage: str, keys=None, prior: dict | None = None,
                says: dict | None = None) -> dict:
    """Dara's parts as written, each with what it rests on: {key: {value, basis, cites, builds_on_client,
    why, claims, downgraded, certainty, basis_said}}. `prior`: each part's claims before this rewrite
    (counted, never restored). `says`: what each part should say (for the log only). The values are
    never edited (asserted)."""
    IN = Inputs(ctx.ev, ctx.client, ctx.lib)
    brands = Brands(ctx.brand, ctx.competitors, IN.pins)
    known = IN.known()
    res, notes, ask = {}, {}, []
    for k, r in (out or {}).items():
        if k not in KEYS or (keys is not None and k not in keys) or not isinstance(r, dict):
            continue
        v = clean(k, r.get("value"))
        if v is None:
            continue
        said = r.get("basis") if r.get("basis") in BASES else "assumption"
        raw_cites = [c for c in dict.fromkeys(r.get("cites") or []) if isinstance(c, str)]
        cites = [c for c in raw_cites if c in known]
        dropped = [c for c in raw_cites if c not in known]
        mapped = ctx.client.mapped(k)
        named = ctx.client.named_mat(k, v)
        claims = []
        if k != "open_questions":
            for t in sentences(v):
                sp = derive.spans(t)
                ents = brands.named_in(t)
                if sp or (ents and said in ("research", "client")):
                    claims.append({"text": t, "_spans": sp, "_ents": ents})
        own = [IN.get(c) for c in cites if c not in ctx.lib]
        own = [i for i in own if i is not None]
        if said == "client":
            own += [IN.get(c) for c in list(IN.client.items) + ([named] if named else []) if c not in cites]
            own = [i for i in own if i is not None]
        for c in claims:
            got = tie(c["text"], c["_spans"], own) if c["_spans"] else None
            if got is None and not c["_spans"]:
                agree = [i.id for i in own if i.kind == "pin" and _states_entity(c["text"], i)][:3]
                if agree:
                    got = {"kind": "fact", "cites": agree}
            if got:
                c.update(got, by="match")
            else:
                ask.append((k, c))
        res[k] = {"value": v, "basis_said": said, "cites": cites, "claims": claims, "mapped": mapped,
                  "named": named, "builds_on_client": bool(r.get("builds_on_client")),
                  "why": _short(r.get("why"), 300)}
        notes[k] = {"dropped_cites": len(dropped)}
    # -- the tie call, for what code alone could not tie -------------------------------------------------
    tie_call = "skipped"
    named_by = {}
    if ask and ctx.model is not None:
        idx = {}
        sents = []
        for k, c in ask:
            n = len([x for x in sents if x["part"] == k])
            idx[(k, n)] = c
            sents.append({"part": k, "n": n, "text": c["text"]})
        payload = {"sentences": sents, "facts": ctx.ev.get("facts") or [], "findings": ctx.ev.get("findings") or [],
                   "client_words": ctx.client.payload()}
        try:
            got = ctx.model.structured("tie_claims", TIE_SYSTEM, payload,
                                       tie_schema(sorted({s["part"] for s in sents})), max_tokens=4000)
            for t in got.get("ties") or []:
                c = idx.get((t.get("part"), t.get("n")))
                if c is not None:
                    named_by[id(c)] = t
            tie_call = "ok"
        except Exception as e:  # noqa: BLE001 - tying never stops a draft; what is untied is to confirm
            tie_call = "failed"
            ctx.rl.note("tie_failed", stage=stage, error=f"{type(e).__name__}: {str(e)[:160]}")
    for k, c in ask:
        t = named_by.get(id(c))
        ids = [i for i in dict.fromkeys((t or {}).get("cites") or []) if i in known and i not in ctx.lib]
        calc = (t or {}).get("calc") or None
        if calc:
            ids = list(dict.fromkeys(ids + [i for i in calc.get("inputs") or [] if i in known and i not in ctx.lib]))
        inps = [IN.get(i) for i in ids]
        inps = [i for i in inps if i is not None]
        agree = bool(inps) and all(brands.agrees(i, c["text"]) for i in inps)
        done = None
        if agree and c["_spans"]:
            got = tie(c["text"], c["_spans"], inps)
            if got and set(got["cites"]) == {i.id for i in inps}:
                done = got  # every input it named is used
            elif calc and calc.get("op"):
                # the named calc, recomputed here; the rest of the sentence stated by the inputs
                rest = [x for x in c["_spans"] if not any(_direct(x, i) for i in inps)]
                order = [i for i in calc.get("inputs") or [] if i in ids]
                if len(rest) == 1 and order:
                    check, w = _recompute(calc["op"], order, rest[0], IN)
                    done = {"kind": "derived", "cites": [i.id for i in inps], "check": check,
                            "calc": {"op": calc["op"], "inputs": order, "result": rest[0].text},
                            **({"working": w} if w else {})}
            elif t:
                # named inputs, no calc: a worked-out claim whose working is only stated (a level lower)
                rest = [x for x in c["_spans"] if not any(_direct(x, i) for i in inps)]
                if len(rest) == 1 and rest[0].kind in ("duration", "number", "price"):
                    done = {"kind": "derived", "cites": [i.id for i in inps], "check": "stated"}
        elif agree:
            done = {"kind": "fact", "cites": [i.id for i in inps]}
        if done is None and any(x.kind in ("number", "price") and not any(_direct(x, i) for i in inps)
                                for x in c["_spans"]):
            # what the call named (or the part cites) is about what the sentence names, but a figure is not
            # in it: the claim stands on it, flagged to check
            cand = inps or [IN.get(x) for x in res[k]["cites"]]
            near = [i.id for i in cand if i is not None and i.kind == "pin" and _states_entity(c["text"], i)][:3]
            if near:
                done = {"kind": "fact", "cites": near, "check": "false"}
        if done:
            c.update(done, by="model" if t else "match")
        else:
            c.update(kind="to_confirm", cites=[], by="net" if not c["_spans"] else ("model" if t else "match"),
                     suggest=_suggest(c, IN, brands, ids))
    # -- basis, the client guard, and the record ------------------------------------------------------
    for k, p in res.items():
        claims = p["claims"]
        kinds = {c["kind"] for c in claims}
        tied = [x for c in claims if c["kind"] != "to_confirm" for x in c["cites"]]
        valid = [c for c in p["cites"] if c in IN.pins or c in IN.findings]
        psg = [c for c in p["cites"] if c in ctx.lib]
        said = p["basis_said"]
        client_ok = bool(p["mapped"]) or bool(p["named"])
        corrected = None
        if said == "client" and client_ok:
            basis = "client"
        elif "fact" in kinds or "derived" in kinds or (said in ("research", "client") and valid):
            basis = "research"
        elif said in ("library", "client", "research") and psg:
            basis = "library"
        else:
            basis = "assumption"
        if said == "client" and basis != "client":
            corrected = basis
            ctx.rl.note("basis_corrected", part=k, said="client", now=basis, stage=stage)
        boc = p["builds_on_client"] and bool(p["mapped"])
        cites = list(dict.fromkeys(p["cites"] + tied + (p["mapped"] if basis == "client" else [])
                                   + ([p["named"]] if basis == "client" and p["named"] else [])
                                   + (p["mapped"] if boc else [])))
        if basis == "assumption":
            cites = [c for c in cites if c in tied]
        lvl, why = _certainty(claims, IN)
        if basis == "client" and not any(c["kind"] != "client" for c in claims):
            lvl, why = cap_stage.capture_certainty(IN.client.items, p["mapped"], {})
        elif basis == "assumption" and lvl is None:
            lvl, why = "low", "a planner's assumption, for the agency to confirm with the client"
        elif lvl is None:
            lvl, why = "medium", "rests on the facts and passages it cites"
        if basis == "assumption":
            lvl = "low"
            why = why if any(c["kind"] == "to_confirm" for c in claims) else \
                "a planner's assumption, for the agency to confirm with the client"
        public = [{x: c[x] for x in ("text", "kind", "cites", "working", "calc", "check", "by", "suggest")
                   if c.get(x) not in (None, [], "") or x == "cites"} for c in claims]
        for c in public:
            assert c["text"] in _value_text(p["value"]), "a claim is the value's own words"
        lost = 0
        if prior and prior.get(k):
            now = {c.get("working") or c["text"] for c in public if c["kind"] == "derived"}
            lost = sum(1 for c in prior[k] if c.get("kind") == "derived" and (c.get("working") or c.get("text"))
                       not in now)
        res[k] = {"value": p["value"], "basis": basis, "basis_said": said, "cites": cites, "builds_on_client": boc,
                  "why": p["why"], "claims": public, "downgraded": said in ("research", "library") and
                  basis == "assumption", "certainty": (lvl, why), "mapped": p["mapped"], "named": p["named"],
                  "corrected": corrected}
        assert res[k]["value"] == clean(k, (out[k] or {}).get("value")), "the cleaner never edits a value"
        notes[k].update(basis_said=said, basis=basis,
                        claims=[{"n": i, "kind": c["kind"], "rests_on": c["cites"] or "none", "by": c.get("by"),
                                 "check": c.get("check"), "suggest": c.get("suggest")} for i, c in enumerate(public)],
                        to_confirm=sum(1 for c in public if c["kind"] == "to_confirm"),
                        missed=sum(1 for c in public if c["kind"] == "to_confirm" and c.get("by") == "net"),
                        derived_lost=lost,
                        **({"builds_on_client_dropped": True} if p["builds_on_client"] and not boc else {}))
    ctx.rl.note("provenance", stage=stage, parts=notes, tie_call=tie_call if ask else "skipped")
    return res


def _suggest(c, IN: Inputs, brands: Brands, named) -> list:
    """Inputs that would support a claim to confirm, for a person to look at: never its cites."""
    out = list(named)
    sp = c["_spans"]
    if sp:
        pins = [IN.get(i) for i in list(IN.pins)[:150] + list(IN.unpinned)]
        pins = [i for i in pins if i is not None]
        for s in sp:
            sup = [i.id for i in pins if _direct(s, i)][:2]
            out += sup
            if not sup and s.kind == "duration":
                withdates = [i for i in pins if i.dates][:80]
                d = _derive_span(s, withdates)
                if d:
                    out += d["inputs"]
        for m, t in IN.client.mats.items():
            if any(s.kind in ("number", "price") and s.text in t for s in sp):
                out.append(m)
    else:
        out += [pid for pid, p in list(IN.pins.items())[:150]
                if _entity_name(p.get("entity"))[0] in ("brand", "org")
                and _names(c["text"], _entity_name(p.get("entity"))[1])][:2]
    return list(dict.fromkeys(out))[:4]


# =============================================================================================
# Reasoning from the claims
# =============================================================================================
def because(v: dict, client: ClientWords, *, extra_attention=(), writer_note=None) -> tuple[list, dict, str | None]:
    """(because points, certainty, attention) for a cleaned part. Client points cite the capture items
    and their materials; fact and worked-out points cite their inputs. An assumption's why and every
    claim to confirm go to attention, never into an uncited point."""
    pts, attn = [], []
    claims = v.get("claims") or []
    basis = v["basis"]
    if basis == "client":
        caps = list(v.get("mapped") or [])
        cite = caps + client.mats_of(caps) + ([v["named"]] if v.get("named") else [])
        pts.append(rsn.point(f"The client's words, written out: {_short(v['why'], 240)}", cite))
    for c in claims:
        if c["kind"] == "derived" and c.get("working"):
            pts.append(rsn.point(f"Worked out: {c['working']}", c["cites"]))
        elif c["kind"] == "derived":
            pts.append(rsn.point(f"Worked out from {len(c['cites'])} fact(s): {_short(c['text'], 200)}", c["cites"]))
        elif c["kind"] == "fact" and not c.get("check"):
            pts.append(rsn.point(f"From the facts: {_short(c['text'], 200)}", c["cites"]))
        elif c["kind"] == "client" and basis != "client":
            pts.append(rsn.point(f"The client wrote it: {_short(c['text'], 200)}",
                                 c["cites"] + client.mats_of(c["cites"])))
    if basis in ("research", "library"):
        pts.append(rsn.point(_short(v["why"], 260) or "Rests on what it cites", v["cites"]))
    if basis == "assumption":
        pts.append(rsn.point("A planner's proposal, for the agency to confirm with the client"))
    if v.get("builds_on_client"):
        caps = list(v.get("mapped") or [])
        pts.append(rsn.point("It builds on what the client wrote", caps + client.mats_of(caps)))
    if writer_note:
        pts.append(writer_note)
    tc = [c for c in claims if c["kind"] == "to_confirm"]
    if tc:
        attn.append("To confirm: " + " ".join(_short(c["text"], 160) for c in tc[:4]))
    for c in claims:
        if c.get("check") == "false":
            attn.append(f"Check the working: {c['working']}, but the part says “{_short(c['text'], 120)}”."
                        if c.get("working") else f"Check: “{_short(c['text'], 160)}” is not what its fact says.")
    attn += [a for a in extra_attention if a]
    if basis == "assumption" and v.get("why"):
        attn.append(f"Assumed: {_short(v['why'], 260)}")
    # a point that states a figure and cites nothing goes to attention, never borrows a cite
    keep = []
    for p in pts:
        if not p.get("cites") and rsn.states_figure(p["point"]):
            attn.append(p["point"])
        else:
            keep.append(p)
    if not keep:
        keep = [rsn.point("Rests on what it cites" if v["cites"] else "A planner's proposal")]
    lvl, why = v.get("certainty") or ("low", "a planner's proposal")
    return keep, rsn.certainty(lvl, why), " ".join(attn) or None


def code_verdicts(parts: dict) -> list:
    """The claim verdicts code derives, in the review's claim shape: a claim to confirm is unsupported, a
    figure not in what it cites is partly, a recomputed working is supported. They lower certainty and add
    to attention only; none sends a part to a rewrite."""
    out = []
    for k, v in parts.items():
        for c in v.get("claims") or []:
            verdict = ("unsupported" if c["kind"] == "to_confirm" else "partly" if c.get("check") == "false"
                       else "supported" if c["kind"] == "derived" and c.get("check") == "recomputed" else None)
            if verdict:
                out.append({"part": k, "claim": c["text"], "cite": ", ".join(c["cites"]), "verdict": verdict,
                            "note": {"unsupported": "nothing given supports it: to confirm",
                                     "partly": "a figure is not what its fact says",
                                     "supported": f"worked out: {c.get('working') or ''}"}[verdict], "by": "code"})
    return out


def judge_claims(parts: dict, rv_claims: list) -> list:
    """Jude's claim verdicts, with code's: a verdict on a worked-out claim that recomputes is supported
    whatever Jude says (he grades the working, never the literal words); code's verdicts are added."""
    out = []
    for c in rv_claims or []:
        part = parts.get(c.get("part")) or {}
        txt = str(c.get("claim") or "").lower()
        figs = {s.text.lower() for s in derive.spans(txt)}
        hit = next((x for x in part.get("claims") or [] if x["kind"] == "derived" and x.get("check") == "recomputed"
                    and txt and (txt in x["text"].lower() or (figs and figs <= {s.text.lower() for s in
                                                                                 derive.spans(x["text"].lower())}))),
                   None)
        out.append({**c, "verdict": "supported", "note": f"worked out: {hit.get('working')}"} if hit else c)
    return out + code_verdicts(parts)


def prior_claims(chain: list, doc: str, keys) -> dict:
    """The claims of the decision that last wrote each part (the chain newest first)."""
    from .fields import wrote
    out = {}
    for k in keys:
        d = next((d for d in chain if d.get("kind") in ("edit", "resolve") and d.get("action") != "propose"
                  and wrote(d, doc, k)), None)
        if d and isinstance(d.get("claims"), list):
            out[k] = d["claims"]
    return out


def brief_entry(v: dict) -> dict:
    """A cleaned part as a judge or a rewrite reads it."""
    return {"value": v["value"], "basis": v["basis"], "cites": v["cites"],
            "claims": [{x: c[x] for x in ("text", "kind", "cites", "working") if x in c} for c in v.get("claims") or []]}


def today() -> _dt.date:
    return _dt.date.today()
