"""The beta's record (dogfood.py, features/production-tool-dogfood.clan): consent first, every
write and job state change, never a poll, a header or a key, and runs folded."""

import json

from conftest import Harness, base_config
from director import new_id

import dogfood


def on(**over) -> Harness:
    cfg = base_config(**over)
    cfg["flags"]["dogfood"] = True
    return Harness(cfg)


def objects(h, prefix="dogfood/events/"):
    return {k: v[0] for k, v in h.blobs.objects.items() if k.startswith(prefix)}


def lines(h) -> list[dict]:
    out = []
    for raw in objects(h).values():
        out += [json.loads(line) for line in raw.decode().splitlines() if line]
    return out


def agreed(h, handle="alice") -> str:
    token = h.sign_in(handle)
    h.call("POST", "/dogfood/consent", None, token, expect=204)
    return token


def test_off_means_404_and_nothing_written(h):
    token = h.sign_in()
    h.call("POST", "/dogfood/consent", None, token, expect=404)
    h.call("POST", "/dogfood/events", {"events": [{"kind": "click", "name": "button: Go"}]}, token, expect=404)
    h.post_job(token, expect=200)
    _, session = h.call("POST", "/session", {"eventCode": "HACK", "team": "blue", "handle": "alice"}, expect=200)
    assert "dogfood" not in session
    assert not [k for k in h.blobs.objects if k.startswith("dogfood/")]


def test_nothing_is_recorded_before_consent_and_consent_is_kept_once():
    h = on()
    token = h.sign_in()
    h.post_job(token, expect=200)
    h.call("POST", "/dogfood/events", {"events": [{"kind": "click", "name": "button: Go"}]}, token, expect=403)
    assert not objects(h)
    h.call("POST", "/dogfood/consent", None, token, expect=204)
    consent = [json.loads(v) for k, v in objects(h, "dogfood/consent/").items()]
    assert len(consent) == 1 and consent[0]["handle"] == "alice" and consent[0]["participantId"].startswith("p_")
    assert consent[0]["team"] == "blue"  # from the token's "t" (personal workspaces)
    _, session = h.call("POST", "/session", {"eventCode": "HACK", "team": "blue", "handle": "alice"}, expect=200)
    assert session["dogfood"] == {"consented": True}
    kinds = [e["kind"] for e in lines(h)]
    assert kinds == ["consent", "sign-in"]


def test_a_batch_is_one_object_timed_by_the_browser():
    h = on()
    token = agreed(h)
    before = set(objects(h))
    at = dogfood.iso(h.clock() - 2)  # 2 s before the relay saw it
    h.call("POST", "/dogfood/events", {"events": [
        {"kind": "nav", "name": "stage", "project": "proj_1", "stage": "storyboard", "at": at, "tab": "t1", "seq": 1},
        {"kind": "click", "name": "button: Retry", "at": at, "seq": 2},
    ]}, token, expect=204)
    new = set(objects(h)) - before
    assert len(new) == 1 and "-web-" in next(iter(new))
    web = [e for e in lines(h) if e["source"] == "web"]
    assert [e["name"] for e in web] == ["stage", "button: Retry"]
    assert web[0]["ts"] == at and web[0]["project"] == "proj_1" and web[0]["data"]["tab"] == "t1"


def test_a_batch_over_the_limit_is_refused():
    h = on()
    token = agreed(h)
    big = {"events": [{"kind": "click", "name": "x" * 290, "data": {"pad": "y" * 900}}] * 300}
    h.call("POST", "/dogfood/events", big, token, expect=413)


def test_a_2s_poll_for_a_minute_writes_only_state_changes():
    h = on()
    token = agreed(h)
    _, job = h.post_job(token, expect=200)
    for _ in range(30):
        h.clock.tick(2)
        h.poll(token, job["jobId"])
    h.providers[job["provider"]].succeed(job["requestId"])
    h.clock.tick(2)
    assert h.poll(token, job["jobId"])["state"] == "completed"
    mine = [e for e in lines(h) if e["kind"] not in ("consent", "sign-in")]
    assert not [e for e in mine if e["name"].startswith("GET")]
    assert len(mine) <= 6, [(e["kind"], e["name"]) for e in mine]
    states = [e["name"] for e in mine if e["kind"] == "job"]
    assert states[0] == "queued" and states[-1] == "completed"
    assert all(e["data"]["jobId"] == job["jobId"] for e in mine)


def test_twenty_identical_queue_full_answers_are_one_queued_line_and_one_repeat():
    h = on(inFlightPerParticipant=1)
    token = agreed(h)
    h.post_job(token, expect=200)  # holds the one place
    waiting = new_id("job")
    for _ in range(20):
        h.clock.tick(10)
        h.post_job(token, job_id=waiting, expect=429)
    raw = [e for e in lines(h) if e.get("data", {}).get("jobId") == waiting or e["kind"] == "repeat"]
    assert [e["kind"] for e in raw] == ["job", "repeat"]  # one line, and one object rewritten as the run grew
    folded = [e for e in dogfood.fold_lines(lines(h)) if e.get("data", {}).get("jobId") == waiting or e["kind"] == "repeat"]
    assert [(e["kind"], e["name"]) for e in folded] == [("job", "queued"), ("repeat", "queued")]
    assert folded[0]["data"]["waiting"] == "queue_full"
    assert folded[1]["data"]["count"] == 19 and folded[1]["data"]["of"] == "job"


