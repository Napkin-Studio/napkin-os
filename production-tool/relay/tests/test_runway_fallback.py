"""Runway is the floor of every job (features/runway-fallback.clan, owner's rule of 2026-10-09): a
job runs on the first provider its routing (or a pick) names, and any failure there except moderation
or invalid input is made again on Runway, once, automatically. The provider in front here is the
harness's fake on the mock sheet (conftest.front_sheet); a future provider is just another adapter
(features/drop-hackathon-extras.clan)."""

import copy
import json

import pytest

from conftest import Harness, base_config, job_request
from contracts_dir import contracts_dir
from director import new_id
from providers.base import CapabilityMissing, Moderated, ProviderError, Status

PROVIDER_OPS = ("generate", "view", "frame", "region_edit", "clip", "clip_edit")
FRONT_PRICE = 0.15
RUNWAY_PRICE = {"generate": 0.2, "clip": 1.2}


def chain_config() -> dict:
    """Every step on the fake in front, then Runway."""
    cfg = base_config()
    cfg["routing"] = {op: ([] if op in ("shot_list", "stitch") else ["mock", "runway"]) for op in cfg["routing"]}
    return cfg


def post(h, token, op="generate", pick=None, expect=200, job_id=None):
    req = job_request(op, job_id or new_id("job"))
    if pick:
        req["modelChoice"] = pick
    return h.call("POST", "/jobs", req, token, expect=expect)[1]


def quota_left(h, job, cls="image"):
    return h.relay.remaining(job["participantId"])[cls]


@pytest.fixture
def h():
    return Harness(chain_config())


# ── the chain ───────────────────────────────────────────────────────────────
def test_the_live_config_routes_every_step_to_runway_alone():
    cfg = json.loads((contracts_dir() / "examples" / "config.live.json").read_text())
    assert all(cfg["routing"][op] == ["runway"] for op in PROVIDER_OPS)


@pytest.mark.parametrize("op", ["generate", "view", "clip"])
def test_runway_alone_runs_every_step_on_runway(op):
    cfg = base_config()
    cfg["routing"] = {o: ([] if o in ("shot_list", "stitch") else ["runway"]) for o in cfg["routing"]}
    h = Harness(cfg)
    job = post(h, h.as_person(), op)
    assert (job["state"], job["provider"]) == ("submitted", "runway")
    assert "fallbackFrom" not in job and not h.providers["mock"].submits


def test_the_chain_is_the_routing_or_a_pick_then_runway(h):
    chain = h.relay._chain
    for op in PROVIDER_OPS:
        assert chain(h.cfg, op, None) == ["mock", "runway"]
    assert chain(h.cfg, "clip", {"provider": "mock", "model": "mock-hq"}) == ["mock", "runway"]
    assert chain(h.cfg, "clip", {"provider": "runway", "model": "veo3.1_fast"}) == ["runway"]
    h.cfg["routing"]["generate"] = ["runway", "mock"]  # Runway is last, wherever the routing names it
    assert chain(h.cfg, "generate", None) == ["runway", "mock"]


def test_the_first_provider_runs_the_job_when_it_can(h):
    job = post(h, h.as_person(), "clip")
    assert (job["provider"], job["model"]) == ("mock", "mock")
    assert len(h.providers["mock"].submits) == 1 and not h.providers["runway"].submits


# ── every failure in front falls back to Runway ─────────────────────────────
def test_out_of_credit_at_submit_is_made_on_runway(h):
    h.providers["mock"].submit_effect = ProviderError("provider_failed", "credit is exhausted", provider_code="402")
    job = post(h, h.as_person(), "clip")
    assert (job["state"], job["provider"], job["model"]) == ("submitted", "runway", "veo3.1")
    assert job["fallbackFrom"] == {"provider": "mock", "model": "mock"}
    assert job["fallbackReason"] == "Mock could not make it: credit is exhausted."
    assert len(h.providers["runway"].submits) == 1


