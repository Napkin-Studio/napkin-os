"""The gates table in docs/contracts/deck-maker.md holds the engine's stage files and the server's gate plan to one list. Run from
``engine/``: ``PYTHONPATH=. python3 -m pytest -q deck/tests/test_gates_contract.py``."""
from __future__ import annotations

import re
from pathlib import Path

from deck import run_deck, run_state, server

DOC = Path(__file__).resolve().parents[3] / "docs" / "contracts" / "deck-maker.md"


def table() -> list[dict]:
    lines = DOC.read_text().splitlines()
    i = next(n for n, l in enumerate(lines) if re.match(r"\|\s*Gate\s*\|\s*n\s*\|\s*After stage", l))
    rows = []
    for l in lines[i + 2:]:
        if not l.startswith("|"):
            break
        gate, n, stage, fn, shows = [c.strip() for c in l.strip().strip("|").split("|")]
        rows.append({"gate": gate, "n": int(n), "stage": stage, "file": fn, "shows": shows})
    return rows


def test_the_table_names_each_gate_its_stage_and_the_stage_file_the_engine_writes():
    rows = table()
    assert [r["gate"] for r in rows] == ["storyline", "territories", "idea"] and [r["n"] for r in rows] == [1, 2, 3]
    for r in rows:
        assert run_deck.STAGE_FILES[r["stage"]] == r["file"], f"{r['gate']}: stage {r['stage']} writes {run_deck.STAGE_FILES[r['stage']]}"


def test_the_servers_plan_and_the_run_mapping_use_the_same_gates():
    rows = table()
    assert server.PLAN["agency"] == [(r["stage"], r["gate"]) for r in rows]
    assert [(s, g) for s, g in run_state.GATES] == [(r["stage"], r["gate"]) for r in rows]
    assert {r["gate"]: r["n"] for r in rows} == run_state.GATE_N
    for stage, fn in ((r["stage"], r["file"]) for r in rows):
        assert server.STAGE_FILES[stage][0] == fn


def test_an_investor_deck_has_the_storyline_gate_only_after_its_one_story_stage():
    assert server.PLAN["investor"] == [("i", "storyline")] and run_deck.INVESTOR_STAGE_FILES["i"] == server.STAGE_FILES["i"][0]
    assert run_state.GATE_AFTER["i"] == "storyline"
