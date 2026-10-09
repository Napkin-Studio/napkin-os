"""The Video stage test (2026-10-09, features/video-stage-findings.clan): the mock's still clips made
an ad of only the end card, a clip shorter than its shot left the ad short, and a broken clip showed
ffmpeg's text with temp paths instead of naming the shot."""

import json
import shutil
import subprocess
from pathlib import Path

import stitch
from test_stitch import needs_ffmpeg


def _run(tmp_path, files: dict[str, bytes], clips: list[dict], job="job_f"):
    src = tmp_path / "src"
    src.mkdir(exist_ok=True)
    for name, data in files.items():
        (src / name).write_bytes(data)
    store = {}
    res = stitch.run(
        {"jobId": job, "clips": clips, "eventName": "", "outKey": "ads/x.mp4", "resultKey": "ads/x.json"},
        get=lambda key, dest: shutil.copy(src / key, dest),
        put=lambda key, p, mime: store.__setitem__(key, Path(p).read_bytes()),
        put_json=lambda key, d: store.__setitem__(key, json.dumps(d)),
        ffmpeg="ffmpeg", ffprobe="ffprobe")
    return res, store


def _make(tmp_path, name: str, args: list[str]) -> bytes:
    out = tmp_path / name
    subprocess.run(["ffmpeg", "-loglevel", "error", "-y", *args, str(out)], check=True)
    return out.read_bytes()


def test_a_still_is_looped_and_a_short_clip_held_in_the_command():
    a = stitch.load_assets("roll-up")
    clips = [{"path": "/t/a.png", "trimS": 3, "still": True}, {"path": "/t/b.png", "still": True},
             {"path": "/t/c.mp4", "trimS": 4}]
    cmd = stitch.build_command("ffmpeg", clips, (1280, 720), "roll-up", a, "/t/o.mp4")
    i = cmd.index("/t/a.png")
    assert cmd[i - 7:i + 1] == ["-loop", "1", "-framerate", "24", "-t", "3", "-i", "/t/a.png"]
    j = cmd.index("/t/b.png")
    assert cmd[j - 3:j] == ["-t", "5", "-i"]  # no trimS: STILL_S
    graph = cmd[cmd.index("-filter_complex") + 1]
    assert graph.count("tpad=stop_mode=clone") == 1  # the video only: a still is already as long as its shot
    assert "tpad=stop_mode=clone:stop_duration=4,trim=duration=4,setpts=PTS-STARTPTS[v2]" in graph


def test_pictures_are_told_apart_from_videos(tmp_path):
    png, jpg, mp4 = tmp_path / "a", tmp_path / "b", tmp_path / "c"
    png.write_bytes(b"\x89PNG\r\n\x1a\n" + b"\0" * 8)
    jpg.write_bytes(b"\xff\xd8\xff\xe0" + b"\0" * 8)
    mp4.write_bytes(b"\0\0\0\x18ftypmp42" + b"\0" * 4)
    assert (stitch.still_ext(str(png)), stitch.still_ext(str(jpg)), stitch.still_ext(str(mp4))) == (".png", ".jpg", None)


@needs_ffmpeg
def test_a_clip_that_cannot_be_read_names_its_shot(tmp_path):
    clip = _make(tmp_path, "real.mp4", ["-f", "lavfi", "-i", "testsrc=d=1:s=320x240:r=24", "-pix_fmt", "yuv420p"])
    res, store = _run(tmp_path, {"a.mp4": clip, "b.mp4": b"garbage"}, [{"key": "a.mp4"}, {"key": "b.mp4"}])
    assert res["ok"] is False and res["code"] == "bad_clip" and res["clip"] == 1
    assert json.loads(store["ads/x.json"]) == res
    assert res["error"] == "Shot 2's clip could not be read. Make it again, then render."
    assert "/tmp" not in res["error"]


@needs_ffmpeg
def test_mock_stills_make_an_ad_as_long_as_the_shots(tmp_path):
    png = _make(tmp_path, "still.png", ["-f", "lavfi", "-i", "color=c=red:s=320x568", "-frames:v", "1"])
    res, _ = _run(tmp_path, {"a.mp4": png, "b.mp4": png}, [{"key": "a.mp4", "trimS": 2}, {"key": "b.mp4", "trimS": 1.5}])
    assert res["ok"], res
    assert abs(res["durationS"] - (2 + 1.5 + stitch.CARD_S)) <= 0.15


@needs_ffmpeg
def test_a_clip_shorter_than_its_shot_is_held_to_the_shots_length(tmp_path):
    clip = _make(tmp_path, "short.mp4", ["-f", "lavfi", "-i", "testsrc=d=1:s=360x640:r=30", "-pix_fmt", "yuv420p"])
    res, _ = _run(tmp_path, {"a.mp4": clip}, [{"key": "a.mp4", "trimS": 3}])
    assert res["ok"], res
    assert abs(res["durationS"] - (3 + stitch.CARD_S)) <= 0.15
