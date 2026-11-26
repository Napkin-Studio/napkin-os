"""The engine builds several documents at once (UAT 2026-11-26: one person's build blocked another's for twenty minutes): one run per
document, at most NAPKIN_DECK_MAX_RUNS together, and a run past that waits for a slot and says so, never a dead refusal."""
from __future__ import annotations

import io
import sys
import threading
import time

import pytest

from deck import server as srv
from deck import stages
from deck.tests.test_server import FERN, INPUTS, call, start, wait


def serve(tmp_path, **env):
    cfg = srv.Settings({"NAPKIN_DECK_DATA": str(tmp_path / "runs"), "NAPKIN_DECK_REPLAY": str(FERN / "stages"), "NAPKIN_DECK_PORT": "0", **env})
    httpd = srv.serve(cfg)
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    return type("E", (), {"base": f"http://127.0.0.1:{httpd.server_address[1]}", "cfg": cfg, "dir": tmp_path / "runs", "httpd": httpd})


def held_engine(monkeypatch, n):
    """call_engine waits at a barrier until ``n`` segments are inside it at once, then until ``go`` is set."""
    inside, go, lock = [], threading.Event(), threading.Lock()
    real = srv.Server.call_engine

    def slow(self, d, req, until):
        with lock:
            inside.append(d.name)
        go.wait(15)
        return real(self, d, req, until)
    monkeypatch.setattr(srv.Server, "call_engine", slow)
    return inside, go


def until(pred, secs=10):
    end = time.time() + secs
    while time.time() < end:
        if pred():
            return True
        time.sleep(0.02)
    return False


def test_two_documents_build_at_the_same_time(tmp_path, monkeypatch):
    e = serve(tmp_path)
    inside, go = held_engine(monkeypatch, 2)
    assert start(e, "deck-a")[0] == 202
    status, v = start(e, "deck-b")
    assert status == 202 and v["state"] == "building", v
    assert until(lambda: sorted(inside) == ["deck-a", "deck-b"]), f"both segments run together, not one after the other: {inside}"
    s = call(e.base, "/status")[1]
    assert sorted(s["building"]) == ["deck-a", "deck-b"] and s["waiting"] == [] and s["max_runs"] >= 2
    go.set()
    assert wait(e.base, "deck-a")["state"] == "gate" and wait(e.base, "deck-b")["state"] == "gate"
    assert call(e.base, "/status")[1]["building"] == []
    e.httpd.shutdown()


def test_the_same_document_refuses_a_second_run_while_its_first_is_going(tmp_path, monkeypatch):
    e = serve(tmp_path)
    inside, go = held_engine(monkeypatch, 1)
    start(e, "deck-a")
    assert until(lambda: inside == ["deck-a"])
    status, err = start(e, "deck-a")
    assert status == 409 and err["error"]["type"] == "job_state" and "this deck" in err["error"]["message"]
    go.set()
    assert wait(e.base, "deck-a")["state"] == "gate"
    e.httpd.shutdown()


def test_past_the_limit_a_run_waits_for_a_slot_says_so_and_starts_by_itself(tmp_path, monkeypatch):
    e = serve(tmp_path, NAPKIN_DECK_MAX_RUNS="1")
    inside, go = held_engine(monkeypatch, 1)
    start(e, "deck-a")
    assert until(lambda: inside == ["deck-a"])
    status, v = start(e, "deck-b")
    assert status == 202 and v["state"] == "building", "past the limit a run is queued, never refused"
    assert until(lambda: call(e.base, "/status")[1]["waiting"] == ["deck-b"])
    v = call(e.base, "/run/deck-b")[1]
    now = [r for r in v["run"]["stages"] if r["status"] == "now"]
    assert now and now[0]["sub"] == srv.rs.WAITING_SUB and "starts automatically" in now[0]["sub"]
    assert v["run"]["agent"]["waiting"] is True
    assert inside == ["deck-a"], "the waiting run has not started"
    go.set()
    assert wait(e.base, "deck-a")["state"] == "gate"
    assert wait(e.base, "deck-b")["state"] == "gate", "it starts when the slot frees"
    assert sorted(inside) == ["deck-a", "deck-b"]
    e.httpd.shutdown()


def test_the_limit_comes_from_the_environment():
    assert srv.Settings({"NAPKIN_DECK_MAX_RUNS": "4"}).max_runs == 4
    assert srv.Settings({}).max_runs == srv.DEFAULT_MAX_RUNS
    assert srv.Settings({"NAPKIN_DECK_MAX_RUNS": "0"}).max_runs == 1


def test_each_run_keeps_its_own_cost_cap_when_two_run_at_once(tmp_path, monkeypatch):
    """The cap wraps the model call for the run of the thread that calls it: two runs of two 0.60 calls each stay under a 1.00 cap each
    (a shared cap would see four calls); a third call of one run is refused for that run only."""
    s = srv.Server(srv.Settings({"NAPKIN_DECK_DATA": str(tmp_path), "NAPKIN_DECK_MAX_USD": "1.0"}))
    monkeypatch.setattr(stages, "_call", lambda stage, user, system: ({}, {"usd": 0.6}))
    out, step = {}, threading.Barrier(2)

    def run(name, calls):
        restore = s.guard_live(srv.Doc(tmp_path / name, name), {"mode": "live"})
        try:
            step.wait(5)
            for i in range(calls):
                stages._call("a", "u", "s")
                if i < 2:
                    step.wait(5)
            out[name] = "ok"
        except srv.Refused as e:
            out[name] = e.kind
        finally:
            restore()
    ta, tb = threading.Thread(target=run, args=("a", 3)), threading.Thread(target=run, args=("b", 2))
    ta.start(); tb.start(); ta.join(); tb.join()
    assert out == {"a": "cost_cap", "b": "ok"}
    assert stages._call("a", "u", "s") == ({}, {"usd": 0.6}), "with no run going the call is the plain one again"


def test_what_one_run_prints_never_lands_in_another_runs_message(tmp_path, monkeypatch):
    """The engine's refusal message is the last line it printed: two runs printing at once each keep their own lines."""
    s = srv.Server(srv.Settings({"NAPKIN_DECK_DATA": str(tmp_path), "NAPKIN_DECK_REPLAY": str(FERN / "stages")}))
    both_in = threading.Barrier(2)
    seen = {}

    def fake_main(argv):
        name = argv[argv.index("--client") + 1]
        both_in.wait(5)
        for i in range(50):
            print(f"{name} line {i}", file=sys.stderr)
            time.sleep(0.001)
        raise SystemExit(f"{name} refused")
    monkeypatch.setattr(srv.run_deck, "main", fake_main)

    def run(name):
        d = srv.Doc(tmp_path / name, name)
        d.folder = tmp_path / name / "k"
        req = srv.validate_request({"doc": name, "inputs": {**INPUTS, "prompt": {**INPUTS["prompt"], "client": name}}, "mode": "replay", "render": False}, s.s)
        try:
            s.call_engine(d, req, "b")
        except srv.Refused as e:
            seen[name] = e.message
    t1, t2 = threading.Thread(target=run, args=("alpha",)), threading.Thread(target=run, args=("beta",))
    real_err = sys.stderr
    t1.start(); t2.start(); t1.join(); t2.join()
    assert seen == {"alpha": "alpha line 49", "beta": "beta line 49"}
    assert sys.stderr is real_err or getattr(sys.stderr, "real", None) is real_err, "the real stream is put back or still underneath"
