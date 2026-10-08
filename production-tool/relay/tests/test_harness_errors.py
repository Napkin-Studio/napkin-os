"""Who a failure belongs to, whether it may have reached the provider, and whether trying
again can help (features/harness-errors.clan): the adapters set it, the seam carries it."""

import io

import httpx
import pytest
from PIL import Image

from director.base import PassthroughDirector, fit_duration
from providers import AssetRef, ProviderError, ProviderJob, Ref, base, load_sheet
from providers._seam import Adapted, Resolver, to_status
from providers.fal import FalProvider, queue_app
from providers.heygen import HeyGenProvider
from providers.runway import RunwayProvider
from providers.types import Status
from test_fal import HERO, KEY, KLING_IMAGE, MASK, Fal, resolver
from test_fal import job as fal_job


def _png() -> bytes:
    out = io.BytesIO()
    Image.new("RGB", (64, 48)).save(out, format="PNG")
    return out.getvalue()


def _client(handler) -> httpx.Client:
    return httpx.Client(transport=httpx.MockTransport(handler))


def _down(request):
    raise httpx.ConnectError("nodename nor servname provided, or not known")


# ── the error type ──────────────────────────────────────────────────────────
def test_source_follows_the_code_unless_set():
    assert ProviderError("invalid_input", "x").source == "input"
    assert ProviderError("moderated", "x").source == "input"
    assert ProviderError("internal", "x").source == "napkin"
    assert ProviderError("provider_unavailable", "x").source == "provider"
    assert ProviderError("provider_unavailable", "x", source="network").source == "network"
    assert ProviderError("x", "y").to_dict()["source"] == "provider"
    with pytest.raises(ValueError):
        ProviderError("internal", "x", source="the moon")


# ── the seam ────────────────────────────────────────────────────────────────
class Raises:
    name = "fake"

    def __init__(self, error):
        self.error = error

    def capabilities(self):
        return {}

    def submit(self, job):
        raise self.error


def _submit_through_seam(error: Exception) -> base.ProviderError:
    base.set_job_context("generate", [])
    with pytest.raises(base.ProviderError) as e:
        Adapted(Raises(error)).submit({"provider": "fake", "model": "m", "prompt": "p", "refs": []})
    return e.value


def _raised_from(error: ProviderError, cause: Exception) -> ProviderError:
    try:
        raise error from cause
    except ProviderError as e:
        return e


def test_the_seam_carries_source_retryable_and_accepted():
    out = _submit_through_seam(ProviderError("provider_failed", "no id", False, accepted=True))
    assert (out.code, out.accepted, out.source) == ("provider_failed", True, "provider")
    out = _submit_through_seam(ProviderError("provider_unavailable", "down", True, source="network"))
    assert (out.retryable, out.accepted, out.source) == (True, False, "network")


def test_a_timeout_mid_call_to_the_provider_may_have_reached_it_but_one_on_our_own_asset_did_not():
    sent = _raised_from(ProviderError("provider_unavailable", "fal timed out", True, source="network"), httpx.ReadTimeout("t"))
    assert _submit_through_seam(sent).accepted is True
    ours = _raised_from(ProviderError("internal", "could not read our asset", True, source="napkin"), httpx.ReadTimeout("t"))
    assert _submit_through_seam(ours).accepted is False


def test_a_failed_status_keeps_its_retryable_and_source():
    st = to_status(Status("failed", error=ProviderError("provider_failed", "runner gone", True)))
    assert (st.state, st.retryable, st.source) == ("failed", True, "provider")
    st = to_status(Status("failed", error=ProviderError("internal", "our route", False, source="napkin")))
    assert (st.retryable, st.source) == (False, "napkin")


def test_an_asset_the_relay_never_named_is_our_bug_not_the_participants():
    base.set_job_context("generate", [])
    with pytest.raises(ProviderError) as e:
        Resolver()("sha256:" + "f" * 64)
    assert (e.value.code, e.value.source) == ("internal", "napkin")


