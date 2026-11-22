"""run_deck and the layout plan: the density default, --layout, --no-layout-plan, --until deck and --no-notes (deck-layout-library)."""
from __future__ import annotations

import io
import contextlib
import json
from pathlib import Path

import pytest
from pptx import Presentation

from deck import layouts, render_pptx, run_deck, spec

FX = Path(__file__).with_name("fixtures") / "lumen_water"
BASE = ["--stages", str(FX), "--brief", str(FX / "brief_object.json"), "--client", "Lumen Water", "--project", "National awareness campaign", "--no-qa"]


def run(out: Path, *extra) -> Path:
    saved = (run_deck.subprocess.run, run_deck._soffice)
    run_deck.subprocess.run, run_deck._soffice = (lambda *a, **k: None), (lambda: "soffice")
    try:
        with contextlib.redirect_stdout(io.StringIO()):
            run_deck.main([*BASE, "--out", str(out), *extra])
    finally:
        run_deck.subprocess.run, run_deck._soffice = saved
    return out


def jdeck(out):
    return json.loads((out / "deck.json").read_text())


def test_the_density_default_is_resolved_in_the_engine_by_format_and_stamps_its_source(tmp_path):
    pitch = jdeck(run(tmp_path / "p"))
    assert pitch["meta"]["preferences"]["density"] == {"level": "lean", "source": "default"}
    full = jdeck(run(tmp_path / "f", "--format", "full"))
    assert full["meta"]["preferences"]["density"] == {"level": "detailed", "source": "default"}
    person = jdeck(run(tmp_path / "d", "--density", "standard"))
    assert person["meta"]["preferences"]["density"] == {"level": "standard", "source": "person"}


def test_until_deck_already_carries_the_overlay(tmp_path):
    d = jdeck(run(tmp_path / "u", "--until", "deck"))
    assert not (tmp_path / "u" / "deck.pptx").exists()
    assert all(s["layout"]["blocks_sha"] == spec.blocks_sha(s) and "title" in s["slots"] for s in d["slides"].values())
    assert "layout_title_pt" in d["meta"]
    rep = json.loads((tmp_path / "u" / "report.json").read_text())["layout_plan"]
    assert set(rep["rungs"]) == {"as_is", "shrunk", "switched", "overflow_moved", "relaxed", "no_fit"} and rep["secs"] < 2.0 and "condense" in rep["skipped"]


def test_layout_flag_is_recorded_as_a_persons_swap_and_a_bad_one_is_refused_or_reported(tmp_path):
    d = jdeck(run(tmp_path / "s", "--density", "detailed", "--layout", "s05=text_columns"))
    lay = d["slides"]["s05"]["layout"]
    assert lay["chosen_by"] == "person" and lay["id"] == "text_columns"
    others = jdeck(run(tmp_path / "t", "--density", "detailed"))
    assert d["meta"]["layout_title_pt"] == others["meta"]["layout_title_pt"] or d["meta"]["layout_title_pt"].get("cards") == others["meta"]["layout_title_pt"].get("cards")
    with pytest.raises(SystemExit):
        run(tmp_path / "x", "--layout", "s99=cards")
    run(tmp_path / "y", "--layout", "s05=nonsense")
    assert any(f["check"] == "layout_unknown" for f in json.loads((tmp_path / "y" / "validation.json").read_text()))


def test_no_layout_plan_reproduces_todays_layouts(tmp_path):
    out = run(tmp_path / "n", "--no-layout-plan", "--density", "detailed")
    d = jdeck(out)
    assert not any("layout" in s for s in d["slides"].values()) and "layout_title_pt" not in d["meta"]
    rec = json.loads((out / "layouts.json").read_text())["slides"]
    for sid, s in d["slides"].items():
        want = render_pptx._choose_layout_frozen(s)
        assert rec[sid]["chosen"] == want or (want == "cover" and rec[sid]["chosen"] == "cover"), (sid, rec[sid]["chosen"], want)
        assert rec[sid]["id"] in (want, "flow")


def test_no_notes_writes_a_pptx_without_speaker_notes_and_the_default_keeps_them(tmp_path):
    with_n = Presentation(str(run(tmp_path / "a", "--density", "detailed") / "deck.pptx"))
    without = Presentation(str(run(tmp_path / "b", "--density", "detailed", "--no-notes") / "deck.pptx"))
    assert any(s.notes_slide.notes_text_frame.text.strip() for s in with_n.slides)
    assert not any(s.has_notes_slide and s.notes_slide.notes_text_frame.text.strip() for s in without.slides)
