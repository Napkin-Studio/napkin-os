#!/usr/bin/env python3
"""The delayering test batch on Runway (features/delayering.clan; research section 8, Q1-Q8 and Q11).

A DRY RUN by default: it prints the plan and the estimated credits and sends nothing.
Pass --live to spend money. --max-usd (default 3) is a hard cap: a job that would pass it is not
submitted. Nothing here retries a failed or moderated job.

The key is read only from the environment (RUNWAYML_API_SECRET, or RUNWAY_API_KEY as .env names it)
and printed only as "set (N chars)". Load it first with

    set -a; source .env; set +a

(this script never opens .env). Run it against the API directly, never through the live relay.

Items (--only a,b picks some; the default is every item except q8):
  p    a packshot (gpt_image_2, low, opaque): the input for q2 and q11
  s    a scene, a mug centred on a table with a shadow (gpt_image_2, low): the input for q3, q4, q8
  q1   gpt_image_2 low with background transparent: does Runway's proxy accept it, and what is the
       alpha (255, or 252-254 with a grey fringe)?
  q2   gpt_image_2_5_sunburst transparent with the packshot as a tagged reference, low then high:
       is the cut-out faithful to the packshot (label, colours), or a re-interpretation? (eyes)
  q3   ideogram_4_5 with maskUri (black = edit) over the mug and its shadow, medium, without and
       with preciseEdit: a clean plate with nothing invented (eyes), and the size it returns
  q4   seedream5_pro 1K with the scene as Figure 1: a <bbox> tagged removal against plain words (eyes)
  q6   magnific_precision_upscaler_v2 x2 on the q1 PNG: is the alpha kept?
  q7   seedream5_flash with the q1 PNG as Figure 1: is the alpha kept or flattened, and to what colour?
  q11  bria_fibo_edit_1_5 "remove the background" on the packshot: alpha, or a flat colour?
  q8   (--with-q8) a 2 s wan3 clip from the scene, then aleph2 with the q3 clean plate as a keyframe at
       0 s: does everything outside the removed mug stay as it was? (eyes)

Later items read earlier outputs from disk, so they can run on their own once p, s, q1 and q3 exist.
--mask-box x0,y0,x1,y1 (0-1 of the scene) sets q3's mask after a look at the scene.

Outputs: results/outputs/delayer/<item>/<label>.<ext> (git-ignored). Summary: results/delayer-tests.json
and results/delayer-tests.md, with an alpha report for every PNG that came back.
"""

from __future__ import annotations

import argparse
import base64
import io
import json
import os
import sys
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

import httpx
from PIL import Image, ImageDraw

HERE = Path(__file__).resolve().parent
RELAY = HERE.parent
for p in (str(HERE), str(RELAY)):
    if p not in sys.path:
        sys.path.insert(0, p)

from runway_common import Budget, BudgetExceeded, ephemeral_upload, make_client, scrub, write_file  # noqa: E402
from providers.runway import BASE_URL, USD_PER_CREDIT, VERSION  # noqa: E402

KEYS = ("RUNWAYML_API_SECRET", "RUNWAY_API_KEY")
KEY_HELP = "Put the key in the environment first:  set -a; source .env; set +a   (this script never opens .env)"
OUT = RELAY / "results" / "outputs" / "delayer"
SUMMARY = RELAY / "results" / "delayer-tests.json"
SUMMARY_MD = RELAY / "results" / "delayer-tests.md"
POLL_S = 5
TIMEOUT_S = {"image": 420, "video": 900}
DATA_URI_MAX = 5 * 1024 * 1024
SQUARE = "1920:1920"  # the smallest square gpt_image_2 lists; 1 credit at low
WORK_PX = 1024  # the scene as the edit models see it; the mask is this size too

# Credits at list price (docs.dev.runwayml.com/guides/pricing, read into the 2026-10-15 catalogue);
# bria_fibo_edit_1_5 is undocumented, so it is estimated high. The cap reserves these before a submit.
EST = {"p": 1, "s": 1, "q1": 1, "q2": 19, "q3": 16, "q4": 10, "q6": 25, "q7": 2, "q11": 10, "q8": 66}
DEFAULT_ITEMS = ["p", "s", "q1", "q2", "q3", "q4", "q6", "q7", "q11"]
MASK_BOX = (0.22, 0.12, 0.84, 0.92)

