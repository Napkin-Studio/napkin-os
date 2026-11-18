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
                               _one_character_line, _tag_anchors, _views_are_one, _within_budget)
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


def _sha(c: str) -> str:
    return "sha256:" + c * 64


def test_views_of_one_character_are_said_as_one_character():
    # 2026-11-04: @bolt's four views, listed as four characters, came back as four robots.
    views = [("bolt_front", "1"), ("bolt_three-quarter", "2"), ("bolt_side", "3"), ("bolt_back", "4")]
    payload = {"refs": [{"name": n, "role": "character", "asset": {"sha256": _sha(c)}} for n, c in views]}
    wire = ["bolt_front", "bolt_three_quart", "bolt_side", "bolt_back"]
    job = {"prompt": "A workshop. The character is @bolt_front, @bolt_three_quart, @bolt_side and @bolt_back, exactly as in those pictures. Full-bleed.",
           "refs": [{"name": w, "sha256": _sha(c), "role": "character"} for w, (_, c) in zip(wire, views)]}
    _views_are_one(job, "frame", payload)
    assert "views of one single character" in job["prompt"] and "exactly one of it" in job["prompt"]
    assert job["prompt"].startswith("A workshop. The character is the one in @bolt_front, @bolt_three_quart, @bolt_side and @bolt_back")
    assert job["prompt"].endswith("Full-bleed.")


def test_two_different_characters_stay_two():
    payload = {"refs": [{"name": "bolt_front", "asset": {"sha256": _sha("1")}}, {"name": "maya_front", "asset": {"sha256": _sha("2")}}]}
    job = {"prompt": "The character is @bolt_front and @maya_front, exactly as in those pictures.",
           "refs": [{"name": "bolt_front", "sha256": _sha("1"), "role": "character"}, {"name": "maya_front", "sha256": _sha("2"), "role": "character"}]}
    before = job["prompt"]
    _views_are_one(job, "frame", payload)
    assert job["prompt"] == before


def test_views_said_elsewhere_get_the_line_added():
    payload = {"refs": [{"name": "bolt_front", "asset": {"sha256": _sha("1")}}, {"name": "bolt_side", "asset": {"sha256": _sha("2")}}]}
    job = {"prompt": "@bolt_front rolls out of the door.",
           "refs": [{"name": "bolt_front", "sha256": _sha("1"), "role": "character"}, {"name": "bolt_side", "sha256": _sha("2"), "role": "character"}]}
    _views_are_one(job, "clip", payload)
    assert job["prompt"] == "@bolt_front rolls out of the door. @bolt_front and @bolt_side are views of one single character from different sides: show exactly one of it, never copies."


# ── Change this frame (features/frame-change-edit.clan) ──────────────────────────────────────

FRAME_CASES = [c for c in load()["cases"] if c["op"] == "frame_edit" and c["since"] == "director.v7"]
REDRAW = next(c for c in load()["cases"] if c["id"] == "fe_redraw_product_insert")
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


@pytest.mark.skipif(not V7.is_dir(), reason="director.v7 is not recorded yet: scripts/model-local run "
                    "uv run python -m eval.director_eval record director.v7 (features/frame-change-edit.clan next_step)")
def test_every_frame_edit_case_passes_on_recorded_director_v7_replies():
    rows = table(load(), ["director.v7"])["director.v7"]
    assert set(rows) >= {c["id"] for c in FRAME_CASES}, "record every frame_edit case"
    failed = {cid: [k for k in ("valid", *FRAME_CHECKS) if not r.get(k)] for cid, r in rows.items()
              if cid.startswith("fe_") and not all(r.get(k) for k in ("valid", *FRAME_CHECKS))}
    assert not failed, failed


PATCH_CASES = [c for c in load()["cases"] if c["op"] == "clip_patch"]


def test_the_clip_patch_cases_cover_fixes_asks_and_an_answer():
    from eval.director_eval import FRAMES
    routes = [c["expect"]["route"] for c in PATCH_CASES]
    assert routes.count("fix") >= 3 and routes.count("ask") >= 2
    assert any(c["input"].get("answer") for c in PATCH_CASES)
    data = load()
    assert all(c["since"] == "director.v7" and (FRAMES / data["frames"][c["frame"]]).exists() for c in PATCH_CASES)


@pytest.mark.skipif(not V7.is_dir(), reason="director.v7 is not recorded yet")
def test_every_clip_patch_case_passes_on_recorded_director_v7_replies():
    rows = table(load(), ["director.v7"])["director.v7"]
    assert set(rows) >= {c["id"] for c in PATCH_CASES}, "record every clip_patch case"
    failing = {cid: r for cid, r in rows.items() if cid in {c["id"] for c in PATCH_CASES} and not all(r.values())}
    assert not failing, failing


