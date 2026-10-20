"""Intake: what a deck was built from, what it cannot ground, and the a0 stage's output (ADR 0028).

The Deck stands alone: a prompt of any length plus any documents build a deck, and a brief or the
research tool's output make it stronger. This module is plain code, no model:

``tier(inp)``         the ``built_from`` record: ``{tier, documents, brief, research}``
``gap_report(inp)``   which brief fields are empty or only proposed, which slide types have no
                      evidence. Computed here, never by the model (the model writes fields and questions)
``validate_a0(obj)``  checks an ``a0_intake.json`` against the shared contract (at most 5 questions)
``apply_a0(inp, a0)`` puts the stage's fields into the brief where it is empty, never over a field the
                      brief supplies, and drops a field whose figures are in none of the inputs

``infer_type(...)``    which deck type the inputs point at, from quoted words, in code (deck types: features/deck-maker-intake.clan)
``type_question(...)`` the question card 'What kind of deck is this?', always the first of a0's questions
``chosen_type(inp)``   the deck type an answer, a flag or the stated default selects

The ladder is check (this module and the a0 stage), ask (the app puts the questions to the person)
and strengthen (the app asks whether to launch the Research Tool). The engine never launches research.
"""
from __future__ import annotations

import hashlib
import json
import re

from . import profiles, spec
from .inputs import BRIEF_FIELDS
from .refs import Resolver, answer_text, numbers_in

#: ``kind`` values an a0 field may carry (the shared contract).
A0_KINDS = ("prompt", "document", "research", "proposal")
#: At most this many questions, each skippable.
MAX_QUESTIONS = 5
#: Documents carry [pN] locators; those digits are not figures.
_LOCATOR = re.compile(r"\[p\d+\]")


#: Forms that make a legal or regulatory line: they may appear in a field only if an input says them.
#: An ordinary word is not one: 'limited' alone ("limited to"), 'act' alone, 'authority' alone and 'commission'
#: alone pass. A company form needs a capitalised name before it ("Fernley Drinks Limited", "Acme Inc"), and so
#: does an Act, an Authority or a Commission ("Companies Act 2014", "Data Protection Commission"). The distinct
#: tokens (Ltd, plc, DAC, LLC, GmbH, GDPR, the Central Bank, regulated, licence, trademark, copyright) are legal alone.
_NAME = r"[A-Z][A-Za-z&'-]+"
_LEGAL = re.compile(
    rf"\b{_NAME}(?: {_NAME})* (?:Limited|Inc|Act|Authority|Commission)\b(?: \d{{4}}\b)?"
    r"|(?i:\b(?:ltd|plc|dac|llc|gmbh|regulat\w*|licen[cs]\w*|trademark|copyright|gdpr|the central bank)\b)")
_CAPS = re.compile(r"\b[A-Z][A-Za-z&'-]{2,}\b")


def _figures(text) -> set:
    """Figures in a text: years (1900-2100), 0 and 1 are not figures."""
    return {n for n in numbers_in(text) if n not in (0.0, 1.0) and not (n.is_integer() and 1900 <= n <= 2100)}


def _rejected_facts(inp) -> set:
    """Pin ids a person rejected, plus the pins cited by findings they rejected."""
    out = set(inp.rejected_pins)
    for f in inp.findings.values():
        if f.get("status") == "rejected":
            out |= {r for r in f.get("fact_refs") or [] if isinstance(r, str)}
    return out


def _haystack(inp, given: dict) -> str:
    """Lower-cased text of everything the person gave (prompt, answers, documents, usable research, the
    brief's own values): the only place a name or legal line may come from."""
    bad = _rejected_facts(inp)
    parts = [inp.prompt_text] + [answer_text(inp, q) for q in inp.answers] + [d["text"] for d in inp.docs.values()]
    parts += [json.dumps(f, ensure_ascii=False, default=str) for k, f in inp.facts.items() if k not in bad]
    parts += [json.dumps(f, ensure_ascii=False, default=str) for f in inp.doc_facts.values()]
    parts += [str(f.get("statement")) for f in inp.findings.values() if f.get("status") != "rejected"]
    parts += [json.dumps(f["value"], ensure_ascii=False, default=str) for f in given.values() if f.get("value") is not None]
    return " ".join(str(p) for p in parts).lower()


def _untraced_names(value, hay: str) -> list:
    """Names and legal words in a field value that no input says. A capitalised word that is not the
    first of its sentence is a name; a legal word (Ltd, regulated, Act, ...) is a legal line."""
    text = json.dumps(value, ensure_ascii=False, default=str) if not isinstance(value, str) else value
    out = []
    for m in _LEGAL.finditer(text):
        if m.group(0).lower() not in hay:
            out.append(m.group(0))
    for m in _CAPS.finditer(text):
        before = text[:m.start()].rstrip()
        if not before or before[-1] in ".!?:\n\"[{" or before.endswith(("\\n",)):
            continue   # the first word of a sentence is capitalised by grammar, not by being a name
        if m.group(0).lower() not in hay:
            out.append(m.group(0))
    return sorted(set(out))


def _empty(v) -> bool:
    """True for a value nothing was written in: None, a blank string, an empty list or dict."""
    return v is None or (isinstance(v, (str, list, dict)) and not v)


def tier(inp) -> dict:
    """What the deck is built from: ``{tier, documents, brief, research}``. ``tier`` is ``brief+research``,
    ``brief``, ``research``, ``prompt+documents`` or ``prompt``, the strongest input present. A field
    an intake stage filled does not make a brief."""
    brief, research = inp.has_brief(), inp.has_research()
    docs = [d.get("name") or k for k, d in inp.docs.items()]
    if brief and research:
        t = "brief+research"
    elif brief:
        t = "brief"
    elif research:
        t = "research"
    elif docs:
        t = "prompt+documents"
    else:
        t = "prompt"
    return {"tier": t, "documents": docs, "brief": brief, "research": research}


