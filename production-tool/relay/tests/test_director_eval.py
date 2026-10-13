"""The director comparison (features/director-v5.clan), replayed: no model call.

The recordings under eval/recorded/ come from `python -m eval.director_eval record`. These tests
hold the bar the feature set: v5's answers keep the words and add nothing unasked at least as well as
the passthrough, and beat v4's. Under contract 3 the recordings (converted to its shapes) replay
through director.v6's checks; v6 itself is recorded live.
"""

from __future__ import annotations

from pathlib import Path

import pytest

from director.director import (Director, DirectorError, _donors_are_objects,
                               _one_character_line, _tag_anchors, _within_budget)
from eval.director_eval import load, table, totals
from providers import load_sheets

PROMPTS = Path(__file__).resolve().parent.parent / "prompts"


@pytest.fixture(scope="module")
def scores():
    return table(load(), ["passthrough", "director.v4", "director.v5"])


def check(rows: dict, name: str) -> int:
    return sum(r.get(name, False) for r in rows.values())


V5_CASES = {c["id"] for c in load()["cases"] if not c.get("since")}


def only(rows: dict, ids: set) -> dict:
    return {k: v for k, v in rows.items() if k in ids}


def test_every_case_has_a_v5_recording(scores):
    assert set(scores["director.v5"]) == V5_CASES


def test_v5_keeps_the_words_and_adds_nothing_unasked_at_least_as_well_as_the_passthrough(scores):
    for name in ("words", "no_leaks"):
        assert check(scores["director.v5"], name) >= check(only(scores["passthrough"], V5_CASES), name), name


def test_v5_beats_v4_and_the_passthrough_overall(scores):
    v5, v4, raw = (totals(only(scores[v], V5_CASES))[0] for v in ("director.v5", "director.v4", "passthrough"))
    assert v5 > v4 and v5 > raw


def test_v5_answers_are_all_usable(scores):
    assert all(r["valid"] for r in scores["director.v5"].values())


def director(version: str) -> Director:
    return Director(None, PROMPTS, load_sheets(), prompt_version=version)


def test_v6_sends_each_op_only_its_own_section():
    d = director("director.v6")
    frame, view = d.system_for("frame"), d.system_for("view")
    assert "## frame" in frame and "## view" not in frame
    assert "## view" in view and "## frame" not in view
    assert len(frame.split()) < len(d.system.split()) / 1.5


def test_a_shot_list_runs_on_its_own_v6_section():
    text = director("director.v6").system_for("shot_list")
    assert "## shot_list" in text and "plannedShot" not in text and "`beats`" in text and "## frame" not in text


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


def test_the_directors_additions_have_a_budget_but_the_words_do_not():
    words = "x" * 2000
    _within_budget({"prompt": words + "y" * 300}, "generate", {"text": words})
    with pytest.raises(DirectorError, match="added"):
        _within_budget({"prompt": "y" * 400}, "generate", {"text": ""})


def test_the_anchor_and_previous_frames_are_named_by_their_tags_when_sent():
    job = {"prompt": "Keep the setting, light and style of anchor. Continue from previous. The previous shot was wide.",
           "refs": [ref("anchor", "object"), ref("previous", "object")]}
    _tag_anchors(job)
    assert job["prompt"] == "Keep the setting, light and style of @anchor. Continue from @previous. The previous shot was wide."
    alone = {"prompt": "Continue from previous.", "refs": [ref("hero_front", "character")]}
    _tag_anchors(alone)
    assert alone["prompt"] == "Continue from previous."  # not sent: left as words


def test_one_line_names_every_picture_of_the_character():
    job = {"prompt": "A sofa. The character is @a_front, exactly as in that picture. The character is @a_side, exactly as in that picture. "
                     "The character is @a_back, exactly as in that picture. Full-bleed."}
    _one_character_line(job)
    assert job["prompt"] == "A sofa. The character is @a_front, @a_side and @a_back, exactly as in those pictures. Full-bleed."


# ── Change this frame (features/frame-change-edit.clan) ──────────────────────────────────────

