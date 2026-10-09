"""Runway is the floor of every job (features/runway-fallback.clan, owner's rule of 2026-10-09):
model_to_use = the participant gave a HeyGen/fal key ? that provider : Runway (the event's key); any
failure on HeyGen/fal except moderation or invalid input is made again on Runway, once, automatically."""

import copy
import json

import pytest

import own_keys
from conftest import Harness, job_request
from contracts_dir import contracts_dir
from director import new_id
from providers.base import CapabilityMissing, Moderated, ProviderError, Status
from test_own_keys import FAL_KEY, HEYGEN_KEY, OwnFakes, keys

PROVIDER_OPS = ("generate", "view", "frame", "region_edit", "clip", "clip_edit")
RUNWAY_PRICE = {"generate": 0.2, "clip": 1.2}


def event_config() -> dict:
    cfg = json.loads((contracts_dir() / "examples" / "config.event.json").read_text())
    cfg["inFlightPerParticipant"] = 6
    return cfg


def harness(cfg: dict | None = None) -> tuple[Harness, OwnFakes]:
    h = Harness(cfg or event_config(), providers=("fal", "heygen", "runway"))
    fakes = OwnFakes(h.blobs)
    h.relay._own_adapters = own_keys.OwnAdapters(sheets=fakes.sheets, make=fakes)
    return h, fakes


def own(h: Harness, fakes: OwnFakes, provider: str, key: str):
    h.relay.own_adapters.get(provider, key)  # build it now so the test can tell it what to do
    return fakes.one(provider, key)


def post(h, token, op="generate", headers=None, pick=None, expect=200, job_id=None):
    req = job_request(op, job_id or new_id("job"))
    if pick:
        req["modelChoice"] = pick
    return h.call("POST", "/jobs", req, token, expect=expect, headers=headers)[1]


def quota_left(h, job, cls="image"):
    return h.relay.remaining(job["participantId"], "participant")[cls]


# ── the chain ───────────────────────────────────────────────────────────────
def test_the_event_routes_every_step_to_runway_alone():
    cfg = event_config()
    assert all(cfg["routing"][op] == ["runway"] for op in PROVIDER_OPS)
    assert "fallbackOnly" not in cfg


@pytest.mark.parametrize("op", ["generate", "view", "clip"])
def test_no_keys_runs_every_step_on_runway(op):
    h, fakes = harness()
    job = post(h, h.sign_in(), op)
    assert (job["state"], job["provider"], job["keySource"]) == ("submitted", "runway", "event")
    assert "fallbackFrom" not in job
    assert not h.providers["fal"].submits and not h.providers["heygen"].submits and not fakes.made


def test_the_chain_is_the_key_providers_then_runway():
    h, _ = harness()
    cfg = h.cfg
    chain = h.relay._chain
    for op in PROVIDER_OPS:
        assert chain(cfg, op, None, None) == ["runway"]
    assert chain(cfg, "clip", None, {"heygen": "k", "fal": "k"}) == ["heygen", "fal", "runway"]
    assert chain(cfg, "frame", None, {"fal": "k"}) == ["fal", "runway"]
    assert chain(cfg, "clip", {"provider": "fal", "model": "veo3.1-i2v"}, {"fal": "k"}) == ["fal", "runway"]


def test_a_heygen_key_runs_clips_on_heygen():
    h, fakes = harness()
    job = post(h, h.sign_in(), "clip", headers=keys(heygen=HEYGEN_KEY))
    assert (job["provider"], job["keySource"]) == ("heygen", "own")
    assert len(fakes.one("heygen", HEYGEN_KEY).submits) == 1 and not h.providers["runway"].submits


