"""Change this frame: edit parts, or redraw the whole frame (features/frame-edit-or-redraw.clan).

frame_edit takes input.mode: edit (absent) keeps the picture; redraw draws the frame again from the shot and
the words, with the current frame for its place and light only, as op frame, never with a previous frame or
the edit's "everything else stays" (live test 2026-11-17: T3 against T1). An edit whose words swap who is in
the picture asks a recast before anything is paid; so does the Image editor's whole-frame change on a shot's
frame, whose "redraw" answer hands the job to the Storyboard (handoff). A picture that comes back the same is
marked unchanged. A take's timed lines get their own budget.
"""

from __future__ import annotations

import copy
import io
import json

import pytest
from PIL import Image, ImageDraw

import sameness
from conftest import Harness, asset, base_config, envelope
from director import new_id
from director.claude import ClaudeDirector
from director.director import Director, DirectorError, _within_budget
from director.model import ModelPort
from test_frame_edit import (BEACH, FRAME, MAYA, PROMPTS, FakeWire, edit_input, harness, post, shot, spent)

RECAST_WORDS = "change this shot so that an Indian seller is selling it to Nigerian buyers"
T3 = ("An Indian man in a patterned shirt sells the cloth from behind the stall, handing a paper bag across the table. "
      "The line of shoppers waiting in front of the stall are Nigerian women in bright ankara prints and gele head "
      "wraps, arms full of folded cloth. The market and the light stay as they are; the people are new. "
      "A medium wide shot, eye level. Keep the setting, light and style of @current. "
      "Full-bleed cinematic image; no text, captions, borders or panels.")


def dex(h: Harness, *replies) -> FakeWire:
    wire = FakeWire(*replies)
    h.relay.director = ClaudeDirector(Director(ModelPort(wire, "eu.anthropic.claude-sonnet-5-5", timeout=5),
                                               PROMPTS, {}, prompt_version="director.v9.1"))
    return wire


WHO = "An Indian man sells from behind the stall; Nigerian women in ankara prints wait in front of it."
# The 2026-11-17 live tests on the market's shot 4 (an insert, high angle): T4 places each person and names who
# leaves; T5 adds the redrawn shot 5 as the cast. Both came back right; the bare words had kept the old seller.
T4 = ("An insert, high angle, static. Behind the stall on the right, where the seller stands, an Indian man in his "
      "sixties with grey hair and a white striped shirt folds the cloth into a paper bag and passes it across with a nod. "
      "The woman in the yellow and blue dress is not in this picture. On the left, the hands of a Nigerian woman buyer, "
      "her sleeve in bright ankara print, hold out the cash. The stall, the cloth and the light stay as they are; the "
      "people are new. Keep the setting, light and style of @current. "
      "Full-bleed cinematic image; no text, captions, borders or panels.")
T5 = T4.replace("an Indian man in his sixties with grey hair and a white striped shirt",
                "the Indian man in @cast, grey hair and white striped shirt,")
UNPLACED = ("An Indian seller and Nigerian buyers. The market and the light stay as they are; the people are new. "
            "An insert, high angle. Keep the setting, light and style of @current. "
            "Full-bleed cinematic image; no text, captions, borders or panels.")
CAST = asset(88)


def redraw_reply(prompt: str = T3, refs=None, **edit) -> dict:
    edit = {"who": WHO, **edit}
    if edit["who"] is None:
        edit.pop("who")
    return {"op": "frame_edit", "frameEdit": {"reading": "redraw", "runAs": "frame", **edit}, "question": None,
            "rationale": "redraw: who is where, from the words", "confidence": 0.9,
            "providerJob": {"provider": "runway", "model": "gemini_image3_pro", "prompt": prompt, "ratio": "1344:768",
                            "outputs": 1, "refs": refs if refs is not None else [
                                {"sha256": FRAME["sha256"], "name": "current", "role": "current"},
                                {"sha256": MAYA["asset"]["sha256"], "name": "maya_front", "role": "character"}]}}


def recast(op: str = "frame_edit", **over) -> dict:
    edit_label = "Edit anyway" if op == "frame_edit" else "Change anyway"
    q = {"kind": "recast", "text": "This changes who is in the picture.",
         "why": "An edit keeps everyone already there, so it would add people rather than swap them.",
         "options": [{"id": "edit", "label": edit_label, "value": "edit"},
                     {"id": "redraw", "label": "Redraw frame instead", "value": "redraw"}],
         "allow_text": False, "recommended_option_id": "redraw", **over}
    return {"op": op, "question": q, "rationale": "the words swap the people", "confidence": 0.8}


