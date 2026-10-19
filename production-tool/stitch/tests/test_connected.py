"""Joined shots (features/connected-video.clan, phases A and B), on real ffmpeg: a take's cuts found near
the prompt's times, windows of one take, fit "speed" keeping the ad's length (and trimming past 1.33x), and
the shared frame of a continue join shown once. Old requests render as before (test_assembly.py)."""

from __future__ import annotations

import json
import shutil
import subprocess
from pathlib import Path

import pytest

import splice
import stitch
from test_assembly import cmd_for, frames_of, graph, needs_ffmpeg, render

FPS = stitch.FPS


def ff(*args: str) -> None:
    subprocess.run(["ffmpeg", "-loglevel", "error", "-y", *args], check=True)


def take(path: Path, parts: list[tuple[str, float]]) -> Path:
    """A synthetic take: each (lavfi source, seconds) one shot, joined by hard cuts, at 24 fps."""
    args, labels = [], []
    for i, (src, seconds) in enumerate(parts):
        args += ["-f", "lavfi", "-i", f"{src}{':' if '=' in src else '='}s=320x180:r={FPS}"]
        labels.append(f"[{i}:v]trim=duration={seconds},setpts=PTS-STARTPTS,format=yuv420p[s{i}]")
    graph_ = ";".join(labels) + ";" + "".join(f"[s{i}]" for i in range(len(parts))) + f"concat=n={len(parts)}:v=1:a=0[v]"
    ff(*args, "-filter_complex", graph_, "-map", "[v]", "-c:v", "libx264", "-preset", "veryfast", str(path))
    return path


def solid(path: Path, colours: list[tuple[str, int]]) -> Path:
    """A 24 fps clip of solid frames: each (colour, frames) in turn."""
    args, labels = [], []
    for i, (c, n) in enumerate(colours):
        args += ["-f", "lavfi", "-i", f"color=c={c}:s=160x90:r={FPS}"]
        labels.append(f"[{i}:v]trim=end_frame={n},setpts=PTS-STARTPTS,format=yuv420p[s{i}]")
    graph_ = ";".join(labels) + ";" + "".join(f"[s{i}]" for i in range(len(colours))) + f"concat=n={len(colours)}:v=1:a=0[v]"
    ff(*args, "-filter_complex", graph_, "-map", "[v]", "-c:v", "libx264", "-preset", "veryfast", "-crf", "10", str(path))
    return path


def reds(data: bytes, tmp_path: Path) -> list[int]:
    """The indices of the frames that are mostly red."""
    f = tmp_path / "reds.mp4"
    f.write_bytes(data)
    return [i for i, (r, g, b) in enumerate(stitch._colour_means("ffmpeg", str(f))) if r > 180 and g < 80 and b < 80]


# ── take_cuts ─────────────────────────────────────────────────────────────────

FOUR_CUTS = [("testsrc2", 2), ("smptebars", 2.5), ("mandelbrot", 1.5), ("rgbtestsrc", 2), ("color=c=0x3060a0", 2)]


@needs_ffmpeg
def test_take_cuts_finds_each_cut_within_a_tenth_of_its_planned_time(tmp_path):
    take(tmp_path / "take.mp4", FOUR_CUTS)  # cuts at 2, 4.5, 6 and 8 s
    store: dict = {}
    planned = [2.07, 4.43, 6.09, 7.92, 9.0]  # the prompt's times, off as a model is; nothing happens at 9 s
    res = stitch.run({"jobId": "j", "mode": "take_cuts", "key": "take.mp4", "cuts": planned, "searchS": 0.1,
                      "threshold": 0.10, "resultKey": "cuts.json"},
                     get=lambda key, dest: shutil.copy(tmp_path / key, dest), put=lambda *a: None,
                     put_json=lambda key, d: store.__setitem__(key, d), ffmpeg="ffmpeg", ffprobe="ffprobe")
    assert res["ok"] and store["cuts.json"] == res
    assert [c["planned_s"] for c in res["cuts"]] == planned
    found = [c["found_s"] for c in res["cuts"]]
    assert found[-1] is None  # no scene change near 9 s: the relay keeps the planned time
    for want, got in zip([2, 4.5, 6, 8], found):
        assert got is not None and abs(got - want) <= 0.1 + 1e-6, (want, got)
    assert res["takeS"] == 10.0 and res["fps"] == 24.0


