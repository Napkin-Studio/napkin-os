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
    def clan(self):
        c = super().clan()
        c["facts"], c["findings"] = copy.deepcopy(FACTS), copy.deepcopy(FINDINGS)
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
    st, body = post(terr, "run_territories", {}, {**host.clan(), "data": {}})
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


def test_a_send_to_a_destination_that_is_not_built_says_so_and_is_never_written_sent(terr):
    host = TerritoriesHost(data=copy.deepcopy(contract.example("greenlight_open")), schema=SCHEMA)
    tid = next(t["id"] for t in host.data["territories"] if t["status"] == "live" and t["state"] == "developed")
    step(terr, host, "greenlight_route", territory_id=tid, by="Shrey")
    r = step(terr, host, "send_routes", to="deck-maker", territory_ids=[tid], not_chosen=[], by="Shrey")
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


def test_a_send_is_held_while_a_greenlit_route_rests_on_an_unanswered_derived_finding(terr):
    host = TerritoriesHost(data=copy.deepcopy(contract.example("greenlight_derived_pending")), schema=SCHEMA)
    ids = [g["territory_id"] for g in host.data["greenlit"]]
    r = step(terr, host, "send_routes", to="deck-maker", territory_ids=ids, by="Shrey")
    assert r[0]["job"]["state"] == "failed" and "finding" in r[0]["job"]["error"]["message"]
    assert not host.data.get("sends")


# ---------------------------------------------------------------- the file delivery path


def test_fetch_territories_file_says_so_when_nothing_is_built(terr, monkeypatch):
    monkeypatch.setattr(delivery, "FILES", {})
    host = at_pick(terr)
    st, body = post(terr, "fetch_territories_file", {"name": "board.pdf"}, host.clan())
    assert st == 503 and body["error"]["type"] == "not_built" and "not built" in body["error"]["message"]


def test_fetch_territories_file_hands_over_a_registered_file_and_writes_nothing(terr, monkeypatch):
    monkeypatch.setattr(delivery, "FILES", {})
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
