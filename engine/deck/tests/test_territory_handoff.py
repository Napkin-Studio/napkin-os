"""The territory tool to Deck Maker handoff (deck-concepts): a territory run for the project becomes stage c's candidate territories, and
its frames the territories' pictures, instead of being ignored. ``--territory-run RUN.json|DIR|auto`` on run_deck; ``from_territory.
import_run`` / ``find_run`` / ``auto_runs`` underneath. Offline: the invented Lumen Water demo run, its plan and frames (fixtures/frames_demo)."""
from __future__ import annotations

import json
import shutil
from pathlib import Path

import pytest

from deck import from_territory as ft

HERE = Path(__file__).resolve().parent
DEMO = HERE / "fixtures" / "frames_demo"
RUN = DEMO / "lumen_run.json"


def _copy_run(dst: Path, frames: bool = True) -> Path:
    dst.mkdir(parents=True, exist_ok=True)
    shutil.copy(RUN, dst / RUN.name)
    shutil.copy(DEMO / "lumen_run.frames-plan.json", dst / "lumen_run.frames-plan.json")
    if frames:
        shutil.copytree(DEMO / "lumen_run.frames", dst / "lumen_run.frames")
    return dst / RUN.name


def test_a_run_with_frames_becomes_stage_c_and_frames(tmp_path):
    run = _copy_run(tmp_path / "proj" / "territory")
    st = tmp_path / "proj" / "deck" / "stages"
    got = ft.import_run(run, st)
    c = json.loads((st / "c_territories.json").read_text())
    assert got["territories"] == len(c["territories"]) >= 2 and got["frames"] > 0 and got["version"].startswith("v1-")
    assert c["chosen"] == c["ranking"]["order"][0] and "Gate 2" in c["chosen_by"]
    assert (st / "frames.json").exists() and any((st / "assets").iterdir())


def test_a_run_without_frames_still_gives_the_territories(tmp_path):
    run = _copy_run(tmp_path / "t", frames=False)
    st = tmp_path / "st"
    got = ft.import_run(run, st, chosen="t1")
    c = json.loads((st / "c_territories.json").read_text())
    assert got["frames"] == 0 and c["chosen"] == "t1" and not (st / "frames.json").exists()


def test_a_recorded_stage_c_or_idea_is_never_overwritten(tmp_path):
    run = _copy_run(tmp_path / "t", frames=False)
    st = tmp_path / "st"
    st.mkdir()
    (st / "d_idea.json").write_text("{}")
    with pytest.raises(ft.FromTerritoryError):
        ft.import_run(run, st)


def test_find_run_picks_a_proceed_run_and_skips_its_side_files(tmp_path):
    run = _copy_run(tmp_path / "t")
    (tmp_path / "t" / "lumen_run.baseline.json").write_text(json.dumps({"status": "proceed", "territories": [{"id": "x"}]}))
    (tmp_path / "t" / "notes.json").write_text(json.dumps({"status": "stop"}))
    assert ft.find_run(tmp_path / "t") == run
    assert ft.find_run(tmp_path / "nowhere") is None


def test_auto_looks_beside_the_deck(tmp_path):
    st = tmp_path / "proj" / "deck-B" / "stages"
    st.mkdir(parents=True)
    run = _copy_run(tmp_path / "proj" / "territory")
    where = ft.auto_runs(st)
    assert (tmp_path / "proj" / "territory").resolve() in where
    assert next(r for r in (ft.find_run(w) for w in where) if r) == run.resolve()


def test_run_deck_takes_the_run_before_stage_c(tmp_path, monkeypatch):
    from deck import run_deck
    run = _copy_run(tmp_path / "proj" / "territory")
    st = tmp_path / "proj" / "deck" / "stages"
    st.mkdir(parents=True)

    class A:   # the parsed arguments run_deck._territory_handoff reads
        territory_run, territory_chosen, stages, brief, pictures = "auto", None, st, None, None
    rep: dict = {}
    run_deck._territory_handoff(A, rep)
    assert rep["territory_run"]["found"] and rep["territory_run"]["run"] == str(run.resolve())
    assert (st / "c_territories.json").exists() and A.pictures == "creative"


def test_auto_with_no_run_is_a_note_and_a_named_path_with_none_is_refused(tmp_path):
    from deck import run_deck
    st = tmp_path / "a" / "b" / "stages"
    st.mkdir(parents=True)

    class A:
        territory_run, territory_chosen, stages, brief, pictures = "auto", None, st, None, None
    rep: dict = {}
    run_deck._territory_handoff(A, rep)
    assert rep["territory_run"]["found"] is False and not (st / "c_territories.json").exists()
    A.territory_run = str(tmp_path / "missing")
    with pytest.raises(SystemExit):
        run_deck._territory_handoff(A, rep)
