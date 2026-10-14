"""Fix this moment: op clip_patch, one relay job in three stages (features/clip-moment-edit.clan).

Stitch reads the take (and on a cut send cuts the window out), the model remakes the window (a range
send, the default since the owner's 2026-10-14 decision: the whole take, with the window as the
keyframe's range), and stitch splices the window back. Here the stitch Lambda is a fake whose results the tests write (stitch/tests run the real ffmpeg),
and the provider is the conftest fake, or the real Runway adapter on a fake HTTP client.
"""

from __future__ import annotations

import copy
import hashlib
import json

import httpx
import pytest

import time_rules
from conftest import CDN, Harness, asset, base_config, envelope
from contracts import Contracts
from contracts_dir import contracts_dir, pricing
from director import new_id
from director.director import Director, DirectorError
from providers import load_sheet
from providers._seam import Adapted, Resolver
from providers.runway import RunwayProvider
from provider_schemas import errors as body_errors
from service import PATCH_SPLICE_FAILED, PATCH_UNAVAILABLE, provider_op_for

PATCHES = json.loads((contracts_dir() / "examples" / "patches.json").read_text())


def sha(n: str) -> str:
    return "sha256:" + hashlib.sha256(n.encode()).hexdigest()


TAKE = {"sha256": sha("take"), "url": f"{CDN}/out/{sha('take')}", "mime": "video/mp4"}
CUT, STILL, LAST, EDITED, RAW, OUT = (sha(x) for x in ("cut", "still", "last", "edited", "raw", "out"))


def config(**patch) -> dict:
    cfg = base_config()
    cfg["routing"]["clip_patch"] = ["runway"]
    cfg["flags"]["clipPatch"] = True
    if patch:
        cfg["clipPatch"] = patch
    return cfg


def harness(cfg: dict | None = None) -> Harness:
    h = Harness(cfg or config())
    h.token = h.as_person()
    return h


def patch_input(a=2, b=4, at=3.2, **more) -> dict:
    return {"text": "her eyes should open here", "video": dict(TAKE), "window": {"from_s": a, "to_s": b}, "atS": at, **more}


def post(h, expect=200, job_id=None, **inp):
    req = {**envelope("clip_patch", job_id or new_id("job")), "input": patch_input(**inp)}
    return h.call("POST", "/jobs", req, h.token, expect=expect)[1]


def stitch_result(h, job, name: str, data: dict) -> None:
    h.blobs.put(f"ads/scratch/{job['jobId']}/{name}", json.dumps(data).encode(), "application/json")


def cut_done(h, job, seconds=None, stills=(STILL,), take_s=6.0, name="cut.json"):
    """Stitch's stage 1 result: the take read, its stills, and the sub-clip when one was asked (seconds)."""
    data = {"ok": True, "takeS": take_s, "w": 1280, "h": 720, "fps": 24.0,
            "stills": [{"sha256": s, "bytes": 5} for s in stills]}
    if seconds is not None:
        data["clip"] = {"sha256": CUT, "bytes": 10, "durationS": seconds}
    stitch_result(h, job, name, data)
    return h.poll(h.token, job["jobId"])


def provider_done(h, job, provider="runway", cost=0.56):
    rid = h.providers[provider].submits and f"{provider}-{len(h.providers[provider].submits)}"
    h.providers[provider].succeed(rid, data=b"raw-mp4", cost=cost)
    h.clock.tick(6)
    return h.poll(h.token, job["jobId"])


def splice_done(h, job, tries=1, ok=True, seams=((2.0, 0.93), (4.0, 0.91)), exact=True):
    data = {"ok": True, "sha256": OUT, "bytes": 99, "w": 1280, "h": 720, "fps": 24.0, "durationS": 6.0, "exact": exact,
            "seams": [{"at_s": t, "score": s, "ok": s >= 0.85} for t, s in seams]} if ok else {"ok": False, "error": "x"}
    stitch_result(h, job, f"splice-{tries}.json", data)
    return h.poll(h.token, job["jobId"])


