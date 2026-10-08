"""A model the participant picks when regenerating (features/model-choice.clan): the relay runs
it on its provider, falls back to the fallback-only provider's default when that provider cannot
take it, and refuses a pick the routing or the sheet does not allow before any spend."""

import importlib

import httpx
import pytest

from conftest import Harness, base_config, job_request, sheets
from director import new_id
from providers import ProviderJob, Ref, load_sheet
from providers.base import ProviderError
from providers.fal import FalProvider
from providers.types import effective_sheet, op_models
from test_fal import FRAME, HERO, KEY, Fal, resolver

VEO = {"provider": "fal", "model": "veo3.1-i2v"}


def config(**over):
    cfg = base_config(**over)
    cfg["routing"]["clip"] = ["fal", "heygen", "runway"]
    cfg["routing"]["frame"] = ["fal", "runway"]
    cfg.setdefault("fallbackOnly", ["runway"])
    return cfg


def harness(**over):
    return Harness(config(**over), providers=("fal", "heygen", "runway"))


def post(h, token, pick=None, op="clip", job_id=None, expect=200):
    req = job_request(op, job_id or new_id("job"))
    if pick:
        req["modelChoice"] = pick
    return h.call("POST", "/jobs", req, token, expect=expect)[1]


# ── the relay ───────────────────────────────────────────────────────────────
def test_a_pick_runs_on_its_provider_and_model_at_its_price():
    h = harness()
    job = post(h, h.sign_in(), VEO)
    assert (job["provider"], job["model"]) == ("fal", "veo3.1-i2v")
    assert job["cost"]["reserved"] == 2.4
    assert "fallbackFrom" not in job
    assert h.providers["fal"].submits[0]["model"] == "veo3.1-i2v"


def test_no_pick_routes_as_before():
    h = harness()
    job = post(h, h.sign_in())
    assert (job["provider"], job["model"]) == ("fal", "kling-v3-pro-i2v")
    assert job["cost"]["reserved"] == 0.56


def test_a_pick_its_provider_cannot_take_falls_back_to_runway_default():
    h = harness()
    h.providers["fal"].submit_effect = ProviderError("provider_unavailable", "503 from fal")
    job = post(h, h.sign_in(), VEO)
    assert (job["provider"], job["model"]) == ("runway", "veo3.1")
    assert job["fallbackFrom"] == VEO
    assert job["cost"]["reserved"] == 1.2  # settled at the provider that ran (Veo 3.1 on Runway)
    assert h.providers["heygen"].submits == []  # another picked-from provider is never tried


def test_a_failed_pick_without_fallback_only_providers_fails_and_tries_nothing_else():
    h = harness(fallbackOnly=[])
    h.providers["fal"].submit_effect = ProviderError("provider_unavailable", "503 from fal")
    job = post(h, h.sign_in(), VEO)
    assert job["state"] == "failed" and job["error"]["code"] == "provider_unavailable"
    assert h.providers["heygen"].submits == [] and h.providers["runway"].submits == []


@pytest.mark.parametrize("pick", [
    {"provider": "runway", "model": "veo3.1_fast"},     # fallback-only: never offered
    {"provider": "fal", "model": "seedance-2.0"},       # not on the sheet
    {"provider": "fal", "model": "nano-banana-pro-edit"},  # a frame model, not a clip one
])
def test_a_pick_the_routing_or_sheet_does_not_allow_is_refused_before_spend(pick):
    h = harness()
    jid = new_id("job")
    out = post(h, h.sign_in(), pick, job_id=jid, expect=400)
    assert out["error"]["code"] == "invalid_input"
    assert h.store.get_job(jid) is None
    assert h.store.counters("spend").get("usd", 0) == 0
    assert all(not p.submits for p in h.providers.values())


def test_a_pick_on_a_provider_the_op_does_not_route_is_refused():
    h = harness()
    out = post(h, h.sign_in(), {"provider": "heygen", "model": "heygen-video-1"}, op="generate", expect=400)
    assert out["error"]["code"] == "invalid_input"