# ── every failure on a key provider falls back to Runway ────────────────────
def test_heygen_out_of_credit_at_submit_is_made_on_runway():
    h, fakes = harness()
    token = h.sign_in()
    own(h, fakes, "heygen", HEYGEN_KEY).submit_effect = ProviderError(
        "provider_failed", "HeyGen credit is exhausted", provider_code="402")
    job = post(h, token, "clip", headers=keys(heygen=HEYGEN_KEY))
    assert (job["state"], job["provider"], job["model"], job["keySource"]) == ("submitted", "runway", "veo3.1", "event")
    assert job["fallbackFrom"] == {"provider": "heygen", "model": "heygen-video-1"}
    assert job["fallbackReason"] == "HeyGen could not make it: HeyGen credit is exhausted."
    assert len(h.providers["runway"].submits) == 1


def test_fal_failing_after_submit_is_made_on_runway():
    h, fakes = harness()
    token = h.sign_in()
    job = post(h, token, headers=keys(fal=FAL_KEY))
    fal = fakes.one("fal", FAL_KEY)
    fal.states[job["requestId"]] = Status(state="failed", error_code="provider_failed", error_message="runner crashed")
    h.clock.tick(3)
    out = h.poll(token, job["jobId"])
    assert (out["state"], out["provider"], out["keySource"]) == ("submitted", "runway", "event")
    assert out["fallbackFrom"] == {"provider": "fal", "model": "nano-banana-pro-edit"}
    assert out["fallbackReason"] == "fal could not make it: runner crashed."
    assert "error" not in out and out["requestId"].startswith("runway-")
    h.providers["runway"].succeed(out["requestId"])
    h.clock.tick(5)
    done = h.poll(token, job["jobId"])
    assert (done["state"], done["provider"], done["fallbackFrom"]["provider"]) == ("completed", "runway", "fal")


def test_fal_timing_out_is_cancelled_there_and_made_on_runway():
    h, fakes = harness()
    token = h.sign_in()
    job = post(h, token, headers=keys(fal=FAL_KEY))
    h.clock.tick(h.cfg["jobTimeoutS"]["image"] + 1)
    out = h.poll(token, job["jobId"])
    assert (out["state"], out["provider"]) == ("submitted", "runway")
    assert fakes.one("fal", FAL_KEY).cancels == [job["requestId"]]
    assert out["fallbackReason"].startswith("fal could not make it: The provider took too long")
    # Runway gets its own time: the job does not time out at once for having waited on fal.
    h.clock.tick(5)
    assert h.poll(token, job["jobId"])["state"] == "submitted"


def test_fal_uncertain_is_made_on_runway_and_says_fal_may_still_charge():
    h, fakes = harness()
    token = h.sign_in()
    own(h, fakes, "fal", FAL_KEY).submit_effect = ProviderError(
        "provider_unavailable", "timed out", retryable=True, accepted=True)
    job = post(h, token, headers=keys(fal=FAL_KEY))
    assert (job["state"], job["provider"]) == ("submitted", "runway")
    assert "fal may still charge your account for its attempt." in job["fallbackReason"]
    assert len(fakes.one("fal", FAL_KEY).submits) == 1  # never sent to fal again


def test_a_submit_that_never_came_back_is_made_on_runway():
    h, fakes = harness()
    token = h.sign_in()
    job = post(h, token, headers=keys(fal=FAL_KEY))
    stored = h.store.get_job(job["jobId"])
    h.store.save_job({**stored, "state": "submitting", "requestId": None})
    h.clock.tick(200)
    out = h.poll(token, job["jobId"])
    assert (out["state"], out["provider"]) == ("submitted", "runway")
    assert "may still charge" in out["fallbackReason"]


def test_fal_refusing_on_its_sheet_is_made_on_runway():
    h, fakes = harness()
    token = h.sign_in()
    own(h, fakes, "fal", FAL_KEY).submit_effect = CapabilityMissing("fal takes at most 4 character refs")
    job = post(h, token, headers=keys(fal=FAL_KEY))
    assert (job["state"], job["provider"], job["keySource"]) == ("submitted", "runway", "event")
    assert job["fallbackFrom"]["provider"] == "fal"
    assert job["fallbackReason"] == "fal could not make it: fal takes at most 4 character refs."


