import base64
import io
import json
from pathlib import Path

import httpx
import pytest
from jsonschema import Draft202012Validator, FormatChecker
from PIL import Image
from referencing import Registry, Resource

from providers import AssetRef, CapabilityMissing, ProviderError, ProviderJob, Ref, load_sheet
from providers.types import CONTRACTS
from providers.fal import MASK_POLARITY, SAM2, WAN, FalProvider, queue_app

FIXTURES = Path(__file__).parent / "fixtures" / "fal"
BASE = "https://napkin.ie/production-tool/contracts/"
KEY = "test-key"

HERO, FRONT, SIDE, FRAME, MASK, VIDEO = ("sha256:" + c * 64 for c in "123456")
KLING_IMAGE = "fal-ai/kling-image/o3/image-to-image"
KLING_VIDEO = "fal-ai/kling-video/v3/pro/image-to-video"
LUMA = "luma/agent/ray/v3.2/video-to-video"
IDEOGRAM = "ideogram/v4.5/edit"
QWEN = "fal-ai/qwen-image-edit-2511-multiple-angles"


def fixture(name: str) -> dict:
    return json.loads((FIXTURES / name).read_text())


def _png(size=(64, 48), left_white=True) -> bytes:
    """A mask: the left half white (our "change"), the right half black."""
    img = Image.new("L", size, 0)
    img.paste(255 if left_white else 0, (0, 0, size[0] // 2, size[1]))
    out = io.BytesIO()
    img.save(out, format="PNG")
    return out.getvalue()


def _decode(uri: str) -> Image.Image:
    assert uri.startswith("data:image/png;base64,")
    return Image.open(io.BytesIO(base64.b64decode(uri.split(",", 1)[1])))


def resolver(sha: str) -> AssetRef:
    return AssetRef(sha, f"https://cdn.test/{sha[7:11]}", "video/mp4" if sha == VIDEO else "image/png")


class Fal:
    """A fake fal queue and CloudFront. `routes` maps (method, path) to a response."""

    def __init__(self, **files: bytes):
        self.requests: list[httpx.Request] = []
        self.routes: dict[tuple[str, str], httpx.Response] = {}
        self.files = {"/" + k: v for k, v in files.items()}
        self.n = 0

    def on(self, method: str, path: str, status: int, body):
        self.routes[(method, "/" + path)] = httpx.Response(status, json=body)

    def __call__(self, request: httpx.Request) -> httpx.Response:
        self.requests.append(request)
        if request.url.host == "cdn.test":
            return httpx.Response(200, content=self.files[request.url.path])
        route = self.routes.get((request.method, request.url.path))
        if route is not None:
            return route
        assert request.method == "POST", f"unexpected {request.method} {request.url.path}"
        self.n += 1
        # Like fal: the queue URLs sit under the base app (owner/app), never the endpoint's sub-path.
        rid, app = f"req{self.n}", "/".join(request.url.path.strip("/").split("/")[:2])
        base = f"https://queue.fal.run/{app}/requests/{rid}"
        return httpx.Response(200, json={**fixture("submit.json"), "request_id": rid, "status_url": f"{base}/status",
                                         "response_url": base, "cancel_url": f"{base}/cancel"})

    @property
    def fal_requests(self):
        return [r for r in self.requests if r.url.host == "queue.fal.run"]

    def body(self, i=-1) -> dict:
        return json.loads(self.fal_requests[i].content)


@pytest.fixture
def fal():
    # the source frame and the mask are the same size; "7777" is a source of another size
    return Fal(**{HERO[7:11]: _png(), MASK[7:11]: _png(), "7777": _png((32, 32))})


@pytest.fixture
def provider(fal):
    return FalProvider(KEY, resolver, client=httpx.Client(transport=httpx.MockTransport(fal)))


def job(op="generate", **kw):
    # Image steps default to Nano Banana Pro (features/default-models.clan); these tests are Kling's.
    model = kw.pop("model", "kling-image-o3" if op in ("generate", "frame") else "m")
    return ProviderJob(op=op, provider="fal", model=model, prompt=kw.pop("prompt", "a fox"),
                       refs=kw.pop("refs", [Ref(HERO, "hero", "character")]), **kw)


def element_refs():
    return [Ref(FRONT, "hero", "element_front"), Ref(SIDE, "hero_side", "element_angle")]


def test_sheet_matches_schema():
    schemas = {p.name: json.loads(p.read_text()) for p in CONTRACTS.glob("*.schema.json")}
    registry = Registry().with_resources((BASE + n, Resource.from_contents(s)) for n, s in schemas.items())
    v = Draft202012Validator(schemas["capabilities.schema.json"], registry=registry, format_checker=FormatChecker())
    assert not list(v.iter_errors(load_sheet("fal")))


def test_submit_returns_the_id_and_makes_one_call(provider, fal):
    rid = provider.submit(job())
    assert rid == f"{KLING_IMAGE}>fal-ai/kling-image:req1"
    assert [(r.method, r.url.path) for r in fal.fal_requests] == [("POST", f"/{KLING_IMAGE}")]


def test_every_fal_call_carries_the_key_and_disables_fallback(provider, fal):
    rid = provider.submit(job(op="region_edit", mask=MASK, refs=[Ref(HERO, "marked", "current")]))
    fal.on("GET", f"{queue_app(IDEOGRAM)}/requests/req1/status", 200, fixture("status_in_progress.json"))
    provider.status(rid)
    fal.on("PUT", f"{queue_app(IDEOGRAM)}/requests/req1/cancel", 202, {"status": "CANCELLATION_REQUESTED"})
    provider.cancel(rid)
    assert len(fal.fal_requests) == 3
    for r in fal.fal_requests:
        assert r.headers["authorization"] == f"Key {KEY}"
        assert r.headers["x-app-fal-disable-fallback"] == "true"
    # our own assets are fetched without the key
    assert all("authorization" not in r.headers for r in fal.requests if r.url.host == "cdn.test")


# --- request bodies ---

def test_generate_body_rewrites_tags_to_image_and_element(provider, fal):
    refs = [Ref(HERO, "hero", "character"), Ref(FRAME, "scene", "frame"), *[
        Ref(FRONT, "lead", "element_front"), Ref(SIDE, "lead_side", "element_angle")]]
    provider.submit(job(prompt="@hero meets @scene, @lead waves", refs=refs, ratio="16:9", outputs=3))
    body = fal.body()
    assert body["prompt"] == "@Image1 meets @Image2, @Element1 waves"
    assert body["image_urls"] == ["https://cdn.test/1111", "https://cdn.test/4444"]
    assert body["elements"] == [{"frontal_image_url": "https://cdn.test/2222",
                                 "reference_image_urls": ["https://cdn.test/3333"]}]
    assert (body["aspect_ratio"], body["result_type"], body["num_images"]) == ("16:9", "single", 3)
    assert "seed" not in body


def test_frame_with_several_outputs_is_a_series(provider, fal):
    provider.submit(job(op="frame", outputs=4))
    body = fal.body()
    assert (body["result_type"], body["series_amount"]) == ("series", 4)
    assert "num_images" not in body


def test_a_name_the_request_does_not_send_goes_as_words(provider, fal):
    # Was: an unknown tag failed the job as invalid_input. The director's check still refuses a name
    # that is in none of the job's refs (and falls back to the passthrough); here at the endpoint, a
    # name it cannot send is said in words instead (2026-10-09).
    provider.submit(job(prompt="@ghost walks"))
    assert "ghost walks" in fal.body()["prompt"] and "@ghost" not in fal.body()["prompt"]


def test_a_region_edit_says_the_edited_image_in_words(provider, fal):
    # 2026-10-09: "@current is not one of the refs [...]": the edited image goes as image_url, not a ref.
    provider.submit(job(op="region_edit", prompt="the samurai in @current holds @style", mask=MASK,
                        refs=[Ref(HERO, "current", "current"), Ref(FRAME, "style", "object")]))
    assert fal.body()["prompt"] == "the samurai in the image holds style"


def test_image_op_without_an_image_ref_is_refused(provider, fal):
    # No picture at all. (Element refs alone now go as images: see the test at the end.)
    with pytest.raises(CapabilityMissing):
        provider.submit(job(refs=[]))
    assert fal.fal_requests == []


def test_view_sends_float_angles(provider, fal):
    provider.submit(job(op="view", angle={"horizontal": 90, "vertical": 15}, prompt="clean studio light"))
    body = fal.body()
    assert fal.fal_requests[-1].url.path == f"/{QWEN}"
    assert body["horizontal_angle"] == 90.0 and isinstance(body["horizontal_angle"], float)
    assert body["vertical_angle"] == 15.0
    assert body["image_urls"] == ["https://cdn.test/1111"]
    assert body["additional_prompt"] == "clean studio light"


def test_view_and_region_edit_name_refs_by_their_bare_name(provider, fal):
    provider.submit(job(op="view", angle={"horizontal": 90}, prompt="@hero in soft light"))
    assert fal.body()["additional_prompt"] == "hero in soft light"
    provider.submit(job(op="region_edit", prompt="@style on the coat", mask=MASK,
                        refs=[Ref(HERO, "marked", "current"), Ref(FRAME, "style", "object")]))
    assert fal.body()["prompt"] == "style on the coat"


def test_a_view_says_a_name_it_does_not_send_in_words(provider, fal):
    # 2026-10-09: the director's words named the whole character (@hero_key) and another picture;
    # only the source goes to the view, so each failed the job as an unknown tag.
    provider.submit(job(op="view", angle={"horizontal": 90}, prompt="@hero from the side, coat like @style_coat"))
    assert fal.body()["additional_prompt"] == "hero from the side, coat like style coat"


def test_per_endpoint_output_limits_are_refused_before_any_call(provider, fal):
    with pytest.raises(CapabilityMissing):
        provider.submit(job(op="view", angle={"horizontal": 90}, outputs=5))
    with pytest.raises(CapabilityMissing):
        provider.submit(job(op="region_edit", mask=MASK, outputs=9, refs=[Ref(HERO, "marked", "current")]))
    assert fal.requests == []
    provider.submit(job(op="view", angle={"horizontal": 90}, outputs=4))
    assert fal.body()["num_images"] == 4


def test_view_needs_an_angle(provider):
    with pytest.raises(ProviderError) as e:
        provider.submit(job(op="view"))
    assert e.value.code == "invalid_input"


def test_clip_body_sends_string_duration_and_audio_false(provider, fal):
    provider.submit(job(op="clip", prompt="@hero runs", refs=element_refs(), first_frame=FRAME,
                        last_frame=HERO, duration_s=5, audio=False, negative="blur"))
    body = fal.body()
    assert fal.fal_requests[-1].url.path == f"/{KLING_VIDEO}"
    assert body["duration"] == "5"
    assert body["generate_audio"] is False
    assert body["prompt"] == "@Element1 runs"
    assert body["start_image_url"] == "https://cdn.test/4444" and body["end_image_url"] == "https://cdn.test/1111"
    assert body["elements"][0]["reference_image_urls"] == ["https://cdn.test/3333"]
    assert body["negative_prompt"] == "blur"
    assert "multi_prompt" not in body


def test_clip_leaves_out_a_picture_that_is_not_an_element(provider, fal):
    """2026-10-08: a shot with @uberto (front and views) and @watchy (front only) was refused whole:
    Kling video takes pictures only as elements. The start frame shows watchy; the clip goes."""
    refs = element_refs() + [Ref(SIDE, "watchy_front", "character")]
    provider.submit(job(op="clip", prompt="@hero meets @watchy_front", refs=refs, first_frame=FRAME))
    body = fal.body()
    assert body["prompt"] == "@Element1 meets watchy"
    assert len(body["elements"]) == 1 and "image_urls" not in body


def test_clip_sets_audio_false_even_when_the_job_does_not_say(provider, fal):
    provider.submit(job(op="clip", refs=[], first_frame=FRAME))
    assert fal.body()["generate_audio"] is False


def test_clip_multi_shot_splits_on_dashes_and_the_durations_add_up(provider, fal):
    provider.submit(job(op="clip", prompt="@hero opens the door\n---\n@hero steps out\n---\nwide shot",
                        refs=element_refs(), first_frame=FRAME, duration_s=10))
    body = fal.body()
    # The top-level duration defaults to "5" on fal, so it says the shots' sum (docs checked 2026-10-07).
    assert "prompt" not in body and body["duration"] == "10"
    assert body["shot_type"] == "customize"
    assert [(s["prompt"], s["duration"]) for s in body["multi_prompt"]] == [
        ("@Element1 opens the door", "4"), ("@Element1 steps out", "3"), ("wide shot", "3")]


def test_clip_needs_whole_seconds_and_a_first_frame(provider):
    with pytest.raises(ProviderError):
        provider.submit(job(op="clip", refs=[], first_frame=FRAME, duration_s=4.5))
    with pytest.raises(CapabilityMissing):
        provider.submit(job(op="clip", refs=[]))
    with pytest.raises(CapabilityMissing):  # kling video wants an angle ref on every element
        provider.submit(job(op="clip", refs=[element_refs()[0]], first_frame=FRAME))


def test_clip_edit_feel_uses_luma_with_string_duration_and_strength(provider, fal):
    provider.submit(job(op="clip_edit", prompt="warmer, slower", refs=[Ref(VIDEO, "video", "current")],
                        duration_s=10, strength="flex"))
    body = fal.body()
    assert fal.fal_requests[-1].url.path == f"/{LUMA}"
    assert body == {"video_url": "https://cdn.test/6666", "prompt": "warmer, slower",
                    "duration": "10s", "resolution": "540p", "edit_strength": "flex_2"}


def test_clip_edit_needs_the_source_video(provider):
    with pytest.raises(CapabilityMissing):
        provider.submit(job(op="clip_edit", refs=[]))


# --- masks ---

def test_ideogram_mask_is_inverted_black_edit(provider, fal):
    """Ours is white = change; Ideogram v4.5 documents black = edit."""
    assert MASK_POLARITY[IDEOGRAM] == "black_edit"
    provider.submit(job(op="region_edit", prompt="a red scarf", mask=MASK,
                        refs=[Ref(HERO, "marked", "current"), Ref(FRAME, "style", "object")]))
    body = fal.body()
    mask = _decode(body["mask_url"])
    assert mask.size == (64, 48)
    assert mask.getpixel((5, 5)) == 0        # our changed (white) area is black for Ideogram
    assert mask.getpixel((60, 5)) == 255     # the kept area is white
    assert body["image_url"] == "https://cdn.test/1111"
    assert body["reference_image_urls"] == ["https://cdn.test/4444"]
    assert (body["quality"], body["edit_precision"]) == ("medium", "regular")


def test_region_edit_reads_inline_inputs_on_the_local_relay(fal):
    """2026-10-08: the local relay sends inputs as data URIs; reading the source's size did an HTTP GET on
    one, httpx raised InvalidURL, and the job sat in 'uncertain' although nothing reached fal."""
    inline = {HERO: _png(), MASK: _png()}

    def local(sha: str) -> AssetRef:
        return AssetRef(sha, "data:image/png;base64," + base64.b64encode(inline[sha]).decode(), "image/png")

    provider = FalProvider(KEY, local, client=httpx.Client(transport=httpx.MockTransport(fal)))
    provider.submit(job(op="region_edit", prompt="a red scarf", mask=MASK, refs=[Ref(HERO, "marked", "current")]))
    assert _decode(fal.body()["mask_url"]).size == (64, 48)
    assert not [r for r in fal.requests if r.url.host == "cdn.test"]


def test_mask_must_match_the_source_size(provider, fal):
    fal.files["/7777"] = _png((32, 32))
    other = "sha256:" + "7" * 64
    with pytest.raises(ProviderError) as e:
        provider.submit(job(op="region_edit", mask=MASK, refs=[Ref(other, "marked", "current")]))
    assert e.value.code == "invalid_input"
    assert fal.fal_requests == []


def test_region_edit_needs_a_mask_and_at_most_three_refs(provider):
    with pytest.raises(CapabilityMissing):
        provider.submit(job(op="region_edit"))
    refs = [Ref(HERO, "marked", "current")] + [Ref(FRAME, f"ref{i}_x", "object") for i in range(4)]
    with pytest.raises(CapabilityMissing):
        provider.submit(job(op="region_edit", mask=MASK, refs=refs))


def test_unverified_mask_polarity_is_assumed_white_edit():
    # LIVE CHECK REQUIRED before the event: fal documents no polarity for sam2/video or
    # wan-vace-14b/inpainting. We assume white = edit, so the mask goes out un-inverted.
    # If a live run shows black = edit, change MASK_POLARITY and this test together.
    assert MASK_POLARITY[SAM2] == "unverified"
    assert MASK_POLARITY[WAN] == "unverified"


# --- the region chain: sam2 then wan ---

def region_job():
    return job(op="clip_edit", prompt="make the jacket green", mask=MASK, refs=[Ref(VIDEO, "video", "current")])


def test_region_edit_chain_runs_sam2_then_wan(provider, fal):
    rid = provider.submit(region_job())
    assert rid == f"{SAM2}>{queue_app(SAM2)}:req1"
    sam = fal.body()
    assert fal.fal_requests[-1].url.path == f"/{SAM2}"
    assert sam["video_url"] == "https://cdn.test/6666"
    assert _decode(sam["mask_url"]).getpixel((5, 5)) == 255  # not inverted (unverified, see above)

    fal.on("GET", f"{queue_app(SAM2)}/requests/req1/status", 200, fixture("status_in_queue.json"))
    assert provider.status(rid).state == "queued"

    fal.on("GET", f"{queue_app(SAM2)}/requests/req1/status", 200, fixture("status_completed.json"))
    fal.on("GET", f"{queue_app(SAM2)}/requests/req1", 200, fixture("result_sam2.json"))
    assert provider.status(rid).state == "running"      # COMPLETED seen
    assert provider.status(rid).state == "running"      # result fetched
    assert fal.fal_requests[-1].url.path == f"/{queue_app(SAM2)}/requests/req1"
    st = provider.status(rid)                           # wan submitted
    assert st.state == "running" and st.outputs == []
    wan = fal.body()
    assert fal.fal_requests[-1].url.path == f"/{WAN}"
    assert wan["mask_video_url"] == "https://v3b.fal.media/files/b/sam2/mask.mp4"
    assert wan["video_url"] == "https://cdn.test/6666" and wan["prompt"] == "make the jacket green"
    assert wan["enable_safety_checker"] is True

    # the same id now follows the wan request, and it is not submitted twice
    fal.on("GET", f"{queue_app(WAN)}/requests/req2/status", 200, fixture("status_in_progress.json"))
    assert provider.status(rid).state == "running"
    fal.on("GET", f"{queue_app(WAN)}/requests/req2/status", 200, fixture("status_completed.json"))
    fal.on("GET", f"{queue_app(WAN)}/requests/req2", 200, fixture("result_video.json"))
    assert provider.status(rid).state == "running"
    done = provider.status(rid)
    assert done.state == "done" and done.outputs[0].mime == "video/mp4" and done.cost_usd is None
    assert [r.url.path for r in fal.fal_requests if r.method == "POST"] == [f"/{SAM2}", f"/{WAN}"]


def test_chain_cancel_stops_wan_from_starting(provider, fal):
    rid = provider.submit(region_job())
    fal.on("PUT", f"{queue_app(SAM2)}/requests/req1/cancel", 202, {"status": "CANCELLATION_REQUESTED"})
    provider.cancel(rid)
    assert provider.status(rid).state == "cancelled"
    assert [r.method for r in fal.fal_requests] == ["POST", "PUT"]


def test_a_lost_chain_fails_without_retry(provider):
    st = provider.status(f"{SAM2}:ghost")
    assert st.state == "failed" and not st.error.retryable


def _at_hand_over(provider, fal):
    """A chain whose sam2 is done and whose wan request is next."""
    rid = provider.submit(region_job())
    fal.on("GET", f"{queue_app(SAM2)}/requests/req1/status", 200, fixture("status_completed.json"))
    fal.on("GET", f"{queue_app(SAM2)}/requests/req1", 200, fixture("result_sam2.json"))
    provider.status(rid)
    provider.status(rid)
    return rid


def test_every_chain_poll_is_one_fal_call(provider, fal):
    rid = provider.submit(region_job())
    fal.on("GET", f"{queue_app(SAM2)}/requests/req1/status", 200, fixture("status_completed.json"))
    fal.on("GET", f"{queue_app(SAM2)}/requests/req1", 200, fixture("result_sam2.json"))
    for _ in range(3):
        before = len(fal.fal_requests)
        provider.status(rid)
        assert len(fal.fal_requests) - before == 1


def test_chain_cancel_after_hand_over_cancels_wan(provider, fal):
    rid = _at_hand_over(provider, fal)
    provider.status(rid)
    fal.on("PUT", f"{queue_app(WAN)}/requests/req2/cancel", 202, {"status": "CANCELLATION_REQUESTED"})
    provider.cancel(rid)
    assert fal.fal_requests[-1].url.path == f"/{queue_app(WAN)}/requests/req2/cancel"
    assert provider.status(rid).state == "cancelled"


def test_chain_sam2_failure_ends_the_job(provider, fal):
    rid = provider.submit(region_job())
    fal.on("GET", f"{queue_app(SAM2)}/requests/req1/status", 200, fixture("status_completed_error.json"))
    assert provider.status(rid).state == "failed"
    before = len(fal.fal_requests)
    assert provider.status(rid).state == "failed"
    assert len(fal.fal_requests) == before


def test_chain_sam2_without_a_video_fails(provider, fal):
    rid = provider.submit(region_job())
    fal.on("GET", f"{queue_app(SAM2)}/requests/req1/status", 200, fixture("status_completed.json"))
    fal.on("GET", f"{queue_app(SAM2)}/requests/req1", 200, {"images": [{"url": "https://x/a.png"}]})
    provider.status(rid)
    st = provider.status(rid)
    assert (st.state, st.error.retryable) == ("failed", False)
    assert [r.method for r in fal.fal_requests].count("POST") == 1


def test_chain_wan_enqueue_moderated_is_failed_and_never_resent(provider, fal):
    rid = _at_hand_over(provider, fal)
    fal.on("POST", WAN, 422, fixture("error_policy_422.json"))
    st = provider.status(rid)
    assert (st.state, st.error.code, st.error.retryable) == ("failed", "moderated", False)
    assert provider.status(rid).state == "failed"
    assert [r.url.path for r in fal.fal_requests if r.method == "POST"] == [f"/{SAM2}", f"/{WAN}"]


def test_chain_wan_enqueue_5xx_raises_then_retries_without_double_submit(provider, fal):
    rid = _at_hand_over(provider, fal)
    fal.on("POST", WAN, 503, {"detail": "overloaded"})
    with pytest.raises(ProviderError) as e:
        provider.status(rid)
    assert e.value.retryable
    del fal.routes[("POST", f"/{WAN}")]
    assert provider.status(rid).state == "running"
    fal.on("GET", f"{queue_app(WAN)}/requests/req2/status", 200, fixture("status_in_progress.json"))
    assert provider.status(rid).state == "running"
    assert [r.url.path for r in fal.fal_requests if r.url.path == f"/{WAN}"] == [f"/{WAN}", f"/{WAN}"]


def test_chain_wan_enqueue_with_no_answer_is_not_resent(fal):
    calls = []

    def flaky(request):
        if request.url.path == f"/{WAN}":
            calls.append(1)
            raise httpx.ReadTimeout("lost")
        return fal(request)

    p = FalProvider(KEY, resolver, client=httpx.Client(transport=httpx.MockTransport(flaky)))
    rid = _at_hand_over(p, fal)
    st = p.status(rid)
    assert (st.state, st.error.retryable) == ("failed", False)
    p.status(rid)
    assert len(calls) == 1


def test_chain_wan_failure_is_failed(provider, fal):
    rid = _at_hand_over(provider, fal)
    provider.status(rid)
    fal.on("GET", f"{queue_app(WAN)}/requests/req2/status", 200, fixture("status_completed_policy.json"))
    st = provider.status(rid)
    assert (st.state, st.error.code) == ("failed", "moderated")


# --- status ---

def test_status_maps_queue_progress_and_done(provider, fal):
    rid = provider.submit(job())
    path = f"{queue_app(KLING_IMAGE)}/requests/req1"
    fal.on("GET", path + "/status", 200, fixture("status_in_queue.json"))
    st = provider.status(rid)
    assert (st.state, st.queue_position) == ("queued", 3)

    fal.on("GET", path + "/status", 200, fixture("status_in_progress.json"))
    assert provider.status(rid).state == "running"

    fal.on("GET", path + "/status", 200, fixture("status_completed.json"))
    fal.on("GET", path, 200, fixture("result_kling_image.json"))
    before = len(fal.fal_requests)
    assert provider.status(rid).state == "running"      # COMPLETED seen, one call
    st = provider.status(rid)
    assert st.state == "done" and st.kind == "generated"
    assert [(o.url, o.mime, o.w, o.h) for o in st.outputs][0] == (
        "https://v3b.fal.media/files/b/kling/one.png", "image/png", 1024, 1024)
    assert len(st.outputs) == 2 and st.cost_usd == pytest.approx(0.056)
    assert len(fal.fal_requests) - before == 2  # one call per status()


def test_a_poll_is_one_call_while_the_job_runs(provider, fal):
    rid = provider.submit(job())
    fal.on("GET", f"{queue_app(KLING_IMAGE)}/requests/req1/status", 200, fixture("status_in_progress.json"))
    before = len(fal.fal_requests)
    provider.status(rid)
    assert len(fal.fal_requests) - before == 1


def test_completed_with_an_error_is_failed(provider, fal):
    rid = provider.submit(job())
    fal.on("GET", f"{queue_app(KLING_IMAGE)}/requests/req1/status", 200, fixture("status_completed_error.json"))
    st = provider.status(rid)
    assert st.state == "failed"
    # fal's docs call runner errors transient: trying again can help (features/harness-errors.clan)
    assert (st.error.code, st.error.retryable, st.error.provider_code) == ("provider_failed", True, "runner_disconnected")


def test_completed_with_a_policy_error_is_moderated_and_not_retryable(provider, fal):
    rid = provider.submit(job())
    fal.on("GET", f"{queue_app(KLING_IMAGE)}/requests/req1/status", 200, fixture("status_completed_policy.json"))
    st = provider.status(rid)
    assert (st.state, st.error.code, st.error.retryable) == ("failed", "moderated", False)


def test_result_422_content_policy_is_moderated(provider, fal):
    rid = provider.submit(job())
    fal.on("GET", f"{queue_app(KLING_IMAGE)}/requests/req1/status", 200, fixture("status_completed.json"))
    fal.on("GET", f"{queue_app(KLING_IMAGE)}/requests/req1", 422, fixture("error_policy_422.json"))
    provider.status(rid)
    st = provider.status(rid)
    assert (st.state, st.error.code, st.error.retryable) == ("failed", "moderated", False)
    assert st.error.provider_code == "content_policy_violation"


def test_no_media_generated_is_failed(provider, fal):
    rid = provider.submit(job())
    fal.on("GET", f"{queue_app(KLING_IMAGE)}/requests/req1/status", 200, fixture("status_completed.json"))
    fal.on("GET", f"{queue_app(KLING_IMAGE)}/requests/req1", 200, {"images": []})
    provider.status(rid)
    assert provider.status(rid).error.code == "provider_failed"


def _completed(provider, fal, result_status, result_body):
    rid = provider.submit(job())
    fal.on("GET", f"{queue_app(KLING_IMAGE)}/requests/req1/status", 200, fixture("status_completed.json"))
    fal.on("GET", f"{queue_app(KLING_IMAGE)}/requests/req1", result_status, result_body)
    provider.status(rid)
    return rid


def test_result_422_no_media_is_provider_failed_not_invalid_input(provider, fal):
    rid = _completed(provider, fal, 422, fixture("error_no_media_422.json"))
    st = provider.status(rid)
    assert (st.state, st.error.code, st.error.retryable) == ("failed", "provider_failed", False)
    assert st.error.provider_code == "no_media_generated"


def test_result_5xx_raises_and_the_next_poll_fetches_the_result_again(provider, fal):
    rid = _completed(provider, fal, 503, {"detail": "down"})
    with pytest.raises(ProviderError) as e:
        provider.status(rid)
    assert e.value.retryable
    fal.on("GET", f"{queue_app(KLING_IMAGE)}/requests/req1", 200, fixture("result_kling_image.json"))
    assert provider.status(rid).state == "done"


def test_status_get_4xx_is_a_failed_status_not_an_exception(provider, fal):
    rid = provider.submit(job())
    fal.on("GET", f"{queue_app(KLING_IMAGE)}/requests/req1/status", 404, {"detail": "Request not found"})
    st = provider.status(rid)
    assert (st.state, st.error.retryable) == ("failed", False)


def test_status_429_raises_retryable(provider, fal):
    rid = provider.submit(job())
    fal.routes[("GET", f"/{queue_app(KLING_IMAGE)}/requests/req1/status")] = httpx.Response(429, headers={"retry-after": "9"}, json={})
    with pytest.raises(ProviderError) as e:
        provider.status(rid)
    assert (e.value.retryable, e.value.retry_after_s) == (True, 9)


def test_unknown_status_is_provider_failed(provider, fal):
    rid = provider.submit(job())
    fal.on("GET", f"{queue_app(KLING_IMAGE)}/requests/req1/status", 200, {"status": "WEIRD"})
    st = provider.status(rid)  # asking again cannot help: the job ends now, not at the relay's timeout
    assert (st.state, st.error.code, st.error.retryable) == ("failed", "provider_failed", False)


def test_status_transport_error_is_retryable(fal):
    def down(request):
        if request.method == "POST":
            return fal(request)
        raise httpx.ConnectError("gone")

    p = FalProvider(KEY, resolver, client=httpx.Client(transport=httpx.MockTransport(down)))
    rid = p.submit(job())
    for call in (lambda: p.status(rid), lambda: p.cancel(rid)):
        with pytest.raises(ProviderError) as e:
            call()
        assert (e.value.code, e.value.retryable) == ("provider_unavailable", True)


@pytest.mark.parametrize("raw", [b"<html>bad gateway</html>", b""])
def test_non_json_bodies_are_provider_errors(provider, fal, raw):
    fal.routes[("POST", f"/{KLING_IMAGE}")] = httpx.Response(200, content=raw)
    with pytest.raises(ProviderError) as e:
        provider.submit(job())
    # a 2xx: fal may have the request, so it must never be sent anywhere else
    assert (e.value.code, e.value.retryable, e.value.accepted) == ("provider_failed", False, True)
    fal.routes.clear()
    rid = provider.submit(job())
    fal.routes[("GET", f"/{queue_app(KLING_IMAGE)}/requests/req1/status")] = httpx.Response(200, content=raw)
    with pytest.raises(ProviderError) as e:
        provider.status(rid)
    assert e.value.code == "provider_unavailable"
    fal.routes[("GET", f"/{queue_app(KLING_IMAGE)}/requests/req1/status")] = httpx.Response(200, json=fixture("status_completed.json"))
    fal.routes[("GET", f"/{queue_app(KLING_IMAGE)}/requests/req1")] = httpx.Response(200, content=raw)
    provider.status(rid)
    with pytest.raises(ProviderError) as e:
        provider.status(rid)
    assert e.value.code == "provider_unavailable"


def test_submit_reply_without_request_id_is_provider_failed(provider, fal):
    fal.on("POST", KLING_IMAGE, 200, {"queue_position": 0})
    with pytest.raises(ProviderError) as e:
        provider.submit(job())
    assert (e.value.code, e.value.retryable) == ("provider_failed", False)


def test_result_with_an_odd_shape_is_failed(provider, fal):
    rid = _completed(provider, fal, 200, {"images": [{"no_url": 1}]})
    st = provider.status(rid)
    assert (st.state, st.error.code) == ("failed", "provider_failed")


# --- errors on submit ---

def test_submit_content_policy_violation_is_moderated_not_retryable(provider, fal):
    fal.on("POST", KLING_IMAGE, 422, fixture("error_policy_422.json"))
    with pytest.raises(ProviderError) as e:
        provider.submit(job())
    assert (e.value.code, e.value.retryable, e.value.provider_code) == ("moderated", False, "content_policy_violation")


def test_submit_429_is_retryable_with_retry_after(provider, fal):
    fal.routes[("POST", f"/{KLING_IMAGE}")] = httpx.Response(429, headers={"retry-after": "7"}, json={"detail": "slow down"})
    with pytest.raises(ProviderError) as e:
        provider.submit(job())
    assert (e.value.code, e.value.retryable, e.value.retry_after_s) == ("provider_unavailable", True, 7)


def test_submit_429_defaults_and_clamps_retry_after(provider, fal):
    for header, want in ((None, 5), ("Wed, 21 Oct 2026 07:28:00 GMT", 5), ("-3", 0)):
        headers = {"retry-after": header} if header else {}
        fal.routes[("POST", f"/{KLING_IMAGE}")] = httpx.Response(429, headers=headers, json={"detail": "slow"})
        with pytest.raises(ProviderError) as e:
            provider.submit(job())
        assert (e.value.retryable, e.value.retry_after_s) == (True, want)


@pytest.mark.parametrize("status,body,headers", [
    (422, {"detail": "content_policy_violation: flagged"}, {}),
    (422, {"detail": "flagged"}, {"x-fal-error-type": "content_policy_violation"}),
    (422, {"detail": "flagged", "error_type": "content_policy_violation"}, {}),
    (400, {"detail": "The prompt hit a content_policy_violation"}, {}),
])
def test_moderation_is_found_outside_the_detail_list(provider, fal, status, body, headers):
    fal.routes[("POST", f"/{KLING_IMAGE}")] = httpx.Response(status, json=body, headers=headers)
    with pytest.raises(ProviderError) as e:
        provider.submit(job())
    assert (e.value.code, e.value.retryable) == ("moderated", False)


@pytest.mark.parametrize("status", [401, 403])
def test_bad_key_is_provider_failed(provider, fal, status):
    fal.on("POST", KLING_IMAGE, status, {"detail": "Unauthorized"})
    with pytest.raises(ProviderError) as e:
        provider.submit(job())
    assert (e.value.code, e.value.retryable) == ("provider_failed", False)


def test_submit_5xx_is_unavailable(provider, fal):
    fal.on("POST", KLING_IMAGE, 503, {"detail": "overloaded", "error_type": "runner_unavailable"})
    with pytest.raises(ProviderError) as e:
        provider.submit(job())
    assert (e.value.code, e.value.retryable) == ("provider_unavailable", True)


def test_submit_invalid_input_is_not_retryable(provider, fal):
    fal.on("POST", KLING_IMAGE, 422, fixture("error_invalid_422.json"))
    with pytest.raises(ProviderError) as e:
        provider.submit(job())
    assert (e.value.code, e.value.retryable, e.value.message) == ("invalid_input", False, "Field required")


def test_unreachable_fal_is_unavailable():
    def boom(request):
        raise httpx.ConnectError("no route")

    p = FalProvider(KEY, resolver, client=httpx.Client(transport=httpx.MockTransport(boom)))
    with pytest.raises(ProviderError) as e:
        p.submit(job())
    assert (e.value.code, e.value.retryable) == ("provider_unavailable", True)


# --- capabilities ---

def test_seed_and_unsupported_ops_are_refused_before_any_call(provider, fal):
    with pytest.raises(CapabilityMissing):
        provider.submit(job(seed=3))
    with pytest.raises(CapabilityMissing):
        provider.submit(job(op="segment"))
    assert fal.requests == []


def test_characters_and_frames_default_to_nano_banana_pro_with_kling_beside_it():
    """features/default-models.clan: a good model always, chosen for keeping characters."""
    sheet = load_sheet("fal")
    for op in ("generate", "frame"):
        assert sheet["ops"][op]["endpoint"] == "fal-ai/nano-banana-pro/edit"
        assert "kling-image-o3" in [a["model"] for a in sheet["ops"][op]["alternates"]]
    assert sheet["ops"]["clip"]["model"] == "kling-v3-pro-i2v"  # the clip model that keeps named characters


# --- cancel ---

def test_cancel_puts_to_the_cancel_url(provider, fal):
    rid = provider.submit(job())
    fal.on("PUT", f"{queue_app(KLING_IMAGE)}/requests/req1/cancel", 202, {"status": "CANCELLATION_REQUESTED"})
    provider.cancel(rid)
    assert fal.fal_requests[-1].method == "PUT"
    assert fal.fal_requests[-1].url.path == f"/{queue_app(KLING_IMAGE)}/requests/req1/cancel"


def test_cancel_of_a_finished_request_is_fine(provider, fal):
    rid = provider.submit(job())
    fal.on("PUT", f"{queue_app(KLING_IMAGE)}/requests/req1/cancel", 400, fixture("error_already_completed.json"))
    provider.cancel(rid)


def test_cancel_of_an_unknown_request_raises(provider, fal):
    fal.on("PUT", f"{queue_app(KLING_IMAGE)}/requests/ghost/cancel", 404, {"detail": "not found"})
    with pytest.raises(ProviderError):
        provider.cancel(f"{KLING_IMAGE}:ghost")


def test_queue_urls_use_the_base_app_not_the_endpoint_sub_path(provider, fal):
    """2026-10-07: polling fal-ai/kling-image/o3/image-to-image/requests/<id>/status got 405 from fal;
    the queue serves status, result and cancel under the base app (the submit reply's status_url)."""
    assert queue_app(KLING_IMAGE) == "fal-ai/kling-image"
    assert queue_app("whatever/the/endpoint", "https://queue.fal.run/fal-ai/kling-image/requests/r/status") == "fal-ai/kling-image"
    rid = provider.submit(job())
    fal.on("GET", "fal-ai/kling-image/requests/req1/status", 200, fixture("status_completed.json"))
    fal.on("GET", "fal-ai/kling-image/requests/req1", 200, fixture("result_kling_image.json"))
    provider.status(rid)
    done = provider.status(rid)
    assert done.state == "done"
    assert [r.url.path for r in fal.fal_requests[1:]] == ["/fal-ai/kling-image/requests/req1/status", "/fal-ai/kling-image/requests/req1"]
    # An id written before the queue app was kept still polls the right place.
    assert provider._split(f"{KLING_IMAGE}:req1") == (KLING_IMAGE, "fal-ai/kling-image", "req1")


def test_kling_image_gets_an_aspect_ratio_from_its_list(provider, fal):
    """Kling image o3 takes 16:9, 9:16, 1:1, 4:3, 3:4, 3:2, 2:3, 21:9: the canvas's 4:5 becomes 3:4."""
    provider.submit(job(ratio="4:5"))
    assert fal.body()["aspect_ratio"] == "3:4"
    provider.submit(job(ratio="896:1152"))
    assert fal.body()["aspect_ratio"] == "3:4"
    provider.submit(job(ratio="9:16"))
    assert fal.body()["aspect_ratio"] == "9:16"


def test_a_clip_with_no_words_still_sends_a_prompt(provider, fal):
    provider.submit(job(op="clip", prompt="", refs=[], first_frame=FRAME))
    assert fal.body()["prompt"]


def test_a_clip_edit_source_sent_as_video_is_found():
    """director.schema.json lets the director name the source clip as `video`; adapters look for the
    `current` ref, so from_director turns one into the other."""
    from providers.types import ProviderJob as PJ
    pj = PJ.from_director("clip_edit", {"provider": "fal", "model": "m", "prompt": "x", "video": VIDEO, "refs": []})
    assert [(r.sha256, r.role) for r in pj.refs] == [(VIDEO, "current")]


def test_a_generate_with_only_one_characters_variants_sends_them_as_images(provider, fal):
    """2026-10-07: maya_front + maya_side went as one Kling element and nothing else, and Kling image
    o3 needs at least one image in image_urls ("needs at least one image ref"). With no plain image,
    the element's pictures go as images, and the prompt names them @Image1, @Image2."""
    refs = [Ref(HERO, "maya_front", "element_front"), Ref(FRAME, "maya_side", "element_angle")]
    provider.submit(job(prompt="@maya_front waving, like @maya_side", refs=refs))
    body = fal.body()
    assert len(body["image_urls"]) == 2 and "elements" not in body
    assert body["prompt"] == "@Image1 waving, like @Image2"
