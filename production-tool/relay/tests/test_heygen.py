import json
from pathlib import Path

import httpx
import pytest

from providers import AssetRef, CapabilityMissing, ProviderJob, Ref
from providers.types import ProviderError
from providers.heygen import HeyGenProvider, idempotency_key

FIXTURES = Path(__file__).parent / "fixtures" / "heygen"
SHA = "sha256:" + "a" * 64
SHB = "sha256:" + "b" * 64


def fixture(name: str) -> dict:
    return json.loads((FIXTURES / f"{name}.json").read_text())


def assets(sha: str) -> AssetRef:
    return AssetRef(sha, f"https://cdn.test/{sha[-8:]}.png", "image/png")


def make(handler):
    sent = []

    def wrapped(request: httpx.Request) -> httpx.Response:
        sent.append(request)
        return handler(request)

    client = httpx.Client(transport=httpx.MockTransport(wrapped))
    provider = HeyGenProvider("key-123", assets, client=client)
    provider.sent = sent
    return provider


def reply(status=200, name=None, headers=None):
    return lambda request: httpx.Response(status, json=fixture(name) if name else {}, headers=headers)


def job(**kw) -> ProviderJob:
    fields = dict(op="clip", provider="heygen", model="heygen-video-1", prompt="a slow push in",
                  first_frame=SHA, duration_s=8, seed=7)
    fields.update(kw)
    return ProviderJob(**fields)


def refs_job(**kw) -> ProviderJob:
    fields = dict(first_frame=None, prompt="@villain chases @hero",
                  refs=[Ref(SHA, "hero", "character"), Ref(SHB, "villain", "character")])
    fields.update(kw)
    return job(**fields)


def body_of(request: httpx.Request) -> dict:
    return json.loads(request.content)


def test_image_to_video_body():
    p = make(reply(202, "create_202"))
    assert p.submit(job()) == "vid_abc123"
    request = p.sent[0]
    assert (request.method, str(request.url)) == ("POST", "https://api.heygen.com/v3/models/videos")
    assert request.headers["X-Api-Key"] == "key-123"
    body = body_of(request)
    assert body == {"model": "heygen-video-1", "mode": "image_to_video", "prompt": "a slow push in",
                    "resolution": "768p", "prompt_enhancement": "disabled",
                    "image": {"type": "url", "url": "https://cdn.test/aaaaaaaa.png"},
                    "aspect_ratio": None, "duration": 8, "seed": 7}


def test_reference_to_video_body_names_pictures_in_sent_order():
    p = make(reply(202, "create_202"))
    p.submit(refs_job(ratio="16:9"))
    body = body_of(p.sent[0])
    assert body["mode"] == "reference_to_video"
    assert body["reference_images"] == [{"type": "url", "url": "https://cdn.test/aaaaaaaa.png"},
                                        {"type": "url", "url": "https://cdn.test/bbbbbbbb.png"}]
    assert body["prompt"] == "<Picture 2> chases <Picture 1>"
    assert body["aspect_ratio"] == "16:9"
    assert "image" not in body


def test_resolution_is_never_2k():
    p = make(reply(202, "create_202"))
    p.submit(job())
    p.submit(refs_job())
    assert [body_of(r)["resolution"] for r in p.sent] == ["768p", "768p"]


def test_audio_is_recorded_as_unsettable():
    p = make(reply(202, "create_202"))
    p.submit(job())
    assert p.requests[0]["audio"] is False and p.requests[0]["audioSent"] is False
    assert "audio" not in body_of(p.sent[0])


def test_idempotency_key_is_deterministic_and_valid():
    p = make(reply(202, "create_202"))
    p.submit(job())
    p.submit(job())
    p.submit(job(seed=8))
    keys = [r.headers["Idempotency-Key"] for r in p.sent]
    assert keys[0] == keys[1] != keys[2]
    assert keys[0] == idempotency_key(job())
    assert 1 <= len(keys[0]) <= 255 and all(c.isalnum() or c in "_:.-" for c in keys[0])


def test_no_first_frame_and_no_refs_is_refused():
    p = make(reply(202, "create_202"))
    with pytest.raises(CapabilityMissing):
        p.submit(job(first_frame=None))
    assert p.sent == []


def test_unknown_tag_is_invalid_input():
    p = make(reply(202, "create_202"))
    with pytest.raises(ProviderError) as e:
        p.submit(refs_job(prompt="@ghost waves"))
    assert e.value.code == "invalid_input"


def test_prompt_over_5000_chars_is_invalid_input():
    p = make(reply(202, "create_202"))
    with pytest.raises(ProviderError) as e:
        p.submit(job(prompt="x" * 5001))
    assert e.value.code == "invalid_input" and p.sent == []


