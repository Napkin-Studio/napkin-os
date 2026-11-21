"""A film's cutdowns and shapes on the relay (features/campaign-formats.clan, phases 5 and 6): Dex's plan
(beats per length, a crop per shot per shape), the free render through stitch, and Aleph 2's outpaint and
the vertical remakes, each a paid job with its own reservation, their bodies checked against Runway's
OpenAPI. Nothing here calls a provider."""

from __future__ import annotations

import json
import shutil

import httpx
import pytest

import cutdowns
from conftest import CDN, Harness, asset, base_config
from contracts_dir import contracts_dir
from director.base import PassthroughDirector
from director.director import provider_ratio
from director.model import Usage
from provider_schemas import errors
from providers import AssetRef, ProviderJob, Ref, load_sheet
from providers.runway import RunwayProvider
from providers.types import effective_sheet

CASES = json.loads((contracts_dir() / "examples" / "cutdown-cases.json").read_text())["cases"]
SHOT = "shot_01K7B00000000000000000SH{:02d}"
TAKE = "take_01K7B00000000000000000TK{:02d}"


@pytest.mark.parametrize("case", CASES["fit"], ids=[c["name"] for c in CASES["fit"]])
def test_the_window_case_table(case):
    windows, over = cutdowns.fit_windows(case["shots"], set(case["keep"]), case["lengthS"])
    assert windows == case["windows"] and over == case["over"]


@pytest.mark.parametrize("case", CASES["crop"], ids=[c["name"] for c in CASES["crop"]])
def test_the_crop_case_table(case):
    keys, _, cuts = cutdowns.crop_keys(case["take"], case["aspect"], case["subjects"])
    assert keys == case["keys"] and cuts == case["cuts"]


def test_every_crop_has_the_shape_and_stays_in_the_take():
    for take in ({"w": 1920, "h": 1080}, {"w": 1280, "h": 720}, {"w": 1080, "h": 1920}):
        for aspect in ({"w": 9, "h": 16}, {"w": 4, "h": 5}, {"w": 1, "h": 1}, {"w": 16, "h": 9}):
            for x in (0, 0.3, 0.8):
                sub = [{"x": x * take["w"], "y": 100, "w": take["w"] * 0.15, "h": take["h"] * 0.5}]
                for k in cutdowns.crop_keys(take, aspect, sub)[0]:
                    b = k["box"]
                    assert b["x"] >= 0 and b["y"] >= 0 and b["x"] + b["w"] <= take["w"] + 0.01 and b["y"] + b["h"] <= take["h"] + 0.01
                    assert abs(b["w"] / b["h"] - aspect["w"] / aspect["h"]) < 0.01


def test_aleph_makes_4_5_at_3_4_and_the_others_at_their_own():
    assert cutdowns.aleph_ratio(9, 16) == "9:16" and cutdowns.aleph_ratio(1, 1) == "1:1"
    assert cutdowns.aleph_ratio(4, 5) == "3:4" and cutdowns.aleph_ratio(1080, 1350) == "3:4"


def master(n=10, s=3.0, take_s=4.0):
    shots = [{"shotId": SHOT.format(i), "takeId": TAKE.format(i), "words": f"Shot {i + 1}.", "inS": 0, "outS": s,
              "takeS": take_s, "takeSize": {"w": 1920, "h": 1080}} for i in range(n)]
    return shots + [{"shotId": SHOT.format(99), "inS": 0, "outS": 2.5, "endCard": True}]


def plan_input(shots, lengths=(15, 6), aspects=({"w": 9, "h": 16}, {"w": 1, "h": 1})):
    return {"aspect": {"w": 16, "h": 9}, "delivery": {"width": 1920, "height": 1080},
            "cutdown": {"step": "plan", "shots": shots, "lengths": list(lengths), "aspects": list(aspects)}}


