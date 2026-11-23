"""run_territories@1 and fetch_territories_file@1 (middleware-api.md §13, features/territories-handlers).

The real middleware, the real runner (engine/territory), a stand-in model: every step goes through the real dispatch, the real job and the
Brief tests' host (it applies a change as the real one does: once per decision id). Every state of the document is checked against the
Territories schema and its own rules (contract.problems / check / lint). No paid call is made."""
import base64
import copy
import json
import sys
import threading
import time
from pathlib import Path

import httpx
import jsonschema
import pytest

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "engine"))
sys.path.append(str(ROOT / "engine" / "territory" / "tests"))      # last: the server's own test modules win a name clash

pytest.importorskip("jsonschema")
from territory import contract, gates, runner                       # noqa: E402
from test_runner import all_outputs, Counting                       # noqa: E402

from napkin.reasoning import problems                               # noqa: E402
from napkin.territories import delivery, job as tjob                # noqa: E402

from conftest import Server                                         # noqa: E402
from test_brief import DOC, Host, post                              # noqa: E402

SCHEMA = contract.schema()
FACTS, FINDINGS = contract.example("facts"), contract.example("findings")
UPSTREAM = {"upstream": contract.example("data")["upstream"]}


class TerritoriesHost(Host):
    """The real host's request: ``data.upstream`` is the INDEX (keys only, middleware-api.md §1) and the frozen brief and research ride whole
    beside it as ``carried_upstream``. A test that handed the engine the full data directly passed while the real run found no brief."""

    def clan(self):
        c = super().clan()
        c["facts"], c["findings"] = copy.deepcopy(FACTS), copy.deepcopy(FINDINGS)
        up = (c["data"] or {}).get("upstream")
        if isinstance(up, dict) and up:
            c["carried_upstream"] = copy.deepcopy(up)
            c["data"]["upstream"] = {k: {"direct": False, "keys": sorted(v), "open_contests": []} for k, v in up.items()}
        return c


@pytest.fixture
def terr(tmp_path, monkeypatch):
    monkeypatch.setenv("NAPKIN_TERRITORY_DATA", str(tmp_path / "territory"))
    s = Server(tmp_path)
    s.model_calls = Counting(all_outputs())
    monkeypatch.setattr(tjob, "make_llm", lambda: s.model_calls)
    yield s
    s.stop()


def valid(host):
    jsonschema.Draft7Validator(SCHEMA).validate(host.data)
    assert contract.problems(host.data) == []
    assert contract.lint(host.data) == [], "no price, no field name in the document"


def step(srv, host, name="run", **inp):
    """One step: the reply's change lands, then the polls' (a quick move finishes in its first reply)."""
    st, body = post(srv, "run_territories", {"step": name, **inp} if name != "run" else inp, host.clan())
    assert st == 200, body
    replies = [body]
    host.apply(body["change"])
    t0 = time.time()
    while body["job"]["state"] in ("queued", "running"):
        assert time.time() - t0 < 60, "the job did not finish"
        time.sleep(0.02)
        st, body = post(srv, "job_status", {"job_id": replies[0]["job"]["id"]}, host.clan())
        assert st == 200, body
        replies.append(body)
        host.apply(body["change"])
    return replies


def at_pick(srv):
    host = TerritoriesHost(data=copy.deepcopy(UPSTREAM), schema=SCHEMA)
    step(srv, host)
    return host


def approve_pick(host):
    d, ref = gates.approve(host.data, "pick", "Shrey", "2026-11-23T10:00:00Z", findings=FINDINGS)
    assert ref == []
    host.data["run"]["approvals"], host.data["run"]["decisions"] = d["run"]["approvals"], d["run"]["decisions"]


def at_greenlight(srv):
    host = at_pick(srv)
    approve_pick(host)
    step(srv, host)
    return host


# ---------------------------------------------------------------- the run, through the gates


def test_a_new_document_runs_to_the_pick_gate_and_the_document_holds_it(terr):
    host = TerritoriesHost(data=copy.deepcopy(UPSTREAM), schema=SCHEMA)
    replies = step(terr, host)
    assert replies[-1]["job"]["state"] == "done" and "pick gate" in replies[-1]["result"]["summary"]
    assert host.data["run"]["state"] == "gate" and host.data["run"]["gate"]["id"] == "pick"
    assert host.data["focus"]["insights"] and terr.model_calls.calls == ["insights"]
    valid(host)


def test_the_run_sees_the_brief_though_the_host_sends_the_upstream_as_an_index(terr):
    host = TerritoriesHost(data=copy.deepcopy(UPSTREAM), schema=SCHEMA)
    host.clan = lambda base=host.clan: {**base(), "facts": [], "findings": []}     # a brief and no research: the brief is all there is to read
    sent = host.clan()
    assert all("keys" in v and "background" not in v for v in sent["data"]["upstream"].values()), "data.upstream is only the index"
    assert sent["carried_upstream"]
    step(terr, host)
    assert host.data["run"]["state"] == "gate", "a run with the brief carried finds its insights, not 'I need the category and the market'"
    assert host.data["upstream"] == UPSTREAM["upstream"], "the frozen copies are never rewritten by a step"


def test_the_engines_own_approval_of_the_pick_sets_the_crew_off_where_a_pageless_stamp_does_not(terr):
    """The page asks for step approve and then run. A bare approval with no inputs hash (what the page used to write itself) is stale to the engine."""
    host = at_pick(terr)
    host.data["run"]["approvals"] = {"pick": {"by": "Shrey", "at": "2026-11-23T10:00:00Z", "decision": "approve"}}
    step(terr, host)
    assert host.data["run"]["state"] == "gate" and host.data["run"]["gate"]["id"] == "pick", "a stamp without the inputs hash holds the run at Pick"
    host.data["run"].pop("approvals")
    r = step(terr, host, "approve", gate="pick", by="Shrey")
    assert r[-1]["job"]["state"] == "done"
    assert gates.approval_state(host.data, "pick")["valid"]
    step(terr, host)
    assert host.data["run"]["gate"]["id"] == "greenlight" and host.data["territories"], "approved by the engine, the next run explores and develops"


