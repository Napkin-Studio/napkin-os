"""run_state: the engine's files turned into what the Deck Maker app reads, on the Fernley recording (no model, no renderer).
Run from ``engine/``: ``PYTHONPATH=. python3 -m pytest -q deck/tests/test_run_state.py``.
"""
from __future__ import annotations

import json
import shutil
from pathlib import Path

import pytest

from deck import inputs, run_deck, run_state as rs

FERN = Path(__file__).parent / "fixtures" / "fernley"
SCHEMA = Path(__file__).resolve().parents[3] / "app" / "templates" / "deck-maker" / "schema.json"


def folder(tmp_path: Path, *names: str) -> Path:
    """A stages folder holding only the named recorded stage files."""
    d = tmp_path / "stages"
    d.mkdir(exist_ok=True)
    for n in names:
        shutil.copyfile(FERN / "stages" / n, d / n)
    return d


UPTO = {"b": ("a0_intake.json", "a_requirements.json", "b_storyline.json", "insight_judge.json"),
        "c": ("a0_intake.json", "a_requirements.json", "b_storyline.json", "insight_judge.json", "c_territories.json"),
        "d": ("a0_intake.json", "a_requirements.json", "b_storyline.json", "insight_judge.json", "c_territories.json", "d_idea.json")}


def summary():
    inp = inputs.load(None, prompt_text=(FERN / "prompt.txt").read_text())
    return rs.inputs_summary(inp)


def valid_in_the_app(run: dict) -> None:
    jsonschema = pytest.importorskip("jsonschema")
    schema = json.loads(SCHEMA.read_text())
    schema = {**schema, "required": []}
    jsonschema.Draft7Validator(schema).validate({"run": run})


def test_a_draft_run_has_nothing_in_it():
    assert rs.run_object(state="draft", stages=Path("/nonexistent")) == {"state": "draft", "stages": [], "gate": None}


@pytest.mark.parametrize("gate,after,row,n", [("storyline", "b", "storyline", 1), ("territories", "c", "territories", 2), ("idea", "d", "idea", 3)])
def test_each_gate_holds_its_row_and_says_what_to_approve(tmp_path, gate, after, row, n):
    d = folder(tmp_path, *UPTO[after])
    run = rs.run_object(state="gate", stages=d, summary=summary(), held=gate, cost=0.25)
    valid_in_the_app(run)
    assert run["state"] == "gate" and run["stage"] == row and "agent" not in run
    status = {r["id"]: r["status"] for r in run["stages"]}
    ids = rs.ROW_IDS
    assert all(status[i] == "done" for i in ids[:ids.index(row)]) and status[row] == "now"
    assert all(status[i] == "next" for i in ids[ids.index(row) + 1:])
    assert run["gate"]["id"] == gate and run["gate"]["n"] == n and run["gate"]["of"] == 3
    assert not any("items" in r for r in run["stages"]), "a held gate shows its payload, not a running box"


def test_gate_one_lists_the_storylines_beats_with_where_they_came_from(tmp_path):
    g = rs.gate_payload("storyline", folder(tmp_path, *UPTO["b"]))
    assert g["agent"] == "strategy" and len(g["beats"]) >= 4
    assert [b["n"] for b in g["beats"]] == [f"{i + 1:02d}" for i in range(len(g["beats"]))]
    assert all(b["title"] and b["basis"] in ("brief", "research", "proposal") and b["src"] for b in g["beats"])


def test_gate_two_has_three_territories_and_the_blind_judges_first_pick(tmp_path):
    g = rs.gate_payload("territories", folder(tmp_path, *UPTO["c"]))
    assert len(g["territories"]) == 3 and [t["n"] for t in g["territories"]] == [1, 2, 3]
    assert g["first_pick"] in {t["id"] for t in g["territories"]}


def test_gate_three_shows_the_idea_its_territory_and_its_executions(tmp_path):
    g = rs.gate_payload("idea", folder(tmp_path, *UPTO["d"]))
    assert g["agent"] == "idea" and g["idea"]["line"] and g["idea"]["executions"]
    assert g["idea"]["territory_id"] and g["idea"]["territory_name"]


def test_a_running_stage_shows_its_items_the_agent_and_no_time(tmp_path):
    d = folder(tmp_path, *UPTO["c"][:-1])   # b is written, c is being written
    run = rs.run_object(state="building", stages=d, summary=summary(), current="c", cost=0.12)
    valid_in_the_app(run)
    row = next(r for r in run["stages"] if r["id"] == "territories")
    assert row["status"] == "now" and row["items"] == [{"text": "Three territories, then a blind ranking · writing now", "status": "now"}]
    assert run["agent"] == {"key": "strategy", "activity": "write", "step_index": 2, "step_total": 7}
    assert "%" not in json.dumps(run)


def test_the_agent_follows_the_step_and_a_long_step_is_flagged_slow_not_timed(tmp_path):
    d = folder(tmp_path)
    for step, agent in (("a0", "brief"), ("b", "strategy"), ("d", "idea"), ("e", "copy"), ("validate", "review")):
        assert rs.run_object(state="building", stages=d, current=step)["agent"]["key"] == agent
    assert rs.run_object(state="building", stages=d, current="b", slow=True)["agent"]["slow"] is True
    assert rs.is_slow("b", 137) and not rs.is_slow("b", 100) and not rs.is_slow("nonsense", 1e9)


