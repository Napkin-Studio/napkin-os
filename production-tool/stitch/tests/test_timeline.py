"""The ad from a timeline on real ffmpeg (features/make-and-edit.clan): V1's clips placed at their start
times with their windows, a fade from black, a dissolve and a dip, a black gap, a held last frame, a
retimed clip, a text laid over its time with alpha fades, and the person's end card, then the studio's
roll-up. The film is exactly the plan's length, and an event with no mode still builds the ad's command
as it always did."""

from __future__ import annotations

import json
import shutil
import subprocess
from pathlib import Path

import pytest

import stitch
import timeline

HERE = Path(__file__).parent
HAVE_FFMPEG = bool(shutil.which("ffmpeg") and shutil.which("ffprobe"))
needs_ffmpeg = pytest.mark.skipif(not HAVE_FFMPEG, reason="needs ffmpeg and ffprobe")

RED, GREEN, BLUE, YELLOW = (255, 0, 0), (0, 255, 0), (0, 0, 255), (255, 255, 0)


def ff(*args: str) -> None:
    r = subprocess.run(["ffmpeg", "-hide_banner", "-loglevel", "error", "-y", *args], capture_output=True, text=True)
    assert r.returncode == 0, r.stderr


def solid(path: Path, colour: str, seconds: float) -> Path:
    ff("-f", "lavfi", "-i", f"color=c={colour}:s=320x180:r=24:d={seconds}", "-c:v", "libx264", "-pix_fmt", "yuv420p", str(path))
    return path


def png(path: Path, colour: str, band: bool = False) -> Path:
    """A 320x180 PNG: a solid card, or (band) a transparent picture with a white band at its foot (a caption)."""
    if band:
        ff("-f", "lavfi", "-i", "color=c=white:s=320x180,format=rgba,geq=r=255:g=255:b=255:a='255*between(Y,140,170)'",
           "-frames:v", "1", str(path))
    else:
        ff("-f", "lavfi", "-i", f"color=c={colour}:s=320x180", "-frames:v", "1", str(path))
    return path


def pixel(path: Path, t: float, xy=(160, 60)) -> tuple[int, int, int]:
    r = subprocess.run(["ffmpeg", "-hide_banner", "-loglevel", "error", "-ss", f"{t}", "-i", str(path), "-frames:v", "1",
                        "-f", "rawvideo", "-pix_fmt", "rgb24", "-"], capture_output=True, check=True)
    w = int(json.loads(subprocess.run(["ffprobe", "-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width",
                                       "-of", "json", str(path)], capture_output=True, text=True, check=True).stdout)["streams"][0]["width"])
    i = (xy[1] * w + xy[0]) * 3
    return tuple(r.stdout[i:i + 3])


def near(got, want, tol=48) -> bool:
    return all(abs(a - b) <= tol for a, b in zip(got, want))


def render(tmp: Path, event: dict) -> tuple[dict, Path]:
    def get(key, dest):
        shutil.copy(tmp / key, dest)

    out = tmp / "out.mp4"
    results = {}
    res = stitch.run({"jobId": "job_timeline01", "mode": "timeline", "outKey": "ad.mp4", "resultKey": "ad.json", **event},
                     get=get, put=lambda key, src, mime: shutil.copy(src, out), put_json=lambda k, d: results.update(d),
                     ffmpeg="ffmpeg", ffprobe="ffprobe")
    assert res == results
    return res, out


@pytest.fixture
def media(tmp_path):
    solid(tmp_path / "red.mp4", "red", 4)
    solid(tmp_path / "green.mp4", "lime", 4)
    solid(tmp_path / "blue.mp4", "blue", 4)
    solid(tmp_path / "short.mp4", "red", 1)
    png(tmp_path / "card.png", "yellow")
    png(tmp_path / "caption.png", "white", band=True)
    return tmp_path


# The plan (ad time):  0-2 red (fade in 0.5) | 2-3.5 green | 3.5-5 blue, dissolved in over 0.5 |
# 5-5.5 black gap | 5.5-7 short red: 1 s of footage held 0.5 | 7-8 card, dipped to black over 0.5.
PLAN = {
    "clips": [
        {"key": "red.mp4", "startS": 0, "inS": 0, "outS": 2, "fadeInS": 0.5},
        {"key": "green.mp4", "startS": 2, "inS": 0.5, "outS": 2},
        {"key": "blue.mp4", "startS": 3.5, "inS": 1, "outS": 2.5, "transitionIn": {"kind": "dissolve", "s": 0.5}},
        {"key": "short.mp4", "startS": 5.5, "inS": 0, "outS": 1, "holdS": 0.5},
    ],
    "texts": [{"key": "caption.png", "fromS": 2.5, "toS": 4, "fadeInS": 0.25, "fadeOutS": 0.25}],
    "endCard": {"key": "card.png", "s": 1, "transitionIn": {"kind": "dip_black", "s": 0.5}},
    "lengthS": 8,
}


