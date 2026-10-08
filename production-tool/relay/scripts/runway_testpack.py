#!/usr/bin/env python3
"""Runway test pack: the batch from the owner's handoff, in one results file.

A DRY RUN by default: it prints the plan and the estimated cost, and sends nothing.
Pass --live to spend money. --max-usd (default 15) is a hard cap: a job that would pass it is not submitted.

The key is read only from the environment variable RUNWAYML_API_SECRET. Load it first with

    set -a; source .env; set +a

(this script never opens .env) and it is printed only as "set (N chars)".

Items (--only a,b,c picks some; the default is all):
  a  does @tag work on gemini_image3.1_flash (with-tag vs without-tag; a person judges, so 'needs eyes')
  b  does a CloudFront input URL pass (--input-url: its HEAD result and the job's outcome)
  c  10 region edits through region.pipeline, shipped if 7 of 10 stay inside the box
  d  turnaround as one sheet vs one call per view
  e  clip A/B: veo3.1_fast vs gen4.5 vs seedance2_fast (model overrides; an adapter or Runway rejection is reported)
  f  p50/p95 latency of 20 jobs in parallel, with the time spent THROTTLED counted apart
  g  the organization's limits (GET /v1/organization, free)

Inputs: --image-url (a character; items a, c, d, e), --input-url (item b). The image ops (a, c, d) fetch
the --image-url once and send it to Runway as a data URI, so it may be a local http URL. Runway rejects a
data URI as a clip's first frame, so for a URL that is not https item e uploads the (shrunk) image to Runway's
ephemeral store (free) and uses the runway:// uri; a dry run uploads nothing. Item b wants an https URL for
the CloudFront test, so it is 'blocked' (zero cost, nothing submitted) unless its URL is https.
Order: g first, then the cheap items together (b, a, d), then f alone so its latencies are clean,
then the costly c and e together.

Writes production-tool/relay/results/runway-testpack.json (and a .md beside it for the record's
open_questions). Exit status is non-zero if an item errored or was cut short.

Every finished job's outputs are saved under --save-dir (default results/outputs) as <item>/<label>.<ext>
(item c: <edit>/original.png, raw_edit.png, final.png, metrics.json), and a live run writes index.html
beside the results file, to look at them. --report-only rebuilds index.html from an existing results
file: no key, no network.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from pathlib import Path
from typing import Callable, Optional

import httpx

from runway_common import (
    CLIP_RATIO, DEFAULT_MAX_USD, GATE_NOTE, IMAGE_RATIO, KEY_ENV, KEY_HELP, RELAY, UPLOAD_NOTE, Assets,
    Budget, BudgetExceeded, Runner, Tap, default_factory, estimate_usd, fetch_bytes, first_frame_ref, head_url,
    image_ref, is_https, key_status, make_client, make_job, percentile, prepare_image, redact_url, region_edit,
    save_outputs, scrub, sheet_with_model, write_file,
)
from runway_report import build_report
from providers import ProviderError, Ref, load_sheet
from region import DEFAULT_THRESHOLDS, evaluate_gate, paste_back

RESULTS = RELAY / "results" / "runway-testpack.json"
SAVE_DIR = RELAY / "results" / "outputs"
STAGES = (("g",), ("b", "a", "d"), ("f",), ("c", "e"))
ITEMS = tuple("abcdefg")
NEEDS = {"a": "--image-url", "b": "--input-url", "c": "--image-url", "d": "--image-url", "e": "--image-url"}
TITLES = {
    "a": "@tag on gemini_image3.1_flash", "b": "CloudFront input URL", "c": "region edits (gate 7 of 10)",
    "d": "turnaround: one sheet vs one call per view", "e": "clip A/B", "f": "20 jobs in parallel",
    "g": "organization limits",
}
INPUT_NEEDS_HTTPS = "needs an https input URL: Runway only fetches https, and this item tests a CloudFront URL"
CLIP_MODELS = ("veo3.1_fast", "gen4.5", "seedance2_fast")
VIEWS = ("front", "three_quarter", "side", "back")
PARALLEL_JOBS, REGION_EDITS = 20, 10

# Ten boxes in two rows across the image, each with a plain request.
REGION_PROMPTS = (
    "Make it a different colour.", "Add a small red hat.", "Replace it with a plain blue square.",
    "Make it look wet.", "Add a pair of round glasses.", "Make it a bright green.",
    "Turn it into a wooden texture.", "Add a yellow flower.", "Make it a glossy black.", "Add a gold badge.",
)
REGION_BOXES = tuple({"x": x, "y": y, "w": 0.16, "h": 0.2} for y in (0.2, 0.6) for x in (0.05, 0.24, 0.43, 0.62, 0.81))


def parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--live", action="store_true", help="spend money: really call Runway")
    p.add_argument("--only", default=",".join(ITEMS), help="comma-separated items, from: a,b,c,d,e,f,g")
    p.add_argument("--image-url", help="public HTTPS image of a character")
    p.add_argument("--input-url", help="the CloudFront URL to test for item b")
    p.add_argument("--max-usd", type=float, default=DEFAULT_MAX_USD, help="hard cap on spend (default %(default)s)")
    p.add_argument("--out", type=Path, default=RESULTS, help="the results file (default %(default)s)")
    p.add_argument("--save-dir", type=Path, default=SAVE_DIR, help="where outputs are saved (default %(default)s)")
    p.add_argument("--report-only", action="store_true",
                   help="rebuild index.html beside --out from the existing results file; no key, no network")
    return p


def plan(sheet: dict, only: list[str]) -> list[dict]:
    """What each item will send and what it should cost at most."""
    flash, pro, clip = (estimate_usd(sheet, op) for op in ("generate", "region_edit", "clip"))
    jobs = {"a": (2, flash), "b": (1, flash), "c": (REGION_EDITS, pro), "d": (1 + len(VIEWS), flash),
            "e": (len(CLIP_MODELS), clip), "f": (PARALLEL_JOBS, flash), "g": (0, 0.0)}
    return [{"item": i, "title": TITLES[i], "jobs": jobs[i][0], "est_usd": round(jobs[i][0] * jobs[i][1], 2)}
            for i in ITEMS if i in only]


def blocked_reason(item: str, image_url: Optional[str], input_url: Optional[str]) -> Optional[str]:
    """Why an item cannot run with these inputs, or None. A URL that is not given is the 'needs' check's business."""
    if item == "b" and input_url and not is_https(input_url):
        return INPUT_NEEDS_HTTPS
    return None