def test_heygen_then_fal_then_runway_before_submit():
    h, fakes = harness()
    token = h.sign_in()
    own(h, fakes, "heygen", HEYGEN_KEY).submit_effect = ProviderError("provider_unavailable", "busy", retryable=True)
    own(h, fakes, "fal", FAL_KEY).submit_effect = ProviderError("queue_full", "full", retryable=True)
    job = post(h, token, "clip", headers=keys(heygen=HEYGEN_KEY, fal=FAL_KEY))
    assert (job["provider"], job["keySource"]) == ("runway", "event")
    assert job["fallbackFrom"]["provider"] == "heygen"


def test_heygen_failing_after_submit_goes_straight_to_runway_not_to_fal():
    h, fakes = harness()
    token = h.sign_in()
    job = post(h, token, "clip", headers=keys(heygen=HEYGEN_KEY, fal=FAL_KEY))
    fakes.one("heygen", HEYGEN_KEY).states[job["requestId"]] = Status(state="failed", error_code="provider_failed",
                                                                       error_message="render failed")
    h.clock.tick(6)
    out = h.poll(token, job["jobId"])
    assert out["provider"] == "runway"
    assert ("fal", FAL_KEY) not in fakes.made or not fakes.one("fal", FAL_KEY).submits


def test_a_pick_on_fal_with_a_key_falls_back_to_runway_default():
    h, fakes = harness()
    token = h.sign_in()
    pick = {"provider": "fal", "model": "veo3.1-fast-i2v"}
    own(h, fakes, "fal", FAL_KEY).submit_effect = ProviderError("provider_failed", "fal rejected the API key")
    job = post(h, token, "clip", headers=keys(fal=FAL_KEY), pick=pick)
    assert (job["provider"], job["model"], job["fallbackFrom"]) == ("runway", "veo3.1", pick)
    assert "Your fal key was refused" in job["fallbackReason"]


# ── no fallback ─────────────────────────────────────────────────────────────
def test_moderated_at_submit_never_falls_back():
    h, fakes = harness()
    token = h.sign_in()
    own(h, fakes, "fal", FAL_KEY).submit_effect = Moderated(provider_code="content_policy_violation")
    job = post(h, token, headers=keys(fal=FAL_KEY))
    assert job["state"] == "failed" and job["error"]["code"] == "moderated"
    assert not h.providers["runway"].submits


def test_moderated_after_submit_never_falls_back():
    h, fakes = harness()
    token = h.sign_in()
    job = post(h, token, headers=keys(fal=FAL_KEY))
    fakes.one("fal", FAL_KEY).states[job["requestId"]] = Status(state="moderated", provider_code="x")
    h.clock.tick(3)
    assert h.poll(token, job["jobId"])["error"]["code"] == "moderated"
    assert not h.providers["runway"].submits


@pytest.mark.parametrize("where", ["submit", "status"])
def test_invalid_input_never_falls_back(where):
    h, fakes = harness()
    token = h.sign_in()
    fal = own(h, fakes, "fal", FAL_KEY)
    if where == "submit":
        fal.submit_effect = ProviderError("invalid_input", "the image is not readable")
        job = post(h, token, headers=keys(fal=FAL_KEY))
    else:
        job = post(h, token, headers=keys(fal=FAL_KEY))
        fal.states[job["requestId"]] = Status(state="failed", error_code="invalid_input", error_message="bad prompt")
        h.clock.tick(3)
        job = h.poll(token, job["jobId"])
    assert job["state"] == "failed" and job["error"]["code"] == "invalid_input"
    assert not h.providers["runway"].submits


def test_runway_failing_fails_the_job():
    h, fakes = harness()
    token = h.sign_in()
    job = post(h, token)
    h.providers["runway"].states[job["requestId"]] = Status(state="failed", error_code="provider_failed",
                                                            error_message="boom")
    h.clock.tick(6)
    out = h.poll(token, job["jobId"])
    assert out["state"] == "failed" and out["error"]["message"] == "boom"
    assert len(h.providers["runway"].submits) == 1


