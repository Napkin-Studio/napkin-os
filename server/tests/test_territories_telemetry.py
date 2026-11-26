"""The Territories run log record (features/territories-telemetry): it equals the ledger, holds no client text, and a cancelled or resumed
step is logged honestly with nothing counted twice. The real middleware and runner, a stand-in model; no paid call."""
import copy
import json
import sys
import time
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "engine"))
sys.path.append(str(ROOT / "engine" / "territory" / "tests"))

from territory import runner, spend as sp                          # noqa: E402

from napkin import runlog                                           # noqa: E402
from napkin.territories import job as tjob, telemetry               # noqa: E402

from test_brief import DOC, post                                    # noqa: E402
from test_territories import (Held, SCHEMA, UPSTREAM, FACTS, FINDINGS, TerritoriesHost, approve_pick, at_pick, step, terr)  # noqa: E402,F401


@pytest.fixture(autouse=True)
def priced(terr, monkeypatch):
    """The stand-in model reports tokens, so the ledger prices each call (a model that reports none costs nothing, which proves nothing)."""
    inner = terr.model_calls

    def call(stage, system, user):
        obj, u = inner(stage, system, user)
        return obj, {**u, "model": "claude-sonnet-4-5", "usd": None, "prompt_tokens": 1500 + len(user) % 50, "completion_tokens": 700, "calls": 1}
    call.calls = inner.calls
    monkeypatch.setattr(tjob, "make_llm", lambda: call)
    return call


@pytest.fixture
def logs(tmp_path):
    runlog.configure(str(tmp_path / "runs"), bodies=True)           # bodies ON: the strictest place to show the record holds none
    yield tmp_path / "runs"
    runlog.configure(None)


def records(d: Path):
    out = []
    for f in sorted(d.rglob("run_territories-*.jsonl")):
        for line in f.read_text().splitlines():
            r = json.loads(line)
            if r.get("ev") == "note" and r.get("what") == telemetry.WHAT:
                out.append(r)
    return sorted(out, key=lambda r: r["t"])


def ledger_total(tmp_path, doc=DOC):
    return sp.Spend(store=runner.Store.for_doc(doc, tmp_path / "territory").spend_path).total()


def test_the_record_equals_the_ledger_and_the_outcome_is_counted(terr, logs, tmp_path):
    host = at_pick(terr)
    approve_pick(host)
    step(terr, host)
    first, second = records(logs)
    assert first["step"] == "run" and first["held_at"] == "pick" and second["held_at"] == "greenlight"
    assert second["spend"]["usd"] > 0 and second["paid_calls"] == sum(b["calls"] for b in second["spend"]["by_provider"].values())
    total = ledger_total(tmp_path)
    assert round(first["spend"]["usd"] + second["spend"]["usd"], 6) == total == second["ledger"]["usd"]
    assert sum(b["usd"] for b in second["spend"]["by_stage"].values()) == pytest.approx(second["spend"]["usd"])
    assert second["outcome"]["routes"] > 0 and second["outcome"]["developed"] > 0 and second["outcome"]["greenlit"] == 0
    assert {s["stage"] for s in second["stages"]} >= {"explore", "develop"} and all(s["secs"] is not None for s in second["stages"])
    assert "error_kind" not in second


def test_no_client_text_in_the_record(terr, logs):
    host = at_pick(terr)
    approve_pick(host)
    step(terr, host)
    words = set()

    def walk(x):
        if isinstance(x, str) and len(x) > 12:
            words.add(x)
        elif isinstance(x, dict):
            [walk(v) for v in x.values()]
        elif isinstance(x, list):
            [walk(v) for v in x]
    walk(UPSTREAM), walk(FACTS), walk(FINDINGS), walk(host.data.get("territories")), walk(host.data.get("focus"))
    text = "\n".join(json.dumps(r, ensure_ascii=False) for r in records(logs))
    assert text and not [w for w in words if w in text]
    for r in records(logs):
        assert not set(r) & runlog.STDOUT_DROPS


def test_a_cancelled_step_is_logged_cancelled_and_the_resume_counts_only_its_own_calls(terr, logs, tmp_path, monkeypatch, priced):
    held = Held(priced)
    monkeypatch.setattr(tjob, "make_llm", lambda: held)
    host = TerritoriesHost(data=copy.deepcopy(UPSTREAM), schema=SCHEMA)
    st, first = post(terr, "run_territories", {}, host.clan())
    assert held.entered.wait(10)
    post(terr, "cancel_job", {"job_id": first["job"]["id"]}, host.clan())
    held.go.set()
    for _ in range(200):
        if records(logs):
            break
        time.sleep(0.05)
    monkeypatch.setattr(tjob, "make_llm", lambda: priced)
    step(terr, host)
    a, b = records(logs)
    assert a["state"] == "cancelled" and a["cancelled"] and a["error_kind"] == "stopped"
    assert a["spend"]["usd"] == ledger_total(tmp_path) - b["spend"]["usd"], "the call on the wire was paid once, in the cancelled step"
    assert b["spend"]["usd"] == 0 and b["paid_calls"] == 0 and b["reused"] >= 1, "the resume read it and paid nothing"
    assert b["ledger"]["usd"] == ledger_total(tmp_path)


def test_a_cap_stop_and_a_failure_are_logged(terr, logs, monkeypatch):
    monkeypatch.setenv(sp.ENV_CAP, "0.00001")
    host = TerritoriesHost(data=copy.deepcopy(UPSTREAM), schema=SCHEMA)
    step(terr, host)
    r, = records(logs)
    assert r["cap_stops"] == {"claude": 1} and r["error_kind"] == "cap" and r["paid_calls"] == 0 and r["spend"]["usd"] == 0
    monkeypatch.delenv(sp.ENV_CAP)

    def boom(doc, **kw):
        raise RuntimeError("secret client words")
    monkeypatch.setattr(runner, "run", boom)
    host2 = TerritoriesHost(data=copy.deepcopy(UPSTREAM), schema=SCHEMA)
    step(terr, host2)
    last = records(logs)[-1]
    assert last["state"] == "failed" and last["error_kind"] == "failed" and "secret" not in json.dumps(last)


def test_a_quick_move_is_logged_with_no_spend_and_the_report_reads_it(terr, logs, tmp_path):
    host = at_pick(terr)
    approve_pick(host)
    step(terr, host)
    rid = next(t["id"] for t in host.data["territories"] if t.get("status") == "live")
    step(terr, host, "greenlight_route", territory_id=rid, by="Shrey")
    last = records(logs)[-1]
    assert last["step"] == "greenlight_route" and last["spend"]["usd"] == 0 and last["outcome"]["greenlit"] == 1
    out = telemetry.report(logs)
    assert "greenlight_route" in out and "routes/developed/greenlit/sent" in out


def test_a_log_that_cannot_be_written_never_stops_the_run(terr, logs, monkeypatch):
    monkeypatch.setattr(telemetry, "build", lambda *a, **k: 1 / 0)
    host = TerritoriesHost(data=copy.deepcopy(UPSTREAM), schema=SCHEMA)
    replies = step(terr, host)
    assert replies[-1]["job"]["state"] == "done"
