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
                http URL will do); clip (its first frame: Runway rejects a data URI there, so a URL
                that is not https is fetched, shrunk and uploaded to Runway's ephemeral store, free;
                a dry run uploads nothing)
  --video-url   clip_edit (https mp4, 2-30 s; blocked if it is not https)

The two person-run live checks of features/runway-sheet-sync.clan (scripts/live_check_*.sh wrap them):
  (a) Aleph 2 on our key:  --ops clip_edit --video-url <4 s https mp4> --input-s 4 --range 1-3
                           --keyframe-url <https image>
  (b) Is a stopped render charged?  --ops clip --model veo3.1_fast --duration 4 --cancel-after 15
      submits, cancels after 15 s, and prints creditBalance from GET /v1/organization before and
      after (a cancelled task cannot be read again, and /v1/organization/usage only totals a day).
Exit status is non-zero if any op failed or was not run.
"""

from __future__ import annotations

import argparse
import os
import sys
import time
from typing import Callable, Optional

import httpx

from runway_common import (
    CLIP_RATIO, DEFAULT_MAX_USD, IMAGE_RATIO, KEY_ENV, KEY_HELP, UPLOAD_NOTE, Assets, Budget, BudgetExceeded,
    Runner, Tap, default_factory, estimate_usd, fetch_bytes, first_frame_ref, image_ref, is_https, key_status,
    make_client, make_job, prepare_image, region_edit,
)
from contracts_dir import pricing
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
    p.add_argument("--model", help="run the op on this model (one of its alternates), e.g. veo3.1_fast")
    p.add_argument("--duration", type=int, help="clip length in seconds (default 4)")
    p.add_argument("--input-s", type=float, help="clip_edit: the input video's length, for the price (default the op's)")
    p.add_argument("--range", help="clip_edit: the keyframe's edit window START-END in whole seconds, end exclusive")
    p.add_argument("--keyframe-url", help="clip_edit: an image placed as a keyframe (in the middle of --range)")
    p.add_argument("--cancel-after", type=float, help="submit, then cancel after this many seconds and compare "
                   "creditBalance before and after (live check b)")
    p.add_argument("--settle", type=float, default=90.0,
                   help="seconds to wait after a cancel before reading the balance again (default %(default)s)")
    return p


def window(text: Optional[str]) -> Optional[tuple[int, int]]:
    """'1-3' -> (1, 3): whole seconds, end exclusive, as aleph2's keyframe range takes."""
    if not text:
        return None
    start, _, end = text.partition("-")
    try:
        a, b = int(start), int(end)
    except ValueError:
        raise ValueError(f"--range {text}: needs START-END in whole seconds") from None
    if not 0 <= a < b:
        raise ValueError(f"--range {text}: needs START-END with START < END")
    return a, b


def settings_for(op: str, args) -> dict:
    """The settings the job's price depends on, from the flags (contracts/pricing.py)."""
    if op == "clip":
        return {"durationS": args.duration or 4}
    if op == "clip_edit" and args.input_s:
        return {"inputS": args.input_s}
    return {}


def price(sheet: dict, op: str, args=None) -> float:
    """One job's USD at the flags' settings; an unpriced job counts as $1 against the cap."""
    if args is None:
        return estimate_usd(sheet, op)
    model = args.model if args.model and args.model != sheet["ops"][op]["model"] else None
    usd = pricing().op_usd(sheet, op, model, settings_for(op, args))
    return 1.0 if usd is None else usd


def blocked_reason(op: str, urls: dict) -> Optional[str]:
    """Why an op cannot run with these URLs, or None. A URL that is not given is the 'needs' check's business."""
    if op == "clip_edit" and urls.get("video") and not is_https(urls["video"]):
        return VIDEO_NEEDS_HTTPS
    return None


def plan_lines(sheet: dict, ops: list[str], urls: dict, args=None) -> tuple[list[str], float]:
    lines, total = [], 0.0
    for op in ops:
        est, need = price(sheet, op, args), NEEDS.get(op)
        note = ""
        if need and not urls.get(need):
            note = f"   needs {FLAG[need]}"
        if reason := blocked_reason(op, urls):
            est, note = 0.0, f"   BLOCKED: {reason}"
        elif op == "clip" and urls.get("image") and not is_https(urls["image"]):
            note = f"   {UPLOAD_NOTE}"
        total += est
        model = (args.model if args is not None and args.model else None) or sheet["ops"][op]["model"]
        lines.append(f"  {op:<12} {model:<22} ~${est:.2f}{note}")
    return lines, total