# ── HeyGen ──────────────────────────────────────────────────────────────────
def _asset(sha: str) -> AssetRef:
    return AssetRef(sha, f"https://cdn.test/{sha[-8:]}.png", "image/png")


def _heygen(handler) -> HeyGenProvider:
    return HeyGenProvider("hg_key", _asset, client=_client(handler))


def _clip() -> ProviderJob:
    return ProviderJob(op="clip", provider="heygen", model="heygen-video-1", prompt="a slow push in",
                       first_frame="sha256:" + "a" * 64, duration_s=8)


def test_heygen_unreachable_before_sending_falls_back_instead_of_going_uncertain():
    with pytest.raises(ProviderError) as e:
        _heygen(_down).submit(_clip())
    assert (e.value.code, e.value.retryable, e.value.accepted, e.value.source) == (
        "provider_unavailable", True, False, "network")
    with pytest.raises(ProviderError) as e:
        _heygen(_down).status("vid_1")
    assert e.value.retryable  # the relay asks again


@pytest.mark.parametrize("status", [401, 402, 403])
def test_heygen_account_problems_stay_precise_for_the_relay_and_own_keys(status):
    with pytest.raises(ProviderError) as e:
        _heygen(lambda r: httpx.Response(status, json={"error": {"message": "no"}})).submit(_clip())
    assert (e.value.code, e.value.provider_code, e.value.source, e.value.accepted) == (
        "provider_failed", str(status), "provider", False)


def test_heygen_status_404_on_our_video_id_ends_the_job_as_our_bug():
    st = _heygen(lambda r: httpx.Response(404, json={"error": {"message": "not found"}})).status("vid_1")
    assert (st.state, st.error.code, st.error.source, st.error.retryable) == ("failed", "internal", "napkin", False)


def test_heygen_2xx_without_a_video_id_is_accepted():
    with pytest.raises(ProviderError) as e:
        _heygen(lambda r: httpx.Response(200, json={"data": {}})).submit(_clip())
    assert e.value.accepted


# ── Runway ──────────────────────────────────────────────────────────────────
def _runway(handler) -> RunwayProvider:
    return RunwayProvider("key_test", _asset, client=_client(handler))


def _image_job() -> ProviderJob:
    return ProviderJob(op="generate", provider="runway", model="gemini_image3.1_flash", prompt="@hero waves",
                       refs=[Ref("sha256:" + "a" * 64, "hero", "character")], ratio="1024:1024")


def test_runway_unreachable_is_a_network_problem():
    with pytest.raises(ProviderError) as e:
        _runway(_down).submit(_image_job())
    assert (e.value.code, e.value.source, e.value.accepted) == ("provider_unavailable", "network", False)


@pytest.mark.parametrize("status", [401, 403])
def test_runway_key_problems_carry_their_status(status):
    with pytest.raises(ProviderError) as e:
        _runway(lambda r: httpx.Response(status, json={"error": "bad key"})).submit(_image_job())
    assert (e.value.code, e.value.provider_code, e.value.source) == ("provider_failed", str(status), "provider")


def test_runway_status_404_on_our_task_ends_the_job_as_our_bug():
    st = _runway(lambda r: httpx.Response(404, json={"error": "no such task"})).status("task_1")
    assert (st.state, st.error.code, st.error.source, st.error.retryable) == ("failed", "provider_failed", "napkin", False)


# ── fal ─────────────────────────────────────────────────────────────────────
def _fal(fake: Fal) -> FalProvider:
    return FalProvider(KEY, resolver, client=_client(fake))


def test_fal_reading_our_own_asset_times_out_is_ours_and_never_marked_sent():
    def handler(request):
        if request.url.host == "cdn.test":
            raise httpx.ReadTimeout("our CDN was slow")
        return httpx.Response(200, json={"request_id": "r1"})
    region = fal_job(op="region_edit", mask=MASK, refs=[Ref(HERO, "marked", "current")])
    with pytest.raises(ProviderError) as e:
        FalProvider(KEY, resolver, client=_client(handler)).submit(region)
    assert (e.value.code, e.value.source, e.value.retryable) == ("internal", "napkin", True)
    out = _submit_through_seam(e.value)
    assert out.accepted is False


