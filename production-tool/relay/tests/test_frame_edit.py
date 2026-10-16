"""Change this frame understands the words (features/frame-change-edit.clan, review item 5).

One frame_edit job: Dex reads the words against the current frame (sent to him as one image) and the
shot, and the relay runs the op his reading resolves (frameEdit.runAs), under every existing check:
a camera change redraws the frame (op frame), a local one edits it (region_edit, or an instruction edit
with no box), a change of camera movement only draws nothing, and words that could mean either ask
"Bigger how?". The adapter never sees op frame_edit.
"""

from __future__ import annotations

import copy
import io
import json
import time
from pathlib import Path

import httpx
import pytest
from PIL import Image

import names
from conftest import CDN, Harness, asset, base_config, envelope, ref
from contracts_dir import pricing
from director import new_id
from director.base import PassthroughDirector
from director.claude import ClaudeDirector
from director.director import (Director, DirectorError, QUOTE_MIN, _given_words, _within_budget, camera_words)
from director import frame_edit as fe
from director.model import ModelPort, Reply
from providers import load_sheet
from providers._seam import Adapted, Resolver
from providers.runway import REGION_PROMPT, RunwayProvider

PROMPTS = Path(__file__).resolve().parent.parent / "prompts"
COMMON = json.loads((Path(__file__).resolve().parents[2] / "contracts" / "common.schema.json").read_text())["$defs"]

FRAME = asset(40)
MASK = asset(43)
MAYA, BEACH = ref(41, "maya_front"), ref(42, "beach_wide", role="location")
WORDS = "make this an overhead aerial shot"


def png(w: int = 320, h: int = 180) -> bytes:
    out = io.BytesIO()
    Image.new("RGB", (w, h), (90, 140, 200)).save(out, "PNG")
    return out.getvalue()


def shot(**camera) -> dict:
    return {"id": "shot_01K7F00000000000000000SH04", "kind": "shot", "duration_s": 3,
            "camera": camera or {"size": "medium", "angle": "eye_level", "movement": "static"},
            "action": "@maya_front runs along the beach at golden hour.", "refs": ["maya_front", "beach_wide"]}


def edit_input(text: str = WORDS, **more) -> dict:
    return {"text": text, "image": FRAME, "aspect": {"w": 1344, "h": 756}, "shot": shot(),
            "refs": [copy.deepcopy(MAYA), copy.deepcopy(BEACH)], **more}


def harness(*routes: str, providers=("mock", "runway")) -> Harness:
    cfg = base_config()
    cfg["routing"]["frame_edit"] = list(routes or ("runway",))
    h = Harness(cfg, providers=providers)
    h.blobs.objects[f"in/{FRAME['sha256']}"] = (png(), "image/png")
    return h


class FakeWire:
    api = "bedrock"

    def __init__(self, *replies):
        self.replies, self.calls = list(replies), []

    def send(self, **kw):
        self.calls.append(kw)
        return Reply(json.dumps(self.replies.pop(0)), "ok", (6000, 400))


def dex(h: Harness, *replies) -> FakeWire:
    """The relay's director is Claude on a recorded reply (director.v7 from the config)."""
    wire = FakeWire(*replies)
    h.relay.director = ClaudeDirector(Director(ModelPort(wire, "eu.anthropic.claude-sonnet-5-5", timeout=5),
                                               PROMPTS, {}, prompt_version="director.v7"))
    return wire


def reply(reading="camera", run_as="frame", camera=None, prompt=None, refs=None, **job) -> dict:
    out = {"op": "frame_edit", "frameEdit": {"reading": reading, "runAs": run_as}, "question": None,
           "rationale": f"read as {reading}", "confidence": 0.9}
    if camera:
        out["frameEdit"]["camera"] = camera
    if run_as != "none":
        out["providerJob"] = {
            "provider": job.pop("provider", "runway"), "model": "gemini_image3_pro",
            "prompt": prompt or f"{WORDS}. Seen from directly above, wide: @maya_front runs along @beach_wide. "
                                "The people, place and light of @current, not its framing.",
            "refs": refs if refs is not None else [
                {"sha256": FRAME["sha256"], "name": "current", "role": "current"},
                {"sha256": MAYA["asset"]["sha256"], "name": "maya_front", "role": "character"},
                {"sha256": BEACH["asset"]["sha256"], "name": "beach_wide", "role": "object"}],
            "ratio": "1344:768", "outputs": 1, **job}
    return out