def local_reply(prompt: str) -> dict:
    return {"op": "frame_edit", "frameEdit": {"reading": "local", "runAs": "frame"}, "question": None,
            "rationale": "local", "confidence": 0.8,
            "providerJob": {"provider": "runway", "model": "gemini_image3_pro", "prompt": prompt, "ratio": "1344:768",
                            "outputs": 1, "refs": [{"sha256": FRAME["sha256"], "name": "current", "role": "current"}]}}


def answer(h: Harness, token: str, job: dict, option: str, expect=200) -> dict:
    return h.call("POST", f"/jobs/{job['jobId']}/answer",
                  {"contractVersion": "3", "questionId": job["question"]["id"], "optionId": option}, token, expect=expect)[1]


# ── Redraw frame ───────────────────────────────────────────────────────────────────────────────

def test_a_redraw_runs_as_frame_with_the_current_frame_first_and_never_a_previous_frame():
    h = harness()
    previous = {"sha256": asset(77)["sha256"], "name": "previous", "role": "object"}
    dex(h, redraw_reply(refs=[{"sha256": MAYA["asset"]["sha256"], "name": "maya_front", "role": "character"}, previous]))
    job = post(h, h.as_person(), edit_input(RECAST_WORDS, mode="redraw"))
    runway = h.providers["runway"]
    assert runway.ops == ["frame"]
    (sent,) = runway.submits
    assert [(r["name"], r["role"]) for r in sent["refs"]][:2] == [("current", "current"), ("maya_front", "character")]
    assert all(r["name"] != "previous" and r["sha256"] != previous["sha256"] for r in sent["refs"])
    assert "everything else" not in sent["prompt"].lower() and "@previous" not in sent["prompt"]
    edit = job["director"]["output"]["frameEdit"]
    assert edit == {"reading": "redraw", "runAs": "frame", "who": WHO}
    assert job["cost"]["reserved"] == 0.2


@pytest.mark.parametrize("prompt", [
    T3.replace("The market and the light stay as they are; the people are new.", "Everything else in @current stays exactly as it is."),
    T3 + " Continue from @previous.",
])
def test_a_redraw_that_keeps_the_old_people_falls_to_the_passthrough_which_redraws(prompt):
    h = harness()
    dex(h, redraw_reply(prompt=prompt))
    job = post(h, h.as_person(), edit_input(RECAST_WORDS, mode="redraw"))
    (sent,) = h.providers["runway"].submits
    edit = job["director"]["output"]["frameEdit"]
    assert job["director"]["model"] == "passthrough" and edit["reading"] == "redraw" and edit["runAs"] == "frame"
    assert sent["prompt"].startswith(RECAST_WORDS) and "Keep the setting, light and style of @current" in sent["prompt"]
    assert "everything else" not in sent["prompt"].lower()
    assert [r["role"] for r in sent["refs"]][0] == "current" and "previous" not in [r["name"] for r in sent["refs"]]


def test_a_redraw_never_asks_a_question_that_does_falls_to_the_passthrough():
    h = harness()
    dex(h, recast())
    job = post(h, h.as_person(), edit_input(RECAST_WORDS, mode="redraw"))
    assert job["state"] == "submitted" and job["director"]["output"]["frameEdit"]["reading"] == "redraw"
    assert h.providers["runway"].ops == ["frame"]


def test_an_edit_read_as_a_redraw_is_refused():
    h = harness()
    dex(h, redraw_reply())
    job = post(h, h.as_person(), edit_input("make her scarf red"))
    assert job["director"]["model"] == "passthrough" and job["director"]["output"]["frameEdit"]["reading"] == "local"


def test_a_redraw_with_a_box_draws_the_whole_frame_and_says_the_box_was_not_used():
    h = harness()
    dex(h, redraw_reply())
    job = post(h, h.as_person(), edit_input(RECAST_WORDS, mode="redraw", region={"x": 0.1, "y": 0.1, "w": 0.3, "h": 0.3}))
    (sent,) = h.providers["runway"].submits
    assert "region" not in sent and "mask" not in sent
    assert job["director"]["output"]["frameEdit"]["maskUnused"] is True


# ── a redraw places its people, and keeps a recast neighbour's cast (2026-11-17) ──────────────

def redraw_harness() -> Harness:
    h = harness()
    h.blobs.objects[f"in/{CAST['sha256']}"] = h.blobs.objects[f"in/{FRAME['sha256']}"]
    return h