def test_v8_keeps_every_ref_the_shot_names_and_says_why_it_adds_one():
    """The owner's case (2026-10-15, features/canvas-nodes.clan), recorded live on director.v8: the shot says
    @samurai, so its four views go; the hall picture goes only as an addition with a reason."""
    rows = table(load(), ["director.v8"])["director.v8"]
    assert all(rows["frame_samurai_keeps_refs"].values()), rows["frame_samurai_keeps_refs"]


def test_a_reply_that_swaps_samurai_for_one_view_fails_the_eval():
    import json as _json

    from eval.director_eval import Replay, answer, recorded, score
    data = load()
    case = next(c for c in data["cases"] if c["id"] == "frame_samurai_keeps_refs")
    reply = _json.loads(recorded("director.v8", case["id"])["reply"])
    job = reply["providerJob"]
    # What the frames of 2026-10-15 did: one view per shot, the rest left out, nothing said.
    job["refs"] = [r for r in job["refs"] if r["name"] == "samurai_side"]
    job["prompt"] = "A wide shot. @samurai_side sweeps the hall in one clean arc. Dust lifts and vanishes out the door."
    reply.pop("added", None)
    out = answer(case, data, "director.v8", Replay(_json.dumps(reply)))
    assert out == {"error": out.get("error")} and "left out" in out["error"]  # the relay refuses it
    assert score(case, out) == {"valid": False}


def test_the_v9_cases_hold_the_passthrough_to_each_models_pictures():
    """Clips that carry characters (features/runway-video-models.clan): with no model, the passthrough
    sends exactly the pictures each case's model carries, so the relay's fallback keeps the baby. The one
    model that cannot carry a character without a frame (Veo) refuses instead of sending it as words (the
    owner's @on ad came out a generic person, 2026-11): the web makes a storyboard frame first."""
    data = load()
    v9 = {c["id"] for c in data["cases"] if c.get("since") == "director.v9" and c["op"] != "shot_list"}
    assert v9 == {"clip_hailuo_refs_no_frame", "clip_omni_refs_no_frame", "clip_kling_o3_frame_refs",
                  "clip_veo_no_frame_words", "clip_edit_kling_adds_hat"}
    rows = table(data, ["passthrough"])["passthrough"]
    refuse = {c["id"] for c in data["cases"] if c.get("expect_refuse")}
    assert refuse == {"clip_veo_no_frame_words"}
    for cid in v9 - refuse:
        assert rows[cid]["valid"] and rows[cid]["exact_refs"], (cid, rows[cid])
        assert rows[cid].get("frame", True), (cid, rows[cid])
    for cid in refuse:
        assert rows[cid]["valid"] is False, (cid, rows[cid])


def test_a_v9_answer_that_sends_the_wrong_pictures_scores_so():
    from eval.director_eval import score
    case = next(c for c in load()["cases"] if c["id"] == "clip_hailuo_refs_no_frame")
    words_only = {"providerJob": {"prompt": "A baby grabs cereal in a kitchen.", "refs": []}}
    assert score(case, words_only)["exact_refs"] is False
    kept = {"providerJob": {"prompt": "@baby_front grabs cereal in a kitchen.",
                            "refs": [{"name": "baby_front", "role": "character"}, {"name": "baby_side", "role": "character"}]}}
    assert score(case, kept)["exact_refs"] is True and score(case, kept)["frame"] is True


# ── Free prose to shots (features/script-freeform.clan, owner 2026-11-16) ──
# A script written freely (prose and bullets, no scene heading, no screenplay element) is planned from its
# words as they are. Offline: the passthrough's plan, and hand-written replies (fixtures here, not
# recordings) through director.v9's checks; the live recording waits for the owner's say.

import re  # noqa: E402

from eval.director_eval import Replay, answer, job_input, score  # noqa: E402

FREE = next(c for c in load()["cases"] if c["id"] == "shot_list_free_prose")


def _plan(*actions, seconds=None, question=None, heading=None):
    seconds = seconds or [30 / len(actions)] * len(actions)
    shots = [{"kind": "shot", "duration_s": s, "camera": {"size": "medium"}, "action": a, "refs": [],
              **({"scene_heading": heading} if heading and i == 0 else {})} for i, (a, s) in enumerate(zip(actions, seconds))]
    out = {"op": "shot_list", "question": question, "rationale": "fixture", "confidence": 0.8}
    if question is None:
        out["shots"] = shots
    return __import__("json").dumps(out)


GOOD = ("A woman in a red raincoat steps off a green tram into heavy rain and opens a small yellow umbrella.",
        "She walks past a bakery window, warm light, and glances in at the bread.",
        "A whimper under the bridge railing: a soaked puppy, shivering.",
        "She kneels and holds the umbrella over the puppy, not over herself.",
        "She carries the puppy across the old stone bridge as the rain stops and the sky turns gold.",
        "On screen: Someone's always looking out for you.")


