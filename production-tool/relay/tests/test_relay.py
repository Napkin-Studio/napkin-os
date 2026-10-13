import hashlib

import pytest

from conftest import Harness, base_config, job_request
from director import new_id
from identity import person, tenant_id
from providers.base import Moderated, ProviderError, Status
from service import QUEUE_TIMEOUT_S


# ── the person and uploads ──────────────────────────────────────────────────
def test_me_says_who_the_seam_names_with_quotas(h):
    token = h.as_person("Alice", name="Alice Ng")
    _, out = h.call("GET", "/me", None, token, expect=200)
    assert out["participantId"].startswith("p_") and out["workspace"] == out["tenant"]["id"]
    assert out["tenant"] == {"id": tenant_id("blue"), "agency": "blue"} and out["name"] == "Alice Ng"
    assert (out["handle"], out["team"]) == ("Alice", "blue") and out["projects"] == 0
    assert out["quotas"] == {"image": 40, "video": 6, "render": 3}
    assert "dogfood" not in out
    # the same name in any case is the same person (quotas and workspace follow it)
    _, again = h.call("GET", "/me", None, h.as_person("alice"), expect=200)
    assert again["participantId"] == out["participantId"]


def test_no_identity_is_401_everywhere_but_health_and_config(h):
    for method, path, body in (("POST", "/jobs", job_request("generate", new_id("job"))), ("GET", "/projects", None),
                               ("GET", "/me", None), ("GET", "/jobs/job_x", None), ("GET", "/library", None),
                               ("POST", "/uploads", {"sha256": "sha256:" + "a" * 64, "mime": "image/png", "bytes": 1})):
        _, out = h.call(method, path, body, expect=401)
        assert out["error"]["code"] == "unauthorised", path
    assert h.call("GET", "/me", None, "blue/nobody", expect=401)  # a key the seam does not know
    assert not h.store.all_jobs() and not h.providers["mock"].submits
    h.call("GET", "/health", expect=200)
    h.call("GET", "/config", expect=200)


def test_the_relay_fails_closed_with_no_identity_source(h):
    """The real seam (identity.who) with no source set: nobody is anyone (features/drop-hackathon-extras.clan)."""
    import identity
    from service import Relay

    identity.use_local(None)
    relay = Relay(store=h.store, blobs=h.blobs, registry=h.relay.registry, director=h.relay.director,
                  config=lambda: h.cfg, clock=h.clock)
    for method, path in (("POST", "/jobs"), ("GET", "/projects"), ("GET", "/me")):
        status, out, _ = relay.http(method, path, {"Authorization": "Bearer anything"}, b"{}")
        assert status == 401 and out["error"]["code"] == "unauthorised", path
    assert relay.http("GET", "/health", {}, None)[0] == 200


def test_the_local_person_answers_me_against_the_contract(h, monkeypatch):
    import identity
    from service import Relay

    monkeypatch.setenv("NAPKIN_LOCAL_USER", "maya@Blue Herons")
    identity.use_local(identity.local_person())
    h.tenant("Blue Herons")
    try:
        relay = Relay(store=h.store, blobs=h.blobs, registry=h.relay.registry, director=h.relay.director,
                      config=lambda: h.cfg, clock=h.clock)
        status, out, _ = relay.http("GET", "/api/me", {}, None)
    finally:
        identity.use_local(None)
    assert status == 200 and not h.contracts.errors("relay-api.schema.json#/$defs/Me", out), out
    assert (out["handle"], out["team"]) == ("maya", "Blue Herons")
    monkeypatch.delenv("NAPKIN_LOCAL_USER")
    me = identity.local_person()
    assert (me["h"], me["t"]) == ("local", "napkin")


def test_blocked_handle_cannot_submit(h):
    token = h.as_person("mallory")
    h.store.blocked.add("mallory")
    _, out = h.post_job(token, expect=403)
    assert out["error"] == {"code": "blocked", "message": "This name has been blocked.", "retryable": False}


