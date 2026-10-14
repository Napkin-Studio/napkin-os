"""Fix this moment's stitch modes on real ffmpeg (features/clip-moment-edit.clan): the cut is frame
accurate, the splice copies every GOP away from the window packet for packet, re-encodes only the
margin to its keyframes (PSNR >= 50), puts the new frames and both crossfades inside the window,
conforms a patch of another size, rate and length, copies the audio untouched, decodes cleanly, and
falls back to one whole-take encode when the take cannot be joined. An event with no mode still builds
exactly the ad's command."""

from __future__ import annotations

import json
import re
import shutil
import subprocess
from pathlib import Path

import pytest

import splice
import stitch

HAVE_FFMPEG = bool(shutil.which("ffmpeg") and shutil.which("ffprobe"))
pytestmark = pytest.mark.skipif(not HAVE_FFMPEG, reason="needs ffmpeg and ffprobe")
HERE = Path(__file__).resolve().parent
FPS = 24
GOP = 36  # keyframes at 0, 1.5, 3, 4.5 s: a window at 2-4 s has a margin each side


def ff(*args: str) -> str:
    r = subprocess.run(["ffmpeg", "-hide_banner", "-loglevel", "error", "-y", *args], capture_output=True, text=True)
    assert r.returncode == 0, r.stderr
    return r.stdout


def make_take(path: Path, *, gop: int = GOP, codec: str = "libx264", audio: bool = True, size: str = "320x180",
              rate: int = FPS, seconds: float = 6) -> Path:
    args = ["-f", "lavfi", "-i", f"testsrc=size={size}:rate={rate}:duration={seconds}"]
    if audio:
        args += ["-f", "lavfi", "-i", f"sine=frequency=440:duration={seconds}"]
    args += ["-c:v", codec]
    if codec == "libx264":
        args += ["-preset", "veryfast", "-crf", "18", "-pix_fmt", "yuv420p", "-g", str(gop), "-keyint_min", str(gop),
                 "-sc_threshold", "0"]
    else:
        args += ["-q:v", "3", "-g", str(gop)]
    if audio:
        args += ["-c:a", "aac", "-shortest"]
    ff(*args, str(path))
    return path


class Store:
    """The Lambda's S3 as a folder: keys are file names."""

    def __init__(self, root: Path):
        self.root = root
        self.results: dict[str, dict] = {}

    def get(self, key, dest):
        shutil.copy(self.root / key, dest)

    def put(self, key, src, mime):
        shutil.copy(src, self.root / key)

    def put_json(self, key, data):
        self.results[key] = data

    def run(self, event: dict) -> dict:
        return stitch.run(event, get=self.get, put=self.put, put_json=self.put_json, ffmpeg="ffmpeg", ffprobe="ffprobe")


def decoded(path: Path) -> list[str]:
    out = ff("-i", str(path), "-map", "0:v:0", "-f", "framemd5", "-")
    return [x.rsplit(",", 1)[1].strip() for x in out.splitlines() if x and not x.startswith("#")]


def packets(path: Path, stream: str = "v:0") -> list[tuple[str, str]]:
    """(flags-free md5, size) of each packet as stored, stream copied."""
    out = ff("-i", str(path), "-map", f"0:{stream}", "-c", "copy", "-f", "framemd5", "-")
    return [(x.rsplit(",", 1)[1].strip(), x.split(",")[4].strip()) for x in out.splitlines() if x and not x.startswith("#")]


def psnr(a: Path, b: Path, start: int, end: int, tmp: Path) -> list[float]:
    """Per-frame PSNR (dB; inf for identical) of frames [start, end) of a against b."""
    stats = tmp / f"psnr-{start}-{end}.log"
    ff("-i", str(a), "-i", str(b), "-filter_complex",
       f"[0:v]trim=start_frame={start}:end_frame={end},setpts=PTS-STARTPTS[x];"
       f"[1:v]trim=start_frame={start}:end_frame={end},setpts=PTS-STARTPTS[y];[x][y]psnr=stats_file={stats}",
       "-f", "null", "-")
    vals = []
    for line in stats.read_text().splitlines():
        m = re.search(r"psnr_avg:(\S+)", line)
        vals.append(float("inf") if m.group(1) == "inf" else float(m.group(1)))
    return vals


