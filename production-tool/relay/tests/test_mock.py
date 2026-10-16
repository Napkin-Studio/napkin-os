import io
import json
import shutil
import subprocess

import pytest
from jsonschema import Draft202012Validator, FormatChecker
from PIL import Image
from referencing import Registry, Resource

from providers import (
    AssetRef, CapabilityMissing, MockProvider, ProviderJob, Ref, check_capabilities, load_sheet,
)
from providers.types import CONTRACTS, ProviderError

SHA = "sha256:" + "a" * 64
BASE = "https://napkin.ie/production-tool/contracts/"


def _png(color=(10, 120, 200), size=(64, 48)) -> bytes:
    out = io.BytesIO()
    Image.new("RGB", size, color).save(out, format="PNG")
    return out.getvalue()


class Clock:
    t = 0.0

    def __call__(self):
        return self.t


@pytest.fixture
def clock():
    return Clock()


@pytest.fixture
def mock(clock):
    fetched = []

    def fetch(url):
        fetched.append(url)
        return _png()

    provider = MockProvider(lambda sha: AssetRef(sha, f"https://cdn.test/{sha[-8:]}.png", "image/png"),
                            fetch, clock=clock)
    provider.fetched = fetched
    return provider


def job(op="generate", **kw):
    return ProviderJob(op=op, provider="mock", model="mock", prompt="a fox",
                       refs=kw.pop("refs", [Ref(SHA, "hero", "character")]), **kw)


def test_sheet_matches_schema():
    schemas = {p.name: json.loads(p.read_text()) for p in CONTRACTS.glob("*.schema.json")}
    registry = Registry().with_resources((BASE + n, Resource.from_contents(s)) for n, s in schemas.items())
    v = Draft202012Validator(schemas["capabilities.schema.json"], registry=registry, format_checker=FormatChecker())
    assert not list(v.iter_errors(load_sheet("mock")))


def test_submit_returns_at_once_without_fetching(mock):
    rid = mock.submit(job())
    assert rid.startswith("mock_")
    assert mock.fetched == []


def test_status_walks_queue_running_done(mock, clock):
    rid = mock.submit(job())
    s = mock.status(rid)
    assert (s.state, s.queue_position) == ("queued", 2)
    clock.t = 0.6
    assert mock.status(rid).queue_position == 1
    clock.t = 1.2
    assert mock.status(rid).state == "running"
    clock.t = 2.0
    s = mock.status(rid)
    assert s.state == "done" and s.kind == "mock" and s.cost_usd == 0.0


def test_output_is_the_input_stamped_and_sized(mock, clock):
    rid = mock.submit(job())
    clock.t = 3
    out = mock.status(rid).outputs[0]
    assert out.mime == "image/png" and (out.w, out.h) == (64, 48)
    stamped = Image.open(io.BytesIO(out.data)).convert("RGB")
    assert stamped.getpixel((2, 2)) == (220, 30, 30)  # the red MOCK banner
    assert stamped.getpixel((63, 47)) == (10, 120, 200)  # the rest is the input


def test_no_input_stamps_a_blank_canvas(mock, clock):
    rid = mock.submit(job(refs=[]))
    clock.t = 3
    out = mock.status(rid).outputs[0]
    assert (out.w, out.h) == (1024, 1024)


def test_several_outputs(mock, clock):
    rid = mock.submit(job(outputs=4))
    clock.t = 3
    assert len(mock.status(rid).outputs) == 4


def test_every_video_request_sets_audio_explicitly(mock):
    mock.submit(job("clip", first_frame=SHA, duration_s=5))
    mock.submit(job("clip_edit", duration_s=5))
    video = [r for r in mock.requests if r["op"] in ("clip", "clip_edit")]
    assert len(video) == 2 and all(r["audio"] is False for r in video)


def test_video_without_ffmpeg_returns_a_still_with_its_duration(mock, clock):
    mock._ffmpeg = None  # the relay Lambda: no ffmpeg on PATH
    rid = mock.submit(job("clip", first_frame=SHA, duration_s=6))
    clock.t = 3
    out = mock.status(rid).outputs[0]
    assert out.mime == "image/png" and out.duration_s == 6


def test_a_clip_from_words_alone_is_a_blank_still_with_its_duration(mock, clock):
    """A clip straight from the script (ui-behaviour 3.5): no frame, no refs; the mock still makes one."""
    mock._ffmpeg = None
    rid = mock.submit(job("clip", refs=[], duration_s=4))
    clock.t = 3
    out = mock.status(rid).outputs[0]
    assert out.mime == "image/png" and out.duration_s == 4
    assert mock.fetched == []
    assert load_sheet("mock")["ops"]["clip"]["textEndpoint"]


def test_a_clip_from_words_alone_has_the_videos_shape(mock, clock):
    mock._ffmpeg = None
    rid = mock.submit(job("clip", refs=[], duration_s=4, ratio="16:9"))
    clock.t = 3
    out = mock.status(rid).outputs[0]
    assert (out.w, out.h) == (1280, 720)


def test_cancel(mock, clock):
    rid = mock.submit(job())
    mock.cancel(rid)
    clock.t = 3
    assert mock.status(rid).state == "cancelled"