def spend(h) -> float:
    return round(h.store.counters("spend").get("usd", 0), 4)


def video_used(h) -> int:
    pid = h.people[h.token]["pid"]
    return int(h.store.counters(f"{pid}#{h.relay._day()}").get("video", 0))


# ── the whole job ───────────────────────────────────────────────────────────

def test_the_three_stages_run_end_to_end_and_fill_the_patch_block():
    h = harness()
    job = post(h)
    assert (job["state"], job["op"], job["crew"], job["quotaClass"], job["model"]) == ("submitted", "clip_patch", "edie", "video", "aleph2")
    assert job["patch"] == {"send": "range", "window": {"from_s": 2, "to_s": 4}, "cut": {"from_s": 0, "to_s": 4},
                            "range": {"start_s": 2, "end_s": 4}, "keyframe": "still", "model": "aleph2"}  # cut: as planned
    assert job["cost"]["reserved"] == 0.56 and spend(h) == 0.56  # billed by the range, not the take
    cut = h.stitched[-1]
    assert cut["mode"] == "cut" and cut["key"] == f"out/{TAKE['sha256']}"
    assert "clip" not in cut  # a range send goes whole: stitch only reads it and grabs the keyframe
    assert cut["stills"] == [{"atS": 3.2, "key": f"ads/scratch/{job['jobId']}/still.png"}]

    job = cut_done(h, job)
    assert job["state"] == "submitted" and job["provider"] == "runway" and job["patch"]["cut"] == {"from_s": 0, "to_s": 6.0}
    sent = h.providers["runway"].submits[-1]
    assert h.providers["runway"].ops[-1] == "clip_edit"  # never clip_patch at the adapter
    assert sent["refs"] == [{"sha256": TAKE["sha256"], "name": "current", "role": "current"}]  # the whole take
    assert sent["keyframe"] == {"sha256": STILL, "atS": 3.2, "startS": 2, "endS": 4} and sent["model"] == "aleph2"

    job = provider_done(h, job)
    assert job["state"] == "submitted"
    splice = h.stitched[-1]
    assert splice["mode"] == "splice" and splice["parentKey"] == f"out/{TAKE['sha256']}"
    assert (splice["cutFromS"], splice["windowFromS"], splice["windowToS"], splice["crossfadeS"], splice["seamMin"]) == (0, 2, 4, 0.25, 0.85)
    assert splice["outKey"] == f"ads/patch/{job['jobId']}.mp4"
    assert h.store.counters("slots#runway#video").get("n") == 0  # the provider's slot is free while it splices

    job = splice_done(h, job)
    assert job["state"] == "completed" and job["kind"] == "generated"
    assert job["outputs"] == [{"sha256": OUT, "url": f"{CDN}/ads/patch/{job['jobId']}.mp4", "mime": "video/mp4",
                               "bytes": 99, "w": 1280, "h": 720, "durationS": 6.0}]
    assert job["patch"]["exact"] is True and [s["ok"] for s in job["patch"]["seams"]] == [True, True]
    assert job["cost"]["confirmed"] == 0.56 and spend(h) == 0.56
    assert h.store.claimed_by(f"patch#{TAKE['sha256']}", h.clock()) is None  # the take is free again


def test_a_low_seam_lands_with_judes_score_on_the_job():
    h = harness()
    job = cut_done(h, post(h))
    job = splice_done(h, provider_done(h, job), seams=((2.0, 0.62), (4.0, 0.9)))
    assert job["state"] == "completed"
    assert job["patch"]["seams"] == [{"at_s": 2.0, "score": 0.62, "ok": False}, {"at_s": 4.0, "score": 0.9, "ok": True}]


# ── admission ───────────────────────────────────────────────────────────────

def test_off_unless_the_flag_says_on():
    cfg = config()
    del cfg["flags"]["clipPatch"]
    h = harness(cfg)
    assert post(h, expect=403)["error"]["code"] == "flag_off"
    h.cfg["flags"]["clipPatch"] = False
    assert post(h, expect=403)["error"]["code"] == "flag_off"
    assert spend(h) == 0 and video_used(h) == 0


