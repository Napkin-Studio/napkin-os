"""territories-engine-server (in-process runner): segments, gates, resume-not-repay, cancel, timeouts, failures in words, Bedrock.
Run from engine/: ``PYTHONPATH=. python -m pytest -q territory/tests/test_runner.py`` (needs jsonschema). No real model is called: a stand-in
model answers every stage and the live path (Spend.wrap, gates.drive, the store) is the one the middleware handler runs (LESSONS 11)."""
from __future__ import annotations

import copy
import json
import re
import sys
import threading
import time
import types
from pathlib import Path

import pytest

pytest.importorskip("jsonschema")

from test_routes import FACTS, FINDINGS, PIN, VERIFIED, outputs as route_outputs  # noqa: E402
from test_world import fake as world_fake  # noqa: E402
from territory import contract, gates, runner, spend as sp  # noqa: E402
from territory.llm import STAGE_MODEL, FakeLLM  # noqa: E402

AT = "2026-11-23T10:00:00Z"
WORDS_BAD = re.compile(r"(blocked_by|derived_resolution|rests_on|_id\b|None\b|null\b|\bfield\b|Traceback|Error\(|\$\d|\busd\b)", re.I)
UPSTREAM = {"upstream": contract.example("data")["upstream"]}


def insights_out(u):
    return {"insights": [
        {"kind": "tension", "text": "They want the break to start sooner, but the drive makes them work for it first.", "cites": [VERIFIED, "brief:audience"]},
        {"kind": "truth", "text": "Sitting down on a train is the first minute of the weekend.", "cites": [PIN]},
        {"kind": "provocation", "text": "What if the platform was the first room of the holiday?", "cites": []}]}


def all_outputs(**over):
    o = {"insights": insights_out, **route_outputs(), **world_fake().outputs}
    o.update(over)
    return o


class Counting:
    """The stand-in model that every stage calls through, counting what it was ASKED (a paid call), keyed like Spend keys it."""

    def __init__(self, outs=None, hook=None):
        self.fake = FakeLLM(outs or all_outputs())
        self.keys, self.hook, self.lock = [], hook, threading.Lock()

    def __call__(self, stage, system, user):
        with self.lock:
            self.keys.append(sp.call_key(stage, system, user))
        if self.hook:
            self.hook(stage)
        return self.fake(stage, system, user)

    @property
    def calls(self):
        return self.fake.calls


def store_in(tmp_path, name="d1"):
    return runner.Store.for_doc(name, tmp_path)


def go(inner, store, doc=None, **kw):
    return runner.run(doc or UPSTREAM, llm=inner, store=store, facts=FACTS, findings=FINDINGS, **kw)


def approved(res):
    d, ref = gates.approve(res.doc, "pick", "Shrey", AT, findings=FINDINGS)
    assert ref == []
    return d


def plain(*texts):
    for t in texts:
        assert t and not WORDS_BAD.search(t), t


# ---------------------------------------------------------------- the live path through every gate


def test_a_new_document_stops_at_pick_after_one_insights_call(tmp_path):
    m = Counting()
    res = go(m, store_in(tmp_path))
    assert m.calls == ["insights"]
    assert res.doc["run"]["state"] == "gate" and res.doc["run"]["gate"]["id"] == "pick" and not res.error
    assert [i["ticked"] for i in res.doc["focus"]["insights"]].count(True) >= 1
    assert contract.problems(res.doc) == []
    assert [d["kind"] for d in res.decisions][0] == "ask"           # the ask is the first entry, before the first paid call


def test_a_held_gate_makes_no_model_call_and_an_approval_goes_on(tmp_path):
    st, m = store_in(tmp_path), Counting()
    first = go(m, st)
    n = len(m.calls)
    again = go(m, st, first.doc)                                      # the pick is not approved: held
    assert len(m.calls) == n and again.doc["run"]["gate"]["id"] == "pick"
    d = approved(first)
    res = go(m, st, d)
    assert res.doc["run"]["state"] == "gate" and res.doc["run"]["gate"]["id"] == "greenlight" and not res.error
    assert {"explore", "develop"} <= {s["stage"] for s in res.info["segments"] if s["state"] == "finished"}
    assert all(t["state"] == "developed" for t in res.doc["territories"] if t["status"] == "live")
    assert contract.problems(res.doc) == [] and contract.check(res.doc, facts=FACTS, findings=FINDINGS) == []
    again = go(m, st, res.doc)                                        # the greenlight is not approved: held, nothing paid
    n = len(m.calls)
    again = go(m, st, res.doc)
    assert len(m.calls) == n


