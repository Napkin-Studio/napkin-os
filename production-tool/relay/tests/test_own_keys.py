"""A participant's own fal and HeyGen keys (features/production-tool-own-keys.clan)."""

import copy
import json
import logging

import httpx
import pytest

import own_keys
from conftest import SECRET, FakeProvider, Harness, base_config, job_request, sheets
from director import new_id
from providers.base import ProviderError

FAL_KEY = "fal-own-key-1234567890"
HEYGEN_KEY = "heygen-own-key-0987654321"


class OwnFakes:
    """make() for OwnAdapters: one FakeProvider per (provider, key), recording the key."""

    def __init__(self, blobs):
        self.blobs = blobs
        self.made: dict[tuple[str, str], FakeProvider] = {}
        self.sheets = sheets()

    def __call__(self, provider, key):
        fake = FakeProvider(provider, copy.deepcopy(self.sheets[provider]), self.blobs)
        self.made[(provider, key)] = fake
        return fake

    def one(self, provider, key) -> FakeProvider:
        return self.made[(provider, key)]


def harness(flag=True, **over) -> tuple[Harness, OwnFakes]:
    cfg = base_config(**over)
    cfg["flags"] = {**cfg["flags"], "ownKeys": flag}
    h = Harness(cfg)
    fakes = OwnFakes(h.blobs)
    h.relay._own_adapters = own_keys.OwnAdapters(sheets=fakes.sheets, make=fakes)
    return h, fakes


def keys(**k) -> dict:
    return {"X-Own-Keys": json.dumps(k)}


def post(h, token, op="generate", job_id=None, headers=None, expect=200):
    job_id = job_id or new_id("job")
    return h.call("POST", "/jobs", job_request(op, job_id), token, expect=expect, headers=headers)[1]


# ── routing ─────────────────────────────────────────────────────────────────
def test_flag_off_ignores_the_header():
    h, fakes = harness(flag=False)
    token = h.sign_in()
    job = post(h, token, headers=keys(fal=FAL_KEY))
    assert job["keySource"] == "event" and job["provider"] == "fal"
    assert len(h.providers["fal"].submits) == 1 and not fakes.made


def test_fal_key_runs_image_steps_on_their_key():
    h, fakes = harness()
    token = h.sign_in()
    job = post(h, token, headers=keys(fal=FAL_KEY))
    assert job["keySource"] == "own" and job["provider"] == "fal" and job["state"] == "submitted"
    assert len(fakes.one("fal", FAL_KEY).submits) == 1
    assert not h.providers["fal"].submits and not h.providers["runway"].submits


@pytest.mark.parametrize("given,op,want", [
    ({"fal": FAL_KEY}, "clip", ("own", "fal")),               # a key they gave wins, clips too
    ({"heygen": HEYGEN_KEY}, "clip", ("own", "heygen")),
    ({"heygen": HEYGEN_KEY}, "view", ("event", "runway")),    # HeyGen does clips only
    ({"fal": FAL_KEY, "heygen": HEYGEN_KEY}, "clip", ("own", "heygen")),
    ({"fal": FAL_KEY, "heygen": HEYGEN_KEY}, "view", ("own", "fal")),
    ({}, "view", ("event", "runway")),
])
def test_which_key_runs_which_step(given, op, want):
    h, _ = harness()
    token = h.sign_in()
    job = post(h, token, op, headers=keys(**given))
    assert (job["keySource"], job["provider"]) == want


def test_both_keys_clip_goes_to_fal_when_heygen_is_busy():
    h, fakes = harness()
    token = h.sign_in()
    h.relay.own_adapters.get("heygen", HEYGEN_KEY)  # build it now to make it refuse
    fakes.one("heygen", HEYGEN_KEY).submit_effect = ProviderError("provider_unavailable", "busy", retryable=True)
    job = post(h, token, "clip", headers=keys(fal=FAL_KEY, heygen=HEYGEN_KEY))
    assert job["keySource"] == "own" and job["provider"] == "fal"
    assert not h.providers["runway"].submits