CAMERA = reply(camera={"angle": "overhead", "size": "wide"})


def ask(**over) -> dict:
    q = {"kind": "ambiguity", "text": "Bigger how?", "why": "Bigger could mean the camera or the bottle.",
         "options": [{"id": "local", "label": "Make the bottle bigger", "value": "local",
                      "cost": {"estimate": 0.2, "currency": "USD"}},
                     {"id": "camera", "label": "Move the camera in", "value": "camera",
                      "cost": {"estimate": 9.0, "currency": "USD"}},
                     {"id": "both", "label": "Both", "value": "both"}],
         "allow_text": False, **over}
    return {"op": "frame_edit", "question": q, "rationale": "bigger could be either", "confidence": 0.4}


def post(h: Harness, token: str, inp: dict, expect=200, **req):
    body = {**envelope("frame_edit", new_id("job")), "node": {"kind": "shot", "id": shot()["id"]}, "input": inp, **req}
    return h.call("POST", "/jobs", body, token, expect=expect)[1]


def spent(h: Harness) -> float:
    return round(h.store.counters("spend").get("usd", 0), 6)


# ── the op: who works it, what it needs, what it refuses ──────────────────────────────────────

def test_frame_edit_is_built_and_dex_works_it():
    h = harness()
    dex(h, CAMERA)
    job = post(h, h.as_person(), edit_input())
    assert job["state"] == "submitted" and job["crew"] == "dex" and job["quotaClass"] == "image"


@pytest.mark.parametrize("extra", [{"anchorFrame": FRAME}, {"previousFrame": FRAME}])
def test_a_frame_edit_with_an_anchor_or_previous_frame_is_invalid_input(extra):
    h = harness()
    token = h.as_person()
    out = post(h, token, edit_input(**extra), expect=400)
    assert out["error"]["code"] == "invalid_input"
    assert h.relay.remaining(h.people[token]["pid"]) == h.cfg["quotas"] and spent(h) == 0


def test_a_frame_edit_takes_no_model_choice_and_needs_its_frame_shot_and_words():
    h = harness()
    token = h.as_person()
    pick = {"provider": "runway", "model": "gemini_image3_pro"}
    assert post(h, token, edit_input(), expect=400, modelChoice=pick)["error"]["code"] == "invalid_input"
    for missing in ("image", "shot", "text"):
        inp = edit_input()
        del inp[missing]
        assert post(h, token, inp, expect=400)["error"]["code"] == "invalid_input", missing


def test_frame_edit_is_off_when_its_routing_is():
    h = harness()
    del h.cfg["routing"]["frame_edit"]
    assert post(h, h.as_person(), edit_input(), expect=403)["error"]["code"] == "flag_off"


# ── a camera reading: the whole frame drawn again, from the words first ───────────────────────

def test_a_camera_reading_runs_as_frame_with_the_current_frame_and_no_continuity():
    h = harness()
    wire = dex(h, CAMERA)
    job = post(h, h.as_person(), edit_input())
    runway = h.providers["runway"]
    assert runway.ops == ["frame"]  # never frame_edit
    (sent,) = runway.submits
    assert sent["prompt"].lower().startswith(WORDS)
    assert [(r["name"], r["role"]) for r in sent["refs"]] == [("current", "current"), ("maya_front", "character"),
                                                              ("beach_wide", "object")]
    assert sent["refs"][0]["sha256"] == FRAME["sha256"]
    assert "anchor" not in json.dumps(sent) and "previous" not in json.dumps(sent)
    edit = job["director"]["output"]["frameEdit"]
    assert edit == {"reading": "camera", "runAs": "frame", "camera": {"angle": "overhead", "size": "wide"}}
    # Dex saw the frame: exactly one picture, downscaled to at most 768 px.
    (images,) = [t["images"] for t in wire.calls[0]["turns"][:1]]
    assert len(images) == 1 and images[0]["media_type"] == "image/jpeg"
    assert Image.open(io.BytesIO(__import__("base64").b64decode(images[0]["data"]))).size[0] <= 768
    assert job["director"]["promptVersion"] == "director.v9"  # the configs name v9 (features/runway-video-models.clan); frame_edit is unchanged from v7


