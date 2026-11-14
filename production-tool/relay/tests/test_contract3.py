"""Contract 3 at the relay (features/contract-v3.clan): the version check, who a job belongs to,
unbuilt ops, asks (needs_input, the answer route, first answer wins, Change), aspect, the stitch
mapping and director.v6."""

import json

import pytest

from contracts_dir import contracts_dir
from conftest import CDN, Harness, asset, base_config, envelope, job_request, ref
from director import new_id
from director.claude import make as make_director
from director.model import Reply
from service import STALE_BUILD


def ask_job(h, token, op="generate", **inp):
    """A job the passthrough asks about first (its [ask] hook)."""
    inp = inp or {"text": "a hero [ask]", "refs": [ref(1, kind="drawing")]}
    _, job = h.post_job(token, op=op, expect=200, **inp)
    return job


def answer(h, token, job, expect=200, **body):
    body = {"contractVersion": "3", "questionId": job["question"]["id"], **(body or {"optionId": "straight"})}
    return h.call("POST", f"/jobs/{job['jobId']}/answer", body, token, expect=expect)[1]


# ── the version check ────────────────────────────────────────────────────────

def test_a_contract_2_request_is_told_to_reload_and_writes_nothing(h):
    token = h.as_person()
    req = job_request("generate", new_id("job"))
    req["contractVersion"] = "2"
    _, out = h.call("POST", "/jobs", req, token, expect=400)
    assert out["error"] == {"code": "invalid_input", "message": STALE_BUILD, "retryable": False}
    assert h.store.get_job(req["jobId"]) is None
    assert h.relay.remaining(h.people[token]["pid"])["image"] == h.cfg["quotas"]["image"]
    # The same request with a v2 body shape (no project, node or nonce) is refused for the version first.
    old = {"contractVersion": "2", "jobId": new_id("job"), "op": "generate", "parentIds": [], "input": {"text": "x"}}
    assert h.call("POST", "/jobs", old, token, expect=400)[1]["error"]["message"] == STALE_BUILD


def test_a_contract_3_job_carries_who_started_it_where_and_for_what(h):
    token = h.as_person("alice")
    req = {**job_request("frame", new_id("job"), shot={"id": new_id("shot"), "kind": "shot", "duration_s": 3,
                                                      "camera": {"size": "wide"}, "action": "rain", "refs": []},
                         image=asset(3), ratio="16:9"), "purpose": "frame for shot 1"}
    _, job = h.call("POST", "/jobs", req, token, expect=200)
    who = h.people[token]
    assert job["contractVersion"] == "3"
    assert (job["tenantId"], job["startedBy"], job["crew"]) == (who["tenant"]["id"], f"human:{who['pid']}", "wren")
    assert (job["projectId"], job["node"], job["nonce"], job["purpose"]) == (req["projectId"], req["node"], req["nonce"], "frame for shot 1")
    _, plan = h.post_job(token, op="shot_list", expect=200)
    assert plan["crew"] == "dex" and plan["quotaClass"] == "text"


# upscale is built (features/image-editor.clan; tests/test_image_editor.py); cutout is not, since Remove
# background left the editor (owner, 2026-10-16).
@pytest.mark.parametrize("op", ["bridge", "transcribe", "read", "check", "resize", "cutout"])
def test_an_op_not_built_yet_is_422_capability_missing_before_quota(h, op):
    token = h.as_person()
    inp = {"text": "x"}
    if op == "resize":  # its input has a shape (features/campaign-formats.clan); a still is
        # never re-edited (extend and regenerate are built: tests/test_campaign.py)
        inp = json.loads((contracts_dir() / "examples" / f"job-request.{op}.json").read_text())["input"]
        if op == "resize":
            inp["resize"]["method"] = "reedit"
    _, out = h.call("POST", "/jobs", {**envelope(op, new_id("job")), "input": inp}, token, expect=422)
    assert out["error"]["code"] == "capability_missing"
    assert h.relay.remaining(h.people[token]["pid"]) == h.cfg["quotas"]


# ── asks ─────────────────────────────────────────────────────────────────────