def test_failing_after_submit_is_made_on_runway(h):
    token = h.as_person()
    job = post(h, token)
    h.providers["mock"].states[job["requestId"]] = Status(state="failed", error_code="provider_failed",
                                                          error_message="runner crashed")
    h.clock.tick(3)
    out = h.poll(token, job["jobId"])
    assert (out["state"], out["provider"]) == ("submitted", "runway")
    assert out["fallbackFrom"] == {"provider": "mock", "model": "mock"}
    assert out["fallbackReason"] == "Mock could not make it: runner crashed."
    assert "error" not in out and out["requestId"].startswith("runway-")
    h.providers["runway"].succeed(out["requestId"])
    h.clock.tick(5)
    done = h.poll(token, job["jobId"])
    assert (done["state"], done["provider"], done["fallbackFrom"]["provider"]) == ("completed", "runway", "mock")
    assert done["kind"] == "generated"


def test_timing_out_is_cancelled_there_and_made_on_runway(h):
    token = h.as_person()
    job = post(h, token)
    h.clock.tick(h.cfg["jobTimeoutS"]["image"] + 1)
    out = h.poll(token, job["jobId"])
    assert (out["state"], out["provider"]) == ("submitted", "runway")
    assert h.providers["mock"].cancels == [job["requestId"]]
    assert out["fallbackReason"].startswith("Mock could not make it: The provider took too long")
    # Runway gets its own time: the job does not time out at once for having waited in front.
    h.clock.tick(5)
    assert h.poll(token, job["jobId"])["state"] == "submitted"


def test_uncertain_is_made_on_runway_and_says_the_first_may_still_charge(h):
    h.providers["mock"].submit_effect = ProviderError("provider_unavailable", "timed out", retryable=True, accepted=True)
    job = post(h, h.as_person())
    assert (job["state"], job["provider"]) == ("submitted", "runway")
    assert job["fallbackReason"].endswith("Mock may still charge for its attempt.")
    assert len(h.providers["mock"].submits) == 1  # never sent there again


def test_a_submit_that_never_came_back_is_made_on_runway(h):
    token = h.as_person()
    job = post(h, token)
    stored = h.store.get_job(job["jobId"])
    h.store.save_job({**stored, "state": "submitting", "requestId": None})
    h.clock.tick(200)
    out = h.poll(token, job["jobId"])
    assert (out["state"], out["provider"]) == ("submitted", "runway")
    assert "may still charge" in out["fallbackReason"]


def test_a_refusal_on_its_sheet_is_made_on_runway(h):
    h.providers["mock"].submit_effect = CapabilityMissing("mock takes at most 4 character refs")
    job = post(h, h.as_person())
    assert (job["state"], job["provider"]) == ("submitted", "runway")
    assert job["fallbackFrom"]["provider"] == "mock"
    assert job["fallbackReason"] == "Mock could not make it: mock takes at most 4 character refs."


def test_a_pick_in_front_falls_back_to_runways_default(h):
    pick = {"provider": "mock", "model": "mock-hq"}
    h.providers["mock"].submit_effect = ProviderError("provider_failed", "the API key was rejected")
    job = post(h, h.as_person(), "clip", pick=pick)
    assert (job["provider"], job["model"], job["fallbackFrom"]) == ("runway", "veo3.1", pick)
    assert job["fallbackReason"] == "Mock could not make it: the API key was rejected."


# ── no fallback ─────────────────────────────────────────────────────────────
def test_moderated_at_submit_never_falls_back(h):
    h.providers["mock"].submit_effect = Moderated(provider_code="content_policy_violation")
    job = post(h, h.as_person())
    assert job["state"] == "failed" and job["error"]["code"] == "moderated"
    assert not h.providers["runway"].submits