def test_runway_failing_after_a_fallback_fails_the_job_and_tries_nothing_more():
    h, fakes = harness()
    token = h.sign_in()
    own(h, fakes, "fal", FAL_KEY).submit_effect = ProviderError("provider_unavailable", "down", retryable=True)
    job = post(h, token, headers=keys(fal=FAL_KEY))
    h.providers["runway"].states[job["requestId"]] = Status(state="failed", error_code="provider_failed",
                                                            error_message="boom")
    h.clock.tick(6)
    out = h.poll(token, job["jobId"])
    assert out["state"] == "failed" and out["provider"] == "runway"
    assert len(h.providers["runway"].submits) == 1 and len(fakes.one("fal", FAL_KEY).submits) == 1


def test_runway_unable_to_do_the_step_fails_clearly():
    h, fakes = harness()
    token = h.sign_in()
    own(h, fakes, "fal", FAL_KEY).submit_effect = ProviderError("provider_failed", "fal is out of credit",
                                                                provider_code="402")
    h.providers["runway"].submit_effect = CapabilityMissing("clip_edit takes no mask")
    job = post(h, token, headers=keys(fal=FAL_KEY))
    err = job["error"]
    assert job["state"] == "failed" and err["code"] == "capability_missing" and not err["retryable"]
    assert err["message"].startswith("fal could not make it: fal is out of credit. Runway cannot do this step either: ")
    assert h.store.counters("spend").get("usd", 0) == 0
    assert quota_left(h, job) == 40  # given back: nothing was made


def test_runway_busy_after_a_fallback_names_both():
    h, fakes = harness()
    token = h.sign_in()
    own(h, fakes, "fal", FAL_KEY).submit_effect = ProviderError("provider_failed", "fal is out of credit")
    h.providers["runway"].submit_effect = ProviderError("provider_unavailable", "503 from runway", retryable=True)
    job = post(h, token, headers=keys(fal=FAL_KEY))
    assert job["error"]["code"] == "provider_unavailable" and job["error"]["retryable"]
    assert job["error"]["message"] == ("fal could not make it: fal is out of credit. Runway could not take it either "
                                       "(503 from runway). Try again.")


# ── spend, quota and slots ──────────────────────────────────────────────────
def test_a_fallback_counts_as_an_event_runway_job():
    h, fakes = harness()
    token = h.sign_in()
    job = post(h, token, headers=keys(fal=FAL_KEY))
    pid = job["participantId"]
    assert (job["keySource"], job["cost"]["reserved"]) == ("own", 0)
    assert h.store.counters("spend").get("usd", 0) == 0 and quota_left(h, job) == 40
    fakes.one("fal", FAL_KEY).states[job["requestId"]] = Status(state="failed", error_code="provider_failed",
                                                                 error_message="x")
    h.clock.tick(3)
    out = h.poll(token, job["jobId"])
    assert (out["keySource"], out["cost"]["reserved"]) == ("event", RUNWAY_PRICE["generate"])
    assert h.store.counters("spend")["usd"] == pytest.approx(RUNWAY_PRICE["generate"])
    assert quota_left(h, job) == 39
    assert h.store.counters(f"slots#fal#own#{pid}#image")["n"] == 0
    assert h.store.counters("slots#runway#image")["n"] == 1
    h.providers["runway"].succeed(out["requestId"], cost=0.18)
    h.clock.tick(5)
    done = h.poll(token, job["jobId"])
    assert done["state"] == "completed" and done["cost"]["confirmed"] == 0.18
    assert h.store.counters("spend")["usd"] == pytest.approx(0.18)
    assert h.store.counters("slots#runway#image")["n"] == 0
    assert h.store.counters(f"inflight#{pid}")["n"] == 0