def test_other_ops_send_the_model_no_image():
    wire = FakeWire({"op": "generate", "providerJob": {"provider": "runway", "model": "gemini_image3_pro",
                                                      "prompt": "a hero", "refs": [], "ratio": "1024:1024"},
                     "question": None, "rationale": "x", "confidence": 0.5})
    d = Director(ModelPort(wire, "m", timeout=5), PROMPTS, {"runway": load_sheet("runway")}, prompt_version="director.v7")
    d.run("generate", {"text": "a hero", "ratio": "1:1"}, "runway", images=[{"media_type": "image/png", "data": "x"}])
    assert wire.calls[0]["turns"][0]["images"] == []


def test_a_leaf_that_keeps_its_value_is_no_change_and_a_patch_of_none_is_refused():
    h = harness()
    dex(h, reply(camera={"angle": "overhead", "size": "medium"}))
    job = post(h, h.as_person(), edit_input())
    assert job["director"]["output"]["frameEdit"]["camera"] == {"angle": "overhead"}
    h2 = harness()
    dex(h2, reply(camera={"angle": "eye_level", "size": "medium"}))
    job2 = post(h2, h2.as_person(), edit_input())
    assert job2["director"]["model"] == "passthrough"  # the reply changed nothing: the words go as they are


@pytest.mark.parametrize("camera", [{"size": "graphic"}, {"angle": "upside_down"}])
def test_a_camera_patch_outside_the_contract_falls_to_the_passthrough(camera):
    h = harness()
    dex(h, reply(camera=camera))
    job = post(h, h.as_person(), edit_input())
    assert job["director"]["model"] == "passthrough"
    assert job["director"]["output"]["frameEdit"]["words_as_given"] is True
    assert h.providers["runway"].ops == ["frame"]


@pytest.mark.parametrize("prompt", [
    f"{WORDS}. Keep the setting of the anchor frame.",
    f"{WORDS}. Continue from @previous.",
    f"Seen from above. {WORDS}.",
])
def test_continuity_words_or_words_not_first_fall_to_the_passthrough(prompt):
    h = harness()
    dex(h, reply(camera={"angle": "overhead"}, prompt=prompt))
    job = post(h, h.as_person(), edit_input())
    assert job["director"]["model"] == "passthrough"
    assert h.providers["runway"].submits[0]["prompt"] == WORDS


def test_dex_leaving_out_the_current_frame_still_sends_it_first():
    h = harness()
    dex(h, reply(camera={"angle": "overhead"}, refs=[{"sha256": MAYA["asset"]["sha256"], "name": "maya_front", "role": "character"}]))
    post(h, h.as_person(), edit_input())
    assert [r["name"] for r in h.providers["runway"].submits[0]["refs"]] == ["current", "maya_front"]


# ── a local reading ───────────────────────────────────────────────────────────────────────────

LOCAL_PROMPT = "make her scarf red. Only the scarf changes; everything else stays as it is."
BOX = {"x": 0.4, "y": 0.3, "w": 0.2, "h": 0.2}


class FakeRunwayHttp:
    """Runway as a MockTransport, serving our own pictures back for the marked copy."""

    def __init__(self):
        self.requests: list[httpx.Request] = []

    def __call__(self, req: httpx.Request) -> httpx.Response:
        self.requests.append(req)
        if req.method == "POST":
            return httpx.Response(200, json={"id": "task_1"})
        if str(req.url).startswith(CDN):
            return httpx.Response(200, content=png(), headers={"content-type": "image/png"})
        return httpx.Response(200, json={"id": "task_1", "status": "RUNNING"})


