"""The Runway client, shared by the Territory tool (frames) and the Deck (pictures; deck-image-gen). Runway docs read 2026-11-17 (https://docs.dev.runwayml.com, openapi.json): POST /v1/text_to_image
with {model, promptText, ratio, referenceImages:[{uri, tag?, subject?}]} (up to 14 for the gemini image models, uri an https URL,
a runway:// upload or a data URI under 5MB), answer {id, estimatedCost}; then poll GET /v1/tasks/{id} until SUCCEEDED (output: [url])
or FAILED. Statuses: PENDING, THROTTLED, RUNNING, SUCCEEDED, FAILED, CANCELLED. Credits are $0.01 each.

Rules kept here: the key is read ONLY from the environment variable RUNWAYML_API_SECRET (no .env file, no fallback name) and is
never printed or stored; a cost card comes first and nothing goes live without the caller's explicit yes; a manifest makes a re-run
idempotent (a task that exists is polled, not created again; a saved frame is skipped)."""
from __future__ import annotations

import contextlib
import hashlib
import json
import math
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
#: The Deck's tiers, pinned in code (Sai, 17 Nov 2026): flash makes drafts, pro makes only approved heroes. There is no --model flag and a Style
#: Pack's models must equal this map (visuals.style, deck.imagegen.check_models).
TIER_MODEL = {"draft": "gemini_image3.1_flash", "hero": "gemini_image3_pro"}
TIER_SIZE = {"draft": "1K", "hero": "2K"}
#: Credits per picture by model and size (Runway's pricing page, read 17 Nov 2026): a 2K pro picture costs what a 1K one does.
PRICE = {"gemini_image3.1_flash": {"1K": 7}, "gemini_image3_pro": {"1K": 20, "2K": 20}}
#: The ratios each model and size offers (Runway openapi, read 17 Nov 2026). The Deck snaps a slot's aspect to one of these.
RATIO_SETS = {
    ("gemini_image3.1_flash", "1K"): ("1344:768", "1248:832", "1184:864", "1024:1024", "896:1152", "768:1344"),
    ("gemini_image3_pro", "1K"): ("1344:768", "1248:832", "1184:864", "1024:1024", "896:1152", "768:1344"),
    ("gemini_image3_pro", "2K"): ("2752:1536", "2528:1696", "2400:1792", "2048:2048", "1856:2304", "1536:2752"),
}
MAX_REFERENCES = 14
DEFAULT_MAX_USD = 2.0              # the Territory tool's lifetime cap for one run's frames (plan call plus every picture, every version); --max-usd lowers it
LIFETIME_CAP_USD = 2.5             # Sai, 17 Nov 2026 (the Deck's rule): no flag raises a run's frames above $2.50


def cap_ok(cap) -> bool:
    """A usable spend cap: a finite number above 0 and at most LIFETIME_CAP_USD. NaN passes every ``>`` check (so it would remove the cap)
    and infinity is no cap at all: both are refused, like 0, a negative and anything over $2.50."""
    try:
        c = float(cap)
    except (TypeError, ValueError):
        return False
    return math.isfinite(c) and 0 < c <= LIFETIME_CAP_USD + 1e-9
MAX_ATTEMPTS = 3                   # a frame that has failed this often is given up on until a person looks (no endless re-billing)
STOP_STATUSES = (401, 402, 403, 429)   # bad key, no credit, no access, rate limit: trying every other frame would only repeat it


def credits_for(model: str, size: str = "1K") -> int:
    """The table price of one picture, in credits. An unknown model or size is an error: nothing is priced by guess."""
    try:
        return PRICE[model][size]
    except KeyError:
        raise RunwayError(f"no price for {model} at {size}") from None


def snap(aspect: str, model: str, size: str = "1K") -> str:
    """The ratio a slot's aspect (``16:9``) becomes: the nearest in the model's size set by log-ratio distance, ties to the larger area.
    Only the six slot aspects are accepted; nothing is stretched (the renderer crops with cover)."""
    import math
    try:
        w, h = (int(x) for x in aspect.split(":"))
        cands = RATIO_SETS[(model, size)]
    except (ValueError, KeyError):
        raise RunwayError(f"cannot snap aspect {aspect!r} for {model} at {size}") from None
    want = math.log(w / h)
    area = lambda r: int(r.split(":")[0]) * int(r.split(":")[1])  # noqa: E731
    return min(cands, key=lambda r: (abs(math.log(int(r.split(":")[0]) / int(r.split(":")[1])) - want), -area(r)))