def test_a_failed_run_says_which_stage_and_why(tmp_path):
    err = {"stage": "territories", "message": "The engine stopped: no territories came back", "retryable": True}
    run = rs.run_object(state="failed", stages=folder(tmp_path, *UPTO["b"]), current="c", error=err)
    valid_in_the_app(run)
    assert run["error"] == err and run["agent"]["activity"] == "error"
    assert next(r for r in run["stages"] if r["id"] == "territories")["status"] == "failed"


def test_the_cost_is_the_engines_own_figure_summed_over_the_stage_files(tmp_path):
    total = rs.spent(folder(tmp_path, *[p.name for p in (FERN / "stages").glob("*.json")]))
    assert 0.5 < total < 1.5


def test_the_finished_run_is_every_row_done_and_review_next_with_the_deck_and_its_files(tmp_path, monkeypatch):
    for mod in (run_deck.render_pptx, run_deck.render_web):
        monkeypatch.setattr(mod, "render", lambda *a, **k: None)
    monkeypatch.setattr(run_deck.subprocess, "run", lambda *a, **k: None)
    monkeypatch.setattr(run_deck, "_soffice", lambda: "soffice")
    stages, out = tmp_path / "s", tmp_path / "o"
    shutil.copytree(FERN / "stages", stages)
    rep = run_deck.main(["--prompt-file", str(FERN / "prompt.txt"), "--stages", str(stages), "--client", "Fernley", "--project", "Tea",
                         "--out", str(out), "--kind", "agency", "--no-qa"])
    (out / "deck.pdf").write_bytes(b"%PDF")   # a file the engine would have rendered
    inp = inputs.load(None, prompt_text=(FERN / "prompt.txt").read_text())
    pay = rs.payload(out, rep, inp, live=False)
    run = rs.run_object(state="done", stages=stages, summary=rs.inputs_summary(inp), cost=0, done=pay["done"],
                        validation={"errors": pay["validation"]["errors"], "warnings": pay["validation"]["warnings"]})
    valid_in_the_app(run)
    assert [r["status"] for r in run["stages"]] == ["done"] * 7 + ["now"] and run["stage"] == "review"
    assert run["agent"]["activity"] == "complete" and run["done"]["slides"] > 0
    assert pay["exports"] == {"pdf": {"file": "deck.pdf", "bytes": 4}}, "names and sizes only; a file that does not exist is not listed"
    assert pay["report"]["cost_usd"] == 0 and pay["report"]["mode"] == "replay"
    assert pay["deck"]["appendix_count"] == len(pay["deck"]["appendix_ids"]) and pay["evidence"]
    assert set(pay["validation"]) == {"errors", "warnings", "findings"}


def test_the_payload_carries_qa_and_repair_only_when_the_loop_wrote_them_and_they_are_valid_in_the_app(tmp_path):
    jsonschema = pytest.importorskip("jsonschema")
    out = tmp_path / "out"
    out.mkdir()
    deck = {"order": ["s01", "s02"], "slides": {"s01": {"type": "title", "status": "drafted", "title": "T", "blocks": []}, "s02": {"type": "idea", "status": "drafted", "title": "U", "blocks": []}}, "meta": {}}
    assert rs.repair_payload(out, deck, {}) == {}   # no issues.json: --no-repair or no QA
    issue = {"id": "i_0000000a", "round": 0, "slide": "s02", "source": "qa_render", "check": "text_overflow", "level": "error", "severity": "blocker", "message": "m", "status": "fixed"}
    (out / "issues.json").write_text(json.dumps([issue, {**issue, "id": "i_0000000b", "check": "margin", "severity": "major", "status": "left_for_person"}]))
    (out / "qa.json").write_text(json.dumps({"slides": {}, "deck_sha": "abc123"}))
    got = rs.repair_payload(out, deck, {})
    assert set(got) == {"qa"} and got["qa"]["summary"]["major"] == 1 and got["qa"]["summary"]["blocker"] == 0 and got["qa"]["deck_sha"] == "abc123"
    (out / "repair.json").write_text(json.dumps({"rounds": [{"n": 1, "kept": True, "why": "", "fixed": 1, "open": 1, "usd": 0.0, "before": {"blocker": 1, "major": 1, "minor": 0}, "after": {"blocker": 0, "major": 1, "minor": 0}}],
                                                 "left_for_person": [{"slide": "s02", "check": "margin", "why": "x"}], "stopped": "clean", "skipped": [{"rung": "shorten"}]}))
    got = rs.repair_payload(out, deck, {"repair": {"rounds": [{"n": 1, "seconds": 1.5}]}})
    schema = {**json.loads(SCHEMA.read_text()), "required": []}
    jsonschema.Draft7Validator(schema).validate(got)   # the template's closed objects accept exactly this
    assert got["repair"]["rounds"][0]["seconds"] == 1.5 and got["repair"]["skipped"] == 1 and got["repair"]["left_for_person"] == 1
    assert "1 fixed by repair, 1 left for you" in rs.done_line(deck, {"validation": {}, "repair": {"rounds": [{"kept": True, "fixed": 1}], "left_for_person": [1]}})["summary"]
