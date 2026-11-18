"""Jude's seam check, evaluated offline on synthetic takes (features/clip-moment-edit.clan).

    uv run --python 3.12 python eval/seam_eval.py [--out report.json]

Each case cuts a testsrc take's window, makes a "model output" from the cut (unchanged, shifted,
recoloured), splices it back with splice.py and checks the seam scores against seamMin: a matched patch
passes and a shifted or recoloured one fails. A chain of 5 patches over overlapping windows checks that
the re-encoded margin stays at PSNR >= 50 dB against the original take, and that the GOPs away from
every window are still the original's packets. tests/test_seam_eval.py runs this in CI's stitch pytest.

The live eval (real Aleph 2 output, billed) is a person's run: relay/scripts/live_check_clip_patch.sh.
"""

from __future__ import annotations

import argparse
import json
import re
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent))
import splice  # noqa: E402

FPS, GOP = 24, 36
PSNR_MIN = 50.0
CASES = (  # (name, filter making the model output from the cut, crossfade s, seams should pass)
    ("matched", "null", 0.25, True),
    ("matched_hard_cut", "null", 0.0, True),
    ("shifted", "crop=300:170:20:10,scale=320:180", 0.0, False),
    ("shifted_faded", "crop=280:160:40:20,scale=320:180", 0.25, False),
    ("recoloured", "negate", 0.25, False),
    ("recoloured_hard_cut", "hue=h=180:s=2", 0.0, False),
)
CHAIN = ((2, 4), (3, 5), (1, 3), (2, 4), (3, 5))  # whole-second windows, each patched over the last


def _ff(*args: str) -> str:
    r = subprocess.run(["ffmpeg", "-hide_banner", "-loglevel", "error", "-y", *args], capture_output=True, text=True)
    if r.returncode:
        raise RuntimeError(r.stderr[-500:])
    return r.stdout


def _take(path: Path) -> None:
    _ff("-f", "lavfi", "-i", f"testsrc=size=320x180:rate={FPS}:duration=6", "-c:v", "libx264", "-preset", "veryfast",
        "-crf", "18", "-pix_fmt", "yuv420p", "-g", str(GOP), "-keyint_min", str(GOP), "-sc_threshold", "0", str(path))


class _Folder:
    def __init__(self, root: Path):
        self.root, self.results = root, {}

    def run(self, event: dict) -> dict:
        return splice.run(event, get=lambda k, d: shutil.copy(self.root / k, d), put=lambda k, s, m: shutil.copy(s, self.root / k),
                          put_json=lambda k, v: self.results.__setitem__(k, v), ffmpeg="ffmpeg", ffprobe="ffprobe")


def _patch(f: _Folder, parent: str, window: tuple[int, int], vf: str, name: str) -> str:
    a, b = window
    cut = f.run({"jobId": name, "mode": "cut", "key": parent, "clip": {"fromS": a, "toS": b, "outKey": f"{name}-cut.mp4"},
                 "resultKey": "c.json"})
    if not cut["ok"]:
        raise RuntimeError(cut["error"])
    _ff("-i", str(f.root / f"{name}-cut.mp4"), "-vf", vf, "-c:v", "libx264", "-crf", "16", "-pix_fmt", "yuv420p",
        str(f.root / f"{name}-patch.mp4"))
    return f"{name}-patch.mp4"


def _min_psnr(a: Path, b: Path, ranges: list[tuple[int, int]], tmp: Path) -> float:
    worst = float("inf")
    for s, e in ranges:
        if e <= s:
            continue
        stats = tmp / "psnr.log"
        _ff("-i", str(a), "-i", str(b), "-filter_complex",
            f"[0:v]trim=start_frame={s}:end_frame={e},setpts=PTS-STARTPTS[x];"
            f"[1:v]trim=start_frame={s}:end_frame={e},setpts=PTS-STARTPTS[y];[x][y]psnr=stats_file={stats}", "-f", "null", "-")
        for m in re.finditer(r"psnr_avg:(\S+)", stats.read_text()):
            worst = min(worst, float("inf") if m.group(1) == "inf" else float(m.group(1)))
    return worst


def evaluate(seam_min: float = splice.SEAM_MIN) -> dict:
    """{cases: [...], chain: {...}, ok}: every case's seams on the right side of seam_min, and the chain's
    margin at PSNR >= 50 with its far GOPs untouched."""
    report: dict = {"seamMin": seam_min, "cases": []}
    with tempfile.TemporaryDirectory() as tmp:
        root = Path(tmp)
        f = _Folder(root)
        _take(root / "take.mp4")
        for name, vf, cf, should in CASES:
            patch = _patch(f, "take.mp4", (2, 4), vf, name)
            res = f.run({"jobId": name, "mode": "splice", "parentKey": "take.mp4", "patchKey": patch, "cutFromS": 2,
                         "windowFromS": 2, "windowToS": 4, "crossfadeS": cf, "seamMin": seam_min,
                         "outKey": f"{name}-out.mp4", "resultKey": "s.json"})
            passed = bool(res.get("ok")) and all(s["ok"] for s in res["seams"]) and len(res["seams"]) == 2
            report["cases"].append({"name": name, "crossfadeS": cf, "seams": res.get("seams"), "exact": res.get("exact"),
                                    "want": "pass" if should else "fail", "right": passed == should})
        # Five patches in a row, each on the last one's output, as Fix again does (v3 -> v4 -> ...).
        parent = "take.mp4"
        touched: set[int] = set()
        for i, (a, b) in enumerate(CHAIN):
            patch = _patch(f, parent, (a, b), "null", f"chain{i}")
            res = f.run({"jobId": f"chain{i}", "mode": "splice", "parentKey": parent, "patchKey": patch, "cutFromS": a,
                         "windowFromS": a, "windowToS": b, "crossfadeS": 0.25, "outKey": f"chain{i}-out.mp4",
                         "resultKey": "s.json"})
            if not res.get("ok"):
                raise RuntimeError(res.get("error"))
            parent = f"chain{i}-out.mp4"
            lo = max(k for k in (0, GOP, 2 * GOP, 3 * GOP) if k <= a * FPS)
            hi = min([k for k in (GOP, 2 * GOP, 3 * GOP) if k >= b * FPS] or [6 * FPS])
            touched |= set(range(lo, hi))
        # The margin: re-encoded frames outside every window (the windows' own frames are the patches').
        windows = {i for a, b in CHAIN for i in range(a * FPS, b * FPS)}
        margin = sorted(touched - windows)
        runs, start = [], None
        for i in range(6 * FPS + 1):
            if i in margin and start is None:
                start = i
            if i not in margin and start is not None:
                runs.append((start, i))
                start = None
        far = [(0, min(touched)), (max(touched) + 1, 6 * FPS)]
        report["chain"] = {"patches": len(CHAIN), "marginFrames": len(margin),
                           "marginPsnrMin": _min_psnr(root / parent, root / "take.mp4", runs, root),
                           "farPsnrMin": _min_psnr(root / parent, root / "take.mp4", far, root)}
    c = report["chain"]
    report["ok"] = all(x["right"] for x in report["cases"]) and c["marginPsnrMin"] >= PSNR_MIN and c["farPsnrMin"] == float("inf")
    return report


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--out", help="write the report here as JSON")
    ap.add_argument("--seam-min", type=float, default=splice.SEAM_MIN)
    args = ap.parse_args()
    report = evaluate(args.seam_min)
    text = json.dumps(report, indent=1, default=str)
    print(text)
    if args.out:
        Path(args.out).write_text(text)
    return 0 if report["ok"] else 1


if __name__ == "__main__":
    sys.exit(main())
