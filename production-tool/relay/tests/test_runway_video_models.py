"""Clips that carry characters, and edits with pictures (features/runway-video-models.clan).

Every body the adapter builds for the new clip and clip_edit models is checked against Runway's own
request schema (tests/fixtures/schemas/runway, from openapi.json), and the director keeps or drops a
clip's pictures by the model's sheet. Offline: a MockTransport stands in for Runway and a fake wire
for the model; the director replies here are canned for the test, not recorded from a model."""

from __future__ import annotations

import copy
import json
from pathlib import Path

import httpx
import pytest

from director import Director, DirectorError
from director.base import PassthroughDirector, fit_duration
from director.director import provider_ratio
from director.model import ModelPort, Reply
from names import to_wire
from provider_schemas import errors
from providers import AssetRef, CapabilityMissing, ProviderJob, Ref, load_sheet
from providers.runway import RunwayProvider, failure
from providers.types import effective_sheet, op_models

HERE = Path(__file__).parent
PROMPTS = HERE.parent / "prompts"
FRAME, LAST = "sha256:" + "f" * 64, "sha256:" + "e" * 64
BABY, BABY_SIDE, HAT = "sha256:" + "1" * 64, "sha256:" + "2" * 64, "sha256:" + "3" * 64
CLIP = "sha256:" + "c" * 64
URL = {FRAME: "https://cdn.test/frame.png", LAST: "https://cdn.test/last.png", BABY: "https://cdn.test/baby.png",
       BABY_SIDE: "https://cdn.test/baby_side.png", HAT: "https://cdn.test/hat.png", CLIP: "https://cdn.test/clip.mp4"}
SHEET = load_sheet("runway")
CLIP_MODELS = op_models(SHEET, "clip")
EDIT_MODELS = op_models(SHEET, "clip_edit")
NEW_CLIP = ["klingO3_pro", "klingO3_standard", "kling3.0_pro", "kling3.0_standard", "hailuo3",
            "gemini_omni_flash_1.1", "wan3", "seedance2_5", "seedance2_fast"]
STYLISED = "Stylised characters only: Seedance refuses photoreal faces"


def resolve(sha):
    url = URL.get(sha, f"https://cdn.test/{sha[-8:]}.png")
    return AssetRef(sha, url, "video/mp4" if url.endswith(".mp4") else "image/png")


class Server:
    def __init__(self):
        self.requests: list[httpx.Request] = []

    def __call__(self, request):
        self.requests.append(request)
        return httpx.Response(200, json={"id": "task_1"})

    @property
    def body(self) -> dict:
        return json.loads(self.requests[-1].content)

    @property
    def path(self) -> str:
        return self.requests[-1].url.path


@pytest.fixture
def server():
    return Server()


@pytest.fixture
def runway(server):
    return RunwayProvider("key_test", resolve, client=httpx.Client(transport=httpx.MockTransport(server)))


def spec(op: str, model: str) -> dict:
    return effective_sheet(SHEET, op, model)["ops"][op]


def clip(model: str, refs=(), first=FRAME, last=None, ratio="16:9", seconds=6, **kw) -> ProviderJob:
    """A clip as the director would send it to `model`: its own size and an allowed length."""
    return ProviderJob(op="clip", provider="runway", model=model, prompt=kw.pop("prompt", "the baby claps"),
                       refs=list(refs), first_frame=first, last_frame=last,
                       ratio=provider_ratio("runway", "clip", ratio, model),
                       duration_s=fit_duration(seconds, spec("clip", model)), audio=False, **kw)


def valid(server: Server) -> list[str]:
    return errors("runway", "POST " + server.path, server.body)


REFS = [Ref(BABY, "baby_front", "character"), Ref(BABY_SIDE, "baby_side", "character")]


# ── the menu's facts ───────────────────────────────────────────────────────
def test_the_clip_and_edit_menus_offer_the_new_models_after_veo():
    assert CLIP_MODELS == ["veo3.1", "veo3.1_fast", *NEW_CLIP]
    assert EDIT_MODELS == ["aleph2", "klingO3_pro", "klingO3_standard", "gemini_omni_flash_1.1", "seedance2_5"]
    for op in ("clip", "clip_edit"):
        for a in SHEET["ops"][op]["alternates"]:
            assert a["label"] and a.get("note"), a["model"]
            assert not any(ch.isdigit() and "credit" in a["note"].lower() for ch in a["note"]), a["note"]
            assert "$" not in a["note"] and "credit" not in a["note"].lower()