class Ctx:
    """What the items share: the runner, the inputs, and the injected I/O."""

    def __init__(self, runner, assets, key, factory, args, fetch, head, client=None):
        self.runner, self.assets, self.key, self.factory = runner, assets, key, factory
        self.client = client or make_client()  # for the ephemeral upload
        self.image_url, self.input_url, self.fetch, self.head = args.image_url, args.input_url, fetch, head
        self.save_dir, self.base = args.save_dir, args.out.parent  # recorded paths are relative to the results folder
        self._image_sha, self._lock = None, threading.Lock()

    def image(self) -> str:
        """The character as a data URI, for an image op: fetched and shrunk once."""
        with self._lock:
            if self._image_sha is None:
                self._image_sha = image_ref(self.assets, self.fetch, self.image_url)
            return self._image_sha

    def run(self, item: str, label: str, job, runner=None, **kw) -> dict:
        """Run one job and save its outputs."""
        rec = (runner or self.runner).run(label, job, **kw)
        save_outputs(rec, item, self.save_dir, self.base, self.fetch,
                     "mp4" if job.op in ("clip", "clip_edit") else "png")
        return rec

    def map(self, fn, items) -> list:
        with ThreadPoolExecutor(max_workers=max(1, len(items))) as pool:
            return list(pool.map(fn, items))

    def job(self, op: str, prompt: str, **kw):
        return make_job(self.runner.sheet, op, prompt, **kw)


def settled(records: list[dict]) -> str:
    return "skipped" if all(r["state"] == "skipped" for r in records) else "done"


def item_a(ctx: Ctx) -> dict:
    ref = [Ref(ctx.image(), "hero", "character")]
    with_tag = "@hero standing in a sunlit kitchen, photo."
    without = "The person in the reference image standing in a sunlit kitchen, photo."
    recs = ctx.map(lambda p: ctx.run("a", p[0], ctx.job("generate", p[1], refs=ref, ratio=IMAGE_RATIO)),
                   [("with_tag", with_tag), ("without_tag", without)])
    return {"status": "needs_eyes" if all(r["state"] == "done" for r in recs) else settled(recs),
            "reference_honoured": "needs eyes", "jobs": recs}