def request_key(model: str, ratio: str, prompt: str, ref_shas, rails_version: str, attempt: int = 1) -> str:
    """A job's key: ``j_`` and 16 hex of the SHA-256 over what makes the request what it is (model, ratio, the prompt with its whitespace
    normalised, the sorted SHA-256s of the references sent, the rails version, the attempt). The same request is the same job."""
    blob = json.dumps([model, ratio, " ".join(str(prompt).split()), sorted(ref_shas or []), str(rails_version), int(attempt)], ensure_ascii=False)
    return "j_" + hashlib.sha256(blob.encode()).hexdigest()[:16]


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

    def create(self, model: str, prompt: str, refs: list[dict], ratio: str = RATIO) -> dict:
        if len(refs) > MAX_REFERENCES:
            e = RunwayError(f"{len(refs)} reference images: Runway takes at most {MAX_REFERENCES}")
            e.pre_send = True   # refused before anything was sent
            raise e
        body = {"model": model, "promptText": prompt, "ratio": ratio}
        if refs:
            body["referenceImages"] = refs
        return self._json("POST", "/text_to_image", body)

    def task(self, task_id: str) -> dict:
        return self._json("GET", f"/tasks/{task_id}")

    def download(self, url: str) -> bytes:
        """The output URL is a signed link: fetched without the Runway key."""
        if not str(url).startswith("https://"):
            raise RunwayError("the output link is not https: not fetched")
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
    with open(tmp, "w") as f:                       # synced to disk: the "creating" marker must survive a crash or a power cut
        f.write(json.dumps(manifest, indent=1, ensure_ascii=False))
        f.flush()
        os.fsync(f.fileno())
    tmp.replace(vdir / "manifest.json")
    try:
        fd = os.open(vdir, os.O_RDONLY)
        try:
            os.fsync(fd)
        finally:
            os.close(fd)
    except OSError:
        pass


def state(job: dict, manifest: dict, vdir: Path) -> str:
    """saved: a frame is on disk, skip it. polling: a task exists, poll it (no new charge). unknown: a create was sent and we never
    saw the answer (timeout, dropped connection, a crash, a 5xx): it MAY be billed, so it is never created again automatically
    (--retry-unknown, after a fresh cost card). gave_up: failed MAX_ATTEMPTS times, left for a person. new: create a task."""
    e = (manifest.get("frames") or {}).get(job["key"])
    if e and e.get("file") and (vdir / e["file"]).exists():
        return "saved"
    if e and e.get("task") and e.get("status") not in ("FAILED", "CANCELLED"):
        return "polling"
    if e and not e.get("task") and e.get("status") in ("CREATING", "UNKNOWN"):
        return "unknown"
    if e and e.get("status") in ("FAILED", "CANCELLED") and (e.get("attempts") or 0) >= MAX_ATTEMPTS:
        return "gave_up"
    return "new"


def cost_card(jobs: list[dict], manifest: dict, vdir: Path, plan_usd: float | None = None, refs: int = 0, max_usd: float = DEFAULT_MAX_USD,
              spent_usd: float = 0.0, sends: int = 0, id_parts=()) -> dict:
    """The card a person reads before a live run. ``spent_usd`` is what this run has already cost over its lifetime (the ledger: every version,
    every attempt); the card is over the cap when that plus this card passes ``max_usd``. ``id`` is ``c_`` and 16 hex over exactly the jobs,
    their states and models, the plan call, the cap, the spend and the send count (and ``id_parts``): a yes is ``--yes-cost <id>``, and any
    send or change makes every earlier id stale."""
    rows, total = [], 0
    for kind, (model, credits, _) in MODELS.items():
        mine = [j for j in jobs if j["kind"] == kind]
        if not mine:
            continue
        new = sum(state(j, manifest, vdir) == "new" for j in mine)
        rows.append({"model": model, "kind": kind, "frames": len(mine), "new": new, "saved": sum(state(j, manifest, vdir) == "saved" for j in mine),
                     "polling": sum(state(j, manifest, vdir) == "polling" for j in mine), "gave_up": sum(state(j, manifest, vdir) == "gave_up" for j in mine),
                     "unknown": sum(state(j, manifest, vdir) == "unknown" for j in mine),
                     "credits_each": credits, "credits": new * credits})
        total += new * credits
    usd = round(total * USD_PER_CREDIT, 2)
    this = round(usd + (plan_usd or 0), 2)
    spent = round(float(spent_usd or 0), 4)
    cid = "c_" + hashlib.sha256(json.dumps(["territory-frames", [(j["key"], MODELS[j["kind"]][0], state(j, manifest, vdir)) for j in jobs], plan_usd, refs,
                                             max_usd, spent, int(sends), list(id_parts)], sort_keys=True, ensure_ascii=False, default=str).encode()).hexdigest()[:16]
    return {"id": cid, "rows": rows, "credits": total, "usd": usd, "plan_usd": plan_usd, "reference_images": refs, "max_usd": max_usd,
            "spent_usd": spent, "left_usd": round(max_usd - spent - this, 2),
            "total_usd": this, "over_cap": not cap_ok(max_usd) or not (spent + this <= max_usd + 1e-9),
            "estimated": True, "note": "Credits at Runway's published 1K price ($0.01 a credit). Reference images are not billed separately on that page; "
                                       "the manifest records each task's estimatedCost from Runway so you can check."}