@pytest.mark.parametrize("prompt", [T3, T4])
def test_a_redraw_that_places_each_person_goes_as_dex_wrote_it(prompt):
    h = harness()
    dex(h, redraw_reply(prompt=prompt))
    job = post(h, h.as_person(), edit_input(RECAST_WORDS, mode="redraw"))
    (sent,) = h.providers["runway"].submits
    assert job["director"]["model"] != "passthrough" and sent["prompt"].startswith(prompt[:40])
    assert job["director"]["output"]["frameEdit"]["who"] == WHO


def test_a_redraw_that_places_no_one_falls_to_the_passthrough():
    h = harness()
    dex(h, redraw_reply(prompt=UNPLACED))
    job = post(h, h.as_person(), edit_input(RECAST_WORDS, mode="redraw"))
    assert job["director"]["model"] == "passthrough"
    assert job["director"]["output"]["frameEdit"]["reading"] == "redraw"


def test_a_redraw_without_who_falls_to_the_passthrough():
    h = harness()
    dex(h, redraw_reply(who=None))
    job = post(h, h.as_person(), edit_input(RECAST_WORDS, mode="redraw"))
    assert job["director"]["model"] == "passthrough" and "who" not in job["director"]["output"]["frameEdit"]


def test_an_edit_never_carries_who():
    h = harness()
    dex(h, {**local_reply("Make her scarf red. Everything else in @current stays exactly as it is."),
            "frameEdit": {"reading": "local", "runAs": "frame", "who": WHO}})
    job = post(h, h.as_person(), edit_input("make her scarf red"))
    assert job["director"]["model"] != "passthrough" and "who" not in job["director"]["output"]["frameEdit"]


def test_a_redraw_with_a_cast_frame_sends_current_then_cast_and_dex_sees_both():
    h = redraw_harness()
    wire = dex(h, redraw_reply(prompt=T5, refs=[{"sha256": FRAME["sha256"], "name": "current", "role": "current"}]))
    job = post(h, h.as_person(), edit_input(RECAST_WORDS, mode="redraw", castFrame=CAST))
    (sent,) = h.providers["runway"].submits
    assert job["director"]["model"] != "passthrough"
    assert [(r["name"], r["role"], r["sha256"]) for r in sent["refs"]][:2] == [
        ("current", "current", FRAME["sha256"]), ("cast", "object", CAST["sha256"])]
    assert "@cast" in sent["prompt"]
    assert len(wire.calls[0]["turns"][0]["images"]) == 2


def test_a_cast_frame_dex_never_names_falls_to_the_passthrough_which_names_it():
    h = redraw_harness()
    dex(h, redraw_reply(prompt=T4))
    job = post(h, h.as_person(), edit_input(RECAST_WORDS, mode="redraw", castFrame=CAST))
    (sent,) = h.providers["runway"].submits
    assert job["director"]["model"] == "passthrough"
    assert "the people are the ones in @cast" in sent["prompt"]
    assert [r["name"] for r in sent["refs"]][:2] == ["current", "cast"]


def test_cast_without_a_cast_frame_falls_to_the_passthrough():
    h = harness()
    dex(h, redraw_reply(prompt=T5))
    job = post(h, h.as_person(), edit_input(RECAST_WORDS, mode="redraw"))
    (sent,) = h.providers["runway"].submits
    assert job["director"]["model"] == "passthrough" and "@cast" not in sent["prompt"]
    assert "cast" not in [r["name"] for r in sent["refs"]]


def test_a_cast_frame_never_lets_a_previous_frame_back_in():
    h = redraw_harness()
    dex(h, redraw_reply(prompt=T5 + " Continue from @previous."))
    job = post(h, h.as_person(), edit_input(RECAST_WORDS, mode="redraw", castFrame=CAST))
    (sent,) = h.providers["runway"].submits
    assert job["director"]["model"] == "passthrough" and "@previous" not in sent["prompt"]


@pytest.mark.parametrize("more", [{"castFrame": CAST}, {"castFrame": CAST, "mode": "edit"}])
def test_a_cast_frame_comes_only_with_a_redraw(more):
    h = redraw_harness()
    dex(h, local_reply("Make her scarf red."))
    post(h, h.as_person(), edit_input("make her scarf red", **more), expect=400)
    assert not h.providers["runway"].submits


# ── the recast ask, before anything is paid ───────────────────────────────────────────────────