def test_what_was_asked_is_kept_capped_but_never_a_header_or_an_upload_url():
    h = on()
    token = agreed(h)
    h.call("POST", "/jobs", {"contractVersion": "2", "jobId": new_id("job"), "op": "generate", "parentIds": [],
                             "input": {"text": "a red coat hero", "refs": []}}, token,
           headers={"X-Own-Keys": "fal=SECRET-FAL-KEY", "X-Project-Id": "proj_x"})
    h.call("POST", "/uploads", {"sha256": "sha256:" + "a" * 64, "mime": "image/png", "bytes": 10}, token, expect=200)
    everything = b"".join(objects(h).values()).decode()
    assert "SECRET-FAL-KEY" not in everything and token not in everything and "X-Amz-Signature" not in everything
    req = [e for e in lines(h) if e["kind"] == "request" and e["name"] == "POST /jobs"]
    assert len(req) == 1 and "a red coat hero" in req[0]["data"]["body"]["text"] and req[0]["project"] == "proj_x"
    up = [e for e in lines(h) if e["name"] == "POST /uploads"]
    assert up and "body" not in up[0]["data"]


def test_a_job_event_says_where_it_ran_and_why_it_moved():
    h = on()
    token = agreed(h)
    h.providers["fal"].submit_effect = RuntimeError("fal down")  # the floor (runway) makes it instead
    _, job = h.post_job(token, expect=200)
    jobs = [e for e in lines(h) if e["kind"] == "job"]
    assert {e["data"]["jobId"] for e in jobs} == {job["jobId"]}
    assert [(e["name"], e["data"].get("provider")) for e in jobs] == [
        ("queued", None), ("submitting", "fal"), ("queued", None), ("submitting", "runway"), ("submitted", "runway")]
    assert jobs[2]["data"]["fallbackReason"].startswith("fal could not make it")
    assert jobs[-1]["data"]["fallbackFrom"]["provider"] == "fal"


def test_a_failing_store_changes_no_answer():
    h = on()
    token = agreed(h)

    def broken(key, data, mime):
        if key.startswith("dogfood/"):
            raise OSError("S3 is down")
        h.blobs.objects[key] = (data, mime)

    h.blobs.put = broken
    _, job = h.post_job(token, expect=200)
    assert h.poll(token, job["jobId"])["state"] == "submitted"
    h.call("POST", "/dogfood/events", {"events": [{"kind": "click", "name": "a"}]}, token)


def test_fold_lines_reads_in_time_order_and_joins_runs_split_across_writers():
    a = {"participant": "p_a", "source": "relay", "kind": "request", "name": "POST /clan", "data": {"status": 204}}
    b = {"participant": "p_b", "source": "web", "kind": "click", "name": "button: Go", "data": {}}
    lines_ = [
        {**a, "ts": "2026-10-09T10:00:00.000Z", "data": {"status": 204, "latencyMs": 3}},
        {**b, "ts": "2026-10-09T10:00:01.000Z"},
        {**a, "ts": "2026-10-09T10:00:02.000Z", "data": {"status": 204, "latencyMs": 9}},  # another Lambda
        {"participant": "p_a", "source": "relay", "kind": "repeat", "name": "POST /clan", "ts": "2026-10-09T10:00:05.000Z",
         "data": {"of": "request", "count": 3, "first": "2026-10-09T10:00:03.000Z", "last": "2026-10-09T10:00:05.000Z"}},
        {**b, "ts": "2026-10-09T09:59:59.000Z", "kind": "feedback", "name": "frame", "data": {"thumb": "up"}},
        {**b, "ts": "2026-10-09T09:59:59.500Z", "kind": "feedback", "name": "frame", "data": {"thumb": "up"}},
    ]
    out = dogfood.fold_lines(lines_)
    assert [e["ts"] for e in out] == sorted(e["ts"] for e in out)
    mine = [e for e in out if e["participant"] == "p_a"]
    assert [e["kind"] for e in mine] == ["request", "repeat"]
    assert mine[1]["data"]["count"] == 4 and mine[1]["data"]["last"] == "2026-10-09T10:00:05.000Z"
    assert len([e for e in out if e["kind"] == "feedback"]) == 2  # a person's statements never fold


def test_a_huge_event_is_capped():
    big = dogfood.capped({"text": "x" * (dogfood.BODY_CAP + 10)})
    assert big["capped"]["truncated"] and big["capped"]["size"] > dogfood.BODY_CAP
    assert dogfood.body_value(b"\xff\xfe binary")["binary"]


def test_a_pruned_person_stops_being_recorded_within_minutes():
    h = on()
    token = agreed(h)
    for k in [k for k in h.blobs.objects if k.startswith("dogfood/")]:
        del h.blobs.objects[k]
    h.clock.tick(dogfood.CONSENT_TTL_S + 1)
    h.post_job(token, expect=200)
    assert not objects(h)
