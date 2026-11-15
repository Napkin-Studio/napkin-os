"""The spend guard's estimate never below the sheet's price (features/production-platform-rules.clan, review B).

The euro guard (director/spend.py) is the only meter model calls and the line's paid ops pass before they are sent,
so it must count at least what the ledger counts: the same price function (contracts/pricing.py) with every setting
the price turns on (model, tier, scale, duration, outputs, audio, refs, input length). The walk below covers every
op and every model in capabilities/runway.json across the settings a job can carry, and the relay passes the
ledger's own reservation to the adapter so the guard never asks for less. No network and no key.
"""

from __future__ import annotations

import itertools
import json

import httpx
import pytest

from contracts_dir import contracts_dir, pricing
from director import spend
from providers import AssetRef, ProviderError, ProviderJob, Ref
from providers.runway import RunwayProvider
from providers.types import effective_sheet, load_sheet

SHA = "sha256:" + "c" * 64
VARS = ("NAPKIN_ENV", "NAPKIN_PAID_CALLS", "NAPKIN_SPEND_CAP_EUR", "NAPKIN_SPEND_RUN_CAP_EUR")
SHEET = json.loads((contracts_dir() / "capabilities" / "runway.json").read_text())
EVERY_OP_MODEL = [(op, m) for op, spec in SHEET["ops"].items()
                  for m in dict.fromkeys([spec["model"], *([spec["regionModel"]] if spec.get("regionModel") else []),
                                          *(a["model"] for a in spec.get("alternates") or [])])]


@pytest.fixture(autouse=True)
def clean(monkeypatch):
    for v in VARS:
        monkeypatch.delenv(v, raising=False)
    spend.reset()
    spend.set_run("-")
    yield
    spend.reset()


def runway(seen=None):
    def record(request):
        (seen if seen is not None else []).append(request)
        return httpx.Response(200, json={"id": "task_1"})
    return RunwayProvider("key_test", lambda sha: AssetRef(sha, "https://cdn.test/a", "image/png"),
                          client=httpx.Client(transport=httpx.MockTransport(record)))


def sheet_price(op, model, settings):
    return pricing().op_usd(effective_sheet(load_sheet("runway"), op, model), op, None, settings)


def cases(op, model):
    """(provider job, the settings the ledger prices it at) for each setting a job of `op` on `model` can carry."""
    eff = effective_sheet(SHEET, op, model)
    spec = eff["ops"][op]
    m = SHEET["models"][spec["model"]]
    price = m.get("pricing") or {}
    durations = sorted({*(spec.get("durations") or []), 2, 5, 8, 10})
    tiers = [None, *(price.get("byResolution") or {})]
    ratios = [None, *[r["ratio"] for r in m.get("ratios") or []][:4]]
    reads_clip = op in ("clip_edit", "clip_patch", "cutdown")
    for d, tier, ratio, outputs, audio, scale, px, refs in itertools.product(
            durations, tiers, ratios, (1, 2, 4), (False, True), (2, 4), (1000, 1344, 2048, 4096), (0, 1, 3)):
        if op != "upscale" and (scale, px) != (2, 1344):
            continue
        settings = {"durationS": d, "ratio": ratio, "outputs": outputs, "audio": audio, "refs": refs or None,
                    "resolution": tier, "scaleFactor": scale, "inputPx": px, "inputS": d if reads_clip else None}
        job = ProviderJob(op=op, provider="runway", model=model, prompt="a shot", ratio=ratio, duration_s=float(d),
                          outputs=outputs, audio=audio, scale=scale,
                          refs=[Ref(SHA, f"r{i}", "character") for i in range(refs)],
                          quality={"level": "final", "tier": tier} if tier else None)
        yield job, settings


@pytest.mark.parametrize("op,model", EVERY_OP_MODEL)
def test_the_guard_never_estimates_below_the_sheet_price(op, model):
    """Every op and model in the capabilities file, at every setting the price turns on: guard >= sheet price."""
    rw, low = runway(), []
    for job, settings in cases(op, model):
        price = sheet_price(op, model, settings)
        if price is None:
            continue
        guard = rw._guard_estimate(job)
        if guard < price:
            low.append((settings, guard, price))
    assert not low, f"{op} on {model}: the guard asked for less than the sheet, e.g. {low[:3]}"


