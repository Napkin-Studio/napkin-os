"""``run_deck --until``: stop after a stage, or after the deck is assembled and validated and before anything is rendered
(features/deck-maker-server.clan). No model call: recorded stages, and the renderers and the live stage stubbed. Run from
``engine/``: ``PYTHONPATH=. python3 -m pytest -q deck/tests/test_until.py``.
"""
from __future__ import annotations

import json
import shutil
from pathlib import Path

import pytest

from deck import run_deck, stages

BRIEF = Path(__file__).parent / "fixtures" / "lumen_water"
RECORDED = ("a_requirements.json", "b_storyline.json", "c_territories.json", "d_idea.json")


def _stages_dir(tmp_path: Path, name: str = "stages") -> Path:
    d = tmp_path / name
    d.mkdir()
    for f in RECORDED:
        data = json.loads((BRIEF / f).read_text())
        data["usage"] = {"model": "claude-opus-5-5", "prompt_tokens": 1000, "completion_tokens": 100, "secs": 1}
        (d / f).write_text(json.dumps(data))
    return d


def _args(stages_dir: Path, out: Path, *more: str) -> list[str]:
    return ["--brief", str(BRIEF / "brief_object.json"), "--stages", str(stages_dir), "--client", "Lumen Water",
            "--project", "National awareness campaign", "--out", str(out), "--no-qa", *more]


@pytest.fixture
def renders(monkeypatch, tmp_path):
    """Count what is rendered; nothing is written and LibreOffice is never asked."""
    calls: list[str] = []
    monkeypatch.setattr(run_deck.render_pptx, "render", lambda *a, **k: calls.append("pptx") or tmp_path / "deck.pptx")
    monkeypatch.setattr(run_deck.render_web, "render", lambda *a, **k: calls.append("web"))
    monkeypatch.setattr(run_deck.subprocess, "run", lambda *a, **k: calls.append("soffice"))
    monkeypatch.setattr(run_deck, "_soffice", lambda: "soffice")
    return calls


@pytest.mark.parametrize("stage", ["b", "c", "d"])
def test_a_stage_stops_the_run_with_a_report_and_no_deck(tmp_path, renders, stage):
    out = tmp_path / "out"
    rep = run_deck.main(_args(_stages_dir(tmp_path), out, "--until", stage))
    assert rep["until"] == stage
    assert (out / "report.json").exists()
    assert json.loads((out / "report.json").read_text())["until"] == stage
    assert not (out / "deck.json").exists() and not (out / "validation.json").exists()
    assert renders == []
    assert rep["usd_total"] > 0   # the recorded stages' cost is totalled, as in a whole run


def test_until_deck_writes_the_deck_and_renders_nothing(tmp_path, renders):
    out = tmp_path / "out"
    rep = run_deck.main(_args(_stages_dir(tmp_path), out, "--until", "deck"))
    assert rep["until"] == "deck" and rep["slides"] > 0
    assert (out / "deck.json").exists() and (out / "validation.json").exists() and (out / "report.json").exists()
    assert renders == [], "no file is rendered before the stop"
    assert not (out / "deck.pdf").exists() and not (out / "deck.pptx").exists()


def test_the_deck_at_the_stop_is_the_deck_of_a_whole_run(tmp_path, renders):
    whole, stopped = tmp_path / "whole", tmp_path / "stopped"
    run_deck.main(_args(_stages_dir(tmp_path, "s1"), whole))
    run_deck.main(_args(_stages_dir(tmp_path, "s2"), stopped, "--until", "deck"))
    def deck(d: Path) -> dict:
        got = json.loads((d / "deck.json").read_text())
        got["meta"].pop("built_at")   # the one clock-dependent field: the second the deck was built
        return got
    assert deck(whole) == deck(stopped)
    assert (whole / "validation.json").read_text() == (stopped / "validation.json").read_text()


def test_a_run_without_until_is_unchanged(tmp_path, renders):
    out = tmp_path / "out"
    rep = run_deck.main(_args(_stages_dir(tmp_path), out))
    assert "until" not in rep and "until" not in json.loads((out / "report.json").read_text())
    assert renders == ["pptx", "web", "soffice", "soffice"]   # the pptx, the web deck, then the two LibreOffice and pdftoppm calls
    assert {"slides", "slides_by_status", "wall_secs", "usd_total"} <= set(rep)


def test_a_stage_the_deck_type_does_not_run_is_refused(tmp_path, renders, capsys):
    with pytest.raises(SystemExit) as e:
        run_deck.main(_args(_stages_dir(tmp_path), tmp_path / "out", "--until", "i"))   # 'i' is the investor deck's story
    assert e.value.code == 2
    assert "no such stage" in capsys.readouterr().err
    assert not (tmp_path / "out" / "report.json").exists()


def test_a_live_run_makes_the_missing_stages_folder_before_the_first_stage(tmp_path, renders, monkeypatch):
    """The folder is made first: a live run used to fail on its first write, after the first paid call."""
    missing = tmp_path / "does" / "not" / "exist"
    ran: list[str] = []

    def fake(k, inp, st, profile):
        assert missing.is_dir(), "the stages folder exists before a stage is run"
        ran.append(k)
        return {"stage": k}, {"model": "stub", "tokens_in": 0, "tokens_out": 0, "usd": 0}

    monkeypatch.setattr(stages, "run_stage", fake)
    run_deck.main(_args(missing, tmp_path / "out", "--live", "--until", "a"))
    assert ran and ran[-1] == "a"
    assert (missing / "a_requirements.json").exists()
    assert not (tmp_path / "out" / "deck.json").exists()


def test_a_recorded_run_does_not_make_a_folder_it_was_not_given(tmp_path, renders):
    missing = tmp_path / "nope"
    run_deck.main(_args(missing, tmp_path / "out", "--until", "b"))
    assert not missing.exists()
