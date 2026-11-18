"""Change this… (features/make-and-edit.clan): JobRequest.remakeWith. The relay rebuilds the parent's held
request server-side, changes only the delta, and records the parent and the delta (each from filled from
the held request) on Job.remake. camera.movement and words remake the clip whole on its model, keeping its
seed; a moment is a clip_patch of the parent's footage snapped to whole seconds of at least 2 s; the feel
is a clip_edit of it. No price reaches what the editor reads.

Offline: the passthrough director and the conftest fakes, as test_connected_takes.py runs takes."""

from __future__ import annotations

import copy

import pytest

from conftest import Harness, base_config, envelope
from director import new_id
from test_connected_takes import SHOTS, WAN, land, shot, stitch_result, take_input

GEN = "gen_01K7B00000000000000000GN01"


def harness() -> Harness:
    cfg = base_config()
    cfg["flags"] = {**cfg["flags"], "connectedVideo": True, "feelEdit": True, "clipPatch": True}
    cfg["routing"]["clip_patch"] = ["runway"]
    h = Harness(cfg)
    h.token = h.as_person()
    return h


def post(h, inp: dict, pick: dict | None = WAN, op="clip", expect=200, **extra) -> dict:
    req = {**envelope(op, new_id("job")), "input": inp, **extra}
    if pick:
        req["modelChoice"] = pick
    return h.call("POST", "/jobs", req, h.token, expect=expect)[1]


def remake(h, parent: dict, delta: list[dict], op="clip", expect=200, token=None, **extra) -> dict:
    req = {**envelope(op, new_id("job")), "input": {}, "parentIds": [parent["jobId"]],
           "remakeWith": {"parentJobId": parent["jobId"], "parentId": GEN, "delta": delta}, **extra}
    return h.call("POST", "/jobs", req, token or h.token, expect=expect)[1]


def single(h, seed: int | None = None) -> dict:
    """A finished one-shot clip (shot 1, static), with the seed Dex sent when given."""
    job = land(h, post(h, {"text": "A Viking on a cliff.", "image": take_input()["image"], "ratio": "16:9", "shot": copy.deepcopy(SHOTS[0])}))
    assert job["state"] == "completed", job
    if seed is not None:
        stored = h.store.get_job(job["jobId"])
        stored["director"]["output"]["providerJob"]["seed"] = seed
        assert h.store.save_job(stored)
    return job


def together(h) -> dict:
    """A finished box of three shots made as one video (a take), 9 s."""
    job = land(h, post(h, take_input()))
    found = {"ok": True, "takeS": 9.0, "fps": 24.0, "cuts": [{"planned_s": 3, "found_s": 3.042}, {"planned_s": 5.75, "found_s": 5.75}]}
    job = stitch_result(h, job, "cuts.json", found)
    assert job["state"] == "completed", job
    return job


def held(h, job: dict) -> dict:
    return h.store.get_job(job["jobId"])["_req"]


# ── camera and words: the clip made whole again, one thing changed ───────────
def test_a_camera_change_resends_the_parents_request_with_only_the_movement_changed():
    h = harness()
    parent = single(h, seed=4242)
    before = copy.deepcopy(held(h, parent)["input"])
    job = remake(h, parent, [{"field": "camera.movement", "to": "handheld"}])
    assert job["remake"] == {"parentJobId": parent["jobId"], "parentId": GEN,
                             "delta": [{"field": "camera.movement", "from": "static", "to": "handheld"}]}
    after = held(h, job)["input"]
    assert after["shot"]["camera"]["movement"] == "handheld"
    after["shot"]["camera"]["movement"] = "static"
    assert after == before  # frames, references, words and length: the parent's
    assert job["model"] == parent["model"] == "wan3"
    assert h.providers["runway"].submits[-1]["seed"] == 4242  # the seed is kept on the same model
    assert "cost" not in job["remake"]


def test_another_model_does_not_carry_the_seed():
    h = harness()
    parent = single(h, seed=4242)
    remake(h, parent, [{"field": "camera.movement", "to": "push_in"}], modelChoice={"provider": "runway", "model": "seedance2_5"})
    sent = h.providers["runway"].submits[-1]
    assert sent["model"] == "seedance2_5" and "seed" not in sent