def build_job(sheet: dict, op: str, assets: Assets, urls: dict, fetch: Callable[[str], bytes],
              first_frame: Callable[[str], str], args=None):
    """The request for one op. Returns the job, or None for region_edit (its own pipeline)."""
    model = {"model": args.model} if args is not None and args.model else {}
    if op == "generate":
        return make_job(sheet, op, "A red fox sitting in a snowy forest, photo.", ratio=IMAGE_RATIO, **model)
    if op == "clip_edit":
        sha = assets.add_url(urls["video"], "video/mp4")
        keyframe = None
        if args is not None and args.keyframe_url:
            span = window(args.range)
            at = (span[0] + span[1]) / 2 if span else 1.0
            keyframe = {"sha256": image_ref(assets, fetch, args.keyframe_url), "atS": at,
                        **({"startS": span[0], "endS": span[1]} if span else {})}
        return make_job(sheet, op, "Make the lighting warmer, keep everything else the same.",
                        refs=[Ref(sha, "source", "source")], keyframe=keyframe, **model)
    if op == "clip":  # an https URL as is, else uploaded to Runway: a data URI is no first frame
        sha = first_frame(urls["image"])
        seconds = args.duration if args is not None and args.duration else 4
        return make_job(sheet, op, "She turns and smiles.", ratio=CLIP_RATIO, duration_s=seconds,
                        first_frame=sha, **model)
    sha = image_ref(assets, fetch, urls["image"])  # an image op takes the bytes inline
    if op == "view":
        return make_job(sheet, op, "@hero seen from the side, full body, plain background.", ratio=IMAGE_RATIO,
                        refs=[Ref(sha, "hero", "character")])
    if op == "frame":
        return make_job(sheet, op, "@hero walking through a doorway, cinematic still.", ratio=IMAGE_RATIO,
                        refs=[Ref(sha, "hero", "character")])
    return None


def run_op(op: str, runner: Runner, assets: Assets, urls: dict, fetch: Callable[[str], bytes],
           first_frame: Callable[[str], str], args=None) -> dict:
    sheet = runner.sheet
    if reason := blocked_reason(op, urls):
        return {"label": op, "op": op, "state": "blocked", "reason": reason}
    try:
        job = build_job(sheet, op, assets, urls, fetch, first_frame, args)
    except Exception as exc:  # an unreachable image is this op's failure, not the run's
        return {"label": op, "op": op, "state": "failed", "error": {"code": "input", "message": f"{type(exc).__name__}: {exc}"}}
    if job:
        if args is not None and args.cancel_after is not None:
            return cancel_check(op, job, runner, args, price(sheet, op, args))
        return runner.run(op, job, est=price(sheet, op, args) if args is not None else None)
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


def cancel_check(op: str, job, runner: Runner, args, est: float) -> dict:
    """Live check (b): submit, cancel after --cancel-after seconds, and read creditBalance before and
    after. Runway does not let a cancelled task be read again, so the balance is the only witness:
    run it with nothing else running on the key, on a model nothing else used that UTC day."""
    rec = {"label": f"{op} (stopped)", "op": op, "model": job.model}
    provider = runner.provider
    try:
        before = provider.organization().get("creditBalance")
        rid = runner.submit(job, est)
        rec["request_id"] = rid
        runner.sleep(args.cancel_after)
        provider.cancel(rid)
        runner.sleep(args.settle)
        after = provider.organization().get("creditBalance")
    except BudgetExceeded as exc:
        return {**rec, "state": "skipped", "reason": str(exc)}
    except ProviderError as exc:
        return {**rec, "state": "failed", "error": exc.to_dict()}
    charged = None if before is None or after is None else before - after
    verdict = ("balance unreadable" if charged is None else "NOT charged" if charged == 0 else
               f"CHARGED {charged} credits")
    usd = None if charged is None else round(charged * runner.sheet["usdPerCredit"], 4)
    return {**rec, "state": "done", "cost_usd": usd,
            "reason": f"cancelled after {args.cancel_after:g} s; creditBalance {before} -> {after}: {verdict}",
            "balance": {"before": before, "after": after, "charged": charged}}


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
         factory=default_factory, fetch: Callable[[str], bytes] = fetch_bytes,
         transport: Optional[httpx.BaseTransport] = None, **runtime) -> int:
    args = parser().parse_args(argv)
    env = os.environ if env is None else env
    ops = [o for o in args.ops.split(",") if o]
    if bad := [o for o in ops if o not in OPS]:
        out(f"unknown ops: {', '.join(bad)}")
        return 2
    sheet = load_sheet("runway")
    urls = {"image": args.image_url, "video": args.video_url}

    out(f"{KEY_ENV}: {key_status(env)}")
    try:
        window(args.range)
    except ValueError as exc:
        out(str(exc))
        return 2
    lines, total = plan_lines(sheet, ops, urls, args)
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
    for model, n in sorted(((org.get("ceilings") or {}).get("maxDailyGenerations") or {}).items()):
        out(f"  {model:<24} daily generations {n if n is not None else 'no limit'}")
    for model, n in sorted(org["concurrency"].items()):
        out(f"  {model:<24} concurrency {n if n is not None else 'no limit'}")
    if not args.live:
        return 0

    runner = Runner(provider, Budget(args.max_usd), tap=tap, **runtime)
    client = make_client(transport=transport)  # for the ephemeral upload of a clip's first frame

    def first_frame(url: str) -> str:
        return first_frame_ref(assets, client, key, fetch, url)

    failed = 0
    for op in ops:
        rec = run_op(op, runner, assets, urls, fetch, first_frame, args)
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