def test_an_edit_that_swaps_the_people_asks_a_recast_before_anything_is_paid():
    h = harness()
    dex(h, recast())
    token = h.as_person()
    job = post(h, token, edit_input(RECAST_WORDS))
    assert job["state"] == "needs_input"
    q = job["question"]
    assert q["kind"] == "recast" and q["recommended_option_id"] == "redraw" and q["allow_text"] is False
    assert [(o["id"], o["value"]) for o in q["options"]] == [("redraw", "redraw"), ("edit", "edit")]
    assert job["cost"]["reserved"] == 0 and spent(h) == 0 and not h.providers["runway"].submits


def test_the_answer_redraw_resumes_the_same_job_as_a_redraw():
    h = harness()
    dex(h, recast(), redraw_reply())
    token = h.as_person()
    job = post(h, token, edit_input(RECAST_WORDS))
    resumed = answer(h, token, job, "redraw")
    assert resumed["jobId"] == job["jobId"] and resumed["state"] == "submitted"
    assert resumed["director"]["output"]["frameEdit"]["reading"] == "redraw"
    assert h.providers["runway"].ops == ["frame"]


def test_the_answer_edit_resumes_as_an_edit_and_never_asks_again():
    h = harness()
    words = RECAST_WORDS + ". Everything else in @current stays exactly as it is."
    dex(h, recast(), local_reply(words))
    token = h.as_person()
    job = post(h, token, edit_input(RECAST_WORDS))
    resumed = answer(h, token, job, "edit")
    assert resumed["state"] == "submitted" and resumed["director"]["output"]["frameEdit"]["reading"] == "local"
    (sent,) = h.providers["runway"].submits
    assert sent["prompt"] == words


def test_asking_again_after_edit_falls_to_the_passthrough_which_edits():
    h = harness()
    dex(h, recast(), recast())
    token = h.as_person()
    job = post(h, token, edit_input(RECAST_WORDS))
    resumed = answer(h, token, job, "edit")
    assert resumed["state"] == "submitted" and resumed["director"]["model"] == "passthrough"
    assert resumed["director"]["output"]["frameEdit"]["reading"] == "local"


@pytest.mark.parametrize("bad", [
    {"recommended_option_id": "edit"},
    {"options": [{"id": "redraw", "label": "Redraw", "value": "redraw"}, {"id": "keep", "label": "Keep", "value": "keep"}]},
    {"options": [{"id": "a", "label": "Redraw", "value": "redraw"}, {"id": "b", "label": "Edit", "value": "edit"}]},
])
def test_a_recast_of_another_shape_is_refused(bad):
    h = harness()
    dex(h, recast(**bad))
    job = post(h, h.as_person(), edit_input(RECAST_WORDS))
    assert job["state"] == "submitted" and job["director"]["model"] == "passthrough"


# ── the Image editor's whole-frame change on a shot's frame ───────────────────────────────────

def editor(h_routes=("runway",)) -> Harness:
    cfg = base_config()
    h = Harness(cfg)
    h.limits("blue", allow={"claude": True, "makers": ["runway", "google", "ideogram", "magnific"]})
    h.blobs.objects[f"in/{FRAME['sha256']}"] = (png_bytes(), "image/png")
    return h


def png_bytes(colour=(90, 140, 200)) -> bytes:
    out = io.BytesIO()
    Image.new("RGB", (320, 180), colour).save(out, "PNG")
    return out.getvalue()


def market_shot() -> dict:
    return {**shot(), "action": "Behind them, a line of shoppers waits, arms full of colour.", "refs": []}


def region_post(h: Harness, token: str, inp: dict, expect=200) -> dict:
    body = {**envelope("region_edit", new_id("job")), "node": {"kind": "shot", "id": shot()["id"]}, "input": inp}
    return h.call("POST", "/jobs", body, token, expect=expect)[1]


def test_a_whole_frame_change_that_swaps_the_people_on_a_shots_frame_asks_and_redraw_hands_off_free():
    h = editor()
    dex(h, recast("region_edit"))
    token = h.as_person()
    job = region_post(h, token, {"image": FRAME, "text": RECAST_WORDS, "shot": market_shot()})
    assert job["state"] == "needs_input" and job["question"]["kind"] == "recast"
    done = answer(h, token, job, "redraw")
    assert done["state"] == "cancelled" and done["handoff"] == {"op": "frame_edit", "mode": "redraw"}
    assert spent(h) == 0 and not h.providers["runway"].submits
    assert h.relay.remaining(h.people[token]["pid"]) == h.cfg["quotas"]


