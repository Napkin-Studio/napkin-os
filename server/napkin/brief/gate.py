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

# What the client is asked when a scorecard dimension is not a pass: one plain question per dimension, worded
# as the capture's own gap questions are (capture.core_gap_questions), so the same ask in the brief's other
# gaps is one question (questions.dedupe). No em dash: the interface does not use them.
ASK = {
    "objectives_quality": "What is the objective?",
    "audience_vividness": "Who is the audience?",
    "single_minded_message": "What is the key message?",
    "evaluation_criteria": "What are the evaluation criteria?",
    "budget_interlock": "What is the budget?",
    "strategic_clarity": "What is the strategic angle?",
    "language": "Which words in the brief need defining?",
}
SIGNERS = "Who signs this brief off at the client, and who signs it at the agency?"

NAMED_SIGNERS = ("decision_makers",)


def enabled() -> bool:
    """The two new checks fail (rather than ask for a person) only with the flag on."""
    return os.environ.get("NAPKIN_BRIEF_GATE", "").strip().lower() == "on"


def scorecard_questions(scorecard: dict | None, *, signers_named: bool = False) -> list[str]:
    """One question for the client per scorecard dimension that is vague or missing, in the scorecard's order;
    and, unless someone is named, who signs off. The evidence the judge quoted stays on the scorecard."""
    out = [ASK[d["dimension"]] for d in (scorecard or {}).get("dimensions") or []
           if d.get("dimension") in SCORECARD_DIMENSIONS and d.get("verdict") != "pass"]
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
