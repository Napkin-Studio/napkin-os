import json
from pathlib import Path

import httpx
import pytest

from providers import AssetRef, CapabilityMissing, ProviderError, ProviderJob, Ref, load_sheet
from providers.runway import RunwayProvider, min_poll_s

FIX = Path(__file__).parent / "fixtures" / "runway"
SHA = "sha256:" + "a" * 64
SHB = "sha256:" + "b" * 64
SHC = "sha256:" + "c" * 64
URL = {SHA: "https://cdn.test/a.png", SHB: "https://cdn.test/b.png", SHC: "https://cdn.test/c.mp4"}


def fixture(name: str) -> dict:
    return json.loads((FIX / f"{name}.json").read_text())


def resolve(sha):
    url = URL.get(sha, f"https://cdn.test/{sha[-8:]}.png")
    return AssetRef(sha, url, "video/mp4" if url.endswith(".mp4") else "image/png")


class Server:
    """A MockTransport that records requests and answers from a queue of canned responses."""

    def __init__(self):
        self.requests: list[httpx.Request] = []
        self.replies: list[httpx.Response] = []

    def reply(self, status=200, body=None, headers=None):
        self.replies.append(httpx.Response(status, json=body, headers=headers))

    def __call__(self, request):
        self.requests.append(request)
        return self.replies.pop(0) if self.replies else httpx.Response(200, json=fixture("create_response"))

    @property
    def body(self) -> dict:
        return json.loads(self.requests[-1].content)


@pytest.fixture
def server():
    return Server()


@pytest.fixture
def runway(server):
    return RunwayProvider("key_test", resolve, client=httpx.Client(transport=httpx.MockTransport(server)))


def job(op="generate", **kw):
    kw.setdefault("refs", [Ref(SHA, "hero", "character")])
    kw.setdefault("ratio", "1024:1024")
    return ProviderJob(op=op, provider="runway", model=kw.pop("model", "x"), prompt=kw.pop("prompt", "@hero on a beach"), **kw)


def test_request_carries_key_version_and_returns_the_task_id(runway, server):
    assert runway.submit(job()) == "task_abc123"
    req = server.requests[0]
    assert (req.method, str(req.url)) == ("POST", "https://api.dev.runwayml.com/v1/text_to_image")
    assert req.headers["Authorization"] == "Bearer key_test"
    assert req.headers["X-Runway-Version"] == "2024-11-06"
    assert len(server.requests) == 1  # submit never polls


@pytest.mark.parametrize("op", ["generate", "view", "frame"])
def test_image_ops_build_the_exact_body(runway, server, op):
    runway.submit(job(op, refs=[Ref(SHA, "hero", "character"), Ref(SHB, "prop_one", "object")],
                      prompt="@hero holds @prop_one", outputs=4))
    assert server.body == {
        "model": "gemini_image3_pro",
        "promptText": "@hero holds @prop_one",
        "ratio": "1024:1024",
        "outputCount": 4,
        "referenceImages": [
            {"uri": URL[SHA], "tag": "hero", "subject": "human"},
            {"uri": URL[SHB], "tag": "prop_one", "subject": "object"},
        ],
    }


def test_no_refs_sends_no_reference_images_and_one_output(runway, server):
    runway.submit(job(refs=[], prompt="a red fox"))
    assert server.body == {"model": "gemini_image3_pro", "promptText": "a red fox",
                           "ratio": "1024:1024", "outputCount": 1}


def test_region_edit_sends_current_and_marked_on_the_pro_model(runway, server):
    """The Gemini 3 Pro alternate takes no mask: the box drawn on a copy (features/image-editor.clan)."""
    runway.submit(job("region_edit", prompt="make the coat red", model="gemini_image3_pro",
                      refs=[Ref(SHA, "hero", "character"), Ref(SHB, "boxed", "marked"), Ref(SHC.replace("c", "d"), "clean", "current")]))
    body = server.body
    assert body["model"] == "gemini_image3_pro"
    assert [r["tag"] for r in body["referenceImages"]] == ["clean", "boxed", "hero"]
    assert [r["subject"] for r in body["referenceImages"]] == ["object", "object", "human"]
    assert body["promptText"].startswith("@clean is the clean image. @boxed is the same image with a box drawn on it.")
    assert body["promptText"].endswith("make the coat red")