def item_b(ctx: Ctx) -> dict:
    try:
        head = ctx.head(ctx.input_url)
    except Exception as exc:  # a HEAD that cannot even connect is itself the answer
        head = {"error": str(exc)}
    sha = ctx.assets.add_url(ctx.input_url, "image/png")
    rec = ctx.run("b", "input_url", ctx.job("generate", "@hero in a sunlit kitchen, photo.",
                                            refs=[Ref(sha, "hero", "character")], ratio=IMAGE_RATIO))
    return {"status": settled([rec]), "input_url": redact_url(ctx.input_url), "head": head,
            "passed": rec["state"] == "done", "jobs": [rec]}


def save_edit(ctx: Ctx, i: int, original: bytes, raw: Optional[bytes], res, row: dict) -> dict:
    """The edit's pictures and numbers, side by side: the model's raw output is what the gate judged."""
    folder = ctx.save_dir / "c" / f"edit_{i + 1:02d}"
    final = res.png
    if final is None and raw is not None:  # the gate said no: show the plain paste-back anyway, marked as ungated
        final = paste_back(original, raw, row["region"], 0)
        row["final_ungated"] = True
    files = {"original": ("original.png", original), "raw_edit": ("raw_edit.png", raw), "final": ("final.png", final),
             "metrics": ("metrics.json", json.dumps({k: row[k] for k in ("ok", "region", "reason", "metrics")},
                                                    indent=2).encode())}
    saved = {}
    for key, (name, data) in files.items():
        if data is not None:
            write_file(folder / name, data)
            saved[key] = os.path.relpath(folder / name, ctx.base)
    return saved


def item_c(ctx: Ctx) -> dict:
    png, ratio = prepare_image(ctx.fetch(ctx.image_url))

    def one(i: int) -> dict:
        got = {}
        try:
            res = region_edit(ctx.runner, png, ratio, REGION_BOXES[i], REGION_PROMPTS[i], ctx.assets, ctx.fetch, got)
        except BudgetExceeded as exc:
            return {"index": i, "ok": False, "skipped": str(exc)}
        except ProviderError as exc:
            return {"index": i, "ok": False, "error": exc.to_dict()}
        except Exception as exc:  # a failed download or decode after a paid edit must not lose the other edits
            return {"index": i, "ok": False, "error": {"code": "input", "message": scrub(f"{type(exc).__name__}: {exc}")}}
        row = {"index": i, "ok": res.ok, "region": REGION_BOXES[i], "reason": res.reason, "metrics": res.metrics}
        try:
            row["files"] = save_edit(ctx, i, png, got.get("raw"), res, row)
        except Exception as exc:  # the verdict stands even if its pictures could not be written
            row["files"], row["save_error"] = {}, scrub(f"{type(exc).__name__}: {exc}")
        return row

    rows = ctx.map(one, range(REGION_EDITS))
    skipped = sum("skipped" in r for r in rows)
    return {"status": "incomplete" if skipped else "done", "gate": evaluate_gate([r["ok"] for r in rows]),
            "gate_note": GATE_NOTE, "thresholds": DEFAULT_THRESHOLDS, "skipped": skipped, "edits": rows}


def item_d(ctx: Ctx) -> dict:
    ref = [Ref(ctx.image(), "hero", "character")]
    sheet_prompt = ("A character turnaround sheet of @hero: four full-body views in one row, "
                    "front, three-quarter, side and back, plain background.")
    calls = [("sheet", ctx.job("generate", sheet_prompt, refs=ref, ratio="1536:672"))]
    calls += [(f"view_{v}", ctx.job("view", f"@hero seen from the {v.replace('_', ' ')}, full body, plain background.",
                                    refs=ref, ratio=IMAGE_RATIO)) for v in VIEWS]
    recs = ctx.map(lambda c: ctx.run("d", *c), calls)
    cost = {"sheet": recs[0].get("cost_usd"), "per_view": sum(r.get("cost_usd") or 0 for r in recs[1:])}
    return {"status": "needs_eyes" if all(r["state"] == "done" for r in recs) else settled(recs),
            "verdict": "needs eyes: does the sheet keep one character across the four views?",
            "cost_usd": cost, "jobs": recs}