def _figure_numbers(inp, fields: dict) -> set:
    """Every figure the inputs state: prompt, answers, documents, research, and brief values given
    as fact (not proposed). Years and 0/1 are not figures."""
    nums = numbers_in(inp.prompt_text)
    for qid in inp.answers:
        nums |= numbers_in(answer_text(inp, qid))
    for d in inp.docs.values():
        nums |= numbers_in(_LOCATOR.sub(" ", d["text"]))
    bad = _rejected_facts(inp)
    for k, f in list(inp.facts.items()) + list(inp.doc_facts.items()):
        if k not in bad:   # a pin a person rejected is never evidence
            nums |= numbers_in(json.dumps(f, ensure_ascii=False, default=str))
    for f in inp.findings.values():
        if f.get("status") != "rejected":
            nums |= numbers_in(f.get("statement"))
    for f in fields.values():
        if f["value"] is not None and f["kind"] != "proposal":
            nums |= numbers_in(json.dumps(f["value"], ensure_ascii=False, default=str))
    return {n for n in nums if n not in (0.0, 1.0) and not (n.is_integer() and 1900 <= n <= 2100)}


def _effective(inp, a0: dict | None) -> dict:
    """The brief as it stands (and as it would stand with ``a0`` applied): field id -> {value, kind}."""
    out = {}
    for fid in BRIEF_FIELDS:
        f = inp.brief.get(fid) or {}
        out[fid] = {"value": f.get("value"), "kind": f.get("kind")}
    for fid, f in ((a0 or {}).get("fields") or {}).items():
        if fid in out and (_empty(out[fid]["value"]) or (inp.brief.get(fid) or {}).get("kind") == "proposal") and not _empty(f.get("value")):
            out[fid] = {"value": f["value"], "kind": f.get("kind")}
    return out


#: Evidence tests named by spec.SLIDE_EVIDENCE: each takes (inp, effective fields, figure numbers).
HAS = {
    "figure": lambda inp, eff, nums: bool(nums),
    "audience": lambda inp, eff, nums: not _empty(eff["audience"]["value"]) and eff["audience"]["kind"] != "proposal",
    "competitor": lambda inp, eff, nums: not _empty(eff["competitor_context"]["value"]) and eff["competitor_context"]["kind"] != "proposal",
    "budget": lambda inp, eff, nums: not _empty(eff["budget_scope"]["value"]) and eff["budget_scope"]["kind"] != "proposal",
}


def gap_report(inp, a0: dict | None = None, kind: str = "agency") -> dict:
    """What the inputs cannot ground, computed in code: ``brief_fields`` (a field empty, or filled only
    by proposal) and ``slide_types`` (a slide type with no evidence, by spec.SLIDE_EVIDENCE: no
    figure for a measurement slide, no audience evidence for an audience slide). ``a0`` (a stage
    output) is read as if applied, so the report says what is left once it has filled what it can;
    ``kind`` is the deck kind (agency or investor)."""
    eff = _effective(inp, a0)
    fields = []
    for fid in BRIEF_FIELDS:
        v, k = eff[fid]["value"], eff[fid]["kind"]
        if _empty(v):
            fields.append({"field": fid, "why": "empty: nothing the person gave states it"})
        elif k == "proposal":
            fields.append({"field": fid, "why": "filled only by proposal: nothing the person gave supports it"})
    nums = _figure_numbers(inp, eff)
    types = [{"type": t, "why": why} for t, (need, why) in spec.SLIDE_EVIDENCE.get(kind, {}).items()
             if not HAS[need](inp, eff, nums)]
    return {"brief_fields": fields, "slide_types": types}


def validate_a0(obj) -> list:
    """Errors in an ``a0_intake.json`` against the shared contract; an empty list means valid.
    Fields are brief field ids with ``value``, ``kind`` (prompt, document, research or proposal) and
    ``refs``; ``abstained`` lists field ids that no field also fills; ``gaps`` holds ``brief_fields`` and
    ``slide_types``; ``questions`` are at most five, each with an id (``q_...``), text, options
    (id, label, value), ``allow_text`` and an ``address`` (``brief.<field>``)."""
    errs = []
    if not isinstance(obj, dict):
        return ["a0 is not an object"]
    if obj.get("stage") != "a0_intake":
        errs.append("stage must be 'a0_intake'")
    if not isinstance(obj.get("produced_by"), str):
        errs.append("produced_by must be a string")
    fields = obj.get("fields")
    if not isinstance(fields, dict):
        errs.append("fields must be an object")
        fields = {}
    for fid, f in fields.items():
        if fid not in BRIEF_FIELDS:
            errs.append(f"fields.{fid}: not a brief field")
        if not isinstance(f, dict) or "value" not in f:
            errs.append(f"fields.{fid}: needs a value")
            continue
        if f.get("kind") not in A0_KINDS:
            errs.append(f"fields.{fid}: kind must be one of {', '.join(A0_KINDS)}")
        if not isinstance(f.get("refs"), list) or not all(isinstance(r, str) for r in f["refs"]):
            errs.append(f"fields.{fid}: refs must be a list of strings")
    ab = obj.get("abstained")
    if not isinstance(ab, list) or not all(isinstance(x, str) for x in ab):
        errs.append("abstained must be a list of brief field ids")
    else:
        errs += [f"abstained.{x}: not a brief field" for x in ab if x not in BRIEF_FIELDS]
        errs += [f"{x} is both filled and abstained" for x in ab if x in fields]
    gaps = obj.get("gaps")
    if not isinstance(gaps, dict) or not isinstance(gaps.get("brief_fields"), list) or not isinstance(gaps.get("slide_types"), list):
        errs.append("gaps must hold brief_fields and slide_types lists")
    else:
        errs += [f"gaps.brief_fields: {g!r} needs field and why" for g in gaps["brief_fields"] if not (isinstance(g, dict) and g.get("field") and g.get("why"))]
        errs += [f"gaps.slide_types: {g!r} needs type and why" for g in gaps["slide_types"] if not (isinstance(g, dict) and g.get("type") and g.get("why"))]
    qs = obj.get("questions")
    if not isinstance(qs, list):
        errs.append("questions must be a list")
        qs = []
    if len(qs) > MAX_QUESTIONS:
        errs.append(f"at most {MAX_QUESTIONS} questions, got {len(qs)}")
    seen = set()
    for q in qs:
        if not isinstance(q, dict):
            errs.append("a question must be an object")
            continue
        qid = q.get("id")
        if not (isinstance(qid, str) and qid.startswith("q_")) or qid in seen:
            errs.append(f"question id {qid!r} must be a unique 'q_...'")
        seen.add(qid)
        if not q.get("text"):
            errs.append(f"{qid}: needs text")
        if not isinstance(q.get("allow_text"), bool):
            errs.append(f"{qid}: allow_text must be true or false")
        opts = q.get("options")
        if not isinstance(opts, list) or not all(isinstance(o, dict) and o.get("id") and o.get("label") for o in opts):
            errs.append(f"{qid}: options must be a list of {{id, label, value}}")
        addr = str(q.get("address") or "")
        if qid == TYPE_QUESTION_ID:
            if addr != TYPE_ADDRESS:
                errs.append(f"{qid}: address must be '{TYPE_ADDRESS}'")
        elif not addr.startswith("brief.") or addr[6:].split(".")[0] not in BRIEF_FIELDS:
            errs.append(f"{qid}: address must be 'brief.<field>'")
    return errs


