"""The director comparison (features/director-v5.clan), replayed: no model call.

The recordings under eval/recorded/ come from `python -m eval.director_eval record`. These tests
hold the bar the feature set: v5 keeps the participant's words and adds nothing they did not ask
for at least as well as the passthrough, and beats v4.
"""

from __future__ import annotations

from pathlib import Path

import pytest

from director.director import Director, DirectorError, _donors_are_objects, _lone_fronts_are_characters, _within_budget
from eval.director_eval import load, table, totals
from providers import load_sheets

PROMPTS = Path(__file__).resolve().parent.parent / "prompts"


@pytest.fixture(scope="module")
def scores():
    return table(load(), ["passthrough", "director.v4", "director.v5"])


def check(rows: dict, name: str) -> int:
    return sum(r.get(name, False) for r in rows.values())


def test_every_case_has_a_v5_recording(scores):
    assert set(scores["director.v5"]) == {c["id"] for c in load()["cases"]}


def test_v5_keeps_the_words_and_adds_nothing_unasked_at_least_as_well_as_the_passthrough(scores):
    for name in ("words", "no_leaks"):
        assert check(scores["director.v5"], name) >= check(scores["passthrough"], name), name


def test_v5_beats_v4_and_the_passthrough_overall(scores):
    v5, v4, raw = (totals(scores[v])[0] for v in ("director.v5", "director.v4", "passthrough"))
    assert v5 > v4 and v5 > raw


def test_v5_answers_are_all_usable(scores):
    assert all(r["valid"] for r in scores["director.v5"].values())


def director(version: str) -> Director:
    return Director(None, PROMPTS, load_sheets(), prompt_version=version)


def test_v5_sends_each_op_only_its_own_section():
    d = director("director.v5")
    frame, view = d.system_for("frame"), d.system_for("view")
    assert "## frame" in frame and "## view" not in frame
    assert "## view" in view and "## frame" not in view
    assert len(frame.split()) < len(director("director.v4").system.split()) / 2


def test_a_shot_list_still_runs_on_the_v4_prompt():
    assert "shot_list: turn `input.script`" in director("director.v5").system_for("shot_list")


def test_v4_is_one_prompt_for_every_op():
    d = director("director.v4")
    assert d.system_for("frame") == d.system_for("view") == d.system


def ref(name, role):
    return {"sha256": "sha256:" + "0" * 64, "name": name, "role": role}


def test_a_picture_the_words_take_one_thing_from_is_an_object():
    for text in ("make it wear the tshirt like @handyman_front", "give it @handyman_front's shirt", "the dress of @handyman_front"):
        job = {"refs": [ref("in_1", "character"), ref("handyman_front", "character")]}
        _donors_are_objects(job, {"text": text})
        assert [r["role"] for r in job["refs"]] == ["character", "object"], text


def test_a_donor_alone_stays_the_character():
    job = {"refs": [ref("handyman_front", "character")]}
    _donors_are_objects(job, {"text": "like @handyman_front but smiling"})
    assert job["refs"][0]["role"] == "character"


def test_an_element_front_without_an_angle_goes_as_a_character():
    job = {"refs": [ref("maya_front", "element_front"), ref("bob_front", "element_front"), ref("bob_side", "element_angle")]}
    _lone_fronts_are_characters(job)
    assert [r["role"] for r in job["refs"]] == ["character", "element_front", "element_angle"]


def test_the_directors_additions_have_a_budget_but_the_words_do_not():
    words = "x" * 2000
    _within_budget({"prompt": words + "y" * 300}, "generate", {"text": words})
    with pytest.raises(DirectorError, match="added"):
        _within_budget({"prompt": "y" * 400}, "generate", {"text": ""})
