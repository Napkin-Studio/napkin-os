#!/usr/bin/env python3
"""Live check of Fix this moment (features/clip-moment-edit.clan): one real range send on Aleph 2, spliced
back with the real stitch splice. A person runs this; agents never do (it spends real Runway credits,
about $0.28 a second of the window, at least 2 s: $0.56 for a 2 s window).

A DRY RUN by default: it reads the take, prints the plan (the send, the range, the keyframe, the billed
seconds and the estimate from the sheet) and sends nothing. Pass --live to spend; --max-usd (default 2)
is a hard cap. The key is read only from RUNWAYML_API_SECRET:

    set -a; source .env; set +a      # this script never opens .env
    cd production-tool/relay
    uv run python scripts/live_check_clip_patch.py --take take.mp4 --window 2-4 --at 3 \\
        --text "her eyes should open here" [--video-url https://.../take.mp4] [--live]

The take goes as --video-url when given (https, the same file as --take), else it is uploaded to
Runway's ephemeral store (free, 24 h). Exactly the relay's provider job is sent: clip_edit on aleph2,
the whole take as `current`, the frame at --at as the keyframe, the window as its range. With --live it
writes, under --out (default ./clip_patch_check): aleph.mp4 (Runway's whole take), out.mp4 (the window
spliced into the take), and report.json. Paste the last lines into the feature log:

    scripts/feature log clip-moment-edit "live check: <the summary line>"

What to look at in out.mp4: the window changed as asked, nothing changed outside it, both seams (Jude's
scores in the report), and the take's sound as it was (Aleph keeps its input audio).
"""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import os
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
RELAY = HERE.parent
sys.path.insert(0, str(RELAY))
sys.path.insert(0, str(RELAY.parent / "stitch"))

import time_rules  # noqa: E402
from runway_common import (  # noqa: E402
    KEY_ENV, Assets, Budget, Runner, Tap, default_factory, ephemeral_upload, fetch_bytes, is_https, key_status,
    make_client,
)
from contracts_dir import pricing
from providers import ProviderJob, load_sheet  # noqa: E402

PROMPT_TAIL = "Everything else stays exactly as it is: the people, the place, the light and the camera."


def parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--take", required=True, help="the take, a local mp4 (read for its length and the keyframe)")
    p.add_argument("--window", required=True, help="whole seconds of take time, a-b (at least 2 s)")
    p.add_argument("--at", type=float, required=True, help="the note's moment in take time, inside the window")
    p.add_argument("--text", required=True, help="the note")
    p.add_argument("--video-url", help="the same take at a public https URL (else it is uploaded to Runway)")
    p.add_argument("--live", action="store_true", help="spend money: really call Runway")
    p.add_argument("--max-usd", type=float, default=2.0, help="hard cap on spend (default %(default)s)")
    p.add_argument("--out", default="clip_patch_check", help="where the outputs go (default %(default)s)")
    return p


def window_of(text: str) -> dict:
    a, _, b = text.partition("-")
    w = {"from_s": int(a), "to_s": int(b)}
    if w["to_s"] - w["from_s"] < time_rules.MIN_WINDOW_S:
        raise SystemExit(f"--window {text}: a fix needs at least {time_rules.MIN_WINDOW_S} s")
    return w


def tools() -> tuple[str, str]:
    ffmpeg, ffprobe = shutil.which("ffmpeg"), shutil.which("ffprobe")
    if not ffmpeg or not ffprobe:
        raise SystemExit("needs ffmpeg and ffprobe on PATH")
    return ffmpeg, ffprobe


def plan_for(take_s: float, window: dict, at: float) -> tuple[dict, float]:
    """The relay's plan (time_rules.patch_plan, range send) and its estimate from the sheet."""
    if not window["from_s"] <= at <= window["to_s"] or window["to_s"] > take_s + 1e-6:
        raise SystemExit(f"--at {at:g} must be inside the window, and the window inside the {take_s:g} s take")
    plan = time_rules.patch_plan(window, at, take_s)
    sheet = load_sheet("runway")
    billed = max(sheet["ops"]["clip_patch"].get("minS", 0), math.ceil(plan["seconds"] - 1e-9))
    return plan, pricing().op_usd(sheet, "clip_patch", None, {"inputS": billed})


def local_io(root: Path):
    def get(key: str, path: str) -> None:
        shutil.copyfile(root / key, path)

    def put(key: str, path: str, _mime: str) -> None:
        (root / key).parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(path, root / key)

    return get, put


def has_audio(ffprobe: str, path: Path) -> bool:
    out = subprocess.run([ffprobe, "-v", "error", "-select_streams", "a", "-show_entries", "stream=index", "-of", "csv=p=0",
                          str(path)], capture_output=True, text=True, check=True).stdout
    return bool(out.strip())


