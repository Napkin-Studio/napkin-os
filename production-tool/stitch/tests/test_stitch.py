import glob
import json
import shutil
import subprocess
from pathlib import Path

import pytest

import stitch


def test_target_size_is_even_and_capped():
    assert stitch.target_size(1080, 1920) == (720, 1280)
    assert stitch.target_size(1281, 721) == (1280, 720)
    assert stitch.target_size(641, 481) == (640, 480)


def test_command_normalises_trims_and_appends_card():
    clips = [{"path": "/t/a.mp4", "trimS": 4.5}, {"path": "/t/b.mp4"}]
    cmd = stitch.build_command("ffmpeg", clips, (720, 1280), "/t/card.txt", "/t/ev.txt", "/f.ttf", "/t/out.mp4")
    # trim goes before its own input only
    assert cmd[cmd.index("/t/a.mp4") - 3:cmd.index("/t/a.mp4") + 1] == ["-t", "4.5", "-i", "/t/a.mp4"]
    assert cmd[cmd.index("/t/b.mp4") - 1] == "-i" and cmd[cmd.index("/t/b.mp4") - 2] != "4.5"
    # the 1 s card is a lavfi colour source at the same size and fps
    i = cmd.index("color=c=black:s=720x1280:r=24")
    assert cmd[i - 5:i] == ["-f", "lavfi", "-t", "1", "-i"]
    graph = cmd[cmd.index("-filter_complex") + 1]
    assert graph.count("scale=720:1280:force_original_aspect_ratio=decrease") == 2
    assert graph.count("fps=24") == 2
    assert "textfile=/t/card.txt:expansion=none" in graph and "textfile=/t/ev.txt:expansion=none" in graph
    assert "[v0][v1][card]concat=n=3:v=1:a=0[out]" in graph
    assert "-an" in cmd and cmd[-1] == "/t/out.mp4"
    assert "+faststart" in cmd


def test_failure_writes_an_error_result(tmp_path):
    results = {}

    def get(key, dest):
        raise FileNotFoundError(key)

    out = stitch.run({"jobId": "job_x", "clips": [{"key": "out/x"}], "eventName": "E",
                      "outKey": "ads/x.mp4", "resultKey": "ads/x.json"},
                     get=get, put=lambda *a: None, put_json=lambda k, d: results.__setitem__(k, d),
                     ffmpeg="ffmpeg", ffprobe="ffprobe")
    assert out["ok"] is False and "FileNotFoundError" in out["error"]
    assert results["ads/x.json"] == out


FONTS = sorted(glob.glob("/usr/share/fonts/**/DejaVuSans*.ttf", recursive=True)
               + glob.glob("/usr/share/fonts/**/*.ttf", recursive=True))


@pytest.mark.skipif(not (shutil.which("ffmpeg") and shutil.which("ffprobe") and FONTS),
                    reason="needs ffmpeg, ffprobe and a TTF font")
def test_real_ffmpeg_stitch(tmp_path):
    src = tmp_path / "src"
    src.mkdir()
    for name, size in (("a", "320x568"), ("b", "480x480")):
        subprocess.run(["ffmpeg", "-loglevel", "error", "-f", "lavfi", "-i", f"testsrc=d=2:s={size}:r=30",
                        "-pix_fmt", "yuv420p", str(src / f"{name}.mp4")], check=True)
    store = {}
    res = stitch.run(
        {"jobId": "job_x", "clips": [{"key": "a.mp4", "trimS": 1}, {"key": "b.mp4"}], "eventName": "Napkin 'Hack': 100%",
         "outKey": "ads/x.mp4", "resultKey": "ads/x.json"},
        get=lambda key, dest: shutil.copy(src / key, dest),
        put=lambda key, p, mime: store.__setitem__(key, Path(p).read_bytes()),
        put_json=lambda key, d: store.__setitem__(key, json.dumps(d)),
        ffmpeg="ffmpeg", ffprobe="ffprobe", font=FONTS[0])
    assert res["ok"], res
    assert (res["w"], res["h"]) == (320, 568)
    assert 3.8 <= res["durationS"] <= 4.3  # 1 s + 2 s + 1 s card
    assert res["sha256"].startswith("sha256:") and len(store["ads/x.mp4"]) == res["bytes"]