def test_an_unmasked_local_reading_runs_as_region_edit_with_a_box_mask_on_ideogram():
    """Runway's region_edit is ideogram_4_5 (features/image-editor.clan): a box with no painted mask
    goes as a black-and-white mask made from the box, black where it changes, beside the frame."""
    h = harness(providers=("runway",))
    http = FakeRunwayHttp()
    h.relay.registry.register(Adapted(RunwayProvider("rw-key", Resolver(), client=httpx.Client(transport=httpx.MockTransport(http)))),
                              h.providers["runway"].sheet)
    dex(h, reply("local", "region_edit", prompt=LOCAL_PROMPT, region=BOX,
                 refs=[{"sha256": FRAME["sha256"], "name": "current", "role": "current"}]))
    job = post(h, h.as_person(), edit_input("make her scarf red", region=BOX))
    assert job["state"] == "submitted", job
    (sent,) = [json.loads(r.content) for r in http.requests if r.method == "POST"]
    assert sent["model"] == "ideogram_4_5" and sent["promptText"].startswith("make her scarf red")
    assert sent["maskUri"].startswith("data:image/png;base64,") and "ratio" not in sent
    assert len(sent["referenceImages"]) == 1
    assert job["director"]["output"]["frameEdit"] == {"reading": "local", "runAs": "region_edit"}


def test_a_masked_local_reading_is_a_masked_inpaint_on_a_sheet_that_takes_masks():
    h = harness("mock")
    dex(h, reply("local", "region_edit", prompt=LOCAL_PROMPT, provider="mock", region=BOX, mask=MASK["sha256"],
                 refs=[{"sha256": FRAME["sha256"], "name": "current", "role": "current"}]))
    post(h, h.as_person(), edit_input("make her scarf red", region=BOX, mask=MASK))
    mock = h.providers["mock"]
    assert mock.ops == ["region_edit"] and mock.submits[0]["mask"] == MASK["sha256"]


def test_a_local_reading_with_no_box_is_an_instruction_edit_of_the_whole_frame():
    h = harness()
    dex(h, reply("local", "frame", prompt=f"{LOCAL_PROMPT} Everything else in @current stays exactly as it is."))
    job = post(h, h.as_person(), edit_input("make her scarf red"))
    assert h.providers["runway"].ops == ["frame"]
    assert job["director"]["output"]["frameEdit"] == {"reading": "local", "runAs": "frame"}
    assert h.providers["runway"].submits[0]["refs"][0]["role"] == "current"


def test_a_camera_reading_with_a_mask_redraws_the_whole_frame_and_says_the_mask_was_not_used():
    h = harness("mock")
    dex(h, reply(camera={"angle": "overhead", "size": "wide"}, provider="mock", region=BOX, mask=MASK["sha256"]))
    job = post(h, h.as_person(), edit_input(region=BOX, mask=MASK))
    mock = h.providers["mock"]
    assert mock.ops == ["frame"]
    assert "mask" not in mock.submits[0] and "region" not in mock.submits[0]
    assert job["director"]["output"]["frameEdit"]["maskUnused"] is True


def test_only_the_passthrough_marks_the_words_as_given():
    h = harness()
    answer = reply(camera={"angle": "overhead"})
    answer["frameEdit"]["words_as_given"] = True  # a recorded v7 reply wrote it
    dex(h, answer)
    job = post(h, h.as_person(), edit_input())
    assert job["director"]["model"] != "passthrough" and "words_as_given" not in job["director"]["output"]["frameEdit"]


# ── asks: Bigger how? ─────────────────────────────────────────────────────────────────────────

