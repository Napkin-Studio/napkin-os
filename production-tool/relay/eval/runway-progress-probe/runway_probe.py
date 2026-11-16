#!/usr/bin/env python3
"""Runway progress probe: what does a task report while it runs, and how long does it take?

Measures what the Napkin ring/ETA design needs and the repo's adapter currently drops:
  * the raw status sequence (PENDING / THROTTLED / RUNNING / SUCCEEDED ...) and time in each
  * the `progress` field on RUNNING tasks: present? units (0-1 or 0-100)? monotonic? how well does it predict the end?
  * real durations for a cheap image and a 4 s clip
  * what THROTTLED looks like when you submit more tasks than your concurrency allows

DRY RUN by default: prints the plan and the estimated cost and sends nothing. --live spends money.
--max-usd (default 1.50) is a hard cap checked before every submit. Standard library only; reads no files.
The key comes from the environment (RUNWAYML_API_SECRET, else RUNWAY_API_KEY) and is only ever printed as "set (N chars)".

    set -a; source <your env file>; set +a
    python3 runway_probe.py --live

Plan (estimates from the repo's provider sheet, checked 2026-10-08):
  stage A  3 images at once   gemini_image3.1_flash  ~$0.07 each   (more than a tier-1 limit, to see THROTTLED)
  stage B  1 clip, 4 s        veo3.1_fast, audio off  ~$0.60        (first frame = stage A's first image)
"""
from __future__ import annotations

import argparse
import json
import os
import random
import sys
import threading
import time
import urllib.error
import urllib.request

BASE_URL = "https://api.dev.runwayml.com"
VERSION = "2024-11-06"            # the adapter's X-Runway-Version
TERMINAL = {"SUCCEEDED", "FAILED", "CANCELLED"}
IMG_MODEL, IMG_EST = "gemini_image3.1_flash", 0.07
CLIP_MODEL, CLIP_EST = "veo3.1_fast", 0.60


class Api:
    def __init__(self, key: str, base: str):
        self.key, self.base = key, base.rstrip("/")

    def call(self, method: str, path: str, body: dict | None = None, timeout: int = 30) -> dict:
        data = json.dumps(body).encode() if body is not None else None
        req = urllib.request.Request(self.base + path, data=data, method=method, headers={
            "Authorization": f"Bearer {self.key}", "X-Runway-Version": VERSION, "Content-Type": "application/json"})
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            raw = resp.read()
        return json.loads(raw) if raw else {}


class Budget:
    def __init__(self, cap: float):
        self.cap, self.reserved, self.lock = cap, 0.0, threading.Lock()

    def reserve(self, est: float) -> None:
        with self.lock:
            if self.reserved + est > self.cap + 1e-9:
                raise SystemExit(f"stop: a ${est:.2f} task would pass --max-usd ${self.cap:.2f} (${self.reserved:.2f} reserved)")
            self.reserved += est


def trim(e: Exception) -> str:
    if isinstance(e, urllib.error.HTTPError):
        try:
            return f"HTTP {e.code}: {e.read().decode()[:300]}"
        except Exception:
            return f"HTTP {e.code}"
    return f"{type(e).__name__}: {e}"


