#!/usr/bin/env python3
"""Runway smoke test: one real job per op, to see that each endpoint answers as the adapter expects.

A DRY RUN by default: it prints the plan and the estimated cost, and sends nothing.
Pass --live to spend money. --max-usd (default 15) is a hard cap: a job that would pass it is not submitted.

The key is read only from the environment variable RUNWAYML_API_SECRET. Load it first with

    set -a; source .env; set +a

(this script never opens .env) and it is printed only as "set (N chars)".

Step 0 is GET /v1/organization (free): the tier and each model's concurrency. --org-only
does just that, without --live.

Inputs, no redirects, with a Content-Type and Content-Length:
  --image-url   view, frame, region_edit (fetched once and sent as a data URI, so a local
                http URL will do); clip (its first frame: Runway rejects a data URI there, so it
                needs an https URL, else the op is 'blocked': nothing is submitted)
  --video-url   clip_edit (https mp4, 2-30 s; blocked if it is not https)
Exit status is non-zero if any op failed or was not run.
"""

from __future__ import annotations

import argparse
import os
import sys
import time
from typing import Callable, Optional

from runway_common import (
    CLIP_RATIO, DEFAULT_MAX_USD, FIRST_FRAME_NEEDS_HTTPS, IMAGE_RATIO, KEY_ENV, KEY_HELP, Assets, Budget,
    BudgetExceeded, Runner, Tap, default_factory, estimate_usd, fetch_bytes, image_ref, is_https, key_status,
    make_job, prepare_image, region_edit,
)
from providers import ProviderError, Ref, load_sheet

OPS = ("generate", "view", "frame", "region_edit", "clip", "clip_edit")
NEEDS = {"view": "image", "frame": "image", "region_edit": "image",
         "clip": "image", "clip_edit": "video"}
FLAG = {"image": "--image-url", "video": "--video-url"}
VIDEO_NEEDS_HTTPS = "needs an https video URL: Runway cannot fetch a local video for a clip edit"
BOX = {"x": 0.3, "y": 0.3, "w": 0.3, "h": 0.3}


def parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--live", action="store_true", help="spend money: really call Runway")
    p.add_argument("--org-only", action="store_true", help="only GET /v1/organization (free); no --live needed")
    p.add_argument("--ops", default=",".join(OPS), help="comma-separated subset of: " + ", ".join(OPS))
    p.add_argument("--image-url", help="public HTTPS image (a character or object)")
    p.add_argument("--video-url", help="public HTTPS mp4, 2-30 s, for clip_edit")
    p.add_argument("--max-usd", type=float, default=DEFAULT_MAX_USD, help="hard cap on spend (default %(default)s)")
    return p


def blocked_reason(op: str, urls: dict) -> Optional[str]:
    """Why an op cannot run with these URLs, or None. A URL that is not given is the 'needs' check's business."""
    if op == "clip" and urls.get("image") and not is_https(urls["image"]):
        return FIRST_FRAME_NEEDS_HTTPS
    if op == "clip_edit" and urls.get("video") and not is_https(urls["video"]):
        return VIDEO_NEEDS_HTTPS
    return None


def plan_lines(sheet: dict, ops: list[str], urls: dict) -> tuple[list[str], float]:
    lines, total = [], 0.0
    for op in ops:
        est, need = estimate_usd(sheet, op), NEEDS.get(op)
        note = ""
        if need and not urls.get(need):
            note = f"   needs {FLAG[need]}"
        if reason := blocked_reason(op, urls):
            est, note = 0.0, f"   BLOCKED: {reason}"
        total += est
        lines.append(f"  {op:<12} {sheet['ops'][op]['model']:<22} ~${est:.2f}{note}")
    return lines, total


def build_job(sheet: dict, op: str, assets: Assets, urls: dict, fetch: Callable[[str], bytes]):
    """The request for one op. Returns the job, or None for region_edit (its own pipeline)."""
    if op == "generate":
        return make_job(sheet, op, "A red fox sitting in a snowy forest, photo.", ratio=IMAGE_RATIO)
    if op == "clip_edit":
        sha = assets.add_url(urls["video"], "video/mp4")
        return make_job(sheet, op, "Make the lighting warmer, keep everything else the same.",
                        refs=[Ref(sha, "source", "source")])
    if op == "clip":  # an https URL, checked before this; a data URI is no first frame
        sha = assets.add_url(urls["image"], "image/png")
        return make_job(sheet, op, "She turns and smiles.", ratio=CLIP_RATIO, duration_s=4, first_frame=sha)
    sha = image_ref(assets, fetch, urls["image"])  # an image op takes the bytes inline
    if op == "view":
        return make_job(sheet, op, "@hero seen from the side, full body, plain background.", ratio=IMAGE_RATIO,
                        refs=[Ref(sha, "hero", "character")])
    if op == "frame":
        return make_job(sheet, op, "@hero walking through a doorway, cinematic still.", ratio=IMAGE_RATIO,
                        refs=[Ref(sha, "hero", "character")])
    return None