def test_the_plan_is_free_uncounted_and_names_every_shot_kept_or_dropped():
    h = Harness(base_config())
    token = h.as_person()
    before = h.relay.remaining(h.people[token]["pid"])
    _, job = h.post_job(token, op="cutdown", expect=200, **plan_input(master()))
    assert job["state"] == "completed" and job["crew"] == "edie" and job["cost"]["reserved"] == 0
    assert job["director"]["model"] == "passthrough"
    plan = job["cutdownPlan"]
    fifteen, six = plan["lengths"]
    assert [b["shotId"] for b in fifteen["beats"]] == [SHOT.format(i) for i in range(10)]  # never the end card
    kept = [b for b in fifteen["beats"] if b["keep"]]
    assert kept[0]["shotId"] == SHOT.format(0) and kept[-1]["shotId"] == SHOT.format(9)
    # 15 s less the studio card and the film's own card (features/pt-film-r1.clan): its 2.5 s held to 2 s.
    assert sum(b["outS"] - b["inS"] for b in kept) == pytest.approx(15 - cutdowns.CARD_S - 2.0, abs=0.01)
    # The opening and the payoff, truly (UAT round 4, R4-F4: the 6 s kept the payoff alone).
    assert [b["shotId"] for b in six["beats"] if b["keep"]] == [SHOT.format(0), SHOT.format(9)]
    assert all(b["why"] for b in fifteen["beats"])
    # A crop of every shot at every shape; the middle holds at 9:16 and 1:1, so nothing is outpainted.
    assert len(plan["crops"]) == 20 and not any(c["cuts"] for c in plan["crops"])
    assert h.relay.remaining(h.people[token]["pid"]) == before
    assert h.store.counters("spend").get("usd", 0) == 0
    assert not h.providers["runway"].submits


class FakePort:
    """The director's model port, answered here: Dex keeps shots 2 and 4 for 15 s, the subject moves."""

    model = vision_model = "claude-test"

    def __init__(self):
        self.calls = []

    def call(self, purpose, system, payload, schema, **kw):
        self.calls.append({"purpose": purpose, "payload": payload, "images": kw.get("images")})
        return {"lengths": [{"lengthS": 15, "why": "The reveal and the sip.", "beats": [
                    {"shotId": SHOT.format(1), "keep": True, "why": "The product reveal."},
                    {"shotId": SHOT.format(3), "keep": True, "why": "The sip."},
                    {"shotId": SHOT.format(0), "keep": False, "why": "Only walks in."}]}],
                "subjects": [{"shotId": SHOT.format(1), "boxes": [
                    {"x": 0.05, "y": 0.2, "w": 0.15, "h": 0.6}, {"x": 0.42, "y": 0.2, "w": 0.15, "h": 0.6},
                    {"x": 0.8, "y": 0.2, "w": 0.15, "h": 0.6}]},
                    {"shotId": SHOT.format(3), "boxes": [{"x": 0.2, "y": 0.1, "w": 0.6, "h": 0.8}]}],
                "rationale": "The reveal, then the sip."}


def test_dex_looks_at_the_stills_and_the_relay_settles_his_answer():
    h = Harness(base_config())
    port = FakePort()
    h.relay.cutter = cutdowns.ModelCutter(port)
    token = h.as_person()
    shots = master(5)
    for i, s in enumerate(shots[:5]):
        still = asset(100 + i)
        h.blobs.put(f"in/{still['sha256']}", _png(), "image/png")
        s["stills"] = [still]
    _, job = h.post_job(token, op="cutdown", expect=200, **plan_input(shots, lengths=(15,), aspects=({"w": 9, "h": 16},)))
    assert job["state"] == "completed", job.get("error")
    call = port.calls[0]
    assert call["purpose"] == "cutdown" and len(call["images"]) == 5
    assert all("stills" not in s for s in call["payload"]["shots"]) and call["payload"]["shots"][0]["pictures"]
    beats = {b["shotId"]: b for b in job["cutdownPlan"]["lengths"][0]["beats"]}
    assert beats[SHOT.format(1)]["keep"] and beats[SHOT.format(3)]["keep"] and not beats[SHOT.format(0)]["keep"]
    assert beats[SHOT.format(0)]["why"] == "Only walks in." and not beats[SHOT.format(2)]["keep"]  # left out: dropped
    crops = {c["shotId"]: c for c in job["cutdownPlan"]["crops"]}
    assert len(crops[SHOT.format(1)]["keys"]) == 3  # she walks across: a slow pan
    assert crops[SHOT.format(3)]["cuts"]  # 60% wide: a 9:16 crop would cut her, so Aleph makes the edges
    assert job["director"]["rationale"] == "The reveal, then the sip." and job["cost"]["reserved"] == 0