#: The id prefix of a question card raised for a flagged token (one card per field).
TOKEN_QUESTION_PREFIX = "q_token_"


def _token_card(fid: str, tokens: list) -> dict:
    """The question card for a field kept with flagged tokens: it names them and offers keep or remove.
    Computed in code, addressed to the field it is about."""
    named = ", ".join(f"'{t}'" for t in tokens)
    return {"id": TOKEN_QUESTION_PREFIX + fid,
            "text": f"The intake wrote {named} in {fid.replace('_', ' ')}, but nothing you gave says it. Keep it?",
            "options": [{"id": "opt_keep", "label": "Keep it", "value": "keep"}, {"id": "opt_remove", "label": "Remove it", "value": "remove"}],
            "allow_text": True, "address": f"brief.{fid}"}


def _without_tokens(value, tokens: list):
    """A field value with every sentence (text), item (list) or entry (dict) that holds a token taken out;
    None when nothing is left. Words are never reworded: a piece is kept whole or dropped whole."""
    has = lambda s: any(t in str(s) for t in tokens)
    if isinstance(value, str):
        kept = [s for s in re.split(r"(?<=[.!?])\s+", value) if s and not has(s)]
        return " ".join(kept) or None
    if isinstance(value, list):
        return [x for x in value if not has(json.dumps(x, ensure_ascii=False, default=str))] or None
    if isinstance(value, dict):
        return {k: v for k, v in value.items() if not has(json.dumps(v, ensure_ascii=False, default=str))} or None
    return value


def _apply_token_answers(inp, rep: dict) -> None:
    """Honour the person's answer to a token card: 'Remove it' takes the flagged pieces out of the field
    (the field is dropped if nothing is left); any other answer keeps it, and the flag stays on the record."""
    for fid, f in inp.brief.items():
        toks = f.get("kept_with_flag")
        a = (inp.answers or {}).get(TOKEN_QUESTION_PREFIX + fid)
        if toks and f.get("from_intake") and f.get("flag_kind") and isinstance(a, dict) and a.get("option_id") == "opt_keep":
            f["kind"] = f.pop("flag_kind")   # the person kept the flagged name: the field is as sourced as it first claimed
            continue
        if not (toks and f.get("from_intake") and isinstance(a, dict) and a.get("option_id") == "opt_remove"):
            continue
        left = _without_tokens(f.get("value"), toks)
        f["value"], f["kept_with_flag"] = left, []
        rep.setdefault("removed", []).append(fid)


def apply_a0(inp, a0: dict) -> dict:
    """Put an a0 stage's output into the brief fields, in place, and return what happened.

    The person's own answers fill their addressed field first. Then each a0 field fills a brief
    field only where it is empty: a field the brief supplies is never overwritten. A field is
    dropped when a figure in it is in none of the inputs, or it cites a rejected finding. A field
    that claims a prompt, document or research basis but cites nothing that resolves is demoted
    to ``proposal``. Questions nobody answered join the open questions. Idempotent."""
    R = Resolver(inp, [])
    given = {fid: {"value": f.get("value"), "kind": f.get("kind")} for fid, f in inp.brief.items() if not f.get("from_intake")}
    traced = _figure_numbers(inp, given)
    hay = _haystack(inp, given)
    rejected = _rejected_facts(inp)
    rep = {"applied": [], "kept_brief": [], "dropped": [], "demoted": [], "answered": [], "kept_with_flag": []}

    def free(fid: str) -> bool:
        """True when a field is empty, or only an earlier intake proposal fills it."""
        f = inp.brief.get(fid) or {}
        if f.get("from_intake") and f.get("kept_with_flag"):
            return False   # already applied, and held with a flagged token until the person answers its card
        return _empty(f.get("value")) or bool(f.get("from_intake") and f.get("kind") == "proposal")

    def put(fid, value, kind, refs, conflict=None):
        """Write one intake field in the brief's field shape."""
        inp.brief[fid] = {"value": value, "kind": kind, "mark": "intake", "fact_refs": [r for r in refs if r.startswith("f_")],
                          "reason": None, "rejected_attempt": None, "review": None, "rival": None,
                          "from_intake": True, "refs": refs, **({"conflict": conflict} if conflict else {})}

    holder = inp.intake if (inp.intake or {}).get("questions") else (a0 if isinstance(a0, dict) else {})
    questions = holder.setdefault("questions", [])   # the card for a flagged token joins this list
    for q in questions:
        parts = str(q.get("address") or "").split(".")
        fid = parts[1] if len(parts) > 1 else None
        txt = answer_text(inp, q.get("id", ""))
        if fid in BRIEF_FIELDS and txt and free(fid) and not str(q.get("id", "")).startswith(TOKEN_QUESTION_PREFIX):
            put(fid, txt, "prompt", [f"answer:{q['id']}"])
            rep["answered"].append(fid)
    for fid, f in ((a0 or {}).get("fields") or {}).items():
        if fid not in BRIEF_FIELDS or _empty(f.get("value")):
            continue
        if not free(fid):
            rep["kept_brief"].append(fid)
            continue
        refs = [r for r in f.get("refs") or [] if R.kind(r) != "unknown"]
        if any(R.kind(r) == "finding" and inp.findings[r].get("status") == "rejected" for r in refs):
            rep["dropped"].append({"field": fid, "why": "cites a finding a person rejected"})
            continue
        if any(r in rejected for r in refs):
            rep["dropped"].append({"field": fid, "why": "cites a research pin a person rejected"})
            continue
        refs = [r for r in refs if r not in rejected]
        bad = sorted(_figures(json.dumps(f["value"], ensure_ascii=False, default=str)) - traced)
        if bad:
            rep["dropped"].append({"field": fid, "why": "figure in none of the inputs: " + ", ".join(f"{n:g}" for n in bad)})
            continue
        names = _untraced_names(f["value"], hay)   # one untraced token never costs the whole field: keep it, flag it, ask
        kind = f.get("kind") if f.get("kind") in A0_KINDS else "proposal"
        if kind == "proposal" and (inp.brief.get(fid) or {}).get("from_intake"):
            continue   # the same proposal again: nothing to change
        if kind != "proposal" and not refs:
            kind = "proposal"
            rep["demoted"].append(fid)
        if names and kind != "proposal":
            held_kind, kind = kind, "proposal"   # a name or legal line in none of the inputs is never sourced: it is a proposal until the person keeps it
            rep["demoted"].append(fid)
        else:
            held_kind = None
        put(fid, f["value"], kind, refs, f.get("conflict"))
        rep["applied"].append(fid)
        if names:
            inp.brief[fid]["kept_with_flag"] = names
            if held_kind:
                inp.brief[fid]["flag_kind"] = held_kind   # what the field claimed; 'Keep it' on the card restores it
            rep["kept_with_flag"].append({"field": fid, "tokens": names, "why": "name or legal line in none of the inputs: " + ", ".join(names)})
            card = _token_card(fid, names)
            if card["id"] in {q.get("id") for q in questions}:
                pass
            elif len(questions) < MAX_QUESTIONS:
                questions.append(card)   # after the type question and the stage's own, within the cap
            else:
                rep["kept_with_flag"][-1]["question"] = "not asked: the five-question cap is full"
    _apply_token_answers(inp, rep)
    have = {q.get("question") for q in inp.open_questions}
    for q in questions:
        if str(q.get("address") or "").startswith("deck.") or str(q.get("id", "")).startswith(TOKEN_QUESTION_PREFIX):
            continue   # the deck type is settled by the profile (chosen_type), and a token card is for the person, not a gap in the brief
        if not answer_text(inp, q.get("id", "")) and q.get("text") and q["text"] not in have:
            inp.open_questions.append({"question": q["text"], "why": "asked at intake; the person skipped or has not answered", "priority": "normal"})
            have.add(q["text"])
    return rep



