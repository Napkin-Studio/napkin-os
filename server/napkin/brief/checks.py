"""First-draft checks (feature brief-first-draft-checks, ADR 0035).

The default flow writes the whole brief in one call, so the per-field rubric (judge.py) never saw a first
draft. These are the pieces of it that the whole-brief review can use: what code can measure (words against a
part's limit, sentences, a standalone 'and' in the proposition), the planning skill's tests for the parts
Jude judges, and the one rule about marking: an assumption says it is one.

Code decides only what it can measure. Whether an 'and' joins two thoughts, or an objection is one doubt, is
Jude's call, given the test."""

from __future__ import annotations

import re

from .fields import RUBRIC_FIELDS
from .rubric import _sentences, and_flag

# the app's part -> the schema's rubric field
APP_RUBRIC = {"background": "background", "audience": "audience", "budget_and_scope": "budget_scope",
              "competitor_context": "competitor_context", "insight": "insight", "single_minded_proposition": "smp",
              "tone_and_world": "tone_world_assets", "mandatories": "mandatories", "job": "job", "reasons_to_believe": "reasons_to_believe",
              "barrier": "barrier", "objection": "objection", "media_roles": "media_roles", "measurement": "measurement"}
# the parts Jude judges against the skill's tests, and the words the review prompt names them by
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


def _spoken(v) -> str:
    """The words of a part, without the 'To confirm:' mark: the mark is not part of what is said."""
    return re.sub(r"(?i)^\s*to confirm:\s*", "", text_of(v))


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
    """What code measured, per part Jude judges or that has a limit."""
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
        if f:
            out[k] = f
    return out


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
        if why:
            out.append({"part": k, "instruction": "; ".join(why).capitalize() + "."})
    return out


def tests(keys) -> dict:
    """The planning skill's judged tests for the parts in TESTED, as the schema words them."""
    out = {}
    for k in keys:
        rid = APP_RUBRIC.get(k)
        if k in TESTED and rid:
            out[k] = {c["id"]: c["test"] for c in RUBRIC_FIELDS[rid]["rubric"] if c["method"] == "llm"}
    return out


def _mark(k: str, e: dict) -> bool:
    """Put the mark on the part's text (idempotent): the value, or for MARKED_LISTS its first item. -> whether it marked."""
    v = e.get("value")
    if k in MARKED_LISTS and isinstance(v, list):
        first = next((i for i, x in enumerate(v) if isinstance(x, str) and x.strip()), None)
        if first is not None and not v[first].strip().lower().startswith("to confirm"):
            v[first] = f"{MARK} {v[first].strip()}"
            return True
    elif isinstance(v, str) and v.strip() and not v.strip().lower().startswith("to confirm"):
        e["value"] = f"{MARK} {v.strip()}"
        return True
    return False


def mark_assumptions(entries: dict, insight: dict | None = None) -> list[str]:
    """Mark each assumption 'To confirm:' (idempotent), and the proposition and objection when the insight they
    rest on is one. Run on Dara's raw output, before provenance reads the sentences, so a claim and its sentence
    stay the same text. Lists (but for MARKED_LISTS, which mark their first item), client words and research stay
    as they are. `insight`: the insight already held, when this output does not carry one. -> the parts marked now."""
    marked = []

    def put(k, e):
        if _mark(k, e):
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
    """Provenance moved some parts to 'assumption' (Dara said research, library or client; nothing tied the claim).
    They say so too. A part with figures is left as it is: a mark in front of its first sentence would stop the
    sentence from tying to its claim."""
    marked = []
    for k, e in entries.items():
        if k in IDENTITY or not isinstance(e, dict) or not e.get("downgraded") or e.get("basis") != "assumption":
            continue
        if not re.search(r"\d", text_of(e.get("value"))) and _mark(k, e):
            marked.append(k)
    return marked