def follow(api: Api, label: str, model: str, rid: str, t_submit: float, timeout_s: float, poll_s: float, out: dict) -> None:
    """Poll one task until it ends, recording every raw reply's status and progress."""
    samples, errors, final = [], 0, None
    while time.monotonic() - t_submit < timeout_s:
        time.sleep(poll_s + random.random() * poll_s * .15)
        t = round(time.monotonic() - t_submit, 2)
        try:
            task = api.call("GET", f"/v1/tasks/{rid}")
        except Exception as e:
            errors += 1
            print(f"  {label}: poll failed ({trim(e)})")
            if errors >= 6:
                break
            continue
        s = {"t": t, "status": task.get("status"), "progress": task.get("progress"),
             "keys": sorted(k for k in task if k not in ("output",))}
        samples.append(s)
        print(f"  {label:<10} t={t:>6.1f}s  {str(s['status']):<10} progress={s['progress']}")
        if task.get("status") in TERMINAL:
            final = task
            break
    if final is None and samples and samples[-1]["status"] not in TERMINAL:
        try:
            api.call("DELETE", f"/v1/tasks/{rid}")
            print(f"  {label}: timed out, cancelled the task")
        except Exception as e:
            print(f"  {label}: timed out and could not cancel ({trim(e)})")
    out[label] = {"label": label, "model": model, "taskId": rid, "samples": samples,
                  "final": None if final is None else {
                      "status": final.get("status"), "cost": final.get("cost"), "failure": final.get("failure"),
                      "failureCode": final.get("failureCode"), "createdAt": final.get("createdAt"),
                      "outputs": len(final.get("output") or []), "firstOutput": (final.get("output") or [None])[0]},
                  "duration_s": samples[-1]["t"] if final is not None and samples else None}


