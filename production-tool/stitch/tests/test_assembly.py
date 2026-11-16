"""The ad's assembly (features/connected-video.clan, phase 1): in and out points, transitions with
handles that keep the ad as long as its shots plus the card, PNG clips beside them, Jude's seam scores,
and a request with no in points that renders exactly as before."""

from __future__ import annotations

import hashlib
import json
import shutil
import subprocess
from pathlib import Path

import pytest

import stitch

HAVE_FFMPEG = bool(shutil.which("ffmpeg") and shutil.which("ffprobe"))
needs_ffmpeg = pytest.mark.skipif(not HAVE_FFMPEG, reason="needs ffmpeg and ffprobe")
HERE = Path(__file__).resolve().parent
ASSETS = stitch.load_assets("roll-up")


def cmd_for(clips):
    return stitch.build_command("ffmpeg", clips, (1280, 720), "roll-up", ASSETS, "/t/o.mp4")


def graph(cmd):
    return cmd[cmd.index("-filter_complex") + 1]


# ── the command ───────────────────────────────────────────────────────────────

def test_no_in_points_and_cuts_build_the_command_as_before():
    """inS 0, no outS and cut joins are the old request: they build the snapshot's command (its videos'
    parts unchanged since before in points; its still is held to its shot since 2026-10-15)."""
    want = json.loads((HERE / "snapshots" / "ad_command.json").read_text())
    clips = [{"path": "/tmp/c0.mp4", "trimS": 4.5, "inS": 0}, {"path": "/tmp/c1.mp4", "transition": {"kind": "cut"}},
             {"path": "/tmp/c2.png", "still": True, "trimS": 3, "transition": {"kind": "cut", "s": 1}}]
    cmd = stitch.build_command("ffmpeg", clips, (1280, 720), "roll-up", ASSETS, "/tmp/ad.mp4")
    assert [c.replace(str(stitch.ENDCARD_DIR), "<endcard>") for c in cmd] == want["two_clips_and_a_still/roll-up"]


def test_an_in_point_seeks_the_input_and_reads_the_slot():
    cmd = cmd_for([{"path": "/t/a.mp4", "trimS": 2.5, "inS": 1.25}])
    i = cmd.index("/t/a.mp4")
    assert cmd[i - 5:i + 1] == ["-ss", "1.25", "-t", "2.5", "-i", "/t/a.mp4"]
    assert "tpad=stop_mode=clone:stop_duration=2.5,trim=duration=2.5" in graph(cmd)


def test_an_out_point_before_the_slot_end_is_held_from_there():
    cmd = cmd_for([{"path": "/t/a.mp4", "trimS": 3, "inS": 1, "outS": 2.5}])
    i = cmd.index("/t/a.mp4")
    assert cmd[i - 5:i + 1] == ["-ss", "1", "-t", "1.5", "-i", "/t/a.mp4"]  # never a frame past outS
    assert "stop_duration=3,trim=duration=3" in graph(cmd)  # held to the slot


def test_an_out_point_alone_sets_the_slot():
    cmd = cmd_for([{"path": "/t/a.mp4", "inS": 0.5, "outS": 2.5}])
    i = cmd.index("/t/a.mp4")
    assert cmd[i - 5:i + 1] == ["-ss", "0.5", "-t", "2", "-i", "/t/a.mp4"]


@pytest.mark.parametrize("kind,name", [("dissolve", "fade"), ("dip", "fadeblack")])
def test_a_transition_borrows_the_outgoing_clips_handle(kind, name):
    clips = [{"path": "/t/a.mp4", "trimS": 2.5}, {"path": "/t/b.mp4", "trimS": 3, "transition": {"kind": kind, "s": 0.5}},
             {"path": "/t/c.mp4", "trimS": 2}]
    cmd = cmd_for(clips)
    a = cmd.index("/t/a.mp4")
    assert cmd[a - 3:a - 1] == ["-t", "3"]  # 2.5 s slot + its 0.5 s out-handle
    g = graph(cmd)
    assert "stop_duration=3,trim=duration=3,setpts=PTS-STARTPTS,fps=24[v0]" in g
    assert f"[v0][v1]xfade=transition={name}:duration=0.5:offset=2.5[x1]" in g
    assert "[x1][v2][card]concat=n=3:v=1:a=0[out]" in g


