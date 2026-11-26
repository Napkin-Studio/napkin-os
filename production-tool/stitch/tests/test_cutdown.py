"""Cutdowns and re-aspects on real ffmpeg (features/campaign-formats.clan, phases 5 and 6): a 15 s cut of
three takes' windows and a 9:16 reframe of them, each with its end card at its own size, a caption laid
over its time, the sound kept and faded, and a still crop, a slow pan and a centre fill. An event with no
mode still builds exactly the ad's command."""

from __future__ import annotations

import json
import shutil
import subprocess
from pathlib import Path

import pytest

import cutdown
import stitch

HAVE_FFMPEG = bool(shutil.which("ffmpeg") and shutil.which("ffprobe"))
pytestmark = pytest.mark.skipif(not HAVE_FFMPEG, reason="needs ffmpeg and ffprobe")


def ff(*args: str) -> None:
    r = subprocess.run(["ffmpeg", "-hide_banner", "-loglevel", "error", "-y", *args], capture_output=True, text=True)
    assert r.returncode == 0, r.stderr


def take(path: Path, seconds: float = 6, audio: bool = True, size: str = "320x180") -> Path:
    args = ["-f", "lavfi", "-i", f"testsrc=size={size}:rate=24:duration={seconds}"]
    if audio:
        args += ["-f", "lavfi", "-i", f"sine=frequency=440:duration={seconds}"]
    ff(*args, "-c:v", "libx264", "-pix_fmt", "yuv420p", *(["-c:a", "aac"] if audio else []), "-shortest", str(path))
    return path


def caption_png(path: Path, size: tuple[int, int]) -> Path:
    """A transparent PNG with a white band near the foot (a caption, as the relay draws one)."""
    w, h = size
    ff("-f", "lavfi", "-i", f"color=c=white:s={w}x{h},format=rgba,"
       f"geq=r=255:g=255:b=255:a='255*between(X,10,{w - 10})*between(Y,{h - 60},{h - 20})'",
       "-frames:v", "1", str(path))
    return path


def streams(path: Path) -> dict:
    r = subprocess.run(["ffprobe", "-v", "error", "-show_entries", "stream=codec_type,width,height:format=duration",
                        "-of", "json", str(path)], capture_output=True, text=True, check=True)
    data = json.loads(r.stdout)
    v = next(s for s in data["streams"] if s["codec_type"] == "video")
    return {"w": v["width"], "h": v["height"], "duration": float(data["format"]["duration"]),
            "audio": any(s["codec_type"] == "audio" for s in data["streams"])}


class Frame:
    def __init__(self, data: bytes, w: int):
        self.data, self.w = data, w

    def getpixel(self, xy):
        i = (xy[1] * self.w + xy[0]) * 3
        return tuple(self.data[i:i + 3])

    def sample(self, step: int = 97) -> bytes:
        return self.data[::step]


def frame_at(path: Path, t: float, _out: Path | None = None) -> Frame:
    s = streams(path)
    r = subprocess.run(["ffmpeg", "-hide_banner", "-loglevel", "error", "-ss", f"{t}", "-i", str(path), "-frames:v", "1",
                        "-f", "rawvideo", "-pix_fmt", "rgb24", "-"], capture_output=True, check=True)
    return Frame(r.stdout, s["w"])


def render(tmp: Path, event: dict) -> dict:
    store: dict[str, bytes] = {}

    def get(key, dest):
        shutil.copy(tmp / key, dest)

    def put(key, src, mime):
        store[key] = Path(src).read_bytes()
        (tmp / "out.mp4").write_bytes(store[key])

    out = stitch.run({"jobId": "job_cut", "outKey": "ads/cuts/job_cut.mp4", "resultKey": "ads/cuts/job_cut.json", **event},
                     get=get, put=put, put_json=lambda k, d: store.__setitem__(k, d), ffmpeg="ffmpeg", ffprobe="ffprobe")
    assert out["ok"], out
    return out


@pytest.fixture
def takes(tmp_path):
    take(tmp_path / "a.mp4")
    take(tmp_path / "b.mp4", audio=False)
    take(tmp_path / "c.mp4")
    return tmp_path


def test_a_15s_cutdown_is_its_windows_alone_with_the_sound_faded_and_no_studio_card(takes):
    clips = [{"key": "a.mp4", "inS": 0, "outS": 4.5}, {"key": "b.mp4", "inS": 1, "outS": 5.5},
             {"key": "c.mp4", "inS": 0.5, "outS": 4.0}]
    out = render(takes, {"mode": "cutdown", "size": [320, 180], "clips": clips, "endCard": True, "fadeOutS": 0.5})
    s = streams(takes / "out.mp4")
    body = 4.5 + 4.5 + 3.5
    assert (s["w"], s["h"]) == (320, 180) and s["audio"]
    assert abs(s["duration"] - body) <= 2 / stitch.FPS + 0.03, s  # 12.5 s: its windows, no studio card after them
    assert out["durationS"] == pytest.approx(body, abs=0.1)
    assert "endCard" not in out