def test_the_approved_pick_runs_explore_and_develop_to_the_greenlight_gate(terr):
    host = at_greenlight(terr)
    d = host.data
    assert d["run"]["gate"]["id"] == "greenlight" and d["territories"] and all(t["state"] == "developed" for t in d["territories"] if t["status"] == "live")
    assert d["crew"] and d["expeditions"]
    valid(host)
    assert contract.check(host.data, facts=FACTS, findings=FINDINGS) == []


def test_a_model_step_never_writes_what_the_person_writes(terr):
    host = at_pick(terr)
    approve_pick(host)
    person = copy.deepcopy({k: host.data["run"][k] for k in ("approvals", "decisions")})
    host.data["run"]["gate_requests"] = [{"gate": "pick", "kind": "edit", "at": "2026-11-23T10:00:00Z", "status": "waiting"}]
    step(terr, host)
    for ch in host.changes:
        patch = ch["data_patch"].get("run", {})
        assert not set(patch) & {"approvals", "decisions", "gate_requests"}
        assert not set(ch["read"]) & {"run"}, "the read-set never names the whole run: the person writes beside it"
    assert {k: host.data["run"][k] for k in ("approvals", "decisions")} == person
    assert host.data["run"]["gate_requests"][0]["kind"] == "edit"


def test_every_change_names_what_it_writes_and_carries_its_reasoning(terr):
    host = at_greenlight(terr)
    ids = set()
    for ch in host.changes:
        for d in ch["decisions"]:
            assert d["id"] not in ids and not problems(d["reasoning"]) and d["handler"] == "run_territories@1.0" and d["kind"] == "edit"
            ids.add(d["id"])
        named = {t.split("#", 1)[1] for d in ch["decisions"] for t in d["targets"]}
        assert set(ch["read"]) <= named, "every path the patch writes is a target of a decision"
        assert ch["base_version"] and ch["doc"]


def test_the_ledger_goes_into_the_decision_history_and_the_price_only_there(terr):
    host = at_greenlight(terr)
    ledger = [d for d in host.chain if d["agent"].endswith("/ledger")]
    actions = {d["action"] for d in ledger}
    assert {"ask", "outcome"} <= actions, actions
    assert all("$" in d["rationale"] for d in ledger if d["action"] in ("ask", "spend"))
    assert "$" not in json.dumps(host.data) and contract.lint(host.data) == []
    again = len(ledger)
    step(terr, host)                                              # a second step does not write the same history twice
    assert len([d for d in host.chain if d["agent"].endswith("/ledger") and d["action"] in ("ask",)]) == len([d for d in ledger if d["action"] == "ask"])
    assert len([d for d in host.chain if d["agent"].endswith("/ledger")]) >= again


def test_a_repeated_poll_of_a_finished_job_changes_nothing(terr):
    host = TerritoriesHost(data=copy.deepcopy(UPSTREAM), schema=SCHEMA)
    replies = step(terr, host)
    before, n = copy.deepcopy(host.data), len(host.changes)
    st, again = post(terr, "job_status", {"job_id": replies[0]["job"]["id"]}, host.clan())
    assert st == 200 and again["job"]["state"] == "done"
    host.apply(again["change"])
    assert host.data == before and len(host.changes) == n


def test_the_carried_members_and_the_marks_reach_the_runner_as_the_deck_gets_them(terr, monkeypatch):
    seen = {}
    real = runner.run

    def spy(doc, **kw):
        seen.update(kw)
        return real(doc, **kw)
    monkeypatch.setattr(runner, "run", spy)
    data = copy.deepcopy(UPSTREAM)
    did = next(iter(data["upstream"]))
    data["upstream"][did]["confidential_fields"] = ["background"]
    host = TerritoriesHost(data=data, schema=SCHEMA)
    step(terr, host)
    assert seen["facts"] == FACTS and seen["findings"] == FINDINGS and seen["sources"] is not None or seen["sources"] == []
    assert [m["kind"] for m in seen["marks"]] == ["confidential_field"] and seen["marks"][0]["path"] == f"upstream.{did}.background"
    assert seen["doc_id"] == DOC and seen["cancel"] is not None and Path(seen["store"].dir).name == DOC


def test_a_failed_run_is_written_failed_with_words_and_the_job_says_done(terr):
    terr.model_calls.fake.outputs["insights"] = lambda u: (_ for _ in ()).throw(RuntimeError("no"))
    host = TerritoriesHost(data=copy.deepcopy(UPSTREAM), schema=SCHEMA)
    step(terr, host)
    assert host.data["run"]["state"] == "failed" and host.data["run"]["error"]["message"]
    assert "Traceback" not in json.dumps(host.data) and "RuntimeError" not in json.dumps(host.data)


# ---------------------------------------------------------------- one at a time, cancel


class Held:
    """A model that waits for a signal on its first call, so a step can be held in flight."""

    def __init__(self, inner):
        self.inner, self.go, self.entered = inner, threading.Event(), threading.Event()

    def __call__(self, stage, system, user):
        self.entered.set()
        self.go.wait(20)
        return self.inner(stage, system, user)


