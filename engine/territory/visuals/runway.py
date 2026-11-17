"""The Runway client for frames. Runway docs read 2026-11-17 (https://docs.dev.runwayml.com, openapi.json): POST /v1/text_to_image
with {model, promptText, ratio, referenceImages:[{uri, tag?, subject?}]} (up to 14 for the gemini image models, uri an https URL,
a runway:// upload or a data URI under 5MB), answer {id, estimatedCost}; then poll GET /v1/tasks/{id} until SUCCEEDED (output: [url])
or FAILED. Statuses: PENDING, THROTTLED, RUNNING, SUCCEEDED, FAILED, CANCELLED. Credits are $0.01 each.

Rules kept here: the key is read ONLY from the environment variable RUNWAYML_API_SECRET (no .env file, no fallback name) and is
never printed or stored; a cost card comes first and nothing goes live without the caller's explicit yes; a manifest makes a re-run
idempotent (a task that exists is polled, not created again; a saved frame is skipped)."""
from __future__ import annotations

import json
import os
import time
import urllib.error
import urllib.request
from pathlib import Path

API = "https://api.dev.runwayml.com/v1"
VERSION = "2024-11-06"
KEY_ENV = "RUNWAYML_API_SECRET"
RATIO = "1344:768"
USD_PER_CREDIT = 0.01
#: quick: every territory; best: the --shortlist ones. (model id, credits per 1K frame, short name for file names)
MODELS = {"quick": ("gemini_image3.1_flash", 7, "flash"), "best": ("gemini_image3_pro", 20, "pro")}
MAX_REFERENCES = 14


class RunwayError(Exception):
    def __init__(self, msg: str, status: int | None = None):
        super().__init__(msg)
        self.status = status


def api_key(environ=None) -> str:
    """The key, from the environment only. Never reads a .env file, never prints the value."""
    key = (os.environ if environ is None else environ).get(KEY_ENV, "").strip()
    if not key:
        raise RunwayError(f"{KEY_ENV} is not set in the environment. Export it in your shell for this run; this tool never reads .env files.")
    return key