def test_the_free_prose_case_has_no_heading_and_no_screenplay_element():
    lines = [x.strip() for x in FREE["input"]["script"].split("\n") if x.strip()]
    assert FREE["op"] == "shot_list" and FREE["since"] == "director.v9" and "provider" not in FREE
    assert not any(re.match(r"^(INT|EXT|EST|I/E)[. ]", x, re.I) for x in lines)
    assert not any(x.isupper() for x in lines)  # no CHARACTER cue
    assert any(x.startswith("- ") for x in lines)  # bullets, as written


def test_the_passthrough_plans_free_prose_from_its_words():
    checks = score(FREE, answer(FREE, load(), "passthrough"))
    assert all(checks.values()), checks


def test_a_plan_that_reads_the_words_as_they_are_passes_v9s_checks_and_the_eval():
    out = answer(FREE, load(), "director.v9", Replay(_plan(*GOOD)))
    assert "error" not in out, out
    checks = score(FREE, out)
    assert set(checks) == {"valid", "plans", "count", "length", "words", "order", "no_headings"}
    assert all(checks.values()), checks


def test_the_eval_fails_a_plan_that_invents_a_heading_drops_words_reorders_or_asks():
    data = load()
    assert not score(FREE, answer(FREE, data, "director.v9", Replay(_plan(*GOOD, heading="EXT. CITY STREET - DUSK"))))["no_headings"]
    assert not score(FREE, answer(FREE, data, "director.v9", Replay(_plan(*GOOD[:-1]))))["words"]
    assert not score(FREE, answer(FREE, data, "director.v9", Replay(_plan(*reversed(GOOD)))))["order"]
    question = {"id": "q_01HZY3V9Q8W3N5R2T6Y7U8I9O0", "kind": "ambiguity", "text": "Which street?", "options": [
        {"id": "a", "label": "One street", "value": "one"}, {"id": "b", "label": "Two streets", "value": "two"}], "allow_text": False}
    asked = score(FREE, answer(FREE, data, "director.v9", Replay(_plan(*GOOD, question=question))))
    assert asked.get("valid") is False or not asked["plans"]


# ── A redraw with no people places its objects (director.v14, features/frame-edit-or-redraw.clan, 2026-11-18) ──

PLACED = ("An insert, eye level, static. In the centre of the kitchen table, a tall frosted-glass Lumen bottle stands where "
          "the green bottle was. To the left of the bottle, a white bowl of yellow lemons sits on the table. "
          "The place and the light stay as they are. Keep the setting, light and style of @current. "
          "Full-bleed cinematic image; no text, captions, borders or panels.")
PLACED_WHO = "The frosted Lumen bottle stands in the centre of the table; the bowl of lemons sits to the left of it."


def _redraw(prompt: str = PLACED, who: str | None = PLACED_WHO) -> str:
    edit = {"reading": "redraw", "runAs": "frame", **({"who": who} if who is not None else {})}
    return __import__("json").dumps({
        "op": "frame_edit", "question": None, "frameEdit": edit, "rationale": "fixture", "confidence": 0.9,
        "providerJob": {"provider": "runway", "model": "gemini_image3_pro", "prompt": prompt, "ratio": "1344:768",
                        "refs": [{"sha256": job_input(REDRAW, load())["image"]["sha256"], "name": "current", "role": "current"}]}})


def test_the_redraw_case_is_a_product_insert_with_no_people_on_a_clean_still():
    from eval.director_eval import FRAMES
    inp = REDRAW["input"]
    assert REDRAW["since"] == "director.v14" and inp["mode"] == "redraw" and inp["shot"]["camera"]["size"] == "insert"
    assert not inp["refs"] and not inp["shot"]["refs"] and "castFrame" not in inp
    assert (FRAMES / load()["frames"][inp["image"]]).exists()


def test_a_redraw_that_places_each_object_passes_v14_and_the_eval():
    out = answer(REDRAW, load(), "director.v14", Replay(_redraw()))
    assert "error" not in out, out
    checks = score(REDRAW, out)
    assert set(checks) == {"valid", "reading", "camera", "ask", "no_continuity", "length", "places", "who", "no_people"}
    assert all(checks.values()), checks


def test_the_eval_fails_a_redraw_that_leaves_an_object_unplaced_or_brings_people():
    data = load()
    unplaced = PLACED.replace("To the left of the bottle, a white bowl of yellow lemons sits on the table.",
                              "A white bowl of yellow lemons sits on the table too.")
    got = score(REDRAW, answer(REDRAW, data, "director.v14", Replay(_redraw(unplaced))))
    assert got["valid"] and not got["places"]
    vague = score(REDRAW, answer(REDRAW, data, "director.v14", Replay(_redraw(who="A bottle and some lemons."))))
    assert vague["valid"] and not vague["who"]
    person = PLACED.replace("The place and the light", "A woman's hand reaches in from the right. The place and the light")
    assert not score(REDRAW, answer(REDRAW, data, "director.v14", Replay(_redraw(person))))["no_people"]
    nobody = PLACED.replace("The place and the light", "No one is in the frame. The place and the light")
    assert score(REDRAW, answer(REDRAW, data, "director.v14", Replay(_redraw(nobody))))["no_people"]