def test_a_second_step_on_a_document_that_is_running_is_a_409(terr, monkeypatch):
    held = Held(terr.model_calls)
    monkeypatch.setattr(tjob, "make_llm", lambda: held)
    host = TerritoriesHost(data=copy.deepcopy(UPSTREAM), schema=SCHEMA)
    st, first = post(terr, "run_territories", {}, host.clan())
    assert st == 200 and held.entered.wait(10)
    st2, body = post(terr, "run_territories", {"step": "undo", "action_id": "x", "by": "Shrey"}, host.clan())
    assert st2 == 409 and body["error"]["type"] == "job_state"
    held.go.set()
    for _ in range(300):
        st, b = post(terr, "job_status", {"job_id": first["job"]["id"]}, host.clan())
        if b["job"]["state"] == "done":
            break
        time.sleep(0.05)
    assert b["job"]["state"] == "done"


def test_the_runner_being_busy_is_a_409_job_state(terr, monkeypatch):
    class Busy:
        busy, doc, decisions, info, refusals, stopped = True, {}, [], {}, ["This run is already going. Wait for it to finish, then look again."], False
    monkeypatch.setattr(runner, "run", lambda doc, **kw: Busy())
    host = TerritoriesHost(data=copy.deepcopy(UPSTREAM), schema=SCHEMA)
    replies = step(terr, host)
    assert replies[-1]["job"]["state"] == "failed" and replies[-1]["job"]["error"]["type"] == "job_state"
    assert host.changes == [] and "already going" in replies[-1]["job"]["error"]["message"]


def test_cancel_stops_before_the_next_call_writes_nothing_and_the_next_run_pays_for_nothing_twice(terr, monkeypatch):
    held = Held(terr.model_calls)
    monkeypatch.setattr(tjob, "make_llm", lambda: held)
    host = TerritoriesHost(data=copy.deepcopy(UPSTREAM), schema=SCHEMA)
    st, first = post(terr, "run_territories", {}, host.clan())
    assert held.entered.wait(10)
    st, c = post(terr, "cancel_job", {"job_id": first["job"]["id"]}, host.clan())
    assert st == 200 and c["job"]["state"] == "cancelled"
    held.go.set()
    time.sleep(0.5)
    st, b = post(terr, "job_status", {"job_id": first["job"]["id"]}, host.clan())
    assert b["job"]["state"] == "cancelled" and b["change"] is None
    monkeypatch.setattr(tjob, "make_llm", lambda: terr.model_calls)
    n = len(terr.model_calls.calls)
    step(terr, host)                                              # the call that was on the wire was recorded: it is read, not paid again
    assert host.data["run"]["gate"]["id"] == "pick" and len(terr.model_calls.calls) == n


# ---------------------------------------------------------------- the person's moves


def test_steer_and_rerank_are_model_steps_and_a_refusal_is_a_failed_job_in_words(terr):
    host = at_greenlight(terr)
    crew = host.data["crew"][0]["id"]
    before = copy.deepcopy(host.data)
    r = step(terr, host, "steer", crew_id=crew, kind="further", by="")
    assert r[-1]["job"]["state"] == "failed" and r[-1]["job"]["error"]["type"] == "refused" and "Traceback" not in r[-1]["job"]["error"]["message"]
    assert host.data == before
    r = step(terr, host, "rerank_routes", by="Shrey")
    assert r[-1]["job"]["state"] == "done"
    valid(host)
    r = step(terr, host, "steer", crew_id=crew, kind="further", by="Shrey")
    assert r[-1]["job"]["state"] == "done"
    valid(host)


def test_bad_input_is_a_400_before_any_job(terr):
    host = at_pick(terr)
    for inp in ({"step": "dance"}, {"step": "steer", "kind": "further"}, {"step": "steer", "crew_id": "c", "kind": "sideways"}, {"step": "undo"}, {"step": "more"}):
        st, body = post(terr, "run_territories", inp, host.clan())
        assert st == 400, (inp, body)
    st, body = post(terr, "run_territories", {}, {**host.clan(), "data": {}, "carried_upstream": {}})
    assert st == 400


def test_undo_takes_a_fix_back_in_the_request(terr):
    host = TerritoriesHost(data=copy.deepcopy(contract.example("greenlight_open")), schema=SCHEMA)
    r = step(terr, host, "undo", action_id="act_spread1", by="Shrey")
    assert len(r) == 1 and r[0]["job"]["state"] == "done" and r[0]["change"]
    assert next(a for a in host.data["actions"] if a["id"] == "act_spread1")["undone"] is True
    r = step(terr, host, "undo", action_id="act_spread1", by="Shrey")
    assert r[0]["job"]["state"] == "failed" and "already" in r[0]["job"]["error"]["message"]


def test_greenlight_remove_answer_review_approve_and_send_through_the_gates(terr):
    host = TerritoriesHost(data=copy.deepcopy(contract.example("greenlight_open")), schema=SCHEMA)
    host.data["greenlit"] = []
    ids = [t["id"] for t in host.data["territories"] if t["status"] == "live" and t["state"] == "developed"][:2]
    for tid in ids:
        assert step(terr, host, "greenlight_route", territory_id=tid, by="Shrey")[0]["job"]["state"] == "done"
    assert [g["territory_id"] for g in host.data["greenlit"]] == ids
    assert host.data["run"]["gate"]["blocked_by"] == [b for b in gates.blockers(host.data, "greenlight", findings=FINDINGS)]
    assert step(terr, host, "remove_route", territory_id=ids[1], by="Shrey")[0]["job"]["state"] == "done"
    assert [g["territory_id"] for g in host.data["greenlit"]] == ids[:1]
    assert step(terr, host, "remove_route", territory_id=ids[1], by="Shrey")[0]["job"]["state"] == "failed"
    valid(host)