def main(argv=None) -> int:
    args = parser().parse_args(argv)
    import splice as stitch  # stitch/splice.py: the relay's own cut and splice

    ffmpeg, ffprobe = tools()
    take = Path(args.take).resolve()
    window = window_of(args.window)
    take_s = round(stitch.probe(ffprobe, str(take))["durationS"], 3)
    plan, est = plan_for(take_s, window, args.at)
    print(f"take {take.name}: {take_s:g} s; send {plan['send']}; window {window['from_s']}-{window['to_s']} s")
    if plan["send"] != "range":
        print(f"  the take is over {time_rules.MAX_INPUT_S} s, so the relay would cut it; this check is for the range send")
        return 2
    print(f"  keyframe: the frame at {plan['keyframeS']:g} s, range {plan['range']['start_s']}-{plan['range']['end_s']} s")
    print(f"  billed seconds {plan['seconds']:g}, estimate ${est:.2f} (cap ${args.max_usd:.2f})")
    print(f"  key {KEY_ENV}: {key_status(os.environ)}")
    if args.video_url and not is_https(args.video_url):
        raise SystemExit("--video-url must be https (Runway fetches it)")
    if not args.live:
        print("dry run: nothing sent. Add --live to spend.")
        return 0
    key = os.environ.get(KEY_ENV)
    if not key:
        raise SystemExit(f"--live needs {KEY_ENV} in the environment")

    out = Path(args.out).resolve()
    out.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory() as scratch:
        root, work = Path(scratch) / "store", Path(scratch) / "work"  # the relay's S3, and stitch's /tmp
        root.mkdir(), work.mkdir()
        tmp = str(work)
        (root / "take.mp4").write_bytes(take.read_bytes())
        get, put = local_io(root)
        cut = stitch.cut({"jobId": "check", "mode": "cut", "key": "take.mp4", "stills": [{"atS": plan["keyframeS"], "key": "still.png"}]},
                         get=get, put=put, ffmpeg=ffmpeg, ffprobe=ffprobe, tmp=tmp)
        still = (root / "still.png").read_bytes()

        assets, tap = Assets(), Tap()
        client = make_client(tap)
        if args.video_url:
            video_sha = assets.add_url(args.video_url, "video/mp4")
        else:
            data = take.read_bytes()
            video_sha = assets.add_uploaded(data, "video/mp4", ephemeral_upload(client, key, data, "video/mp4", "take.mp4"))
        still_sha = assets.add_uploaded(still, "image/png", ephemeral_upload(client, key, still, "image/png", "still.png"))
        sheet = load_sheet("runway")
        spec = sheet["ops"]["clip_patch"]
        job = ProviderJob.from_director("clip_edit", {
            "provider": "runway", "model": spec["model"], "prompt": f"{args.text.rstrip('.')}. {PROMPT_TAIL}",
            "refs": [{"sha256": video_sha, "name": "current", "role": "current"}], "audio": False,
            "keyframe": {"sha256": still_sha, "atS": plan["keyframeS"],
                         "startS": plan["range"]["start_s"], "endS": plan["range"]["end_s"]},
        })
        runner = Runner(default_factory(key, assets, tap, sheet), Budget(args.max_usd), tap=tap)
        rec = runner.run("clip_patch range send", job, est=est)
        report = {"take": take.name, "takeS": take_s, "window": window, "atS": args.at, "plan": plan, "reservedUsd": est,
                  "stillFrame": cut["stills"][0], "runway": rec}
        if rec.get("state") != "completed" or not rec.get("outputs"):
            (out / "report.json").write_text(json.dumps(report, indent=1) + "\n")
            print(f"summary: aleph2 range send {rec.get('state')}: {json.dumps(rec.get('error') or rec.get('reason'))}; "
                  f"cost {rec.get('cost_usd')}")
            return 1
        (root / "aleph.mp4").write_bytes(fetch_bytes(rec["outputs"][0]))
        shutil.copyfile(root / "aleph.mp4", out / "aleph.mp4")
        spliced = stitch.splice({"jobId": "check", "mode": "splice", "parentKey": "take.mp4", "patchKey": "aleph.mp4",
                                 "cutFromS": 0, "windowFromS": window["from_s"], "windowToS": window["to_s"],
                                 "crossfadeS": 0.25, "seamMin": 0.85, "outKey": "out.mp4"},
                                get=get, put=put, ffmpeg=ffmpeg, ffprobe=ffprobe, tmp=tmp)
        shutil.copyfile(root / "out.mp4", out / "out.mp4")
        aleph = stitch.probe(ffprobe, str(root / "aleph.mp4"))
        report.update(aleph={"w": aleph["w"], "h": aleph["h"], "durationS": round(aleph["durationS"], 3),
                             "audio": has_audio(ffprobe, root / "aleph.mp4")},
                      splice=spliced, outAudio=has_audio(ffprobe, root / "out.mp4"), takeAudio=has_audio(ffprobe, take),
                      outSha256="sha256:" + hashlib.sha256((root / "out.mp4").read_bytes()).hexdigest())
    (out / "report.json").write_text(json.dumps(report, indent=1) + "\n")
    seams = ", ".join(f"{s['at_s']:g}s {s['score']:.2f}{'' if s['ok'] else ' LOW'}" for s in spliced["seams"])
    print(f"summary: aleph2 range send completed in {rec['latency_s']} s, cost ${rec.get('cost_usd')} (estimate ${est:.2f}); "
          f"Aleph returned {report['aleph']['durationS']:g} s at {report['aleph']['w']}x{report['aleph']['h']}, "
          f"audio {'kept' if report['aleph']['audio'] else 'dropped'}; splice exact={spliced['exact']}, seams {seams}")
    print(f"outputs in {out}: aleph.mp4, out.mp4, report.json. Watch out.mp4 before logging.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
