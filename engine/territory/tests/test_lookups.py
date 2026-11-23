"""territories-lookups: the OK card, one paid look-up through the research port, a pin only for a checked quote and a named person.
Run from engine/: ``PYTHONPATH=. python -m pytest -q territory/tests/test_lookups.py`` (needs jsonschema). Tavily and the model are STUBBED here: no call is made."""
from __future__ import annotations

import copy
import json
import re

import pytest

pytest.importorskip("jsonschema")
import jsonschema  # noqa: E402

from territory import contract, lookups, spend as sp  # noqa: E402

SCHEMA = contract.schema()
PRICE = re.compile(r"(€|\$|£)\s?\d|\b(USD|EUR|GBP)\b|usd|cost", re.I)


class Port:
    """A stand-in research port: counts real calls and answers in the port's shape."""

    def __init__(self, sources=None, fail=None):
        self.n, self.fail = 0, fail
        self.sources = sources if sources is not None else [
            {"id": "src_1", "url": "https://example.org/rail-survey", "publisher": "Example Rail Survey", "title": "Rail", "retrieved_at": "2026-11-23",
             "published_at": "2025-06", "excerpts": ["54% of rail passengers count the journey as part of the trip.", "Families book table seats first."]},
            {"id": "src_2", "url": "https://example.com/forum", "publisher": "", "title": "Forum", "retrieved_at": "2026-11-23",
             "excerpts": [{"quote": "The ride west is the highlight.", "checked": True}, {"quote": "Not on the page really.", "checked": False}]}]

    def search(self, query, lens, market, entity=None, category=None, max_sources=6):
        self.n += 1
        if self.fail:
            raise self.fail
        return {"sources": self.sources, "trace": {"backend": "tavily", "queries": [query], "cost_usd": 0.016, "model": "claude-haiku-4-5",
                                                  "tokens": {"input": 2000, "output": 200}}}


def base():
    d = copy.deepcopy(contract.example("data"))
    d["lookups"], d["finds"], d["notes"] = [], [], []
    d["run"]["calls"] = {"model": 5, "lookups": 0}
    return d


def valid(d):
    jsonschema.Draft7Validator(SCHEMA).validate(d)
    assert contract.problems(d) == []
    assert contract.lint(d) == [], "no price in the document"


def asked(q="Do families book table seats on weekend trains?"):
    d, ref, note = lookups.propose(base(), q, "Shrey")
    assert ref == [] and "OK" in note
    return d, d["lookups"][0]["id"]


def test_the_card_names_the_question_and_calls_nothing():
    d, lid = asked()
    c = lookups.card(d, lid)
    assert c == {"id": lid, "q": "Do families book table seats on weekend trains?", "by": "Shrey", "status": "ask"}
    assert not PRICE.search(json.dumps(c))
    assert d["finds"] == [] and d["run"]["calls"]["lookups"] == 0
    valid(d)


def test_a_card_needs_a_named_person_and_a_question_and_is_not_asked_twice():
    assert lookups.propose(base(), "x?", "engine")[1] and lookups.propose(base(), "x?", "")[1]
    assert lookups.propose(base(), "   ", "Shrey")[1]
    assert lookups.propose(base(), "q" * 241, "Shrey")[1]
    d, _ = asked()
    assert "already waiting" in lookups.propose(d, "do families BOOK table seats on weekend trains?", "Shrey")[1][0]


def test_a_napkin_proposal_is_attributed_to_napkin_and_still_needs_an_ok():
    d, ref, _ = lookups.propose(base(), "Is the table seat popular?", "Shrey", proposer="Napkin, for a route that promises a table")
    assert ref == [] and d["lookups"][0]["by"].startswith("Napkin") and d["lookups"][0]["status"] == "ask"
    port, s = Port(), sp.Spend(cap_usd=1)
    assert lookups.run(d, d["lookups"][0]["id"], "engine", research=port, spend=s)[1] and port.n == 0, "the engine cannot say OK"


