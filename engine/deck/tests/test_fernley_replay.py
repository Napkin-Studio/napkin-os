"""The Fernley recording replayed through run_deck: what the engine writes from recorded stages, byte for byte
(``deck.json`` without ``meta.built_at``, ``validation.json``, ``report.json`` without its timings). No model call and no
renderer: a stage that is recorded is read, never run, and the renderers and LibreOffice are stubbed. Run from ``engine/``:
``PYTHONPATH=. python3 -m pytest -q deck/tests/test_fernley_replay.py``. Regenerate the golden only for an intended change
to the engine's output: ``DECK_WRITE_GOLDEN=1``, then read the diff (fixtures/fernley/README.md).
"""
from __future__ import annotations

import json
import os
import shutil
from pathlib import Path

import pytest

from deck import layouts, run_deck

FERNLEY = Path(__file__).parent / "fixtures" / "fernley"
CLIENT = "Fernley Drinks Ltd (FICTIONAL, Cork sparkling iced tea brand)"
PROJECT = "Fernley Sparkling Tea 2027 Campaign Pitch"


def args(stages: Path, out: Path, *more: str) -> list[str]:
    return ["--prompt-file", str(FERNLEY / "prompt.txt"), "--stages", str(stages), "--client", CLIENT, "--project", PROJECT,
            "--out", str(out), "--kind", "agency", "--no-qa", *more]


def replay(tmp_path: Path, monkeypatch, *more: str, name: str = "run") -> tuple[dict, Path]:
    """Run the recording through run_deck with nothing rendered; returns (report, out dir)."""
    for mod in (run_deck.render_pptx, run_deck.render_web):
        monkeypatch.setattr(mod, "render", lambda *a, **k: None)
    monkeypatch.setattr(run_deck.subprocess, "run", lambda *a, **k: None)
    monkeypatch.setattr(run_deck, "_soffice", lambda: "soffice")
    stages = tmp_path / f"{name}-stages"
    shutil.copytree(FERNLEY / "stages", stages)
    out = tmp_path / f"{name}-out"
    return run_deck.main(args(stages, out, *more)), out


def normal(report: dict) -> dict:
    """A report without the timings of this machine."""
    r = json.loads(json.dumps(report))
    r.pop("wall_secs", None)
    r.pop("started", None)
    if "validation" in r:
        r["validation"] = layouts.without_plan_summary(r["validation"])
    r.pop("layout_plan", None)   # the plan's own record (golden_plan.json style): not part of the recorded run
    r.get("stages", {}).pop("layout_plan", None)
    for s in r.get("stages", {}).values():
        if isinstance(s, dict):
            s.pop("secs", None)
    return r


def written(out: Path) -> tuple[dict, list, dict]:
    deck = layouts.strip_plan(json.loads((out / "deck.json").read_text()))
    deck["meta"].pop("built_at", None)   # the second the deck was built
    return deck, layouts.without_plan_findings(json.loads((out / "validation.json").read_text())), normal(json.loads((out / "report.json").read_text()))


def test_the_recording_replays_to_the_golden(tmp_path, monkeypatch):
    _, out = replay(tmp_path, monkeypatch)
    deck, validation, report = written(out)
    gold = FERNLEY / "golden"
    if os.environ.get("DECK_WRITE_GOLDEN"):
        for name, data in (("deck.json", deck), ("validation.json", validation), ("report.json", report)):
            (gold / name).write_text(json.dumps(data, indent=1, ensure_ascii=False))
    assert deck == json.loads((gold / "deck.json").read_text())
    assert validation == json.loads((gold / "validation.json").read_text())
    assert report == json.loads((gold / "report.json").read_text())


def test_the_replay_costs_what_the_recording_cost_and_calls_no_model(tmp_path, monkeypatch):
    import sys
    monkeypatch.setitem(sys.modules, "brief_llm", None)   # a model call would fail to import its transport: nothing can be paid for
    rep, _ = replay(tmp_path, monkeypatch)
    assert 0.5 < rep["usd_total"] < 1.5   # the recording's own figures (about 0.83 USD), not a new spend
    assert all(s.get("source") != "live" for s in rep["stages"].values() if isinstance(s, dict))


def test_until_deck_gives_the_same_deck_as_the_whole_run(tmp_path, monkeypatch):
    _, whole = replay(tmp_path, monkeypatch, name="whole")
    _, stopped = replay(tmp_path, monkeypatch, "--until", "deck", name="stopped")
    assert written(whole)[:2] == written(stopped)[:2]


@pytest.mark.parametrize("stage,written_stages", [("b", {"a0", "a", "b", "insight_judge"}), ("c", {"a0", "a", "b", "insight_judge", "c"})])
def test_until_a_gate_reads_only_the_stages_up_to_it(tmp_path, monkeypatch, stage, written_stages):
    rep, out = replay(tmp_path, monkeypatch, "--until", stage)
    assert rep["until"] == stage
    assert not (out / "deck.json").exists()
    seen = {k for k, v in rep["stages"].items() if isinstance(v, dict) and v.get("source") in ("recorded", "live")}
    assert seen <= written_stages | {"inputs"}, seen
    assert "d" not in rep["stages"] and "fit" not in rep["stages"]