@pytest.mark.parametrize("case", PATCHES["estimates"]["cases"], ids=lambda c: f"{c['seconds']}s")
def test_the_price_is_the_sheets_per_second_rate_on_the_cut(case):
    # Priced through contracts/pricing.py from the models catalogue (runway-sheet-sync).
    h = harness()
    assert h.relay._estimate("clip_patch", "runway", seconds=case["seconds"]) == (case["usd"], False)


def test_a_3_s_window_reserves_084_and_context_only_widens_a_cut_send():
    h = harness()
    assert post(h, a=2, b=5)["cost"]["reserved"] == 0.84
    assert post(harness(config(contextS=1)))["cost"]["reserved"] == 0.56  # a range send bills the range alone
    h2 = harness(config(send="cut", contextS=1))
    job = post(h2)
    assert job["patch"]["send"] == "cut" and job["patch"]["cut"] == {"from_s": 1, "to_s": 5} and job["cost"]["reserved"] == 1.12
    assert job["patch"]["keyframe"] == "still" and job["patch"]["range"] == {"start_s": 1, "end_s": 3}
    assert h2.stitched[-1]["clip"] == {"fromS": 1, "toS": 5, "outKey": f"ads/scratch/{job['jobId']}/cut.mp4"}


def test_the_real_cut_length_reprices_a_cut_send():
    h = harness(config(send="cut", contextS=1))
    job = post(h, a=4, b=6, at=5, video=dict(TAKE))  # 3-7 s asked
    job = cut_done(h, job, seconds=3.4, take_s=6.4)  # of a 6.4 s take: stitch cut 3-6.4
    assert job["patch"]["cut"] == {"from_s": 3, "to_s": 6.4} and job["cost"]["reserved"] == 1.12 and spend(h) == 1.12
    assert h.providers["runway"].submits[-1]["refs"][0]["sha256"] == CUT  # the cut, never the take


def test_a_take_of_unknown_length_is_read_before_it_is_sent_whole():
    h = harness()
    job = post(h, video=dict(TAKE))
    job = cut_done(h, job, take_s=8.0)
    assert job["patch"]["cut"] == {"from_s": 0, "to_s": 8.0} and job["cost"]["reserved"] == 0.56
    assert h.providers["runway"].submits[-1]["refs"][0]["sha256"] == TAKE["sha256"]


def test_a_take_longer_than_aleph_takes_is_cut_after_all():
    h = harness()
    job = post(h, video=dict(TAKE))
    job = cut_done(h, job, take_s=40.0)  # read: too long to send whole
    assert job["state"] == "submitted" and job["patch"]["send"] == "cut" and job["patch"]["cut"] == {"from_s": 2, "to_s": 4}
    again = h.stitched[-1]
    assert again["clip"]["fromS"] == 2 and again["resultKey"].endswith("cut-2.json") and not h.providers["runway"].submits
    job = cut_done(h, job, seconds=2.0, take_s=40.0, name="cut-2.json")
    assert h.providers["runway"].submits[-1]["refs"][0]["sha256"] == CUT and job["cost"]["reserved"] == 0.56
    job = provider_done(h, job)
    assert h.stitched[-1]["cutFromS"] == 2


@pytest.mark.parametrize("inp,words", [
    ({"a": 2, "b": 3}, "at least 2 s"),
    ({"at": 5.5}, "outside its window"),
])
def test_a_window_that_cannot_work_is_refused_before_quota(inp, words):
    h = harness()
    out = post(h, expect=400, **inp)
    assert words in out["error"]["message"] and video_used(h) == 0 and spend(h) == 0


def test_a_take_that_is_not_ours_or_not_a_video_is_refused():
    h = harness()
    req = {**envelope("clip_patch", new_id("job")), "input": {**patch_input(), "video": {**TAKE, "url": "https://elsewhere.test/x.mp4"}}}
    assert "not one of ours" in h.call("POST", "/jobs", req, h.token, expect=400)[1]["error"]["message"]
    req = {**envelope("clip_patch", new_id("job")), "input": {**patch_input(), "video": asset(9)}}
    assert "video" in h.call("POST", "/jobs", req, h.token, expect=400)[1]["error"]["message"]


