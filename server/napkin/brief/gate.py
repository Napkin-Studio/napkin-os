"""Brief check and Brief gate (feature brief-gate; build prompt v2 section 6).

One scorecard, not three: the BetterBriefs scorecard in capture.py (SCORECARD_DIMENSIONS) is the only
one. Brief check reads it and turns each dimension that is not a pass into one question for the client,
and asks who signs off. The gate's six items are named groups of the checks that already exist, plus two
new ones, `famous` and `baseline`, below. Whether a gate item is met is the host's to say (crates/
napkin-host/src/ops/gate.rs): a missing item is on the lock list, so /approve refuses. This file holds
what the middleware adds: the questions, the groups, and the two new checks.

The two new checks start as `review`, never `fail`, until the flag NAPKIN_BRIEF_GATE is on, so a brief
that locks today still does."""

from __future__ import annotations

import os
import re

from .capture import SCORECARD_DIMENSIONS
from .rubric import FAIL, PASS, REVIEW

# The gate's six items, each the rubric checks it is a view over (middleware-api.md 10.8). `famous` and
# `baseline` are the two that had no check.
GATE_GROUPS = {
    "proposition": ["smp"],
    "insight": ["insight"],
    "objective": ["objectives"],
    "feel_or_do": ["desired_response"],
    "famous": ["famous"],
    "baseline": ["measurement", "baseline"],
}

# What the client is asked when a scorecard dimension is not a pass: one question per dimension, said so the
# same ask in the brief's other gaps merges with it (questions.dedupe).
ASK = {
    "objectives_quality": "What is the objective? — Give the number it should reach and the date it should reach it by.",
    "audience_vividness": "Who is the audience? — Describe them as a person: what they want, and who this is not for.",
    "single_minded_message": "What is the key message? — The one thing the client wants people to take away.",
    "evaluation_criteria": "What are the evaluation criteria? — How the client will judge the work, and who makes the call.",
    "budget_interlock": "What is the budget? — Whether it matches what the client wants to achieve.",
    "strategic_clarity": "What is the strategic angle? — The choice the client has made, and what the work should not do.",
    "language": "Which words in the brief need defining? — Terms the agency should not have to guess at.",
}
SIGNERS = "Who signs this brief off at the client, and who signs it at the agency?"

NAMED_SIGNERS = ("decision_makers",)


def enabled() -> bool:
    """The two new checks fail (rather than ask for a person) only with the flag on."""
    return os.environ.get("NAPKIN_BRIEF_GATE", "").strip().lower() == "on"


def scorecard_questions(scorecard: dict | None, *, signers_named: bool = False) -> list[str]:
    """One question for the client per scorecard dimension that is vague or missing, in the scorecard's order,
    each with the evidence the judge quoted; and, unless someone is named, who signs off."""
    out = []
    for d in (scorecard or {}).get("dimensions") or []:
        dim = d.get("dimension")
        if dim not in SCORECARD_DIMENSIONS or d.get("verdict") == "pass":
            continue
        q = ASK[dim]
        ev = str(d.get("evidence") or "").strip().rstrip(".")
        if ev:
            q = f"{q} The brief says \"{ev}\"."
        out.append(q)
    if scorecard and not signers_named:
        out.append(SIGNERS)
    return out


_ANCHOR = re.compile(r"baseline|benchmark|last (?:year|quarter|month|autumn|spring|summer|winter)|currently|today", re.I)


def check_baseline(measurement) -> dict:
    """The effectiveness plan names what to measure against: a baseline, and a number."""
    text = " ".join(measurement) if isinstance(measurement, list) else str(measurement or "")
    if not text.strip():
        return {"check": "baseline", "method": "auto", "status": REVIEW, "note": "empty"}
    if _ANCHOR.search(text) and re.search(r"\d", text):
        return {"check": "baseline", "method": "auto", "status": PASS, "note": "names a baseline"}
    return {"check": "baseline", "method": "auto", "status": FAIL if enabled() else REVIEW,
            "note": "no baseline to measure against"}


def check_famous(famous) -> dict:
    """What would make this famous. Code decides only that it is said; whether it is a real idea about
    fame is the Judge's call (a model check), and the creative director can overrule it with a reason."""
    if not str(famous or "").strip():
        return {"check": "famous", "method": "auto", "status": FAIL if enabled() else REVIEW, "note": "not said"}
    return {"check": "famous", "method": "llm", "status": REVIEW, "note": "the judge to decide"}


def gate_checks(values: dict) -> list[dict]:
    """The two new checks over a brief's app values."""
    return [check_famous(values.get("famous")), check_baseline(values.get("measurement"))]