def test_bigger_asks_an_ambiguity_with_camera_local_both_no_recommendation_and_no_price():
    h = harness()
    dex(h, ask())
    token = h.as_person()
    job = post(h, token, edit_input("make the bottle bigger"))
    assert job["state"] == "needs_input"
    q = job["question"]
    assert q["kind"] == "ambiguity" and q["text"] == "Bigger how?" and "recommended_option_id" not in q
    assert [(o["id"], o["value"]) for o in q["options"]] == [("camera", "camera"), ("local", "local"), ("both", "both")]
    assert all("cost" not in o for o in q["options"]) and q["allow_text"] is False
    assert job["cost"]["reserved"] == 0 and spent(h) == 0
    assert not h.providers["runway"].submits


def test_the_answer_resumes_the_same_job_and_a_second_answer_gets_409():
    h = harness()
    dex(h, ask(), reply(camera={"size": "close"}, prompt="make the bottle bigger. Closer on the bottle, @current's people and light."))
    alice, bob = h.as_person("alice"), h.as_person("bob")
    job = post(h, alice, edit_input("make the bottle bigger"))
    qid = job["question"]["id"]
    _, resumed = h.call("POST", f"/jobs/{job['jobId']}/answer", {"contractVersion": "3", "questionId": qid, "optionId": "camera"},
                        bob, expect=200)
    assert resumed["jobId"] == job["jobId"] and resumed["state"] == "submitted"
    assert h.providers["runway"].ops == ["frame"]
    assert resumed["director"]["output"]["frameEdit"]["camera"] == {"size": "close"}
    h.call("POST", f"/jobs/{job['jobId']}/answer", {"contractVersion": "3", "questionId": qid, "optionId": "local"},
           alice, expect=409)


def test_a_reply_that_ignores_the_answer_falls_to_the_passthrough_which_honours_it():
    h = harness()
    dex(h, ask(), reply(camera={"size": "close"}, prompt="make the bottle bigger, closer."))
    token = h.as_person()
    job = post(h, token, edit_input("make the bottle bigger", region=BOX))
    _, resumed = h.call("POST", f"/jobs/{job['jobId']}/answer",
                        {"contractVersion": "3", "questionId": job["question"]["id"], "optionId": "local"}, token, expect=200)
    edit = resumed["director"]["output"]["frameEdit"]
    assert resumed["director"]["model"] == "passthrough"
    assert edit["reading"] == "local" and edit["runAs"] == "region_edit" and edit["words_as_given"] is True
    assert h.providers["runway"].ops == ["region_edit"]


@pytest.mark.parametrize("bad", [
    {"kind": "nudge", "recommended_option_id": "camera"},
    {"options": [{"id": "camera", "label": "Camera", "value": "camera"}, {"id": "subject", "label": "Subject", "value": "subject"}]},
    {"options": [{"id": "a", "label": "Camera", "value": "camera"}, {"id": "b", "label": "Edit", "value": "local"}]},
])
def test_an_ask_of_another_shape_is_refused_and_the_passthrough_asks_instead(bad):
    h = harness()
    dex(h, ask(**bad))
    job = post(h, h.as_person(), edit_input("make the bottle bigger"))
    assert job["state"] == "needs_input" and job["director"]["model"] == "passthrough"
    q = job["question"]
    assert q["kind"] == "ambiguity" and [o["value"] for o in q["options"]] == ["camera", "local", "both"]
    assert "recommended_option_id" not in q


# ── movement only: nothing to draw ────────────────────────────────────────────────────────────

@pytest.mark.parametrize("answer", [
    reply(run_as="none", camera={"movement": "push_in", "movement_speed": "slow"}),
    reply(run_as="frame", camera={"movement": "push_in", "movement_speed": "slow"}),  # a job it did not need
])
def test_a_change_of_movement_only_completes_unpaid_with_no_provider_call(answer):
    h = harness()
    dex(h, answer)
    token = h.as_person()
    job = post(h, token, edit_input("push in slowly"))
    assert job["state"] == "completed" and job["outputs"] == []
    assert job["cost"]["reserved"] == 0 and "confirmed" not in job["cost"] and spent(h) == 0
    assert job["director"]["output"]["frameEdit"] == {"reading": "camera", "runAs": "none",
                                                      "camera": {"movement": "push_in", "movement_speed": "slow"}}
    assert "providerJob" not in job["director"]["output"]
    assert not h.providers["runway"].submits
    assert h.relay.remaining(h.people[token]["pid"]) == h.cfg["quotas"]
    assert h.store.counters(f"inflight#{h.people[token]['pid']}").get("n", 0) == 0