def test_a_fallback_refused_by_the_quota_says_why():
    h, fakes = harness()
    h.cfg["quotas"] = {**h.cfg["quotas"], "image": 0}
    token = h.sign_in()
    own(h, fakes, "fal", FAL_KEY).submit_effect = ProviderError("provider_failed", "fal is out of credit")
    job = post(h, token, headers=keys(fal=FAL_KEY))
    assert job["state"] == "failed" and job["error"]["code"] == "quota_exhausted"
    assert job["error"]["message"] == ("fal could not make it: fal is out of credit. Runway could not make it instead: "
                                       "you have used today's image quota.")
    assert not h.providers["runway"].submits
    assert h.store.counters("slots#runway#image").get("n", 0) == 0
    assert h.store.counters(f"inflight#{job['participantId']}")["n"] == 0


def test_a_fallback_stops_at_the_spend_stop():
    h, fakes = harness()
    h.cfg["spend"] = {"capUsd": 1, "warnUsd": 1}
    h.store.incr("spend", "usd", 5)
    token = h.sign_in()
    own(h, fakes, "fal", FAL_KEY).submit_effect = ProviderError("provider_failed", "fal is out of credit")
    job = post(h, token, headers=keys(fal=FAL_KEY))
    assert job["state"] == "failed" and job["error"]["code"] == "spend_stop"
    assert not h.providers["runway"].submits
    assert quota_left(h, job) == 40


def test_an_event_job_refused_before_acceptance_gives_its_reservation_back():
    # On a config that still routes fal on the event key: fal's reservation is given back, Runway's taken.
    cfg = event_config()
    cfg["routing"]["generate"] = ["fal", "runway"]
    h, _ = harness(cfg)
    token = h.sign_in()
    h.providers["fal"].submit_effect = ProviderError("provider_failed", "fal is out of credit", provider_code="402")
    job = post(h, token)
    assert (job["provider"], job["keySource"], job["fallbackFrom"]["provider"]) == ("runway", "event", "fal")
    assert h.store.counters("spend")["usd"] == pytest.approx(RUNWAY_PRICE["generate"])
    assert quota_left(h, job) == 39  # one job, counted once


# ── picks ───────────────────────────────────────────────────────────────────
@pytest.mark.parametrize("pick,given,ok", [
    ({"provider": "runway", "model": "veo3.1"}, {}, True),
    ({"provider": "runway", "model": "veo3.1_fast"}, {}, True),               # an alternate
    ({"provider": "runway", "model": "veo3.1_fast"}, {"fal": FAL_KEY}, True),
    ({"provider": "fal", "model": "veo3.1-fast-i2v"}, {}, False),             # fal without a key
    ({"provider": "heygen", "model": "heygen-video-1"}, {}, False),           # HeyGen without a key
    ({"provider": "fal", "model": "veo3.1-fast-i2v"}, {"fal": FAL_KEY}, True),
    ({"provider": "heygen", "model": "heygen-video-1"}, {"heygen": HEYGEN_KEY}, True),
    ({"provider": "heygen", "model": "heygen-video-1"}, {"fal": FAL_KEY}, False),
])
def test_runway_is_always_pickable_and_fal_or_heygen_only_on_a_key(pick, given, ok):
    h, _ = harness()
    out = post(h, h.sign_in(), "clip", headers=keys(**given) if given else None, pick=pick,
               expect=200 if ok else 400)
    if ok:
        assert (out["provider"], out["model"]) == (pick["provider"], pick["model"])
        assert out["keySource"] == ("event" if pick["provider"] == "runway" else "own")
    else:
        assert out["error"]["code"] == "invalid_input"


def test_without_runway_routed_there_is_no_floor():
    cfg = copy.deepcopy(event_config())
    cfg["routing"]["clip"] = ["heygen"]
    h, fakes = harness(cfg)
    token = h.sign_in()
    own(h, fakes, "heygen", HEYGEN_KEY).submit_effect = ProviderError("provider_failed", "HeyGen credit is exhausted",
                                                                      provider_code="402")
    job = post(h, token, "clip", headers=keys(heygen=HEYGEN_KEY))
    assert job["state"] == "failed" and not h.providers["runway"].submits