def test_region_edit_needs_both_images(runway, server):
    with pytest.raises(CapabilityMissing):
        runway.submit(job("region_edit", model="gemini_image3_pro", refs=[Ref(SHB, "boxed", "marked")]))
    assert server.requests == []


def test_clip_builds_the_exact_body_with_audio_off(runway, server):
    runway.submit(job("clip", refs=[], first_frame=SHA, last_frame=SHB, duration_s=6, ratio="1280:720",
                      prompt="she walks away", negative="blur", seed=42))
    assert server.requests[0].url.path == "/v1/image_to_video"
    assert server.body == {
        "model": "veo3.1",
        "promptImage": [{"uri": URL[SHA], "position": "first"}, {"uri": URL[SHB], "position": "last"}],
        "promptText": "she walks away",
        "ratio": "1280:720",
        "audio": False,
        "duration": 6,
        "negativePrompt": "blur",
        "seed": 42,
    }


def test_audio_is_explicit_on_every_video_request_even_if_asked_for_sound(runway, server):
    runway.submit(job("clip", refs=[], first_frame=SHA, duration_s=4, ratio="1280:720", audio=True, prompt="she waves"))
    assert server.body["audio"] is False
    assert "audio" in server.body


def test_a_clip_with_no_first_frame_is_made_from_words_on_text_to_video(runway, server):
    """A clip straight from the script (ui-behaviour 3.5): the sheet's textEndpoint, no pictures."""
    runway.submit(job("clip", refs=[], duration_s=4, ratio="1280:720", prompt="a runner crests the cliff at dawn"))
    assert server.requests[0].url.path == "/v1/text_to_video"
    assert server.body == {"model": "veo3.1", "promptText": "a runner crests the cliff at dawn", "ratio": "1280:720",
                           "audio": False, "duration": 4}
    from provider_schemas import errors
    assert errors("runway", "POST /v1/text_to_video", server.body) == []


def test_a_clip_from_words_takes_no_pictures_and_needs_a_text_endpoint(server):
    runway = RunwayProvider("key_test", resolve, client=httpx.Client(transport=httpx.MockTransport(server)))
    with pytest.raises(CapabilityMissing):
        runway.submit(job("clip", duration_s=4, ratio="1280:720"))  # a character ref and no frame
    sheet = load_sheet("runway")
    del sheet["ops"]["clip"]["textEndpoint"]
    runway = RunwayProvider("key_test", resolve, client=httpx.Client(transport=httpx.MockTransport(server)), sheet=sheet)
    with pytest.raises(CapabilityMissing):
        runway.submit(job("clip", refs=[], duration_s=4, ratio="1280:720"))
    assert server.requests == []


def test_clip_needs_a_valid_duration(runway):
    with pytest.raises(CapabilityMissing):
        runway.submit(job("clip", refs=[], first_frame=SHA, duration_s=5, ratio="1280:720"))
    with pytest.raises(CapabilityMissing):
        runway.submit(job("clip", refs=[], first_frame=SHA, duration_s=4, ratio="1280:720", seed=2**32))


def test_clip_edit_builds_the_body_from_the_video_ref_and_keyframe(runway, server):
    runway.submit(job("clip_edit", refs=[Ref(SHA, "hero", "character"), Ref(SHC, "source", "current")],
                      prompt="warmer light", keyframe={"sha256": SHB, "atS": 1.5, "startS": 1, "endS": 3}, seed=9))
    assert server.requests[0].url.path == "/v1/video_to_video"
    assert server.body == {
        "model": "aleph2",
        "videoUri": URL[SHC],
        "promptText": "warmer light",
        "keyframes": [{"uri": URL[SHB], "seconds": 1.5, "range": {"start_seconds": 1, "end_seconds": 3}}],
        "seed": 9,
    }