def summarise(res: dict) -> list[str]:
    lines = []
    for r in res.values():
        s = r["samples"]
        line = [f"{r['label']} ({r['model']}): "]
        if not s:
            lines.append(line[0] + "no samples")
            continue
        seq, last = [], None
        for x in s:                                    # status timeline
            if x["status"] != last:
                seq.append([x["status"], x["t"], x["t"]])
                last = x["status"]
            else:
                seq[-1][2] = x["t"]
        lines.append(line[0] + " -> ".join(f"{a} {b:.0f}-{c:.0f}s" for a, b, c in seq)
                     + (f"; ended {r['duration_s']:.0f}s after submit" if r["duration_s"] is not None else "; did not finish"))
        prog = [(x["t"], x["progress"]) for x in s if isinstance(x["progress"], (int, float))]
        if not prog:
            lines.append("    progress: never present in any reply")
            continue
        vals = [p for _, p in prog]
        mono = all(b >= a for a, b in zip(vals, vals[1:]))
        scale = 100.0 if max(vals) > 1.0 else 1.0
        lines.append(f"    progress: {len(vals)} samples, min {min(vals)}, max {max(vals)}, "
                     f"looks like {'percent (0-100)' if scale == 100 else 'a fraction (0-1)'}, monotonic: {mono}")
        run_start = next((x["t"] for x in s if x["status"] == "RUNNING"), None)
        if r["duration_s"] and run_start is not None:
            errs = []
            for t, p in prog:
                frac = p / scale
                if .1 <= frac <= .95 and t > run_start:
                    pred_total = run_start + (t - run_start) / frac        # linear extrapolation from RUNNING start
                    errs.append((frac, pred_total, (pred_total - r["duration_s"]) / r["duration_s"]))
            if errs:
                pick = [min(errs, key=lambda e, q=q: abs(e[0] - q)) for q in (.25, .5, .75)]
                lines.append("    linear ETA from progress: " + "; ".join(
                    f"at {e[0]*100:.0f}% predicts {e[1]:.0f}s total ({e[2]*100:+.0f}% off)" for e in pick))
    return lines


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--live", action="store_true", help="spend money: really call Runway")
    ap.add_argument("--max-usd", type=float, default=1.50, help="hard cap on estimated spend (default %(default)s)")
    ap.add_argument("--images", type=int, default=3, help="stage A task count (default %(default)s)")
    ap.add_argument("--no-clip", action="store_true", help="skip stage B (the $0.60 clip)")
    ap.add_argument("--poll-s", type=float, default=5.5, help="poll gap; Runway says not more often than every 5 s")
    ap.add_argument("--base-url", default=BASE_URL, help="for self-tests against a fake server only")
    ap.add_argument("--out", default="runway-probe-results.json")
    a = ap.parse_args()

    key = os.environ.get("RUNWAYML_API_SECRET") or os.environ.get("RUNWAY_API_KEY") or ""
    plan = a.images * IMG_EST + (0 if a.no_clip else CLIP_EST)
    print(f"key: {'set (%d chars)' % len(key) if key else 'NOT set (RUNWAYML_API_SECRET / RUNWAY_API_KEY)'}")
    print(f"plan: {a.images} x {IMG_MODEL} ~${IMG_EST:.2f}" + ("" if a.no_clip else f" + 1 x {CLIP_MODEL} 4 s ~${CLIP_EST:.2f}")
          + f"  = ~${plan:.2f}   cap ${a.max_usd:.2f}")
    if plan > a.max_usd:
        print("the plan is over the cap; raise --max-usd or lower --images")
        return 2
    if not a.live:
        print("DRY RUN: nothing sent. Add --live to spend.")
        return 0
    if not key:
        print("no key in the environment: nothing sent")
        return 2

    api, budget, results = Api(key, a.base_url), Budget(a.max_usd), {}

    try:  # free: the tier and each model's concurrency
        org = api.call("GET", "/v1/organization")
        tier = org.get("tier") or {}
        print(f"organization: tier {tier.get('maxMonthlyCreditSpend', '?')} credits/month cap, balance {org.get('creditBalance')} credits")
        for m in (IMG_MODEL, CLIP_MODEL):
            print(f"  {m}: maxConcurrentGenerations {((tier.get('models') or {}).get(m) or {}).get('maxConcurrentGenerations')}")
        results["_organization"] = org
    except Exception as e:
        print(f"organization lookup failed ({trim(e)}); continuing")

    def submit(label: str, path: str, body: dict, est: float) -> tuple[str, float] | None:
        budget.reserve(est)
        t0 = time.monotonic()
        try:
            task = api.call("POST", path, body)
        except Exception as e:
            print(f"  {label}: submit failed ({trim(e)}); not retrying (a retry could pay twice)")
            return None
        print(f"  {label}: submitted, task {str(task.get('id'))[:8]}...")
        return task["id"], t0

    print("\nstage A: images, all at once")
    threads, a_out = [], {}
    for i in range(a.images):
        label = f"image{i + 1}"
        sub = submit(label, "/v1/text_to_image", {"model": IMG_MODEL, "promptText": f"A small red paper boat on a calm pond, soft morning light, photo {i + 1}",
                                                  "ratio": "1024:1024"}, IMG_EST)
        if sub:
            th = threading.Thread(target=follow, args=(api, label, IMG_MODEL, sub[0], sub[1], 300, a.poll_s, a_out), daemon=True)
            th.start()
            threads.append(th)
    for th in threads:
        th.join()
    results.update(a_out)

    first = next((r["final"]["firstOutput"] for r in a_out.values() if r.get("final") and r["final"].get("firstOutput")), None)
    if not a.no_clip:
        if not first:
            print("\nstage B skipped: no image to use as the first frame")
        else:
            print("\nstage B: one 4 s clip")
            sub = submit("clip", "/v1/image_to_video", {"model": CLIP_MODEL, "promptImage": [{"uri": first, "position": "first"}],
                                                       "promptText": "The boat drifts gently across the pond.", "ratio": "1280:720",
                                                       "duration": 4, "audio": False}, CLIP_EST)
            if sub:
                b_out: dict = {}
                follow(api, "clip", CLIP_MODEL, sub[0], sub[1], 900, a.poll_s, b_out)
                results.update(b_out)

    print("\nsummary")
    for line in summarise({k: v for k, v in results.items() if not k.startswith("_")}):
        print(line)
    cr = [r["final"]["cost"] for r in results.values() if isinstance(r, dict) and r.get("final") and r["final"].get("cost")]
    if cr:
        print(f"  reported cost objects: {cr[:4]}")
    with open(a.out, "w") as f:
        json.dump(results, f, indent=1)
    print(f"\nwrote {a.out}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