def _urllib_transport(method: str, url: str, headers: dict, body: bytes | None, timeout: float = 120.0) -> tuple[int, bytes]:
    req = urllib.request.Request(url, data=body, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return r.status, r.read()
    except urllib.error.HTTPError as e:
        return e.code, e.read()


class Client:
    """``transport(method, url, headers, body) -> (status, bytes)`` is injectable: tests pass a fake Runway."""

    def __init__(self, key: str, transport=None):
        self._key, self._transport = key, transport or _urllib_transport

    def _scrub(self, text: str) -> str:
        return text.replace(self._key, "***") if self._key else text

    def _json(self, method: str, path: str, body: dict | None = None) -> dict:
        headers = {"Authorization": f"Bearer {self._key}", "X-Runway-Version": VERSION, "Content-Type": "application/json"}
        status, raw = self._transport(method, f"{API}{path}", headers, json.dumps(body).encode() if body is not None else None)
        if status >= 300:
            raise RunwayError(self._scrub(f"Runway said {status} on {method} {path}: {raw.decode('utf-8', 'replace')[:300]}"), status)
        return json.loads(raw or b"{}")

    def create(self, model: str, prompt: str, refs: list[dict]) -> dict:
        if len(refs) > MAX_REFERENCES:
            raise RunwayError(f"{len(refs)} reference images: Runway takes at most {MAX_REFERENCES}")
        body = {"model": model, "promptText": prompt, "ratio": RATIO}
        if refs:
            body["referenceImages"] = refs
        return self._json("POST", "/text_to_image", body)

    def task(self, task_id: str) -> dict:
        return self._json("GET", f"/tasks/{task_id}")

    def download(self, url: str) -> bytes:
        """The output URL is a signed link: fetched without the Runway key."""
        status, raw = self._transport("GET", url, {}, None)
        if status >= 300:
            raise RunwayError(f"download failed with {status}", status)
        return raw


# ----------------------------------------------------------------------------------------------------- jobs and the card

def job_key(tid: str, shot: str, kind: str) -> str:
    return f"{tid}-{shot}-{MODELS[kind][2]}"


def frame_file(key: str) -> str:
    return key + ".png"


def load_manifest(vdir: Path) -> dict:
    p = vdir / "manifest.json"
    return json.loads(p.read_text()) if p.exists() else {"frames": {}}


def save_manifest(vdir: Path, manifest: dict) -> None:
    vdir.mkdir(parents=True, exist_ok=True)
    tmp = vdir / "manifest.json.tmp"
    tmp.write_text(json.dumps(manifest, indent=1, ensure_ascii=False))
    tmp.replace(vdir / "manifest.json")


def state(job: dict, manifest: dict, vdir: Path) -> str:
    """saved: a frame is on disk, skip it. polling: a task exists, poll it (no new charge). new: create a task."""
    e = (manifest.get("frames") or {}).get(job["key"])
    if e and e.get("file") and (vdir / e["file"]).exists():
        return "saved"
    if e and e.get("task") and e.get("status") not in ("FAILED", "CANCELLED"):
        return "polling"
    return "new"


def cost_card(jobs: list[dict], manifest: dict, vdir: Path, plan_usd: float | None = None, refs: int = 0) -> dict:
    rows, total = [], 0
    for kind, (model, credits, _) in MODELS.items():
        mine = [j for j in jobs if j["kind"] == kind]
        if not mine:
            continue
        new = sum(state(j, manifest, vdir) == "new" for j in mine)
        rows.append({"model": model, "kind": kind, "frames": len(mine), "new": new, "saved": sum(state(j, manifest, vdir) == "saved" for j in mine),
                     "polling": sum(state(j, manifest, vdir) == "polling" for j in mine), "credits_each": credits, "credits": new * credits})
        total += new * credits
    return {"rows": rows, "credits": total, "usd": round(total * USD_PER_CREDIT, 2), "plan_usd": plan_usd, "reference_images": refs,
            "estimated": True, "note": "Credits at Runway's published 1K price ($0.01 a credit). Reference images are not billed separately on that page; "
                                       "the manifest records each task's estimatedCost from Runway so you can check."}


def render_card(card: dict) -> str:
    lines = ["RUNWAY COST CARD (estimate; a live run needs --live --yes-cost)"]
    if card.get("plan_usd") is not None:
        lines.append(f"  frame plan   1 model call (Claude)             ~${card['plan_usd']:.2f}")
    for r in card["rows"]:
        lines.append(f"  {r['model']:<24} {r['new']:>3} new x {r['credits_each']:>2} credits = {r['credits']:>4} credits"
                     f"   ({r['saved']} saved, {r['polling']} already running, skipped)")
    lines.append(f"  {card['reference_images']} reference image(s) sent with every frame")
    total_usd = card["usd"] + (card.get("plan_usd") or 0)
    lines.append(f"  total        {card['credits']} credits = ${card['usd']:.2f}" + (f", plus the plan call: about ${total_usd:.2f}" if card.get("plan_usd") is not None else ""))
    return "\n".join(lines)


# ------------------------------------------------------------------------------------------------------------ generation

def generate(client: Client, jobs: list[dict], vdir: Path, manifest: dict, refs: list[dict], sleep=time.sleep,
             poll_every: float = 4.0, max_rounds: int = 120, log=print) -> dict:
    """Create the tasks that do not exist, then poll all of them. Idempotent: run it again to pick up anything still running."""
    frames = manifest.setdefault("frames", {})
    made = polled = 0
    stopped = None
    for j in jobs:
        s = state(j, manifest, vdir)
        if s != "new":
            continue
        if stopped:
            continue
        prior = frames.get(j["key"]) or {}
        try:
            t = client.create(MODELS[j["kind"]][0], j["prompt"], refs)
        except RunwayError as e:
            frames[j["key"]] = {**_entry(j), "status": "FAILED", "error": str(e), "attempts": prior.get("attempts", 0) + 1}
            save_manifest(vdir, manifest)
            log(f"{j['key']}: not created: {e}")
            if e.status == 429:
                stopped = "Runway is rate limiting: run this again later to create the rest"
            continue
        est = (t.get("estimatedCost") or {}).get("credits")
        frames[j["key"]] = {**_entry(j), "task": t["id"], "status": "PENDING", "estimated_credits": est, "attempts": prior.get("attempts", 0) + 1}
        save_manifest(vdir, manifest)          # before polling: a crash now cannot lose the task id and create a duplicate
        made += 1
    todo = [j for j in jobs if state(j, manifest, vdir) == "polling"]
    for _ in range(max_rounds):
        if not todo:
            break
        still = []
        for j in todo:
            e = frames[j["key"]]
            try:
                t = client.task(e["task"])
            except RunwayError as err:
                log(f"{j['key']}: could not poll: {err}")
                still.append(j)
                continue
            polled += 1
            e["status"] = t.get("status")
            if t.get("status") == "SUCCEEDED":
                try:
                    data = client.download((t.get("output") or [""])[0])
                except RunwayError as err:
                    log(f"{j['key']}: finished but not downloaded ({err}): run again to retry")
                    still.append(j)
                    continue
                (vdir / frame_file(j["key"])).write_bytes(data)
                e["file"] = frame_file(j["key"])
                e["cost_credits"] = (t.get("cost") or {}).get("credits") if isinstance(t.get("cost"), dict) else t.get("cost")
                log(f"{j['key']}: saved")
            elif t.get("status") in ("FAILED", "CANCELLED"):
                e["error"] = str(t.get("failure") or t.get("failureCode") or t.get("status"))
                log(f"{j['key']}: {t.get('status')} {e['error']}")
            else:
                still.append(j)
            save_manifest(vdir, manifest)
        todo = still
        if todo:
            sleep(poll_every)
    return {"created": made, "polled": polled, "still_running": [j["key"] for j in todo], "stopped": stopped}


def _entry(j: dict) -> dict:
    return {"territory": j["tid"], "shot": j["shot"], "tier": j["kind"], "model": MODELS[j["kind"]][0], "credits": MODELS[j["kind"]][1],
            "prompt": j["prompt"]}
