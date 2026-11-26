"""The Territories run log record (feature territories-telemetry): one ``note`` event, ``what: "territory_run"``, written into the job's own
run log (server/napkin/runlog.py) when a step ends, however it ends (done, failed, cancelled).

What it holds, per step: the document id, a hash of the carried inputs' ids, each stage's seconds and calls, the spend by provider and by stage
(read from the ledger the engine keeps, ``<store>/spend.json``, never re-priced here), the tokens, the models, the retries, the calls that paid
nothing (read or joined), the paid calls the cap refused, the refusals, the error's kind and stage, the gate the run is held at, and the outcome
counts (routes, developed, greenlit, sent).

What it never holds: a brief's words, a route's words, a prompt, a reply, a refusal's sentence, an error's sentence. Ids, counts, seconds, model
names and kinds only. (A failed step's sentence is in ``job_end`` already, under the run log's own body rules.) Confidential material is not
reached at all: nothing here reads a text field.

``spend`` counts only the paid calls recorded DURING this step (a ledger line's time is after the step began), so a resumed run never counts
what an earlier one paid; ``ledger`` is the whole document's running total, so the two can be checked against each other and against the
engine's own ``Result.spent_usd``.

``python -m napkin.territories.telemetry [file | dir]`` prints spend against outcome per step.
"""
from __future__ import annotations

import hashlib
import json
import sys
import threading
from pathlib import Path

WHAT = "territory_run"
#: ledger line fields read (never a text)
SENT_STATUS = ("sent", "not_built", "queued")


class Collector:
    """Per-job: what the run log's ``model`` lines say that the ledger does not (attempts). Fed by the handler's ``on_line``."""

    def __init__(self):
        self.lock = threading.Lock()
        self.calls, self.attempts = 0, 0

    def line(self, kw: dict):
        with self.lock:
            self.calls += 1
            self.attempts += int(kw.get("attempts") or 1)


def inputs_hash(step: str, clan: dict | None) -> str:
    """A hash of the step and the ids of the carried facts, findings and sources: same inputs, same hash, and nothing readable in it."""
    c = clan or {}
    ids = [sorted(str(x.get("id")) for x in (c.get(k) or []) if isinstance(x, dict)) for k in ("facts", "findings", "sources")]
    return hashlib.sha256(json.dumps([step, ids]).encode()).hexdigest()[:16]


def counts(doc: dict | None) -> dict:
    d = doc or {}
    ts = [t for t in d.get("territories") or [] if isinstance(t, dict)]
    return {"routes": len([t for t in ts if t.get("status") == "live"]), "developed": len([t for t in ts if t.get("state") == "developed"]),
            "greenlit": len(d.get("greenlit") or []),
            "sent": sum(len(s.get("territory_ids") or []) for s in d.get("sends") or [] if isinstance(s, dict) and s.get("status") in SENT_STATUS)}


def ledger_lines(store, since: float | None = None) -> list[dict]:
    """The paid calls the ledger holds (all of them, or those recorded at or after ``since``), read from the spend file."""
    try:
        rows = json.loads(Path(store.spend_path).read_text()).get("lines") or []
    except (OSError, ValueError, AttributeError):
        return []
    return [r for r in rows if since is None or float(r.get("at") or 0) >= since]


def spend_block(lines: list[dict]) -> dict:
    out: dict = {"by_provider": {}, "by_stage": {}, "models": sorted({str(l.get("model")) for l in lines if l.get("model")})}
    for l in lines:
        for key, k in (("by_provider", l.get("provider")), ("by_stage", l.get("stage"))):
            b = out[key].setdefault(str(k), {"calls": 0, "tokens_in": 0, "tokens_out": 0, "usd": 0.0})
            b["calls"] += 1
            b["tokens_in"] += int(l.get("tokens_in") or 0)
            b["tokens_out"] += int(l.get("tokens_out") or 0)
            b["usd"] = round(b["usd"] + float(l.get("usd") or 0), 6)
    out["usd"] = round(sum(float(l.get("usd") or 0) for l in lines), 6)
    out["estimated_lines"] = sum(1 for l in lines if l.get("estimated"))
    return out


def stages_of(rows: list[dict]) -> list[dict]:
    """The segments this step ran: {stage, state, secs, calls}, from the rows that ended (a started row with nothing after it is a stage that
    never ended: ``state: "started"``)."""
    out = []
    for r in rows:
        if r.get("state") == "started":
            out.append({"stage": r.get("stage"), "state": "started", "secs": None, "calls": 0})
        elif out and out[-1]["stage"] == r.get("stage") and out[-1]["state"] == "started":
            out[-1] = {"stage": r.get("stage"), "state": r.get("state"), "secs": r.get("secs"), "calls": int(r.get("calls") or 0)}
        else:
            out.append({"stage": r.get("stage"), "state": r.get("state"), "secs": r.get("secs"), "calls": int(r.get("calls") or 0)})
    return out