def test_upload_dedupes_by_hash(h):
    token = h.as_person()
    sha = "sha256:" + "a" * 64
    _, out = h.call("POST", "/uploads", {"sha256": sha, "mime": "image/png", "bytes": 10}, token, expect=200)
    assert not out["exists"] and out["putUrl"] and out["url"] == f"https://cdn.test/in/{sha}"
    h.blobs.put(f"in/{sha}", b"x", "image/png")
    _, out = h.call("POST", "/uploads", {"sha256": sha, "mime": "image/png", "bytes": 10}, token, expect=200)
    assert out == {"exists": True, "url": f"https://cdn.test/in/{sha}"}


def test_invalid_job_request_is_rejected(h):
    token = h.as_person()
    req = job_request("generate", new_id("job"))
    req["op"] = "teleport"
    status, out = h.call("POST", "/jobs", req, token, expect=400)
    assert out["error"]["code"] == "invalid_input"


def test_log_returns_204(h):
    token = h.as_person()
    h.call("POST", "/log", {"level": "report", "message": "the button did nothing", "stage": "character"}, token, expect=204)


def _clan_post(h, token, body, reason="accept", project=None):
    headers = {"Authorization": f"Bearer {token}", "Content-Type": "application/vnd.clan+zip", "X-Clan-Reason": reason}
    if project is not None:
        headers["X-Project-Id"] = project
    return h.relay.http("POST", "/api/clan", headers, body)


def test_clan_mirror_keeps_latest_and_history(h):
    token = h.as_person()
    body = b"PK\x03\x04" + b"x" * 100
    status, out, ctx = _clan_post(h, token, body)
    assert (status, out) == (204, None)
    keys = [k for k in h.blobs.objects if k.startswith("clan/")]
    assert any(k.endswith("/latest.clan") for k in keys)
    assert any(k.endswith("-accept.clan") for k in keys)
    assert all(h.blobs.objects[k] == (body, "application/vnd.clan+zip") for k in keys)
    assert ctx["clanBytes"] == len(body)


def test_clan_mirror_keeps_one_copy_per_project(h):
    token = h.as_person()
    a, b = "prj_01J9Z8Y7X6W5V4T3S2R1Q0P9N8", "prj_01J9Z8Y7X6W5V4T3S2R1Q0P9N9"
    _clan_post(h, token, b"PK\x03\x04" + b"a" * 10, project=a)
    _clan_post(h, token, b"PK\x03\x04" + b"b" * 10, reason="manual", project=b)
    base = f"tenants/{tenant_id('blue')}/projects"  # the agency's projects (features/os-sign-in.clan)
    keys = sorted(k for k in h.blobs.objects if k.startswith(base))
    assert f"{base}/{a}/latest.clan" in keys and f"{base}/{b}/latest.clan" in keys
    assert h.blobs.objects[f"{base}/{a}/latest.clan"][0].endswith(b"a" * 10)
    assert h.blobs.objects[f"{base}/{b}/latest.clan"][0].endswith(b"b" * 10)
    assert any(k.startswith(f"{base}/{a}/") and k.endswith("-accept.clan") for k in keys)
    assert any(k.startswith(f"{base}/{b}/") and k.endswith("-manual.clan") for k in keys)
    # Without the header: the person's own copy, as before.
    _clan_post(h, token, b"PK\x03\x04" + b"c" * 10)
    pid = person("alice", "blue")["pid"]
    assert h.blobs.objects[f"clan/{pid}/latest.clan"][0].endswith(b"c" * 10)


def test_clan_mirror_refuses_a_bad_project_id(h):
    token = h.as_person()
    for bad in ("", "../other", "prj_short", "PRJ_01J9Z8Y7X6W5V4T3S2R1Q0P9N8", "prj_01J9Z8Y7X6W5V4T3S2R1Q0P9N8/x"):
        status, out, _ = _clan_post(h, token, b"PK\x03\x04" + b"x" * 10, project=bad)
        assert status == 400 and out["error"]["code"] == "invalid_input", bad
    assert not [k for k in h.blobs.objects if k.startswith(("clan/", "tenants/"))]


