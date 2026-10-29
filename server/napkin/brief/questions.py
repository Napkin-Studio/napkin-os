"""The client questions, each gap asked once (brief/planned.py gathers them from the plan, the
draft and Jude; job.py from the capture and the verdicts).

Two questions that ask for the same thing in different words ("What is the launch budget?",
"What budget has been set for this?") are one question. The check is by rule, not by a model
call: the brief is already slow, and a rule gives the same answer twice. It is cautious: a
question with one meaningful word only matches an identical one, so "the budget" and "the media
budget" stay two questions. The first one keeps its wording and its place."""

from __future__ import annotations

import re

# Words that do not say what is being asked: question words, glue, and the words every
# question to a client about a brief carries.
_GLUE = set("""
a an the of for to and or in on at by with from into about as is are was were be been being
has have had do does did can could will would should shall may might must
this that these those it its there their they them our we us you your
what which who whom whose how when where why any some more other another
please need needs needed know tell say said confirm confirmed agree agreed
client clients brief briefs campaign campaigns project projects
launch set sets planned intended expected available existing current
""".split())

_PRIORITY = re.compile(r"^\s*\[[^\]]*\]\s*")
_WORD = re.compile(r"[a-z0-9€£$%]+")


def terms(question: str) -> frozenset[str]:
    """What the question is about: its meaningful words, lower-cased and singular.
    The `[priority]` prefix and the `— why it matters` clause are not part of the ask."""
    text = _PRIORITY.sub("", question or "").split(" — ")[0].lower()
    out = set()
    for w in _WORD.findall(text):
        if w in _GLUE:
            continue
        if len(w) > 3 and w.endswith("s") and not w.endswith("ss"):
            w = w[:-1]
        out.add(w)
    return frozenset(out)


def same_ask(a: str, b: str) -> bool:
    """True when the two questions ask for the same thing."""
    ta, tb = terms(a), terms(b)
    if not ta or not tb:
        # Nothing but question words ("When is it?"): only an identical question matches.
        return " ".join(_WORD.findall(a.lower())) == " ".join(_WORD.findall(b.lower()))
    if ta == tb:
        return True
    small = min(ta, tb, key=len)
    if len(small) < 2:
        return False
    inter = len(ta & tb)
    return inter / len(small) >= 0.75 or inter / len(ta | tb) >= 0.6


def dedupe(questions: list[str]) -> tuple[list[str], list[tuple[str, str]]]:
    """The questions with each ask once, in order, and the pairs that were merged as
    `(kept, dropped)` so a wrong merge can be seen in the run log."""
    kept: list[str] = []
    merged: list[tuple[str, str]] = []
    for q in questions:
        q = (q or "").strip()
        if not q:
            continue
        twin = next((k for k in kept if same_ask(k, q)), None)
        if twin is None:
            kept.append(q)
        elif twin != q:
            merged.append((twin, q))
    return kept, merged
