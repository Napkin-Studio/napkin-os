"""Who a failure belongs to, whether it may have reached the provider, and whether trying
again can help (features/harness-errors.clan): the adapters set it, the seam carries it."""

import httpx
import pytest

from director.base import PassthroughDirector, fit_duration
from providers import AssetRef, ProviderError, ProviderJob, Ref, base, load_sheet
from providers._seam import Adapted, Resolver, to_status
from providers.runway import RunwayProvider
from providers.types import Status


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
    sent = _raised_from(ProviderError("provider_unavailable", "the provider timed out", True, source="network"), httpx.ReadTimeout("t"))
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


def _asset(sha: str) -> AssetRef:
    return AssetRef(sha, f"https://cdn.test/{sha[-8:]}.png", "image/png")


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


# ── the director fits the clip length ───────────────────────────────────────
def test_fit_duration():
    veo = {"durationsS": [4, 6, 8]}
    assert [fit_duration(s, veo) for s in (4, 5, 7, 10)] == [4, 6, 8, 8]
    ranged = {"minS": 5, "maxS": 15}
    assert [fit_duration(s, ranged) for s in (4, 4.5, 5, 9.2, 20)] == [5, 5, 5, 10, 15]
    assert fit_duration(3.5, {}) == 3.5


def test_passthrough_fits_a_short_shot_to_the_sheet_instead_of_failing():
    out = PassthroughDirector().direct(
        {"op": "clip", "input": {"image": {"sha256": "sha256:" + "a" * 64}, "shot": {"duration_s": 5, "action": "walks"}}},
        load_sheet("runway"))
    assert out["providerJob"]["durationS"] == 6  # veo3.1 takes 4, 6 or 8 s