def test_busy_own_providers_fall_back_to_runway_on_the_event_key():
    # Was "never fall back to the event key"; Runway is the floor since 2026-10-09 (features/runway-fallback.clan).
    h, fakes = harness()
    token = h.sign_in()
    h.relay.own_adapters.get("heygen", HEYGEN_KEY)
    fakes.one("heygen", HEYGEN_KEY).submit_effect = ProviderError("provider_unavailable", "busy", retryable=True)
    job = post(h, token, "clip", headers=keys(heygen=HEYGEN_KEY))
    assert (job["state"], job["keySource"], job["provider"]) == ("submitted", "event", "runway")
    assert job["fallbackFrom"] == {"provider": "heygen", "model": "heygen-video-1"}
    assert job["fallbackReason"] == "HeyGen could not make it: busy."
    assert len(h.providers["runway"].submits) == 1


def test_a_refused_key_falls_back_to_runway_and_says_why():
    # Was "fails with a clear message and no fallback" (features/runway-fallback.clan, 2026-10-09).
    h, fakes = harness()
    token = h.sign_in()
    h.relay.own_adapters.get("fal", FAL_KEY)
    fakes.one("fal", FAL_KEY).submit_effect = ProviderError("provider_failed", "fal rejected the API key")
    job = post(h, token, headers=keys(fal=FAL_KEY))
    assert (job["state"], job["provider"], job["keySource"]) == ("submitted", "runway", "event")
    assert job["fallbackReason"].startswith("fal could not make it: Your fal key was refused.")
    assert not h.providers["fal"].submits and len(h.providers["runway"].submits) == 1


def test_bad_header_is_refused_without_echoing_the_key():
    h, _ = harness()
    token = h.sign_in()
    for raw in ("not json", json.dumps(["x"]), json.dumps({"runway": "k"}), json.dumps({"fal": " spaced "})):
        out = post(h, token, headers={"X-Own-Keys": raw}, expect=400)
        assert out["error"]["code"] == "invalid_input" and "spaced" not in out["error"]["message"]


# ── money, quotas and slots ─────────────────────────────────────────────────
def test_own_jobs_take_no_event_spend_quota_or_slot():
    h, fakes = harness()
    token = h.sign_in()
    job = post(h, token, headers=keys(fal=FAL_KEY))
    assert job["cost"]["reserved"] == 0
    assert h.store.counters("spend").get("usd", 0) == 0
    assert h.store.counters("slots#fal#image").get("n", 0) == 0
    assert h.call("POST", "/session", {"eventCode": "HACK", "handle": "alice"})[1]["quotas"]["image"] == 40
    fakes.one("fal", FAL_KEY).succeed(job["requestId"], cost=0.5)
    h.clock.tick(5)
    done = h.poll(token, job["jobId"])
    assert done["state"] == "completed"
    assert h.store.counters("spend").get("usd", 0) == 0
    assert h.store.counters(f"slots#fal#own#{job['participantId']}#image").get("n", 0) == 0


def test_spend_stop_does_not_block_own_keys():
    h, _ = harness()
    h.cfg["spend"] = {"capUsd": 1, "warnUsd": 1}
    h.store.incr("spend", "usd", 5)
    token = h.sign_in()
    assert post(h, token, "view", expect=503)["error"]["code"] == "spend_stop"
    assert post(h, token, "view", headers=keys(fal=FAL_KEY))["keySource"] == "own"


def test_own_jobs_use_the_participants_own_slots():
    h, fakes = harness()
    limit = fakes.sheets["fal"]["concurrency"]["image"]
    h.store.incr("slots#fal#image", "n", limit, limit)  # the event's fal slots are full
    token = h.sign_in()
    job = post(h, token, headers=keys(fal=FAL_KEY))
    assert job["state"] == "submitted"
    assert h.store.counters(f"slots#fal#own#{job['participantId']}#image")["n"] == 1


def test_in_flight_limit_still_applies():
    h, _ = harness(inFlightPerParticipant=1)
    token = h.sign_in()
    post(h, token, headers=keys(fal=FAL_KEY))
    assert post(h, token, headers=keys(fal=FAL_KEY), expect=429)["error"]["code"] == "queue_full"


# ── tab closed, keys at rest ────────────────────────────────────────────────
def test_sweep_and_polls_work_without_the_header():
    h, fakes = harness()
    token = h.sign_in()
    job = post(h, token, headers=keys(fal=FAL_KEY))
    fakes.one("fal", FAL_KEY).succeed(job["requestId"])
    h.clock.tick(5)
    h.relay.sweep()
    assert h.store.get_job(job["jobId"])["state"] == "completed"