def test_seedance_says_plainly_it_refuses_photoreal_faces():
    for op in ("clip", "clip_edit"):
        for a in SHEET["ops"][op]["alternates"]:
            if a["model"].startswith("seedance"):
                assert a["note"] == STYLISED


# ── clip bodies, against Runway's schema ───────────────────────────────────
@pytest.mark.parametrize("model", CLIP_MODELS)
def test_a_clip_from_its_frame_is_a_valid_body_for_every_model(runway, server, model):
    runway.submit(clip(model))
    assert server.path == "/v1/image_to_video"
    assert server.body["promptImage"] == [{"uri": URL[FRAME], "position": "first"}]
    assert "references" not in server.body
    assert valid(server) == []


@pytest.mark.parametrize("model", [m for m in CLIP_MODELS if effective_sheet(SHEET, "clip", m)["video"]["lastFrame"]])
def test_a_clip_from_a_first_and_last_frame_is_valid(runway, server, model):
    runway.submit(clip(model, last=LAST))
    assert [p["position"] for p in server.body["promptImage"]] == ["first", "last"]
    assert valid(server) == []


@pytest.mark.parametrize("model", CLIP_MODELS)
def test_a_clip_from_words_alone_is_valid_on_the_text_endpoint(runway, server, model):
    runway.submit(clip(model, first=None, prompt="a baby in a high chair grabs cereal"))
    assert server.path == "/v1/text_to_video" and "promptImage" not in server.body
    assert valid(server) == []


@pytest.mark.parametrize("model", CLIP_MODELS)
def test_refs_with_no_frame_go_only_where_the_model_takes_them(runway, server, model):
    """The owner's baby, 2026-10-15: a clip with no frame carries the character's pictures on Hailuo 3,
    Omni Flash 1.1, WAN 3 and Seedance; Veo and Kling take none there."""
    job = clip(model, refs=REFS, first=None, prompt="@baby_front grabs cereal in a sunlit kitchen")
    if effective_sheet(SHEET, "clip", model)["video"].get("refsWithoutFrame"):
        runway.submit(job)
        assert server.path == "/v1/text_to_video"
        assert server.body["references"] == [{"uri": URL[BABY]}, {"uri": URL[BABY_SIDE]}]
        assert valid(server) == []
    else:
        with pytest.raises(CapabilityMissing):
            runway.submit(job)
        assert server.requests == []


@pytest.mark.parametrize("model", CLIP_MODELS)
def test_refs_with_a_frame_go_only_on_kling_o3(runway, server, model):
    job = clip(model, refs=REFS)
    if model.startswith("klingO3"):
        runway.submit(job)
        assert server.body["promptImage"] == [{"uri": URL[FRAME], "position": "first"}]
        assert server.body["references"] == [{"uri": URL[BABY]}, {"uri": URL[BABY_SIDE]}]
        assert valid(server) == []
    else:
        with pytest.raises(CapabilityMissing):
            runway.submit(job)


def test_kling_o3_frame_and_refs_is_the_body_the_paid_test_proved(runway, server):
    """2026-10-15 q1: references are objects; a bare string array was a 400."""
    runway.submit(clip("klingO3_standard", refs=REFS, seconds=3, prompt="@baby_front claps. Keep @baby_front exactly."))
    assert server.body == {
        "model": "klingO3_standard",
        "promptImage": [{"uri": URL[FRAME], "position": "first"}],
        "references": [{"uri": URL[BABY]}, {"uri": URL[BABY_SIDE]}],
        "promptText": "baby front claps. Keep baby front exactly.",
        "ratio": "1280:720",
        "audio": False,
        "duration": 3,
    }


def test_kling_o3_takes_seven_pictures_in_all_frames_included(runway, server):
    six = [Ref("sha256:" + f"{i}" * 64, f"pic_{i:02d}", "character") for i in range(1, 7)]
    runway.submit(clip("klingO3_pro", refs=six))  # 1 + 6
    with pytest.raises(CapabilityMissing, match="7 pictures"):
        runway.submit(clip("klingO3_pro", refs=six, last=LAST))  # 2 + 6
    assert len(server.requests) == 1