def run_op(op: str, runner: Runner, assets: Assets, urls: dict, fetch: Callable[[str], bytes]) -> dict:
    sheet = runner.sheet
    if reason := blocked_reason(op, urls):
        return {"label": op, "op": op, "state": "blocked", "reason": reason}
    try:
        job = build_job(sheet, op, assets, urls, fetch)
    except Exception as exc:  # an unreachable image is this op's failure, not the run's
        return {"label": op, "op": op, "state": "failed", "error": {"code": "input", "message": f"{type(exc).__name__}: {exc}"}}
    if job:
        return runner.run(op, job)
    try:
        png, ratio = prepare_image(fetch(urls["image"]))
        res = region_edit(runner, png, ratio, BOX, "Make whatever is inside the box a different colour.",
                          assets, fetch)
    except BudgetExceeded as exc:
        return {"label": op, "op": op, "state": "skipped", "reason": str(exc)}
    except ProviderError as exc:
        return {"label": op, "op": op, "state": "failed", "error": exc.to_dict()}
    # The provider answering is what the smoke test checks; whether the box held is the gate's business.
    return {"label": op, "op": op, "state": "done" if res.metrics else "failed",
            "inside_box_ok": res.ok, "reason": res.reason}


def show(rec: dict, out: Callable[[str], None]) -> None:
    cost = rec.get("cost_usd")
    line = (f"  {rec['label']:<12} {rec['state']:<8} {rec.get('latency_s', 0):>6.1f} s  "
            f"{'$%.2f' % cost if cost is not None else '$?':<6}")
    err = rec.get("error")
    if err:
        line += f"  {err['code']}: {err['message']}"
        if err["code"] == "moderated":
            line += " (moderated, not retried)"
    if rec.get("reason"):
        line += f"  {rec['reason']}"
    out(line)


def main(argv: Optional[list[str]] = None, env: Optional[dict] = None, out: Callable[[str], None] = print,
         factory=default_factory, fetch: Callable[[str], bytes] = fetch_bytes, **runtime) -> int:
    args = parser().parse_args(argv)
    env = os.environ if env is None else env
    ops = [o for o in args.ops.split(",") if o]
    if bad := [o for o in ops if o not in OPS]:
        out(f"unknown ops: {', '.join(bad)}")
        return 2
    sheet = load_sheet("runway")
    urls = {"image": args.image_url, "video": args.video_url}

    out(f"{KEY_ENV}: {key_status(env)}")
    lines, total = plan_lines(sheet, ops, urls)
    out("plan:")
    out("  step 0       GET /v1/organization   free")
    for line in lines:
        out(line)
    out(f"estimated cost: ${total:.2f}   cap: ${args.max_usd:.2f}   audio: off on every video")
    if not (args.live or args.org_only):
        out("dry run: nothing was sent. Add --live to spend, or --org-only for the free organization check.")
        return 0

    key = env.get(KEY_ENV)
    if not key:
        out(f"refusing to go live: {KEY_ENV} is missing. {KEY_HELP}")
        return 2
    if args.live and (missing := sorted({FLAG[NEEDS[o]] for o in ops if NEEDS.get(o) and not urls[NEEDS[o]]})):
        out(f"refusing to go live: these ops need {', '.join(missing)}")
        return 2

    assets, tap = Assets(), Tap(runtime.get("clock", time.monotonic))
    provider = factory(key, assets, tap)
    try:
        org = provider.organization()
    except ProviderError as exc:
        out(f"step 0 failed: {exc.code}: {exc.message}")
        return 1
    out(f"step 0: tier {org['tier'].get('maxMonthlyCreditSpend')} credits/month max, "
        f"{org.get('creditBalance')} credits left")
    for model, n in sorted(org["concurrency"].items()):
        out(f"  {model:<24} concurrency {n if n is not None else 'no limit'}")
    if not args.live:
        return 0

    runner = Runner(provider, Budget(args.max_usd), tap=tap, **runtime)
    failed = 0
    for op in ops:
        rec = run_op(op, runner, assets, urls, fetch)
        show(rec, out)
        failed += rec["state"] != "done"
        if rec["state"] == "skipped":
            out("stopped: --max-usd reached, the remaining ops were not run")
            failed += len(ops) - ops.index(op) - 1
            break
    out(f"spent: ${runner.budget.spent:.2f} of ${args.max_usd:.2f}   failed or not run: {failed}")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