def test_an_agency_with_claude_off_gets_the_passthrough_plan():
    h = Harness(base_config())
    port = FakePort()
    h.relay.cutter = cutdowns.ModelCutter(port)
    token = h.as_person()
    h.limits("blue", allow={"claude": False, "makers": ["runway", "google"]})
    _, job = h.post_job(token, op="cutdown", expect=200, **plan_input(master()))
    assert job["state"] == "completed" and not port.calls and job["director"]["model"] == "passthrough"


class SlowPort:
    """The director's port as it ran live: 20 s, and a timeout raises (ModelError)."""

    model = vision_model = "eu.anthropic.claude-sonnet-5-5"

    def __init__(self, fail=True):
        self.timeout = 20.0
        self.fail = fail
        self.seen = []

    def call(self, purpose, system, payload, schema, *, usage, **kw):
        self.seen.append((self.timeout, kw.get("effort")))
        usage.input_tokens, usage.output_tokens = 12000, 300
        if self.fail:
            raise TimeoutError("Dex took too long")
        return {"lengths": [], "subjects": [], "rationale": "ok"}


def round4_master():
    """Round 4's film: 5 shots in their takes (the opening 2.967 s, the payoff 2.0 s at 2-4 s of a 4 s take), no card."""
    w = [(0, 2.967, 5), (2.967, 4.967, 5), (0, 1.5, 4), (0, 1.5, 4), (2, 4, 4)]
    return [{"shotId": SHOT.format(i), "takeId": TAKE.format(i), "words": f"Shot {i + 1}.", "inS": a, "outS": b, "takeS": t,
             "takeSize": {"w": 1920, "h": 1080}} for i, (a, b, t) in enumerate(w)]


def test_the_cut_plan_gets_one_long_try_and_its_cost_is_kept_when_dex_fails():
    # Live (R4-F4): the plan timed out at 20 s twice (41 s); the passthrough then kept shot 5 alone, 2 s of picture.
    port = SlowPort(fail=False)
    cutdowns.ModelCutter(port).plan({"input": {"cutdown": {"shots": round4_master(), "lengths": [6], "aspects": []}}})
    assert port.seen == [(cutdowns.CUT_PLAN_S, "low")]  # one try of 45 s, effort low
    assert port.timeout == 20.0  # the shared port is untouched
    # Little room left in the Lambda: never past it, never under the port's own seconds.
    assert cutdowns.plan_port(SlowPort(), 30).timeout == 30
    assert cutdowns.plan_port(SlowPort(), 5).timeout == 20


def test_a_failed_cut_plan_is_a_simple_cut_said_so_that_fills_the_length_and_costs_what_dex_spent():
    h = Harness(base_config())
    h.relay.cutter = cutdowns.ModelCutter(SlowPort())
    token = h.as_person()
    _, job = h.post_job(token, op="cutdown", expect=200, **plan_input(round4_master(), lengths=(6,), aspects=({"w": 9, "h": 16},)))
    assert job["state"] == "completed" and job["director"]["model"] == "passthrough"
    assert job["director"]["rationale"].startswith("Dex could not plan this (TimeoutError), so this is a simple cut")
    six = job["cutdownPlan"]["lengths"][0]
    kept = [b for b in six["beats"] if b["keep"]]
    assert [b["shotId"] for b in kept] == [SHOT.format(0), SHOT.format(4)]  # the opening and the payoff, truly
    # 6 s less the studio card (2.5 s): 3.5 s of picture, so the file is 6 s.
    assert sum(b["outS"] - b["inS"] for b in kept) == pytest.approx(3.5, abs=0.01)
    assert job["cost"].get("agentUsd", 0) > 0  # what Dex spent before failing (F21)