def test_hailuo_from_refs_sends_its_resolution_and_aspect_and_no_audio(runway, server):
    runway.submit(clip("hailuo3", refs=REFS, first=None, seconds=5, prompt="@baby_front in a kitchen"))
    assert server.body == {"model": "hailuo3", "references": [{"uri": URL[BABY]}, {"uri": URL[BABY_SIDE]}],
                           "promptText": "baby front in a kitchen", "ratio": "16:9", "resolution": "768p", "duration": 5}


def test_omni_flash_from_refs_takes_a_pixel_size_and_no_audio(runway, server):
    runway.submit(clip("gemini_omni_flash_1.1", refs=REFS[:1], first=None, seconds=3, prompt="@baby_front smiles"))
    assert server.body == {"model": "gemini_omni_flash_1.1", "references": [{"uri": URL[BABY]}],
                           "promptText": "baby front smiles", "ratio": "1280:720", "duration": 3}


def test_wan3_with_a_frame_sends_an_auto_ratio_of_the_asked_tier(runway, server):
    runway.submit(clip("wan3"))
    assert server.body["ratio"] == "auto_720p" and server.body["audio"] is False
    runway.submit(clip("wan3", first=None, refs=REFS))
    assert server.body["ratio"] == "1280:720"


def test_seed_goes_only_to_models_that_take_one(runway, server):
    runway.submit(clip("seedance2_5", seed=7))
    assert server.body["seed"] == 7 and valid(server) == []
    runway.submit(clip("klingO3_pro", seed=7))
    assert "seed" not in server.body and valid(server) == []
    runway.submit(clip("veo3.1", seed=7, negative="blur"))
    assert server.body["seed"] == 7 and server.body["negativePrompt"] == "blur"
    runway.submit(clip("hailuo3", negative="blur"))
    assert "negativePrompt" not in server.body and valid(server) == []


@pytest.mark.parametrize("model,seconds", [("hailuo3", 4), ("gemini_omni_flash_1.1", 11), ("klingO3_pro", 16), ("seedance2_fast", 16)])
def test_a_length_outside_the_models_range_is_refused_before_runway(runway, server, model, seconds):
    with pytest.raises(CapabilityMissing):
        runway.submit(ProviderJob(op="clip", provider="runway", model=model, prompt="x", first_frame=FRAME,
                                  ratio=provider_ratio("runway", "clip", "16:9", model), duration_s=seconds))
    assert server.requests == []


def test_the_director_fits_each_models_lengths():
    assert fit_duration(4, spec("clip", "hailuo3")) == 5
    assert fit_duration(12, spec("clip", "gemini_omni_flash_1.1")) == 10
    assert fit_duration(2.5, spec("clip", "klingO3_pro")) == 3
    assert fit_duration(5, spec("clip", "veo3.1_fast")) == 6


@pytest.mark.parametrize("model,ratio,want", [
    ("veo3.1", "16:9", "1280:720"), ("klingO3_pro", "16:9", "1920:1080"), ("klingO3_standard", "9:16", "720:1280"),
    ("hailuo3", "16:9", "16:9"), ("hailuo3", "4:5", "3:4"), ("gemini_omni_flash_1.1", "9:16", "720:1280"),
    ("wan3", "1:1", "960:960"), ("seedance2_5", "16:9", "1280:720"), ("seedance2_fast", "4:3", "1112:834"),
])
def test_each_model_gets_its_own_size(model, ratio, want):
    assert provider_ratio("runway", "clip", ratio, model) == want


# ── clip_edit bodies ───────────────────────────────────────────────────────
def edit(model: str, pictures=(), **kw) -> ProviderJob:
    refs = [Ref(CLIP, "current", "current"), *pictures]
    return ProviderJob(op="clip_edit", provider="runway", model=model, prompt=kw.pop("prompt", "put @hat_front on her head"),
                       refs=refs, audio=False, **kw)


HAT_REF = Ref(HAT, "hat_front", "object")