@pytest.mark.parametrize("job,price", [
    (ProviderJob(op="upscale", provider="runway", model="magnific_precision_upscaler_v2", prompt="",
                 refs=[Ref(SHA, "current", "current")], scale=4), 1.50),
    (ProviderJob(op="clip_edit", provider="runway", model="aleph2", prompt="make it dusk",
                 refs=[Ref(SHA, "current", "current")], ratio="1280:720", duration_s=10.0), 2.80),
    (ProviderJob(op="cutdown", provider="runway", model="aleph2", prompt="continue",
                 refs=[Ref(SHA, "current", "current")], ratio="1:1", duration_s=8.0), 2.24),
    (ProviderJob(op="clip", provider="runway", model="seedance2_5", prompt="a shot", first_frame=SHA,
                 ratio="1280:720", duration_s=6.0, quality={"level": "final", "tier": "1080p"}), 4.08),
], ids=["upscale-4x", "clip_edit-10s", "cutdown-8s", "seedance-final-6s"])
def test_the_reviews_measured_cases_reach_the_sheet_price(job, price):
    """The review measured 0.25, 1.40, 0.84 and 1.80 against these sheet prices."""
    assert runway()._guard_estimate(job) >= price


def test_a_four_times_upscale_is_not_sent_under_a_one_euro_cap(monkeypatch):
    monkeypatch.setenv("NAPKIN_ENV", "napkin-staging")
    monkeypatch.setenv("NAPKIN_PAID_CALLS", "on")
    monkeypatch.setenv("NAPKIN_SPEND_CAP_EUR", "1")
    seen = []
    up4 = ProviderJob(op="upscale", provider="runway", model="magnific_precision_upscaler_v2", prompt="",
                      refs=[Ref(SHA, "current", "current")], scale=4)
    with pytest.raises(ProviderError) as e:
        runway(seen).submit(up4)  # 150 credits (1.50 USD) by the sheet
    assert e.value.code == "spend_stop" and seen == []


def test_the_guard_never_asks_less_than_the_ledger_reserved():
    """The relay passes its reservation (priceUsd): a price the adapter cannot see is still counted."""
    job = ProviderJob.from_director("generate", {"provider": "runway", "model": "gemini_image3_pro", "prompt": "a bottle",
                                                 "refs": [], "priceUsd": 7.5})
    assert job.price_usd == 7.5 and runway()._guard_estimate(job) >= 7.5


def test_through_the_relay_the_guard_counts_at_least_the_jobs_reservation(monkeypatch):
    """A whole job through the relay: what the guard is asked for is at least what the ledger reserved."""
    from providers._seam import Adapted, Resolver
    from test_frame_edit import CAMERA, FakeRunwayHttp, dex, edit_input, harness, post

    monkeypatch.setenv("NAPKIN_PAID_CALLS", "on")
    monkeypatch.setenv("NAPKIN_SPEND_CAP_EUR", "1000")
    asked = []
    real = spend.check
    monkeypatch.setattr(spend, "check", lambda amount, *a, **k: (asked.append(amount), real(amount, *a, **k))[1])
    h = harness(providers=("runway",))
    http = FakeRunwayHttp()
    h.relay.registry.register(Adapted(RunwayProvider("rw-key", Resolver(), client=httpx.Client(transport=httpx.MockTransport(http)))),
                              h.providers["runway"].sheet)
    dex(h, CAMERA)
    job = post(h, h.as_person(), edit_input())
    assert job["state"] == "submitted", job
    assert asked and asked[-1] >= job["cost"]["reserved"] > 0


# ── review finding 4: the guard trusts the caller's clip length ──────────────────────────────────────

_MP4: dict = {}


def mp4(seconds: float) -> bytes:
    """A real MP4 of `seconds` (ffmpeg, a 16x16 black clip at 2 fps), made once per length. The relay measures a
    clip with ffprobe (cliplength.py), so a test clip is a real one; no ffmpeg here skips the test."""
    import shutil
    import subprocess
    import tempfile
    if seconds not in _MP4:
        if not shutil.which("ffmpeg"):
            pytest.skip("ffmpeg is not installed")
        with tempfile.TemporaryDirectory() as d:
            out = f"{d}/clip.mp4"
            subprocess.run(["ffmpeg", "-hide_banner", "-loglevel", "error", "-y", "-f", "lavfi", "-i",
                            f"color=c=black:s=16x16:r=2:d={seconds}", "-pix_fmt", "yuv420p", "-movflags", "+faststart", out],
                           check=True, timeout=120)
            _MP4[seconds] = open(out, "rb").read()
    return _MP4[seconds]


