import json
import shutil
import subprocess
from pathlib import Path

import pytest

import stitch

HAVE_FFMPEG = bool(shutil.which("ffmpeg") and shutil.which("ffprobe"))
needs_ffmpeg = pytest.mark.skipif(not HAVE_FFMPEG, reason="needs ffmpeg and ffprobe")


def test_target_size_is_even_and_capped():
    assert stitch.target_size(1080, 1920) == (720, 1280)
    assert stitch.target_size(1281, 721) == (1280, 720)
    assert stitch.target_size(641, 481) == (640, 480)


# ── the pick ──────────────────────────────────────────────────────────────────

def test_card_version_is_fixed_per_job():
    # sha256(jobId)[0] even → roll-up (white), odd → roll-up-ink.
    assert stitch.card_version("job_sample0") == "roll-up-ink"
    assert stitch.card_version("job_sample1") == "roll-up"
    for j in ("job_a", "job_01K6XB000000000000000000R1", ""):
        assert stitch.card_version(j) == stitch.card_version(j)
        assert stitch.card_version(j) in stitch.VERSIONS


def test_card_version_splits_jobs_evenly():
    picks = [stitch.card_version(f"job_{i:05d}") for i in range(1000)]
    white = picks.count("roll-up")
    assert 400 <= white <= 600, white


# ── the curves ────────────────────────────────────────────────────────────────

def bezier(x1, y1, x2, y2):
    def bz(s, a, b):
        return 3 * a * s * (1 - s) ** 2 + 3 * b * s * s * (1 - s) + s ** 3

    def f(p):
        lo, hi = 0.0, 1.0
        for _ in range(60):
            m = (lo + hi) / 2
            lo, hi = (m, hi) if bz(m, x1, x2) < p else (lo, m)
        return bz((lo + hi) / 2, y1, y2)
    return f


@pytest.mark.parametrize("coef,curve", [
    (stitch.ROLL_EASE, (.33, 0, .2, 1)),
    (stitch.POP_EASE, (.3, 1.4, .5, 1)),
    (stitch.STUDIO_EASE, (.2, .8, .2, 1)),
])
def test_ease_polynomials_follow_their_bezier(coef, curve):
    f = bezier(*curve)
    assert stitch.ease(coef, 0) == pytest.approx(0, abs=1e-9)
    assert stitch.ease(coef, 1) == pytest.approx(1, abs=1e-5)
    assert max(abs(stitch.ease(coef, i / 400) - f(i / 400)) for i in range(401)) < 0.006


def test_the_roll_never_runs_backwards_or_overshoots():
    e = [stitch.ease(stitch.ROLL_EASE, i / 4000) for i in range(4001)]
    assert all(b >= a for a, b in zip(e, e[1:]))
    assert max(e) <= 1 + 1e-9


def test_ease_expr_is_the_same_polynomial():
    expr = stitch.ease_expr((1.0, -0.5, 0.5), 0.1, 2)
    assert expr.startswith("(st(0,clip((t-0.1)/2,0,1));ld(0)*(")
    assert expr.count("ld(0)") == 3


# ── the layout ────────────────────────────────────────────────────────────────

SIZES = [(720, 1280), (1280, 720), (1080, 1080), (864, 1080), (1280, 426), (640, 480)]


@pytest.mark.parametrize("version", stitch.VERSIONS)
def test_every_version_has_its_pieces(version):
    a = stitch.load_assets(version)
    assert set(a) == {"mark", "made", "word", *(f"fig-{k}" for k in stitch.CREW)}
    assert a["mark"]["w"] == a["mark"]["h"]


@pytest.mark.parametrize("size", SIZES)
def test_layout_fits_every_ratio_and_the_portrait_safe_area(size):
    w, h = size
    L = stitch.card_layout(w, h, stitch.load_assets("roll-up"))
    assert L["lock_w"] + 2 * stitch.LINE_OUT * L["s"] <= 0.88 * w
    made_top = L["made"][1]
    assert 0 < made_top and L["line_y"] < h
    if h > w:  # 9:16 platform UI: keep out of the top 14 % and the bottom 35 %
        assert made_top >= 0.14 * h and L["line_y"] <= 0.65 * h
    xs = [f["x"] for f in L["figs"]]
    assert xs == sorted(xs) and xs[0] == pytest.approx(L["xl"])
    assert xs[-1] + L["figs"][-1]["w"] == pytest.approx(L["xl"] + L["lock_w"], abs=0.01)


def test_agents_appear_as_the_disc_passes_them():
    # The examples (scratchpad/endcard/8-roll-up-reveals-crew, solved in the browser
    # from the same bezier) at 720x1280: Ellis 1160 … Jude 250 ms.
    L = stitch.card_layout(720, 1280, stitch.load_assets("roll-up"))
    got = [round(f["at"] * 1000) for f in L["figs"]]
    for g, want in zip(got, [1160, 802, 629, 510, 405, 250]):
        assert abs(g - want) <= 25, got
    assert [f["agent"] for f in L["figs"]] == list(stitch.CREW)
    # Right to left, and all of them before the disc lands.
    assert got == sorted(got, reverse=True)
    assert max(got) < (stitch.ROLL_AT + stitch.ROLL_S) * 1000