def test_kling_o3_edits_with_pictures_and_keeps_the_clips_sound(runway, server):
    runway.submit(edit("klingO3_standard", [HAT_REF]))
    assert server.body == {"model": "klingO3_standard", "promptVideo": URL[CLIP], "promptText": "put hat front on her head",
                           "references": [{"uri": URL[HAT]}], "providerSettings": {"keepOriginalSound": True}}
    assert valid(server) == []


def test_omni_flash_edits_in_edit_mode(runway, server):
    runway.submit(edit("gemini_omni_flash_1.1", [HAT_REF]))
    assert server.body == {"model": "gemini_omni_flash_1.1", "videoUri": URL[CLIP], "promptText": "put hat front on her head",
                           "references": [{"uri": URL[HAT]}], "mode": "edit"}
    assert valid(server) == []


def test_seedance_edits_in_edit_mode_at_the_clips_own_length(runway, server):
    runway.submit(edit("seedance2_5", [HAT_REF], seed=3))
    assert server.body == {"model": "seedance2_5", "promptVideo": URL[CLIP], "promptText": "put hat front on her head",
                           "references": [{"uri": URL[HAT]}], "mode": "edit", "duration": "auto", "audio": False, "seed": 3}
    assert valid(server) == []


@pytest.mark.parametrize("model", ["aleph2", "klingO3_pro", "gemini_omni_flash_1.1", "seedance2_5"])
def test_a_words_only_edit_is_valid_on_every_edit_model(runway, server, model):
    runway.submit(edit(model, prompt="make it dusk"))
    assert server.path == "/v1/video_to_video" and "references" not in server.body
    assert valid(server) == []


def test_aleph2_takes_no_pictures_so_their_names_are_said_in_words(runway, server):
    runway.submit(edit("aleph2", [HAT_REF]))
    assert server.body == {"model": "aleph2", "videoUri": URL[CLIP], "promptText": "put hat front on her head"}


def test_an_edit_past_the_models_pictures_or_with_a_keyframe_it_cannot_take_is_refused(runway, server):
    five = [Ref("sha256:" + f"{i}" * 64, f"pic_{i:02d}", "object") for i in range(1, 6)]
    with pytest.raises(CapabilityMissing):
        runway.submit(edit("klingO3_pro", five))
    with pytest.raises(CapabilityMissing):
        runway.submit(edit("gemini_omni_flash_1.1", keyframe={"sha256": FRAME, "atS": 1}))
    assert server.requests == []


# ── moderation ─────────────────────────────────────────────────────────────
@pytest.mark.parametrize("code", ["INPUT_PREPROCESSING.SAFETY.THIRD_PARTY", "INPUT_PREPROCESSING.SAFETY.IMAGE", "SAFETY.INPUT.IMAGE"])
def test_every_safety_refusal_is_a_moderated_failure_never_retried(code):
    """A Seedance photoreal refusal must come back as a clear failure (the relay ends the job moderated)."""
    error, moderated = failure(code, "Refused")
    assert (error.code, error.retryable, moderated, error.source) == ("moderated", False, True, "input")


# ── the director: which pictures a clip carries ────────────────────────────
class FakeWire:
    api = "anthropic"

    def __init__(self, reply):
        self.reply = reply

    def send(self, **kw):
        return Reply(json.dumps(self.reply), "ok", (100, 50))


def clip_input(image: bool) -> dict:
    asset = lambda sha: {"sha256": sha, "url": f"https://hack.napkin.ie/in/{sha}", "mime": "image/png"}
    inp = {"shot": {"id": "shot_01K6XB000000000000000000A1", "kind": "shot", "duration_s": 5,
                    "camera": {"size": "medium", "movement": "static"},
                    "action": "@baby grabs a handful of cereal and smiles.", "refs": ["baby"]},
           "ratio": "16:9",
           "refs": [{"id": "ref_01K6XA6Z0000000000000010VW", "name": "baby_front", "role": "character",
                     "kind": "generated", "asset": asset(BABY)}]}
    if image:
        inp["image"] = asset(FRAME)
    return to_wire("clip", inp)


def canned(model: str, image: bool, refs: bool) -> dict:
    job = {"provider": "runway", "model": model, "durationS": 5, "audio": False, "ratio": "16:9",
           "prompt": "@baby_front grabs a handful of cereal from the tray and smiles. The camera holds still.",
           "refs": [{"sha256": BABY, "name": "baby_front", "role": "character"}] if refs else []}
    if image:
        job["firstFrame"] = FRAME
    return {"op": "clip", "providerJob": job, "question": None, "rationale": "canned", "confidence": 0.8}