def test_change_anyway_makes_the_whole_frame_change():
    h = editor()
    dex(h, recast("region_edit"), {
        "op": "region_edit", "question": None, "rationale": "as asked", "confidence": 0.8,
        "providerJob": {"provider": "runway", "model": "gemini_image3_pro", "prompt": RECAST_WORDS + ". Everything else stays as it is.",
                        "refs": [{"sha256": FRAME["sha256"], "name": "current", "role": "current"}], "outputs": 1, "ratio": "1344:768"}})
    token = h.as_person()
    job = region_post(h, token, {"image": FRAME, "text": RECAST_WORDS, "shot": market_shot()})
    resumed = answer(h, token, job, "edit")
    assert resumed["state"] == "submitted" and resumed["model"] == "gemini_image3_pro"
    assert h.providers["runway"].ops == ["region_edit"]


def test_a_recast_on_a_picture_that_is_not_a_shots_frame_is_refused():
    h = editor()
    dex(h, recast("region_edit"))
    job = region_post(h, h.as_person(), {"image": FRAME, "text": RECAST_WORDS})
    assert job["state"] == "submitted" and job["director"]["model"] == "passthrough"


# ── a picture that came back the same ─────────────────────────────────────────────────────────

def scene(patch=None) -> bytes:
    im = Image.new("RGB", (1344, 768), (30, 30, 30))
    d = ImageDraw.Draw(im)
    for i in range(0, 1344, 48):
        d.rectangle([i, 0, i + 24, 768], fill=((i * 7) % 255, (i * 3) % 255, (i * 5) % 255))
    if patch:
        d.rectangle(patch, fill=(200, 20, 20))
    out = io.BytesIO()
    im.save(out, "PNG")
    return out.getvalue()


def test_sameness_calls_a_picture_given_back_the_same_and_a_small_real_edit_changed():
    a = scene()
    assert sameness.same_picture(a, a)
    jpeg = io.BytesIO()
    Image.open(io.BytesIO(a)).save(jpeg, "JPEG", quality=92)  # re-encoded by a provider
    assert sameness.same_picture(a, jpeg.getvalue())
    assert not sameness.same_picture(a, scene(patch=[600, 300, 670, 360]))  # 0.4 % of the frame
    assert not sameness.same_picture(a, png_bytes())


def test_a_region_edit_is_judged_inside_its_area():
    """QA 2026-11-17: a no-op fill left its area as it was while the rest of the frame moved a little."""
    a = scene()
    elsewhere = scene(patch=[1100, 600, 1300, 740])  # a change outside the area
    region = {"x": 0.0, "y": 0.0, "w": 0.34, "h": 0.34}
    assert not sameness.same_picture(a, elsewhere)
    assert sameness.same_picture(a, elsewhere, region)
    inside = scene(patch=[60, 40, 300, 200])  # a real fill inside the area
    assert not sameness.same_picture(a, inside, region)


def test_a_frame_edit_whose_picture_came_back_the_same_is_marked_unchanged():
    h = harness()
    h.blobs.objects[f"in/{FRAME['sha256']}"] = (scene(), "image/png")
    out_same = asset(91)
    h.blobs.objects[f"in/{out_same['sha256']}"] = (scene(), "image/png")
    out_new = asset(92)
    h.blobs.objects[f"in/{out_new['sha256']}"] = (scene(patch=[100, 100, 400, 400]), "image/png")
    job = {"jobId": "job_x", "op": "frame_edit", "_req": {"input": {"image": FRAME}}}
    assert h.relay._came_back_same(job, out_same) is True
    assert h.relay._came_back_same(job, out_new) is False
    assert h.relay._came_back_same(job, {"sha256": "sha256:" + "0" * 64, "url": "https://elsewhere.test/x.png"}) is False


# ── a take's timed lines have their own budget ────────────────────────────────────────────────

def test_a_takes_budget_grows_with_its_shots():
    shots = [{"action": f"Shot {k} happens."} for k in range(3)]
    prompt = "x" * 556  # the Omni Flash take of 2026-11-17 that fell back to the raw words
    _within_budget({"prompt": prompt}, "clip", {"mode": "take_refs", "shots": shots})
    with pytest.raises(DirectorError):
        _within_budget({"prompt": prompt}, "clip", {})  # a single clip keeps its 300
    with pytest.raises(DirectorError):
        _within_budget({"prompt": "x" * 1200}, "clip", {"mode": "take", "shots": shots})


def test_the_bundled_v9_1_prompt_carries_redraw_recast_and_the_take_budget():
    text = (PROMPTS / "director.v9.1.md").read_text()
    for line in ("### redraw", "`kind` `recast`", "Redraw frame instead", "120 for each shot's line",
                 "Keep the setting, light and style of @current.", "where they stand in this shot's framing",
                 "is not in this picture", "`input.castFrame`", "`frameEdit.who`"):
        assert line in text, line