def item_e(ctx: Ctx) -> dict:
    # An https URL is used as is; any other is uploaded to Runway first. A failure here is the item's, before any job.
    sha = first_frame_ref(ctx.assets, ctx.client, ctx.key, ctx.fetch, ctx.image_url)
    clip_sheet = ctx.runner.sheet

    def one(model: str) -> dict:
        sheet = sheet_with_model(clip_sheet, "clip", model)
        runner = ctx.runner.with_provider(ctx.factory(ctx.key, ctx.assets, ctx.runner.tap, sheet))
        job = make_job(sheet, "clip", "She turns and smiles.", ratio=CLIP_RATIO, duration_s=4, first_frame=sha)
        return ctx.run("e", model, job, runner)  # est: the sheet's clip price; the others' prices are not on the sheet

    recs = ctx.map(one, CLIP_MODELS)
    return {"status": "needs_eyes" if any(r["state"] == "done" for r in recs) else settled(recs),
            "rejected": [r["model"] for r in recs if r["state"] == "failed"], "jobs": recs}


def item_f(ctx: Ctx) -> dict:
    prompts = [(f"job_{i + 1}", f"A single object on a plain table, variation {i + 1}, photo.")
               for i in range(PARALLEL_JOBS)]
    recs = ctx.map(lambda p: ctx.run("f", p[0], ctx.job("generate", p[1], ratio=IMAGE_RATIO)), prompts)
    done = [r for r in recs if r["state"] == "done"]
    lat = [r["latency_s"] for r in done]
    return {"status": settled(recs), "submitted": sum(r["state"] != "skipped" for r in recs), "done": len(done),
            "p50_s": percentile(lat, 50), "p95_s": percentile(lat, 95),
            "p50_excl_throttled_s": percentile([r["latency_s"] - r["throttled_s"] for r in done], 50),
            "p95_excl_throttled_s": percentile([r["latency_s"] - r["throttled_s"] for r in done], 95),
            "throttled_s_total": round(sum(r["throttled_s"] for r in done), 2),
            "throttled_jobs": sum(r["throttled_s"] > 0 for r in done), "jobs": recs}


def item_g(ctx: Ctx) -> dict:
    return {"status": "done", **ctx.runner.provider.organization()}


RUN = {"a": item_a, "b": item_b, "c": item_c, "d": item_d, "e": item_e, "f": item_f, "g": item_g}


def run_item(name: str, ctx: Ctx) -> dict:
    if reason := blocked_reason(name, ctx.image_url, ctx.input_url):
        return {"status": "blocked", "reason": reason}
    try:
        return RUN[name](ctx)
    except Exception as exc:  # one item's failure (an unreachable image, say) must not end the batch
        return {"status": "error", "error": f"{type(exc).__name__}: {exc}"}


def summary(res: dict) -> str:
    """Markdown for the production-tool record's open_questions."""
    it, lines = res["items"], [f"Runway test pack, {res['generated_at']} (${res['spent_usd']:.2f} spent)"]

    def urls(item, label=None):  # the saved files, not the signed URLs
        return " ".join(f for r in it[item]["jobs"] if label in (None, r["label"]) for f in r.get("files", []))

    if "a" in it and it["a"]["status"] != "error":
        lines.append(f"- (a) @tag on gemini_image3.1_flash: needs eyes. with tag {urls('a', 'with_tag') or 'no output'}; "
                     f"without {urls('a', 'without_tag') or 'no output'}")
    if "b" in it and "head" in it["b"]:
        b = it["b"]
        lines.append(f"- (b) CloudFront input URL: HEAD {b['head']}; job {b['jobs'][0]['state']}")
    if "c" in it and "gate" in it["c"]:
        g = it["c"]["gate"]
        outside = [r["metrics"]["outside_changed_fraction"] for r in it["c"]["edits"] if r.get("metrics")]
        spread = f"; outside changed {min(outside) * 100:.1f}-{max(outside) * 100:.1f}%" if outside else ""
        lines.append(f"- (c) region edits: {g['count']} of {g['of']} inside the box, need {g['need']}: "
                     f"{'PASS' if g['passed'] else 'FAIL'} ({GATE_NOTE}{spread})")
    if "d" in it and "jobs" in it["d"]:
        d = it["d"]
        lines.append(f"- (d) turnaround: needs eyes. sheet {urls('d', 'sheet')}; per view cost "
                     f"${d['cost_usd']['per_view']:.2f} vs sheet ${d['cost_usd']['sheet'] or 0:.2f}")
    if "e" in it and "jobs" in it["e"]:
        parts = [f"{r['model']} {r['state']} {r.get('latency_s', 0)} s" +
                 (f" ({r['error']['message']})" if r.get("error") else "") for r in it["e"]["jobs"]]
        lines.append("- (e) clip A/B, needs eyes: " + "; ".join(parts))
    if "f" in it and "p50_s" in it["f"]:
        f = it["f"]
        lines.append(f"- (f) 20 in parallel: p50 {f['p50_s']} s, p95 {f['p95_s']} s; throttled {f['throttled_s_total']} s "
                     f"over {f['throttled_jobs']} jobs (without it p50 {f['p50_excl_throttled_s']} s)")
    if "g" in it and "concurrency" in it["g"]:
        lines.append(f"- (g) organization: {it['g']['concurrency']}")
    lines += [f"- ({n}) {it[n]['status']}: {it[n].get('error', '')}" for n in it if it[n]["status"] == "error"]
    lines += [f"- ({n}) blocked, nothing submitted: {it[n]['reason']}" for n in it if it[n]["status"] == "blocked"]
    return "\n".join(lines)