def render_card(card: dict) -> str:
    cid = card.get("id") or "<card id>"
    lines = [f"RUNWAY COST CARD  card {cid}  (estimate; a live run needs --live --yes-cost {cid})"]
    if card.get("plan_usd") is not None:
        lines.append(f"  frame plan   1 model call (Claude)             ~${card['plan_usd']:.2f}")
    for r in card["rows"]:
        lines.append(f"  {r['model']:<24} {r['new']:>3} new x {r['credits_each']:>2} credits = {r['credits']:>4} credits"
                     f"   ({r['saved']} saved, {r['polling']} already running, skipped" + (f"; {r['gave_up']} given up after {MAX_ATTEMPTS} failed attempts: needs a person" if r.get("gave_up") else "")
                     + (f"; {r['unknown']} unknown" if r.get("unknown") else "") + ")")
    if any(r.get("unknown") for r in card["rows"]):
        lines.append("  UNKNOWN jobs: a create was sent and its answer never seen. They may already be billed: check the Runway dashboard. "
                     "They are never created again automatically; --retry-unknown --live --yes-cost re-creates them and puts them on this card.")
    lines.append(f"  {card['reference_images']} reference image(s) sent with every frame")
    lines.append(f"  total        {card['credits']} credits = ${card['usd']:.2f}" + (f", plus the plan call: about ${card['total_usd']:.2f}" if card.get("plan_usd") is not None else ""))
    lines.append(f"  spent        ${card.get('spent_usd', 0):.2f} already on this run (every version and attempt, from the ledger); "
                 f"left after this card ${card.get('left_usd', card['max_usd'] - card['total_usd']):.2f}")
    lines.append(f"  hard stop    cap ${card['max_usd']:.2f} for this run's lifetime (--max-usd lowers it; it never goes above ${LIFETIME_CAP_USD:.2f})"
                 + ("  ** THE CARD IS OVER THE CAP: nothing will run **" if card.get("over_cap") else ""))
    return "\n".join(lines)


# ------------------------------------------------------------------------------------------------------------ generation

def snapshot(e: dict) -> dict:
    """One earlier attempt of a frame, as it is kept in its ``history``: what was sent and what it cost, never dropped."""
    return {k: e.get(k) for k in ("task", "status", "estimated_credits", "cost_credits", "credits", "model", "sha256", "file", "error", "attempts", "guard",
                                  "prompt_sha256") if e.get(k) is not None}


def retire(e: dict) -> None:
    """Move a frame's current attempt into its history (a retry of a flagged or unknown frame): its credits stay counted."""
    if e.get("task") or e.get("status") in ("FAILED", "CANCELLED", "UNKNOWN", "CREATING", "SUCCEEDED"):
        e["history"] = list(e.get("history") or []) + [snapshot(e)]


def _ledger_spent(ledger) -> float:
    from . import jobs as _jobs                       # the Deck's ledger and spend rule, shared (jobs imports this module)
    return _jobs.spent_usd({"jobs": {}}, ledger)