def test_fal_an_image_we_cannot_read_is_the_inputs_problem_before_any_call():
    fake = Fal(**{HERO[7:11]: b"not an image", MASK[7:11]: _png()})
    with pytest.raises(ProviderError) as e:
        _fal(fake).submit(fal_job(op="region_edit", mask=MASK, refs=[Ref(HERO, "marked", "current")]))
    assert (e.value.code, e.value.accepted) == ("invalid_input", False)
    assert not fake.fal_requests


def test_fal_2xx_without_a_request_id_is_accepted():
    fake = Fal()
    fake.on("POST", KLING_IMAGE, 200, {"status": "IN_QUEUE"})
    with pytest.raises(ProviderError) as e:
        _fal(fake).submit(fal_job())
    assert e.value.accepted


def test_fal_404_or_405_is_our_route_not_the_participants_input():
    fake = Fal()
    fake.on("POST", KLING_IMAGE, 405, {"detail": "Method Not Allowed"})
    with pytest.raises(ProviderError) as e:
        _fal(fake).submit(fal_job())
    assert (e.value.code, e.value.source) == ("internal", "napkin")
    fake = Fal()
    provider = _fal(fake)
    rid = provider.submit(fal_job())
    fake.on("GET", f"{queue_app(KLING_IMAGE)}/requests/req1/status", 404, {"detail": "Not Found"})
    st = provider.status(rid)
    assert (st.state, st.error.code, st.error.source) == ("failed", "internal", "napkin")


@pytest.mark.parametrize("error_type,code,source,retryable", [
    ("image_too_large", "invalid_input", "input", False),
    ("unsupported_image_format", "invalid_input", "input", False),
    ("sequence_too_long", "invalid_input", "input", False),
    ("one_of", "invalid_input", "input", False),
    ("file_download_error", "internal", "napkin", True),
    ("no_media_generated", "provider_failed", "provider", False),
])
def test_fal_documented_422_types_go_to_the_right_party(error_type, code, source, retryable):
    fake = Fal()
    fake.on("POST", KLING_IMAGE, 422, {"detail": [{"type": error_type, "msg": "fal says no", "loc": ["body"]}]})
    with pytest.raises(ProviderError) as e:
        _fal(fake).submit(fal_job())
    assert (e.value.code, e.value.source, e.value.retryable) == (code, source, retryable)


def test_fal_transient_runner_failures_can_be_tried_again():
    fake = Fal()
    provider = _fal(fake)
    rid = provider.submit(fal_job())
    fake.on("GET", f"{queue_app(KLING_IMAGE)}/requests/req1/status", 200,
            {"status": "COMPLETED", "error": "the runner did not start", "error_type": "startup_timeout"})
    st = provider.status(rid)
    assert (st.state, st.error.code, st.error.retryable) == ("failed", "provider_failed", True)


# ── the director fits the clip length ───────────────────────────────────────
def test_fit_duration():
    veo = {"durationsS": [4, 6, 8]}
    assert [fit_duration(s, veo) for s in (4, 5, 7, 10)] == [4, 6, 8, 8]
    heygen = {"minS": 5, "maxS": 15}
    assert [fit_duration(s, heygen) for s in (4, 4.5, 5, 9.2, 20)] == [5, 5, 5, 10, 15]
    assert fit_duration(3.5, {}) == 3.5


def test_passthrough_fits_a_short_shot_to_heygen_instead_of_failing():
    out = PassthroughDirector().direct(
        {"op": "clip", "input": {"image": {"sha256": "sha256:" + "a" * 64}, "shot": {"duration_s": 4, "action": "walks"}}},
        load_sheet("heygen"))
    assert out["providerJob"]["durationS"] == 5
