"""Offline tests: an investor why_now (or what_we_know) slide with no source is a gap, held behind the
Appendix and asked for; a supported one stays presented. Invented inputs, no model call. Run from ``engine/``."""
from __future__ import annotations

import pytest

from deck import assemble, inputs, intake, profiles, validate

PROMPT = "Dockhand matches proof of delivery to invoices for independent wholesalers. Pilot with twelve wholesalers."
PLACEHOLDER = "The inputs state no change in the world: to confirm with the founders"


def _stage(why_points, extra=None):
    secs = [{"type": "problem", "title": "Wholesalers lose a week a month", "points": [{"text": "Paperwork costs a week every month", "refs": ["prompt:1"]}]},
            {"type": "why_now", "title": "Why this moment", "points": why_points}]
    secs += extra or []
    return {"i": {"cover": {"title": "Dockhand"}, "sections": secs}}


def _build(why_points, answers=None, extra=None, **kw):
    inp = inputs.load(None, prompt_text=PROMPT, answers=answers or {})
    return assemble.build_investor(inp, _stage(why_points, extra), client="Dockhand", project="Seed",
                                   profile=profiles.load("investor_seed"), **kw)


def _types(deck):
    return [deck["slides"][s]["type"] for s in deck["order"]]


def _presented(deck):
    return [deck["slides"][s]["type"] for s in validate.presented(deck)]


GAP = [{"text": PLACEHOLDER, "basis": "proposal"}]


def test_a_placeholder_only_why_now_goes_behind_the_appendix():
    deck = _build(GAP)
    t = _types(deck)
    assert "why_now" not in _presented(deck)
    assert t.index("appendix") < t.index("why_now")   # kept, not deleted
    sl = next(s for s in deck["slides"].values() if s["type"] == "why_now")
    assert sl["status"] == "needs_human" and sl["label"].startswith("Gap to fill") and "Gap to fill" in sl["notes"]
    assert PLACEHOLDER in str(sl["blocks"])


@pytest.mark.parametrize("points", [
    [{"text": "A new water-use rule takes effect in 2027", "refs": ["prompt:1"]}],
    [{"text": "Pilot with twelve wholesalers", "refs": ["prompt:1"], "basis": "sourced"}]])
def test_a_supported_why_now_stays_presented(points):
    deck = _build(points)
    assert "why_now" in _presented(deck)
    assert assemble.investor_gaps(deck) == []


def test_the_presented_count_and_limit_are_unaffected():
    gap, ok = _build(GAP), _build([{"text": "A new rule takes effect", "refs": ["prompt:1"]}])
    assert len(_presented(gap)) == len(_presented(ok)) - 1
    assert len(_presented(gap)) <= gap["meta"]["length"]["max_slides"]
    assert gap["meta"]["length"] == ok["meta"]["length"]


def test_the_question_card_is_present_and_in_the_questions_slide():
    deck = _build(GAP)
    assert assemble.investor_gaps(deck) == ["why_now"]
    cards = intake.gap_questions(assemble.investor_gaps(deck))
    assert [c["id"] for c in cards] == ["q_supply_why_now"] and cards[0]["kind"] == "supply" and cards[0]["address"] == "slide.why_now"
    q = next(s for s in deck["slides"].values() if s["type"] == "questions")
    assert cards[0]["text"] in str(q["blocks"])
    assert intake.gap_questions(assemble.investor_gaps(_build([{"text": "x", "refs": ["prompt:1"]}]))) == []


def test_a_what_we_know_gap_is_handled_the_same_way():
    deck = _build([{"text": "A rule takes effect", "refs": ["prompt:1"]}],
                  extra=[{"type": "what_we_know", "title": "What we learned", "points": [{"text": "to confirm with the founders", "basis": "proposal"}]}])
    assert "what_we_know" not in _presented(deck) and "what_we_know" in _types(deck)
    assert [c["id"] for c in intake.gap_questions(assemble.investor_gaps(deck))] == ["q_supply_what_we_know"]


def test_an_answer_to_the_card_brings_the_slide_back_into_the_story():
    deck = _build(GAP, answers={"q_supply_why_now": {"text": "The 2027 water-use rule makes metering mandatory.", "by": "Founder"}})
    assert "why_now" in _presented(deck)
    sl = next(s for s in deck["slides"].values() if s["type"] == "why_now")
    assert sl["status"] == "from_source" and sl["supplied"]["refs"] == ["answer:q_supply_why_now"]
    assert assemble.investor_gaps(deck) == []
