"""Brief check and Brief gate (feature brief-gate): the scorecard's gaps as questions for the client, the gate's
six groups, the two new checks, and one scorecard definition."""

import json
import re
from pathlib import Path

import pytest

from napkin.brief import capture, gate
from napkin.brief.questions import dedupe
from napkin.brief.rubric import FAIL, PASS, REVIEW

REPO = Path(__file__).resolve().parents[2]


def card(**verdicts):
    """A scorecard of the seven dimensions, all pass but the ones named."""
    return {"dimensions": [{"dimension": d, "verdict": verdicts.get(d, "pass")} for d in capture.SCORECARD_DIMENSIONS],
            "single_mindedness": {"verdict": "single", "split_into": []}, "summary": "-"}


def test_a_j001_brief_with_no_objective_gives_exactly_one_question_about_the_objective():
    sc = card(objectives_quality="missing")
    # the capture's own gap question for the same thing, as the job gathers them
    asked = ["[blocker] What is the objective? — Without it the work has nothing to be judged against."]
    questions, _ = dedupe(asked + gate.scorecard_questions(sc, signers_named=True))
    assert len([q for q in questions if "objective" in q.lower()]) == 1


def test_each_dimension_short_of_a_pass_is_one_question_and_the_evidence_is_quoted():
    sc = card(objectives_quality="vague", language="missing")
    sc["dimensions"][0]["evidence"] = "grow consideration among younger drinkers"
    qs = gate.scorecard_questions(sc, signers_named=True)
    assert len(qs) == 2
    assert 'The brief says "grow consideration among younger drinkers".' in qs[0]
    assert gate.scorecard_questions(card(), signers_named=True) == []


def test_brief_check_asks_who_signs_off_unless_it_is_known():
    assert gate.scorecard_questions(card())[-1] == gate.SIGNERS
    assert gate.SIGNERS not in gate.scorecard_questions(card(), signers_named=True)
    assert gate.scorecard_questions(None) == []


def test_the_gate_has_six_items_over_the_existing_checks():
    assert list(gate.GATE_GROUPS) == ["proposition", "insight", "objective", "feel_or_do", "famous", "baseline"]
    from napkin.brief.fields import RUBRIC_FIELDS
    new = {"famous", "baseline"}
    for item, ids in gate.GATE_GROUPS.items():
        for rid in ids:
            assert rid in RUBRIC_FIELDS or rid in new, (item, rid)


@pytest.mark.parametrize("flag,status", [("", REVIEW), ("on", FAIL)])
def test_a_brief_with_no_baseline_fails_the_sixth_item_only_with_the_flag_on(monkeypatch, flag, status):
    monkeypatch.setenv("NAPKIN_BRIEF_GATE", flag)
    got = gate.check_baseline(["Track consideration monthly."])
    assert got["status"] == status
    assert gate.check_baseline(["Baseline: 6% of orders. Target: 14% by December."])["status"] == PASS
    assert gate.check_famous("")["status"] == status
    assert gate.check_famous("A bar that closes its doors for one song.")["status"] == REVIEW  # the judge decides


def test_there_is_one_scorecard_definition():
    # the engine's list is read from its schema, and equals the middleware's
    text = (REPO / "engine/brief_object.schema.json").read_text()
    found = re.search(r'"dimension": \{"enum": (\[[^\]]*\])', text)
    assert json.loads(found.group(1)) == capture.SCORECARD_DIMENSIONS
    defs = []
    for root in ("server", "engine"):
        for f in (REPO / root).rglob("*.py"):
            if ".venv" in f.parts:
                continue
            defs += [str(f.relative_to(REPO)) for m in re.finditer(r"^SCORECARD_DIMENSIONS\s*=", f.read_text(errors="ignore"), re.M)]
    assert defs == ["server/napkin/brief/capture.py"]