def test_a_model_not_on_the_sheet_is_refused():
    h = harness(config(model="gen9"))
    assert post(h, expect=422)["error"]["code"] == "capability_missing"


# ── one patch per take ──────────────────────────────────────────────────────

def test_a_second_patch_on_the_same_take_is_409_naming_the_running_window():
    h = harness()
    post(h)
    out = post(h, expect=409, a=3, b=5, at=3.5)
    assert out["error"]["code"] == "conflict" and "0:02-0:04" in out["error"]["message"]
    assert video_used(h) == 1 and spend(h) == 0.56  # the second took nothing


@pytest.mark.parametrize("end", ["completed", "failed", "cancelled", "timeout", "uncertain", "lost_submit"])
def test_the_take_is_free_again_on_every_end(end):
    from providers.base import ProviderError
    h = harness()
    job = post(h)
    key = f"patch#{TAKE['sha256']}"
    if end == "completed":
        job = splice_done(h, provider_done(h, cut_done(h, job)))
    elif end == "failed":
        stitch_result(h, job, "cut.json", {"ok": False, "error": "Could not get the take ready for the fix."})
        job = h.poll(h.token, job["jobId"])
    elif end == "cancelled":
        job = h.call("DELETE", f"/jobs/{job['jobId']}", None, h.token)[1]
    elif end == "timeout":
        h.clock.tick(121)
        job = h.poll(h.token, job["jobId"])
    elif end == "uncertain":
        h.providers["runway"].submit_effect = ProviderError("provider_failed", "reset", accepted=True)
        job = cut_done(h, job)
    else:  # the submit never came back
        h.providers["runway"].submit_effect = RuntimeError("socket reset")
        job = cut_done(h, job)
    assert job["state"] in ("completed", "failed", "cancelled", "uncertain"), job
    assert h.store.claimed_by(key, h.clock()) is None
    assert post(h)["state"] == "submitted"  # the next fix runs


def test_a_claim_that_was_never_released_expires():
    h = harness()
    job = post(h)
    h.store._jobs[job["jobId"]]["_lock"] = None  # as if its release were lost
    h.store.release("nothing", "x")
    hold = h.relay._patch_hold_s(h.cfg)
    h.clock.tick(hold + 1)
    assert post(h, a=3, b=5, at=3.5)["state"] == "submitted"


# ── stage clocks and money ──────────────────────────────────────────────────

def test_a_cut_that_times_out_or_fails_gives_everything_back():
    for fail in ("timeout", "error"):
        h = harness()
        job = post(h)
        if fail == "timeout":
            h.clock.tick(119)
            assert h.poll(h.token, job["jobId"])["state"] == "submitted"
            h.clock.tick(2)
        else:
            stitch_result(h, job, "cut.json", {"ok": False, "error": "Could not get the take ready for the fix."})
        job = h.poll(h.token, job["jobId"])
        assert job["state"] == "failed" and job["error"]["code"] in ("timeout", "provider_failed")
        assert spend(h) == 0 and video_used(h) == 0 and not h.providers["runway"].submits


def test_the_provider_stage_keeps_todays_timeout_rule():
    h = harness()
    job = cut_done(h, post(h))
    h.clock.tick(h.cfg["jobTimeoutS"]["video"] + 1)
    job = h.poll(h.token, job["jobId"])
    assert job["state"] == "failed" and job["error"]["code"] == "timeout"
    assert spend(h) == 0 and video_used(h) == 0  # never seen running: nothing kept (service.py's rule)


