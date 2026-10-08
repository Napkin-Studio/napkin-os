#!/usr/bin/env python3
"""One real job per step on each provider pathway (features/harness-pathways.clan).

A DRY RUN by default: it prints the plan and its estimated cost and sends nothing. Pass --live to
spend money; --max-usd (default 2) is a hard cap checked before every job. The jobs go through an
in-process Relay (the real director passthrough, names.py, the seam and the real adapters) to the
real providers, polled until they end; results land in a JSON file.

Keys come only from the environment (FAL_KEY, RUNWAY_API_KEY, HEYGEN_API_KEY) and are printed only
as "set" or "missing"; this script never opens .env. Load them first:   set -a; source ../../.env; set +a
A pathway runs only the steps whose provider has a key.

Inputs are public HTTPS URLs the providers fetch themselves:
  --image-url  a character picture (required for --live)
  --mask-url   a PNG mask, white = change, the same size as the image (region edits; else skipped)
  --video-url  a short MP4 (clip edits; else skipped)
Images only by default; --video adds clips and clip edits (about $0.5-2.5 each).

    uv run --frozen --python 3.12 python scripts/pathway_smoke.py --image-url https://… [--pathways fal,mix]
"""

from __future__ import annotations

import argparse
import datetime as dt
import hashlib
import json
import os
import sys
import tempfile
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent
RELAY = HERE.parent
sys.path.insert(0, str(RELAY))

from contracts_dir import contracts_dir  # noqa: E402
from providers.types import effective_sheet  # noqa: E402

PATHWAYS = ("runway", "fal", "heygen", "mix")
KEYS = {"fal": "FAL_KEY", "runway": "RUNWAY_API_KEY", "heygen": "HEYGEN_API_KEY"}
IMAGE_STEPS = ("generate", "view", "frame", "region_edit")
VIDEO_STEPS = ("clip", "clip_edit")
TERMINAL = ("completed", "failed", "cancelled", "uncertain")
JOB_TIMEOUT_S = 900


def _sheets() -> dict[str, dict]:
    return {json.loads(p.read_text())["provider"]: json.loads(p.read_text())
            for p in (contracts_dir() / "capabilities").glob("*.json")}


def _config(name: str) -> dict:
    cfg = json.loads((contracts_dir() / "examples" / f"config.pathway.{name}.json").read_text())
    cfg["flags"] = {**cfg["flags"], "regionEditCanvas": True, "regionEditFrames": True, "videoRegionEdit": True,
                    "feelEdit": True}
    cfg["quotas"] = {"image": 1000, "video": 1000, "render": 1000}
    cfg["inFlightPerParticipant"] = 6
    return cfg


def _asset(url: str, mime: str) -> dict:
    return {"sha256": "sha256:" + hashlib.sha256(url.encode()).hexdigest(), "url": url, "mime": mime}


def _id(prefix: str) -> str:
    from director import new_id
    return new_id(prefix)


def inputs(args) -> dict[str, dict | None]:
    """The input for each step, or None when an argument it needs is missing."""
    image = _asset(args.image_url or "https://example.invalid/character.png", "image/png")
    front = {"id": _id("ref"), "name": "hero_front", "role": "character", "kind": "picture", "asset": image}
    shot = {"id": _id("shot"), "order": 1, "duration_s": 5, "composition": "medium",
            "action": "@hero_front waves at the camera in a sunny park", "camera_move": "static",
            "refs": ["hero_front"]}
    return {
        "generate": {"text": "@hero_front standing, full body, plain background", "refs": [front], "ratio": "4:5"},
        "view": {"view": "side", "image": image, "ratio": "4:5"},
        "frame": {"shot": shot, "refs": [front], "ratio": "16:9"},
        "region_edit": ({"image": image, "region": {"x": 0.3, "y": 0.1, "w": 0.4, "h": 0.25},
                         "mask": _asset(args.mask_url, "image/png"), "text": "a red hat", "ratio": "4:5"}
                        if args.mask_url else None),
        "clip": {"shot": shot, "image": image, "refs": [front], "ratio": "16:9"},
        "clip_edit": ({"video": _asset(args.video_url, "video/mp4"), "feel": {"strength": "flex"},
                       "text": "warmer, golden-hour light"} if args.video_url else None),
    }


def plan(args, env: dict) -> list[dict]:
    sheets, inp, rows = _sheets(), inputs(args), []
    steps = IMAGE_STEPS + (VIDEO_STEPS if args.video else ())
    for name in args.pathways:
        cfg = _config(name)
        for op in steps:
            provider = next((p for p in cfg["routing"].get(op, []) if op in sheets[p]["ops"]), None)
            if provider is None:
                continue
            spec = effective_sheet(sheets[provider], op, None)["ops"][op]
            why = ("" if KEYS[provider] in env else f"no {KEYS[provider]}") or ("" if inp[op] else
                   f"needs --{'mask' if op == 'region_edit' else 'video'}-url")
            rows.append({"pathway": name, "op": op, "provider": provider, "model": spec["model"],
                         "estimateUsd": spec.get("estimateUsd"), "skip": why})
    return rows


