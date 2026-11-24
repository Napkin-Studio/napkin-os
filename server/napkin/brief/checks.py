"""First-draft checks (feature brief-first-draft-checks, ADR 0035).

The default flow writes the whole brief in one call, so the per-field rubric (judge.py) never saw a first
draft. These are the pieces of it that the whole-brief review can use: what code can measure (words against a
part's limit, sentences, a standalone 'and' in the proposition), the planning skill's tests for the parts
the Review agent judges, and the one rule about marking: an assumption says it is one.

Code decides only what it can measure. Whether an 'and' joins two thoughts, or an objection is one doubt, is
the Review agent's call, given the test."""

from __future__ import annotations

import re

from .fields import RUBRIC_FIELDS
from .rubric import _sentences, and_flag

# the app's part -> the schema's rubric field
APP_RUBRIC = {"background": "background", "audience": "audience", "budget_and_scope": "budget_scope",
              "competitor_context": "competitor_context", "insight": "insight", "single_minded_proposition": "smp",
              "tone_and_world": "tone_world_assets", "mandatories": "mandatories", "job": "job", "reasons_to_believe": "reasons_to_believe",
              "barrier": "barrier", "objection": "objection", "media_roles": "media_roles", "measurement": "measurement"}
# the parts the Review agent judges against the skill's tests, and the words the review prompt names them by
TESTED_WORDS = {"insight": "the insight", "single_minded_proposition": "the proposition", "job": "the job",
                "barrier": "the barrier", "objection": "the objection", "media_roles": "the role of each medium",
                "measurement": "how we will know it worked"}
TESTED = tuple(TESTED_WORDS)
# list parts that print as a box of their own: an assumption marks the first item, which the box reads as its tag
MARKED_LISTS = ("media_roles", "measurement")
# one sentence at most: a word or a phrase is fine (Laurence, 3 Oct), several sentences are several thoughts
ONE_SENTENCE = ("single_minded_proposition", "job", "objection")
# over its limit by more than this, a part goes back; a few words over does not
MARGIN = 1.15
MARK = "To confirm:"
# the proposition and the objection rest on the insight: when it is an assumption, so are they
INHERIT = ("single_minded_proposition", "objection")
# names the brief is filed under: a guess there is a name, not a claim, and headings and file names carry it as it is
IDENTITY = ("project_name", "client")


# a name with an ampersand ("Crust & Co", "Marks & Spencer") is one thing, not two thoughts
_NAMES = re.compile(r"\b[A-Z][\w'.-]*\s+&\s+[A-Z][\w'.-]*")


def text_of(v) -> str:
    if isinstance(v, list):
        return "; ".join(text_of(x) for x in v if text_of(x))
    return v.strip() if isinstance(v, str) else ""


_LEAD_MARK = re.compile(r"(?i)^\s*to confirm:\s*")


def _spoken(v) -> str:
    """The words of a part, without the 'To confirm:' mark: the mark is not part of what is said. A list can carry
    the mark on any of its items (a redraft or a person may put it on several), so it comes off every item."""
    if isinstance(v, list):
        return "; ".join(t for t in (_LEAD_MARK.sub("", text_of(x)) for x in v) if t)
    return _LEAD_MARK.sub("", text_of(v))


def limit(key: str) -> int | None:
    rid = APP_RUBRIC.get(key)
    return (RUBRIC_FIELDS.get(rid) or {}).get("max_words") if rid else None


def max_items(key: str) -> int | None:
    rid = APP_RUBRIC.get(key)
    return (RUBRIC_FIELDS.get(rid) or {}).get("max_items") if rid else None


def item_rule(key: str) -> str:
    """The part's own words for its item cap, from its max_items test in the schema."""
    f = RUBRIC_FIELDS.get(APP_RUBRIC.get(key) or "") or {}
    return next((c["test"].rstrip(".") for c in f.get("rubric", []) if c["id"] == "max_items"), "")


def facts(whole: dict) -> dict:
    """What code measured, per part the Review agent judges or that has a limit."""
    out = {}
    for k, e in whole.items():
        t = _spoken(e.get("value"))
        if not t:
            continue
        f = {}
        own = e.get("basis") == "client"  # the client's own words are written out, not cut to a limit
        cap = None if own else max_items(k)
        if cap and isinstance(e.get("value"), list):
            f["items"], f["max_items"] = len([x for x in e["value"] if text_of(x)]), cap
        lim = None if own else limit(k)
        if lim:
            f["words"], f["limit"] = len(t.split()), lim
        if k in ONE_SENTENCE:
            f["sentences"] = len(_sentences(t))
        if k == "single_minded_proposition":
            f["standalone_and"] = and_flag(_NAMES.sub(" ", t))
        if k in PERSON_PARTS and not own:
            who = invented_person(t)
            if who:
                f["invented_person"] = who
        if f:
            out[k] = f
    return out