def test_transitions_chain_and_cuts_split_the_pieces():
    clips = [{"path": "/t/a.mp4", "trimS": 2}, {"path": "/t/b.mp4", "trimS": 2, "transition": {"kind": "dissolve"}},
             {"path": "/t/c.mp4", "trimS": 2, "transition": {"kind": "dip", "s": 1}},
             {"path": "/t/d.mp4", "trimS": 2}]
    g = graph(cmd_for(clips))
    # a (2 + 0.5 handle), b (2 + 1 handle): b starts at 2, c at 4
    assert "[v0][v1]xfade=transition=fade:duration=0.5:offset=2[x1]" in g
    assert "[x1][v2]xfade=transition=fadeblack:duration=1:offset=4[x2]" in g
    assert "[x2][v3][card]concat=n=3:v=1:a=0[out]" in g


def test_a_transition_is_whole_frames_and_no_longer_than_the_incoming_slot():
    assert stitch.joins([{"trimS": 2}, {"trimS": 0.25, "transition": {"kind": "dissolve", "s": 1}}]) == [("cut", 0.0), ("dissolve", 0.25)]
    assert stitch.joins([{"trimS": 2}, {"trimS": 2, "transition": {"kind": "dip", "s": 0.51}}])[1] == ("dip", 12 / 24)
    assert stitch.joins([{"trimS": 2}, {"trimS": 9, "transition": {"kind": "dip", "s": 5}}])[1] == ("dip", stitch.MAX_TRANSITION_S)
    # An unknown kind, the first clip's transition, and a clip of unknown length all join with a cut.
    assert stitch.joins([{"trimS": 2, "transition": {"kind": "dissolve"}}, {"trimS": 2, "transition": {"kind": "wipe"}}]) == [("cut", 0.0)] * 2
    assert stitch.joins([{"path": "x"}, {"trimS": 2, "transition": {"kind": "dissolve"}}])[1] == ("cut", 0.0)


def test_a_still_lends_its_handle_by_looping_longer():
    cmd = cmd_for([{"path": "/t/a.png", "still": True, "trimS": 2}, {"path": "/t/b.png", "still": True, "trimS": 2,
                                                                       "transition": {"kind": "dissolve"}}])
    a = cmd.index("/t/a.png")
    assert cmd[a - 7:a] == ["-loop", "1", "-framerate", "24", "-t", "2.5", "-i"]


# ── real ffmpeg ───────────────────────────────────────────────────────────────

def make(path: Path, src: str, seconds: float, size: str = "320x568", rate: int = 30) -> Path:
    subprocess.run(["ffmpeg", "-loglevel", "error", "-y", "-f", "lavfi", "-i", f"{src}=s={size}:r={rate}", "-t", str(seconds),
                    "-pix_fmt", "yuv420p", str(path)], check=True)
    return path


def render(tmp_path: Path, clips: list[dict], job: str = "job_a") -> tuple[dict, dict]:
    store: dict = {}
    res = stitch.run({"jobId": job, "clips": clips, "outKey": "ads/x.mp4", "resultKey": "ads/x.json"},
                     get=lambda key, dest: shutil.copy(tmp_path / key, dest),
                     put=lambda key, p, mime: store.__setitem__(key, Path(p).read_bytes()),
                     put_json=lambda key, d: store.__setitem__(key, d), ffmpeg="ffmpeg", ffprobe="ffprobe")
    return res, store