def test_a_failed_splice_is_tried_again_once_then_fails_charged_with_the_raw_output_kept():
    h = harness()
    job = provider_done(h, cut_done(h, post(h)))
    job = splice_done(h, job, tries=1, ok=False)
    assert job["state"] == "submitted" and h.stitched[-1]["resultKey"].endswith("splice-2.json")
    h.clock.tick(181)  # the second try never answers
    job = h.poll(h.token, job["jobId"])
    assert job["state"] == "failed" and job["error"]["message"] == PATCH_SPLICE_FAILED
    assert "$" not in job["error"]["message"] and "charge" not in job["error"]["message"].lower()  # silently
    assert job["patch"]["rawOutput"]["sha256"].startswith("sha256:")
    assert job["cost"]["confirmed"] == 0.56 and spend(h) == 0.56 and video_used(h) == 1


def test_a_splice_that_succeeds_on_its_second_try_lands():
    h = harness()
    job = splice_done(h, provider_done(h, cut_done(h, post(h))), tries=1, ok=False)
    job = splice_done(h, job, tries=2)
    assert job["state"] == "completed"


def test_an_aleph_entitlement_refusal_fails_with_a_refund_and_no_price():
    from providers.base import ProviderError
    h = harness()
    h.providers["runway"].submit_effect = ProviderError("provider_failed", "Runway answered 403", provider_code="403")
    job = cut_done(h, post(h))
    assert job["state"] == "failed" and job["error"]["message"] == PATCH_UNAVAILABLE and "$" not in PATCH_UNAVAILABLE
    assert spend(h) == 0 and video_used(h) == 0


def test_cancel_in_the_cut_is_free_and_in_the_splice_is_charged():
    h = harness()
    job = h.call("DELETE", f"/jobs/{post(h)['jobId']}", None, h.token)[1]
    assert job["state"] == "cancelled" and spend(h) == 0 and video_used(h) == 0
    h = harness()
    job = provider_done(h, cut_done(h, post(h)))
    job = h.call("DELETE", f"/jobs/{job['jobId']}", None, h.token)[1]
    assert job["state"] == "cancelled" and job["cost"]["confirmed"] == 0.56 and spend(h) == 0.56


# ── the model: chosen before the job, run as the op the adapter knows ───────

def veo_sheet() -> dict:
    sheet = copy.deepcopy(load_sheet("runway"))
    sheet["ops"]["clip_patch"]["alternates"] = [{"model": "veo3.1", "endpoint": "POST /v1/image_to_video", "defaults": {"durationS": 4},
                                                 "label": "Veo 3.1", "mode": "first_last", "durationsS": [4]}]
    return sheet


def test_provider_op_for_maps_clip_patch_and_leaves_every_other_op():
    sheet = veo_sheet()
    from providers.types import effective_sheet
    assert provider_op_for("clip_patch", effective_sheet(sheet, "clip_patch", "aleph2")["ops"]["clip_patch"]) == "clip_edit"
    assert provider_op_for("clip_patch", effective_sheet(sheet, "clip_patch", "veo3.1")["ops"]["clip_patch"]) == "clip"
    for op in ("clip", "clip_edit", "frame", "generate"):
        assert provider_op_for(op, None) == op


def runway_harness(cfg: dict, sheet: dict | None = None):
    """The relay with the real Runway adapter on a fake HTTP client: the request it would send."""
    h = harness(cfg)
    sent: list[httpx.Request] = []

    def answer(request):
        sent.append(request)
        return httpx.Response(200, json={"id": f"task_{len(sent)}"})

    sheet = sheet or load_sheet("runway")
    adapter = Adapted(RunwayProvider("key", Resolver(), client=httpx.Client(transport=httpx.MockTransport(answer)), sheet=sheet))
    h.relay.registry.register(adapter, sheet)
    return h, sent


