"""Intake: the few questions Brief Maker may ask before it plans (feature brief-intake-qa).

Rules over the capture, no model call: Ellis has just read what the client said, so what a core
item lacks is known. At most `cap` questions, in priority order, each a gap that one sentence from
the planner would settle. Never asked: tone, insight, barrier, proposition, objection, reasons to
believe, competitors. Those are the planner's and Sam's work (strategic-planning skill), not the
client's to supply.

An answer is the client's word, as the planner gave it: it becomes one material ("Intake answers")
and one capture item per answer, the quote the answer verbatim, so the part it feeds rests on the
client with no "To confirm:" mark. It is never a field write: a field a person holds is proposed,
not written (middleware-api.md §10.5).

A question skipped, or not answered in time, changes nothing: the part is an assumption marked
"To confirm:" and the question stays in open_questions with the wording used here."""

from __future__ import annotations

import hashlib

from .capture import Material, cap_id, format_question, material_id

NAME = "Intake answers"

# (key, capture keys that settle it, capture key an answer is filed under, the question, why, priority)
# In priority order. `client` is settled by the capture's named client, not by an item.
ASKS = [
    ("client", (), "background_context", "Which client and brand is this brief for?",
     "The brief is filed under the client, and the research starts from the brand.", "blocker"),
    ("objective", ("objective", "success_metrics"), "objective",
     "What is the one thing this work must achieve, and how will you measure it?",
     "The single most important thing to achieve, with its measure: a brief without one cannot be judged.",
     "blocker"),
    ("audience", ("target_audience",), "target_audience", "Who exactly is this for?",
     "If we cannot picture them, neither can the creatives.", "blocker"),
    ("budget", ("budget",), "budget", "What is the budget, and does it include VAT and the media?",
     "Scope and ambition depend on the money; a figure is never invented for the brief.", "important"),
    ("mandatories", ("mandatories", "constraints"), "mandatories",
     "Is there a line, a hero product or a legal line that must appear, or anything to avoid?",
     "The one soft mandatory the client will not say is the one that sinks the first round.", "important"),
    ("timeline", ("timeline",), "timeline", "When does it need to be live, and by when must it be agreed?",
     "It decides what can be done and when the pitch is.", "important"),
]
KEYS = [a[0] for a in ASKS]
# What each question is about, in words: a model's question using only these (and the intake question's own
# words) is the question that was answered (questions.without_answered).
ANCHORS = {"client": "client brand name", "objective": "objective goal measure kpi success",
           "audience": "audience target", "budget": "budget", "mandatories": "mandatory appear avoid",
           "timeline": "timeline timing date deadline"}


def questions(items: dict, named: dict, cap: int) -> list[dict]:
    """The questions the capture leaves open, most important first, at most `cap`. `items` is every capture
    item the brief holds (this job's and the document's), so an answer given before is never asked again."""
    have = {i.get("key") for i in (items or {}).values()}
    out = []
    for key, settled_by, _, text, why, prio in ASKS:
        if key == "client":
            if (named or {}).get("client"):
                continue
        elif any(k in have for k in settled_by):
            continue
        out.append({"id": f"q_{key}", "key": key, "text": text, "why": why, "priority": prio, "skippable": True})
    return out[:max(0, int(cap))]


def worded(q: dict) -> str:
    """The question as open_questions holds it: `[priority] question — why`."""
    return format_question({"question": q["text"], "why_it_matters": q["why"], "priority": q["priority"]})


def answer_items(asked: list[dict], answers: dict) -> tuple[Material | None, dict, list[dict], list[dict]]:
    """(material, capture items, answered questions, skipped questions). A question with no answer, or a blank
    one, is skipped: it builds nothing. The material's id comes from its text, so the same answers are the same
    ids; each item's quote is the answer exactly as given, found in the material."""
    file_under = {a[0]: a[2] for a in ASKS}
    done, skipped = [], []
    for q in asked:
        a = answers.get(q["id"])
        (done if isinstance(a, str) and a.strip() else skipped).append(q)
    if not done:
        return None, {}, [], skipped
    text = "\n\n".join(f"Q: {q['text']}\nA: {answers[q['id']].strip()}" for q in done)
    sha = hashlib.sha256(text.encode()).hexdigest()
    mat = Material(material_id(sha), "other", NAME, sha, text=text, media_type="text/plain")
    items = {}
    for q in done:
        value = answers[q["id"]].strip()
        key = file_under[q["key"]]
        items[cap_id(key, value, mat.id)] = {"key": key, "value": value, "status": "fact", "material_id": mat.id,
                                             "quote": value}
    return mat, items, done, skipped