def test_a_derived_ask_is_answered_then_the_gate_is_approved(terr):
    host = TerritoriesHost(data=copy.deepcopy(contract.example("greenlight_derived_pending")), schema=SCHEMA)
    ask = next(a for a in host.data["asks"] if a["kind"] == "derived_evidence" and a["status"] == "open")
    assert step(terr, host, "approve", gate="greenlight", by="Shrey")[0]["job"]["state"] == "failed"
    assert step(terr, host, "answer_ask", ask_id=ask["id"], answer="verify", by="Shrey")[0]["job"]["state"] == "done"
    assert host.data["run"]["gate"]["blocked_by"] == []
    r = step(terr, host, "approve", gate="greenlight", by="Shrey")
    assert r[0]["job"]["state"] == "done" and host.data["run"]["approvals"]["greenlight"]["by"] == "Shrey"
    valid(host)


def test_the_sensitive_review_is_recorded_by_a_named_person(terr):
    host = TerritoriesHost(data=copy.deepcopy(contract.example("greenlight_sensitive_missing")), schema=SCHEMA)
    assert step(terr, host, "record_review", by="engine")[0]["job"]["state"] == "failed"
    assert step(terr, host, "record_review", by="Aoife")[0]["job"]["state"] == "done"
    assert host.data["review"]["sensitive"]["status"] == "done" and host.data["review"]["sensitive"]["by"] == "Aoife"


def test_a_send_to_a_destination_that_is_not_built_says_so_and_is_never_written_sent(terr, monkeypatch):
    host = TerritoriesHost(data=copy.deepcopy(contract.example("greenlight_open")), schema=SCHEMA)
    tid = next(t["id"] for t in host.data["territories"] if t["status"] == "live" and t["state"] == "developed")
    step(terr, host, "greenlight_route", territory_id=tid, by="Shrey")
    monkeypatch.delitem(delivery.DESTINATIONS, "production-tool")   # nothing registered: the destination is not built
    r = step(terr, host, "send_routes", to="production-tool", territory_ids=[tid], not_chosen=[], by="Shrey")
    assert r[0]["job"]["state"] == "done" and "not built yet" in r[0]["result"]["summary"]
    assert [s["status"] for s in host.data["sends"]] == ["not_built"] and host.data["run"]["state"] == "gate"
    valid(host)
    assert step(terr, host, "send_routes", to="deck-maker", territory_ids=["t_nope"], by="Shrey")[0]["job"]["state"] == "failed"
    assert step(terr, host, "send_routes", to="the-moon", territory_ids=[tid], by="Shrey")[0]["job"]["state"] == "failed"


def test_a_send_to_a_registered_destination_is_sent_approved_and_finishes_the_run(terr, monkeypatch):
    got = []
    monkeypatch.setitem(delivery.DESTINATIONS, "deck-maker", lambda doc, data, send: got.append(send) or {"status": "sent"})
    host = TerritoriesHost(data=copy.deepcopy(contract.example("greenlight_open")), schema=SCHEMA)
    ids = [t["id"] for t in host.data["territories"] if t["status"] == "live" and t["state"] == "developed"][:2]
    host.data["greenlit"] = []
    for tid in ids:
        step(terr, host, "greenlight_route", territory_id=tid, by="Shrey")
    r = step(terr, host, "send_routes", to="deck-maker", territory_ids=ids, not_chosen=[], by="Shrey")
    assert r[0]["job"]["state"] == "done" and "Sent to Deck Maker" in r[0]["result"]["summary"]
    assert got and got[0]["territory_ids"] == ids
    assert host.data["sends"][0]["status"] == "sent" and host.data["run"]["state"] == "done"
    valid(host)


def test_a_send_to_deck_maker_is_real_by_default_and_names_what_it_refuses(terr):
    """territories-spinoff-out-deck: with nothing stubbed, deck-maker is a registered destination: the send is written ``sent`` with the routes and the
    ones not chosen (the record the Deck reads after the host's spin-off), the gate is approved and the run finishes."""
    assert "deck-maker" in delivery.DESTINATIONS and "production-tool" in delivery.DESTINATIONS
    host = TerritoriesHost(data=copy.deepcopy(contract.example("greenlight_open")), schema=SCHEMA)
    live = [t["id"] for t in host.data["territories"] if t["status"] == "live" and t["state"] == "developed"]
    ids, rest = live[:2], live[2:4]
    host.data["greenlit"] = []
    for tid in ids:
        step(terr, host, "greenlight_route", territory_id=tid, by="Shrey")
    r = step(terr, host, "send_routes", to="deck-maker", territory_ids=ids, not_chosen=rest, by="Shrey")
    assert r[0]["job"]["state"] == "done" and "Sent to Deck Maker" in r[0]["result"]["summary"]
    send = host.data["sends"][-1]
    assert (send["to"], send["status"], send["territory_ids"], send["not_chosen"], send["by"]) == ("deck-maker", "sent", ids, rest, "Shrey")
    assert host.data["run"]["state"] == "done" and host.data["run"]["approvals"]["greenlight"]["by"] == "Shrey"
    valid(host)


def test_the_deck_maker_destination_refuses_a_route_that_is_only_a_find_or_was_killed_or_is_gone():
    from napkin.territories import to_deck
    data = copy.deepcopy(contract.example("greenlight_open"))
    by_state = {t["id"]: t for t in data["territories"]}
    dev = next(t["id"] for t in data["territories"] if t["state"] == "developed" and t["status"] == "live")
    find = next(t["id"] for t in data["territories"] if t["state"] != "developed" and t["status"] == "live")
    killed = next(t["id"] for t in data["territories"] if t["status"] == "killed")
    assert to_deck.deliver("d", data, {"territory_ids": [dev]}) == {"status": "sent"}
    for tid, words in ((find, "only a find"), (killed, "taken off the list"), ("t_nope", "not in this document")):
        with pytest.raises(delivery.Refused, match=words):
            to_deck.deliver("d", data, {"territory_ids": [dev, tid]})
    assert by_state[dev]["state"] == "developed"