def test_cancel_uses_their_key():
    h, fakes = harness()
    token = h.sign_in()
    job = post(h, token, headers=keys(fal=FAL_KEY))
    h.call("DELETE", f"/jobs/{job['jobId']}", None, token, expect=200)
    assert fakes.one("fal", FAL_KEY).cancels == [job["requestId"]]


def test_an_unreadable_key_sends_the_job_to_runway():
    # Was "fails the job"; Runway is the floor since 2026-10-09 (features/runway-fallback.clan).
    h, fakes = harness()
    token = h.sign_in()
    job = post(h, token, headers=keys(fal=FAL_KEY))
    stored = h.store.get_job(job["jobId"])
    stored["_own"]["fal"] = own_keys.Sealer("another-secret").seal(FAL_KEY, job["jobId"], "fal")
    h.store.save_job(stored)
    h.clock.tick(5)
    out = h.poll(token, job["jobId"])
    assert (out["state"], out["provider"]) == ("submitted", "runway")
    assert "no longer read your fal key" in out["fallbackReason"]
    assert h.store.counters(f"slots#fal#own#{job['participantId']}#image").get("n", 0) == 0


def test_keys_never_leave_or_rest_readable(caplog):
    caplog.set_level(logging.DEBUG)
    h, fakes = harness()
    token = h.sign_in()
    seen = []
    job = post(h, token, headers=keys(fal=FAL_KEY, heygen=HEYGEN_KEY))
    seen.append(job)
    clip = post(h, token, "clip", headers=keys(fal=FAL_KEY, heygen=HEYGEN_KEY))
    seen.append(clip)
    fakes.one("fal", FAL_KEY).succeed(job["requestId"])
    h.clock.tick(5)
    seen.append(h.poll(token, job["jobId"]))
    status, out, ctx = h.relay.http("GET", f"/jobs/{clip['jobId']}", {"Authorization": f"Bearer {token}"}, None)
    seen += [out, ctx]
    blob = json.dumps(seen) + caplog.text + json.dumps([h.store.get_job(j["jobId"]) for j in (job, clip)], default=str)
    for k in (FAL_KEY, HEYGEN_KEY):
        assert k not in blob
    assert all("_own" not in j for j in seen[:3])


# ── the pieces ──────────────────────────────────────────────────────────────
def test_sealed_key_is_bound_to_its_job_and_provider():
    s = own_keys.Sealer(SECRET)
    sealed = s.seal(FAL_KEY, "job_a", "fal")
    assert s.open(sealed, "job_a", "fal") == FAL_KEY
    assert s.open(sealed, "job_b", "fal") is None
    assert s.open(sealed, "job_a", "heygen") is None
    assert own_keys.Sealer("rotated").open(sealed, "job_a", "fal") is None
    assert s.open("v1:" + "A" * 8, "job_a", "fal") is None


def test_parse_drops_blank_keys():
    assert own_keys.parse(None) == {}
    assert own_keys.parse(json.dumps({"fal": "", "heygen": HEYGEN_KEY})) == {"heygen": HEYGEN_KEY}


def test_refused_matches_what_the_real_adapters_raise():
    from providers import _seam, fal

    resp = httpx.Response(401, json={"detail": "bad key"}, request=httpx.Request("POST", "https://queue.fal.run/x"))
    e = _seam._error(fal._error(resp))
    assert own_keys.refused("fal", e.code, e.message, e.provider_code)
    assert own_keys.refused("heygen", "provider_failed", "HeyGen refused the key: nope", "403")
    assert not own_keys.refused("heygen", "provider_failed", "HeyGen credit is exhausted", "402")


def test_own_adapters_are_reused_per_key():
    made = []
    adapters = own_keys.OwnAdapters(sheets=sheets(), make=lambda p, k: made.append((p, k)) or object(), limit=2)
    a = adapters.get("fal", "k1")
    assert adapters.get("fal", "k1") is a and len(made) == 1
    adapters.get("fal", "k2")
    adapters.get("fal", "k3")
    adapters.get("fal", "k1")
    assert len(made) == 4  # k1 fell out of the cache of two
    assert not adapters.supports("runway", "generate")