def write_report(res: dict, results_file: Path, out: Callable[[str], None]) -> None:
    page = results_file.parent / "index.html"
    page.write_text(build_report(res, TITLES))
    out(f"wrote {page}")


def main(argv: Optional[list[str]] = None, env: Optional[dict] = None, out: Callable[[str], None] = print,
         factory=default_factory, fetch: Callable[[str], bytes] = fetch_bytes,
         head: Callable[[str], dict] = head_url, transport: Optional[httpx.BaseTransport] = None, **runtime) -> int:
    args = parser().parse_args(argv)
    env = os.environ if env is None else env
    if args.report_only:
        if not args.out.exists():
            out(f"no results file at {args.out}")
            return 2
        write_report(json.loads(args.out.read_text()), args.out, out)
        return 0
    only = [i for i in args.only.split(",") if i]
    if bad := [i for i in only if i not in ITEMS]:
        out(f"unknown items: {', '.join(bad)}")
        return 2
    sheet = load_sheet("runway")
    rows = plan(sheet, only)
    inputs = {"--image-url": args.image_url, "--input-url": args.input_url}

    out(f"{KEY_ENV}: {key_status(env)}")
    out("plan:")
    for r in rows:
        need = NEEDS.get(r["item"])
        note = f"   needs {need}" if need and not inputs[need] else ""
        if reason := blocked_reason(r["item"], args.image_url, args.input_url):
            r["est_usd"], note = 0.0, f"   BLOCKED: {reason}"
        elif r["item"] == "e" and args.image_url and not is_https(args.image_url):
            note = f"   {UPLOAD_NOTE}"
        out(f"  {r['item']}  {r['title']:<44} {r['jobs']:>2} jobs  ~${r['est_usd']:.2f}{note}")
    total = sum(r["est_usd"] for r in rows)
    out(f"estimated cost: ${total:.2f}   cap: ${args.max_usd:.2f}   audio: off on every video")
    if not args.live:
        out("dry run: nothing was sent. Add --live to spend.")
        return 0

    key = env.get(KEY_ENV)
    if not key:
        out(f"refusing to go live: {KEY_ENV} is missing. {KEY_HELP}")
        return 2
    if missing := sorted({NEEDS[i] for i in only if i in NEEDS and not inputs[NEEDS[i]]}):
        out(f"refusing to go live: the chosen items need {', '.join(missing)}")
        return 2

    assets, tap = Assets(), Tap(runtime.get("clock", time.monotonic))
    runner = Runner(factory(key, assets, tap), Budget(args.max_usd), tap=tap, **runtime)
    ctx = Ctx(runner, assets, key, factory, args, fetch, head, make_client(transport=transport))
    items: dict[str, dict] = {}
    for stage in STAGES:
        names = [i for i in stage if i in only]
        for name, result in zip(names, ctx.map(lambda n: run_item(n, ctx), names)):
            items[name] = result
            out(f"  {name}  {TITLES[name]}: {result['status']}")
    res = {"generated_at": datetime.now(timezone.utc).isoformat(timespec="seconds"), "live": True,
           "max_usd": args.max_usd, "estimated_usd": round(total, 2), "spent_usd": round(runner.budget.spent, 2),
           "inputs": {"image_url": args.image_url and redact_url(args.image_url),
                      "input_url": args.input_url and redact_url(args.input_url)},
           "items": dict(sorted(items.items()))}
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(res, indent=2) + "\n")
    text = summary(res)
    args.out.with_suffix(".md").write_text(text + "\n")
    write_report(res, args.out, out)
    out(text)
    out(f"wrote {args.out}")
    return 1 if any(r["status"] in ("error", "incomplete", "skipped") for r in items.values()) else 0


if __name__ == "__main__":
    sys.exit(main())