def test_moderated_after_submit_never_falls_back(h):
    token = h.as_person()
    job = post(h, token)
    h.providers["mock"].states[job["requestId"]] = Status(state="moderated", provider_code="x")
    h.clock.tick(3)
    assert h.poll(token, job["jobId"])["error"]["code"] == "moderated"
    assert not h.providers["runway"].submits


@pytest.mark.parametrize("where", ["submit", "status"])
def test_invalid_input_never_falls_back(h, where):
    token = h.as_person()
    front = h.providers["mock"]
    if where == "submit":
        front.submit_effect = ProviderError("invalid_input", "the image is not readable")
        job = post(h, token)
    else:
        job = post(h, token)
        front.states[job["requestId"]] = Status(state="failed", error_code="invalid_input", error_message="bad prompt")
        h.clock.tick(3)
        job = h.poll(token, job["jobId"])
    assert job["state"] == "failed" and job["error"]["code"] == "invalid_input"
    assert not h.providers["runway"].submits


def test_runway_failing_fails_the_job():
    cfg = chain_config()
    cfg["routing"]["generate"] = ["runway"]
    h = Harness(cfg)
    token = h.as_person()
    job = post(h, token)
    h.providers["runway"].states[job["requestId"]] = Status(state="failed", error_code="provider_failed",
                                                            error_message="boom")
    h.clock.tick(6)
    out = h.poll(token, job["jobId"])
    assert out["state"] == "failed" and out["error"]["message"] == "boom"
    assert len(h.providers["runway"].submits) == 1


def test_runway_failing_after_a_fallback_fails_the_job_and_tries_nothing_more(h):
    token = h.as_person()
    h.providers["mock"].submit_effect = ProviderError("provider_unavailable", "down", retryable=True)
    job = post(h, token)
    h.providers["runway"].states[job["requestId"]] = Status(state="failed", error_code="provider_failed",
                                                            error_message="boom")
    h.clock.tick(6)
    out = h.poll(token, job["jobId"])
    assert out["state"] == "failed" and out["provider"] == "runway"
    assert len(h.providers["runway"].submits) == 1 and len(h.providers["mock"].submits) == 1


def test_runway_unable_to_do_the_step_fails_clearly(h):
    h.providers["mock"].submit_effect = ProviderError("provider_failed", "out of credit", provider_code="402")
    h.providers["runway"].submit_effect = CapabilityMissing("clip_edit takes no mask")
    job = post(h, h.as_person())
    err = job["error"]
    assert job["state"] == "failed" and err["code"] == "capability_missing" and not err["retryable"]
    assert err["message"].startswith("Mock could not make it: out of credit. Runway cannot do this step either: ")
    assert h.store.counters("spend").get("usd", 0) == 0
    assert quota_left(h, job) == 40  # given back: nothing was made


def test_runway_busy_after_a_fallback_names_both(h):
    h.providers["mock"].submit_effect = ProviderError("provider_failed", "out of credit")
    h.providers["runway"].submit_effect = ProviderError("provider_unavailable", "503 from runway", retryable=True)
    job = post(h, h.as_person())
    assert job["error"]["code"] == "provider_unavailable" and job["error"]["retryable"]
    assert job["error"]["message"] == ("Mock could not make it: out of credit. Runway could not take it either "
                                       "(503 from runway). Try again.")