# ---------------------------------------------------------------- the deck type (deck types: features/deck-maker-intake.clan)

#: The question card's id and the path its answer settles (a deck-level path, not a brief field).
TYPE_QUESTION_ID = "q_deck_type"
TYPE_ADDRESS = "deck.type"
TYPE_QUESTION_TEXT = "What kind of deck is this?"

#: Words that point at a deck type: (pattern, weight, case-sensitive). Weights: 3 names the type outright,
#: 2 is a strong hint, 1 a weak one. Derived from the research's own names for the kinds (GUIDE.md section 3):
#: a tender (ITT, scored criteria, lots), an investor round (Sequoia and DocSend vocabulary), a chemistry or
#: credentials meeting (WFA/EACA, IPA/ISBA) and an agency pitch (brief, campaign, tissue session).
SIGNALS = {
    "tender_response": (
        (r"\binvitation to tender\b", 3, False), (r"\brequests? for (?:tender|proposals?)\b", 3, False),
        (r"\b(?:ITT|RFT|RFP)\b", 3, True), (r"\bscoring criteria\b", 3, False),
        (r"\b(?:award|evaluation|selection) criteria\b", 3, False), (r"\bcontracting authority\b", 3, False),
        (r"\bmost economically advantageous\b", 3, False), (r"\btender(?:s|ing|ed)?\b", 2, False),
        (r"\bprocurement\b", 2, False), (r"\b(?:lots? \d+|separate lots|in \d+ lots|(?:the|two|three|four|several) lots)\b", 2, False),
        (r"\betenders?\b", 2, False), (r"\bminimum score\b", 1, False), (r"\bsocial value\b", 1, False)),
    "investor_seed": (
        (r"\bpre-?seed\b", 3, False), (r"\bseed (?:round|deck|stage|funding|investors?)\b", 3, False),
        (r"\b(?:series [AB]|funding round|investment round)\b", 3, False), (r"\bseed\b", 2, False),
        (r"\braising\b", 2, False), (r"\binvestors?\b", 2, False), (r"\bventure capital\b|\bVCs?\b", 2, True),
        (r"\bcap table\b", 2, False), (r"\bvaluation\b", 2, False), (r"\bround\b", 1, False),
        (r"\bfounders?\b", 1, False), (r"\brunway\b", 1, False)),
    "credentials": (
        (r"\bchemistry (?:meeting|session|call)\b", 3, False), (r"\b(?:credentials|capabilities) (?:deck|presentation)\b", 3, False),
        (r"\bcredentials\b", 2, False), (r"\bwho we are\b", 2, False), (r"\bmeet the team\b", 2, False),
        (r"\bintro(?:ductory)? meeting\b", 2, False), (r"\bget to know (?:us|you)\b", 1, False)),
    "agency_pitch": (
        (r"\bcreative brief\b", 2, False), (r"\btissue session\b", 2, False), (r"\bpitch\b", 1, False),
        (r"\bcampaign\b", 1, False), (r"\bagency\b", 1, False)),
}
#: Tie-break order when two types score the same.
_PRIORITY = ("tender_response", "investor_seed", "credentials", "agency_pitch")
_LEVELS = ("low", "medium", "high")


def _texts_of(prompt_text, documents, brief) -> list:
    """The inputs as plain strings in reading order: the prompt, each document's text, each brief value.
    ``documents`` is a {key: {text}} mapping (as inp.docs), a {key: text} mapping or a list of either;
    ``brief`` is a {field: {value}} mapping (as inp.brief) or {field: value}."""
    out = [str(prompt_text or "")]
    docs = documents.values() if isinstance(documents, dict) else (documents or [])
    for d in docs:
        out.append(str(d.get("text", "")) if isinstance(d, dict) else str(d))
    for f in (brief or {}).values():
        v = f.get("value") if isinstance(f, dict) and "value" in f else f
        if v not in (None, "", [], {}):
            out.append(json.dumps(v, ensure_ascii=False, default=str) if not isinstance(v, str) else v)
    return [t for t in out if t.strip()]