def test_clip_edit_prompt_only_has_no_keyframes(runway, server):
    runway.submit(job("clip_edit", refs=[Ref(SHC, "source", "current")], prompt="make it feel like dusk"))
    assert server.body == {"model": "aleph2", "videoUri": URL[SHC], "promptText": "make it feel like dusk"}


def test_clip_edit_body_has_no_audio_field_because_aleph2_has_none(runway, server):
    runway.submit(job("clip_edit", refs=[Ref(SHC, "source", "current")], prompt="dusk", audio=True))
    assert "audio" not in server.body


@pytest.mark.parametrize("reply", [
    httpx.Response(200, text="<html>bad gateway</html>"),
    httpx.Response(200, json={}),
    httpx.Response(200, json=[1]),
])
def test_malformed_success_replies_become_provider_errors(runway, server, reply):
    server.replies += [reply, reply]
    with pytest.raises(ProviderError) as e:
        runway.submit(job())
    # a 2xx: Runway may have the task, so it must never be sent anywhere else
    assert (e.value.code, e.value.retryable, e.value.accepted) == ("provider_failed", False, True)
    with pytest.raises(ProviderError) as e:
        runway.status("task_1")
    assert e.value.retryable  # a garbled poll is asked again


def test_clip_edit_without_a_source_video_or_with_half_a_range_refuses(runway, server):
    with pytest.raises(CapabilityMissing):
        runway.submit(job("clip_edit", refs=[Ref(SHA, "hero", "character")]))
    with pytest.raises(ProviderError) as e:
        runway.submit(job("clip_edit", refs=[Ref(SHC, "source", "current")],
                          keyframe={"sha256": SHB, "atS": 1, "startS": 1}))
    assert e.value.code == "invalid_input"
    assert server.requests == []


def test_tags_are_rewritten_in_ref_order(runway, server):
    runway.submit(job(refs=[Ref(SHA, "hero", "character"), Ref(SHB, "villain", "character")],
                      prompt="@villain chases @hero, mail a@hero.com"))
    assert server.body["promptText"] == "@villain chases @hero, mail a@hero.com"
    assert [r["tag"] for r in server.body["referenceImages"]] == ["hero", "villain"]


def test_a_tag_not_among_the_refs_goes_as_words(runway, server):
    # Was invalid_input; the director's check still refuses a name in none of the job's refs (2026-10-09).
    runway.submit(job(prompt="@ghost walks"))
    assert server.body["promptText"].startswith("ghost walks")


def test_tag_syntax_comes_from_the_sheet(server):
    sheet = {**load_sheet("runway"), "tagSyntax": "none"}
    r = RunwayProvider("k", resolve, client=httpx.Client(transport=httpx.MockTransport(server)), sheet=sheet)
    r.submit(job(refs=[Ref(SHA, "hero", "character"), Ref(SHB, "villain", "character")], prompt="@villain and @hero"))
    assert server.body["promptText"] == "villain and hero"


@pytest.mark.parametrize("j", [
    job("region_edit", seed=1, refs=[Ref(SHA, "a_ref", "current"), Ref(SHB, "b_ref", "marked")]),  # no seed on images
    job(mask=SHA),
    job(angle={"horizontal": 90}),
    job(outputs=2),  # exactly 1 or 4
    job(outputs=5),
    job("stitch"),
    job(refs=[Ref(SHA, f"char_{i}", "character") for i in range(6)]),
    job(refs=[Ref(SHA, f"obj_{i:02d}", "object") for i in range(10)]),
    job(prompt="x" * 5501),
    job("clip", refs=[], first_frame=SHA, ratio="1280:720", prompt="x" * 1001),
    job("clip", first_frame=SHA, ratio="1280:720", duration_s=4),  # no first frame together with refs
])
def test_capability_refusal_makes_no_call(runway, server, j):
    with pytest.raises(CapabilityMissing):
        runway.submit(j)
    assert server.requests == []