def test_a_simple_plan_short_of_its_length_keeps_more_shots_and_dexs_own_says_it_is_short():
    # The payoff alone for 6 s: 2 s of picture with no handle. A simple cut keeps the longest dropped shot too.
    shots = round4_master()
    payoff = [{"lengthS": 6, "beats": [{"shotId": SHOT.format(4), "keep": True, "why": "The payoff."}]}]
    out = cutdowns.settle_lengths(shots, payoff, [6], fill=True)
    kept = [b for b in out[0]["beats"] if b["keep"]]
    assert [b["shotId"] for b in kept] == [SHOT.format(0), SHOT.format(4)]
    assert kept[0]["why"] == "Kept to fill the length."
    assert sum(b["outS"] - b["inS"] for b in kept) == pytest.approx(3.5, abs=0.01)
    # Dex's own plan stays as he chose it, and says it comes out short.
    dex = cutdowns.settle_lengths(shots, payoff, [6])
    assert [b["shotId"] for b in dex[0]["beats"] if b["keep"]] == [SHOT.format(4)]
    assert "1.5 s short" in dex[0]["why"]


def _png() -> bytes:
    import io

    from PIL import Image
    out = io.BytesIO()
    Image.new("RGB", (64, 36), (40, 80, 120)).save(out, format="PNG")
    return out.getvalue()


def stored_clip(h, n):
    a = asset(n, "video/mp4")
    a["url"] = f"{CDN}/out/{a['sha256']}"
    h.blobs.put(f"out/{a['sha256']}", b"\x00\x00\x00\x18ftypmp42", "video/mp4")
    return a


def render_input(h, layers=()):
    return {"aspect": {"w": 9, "h": 16}, "delivery": {"width": 1080, "height": 1920},
            "cutdown": {"step": "render", "lengthS": 15, "endCard": True, "fadeOutS": 0.5, "layers": list(layers), "clips": [
                {"asset": stored_clip(h, 1), "inS": 0, "outS": 4.5, "takeSize": {"w": 1920, "h": 1080},
                 "crop": {"x": 656.25, "y": 0, "w": 607.5, "h": 1080}},
                {"asset": stored_clip(h, 2), "inS": 0.5, "outS": 4, "takeSize": {"w": 1920, "h": 1080},
                 "cropKeys": [{"at": 0, "box": {"x": 0, "y": 0, "w": 607.5, "h": 1080}}, {"at": 1, "box": {"x": 1312.5, "y": 0, "w": 607.5, "h": 1080}}]},
                {"asset": stored_clip(h, 3), "inS": 0, "outS": 4.5}]}}


def test_a_render_goes_to_stitch_free_with_its_crops_and_its_words_drawn_here():
    h = Harness(base_config())
    token = h.as_person()
    caption = {"kind": "captions", "box": {"x": 0.08, "y": 0.6, "w": 0.84, "h": 0.08}, "text": "Every morning.", "fromS": 4.5, "toS": 8}
    line = {"kind": "line", "box": {"x": 0.08, "y": 0.8, "w": 0.84, "h": 0.08}, "text": "First light."}
    _, job = h.post_job(token, op="cutdown", expect=200, **render_input(h, [caption, line]))
    assert job["state"] == "submitted" and job["cost"]["reserved"] == 0 and job["crew"] == "edie"
    [event] = h.stitched
    assert event["mode"] == "cutdown" and event["size"] == [1080, 1920] and event["fadeOutS"] == 0.5
    assert [c["key"] for c in event["clips"]] == [f"out/{asset(n, 'video/mp4')['sha256']}" for n in (1, 2, 3)]
    assert event["clips"][0]["crop"]["w"] == 607.5 and event["clips"][0]["takeSize"] == [1920, 1080]
    assert len(event["clips"][1]["cropKeys"]) == 2 and "crop" not in event["clips"][2]
    # One PNG for the line (all through), one for the caption (its time); no words go anywhere else.
    timed = sorted(event["layers"], key=lambda x: x.get("fromS", -1))
    assert timed[0].get("fromS") is None and timed[1]["fromS"] == 4.5 and timed[1]["toS"] == 8
    assert all(h.blobs.get(x["key"])[:8] == b"\x89PNG\r\n\x1a\n" for x in event["layers"])
    assert "Every morning" not in json.dumps(event)
    h.blobs.put(f"ads/cuts/{job['jobId']}.json", json.dumps({"ok": True, "sha256": "sha256:" + "a" * 64, "bytes": 10,
                                                          "w": 1080, "h": 1920, "durationS": 15}).encode(), "application/json")
    done = h.poll(token, job["jobId"])
    assert done["state"] == "completed" and done["outputs"][0]["url"].endswith(f"ads/cuts/{job['jobId']}.mp4")
    assert done["outputs"][0]["durationS"] == 15 and h.store.counters("spend").get("usd", 0) == 0