def test_a_words_change_in_a_box_made_together_changes_that_shots_words_and_its_prompt_line():
    h = harness()
    parent = together(h)
    before = copy.deepcopy(held(h, parent)["input"])
    sh = SHOTS[1]["id"]
    job = remake(h, parent, [{"field": "words", "shotId": sh, "to": "He grips the axe and roars."},
                             {"field": "camera.movement", "shotId": sh, "to": "handheld"}])
    assert [d["from"] for d in job["remake"]["delta"]] == ["He grips the axe.", "static"]
    after = held(h, job)["input"]
    assert after["shots"][1]["action"] == "He grips the axe and roars." and after["shots"][1]["camera"]["movement"] == "handheld"
    after["shots"][1] = before["shots"][1]
    assert after == before  # the other shots, the frame and the mode are the parent's: the whole box is remade
    assert "He grips the axe and roars." in h.providers["runway"].submits[-1]["prompt"]


def test_a_change_in_a_box_must_name_its_shot():
    h = harness()
    parent = together(h)
    out = remake(h, parent, [{"field": "camera.movement", "to": "handheld"}], expect=400)
    assert "which shot" in out["error"]["message"]
    out = remake(h, parent, [{"field": "camera.movement", "shotId": shot(9, 1, "x")["id"], "to": "handheld"}], expect=400)
    assert "not in this take" in out["error"]["message"]


# ── a moment and the feel ───────────────────────────────────────────────────
def test_a_moment_is_a_clip_patch_of_the_parent_snapped_to_whole_seconds():
    h = harness()
    parent = together(h)
    stored = h.store.get_job(parent["jobId"])
    if not stored["outputs"][0].get("durationS"):  # the fake provider's bytes carry no length; a real take's do
        stored["outputs"][0]["durationS"] = 9.0
        assert h.store.save_job(stored)
    job = remake(h, parent, [{"field": "moment", "to": {"inS": 6.2, "outS": 6.4, "note": "his shirt is deep red",
                                                         "region": {"x": 0.3, "y": 0.3, "w": 0.3, "h": 0.4}}}], op="clip_patch")
    assert job["op"] == "clip_patch" and job["model"] == "aleph2"
    assert job["remake"]["window"] == {"from_s": 6, "to_s": 8} and job["remake"]["atS"] == 6.3
    assert job["patch"]["window"] == {"from_s": 6, "to_s": 8}
    inp = held(h, job)["input"]
    assert inp["video"]["sha256"] == parent["outputs"][0]["sha256"] and inp["text"] == "his shirt is deep red"
    assert inp["window"] == {"from_s": 6, "to_s": 8} and inp["region"]["w"] == 0.3
    assert inp["shot"]["duration_s"] == 9.0  # planned on the whole take
    # A patch of the patch can still change the camera: the clip request is held on it too.
    assert h.store.get_job(job["jobId"])["_clip"]["req"] == held(h, parent)


def test_a_moment_on_a_take_whose_length_is_unknown_or_under_two_seconds_is_refused():
    h = harness()
    parent = single(h)
    stored = h.store.get_job(parent["jobId"])
    stored["outputs"][0].pop("durationS", None)
    assert h.store.save_job(stored)
    out = remake(h, parent, [{"field": "moment", "to": {"inS": 1, "outS": 2, "note": "x"}}], op="clip_patch", expect=400)
    assert "length is not known" in out["error"]["message"]
    stored = h.store.get_job(parent["jobId"])
    stored["outputs"][0]["durationS"] = 1.5
    assert h.store.save_job(stored)
    out = remake(h, parent, [{"field": "moment", "to": {"inS": 0.2, "outS": 0.6, "note": "x"}}], op="clip_patch", expect=400)
    assert "shorter than 2 s" in out["error"]["message"]


def test_the_feel_is_a_clip_edit_of_the_parents_footage():
    h = harness()
    parent = single(h)
    job = remake(h, parent, [{"field": "feel", "to": {"words": "warm morning light", "strength": "adhere"}}], op="clip_edit")
    assert job["op"] == "clip_edit"
    inp = held(h, job)["input"]
    assert inp == {"video": {"sha256": parent["outputs"][0]["sha256"], "url": parent["outputs"][0]["url"], "mime": "video/mp4"},
                   "feel": {"strength": "adhere"}, "text": "warm morning light", "ratio": "16:9"}
    assert job["remake"]["delta"] == [{"field": "feel", "to": {"words": "warm morning light", "strength": "adhere"}}]