@pytest.mark.parametrize("send,ctx,still,want", [
    ("range", 0, False, {"uri": f"{CDN}/ads/scratch/@/still.png", "seconds": 3.2, "range": {"start_seconds": 2, "end_seconds": 4}}),
    ("range", 0, True, {"uri": f"{CDN}/in/{EDITED}", "seconds": 3.2, "range": {"start_seconds": 2, "end_seconds": 4}}),
    ("cut", 0, False, None),
    ("cut", 0, True, {"uri": f"{CDN}/in/{EDITED}", "seconds": 1.2}),
    ("cut", 1, False, {"uri": f"{CDN}/ads/scratch/@/still.png", "seconds": 2.2, "range": {"start_seconds": 1, "end_seconds": 3}}),
])
def test_aleph_bodies_carry_what_is_sent_and_the_policys_keyframe(send, ctx, still, want):
    h, sent = runway_harness(config(send=send, contextS=ctx))
    more = {"still": {"sha256": EDITED, "url": f"{CDN}/in/{EDITED}", "mime": "image/png"}} if still else {}
    job = post(h, **more)
    cut_done(h, job, seconds=None if send == "range" else 4.0 if ctx else 2.0)
    assert sent[-1].url.path == "/v1/video_to_video"
    body = json.loads(sent[-1].content)
    video = TAKE["url"] if send == "range" else f"{CDN}/ads/scratch/{job['jobId']}/cut.mp4"
    assert body["model"] == "aleph2" and body["videoUri"] == video
    if want is None:
        assert "keyframes" not in body
    else:
        want = {**want, "uri": want["uri"].replace("@", job["jobId"])}
        assert body["keyframes"] == [want]
    assert body_errors("runway", "POST /v1/video_to_video", body) == []


def test_clippatch_model_veo_picks_the_alternate_before_submit_and_sends_first_and_last_frames():
    sheet = veo_sheet()
    h, sent = runway_harness(config(model="veo3.1"), sheet)
    h.providers["runway"].sheet = sheet
    h.relay.registry.sheets["runway"] = sheet
    shot = {"id": "shot_01K7B00000000000000000SH04", "kind": "shot", "duration_s": 6,
            "camera": {"size": "close"}, "action": "She wakes.", "refs": []}
    job = post(h, shot=shot)
    assert job["model"] == "veo3.1" and job["cost"]["reserved"] == pricing().op_usd(sheet, "clip_patch", "veo3.1", {"durationS": 4})
    assert job["patch"]["window"] == {"from_s": 1, "to_s": 5}  # widened to the 4 s Veo makes, inside the shot
    assert h.stitched[-1]["stills"] == [{"atS": 1, "key": f"ads/scratch/{job['jobId']}/still.png"},
                                        {"atS": 5, "key": f"ads/scratch/{job['jobId']}/last.png"}]
    assert job["patch"]["send"] == "frames" and "clip" not in h.stitched[-1]
    cut_done(h, job, stills=(STILL, LAST))
    assert sent[-1].url.path == "/v1/image_to_video"
    body = json.loads(sent[-1].content)
    assert body["model"] == "veo3.1" and body["duration"] == 4 and body["audio"] is False
    assert [f["position"] for f in body["promptImage"]] == ["first", "last"]
    assert body_errors("runway", "POST /v1/image_to_video", body) == []


# ── asks ────────────────────────────────────────────────────────────────────

class AskingDirector:
    """Dex judging the note to be about the whole shot."""
    sees_images = False

    def __init__(self):
        self.calls = []

    def direct(self, job_request, sheet, images=None):
        self.calls.append(job_request)
        if job_request["input"].get("answer"):
            from director import PassthroughDirector
            return PassthroughDirector().direct(job_request, sheet)
        return {"op": "clip_patch", "rationale": "the note is about the whole shot", "confidence": 0.6,
                "question": {"kind": "ambiguity", "text": "Fix only this moment, or remake the clip?",
                             "options": [{"id": "fix", "label": "Fix it", "value": {"route": "fix"}, "cost": {"estimate": 0.56, "currency": "USD"}},
                                         {"id": "remake", "label": "Remake", "value": {"route": "remake"}}],
                             "allow_text": False}}


def asked(h):
    h.relay.director = AskingDirector()
    job = cut_done(h, post(h))
    assert job["state"] == "needs_input"
    return job