def generate(client: Client, jobs: list[dict], vdir: Path, manifest: dict, refs: list[dict], sleep=time.sleep,
             poll_every: float = 4.0, max_rounds: int = 120, log=print, max_credits: float | None = None, ledger=None,
             cap_usd: float | None = None) -> dict:
    """Create the tasks that do not exist, then poll all of them. Idempotent: run it again to pick up anything still running.

    ``ledger`` (a ``visuals.jobs.Ledger``): every create is appended to it under its file lock BEFORE the POST, and with ``cap_usd`` the
    spend derived from it (every send ever made for this run, at the largest of the table price and Runway's estimate) is checked under
    that same lock, so a retry never hides the credits an earlier attempt cost and two processes cannot both take the last dollar.
    A frame made again keeps its earlier attempts in ``history``. A ``cap_usd`` that is not finite, not above 0 or over LIFETIME_CAP_USD
    is refused before anything is sent (``math.isfinite``: NaN would pass every comparison)."""
    if cap_usd is not None and not cap_ok(cap_usd):
        raise RunwayError(f"cap_usd {cap_usd!r} is not a cap: give a finite number above 0 and at most {LIFETIME_CAP_USD:.2f}. Nothing was sent.")
    frames = manifest.setdefault("frames", {})
    made = polled = 0
    unknown: list[str] = []
    stopped = None
    committed = 0.0                    # credits asked for in this call, by Runway's own estimate (or the card's price when it gave none)
    for j in jobs:
        s = state(j, manifest, vdir)
        if s != "new":
            continue
        if stopped:
            continue
        price = MODELS[j["kind"]][1]
        if max_credits is not None and committed + price > max_credits:
            stopped = f"credit cap reached ({committed:g} of {max_credits:g} credits committed): stopped before the next frame"
            continue
        prior = frames.get(j["key"]) or {}
        attempts = prior.get("attempts", 0) + 1
        history = list(prior.get("history") or [])
        if prior.get("task") or prior.get("status") in ("FAILED", "CANCELLED", "UNKNOWN", "CREATING"):
            history.append(snapshot(prior))    # an earlier attempt is kept with what it cost, never overwritten
        keep = {"history": history} if history else {}
        with (ledger.locked() if ledger is not None else contextlib.nullcontext()):
            if ledger is not None and cap_usd is not None:
                spent = _ledger_spent(ledger)
                if not (math.isfinite(spent) and spent + price * USD_PER_CREDIT <= cap_usd + 1e-9):
                    stopped = f"lifetime cap reached: ${spent:.2f} spent on this run of ${cap_usd:.2f}, and the next frame costs ${price * USD_PER_CREDIT:.2f}"
                    continue
            if ledger is not None:              # appended and synced BEFORE the POST: a send that never got an answer still counts
                ledger.append({"key": j["key"], "tier": j["kind"], "model": MODELS[j["kind"]][0], "table_credits": price, "state": "creating",
                               "send": attempts})
            frames[j["key"]] = {**_entry(j), "status": "CREATING", "attempts": attempts, **keep}
            save_manifest(vdir, manifest)          # synced BEFORE the POST: a crash or timeout from here on leaves a marker, never a clean slate
            try:
                t = client.create(MODELS[j["kind"]][0], j["prompt"], refs)
                task_id = t["id"]
            except RunwayError as e:
                if e.status is not None and e.status >= 500:         # the server may have taken the request before it failed
                    frames[j["key"]].update(status="UNKNOWN", error=str(e))
                    save_manifest(vdir, manifest)
                    log(f"{j['key']}: UNKNOWN, may be billed: {e}")
                    unknown.append(j["key"])
                    stopped = "Runway answered with a server error on a create: stopped; those jobs are unknown (not created again automatically)"
                    continue
                frames[j["key"]] = {**_entry(j), "status": "FAILED", "error": str(e), "attempts": attempts, **keep}
                save_manifest(vdir, manifest)
                log(f"{j['key']}: not created: {e}")
                if e.status in STOP_STATUSES:
                    stopped = ("Runway is rate limiting: run this again later to create the rest" if e.status == 429
                               else f"Runway refused the request ({e.status}: key, credit or access): stopped, nothing else tried")
                continue
            except (OSError, ValueError, KeyError, TypeError) as e:   # timeout, reset, no answer, an answer with no task id: it may exist and be billed
                frames[j["key"]].update(status="UNKNOWN", error=f"{type(e).__name__}: {e}")
                save_manifest(vdir, manifest)
                log(f"{j['key']}: UNKNOWN, the create was sent and no answer was seen ({type(e).__name__}); it may be billed and is NOT created again")
                unknown.append(j["key"])
                stopped = "a create got no answer (network): stopped; that job is unknown, not created again automatically"
                continue
            est = (t.get("estimatedCost") or {}).get("credits")
            frames[j["key"]] = {**_entry(j), "task": task_id, "status": "PENDING", "estimated_credits": est, "attempts": attempts, **keep}
            save_manifest(vdir, manifest)          # before polling: a crash now cannot lose the task id and create a duplicate
            if ledger is not None:
                ledger.append({"key": j["key"], "tier": j["kind"], "model": MODELS[j["kind"]][0], "table_credits": price, "estimated_credits": est,
                               "state": "polling", "task": task_id})
        made += 1
        committed += est if isinstance(est, (int, float)) else price
        if isinstance(est, (int, float)) and est > price * 1.5:
            stopped = f"Runway's estimate for {j['key']} is {est:g} credits, more than the card's {price}: stopped, check the price before going on"
    todo = [j for j in jobs if state(j, manifest, vdir) == "polling"]
    for _ in range(max_rounds):
        if not todo:
            break
        still = []
        for j in todo:
            e = frames[j["key"]]
            try:
                t = client.task(e["task"])
            except (RunwayError, OSError, ValueError) as err:   # a polling timeout or a dropped connection: the task is still there, poll again
                log(f"{j['key']}: could not poll: {type(err).__name__}: {err}")
                still.append(j)
                continue
            polled += 1
            e["status"] = t.get("status")
            if t.get("status") == "SUCCEEDED":
                try:
                    out = (t.get("output") or [None])[0]
                    if not out:
                        raise RunwayError("the task succeeded but gave no output URL")
                    data = client.download(out)
                except (RunwayError, OSError, ValueError) as err:
                    log(f"{j['key']}: finished but not downloaded ({err}): run again to retry")
                    still.append(j)
                    continue
                (vdir / frame_file(j["key"])).write_bytes(data)
                e["file"] = frame_file(j["key"])
                e["sha256"] = hashlib.sha256(data).hexdigest()
                e["cost_credits"] = (t.get("cost") or {}).get("credits") if isinstance(t.get("cost"), dict) else t.get("cost")
                if ledger is not None and isinstance(e["cost_credits"], (int, float)):
                    with ledger.locked():              # Runway's reported cost refines the price (the largest figure counts), never adds a send
                        ledger.append({"key": j["key"], "tier": j["kind"], "model": MODELS[j["kind"]][0], "table_credits": MODELS[j["kind"]][1],
                                       "cost_credits": e["cost_credits"], "state": "saved", "task": e.get("task")})
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
    unknown += [j["key"] for j in jobs if state(j, manifest, vdir) == "unknown" and j["key"] not in unknown]
    return {"created": made, "polled": polled, "still_running": [j["key"] for j in todo], "stopped": stopped, "unknown": unknown}