# ── money: the reservation follows the op it runs as ──────────────────────────────────────────

def test_frame_edit_reserves_the_dearer_op_then_the_price_of_the_one_it_runs_as():
    # region_edit on a cheaper catalogue model than frame's, so the two prices differ (runway-sheet-sync:
    # prices come from models[model].pricing through pricing.py).
    h = harness()
    sheet = h.providers["runway"].sheet
    sheet["ops"]["region_edit"].update(model="gemini_image3.1_flash", mask="none",
                                       defaults={"outputs": 1, "ratio": "1344:768"})
    cheap = pricing().op_usd(sheet, "region_edit")
    assert cheap < pricing().op_usd(sheet, "frame_edit") == 0.2
    dex(h, reply("local", "region_edit", prompt=LOCAL_PROMPT, region=BOX,
                 refs=[{"sha256": FRAME["sha256"], "name": "current", "role": "current"}]))
    job = post(h, h.as_person(), edit_input("make her scarf red", region=BOX))
    assert job["cost"]["estimate"] == job["cost"]["reserved"] == cheap
    assert spent(h) == cheap
    h2 = harness()
    dex(h2, CAMERA)
    job2 = post(h2, h2.as_person(), edit_input())
    assert job2["cost"]["reserved"] == 0.2 and spent(h2) == 0.2


def test_the_sheet_prices_frame_edit_at_the_dearer_of_frame_and_region_edit():
    for name in ("runway", "mock"):
        sheet = load_sheet(name)
        price = lambda op: pricing().op_usd(sheet, op) or 0  # noqa: E731
        assert price("frame_edit") == max(price("frame"), price("region_edit"))


# ── checks under the op it runs as ────────────────────────────────────────────────────────────

def test_the_image_prompt_cap_holds_for_frame_edit():
    sheet = load_sheet("runway")
    job = {"provider": "runway", "model": "gemini_image3_pro", "prompt": "x" * 5600, "refs": []}
    with pytest.raises(DirectorError, match="over its 5500"):
        Director._check_provider_limits("frame_edit", sheet, job)


def test_an_over_long_frame_edit_prompt_falls_to_the_passthrough():
    h = harness()
    dex(h, reply(camera={"angle": "overhead"}, prompt=WORDS + " " + "seen from above " * 360))
    job = post(h, h.as_person(), edit_input())
    assert job["director"]["model"] == "passthrough"


def test_refs_at_the_sheets_limit_keep_room_for_the_current_frame():
    sheet = {"refs": {"max": 3, "maxCharacter": 5}}
    payload = {"image": FRAME, "refs": [ref(1, "maya_front"), ref(2, "maya_side"), ref(3, "maya_back")]}
    _, dropped_frame = names.fit_refs("frame", payload, sheet)
    _, dropped_edit = names.fit_refs("frame_edit", payload, sheet)
    assert dropped_frame == [] and dropped_edit == ["maya_back"]


# ── the budget: the shot's own words, quoted, are not the director's ──────────────────────────

DIRECTION = " ".join(f"Beat {i}: she turns slowly toward the light and the sea wind lifts her hair." for i in range(55))[:4000]


def test_quoting_the_shots_long_direction_is_within_the_budget():
    payload = {"text": "brighter", "shot": {**shot(), "direction": DIRECTION}}
    prompt = "brighter. " + DIRECTION[:1200] + " Full-bleed cinematic image."
    assert len(DIRECTION) == 4000
    _within_budget({"prompt": prompt}, "frame", payload)
    assert len(prompt) - _given_words(prompt, payload) < 60