def test_find_cuts_takes_the_strongest_change_in_reach_and_uses_each_once():
    scores = [(1.0, 0.05), (2.0, 0.6), (2.04, 0.9), (2.5, 0.95), (4.0, 0.3)]
    assert splice.find_cuts(scores, [2.0, 2.1, 4.2], 0.1) == [2.04, 2.0, None]
    assert splice.find_cuts(scores, [1.0], 0.5, threshold=0.10) == [None]  # 0.05 is under the threshold


@needs_ffmpeg
def test_take_cuts_on_an_unreadable_take_fails_cleanly(tmp_path):
    (tmp_path / "bad.mp4").write_bytes(b"not a video")
    store: dict = {}
    res = stitch.run({"jobId": "j", "mode": "take_cuts", "key": "bad.mp4", "cuts": [2], "searchS": 0.1, "resultKey": "c.json"},
                     get=lambda key, dest: shutil.copy(tmp_path / key, dest), put=lambda *a: None,
                     put_json=lambda key, d: store.__setitem__(key, d), ffmpeg="ffmpeg", ffprobe="ffprobe")
    assert res == {"ok": False, "error": "Could not find the take's cuts."} and store["c.json"] == res


# ── windows of one take ──────────────────────────────────────────────────────

@needs_ffmpeg
def test_windows_of_one_take_are_its_shots_in_order_and_it_is_fetched_once(tmp_path):
    take(tmp_path / "take.mp4", FOUR_CUTS[:3])  # shots at 0-2, 2-4.5, 4.5-6
    fetched: list[str] = []
    store: dict = {}
    clips = [{"key": "take.mp4", "trimS": 2, "inS": 0, "outS": 2}, {"key": "take.mp4", "trimS": 2.5, "inS": 2, "outS": 4.5},
             {"key": "take.mp4", "trimS": 1.5, "inS": 4.5, "outS": 6}]

    def get(key, dest):
        fetched.append(key)
        shutil.copy(tmp_path / key, dest)

    res = stitch.run({"jobId": "j", "clips": clips, "outKey": "ad.mp4", "resultKey": "ad.json"}, get=get,
                     put=lambda key, p, mime: store.__setitem__(key, Path(p).read_bytes()),
                     put_json=lambda key, d: store.__setitem__(key, d), ffmpeg="ffmpeg", ffprobe="ffprobe")
    assert res["ok"], res
    assert fetched == ["take.mp4"]
    assert frames_of(store["ad.mp4"], tmp_path) == round((6 + stitch.CARD_S) * FPS)
    # Each window joins the next where the take itself cut: the seams sit at the take's cuts.
    assert [s["at_s"] for s in res["seams"]] == [2.0, 4.5]


# ── fit: speed ────────────────────────────────────────────────────────────────

def test_fit_speed_retimes_the_whole_window_into_the_slot():
    clips = [{"path": "/t/a.mp4", "trimS": 3.2, "fit": "speed"}, {"path": "/t/b.mp4", "trimS": 2}]
    stitch.fit_windows(clips, [{"durationS": 4.0}, {"durationS": 4.0}])  # Veo's 4 s for a 3.2 s shot
    assert clips[0]["speed"] == pytest.approx(1.25)
    assert "fit" not in clips[0] and clips[1] == {"path": "/t/b.mp4", "trimS": 2}
    cmd = cmd_for(clips)
    a = cmd.index("/t/a.mp4")
    assert cmd[a - 3:a - 1] == ["-t", "4"]  # the whole window, not the slot
    assert "setsar=1,setpts=(PTS-STARTPTS)/1.250000,fps=24" in graph(cmd)
    assert "stop_duration=3.2,trim=duration=3.2" in graph(cmd)  # and it fills its slot exactly