def test_a_whole_shot_note_asks_fix_or_remake_uncharged_holding_nothing():
    h = harness()
    job = asked(h)
    q = job["question"]
    assert [(o["id"], o["label"]) for o in q["options"]] == [("fix", "Fix only 0:02-0:04"), ("remake", "Remake the whole clip")]
    assert q["allow_text"] is True and all("cost" not in o for o in q["options"])
    assert spend(h) == 0 and job["cost"]["reserved"] == 0
    assert h.store.claimed_by(f"patch#{TAKE['sha256']}", h.clock()) is None


def test_remake_cancels_free_with_the_handoff_and_the_quota_back():
    h = harness()
    job = asked(h)
    status, out = h.call("POST", f"/jobs/{job['jobId']}/answer", {"contractVersion": "3", "questionId": job["question"]["id"],
                                                                  "optionId": "remake"}, h.token)
    assert status == 200 and out["state"] == "cancelled" and out["handoff"] == {"op": "clip"}
    assert spend(h) == 0 and video_used(h) == 0


def test_fix_reclaims_the_take_and_runs_on():
    h = harness()
    job = asked(h)
    status, out = h.call("POST", f"/jobs/{job['jobId']}/answer", {"contractVersion": "3", "questionId": job["question"]["id"],
                                                                  "optionId": "fix"}, h.token)
    assert status == 200 and out["state"] == "submitted" and h.providers["runway"].ops[-1] == "clip_edit"
    assert h.store.claimed_by(f"patch#{TAKE['sha256']}", h.clock()) == job["jobId"]


def test_fix_while_another_patch_runs_is_409_and_the_ask_stays():
    h = harness()
    job = asked(h)
    h.relay.director = __import__("director").PassthroughDirector()
    post(h, a=3, b=5, at=3.5)  # the take was free while the first waited
    status, out = h.call("POST", f"/jobs/{job['jobId']}/answer", {"contractVersion": "3", "questionId": job["question"]["id"],
                                                                  "optionId": "fix"}, h.token, expect=409)
    assert out["error"]["code"] == "conflict"
    assert h.poll(h.token, job["jobId"])["state"] == "needs_input"


# ── the director's checks, run by the relay ─────────────────────────────────

def test_a_keyframe_outside_its_range_is_refused_by_the_directors_check():
    with pytest.raises(DirectorError):
        Director._check_keyframe({"sha256": STILL, "atS": 3.0, "startS": 1, "endS": 3})
    Director._check_keyframe({"sha256": STILL, "atS": 2.95, "startS": 1, "endS": 3})


# ── config rollout: old and new relays read old and new config files ───────

def test_old_and_new_configs_load_on_old_and_new_schemas():
    schema = json.loads((contracts_dir() / "config.schema.json").read_text())
    old = copy.deepcopy(schema)
    del old["properties"]["clipPatch"]
    del old["properties"]["flags"]["properties"]["clipPatch"]
    from jsonschema import Draft202012Validator
    from referencing import Registry, Resource
    common = json.loads((contracts_dir() / "common.schema.json").read_text())
    reg = Registry().with_resource(common["$id"], Resource.from_contents(common))
    live = json.loads((contracts_dir() / "examples" / "config.live.json").read_text())
    testing = json.loads((contracts_dir() / "examples" / "config.testing.json").read_text())
    old_live = {**live, "routing": {k: v for k, v in live["routing"].items() if k != "clip_patch"}}
    assert not list(Draft202012Validator(old, registry=reg).iter_errors(live))  # the live file loads on an old relay
    assert not list(Draft202012Validator(schema, registry=reg).iter_errors(old_live))  # an old file on the new relay
    assert not Contracts().errors("config.schema.json", testing)
    assert "clipPatch" not in live and not live["flags"].get("clipPatch")  # off in the live config


def test_patch_plan_twin_gives_the_relays_keyframe():
    plan = time_rules.patch_plan({"from_s": 2, "to_s": 4}, 3.2, 6, 0, edited=True)
    assert plan["send"] == "range" and plan["keyframe"] == "edited" and plan["keyframeS"] == 3.2
    plan = time_rules.patch_plan({"from_s": 2, "to_s": 4}, 3.2, 6, 0, edited=True, send="cut")
    assert plan["keyframe"] == "edited" and plan["keyframeS"] == 1.2