def test_an_old_approval_holds_after_the_picks_change(tmp_path):
    st, m = store_in(tmp_path), Counting()
    d = approved(go(m, st))
    n = len(m.calls)
    d["focus"]["insights"][0]["ticked"] = not d["focus"]["insights"][0]["ticked"]
    d["focus"]["insights"][1]["ticked"] = True
    d["focus"]["insights"][2]["ticked"] = True
    res = go(m, st, d)
    assert len(m.calls) == n and res.doc["run"]["gate"]["id"] == "pick"


def test_no_price_reaches_the_document_only_the_decisions(tmp_path):
    st = store_in(tmp_path)
    res = go(Counting(), st)
    res = go(Counting(), st, approved(res))
    text = json.dumps(res.doc).lower()
    assert "usd" not in text and not [p for p in contract.lint(res.doc) if p.rule == "price"]
    assert any(d["kind"] == "spend" for d in res.decisions) or res.spent_usd["claude"] >= 0


# ---------------------------------------------------------------- resume, never repay (LESSONS 13)


def test_a_killed_run_resumed_from_the_store_repays_nothing(tmp_path):
    st = store_in(tmp_path)
    d = approved(go(Counting(), st))
    seen = {"n": 0}

    def kill(stage):
        if stage.startswith("route_"):
            seen["n"] += 1
            if seen["n"] >= 3:
                raise KeyboardInterrupt        # the process dies mid-explore: nothing after this call runs
    first = Counting(hook=kill)
    died = go(first, st, d)                                         # a real kill leaves no result at all; the run here ends failed
    assert died.doc["run"]["state"] == "failed"
    paid_before = {l["key"] for l in json.loads(st.spend_path.read_text())["lines"]}
    assert paid_before                                              # something finished and is on record
    second = Counting()
    res = go(second, st, d)                                         # the document as it was persisted before the kill
    assert res.doc["run"]["gate"]["id"] == "greenlight" and not res.error
    assert not (set(second.keys) & paid_before)                     # no finished call was asked of the model again
    lines = json.loads(st.spend_path.read_text())["lines"]
    assert len({l["key"] for l in lines}) == len(lines)             # and none was paid twice


def test_a_retry_after_a_failed_stage_resumes_not_repays(tmp_path):
    st = store_in(tmp_path)
    d = approved(go(Counting(), st))
    boom = {"on": True}

    def bad_world(u):
        if boom["on"]:
            raise RuntimeError("provider unavailable")
        return all_outputs()["world"](u)
    first = Counting(all_outputs(world=bad_world))
    res = go(first, st, d)
    assert res.doc["run"]["state"] == "failed" and res.error["retryable"]
    plain(res.error["message"])
    boom["on"] = False
    paid_first = {l["key"] for l in json.loads(st.spend_path.read_text())["lines"]}
    doc = gates.request(res.doc, "pick", "retry", AT)
    second = Counting(all_outputs(world=bad_world))
    done = go(second, st, doc)
    assert done.doc["run"]["state"] == "gate" and done.doc["run"]["gate"]["id"] == "greenlight"
    assert not (set(second.keys) & paid_first)                       # nothing recorded as paid in the first run was asked again
    assert not [s for s in second.calls if s.startswith("route_")]    # explore finished the first time: not asked again


# ---------------------------------------------------------------- cancel, timeout, lock


def test_cancel_before_the_run_makes_no_call_and_says_so(tmp_path):
    ev = threading.Event()
    ev.set()
    m = Counting()
    res = go(m, store_in(tmp_path), cancel=ev)
    assert m.calls == [] and res.stopped and res.doc["run"]["state"] == "failed" and res.error["retryable"]
    assert "stopped" in res.error["message"]
    plain(res.error["message"])


