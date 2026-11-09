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

# "Is the budget inclusive of VAT, and does it cover only production?" is two asks in one question.
_JOIN = re.compile(r",?\s+and\s+(?=(?:which|what|who|whom|how|when|where|why|does|do|did|is|are|was|were|should|can|could|will|would|has|have)\b)", re.I)
# a leftover ask that leans on the half that was dropped ("what do they run?") is kept with its question
_LEANS = re.compile(r"\b(they|them|their|it|its|this|that|those|these|he|she|him|her)\b", re.I)
_PRIORITY = re.compile(r"^\s*\[[^\]]*\]\s*")
_WORD = re.compile(r"[a-z0-9€£$%]+")
_CURRENCY = re.compile(r"^[€£$]")


def terms(question: str) -> frozenset[str]:
    """What the question is about: its meaningful words, lower-cased and singular.
    The `[priority]` prefix and the `— why it matters` clause are not part of the ask."""
    text = _PRIORITY.sub("", question or "").split(" — ")[0].lower()
    out = set()
    for w in _WORD.findall(text):
        if w in _GLUE:
            continue
        w = _CURRENCY.sub("", w)  # "€70k" and "70k" are the same figure
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
    # a longer ask needs less of its words to match: five shared words are not a coincidence
    return inter / len(small) >= (0.6 if len(small) >= 5 else 0.75) or inter / len(ta | tb) >= 0.6


def _asks(question: str) -> list[str]:
    """The separate asks inside one question, each ending with its own question mark."""
    body = question.strip().rstrip("?").strip()
    why = ""
    if " — " in body:
        body, why = body.split(" — ", 1)
        why = " — " + why
    asks = [a.strip() for a in _JOIN.split(body) if a.strip()]
    return [a[0].upper() + a[1:] + "?" for a in asks] if len(asks) > 1 else [question.strip()] if not why else [question.strip()]


def dedupe(questions: list[str]) -> tuple[list[str], list[tuple[str, str]]]:
    """The questions with each ask once, in order, and the pairs that were merged as
    `(kept, dropped)` so a wrong merge can be seen in the run log. A question that asks two things, one of
    them already asked, keeps only the new one."""
    kept: list[str] = []
    asked: list[str] = []  # every single ask kept so far
    merged: list[tuple[str, str]] = []
    for q in questions:
        q = (q or "").strip()
        if not q:
            continue
        twin = next((k for k in kept if same_ask(k, q)), None)
        if twin is not None:
            if twin != q:
                merged.append((twin, q))
            continue
        asks = _asks(q)
        fresh = []
        for a in asks:
            hit = next((k for k in asked if same_ask(k, a)), None)
            if hit is None:
                fresh.append(a)
            else:
                merged.append((hit, a))
        if not fresh:
            continue
        if len(fresh) == len(asks) or any(_LEANS.search(f) for f in fresh):
            kept.append(q)
        else:
            kept.append(" and ".join(f[0].lower() + f[1:] if i else f for i, f in enumerate(f.rstrip("?") for f in fresh)) + "?")
        asked.extend(fresh)
    return kept, merged