@pytest.fixture(scope="module")
def media(tmp_path_factory) -> Store:
    root = tmp_path_factory.mktemp("media")
    make_take(root / "parent.mp4")
    return Store(root)


def cut_event(**over) -> dict:
    return {"jobId": "job_t", "mode": "cut", "key": "parent.mp4", "fromS": 2, "toS": 4, "stillAtS": 3.2,
            "outKey": "cut.mp4", "stillKey": "still.png", "resultKey": "cut.json", **over}


def splice_event(patch: str, **over) -> dict:
    return {"jobId": "job_t", "mode": "splice", "parentKey": "parent.mp4", "patchKey": patch, "cutFromS": 2,
            "windowFromS": 2, "windowToS": 4, "crossfadeS": 0.25, "outKey": f"out-{patch}", "resultKey": f"{patch}.json",
            **over}


def patch_from_cut(media: Store, name: str, vf: str, extra: tuple[str, ...] = ()) -> str:
    """What a model might return for the cut: the cut through a filter."""
    if not (media.root / "cut.mp4").exists():
        media.run(cut_event())
    ff("-i", str(media.root / "cut.mp4"), "-vf", vf, *extra, "-c:v", "libx264", "-crf", "16", "-pix_fmt", "yuv420p",
       str(media.root / name))
    return name


# ── cut ─────────────────────────────────────────────────────────────────────

def test_cut_is_frame_accurate_and_grabs_the_still(media, tmp_path):
    res = media.run(cut_event())
    assert res["ok"] and media.results["cut.json"] == res
    assert (res["w"], res["h"], res["fps"], res["durationS"]) == (320, 180, 24.0, 2.0)
    assert res["sha256"].startswith("sha256:") and res["still"]["sha256"].startswith("sha256:")
    cut, parent = media.root / "cut.mp4", media.root / "parent.mp4"
    assert len(decoded(cut)) == 2 * FPS
    # The cut's first and last frames are the take's 48 and 95 (the testsrc counter moves every frame).
    ff("-i", str(parent), "-vf", "trim=start_frame=47:end_frame=50,setpts=PTS-STARTPTS", "-c:v", "libx264", "-crf", "0",
       str(tmp_path / "around.mp4"))
    first = [psnr(cut, tmp_path / "around.mp4", 0, 1, tmp_path)[0]]
    for shift in (1, 2):  # the cut's frame 0 against the take's 48 (around[1]) and its neighbours
        ff("-i", str(tmp_path / "around.mp4"), "-vf", f"trim=start_frame={shift}:end_frame={shift + 1},setpts=PTS-STARTPTS",
           "-c:v", "libx264", "-crf", "0", str(tmp_path / f"n{shift}.mp4"))
        first.append(psnr(cut, tmp_path / f"n{shift}.mp4", 0, 1, tmp_path)[0])
    assert first.index(max(first)) == 1, first
    # The still is a lossless PNG of the frame at 3.2 s (the take's frame 77, the first at or after it).
    still = media.root / "still.png"
    assert still.read_bytes()[:8] == b"\x89PNG\r\n\x1a\n"
    ff("-i", str(parent), "-vf", "trim=start_frame=77:end_frame=78", "-frames:v", "1", str(tmp_path / "f77.png"))
    assert still.read_bytes() == (tmp_path / "f77.png").read_bytes()


def test_a_cut_past_the_take_fails_with_words_not_ffmpeg(media):
    res = media.run(cut_event(fromS=5, toS=4, resultKey="bad.json"))
    assert res == {"ok": False, "error": "Could not cut the moment out of the take."}


# ── splice ──────────────────────────────────────────────────────────────────

@pytest.fixture(scope="module")
def recoloured(media) -> tuple[dict, Path]:
    name = patch_from_cut(media, "neg.mp4", "negate")
    res = media.run(splice_event(name))
    return res, media.root / f"out-{name}"