def test_clan_mirror_refuses_bad_bodies(h):
    token = h.as_person()
    status, out, _ = _clan_post(h, token, b"not a zip")
    assert status == 400 and out["error"]["code"] == "invalid_input"
    # 4.5 MB is what napkin-web's proxy and a Function URL take (features/os-sign-in.clan).
    status, out, _ = _clan_post(h, token, b"PK\x03\x04" + b"0" * (4_500_000 - 3))
    assert status == 413 and "Export it instead" in out["error"]["message"]
    status, out, _ = h.relay.http("POST", "/clan", {}, b"PK\x03\x04")
    assert status == 401
    assert not [k for k in h.blobs.objects if k.startswith(("clan/", "tenants/"))]
    status, _, _ = _clan_post(h, token, b"PK\x03\x04" + b"0" * (4_500_000 - 4))  # exactly 4.5 MB
    assert status == 204


# ── the ledger ──────────────────────────────────────────────────────────────
def test_same_job_id_twice_submits_once(h):
    token = h.as_person()
    jid = new_id("job")
    _, first = h.post_job(token, job_id=jid, expect=200)
    _, second = h.post_job(token, job_id=jid, expect=200)
    assert first["state"] == second["state"] == "submitted"
    assert first["requestId"] == second["requestId"]
    assert len(h.providers["mock"].submits) == 1
    assert h.relay.remaining(first["participantId"])["image"] == 39


def test_job_id_of_someone_else_is_refused(h):
    jid = new_id("job")
    h.post_job(h.as_person("alice"), job_id=jid, expect=200)
    assert h.post_job(h.as_person("bob"), job_id=jid, expect=409)[1]["error"]["code"] == "invalid_input"
    assert h.poll(h.as_person("bob"), jid, expect=404)


def test_submit_that_raises_is_never_resent_there_and_is_made_on_runway(h):
    # Was "becomes uncertain and is never resent": since 2026-10-09 uncertain on a provider in front of
    # Runway falls back to Runway, once (features/runway-fallback.clan). Mock is never sent it again.
    token = h.as_person()
    h.providers["mock"].submit_effect = TimeoutError("read timed out")
    jid = new_id("job")
    _, out = h.post_job(token, job_id=jid, expect=200)
    assert (out["state"], out["provider"]) == ("submitted", "runway")
    assert "Mock may still charge" in out["fallbackReason"]
    h.providers["mock"].submit_effect = None
    _, again = h.post_job(token, job_id=jid, expect=200)
    assert again["provider"] == "runway"
    assert len(h.providers["mock"].submits) == 1 and len(h.providers["runway"].submits) == 1
    assert h.store.counters("slots#mock#image")["n"] == 0
    # mock's reserved spend stays counted (it may have been paid), plus Runway's estimate
    assert h.store.counters("spend")["usd"] == pytest.approx(0.15 + 0.2)


def test_submit_that_raises_on_the_floor_becomes_uncertain_and_is_never_resent():
    h = Harness(base_config(routing={**base_config()["routing"], "generate": ["runway"]}))
    token = h.as_person()
    h.providers["runway"].submit_effect = TimeoutError("read timed out")
    jid = new_id("job")
    _, out = h.post_job(token, job_id=jid, expect=200)
    assert out["state"] == "uncertain" and out["error"]["code"] == "uncertain"
    h.providers["runway"].submit_effect = None
    _, again = h.post_job(token, job_id=jid, expect=200)
    assert again["state"] == "uncertain"
    assert len(h.providers["runway"].submits) == 1 and not h.providers["mock"].submits
    assert h.store.counters(f"inflight#{out['participantId']}")["n"] == 0
    assert h.store.counters("slots#runway#image")["n"] == 0
    # the reserved spend stays counted: it may have been paid
    assert h.store.counters("spend")["usd"] == pytest.approx(0.2)


def test_completed_job_copies_outputs_to_s3_and_hashes_them(h):
    token = h.as_person()
    _, job = h.post_job(token, expect=200)
    mock = h.providers["mock"]
    h.clock.tick(3)
    assert h.poll(token, job["jobId"])["state"] == "submitted"
    mock.succeed(job["requestId"], b"the-image", cost=0.03)
    h.clock.tick(3)
    done = h.poll(token, job["jobId"])
    sha = "sha256:" + hashlib.sha256(b"the-image").hexdigest()
    assert done["state"] == "completed" and done["kind"] == "mock"  # a mock output is labelled
    assert done["outputs"] == [{"sha256": sha, "url": f"https://cdn.test/out/{sha}", "mime": "image/png",
                                "bytes": 9, "w": 64, "h": 64}]
    assert h.blobs.objects[f"out/{sha}"] == (b"the-image", "image/png")
    assert done["cost"]["confirmed"] == 0.03
    assert h.store.counters("spend")["usd"] == pytest.approx(0.03)
    assert h.store.counters("slots#mock#image")["n"] == 0
    assert done["director"]["promptVersion"] == "director.v0"