@needs_ffmpeg
def test_the_film_is_the_plans_length_then_the_roll_up(media):
    res, out = render(media, PLAN)
    assert res["ok"], res
    assert res["lengthS"] == 8
    assert abs(res["durationS"] - (8 + stitch.CARD_S)) <= 0.05, res


@needs_ffmpeg
def test_clips_sit_at_their_times_with_fades_transitions_a_gap_and_a_hold(media):
    _, out = render(media, PLAN)
    assert sum(pixel(out, 0.02)) < 60                       # faded in from black
    assert near(pixel(out, 0.25), (RED[0] // 2, 0, 0), 60)  # halfway up the fade
    assert near(pixel(out, 1.0), RED)
    assert near(pixel(out, 2.8), GREEN)
    mid = pixel(out, 3.75)                                  # inside the dissolve: green and blue at once
    assert mid[1] > 40 and mid[2] > 40, mid
    assert near(pixel(out, 4.6), BLUE)
    assert sum(pixel(out, 5.25)) < 40                       # the gap is black
    assert near(pixel(out, 6.0), RED)
    assert near(pixel(out, 6.8), RED)                       # the held last frame
    assert sum(pixel(out, 7.25)) < 200                      # the middle of the dip: darker than the red before and the card after
    assert near(pixel(out, 7.8), YELLOW)


@needs_ffmpeg
def test_text_shows_at_its_time_only(media):
    _, out = render(media, PLAN)
    band = (160, 155)
    assert near(pixel(out, 3.0, band), (255, 255, 255), 40)  # over green, fully in
    assert near(pixel(out, 2.2, band), GREEN)                # before it
    assert near(pixel(out, 4.4, band), BLUE)                 # after it
    fading = pixel(out, 2.6, band)                           # 0.1 s into a 0.25 s fade: part way
    assert fading != pixel(out, 3.0, band) and fading[0] > 30, fading


@needs_ffmpeg
def test_a_retimed_clip_and_a_dip_to_white(media):
    plan = {"clips": [{"key": "red.mp4", "startS": 0, "inS": 0, "outS": 2.4, "speed": 1.2},
                      {"key": "blue.mp4", "startS": 2, "inS": 0, "outS": 1, "transitionIn": {"kind": "dip_white", "s": 0.5}}],
            "lengthS": 3}
    res, out = render(media, plan)
    assert res["ok"] and abs(res["durationS"] - (3 + stitch.CARD_S)) <= 0.05, res
    assert near(pixel(out, 1.0), RED)
    assert sum(pixel(out, 2.25)) > 600  # the middle of the dip is white
    assert near(pixel(out, 2.8), BLUE)


@needs_ffmpeg
def test_a_plan_whose_length_does_not_add_up_or_whose_clips_overlap_is_refused(media):
    res, _ = render(media, {**PLAN, "lengthS": 9})
    assert not res["ok"] and res["code"] == "bad_clip" and "cannot be rendered" in res["error"]
    overlap = json.loads(json.dumps(PLAN))
    overlap["clips"][1]["startS"] = 1.5
    overlap["lengthS"] = 7.5
    res, _ = render(media, overlap)
    assert not res["ok"] and "overlaps" in res["error"]


def test_pieces_place_gaps_and_lend_handles():
    clips = [{"startS": 0.5, "inS": 0, "outS": 1}, {"startS": 1.5, "inS": 0, "outS": 1, "transitionIn": {"kind": "dissolve", "s": 0.5}},
             {"startS": 3, "inS": 0, "outS": 1, "transitionIn": {"kind": "dissolve", "s": 0.5}}]
    got = timeline.pieces(clips, {"s": 1, "transitionIn": {"kind": "dip_black"}})
    assert [(p["kind"], p["at"], p["len"], p["join"], p["handle"]) for p in got] == [
        ("gap", 0.0, 0.5, ("cut", 0.0), 0.0),
        ("clip", 0.5, 1.0, ("cut", 0.0), 0.5),
        ("clip", 1.5, 1.0, ("dissolve", 0.5), 0.0),
        ("gap", 2.5, 0.5, ("cut", 0.0), 0.0),          # a transition across a gap is a cut
        ("clip", 3.0, 1.0, ("cut", 0.0), 0.5),
        ("card", 4.0, 1.0, ("dip_black", 0.5), 0.0),   # the default length
    ]


def test_an_event_with_no_mode_still_builds_the_ads_command():
    """Old stitch requests stay byte-identical with the timeline mode beside them (snapshots/ad_command.json)."""
    want = json.loads((HERE / "snapshots" / "ad_command.json").read_text())
    assets = stitch.load_assets("roll-up")
    clips = [{"path": "/tmp/c0.mp4", "trimS": 4.5, "inS": 0}, {"path": "/tmp/c1.mp4", "transition": {"kind": "cut"}},
             {"path": "/tmp/c2.png", "still": True, "trimS": 3, "transition": {"kind": "cut", "s": 1}}]
    cmd = stitch.build_command("ffmpeg", clips, (1280, 720), "roll-up", assets, "/tmp/ad.mp4")
    assert [c.replace(str(stitch.ENDCARD_DIR), "<endcard>") for c in cmd] == want["two_clips_and_a_still/roll-up"]
