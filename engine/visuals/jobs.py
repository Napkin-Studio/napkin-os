"""Picture jobs for the Deck: the request-keyed manifest, the lifetime ledger, and the create-and-poll loop (deck-image-gen).

One job is one Runway picture. Its key comes from the request itself (``runway.request_key``), so the same request is the same job and an
identical rerun creates nothing. Money rules (Sai, 17 Nov 2026), all enforced here and not in the caller:

* Spend is DERIVED, never stored as a running total: the sum over every job in the cache manifest and in the cross-cache ledger for this
  deck (the subject call, drafts, heroes, failures and unknowns included), each priced at the largest of Runway's estimate, its reported
  cost and the table price. A deleted cache cannot lower it: the ledger lives outside the cache.
* The ledger is an append-only JSONL file written under ``fcntl.flock`` held from the cap check to the creating marker, so two processes
  racing for the last slot under the cap make exactly one create.
* The write order for a create is: re-derive spend and check the cap; append the job to the ledger and fsync; write the job as ``creating``
  to the manifest (fsync of file and folder); POST; write the task id; release the lock. A crash or a lost reply leaves a marker, never a
  clean slate: the job is ``unknown`` (it may have been charged), counts as spent, and is created again only from a card that asks for it.
* A create that is refused with 401, 402, 403 or 429 stops every later create in the run.

Nothing here reads a file other than the manifest and ledger it is given, and the API key is read by ``runway.api_key`` at the first create
only, from the environment, and scrubbed from every error text.
"""
from __future__ import annotations

import contextlib
import fcntl
import hashlib
import json
import os
import time
from datetime import datetime, timezone
from pathlib import Path

from . import runway

USD_PER_CREDIT = runway.USD_PER_CREDIT
CAP_DEFAULT_USD = 2.5
CAP_MAX_USD = 10.0
#: The subject call (stage g) is priced by its card estimate until a measured figure is recorded.
SUBJECTS_ESTIMATE_USD = 0.05
POLL_FIRST, POLL_MAX, POLL_BUDGET_S = 4.0, 30.0, 600.0
HERO_MAX_JOBS, HERO_MAX_PER_SLOT, DRAFT_MAX_ATTEMPTS = 3, 2, 2


def now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


# ------------------------------------------------------------------------------------------------------ manifest

def load_manifest(cache: Path) -> dict:
    p = Path(cache) / "manifest.json"
    if p.exists():
        m = json.loads(p.read_text())
        m.setdefault("cards", {})
        m.setdefault("jobs", {})
        return m
    return {"version": 1, "cards": {}, "jobs": {}}


def save_manifest(cache: Path, manifest: dict) -> None:
    runway.save_manifest(Path(cache), manifest)   # tmp file, fsync, rename, fsync of the folder


def state(job: dict | None, cache: Path) -> str:
    """saved: the file is on disk. polling: a task exists. unknown: a create was sent and its answer was never seen (it may be charged).
    failed: Runway said FAILED or CANCELLED, or refused the create. new: nothing was ever sent."""
    e = job or {}
    if e.get("file") and (Path(cache) / e["file"]).exists():
        return "saved"
    if e.get("task") and e.get("status") not in ("FAILED", "CANCELLED"):
        return "polling"
    if not e.get("task") and e.get("state") in ("creating", "unknown"):
        return "unknown"
    if e.get("state") == "failed" or e.get("status") in ("FAILED", "CANCELLED"):
        return "failed"
    return "new"


# ------------------------------------------------------------------------------------------------------ ledger and spend

class Ledger:
    """The append-only JSONL file of every job and subject call ever created for a deck, outside the cache."""

    def __init__(self, path: Path, deck_id: str):
        self.path, self.deck_id = Path(path), str(deck_id)
        self._fd = None

    def lines(self) -> list[dict]:
        out = []
        try:
            text = self.path.read_text()
        except OSError:
            return out
        for ln in text.splitlines():
            try:
                row = json.loads(ln)
            except ValueError:
                continue   # a half-written last line is a line that never counted as written; the next append starts a new one
            if isinstance(row, dict) and row.get("deck") == self.deck_id:
                out.append(row)
        return out

    @contextlib.contextmanager
    def locked(self):
        """Hold the file lock (all processes, all decks: one writer at a time)."""
        self.path.parent.mkdir(parents=True, exist_ok=True)
        fd = os.open(self.path, os.O_RDWR | os.O_CREAT | os.O_APPEND, 0o600)
        try:
            fcntl.flock(fd, fcntl.LOCK_EX)
            self._fd = fd
            yield self
        finally:
            self._fd = None
            try:
                fcntl.flock(fd, fcntl.LOCK_UN)
            finally:
                os.close(fd)

    def append(self, row: dict) -> None:
        """Append one line and fsync it. Only inside ``locked()``."""
        if self._fd is None:
            raise RuntimeError("the ledger is appended to only under its lock")
        line = json.dumps({"deck": self.deck_id, "at": now(), **row}, ensure_ascii=False, separators=(",", ":")) + "\n"
        os.write(self._fd, line.encode())
        os.fsync(self._fd)