# the parts that describe people: a group, never a named person the brief does not give (schema: audience prompt)
PERSON_PARTS = ("audience",)
# "Meet Priya", "Priya, 28,", "Hannah, 25-45", "Priya (28)", "Persona: Priya", "Lead: Hannah, renting…": a first name
# with an age or an age range, or a label that introduces a person (UAT round 4: "Meet Priya, 28" and, on the re-test,
# "Lead: Hannah, 25-45, renting or newly owning")
_AGE = r"(?:aged\s+)?\d{2}(?:\s*(?:-|–|—|to)\s*\d{2})?(?:\s*(?:years?\s+old|yo|y/o))?"
_NOT_FIGURE = r"(?!\s*(?:%|per\s?cent|percent|years?\s+of)|\d|[.,]\d)"
_MEET = re.compile(r"\b(?:Meet|meet|This is|Say hello to|Persona|persona|Pen portrait|pen portrait)\s*:?\s+([A-Z][a-z]{2,})\b")
_NAME_AGE = re.compile(rf"\b([A-Z][a-z]{{2,}})(?:,\s*({_AGE})\b|\s+\(({_AGE})\)){_NOT_FIGURE}")
_LABEL_NAME = re.compile(r"\b(?:Lead|Primary|Secondary|Core|Target|Hero)\s*:\s*([A-Z][a-z]{2,})(?=,|\s+(?:is|who|was)\b)")
# plural group nouns ("Renters, 22-35", "Families, 30 to 45") are a group, not a person
_GROUP_END = re.compile(r"(?:ers|ies|ents|ants|ists|ors|ees|ians|ons|ves|men|ren|ple|les|als|ics)$")
# words that look like a name before a number but are not a person ("April, 25", "London, 30")
_NOT_NAMES = set("""January February March April May June July August September October November December
Monday Tuesday Wednesday Thursday Friday Saturday Sunday Spring Summer Autumn Winter Christmas Easter
London Dublin Manchester Leeds Glasgow Edinburgh Cardiff Belfast Bristol Yorkshire England Ireland Scotland Wales
Page Section Chapter Figure Table Step Phase Wave Gen Generation Under Over Aged Ages""".split())


def invented_person(text: str) -> str:
    """The named person a part invents ("Priya, 28" or "Meet Priya"), or '' when it names none. The audience is a
    group drawn from the brief's data; a name with an age is a persona the brief never gave (UAT round 4: "Meet Priya,
    28, who rents a one-bed flat")."""
    t = _LEAD_MARK.sub("", text or "")

    def person(name: str) -> bool:
        return name not in _NOT_NAMES and not _GROUP_END.search(name.lower())

    for m in _NAME_AGE.finditer(t):
        if person(m.group(1)):
            age = (m.group(2) or m.group(3) or "").strip()
            return f"{m.group(1)}, {age}"
    for rx in (_MEET, _LABEL_NAME):
        for m in rx.finditer(t):
            if person(m.group(1)):
                return m.group(1)
    return ""


def revisions(whole: dict) -> list[dict]:
    """The parts code sends back, each with the instruction: only what it can measure."""
    out = []
    for k, f in facts(whole).items():
        why = []
        if f.get("limit") and f["words"] > f["limit"] * MARGIN:
            why.append(f"it is {f['words']} words and the limit is {f['limit']}: cut it to at most {f['limit']} words, keeping what matters most")
        if f.get("max_items") and f["items"] > f["max_items"]:
            rule = item_rule(k)
            why.append(f"it has {f['items']} items and the rule is '{rule}': keep the {f['max_items']} strongest and drop the rest" if rule
                       else f"it has {f['items']} items and the limit is {f['max_items']}: keep the {f['max_items']} strongest and drop the rest")
        if f.get("sentences", 0) > 1:
            why.append(f"it is {f['sentences']} sentences: say it in one (a word or a phrase is fine)")
        if f.get("standalone_and"):
            why.append("it has a standalone 'and' or '&': the proposition is one thought, so keep the one that matters and say it without 'and'")
        if f.get("invented_person"):
            why.append(f"it invents a named person ('{f['invented_person']}') the brief never gives: describe the group from the brief's "
                       "data instead, with no name, age, city or habits the brief does not state")
        if why:
            said = "; ".join(why)
            out.append({"part": k, "instruction": said[:1].upper() + said[1:] + "."})  # names keep their capitals
    return out