def test_cancel_during_explore_stops_before_the_next_call_and_resumes(tmp_path):
    st, ev = store_in(tmp_path), threading.Event()
    d = approved(go(Counting(), st))
    n = {"c": 0}

    def hook(stage):
        n["c"] += 1
        if n["c"] == 2:
            ev.set()
    m = Counting(hook=hook)
    res = go(m, st, d, cancel=ev)
    assert res.stopped and res.doc["run"]["state"] == "failed" and res.error["retryable"]
    assert len(m.calls) <= 7                                        # the five headings were already out; nothing new was started
    after = Counting()
    done = go(after, st, d)
    assert done.doc["run"]["gate"]["id"] == "greenlight"
    assert len(after.keys) == len(set(after.keys)) and set(after.keys).isdisjoint({k for k in m.keys})   # what finished before the stop is read, not asked


def test_the_timeout_comes_from_measured_latency(tmp_path, monkeypatch):
    st = store_in(tmp_path)
    monkeypatch.delenv(runner.ENV_TIMEOUT, raising=False)
    assert st.timeout_for("world") == runner.DEFAULT_TIMEOUT        # nothing measured: the stated default
    st.note_latency("world", 100.0)
    st.note_latency("world", 40.0)
    assert st.timeout_for("world") == runner.TIMEOUT_MULT * 100.0
    st.note_latency("judge", 1.0)
    assert st.timeout_for("judge") == runner.TIMEOUT_FLOOR          # never below the floor
    st.note_latency("kill", 5000.0)
    assert st.timeout_for("kill") == runner.TIMEOUT_CAP             # never above the cap
    assert st.timeout_for("route_core") == runner.DEFAULT_TIMEOUT   # per stage, not shared
    monkeypatch.setenv(runner.ENV_TIMEOUT, "45")
    assert st.timeout_for("route_core") == 45.0


def test_latency_is_measured_from_calls_and_kept_across_runs(tmp_path):
    st = store_in(tmp_path)
    go(Counting(), st)
    assert "insights" in st.latency() and st.latency()["insights"][0] >= 0
    again = runner.Store(st.dir)                                    # a new process reads the same folder
    assert "insights" in again.latency()


def test_a_slow_call_times_out_in_words_and_its_late_answer_is_not_repaid(tmp_path, monkeypatch):
    st = store_in(tmp_path)
    monkeypatch.setattr(runner, "TIMEOUT_FLOOR", 0.05)
    st.note_latency("insights", 0.01)                               # measured fast: the timeout is the (patched) floor
    gate = threading.Event()
    calls = []

    def slow(u):
        calls.append(1)
        gate.wait(2)
        return insights_out(u)
    m = Counting(all_outputs(insights=slow))
    res = go(m, st)
    assert res.doc["run"]["state"] == "failed" and res.error["retryable"]
    plain(res.error["message"])
    gate.set()
    time.sleep(0.2)                                                 # the late answer lands in the store
    m2 = Counting(all_outputs(insights=slow))
    res2 = go(m2, st)
    assert res2.doc["run"]["gate"]["id"] == "pick" and len(calls) == 1      # read, not bought again


def test_one_run_per_document(tmp_path):
    st = store_in(tmp_path)
    inside, release = threading.Event(), threading.Event()

    def hold(stage):
        inside.set()
        release.wait(5)
    out = {}
    t = threading.Thread(target=lambda: out.update(r=go(Counting(hook=hold), st)))
    t.start()
    assert inside.wait(5)
    m2 = Counting()
    res = go(m2, st)
    release.set()
    t.join(10)
    assert res.busy and m2.calls == [] and res.refusals == [runner.BUSY_WORDS]
    assert not out["r"].busy and out["r"].doc["run"]["gate"]["id"] == "pick"
    assert not go(Counting(), st).busy                              # the lock is released


# ---------------------------------------------------------------- failures are words


