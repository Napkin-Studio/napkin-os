"""features/connected-video.clan, phases A and B: clips that land on the next frame, takes of several shots,
the take's cuts, and a shot's window of a take made again.

The relay runs with the passthrough director and the conftest fakes (stitch is a recorder whose results the
tests write; stitch/tests find real cuts with ffmpeg); the Runway bodies are built by the real adapter on a
MockTransport and checked against Runway's own request schema. The director's take prompt is checked on a
canned reply."""

from __future__ import annotations

import copy
import json

import pytest

import connected
from conftest import CDN, Harness, asset, base_config, envelope
from director import Director, DirectorError, new_id
from director.base import PassthroughDirector
from director.model import ModelPort
from names import to_wire
from providers.base import Status
from providers.types import effective_sheet
from test_runway_video_models import PROMPTS, SHEET, FakeWire, Server, clip, valid  # noqa: F401
from test_runway_video_models import runway, server  # noqa: F401  (fixtures)

FRAME, NEXT, TAKE = asset(31), asset(32), {**asset(33, "video/mp4"), "url": f"{CDN}/out/{asset(33)['sha256']}"}
WAN = {"provider": "runway", "model": "wan3"}


def shot(n: int, seconds: float, action: str, size: str = "medium") -> dict:
    return {"id": f"shot_01K7B00000000000000000SH{n:02d}", "kind": "shot", "duration_s": seconds,
            "camera": {"size": size, "movement": "static"}, "action": action, "refs": []}


SHOTS = [shot(1, 3, "He looks out over the sea.", "wide"), shot(2, 2.5, "He grips the axe.", "close"),
         shot(3, 3, "He turns and walks inland.")]


def config(on: bool = True) -> dict:
    cfg = base_config()
    cfg["flags"]["connectedVideo"] = on
    return cfg


def harness(on: bool = True) -> Harness:
    h = Harness(config(on))
    h.token = h.as_person()
    return h


def post(h, inp: dict, pick: dict | None = WAN, expect=200):
    req = {**envelope("clip", new_id("job")), "input": inp}
    if pick:
        req["modelChoice"] = pick
    return h.call("POST", "/jobs", req, h.token, expect=expect)[1]


def take_input(**more) -> dict:
    return {"text": "A Viking on a cliff at dawn, cold blue light.", "image": FRAME, "ratio": "16:9",
            "mode": "take", "shots": copy.deepcopy(SHOTS), **more}


def sent(h) -> dict:
    return h.providers["runway"].submits[-1]


def land(h, job, mime="video/mp4"):
    """The provider finishes the job with one output of `mime`."""
    rid = f"runway-{len(h.providers['runway'].submits)}"
    url = f"https://provider.test/{rid}.mp4"
    h.blobs.remote[url] = b"take-bytes"
    h.providers["runway"].states[rid] = Status(state="succeeded", outputs=[{"url": url, "mime": mime, "w": 1280, "h": 720}],
                                               cost_usd=0.9)
    h.clock.tick(6)
    return h.poll(h.token, job["jobId"])


def stitch_result(h, job, name: str, data: dict):
    h.blobs.put(f"ads/scratch/{job['jobId']}/{name}", json.dumps(data).encode(), "application/json")
    h.clock.tick(5)
    return h.poll(h.token, job["jobId"])


# ── the flag and the model's sheet ─────────────────────────────────────────
def test_every_connected_field_is_refused_while_the_flag_is_off():
    h = harness(on=False)
    for inp in (take_input(), {"image": FRAME, "lastFrame": NEXT, "ratio": "16:9", "shot": SHOTS[0]},
                {"mode": "redo_window", "window": {"source": TAKE, "inS": 3, "outS": 5.5, "withLast": True}, "shot": SHOTS[1]}):
        status, out = h.call("POST", "/jobs", {**envelope("clip", new_id("job")), "input": inp}, h.token)
        assert (status, out["error"]["code"]) == (403, "flag_off"), inp
    assert h.providers["runway"].submits == []


def test_a_last_frame_on_a_model_without_one_is_a_400():
    h = harness()
    h.providers["runway"].sheet["video"]["lastFrame"] = False  # veo3.1, the op's own model, reads the sheet's block
    out = post(h, {"image": FRAME, "lastFrame": NEXT, "ratio": "16:9", "shot": SHOTS[0]}, pick=None, expect=400)
    assert out["error"]["code"] == "invalid_input" and "last frame" in out["error"]["message"]
    assert h.providers["runway"].submits == []