def test_missing_ratio_is_invalid_input(runway):
    with pytest.raises(ProviderError) as e:
        runway.submit(job(ratio=None))
    assert e.value.code == "invalid_input"


# Errors on submit

def test_429_is_retryable_with_retry_after(runway, server):
    server.reply(429, {"error": "slow down"}, headers={"Retry-After": "12"})
    with pytest.raises(ProviderError) as e:
        runway.submit(job())
    assert (e.value.code, e.value.retryable, e.value.retry_after_s) == ("provider_unavailable", True, 12)
    assert e.value.to_dict()["retryAfterS"] == 12


def test_429_without_header_has_no_retry_after(runway, server):
    server.reply(429, {})
    with pytest.raises(ProviderError) as e:
        runway.submit(job())
    assert e.value.retryable and e.value.retry_after_s is None


@pytest.mark.parametrize("status", [500, 502, 503, 504])
def test_5xx_is_unavailable_and_retryable(runway, server, status):
    server.reply(status, {})
    with pytest.raises(ProviderError) as e:
        runway.submit(job())
    assert (e.value.code, e.value.retryable) == ("provider_unavailable", True)


def test_400_is_invalid_input_with_the_issue(runway, server):
    server.reply(400, fixture("error_400"))
    with pytest.raises(ProviderError) as e:
        runway.submit(job())
    assert (e.value.code, e.value.retryable) == ("invalid_input", False)
    assert "promptText" in e.value.message


@pytest.mark.parametrize("status", [401, 404])
def test_our_own_key_or_route_failing_is_provider_failed(runway, server, status):
    server.reply(status, {"error": "no"})
    with pytest.raises(ProviderError) as e:
        runway.submit(job())
    assert (e.value.code, e.value.retryable) == ("provider_failed", False)


def test_a_network_error_is_unavailable():
    def boom(request):
        raise httpx.ConnectError("down")

    r = RunwayProvider("k", resolve, client=httpx.Client(transport=httpx.MockTransport(boom)))
    with pytest.raises(ProviderError) as e:
        r.submit(job())
    assert (e.value.code, e.value.retryable) == ("provider_unavailable", True)


# status()

@pytest.mark.parametrize("name,state", [("task_pending", "queued"), ("task_throttled", "queued"),
                                        ("task_running", "running"), ("task_cancelled", "cancelled")])
def test_status_maps_states(runway, server, name, state):
    server.reply(200, fixture(name))
    s = runway.status("task_1")
    assert s.state == state and s.outputs == [] and s.error is None
    assert (server.requests[0].method, server.requests[0].url.path) == ("GET", "/v1/tasks/task_1")
    assert len(server.requests) == 1  # one call


def test_canceled_spelling_is_accepted(runway, server):
    server.reply(200, {"id": "t", "status": "CANCELED"})
    assert runway.status("t").state == "cancelled"


def test_status_done_has_outputs_and_cost(runway, server):
    server.reply(200, fixture("task_succeeded_image"))
    s = runway.status("task_1")
    assert s.state == "done" and s.kind == "generated" and s.cost_usd == 0.14
    assert [(o.mime, o.url.split("?")[0]) for o in s.outputs] == [
        ("image/png", "https://dnznrvs05pmza.cloudfront.net/a.png"),
        ("image/png", "https://dnznrvs05pmza.cloudfront.net/b.png")]


def test_status_done_video(runway, server):
    server.reply(200, fixture("task_succeeded_video"))
    s = runway.status("task_2")
    assert s.outputs[0].mime == "video/mp4" and s.cost_usd == 0.6


def test_unknown_task_status_is_provider_failed(runway, server):
    server.reply(200, {"id": "t", "status": "WEIRD"})
    st = runway.status("t")  # asking again cannot help: the job ends now, not at the relay's timeout
    assert (st.state, st.error.code, st.error.retryable) == ("failed", "provider_failed", False)