# ── the effective sheet ─────────────────────────────────────────────────────
def test_effective_sheet_puts_the_alternate_over_the_op_and_the_sheet():
    fal = load_sheet("fal")
    veo = effective_sheet(fal, "clip", "veo3.1-i2v")
    assert veo["ops"]["clip"]["model"] == "veo3.1-i2v" and veo["ops"]["clip"]["durationsS"] == [4, 6, 8]
    assert "minS" not in veo["ops"]["clip"]  # its durations replace the op's
    assert veo["refs"]["max"] == 0 and veo["video"]["firstFrameWithRefs"] is False
    assert "alternates" not in veo["ops"]["clip"]
    assert fal["refs"]["max"] == 10  # the sheet itself is untouched
    # The op's own model carries its own settings (features/default-models.clan): Nano Banana Pro.
    for model in (None, "nano-banana-pro-edit"):
        nano = effective_sheet(fal, "frame", model)
        assert nano["tagSyntax"] == "image_n" and nano["seed"] is True and nano["refs"]["element"] is False
        assert nano["ops"]["frame"]["estimateUsd"] == 0.15
    kling = effective_sheet(fal, "frame", "kling-image-o3")  # an alternate keeps the sheet's Kling settings
    assert kling["tagSyntax"] == "at_image_n" and kling["refs"]["element"] is True
    assert kling["ops"]["frame"]["endpoint"] == "fal-ai/kling-image/o3/image-to-image"
    assert effective_sheet(fal, "clip", "kling-v3-pro-i2v") is fal
    assert effective_sheet(fal, "clip", None) is fal


def test_every_alternate_on_a_sheet_is_one_its_adapter_builds():
    for provider, sheet in sheets().items():
        built = importlib.import_module(f"providers.{provider}").ALTERNATES
        for op in sheet["ops"]:
            alternates = set(op_models(sheet, op)[1:])
            assert alternates <= built.get(op, set()), (provider, op, alternates)


# ── fal request bodies (shapes from fal's OpenAPI schemas, 2026-10-08) ───────
@pytest.fixture
def fal():
    return Fal()


@pytest.fixture
def provider(fal):
    return FalProvider(KEY, resolver, client=httpx.Client(transport=httpx.MockTransport(fal)))


def test_nano_banana_frame_names_refs_as_image_n(provider, fal):
    refs = [Ref(HERO, "hero", "character"), Ref(FRAME, "previous", "object")]
    provider.submit(ProviderJob(op="frame", provider="fal", model="nano-banana-pro-edit",
                                prompt="@hero waves; continue from @previous", refs=refs, ratio="4:5", outputs=2))
    assert fal.fal_requests[-1].url.path == "/fal-ai/nano-banana-pro/edit"
    body = fal.body()
    assert body["prompt"] == "image 1 waves; continue from image 2"
    assert body["image_urls"] == ["https://cdn.test/1111", "https://cdn.test/4444"]
    assert (body["aspect_ratio"], body["num_images"], body["resolution"]) == ("4:5", 2, "1K")
    assert "elements" not in body


def test_veo_clip_sends_the_frame_alone_with_a_seconds_duration(provider, fal):
    provider.submit(ProviderJob(op="clip", provider="fal", model="veo3.1-fast-i2v", prompt="she turns to the sea",
                                refs=[], first_frame=FRAME, duration_s=6, negative="blur", seed=7))
    assert fal.fal_requests[-1].url.path == "/fal-ai/veo3.1/fast/image-to-video"
    body = fal.body()
    assert body["image_url"] == "https://cdn.test/4444"
    assert (body["duration"], body["generate_audio"], body["aspect_ratio"]) == ("6s", False, "auto")
    assert (body["negative_prompt"], body["seed"]) == ("blur", 7)


def test_veo_clip_refuses_refs_and_odd_durations(provider):
    from providers import CapabilityMissing
    with pytest.raises(CapabilityMissing):
        provider.submit(ProviderJob(op="clip", provider="fal", model="veo3.1-i2v", prompt="runs",
                                    refs=[Ref(HERO, "hero", "character")], first_frame=FRAME, duration_s=6))
    with pytest.raises(CapabilityMissing):
        provider.submit(ProviderJob(op="clip", provider="fal", model="veo3.1-i2v", prompt="runs",
                                    refs=[], first_frame=FRAME, duration_s=5))


def test_an_alternate_result_is_priced_from_the_alternate(provider, fal):
    rid = provider.submit(ProviderJob(op="frame", provider="fal", model="nano-banana-2-edit", prompt="@hero",
                                      refs=[Ref(HERO, "hero", "character")]))
    endpoint, app, req = provider._split(rid)
    fal.on("GET", f"{app}/requests/{req}/status", 200, {"status": "COMPLETED"})
    fal.on("GET", f"{app}/requests/{req}", 200, {"images": [{"url": "https://v3.fal.media/a.png", "content_type": "image/png"}]})
    provider.status(rid)
    assert provider.status(rid).cost_usd == 0.08
