"""deck-handoffs through build_deck@1: the body carries the frozen brief and research with their members, the rest of the look, the
person's waiting gate requests and the client's tissue reactions (each only when the document has them); the engine's run.human,
run.tissue and run.handoffs reach the document, which stays valid against the Deck Maker app's schema; and the app's own keys are never
written. The engine is a scripted stub (test_deck.FakeEngine). Invented data only."""

import pytest

from napkin.handlers import build_deck as bd

from test_brief import Host
from test_deck import GATE1, GATE2, PAYLOAD, SCHEMA, FakeEngine, build, deck, deck_data, use, view   # noqa: F401  (deck is a fixture)

BRIEF = {"title": "Lumen brief (invented)", "audience": "Households aged 25 to 54", "single_minded_proposition": "Every drop has a story."}
EDIT = {"id": "rq_1", "gate": "storyline", "kind": "edit", "by": "human:sai", "at": "2026-11-20T10:00:00Z", "at_ms": 1,
        "status": "waiting", "edits": {"proposition": "Your tap has a story."}}


def test_the_body_carries_upstream_members_look_requests_and_reactions(deck, monkeypatch):
    fake = use(monkeypatch, FakeEngine(view("gate", gate=GATE1)))
    host = Host(data=deck_data(), schema=SCHEMA)
    host.data["upstream"] = {"doc-brief-1": BRIEF}
    host.facts = [{"id": "f_1", "text": "Households use 140 litres a day (invented)"}]
    host.data["look"] = {"size": {"canvas": "a4", "by": "person"}, "agency_look": {"use": False}}
    host.data["run"]["gate_requests"] = [
        {"gate": "storyline", "kind": "edit", "at": "t", "status": "waiting"},   # recorded before the engine was connected: not sent
        EDIT,
        {"id": "rq_2", "gate": "idea", "kind": "retry", "by": "human:sai", "at": "t2", "status": "waiting", "note": "warmer"}]
    host.data["tissue"] = {"reactions": {"by": "client", "at": "t3", "routes": {"t1": {"verdict": "love", "comments": "more humour"}}}}
    build(deck, host)
    b = fake.posts[0]
    assert b["inputs"]["upstream"] == {"doc-brief-1": BRIEF} and b["members"]["facts"][0]["id"] == "f_1"
    assert b["look"] == {"size": {"canvas": "a4"}} and b["inputs"]["look"] == {"agency_look": {"use": False}}
    assert [r["id"] for r in b["requests"]] == ["rq_1", "rq_2"] and "status" not in b["requests"][0] and "at_ms" not in b["requests"][0]
    assert b["requests"][0]["edits"] == {"proposition": "Your tap has a story."} and b["requests"][1]["note"] == "warmer"
    assert b["reactions"]["routes"]["t1"]["verdict"] == "love"


def test_a_document_with_none_of_them_sends_the_body_it_always_did(deck, monkeypatch):
    fake = use(monkeypatch, FakeEngine(view("gate", gate=GATE1)))
    build(deck, Host(data=deck_data(), schema=SCHEMA))
    assert not {"members", "requests", "reactions"} & set(fake.posts[0]) and not {"upstream", "look"} & set(fake.posts[0]["inputs"])


def test_the_engines_human_tissue_and_handoffs_reach_the_document_and_the_apps_keys_are_never_written(deck, monkeypatch):
    human = {"edits": [{"gate": "storyline", "stage": "b", "key": "proposition", "before": None, "after": "Your tap has a story.",
                        "by": "human:sai", "at": "2026-11-20T10:00:00Z", "request": "rq_1", "kind": "edit"}],
             "requests": {"rq_1": {"status": "done", "message": "changed the proposition", "gate": "storyline", "kind": "edit"}}}
    v2 = view("gate", stage="territories", gate={**GATE2, "picked": "t1", "picked_by": "the client at the tissue session", "tissue": True,
                                                  "human": ["proposition"]})
    v2["run"]["human"] = human
    v2["run"]["tissue"] = {"files": ["tissue.html", "tissue.json", "reactions.json"], "routes": [{"id": "t1", "name": "One", "line": "a"}]}
    use(monkeypatch, FakeEngine(view("building"), v2))
    host = Host(data=deck_data(), schema=SCHEMA)
    host.data["run"]["gate_requests"] = [EDIT]
    build(deck, host)
    r = host.data["run"]
    assert r["human"] == human and r["tissue"]["files"][0] == "tissue.html" and r["gate"]["picked"] == "t1"
    assert r["gate_requests"] == [EDIT], "the person's request stays as they wrote it: the engine's answer is in run.human"
    done = view("done", stage="review", payload=PAYLOAD)
    done["run"]["handoffs"] = {"production_brief": {"files": ["production_brief.md", "production_brief.json"], "deliverables": 3, "to_supply": 4}}
    use(monkeypatch, FakeEngine(done))
    host.data["run"].update(state="gate", gate=GATE2)
    build(deck, host)
    assert host.data["run"]["handoffs"]["production_brief"]["deliverables"] == 3


@pytest.mark.parametrize("q,sent", [
    ({"id": "a", "gate": "idea", "kind": "own", "status": "waiting", "own": {"line": "L", "idea": "I"}}, True),
    ({"id": "a", "gate": "idea", "kind": "edit", "status": "waiting"}, False),        # an edit with no words is a record only
    ({"id": "a", "gate": "idea", "kind": "approve", "status": "waiting"}, False),
    ({"gate": "idea", "kind": "retry", "status": "waiting"}, False),                  # no id: recorded before the engine was connected
])
def test_which_requests_go_to_the_engine(q, sent):
    assert bool(bd.requests_of({"gate_requests": [q]})) is sent