PACK_WORDS = ("Product packshot: a clear glass bottle of sparkling water with a bright blue label that reads "
              "LUMEN in white capital letters and the smaller line 'naturally sparkling' under it, on a plain "
              "white background, soft studio light, the whole bottle centred and fully visible.")
SCENE_WORDS = ("A single red ceramic mug centred on a plain wooden table by a window. Soft morning light from "
               "the left casts one clear soft shadow to the right of the mug. Nothing else on the table. "
               "Photographic, natural colours.")


def api_key(env: dict) -> Optional[str]:
    for k in KEYS:
        if env.get(k):
            return env[k]
    return None


def key_status(env: dict) -> str:
    key = api_key(env)
    return f"set ({len(key)} chars)" if key else "missing"


def now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


# Pictures in and out

def data_uri(data: bytes, mime: str = "image/png") -> str:
    """A data URI under Runway's 5 MB limit. A PNG with alpha is shrunk, never flattened, so a transparent
    input stays transparent (runway_common.fit_image flattens onto white, which these tests must not)."""
    while len(data) * 4 // 3 + 32 > DATA_URI_MAX:
        img = Image.open(io.BytesIO(data))
        img = img.resize((max(1, img.width * 3 // 4), max(1, img.height * 3 // 4)), Image.LANCZOS)
        out = io.BytesIO()
        img.save(out, format="PNG")
        data = out.getvalue()
    return f"data:{mime};base64," + base64.b64encode(data).decode()


def to_work_png(data: bytes, side: int = WORK_PX) -> bytes:
    """The picture as an RGB PNG of `side` x `side` (the scene is square), for the edit models."""
    img = Image.open(io.BytesIO(data)).convert("RGB").resize((side, side), Image.LANCZOS)
    out = io.BytesIO()
    img.save(out, format="PNG")
    return out.getvalue()


def box_mask(size: tuple[int, int], box: tuple[float, float, float, float]) -> bytes:
    """Ideogram's convention: black = edit, white = keep; the mask is the first reference's size."""
    w, h = size
    img = Image.new("L", (w, h), 255)
    ImageDraw.Draw(img).rectangle((round(box[0] * w), round(box[1] * h), round(box[2] * w), round(box[3] * h)), fill=0)
    out = io.BytesIO()
    img.convert("RGB").save(out, format="PNG")
    return out.getvalue()


def alpha_report(path: Path) -> dict:
    """What the file's alpha says: none at all, all 255, or the 252-254 the OpenAI reports describe,
    plus the colour under the soft edge (a grey fringe shows there) and the corners (a flattened
    transparency shows there)."""
    img = Image.open(path)
    rep: dict = {"mode": img.mode, "size": list(img.size), "format": img.format}
    rgba = img.convert("RGBA")
    a = rgba.getchannel("A")
    hist = a.histogram()
    total = sum(hist)
    rep["has_alpha_channel"] = img.mode in ("RGBA", "LA", "PA") or "transparency" in img.info
    rep["alpha"] = {
        "fully_transparent": hist[0] / total,
        "fully_opaque": hist[255] / total,
        "252_254": sum(hist[252:255]) / total,
        "partial_1_251": sum(hist[1:252]) / total,
        "max_opaque_value": max((i for i, n in enumerate(hist) if n), default=0),
    }
    px = rgba.load()
    w, h = rgba.size
    edge = [px[x, y][:3] for y in range(0, h, 4) for x in range(0, w, 4) if 0 < px[x, y][3] < 255]
    if edge:
        rep["soft_edge_mean_rgb"] = [round(sum(c[i] for c in edge) / len(edge)) for i in range(3)]
        rep["soft_edge_pixels_sampled"] = len(edge)
    rep["corners_rgba"] = [list(px[x, y]) for x, y in ((2, 2), (w - 3, 2), (2, h - 3), (w - 3, h - 3))]
    return rep


def ext_of(url: str, content_type: str) -> str:
    for ext in ("png", "jpg", "jpeg", "webp", "mp4", "mov", "zip"):
        if f".{ext}" in url.lower():
            return "jpg" if ext == "jpeg" else ext
    return {"image/png": "png", "image/jpeg": "jpg", "image/webp": "webp", "video/mp4": "mp4"}.get(content_type.split(";")[0], "bin")


# The API

class Runway:
    def __init__(self, key: str, budget: Budget, live: bool, log):
        self.key, self.budget, self.live, self.log = key, budget, live, log
        self.client = make_client()
        self.records: list[dict] = []

    def _headers(self) -> dict:
        return {"Authorization": f"Bearer {self.key}", "X-Runway-Version": VERSION}

    def _get(self, path: str) -> dict:
        resp = self.client.get(BASE_URL + path, headers=self._headers(), timeout=60)
        if resp.status_code >= 300:
            raise RuntimeError(f"GET {path}: {resp.status_code} {scrub(resp.text[:300])}")
        return resp.json()

    def upload(self, data: bytes, mime: str, filename: str) -> str:
        """Runway's ephemeral store (free): the way a clip reaches video_to_video."""
        return ephemeral_upload(self.client, self.key, data, mime, filename)

    def run(self, item: str, label: str, path: str, body: dict, est_credits: int, kind: str = "image") -> dict:
        """Submit, wait, settle the cap with the real cost, save the outputs. One record per job."""
        shown = {k: (f"<{len(v)} data-uri chars>" if isinstance(v, str) and v.startswith("data:") else v) for k, v in body.items()}
        for k in ("referenceImages", "keyframes", "promptImage"):
            if isinstance(shown.get(k), list):
                shown[k] = [{kk: (f"<{len(vv)} data-uri chars>" if isinstance(vv, str) and vv.startswith("data:") else vv)
                             for kk, vv in e.items()} if isinstance(e, dict) else e for e in shown[k]]
        rec = {"item": item, "label": label, "path": path, "body": shown, "est_credits": est_credits, "started": now()}
        self.records.append(rec)
        if not self.live:
            rec["status"] = "dry-run"
            self.log(f"  {item}/{label}: would POST {path} ({est_credits} credits est.)")
            return rec
        est_usd = est_credits * USD_PER_CREDIT
        try:
            self.budget.reserve(est_usd)
        except BudgetExceeded as exc:
            rec["status"] = "not-submitted"
            rec["failure"] = f"spend cap: {exc}"
            self.log(f"  {item}/{label}: not submitted, {exc}")
            return rec
        t0 = time.monotonic()
        resp = self.client.post(BASE_URL + path, headers=self._headers(), json=body, timeout=60)
        if resp.status_code >= 300:
            self.budget.release(est_usd)
            rec["status"] = "rejected"
            rec["http"] = resp.status_code
            rec["failure"] = scrub(resp.text[:600])
            self.log(f"  {item}/{label}: rejected {resp.status_code}: {rec['failure'][:200]}")
            return rec
        task_id = resp.json().get("id")
        rec["task_id"] = task_id
        self.log(f"  {item}/{label}: task {task_id}")
        deadline = t0 + TIMEOUT_S[kind]
        seen: list[str] = []
        task: dict = {}
        while time.monotonic() < deadline:
            time.sleep(POLL_S)
            task = self._get(f"/v1/tasks/{task_id}")
            status = task.get("status")
            if not seen or seen[-1] != status:
                seen.append(status)
            if status in ("SUCCEEDED", "FAILED", "CANCELLED"):
                break
        rec["elapsed_s"] = round(time.monotonic() - t0, 1)
        rec["raw_statuses"] = seen
        credits = (task.get("cost") or {}).get("credits")
        rec["credits"] = credits
        self.budget.settle(est_usd, None if credits is None else credits * USD_PER_CREDIT)
        if task.get("status") != "SUCCEEDED":
            rec["status"] = "failed" if task.get("status") == "FAILED" else f"ended {task.get('status')}"
            rec["failure"] = scrub(str(task.get("failure") or task.get("failureCode") or "no detail"))
            self.log(f"  {item}/{label}: {rec['status']} after {rec['elapsed_s']} s: {rec['failure'][:200]}")
            return rec
        rec["status"] = "done"
        rec["outputs"] = []
        for i, url in enumerate(task.get("output") or []):
            r = self.client.get(url, timeout=120)
            r.raise_for_status()
            ext = ext_of(url, r.headers.get("content-type", ""))
            dest = OUT / item / f"{label}{'' if i == 0 else f'-{i + 1}'}.{ext}"
            write_file(dest, r.content)
            o = {"file": str(dest.relative_to(RELAY)), "bytes": len(r.content)}
            if ext in ("png", "jpg", "webp"):
                try:
                    o["alpha_report"] = alpha_report(dest)
                except Exception as exc:  # a report is a nicety; the file is the result
                    o["alpha_report_error"] = str(exc)
            rec["outputs"].append(o)
        self.log(f"  {item}/{label}: done in {rec['elapsed_s']} s, {credits} credits, {len(rec['outputs'])} file(s)")
        return rec


# Inputs that items share

def saved(item: str, label: str, ext: str = "png") -> Optional[Path]:
    p = OUT / item / f"{label}.{ext}"
    return p if p.exists() else None


def need(item: str, label: str, what: str) -> bytes:
    p = saved(item, label)
    if not p:
        raise SystemExit(f"{what} is missing ({OUT / item / (label + '.png')}): run the item that makes it first")
    return p.read_bytes()


# Items

def item_p(rw: Runway) -> None:
    rw.run("p", "packshot", "/v1/text_to_image",
           {"model": "gpt_image_2", "promptText": PACK_WORDS, "ratio": SQUARE, "quality": "low",
            "background": "opaque", "outputCount": 1}, EST["p"])


def item_s(rw: Runway) -> None:
    rw.run("s", "scene", "/v1/text_to_image",
           {"model": "gpt_image_2", "promptText": SCENE_WORDS, "ratio": SQUARE, "quality": "low",
            "background": "opaque", "outputCount": 1}, EST["s"])


def item_q1(rw: Runway) -> None:
    rw.run("q1", "apple-transparent", "/v1/text_to_image",
           {"model": "gpt_image_2", "promptText": "A single green apple with one leaf, isolated, nothing else.",
            "ratio": SQUARE, "quality": "low", "background": "transparent", "outputCount": 1}, EST["q1"])


def item_q2(rw: Runway) -> None:
    pack = data_uri(need("p", "packshot", "the packshot (item p)"))
    words = ("@pack exactly as it is: the same bottle, the same blue label with LUMEN and 'naturally sparkling', "
             "the same colours and proportions, isolated on a transparent background, no shadow, no surface.")
    for quality, est in (("low", 2), ("high", 17)):
        rw.run("q2", f"sunburst-{quality}", "/v1/text_to_image",
               {"model": "gpt_image_2_5_sunburst", "promptText": words, "ratio": SQUARE, "quality": quality,
                "background": "transparent", "referenceImages": [{"uri": pack, "tag": "pack"}], "outputCount": 1}, est)


def item_q3(rw: Runway, box: tuple[float, float, float, float]) -> None:
    scene = to_work_png(need("s", "scene", "the scene (item s)"))
    write_file(OUT / "q3" / "scene-1024.png", scene)
    mask = box_mask((WORK_PX, WORK_PX), box)
    write_file(OUT / "q3" / "mask.png", mask)
    words = ("Remove the mug and its shadow. Continue the wooden table, the window light and the background "
             "exactly as they are. Do not add any object.")
    base = {"model": "ideogram_4_5", "promptText": words, "referenceImages": [{"uri": data_uri(scene)}],
            "maskUri": data_uri(mask), "quality": "medium", "outputCount": 1}
    rw.run("q3", "cleanplate", "/v1/text_to_image", base, 8)
    rw.run("q3", "cleanplate-precise", "/v1/text_to_image", {**base, "preciseEdit": True}, 8)


def item_q4(rw: Runway, box: tuple[float, float, float, float]) -> None:
    scene = data_uri(to_work_png(need("s", "scene", "the scene (item s)")))
    b = [round(v * 999) for v in box]
    tagged = (f"Figure 1: remove the red mug inside <bbox>{b[0]} {b[1]} {b[2]} {b[3]}</bbox> and continue the table "
              "and the background behind it. Change nothing else.")
    plain = "Figure 1: remove the red mug and its shadow and continue the table and the background behind it. Change nothing else."
    for label, words in (("bbox-tagged", tagged), ("plain-words", plain)):
        rw.run("q4", label, "/v1/text_to_image",
               {"model": "seedream5_pro", "promptText": words, "ratio": "1024:1024", "outputFormat": "png",
                "referenceImages": [{"uri": scene}], "outputCount": 1}, 5)


def transparent_input() -> bytes:
    """A PNG with alpha from an earlier item: q1's apple, else q2's low Sunburst cut-out (q1 failed on
    2026-10-23: Runway lists `transparent` for gpt_image_2 but the task ends in 'invalid input')."""
    for item, label in (("q1", "apple-transparent"), ("q2", "sunburst-low"), ("q2", "sunburst-high")):
        p = saved(item, label)
        if p and alpha_report(p).get("has_alpha_channel"):
            return p.read_bytes()
    raise SystemExit("no transparent PNG yet: run q1 or q2 first")


def item_q6(rw: Runway) -> None:
    png = transparent_input()
    rw.run("q6", "upscale-x2", "/v1/image_upscale",
           {"model": "magnific_precision_upscaler_v2", "imageUri": data_uri(png), "scaleFactor": 2}, EST["q6"])


def item_q7(rw: Runway) -> None:
    png = transparent_input()
    rw.run("q7", "flash-passthrough", "/v1/text_to_image",
           {"model": "seedream5_flash",
            "promptText": "Output Figure 1 exactly as it is, unchanged, with the same transparent background.",
            "ratio": "1024:1024", "outputFormat": "png", "referenceImages": [{"uri": data_uri(png)}], "outputCount": 1}, EST["q7"])


def item_q11(rw: Runway) -> None:
    pack = data_uri(need("p", "packshot", "the packshot (item p)"))
    rw.run("q11", "fibo-remove-bg", "/v1/text_to_image",
           {"model": "bria_fibo_edit_1_5", "promptText": "Remove the background and make it transparent. Keep the bottle exactly as it is.",
            "outputFormat": "png", "referenceImages": [{"uri": pack}]}, EST["q11"])


def item_q8(rw: Runway) -> None:
    scene = to_work_png(need("s", "scene", "the scene (item s)"))
    plate_path = saved("q3", "cleanplate")
    if not plate_path:
        raise SystemExit("q8 needs q3's clean plate first")
    clip = rw.run("q8", "clip", "/v1/image_to_video",
                  {"model": "wan3", "promptImage": [{"uri": data_uri(scene), "position": "first"}],
                   "promptText": "The camera holds still on the mug. Nothing moves except a faint drift of the window light.",
                   "duration": 2, "ratio": "auto_480p", "audio": False}, 10, kind="video")
    if clip.get("status") != "done" or not clip.get("outputs"):
        rw.log("  q8: no clip, aleph2 not run")
        return
    clip_bytes = (RELAY / clip["outputs"][0]["file"]).read_bytes()
    video_uri = rw.upload(clip_bytes, "video/mp4", "delayer-q8.mp4") if rw.live else "runway://dry-run"
    rw.run("q8", "aleph2-keyframe", "/v1/video_to_video",
           {"model": "aleph2", "videoUri": video_uri,
            "promptText": "Keep the video exactly as it is, except that the mug is gone: the table, the window and the light stay as they are.",
            "keyframes": [{"uri": data_uri(plate_path.read_bytes()), "seconds": 0}], "seed": 7}, 56, kind="video")


# The summary

def write_summary(rw: Runway, args, started: str) -> None:
    SUMMARY.parent.mkdir(parents=True, exist_ok=True)
    doc = {"started": started, "finished": now(), "live": args.live, "max_usd": args.max_usd,
           "spent_usd": round(rw.budget.spent, 4) if hasattr(rw.budget, "spent") else None,
           "mask_box": list(args.mask_box), "items": args.only, "records": rw.records}
    SUMMARY.write_text(json.dumps(doc, indent=2) + "\n")
    lines = [f"# Delayering tests on Runway ({started[:10]})", "",
             f"{'Live' if args.live else 'Dry'} run; cap ${args.max_usd}. Outputs under results/outputs/delayer/.", "",
             "| Item | Label | Status | Credits | Seconds | Size | Alpha | File |", "|---|---|---|---|---|---|---|---|"]
    for r in rw.records:
        outs = r.get("outputs") or [{}]
        for o in outs:
            rep = o.get("alpha_report") or {}
            al = rep.get("alpha") or {}
            alpha = ("no alpha channel" if rep and not rep.get("has_alpha_channel") else
                     f"transparent {al.get('fully_transparent', 0):.0%}, opaque {al.get('fully_opaque', 0):.0%}, 252-254 {al.get('252_254', 0):.1%}, max {al.get('max_opaque_value')}" if al else "")
            size = "x".join(map(str, rep.get("size", []))) if rep else ""
            lines.append(f"| {r['item']} | {r['label']} | {r.get('status')}{(' (' + str(r.get('failure'))[:80] + ')') if r.get('failure') else ''} | "
                         f"{r.get('credits', '')} | {r.get('elapsed_s', '')} | {size} | {alpha} | {o.get('file', '')} |")
    SUMMARY_MD.write_text("\n".join(lines) + "\n")


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--live", action="store_true", help="spend money (default: dry run)")
    ap.add_argument("--max-usd", type=float, default=3.0, help="hard spend cap in USD (default 3)")
    ap.add_argument("--only", default=",".join(DEFAULT_ITEMS), help="comma-separated items (default: all but q8)")
    ap.add_argument("--with-q8", action="store_true", help="add q8 (a wan3 clip, then aleph2 with a keyframe; about 66 credits)")
    ap.add_argument("--mask-box", default=",".join(map(str, MASK_BOX)), help="q3 and q4 box as x0,y0,x1,y1 in 0-1 of the scene")
    args = ap.parse_args()
    args.only = [s.strip() for s in args.only.split(",") if s.strip()]
    if args.with_q8 and "q8" not in args.only:
        args.only.append("q8")
    args.mask_box = tuple(float(v) for v in args.mask_box.split(","))
    key = api_key(os.environ)
    print(f"key: {key_status(os.environ)}; {'LIVE' if args.live else 'dry run'}; cap ${args.max_usd}; items {args.only}")
    est = sum(EST.get(i, 0) for i in args.only)
    print(f"estimated at list price: {est} credits (${est * USD_PER_CREDIT:.2f})")
    if args.live and not key:
        print(KEY_HELP, file=sys.stderr)
        return 2
    started = now()
    rw = Runway(key or "", Budget(args.max_usd), args.live, print)
    handlers = {"p": item_p, "s": item_s, "q1": item_q1, "q2": item_q2, "q3": lambda r: item_q3(r, args.mask_box),
                "q4": lambda r: item_q4(r, args.mask_box), "q6": item_q6, "q7": item_q7, "q11": item_q11, "q8": item_q8}
    failed = 0
    for item in args.only:
        if item not in handlers:
            print(f"unknown item {item}", file=sys.stderr)
            return 2
        print(f"[{item}]")
        try:
            handlers[item](rw)
        except SystemExit as exc:
            print(f"  skipped: {exc}")
            failed += 1
        except Exception as exc:  # one item's trouble must not lose the others' records
            print(f"  error: {scrub(str(exc))[:300]}")
            rw.records.append({"item": item, "status": "error", "failure": scrub(str(exc))[:600]})
            failed += 1
    write_summary(rw, args, started)
    print(f"summary: {SUMMARY.relative_to(RELAY)} and .md")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