def test_a_size_ends_on_the_films_own_end_card_then_the_studio_card():
    """UAT 2026-11-21 (B4): every 6 s size ended on the studio card, the client's end card missing. The film's card
    is drawn here at the size and held as the last clip; stitch adds the studio card after it (endCard)."""
    h = Harness(base_config())
    token = h.as_person()
    inp = render_input(h)
    inp["cutdown"]["clientCard"] = {"headline": "Quietboil", "line": "Let them sleep.", "bg": "#14161B", "s": 2}
    _, job = h.post_job(token, op="cutdown", expect=200, **inp)
    [event] = h.stitched
    last = event["clips"][-1]
    assert last["key"] == f"ads/cuts/{job['jobId']}/client-card.png" and (last["inS"], last["outS"]) == (0, 2.0)
    assert h.blobs.get(last["key"])[:8] == b"\x89PNG\r\n\x1a\n" and event["endCard"] is True
    assert "Let them sleep" not in json.dumps(event)  # drawn, never sent as words


def test_the_film_card_comes_off_a_sizes_length_before_the_studio_card():
    shots = [{"shotId": "a", "inS": 0, "outS": 3}, {"shotId": "b", "inS": 0, "outS": 3}, {"shotId": "e", "inS": 0, "outS": 2, "endCard": True}]
    windows, over = cutdowns.fit_windows(shots, {"a", "b"}, 8.0)
    # 8 s less the studio card (2.5) and the film's card (a third of the 5.5 s left, under its 2 s): 3.667 of picture.
    assert sum(w["outS"] - w["inS"] for w in windows) == pytest.approx(3.667, abs=0.002) and abs(over) <= 0.001
    assert cutdowns.client_card_s(2.5, 6.0) == 1.167 and cutdowns.client_card_s(2.5, 30.0) == 2.0 and cutdowns.client_card_s(1.5, 30.0) == 1.5


def test_a_short_size_keeps_3_5_s_of_picture_by_shortening_its_cards():
    """UAT round 3 (R3-F12): the 6 s 9:16 had 2.25 s of picture, then 1.2 s of the film's card and 2.5 s of the
    studio card. Both cards stay; the studio card shortens first (to 1.2 s), then the film's card (to 1 s)."""
    assert cutdowns.card_lengths(6.0, 2.5) == (1.167, 1.333)
    assert cutdowns.card_lengths(15.0, 2.5) == (2.0, 2.5)  # long enough: nothing shortens
    assert cutdowns.card_lengths(6.0, None) == (0.0, 2.5)  # no film card: 3.5 s of picture already
    assert cutdowns.card_lengths(5.0, 2.5) == (1.0, 1.2)  # as short as they go; the picture gets what is left
    assert cutdowns.card_lengths(None, 2.5) == (2.0, 2.5)
    shots = [{"shotId": "a", "inS": 0, "outS": 4, "takeS": 4}, {"shotId": "e", "inS": 0, "outS": 2.5, "endCard": True}]
    windows, over = cutdowns.fit_windows(shots, {"a"}, 6.0)
    assert sum(w["outS"] - w["inS"] for w in windows) == pytest.approx(3.5, abs=0.002) and abs(over) <= 0.001