def test_invented_words_past_the_budget_still_fail_however_they_are_padded():
    payload = {"text": "brighter", "shot": {**shot(), "direction": DIRECTION}}
    invented = "".join(f"a gull number {i} wheels over a red boat; " for i in range(30))[:900]
    with pytest.raises(DirectorError, match="added"):
        _within_budget({"prompt": "brighter. " + invented}, "frame", payload)
    # A paraphrase of the direction is the director's words, not the shot's: it counts.
    paraphrase = " ".join(f"At moment {i} the woman faces a glow while ocean air raises her locks." for i in range(14))
    assert len(paraphrase) > 900 and _given_words(paraphrase, payload) == len("brighter")  # only the words


def test_only_runs_of_twenty_characters_or_more_count_as_given():
    payload = {"text": "", "shot": {**shot(), "direction": "the quick brown fox jumps"}}
    assert QUOTE_MIN == 20
    assert _given_words("quick brown fox", payload) == 0
    assert _given_words("the quick brown fox jumps", payload) == len("the quick brown fox jumps")


# ── the frame fetch: within 3 s, or the words go as they are ──────────────────────────────────

def test_a_slow_frame_fetch_goes_to_the_passthrough_and_says_so(monkeypatch):
    h = harness()
    wire = dex(h, CAMERA)
    slow = h.blobs.fetch

    def fetch(url):
        time.sleep(0.3)
        return slow(url)
    monkeypatch.setattr(h.blobs, "fetch", fetch)
    monkeypatch.setattr(h.relay, "FRAME_FETCH_S", 0.05)
    job = post(h, h.as_person(), edit_input())
    assert not wire.calls
    assert job["director"]["model"] == "passthrough"
    assert job["director"]["output"]["frameEdit"]["words_as_given"] is True
    assert "could not look at the frame" in job["director"]["rationale"]
    assert h.providers["runway"].ops == ["frame"]


def test_an_agency_that_keeps_pictures_from_claude_gets_the_passthrough():
    h = harness()
    wire = dex(h, CAMERA)
    token = h.as_person()
    tid = h.people[token]["tenant"]["id"]
    h.store.put_tenant({"tenantId": tid, "agency": "blue", "enabled": True,
                        "allow": {"claude": False, "makers": ["runway", "google"]}})
    h.relay._tenants.pop(tid, None)
    job = post(h, token, edit_input())
    assert not wire.calls and job["director"]["model"] == "passthrough"


# ── the passthrough's lexicon (common cameraWords) ────────────────────────────────────────────

@pytest.mark.parametrize("text,camera,want", [
    ("make this an overhead aerial shot", {"size": "medium", "angle": "eye_level"}, ("camera", {"angle": "overhead"})),
    ("low angle, close-up", {"size": "medium"}, ("camera", {"angle": "low_angle", "size": "close"})),
    ("give it a dutch tilt", {"size": "medium"}, ("camera", {"angle": "dutch"})),
    ("push in slowly", {"size": "medium", "movement": "static"}, ("camera", {"movement": "push_in", "movement_speed": "slow"})),
    ("shoot it on a 100mm macro", {"size": "close"}, ("camera", {"lens_mm": 100, "macro": True})),
    ("make the bottle bigger", {"size": "medium"}, ("ask", {})),
    ("make her scarf red", {"size": "medium"}, ("local", {})),
    ("she slowly turns to the sea", {"size": "medium"}, ("local", {})),
])
def test_the_passthrough_reads_camera_words_size_words_and_the_rest(text, camera, want):
    assert fe.reading_of(text, camera) == want


def test_an_answer_settles_the_passthroughs_reading():
    assert fe.reading_of("make the bottle bigger", {"size": "medium"}, "camera") == ("camera", {"size": "medium_close"})
    assert fe.reading_of("make the bottle bigger", {"size": "medium"}, "local") == ("local", {})
    assert fe.reading_of("make the bottle smaller", {"size": "medium"}, "both") == ("both", {"size": "medium_wide"})