def test_the_ok_runs_one_search_and_the_results_arrive_as_finds_and_a_note():
    d, lid = asked()
    port, s = Port(), sp.Spend(cap_usd=1)
    out, ref, note = lookups.run(d, lid, "Shrey", research=port, spend=s)
    assert ref == [] and port.n == 1
    lq = out["lookups"][0]
    assert lq["status"] == "done" and lq["ok_by"] == "Shrey" and len(lq["found"]) == len(out["finds"]) == 4
    f = out["finds"][0]
    assert f["kind"] == "found" and f["in_play"] is False and f["quote_checked"] is True and f["url"] == "https://example.org/rail-survey"
    assert f["source"] == "Example Rail Survey" and f["date"] == "2025-06"
    assert {x["source"] for x in out["finds"]} == {"Example Rail Survey", "https://example.com/forum"} or any(x["source"] for x in out["finds"])
    assert [x["quote_checked"] for x in out["finds"]] == [True, True, True, False]
    n = out["notes"][-1]
    assert n["agent"] == "research" and n["cite"] == lq["found"] and "Pin the ones worth keeping" in n["text"] and "3 checked" in n["text"]
    assert out["run"]["calls"]["lookups"] == 1
    assert out["upstream"] == d["upstream"] and out["territories"] == d["territories"], "nothing else is touched (nothing goes to Research or the brief)"
    valid(out)


def test_the_price_is_in_the_history_and_not_in_the_document_or_the_words():
    d, lid = asked()
    s = sp.Spend(cap_usd=1)
    out, _, note = lookups.run(d, lid, "Shrey", research=Port(), spend=s)
    assert not PRICE.search(note) and not PRICE.search(json.dumps(out["notes"]))
    kinds = [(e["kind"], e.get("provider"), e.get("what")) for e in s.decisions()]
    assert ("ask", None, "lookup") in kinds and ("spend", "search", None) in kinds and ("outcome", None, None) not in kinds and any(k[0] == "outcome" for k in kinds)
    spend_line = next(e for e in s.decisions() if e["kind"] == "spend")
    assert spend_line["usd"] > 0.016 and spend_line["provider"] == "search", "the port's search plus the model tokens it used, from the price table"
    assert next(e for e in s.decisions() if e["kind"] == "ask")["by"] == "Shrey", "the OK is in the history, with who gave it"


def test_a_replay_of_the_same_approval_does_not_run_again():
    d, lid = asked()
    port, s = Port(), sp.Spend(cap_usd=1)
    once, _, _ = lookups.run(d, lid, "Shrey", research=port, spend=s)
    again, ref, _ = lookups.run(once, lid, "Shrey", research=port, spend=s)
    assert port.n == 1 and again == once and "already settled" in ref[0]
    # and a retry from the OLD document (the reply was lost) joins the recorded answer: paid once
    port2 = Port()
    redo, ref, _ = lookups.run(d, lid, "Shrey", research=port2, spend=s)
    assert ref == [] and port2.n == 0 and s.count(sp.SEARCH) == 1
    assert [f["id"] for f in redo["finds"]] == [f["id"] for f in once["finds"]]


def test_a_look_up_is_never_made_before_the_ok_is_given_by_a_person():
    d, lid = asked()
    port, s = Port(), sp.Spend(cap_usd=1)
    for who in ("", "engine", "  "):
        assert lookups.run(d, lid, who, research=port, spend=s)[1]
    d2, ref, _ = lookups.decline(d, lid, "Shrey")
    assert ref == [] and d2["lookups"][0]["status"] == "refused"
    assert lookups.run(d2, lid, "Shrey", research=port, spend=s)[1] and port.n == 0 and s.lines == []
    valid(d2)


def test_the_count_cap_stops_the_next_look_up_in_words_without_a_call():
    port, s = Port(), sp.Spend(cap_usd=1, max_lookups=2)
    d = base()
    for i in range(2):
        d, _, _ = lookups.propose(d, f"Question number {i}?", "Shrey")
        d, ref, _ = lookups.run(d, d["lookups"][-1]["id"], "Shrey", research=port, spend=s)
        assert ref == []
    d, _, _ = lookups.propose(d, "A third question?", "Shrey")
    out, ref, _ = lookups.run(d, d["lookups"][-1]["id"], "Shrey", research=port, spend=s)
    assert port.n == 2 and out == d and "number of look-ups the team allows" in ref[0] and not PRICE.search(ref[0])
    assert d["lookups"][-1]["status"] == "ask", "the card stays, so it can be run when the limit is raised"