def test_polls_respect_min_poll(h):
    token = h.as_person()
    _, job = h.post_job(token, expect=200)
    assert job["nextPollS"] >= 2
    h.poll(token, job["jobId"])
    h.poll(token, job["jobId"])
    assert h.providers["mock"].status_calls == []  # its minPollS is 2
    h.clock.tick(2)
    h.poll(token, job["jobId"])
    assert len(h.providers["mock"].status_calls) == 1


def test_provider_failure_never_becomes_success():
    # Runway alone, the floor: a failure there ends the job (a provider in front failing falls back, test_runway_fallback.py).
    h = Harness(base_config(routing={**base_config()["routing"], "generate": ["runway"]}))
    token = h.as_person()
    _, job = h.post_job(token, expect=200)
    h.providers["runway"].states[job["requestId"]] = Status(state="failed", error_code="provider_failed",
                                                            error_message="boom", provider_code="E1")
    h.clock.tick(6)
    out = h.poll(token, job["jobId"])
    assert out["state"] == "failed" and out["error"]["code"] == "provider_failed"
    assert "outputs" not in out


# ── limits ──────────────────────────────────────────────────────────────────
def test_quota_exhaustion():
    h = Harness(base_config(quotas={"image": 2, "video": 1, "render": 1}))
    token = h.as_person()
    h.post_job(token, expect=200)
    h.post_job(token, expect=200)
    _, out = h.post_job(token, expect=429)
    assert out["error"]["code"] == "quota_exhausted" and out["error"]["retryable"] is False
    # a refused job leaves nothing behind
    from service import participant_id
    assert h.store.counters(f"inflight#{participant_id('blue', 'alice')}")["n"] == 2


def test_spend_stop():
    # Was a cap of 0.02 with the first 0.15 job admitted ("spent < cap"): that let the last jobs pass the
    # cap. A job is admitted only when its estimate fits under it (features/video-stage-findings.clan).
    h = Harness(base_config(spend={"capUsd": 0.2, "warnUsd": 0.1}))
    token = h.as_person()
    h.post_job(token, expect=200)            # 0 + 0.15 (the front provider's price) <= 0.2: admitted
    _, out = h.post_job(token, expect=503)   # 0.15 + 0.15 > 0.2
    assert out["error"]["code"] == "spend_stop"
    assert h.store.counters("spend")["usd"] == pytest.approx(0.15)


def test_spend_stop_refuses_a_job_that_would_pass_the_cap():
    h = Harness(base_config(spend={"capUsd": 0.1, "warnUsd": 0.05}))
    token = h.as_person()
    _, out = h.post_job(token, expect=503)   # nothing spent, but 0.15 > 0.1
    assert out["error"]["code"] == "spend_stop"
    assert h.store.counters("spend").get("usd", 0) == 0


def test_in_flight_limit():
    h = Harness(base_config(inFlightPerParticipant=2))
    token = h.as_person()
    _, a = h.post_job(token, expect=200)
    h.post_job(token, expect=200)
    _, out = h.post_job(token, expect=429)
    assert out["error"]["code"] == "queue_full" and out["error"]["retryable"] and out["error"]["retryAfterS"] > 0
    h.providers[a["provider"]].succeed(a["requestId"])
    h.clock.tick(10)
    assert h.poll(token, a["jobId"])["state"] == "completed"
    h.post_job(token, expect=200)


def test_jobs_queue_when_the_provider_is_full_and_run_when_a_slot_frees():
    cfg = base_config()
    cfg["routing"]["generate"] = ["mock"]       # 2 image slots
    h = Harness(cfg)
    tokens = [h.as_person(n) for n in ("ann", "ben", "cat")]
    jobs = [h.post_job(t, expect=200)[1] for t in tokens]
    assert [j["state"] for j in jobs] == ["submitted", "submitted", "queued"]
    assert jobs[2]["queuePosition"] == 0 and jobs[2]["nextPollS"] >= 3
    assert len(h.providers["mock"].submits) == 2
    h.clock.tick(3)
    assert h.poll(tokens[2], jobs[2]["jobId"])["state"] == "queued"
    h.providers["mock"].succeed(jobs[0]["requestId"])
    h.poll(tokens[0], jobs[0]["jobId"])
    assert h.poll(tokens[2], jobs[2]["jobId"])["state"] == "submitted"
    assert len(h.providers["mock"].submits) == 3


