"""A LIVE build continues past each gate (production-spinoff, live test 2026-11-22): the stages a gate leaves unwritten are the next
segment's, not a type change's new writing. The model call is stubbed with the Fernley recording, so the real run_deck runs live offline."""
from __future__ import annotations

import json
import time
from pathlib import Path

from deck import profiles, server, spec, stages

FERN = Path(__file__).parent / "fixtures" / "fernley"
FILES = {"a0": "a0_intake.json", "a": "a_requirements.json", "b": "b_storyline.json", "insight_judge": "insight_judge.json",
         "c": "c_territories.json", "d": "d_idea.json", "e": "e_copy.json", "fit": "fit.json", "red_team": "red_team.json"}
INPUTS = {"prompt": {"text": (FERN / "prompt.txt").read_text().strip(), "client": "Fernley Drinks Ltd (FICTIONAL)", "project": "Fernley Tea 2027",
                     "agency": ""}, "kind": "agency", "format": "pitch", "deck_type": {"id": "agency_pitch", "by": "person", "at": "t"}}


def _approve(*gates):
    return {g: {"by": "human:sai", "at": "t", "decision": "approve"} for g in gates}


def test_a_live_build_passes_all_three_gates_without_a_type_change(tmp_path, monkeypatch):
    monkeypatch.setattr(spec, "RECIPES", True)   # the live default: run_deck reads the recipe and so checks for a type change
    monkeypatch.setattr(spec, "LOOK_V3", True)
    assert profiles.recipes_on()
    asked = []

    def fake_call(stage, user, system):
        asked.append(stage)
        obj = json.loads((FERN / "stages" / FILES.get(stage, "c_territories.json" if stage == "c_judge" else "x")).read_text())
        if stage == "c_judge":
            obj = obj["ranking"]
        return obj, {"usd": 0.01, "calls": 1, "model": "stub"}

    monkeypatch.setattr(stages, "_call", fake_call)
    s = server.Server(server.Settings({"NAPKIN_DECK_DATA": str(tmp_path / "runs"), "NAPKIN_DECK_LIVE": "1", "NAPKIN_DECK_MAX_USD": "5",
                                       "NAPKIN_DECK_PORT": "0"}))

    def go(approvals):
        v = s.run({"doc": "doc1", "inputs": INPUTS, "approvals": approvals, "mode": "live", "render": False})
        end = time.time() + 120
        while s.docs["doc1"].running() and time.time() < end:
            time.sleep(0.05)
        return s.view(s.docs["doc1"]) if v else None

    v = go({})
    assert v["state"] == "gate" and v["run"]["stage"] == "storyline", v["run"].get("error")
    v = go(_approve("storyline"))
    assert v["state"] == "gate" and v["run"]["stage"] == "territories", v["run"].get("error")
    v = go(_approve("storyline", "territories"))
    assert v["state"] == "gate" and v["run"]["stage"] == "idea", v["run"].get("error")
    v = go(_approve("storyline", "territories", "idea"))
    assert v["state"] != "failed", v["run"].get("error")
    assert "c" in asked and "d" in asked