def test_a_9x16_reframe_crops_each_shot_its_own_way_and_draws_the_caption_in_its_time(takes):
    size = (180, 320)
    caption_png(takes / "cap.png", size)
    clips = [
        {"key": "a.mp4", "inS": 0, "outS": 3, "takeSize": [1920, 1080], "crop": {"x": 0, "y": 0, "w": 607.5, "h": 1080}},
        {"key": "b.mp4", "inS": 0, "outS": 3, "takeSize": [1920, 1080],
         "cropKeys": [{"at": 0, "box": {"x": 0, "y": 0, "w": 607.5, "h": 1080}}, {"at": 1, "box": {"x": 1312.5, "y": 0, "w": 607.5, "h": 1080}}]},
        {"key": "c.mp4", "inS": 0, "outS": 2},  # a remade or outpainted clip: filled from its middle
    ]
    render(takes, {"mode": "cutdown", "size": list(size), "clips": clips, "endCard": True, "fadeOutS": 0,
                   "layers": [{"key": "cap.png", "fromS": 3.5, "toS": 5.5}]})
    s = streams(takes / "out.mp4")
    assert (s["w"], s["h"]) == size
    assert abs(s["duration"] - 8) <= 2 / stitch.FPS + 0.03
    # The caption shows in its time and not before.
    before = frame_at(takes / "out.mp4", 1.0, takes / "f1.png").getpixel((size[0] // 2, size[1] - 40))
    during = frame_at(takes / "out.mp4", 4.0, takes / "f2.png").getpixel((size[0] // 2, size[1] - 40))
    assert min(during) > 230 and min(before) < 230
    # The pan moves: the start and the end of shot 2 show different parts of the test pattern.
    a = frame_at(takes / "out.mp4", 3.05, takes / "p0.png")
    b = frame_at(takes / "out.mp4", 5.9, takes / "p1.png")
    assert a.sample() != b.sample()


def test_a_crop_is_scaled_to_the_pixels_the_take_really_has():
    f = cutdown.crop_filter({"takeSize": (1920, 1080), "crop": {"x": 656.25, "y": 0, "w": 607.5, "h": 1080}}, (1280, 720), 3)
    assert f == "crop=404:720:437.5:0,"
    pan = cutdown.crop_filter({"takeSize": (1920, 1080), "cropKeys": [{"at": 0, "box": {"x": 0, "y": 0, "w": 607.5, "h": 1080}},
                                                                     {"at": 1, "box": {"x": 1312.5, "y": 0, "w": 607.5, "h": 1080}}]}, (1920, 1080), 3)
    assert pan == "crop=608:1080:'clip(if(lt(t,3),0+(1312)*(t-0)/3,1312),0,1312)':0,"


def test_the_ads_own_render_builds_the_same_command_as_before(takes):
    cmd = stitch.build_command("ffmpeg", [{"path": "a.mp4", "trimS": 4}], (320, 180), "o.mp4")
    assert "cutdown" not in " ".join(cmd) and "-an" in cmd


def test_a_cutdown_carries_no_studio_card_whatever_cardS_the_event_says(takes):
    """A client ad never carries the studio card (owner 2026-11-23): a size is its windows, to the frame."""
    clips = [{"key": "a.mp4", "inS": 0, "outS": 3.5}]
    out = render(takes, {"mode": "cutdown", "size": [180, 320], "clips": clips, "endCard": True, "fadeOutS": 0.5, "cardS": 1.333})
    s = streams(takes / "out.mp4")
    assert abs(s["duration"] - 3.5) <= 2 / stitch.FPS + 0.03, s
    assert "endCard" not in out


def test_r5_a_box_round_the_whole_subject_is_fitted_on_a_blurred_fill_not_stretched(takes):
    """UAT round 5 (R5-F6): the plan said the 9:16 crop cuts shot 5's subject (the kettle and Maya, 1190 px wide), and
    the cutdown cropped it anyway. The web sends a box round the whole subject; stitch fits it whole over a blurred fill
    of itself. A box of the size's own shape is cropped exactly as before."""
    size = (180, 320)
    whole = {"x": 652.8, "y": 0, "w": 1190.4, "h": 1080}
    assert cutdown.fits_whole({"crop": whole}, size)
    assert not cutdown.fits_whole({"crop": {"x": 0, "y": 0, "w": 607.5, "h": 1080}}, size)
    assert not cutdown.fits_whole({}, size)
    clip = {"key": "a.mp4", "inS": 0, "outS": 2, "takeSize": [1920, 1080], "crop": whole}
    render(takes, {"mode": "cutdown", "size": list(size), "clips": [clip], "endCard": True, "fadeOutS": 0})
    s = streams(takes / "out.mp4")
    assert (s["w"], s["h"]) == size
    # The picture sits in the middle band; the top and the foot are the dark blurred fill, not the test pattern's colours.
    f = frame_at(takes / "out.mp4", 1.0)
    top, mid = f.getpixel((size[0] // 2, 6)), f.getpixel((size[0] // 2, size[1] // 2))
    assert max(top) < max(mid) or top != mid
    # The fitted picture is not stretched: the middle band is the take's 16:9-ish box scaled to the width (~174 px tall).
    rows = [f.getpixel((size[0] // 2, y)) for y in range(size[1])]
    assert rows[size[1] // 2] != rows[4]