def lying_mp4(real_s: int = 30, header_s: int = 2) -> bytes:
    """A real 30 s MP4 whose movie header (mvhd) is rewritten to say 2 s (the re-review's probe)."""
    import struct
    data = bytearray(mp4(real_s))
    at = data.find(b"mvhd")
    assert at > 0 and data[at + 4] == 0
    timescale = struct.unpack(">I", data[at + 16:at + 20])[0]
    data[at + 20:at + 24] = struct.pack(">I", header_s * timescale)
    return bytes(data)


@pytest.mark.parametrize("declared", [None, 1, 2, 5, 30])
def test_clip_edit_is_priced_by_the_stored_clips_real_length_not_the_request(monkeypatch, declared):
    import copy as _copy

    from conftest import envelope
    from director import new_id
    from test_pathways import EDITOR_ALLOW, INPUTS, SHOT, pathway
    monkeypatch.setenv("NAPKIN_PAID_CALLS", "on")
    monkeypatch.setenv("NAPKIN_SPEND_CAP_EUR", "1000")
    asked = []
    real = spend.check
    monkeypatch.setattr(spend, "check", lambda amount, *a, **k: (asked.append(amount), real(amount, *a, **k))[1])
    h, _ = pathway("runway")
    h.limits("blue", allow=EDITOR_ALLOW)
    inp = _copy.deepcopy(INPUTS["clip_edit"])
    h.blobs.put(f"in/{inp['video']['sha256']}", mp4(30), "video/mp4")       # the clip Runway will read: 30 s
    if declared is not None:
        inp["shot"] = {**SHOT, "duration_s": declared, "action": "the sea at dusk", "refs": []}
    status, job = h.call("POST", "/jobs", {**envelope("clip_edit", new_id("job")), "input": inp}, h.as_person())
    full = pricing().op_usd(effective_sheet(load_sheet("runway"), "clip_edit", job.get("model")), "clip_edit", None, {"inputS": 30})
    assert job["cost"]["estimate"] >= full, job["cost"]
    assert asked and asked[-1] >= full, f"declared {declared}: guard asked {asked}, a 30 s clip is {full}"


def test_a_clip_edit_whose_length_cannot_be_read_is_refused():
    import copy as _copy

    from conftest import envelope
    from director import new_id
    from test_pathways import EDITOR_ALLOW, INPUTS, pathway
    h, stand = pathway("runway")
    h.limits("blue", allow=EDITOR_ALLOW)
    inp = _copy.deepcopy(INPUTS["clip_edit"])
    h.blobs.put(f"in/{inp['video']['sha256']}", b"not a video", "video/mp4")
    status, job = h.call("POST", "/jobs", {**envelope("clip_edit", new_id("job")), "input": inp}, h.as_person())
    assert status == 400 and job["error"]["code"] == "invalid_input", job
    assert stand.to("runway") == []



# ── the re-review of 1d637751: a header a caller can edit, two clips, the outpaint, unsent jobs ───────

def test_an_mp4_whose_header_says_2s_but_plays_30s_is_not_priced_at_2s():
    from cliplength import measure
    got = measure(lying_mp4())
    assert got is None or got >= 29, f"the relay prices {got} s for a clip a decoder reads 30 s of"
    assert 29 <= measure(mp4(30)) <= 31


def test_a_clip_too_large_to_measure_is_refused_unread(monkeypatch):
    import blobs
    from conftest import Harness, asset
    h = Harness()
    a = asset(9, "video/mp4")
    h.blobs.put(f"in/{a['sha256']}", mp4(5), "video/mp4")
    monkeypatch.setattr(blobs, "MAX_MEASURE_BYTES", 100)
    assert h.blobs.clip_seconds(a["url"]) is None


def test_clip_edit_prices_the_video_the_adapter_sends(monkeypatch):
    """input.video is a 2 s clip; a second video rides in input.refs, as a style ref or as `current`."""
    import copy as _copy

    from conftest import envelope
    from director import new_id
    from test_pathways import EDITOR_ALLOW, INPUTS, pathway
    from test_pathways import asset as p_asset
    h, stand = pathway("runway")
    h.limits("blue", allow=EDITOR_ALLOW)
    inp = _copy.deepcopy(INPUTS["clip_edit"])
    short, long = inp["video"], p_asset(9, "video/mp4")
    h.blobs.put(f"in/{short['sha256']}", mp4(2), "video/mp4")
    h.blobs.put(f"in/{long['sha256']}", mp4(30), "video/mp4")
    for role in ("style", "current"):
        del stand.sent[:]
        refs = [{"id": new_id("node"), "role": role, "kind": "video", "asset": long}]
        status, job = h.call("POST", "/jobs", {**envelope("clip_edit", new_id("job")), "input": {**inp, "refs": refs}},
                             h.as_person())
        body = str((stand.to("runway") or [{}])[0].get("body") or {})
        assert long["sha256"] not in body or (job.get("cost") or {}).get("reserved", 0) >= 8.4, (role, job.get("cost"), body)