def test_splice_keeps_the_take_whole_and_exact(media, recoloured):
    res, out = recoloured
    assert res["ok"] and res["exact"] is True
    assert (res["w"], res["h"], res["fps"], res["durationS"]) == (320, 180, 24.0, 6.0)
    assert res["sha256"].startswith("sha256:") and res["bytes"] == out.stat().st_size
    parent = media.root / "parent.mp4"
    assert len(decoded(out)) == len(decoded(parent)) == 6 * FPS
    assert splice._decodes("ffmpeg", str(out))


def test_gops_away_from_the_window_are_the_takes_packets(media, recoloured):
    _, out = recoloured
    parent = media.root / "parent.mp4"
    got, want = packets(out), packets(parent)
    # [0, 1.5 s) and [4.5, 6 s) never touch [2, 4): copied, packet for packet.
    assert got[:GOP] == want[:GOP]
    assert got[3 * GOP:] == want[3 * GOP:]
    assert decoded(out)[:GOP] == decoded(parent)[:GOP] and decoded(out)[3 * GOP:] == decoded(parent)[3 * GOP:]


def test_the_margin_is_encoded_once_and_looks_the_same(media, recoloured, tmp_path):
    _, out = recoloured
    parent = media.root / "parent.mp4"
    for s, e in ((GOP, 48), (96, 3 * GOP)):  # [1.5, 2) and [4, 4.5): between a keyframe and the window
        assert min(psnr(out, parent, s, e, tmp_path)) >= 50