@pytest.mark.parametrize("inp,why", [
    (take_input(), "one take"),  # veo3.1: take.ok false
    ({"image": FRAME, "lastFrame": NEXT, "ratio": "16:9", "shot": SHOTS[0], "mode": "alone"}, "lands on no last frame"),
])
def test_what_the_model_or_mode_cannot_do_is_a_400(inp, why):
    h = harness()
    out = post(h, inp, pick=None, expect=400)
    assert why in out["error"]["message"]


def test_a_take_past_the_models_length_or_shots_or_landing_is_a_400():
    h = harness()
    long = take_input(shots=[shot(k, 3, f"Beat {k}.") for k in range(1, 7)])  # 18 s on wan3's 15 s takes
    assert "at most 15 s" in post(h, long, expect=400)["error"]["message"]
    many = take_input(shots=[shot(k, 1, f"Beat {k}.") for k in range(1, 8)])
    assert "at most 6 shots" in post(h, many, expect=400)["error"]["message"]
    landing = take_input(lastFrame=NEXT)  # take.withLast is false until P1
    assert "cannot land" in post(h, landing, expect=400)["error"]["message"]
    bad_cuts = take_input(cuts=[{"atS": 0, "text": "a"}, {"atS": 5, "text": "b"}, {"atS": 4, "text": "c"}])
    assert "rise" in post(h, bad_cuts, expect=400)["error"]["message"]


# ── frames: the next shot's frame as the last frame ─────────────────────────
def test_a_frames_clip_lands_on_the_next_frame():
    h = harness()
    job = post(h, {"image": FRAME, "lastFrame": NEXT, "ratio": "16:9", "shot": SHOTS[1]}, pick={"provider": "runway", "model": "veo3.1_fast"})
    assert job["state"] == "submitted"
    pj = sent(h)
    assert (pj["firstFrame"], pj["lastFrame"], pj["model"], pj["durationS"]) == (FRAME["sha256"], NEXT["sha256"], "veo3.1_fast", 4)
    assert pj["prompt"].endswith(connected.LANDING) and pj["audio"] is False


def test_the_adapter_sends_the_last_frame_as_promptimage_position_last(runway, server):  # noqa: F811
    runway.submit(clip("wan3", last="sha256:" + "e" * 64))
    assert [p["position"] for p in server.body["promptImage"]] == ["first", "last"]
    assert server.body["ratio"] == "auto_720p"  # wan3 with keyframes
    assert valid(server) == []


# ── take: one generation, a timed prompt ──────────────────────────────────
def test_a_take_is_one_job_with_wan_lines_that_add_up_to_its_length():
    h = harness()
    job = post(h, take_input(refs=[]))
    pj = sent(h)
    assert pj["model"] == "wan3" and pj["firstFrame"] == FRAME["sha256"] and pj["refs"] == []
    assert pj["durationS"] == 9  # 8.5 s of shots, rounded up to a whole second
    lines = pj["prompt"].split("\n")
    assert lines == ["A Viking on a cliff at dawn, cold blue light.",
                     "Shot 1 [0-3 s] He looks out over the sea.",
                     "Shot 2 [3-5.75 s] He grips the axe.",  # the 0.5 s slack goes to the heads after the first
                     "Shot 3 [5.75-9 s] He turns and walks inland."]
    assert connected.timing_problem(pj["prompt"], [0, 3, 5.75], 9) is None
    assert job["cost"]["reserved"] > 0


def test_the_take_uses_the_web_cuts_when_given():
    h = harness()
    cuts = [{"atS": 0, "text": "Wide: the sea."}, {"atS": 3.5, "text": "Close: the axe."}, {"atS": 6, "text": "He walks."}]
    post(h, take_input(cuts=cuts))
    assert "Shot 2 [3.5-6 s] Close: the axe." in sent(h)["prompt"]


def test_audio_is_off_only_where_the_model_has_the_switch():
    sheet = effective_sheet(SHEET, "clip", "wan3")
    job = PassthroughDirector().direct({"op": "clip", "input": take_input(), "jobId": "job_1"}, sheet)["providerJob"]
    assert job["audio"] is False
    omni = effective_sheet(SHEET, "clip", "gemini_omni_flash_1.1")
    job = PassthroughDirector().direct({"op": "clip", "input": take_input(), "jobId": "job_1"}, omni)["providerJob"]
    assert "audio" not in job  # no switch: the take keeps its own continuous sound