def job_usd(j: dict) -> float:
    """What a job counts as: the largest of Runway's estimate, its reported cost and the table price, at $0.01 a credit. A subject call
    counts at its measured figure, else its card estimate."""
    if j.get("kind") == "subjects":
        return round(float(j.get("usd") or j.get("estimate_usd") or SUBJECTS_ESTIMATE_USD), 4)
    nums = [x for x in (j.get("estimated_credits"), j.get("cost_credits"), j.get("table_credits")) if isinstance(x, (int, float))]
    if not nums:
        try:
            nums = [runway.credits_for(j["model"], runway.TIER_SIZE.get(j.get("tier"), "1K"))]
        except (KeyError, runway.RunwayError):
            nums = [0]
    return round(max(nums) * USD_PER_CREDIT, 4)


def spent_usd(manifest: dict, ledger: Ledger | None) -> float:
    """The deck's spend, derived: the union by job key of the manifest's jobs and the ledger's lines for this deck. Only jobs that were
    created, or may have been (a ``new`` job that was never sent counts for nothing), are counted."""
    seen: dict[str, float] = {}
    for key, j in (manifest.get("jobs") or {}).items():
        if j.get("state") == "planned":
            continue
        seen[key] = max(seen.get(key, 0.0), job_usd(j))
    for row in (ledger.lines() if ledger else []):
        if row.get("key"):
            seen[row["key"]] = max(seen.get(row["key"], 0.0), job_usd(row))
    return round(sum(seen.values()), 4)


def hero_counts(manifest: dict, ledger: Ledger | None) -> tuple[int, dict]:
    """(hero jobs for the deck, hero jobs per slot): counted from the jobs, failures and unknowns included."""
    jobs: dict[str, dict] = {}
    for row in (ledger.lines() if ledger else []):
        if row.get("tier") == "hero" and row.get("key"):
            jobs[row["key"]] = row
    for k, j in (manifest.get("jobs") or {}).items():
        if j.get("tier") == "hero" and j.get("state") != "planned":
            jobs[k] = j
    per: dict[str, int] = {}
    for j in jobs.values():
        for s in j.get("slots") or []:
            per[s] = per.get(s, 0) + 1
    return len(jobs), per


# ------------------------------------------------------------------------------------------------------ creating and polling

def job_entry(j: dict) -> dict:
    """The manifest row of a planned job: what the request is, never the pictures (they are files)."""
    model = runway.TIER_MODEL[j["tier"]]
    return {"key": j["key"], "kind": j["tier"], "tier": j["tier"], "model": model, "ratio": j["ratio"], "prompt_sha": hashlib.sha256(j["prompt"].encode()).hexdigest(),
            "refs": list(j.get("ref_shas") or []), "slots": list(j["slots"]), "attempt": j.get("attempt", 1),
            "table_credits": runway.credits_for(model, runway.TIER_SIZE[j["tier"]]), "card": j.get("card")}