# ── the command ───────────────────────────────────────────────────────────────

def test_command_normalises_trims_and_carries_no_studio_card():
    clips = [{"path": "/t/a.mp4", "trimS": 4.5}, {"path": "/t/b.mp4"}]
    cmd = stitch.build_command("ffmpeg", clips, (720, 1280), "/t/out.mp4")
    # trim goes before its own input only
    assert cmd[cmd.index("/t/a.mp4") - 3:cmd.index("/t/a.mp4") + 1] == ["-t", "4.5", "-i", "/t/a.mp4"]
    assert cmd[cmd.index("/t/b.mp4") - 1] == "-i" and cmd[cmd.index("/t/b.mp4") - 2] != "4.5"
    graph = cmd[cmd.index("-filter_complex") + 1]
    assert graph.count("scale=720:1280:force_original_aspect_ratio=decrease") == 2
    # A client ad never carries the studio card (owner 2026-11-23): two clips, one concat, no card, no card pieces.
    assert "[v0][v1]concat=n=2:v=1:a=0[out]" in graph
    assert "[card]" not in graph and "overlay=" not in graph and "color=c=" not in " ".join(cmd)
    assert "-an" in cmd and cmd[-1] == "/t/out.mp4"
    assert "+faststart" in cmd


def test_no_event_line_is_drawn():
    cmd = stitch.build_command("ffmpeg", [{"path": "/t/a.mp4"}], (720, 1280), "/t/o.mp4")
    joined = " ".join(cmd)
    assert "drawtext" not in joined and "textfile" not in joined


def test_failure_writes_an_error_result():
    results = {}

    def get(key, dest):
        raise FileNotFoundError(key)

    out = stitch.run({"jobId": "job_x", "clips": [{"key": "out/x"}],
                      "outKey": "ads/x.mp4", "resultKey": "ads/x.json"},
                     get=get, put=lambda *a: None, put_json=lambda k, d: results.__setitem__(k, d),
                     ffmpeg="ffmpeg", ffprobe="ffprobe")
    assert out["ok"] is False and "FileNotFoundError" in out["error"]
    assert results["ads/x.json"] == out


# ── real ffmpeg ───────────────────────────────────────────────────────────────

def _stitch(tmp_path, job, specs, trims):
    src = tmp_path / "src"
    src.mkdir(exist_ok=True)
    for name, size, d in specs:
        subprocess.run(["ffmpeg", "-loglevel", "error", "-f", "lavfi", "-i", f"testsrc=d={d}:s={size}:r=30",
                        "-pix_fmt", "yuv420p", str(src / f"{name}.mp4")], check=True)
    store = {}
    res = stitch.run(
        {"jobId": job, "clips": [{"key": f"{n}.mp4", **({"trimS": t} if t else {})} for (n, _, _), t in zip(specs, trims)],
         "outKey": "ads/x.mp4", "resultKey": "ads/x.json"},
        get=lambda key, dest: shutil.copy(src / key, dest),
        put=lambda key, p, mime: store.__setitem__(key, Path(p).read_bytes()),
        put_json=lambda key, d: store.__setitem__(key, json.dumps(d)),
        ffmpeg="ffmpeg", ffprobe="ffprobe")
    return res, store


@needs_ffmpeg
def test_real_ffmpeg_stitch(tmp_path):
    res, store = _stitch(tmp_path, "job_x", [("a", "320x568", 2), ("b", "480x480", 2)], [1, None])
    assert res["ok"], res
    assert (res["w"], res["h"]) == (320, 568)
    assert 2.9 <= res["durationS"] <= 3.1  # 1 s + 2 s: no studio card after them (owner 2026-11-23)
    assert res["sha256"].startswith("sha256:") and len(store["ads/x.mp4"]) == res["bytes"]
    assert "endCard" not in json.loads(store["ads/x.json"])


@needs_ffmpeg
def test_clips_longer_than_their_shots_are_cut_to_the_shots(tmp_path):
    # The FACET ad (2026-10-07): veo3.1_fast clips come back at 4, 6 or 8 s, and untrimmed
    # 15 s of shots made a 21 s ad. With trimS = each shot's duration_s, the ad is the sum of the shots.
    res, _ = _stitch(tmp_path, "job_t", [("a", "360x640", 4), ("b", "360x640", 6), ("c", "360x640", 8)], [3, 2, 4])
    assert res["ok"], res
    assert abs(res["durationS"] - (3 + 2 + 4)) <= 0.15
