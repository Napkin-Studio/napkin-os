"""The Deck Maker engine server on the Fernley recording: the three gates, the refusals, one run at a time, a failure shown as a
failure, the cost cap. No model and no renderer: replay copies recorded stages, and the last step runs with render false (LibreOffice is
not needed) or is refused before it starts. Run from ``engine/``: ``PYTHONPATH=. python3 -m pytest -q deck/tests/test_server.py``.
"""
from __future__ import annotations

import json
import threading
import time
import urllib.error
import urllib.request
from pathlib import Path

import pytest

from deck import server as srv

FERN = Path(__file__).parent / "fixtures" / "fernley"
PROMPT = (FERN / "prompt.txt").read_text().strip()
INPUTS = {"prompt": {"text": PROMPT, "client": "Fernley Drinks Ltd (FICTIONAL)", "project": "Fernley Tea 2027", "agency": ""}, "kind": "agency", "format": "pitch"}


@pytest.fixture
def engine(tmp_path):
    """A server on a spare port with the recording to replay and live off."""
    cfg = srv.Settings({"NAPKIN_DECK_DATA": str(tmp_path / "runs"), "NAPKIN_DECK_REPLAY": str(FERN / "stages"), "NAPKIN_DECK_PORT": "0"})
    httpd = srv.serve(cfg)
    t = threading.Thread(target=httpd.serve_forever, daemon=True)
    t.start()
    base = f"http://127.0.0.1:{httpd.server_address[1]}"
    yield type("E", (), {"base": base, "cfg": cfg, "dir": tmp_path / "runs", "httpd": httpd})
    httpd.shutdown()