def test_a_render_passes_a_short_sizes_studio_card_length_to_stitch():
    h = Harness(base_config())
    token = h.as_person()
    inp = render_input(h)
    inp["cutdown"]["studioS"] = 1.333
    _, job = h.post_job(token, op="cutdown", expect=200, **inp)
    [event] = h.stitched
    assert event["cardS"] == 1.333
    h2 = Harness(base_config())
    _, job = h2.post_job(h2.as_person(), op="cutdown", expect=200, **render_input(h2))
    [event] = h2.stitched
    assert "cardS" not in event


def test_a_render_of_a_clip_that_is_not_ours_fails_plainly():
    h = Harness(base_config())
    token = h.as_person()
    inp = render_input(h)
    inp["cutdown"]["clips"][0]["asset"]["url"] = "https://elsewhere.test/clip.mp4"
    _, job = h.post_job(token, op="cutdown", expect=200, **inp)
    assert job["state"] == "failed" and job["error"]["code"] == "invalid_input" and not h.stitched


def outpaint_input(h, ratio="9:16", seconds=4):
    return {"aspect": {"w": 9, "h": 16}, "delivery": {"width": 1080, "height": 1920},
            "cutdown": {"step": "outpaint", "lengthS": seconds, "targetRatio": ratio,
                        "clips": [{"asset": stored_clip(h, 7), "inS": 0, "outS": seconds, "takeSize": {"w": 1280, "h": 720}, "outpaint": True}]}}


def test_an_outpaint_is_a_paid_job_on_aleph_2_reserved_by_the_seconds_it_reads():
    h = Harness(base_config(routing={**base_config()["routing"], "cutdown": ["runway"]}))
    token = h.as_person()
    _, job = h.post_job(token, op="cutdown", expect=200, **outpaint_input(h))
    [sent] = h.providers["runway"].submits
    assert h.providers["runway"].ops == ["cutdown"] and sent["model"] == "aleph2" and sent["ratio"] == "9:16"
    assert [r["role"] for r in sent["refs"]] == ["current"] and sent["prompt"] == cutdowns.OUTPAINT_PROMPT
    assert job["cost"]["reserved"] == pytest.approx(4 * 28 * 0.01)  # 28 credits a second, 4 s
    _, short = h.post_job(token, op="cutdown", expect=200, **outpaint_input(h, "1:1", 1))
    assert short["cost"]["reserved"] == pytest.approx(56 * 0.01)  # the 56-credit minimum


def test_an_outpaint_is_refused_when_cutdown_is_not_routed():
    h = Harness(base_config())
    token = h.as_person()
    status, out = h.post_job(token, op="cutdown", **outpaint_input(h))
    assert status == 403 and out["error"]["code"] == "flag_off"


def test_an_outpaint_takes_one_clip_and_a_shape():
    h = Harness(base_config(routing={**base_config()["routing"], "cutdown": ["runway"]}))
    token = h.as_person()
    inp = outpaint_input(h)
    inp["cutdown"]["clips"] *= 2
    assert h.post_job(token, op="cutdown", **inp)[0] == 400
    inp = outpaint_input(h)
    del inp["cutdown"]["targetRatio"]
    assert h.post_job(token, op="cutdown", **inp)[0] == 400


# ── the bodies Runway gets ──────────────────────────────────────────────────
CLIP, FRAME, MAYA = "sha256:" + "c" * 64, "sha256:" + "f" * 64, "sha256:" + "1" * 64
URL = {CLIP: "https://cdn.test/take.mp4", FRAME: "https://cdn.test/frame.png", MAYA: "https://cdn.test/maya.png"}


class Server:
    def __init__(self):
        self.requests = []

    def __call__(self, request):
        self.requests.append(request)
        return httpx.Response(200, json={"id": "task_1"})

    @property
    def body(self):
        return json.loads(self.requests[-1].content)


def runway(server):
    def resolve(sha):
        url = URL.get(sha, f"https://cdn.test/{sha[-6:]}.png")
        return AssetRef(sha, url, "video/mp4" if url.endswith(".mp4") else "image/png")
    return RunwayProvider("key_test", resolve, client=httpx.Client(transport=httpx.MockTransport(server)))


