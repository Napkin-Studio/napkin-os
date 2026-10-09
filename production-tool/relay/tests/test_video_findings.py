"""The Video stage test (2026-10-09, features/video-stage-findings.clan): render credits and quota kept
for failures that made nothing, a Runway 429 failing at once with Runway named twice, a failure's
retryable flag ignored, clips with a video as their frame charged before Runway refused them, the
feel-edit switch bypassed, lone surrogates breaking jobs, and relay-made blobs uploaded again."""

import json

import pytest

from conftest import CDN, Harness, asset, base_config, job_request
from director import new_id
from providers.base import CapabilityMissing, ProviderError, Status
from service import participant_id


def left(h, job, cls):
    return h.relay.remaining(job["participantId"], "participant")[cls]


def runway_only() -> Harness:
    cfg = base_config()
    cfg["routing"] = {**cfg["routing"], "clip": ["runway"], "clip_edit": ["runway"]}
    return Harness(cfg, providers=("runway",))


def clip(h, token, expect=200, **inp):
    return h.post_job(token, op="clip", expect=expect, **(inp or {"image": asset(3)}))[1]


# ── renders come back when no ad was made ───────────────────────────────────
def start_render(h):
    token = h.sign_in()
    _, job = h.post_job(token, op="stitch", expect=200)
    assert left(h, job, "render") == 2
    return token, job, h.stitched[-1]


def test_a_failed_render_gives_the_render_back(h):
    token, job, payload = start_render(h)
    h.blobs.put(payload["resultKey"], json.dumps({"ok": False, "error": "The ad could not be rendered."}).encode(), "application/json")
    out = h.poll(token, job["jobId"])
    assert out["state"] == "failed" and out["error"]["retryable"]
    assert left(h, job, "render") == 3


def test_a_render_that_timed_out_gives_the_render_back(h):
    token, job, _ = start_render(h)
    h.clock.tick(h.cfg["jobTimeoutS"]["video"] + 1)
    out = h.poll(token, job["jobId"])
    assert out["state"] == "failed" and out["error"]["code"] == "timeout"
    assert left(h, job, "render") == 3


def test_a_cancelled_render_gives_the_render_back(h):
    token, job, _ = start_render(h)
    out = h.call("DELETE", f"/jobs/{job['jobId']}", None, token, expect=200)[1]
    assert out["state"] == "cancelled"
    assert left(h, job, "render") == 3


def test_a_clip_the_stitch_cannot_read_names_the_shot_and_is_not_retried(h):
    token, job, payload = start_render(h)
    result = {"ok": False, "code": "bad_clip", "clip": 1, "error": "Shot 2's clip could not be read. Make it again, then render."}
    h.blobs.put(payload["resultKey"], json.dumps(result).encode(), "application/json")
    out = h.poll(token, job["jobId"])
    assert out["state"] == "failed" and out["error"]["code"] == "invalid_input" and not out["error"]["retryable"]
    assert out["error"]["message"].startswith("Shot 2's clip")
    assert left(h, job, "render") == 3


# ── Runway busy at submit ───────────────────────────────────────────────────
def test_a_runway_429_waits_for_retry_after_then_sends_it_again():
    h = runway_only()
    token = h.sign_in()
    runway = h.providers["runway"]
    runway.submit_effect = ProviderError("provider_unavailable", "Runway answered 429", retryable=True, retry_after_s=7)
    job = clip(h, token)
    assert job["state"] == "queued" and "error" not in job
    assert len(runway.submits) == 1 and h.store.counters("slots#runway#video").get("n", 0) == 0
    h.clock.tick(3)
    assert h.poll(token, job["jobId"])["state"] == "queued"
    assert len(runway.submits) == 1  # not before Retry-After
    runway.submit_effect = None
    h.clock.tick(5)
    out = h.poll(token, job["jobId"])
    assert (out["state"], out["provider"]) == ("submitted", "runway")
    assert left(h, job, "video") == 5  # counted once


def test_a_runway_429_that_never_clears_fails_at_the_queue_timeout_saying_why():
    h = runway_only()
    token = h.sign_in()
    h.providers["runway"].submit_effect = ProviderError("provider_unavailable", "Runway answered 429", retryable=True, retry_after_s=30)
    job = clip(h, token)
    for _ in range(25):
        h.clock.tick(30)
        out = h.poll(token, job["jobId"])
    assert out["state"] == "failed" and out["error"]["code"] == "timeout" and out["error"]["retryable"]
    assert out["error"]["message"] == "Runway could not take it in time (Runway answered 429). Try again."
    assert left(h, job, "video") == 6 and h.store.counters("spend").get("usd", 0) == 0


def test_a_runway_outage_without_retry_after_still_fails_at_once():
    h = runway_only()
    token = h.sign_in()
    h.providers["runway"].submit_effect = ProviderError("provider_unavailable", "Runway answered 503", retryable=True)
    job = clip(h, token)
    assert job["state"] == "failed" and job["error"]["code"] == "provider_unavailable"


def test_runway_alone_refusing_names_runway_once():
    h = runway_only()
    token = h.sign_in()
    h.providers["runway"].submit_effect = CapabilityMissing("runway takes at most 3 refs")
    job = clip(h, token)
    msg = job["error"]["message"]
    assert job["state"] == "failed" and job["error"]["code"] == "capability_missing"
    assert msg.startswith("Runway cannot do this clip: it takes at most 3 refs.") and "could not make it" not in msg
    assert "fallbackReason" not in job