def test_a_model_failure_is_a_retryable_error_in_words(tmp_path):
    def boom(u):
        raise RuntimeError("HTTP 529 overloaded trace at line 4")
    res = go(Counting(all_outputs(insights=boom)), store_in(tmp_path))
    assert res.doc["run"]["state"] == "failed" and res.error["retryable"]
    plain(res.error["message"])
    assert "529" not in res.error["message"] and "line 4" not in res.error["message"]
    assert contract.problems(res.doc) == []


def test_the_cap_stops_the_run_in_words_before_a_paid_call(tmp_path):
    m = Counting()
    res = go(m, store_in(tmp_path), cap_usd=0.0001)
    assert m.calls == [] and res.error and "limit" in res.error["message"]
    plain(res.error["message"])


def test_nothing_carried_is_a_plain_refusal_not_a_made_up_run(tmp_path):
    m = Counting()
    res = runner.run({}, llm=m, store=store_in(tmp_path))
    assert m.calls == [] and res.doc["run"]["state"] == "failed" and not res.error["retryable"]
    plain(res.error["message"])


def test_a_stage_that_is_not_built_is_a_failure_in_words(tmp_path, monkeypatch):
    st = store_in(tmp_path)
    d = approved(go(Counting(), st))
    monkeypatch.setattr(gates, "drive", lambda doc, stages, **kw: gates.drive.__wrapped__(doc, {}, **kw) if hasattr(gates.drive, "__wrapped__") else
                        gates._fail(doc, "explore", "The explore step is not built yet, so nothing was run.", retryable=False))
    res = go(Counting(), st, d)
    assert res.error and "not built" in res.error["message"]


def test_an_invalid_final_document_is_refused_in_words_not_returned(tmp_path, monkeypatch):
    real = contract.problems

    class P:
        words, path, rule = "A route has no name.", "territories.0.name", "shape"

    monkeypatch.setattr(contract, "problems", lambda d: [P()] if (d.get("run") or {}).get("state") == "gate" else real(d))
    res = go(Counting(), store_in(tmp_path))
    assert res.doc["run"]["state"] == "failed" and res.error["refused"] == ["A route has no name."]
    plain(res.error["message"])


# ---------------------------------------------------------------- the person's moves on the same store


def test_steer_and_undo_go_through_the_same_store_and_lock(tmp_path):
    st = store_in(tmp_path)
    res = go(Counting(), st, approved(go(Counting(), st)))
    crew = res.doc["crew"][0]["id"]
    m = Counting()
    out = runner.steer(res.doc, crew, "further", "Shrey", llm=m, store=st, facts=FACTS, findings=FINDINGS)
    assert not out.busy and out.refusals == [] and set(m.calls) <= {s for s in STAGE_MODEL}
    nobody = runner.steer(res.doc, crew, "further", "", llm=m, store=st, facts=FACTS, findings=FINDINGS)
    assert nobody.refusals and nobody.doc == res.doc
    un = runner.undo(res.doc, "no_such_action", "Shrey")
    assert un.refusals == ["That action is not in this run."]


def test_rerank_goes_through_the_same_store_and_lock(tmp_path):
    st = store_in(tmp_path)
    res = go(Counting(), st, approved(go(Counting(), st)))
    m = Counting()
    out = runner.rerank(res.doc, "Shrey", llm=m, store=st, facts=FACTS, findings=FINDINGS)
    assert not out.busy and out.refusals == [] and out.info["calls"] == {"judge": 1} and contract.problems(out.doc) == []     # the same ask as develop's: read from the store, not paid again
    assert runner.rerank(res.doc, "", llm=m, store=st).refusals


# ---------------------------------------------------------------- Bedrock, and no deck package (LESSONS 2, 3)


def test_territory_runs_without_the_deck_package():
    """The middleware image carries engine/territory and brief_llm.py, not engine/deck: nothing the runner loads may reach for it."""
    import subprocess
    code = ("import sys; sys.modules['deck'] = None; import territory.runner, territory.llm, territory.gates, territory.routes, territory.world, "
            "territory.insights, territory.spend, territory.contract, territory.carried; print('ok')")
    out = subprocess.run([sys.executable, "-c", code], cwd=Path(runner.__file__).resolve().parents[1], capture_output=True, text=True,
                         env={**__import__("os").environ, "PYTHONPATH": "."})
    assert out.stdout.strip() == "ok", out.stderr[-600:]