def direct(model: str, image: bool, refs: bool = True) -> dict:
    sheet = effective_sheet(SHEET, "clip", model)
    d = Director(ModelPort(FakeWire(canned(model, image, refs)), "claude-haiku-4-5", timeout=5), PROMPTS,
                 {"runway": sheet}, prompt_version="director.v9")
    return d.run("clip", clip_input(image), "runway").output["providerJob"]


@pytest.mark.parametrize("model", ["hailuo3", "gemini_omni_flash_1.1", "wan3", "seedance2_5"])
def test_a_clip_with_no_frame_keeps_its_character_pictures_on_a_ref_model(model):
    job = direct(model, image=False)
    assert [r["name"] for r in job["refs"]] == ["baby_front"] and "firstFrame" not in job
    assert "@baby_front" in job["prompt"]


@pytest.mark.parametrize("model", ["hailuo3", "wan3"])
def test_a_ref_model_clip_with_no_frame_that_leaves_out_the_character_is_refused(model):
    with pytest.raises(DirectorError, match="left out @baby_front"):
        direct(model, image=False, refs=False)


@pytest.mark.parametrize("model", ["veo3.1", "veo3.1_fast", "klingO3_pro", "kling3.0_standard"])
def test_a_clip_with_no_frame_on_a_words_only_model_says_the_character_in_words(model):
    job = direct(model, image=False)
    assert job["refs"] == [] and "@baby_front" not in job["prompt"] and "baby" in job["prompt"]


def test_kling_o3_keeps_the_frame_and_the_character_pictures():
    job = direct("klingO3_standard", image=True)
    assert job["firstFrame"] == FRAME and [r["name"] for r in job["refs"]] == ["baby_front"]
    assert job["ratio"] == "1280:720" and job["durationS"] == 5


@pytest.mark.parametrize("model", ["veo3.1", "kling3.0_pro", "hailuo3", "seedance2_fast"])
def test_a_frame_on_any_other_model_goes_alone_as_before(model):
    job = direct(model, image=True)
    assert job["firstFrame"] == FRAME and job["refs"] == []


@pytest.mark.parametrize("model,refs", [("hailuo3", ["baby_front"]), ("wan3", ["baby_front"]), ("veo3.1", []), ("kling3.0_pro", [])])
def test_the_passthrough_sends_the_same_pictures(model, refs):
    sheet = effective_sheet(SHEET, "clip", model)
    out = PassthroughDirector().direct({"op": "clip", "input": clip_input(False), "jobId": "job_1"}, sheet)
    assert [r["name"] for r in out["providerJob"]["refs"]] == refs


def test_v9_is_v8_with_the_clip_and_edit_rules():
    d = Director(None, PROMPTS, {}, prompt_version="director.v9")
    text = d.system_for("clip")
    assert "refsWithoutFrame" in text and "firstFrameWithRefs" in text
    assert "Kling O3" in d.system_for("clip_edit")


# ── the estimate: pictures and sizes are priced ────────────────────────────
def test_the_reservation_prices_each_picture_a_hailuo_clip_carries():
    from contracts_dir import pricing
    from service import Relay as Service
    sheet = effective_sheet(SHEET, "clip", "hailuo3")
    inp = {"shot": {"duration_s": 5}, "refs": [{}, {}]}
    settings = Service._settings("clip", sheet["ops"]["clip"], sheet, inp)
    assert settings == {"refs": 2, "durationS": 5}
    assert pricing().op_usd(sheet, "clip", None, settings) == 0.54  # 5 s x 10 + 2 x 2 credits
    with_frame = Service._settings("clip", sheet["ops"]["clip"], sheet, {**inp, "image": {"sha256": FRAME}})
    assert with_frame["refs"] == 1  # the frame alone: Hailuo takes no refs beside it
    seed = effective_sheet(SHEET, "clip", "seedance2_5")
    assert pricing().op_usd(seed, "clip", None, Service._settings("clip", seed["ops"]["clip"], seed, {"shot": {"duration_s": 2}})) == 1.2  # 4 s at least