def test_fair_share_puts_the_participant_with_fewer_running_jobs_first():
    cfg = base_config()
    cfg["routing"]["generate"] = ["mock"]
    h = Harness(cfg)
    ann, ben = h.as_person("ann"), h.as_person("ben")
    h.post_job(ann, expect=200)
    h.post_job(ann, expect=200)                 # mock full, both ann's
    _, ann3 = h.post_job(ann, expect=200)       # queued first
    h.clock.tick(1)
    _, ben1 = h.post_job(ben, expect=200)       # queued later, but ben has nothing running
    assert ann3["queuePosition"] == 0 and ben1["queuePosition"] == 0
    assert h.poll(ann, ann3["jobId"])["queuePosition"] == 1


def test_routing_falls_back_when_the_first_provider_is_full():
    h = Harness()
    tokens = [h.as_person(n) for n in ("ann", "ben", "cat")]
    jobs = [h.post_job(t, expect=200)[1] for t in tokens]
    assert [j["provider"] for j in jobs] == ["mock", "mock", "runway"]
    assert jobs[2]["cost"]["reserved"] == 0.2   # re-reserved at runway's price (Gemini 3 Pro)


def test_routing_falls_back_when_the_first_provider_refuses():
    h = Harness()
    h.providers["mock"].submit_effect = ProviderError("provider_unavailable", "503 from mock")
    token = h.as_person()
    _, job = h.post_job(token, expect=200)
    assert job["state"] == "submitted" and job["provider"] == "runway"
    assert h.store.counters("slots#mock#image")["n"] == 0


def test_moderated_is_never_retried_or_rerouted():
    h = Harness()
    h.providers["mock"].submit_effect = Moderated(provider_code="content_policy_violation")
    token = h.as_person()
    jid = new_id("job")
    _, job = h.post_job(token, job_id=jid, expect=200)
    assert job["state"] == "failed" and job["error"]["code"] == "moderated" and not job["error"]["retryable"]
    assert job["error"]["providerCode"] == "content_policy_violation"
    h.post_job(token, job_id=jid, expect=200)
    h.clock.tick(5)
    h.poll(token, jid)
    assert len(h.providers["mock"].submits) == 1 and h.providers["runway"].submits == []


def test_moderated_status_fails_the_job(h):
    token = h.as_person()
    _, job = h.post_job(token, expect=200)
    h.providers["mock"].states[job["requestId"]] = Status(state="moderated", provider_code="SAFETY.INPUT.TEXT")
    h.clock.tick(3)
    out = h.poll(token, job["jobId"])
    assert out["error"]["code"] == "moderated" and out["error"]["retryable"] is False


def test_routing_off_and_flags():
    cfg = base_config()
    cfg["routing"]["generate"] = []
    cfg["flags"]["video"] = False
    h = Harness(cfg)
    token = h.as_person()
    assert h.post_job(token, expect=403)[1]["error"]["code"] == "flag_off"
    assert h.post_job(token, op="clip", expect=403)[1]["error"]["code"] == "flag_off"


def test_cancel_a_queued_job_gives_the_quota_back():
    cfg = base_config()
    cfg["routing"]["generate"] = ["mock"]
    h = Harness(cfg)
    a, b, c = (h.as_person(n) for n in ("ann", "ben", "cat"))
    h.post_job(a, expect=200)
    h.post_job(b, expect=200)
    _, queued = h.post_job(c, expect=200)
    _, out = h.call("DELETE", f"/jobs/{queued['jobId']}", None, c, expect=200)
    assert out["state"] == "cancelled"
    assert h.relay.remaining(queued["participantId"])["image"] == 40


def test_cancel_a_running_job_cancels_at_the_provider(h):
    token = h.as_person()
    _, job = h.post_job(token, expect=200)
    _, out = h.call("DELETE", f"/jobs/{job['jobId']}", None, token, expect=200)
    assert out["state"] == "cancelled" and h.providers["mock"].cancels == [job["requestId"]]