def test_a_send_to_the_production_tool_is_real_and_names_what_it_refuses(terr):
    """territories-spinoff-out-production: production-tool is a registered destination like deck-maker: the send is written ``sent`` with the routes and the
    ones not chosen (the record the Production page reads after the host's spin-off), and a send with no greenlit route is refused in words."""
    host = TerritoriesHost(data=copy.deepcopy(contract.example("greenlight_open")), schema=SCHEMA)
    live = [t["id"] for t in host.data["territories"] if t["status"] == "live" and t["state"] == "developed"]
    ids, rest = live[:2], live[2:4]
    host.data["greenlit"] = []
    r = step(terr, host, "send_routes", to="production-tool", territory_ids=ids, not_chosen=rest, by="Shrey")
    assert r[0]["job"]["state"] == "failed" and "Greenlight" in r[0]["job"]["error"]["message"] and not host.data.get("sends")
    for tid in ids:
        step(terr, host, "greenlight_route", territory_id=tid, by="Shrey")
    r = step(terr, host, "send_routes", to="production-tool", territory_ids=ids, not_chosen=rest, by="Shrey")
    assert r[0]["job"]["state"] == "done" and "Sent to Production tool" in r[0]["result"]["summary"]
    send = host.data["sends"][-1]
    assert (send["to"], send["status"], send["territory_ids"], send["not_chosen"], send["by"]) == ("production-tool", "sent", ids, rest, "Shrey")
    valid(host)


def test_the_production_destination_refuses_no_greenlit_route_a_find_a_killed_route_or_a_gone_one():
    from napkin.territories import to_production
    data = copy.deepcopy(contract.example("greenlight_open"))
    dev = next(t["id"] for t in data["territories"] if t["state"] == "developed" and t["status"] == "live")
    data["greenlit"] = [{"territory_id": dev, "by": "Shrey", "at": "2026-11-23T10:00:00Z", "rests_on_derived": [], "derived_resolution": "verified"}]
    assert to_production.deliver("d", data, {"territory_ids": [dev]}) == {"status": "sent"}
    with pytest.raises(delivery.Refused, match="No greenlit route"):
        to_production.deliver("d", data, {"territory_ids": []})
    with pytest.raises(delivery.Refused, match="No greenlit route"):
        to_production.deliver("d", {**data, "greenlit": []}, {"territory_ids": [dev]})
    killed = copy.deepcopy(data)
    next(t for t in killed["territories"] if t["id"] == dev)["status"] = "killed"
    with pytest.raises(delivery.Refused, match="taken off the list"):
        to_production.deliver("d", killed, {"territory_ids": [dev]})
    find = copy.deepcopy(data)
    next(t for t in find["territories"] if t["id"] == dev)["state"] = "found"
    with pytest.raises(delivery.Refused, match="only a find"):
        to_production.deliver("d", find, {"territory_ids": [dev]})


def test_a_send_is_held_while_a_greenlit_route_rests_on_an_unanswered_derived_finding(terr):
    host = TerritoriesHost(data=copy.deepcopy(contract.example("greenlight_derived_pending")), schema=SCHEMA)
    ids = [g["territory_id"] for g in host.data["greenlit"]]
    r = step(terr, host, "send_routes", to="deck-maker", territory_ids=ids, by="Shrey")
    assert r[0]["job"]["state"] == "failed" and "finding" in r[0]["job"]["error"]["message"]
    assert not host.data.get("sends")


# ---------------------------------------------------------------- the file delivery path


def test_fetch_territories_file_says_so_when_nothing_is_built(terr, monkeypatch):
    monkeypatch.setattr(delivery, "FILES", {})
    monkeypatch.setattr(delivery, "FAMILIES", {})
    host = at_pick(terr)
    st, body = post(terr, "fetch_territories_file", {"name": "board.pdf"}, host.clan())
    assert st == 503 and body["error"]["type"] == "not_built" and "not built" in body["error"]["message"]


def test_fetch_territories_file_hands_over_a_registered_file_and_writes_nothing(terr, monkeypatch):
    monkeypatch.setattr(delivery, "FILES", {})
    monkeypatch.setattr(delivery, "FAMILIES", {})
    delivery.register_file("board.pdf", "application/pdf", lambda doc_id, data: b"%PDF-1.4 " + doc_id.encode() + str(len(data)).encode())
    host = at_pick(terr)
    n = len(host.changes)
    st, body = post(terr, "fetch_territories_file", {"name": "board.pdf"}, host.clan())
    assert st == 200 and body["change"] is None and body["job"]["state"] == "done"
    r = body["result"]
    assert r["media_type"] == "application/pdf" and base64.b64decode(r["data_b64"]).startswith(b"%PDF-1.4 " + DOC.encode()) and r["bytes"] == len(base64.b64decode(r["data_b64"]))
    st, body = post(terr, "fetch_territories_file", {"name": "nope.pdf"}, host.clan())
    assert st == 400 and "board.pdf" in body["error"]["message"]
    st, body = post(terr, "fetch_territories_file", {}, host.clan())
    assert st == 400
    assert len(host.changes) == n


def test_a_file_that_cannot_be_made_is_words_not_a_trace(terr, monkeypatch):
    def boom(doc_id, data):
        raise RuntimeError("secret internals")
    monkeypatch.setattr(delivery, "FILES", {"board.pdf": ("application/pdf", boom)})
    host = at_pick(terr)
    st, body = post(terr, "fetch_territories_file", {"name": "board.pdf"}, host.clan())
    assert st == 502 and "secret" not in json.dumps(body)


# ---------------------------------------------------------------- the engine is not there


def test_without_the_engine_package_the_task_says_so_in_words(terr, monkeypatch):
    monkeypatch.setitem(sys.modules, "territory.runner", None)
    host = TerritoriesHost(data=copy.deepcopy(UPSTREAM), schema=SCHEMA)
    st, body = post(terr, "run_territories", {}, host.clan())
    assert st == 503 and body["error"]["type"] == "engine_unavailable"