def tests(keys) -> dict:
    """The planning skill's judged tests for the parts in TESTED, as the schema words them."""
    out = {}
    for k in keys:
        rid = APP_RUBRIC.get(k)
        if k in TESTED and rid:
            out[k] = {c["id"]: c["test"] for c in RUBRIC_FIELDS[rid]["rubric"] if c["method"] == "llm"}
    return out


_FIGURE = re.compile(r"\d[\d,.]*\d%?|\d%?")


def _figures_of(text: str) -> set:
    return {f.replace(",", "").rstrip(".") for f in _FIGURE.findall(text or "")}


def answer_backed(item: str, answers: str) -> bool:
    """An item whose every figure is one a planner gave in an answered open question ("Judged by: 1,500 stockists, 60,000
    starter bottles, 35% repeat refill" from "Answer: … 1,500 stockists and 60,000 starter bottles …; 35% …"): the
    planner's own words, not an assumption (UAT round 4, F10). An item with no figure is never backed this way."""
    figs = _figures_of(item)
    return bool(figs) and bool(answers) and figs <= _figures_of(answers)


def _mark(k: str, e: dict, answers: str = "") -> bool:
    """Put the mark on the part's text (idempotent): the value, or for MARKED_LISTS its first item that a planner's
    answer does not already back. -> whether it marked."""
    v = e.get("value")
    if k in MARKED_LISTS and isinstance(v, list):
        items = [i for i, x in enumerate(v) if isinstance(x, str) and x.strip()]
        if any(v[i].strip().lower().startswith("to confirm") for i in items):
            return False
        first = next((i for i in items if not answer_backed(v[i], answers)), None)
        if first is not None:
            v[first] = f"{MARK} {v[first].strip()}"
            return True
    elif isinstance(v, str) and v.strip() and not v.strip().lower().startswith("to confirm"):
        e["value"] = f"{MARK} {v.strip()}"
        return True
    return False


def answers_text(open_questions) -> str:
    """The planner's answers in answered open questions ("Q? — Answer: …"), joined, for answer_backed."""
    out = []
    for x in open_questions or []:
        parts = _QA_SPLIT.split(str(x), maxsplit=1)
        if len(parts) == 2:
            out.append(parts[1])
    return " ".join(out)


def mark_assumptions(entries: dict, insight: dict | None = None, answers: str = "") -> list[str]:
    """Mark each assumption 'To confirm:' (idempotent), and the proposition and objection when the insight they
    rest on is one. Run on the Brief agent's raw output, before provenance reads the sentences, so a claim and its sentence
    stay the same text. Lists (but for MARKED_LISTS, which mark their first item a planner's answer does not back),
    client words and research stay as they are. `insight`: the insight already held, when this output does not carry
    one. `answers`: the planner's answers (answers_text). -> the parts marked now."""
    marked = []

    def put(k, e):
        if _mark(k, e, answers):
            marked.append(k)

    for k, e in entries.items():
        if k not in IDENTITY and isinstance(e, dict) and e.get("basis") == "assumption":
            put(k, e)
    ins = entries.get("insight") or insight
    if isinstance(ins, dict) and (ins.get("basis") == "assumption" or text_of(ins.get("value")).lower().startswith("to confirm")):
        for k in INHERIT:
            e = entries.get(k)
            if isinstance(e, dict) and e.get("basis") not in ("client", "person", "research"):
                put(k, e)
    return marked


def mark_downgraded(entries: dict) -> list[str]:
    """Provenance moved some parts to 'assumption' (the Brief agent said research, library or client; nothing tied the claim).
    They say so too. A part with figures is left as it is: a mark in front of its first sentence would stop the
    sentence from tying to its claim."""
    marked = []
    for k, e in entries.items():
        if k in IDENTITY or not isinstance(e, dict) or not e.get("downgraded") or e.get("basis") != "assumption":
            continue
        if not re.search(r"\d", text_of(e.get("value"))) and _mark(k, e):
            marked.append(k)
    return marked


def figure_questions(entries: dict, label=lambda k: k) -> list[str]:
    """A part provenance moved to 'assumption' that holds a figure is left unmarked (mark_downgraded: a mark would
    break the tie between its first sentence and its claim). The figure is still to confirm, so it is asked of the
    client as an open question, one per part. -> the questions, in part order."""
    out = []
    for k, e in entries.items():
        if k in IDENTITY or not isinstance(e, dict) or not e.get("downgraded") or e.get("basis") != "assumption":
            continue
        t = text_of(e.get("value"))
        m = re.search(r"\S*\d\S*", t)
        if m and not t.lower().startswith("to confirm"):
            out.append(f"Which figure in {label(k).lower()} can you stand behind ({m.group(0).strip('.,;:')}), and where does it come from?")
    return out