def test_the_money_cap_is_separate_from_the_model_cap():
    d, lid = asked()
    port, s = Port(), sp.Spend(cap_usd=0.0001, search_cap_usd=0.01)
    assert lookups.run(d, lid, "Shrey", research=port, spend=s)[1] and port.n == 0
    d, lid = asked()
    s = sp.Spend(cap_usd=0.0001, search_cap_usd=0.5)
    assert lookups.run(d, lid, "Shrey", research=port, spend=s)[1] == [] and port.n == 1, "an empty model budget does not stop a look-up"


def test_a_search_that_cannot_run_says_so_in_words_and_pays_nothing():
    for err, words in ((RuntimeError("no research service is configured"), "Searching is not set up"), (TimeoutError("boom at 10.0.0.1"), "did not answer")):
        d, lid = asked()
        s = sp.Spend(cap_usd=1)
        out, ref, _ = lookups.run(d, lid, "Shrey", research=Port(fail=err), spend=s)
        assert out == d and words in ref[0] and "10.0.0.1" not in ref[0] and s.lines == []
        assert out["lookups"][0]["status"] == "ask", "the card stays: try again"


def test_a_zero_source_answer_is_an_honest_note_and_still_one_look_up():
    d, lid = asked()
    out, ref, note = lookups.run(d, lid, "Shrey", research=Port(sources=[]), spend=sp.Spend(cap_usd=1))
    assert ref == [] and out["finds"] == [] and "Nothing usable" in note and out["lookups"][0]["found"] == []
    valid(out)


def test_a_quote_over_the_find_limit_or_with_leak_text_is_left_out_never_cut():
    long = "x " * 250
    port = Port(sources=[{"id": "s", "url": "https://example.org/a", "publisher": "A", "title": "t", "retrieved_at": "2026-11-23",
                          "excerpts": [long, "**bold** leak", "A clean quote."]}])
    d, lid = asked()
    out, _, _ = lookups.run(d, lid, "Shrey", research=port, spend=sp.Spend(cap_usd=1))
    assert [f["text"] for f in out["finds"]] == ["A clean quote."] and out["finds"][0]["date"] == "read 2026-11-23"


def test_only_a_checked_quote_can_be_pinned_by_a_named_person():
    d, lid = asked()
    out, _, _ = lookups.run(d, lid, "Shrey", research=Port(), spend=sp.Spend(cap_usd=1))
    ok, bad = out["finds"][0], out["finds"][3]
    assert bad["quote_checked"] is False
    assert lookups.pin_quote(out, ok["id"], "engine")[1] and lookups.pin_quote(out, ok["id"], "")[1]
    assert "not checked" in lookups.pin_quote(out, bad["id"], "Shrey")[1][0]
    assert "not the one" in lookups.pin_quote(out, ok["id"], "Shrey", True, ok["text"].replace("54%", "64%"))[1][0], "a tampered quote is not pinned"
    pinned, ref = lookups.pin_quote(out, ok["id"], "Shrey", True, ok["text"])
    assert ref == [] and next(f for f in pinned["finds"] if f["id"] == ok["id"])["in_play"] is True
    assert contract.check(pinned)[:0] == [] and ok["id"] in contract.known_cites(pinned)
    unpinned, ref = lookups.pin_quote(pinned, ok["id"], "Shrey", False)
    assert ref == [] and not next(f for f in unpinned["finds"] if f["id"] == ok["id"])["in_play"]
    assert lookups.pin_quote(out, "x_NOPE0001", "Shrey")[1]
    valid(pinned)


def test_a_case_from_the_library_is_not_a_quote_to_pin_here():
    d = copy.deepcopy(contract.example("data"))
    case = next(f for f in d["finds"] if f["kind"] == "case")
    d2, ref = lookups.pin_quote(d, case["id"], "Shrey", True)
    assert ref and d2 is d


def test_the_new_members_are_additive_in_the_schema_lock():
    assert contract.lock_problems() == []