def test_a_question_waits_in_needs_input_uncharged_and_never_times_out(h):
    token = h.as_person("alice")
    job = ask_job(h, token)
    assert job["state"] == "needs_input"
    q = job["question"]
    assert q["id"].startswith("q_") and q["kind"] == "nudge" and q["recommended_option_id"] == "plan_first"
    assert job["cost"]["reserved"] == 0 and "confirmed" not in job["cost"]
    assert h.store.counters("spend").get("usd", 0) == 0
    assert h.store.counters(f"inflight#{job['participantId']}").get("n", 0) == 0
    assert not h.providers["mock"].submits and not h.providers["runway"].submits
    h.clock.tick(48 * 3600)
    h.relay.sweep()
    assert h.poll(token, job["jobId"])["state"] == "needs_input"


def test_another_member_of_the_agency_answers_and_the_same_job_runs_on_its_starters_budget(h):
    alice, bob = h.as_person("alice"), h.as_person("bob")
    job = ask_job(h, alice)
    out = answer(h, bob, job, optionId="straight")
    assert out["jobId"] == job["jobId"] and out["state"] == "submitted"
    assert out["participantId"] == job["participantId"] and out["startedBy"] == job["startedBy"]
    assert out["answeredBy"] == f"human:{h.people[bob]['pid']}" and out["answer"] == {"option_id": "straight"}
    assert out["question"] == job["question"]
    assert h.store.counters(f"inflight#{job['participantId']}").get("n") == 1  # the starter's place, not bob's
    assert h.store.counters(f"inflight#{h.people[bob]['pid']}").get("n", 0) == 0
    assert h.relay.remaining(h.people[bob]["pid"])["image"] == h.cfg["quotas"]["image"]
    stored = h.store.get_job(job["jobId"])
    assert stored["_req"]["input"]["answer"] == {"contractVersion": "3", "questionId": job["question"]["id"], "optionId": "straight"}


def test_the_first_answer_wins_and_a_second_gets_409_with_the_winner(h):
    alice, bob = h.as_person("alice"), h.as_person("bob")
    job = ask_job(h, alice)
    answer(h, bob, job, optionId="straight")
    out = answer(h, alice, job, expect=409, optionId="plan_first")
    assert out["answeredBy"] == f"human:{h.people[bob]['pid']}" and out["answer"] == {"option_id": "straight"}
    assert out["error"]["code"] == "conflict" and "Dev: go ahead" in out["error"]["message"]
    assert h.store.get_job(job["jobId"])["answer"] == {"option_id": "straight"}


def test_an_answer_that_lost_the_ledger_race_gets_the_winner(h):
    alice, bob = h.as_person("alice"), h.as_person("bob")
    job = ask_job(h, alice)
    real = h.store.save_job

    def racing(j):  # bob's answer lands between alice's read and her conditional write
        h.store.save_job = real
        theirs = h.store.get_job(j["jobId"])
        real({**theirs, "answeredBy": f"human:{h.people[bob]['pid']}", "answer": {"option_id": "plan_first"}})
        return real(j)

    h.store.save_job = racing
    out = answer(h, alice, job, expect=409, optionId="straight")
    assert out["answer"] == {"option_id": "plan_first"}


def test_only_the_jobs_agency_may_answer_and_only_its_own_question(h):
    alice = h.as_person("alice")
    job = ask_job(h, alice)
    answer(h, h.as_person("eve", "red"), job, expect=404)
    h.call("POST", f"/jobs/{job['jobId']}/answer", {"contractVersion": "3", "questionId": "q_" + "0" * 26, "optionId": "straight"},
           alice, expect=400)
    answer(h, alice, job, expect=400, optionId="nope")
    answer(h, alice, job, expect=400, text="words")  # this question takes an option
    h.call("POST", f"/jobs/{job['jobId']}/answer", {"contractVersion": "2", "questionId": job["question"]["id"], "optionId": "straight"},
           alice, expect=400)
    done = h.post_job(alice, expect=200)[1]
    _, out = h.call("POST", f"/jobs/{done['jobId']}/answer", {"contractVersion": "3", "questionId": job["question"]["id"],
                                                               "optionId": "straight"}, alice, expect=409)
    assert out["error"]["code"] == "conflict"


def test_a_shot_list_question_is_answered_and_the_plan_lands(h):
    token = h.as_person()
    job = ask_job(h, token, op="shot_list", script="A hero walks in. She smiles. [ask]", targetS=15)
    assert job["state"] == "needs_input" and job["crew"] == "dex"
    out = answer(h, token, job, optionId="plan_first")
    assert out["state"] == "completed" and sum(s["duration_s"] for s in out["shots"]) == 15
    assert all(s["kind"] == "shot" and "camera" in s for s in out["shots"])