def generate(client, jobs: list[dict], cache: Path, manifest: dict, ledger: Ledger, cap_usd: float, refs_for, sleep=time.sleep,
             retry_unknown: bool = False, guard=None, log=print, poll_budget_s: float = POLL_BUDGET_S) -> dict:
    """Create the jobs that need it, then poll all of them. ``jobs`` are planned jobs (key, tier, ratio, prompt, slots, ref_shas);
    ``refs_for(job)`` returns the referenceImages array for the create (data URIs are built only here, at the last moment). ``guard(bytes) ->
    result`` checks a saved picture. Idempotent: a job that is saved or polling is never created again. Returns what happened."""
    cache = Path(cache)
    cache.mkdir(parents=True, exist_ok=True)
    rows = manifest.setdefault("jobs", {})
    created, stopped, unknown, failed = 0, None, [], []
    for j in jobs:
        cur = rows.get(j["key"])
        st = state(cur, cache)
        if st in ("saved", "polling", "failed"):
            continue
        if st == "unknown" and not retry_unknown:
            unknown.append(j["key"])
            continue
        if stopped:
            continue
        entry = {**job_entry(j), "attempt": (cur or {}).get("attempt", j.get("attempt", 1))}
        with ledger.locked():
            spent = spent_usd(manifest, ledger)
            price = entry["table_credits"] * USD_PER_CREDIT
            if st == "unknown":   # re-created from a card: the first send already counts, so a second send is a second spend
                entry["key"] = j["key"]
            if spent + price > cap_usd + 1e-9:
                stopped = f"cap reached: ${spent:.2f} is spent of ${cap_usd:.2f} and the next picture costs ${price:.2f}"
                continue
            ledger.append({"key": j["key"], "tier": entry["tier"], "model": entry["model"], "table_credits": entry["table_credits"],
                           "slots": entry["slots"], "state": "creating"})
            rows[j["key"]] = {**entry, "state": "creating", "created_at": now()}
            save_manifest(cache, manifest)   # synced BEFORE the POST: a crash from here on leaves a marker, never a clean slate
            try:
                t = client.create(entry["model"], j["prompt"], refs_for(j), ratio=entry["ratio"])
                task = t["id"]
            except runway.RunwayError as e:
                if e.status is not None and e.status >= 500:   # the server may have taken the request before it failed
                    rows[j["key"]].update(state="unknown", error=str(e))
                    unknown.append(j["key"])
                    stopped = "Runway answered a create with a server error: stopped; that job is unknown (it may be charged)"
                else:
                    rows[j["key"]].update(state="failed", status="FAILED", error=str(e))
                    failed.append(j["key"])
                    if e.status in runway.STOP_STATUSES:
                        stopped = ("Runway is rate limiting: try again later" if e.status == 429
                                   else f"Runway refused the request ({e.status}: key, credit or access): nothing else tried")
                save_manifest(cache, manifest)
                log(f"{j['key']}: {rows[j['key']]['state']}: {rows[j['key']].get('error', '')[:120]}")
                continue
            except (OSError, ValueError, KeyError, TypeError) as e:   # timeout, reset, no answer, an answer with no task id
                rows[j["key"]].update(state="unknown", error=f"{type(e).__name__}")
                unknown.append(j["key"])
                stopped = "a create got no answer: stopped; that job is unknown (it may be charged) and is not created again unless a card asks"
                save_manifest(cache, manifest)
                log(f"{j['key']}: unknown, the create got no answer ({type(e).__name__})")
                continue
            est = (t.get("estimatedCost") or {}).get("credits")
            rows[j["key"]].update(state="polling", task=task, status="PENDING", estimated_credits=est)
            save_manifest(cache, manifest)
            ledger.append({"key": j["key"], "tier": entry["tier"], "model": entry["model"], "table_credits": entry["table_credits"],
                           "estimated_credits": est, "slots": entry["slots"], "state": "polling", "task": task})
            created += 1
    waited, every = 0.0, POLL_FIRST
    todo = [j for j in jobs if state(rows.get(j["key"]), cache) == "polling"]
    while todo and waited <= poll_budget_s:
        still = []
        for j in todo:
            e = rows[j["key"]]
            try:
                t = client.task(e["task"])
            except runway.RunwayError as err:
                log(f"{j['key']}: could not poll ({str(err)[:80]})")
                still.append(j)
                continue
            e["status"] = t.get("status")
            if t.get("status") == "SUCCEEDED":
                data = _download(client, e, t, log)
                if data is None:
                    still.append(j)
                    continue
                fn = f"{j['key']}.png"
                (cache / fn).write_bytes(data)
                e.update(file=fn, sha256=hashlib.sha256(data).hexdigest(), state="saved")
                cost = t.get("cost")
                e["cost_credits"] = cost.get("credits") if isinstance(cost, dict) else cost
                if guard is not None:
                    e["guard"] = guard(data)
            elif t.get("status") in ("FAILED", "CANCELLED"):
                e.update(state="failed", error=str(t.get("failure") or t.get("failureCode") or t.get("status"))[:300])
                failed.append(j["key"])
                log(f"{j['key']}: {t.get('status')}")
            else:
                still.append(j)
            save_manifest(cache, manifest)
        todo = still
        if todo:
            sleep(every)
            waited += every
            every = min(POLL_MAX, every * 1.5)
    return {"created": created, "stopped": stopped, "unknown": unknown, "failed": failed, "still_running": [j["key"] for j in todo]}


def _download(client, entry: dict, task: dict, log):
    """The picture's bytes, or None. An expired output URL is fetched again from the task (free)."""
    try:
        out = (task.get("output") or [None])[0]
        if not out:
            raise runway.RunwayError("the task succeeded but gave no output URL")
        return client.download(out)
    except runway.RunwayError:
        try:
            again = client.task(entry["task"])
            return client.download((again.get("output") or [None])[0])
        except (runway.RunwayError, TypeError, OSError) as e:
            log(f"{entry['key']}: finished but not downloaded ({type(e).__name__}): run again to fetch it")
            return None
    except OSError as e:
        log(f"{entry['key']}: finished but not downloaded ({type(e).__name__})")
        return None