def test_live_llm_reaches_claude_on_bedrock_with_the_mapped_id(monkeypatch):
    sys.path.insert(0, str(Path(runner.__file__).resolve().parents[1]))
    import brief_llm as L
    from territory.llm import LiveLLM
    made, sent = [], []

    class Messages:
        def create(self, **kw):
            sent.append(kw)
            return types.SimpleNamespace(content=[types.SimpleNamespace(type="text", text='{"ok": true}')],
                                         usage=types.SimpleNamespace(input_tokens=11, output_tokens=7), stop_reason="end_turn")

    class Anthropic:
        def __init__(self, **kw):
            made.append(("anthropic", kw))
            self.messages = Messages()

    class AnthropicBedrock(Anthropic):
        def __init__(self, **kw):
            super().__init__(**kw)
            made[-1] = ("bedrock", kw)

    monkeypatch.setitem(sys.modules, "anthropic", types.SimpleNamespace(Anthropic=Anthropic, AnthropicBedrock=AnthropicBedrock))
    monkeypatch.setattr(L, "_ANTHROPIC_CLIENTS", {})
    monkeypatch.setenv("NAPKIN_MODEL_API", "bedrock")
    monkeypatch.setenv("NAPKIN_MODEL_REGION", "eu-west-1")
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    obj, usage = LiveLLM(approved=True)("insights", "system", "user")
    assert obj == {"ok": True} and usage["model"] == STAGE_MODEL["insights"]
    assert made and made[0][0] == "bedrock" and made[0][1].get("aws_region") == "eu-west-1"
    assert sent and sent[0]["model"] == L.bedrock_model_id(STAGE_MODEL["insights"]) != STAGE_MODEL["insights"]


def test_live_llm_still_needs_the_yes():
    from territory.llm import LiveLLM
    with pytest.raises(PermissionError):
        LiveLLM()


def test_the_result_carries_what_the_run_log_needs(tmp_path):
    """Segment seconds, the calls the cap refused and the calls that paid nothing (features/territories-telemetry)."""
    store = store_in(tmp_path, "tele")
    res = go(Counting(), store)
    assert res.info["cap_stops"] == [] and res.info["reused"] == 0
    assert all(isinstance(r.get("secs"), float) for r in store.segments() if r["state"] != "started")
    again = go(Counting(), store)                                    # the same document again: every call is read from the record
    assert again.info["reused"] >= 1 and again.spent_usd == res.spent_usd
    capped = go(Counting(), store_in(tmp_path, "tele2"), cap_usd=0.0001)
    assert capped.info["cap_stops"] == ["claude"]


def test_a_run_right_after_a_stopped_one_waits_for_it_to_let_go_instead_of_saying_busy():
    """Stop, then Try again (live test T2): the stopped run's thread is still in its last model call, holding the document. The new run waits for
    it to let go rather than answering "already going"; a run that is itself stopped while waiting gives up at once, and the wait has an end."""
    lock = threading.Lock()
    lock.acquire()
    threading.Timer(0.3, lock.release).start()
    t0 = time.monotonic()
    assert runner._acquire_after_stop(lock, None, lambda: True, wait=5) is True and time.monotonic() - t0 < 3
    lock.release()
    held = threading.Lock(); held.acquire()
    stop = threading.Event(); stop.set()
    assert runner._acquire_after_stop(held, stop, lambda: True, wait=5) is False, "a run stopped while it waits does not start"
    assert runner._acquire_after_stop(held, None, lambda: True, wait=0) is False, "and the wait ends"
    t0 = time.monotonic()
    assert runner._acquire_after_stop(held, None, lambda: False, wait=5) is False and time.monotonic() - t0 < 0.5, "a live holder: busy at once"