def infer_type(prompt_text, documents=None, brief=None) -> dict:
    """Which deck type the inputs point at: ``{type, confidence, evidence}`` (a profile id, ``low``/
    ``medium``/``high``, and the exact words quoted from the inputs). Plain code, no model: the words in
    SIGNALS are matched in the prompt, then the documents, then the brief. A type needs a score of 3 to be
    proposed; the score is the sum of the weights of its distinct patterns. A bare line, or anything
    weaker, is an agency pitch with low confidence and no evidence. The person is still asked."""
    texts = _texts_of(prompt_text, documents, brief)
    found = {}
    for tid, pats in SIGNALS.items():
        hits, score = [], 0
        for pat, w, case in pats:
            for t in texts:
                m = re.search(pat, t, 0 if case else re.I)
                if m:
                    score += w
                    if m.group(0) not in hits:
                        hits.append(m.group(0))
                    break
        found[tid] = (score, hits)
    rank = sorted(found, key=lambda t: (-found[t][0], _PRIORITY.index(t)))
    best = rank[0]
    score, hits = found[best]
    if best != "agency_pitch" and score < 3:
        return {"type": "agency_pitch", "confidence": "low", "evidence": []}
    if best == "agency_pitch":
        return {"type": "agency_pitch", "confidence": "medium" if score >= 3 else "low", "evidence": hits[:4] if score >= 3 else []}
    level = 2 if score >= 5 else 1
    if len(rank) > 1 and found[rank[1]][0] == score:
        level -= 1   # two types tie: say so
    return {"type": best, "confidence": _LEVELS[level], "evidence": hits[:4]}


def type_question(inferred: dict | None = None) -> dict:
    """The question card (middleware-api 8.3) 'What kind of deck is this?': the four deck types as options
    (label and one line of when to use it), the inferred one first with origin ``proposed`` and its quoted
    evidence as ``source``, the others ``asked``. Address ``deck.type``, free text allowed, always skippable;
    ``default`` names what a skip falls back to. Computed in code, so it exists with no model stage."""
    inferred = inferred or {"type": spec.DEFAULT_TYPE, "confidence": "low", "evidence": []}
    order = [inferred["type"]] + [t for t in profiles.ids() if t != inferred["type"]]
    opts = []
    for n, tid in enumerate(order):
        p = profiles.load(tid)
        o = {"id": tid, "label": f"{p['label']}: {p['one_line']}", "value": tid, "origin": "proposed" if n == 0 else "asked"}
        if n == 0 and inferred.get("evidence"):
            o["source"] = " / ".join(inferred["evidence"])
        opts.append(o)
    return {"id": TYPE_QUESTION_ID, "text": TYPE_QUESTION_TEXT, "options": opts, "allow_text": True,
            "address": TYPE_ADDRESS, "skippable": True, "default": spec.DEFAULT_TYPE}


def type_card_for(inp) -> dict:
    """The type question for a run's inputs: inferred from its prompt, documents and brief."""
    return type_question(infer_type(inp.prompt_text, inp.docs, {k: f for k, f in inp.brief.items() if not f.get("from_intake")}))


def add_type_question(a0: dict, card: dict, profile: dict | None = None) -> dict:
    """Put the type question first in an a0 output's questions, in place, and return it. The list stays
    at most intake.MAX_QUESTIONS long: the type question and up to four others. Where there is room and a
    profile is known, the profile's own questions fill it, only about a brief field still empty and not
    already asked. Idempotent: an a0 that already leads with the card is left as it is."""
    qs = [q for q in a0.get("questions") or [] if q.get("id") != TYPE_QUESTION_ID][:MAX_QUESTIONS - 1]
    if profile:
        gaps = {g.get("field") for g in (a0.get("gaps") or {}).get("brief_fields") or []}
        asked = {q.get("address") for q in qs}   # fields the a0 already asks about; the profile's own questions do not block each other
        seen = {q.get("text") for q in qs}
        for q in profile["questions"]:
            if len(qs) >= MAX_QUESTIONS - 1:
                break
            if q["address"].split(".")[1] in gaps and q["address"] not in asked and q["text"] not in seen \
                    and q["id"] not in {x.get("id") for x in qs}:
                qs.append({k: q[k] for k in ("id", "text", "options", "allow_text", "address")})
    a0["questions"] = [card] + qs
    return a0


def _recognise(text: str) -> str | None:
    """A deck type named in a typed answer: an id or a label, else the type its words point at (medium
    confidence or better). None when the text names nothing."""
    t = text.strip().lower()
    for tid in profiles.ids():
        p = profiles.load(tid)
        if t in (tid, p["label"].lower(), tid.replace("_", " ")):
            return tid
    inf = infer_type(text)
    return inf["type"] if inf["evidence"] and inf["confidence"] != "low" else None


def chosen_type(inp, flag: str | None = None) -> dict:
    """The deck type a run uses and why: ``{type, source, note}``. ``source`` is ``flag`` (an explicit
    --kind), ``answer`` (the person answered q_deck_type: an option id, or typed words that name a type),
    ``skipped`` (they skipped it, or typed something naming no type: the stated default, agency_pitch) or
    ``default`` (nobody was asked). The flag wins over an answer."""
    if flag:
        return {"type": profiles.for_kind(flag)["id"], "source": "flag", "note": f"--kind {flag}"}
    a = (inp.answers or {}).get(TYPE_QUESTION_ID)
    if isinstance(a, dict) and not a.get("skipped"):
        if a.get("option_id"):
            if a["option_id"] in profiles.ids():
                return {"type": a["option_id"], "source": "answer", "note": f"the person chose {a['option_id']}"}
        elif str(a.get("text") or "").strip():
            tid = _recognise(str(a["text"]))
            if tid:
                return {"type": tid, "source": "answer", "note": f"the person wrote \"{str(a['text']).strip()[:60]}\""}
        return {"type": spec.DEFAULT_TYPE, "source": "skipped", "note": f"the answer named no deck type: used the stated default, {spec.DEFAULT_TYPE}"}
    if isinstance(a, dict):
        return {"type": spec.DEFAULT_TYPE, "source": "skipped", "note": f"the deck type question was skipped: used the stated default, {spec.DEFAULT_TYPE}"}
    return {"type": spec.DEFAULT_TYPE, "source": "default", "note": f"the deck type was not asked or answered: used the stated default, {spec.DEFAULT_TYPE}"}


# ---------------------------------------------------------------- supply cards: what only the person knows (ADR 0023, 0028)
#
# The engine never invents a team, a case, a fee split or a decision date. A person SUPPLIES them: an answer to a
# supply card, written by the app as an attributed human write at intake.answers.<qid>, or a document they attached
# (traced to the page or section it came from). Either way the engine reads it as the person's own input.

