"""The client questions, each gap asked once (brief/planned.py gathers them from the plan, the
draft and the Review agent; job.py from the capture and the verdicts).

Two questions that ask for the same thing in different words ("What is the launch budget?",
"What budget has been set for this?") are one question. The check is by rule, not by a model
call: the brief is already slow, and a rule gives the same answer twice. It is cautious: a
question with one meaningful word only matches an identical one, so "the budget" and "the media
budget" stay two questions. The first one keeps its wording and its place."""

from __future__ import annotations

import re

from .intake import ANCHORS

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


# Words that ask for the same thing in other words become one word first (acceptance run A6, 2026-11-25: "Is there budget
# for a pre-launch tracker wave and a regional holdout?" came back as "Is there money for a tracker wave before April
# and an area with no posters to compare against?"). Phrase first, then the word.
_SAME = [
    (re.compile(r"\b(?:an?\s+)?(?:area|region|market|city|town)s?\s+(?:with\s+)?(?:no|without)\s+(?:\w+\s+){0,3}?(?:to\s+)?(?:compare|comparison|control)(?:\s+(?:against|with))?\b"), " holdout "),
    (re.compile(r"\b(?:hold[\s-]?outs?|control\s+(?:area|region|group|market)s?|test[\s-]and[\s-]control|geo[\s-]?(?:test|split|comparison)s?)\b"), " holdout "),
    (re.compile(r"\b(?:pre[\s-]?launch|before\s+(?:the\s+)?(?:launch|go[\s-]?live|january|february|march|april|may|june|july|august|september|october|november|december|spring|summer|autumn|winter))\b"), " prelaunch "),
    (re.compile(r"\b(?:money|funds?|funding|spend|budgets?)\b"), " budget "),
    (re.compile(r"\b(?:brand\s+)?(?:tracker|tracking)(?:\s+(?:survey|study|wave)s?)?\b"), " tracker "),
]


def _same_words(text: str) -> str:
    for rx, to in _SAME:
        text = rx.sub(to, text)
    return text


def terms(question: str) -> frozenset[str]:
    """What the question is about: its meaningful words, lower-cased and singular, with words that ask for the same
    thing made one (_SAME). The `[priority]` prefix and the `— why it matters` clause are not part of the ask."""
    text = _same_words(_PRIORITY.sub("", question or "").split(" — ")[0].lower())
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
    # a longer ask needs less of its words to match: five shared words are not a coincidence, and four shared words
    # carry most of a seven-word ask ("existing liquid customers switch", UAT round 4: asked twice)
    return (inter / len(small) >= (0.6 if len(small) >= 5 else 0.75) or inter / len(ta | tb) >= 0.6
            or (inter >= 4 and inter / len(small) >= 0.55))


def _figures(question: str) -> frozenset[str]:
    """The figures a question is about ("99.9%", "€70k"): a shared figure ties two asks to one subject."""
    return frozenset(t for t in terms(question) if any(c.isdigit() for c in t))


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
    parent: dict[str, str] = {}  # each ask -> the kept question it came from
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
        fresh, hits = [], []
        for a in asks:
            hit = next((k for k in asked if same_ask(k, a)), None)
            if hit is None:
                fresh.append(a)
            else:
                merged.append((hit, a))
                hits.append(parent.get(hit, hit))
        if not fresh:
            continue
        leaning = [f for f in fresh if _LEANS.search(f)]
        # A leftover ask that leans on the dropped half ("does it support 99.9%…?") and names the same figure as the
        # question that half came from is that question again (UAT round 4: the lab-report question asked twice).
        if hits and leaning and len(leaning) == len(fresh) and all(_figures(f) and any(_figures(f) & _figures(h) for h in hits) for f in fresh):
            merged.extend((hits[0], f) for f in fresh)
            continue
        if len(fresh) == len(asks) or leaning:
            kept.append(q)
        else:
            kept.append(" and ".join(f[0].lower() + f[1:] if i else f for i, f in enumerate(f.rstrip("?") for f in fresh)) + "?")
        for f in fresh:
            parent[f] = kept[-1]
        asked.extend(fresh)
    return kept, merged


# An open question the planner answered (or left open, with why) keeps its words and gains the answer in the same
# list item: "Q? — Answer: Yes" (brief-maker answerQ). The page reads the item back with this shape.
_QA = re.compile(r"\s+—\s+(?:Answer|Left open):\s*\S")


def answered_items(items) -> list[str]:
    """The items of open_questions the planner has already answered or left open: a redraft keeps them
    (UAT 2026-11-22: Draft it again dropped nine answers and asked the questions again)."""
    return [x.strip() for x in items or [] if isinstance(x, str) and _QA.search(x)]


def without_answered(questions: list[str], answered: dict[str, str]) -> list[str]:
    """The questions with those the person already answered at intake taken out (brief/intake.py).
    `answered` maps an intake key to the words it was asked in. A question goes when everything it is about
    sits inside what that key is about (its anchor words and the intake question's own): "What is the launch
    budget?" goes after a budget answer, "What is the media budget split?" stays, as it asks something more.
    This is a filter on the key, not `same_ask`: a one-word question only matches an identical one there."""
    known = [terms(ANCHORS.get(k, k)) | terms(asked) for k, asked in answered.items()]
    out = []
    for q in questions:
        t = terms(q)
        if t and any(t <= k for k in known):
            continue
        out.append(q)
    return out