# ── failures after submit ───────────────────────────────────────────────────
def test_a_provider_failure_after_submit_keeps_its_retryable_flag_and_gives_the_quota_back():
    h = runway_only()
    token = h.sign_in()
    job = clip(h, token)
    assert left(h, job, "video") == 5
    h.providers["runway"].states[job["requestId"]] = Status(
        state="failed", error_code="provider_failed", error_message="Runway could not make a usable clip.",
        provider_code="INTERNAL.BAD_OUTPUT.CODE01", retryable=False, source="provider")
    h.clock.tick(6)
    out = h.poll(token, job["jobId"])
    assert out["state"] == "failed" and out["error"]["retryable"] is False
    assert left(h, job, "video") == 6


def test_a_failure_caused_by_the_input_keeps_the_quota():
    h = runway_only()
    token = h.sign_in()
    job = clip(h, token)
    h.providers["runway"].states[job["requestId"]] = Status(
        state="failed", error_code="invalid_input", error_message="The frame could not be read.",
        provider_code="ASSET.INVALID", retryable=False, source="input")
    h.clock.tick(6)
    out = h.poll(token, job["jobId"])
    assert out["state"] == "failed"
    assert left(h, job, "video") == 5


def test_a_job_that_never_left_the_providers_queue_is_not_charged_at_the_timeout():
    h = runway_only()
    token = h.sign_in()
    job = clip(h, token)
    rid = job["requestId"]
    reserved = h.store.counters("spend")["usd"]
    assert reserved > 0
    h.providers["runway"].states[rid] = Status(state="queued", queue_position=3)  # THROTTLED at Runway
    for _ in range(3):
        h.clock.tick(6)
        h.poll(token, job["jobId"])
    h.clock.tick(h.cfg["jobTimeoutS"]["video"])
    out = h.poll(token, job["jobId"])
    assert out["state"] == "failed" and out["error"]["code"] == "timeout"
    assert h.store.counters("spend")["usd"] == pytest.approx(0)
    assert left(h, job, "video") == 6
    assert rid in h.providers["runway"].cancels


def test_a_job_that_ran_keeps_its_charge_at_the_timeout():
    h = runway_only()
    token = h.sign_in()
    job = clip(h, token)
    reserved = h.store.counters("spend")["usd"]
    h.clock.tick(6)
    h.poll(token, job["jobId"])  # running
    h.clock.tick(h.cfg["jobTimeoutS"]["video"])
    out = h.poll(token, job["jobId"])
    assert out["state"] == "failed" and out["error"]["code"] == "timeout"
    assert h.store.counters("spend")["usd"] == pytest.approx(reserved)
    assert left(h, job, "video") == 5


# ── refused before any charge ───────────────────────────────────────────────
def test_a_clip_whose_frame_is_a_video_is_refused_before_quota(h):
    token = h.sign_in()
    _, out = h.post_job(token, op="clip", expect=400, image=asset(3, "video/mp4"))
    assert out["error"]["code"] == "invalid_input" and "frame" in out["error"]["message"]
    assert h.relay.remaining(participant_id("alice"), "participant")["video"] == 6
    assert h.store.counters("spend").get("usd", 0) == 0


def test_a_clip_with_no_frame_and_no_ref_is_refused(h):
    token = h.sign_in()
    _, out = h.post_job(token, op="clip", expect=400, text="a clip of nothing")
    assert out["error"]["code"] == "invalid_input" and "no frame" in out["error"]["message"]


def test_a_clip_edit_with_no_region_is_a_feel_edit_for_its_switch(h):
    token = h.sign_in()
    assert not h.cfg["flags"]["feelEdit"]
    _, out = h.post_job(token, op="clip_edit", expect=403, video=asset(5, "video/mp4"), text="make it golden")
    assert out["error"]["code"] == "flag_off" and "Feel edits" in out["error"]["message"]


def test_a_lone_surrogate_is_refused_as_invalid_input(h):
    token = h.sign_in()
    req = job_request("clip", new_id("job"), image=asset(3), text="a clip \ud83d")
    _, out = h.call("POST", "/jobs", req, token, expect=400)
    assert out["error"]["code"] == "invalid_input" and "half an emoji" in out["error"]["message"]


# ── uploads ─────────────────────────────────────────────────────────────────
def test_an_upload_of_a_blob_the_relay_made_is_already_there(h):
    token = h.sign_in()
    sha = "sha256:" + "d" * 64
    h.blobs.put(f"out/{sha}", b"mp4", "video/mp4")
    _, out = h.call("POST", "/uploads", {"sha256": sha, "mime": "video/mp4", "bytes": 3}, token, expect=200)
    assert out == {"exists": True, "url": f"{CDN}/out/{sha}"}


def test_the_seam_carries_retry_after_from_the_adapter():
    from providers import _seam, types
    out = _seam._error(types.ProviderError("provider_unavailable", "Runway answered 429", True, retry_after_s=12))
    assert out.retry_after_s == 12 and out.retryable and not out.accepted