def test_the_passthrough_never_sends_an_image_and_asks_with_no_default():
    out = PassthroughDirector().direct({"op": "frame_edit", "jobId": "j", "input": names.to_wire("frame_edit", edit_input("bigger please"))},
                                       load_sheet("runway"), images=[{"media_type": "image/png", "data": "x"}])
    assert out["question"]["kind"] == "ambiguity" and "recommended_option_id" not in out["question"]
    assert PassthroughDirector.sees_images is False


def test_the_passthrough_movement_only_answer_has_no_provider_job():
    out = PassthroughDirector().direct({"op": "frame_edit", "jobId": "j", "input": names.to_wire("frame_edit", edit_input("push in slowly"))},
                                       load_sheet("runway"))
    assert "providerJob" not in out and out["frameEdit"]["runAs"] == "none"


def test_every_camera_value_has_its_words():
    words = camera_words()
    for field, enum in (("size", "cameraSize"), ("angle", "cameraAngle"), ("movement", "cameraMovement"),
                        ("movement_speed", "movementSpeed")):
        assert set(words[field]) == set(COMMON[enum]["enum"]), field
        assert all(row["label"] and row["words"] for row in words[field].values())


# ── Redo: a new job on the earlier one ────────────────────────────────────────────────────────

def test_redo_is_a_new_frame_edit_job_with_the_earlier_one_as_parent():
    h = harness()
    dex(h, CAMERA, reply(camera={"angle": "aerial", "size": "extreme_wide"},
                         prompt="make it an aerial establishing shot, from the air: @maya_front on @beach_wide. The people, place and light of @current, not its framing."))
    token = h.as_person()
    first = post(h, token, edit_input())
    redo = post(h, token, edit_input("make it an aerial establishing shot"), parentIds=[first["jobId"]])
    assert redo["jobId"] != first["jobId"] and redo["state"] == "submitted"
    assert h.store.get_job(redo["jobId"])["_req"]["parentIds"] == [first["jobId"]]
    assert h.providers["runway"].ops == ["frame", "frame"]


# ── the local stack: the mock runs frame_edit end to end ──────────────────────────────────────

def test_the_local_stack_runs_frame_edit_on_the_mock(tmp_path, monkeypatch):
    import identity
    import local
    for var in ("NAPKIN_MODEL_API", "ANTHROPIC_API_KEY", "TOKEN_SECRET", "NAPKIN_LOCAL_TENANTS"):
        monkeypatch.delenv(var, raising=False)
    try:
        relay, blobs = local.build(8797, tmp_path)
        mock = relay.registry.get("mock").inner
        mock._delay = 0.0
        data = png(1344, 756)
        sha = "sha256:" + __import__("hashlib").sha256(data).hexdigest()
        blobs.put(f"in/{sha}", data, "image/png")
        frame = {"sha256": sha, "url": blobs.public_url(f"in/{sha}"), "mime": "image/png"}

        def run(text, **more):
            inp = {**edit_input(text, **more), "image": frame, "refs": []}
            inp["shot"]["refs"] = []
            inp["shot"]["action"] = "She runs along the beach."
            body = {**envelope("frame_edit", new_id("job")), "input": inp}
            status, job, _ = relay.http("POST", "/jobs", {"Content-Type": "application/json"}, json.dumps(body).encode())
            assert status == 200, job
            return job

        moved = run("push in slowly")
        assert moved["state"] == "completed" and moved["director"]["output"]["frameEdit"]["runAs"] == "none"
        redrawn = run(WORDS)
        assert redrawn["state"] == "submitted" and mock.requests[-1]["op"] == "frame"
        edited = run("make her scarf red", region=BOX)
        assert edited["state"] == "submitted" and mock.requests[-1]["op"] == "region_edit"
        time.sleep(1.1)  # the mock sheet's minPollS
        status, done, _ = relay.http("GET", f"/jobs/{redrawn['jobId']}", {}, None)
        assert status == 200 and done["state"] == "completed", done
        assert (done["outputs"][0]["w"], done["outputs"][0]["h"]) == (1344, 756)
    finally:
        identity.use_local(None)