FRAME_CASES = [c for c in load()["cases"] if c["op"] == "frame_edit"]
FRAME_CHECKS = ("reading", "camera", "ask", "no_continuity", "words_first")


def test_there_are_at_least_ten_frame_edit_cases_on_clean_stills():
    from eval.director_eval import FRAMES
    data = load()
    assert len(FRAME_CASES) >= 10
    ids = {c["id"] for c in FRAME_CASES}
    for name in ("fe_overhead_aerial", "fe_low_angle", "fe_close_hands", "fe_dutch", "fe_wide_establishing", "fe_scarf_red",
                 "fe_remove_bottle", "fe_add_rain", "fe_bigger", "fe_push_in", "fe_overhead_masked"):
        assert name in ids, name
    for c in FRAME_CASES:
        assert c["since"] == "director.v7" and (FRAMES / data["frames"][c["input"]["image"]]).exists()
    assert "make_frames.py" in (FRAMES / "SOURCES.md").read_text()


def test_dex_sees_one_picture_for_a_frame_edit_case():
    from eval.director_eval import frame_images
    (image,) = frame_images(FRAME_CASES[0], load())
    assert image["media_type"] == "image/jpeg"
    assert frame_images(load()["cases"][0], load()) is None  # other ops: none


def test_the_scorer_holds_a_frame_edit_answer_to_its_case():
    from eval.director_eval import score
    case = next(c for c in FRAME_CASES if c["id"] == "fe_overhead_aerial")
    words = case["input"]["text"]
    good = {"op": "frame_edit", "question": None,
            "frameEdit": {"reading": "camera", "runAs": "frame", "camera": {"angle": "overhead", "size": "wide"}},
            "providerJob": {"prompt": f"{words}. Seen from directly above. The people, place and light of @current, not its framing.",
                            "refs": [{"name": "current", "role": "current", "sha256": "x"}]}}
    assert all(score(case, good).values())
    old_framing = {**good, "providerJob": {**good["providerJob"], "prompt": f"Keep the framing of the anchor frame. {words}"}}
    got = score(case, old_framing)
    assert not got["no_continuity"] and not got["words_first"]
    assert not score(case, {**good, "frameEdit": {"reading": "local", "runAs": "frame"}})["reading"]
    ask_case = next(c for c in FRAME_CASES if c["id"] == "fe_bigger")
    asked = {"op": "frame_edit", "question": {"kind": "ambiguity", "text": "Bigger how?", "allow_text": False,
                                             "options": [{"id": "camera", "value": "camera"}, {"id": "local", "value": "local"}]}}
    assert all(score(ask_case, asked).values())
    nudged = {"op": "frame_edit", "question": {**asked["question"], "kind": "nudge", "recommended_option_id": "camera"}}
    assert not score(ask_case, nudged)["ask"]


def test_the_passthrough_on_the_frame_edit_cases_never_sees_a_picture_and_keeps_the_words_first(scores):
    rows = only(scores["passthrough"], {c["id"] for c in FRAME_CASES})
    assert len(rows) == len(FRAME_CASES)
    assert all(r["valid"] and r["words_first"] and r["no_continuity"] and r["ask"] for r in rows.values())
    # The lexicon reads every case but the one with no camera word ("go in close on her hands").
    assert [cid for cid, r in rows.items() if not r["reading"]] == ["fe_close_hands"]


V7 = Path(__file__).resolve().parent.parent / "eval" / "recorded" / "director.v7"


@pytest.mark.skipif(not V7.is_dir(), reason="director.v7 is not recorded yet: NAPKIN_MODEL_API=claude-cli "
                    "uv run python -m eval.director_eval record director.v7 (features/frame-change-edit.clan next_step)")
def test_every_frame_edit_case_passes_on_recorded_director_v7_replies():
    rows = table(load(), ["director.v7"])["director.v7"]
    assert set(rows) >= {c["id"] for c in FRAME_CASES}, "record every frame_edit case"
    failed = {cid: [k for k in ("valid", *FRAME_CHECKS) if not r.get(k)] for cid, r in rows.items()
              if cid.startswith("fe_") and not all(r.get(k) for k in ("valid", *FRAME_CHECKS))}
    assert not failed, failed
