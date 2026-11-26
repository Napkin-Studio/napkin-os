"""territories-lookups through the real middleware: the lookup step (the OK card, then one paid search through caps.research and the spend
module's caps), pin_quote as a small move, the words when nothing is configured. Tavily is STUBBED (a research port that counts its calls)."""
import copy
import json
import re
import sys
import time
from pathlib import Path

import jsonschema
import pytest

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "engine"))
sys.path.append(str(ROOT / "engine" / "territory" / "tests"))

from territory import contract                                       # noqa: E402

from conftest import Server                                           # noqa: E402
from fakes import FakeResearch                                        # noqa: E402
from test_territories import SCHEMA, TerritoriesHost, step           # noqa: E402

PRICE = re.compile(r"(€|\$|£)\s?\d|\b(USD|EUR|GBP)\b", re.I)


class Tavily:
    """The research port with Tavily stubbed: counts real calls, answers in the port's shape."""

    def __init__(self):
        self.calls = []

    def search(self, query, lens, market, entity=None, category=None, max_sources=6, attribution=None):
        self.calls.append((query, lens, market))
        return {"sources": [{"id": "s1", "url": "https://example.org/rail", "publisher": "Example Rail Survey", "title": "t", "retrieved_at": "2026-11-23",
                             "published_at": "2025-06", "excerpts": ["54% of rail passengers count the journey as part of the trip."]}],
                "trace": {"backend": "tavily", "queries": [query], "cost_usd": 0.016}}


def doc():
    d = copy.deepcopy(contract.example("data"))
    d["lookups"], d["finds"], d["notes"] = [], [], []
    d["run"]["calls"] = {"model": 5, "lookups": 0}
    return d


def make(tmp_path, monkeypatch, research):
    monkeypatch.setenv("NAPKIN_TERRITORY_DATA", str(tmp_path / "territory"))
    return Server(tmp_path, research=research)


@pytest.fixture
def lk(tmp_path, monkeypatch):
    port = Tavily()
    s = make(tmp_path, monkeypatch, port)
    s.port = port
    yield s
    s.stop()


def host():
    return TerritoriesHost(data=doc(), schema=SCHEMA)


def valid(h):
    jsonschema.Draft7Validator(SCHEMA).validate(h.data)
    assert contract.problems(h.data) == [] and contract.lint(h.data) == []


def test_ask_then_ok_runs_one_search_and_the_note_and_finds_arrive(lk):
    h = host()
    r = step(lk, h, "lookup", q="Do families book table seats?", by="Shrey")
    assert r[-1]["job"]["state"] == "done" and "OK" in r[-1]["result"]["summary"] and lk.port.calls == [], "the card first: no call"
    lq = h.data["lookups"][0]
    assert lq["status"] == "ask" and not PRICE.search(json.dumps(lq))
    r = step(lk, h, "lookup", lookup_id=lq["id"], ok=True, by="Shrey")
    assert r[-1]["job"]["state"] == "done", r[-1]
    assert len(lk.port.calls) == 1 and lk.port.calls[0][0] == "Do families book table seats?"
    lq = h.data["lookups"][0]
    assert lq["status"] == "done" and lq["ok_by"] == "Shrey" and h.data["finds"][0]["id"] in lq["found"]
    assert h.data["notes"][-1]["agent"] == "research" and h.data["run"]["calls"]["lookups"] == 1
    valid(h)
    assert not PRICE.search(json.dumps(h.data))


def test_the_history_holds_the_ok_and_the_price_once_each(lk):
    h = host()
    step(lk, h, "lookup", q="Do families book table seats?", by="Shrey")
    step(lk, h, "lookup", lookup_id=h.data["lookups"][0]["id"], ok=True, by="Shrey")
    ledger = [d for d in h.chain if d["agent"].endswith("/ledger")]
    assert sum("was approved by Shrey" in d["rationale"] for d in ledger) == 1 and sum("made through the research port" in d["rationale"] for d in ledger) == 1
    assert all("$" in d["rationale"] for d in ledger if d["action"] in ("ask", "spend")) and "$" not in json.dumps(h.data)


def test_a_replayed_ok_does_not_search_again_and_says_so(lk):
    h = host()
    step(lk, h, "lookup", q="Do families book table seats?", by="Shrey")
    lid = h.data["lookups"][0]["id"]
    step(lk, h, "lookup", lookup_id=lid, ok=True, by="Shrey")
    r = step(lk, h, "lookup", lookup_id=lid, ok=True, by="Shrey")
    assert r[-1]["job"]["state"] == "failed" and "already settled" in r[-1]["job"]["error"]["message"]
    assert len(lk.port.calls) == 1 and len(h.data["finds"]) == 1