def test_refs_go_only_with_take_refs():
    character = {"id": "ref_01K6XA6Z0000000000000010VW", "name": "viking_front", "role": "character",
                 "kind": "generated", "asset": asset(40)}
    board = {"id": "node_01K6XA6Z0000000000000010VX", "role": "location", "kind": "generated", "asset": asset(41)}
    sheet = effective_sheet(SHEET, "clip", "wan3")
    take = to_wire("clip", take_input(refs=[character, board]))
    job = PassthroughDirector().direct({"op": "clip", "input": take, "jobId": "job_1"}, sheet)["providerJob"]
    assert job["refs"] == [] and job["firstFrame"] == FRAME["sha256"]
    refs = to_wire("clip", {**take_input(refs=[character, board], mode="take_refs"), "image": None})
    refs.pop("image")
    job = PassthroughDirector().direct({"op": "clip", "input": refs, "jobId": "job_1"}, sheet)["providerJob"]
    assert "firstFrame" not in job and [r["sha256"] for r in job["refs"]] == [asset(40)["sha256"], asset(41)["sha256"]]


def test_the_take_body_is_valid_for_runway(runway, server):  # noqa: F811
    sheet = effective_sheet(SHEET, "clip", "wan3")
    pj = PassthroughDirector().direct({"op": "clip", "input": take_input(), "jobId": "job_1"}, sheet)["providerJob"]
    from providers import ProviderJob
    runway.submit(ProviderJob.from_director("clip", pj))
    body = server.body
    assert body["promptImage"] == [{"uri": "https://cdn.test/" + FRAME["sha256"][-8:] + ".png", "position": "first"}]
    assert body["duration"] == 9 and body["ratio"] == "auto_720p" and body["audio"] is False
    assert "references" not in body and "Shot 3 [5.75-9 s]" in body["promptText"]
    assert valid(server) == []


# ── take_cuts: where the take really cut ───────────────────────────────────
def test_a_landed_take_goes_to_take_cuts_and_lands_with_the_cuts():
    h = harness()
    job = post(h, take_input())
    job = land(h, job)
    assert job["state"] == "submitted" and "cuts" not in job
    event = h.stitched[-1]
    assert event["mode"] == "take_cuts" and event["cuts"] == [3, 5.75]
    assert event["searchS"] == 0.1 and event["threshold"] == 0.10  # wan3's 0.05, at least the floor
    assert h.store.counters("slots#runway#video").get("n") == 0  # the provider's slot is free while it looks
    found = {"ok": True, "takeS": 9.0, "fps": 24.0,
             "cuts": [{"planned_s": 3, "found_s": 3.042}, {"planned_s": 5.75, "found_s": None}]}
    job = stitch_result(h, job, "cuts.json", found)
    assert job["state"] == "completed" and job["cuts"] == [{"planned_s": 3, "found_s": 3.042}, {"planned_s": 5.75, "found_s": None}]
    assert job["outputs"][0]["mime"] == "video/mp4" and job["cost"]["confirmed"] == 0.9


def test_a_take_lands_on_its_planned_cuts_when_stitch_cannot_find_them():
    h = harness()
    job = land(h, post(h, take_input()))
    job = stitch_result(h, job, "cuts.json", {"ok": False, "error": "Could not find the take's cuts."})
    assert job["state"] == "completed" and [c["found_s"] for c in job["cuts"]] == [None, None]
    h2 = harness()
    job = land(h2, post(h2, take_input()))
    h2.clock.tick(200)  # no result at all
    job = h2.poll(h2.token, job["jobId"])
    assert job["state"] == "completed" and [c["planned_s"] for c in job["cuts"]] == [3, 5.75]


def test_a_take_that_is_a_picture_lands_at_once_with_planned_cuts():
    h = harness()
    job = land(h, post(h, take_input()), mime="image/png")
    assert job["state"] == "completed" and [c["found_s"] for c in job["cuts"]] == [None, None]