#: The supply cards, in priority order: (id, slide type it fills, question text). Free text, one item per line.
#: ``gap`` names the gap_report slide type that makes a card more urgent (no budget given at all).
SUPPLY_CARDS = (
    ("q_supply_team", "team", "Who would work on this, and in what role? One person per line, for example: name, role.", None),
    ("q_supply_credentials", "credentials", "Which past cases would you show? One per line: the client, what you did, the result.", None),
    ("q_supply_budget", "investment", "How is the budget split between fees, production and media? One line per part.", "investment"),
    ("q_supply_options", "investment", "Which options do you want to put to the client, and what does each cost? One per line.", None),
    ("q_supply_decision_date", "next_step", "By what date will the client decide?", None),
)
#: Investor gap cards: a slide whose only content would be a placeholder (nothing in the inputs states it) is held
#: behind the Appendix divider, and its card asks the person for the missing line. (id, slide type, question text).
GAP_CARDS = (
    ("q_supply_why_now", "why_now", "What changed in the world that makes this the right moment? One line, with the figure, rule or date it rests on."),
    ("q_supply_what_we_know", "what_we_know", "What have your customers shown you that most people in the market do not believe? One line, with the number or quote."),
)


def gap_questions(slide_types) -> list:
    """The question cards for investor slides that would carry no source (assemble.investor_gaps), in GAP_CARDS order:
    the same shape as a supply card, so the app and ``supplied`` read them alike."""
    want = set(slide_types)
    return [{"id": qid, "text": text, "options": [], "allow_text": True, "address": f"slide.{t}", "skippable": True,
             "kind": "supply", "fills": t} for qid, t, text in GAP_CARDS if t in want]


#: The id prefix of a supply card (the app tells it from the type question and the a0's own by its ``kind``).
SUPPLY_PREFIX = "q_supply_"

#: Headings that open the part of a document a human-only slide is filled from, per slide type (whole short line).
_DOC_HEADINGS = {
    "team": r"(?:the |our |project |key )?(?:team|people|personnel|staff|who we are|meet the team|key people)",
    "credentials": r"(?:our |selected |relevant |past |previous )?(?:credentials|case stud(?:y|ies)|work|track record|experience|clients|projects)",
    "investment": r"(?:our |the )?(?:fees?|fee proposal|pricing|investment|budget|rate card|commercials?|costs?)",
}
#: A line that opens some other part of a document: it ends the part being read.
_ANY_HEADING = re.compile(r"^(?:\d+[.)]\s*)?[A-Z][A-Za-z&/' -]{2,40}:?$")
#: A bullet, or a numbered item.
_BULLET = re.compile(r"^\s*(?:[-*•–]|\d{1,2}[.)])\s+(.*\S)\s*$")
#: Lines that ask for something rather than give it (a client's own tender text): never read as the agency's own material.
_ASKS = re.compile(r"^(?:please\b|provide\b|describe\b|include\b|submit\b|state\b|explain\b|list\b|tenderers?\b|bidders?\b|the tenderer\b|the supplier\b|applicants?\b|must\b|should\b|you (?:must|should|will)\b)", re.I)
#: A requirement or limit the client sets on bidders ("Fees must not exceed EUR 100,000"; "Minimum turnover of EUR 2m"):
#: anywhere in a line it marks the client's text, never the agency's own credentials or fee.
_REQUIRES = re.compile(r"\b(?:must|shall|should|required?|requires|requirements?|minimum|maximum|mandatory|not exceed\w*|no more than|no less than|at least|at a minimum|will be (?:evaluated|scored|assessed|marked))\b", re.I)
#: A person line: a capitalised name, a separator, a role ("Aoife Byrne, Strategy Director"; "Cian Doyle - Creative Lead").
_PERSON = re.compile(r"^[A-Z][a-z'’-]+(?: [A-Z][a-z'’-]+){1,2}\s*(?:,|–|—| - |:)\s*\S.{2,80}$")
#: A decision date stated in a document.
_DATE = r"(?:\d{1,2}(?:st|nd|rd|th)? (?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]* \d{4}|(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]* \d{1,2}(?:st|nd|rd|th)?,? \d{4}|\d{4}-\d{2}-\d{2})"
_DECISION = re.compile(rf"\b(?:decision|decide[sd]?|award(?:ed)?|appointment|appointed)\b[^.\n]{{0,60}}?\b({_DATE})", re.I)


def supply_questions(inp, kind: str = "agency", profile: dict | None = None, gaps: dict | None = None) -> list:
    """The supply cards for a run, in priority order, as question cards of the same shape as the type
    question (middleware-api 8.3): ``{id, text, options: [], allow_text, address, skippable, kind: 'supply',
    fills}``. Computed in code from the gap report and spec.HUMAN_ONLY_TYPES, never by a model.

    A card is raised only for a slide the deck type presents (a spine profile's ``spine``; a legacy or
    agency deck has all four human-only slides), and never for what the person already supplied: a team,
    credentials, fee or decision date the attached documents state (doc_supply) is not asked again, and a
    budget the brief gives is not asked for. Investor decks have none of these slides: no cards. The
    answers are read back from ``inp.answers`` by qid (supplied)."""
    if kind == "investor":
        return []
    spine = (profile or {}).get("spine") if (profile or {}).get("arrange") == "spine" else None
    gaps = gaps if gaps is not None else gap_report(inp, None, kind)
    gap_types = {g["type"] for g in gaps.get("slide_types") or []}
    have = doc_supply(inp)
    eff = _effective(inp, None)
    cards = []
    for qid, slide_type, text, gap in SUPPLY_CARDS:
        if slide_type not in spec.HUMAN_ONLY_TYPES or (spine is not None and slide_type not in spine):
            continue
        if slide_type in have:
            continue   # the person's own documents already say it
        if qid == "q_supply_budget" and eff["budget_scope"]["kind"] != "proposal" and not _empty(eff["budget_scope"]["value"]):
            continue   # the brief gives a budget: never asked
        cards.append(({"id": qid, "text": text, "options": [], "allow_text": True, "address": f"slide.{slide_type}",
                       "skippable": True, "kind": "supply", "fills": slide_type}, 0 if gap in gap_types else 1))
    return [c for c, _ in sorted(cards, key=lambda x: x[1])]   # stable: a card the gap report names (no budget at all) first