@pytest.mark.parametrize("kw", [
    dict(duration_s=4), dict(duration_s=16), dict(duration_s=15.5), dict(duration_s=7.5), dict(mask=SHA),
    dict(last_frame=SHB), dict(first_frame=SHA, refs=[Ref(SHB, "hero", "character")]),
])
def test_capability_refusals(kw):
    p = make(reply(202, "create_202"))
    with pytest.raises(CapabilityMissing):
        p.submit(job(**kw))
    assert p.sent == []


def test_ten_refs_refused_and_nine_sent():
    p = make(reply(202, "create_202"))
    many = lambda n: [Ref("sha256:" + f"{i:064x}", f"ref{i:02d}", "prop") for i in range(n)]
    with pytest.raises(CapabilityMissing):
        p.submit(job(first_frame=None, refs=many(10)))
    p.submit(job(first_frame=None, refs=many(9)))
    assert len(body_of(p.sent[0])["reference_images"]) == 9


def test_seed_zero_is_sent():
    p = make(reply(202, "create_202"))
    p.submit(job(seed=0))
    assert body_of(p.sent[0])["seed"] == 0


@pytest.mark.parametrize("name,state", [
    ("status_pending", "queued"), ("status_processing", "running"), ("status_cancelled", "cancelled"),
])
def test_status_in_flight_states(name, state):
    p = make(reply(200, name))
    assert p.status("vid_abc123").state == state
    assert len(p.sent) == 1 and p.sent[0].method == "GET"
    assert str(p.sent[0].url) == "https://api.heygen.com/v3/models/videos/vid_abc123"


def test_status_done_has_video_output():
    s = make(reply(200, "status_completed")).status("vid_abc123")
    assert s.state == "done" and s.kind == "generated"
    (out,) = s.outputs
    assert (out.mime, out.w, out.h, out.duration_s) == ("video/mp4", 1280, 720, 8.04)
    assert out.url.startswith("https://files.heygen.test/")


def test_status_failed_maps_to_provider_failed():
    s = make(reply(200, "status_failed")).status("vid_abc123")
    assert s.state == "failed" and s.error.code == "provider_failed" and not s.error.retryable
    assert s.error.provider_code == "generation_failed"


def test_status_moderated_is_never_retryable():
    s = make(reply(200, "status_moderated")).status("vid_abc123")
    assert s.state == "failed" and s.error.code == "moderated" and s.error.retryable is False


def test_402_is_not_retryable():
    p = make(reply(402, "error_402"))
    with pytest.raises(ProviderError) as e:
        p.submit(job())
    assert e.value.code == "provider_failed" and e.value.retryable is False


def test_409_with_video_id_is_the_same_job():
    p = make(reply(409, "error_409"))
    assert p.submit(job()) == "vid_abc123"


def test_409_without_video_id_is_accepted_so_it_never_goes_elsewhere():
    """HeyGen is already making this clip: sending it to the next provider would pay twice."""
    p = make(lambda r: httpx.Response(409, json={"error": {"message": "in progress"}}))
    with pytest.raises(ProviderError) as e:
        p.submit(job())
    assert (e.value.code, e.value.retryable, e.value.accepted) == ("provider_failed", False, True)


def test_429_carries_retry_after():
    p = make(reply(429, "error_429", headers={"Retry-After": "12"}))
    with pytest.raises(ProviderError) as e:
        p.submit(job())
    assert (e.value.code, e.value.retryable, e.value.retry_after_s) == ("provider_unavailable", True, 12)


def test_503_is_retryable_and_400_is_invalid_input():
    with pytest.raises(ProviderError) as e:
        make(reply(503)).submit(job())
    assert e.value.code == "provider_unavailable" and e.value.retryable
    with pytest.raises(ProviderError) as e:
        make(reply(400, "error_400")).submit(job())
    assert e.value.code == "invalid_input" and not e.value.retryable


def test_cancel_is_local_and_status_then_ignores_the_provider():
    p = make(reply(200, "status_processing"))
    p.cancel("vid_abc123")
    assert p.status("vid_abc123").state == "cancelled"
    assert p.sent == []
    assert p.status("vid_other").state == "running"


def test_submit_never_polls():
    p = make(reply(202, "create_202"))
    p.submit(job())
    assert [r.method for r in p.sent] == ["POST"]


def test_idempotency_key_differs_by_ratio():
    assert idempotency_key(refs_job(ratio="16:9")) != idempotency_key(refs_job(ratio="9:16"))


@pytest.mark.parametrize("seconds", [5, 15])
def test_boundary_durations_are_sent(seconds):
    p = make(reply(202, "create_202"))
    p.submit(job(duration_s=seconds))
    assert body_of(p.sent[0])["duration"] == seconds