def _bulk(n):
    """The carried pins plus ``n`` more, as a big research would carry them (acceptance A12: 89 pins broke the Pick at 80)."""
    rows = FACTS["facts"]
    return {**FACTS, "facts": rows + [{**rows[0], "id": f"f_BULK{i:05d}"} for i in range(n)]}


@pytest.mark.parametrize("extra", [90, 300])
def test_a_big_research_runs_to_the_pick_and_every_source_stays_in_play(tmp_path, extra):
    """Every brief field, pin and finding the crew may quote is in the Pick's list, nothing dropped (owner rule: a hand-off carries the full
    upstream), and the document passes the app's own schema and rules: through the full runner and the contract check, not a stub."""
    facts = _bulk(extra)
    res = runner.run(UPSTREAM, llm=Counting(), store=store_in(tmp_path), facts=facts, findings=FINDINGS)
    assert res.doc["run"].get("error") is None, res.doc["run"].get("error")
    srcs = res.doc["focus"]["sources"]
    assert {f["id"] for f in facts["facts"]} <= {s["id"] for s in srcs} and all(s["in_play"] for s in srcs)
    assert len(srcs) > 80 and len(srcs) <= contract.limit("focus", "sources")
    assert contract.check(res.doc, facts=facts, findings=FINDINGS) == []


def test_a_refused_result_still_lands_failed_in_words_with_what_it_made(tmp_path, monkeypatch):
    """A result the app would refuse (acceptance A13) is not dropped: the run is failed in words, retryable, with what to fix, the part that
    broke put back as the run found it and the insights kept; the failed document is itself one the app takes."""
    real = contract.check

    def capped(doc, **kw):      # the app refusing a Pick list over 5, as it refused 103 over 80
        ps = real(doc, **kw)
        n = len((doc.get("focus") or {}).get("sources") or [])
        return ps + ([contract.Problem("focus.sources", "maxItems", f"The pick has {n} sources; the most allowed is 5.")] if n > 5 else [])
    monkeypatch.setattr(contract, "check", capped)
    res = runner.run(UPSTREAM, llm=Counting(), store=store_in(tmp_path), facts=FACTS, findings=FINDINGS)
    run = res.doc["run"]
    assert run["state"] == "failed" and run["error"]["stage"] == "pick" and run["error"]["retryable"] is True
    assert "did not fit what the app can show" in run["error"]["message"]
    assert any("sources; the most allowed is 5" in r for r in run["error"]["refused"]), run["error"]["refused"]
    plain(run["error"]["message"], *run["error"]["refused"])
    assert res.doc["focus"]["insights"], "the insights the engine made are kept"
    assert capped(res.doc, facts=FACTS, findings=FINDINGS) == [], "the failed document is one the app takes"

    # Try again, once the cause is gone: the Pick is rebuilt from the insights it kept, with no model call, and opens for the person.
    monkeypatch.setattr(contract, "check", real)
    llm = Counting()
    again = runner.run(res.doc, llm=llm, store=store_in(tmp_path), facts=FACTS, findings=FINDINGS)
    assert not llm.keys, llm.keys
    assert again.doc["run"]["state"] != "failed" and (again.doc["run"].get("gate") or {}).get("id") == "pick", again.doc["run"]
    assert again.doc["focus"]["insights"] == res.doc["focus"]["insights"]
    assert len(again.doc["focus"]["sources"]) > 5 and all(s["in_play"] for s in again.doc["focus"]["sources"])
    assert contract.check(again.doc, facts=FACTS, findings=FINDINGS) == []


def test_the_refusal_names_a_list_in_words_never_a_list():
    """'The pick has 103 a list' (acceptance A12): every list the schema caps has a name, and one without reads 'entries'."""
    words = contract.LIST_NAME
    for k in ("sources", "finds", "lookups", "asks", "sends", "decisions"):
        assert k in words
    class E:
        absolute_path, validator, validator_value, instance = ["focus", "sources"], "maxItems", 80, list(range(103))
    assert contract._words(E) == "The pick has 103 sources; the most allowed is 80."
    E.absolute_path = ["something_new"]
    assert "has 103 entries;" in contract._words(E)