def test_queued_job_times_out():
    cfg = base_config()
    cfg["routing"]["generate"] = ["mock"]
    h = Harness(cfg)
    a, b, c = (h.as_person(n) for n in ("ann", "ben", "cat"))
    h.post_job(a, expect=200)
    h.post_job(b, expect=200)
    _, queued = h.post_job(c, expect=200)
    # A queued job waits its turn past the running limit (2026-10-09: a busy room waits, it does not
    # fail at 10 minutes), and fails at the queue limit with a retry.
    h.clock.tick(cfg["jobTimeoutS"]["image"] + 1)
    assert h.poll(c, queued["jobId"])["state"] == "queued"
    h.clock.tick(QUEUE_TIMEOUT_S["image"] - cfg["jobTimeoutS"]["image"])
    out = h.poll(c, queued["jobId"])
    assert out["state"] == "failed" and out["error"]["code"] == "timeout" and out["error"]["retryable"]


def test_the_queue_limit_comes_from_config_when_set():
    cfg = base_config()
    cfg["routing"]["generate"] = ["mock"]
    cfg["queueTimeoutS"] = {"image": 300, "video": 900}
    h = Harness(cfg)
    a, b, c = (h.as_person(n) for n in ("ann", "ben", "cat"))
    h.post_job(a, expect=200)
    h.post_job(b, expect=200)
    _, queued = h.post_job(c, expect=200)
    h.clock.tick(301)  # past 300 but never shorter than the running limit (180 here): fails now
    assert h.poll(c, queued["jobId"])["state"] == "failed"


def test_sweep_advances_jobs_nobody_polls(h):
    token = h.as_person()
    _, job = h.post_job(token, expect=200)
    h.providers["mock"].succeed(job["requestId"])
    h.clock.tick(5)
    h.relay.sweep()
    assert h.store.get_job(job["jobId"])["state"] == "completed"
    assert h.store.counters("slots#mock#image")["n"] == 0


# ── director-only and stitch ────────────────────────────────────────────────
def test_shot_list_runs_on_the_director(h):
    token = h.as_person()
    _, job = h.post_job(token, op="shot_list", expect=200)
    assert job["state"] == "completed" and job["quotaClass"] == "text"
    assert sum(s["duration_s"] for s in job["shots"]) == 15
    assert "provider" not in job


def test_stitch_starts_the_lambda_and_completes_from_its_result(h):
    token = h.as_person()
    _, job = h.post_job(token, op="stitch", expect=200)
    assert job["state"] == "submitted"
    payload = h.stitched[0]
    assert payload["clips"][0]["key"].startswith("out/sha256:") and payload["clips"][0]["trimS"] == 4
    assert payload["outKey"] == f"ads/{job['jobId']}.mp4"
    h.clock.tick(3)
    assert h.poll(token, job["jobId"])["state"] == "submitted"
    h.blobs.put(payload["resultKey"], b'{"ok": true, "sha256": "sha256:' + b"b" * 64 + b'", "bytes": 100, "w": 720, "h": 1280, "durationS": 9.0}', "application/json")
    out = h.poll(token, job["jobId"])
    assert out["state"] == "completed" and out["outputs"][0]["url"] == f"https://cdn.test/ads/{job['jobId']}.mp4"
    assert h.relay.remaining(job["participantId"])["render"] == 2


def test_stitch_rejects_clips_that_are_not_ours(h):
    token = h.as_person()
    inp = {"clips": [{"asset": {"sha256": "sha256:" + "c" * 64, "url": "https://evil.test/x.mp4", "mime": "video/mp4"}}]}
    _, job = h.post_job(token, op="stitch", expect=200, **inp)
    assert job["state"] == "failed" and job["error"]["code"] == "invalid_input"
    assert h.relay.remaining(job["participantId"])["render"] == 3


def test_config_route_and_api_prefix(h):
    _, out = h.call("GET", "/config", expect=200)
    assert out["contractVersion"] == "2"
    status, out, _ = h.relay.http("GET", "/api/me", {"Authorization": f"Bearer {h.as_person('zed')}"}, None)
    assert status == 200 and out["handle"] == "zed"
