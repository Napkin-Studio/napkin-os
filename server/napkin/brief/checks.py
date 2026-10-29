"""First-draft checks (feature brief-first-draft-checks, ADR 0035).

The default flow writes the whole brief in one call, so the per-field rubric (judge.py) never saw a first
draft. These are the pieces of it that the whole-brief review can use: what code can measure (words against a
part's limit, sentences, a standalone 'and' in the proposition), the planning skill's tests for the five parts
Jude judges, and the one rule about marking: an assumption says it is one.

Code decides only what it can measure. Whether an 'and' joins two thoughts, or an objection is one doubt, is
Jude's call, given the test."""

from __future__ import annotations

from .fields import RUBRIC_FIELDS
from .rubric import _sentences, and_flag

# the app's part -> the schema's rubric field
APP_RUBRIC = {"background": "background", "audience": "audience", "budget_and_scope": "budget_scope",
              "competitor_context": "competitor_context", "insight": "insight", "single_minded_proposition": "smp",
              "tone_and_world": "tone_world_assets", "mandatories": "mandatories", "job": "job",
              "barrier": "barrier", "objection": "objection"}
# the five parts Jude judges against the skill's tests
TESTED = ("insight", "single_minded_proposition", "job", "barrier", "objection")
# one sentence at most: a word or a phrase is fine (Laurence, 3 Oct), several sentences are several thoughts
ONE_SENTENCE = ("single_minded_proposition", "job", "objection")
# over its limit by more than this, a part goes back; a few words over does not
MARGIN = 1.15
MARK = "To confirm:"
# the proposition and the objection rest on the insight: when it is an assumption, so are they
INHERIT = ("single_minded_proposition", "objection")


def text_of(v) -> str:
    if isinstance(v, list):
        return "; ".join(text_of(x) for x in v if text_of(x))
    return v.strip() if isinstance(v, str) else ""


def limit(key: str) -> int | None:
    rid = APP_RUBRIC.get(key)
    return (RUBRIC_FIELDS.get(rid) or {}).get("max_words") if rid else None


def facts(whole: dict) -> dict:
    """What code measured, per part Jude judges or that has a limit."""
    out = {}
    for k, e in whole.items():
        t = text_of(e.get("value"))
        if not t:
            continue
        f = {}
        lim = limit(k)
        if lim:
            f["words"], f["limit"] = len(t.split()), lim
        if k in ONE_SENTENCE:
            f["sentences"] = len(_sentences(t))
        if k == "single_minded_proposition":
            f["standalone_and"] = and_flag(t)
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
        if f.get("sentences", 0) > 1:
            why.append(f"it is {f['sentences']} sentences: say it in one (a word or a phrase is fine)")
        if why:
            out.append({"part": k, "instruction": "; ".join(why).capitalize() + "."})
    return out


def tests(keys) -> dict:
    """The planning skill's judged tests for the five parts, as the schema words them."""
    out = {}
    for k in keys:
        rid = APP_RUBRIC.get(k)
        if k in TESTED and rid:
            out[k] = {c["id"]: c["test"] for c in RUBRIC_FIELDS[rid]["rubric"] if c["method"] == "llm"}
    return out


def mark_assumptions(entries: dict, insight: dict | None = None) -> list[str]:
    """Mark each assumption 'To confirm:' (idempotent), and the proposition and objection when the insight they
    rest on is one. Run on Dara's raw output, before provenance reads the sentences, so a claim and its sentence
    stay the same text. Lists, client words and research stay as they are. `insight`: the insight already held,
    when this output does not carry one. -> the parts marked now."""
    marked = []

    def put(k, e):
        v = e.get("value")
        if isinstance(v, str) and v.strip() and not v.strip().lower().startswith("to confirm"):
            e["value"] = f"{MARK} {v.strip()}"
            marked.append(k)

    for k, e in entries.items():
        if isinstance(e, dict) and e.get("basis") == "assumption":
            put(k, e)
    ins = entries.get("insight") or insight
    if isinstance(ins, dict) and (ins.get("basis") == "assumption" or text_of(ins.get("value")).lower().startswith("to confirm")):
        for k in INHERIT:
            e = entries.get(k)
            if isinstance(e, dict) and e.get("basis") not in ("client", "person", "research"):
                put(k, e)
    return marked