def test_unfetchable_input_fails_retryably_not_crashes(clock):
    def fetch(_):
        raise OSError("connection reset")

    m = MockProvider(lambda sha: AssetRef(sha, "https://cdn.test/x.png", "image/png"), fetch, clock=clock)
    rid = m.submit(job())
    clock.t = 3
    s = m.status(rid)
    assert s.state == "failed" and s.error.code == "provider_failed" and s.error.retryable


def test_unknown_request_id_fails(mock):
    assert mock.status("mock_nope").state == "failed"


def test_mock_refuses_what_its_sheet_rules_out(mock):
    with pytest.raises(CapabilityMissing):
        mock.submit(job(refs=[Ref(SHA, f"r{i}", "object") for i in range(15)]))  # max 14


# Capability refusal against the real Runway sheet (no mask, no seed, no angles).
@pytest.mark.parametrize("kw", [{"mask": SHA}, {"seed": 7}, {"angle": {"horizontal": 90}}, {"outputs": 5}])
def test_runway_sheet_refuses(kw):
    with pytest.raises(CapabilityMissing):
        check_capabilities(load_sheet("runway"), job("region_edit", **kw))


def test_runway_sheet_refuses_unsupported_clip_duration_and_op():
    sheet = load_sheet("runway")
    with pytest.raises(CapabilityMissing):
        check_capabilities(sheet, job("clip", first_frame=SHA, duration_s=5))  # 4, 6 or 8 only
    with pytest.raises(CapabilityMissing):
        check_capabilities(sheet, job("stitch"))
    check_capabilities(sheet, job("clip", refs=[], first_frame=SHA, duration_s=6))
    with pytest.raises(CapabilityMissing):  # Runway: no first frame together with refs
        check_capabilities(sheet, job("clip", first_frame=SHA, duration_s=6))


def test_character_ref_limit():
    refs = [Ref(SHA, f"c{i}", "character") for i in range(6)]
    with pytest.raises(CapabilityMissing):
        check_capabilities(load_sheet("runway"), job(refs=refs))


def test_the_input_is_resolved_at_submit_because_status_runs_outside_the_job(clock):
    """The relay's asset URLs exist only while the job is being submitted (base.set_job_context);
    a later status() that looked them up failed with "no URL for asset" (2026-10-08, local dev)."""
    live = {"job": True}

    def assets(sha):
        if not live["job"]:
            raise ProviderError("invalid_input", f"no URL for asset {sha}", False)
        return AssetRef(sha, f"https://cdn.test/{sha[-8:]}.png", "image/png")

    provider = MockProvider(assets, lambda url: _png(), clock=clock)
    rid = provider.submit(ProviderJob(op="generate", provider="mock", model="mock", prompt="a fox",
                                      refs=[Ref(SHA, "in_1", "character")]))
    live["job"] = False
    clock.t = 10
    status = provider.status(rid)
    assert status.state == "done" and status.outputs


# ── the drifting MP4 (features/connected-video.clan, phase 1) ───────────────

HAVE_FFMPEG = bool(shutil.which("ffmpeg") and shutil.which("ffprobe"))


def _frames(mp4: bytes, tmp_path) -> list[bytes]:
    f = tmp_path / "clip.mp4"
    f.write_bytes(mp4)
    r = subprocess.run(["ffmpeg", "-loglevel", "error", "-i", str(f), "-f", "rawvideo", "-pix_fmt", "gray", "-"],
                       capture_output=True, check=True)
    return r.stdout


@pytest.mark.skipif(not HAVE_FFMPEG, reason="needs ffmpeg")
def test_video_with_ffmpeg_is_a_one_second_drifting_mp4(clock, tmp_path):
    stripes = Image.new("RGB", (65, 48), (10, 120, 200))  # odd width: the MP4's is even
    for x in range(0, 65, 8):
        for y in range(48):
            stripes.putpixel((x, y), (250, 250, 250))
    buf = io.BytesIO()
    stripes.save(buf, format="PNG")
    m = MockProvider(lambda sha: AssetRef(sha, "https://cdn.test/x.png", "image/png"), lambda url: buf.getvalue(),
                     clock=clock)
    rid = m.submit(job("clip", first_frame=SHA, duration_s=6))
    clock.t = 3
    out = m.status(rid).outputs[0]
    assert out.mime == "video/mp4" and out.data[4:8] == b"ftyp"
    assert (out.w, out.h, out.duration_s) == (64, 48, 1.0)
    raw = _frames(out.data, tmp_path)
    n = 64 * 48
    assert len(raw) == 24 * n  # 1 s at 24 fps
    assert raw[:n] != raw[-n:]  # it drifts: the last frame is not the first


def test_ffmpeg_none_or_failing_falls_back_to_the_still(clock):
    for ffmpeg in (None, "/nonexistent/ffmpeg"):
        m = MockProvider(lambda sha: AssetRef(sha, "https://cdn.test/x.png", "image/png"), lambda url: _png(),
                         clock=clock, ffmpeg=ffmpeg)
        rid = m.submit(job("clip", first_frame=SHA, duration_s=4))
        clock.t += 3
        out = m.status(rid).outputs[0]
        assert out.mime == "image/png" and out.duration_s == 4, ffmpeg