def frames_of(data: bytes, tmp_path: Path) -> int:
    f = tmp_path / "probe.mp4"
    f.write_bytes(data)
    r = subprocess.run(["ffprobe", "-v", "error", "-count_frames", "-select_streams", "v:0", "-show_entries",
                        "stream=nb_read_frames", "-of", "csv=p=0", str(f)], capture_output=True, text=True, check=True)
    return int(r.stdout.strip())


@pytest.fixture
def media(tmp_path):
    make(tmp_path / "a.mp4", "testsrc", 6)
    make(tmp_path / "b.mp4", "testsrc2", 6)
    make(tmp_path / "c.mp4", "mandelbrot", 3)
    make(tmp_path / "short.mp4", "testsrc2", 1)  # no handle: held
    subprocess.run(["ffmpeg", "-loglevel", "error", "-y", "-f", "lavfi", "-i", "color=c=red:s=320x568", "-frames:v", "1",
                    str(tmp_path / "still.png")], check=True)
    return tmp_path


SHOTS = [2.5, 3, 2]


@needs_ffmpeg
@pytest.mark.parametrize("kind", ["cut", "dissolve", "dip"])
def test_every_transition_keeps_the_ad_as_long_as_its_shots(media, kind):
    clips = [{"key": "a.mp4", "trimS": SHOTS[0]},
             {"key": "b.mp4", "trimS": SHOTS[1], "inS": 1, "transition": {"kind": kind, "s": 0.5}},
             {"key": "short.mp4", "trimS": SHOTS[2], "transition": {"kind": kind, "s": 0.5}}]
    res, store = render(media, clips)
    assert res["ok"], res
    want = sum(SHOTS) + stitch.CARD_S
    assert abs(res["durationS"] - want) <= 1 / stitch.FPS + 1e-6, (res["durationS"], want)
    assert frames_of(store["ads/x.mp4"], media) == round(want * stitch.FPS)
    assert [s["kind"] for s in res["seams"]] == [kind, kind]
    assert [s["at_s"] for s in res["seams"]] == [2.5, 5.5]


@needs_ffmpeg
def test_in_and_out_windows_pick_the_frames(media, tmp_path):
    # testsrc's counter: the frame at 3 s of a.mp4 shows "3". Cut a 1 s window from 3 s and compare it
    # with the source's own frame there.
    res, store = render(media, [{"key": "a.mp4", "trimS": 1, "inS": 3, "outS": 5}])
    assert res["ok"] and abs(res["durationS"] - (1 + stitch.CARD_S)) <= 0.05, res
    ad = tmp_path / "ad.mp4"
    ad.write_bytes(store["ads/x.mp4"])

    def grab(path, at):
        return subprocess.run(["ffmpeg", "-loglevel", "error", "-ss", str(at), "-i", str(path), "-frames:v", "1",
                               "-vf", "scale=32:56", "-f", "rawvideo", "-pix_fmt", "gray", "-"],
                              capture_output=True, check=True).stdout

    def diff(x, y):
        return sum(abs(p - q) for p, q in zip(x, y)) / len(x)

    first = grab(ad, 0)
    assert diff(first, grab(media / "a.mp4", 3)) < diff(first, grab(media / "a.mp4", 0))
    # An out point before the slot's end holds its last frame: the slot is kept, nothing past outS shows.
    res, _ = render(media, [{"key": "a.mp4", "trimS": 2, "inS": 1, "outS": 1.5}, {"key": "b.mp4", "trimS": 1}])
    assert res["ok"] and abs(res["durationS"] - (3 + stitch.CARD_S)) <= 0.05, res


@needs_ffmpeg
@pytest.mark.parametrize("kind", ["cut", "dissolve"])
def test_png_clips_join_like_videos(media, kind):
    clips = [{"key": "still.png", "trimS": 2}, {"key": "a.mp4", "trimS": 2, "transition": {"kind": kind}},
             {"key": "still.png", "trimS": 1.5, "transition": {"kind": kind}}]
    res, _ = render(media, clips)
    assert res["ok"], res
    assert abs(res["durationS"] - (5.5 + stitch.CARD_S)) <= 1 / stitch.FPS + 1e-6