@pytest.mark.parametrize("ratio", cutdowns.ALEPH_RATIOS)
def test_the_outpaint_body_is_valid_for_every_aleph_shape(ratio):
    server = Server()
    directed = PassthroughDirector().direct({"op": "cutdown", "input": {"cutdown": {"step": "outpaint", "targetRatio": ratio, "clips": [
        {"asset": {"sha256": CLIP, "url": URL[CLIP], "mime": "video/mp4"}, "inS": 0, "outS": 4}]}}}, load_sheet("runway"))
    job = ProviderJob.from_director("cutdown", directed["providerJob"])
    runway(server).submit(job)
    body = server.body
    assert server.requests[-1].url.path == "/v1/video_to_video"
    assert body == {"model": "aleph2", "videoUri": URL[CLIP], "targetAspectRatio": ratio, "promptText": cutdowns.OUTPAINT_PROMPT}
    assert errors("runway", "POST /v1/video_to_video", body) == []


def test_aleph_has_no_4_5_so_the_adapter_refuses_it_before_runway():
    server = Server()
    job = ProviderJob(op="cutdown", provider="runway", model="aleph2", prompt=cutdowns.OUTPAINT_PROMPT,
                      refs=[Ref(CLIP, "current", "current")], ratio="4:5")
    with pytest.raises(Exception, match="new edges only at"):
        runway(server).submit(job)
    assert not server.requests


@pytest.mark.parametrize("model", ["klingO3_pro", "klingO3_standard", "hailuo3", "wan3"])
@pytest.mark.parametrize("shape", ["9:16", "1:1"])
def test_remake_for_vertical_is_a_valid_clip_body_with_the_frame_and_the_characters(model, shape):
    """Remake for vertical (phase 6): the shot's frame cropped to the shape as its first frame, its characters as
    references where the model takes them with a frame, at the model's own size for the shape."""
    server = Server()
    sheet = effective_sheet(load_sheet("runway"), "clip", model)
    refs = [Ref(MAYA, "maya", "character")] if sheet["video"].get("firstFrameWithRefs") else []
    job = ProviderJob(op="clip", provider="runway", model=model, prompt="Maya sips from the bottle.", refs=refs,
                      first_frame=FRAME, ratio=provider_ratio("runway", "clip", shape, model), duration_s=5, audio=False)
    runway(server).submit(job)
    body = server.body
    assert errors("runway", "POST /v1/image_to_video", body) == []
    if body["ratio"].startswith("auto_"):  # WAN 3 with a frame: the frame's own shape at the asked tier
        assert body["ratio"] in ("auto_720p", "auto_1080p")
    else:
        w, h = (int(x) for x in body["ratio"].split(":"))
        assert (w < h) if shape == "9:16" else (w == h)
    if refs:
        assert body["references"] == [{"uri": URL[MAYA]}]


# ── the mock's outpaint ─────────────────────────────────────────────────────
@pytest.mark.skipif(not shutil.which("ffmpeg"), reason="needs ffmpeg")
def test_the_mock_outpaints_a_clip_to_the_shape(tmp_path):
    import subprocess

    from providers.mock import outpaint_mp4
    src = tmp_path / "in.mp4"
    subprocess.run(["ffmpeg", "-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", "testsrc=size=320x180:rate=24:duration=1",
                    "-pix_fmt", "yuv420p", str(src)], check=True)
    data, w, h = outpaint_mp4(src.read_bytes(), "9:16", "ffmpeg")
    assert (w, h) == (320, 568) and data[4:8] == b"ftyp"
    data, w, h = outpaint_mp4(src.read_bytes(), "3:4", "ffmpeg")
    assert (w, h) == (320, 426)


def test_the_cutter_schema_is_one_the_port_accepts():
    schema = cutdowns.output_schema()
    assert schema["required"] == ["lengths", "subjects"] and schema["additionalProperties"] is False
    assert isinstance(Usage(), Usage)