def _entry(j: dict) -> dict:
    return {"territory": j["tid"], "shot": j["shot"], "tier": j["kind"], "model": MODELS[j["kind"]][0], "credits": MODELS[j["kind"]][1],
            "prompt": j["prompt"], "prompt_sha256": hashlib.sha256(j["prompt"].encode()).hexdigest()}


def preview(job: dict, refs: list[dict], placeholder: bool = False) -> str:
    """The request a live run would send for one job, as text: what the dry run shows so nothing about the call is a surprise.
    The reference images are counted, never printed (they are data URIs), and the key is never part of it."""
    model = MODELS[job["kind"]][0]
    size = sum(len(r["uri"]) for r in refs)
    lines = ["REQUEST PREVIEW (the first frame; nothing is sent in a dry run)" + ("; the frame plan is not made yet, so the shot below is a placeholder" if placeholder else ""),
             f"  POST {API}/text_to_image   X-Runway-Version: {VERSION}",
             f"  model: {model}   ratio: {RATIO}   credits: {MODELS[job['kind']][1]}",
             f"  referenceImages: {len(refs)}" + (f" ({size / 1e6:.2f} MB encoded, tags {', '.join(r['tag'] for r in refs)})" if refs else ""),
             f"  prompt sha256: {hashlib.sha256(job['prompt'].encode()).hexdigest()[:16]}",
             f"  promptText: {job['prompt']}"]
    return "\n".join(lines)