def call(base: str, path: str, body: dict | None = None):
    req = urllib.request.Request(base + path, data=None if body is None else json.dumps(body).encode(), method="GET" if body is None else "POST",
                                 headers={"Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=20) as r:
            return r.status, json.loads(r.read() or b"{}") if "json" in (r.headers.get("Content-Type") or "") else r.read()
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read() or b"{}")


def wait(base: str, doc: str, until=("gate", "done", "failed")) -> dict:
    end = time.time() + 20
    while time.time() < end:
        _, v = call(base, f"/run/{doc}")
        if v["state"] in until:
            return v
        time.sleep(0.05)
    raise AssertionError("the run did not settle")


def start(e, doc="doc1", approvals=None, **kw):
    return call(e.base, "/run", {"doc": doc, "inputs": INPUTS, "approvals": approvals or {}, "mode": "replay", "render": False, **kw})


def stage_files(e, doc="doc1") -> set[str]:
    return {p.name for p in (e.dir / doc).glob("*/stages/*.json")}


def test_status_says_what_is_on(engine):
    status, s = call(engine.base, "/status")
    assert status == 200 and s == {"ok": True, "live": False, "replay": True, "max_usd": 2.0, "busy": None}


def test_the_run_stops_at_the_storyline_gate_and_nothing_after_it_runs(engine):
    status, first = start(engine)
    assert status == 202
    v = wait(engine.base, "doc1")
    assert v["state"] == "gate" and v["run"]["gate"]["id"] == "storyline" and v["run"]["gate"]["beats"]
    assert {"b_storyline.json", "insight_judge.json"} <= stage_files(engine)
    assert not stage_files(engine) & {"c_territories.json", "d_idea.json", "fit.json", "e_copy.json", "red_team.json"}


def test_each_approval_runs_only_the_next_stage_up_to_the_next_gate(engine):
    start(engine); wait(engine.base, "doc1")
    start(engine, approvals={"storyline": {"decision": "approve"}})
    v = wait(engine.base, "doc1")
    assert v["run"]["gate"]["id"] == "territories" and len(v["run"]["gate"]["territories"]) == 3
    assert "c_territories.json" in stage_files(engine) and "d_idea.json" not in stage_files(engine)
    start(engine, approvals={"storyline": {"decision": "approve"}, "territories": {"decision": "approve", "picked": v["run"]["gate"]["first_pick"]}})
    v = wait(engine.base, "doc1")
    assert v["run"]["gate"]["id"] == "idea" and v["run"]["gate"]["idea"]["executions"]
    assert "d_idea.json" in stage_files(engine) and "fit.json" not in stage_files(engine)


def test_after_the_last_gate_the_deck_is_built_and_the_document_gets_everything_the_screens_read(engine):
    done = {"storyline": {"decision": "approve"}, "territories": {"decision": "approve"}, "idea": {"decision": "approve"}}
    start(engine); wait(engine.base, "doc1")
    for k in ("storyline", "territories"):
        start(engine, approvals={g: done[g] for g in list(done)[: list(done).index(k) + 1]}); wait(engine.base, "doc1")
    start(engine, approvals=done)
    v = wait(engine.base, "doc1")
    assert v["state"] == "done" and v["run"]["stage"] == "review" and v["run"]["done"]["slides"] > 0
    p = v["payload"]
    assert set(p) == {"deck", "validation", "evidence", "report", "exports", "done"} and p["deck"]["order"] and p["evidence"]
    assert p["report"]["cost_usd"] == 0 and p["report"]["mode"] == "replay" and p["exports"] == {}
    assert call(engine.base, "/file/doc1/deck.pdf")[0] == 404, "a file that was not written is not served"


def test_an_old_approval_never_skips_the_gate_of_a_new_run(engine):
    everything = {g: {"decision": "approve"} for g in ("storyline", "territories", "idea")}
    start(engine, doc="fresh", approvals=everything)
    v = wait(engine.base, "fresh")
    assert v["state"] == "gate" and v["run"]["gate"]["id"] == "storyline", "approved before the storyline existed: it is still shown"


def test_a_changed_prompt_starts_the_run_again(engine):
    start(engine); wait(engine.base, "doc1")
    other = {**INPUTS, "prompt": {**INPUTS["prompt"], "text": PROMPT + " And make it playful."}}
    call(engine.base, "/run", {"doc": "doc1", "inputs": other, "approvals": {"storyline": {"decision": "approve"}}, "mode": "replay", "render": False})
    v = wait(engine.base, "doc1")
    assert v["run"]["gate"]["id"] == "storyline" and len(list((engine.dir / "doc1").iterdir())) == 2


@pytest.mark.parametrize("body,status,kind", [
    ({"doc": "d", "inputs": {**INPUTS, "prompt": {"text": "  "}}}, 400, "no_inputs"),
    ({"doc": "../x", "inputs": INPUTS}, 400, "bad_doc"),
    ({"doc": ".hidden", "inputs": INPUTS}, 400, "bad_doc"),
    ({"doc": "d", "inputs": {**INPUTS, "kind": "tender"}}, 400, "unsupported_kind"),
    ({"doc": "d", "inputs": {**INPUTS, "format": "huge"}}, 400, "bad_request"),
    ({"doc": "d", "inputs": INPUTS, "mode": "live"}, 403, "live_off"),
    ({"doc": "d", "inputs": INPUTS, "mode": "teleport"}, 400, "bad_request"),
    ({"doc": "d", "inputs": INPUTS, "approvals": {"storyline": {"decision": "edit"}}}, 400, "not_supported"),
])
def test_a_request_the_server_will_not_run_is_refused_with_why(engine, body, status, kind):
    got, err = call(engine.base, "/run", body)
    assert got == status and err["error"]["type"] == kind and err["error"]["message"]
    assert not any(engine.dir.glob("*")), "nothing is written for a refused request"


def test_without_a_recording_or_live_the_server_says_so(tmp_path):
    cfg = srv.Settings({"NAPKIN_DECK_DATA": str(tmp_path), "NAPKIN_DECK_PORT": "0"})
    with pytest.raises(srv.Refused) as e:
        srv.Server(cfg).run({"doc": "d", "inputs": INPUTS})
    assert e.value.status == 409 and e.value.kind == "no_recording"


def test_one_run_at_a_time_a_second_is_refused(engine, monkeypatch):
    gate, go = threading.Event(), threading.Event()
    real = srv.Server.call_engine

    def slow(self, d, req, until):
        gate.set()
        go.wait(10)
        return real(self, d, req, until)
    monkeypatch.setattr(srv.Server, "call_engine", slow)
    start(engine)
    assert gate.wait(10)
    status, err = start(engine, doc="other")
    assert status == 409 and err["error"]["type"] == "job_state"
    assert call(engine.base, "/status")[1]["busy"] == "doc1"
    go.set()
    assert wait(engine.base, "doc1")["state"] == "gate"


def test_an_engine_failure_is_a_failed_stage_with_its_message_and_no_payload(engine, monkeypatch):
    def boom(self, d, req, until):
        raise RuntimeError("the model said no")
    monkeypatch.setattr(srv.Server, "call_engine", boom)
    start(engine)
    v = wait(engine.base, "doc1")
    assert v["state"] == "failed" and "the model said no" in v["error"]["message"] and v["error"]["retryable"] is True
    assert v["run"]["state"] == "failed" and v["run"]["error"] == v["error"] and "payload" not in v
    assert call(engine.base, "/status")[1]["busy"] is None, "a failed run frees the engine"


def test_the_last_step_without_a_renderer_is_refused_before_it_starts(engine, monkeypatch):
    done = {"storyline": {"decision": "approve"}, "territories": {"decision": "approve"}, "idea": {"decision": "approve"}}
    start(engine); wait(engine.base, "doc1")
    start(engine, approvals={"storyline": done["storyline"]}); wait(engine.base, "doc1")
    start(engine, approvals={k: done[k] for k in ("storyline", "territories")}); wait(engine.base, "doc1")
    monkeypatch.setattr(srv.shutil, "which", lambda name: None)
    status, err = call(engine.base, "/run", {"doc": "doc1", "inputs": INPUTS, "approvals": done, "mode": "replay"})
    assert status == 409 and err["error"]["type"] == "no_renderer" and "soffice" in err["error"]["message"]


def test_a_territory_picked_in_a_replay_is_said_not_applied(engine):
    start(engine); wait(engine.base, "doc1")
    _, v = start(engine, approvals={"storyline": {"decision": "approve"}}); v = wait(engine.base, "doc1")
    other = next(t["id"] for t in v["run"]["gate"]["territories"] if t["id"] != v["run"]["gate"]["first_pick"])
    chosen = json.loads(next((engine.dir / "doc1").glob("*/stages/c_territories.json")).read_text())["chosen"]
    start(engine, approvals={"storyline": {"decision": "approve"}, "territories": {"decision": "approve", "picked": other}})
    v = wait(engine.base, "doc1")
    if other != chosen:
        assert any("you picked" in n for n in v["notices"])


def test_live_stops_at_the_cap_before_it_spends_more(tmp_path):
    cfg = srv.Settings({"NAPKIN_DECK_DATA": str(tmp_path), "NAPKIN_DECK_REPLAY": str(FERN / "stages"), "NAPKIN_DECK_LIVE": "1", "NAPKIN_DECK_MAX_USD": "0.05"})
    s = srv.Server(cfg)
    s.run({"doc": "d", "inputs": INPUTS, "mode": "replay", "render": False})   # the recording's stages, which cost money when they were recorded
    while s.busy:
        time.sleep(0.05)
    with pytest.raises(srv.Refused) as e:
        s.run({"doc": "d", "inputs": INPUTS, "mode": "live", "approvals": {"storyline": {"decision": "approve"}}, "render": False})
    assert e.value.status == 402 and e.value.kind == "cost_cap" and "NAPKIN_DECK_MAX_USD" in e.value.message


def test_the_cap_adds_what_each_call_cost_and_refuses_the_next():
    cap = srv.Cap(1.0, already=0.4)
    cap.check()
    cap.add(0.5)
    cap.check()
    cap.add("0.2")
    with pytest.raises(srv.Refused):
        cap.check()
    cap.add(None); cap.add("x")   # a call that gave no figure adds nothing and never breaks the sum


def test_a_file_is_served_only_by_name_from_its_own_documents_folder(engine):
    assert call(engine.base, "/file/doc1/deck.html")[0] == 404
    assert call(engine.base, "/file/doc1/..%2F..%2Fsecret")[0] in (400, 404)
    assert call(engine.base, "/nope")[0] == 404