def error_kind(state: str, err: dict | None, info: dict, refusals: list, stopped: bool) -> str | None:
    """A word for how it ended badly. Never the sentence."""
    if info.get("cap_stops"):
        return "cap"
    if stopped or state == "cancelled":
        return "stopped"
    if info.get("busy"):
        return "busy"
    if refusals or (err or {}).get("type") == "refused":
        return "refused"
    if state == "failed" or (err and err.get("message")):
        return "failed"
    return None


def build(job, res=None) -> dict:
    """The record for a step that has ended (``job`` is a ``TerritoriesJob``; ``res`` the runner's Result when it came back)."""
    t0 = getattr(job, "t0", None)
    store = getattr(job, "store", None)
    doc = getattr(res, "doc", None) or job.data
    run = (doc or {}).get("run") or {}
    info = dict(getattr(res, "info", {}) or job.info or {})
    refusals = list(getattr(res, "refusals", []) or [])
    err = run.get("error") if run.get("state") == "failed" else None
    mine = ledger_lines(store, t0) if store is not None and t0 is not None else []
    allv = ledger_lines(store) if store is not None else []
    tele = getattr(job, "tele", None)
    seg = (store.segments() if store is not None else [])[getattr(job, "seg_base", 0):]
    stops = list(info.get("cap_stops") or [])
    rec = {
        "step": job.step, "doc": job.doc, "inputs": inputs_hash(job.step, job.clan), "state": job.state, "run_state": run.get("state"),
        "held_at": (run.get("gate") or {}).get("id") if run.get("state") == "gate" else None,
        "stages": stages_of(seg), "outcome": counts(doc),
        "spend": spend_block(mine),
        "ledger": {"usd": spend_block(allv)["usd"], "by_provider": {p: b["usd"] for p, b in spend_block(allv)["by_provider"].items()}, "lines": len(allv)},
        "calls": dict(info.get("calls") or {}), "paid_calls": len(mine),
        "retries": max(0, (tele.attempts - tele.calls) if tele else 0), "reused": int(info.get("reused") or 0),
        "cap_stops": {p: stops.count(p) for p in sorted(set(stops))} or None,
        "refusals": len(refusals), "error_kind": error_kind(job.state, err, info, refusals, bool(getattr(res, "stopped", False))),
        "error_stage": (err or {}).get("stage"), "retryable": (err or {}).get("retryable") if err else None,
        "engine": "territory", "cancelled": job.state == "cancelled",
    }
    return {k: v for k, v in rec.items() if v is not None}


def write(rl, job, res=None):
    """Write the record into the run log. A failure here is noted and never stops the step."""
    try:
        rl.note(WHAT, stage=job.step, **build(job, res))
    except Exception as e:  # noqa: BLE001 - the run log never stops a run
        try:
            rl.note("territory_run_failed", stage=job.step, error_type=type(e).__name__)
        except Exception:  # noqa: BLE001
            pass


# -- the report: spend against outcome, per step ---------------------------------------------------
def _records(path: Path):
    files = sorted(path.rglob("run_territories-*.jsonl")) if path.is_dir() else [path]
    for f in files:
        for line in f.read_text(encoding="utf-8").splitlines():
            try:
                r = json.loads(line)
            except ValueError:
                continue
            if r.get("ev") == "note" and r.get("what") == WHAT:
                yield f.name, r


def report(path: Path) -> str:
    rows = [f"{'job':34} {'step':8} {'state':10} {'usd':>8} {'calls':>5} {'secs':>7}  routes/developed/greenlit/sent  stops  ended"]
    for name, r in _records(Path(path)):
        o, s = r.get("outcome") or {}, r.get("spend") or {}
        secs = sum(x.get("secs") or 0 for x in r.get("stages") or [])
        rows.append(f"{name[:34]:34} {r.get('step', ''):8} {r.get('state', ''):10} {s.get('usd', 0):8.4f} {r.get('paid_calls', 0):5d} {secs:7.1f}  "
                    f"{o.get('routes', 0)}/{o.get('developed', 0)}/{o.get('greenlit', 0)}/{o.get('sent', 0)}".ljust(40)
                    + f" {sum((r.get('cap_stops') or {}).values()):5d}  {r.get('error_kind') or '-'}")
    return "\n".join(rows)


if __name__ == "__main__":
    a = sys.argv[1] if len(sys.argv) > 1 else None
    if a is None:
        from .. import runlog
        a = str(runlog._latest(Path(".")) or ".")
    print(report(Path(a)))