# (failureCode, error code, retryable)
FAILURES = [
    ("SAFETY.INPUT.TEXT", "moderated", False),
    ("SAFETY.INPUT.IMAGE", "moderated", False),
    ("SAFETY.OUTPUT.VIDEO", "moderated", False),
    ("SAFETY.OUTPUT.TEXT", "moderated", False),
    ("INPUT_PREPROCESSING.SAFETY.TEXT", "moderated", False),
    ("ASSET.INVALID", "invalid_input", False),
    ("INPUT_PREPROCESSING.INTERNAL", "provider_failed", True),
    ("INTERNAL", "provider_failed", True),
    ("INTERNAL.BAD_OUTPUT.CODE01", "provider_failed", False),
    ("THIRD_PARTY.UNAVAILABLE", "provider_unavailable", True),
    (None, "provider_failed", True),
    ("SOMETHING.NEW", "provider_failed", False),
]


@pytest.mark.parametrize("code,error,retryable", FAILURES)
def test_failure_codes(runway, server, code, error, retryable):
    server.reply(200, {**fixture("task_failed"), "failureCode": code})
    s = runway.status("task_1")
    assert s.state == "failed" and s.outputs == []
    assert (s.error.code, s.error.retryable, s.error.provider_code) == (error, retryable, code)
    assert s.cost_usd == 0.07  # failures, moderation included, are billed


def test_moderated_is_never_retryable_and_validates_as_an_error(runway, server):
    server.reply(200, {**fixture("task_failed"), "failureCode": "SAFETY.INPUT.TEXT"})
    err = runway.status("task_1").error
    assert err.code == "moderated" and err.retryable is False
    assert err.to_dict()["providerCode"] == "SAFETY.INPUT.TEXT"


def test_status_http_429_raises_with_retry_after(runway, server):
    server.reply(429, {}, headers={"Retry-After": "3"})
    with pytest.raises(ProviderError) as e:
        runway.status("task_1")
    assert e.value.retry_after_s == 3


# cancel()

def test_cancel_deletes_the_task(runway, server):
    server.reply(204)
    runway.cancel("task_1")
    assert (server.requests[0].method, server.requests[0].url.path) == ("DELETE", "/v1/tasks/task_1")


def test_cancel_404_is_fine(runway, server):
    server.reply(404, {"error": "not found"})
    runway.cancel("task_1")


def test_cancel_other_errors_raise(runway, server):
    server.reply(503, {})
    with pytest.raises(ProviderError):
        runway.cancel("task_1")


# Helpers

def test_min_poll_matches_the_sheet():
    assert min_poll_s() == 5 == load_sheet("runway")["results"]["minPollS"]


def test_organization_reads_tier_and_concurrency(runway, server):
    server.reply(200, fixture("organization"))
    org = runway.organization()
    assert server.requests[0].url.path == "/v1/organization"
    assert org["concurrency"] == {"gemini_image3.1_flash": 10, "veo3.1_fast": 10, "aleph2": None}
    assert org["tier"]["maxMonthlyCreditSpend"] == 2000000 and org["creditBalance"] == 98000
    # The tier's ceilings, for the cost model (contracts/cost-model.json tier).
    assert org["ceilings"] == {"maxMonthlyCreditSpend": 2000000, "maxDailyGenerations": {
        "gemini_image3.1_flash": 5000, "veo3.1_fast": 5000, "aleph2": None}}


# ── the sheet, not the adapter, holds the credit price and the prompt limits (features/runway-sheet-sync.clan)
def test_the_credit_price_and_prompt_limits_are_not_constants():
    import providers.runway as module
    assert not hasattr(module, "USD_PER_CREDIT") and not hasattr(module, "MAX_PROMPT")


def test_cost_is_credits_times_the_sheets_usd_per_credit(server):
    sheet = load_sheet("runway")
    sheet["usdPerCredit"] = 0.02
    r = RunwayProvider("k", resolve, client=httpx.Client(transport=httpx.MockTransport(server)), sheet=sheet)
    server.reply(200, fixture("task_succeeded_image"))
    assert r.status("task_1").cost_usd == 0.28  # 14 credits