def test_no_ok_no_call_for_an_unnamed_person_or_a_no(lk):
    h = host()
    step(lk, h, "lookup", q="Do families book table seats?", by="Shrey")
    lid = h.data["lookups"][0]["id"]
    r = step(lk, h, "lookup", lookup_id=lid, ok=True)
    assert r[-1]["job"]["state"] == "failed" and "named person" in r[-1]["job"]["error"]["message"]
    step(lk, h, "lookup", lookup_id=lid, ok=False, by="Shrey")
    assert h.data["lookups"][0]["status"] == "refused" and lk.port.calls == []


def test_bad_input_is_a_400(lk):
    from test_brief import post
    for inp in ({"step": "lookup"}, {"step": "lookup", "lookup_id": "lq_x", "ok": "yes"}, {"step": "pin_quote"}, {"step": "pin_quote", "find_id": "x_A", "on": "no"}):
        st, body = post(lk, "run_territories", inp, host().clan())
        assert st == 400, (inp, body)


def test_pin_quote_is_a_small_move_only_a_named_person_makes_for_a_checked_quote(lk):
    h = host()
    step(lk, h, "lookup", q="Do families book table seats?", by="Shrey")
    step(lk, h, "lookup", lookup_id=h.data["lookups"][0]["id"], ok=True, by="Shrey")
    f = h.data["finds"][0]
    r = step(lk, h, "pin_quote", find_id=f["id"], on=True)
    assert r[-1]["job"]["state"] == "failed" and "named person" in r[-1]["job"]["error"]["message"]
    r = step(lk, h, "pin_quote", find_id=f["id"], on=True, by="Shrey", text=f["text"].replace("54%", "84%"))
    assert r[-1]["job"]["state"] == "failed" and not h.data["finds"][0]["in_play"]
    r = step(lk, h, "pin_quote", find_id=f["id"], on=True, by="Shrey", text=f["text"])
    assert r[-1]["job"]["state"] == "done" and h.data["finds"][0]["in_play"] is True
    h.data["finds"][0]["quote_checked"] = False
    h.data["finds"][0]["in_play"] = False
    r = step(lk, h, "pin_quote", find_id=f["id"], on=True, by="Shrey")
    assert r[-1]["job"]["state"] == "failed" and "not checked" in r[-1]["job"]["error"]["message"]
    h.data["finds"][0]["quote_checked"] = True
    valid(h)


def test_the_count_cap_is_set_by_config_and_refuses_in_words(tmp_path, monkeypatch):
    monkeypatch.setenv("NAPKIN_TERRITORY_LOOKUPS_MAX", "1")
    port = Tavily()
    s = make(tmp_path, monkeypatch, port)
    try:
        h = host()
        for q in ("First question?", "Second question?"):
            step(s, h, "lookup", q=q, by="Shrey")
            r = step(s, h, "lookup", lookup_id=h.data["lookups"][-1]["id"], ok=True, by="Shrey")
        assert len(port.calls) == 1 and r[-1]["job"]["state"] == "failed" and "number of look-ups the team allows" in r[-1]["job"]["error"]["message"]
        assert not PRICE.search(r[-1]["job"]["error"]["message"]) and h.data["lookups"][-1]["status"] == "ask"
    finally:
        s.stop()


def test_without_a_research_port_it_says_so_and_spends_nothing(tmp_path, monkeypatch):
    monkeypatch.setenv("NAPKIN_TERRITORY_DATA", str(tmp_path / "territory"))
    s = Server(tmp_path)
    s.app.research_port = None
    try:
        s.app.research_port = None
        h = host()
        step(s, h, "lookup", q="Do families book table seats?", by="Shrey")
        import napkin.capabilities as cap
        orig = cap.ResearchCap.search

        def none(self, *a, **k):
            from napkin.research import ResearchError
            raise ResearchError("no research service is configured")
        monkeypatch.setattr(cap.ResearchCap, "search", none)
        r = step(s, h, "lookup", lookup_id=h.data["lookups"][0]["id"], ok=True, by="Shrey")
        assert r[-1]["job"]["state"] == "failed" and "Searching is not set up" in r[-1]["job"]["error"]["message"]
        assert h.data["lookups"][0]["status"] == "ask" and h.data["finds"] == []
    finally:
        s.stop()