def test_change_is_a_follow_up_job_that_names_its_parent_and_the_director_hears_the_question(h):
    token = h.as_person()
    job = ask_job(h, token)
    answer(h, token, job, optionId="straight")
    seen = []
    real = h.relay.director.direct
    h.relay.director.direct = lambda req, sheet: seen.append(req["input"]) or real(req, sheet)
    change = {**envelope("generate", new_id("job")), "parentIds": [job["jobId"]],
              "input": {"text": "a hero", "refs": [ref(1, kind="drawing")],
                        "answer": {"contractVersion": "3", "questionId": job["question"]["id"], "optionId": "plan_first"}}}
    _, out = h.call("POST", "/jobs", change, token, expect=200)
    assert out["jobId"] != job["jobId"] and out["state"] == "submitted"
    assert seen[0]["answer"]["question"].startswith("Dev check:") and seen[0]["answer"]["chose"] == "Dev: plan first"
    assert h.store.get_job(out["jobId"])["_req"]["parentIds"] == [job["jobId"]]


def test_stopping_a_waiting_job_gives_the_quota_back(h):
    token = h.as_person()
    job = ask_job(h, token)
    pid = job["participantId"]
    assert h.relay.remaining(pid)["image"] == h.cfg["quotas"]["image"] - 1
    out = h.call("DELETE", f"/jobs/{job['jobId']}", None, h.as_person("bob"), expect=200)[1]  # anyone in the agency may stop it
    assert out["state"] == "cancelled"
    assert h.relay.remaining(pid)["image"] == h.cfg["quotas"]["image"]
    assert h.store.counters(f"inflight#{pid}").get("n", 0) == 0


# ── aspect, stitch, director.v6 ──────────────────────────────────────────────

def test_a_4_5_frame_goes_to_runway_at_its_size(h):
    token = h.as_person()
    shot = {"id": new_id("shot"), "kind": "shot", "duration_s": 3, "camera": {"size": "close"}, "action": "she smiles", "refs": []}
    _, job = h.post_job(token, op="frame", expect=200, shot=shot, ratio="4:5", aspect={"w": 4, "h": 5},
                        delivery={"width": 1440, "height": 1800},
                        safeArea={"type": "insets", "top": 14, "right": 6, "bottom": 35, "left": 6, "unit": "%"},
                        context=[{"kind": "brand_rule", "text": "Leave clear space around the logo."}])
    assert job["state"] == "submitted", job
    assert h.providers["runway"].submits[0]["ratio"] == "896:1152"


def test_stitch_leaves_the_end_card_shot_to_stitchs_own_card_and_keeps_its_payload(h):
    token = h.as_person()
    clip = lambda n, **kw: {"asset": {**asset(n, "video/mp4"), "url": f"{CDN}/out/{asset(n)['sha256']}"}, **kw}  # noqa: E731
    for n in (4, 5, 6):
        h.blobs.put(f"out/{asset(n)['sha256']}", b"mp4", "video/mp4")
    _, job = h.post_job(token, op="stitch", expect=200, clips=[clip(4, trimS=3), clip(5), clip(6, endCard=True, trimS=2.5)])
    (payload,) = h.stitched
    assert set(payload) == {"jobId", "clips", "outKey", "resultKey"}
    assert payload["clips"] == [{"key": f"out/{asset(4)['sha256']}", "trimS": 3}, {"key": f"out/{asset(5)['sha256']}"}]
    assert payload["outKey"] == f"ads/{job['jobId']}.mp4" and job["crew"] == "edie"


class Wire:
    api = "anthropic"

    def send(self, **kw):
        return Reply(json.dumps({"op": "generate", "question": None, "rationale": "x", "confidence": 1}), "ok", (1, 1))


def test_a_config_naming_director_v5_is_refused_loudly_under_contract_3():
    cfg = base_config()
    cfg["director"]["promptVersion"] = "director.v5"
    h = Harness(cfg)
    h.relay.director = make_director(wire=Wire())
    _, job = h.post_job(h.as_person(), expect=200)
    assert job["state"] == "failed" and job["error"]["code"] == "internal"
    assert "director.v5" in job["error"]["message"] and "director.v6" in job["error"]["message"]
    assert not h.providers["mock"].submits