@pytest.mark.parametrize("text,units", [("abc", 3), ("é", 1), ("😀", 2), ("a😀b", 4)])
def test_prompts_are_counted_in_utf16_code_units(text, units):
    from providers.types import utf16_units
    assert utf16_units(text) == units


def clip_with(prompt: str) -> ProviderJob:
    return job("clip", refs=[], first_frame=SHA, ratio="1280:720", prompt=prompt)


def test_a_clip_prompt_of_1000_units_passes(runway, server):
    runway.submit(clip_with("x" * 1000))
    assert len(server.body["promptText"]) == 1000


def test_a_prompt_over_the_limit_by_one_emoji_is_refused_by_us_not_runway(runway, server):
    # 999 units plus one emoji (2 units) is 1001: Runway would answer 400, so we refuse before the call.
    with pytest.raises(CapabilityMissing, match="at most 1000"):
        runway.submit(clip_with("x" * 999 + "😀"))
    assert server.requests == []


def test_the_prompt_limit_is_the_models_own(runway, server):
    runway.submit(job(prompt="@hero " + "x" * 5000))  # Gemini 3 Pro takes 5500
    with pytest.raises(CapabilityMissing, match="at most 5500"):
        runway.submit(job(prompt="@hero " + "x" * 5500))


def test_name_and_sheet():
    r = RunwayProvider("k", resolve)
    assert r.name == "runway" and r.capabilities()["provider"] == "runway"


# ── The Image editor's ops on Runway (features/image-editor.clan, ui-behaviour 3.12) ──

def _png(img) -> bytes:
    import io
    out = io.BytesIO()
    img.save(out, format="PNG")
    return out.getvalue()


def _data(png: bytes) -> str:
    import base64
    return "data:image/png;base64," + base64.b64encode(png).decode()


MASK = "sha256:" + "e" * 64
FRAME = "sha256:" + "f" * 64


@pytest.fixture
def editor(server):
    """Runway with a 40 x 20 frame and our white = change mask over its left half, as data URIs."""
    from PIL import Image, ImageDraw
    mask = Image.new("L", (40, 20), 0)
    ImageDraw.Draw(mask).rectangle((0, 0, 19, 19), fill=255)
    urls = {FRAME: _data(_png(Image.new("RGB", (40, 20), (10, 120, 200)))), MASK: _data(_png(mask))}

    def assets(sha):
        return AssetRef(sha, urls.get(sha) or resolve(sha).url, "image/png")
    return RunwayProvider("key_test", assets, client=httpx.Client(transport=httpx.MockTransport(server)))


def _mask_of(body):
    import base64
    import io
    from PIL import Image
    return Image.open(io.BytesIO(base64.b64decode(body["maskUri"].split(",", 1)[1]))).convert("L")


def test_fill_area_sends_the_mask_black_where_it_changes_on_ideogram(editor, server):
    """Fill area (3.12): ideogram_4_5 edits the mask's black and keeps its white (providers.md fact 2), so
    our white = change mask is inverted; the frame is the first reference and no ratio goes."""
    editor.submit(job("region_edit", model="ideogram_4_5", prompt="add condensation drops", ratio=None,
                      refs=[Ref(FRAME, "current", "current")], mask=MASK, region={"x": 0, "y": 0, "w": 0.5, "h": 1}))
    body = server.body
    assert server.requests[-1].url.path == "/v1/text_to_image"
    assert body["model"] == "ideogram_4_5" and body["promptText"] == "add condensation drops"
    assert body["referenceImages"][0]["uri"].startswith("data:image/png") and "ratio" not in body
    assert "preciseEdit" not in body
    m = _mask_of(body)
    assert m.size == (40, 20) and m.getpixel((5, 10)) == 0 and m.getpixel((35, 10)) == 255


def test_a_box_alone_becomes_a_black_box_mask_on_ideogram(editor, server):
    """The canvas region edit and Fix in the shot send a box only: the adapter makes the mask from it."""
    editor.submit(job("region_edit", model="ideogram_4_5", prompt="make the coat red", ratio=None,
                      refs=[Ref(FRAME, "current", "current")], region={"x": 0.5, "y": 0, "w": 0.5, "h": 1}))
    m = _mask_of(server.body)
    assert m.getpixel((35, 10)) == 0 and m.getpixel((5, 10)) == 255