def test_the_registry_and_the_pipeline_declare_the_same_two_tasks():
    from napkin import registry
    decl = registry.parse_pipeline((ROOT / "app" / "templates" / "territories" / "app" / "pipeline.yaml").read_text())
    assert decl == {"run_territories": "run_territories@1", "fetch_territories_file": "fetch_territories_file@1"}
    for task, declared in decl.items():
        assert registry.lookup(declared, task)[0].TASK == task
    assert {"run_territories", "fetch_territories_file"} <= registry.LATER_TASKS


# ---------------------------------------------------------------- pictures that arrive with a document


def _png(n):
    return bytes.fromhex("89504e470d0a1a0a") + b"made-up picture " + str(n).encode()


def _assets(*ns, **meta):
    import hashlib
    return {"sha256:" + hashlib.sha256(_png(n)).hexdigest(): {"kind": "image", "mime": "image/png", "origin": "generated", "rights": "generated", **meta} for n in ns}


def _with_assets(assets):
    d = copy.deepcopy(UPSTREAM)
    next(iter(d["upstream"].values()))["assets"] = assets
    return d


@pytest.fixture
def blobs(tmp_path, monkeypatch):
    monkeypatch.setenv("NAPKIN_TERRITORY_BLOBS", str(tmp_path / "workspace"))
    monkeypatch.setattr(delivery, "ASSET_READER", None)
    return tmp_path / "workspace"


def _reader(have):
    import hashlib
    by = {hashlib.sha256(_png(n)).hexdigest(): _png(n) for n in have}
    return lambda doc_id, data: (lambda sha: by.get(sha))


def test_a_partial_arrival_is_refused_in_words_and_nothing_runs(terr, blobs, monkeypatch):
    monkeypatch.setattr(delivery, "ASSET_READER", _reader([1, 2]))          # 3 pictures named, 2 come
    host = TerritoriesHost(data=_with_assets(_assets(1, 2, 3)), schema=SCHEMA)
    r = step(terr, host)
    assert r[-1]["job"]["state"] == "failed" and r[-1]["job"]["error"]["type"] == "refused"
    assert "2 of 3 pictures arrived" in r[-1]["job"]["error"]["message"] and terr.model_calls.calls == [] and host.changes == []


def test_every_picture_is_put_on_the_workspace_store_before_the_run_reads_the_document(terr, blobs, monkeypatch):
    import hashlib
    monkeypatch.setattr(delivery, "ASSET_READER", _reader([1, 2, 3]))
    host = TerritoriesHost(data=_with_assets(_assets(1, 2, 3)), schema=SCHEMA)
    r = step(terr, host)
    assert r[-1]["job"]["state"] == "done" and host.data["run"]["gate"]["id"] == "pick"
    for n in (1, 2, 3):
        h = hashlib.sha256(_png(n)).hexdigest()
        assert (blobs / "blobs" / h[:2] / h).read_bytes() == _png(n)
    assert not any(k == "assets" for k in host.data), "the document gets no copy of the bytes"


def test_without_a_reader_a_picture_not_on_the_store_is_missing_never_invented(terr, blobs):
    host = TerritoriesHost(data=_with_assets(_assets(1)), schema=SCHEMA)
    r = step(terr, host)
    assert r[-1]["job"]["state"] == "failed" and "0 of 1 pictures arrived" in r[-1]["job"]["error"]["message"]


def test_arrived_pictures_go_into_route_slots_by_link_once_each(terr, blobs, monkeypatch):
    import hashlib
    monkeypatch.setattr(delivery, "ASSET_READER", _reader([1, 2]))
    base = copy.deepcopy(contract.example("data"))
    next(iter(base["upstream"].values()))["assets"] = _assets(1, 2)
    host = TerritoriesHost(data=base, schema=SCHEMA)
    ts = [t for t in host.data["territories"] if t["status"] == "live" and t["state"] == "developed" and t.get("pictures")]
    r = step(terr, host, "place_pictures", territory_id=ts[0]["id"])
    assert r[0]["job"]["state"] == "done" and "2 pictures placed" in r[0]["result"]["summary"]
    frames = [s for t in host.data["territories"] for s in t.get("pictures") or [] if s.get("kind") == "frame"]
    assert sorted(s["sha256"] for s in frames) == sorted(hashlib.sha256(_png(n)).hexdigest() for n in (1, 2))
    assert all(s["image"] == "sha256:" + s["sha256"] and s["rights"] == "generated" for s in frames)
    r = step(terr, host, "place_pictures", territory_id=ts[0]["id"])           # nothing left: said in words, nothing changes
    assert r[0]["job"]["state"] == "failed" and "no picture left" in r[0]["job"]["error"]["message"]
    assert contract.problems(host.data) == []


def test_attach_names_the_slot_and_the_picture_and_refuses_a_picture_that_did_not_arrive(terr, blobs, monkeypatch):
    import hashlib
    monkeypatch.setattr(delivery, "ASSET_READER", _reader([1]))
    base = copy.deepcopy(contract.example("data"))
    next(iter(base["upstream"].values()))["assets"] = _assets(1)
    host = TerritoriesHost(data=base, schema=SCHEMA)
    t = next(t for t in host.data["territories"] if t.get("pictures") and t["status"] == "live")
    slot = next(s for s in t["pictures"] if s["kind"] != "frame")["id"]
    h = hashlib.sha256(_png(1)).hexdigest()
    assert step(terr, host, "place_pictures", territory_id=t["id"], slot_id=slot, sha256=h)[0]["job"]["state"] == "done"
    assert next(s for s in next(x for x in host.data["territories"] if x["id"] == t["id"])["pictures"] if s["id"] == slot)["sha256"] == h
    assert step(terr, host, "place_pictures", territory_id=t["id"], slot_id=slot, sha256=hashlib.sha256(_png(9)).hexdigest())[0]["job"]["state"] == "failed"


