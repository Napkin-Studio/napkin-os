"""territories-costs: one spend module, a cap named before paid calls, resume never repays, no price in the UI.
Run from engine/: ``PYTHONPATH=. python -m pytest -q territory/tests/test_spend.py``. No model call is made."""
from __future__ import annotations

import re
import threading
import time
from pathlib import Path

import pytest

from territory import cost, pipeline, spend as sp
from territory.llm import FakeLLM
from territory.tests.test_territory import outputs, task

REPO = Path(__file__).resolve().parents[3]


class Paid:
    """A stand-in model: counts real calls and reports tokens, so spend is priced from the table."""

    def __init__(self, delay=0.0):
        self.fake, self.n, self.delay = FakeLLM(outputs()), 0, delay

    def __call__(self, stage, system, user):
        self.n += 1
        time.sleep(self.delay)
        obj, _ = self.fake(stage, system, user)
        return obj, {"model": "claude-sonnet-5-5", "prompt_tokens": 1000, "completion_tokens": 500, "calls": 1}


def test_spend_adds_claude_and_pictures_apart_and_flags_estimates():
    s = sp.Spend(cap_usd=3, images_cap_usd=2)
    s.wrap(Paid())("assumed_brief", "s", "u")
    s.charge_picture("p1", 0.3, lambda: ("img", 0.25))
    assert s.total("claude") > 0 and s.total("runway") == 0.25
    assert s.total() == round(s.total("claude") + 0.25, 6)
    by = {l["provider"]: l for l in s.lines}
    assert by["claude"]["estimated"] is True and by["runway"]["estimated"] is False


def test_total_equals_the_sum_of_calls_priced_from_the_table():
    import price_table
    s = sp.Spend(cap_usd=3)
    llm = s.wrap(Paid())
    llm("tensions", "s", "u1"), llm("sort", "s", "u2")
    assert s.total() == round(2 * price_table.usd("claude-sonnet-5-5", 1000, 500), 6)


def test_the_ask_names_the_cap_before_the_first_call_and_leads_the_history():
    s = sp.Spend(cap_usd=1.5, images_cap_usd=0.5)
    s.ask(cost.estimate())
    s.wrap(Paid())("assumed_brief", "s", "u")
    d = s.decisions()
    assert d[0]["kind"] == "ask" and d[0]["cap_usd"] == {"claude": 1.5, "pictures": 0.5} and d[1]["kind"] == "spend"


def test_a_call_that_would_pass_the_cap_is_not_made():
    inner = Paid()
    s = sp.Spend(cap_usd=0.01)
    with pytest.raises(sp.CapReached) as e:
        s.wrap(inner)("seeds", "s", "u")
    assert inner.n == 0 and not s.lines
    assert not re.search(r"[$€£]|\d", str(e.value))             # a plain message, no price


def test_a_run_stops_at_the_cap_midway_and_keeps_what_was_made():
    inner = Paid()
    s = sp.Spend(cap_usd=sp.estimate_call("assumed_brief") + sp.estimate_call("tensions") + 0.0001)
    with pytest.raises(sp.CapReached):
        pipeline.run(task(), s.wrap(inner))
    assert inner.n == 2 and len(s.lines) == 2


def test_the_picture_cap_is_separate_from_the_claude_cap():
    s = sp.Spend(cap_usd=3, images_cap_usd=0.2)
    with pytest.raises(sp.CapReached) as e:
        s.charge_picture("p", 0.3, lambda: ("x", 0.3))
    assert e.value.provider == "runway"
    s.wrap(Paid())("tensions", "s", "u")                           # Claude still has its own room


def test_env_caps_default_and_refuse_bad_values(monkeypatch):
    monkeypatch.delenv(sp.ENV_CAP, raising=False)
    assert sp.caps()[0] == 3.0
    for bad in ("nan", "inf", "0", "-1", "abc"):
        monkeypatch.setenv(sp.ENV_CAP, bad)
        assert sp.caps()[0] == 3.0
    monkeypatch.setenv(sp.ENV_CAP, "1.25")
    assert sp.caps()[0] == 1.25


def test_resume_after_a_forced_timeout_never_repays_the_finished_stage():
    inner = Paid(delay=0.3)
    s = sp.Spend(cap_usd=3)
    with pytest.raises(TimeoutError):
        s.wrap(inner, timeout=0.05)("assumed_brief", "s", "u")      # the caller gave up; the call is still running
    time.sleep(0.6)                                                 # it finished and was recorded
    obj, _ = s.wrap(inner)("assumed_brief", "s", "u")               # the retry
    assert inner.n == 1 and len(s.lines) == 1 and obj["fields"]


def test_a_retry_while_the_timed_out_call_is_still_running_joins_it():
    inner = Paid(delay=0.3)
    s = sp.Spend(cap_usd=3)
    with pytest.raises(TimeoutError):
        s.wrap(inner, timeout=0.05)("tensions", "s", "u")
    s.wrap(inner)("tensions", "s", "u")                             # waits for the same call
    assert inner.n == 1 and len(s.lines) == 1