# ── the line the planner fixed (UAT round 4, F4) ──────────────────────────────────────────────────────────────────
# A question about the campaign's line, answered with the line to use: "Which line does the board prefer, 'Clean, without
# the plastic' or 'Refill. Not landfill'? — Answer: Refill. Not landfill. Use it word for word everywhere." The line then
# belongs in mandatories, as the end line Production's end card and the deck read (production-tool brief/model.ts
# endLineOf: "End line: '…'"), not only in the answered question.
# what the question offers a choice of: a line in any of its names, or the message / phrase / words to run (UAT round 4
# re-test: "Which message does the board prefer: 'Clean, without the plastic' or 'Refill. Not landfill'?")
_LINE_Q = re.compile(r"\b(?:line|tag[\s-]?line|strap[\s-]?line|end[\s-]?line|sign[\s-]?off|slogan|endline|message|phrase|"
                     r"headline|platform)s?\b", re.I)
# a question about the legal or safety wording is never about the campaign's line
_LEGAL_Q = re.compile(r"\b(?:legal|disclaimer|warning|small\s+print|label|mandatory\s+copy|biocid\w*|terms)\b", re.I)
# an answer that says to keep the words exactly: the line it repeats is fixed, whatever the question called it
_VERBATIM = re.compile(r"\b(?:word\s+for\s+word|verbatim|exactly\s+as\s+(?:written|it\s+is)|as\s+written)\b", re.I)
_QUOTED = re.compile(r"(?<!\w)[\"'‘“]([^\"'‘’“”]{2,120}?)[\"'’”](?!\w)")
_QA_SPLIT = re.compile(r"\s+—\s+Answer:\s*", re.I)
_END_LINE_ITEM = re.compile(r"^\s*(?:end[\s-]?line|sign[\s-]?off|tag[\s-]?line|brand\s+line)\b", re.I)
_NO = re.compile(r"^\s*(?:no|none|n/a|not yet|tbc|to be confirmed|neither)\b", re.I)


def _norm_words(s: str) -> list[str]:
    return re.findall(r"[a-z0-9]+", (s or "").lower())


def _answer_line(question: str, answer: str) -> str:
    """The line an answer fixes: the words it quotes, else the option of the question it repeats, in the answer's own
    words and punctuation. '' when it fixes none."""
    if not answer.strip() or _NO.match(answer):
        return ""
    q = _QUOTED.search(answer)
    if q:
        return q.group(1).strip()
    aw = _norm_words(answer)
    for opt in sorted((m.group(1) for m in _QUOTED.finditer(question)), key=lambda o: -len(_norm_words(o))):
        ow = _norm_words(opt)
        if ow and aw[:len(ow)] == ow:
            # the answer's own text up to the option's last word, with the full stop or mark that ends it
            seen, end = 0, 0
            for m in re.finditer(r"[A-Za-z0-9]+", answer):
                seen += 1
                if seen == len(ow):
                    end = m.end()
                    break
            tail = re.match(r"[.!?…]+", answer[end:])
            return (answer[:end] + (tail.group(0) if tail else "")).strip()
    return ""


def fixed_line(answered: list[str]) -> str:
    """The campaign line a planner fixed in an answered open question, or ''. The last such answer wins."""
    line = ""
    for item in answered or []:
        parts = _QA_SPLIT.split(str(item), maxsplit=1)
        if len(parts) == 2 and (_LINE_Q.search(parts[0]) or _VERBATIM.search(parts[1])) and not _LEGAL_Q.search(parts[0]):
            got = _answer_line(parts[0], parts[1])
            if got:
                line = got
    return line


def carry_fixed_line(mandatories, line: str):
    """``mandatories`` (a list or a string) with "End line: '<line>' (word for word)" in it: an end-line item that names
    another line is replaced, and nothing changes when the line is already there. -> the new value, or None when it
    already held the line (or there is no line)."""
    if not line:
        return None
    items = [x for x in (mandatories if isinstance(mandatories, list) else
                         [s for s in re.split(r"\s*[;\n]\s*", mandatories or "") if s.strip()]) if text_of(x)]
    want = _norm_words(line)
    if any(" ".join(want) in " ".join(_norm_words(text_of(x))) for x in items):
        return None
    item = f"End line: '{line}' (word for word)"
    kept = [x for x in items if not _END_LINE_ITEM.match(text_of(x))]
    return [item] + kept