def add_supply_questions(a0: dict, cards: list, reserve: int = 2) -> dict:
    """Put supply cards after the type question and the stage's own, in place, within the five-question
    cap shared by priority. The type question is first. Supply cards take the room left; when the stage's
    own questions leave less than ``reserve`` places, the last of them go (never one addressed to
    ``brief.objectives``, which the objective slide reads) so that the first ``reserve`` supply cards fit.
    Idempotent: a card already present is not added again."""
    qs = list(a0.get("questions") or [])
    have = {q.get("id") for q in qs}
    new = [c for c in cards if c["id"] not in have]
    keep_n = max(0, min(reserve - sum(1 for q in qs if q.get("kind") == "supply"), len(new)))
    while len(qs) > MAX_QUESTIONS - keep_n:
        drop = next((i for i in range(len(qs) - 1, 0, -1) if qs[i].get("kind") != "supply" and qs[i].get("id") != TYPE_QUESTION_ID
                     and str(qs[i].get("address") or "").split(".")[:2] != ["brief", "objectives"]), None)
        if drop is None:
            break
        qs.pop(drop)
    for c in new:
        if len(qs) >= MAX_QUESTIONS:
            break
        qs.append(c)
    a0["questions"] = qs
    return a0


def _lines_of(answer: str) -> list:
    """The items of a free-text answer: one per line, a leading bullet taken off, blanks dropped. A single line
    of prose stays one item."""
    out = []
    for ln in str(answer or "").splitlines():
        m = _BULLET.match(ln)
        t = (m.group(1) if m else ln).strip()
        if t:
            out.append(t)
    return out


def supplied(inp, qid: str) -> dict | None:
    """What the person supplied by answering card ``qid``: ``{items, ref, by}`` (the answer's lines, cited
    ``answer:<qid>``, and who wrote it: the answer's ``by``, else 'the person'), or None when it is unanswered
    or skipped."""
    items = _lines_of(answer_text(inp, qid))
    if not items:
        return None
    a = (inp.answers or {}).get(qid) or {}
    return {"items": items, "ref": f"answer:{qid}", "by": str(a.get("by") or "the person")}


def _page_at(text: str, pos: int) -> int | None:
    """The page number of the last [pN] locator at or before ``pos`` in a document's text, or None."""
    last = None
    for m in re.finditer(r"\[p(\d+)\]", text[:pos + 1]):
        last = int(m.group(1))
    return last


def doc_supply(inp) -> dict:
    """What the person's attached documents themselves supply for the human-only slides, read in code from
    the documents' own headings and lists (no model): ``{slide type: {items, ref, doc}}`` for ``team`` (a
    Team section whose lines read 'Name, Role'), ``credentials`` and ``investment`` (a section's bullet lines),
    and ``next_step`` (a decision date a sentence states). Lines are copied whole and in order; a line that asks
    for something (a client's tender text: 'Provide CVs of key personnel') is never read as the person's own
    material. ``ref`` is ``doc:<KEY>#pN`` (the page the section opens on), or ``doc:<KEY>#<heading>`` for a
    document with no page markers. First document that has a section wins. Documents that came from the research CLAN (``origin: research``) are the client's own text and are never read. Empty when nothing qualifies."""
    out = {}
    for key, d in (inp.docs or {}).items():
        if d.get("origin") == "research":   # the research CLAN's extracted documents are the client's (RFT, Q&A), not the agency's
            continue
        text = d.get("text") or ""
        lines = text.splitlines()
        offs, o = [], 0
        for ln in lines:
            offs.append(o)
            o += len(ln) + 1
        for stype, pat in _DOC_HEADINGS.items():
            if stype in out:
                continue
            for i, ln in enumerate(lines):
                head = re.sub(r"^(?:#+\s*|\d+[.)]\s*)", "", ln.strip()).rstrip(":").strip()
                if not (head and len(head.split()) <= 5 and re.fullmatch(pat, head, re.I)):
                    continue
                items = []
                for nxt in lines[i + 1:i + 40]:
                    s = nxt.strip()
                    if re.fullmatch(r"\[p\d+\]", s) or not s:
                        continue
                    if _ANY_HEADING.match(s) and not _BULLET.match(s) and not _PERSON.match(s):
                        break
                    m = _BULLET.match(nxt)
                    body = (m.group(1) if m else s).strip()
                    if _ASKS.match(body) or len(body.split()) > 40 or (stype != "team" and _REQUIRES.search(body)) or _DECISION.search(body):
                        continue
                    if stype == "team" and not _PERSON.match(body):
                        continue
                    if stype != "team" and not m:
                        continue
                    if stype == "credentials" and not re.search(r"[A-Z]\w+", body[1:]):
                        continue
                    items.append(body)
                if items:
                    pg = _page_at(text, offs[i])
                    out[stype] = {"items": items[:8], "doc": key, "ref": f"doc:{key}#p{pg}" if pg else f"doc:{key}#{re.sub(r'[^a-z0-9]+', '-', head.lower()).strip('-')}"}
                    break
        if "next_step" not in out:
            for m in _DECISION.finditer(re.sub(r"\[p\d+\]", " ", text)):
                sent = next((_BULLET.sub(r"\1", s) for s in re.split(r"(?<=[.!?])\s+|\n+", re.sub(r"\[p\d+\]", " ", text)) if m.group(0) in s), "")   # the bullet marker is not part of the date's sentence
                pos = text.find(m.group(0))
                pg = _page_at(text, pos) if pos >= 0 else None
                if sent.strip():
                    out["next_step"] = {"items": [sent.strip()], "doc": key, "ref": f"doc:{key}#p{pg}" if pg else f"doc:{key}#decision-date"}
                    break
    return out


def human_fill(inp, stype: str, qids: tuple) -> dict | None:
    """What fills a human-only slide of type ``stype``: the person's answers to cards ``qids`` first
    (``{items: [(text, ref)], by, basis: 'supplied by <by>'}``), else the documents' own section
    (``basis: 'document'``), else None (the slide stays a labelled placeholder)."""
    items, by = [], None
    for q in qids:
        s = supplied(inp, q)
        if s:
            items += [(t, s["ref"]) for t in s["items"]]
            by = by or s["by"]
    if items:
        return {"items": items, "by": by, "basis": f"supplied by {by}"}
    d = doc_supply(inp).get(stype)
    if d:
        return {"items": [(t, d["ref"]) for t in d["items"]], "by": "document", "basis": "document"}
    return None