# ── redo_window: Remake just this shot ─────────────────────────────────────
def test_a_window_is_cut_into_stills_then_made_from_its_first_and_last():
    h = harness()
    job = post(h, {"mode": "redo_window", "ratio": "16:9", "shot": SHOTS[1],
                   "window": {"source": TAKE, "inS": 3, "outS": 5.75, "withLast": True}})
    assert job["state"] == "submitted" and h.providers["runway"].submits == []  # stitch first, no provider slot
    cut = h.stitched[-1]
    scratch = f"ads/scratch/{job['jobId']}"
    assert cut == {"jobId": job["jobId"], "mode": "cut", "key": f"out/{TAKE['sha256']}",
                   "stills": [{"atS": 3, "key": f"{scratch}/first.png"}, {"atS": 5.75, "key": f"{scratch}/last.png"}],
                   "resultKey": f"{scratch}/stills.json"}
    first, last = "sha256:" + "a" * 64, "sha256:" + "b" * 64
    job = stitch_result(h, job, "stills.json", {"ok": True, "takeS": 9, "w": 1280, "h": 720, "fps": 24,
                                                "stills": [{"sha256": first, "bytes": 5}, {"sha256": last, "bytes": 5}]})
    assert job["state"] == "submitted"
    pj = sent(h)
    assert (pj["firstFrame"], pj["lastFrame"], pj["durationS"], pj["model"]) == (first, last, 3, "wan3")
    assert pj["prompt"].startswith("He grips the axe.") and pj["prompt"].endswith(connected.LANDING)
    job = land(h, job)
    assert job["state"] == "submitted" and h.stitched[-1]["mode"] == "land"
    assert h.stitched[-1]["targetKey"] == f"{scratch}/last.png"  # the window's own end still
    job = stitch_result(h, job, "land.json", {"ok": True, "takeS": 3.042, "fps": 24, "landS": 2.708, "landScore": 0.97})
    assert job["state"] == "completed" and "cuts" not in job and (job["landS"], job["landScore"]) == (2.708, 0.97)


# ── land: where a clip really reached its last frame ───────────────────────
def test_a_landing_clip_goes_to_the_land_stage_and_lands_with_where_it_reached_the_frame():
    h = harness()
    job = post(h, {"image": FRAME, "lastFrame": NEXT, "ratio": "16:9", "shot": SHOTS[1]}, pick={"provider": "runway", "model": "veo3.1_fast"})
    job = land(h, job)
    assert job["state"] == "submitted" and "landS" not in job
    event = h.stitched[-1]
    assert event == {"jobId": job["jobId"], "mode": "land", "key": event["key"], "targetKey": f"in/{NEXT['sha256']}",
                     "searchS": 1.0, "resultKey": f"ads/scratch/{job['jobId']}/land.json"}
    assert event["key"].startswith("out/sha256:")
    assert h.store.counters("slots#runway#video").get("n") == 0  # the provider's slot is free while it looks
    job = stitch_result(h, job, "land.json", {"ok": True, "takeS": 4.042, "fps": 24, "landS": 3.708, "landScore": 0.954})
    assert job["state"] == "completed" and (job["landS"], job["landScore"]) == (3.708, 0.954)
    assert job["cost"]["confirmed"] == 0.9


def test_a_low_landing_score_is_still_returned_and_a_failed_look_lands_as_made():
    h = harness()
    job = land(h, post(h, {"image": FRAME, "lastFrame": NEXT, "ratio": "16:9", "shot": SHOTS[1]}))
    job = stitch_result(h, job, "land.json", {"ok": True, "takeS": 4, "fps": 24, "landS": 3.0, "landScore": 0.41})
    assert (job["state"], job["landS"], job["landScore"]) == ("completed", 3.0, 0.41)
    h2 = harness()
    job = land(h2, post(h2, {"image": FRAME, "lastFrame": NEXT, "ratio": "16:9", "shot": SHOTS[1]}))
    job = stitch_result(h2, job, "land.json", {"ok": False, "error": "Could not find where the clip lands."})
    assert job["state"] == "completed" and "landS" not in job and "landScore" not in job


def test_a_clip_with_no_last_frame_has_no_land_stage():
    h = harness()
    job = land(h, post(h, {"image": FRAME, "ratio": "16:9", "shot": SHOTS[1]}, pick=None))
    assert job["state"] == "completed" and "landS" not in job and h.stitched == []


def test_the_mock_lands_one_frame_before_its_end_when_stitch_cannot_look():
    h = Harness(config(), providers=("mock", "runway"))
    h.relay.stitch = None
    job = {"provider": "mock", "jobId": "job_x"}
    assert h.relay._landed_at_end(job, [{"durationS": 1.0}]) == {"landS": 0.958}
    assert h.relay._landed_at_end({**job, "provider": "runway"}, [{"durationS": 4.0}]) == {}


def test_a_window_without_the_last_frame_starts_on_its_first_still_only():
    h = harness()
    job = post(h, {"mode": "redo_window", "ratio": "16:9", "shot": SHOTS[1],
                   "window": {"source": TAKE, "inS": 3, "outS": 5.75, "withLast": False}})
    assert [s["atS"] for s in h.stitched[-1]["stills"]] == [3]
    job = stitch_result(h, job, "stills.json", {"ok": True, "takeS": 9, "stills": [{"sha256": "sha256:" + "a" * 64, "bytes": 5}]})
    assert "lastFrame" not in sent(h)