def test_fit_speed_past_the_cap_or_with_no_slot_is_trimmed_and_logged(capsys):
    clips = [{"path": "/t/a.mp4", "trimS": 2.5, "fit": "speed"}, {"path": "/t/b.mp4", "fit": "speed"}]
    stitch.fit_windows(clips, [{"durationS": 4.0}, {"durationS": 4.0}], "job_x")  # 4 s into 2.5 s is 1.6x
    assert "speed" not in clips[0] and "speed" not in clips[1]
    logged = [json.loads(line) for line in capsys.readouterr().out.splitlines()]
    assert [(e["kind"], e["clip"]) for e in logged] == [("stitch_fit_fallback", 0), ("stitch_fit_fallback", 1)]
    assert "past 1.33" in logged[0]["why"] and logged[1]["why"] == "no slot"
    assert "setpts=(PTS-STARTPTS)/" not in graph(cmd_for(clips))


@needs_ffmpeg
def test_fit_speed_keeps_the_ad_as_long_as_the_plan_and_shows_the_landing_frame(tmp_path):
    # A Veo-like 4 s clip for a 3.2 s shot, landing on red: trimmed, the red would be lost; retimed, it shows.
    solid(tmp_path / "landing.mp4", [("blue", 95), ("red", 1)])
    solid(tmp_path / "next.mp4", [("green", 48)])
    trimmed, st = render(tmp_path, [{"key": "landing.mp4", "trimS": 3.2}, {"key": "next.mp4", "trimS": 2}])
    sped, ss = render(tmp_path, [{"key": "landing.mp4", "trimS": 3.2, "fit": "speed"}, {"key": "next.mp4", "trimS": 2}])
    for res, store in ((trimmed, st), (sped, ss)):
        assert res["ok"], res
        assert frames_of(store["ads/x.mp4"], tmp_path) == round((5.2 + stitch.CARD_S) * FPS)
    assert reds(st["ads/x.mp4"], tmp_path) == []
    assert reds(ss["ads/x.mp4"], tmp_path) == [round(3.2 * FPS) - 1]  # the slot's last frame is the landing frame


# ── the shared frame at a continue join ──────────────────────────────────────

def test_a_continue_join_ends_the_outgoing_window_one_frame_early():
    clips = [{"path": "/t/a.mp4", "trimS": 1, "inS": 0, "outS": 25 / 24, "fit": "speed"},
             {"path": "/t/b.mp4", "trimS": 1, "transition": {"kind": "continue"}}]
    stitch.fit_windows(clips, [{"durationS": 25 / 24}, {"durationS": 1.0}])
    assert clips[0]["outS"] == pytest.approx(1.0) and clips[0]["speed"] == pytest.approx(1.0)
    assert stitch.joins(clips) == [("cut", 0.0), ("cut", 0.0)]  # a cut for the graph: the frame went above


@needs_ffmpeg
def test_the_shared_frame_shows_once_and_the_ad_keeps_its_length(tmp_path):
    # Clip a lands on red (its 25th frame); clip b starts on that same red frame.
    solid(tmp_path / "a.mp4", [("blue", 24), ("red", 1)])
    solid(tmp_path / "b.mp4", [("red", 1), ("green", 23)])
    joined = [{"key": "a.mp4", "trimS": 1, "fit": "speed"}, {"key": "b.mp4", "trimS": 1, "transition": {"kind": "continue"}}]
    res, store = render(tmp_path, joined)
    assert res["ok"], res
    assert frames_of(store["ads/x.mp4"], tmp_path) == round((2 + stitch.CARD_S) * FPS)
    assert reds(store["ads/x.mp4"], tmp_path) == [24]  # once, as b's first frame
    assert res["seams"][0]["kind"] == "cut" and res["seams"][0]["at_s"] == 1.0