# ── refusals, before any quota or spend ────────────────────────────────────
def test_the_wrong_op_a_mixed_change_and_a_parent_that_is_not_ours_are_refused():
    h = harness()
    parent = single(h)
    running = post(h, {"text": "x", "image": take_input()["image"], "ratio": "16:9", "shot": copy.deepcopy(SHOTS[0])})
    inflight = f"inflight#{h.people[h.token]['pid']}"
    spent = h.store.counters(inflight)
    out = remake(h, parent, [{"field": "camera.movement", "to": "handheld"}], op="clip_patch", expect=400)
    assert out["error"]["code"] == "invalid_input"
    out = remake(h, parent, [{"field": "moment", "to": {"inS": 1, "outS": 2, "note": "x"}}, {"field": "words", "to": "y"}], op="clip_patch", expect=400)
    assert "on its own" in out["error"]["message"]
    other = h.as_person("bob", "red")
    out = remake(h, parent, [{"field": "camera.movement", "to": "handheld"}], token=other, expect=400)
    assert "not a clip of this project" in out["error"]["message"]
    out = remake(h, running, [{"field": "camera.movement", "to": "handheld"}], expect=400)
    assert "not finished" in out["error"]["message"]
    assert h.store.counters(inflight) == spent  # nothing was reserved or counted


def test_remake_with_promote_from_is_refused_by_the_contract():
    h = harness()
    parent = single(h)
    out = remake(h, parent, [{"field": "camera.movement", "to": "handheld"}], promoteFrom=parent["jobId"], expect=400)
    assert out["error"]["code"] == "invalid_input"


@pytest.mark.parametrize("field,to,op", [
    ("camera.movement", "handheld", "clip"),
    ("feel", {"strength": "flex"}, "clip_edit"),
])
def test_no_price_in_what_a_remake_records(field, to, op):
    h = harness()
    job = remake(h, single(h), [{"field": field, "to": to}], op=op)
    text = repr(job["remake"]).lower()
    assert not any(w in text for w in ("cost", "usd", "credit", "price"))


# ── Render ad from the timeline (stitch's timeline mode) ─────────────────────
import io  # noqa: E402
import json  # noqa: E402
import shutil  # noqa: E402
import subprocess  # noqa: E402
import sys  # noqa: E402
from pathlib import Path  # noqa: E402

from conftest import CDN  # noqa: E402

HAVE_FFMPEG = bool(shutil.which("ffmpeg") and shutil.which("ffprobe"))


def footage(h, name: str, data: bytes = b"clip") -> dict:
    key = f"out/sha256:{name * 64}"
    h.blobs.put(key, data, "video/mp4")
    return {"sha256": f"sha256:{name * 64}", "url": f"{CDN}/{key}", "mime": "video/mp4"}


def plan(a: dict, b: dict) -> dict:
    return {"clips": [{"asset": a, "startS": 0, "inS": 0, "outS": 2, "fadeInS": 0.3},
                      {"asset": b, "startS": 2, "inS": 0.5, "outS": 1.5, "holdS": 0.2, "transitionIn": {"kind": "dissolve", "s": 0.5}}],
            "texts": [{"words": "Clean like a samurai.", "style": "super", "fromS": 0.5, "toS": 2, "fadeInS": 0.2}],
            "endCard": {"headline": "SuperSamurai", "line": "Clean in one sweep", "cta": "supersamurai.example", "bg": "#F2F3F5", "s": 1,
                        "transitionIn": {"kind": "dip_black", "s": 0.5}},
            "lengthS": 4.2}


def render(h, p: dict, ratio="16:9") -> dict:
    req = {**envelope("stitch", new_id("job")), "input": {"timeline": p, "ratio": ratio}}
    return h.call("POST", "/jobs", req, h.token, expect=200)[1]