def test_change_whole_frame_is_a_precise_edit_with_no_mask_and_no_ratio(editor, server):
    """Change whole frame (3.12): no region and no mask is ideogram's preciseEdit (fact 3)."""
    editor.submit(job("region_edit", model="ideogram_4_5", prompt="warmer light, keep the bottle", ratio="16:9",
                      refs=[Ref(FRAME, "current", "current")]))
    body = server.body
    assert body["preciseEdit"] is True and "maskUri" not in body and "ratio" not in body
    assert [r["uri"][:15] for r in body["referenceImages"]] == ["data:image/png;"]


def test_ideogram_names_no_reference_by_tag(editor, server):
    editor.submit(job("region_edit", model="ideogram_4_5", prompt="like @hero", ratio=None,
                      refs=[Ref(FRAME, "current", "current"), Ref(SHA, "hero", "character")]))
    assert "@" not in server.body["promptText"]
    assert len(server.body["referenceImages"]) == 2 and "tag" not in server.body["referenceImages"][1]


def test_upscale_sends_the_image_and_its_scale_to_magnific(runway, server):
    """Upscale (3.12, providers.md fact 7): image_upscale, 2x or 4x."""
    runway.submit(job("upscale", model="magnific_precision_upscaler_v2", prompt="upscale", ratio=None,
                      refs=[Ref(SHA, "current", "current")], scale=4))
    assert server.requests[-1].url.path == "/v1/image_upscale"
    assert server.body == {"model": "magnific_precision_upscaler_v2", "imageUri": URL[SHA], "scaleFactor": 4}


def test_upscale_defaults_to_2x_and_refuses_a_scale_magnific_lacks(runway, server):
    runway.submit(job("upscale", prompt="upscale", ratio=None, refs=[Ref(SHA, "current", "current")]))
    assert server.body["scaleFactor"] == 2
    with pytest.raises(CapabilityMissing):
        runway.submit(job("upscale", prompt="upscale", ratio=None, refs=[Ref(SHA, "current", "current")], scale=3))


def test_the_editor_bodies_match_runways_own_schemas(editor, runway, server):
    """Each body validates against the snapshot of Runway's request schema (tests/fixtures/schemas)."""
    from jsonschema import Draft202012Validator
    schemas = Path(__file__).parent / "fixtures" / "schemas" / "runway"
    editor.submit(job("region_edit", model="ideogram_4_5", prompt="drops", ratio=None,
                      refs=[Ref(FRAME, "current", "current")], mask=MASK))
    editor.submit(job("region_edit", model="ideogram_4_5", prompt="warmer", ratio=None,
                      refs=[Ref(FRAME, "current", "current")]))
    runway.submit(job("upscale", prompt="upscale", ratio=None, refs=[Ref(SHA, "current", "current")], scale=2))
    for req in server.requests:
        name = req.url.path.strip("/").replace("/", "__")
        schema = json.loads((schemas / f"{name}.json").read_text())["schema"]
        errors = list(Draft202012Validator(schema).iter_errors(json.loads(req.content)))
        assert not errors, (name, errors[0].message)


def test_change_whole_frame_on_the_gemini_alternate_sends_the_frame_and_the_words(editor, server):
    """An agency with Ideogram off: the whole-frame change runs on Gemini 3 Pro, at the frame's own shape."""
    editor.submit(job("region_edit", model="gemini_image3_pro", prompt="warmer light", ratio=None,
                      refs=[Ref(FRAME, "current", "current")]))
    body = server.body
    assert body["model"] == "gemini_image3_pro" and [r["tag"] for r in body["referenceImages"]] == ["current"]
    assert body["promptText"].endswith("warmer light") and "box" not in body["promptText"]
    assert body["ratio"] == "2752:1536"  # the Pro size nearest a 40 x 20 frame