def test_ratio_is_ignored_for_image_to_video():
    p = make(reply(202, "create_202"))
    p.submit(job(ratio="16:9"))
    assert body_of(p.sent[0])["aspect_ratio"] is None


def test_tag_inside_a_word_is_left_alone():
    p = make(reply(202, "create_202"))
    p.submit(refs_job(prompt="@hero meets the heroic @villain"))
    assert body_of(p.sent[0])["prompt"] == "<Picture 1> meets the heroic <Picture 2>"


@pytest.mark.parametrize("response", [
    httpx.Response(202, json={}), httpx.Response(202, json={"data": {}}),
    httpx.Response(202, text="not json"), httpx.Response(202, json=[1]),
])
def test_submit_with_malformed_success_body_is_provider_failed(response):
    with pytest.raises(ProviderError) as e:
        make(lambda r: response).submit(job())
    assert e.value.code == "provider_failed" and not e.value.retryable


def test_done_without_video_url_ends_the_job():
    s = make(lambda r: httpx.Response(200, json={"data": {"status": "completed"}})).status("vid_abc123")
    assert (s.state, s.error.code, s.error.retryable) == ("failed", "provider_failed", False)


def test_status_with_malformed_body_is_asked_again():
    with pytest.raises(ProviderError) as e:
        make(lambda r: httpx.Response(200, text="oops")).status("vid_abc123")
    assert (e.value.code, e.value.retryable) == ("provider_unavailable", True)


def test_unknown_status_string_is_provider_failed():
    p = make(lambda r: httpx.Response(200, json={"data": {"status": "weird"}}))
    s = p.status("vid_abc123")
    assert s.state == "failed" and s.error.code == "provider_failed" and not s.error.retryable


@pytest.mark.parametrize("code,message", [
    ("content_policy_violation", "x"), ("generation_failed", "blocked by moderation"),
    ("SAFETY.INPUT.TEXT", "x"),
])
def test_moderation_spellings_are_never_retryable(code, message):
    body = {"data": {"status": "failed", "failure_code": code, "failure_message": message}}
    s = make(lambda r: httpx.Response(200, json=body)).status("vid_abc123")
    assert s.error.code == "moderated" and s.error.retryable is False


def test_429_without_retry_after_waits_5():
    with pytest.raises(ProviderError) as e:
        make(reply(429)).submit(job())
    assert e.value.retryable and e.value.retry_after_s == 5


def test_5xx_passes_retry_after_through():
    with pytest.raises(ProviderError) as e:
        make(reply(503, headers={"Retry-After": "30"})).submit(job())
    assert e.value.retry_after_s == 30
    with pytest.raises(ProviderError) as e:
        make(reply(500)).submit(job())
    assert e.value.retry_after_s is None


@pytest.mark.parametrize("status,code", [
    (401, "provider_failed"), (403, "provider_failed"), (404, "invalid_input"),
    (422, "invalid_input"), (418, "provider_failed"),
])
def test_other_4xx_are_mapped_and_not_retryable(status, code):
    with pytest.raises(ProviderError) as e:
        make(reply(status)).submit(job())
    assert e.value.code == code and not e.value.retryable and e.value.provider_code == str(status)


def test_non_json_error_body_still_maps():
    p = make(lambda r: httpx.Response(502, text="<html>bad gateway</html>"))
    with pytest.raises(ProviderError) as e:
        p.submit(job())
    assert e.value.code == "provider_unavailable" and e.value.retryable


def test_a_local_inline_image_goes_as_heygen_base64_not_as_a_url():
    """The local relay sends data URIs; HeyGen's url field must be a public HTTPS URL, and inline
    images go as {"type": "base64", "media_type", "data"} (developers.heygen.com, 2026-10-07)."""
    def inline(sha):
        return AssetRef(sha, "data:image/png;base64,iVBORw0KGgo=", "image/png")
    client = httpx.Client(transport=httpx.MockTransport(reply(202, "create_202")))
    sent = []
    p = HeyGenProvider("key-123", inline, client=httpx.Client(transport=httpx.MockTransport(
        lambda r: sent.append(r) or reply(202, "create_202")(r))))
    p.submit(job())
    assert body_of(sent[0])["image"] == {"type": "base64", "media_type": "image/png", "data": "iVBORw0KGgo="}
    p.submit(refs_job(ratio="4:5"))
    body = body_of(sent[1])
    assert body["reference_images"][0]["type"] == "base64"
    assert body["aspect_ratio"] == "3:4"  # reference_to_video takes 9:16, 16:9, 1:1, 3:4, 4:3, 21:9
    client.close()