def test_an_outpaint_is_priced_by_the_take_runway_reads_not_the_window_the_request_declares(monkeypatch):
    """cutdown outpaint sends the take whole (videoUri); the request declares outS - inS (re-review finding 4)."""
    import httpx as _httpx

    from conftest import CDN, Harness, asset, base_config
    from providers import Registry
    from providers._seam import Adapted, Resolver
    monkeypatch.setenv("NAPKIN_PAID_CALLS", "on")
    monkeypatch.setenv("NAPKIN_SPEND_CAP_EUR", "1000")
    asked, seen = [], []
    real = spend.check
    monkeypatch.setattr(spend, "check", lambda amount, *a, **k: (asked.append(amount), real(amount, *a, **k))[1])
    h = Harness(base_config(routing={**base_config()["routing"], "cutdown": ["runway"]}), providers=())
    reg = Registry()
    reg.register(Adapted(RunwayProvider("rw_test_key", Resolver(), client=_httpx.Client(transport=_httpx.MockTransport(
        lambda r: (seen.append((r.method, str(r.url))), _httpx.Response(200, json={"id": "task_1"}))[1])))))
    h.relay.registry = reg
    token = h.as_person()
    h.limits("blue", allow={"claude": True, "makers": ["runway", "google", "ideogram", "magnific"]})
    a = asset(7, "video/mp4")
    a["url"] = f"{CDN}/out/{a['sha256']}"
    h.blobs.put(f"out/{a['sha256']}", mp4(30), "video/mp4")          # the take is 30 s
    inp = {"aspect": {"w": 9, "h": 16}, "delivery": {"width": 1080, "height": 1920},
           "cutdown": {"step": "outpaint", "lengthS": 2, "targetRatio": "9:16",
                       "clips": [{"asset": a, "inS": 0, "outS": 2, "takeSize": {"w": 1280, "h": 720}, "outpaint": True}]}}
    status, job = h.post_job(token, op="cutdown", **inp)
    full = pricing().op_usd(effective_sheet(load_sheet("runway"), "cutdown", None), "cutdown", None, {"inputS": 30})
    assert [s for s in seen if s[0] == "POST"], (status, job)
    assert job["cost"]["reserved"] >= full and asked[-1] >= full, (job["cost"], asked, full)


def test_jobs_that_are_never_sent_leave_the_days_cap_as_it_was(monkeypatch):
    """Re-review finding 3: the guard counted before the adapter built the request; a sheet refusal sent nothing
    yet used the day's cap (one total for every agency)."""
    import copy as _copy

    from conftest import envelope
    from director import new_id
    from test_pathways import EDITOR_ALLOW, INPUTS, SHOT, pathway
    monkeypatch.setenv("NAPKIN_PAID_CALLS", "on")
    monkeypatch.setenv("NAPKIN_SPEND_CAP_EUR", "20")
    spend.reset()
    h, stand = pathway("runway")
    h.limits("blue", allow=EDITOR_ALLOW)
    inp = _copy.deepcopy(INPUTS["clip_edit"])
    h.blobs.put(f"in/{inp['video']['sha256']}", mp4(30), "video/mp4")
    inp["shot"] = {**SHOT, "duration_s": 1, "action": "the sea at dusk", "refs": []}   # the sheet refuses 1 s
    token = h.as_person()
    for _ in range(3):
        _, job = h.call("POST", "/jobs", {**envelope("clip_edit", new_id("job")), "input": inp}, token)
        assert (job.get("error") or {}).get("code") != "spend_stop", job
    assert not stand.to("runway")
    assert sum(spend._day.values()) == 0, f"nothing was sent, yet the guard's day total is {dict(spend._day)}"


def test_a_refused_provider_call_gives_its_guard_reservation_back(monkeypatch):
    """An adapter that refuses after the guard counted (the sheet, the network before sending) releases it."""
    monkeypatch.setenv("NAPKIN_PAID_CALLS", "on")
    monkeypatch.setenv("NAPKIN_SPEND_CAP_EUR", "20")
    up = ProviderJob(op="upscale", provider="runway", model="magnific_precision_upscaler_v2", prompt="",
                     refs=[], scale=4)        # no image: refused before anything is sent
    with pytest.raises(Exception):
        runway().submit(up)
    assert sum(spend._day.values()) == 0 and sum(spend._run.values()) == 0