# ---------------------------------------------------------------- the confirm list and verify decisions

#: The kinds a confirm item has.
CONFIRM_KINDS = ("proposal", "figure", "slide")


def _slug(text: str) -> str:
    """A short stable id piece from text: lowercase words joined by '-', at most 24 characters."""
    return re.sub(r"[^a-z0-9]+", "-", str(text).lower()).strip("-")[:24] or "x"


def _item_refs(sl: dict) -> list:
    """(text, refs, basis) for every claim and sourced block item on a slide, whose words the confirm list reads."""
    out = [(c.get("text", ""), c.get("refs") or [], c.get("basis")) for c in sl.get("claims") or []]
    for b in sl.get("blocks") or []:
        if b.get("internal") or b.get("kind") in ("chart", "table"):
            continue
        if b.get("text") and (b.get("refs") or b.get("basis")):
            out.append((b["text"], b.get("refs") or [], b.get("basis")))
        for it in b.get("items") or []:
            if isinstance(it, dict) and it.get("text") and (it.get("refs") or it.get("basis")) and not it.get("human"):
                out.append((it["text"], it.get("refs") or [], it.get("basis") or b.get("basis")))
    return out


def confirm_list(deck: dict, inp) -> list:
    """What a person should confirm before the deck is shown, computed in code, in the order they matter:

    - a ``proposal`` per brief field only proposed (nothing the person gave supports it) and per claim whose
      basis is proposal on a presented slide;
    - a ``figure`` per figure on a slide whose only source is the person's own statement (the prompt, an answer) or
      a research pin of low confidence;
    - a ``slide`` per slide still needing a person (status needs_human).

    Each item is ``{ref, kind, text, why, slide, verified}``: ``ref`` is stable across rebuilds (a brief field,
    the source ref, a hash of the words, or ``slide:<type>``); ``verified`` is the person's decision
    ``{by, at}`` read from ``inp.verified`` (``intake.verified.<ref>``), else None. Items with the same ref appear once."""
    seen, out = set(), []
    verified = getattr(inp, "verified", None) or {}

    def add(ref, kind, text, why, sid):
        """One confirm item, once per ref."""
        if ref in seen:
            return
        seen.add(ref)
        v = verified.get(ref)
        out.append({"ref": ref, "kind": kind, "text": str(text)[:200], "why": why, "slide": sid,
                    "verified": ({"by": str(v.get("by") or ""), "at": str(v.get("at") or "")} if isinstance(v, dict) else None)})

    order = deck.get("order") or []
    story_end = next((i for i, sid in enumerate(order) if deck["slides"][sid]["type"] == "appendix"), len(order))
    for fid, f in inp.brief.items():
        if f.get("kind") == "proposal" and not _empty(f.get("value")):
            add(f"brief:{fid}", "proposal", json.dumps(f["value"], ensure_ascii=False, default=str) if not isinstance(f["value"], str) else f["value"],
                "proposed by the intake: nothing you gave supports it", None)
    for n, sid in enumerate(order):
        sl = deck["slides"][sid]
        presented = n < story_end
        for text, refs, basis in _item_refs(sl):
            if basis == "proposal" and presented and str(text).strip() and not str(text).startswith(spec.PLACEHOLDER_PREFIX):
                add("proposal:" + hashlib.sha1(str(text).encode("utf-8")).hexdigest()[:8], "proposal", text, "a proposal: nothing you gave supports it", sid)
            if refs and numbers_in(text) - {0.0, 1.0}:
                own = [r for r in refs if str(r).startswith(("prompt:", "answer:"))]
                low = [r for r in refs if str(r).startswith("f_") and (inp.facts.get(r) or {}).get("confidence") == "low"]
                strong = [r for r in refs if r not in own and r not in low and not str(r).startswith(("req:", "brief:", "calc:"))]
                if (own or low) and not strong:
                    add((own or low)[0], "figure", text, "only your own statement supports this figure" if own else "a research pin of low confidence supports this figure", sid)
    slugs = {}
    for sid in order:
        sl = deck["slides"][sid]
        if sl["status"] == "needs_human":
            ref = f"slide:{sl['type']}"
            slugs[ref] = slugs.get(ref, 0) + 1
            if slugs[ref] > 1 or sl["type"] == "criterion_answer":
                ref = f"{ref}:{_slug(sl.get('label') or sl['title'])}"
            add(ref, "slide", sl["title"], "still needs a person: nothing supplies it yet", sid)
    return out


def verify_patch(ref: str, by: str, at: str) -> dict | None:
    """The record of a verify decision: ``{intake: {verified: {<ref>: {by, at}}}}`` (what the app writes with put()),
    or None for an empty ref or author."""
    if not str(ref or "").strip() or not str(by or "").strip():
        return None
    return {"intake": {"verified": {str(ref): {"by": str(by), "at": str(at)}}}}


def confirm_summary(deck: dict, items: list | None = None) -> dict:
    """The counts the export's status line reads: ``total`` items to confirm, ``verified`` by a person, ``supplied``
    (slides a person's answer or document filled), ``sourced`` (verified plus supplied: the only items counted as
    sourced) and ``open`` (confirm items not yet verified). Pure: needs only the deck (``meta.confirm`` unless
    ``items`` is given). A deck without a confirm list has zeros."""
    items = items if items is not None else (deck.get("meta") or {}).get("confirm") or []
    verified = sum(1 for i in items if i.get("verified"))
    supplied_n = sum(1 for s in (deck.get("slides") or {}).values() if s.get("supplied"))
    return {"total": len(items), "verified": verified, "supplied": supplied_n, "sourced": verified + supplied_n, "open": len(items) - verified,
            "needs_person": sum(1 for s in (deck.get("slides") or {}).values() if s.get("status") == "needs_human")}


def stamp_confirm(deck: dict, inp) -> list:
    """Write ``meta.confirm`` (the confirm list) and ``meta.confirm_summary`` into a built deck, in place, and
    return the list. Called by the run after the build, so a golden build stays as it was."""
    items = confirm_list(deck, inp)
    deck["meta"]["confirm"] = items
    deck["meta"]["confirm_summary"] = confirm_summary(deck, items)
    return items