def test_a_window_whose_stills_fail_is_refunded():
    h = harness()
    job = post(h, {"mode": "redo_window", "ratio": "16:9", "shot": SHOTS[1],
                   "window": {"source": TAKE, "inS": 3, "outS": 5.75, "withLast": True}})
    job = stitch_result(h, job, "stills.json", {"ok": False, "error": "Could not get the take ready for the fix."})
    assert job["state"] == "failed" and job["cost"]["reserved"] == 0 and h.providers["runway"].submits == []


def test_a_window_of_a_take_that_is_not_ours_is_a_400():
    h = harness()
    elsewhere = {**TAKE, "url": "https://elsewhere.test/take.mp4"}
    out = post(h, {"mode": "redo_window", "ratio": "16:9", "shot": SHOTS[1],
                   "window": {"source": elsewhere, "inS": 3, "outS": 5.75, "withLast": True}}, expect=400)
    assert "not one of ours" in out["error"]["message"]


# ── the director's take prompt ─────────────────────────────────────────────
def canned_take(prompt: str) -> dict:
    job = {"provider": "runway", "model": "wan3", "durationS": 9, "audio": False, "ratio": "1280:720",
           "firstFrame": FRAME["sha256"], "refs": [], "prompt": prompt}
    return {"op": "clip", "providerJob": job, "question": None, "rationale": "canned", "confidence": 0.8}


def direct_take(prompt: str) -> dict:
    sheet = effective_sheet(SHEET, "clip", "wan3")
    d = Director(ModelPort(FakeWire(canned_take(prompt)), "claude-haiku-4-5", timeout=5), PROMPTS,
                 {"runway": sheet}, prompt_version="director.v9")
    return d.run("clip", to_wire("clip", take_input()), "runway").output["providerJob"]


def test_dexs_take_prompt_is_kept_when_it_times_the_plan():
    prompt = ("A Viking on a cliff at dawn, cold blue light, 35 mm.\nShot 1 [0-3 s] He looks out over the sea. "
              "The camera holds still.\nShot 2 [3-5.75 s] Close on his hand gripping the axe.\n"
              "Shot 3 [5.75-9 s] He turns and walks inland.\nNo text, captions, subtitles or speech bubbles.")
    job = direct_take(prompt)
    assert job["prompt"] == prompt and job["durationS"] == 9 and job["refs"] == []


def test_dexs_take_prompt_that_times_it_otherwise_is_refused():
    with pytest.raises(DirectorError, match="Shot 2 is timed 3-6 s"):
        direct_take("A Viking.\nShot 1 [0-3 s] He looks.\nShot 2 [3-6 s] The axe.\nShot 3 [6-9 s] He walks.")
    with pytest.raises(DirectorError, match="times 2 shots, not 3"):
        direct_take("A Viking.\nShot 1 [0-3 s] He looks.\nShot 2 [3-9 s] The rest.")


def test_the_v9_clip_section_says_how_each_mode_is_written():
    d = Director(None, PROMPTS, {}, prompt_version="director.v9")
    text = d.system_for("clip")
    for words in ("`take`", "`take_refs`", "`frames`", "`redo_window`", "Shot k [a-b s]", "at most 300 characters",
                  connected.LANDING):
        assert words in text, words


# ── the plan, alone ────────────────────────────────────────────────────────
def test_the_take_plan_puts_the_slack_after_the_first_shot_and_ends_on_the_length():
    spec = effective_sheet(SHEET, "clip", "wan3")["ops"]["clip"]
    inp = take_input(shots=[shot(1, 2.5, "a"), shot(2, 2.5, "b"), shot(3, 2.5, "c"), shot(4, 1.5, "d")])
    duration, starts, texts = connected.take_plan(inp, spec)
    assert (duration, starts, texts) == (9, [0, 2.5, 5.0, 7.5], ["a", "b", "c", "d"])
    lines = connected.timed_lines(starts, texts, duration)
    assert lines[-1] == "Shot 4 [7.5-9 s] d"
    assert connected.merge_cuts(starts, [2.52, None]) == [{"planned_s": 2.5, "found_s": 2.52}, {"planned_s": 5.0, "found_s": None},
                                                          {"planned_s": 7.5, "found_s": None}]


def test_a_long_take_prompt_is_shortened_to_the_models_limit():
    starts, texts = [0, 3], ["word " * 400, "other " * 400]
    prompt = connected.take_prompt("anchor", starts, texts, 6, False, limit=1000)
    assert len(prompt) <= 1000 and connected.timing_problem(prompt, starts, 6) is None