def _relay(name: str, blobs_dir: Path, env: dict):
    from blobs import LocalBlobs
    from contracts import Contracts
    from director import PassthroughDirector
    from providers import Registry
    from providers._seam import Adapted, Resolver
    from providers.fal import FalProvider
    from providers.heygen import HeyGenProvider
    from providers.runway import RunwayProvider
    from service import Relay
    from store import MemoryStore

    reg = Registry()
    makers = {"fal": FalProvider, "runway": RunwayProvider, "heygen": HeyGenProvider}
    for provider, make in makers.items():
        if KEYS[provider] in env:
            reg.register(Adapted(make(env[KEYS[provider]], Resolver())))
    cfg = _config(name)
    secrets = {"event_codes": {"participant": ["SMOKE"], "organiser": []}, "token_secret": os.urandom(16).hex()}
    return Relay(store=MemoryStore(), blobs=LocalBlobs(blobs_dir, "http://localhost:0"), registry=reg,
                 director=PassthroughDirector(), config=lambda: cfg, secrets=lambda: secrets, clock=time.time,
                 stitch=None, contracts=Contracts(relaxed=True))


def _call(relay, method: str, path: str, body=None, token=None):
    headers = {"Authorization": f"Bearer {token}"} if token else {}
    status, out, _ = relay.http(method, path, headers, json.dumps(body).encode() if body is not None else None)
    return status, out


def run_live(args, env: dict, rows: list[dict]) -> list[dict]:
    spent, results, inp = 0.0, [], inputs(args)
    with tempfile.TemporaryDirectory() as tmp:
        for name in args.pathways:
            relay = _relay(name, Path(tmp) / name, env)
            _, session = _call(relay, "POST", "/session", {"eventCode": "SMOKE", "handle": "smoke"})
            token = session["token"]
            for row in (r for r in rows if r["pathway"] == name):
                if row["skip"]:
                    results.append({**row, "state": "skipped"})
                    continue
                cost = row["estimateUsd"] or 1.0  # an unpublished price counts as $1 against the cap
                if spent + cost > args.max_usd:
                    results.append({**row, "state": "skipped", "skip": f"over the ${args.max_usd} cap"})
                    continue
                spent += cost
                t0 = time.time()
                req = {"contractVersion": "2", "jobId": _id("job"), "op": row["op"], "parentIds": [], "input": inp[row["op"]]}
                status, job = _call(relay, "POST", "/jobs", req, token)
                while status == 200 and job["state"] not in TERMINAL and time.time() - t0 < JOB_TIMEOUT_S:
                    time.sleep(max(2, job.get("nextPollS") or 2))
                    status, job = _call(relay, "GET", f"/jobs/{job['jobId']}", None, token)
                results.append({**row, "state": job.get("state") if status == 200 else f"http {status}",
                                "ranOn": job.get("provider"), "model": job.get("model", row["model"]),
                                "error": job.get("error"), "cost": job.get("cost"),
                                "outputs": [o.get("mime") for o in job.get("outputs") or []],
                                "seconds": round(time.time() - t0, 1)})
                print(f"  {name:7} {row['op']:11} {results[-1]['state']:10} {results[-1]['seconds']:>6}s",
                      (results[-1]["error"] or {}).get("message", "")[:100])
    return results


def main(argv=None, env=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--live", action="store_true", help="send real jobs (spends money)")
    ap.add_argument("--max-usd", type=float, default=2.0)
    ap.add_argument("--pathways", default=",".join(PATHWAYS))
    ap.add_argument("--video", action="store_true", help="add clips and clip edits")
    ap.add_argument("--image-url")
    ap.add_argument("--mask-url")
    ap.add_argument("--video-url")
    ap.add_argument("--out", default=str(RELAY / "results" / f"pathway-smoke-{dt.date.today().isoformat()}.json"))
    args = ap.parse_args(argv)
    args.pathways = [p for p in args.pathways.split(",") if p]
    env = os.environ if env is None else env
    for provider, var in KEYS.items():
        print(f"{var}: {'set' if var in env else 'missing'}")
    rows = plan(args, env)
    total = sum(r["estimateUsd"] or 0 for r in rows if not r["skip"])
    for r in rows:
        print(f"  {r['pathway']:7} {r['op']:11} {r['provider']:7} {r['model']:38} "
              f"{'unpublished' if r['estimateUsd'] is None else '$%.3f' % r['estimateUsd']:>11}  {r['skip']}")
    print(f"estimated ${total:.2f} for {sum(not r['skip'] for r in rows)} job(s); cap ${args.max_usd:.2f}")
    if not args.live:
        print("dry run: nothing sent (pass --live to spend)")
        return 0
    if not args.image_url or not args.image_url.startswith("https://"):
        print("--live needs --image-url with a public https:// picture", file=sys.stderr)
        return 2
    results = run_live(args, env, rows)
    Path(args.out).parent.mkdir(parents=True, exist_ok=True)
    Path(args.out).write_text(json.dumps(results, indent=1))
    print(f"results: {args.out}")
    return 0 if all(r["state"] in ("completed", "skipped") for r in results) else 1


if __name__ == "__main__":
    sys.exit(main())