# ---------------------------------------------------------------- a person's choices about a world, and an engine write at the same moment


def _route_with_lines(host):
    t = next(t for t in host.data["territories"] if t["status"] == "live" and t["state"] == "developed")
    return t["id"], t["world"]["lines"][0], t["world"]["lines"][1]


def test_a_choice_and_an_engine_write_that_interleave_both_survive(terr, monkeypatch):
    host = at_greenlight(terr)
    tid, l0, l1 = _route_with_lines(host)
    held = Held(terr.model_calls)
    monkeypatch.setattr(tjob, "make_llm", lambda: held)
    st, more = post(terr, "run_territories", {"step": "more", "territory_id": tid, "by": "Shrey"}, host.clan())
    assert st == 200 and held.entered.wait(10)                      # the engine is writing this world now
    for inp in ({"step": "star_line", "territory_id": tid, "line": l0, "on": True},
                {"step": "set_lead", "territory_id": tid, "line": l1},
                {"step": "keep_feel", "territory_id": tid, "dial_set": {"tone": 2, "energy": 3, "register": 4, "brand": 5}}):
        st, body = post(terr, "run_territories", inp, host.clan())
        assert st == 200 and body["job"]["state"] == "done" and body["change"] is None and "kept with the step" in body["result"]["summary"]
    held.go.set()
    for _ in range(300):
        st, b = post(terr, "job_status", {"job_id": more["job"]["id"]}, host.clan())
        if b["job"]["state"] != "running" and b["job"]["state"] != "queued":
            break
        time.sleep(0.05)
    assert b["job"]["state"] == "done"
    host.apply(b["change"])
    w = next(t for t in host.data["territories"] if t["id"] == tid)["world"]
    assert "Brand new line one." in w["lines"], "the engine's write survived"
    assert w["starred"] == [l0] and w["lead"] == l1 and w["dial_set"] == {"tone": 2, "energy": 3, "register": 4, "brand": 5}, "so did the person's choices"
    valid(host)


def test_a_choice_while_a_step_runs_that_the_document_refuses_is_refused_now_in_words(terr, monkeypatch):
    host = at_greenlight(terr)
    tid, l0, _ = _route_with_lines(host)
    held = Held(terr.model_calls)
    monkeypatch.setattr(tjob, "make_llm", lambda: held)
    st, more = post(terr, "run_territories", {"step": "more", "territory_id": tid, "by": "Shrey"}, host.clan())
    assert held.entered.wait(10)
    st, body = post(terr, "run_territories", {"step": "set_lead", "territory_id": tid, "line": "a line nobody wrote"}, host.clan())
    assert st == 200 and body["job"]["state"] == "failed" and "not in this world" in body["job"]["error"]["message"]
    st, body = post(terr, "run_territories", {"step": "greenlight_route", "territory_id": tid, "by": "Shrey"}, host.clan())
    assert st == 409                                                  # a greenlight is not a world choice: one step at a time
    held.go.set()


def test_a_cancelled_step_keeps_the_choice_made_while_it_ran(terr, monkeypatch):
    host = at_greenlight(terr)
    tid, l0, _ = _route_with_lines(host)
    held = Held(terr.model_calls)
    monkeypatch.setattr(tjob, "make_llm", lambda: held)
    st, more = post(terr, "run_territories", {"step": "more", "territory_id": tid, "by": "Shrey"}, host.clan())
    assert held.entered.wait(10)
    post(terr, "run_territories", {"step": "star_line", "territory_id": tid, "line": l0, "on": True}, host.clan())
    st, c = post(terr, "cancel_job", {"job_id": more["job"]["id"]}, host.clan())
    assert c["job"]["state"] == "cancelled" and c["change"]
    host.apply(c["change"])
    held.go.set()
    assert next(t for t in host.data["territories"] if t["id"] == tid)["world"]["starred"] == [l0]
    valid(host)


def test_the_moves_without_a_running_step_apply_at_once_and_say_no_in_words(terr):
    host = at_greenlight(terr)
    tid, l0, l1 = _route_with_lines(host)
    r = step(terr, host, "star_line", territory_id=tid, line=l0, on=True)
    assert len(r) == 1 and r[0]["job"]["state"] == "done" and r[0]["change"]
    r = step(terr, host, "star_line", territory_id=tid, line=l0, on=False)
    assert next(t for t in host.data["territories"] if t["id"] == tid)["world"]["starred"] == []
    step(terr, host, "set_lead", territory_id=tid, line=l1)
    step(terr, host, "set_lead", territory_id=tid, line=None)
    assert "lead" not in next(t for t in host.data["territories"] if t["id"] == tid)["world"]
    assert step(terr, host, "set_lead", territory_id="t_nope", line=l1)[0]["job"]["state"] == "failed"
    for bad in ({"step": "keep_feel", "territory_id": tid, "dial_set": {"tone": 99, "energy": 1, "register": 1, "brand": 1}}, {"step": "star_line", "territory_id": tid, "line": l0},
                {"step": "set_lead", "territory_id": tid, "line": 5}):
        assert post(terr, "run_territories", bad, host.clan())[0] == 400
    valid(host)


def test_the_push_names_the_world_view_offers_become_the_engines_instruction(terr, monkeypatch):
    seen = {}
    real = runner.push

    def spy(doc, tid, by, **kw):
        seen["ins"] = kw.get("instruction")
        return real(doc, tid, by, **kw)
    monkeypatch.setattr(runner, "push", spy)
    host = at_greenlight(terr)
    tid, _, _ = _route_with_lines(host)
    step(terr, host, "push", territory_id=tid, by="Shrey", instruction="more proof")
    assert "evidence" in seen["ins"]