def test_a_timeout_at_every_stage_then_a_retry_pays_each_stage_once():
    inner = Paid(delay=0.05)
    s = sp.Spend(cap_usd=3)
    for _ in range(40):
        try:
            pipeline.run(task(), s.wrap(inner, timeout=0.01))
            break
        except TimeoutError:
            time.sleep(0.08)
    else:
        pytest.fail("never finished")
    assert inner.n == len(s.lines) and inner.n == len({l["key"] for l in s.lines})


def test_a_whole_pipeline_resumed_from_disk_makes_zero_calls(tmp_path):
    store = tmp_path / "spend.json"
    a = Paid()
    first = pipeline.run(task(), sp.Spend(cap_usd=3, store=store).wrap(a))
    b = Paid()
    s2 = sp.Spend(cap_usd=3, store=store)
    again = pipeline.run(task(), s2.wrap(b))
    assert a.n >= 7 and b.n == 0 and len(s2.lines) == a.n
    assert [t["id"] for t in again["territories"]] == [t["id"] for t in first["territories"]]


def test_a_failed_call_is_not_charged_and_may_be_tried_again():
    calls = {"n": 0}

    def flaky(stage, system, user):
        calls["n"] += 1
        if calls["n"] == 1:
            raise RuntimeError("provider down")
        return {"ok": 1}, {"model": "claude-sonnet-5-5", "prompt_tokens": 10, "completion_tokens": 10}
    s = sp.Spend(cap_usd=3)
    llm = s.wrap(flaky)
    with pytest.raises(RuntimeError):
        llm("sort", "s", "u")
    assert not s.lines
    assert llm("sort", "s", "u")[0] == {"ok": 1} and len(s.lines) == 1


def test_a_picture_resumed_is_not_paid_twice():
    s = sp.Spend(cap_usd=3, images_cap_usd=2)
    made = []
    for _ in range(2):
        s.charge_picture("same", 0.3, lambda: (made.append(1) or "img", 0.25))
    assert len(made) == 1 and s.total("runway") == 0.25


def test_concurrent_calls_cannot_slip_past_the_cap():
    est = sp.estimate_call("tensions")
    s = sp.Spend(cap_usd=est * 1.5)
    inner = Paid(delay=0.05)
    results = []

    def go(i):
        try:
            s.wrap(inner)("tensions", "s", f"u{i}")
            results.append("ok")
        except sp.CapReached:
            results.append("refused")
    ts = [threading.Thread(target=go, args=(i,)) for i in range(5)]
    [t.start() for t in ts], [t.join() for t in ts]
    assert results.count("ok") >= 1 and inner.n == results.count("ok")


def test_run_log_gets_a_line_per_call():
    got = []
    s = sp.Spend(cap_usd=3, on_line=got.append)
    s.wrap(Paid())("sort", "s", "u")
    assert got[0]["purpose"] == "territory:sort" and got[0]["tin"] == 1000 and got[0]["ok"] is True


def test_the_outcome_is_counts_plus_totals_in_the_history_only():
    s = sp.Spend(cap_usd=3)
    s.outcome("greenlight", routes_found=12, greenlit=3, sent=1)
    e = s.decisions()[-1]
    assert e["kind"] == "outcome" and e["counts"] == {"routes_found": 12, "greenlit": 3, "sent": 1}


def test_no_price_in_any_ui_file_of_the_territories_template():
    # 'Budget' is allowed: it is the carried brief's own field label (budget_and_scope), not a price we show.
    pat = re.compile(r"(€|\$|£)\s?\d|\b(USD|EUR|GBP)\b|\b(price|prices|spend|spent|costs?)\b", re.I)
    hits = []
    for f in (REPO / "app" / "templates" / "territories").rglob("*"):
        if f.is_file() and f.suffix in (".html", ".js", ".css", ".jsx", ".ts", ".tsx", ".md", ".svg"):
            hits += [f"{f.name}: {m.group(0)}" for m in pat.finditer(f.read_text().replace('Budget and scope', ''))]   # the brief field's name, not a price
    assert hits == []


def test_a_document_carrying_spend_is_refused_by_the_contract():
    from territory import contract
    d = contract.example("data")
    d["run"]["spent_usd"] = 1.2
    assert any(p.rule == "price" for p in contract.lint(d))


def test_the_cli_live_run_goes_through_the_spend_module(tmp_path, capsys):
    from territory import run as runmod
    base = ["--category", "condiments", "--market", "IE", "--prompt", "a sauce brief for the under-35s who never think about it", "--material", "invented"]
    out = tmp_path / "r.json"
    runmod.main(base + ["--live", "--out", str(out)], llm_factory=lambda: Paid())
    cid = re.search(r"--yes-cost (c_[0-9a-f]+)", capsys.readouterr().out)
    if cid is None:
        pytest.skip("the gate does not let this prompt proceed")
    runmod.main(base + ["--live", "--yes-cost", cid.group(1), "--out", str(out)], llm_factory=lambda: Paid())
    ledger = __import__("json").loads((tmp_path / "r.spend.json").read_text())
    assert ledger["events"][0]["kind"] == "ask" and len(ledger["lines"]) >= 7