def test_a_timeline_render_sends_the_plan_and_the_words_drawn_as_pictures():
    from PIL import Image

    h = harness()
    a, b = footage(h, "a"), footage(h, "b")
    job = render(h, plan(a, b))
    event = h.stitched[-1]
    assert event["mode"] == "timeline" and event["lengthS"] == 4.2
    assert event["clips"] == [{"key": a["url"][len(CDN) + 1:], "startS": 0, "inS": 0, "outS": 2, "fadeInS": 0.3},
                              {"key": b["url"][len(CDN) + 1:], "startS": 2, "inS": 0.5, "outS": 1.5, "holdS": 0.2,
                               "transitionIn": {"kind": "dissolve", "s": 0.5}}]
    assert event["texts"] == [{"key": f"ads/{job['jobId']}/text0.png", "fromS": 0.5, "toS": 2, "fadeInS": 0.2}]
    assert event["endCard"] == {"key": f"ads/{job['jobId']}/endcard.png", "s": 1, "transitionIn": {"kind": "dip_black", "s": 0.5}}
    text = Image.open(io.BytesIO(h.blobs.get(event["texts"][0]["key"])))
    assert text.size == (1280, 720) and text.mode == "RGBA" and text.getextrema()[3][1] == 255  # words on a clear picture
    card = Image.open(io.BytesIO(h.blobs.get(event["endCard"]["key"])))
    assert card.size == (1280, 720) and card.getpixel((4, 4)) == (0xF2, 0xF3, 0xF5)
    assert "words" not in json.dumps(event) and "Clean like a samurai." not in json.dumps(event)  # drawn, never sent on
    # It lands like any render: stitch's result, then completed, with no cost to anyone.
    h.blobs.put(f"ads/{job['jobId']}.json", json.dumps({"ok": True, "sha256": "sha256:" + "e" * 64, "bytes": 10, "w": 1280, "h": 720,
                                                       "durationS": 6.7, "endCard": "roll-up"}).encode(), "application/json")
    h.clock.tick(4)
    done = h.poll(h.token, job["jobId"])
    assert done["state"] == "completed" and done["outputs"][0]["durationS"] == 6.7
    assert render(h, plan(a, b), ratio="9:16") and Image.open(io.BytesIO(h.blobs.get(h.stitched[-1]["texts"][0]["key"]))).size == (720, 1280)


@pytest.mark.parametrize("change,why", [
    (lambda p: p["clips"][1].update(startS=1.5), "overlap"),
    (lambda p: p.update(lengthS=9), "not the 9 s"),
    (lambda p: p["clips"][0].update(asset={**p["clips"][0]["asset"], "url": "https://elsewhere.test/a.mp4"}), "not one of ours"),
])
def test_a_plan_that_cannot_be_rendered_fails_free_before_stitch(change, why):
    h = harness()
    p = plan(footage(h, "a"), footage(h, "b"))
    change(p)
    job = render(h, p)
    assert job["state"] == "failed" and job["error"]["code"] == "invalid_input" and why in job["error"]["message"]
    assert h.stitched == []


def test_a_timeline_and_old_clips_together_are_refused_by_the_contract():
    h = harness()
    a = footage(h, "a")
    req = {**envelope("stitch", new_id("job")), "input": {"timeline": plan(a, a), "clips": [{"asset": a}]}}
    assert h.call("POST", "/jobs", req, h.token, expect=400)[1]["error"]["code"] == "invalid_input"


@pytest.mark.skipif(not HAVE_FFMPEG, reason="needs ffmpeg and ffprobe")
def test_the_relays_event_renders_on_the_real_stitch(tmp_path):
    """The event as the relay makes it, through stitch.run on real ffmpeg: the film is the plan's length."""
    sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "stitch"))
    import stitch  # production-tool/stitch/stitch.py

    def solid(colour: str) -> bytes:
        out = tmp_path / f"{colour}.mp4"
        subprocess.run(["ffmpeg", "-hide_banner", "-loglevel", "error", "-y", "-f", "lavfi", "-i", f"color=c={colour}:s=320x180:r=24:d=3",
                        "-c:v", "libx264", "-pix_fmt", "yuv420p", str(out)], check=True)
        return out.read_bytes()

    h = harness()
    job = render(h, plan(footage(h, "a", solid("red")), footage(h, "b", solid("blue"))))
    event = h.stitched[-1]
    results: dict = {}

    def get(key, dest):
        Path(dest).write_bytes(h.blobs.get(key))

    res = stitch.run(event, get=get, put=lambda key, src, mime: h.blobs.put(key, Path(src).read_bytes(), mime),
                     put_json=lambda k, d: results.update(d), ffmpeg="ffmpeg", ffprobe="ffprobe")
    assert res["ok"], res
    assert res["lengthS"] == 4.2 and abs(res["durationS"] - (4.2 + stitch.CARD_S)) <= 0.05
    assert h.blobs.get(f"ads/{job['jobId']}.mp4")