def test_the_failure_says_why_the_own_provider_could_not_take_the_step():
    """2026-10-07: fal was unreachable (DNS) and the participant read only "could not take this step"."""
    h, fakes = harness()
    token = h.sign_in()
    h.relay.own_adapters.get("heygen", HEYGEN_KEY)
    fakes.one("heygen", HEYGEN_KEY).submit_effect = ProviderError(
        "provider_unavailable", "heygen is unreachable: [Errno -3] Temporary failure in name resolution", retryable=True)
    job = post(h, token, "clip", headers=keys(heygen=HEYGEN_KEY))
    assert "Temporary failure in name resolution" in job["fallbackReason"]  # now on Runway, saying why
    h.cfg["routing"]["clip"] = ["heygen"]  # without Runway routed there is no floor: it fails, still saying why
    job = post(h, token, "clip", headers=keys(heygen=HEYGEN_KEY))
    assert job["state"] == "failed" and "Temporary failure in name resolution" in job["error"]["message"]


def test_a_pick_on_their_own_key_runs_there_then_falls_back_to_runway():
    """features/model-choice.clan: a picked model on a provider they hold a key for runs on that key.
    Was "never falls back to the event key"; Runway is the floor since 2026-10-09 (features/runway-fallback.clan)."""
    cfg = base_config()
    cfg["routing"]["clip"] = ["fal", "heygen", "runway"]
    cfg["flags"] = {**cfg["flags"], "ownKeys": True}
    h = Harness(cfg, providers=("fal", "heygen", "runway"))
    fakes = OwnFakes(h.blobs)
    h.relay._own_adapters = own_keys.OwnAdapters(sheets=fakes.sheets, make=fakes)
    token = h.sign_in()
    req = job_request("clip", new_id("job"))
    req["modelChoice"] = {"provider": "heygen", "model": "heygen-video-1"}
    h.relay.own_adapters.get("heygen", HEYGEN_KEY)
    fakes.one("heygen", HEYGEN_KEY).submit_effect = ProviderError("provider_unavailable", "busy", retryable=True)
    job = h.call("POST", "/jobs", req, token, expect=200, headers=keys(heygen=HEYGEN_KEY, fal=FAL_KEY))[1]
    assert (job["keySource"], job["provider"], job["model"]) == ("event", "runway", "veo3.1")
    assert job["fallbackFrom"] == req["modelChoice"]
    assert len(h.providers["runway"].submits) == 1
    assert ("fal", FAL_KEY) not in fakes.made  # their fal key is not the pick's provider


# ── a pick on an own key (features/harness-refusals.clan) ──────────────────
VEO_FAST = {"provider": "fal", "model": "veo3.1-fast-i2v"}


@pytest.mark.parametrize("given", [{"fal": FAL_KEY, "heygen": HEYGEN_KEY}, {"fal": FAL_KEY}])
@pytest.mark.parametrize("event_clip", [["runway"], ["fal", "heygen", "runway"]])
def test_a_fal_pick_runs_on_their_fal_key_for_clips(given, event_clip):
    # 2026-10-08: with both keys the pick narrowed them to fal, then fal's backup-only rule for clips
    # dropped fal too, so the job went to the event's routing: the event's fal key, or refused locally.
    h, fakes = harness(routing={**base_config()["routing"], "clip": event_clip})
    token = h.sign_in()
    req = job_request("clip", new_id("job"))
    req["modelChoice"] = VEO_FAST
    job = h.call("POST", "/jobs", req, token, expect=200, headers=keys(**given))[1]
    assert (job["keySource"], job["provider"], job["model"]) == ("own", "fal", "veo3.1-fast-i2v")
    assert len(fakes.one("fal", FAL_KEY).submits) == 1 and not h.providers["fal"].submits


def test_without_a_pick_a_fal_key_alone_makes_clips_on_fal():
    # 2026-10-09: fal made clips only behind a HeyGen key, so a fal key alone left them to the
    # event's routing (mock locally: a still, no video). A key they gave wins (features/runway-fallback.clan).
    h, _ = harness()
    token = h.sign_in()
    job = post(h, token, "clip", headers=keys(fal=FAL_KEY))
    assert job["keySource"] == "own" and job["provider"] == "fal"