# ── spend, quota and slots ──────────────────────────────────────────────────
def test_a_failure_after_submit_keeps_its_spend_and_reserves_runways(h):
    token = h.as_person()
    job = post(h, token)
    pid = job["participantId"]
    assert job["cost"]["reserved"] == FRONT_PRICE and quota_left(h, job) == 39
    h.providers["mock"].states[job["requestId"]] = Status(state="failed", error_code="provider_failed",
                                                          error_message="x")
    h.clock.tick(3)
    out = h.poll(token, job["jobId"])
    assert out["cost"]["reserved"] == RUNWAY_PRICE["generate"]
    # The first provider may have charged for its attempt: its reservation stays spent.
    assert h.store.counters("spend")["usd"] == pytest.approx(FRONT_PRICE + RUNWAY_PRICE["generate"])
    assert quota_left(h, job) == 39  # one job, counted once
    assert h.store.counters("slots#mock#image")["n"] == 0
    assert h.store.counters("slots#runway#image")["n"] == 1
    h.providers["runway"].succeed(out["requestId"], cost=0.18)
    h.clock.tick(5)
    done = h.poll(token, job["jobId"])
    assert done["state"] == "completed" and done["cost"]["confirmed"] == 0.18
    assert h.store.counters("spend")["usd"] == pytest.approx(FRONT_PRICE + 0.18)
    assert h.store.counters("slots#runway#image")["n"] == 0
    assert h.store.counters(f"inflight#{pid}")["n"] == 0


def test_a_refusal_before_acceptance_gives_its_reservation_back(h):
    h.providers["mock"].submit_effect = ProviderError("provider_failed", "out of credit", provider_code="402")
    job = post(h, h.as_person())
    assert (job["provider"], job["fallbackFrom"]["provider"]) == ("runway", "mock")
    assert h.store.counters("spend")["usd"] == pytest.approx(RUNWAY_PRICE["generate"])
    assert quota_left(h, job) == 39  # one job, counted once


def test_a_fallback_stops_at_the_spend_stop(h):
    h.cfg["spend"] = {"capUsd": 1, "warnUsd": 1}
    token = h.as_person()
    job = post(h, token)
    h.store.incr("spend", "usd", 0.8)  # other jobs spent the rest meanwhile
    h.providers["mock"].states[job["requestId"]] = Status(state="failed", error_code="provider_failed",
                                                          error_message="out of credit")
    h.clock.tick(3)
    out = h.poll(token, job["jobId"])
    assert out["state"] == "failed" and out["error"]["code"] == "spend_stop"
    assert out["error"]["message"] == ("Mock could not make it: out of credit. Runway could not make it instead: "
                                       "the generation budget is used up.")
    assert not h.providers["runway"].submits
    assert h.store.counters("slots#runway#image").get("n", 0) == 0
    assert quota_left(h, job) == 40


# ── picks ───────────────────────────────────────────────────────────────────
@pytest.mark.parametrize("op,pick,ok", [
    ("clip", {"provider": "runway", "model": "veo3.1"}, True),
    ("clip", {"provider": "runway", "model": "veo3.1_fast"}, True),   # an alternate
    ("clip", {"provider": "mock", "model": "mock-hq"}, True),         # routed for the op
    ("clip", {"provider": "mock", "model": "veo3.1"}, False),         # not on that sheet
    ("generate", {"provider": "runway", "model": "veo3.1"}, False),   # not for the op
])
def test_a_pick_must_be_routed_and_on_the_sheet(h, op, pick, ok):
    out = post(h, h.as_person(), op, pick=pick, expect=200 if ok else 400)
    if ok:
        assert (out["provider"], out["model"]) == (pick["provider"], pick["model"])
    else:
        assert out["error"]["code"] == "invalid_input"


def test_a_pick_of_a_provider_the_step_does_not_route_is_refused():
    cfg = chain_config()
    cfg["routing"]["clip"] = ["runway"]
    h = Harness(cfg)
    out = post(h, h.as_person(), "clip", pick={"provider": "mock", "model": "mock"}, expect=400)
    assert out["error"]["code"] == "invalid_input"


def test_without_runway_routed_there_is_no_floor():
    cfg = copy.deepcopy(chain_config())
    cfg["routing"]["clip"] = ["mock"]
    h = Harness(cfg)
    h.providers["mock"].submit_effect = ProviderError("provider_failed", "credit is exhausted", provider_code="402")
    job = post(h, h.as_person(), "clip")
    assert job["state"] == "failed" and not h.providers["runway"].submits