# ---------------------------------------------------------------- the pictures view's choices: final and rights, as small moves


def _with_frames(terr, monkeypatch, blobs, ns=(1, 2), name="data"):
    monkeypatch.setattr(delivery, "ASSET_READER", _reader(list(ns)))
    base = copy.deepcopy(contract.example(name))
    next(iter(base["upstream"].values()))["assets"] = _assets(*ns)
    host = TerritoriesHost(data=base, schema=SCHEMA)
    tid = next(t["id"] for t in host.data["territories"] if t.get("pictures") and t["status"] == "live" and t["state"] == "developed")
    assert step(terr, host, "place_pictures", territory_id=tid)[0]["job"]["state"] == "done"
    return host, tid


def test_set_rights_and_set_final_are_small_moves_through_territory_pictures(terr, blobs, monkeypatch):
    import hashlib
    host, tid = _with_frames(terr, monkeypatch, blobs)
    t = next(x for x in host.data["territories"] if x["id"] == tid)
    slot = next(s for s in t["pictures"] if s["kind"] == "frame")
    h = slot["sha256"]
    assert step(terr, host, "set_rights", sha256=h, rights="licensed", by="Shrey")[0]["job"]["state"] == "done"
    assert step(terr, host, "set_final", territory_id=tid, slot_id=slot["id"], on=True, by="Shrey")[0]["job"]["state"] == "done"
    s2 = next(s for s in next(x for x in host.data["territories"] if x["id"] == tid)["pictures"] if s["id"] == slot["id"])
    assert s2["rights"] == "licensed" and s2["final"] is True
    assert step(terr, host, "set_final", territory_id=tid, sha256=h, on=False, by="Shrey")[0]["job"]["state"] == "done"
    assert "final" not in next(s for s in next(x for x in host.data["territories"] if x["id"] == tid)["pictures"] if s["id"] == slot["id"])
    assert step(terr, host, "set_rights", sha256=hashlib.sha256(b"nothing").hexdigest(), rights="own", by="Shrey")[0]["job"]["state"] == "failed"
    assert step(terr, host, "set_final", territory_id=tid, slot_id=next(s for s in t["pictures"] if s["kind"] != "frame")["id"], on=True, by="Shrey")[0]["job"]["state"] == "failed"
    for bad in ({"step": "set_rights", "sha256": h, "rights": "client_supplied"}, {"step": "set_final", "territory_id": tid, "picture_id": h}, {"step": "set_rights", "rights": "own"}):
        assert post(terr, "run_territories", bad, host.clan())[0] == 400
    assert contract.problems(host.data) == []


def test_a_final_with_no_stated_rights_holds_the_gate_until_the_rights_move(terr, blobs, monkeypatch):
    host, tid = _with_frames(terr, monkeypatch, blobs, name="greenlight_open")
    host.data["greenlit"] = []
    step(terr, host, "greenlight_route", territory_id=tid, by="Shrey")
    t = next(x for x in host.data["territories"] if x["id"] == tid)
    slot = next(s for s in t["pictures"] if s["kind"] == "frame")
    step(terr, host, "set_rights", sha256=slot["sha256"], rights="unknown", by="Shrey")
    step(terr, host, "set_final", territory_id=tid, slot_id=slot["id"], on=True, by="Shrey")
    assert any(b["kind"] == "picture_rights" for b in host.data["run"]["gate"]["blocked_by"])
    step(terr, host, "set_rights", sha256=slot["sha256"], rights="own", by="Shrey")
    assert not any(b["kind"] == "picture_rights" for b in host.data["run"]["gate"]["blocked_by"])


def test_a_picture_choice_interleaves_with_a_running_step(terr, blobs, monkeypatch):
    host, tid = _with_frames(terr, monkeypatch, blobs)
    t = next(x for x in host.data["territories"] if x["id"] == tid)
    slot = next(s for s in t["pictures"] if s["kind"] == "frame")
    held = Held(terr.model_calls)
    monkeypatch.setattr(tjob, "make_llm", lambda: held)
    st, more = post(terr, "run_territories", {"step": "more", "territory_id": tid, "by": "Shrey"}, host.clan())
    assert st == 200 and held.entered.wait(10)
    st, body = post(terr, "run_territories", {"step": "set_rights", "sha256": slot["sha256"], "rights": "licensed", "by": "Shrey"}, host.clan())
    assert st == 200 and body["job"]["state"] == "done" and body["change"] is None
    held.go.set()
    for _ in range(300):
        st, b = post(terr, "job_status", {"job_id": more["job"]["id"]}, host.clan())
        if b["job"]["state"] not in ("queued", "running"):
            break
        time.sleep(0.05)
    host.apply(b["change"])
    t2 = next(x for x in host.data["territories"] if x["id"] == tid)
    assert next(s for s in t2["pictures"] if s["id"] == slot["id"])["rights"] == "licensed"


def test_the_pictures_view_names_the_slot_by_picture_id(terr, blobs, monkeypatch):
    host, tid = _with_frames(terr, monkeypatch, blobs)
    t = next(x for x in host.data["territories"] if x["id"] == tid)
    slot = next(s for s in t["pictures"] if s["kind"] == "frame")
    assert step(terr, host, "set_rights", territory_id=tid, picture_id=slot["id"], rights="own", by="Shrey")[0]["job"]["state"] == "done"
    assert step(terr, host, "set_final", territory_id=tid, picture_id=slot["id"], on=True, by="Shrey")[0]["job"]["state"] == "done"
    s2 = next(s for s in next(x for x in host.data["territories"] if x["id"] == tid)["pictures"] if s["id"] == slot["id"])
    assert s2["rights"] == "own" and s2["final"] is True