@needs_ffmpeg
def test_seam_scores_tell_a_jump_from_a_continuous_join(media):
    # a.mp4 cut at 2.5 s and picked up again on the next frame: continuous. Then a hard cut to another
    # picture: a jump.
    clips = [{"key": "a.mp4", "trimS": 2.5}, {"key": "a.mp4", "trimS": 1.5, "inS": 2.5}, {"key": "c.mp4", "trimS": 2}]
    res, _ = render(media, clips)
    assert res["ok"], res
    continuous, jump = res["seams"]
    assert (continuous["at_s"], jump["at_s"]) == (2.5, 4.0)
    assert continuous["score"] >= 0.95, res["seams"]
    assert jump["score"] < 0.85, res["seams"]
    assert continuous["colour"] <= 0.01 and jump["colour"] > continuous["colour"], res["seams"]
    assert set(continuous) == {"at_s", "kind", "score", "colour"}  # scores only: no flag


@needs_ffmpeg
def test_a_dissolve_between_unlike_shots_still_scores_as_a_jump(media):
    res, _ = render(media, [{"key": "a.mp4", "trimS": 2}, {"key": "c.mp4", "trimS": 2, "transition": {"kind": "dissolve"}}])
    assert res["ok"] and res["seams"][0]["score"] < 0.85, res


@needs_ffmpeg
def test_one_clip_has_no_seams(media):
    res, _ = render(media, [{"key": "a.mp4", "trimS": 1}])
    assert res["ok"] and "seams" not in res


@needs_ffmpeg
def test_a_request_with_no_in_points_renders_byte_for_byte_as_before(media):
    old = [{"key": "a.mp4", "trimS": 2}, {"key": "b.mp4", "trimS": 1.5}, {"key": "still.png", "trimS": 1}]
    new = [{"key": "a.mp4", "trimS": 2, "inS": 0}, {"key": "b.mp4", "trimS": 1.5, "transition": {"kind": "cut"}},
           {"key": "still.png", "trimS": 1, "inS": 0, "transition": {"kind": "cut", "s": 0.5}}]
    a, sa = render(media, old)
    b, sb = render(media, new)
    assert a["ok"] and b["ok"]
    assert a["sha256"] == b["sha256"] == "sha256:" + hashlib.sha256(sa["ads/x.mp4"]).hexdigest()
    assert sa["ads/x.mp4"] == sb["ads/x.mp4"]


# ── cut mode on a picture (the mock's take with no ffmpeg) ───────────────────

@needs_ffmpeg
def test_cut_mode_reads_a_png_take(media):
    store: dict = {}
    event = {"jobId": "job_p", "mode": "cut", "key": "still.png", "resultKey": "cut.json",
             "stills": [{"atS": 0, "key": "s0.png"}, {"atS": 3.958, "key": "s1.png"}],
             "clip": {"fromS": 1, "toS": 2.5, "outKey": "cut.mp4"}}
    res = stitch.run(event, get=lambda key, dest: shutil.copy(media / key, dest),
                     put=lambda key, p, mime: store.__setitem__(key, (Path(p).read_bytes(), mime)),
                     put_json=lambda key, d: store.__setitem__(key, d), ffmpeg="ffmpeg", ffprobe="ffprobe")
    assert res["ok"], res
    assert (res["still"], res["takeS"], res["w"], res["h"]) == (True, 0.0, 320, 568)
    # Every still is the picture, whatever its time.
    assert store["s0.png"] == store["s1.png"] and store["s0.png"][1] == "image/png"
    assert store["s0.png"][0][:8] == b"\x89PNG\r\n\x1a\n"
    # The clip is the picture held for the cut's length.
    assert res["clip"]["durationS"] == 1.5 and store["cut.mp4"][1] == "video/mp4"
    assert frames_of(store["cut.mp4"][0], media) == 36
    assert store["cut.json"] == res