def test_the_new_frames_and_both_crossfades_sit_inside_the_window(media, recoloured, tmp_path):
    _, out = recoloured
    parent = media.root / "parent.mp4"
    inside = psnr(out, parent, 48, 96, tmp_path)
    cf = 6  # 0.25 s at 24 fps
    assert inside[0] >= 40  # the window's first frame is still the take's (the fade starts there)
    assert max(inside[cf:-cf]) < 20  # between the fades: the patch, nothing of the take
    assert inside[cf // 2] < inside[0] and inside[-cf // 2] < inside[-1] + 100  # fading
    assert psnr(out, parent, 47, 48, tmp_path)[0] >= 50 and psnr(out, parent, 96, 97, tmp_path)[0] >= 40


def test_a_matched_patch_scores_its_seams_and_a_bad_one_fails(media, recoloured):
    res, _ = recoloured
    assert [s["at_s"] for s in res["seams"]] == [2.0, 4.0]
    assert all(not s["ok"] and s["score"] < 0.85 for s in res["seams"]), res["seams"]
    good = media.run(splice_event(patch_from_cut(media, "same.mp4", "null")))
    assert all(s["ok"] and s["score"] >= 0.95 for s in good["seams"]), good["seams"]
    shifted = media.run(splice_event(patch_from_cut(media, "shift.mp4", "crop=300:170:20:10,scale=320:180"), crossfadeS=0))
    assert all(not s["ok"] for s in shifted["seams"]), shifted["seams"]


def test_the_audio_is_copied_untouched(media, recoloured):
    _, out = recoloured
    assert packets(out, "a:0") == packets(media.root / "parent.mp4", "a:0")


def test_a_patch_of_another_size_rate_and_length_is_conformed(media):
    # 30 fps, 400x300 and 0.3 s short of the cut: still a 6 s, 24 fps, 320x180 take.
    name = patch_from_cut(media, "odd.mp4", "scale=400:300,fps=30", ("-t", "1.7"))
    res = media.run(splice_event(name))
    assert res["ok"] and res["exact"]
    assert (res["w"], res["h"], res["fps"], res["durationS"]) == (320, 180, 24.0, 6.0)
    assert len(decoded(media.root / f"out-{name}")) == 6 * FPS


def test_a_window_at_the_takes_start_copies_the_rest(media, tmp_path):
    # [0, 2): the span is the first GOP and the next; the copied tail's keyframes carry the take's
    # parameter sets in band (they grow by those bytes), every other packet and every picture after 3 s
    # is the take's.
    ev = cut_event(fromS=0, toS=2, outKey="cut0.mp4", stillAtS=None, resultKey="cut0.json")
    assert media.run(ev)["ok"]
    ff("-i", str(media.root / "cut0.mp4"), "-vf", "negate", "-c:v", "libx264", "-crf", "16", str(media.root / "neg0.mp4"))
    res = media.run(splice_event("neg0.mp4", cutFromS=0, windowFromS=0, windowToS=2))
    out, parent = media.root / "out-neg0.mp4", media.root / "parent.mp4"
    assert res["ok"] and res["exact"]
    assert decoded(out)[2 * GOP:] == decoded(parent)[2 * GOP:]
    got, want = packets(out)[2 * GOP:], packets(parent)[2 * GOP:]
    keys = {0, GOP}  # the keyframes at 3 and 4.5 s
    assert [g for i, g in enumerate(got) if i not in keys] == [w for i, w in enumerate(want) if i not in keys]
    assert all(int(got[i][1]) > int(want[i][1]) for i in keys)
    assert [s["at_s"] for s in res["seams"]] == [2.0]  # no seam at the take's start


def test_a_take_that_cannot_be_joined_is_encoded_whole(tmp_path):
    store = Store(tmp_path)
    make_take(tmp_path / "parent.mp4", codec="mpeg4")
    assert store.run(cut_event())["ok"]
    ff("-i", str(tmp_path / "cut.mp4"), "-vf", "negate", "-c:v", "libx264", "-crf", "16", str(tmp_path / "neg.mp4"))
    res = store.run(splice_event("neg.mp4"))
    assert res["ok"] and res["exact"] is False
    assert (res["w"], res["h"], res["durationS"]) == (320, 180, 6.0)
    assert len(decoded(tmp_path / "out-neg.mp4")) == 6 * FPS
    assert min(psnr(tmp_path / "out-neg.mp4", tmp_path / "parent.mp4", 0, 40, tmp_path)) >= 30


def test_a_take_without_audio_splices(tmp_path):
    store = Store(tmp_path)
    make_take(tmp_path / "parent.mp4", audio=False, gop=24)
    assert store.run(cut_event())["ok"]
    ff("-i", str(tmp_path / "cut.mp4"), "-vf", "negate", "-c:v", "libx264", "-crf", "16", str(tmp_path / "neg.mp4"))
    res = store.run(splice_event("neg.mp4"))
    assert res["ok"] and res["exact"]
    # 1 s GOPs and a whole-second window: the span is exactly the window, everything else is copied
    got, want = packets(tmp_path / "out-neg.mp4"), packets(tmp_path / "parent.mp4")
    assert got[:48] == want[:48] and got[96:] == want[96:]


def test_an_unknown_mode_fails_cleanly(media):
    res = media.run({"jobId": "j", "mode": "trim", "resultKey": "x.json"})
    assert res["ok"] is False and media.results["x.json"] == res


# ── the ad is unchanged ─────────────────────────────────────────────────────

def test_an_event_with_no_mode_builds_the_same_ad_command():
    """tests/snapshots/ad_command.json was written from stitch.py before the modes were added."""
    want = json.loads((HERE / "snapshots" / "ad_command.json").read_text())
    cases = {
        "two_clips_and_a_still": [{"path": "/tmp/c0.mp4", "trimS": 4.5}, {"path": "/tmp/c1.mp4"},
                                  {"path": "/tmp/c2.png", "still": True, "trimS": 3}],
        "one_clip": [{"path": "/tmp/c0.mp4"}],
    }
    for name, clips in cases.items():
        for version in stitch.VERSIONS:
            cmd = stitch.build_command("ffmpeg", clips, (1280, 720), version, stitch.load_assets(version), "/tmp/ad.mp4")
            assert [c.replace(str(stitch.ENDCARD_DIR), "<endcard>") for c in cmd] == want[f"{name}/{version}"]
