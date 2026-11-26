"""The Territories runner: the one entry the middleware's task handlers call, in-process (feature territories-engine-server).

Territories runs INSIDE the middleware like Brief and Research (owner, 2026-11-23): no engine server, no sidecar. A handler builds the
document and the carried members (facts, findings, sources), calls ``run`` in a job thread and writes the returned document back. The runner
owns everything between: the insights segment, ``gates.drive`` over ``routes.stage`` and ``world.stage``, the money, the clock and the
store. It has no dependency on the middleware (it imports only this package), so the engine suite tests it alone.

    store = Store.for_doc(doc_id)                     # a folder per document (NAPKIN_TERRITORY_DATA)
    res = run(doc, llm=LiveLLM(approved=True), store=store, facts=facts, findings=findings, sources=sources, cancel=event)
    res.doc          the document, at a gate, finished, or failed with run.error in words
    res.decisions    ask / spend / outcome entries for the document's decision history (the only place a price is written)
    res.busy         True when another run of this document is going: nothing was run and res.error says so in words

    steer / undo / more / push / rerank               the person's moves on the same store, spend and lock

What it guarantees (LESSONS 11, 12, 13):

* Every model call goes through ``Spend.wrap``, keyed by (stage, system, user). A finished call is recorded in ``<store>/spend.json`` at
  once, so a killed run, a retry and a resume read it and never pay twice. A call that outlives its stage timeout stays in flight and its late
  answer is recorded; the retry joins or reads it.
* A stage timeout is taken from measured latency (``<store>/latency.json``, seconds per stage, kept across runs): ``TIMEOUT_MULT`` times the
  slowest measured call of that stage, never below ``TIMEOUT_FLOOR`` nor above ``TIMEOUT_CAP``. A stage with no measurement uses ``DEFAULT_TIMEOUT``.
* A held gate makes no model call (only ``gates.drive`` runs a stage, and only when ``next_step`` says so).
* One run per document: a second ``run`` while one is going is refused in words and touches nothing.
* ``cancel`` (a ``threading.Event``) stops before the NEXT model call. A call already on the wire finishes and is recorded, never lost, so a
  resume does not repay it. The run ends as a retryable ``run.error`` in words.
* Every failure is a plain-words ``run.error`` ({stage, message, retryable, refused}), never a field name, a trace or a price. A final document
  the app would refuse is not returned: ``contract.refusal_error`` says what to fix.
"""
from __future__ import annotations

import copy
import json
import os
import re
import threading
import time
from dataclasses import dataclass, field
from pathlib import Path

from . import carried, contract, gates, insights, routes, spend as sp, world

ENV_DATA = "NAPKIN_TERRITORY_DATA"
DEFAULT_DATA = "./.territory-data"
STORE_VERSION = 1

#: Timeouts (seconds) from measured latency: a call is waited for TIMEOUT_MULT times the slowest measured one of its stage.
TIMEOUT_MULT, TIMEOUT_FLOOR, TIMEOUT_CAP = 3.0, 90.0, 900.0
#: A stage nobody has measured yet. Replaced by measurement after the first call (``latency.json``). 300 s covers the slowest call measured in the first live run (2026-11-23, local
#: backend: a world batch, 108 s) almost three times over.
DEFAULT_TIMEOUT = 300.0
ENV_TIMEOUT = "NAPKIN_TERRITORY_STAGE_TIMEOUT"
#: How many latency samples per stage the store keeps.
KEEP_SAMPLES = 20


class RunStopped(Exception):
    """Raised at the next model call once a person has cancelled the run."""


# ---------------------------------------------------------------- the store: one folder per document


def _safe(name: str) -> str:
    return re.sub(r"[^A-Za-z0-9._-]", "_", str(name or "").strip())[:80] or "doc"


class Store:
    """``<root>/<doc id>/``: ``spend.json`` (finished model outputs, the resume record; ``Spend`` owns its format), ``latency.json`` (seconds
    per stage) and ``segments.json`` (which segment started, finished or failed). Writes are atomic; a file of an unknown version is ignored
    (the run goes on without it) rather than half-read."""

    def __init__(self, folder: Path | str):
        self.dir = Path(folder)
        self.lock = threading.Lock()

    @classmethod
    def for_doc(cls, doc_id: str, root: Path | str | None = None) -> "Store":
        return cls(Path(root or os.environ.get(ENV_DATA) or DEFAULT_DATA) / _safe(doc_id))

    @property
    def spend_path(self) -> Path:
        return self.dir / "spend.json"

    def _read(self, name: str) -> dict:
        p = self.dir / name
        try:
            d = json.loads(p.read_text())
        except (OSError, ValueError):
            return {}
        return d if isinstance(d, dict) and d.get("version") == STORE_VERSION else {}

    def _write(self, name: str, data: dict) -> None:
        self.dir.mkdir(parents=True, exist_ok=True)
        p = self.dir / name
        tmp = p.with_suffix(".tmp")
        tmp.write_text(json.dumps({"version": STORE_VERSION, **data}, ensure_ascii=False))
        tmp.replace(p)

    # latency
    def latency(self) -> dict[str, list[float]]:
        return {k: [float(x) for x in v] for k, v in (self._read("latency.json").get("stages") or {}).items() if isinstance(v, list)}

    def note_latency(self, stage: str, secs: float) -> None:
        with self.lock:
            d = self.latency()
            d[stage] = [*d.get(stage, []), round(float(secs), 2)][-KEEP_SAMPLES:]
            self._write("latency.json", {"stages": d})

    def timeout_for(self, stage: str) -> float:
        seen = self.latency().get(stage)
        if seen:
            return min(TIMEOUT_CAP, max(TIMEOUT_FLOOR, TIMEOUT_MULT * max(seen)))
        try:
            return float(os.environ.get(ENV_TIMEOUT) or DEFAULT_TIMEOUT)
        except ValueError:
            return DEFAULT_TIMEOUT

    # segments
    def segments(self) -> list[dict]:
        return list(self._read("segments.json").get("segments") or [])

    def note_segment(self, stage: str, state: str, **extra) -> None:
        with self.lock:
            rows = self.segments()
            rows.append({"stage": stage, "state": state, "at": gates.now(), **extra})
            self._write("segments.json", {"segments": rows[-200:]})


# ---------------------------------------------------------------- results and words


@dataclass
class Result:
    doc: dict
    decisions: list = field(default_factory=list)       # Spend.decisions(): the history entries (the only place a price is written)
    info: dict = field(default_factory=dict)             # calls per stage, segments run: for the job's log
    busy: bool = False                                    # another run of this document is going; nothing was run
    stopped: bool = False                                 # cancelled by the person
    refusals: list = field(default_factory=list)         # steer, undo, more and push: the person's move was refused, in words

    @property
    def error(self) -> dict | None:
        return (self.doc.get("run") or {}).get("error")

    @property
    def spent_usd(self) -> dict:
        s = [d for d in self.decisions if d["kind"] == "spend"]
        return {"claude": round(sum(d["usd"] for d in s if d["provider"] == sp.CLAUDE), 6),
                "pictures": round(sum(d["usd"] for d in s if d["provider"] == sp.PICTURES), 6)}


BUSY_WORDS = "This run is already going. Wait for it to finish, then look again."
STOPPED_WORDS = "The run was stopped. What was made is saved; start it again and it goes on from there."
UNEXPECTED_WORDS = "The run stopped before it finished. What was made is saved; try again."

_LOCKS: dict[str, threading.Lock] = {}
_LOCKS_GUARD = threading.Lock()


def _lock_of(store: Store) -> threading.Lock:
    with _LOCKS_GUARD:
        return _LOCKS.setdefault(str(store.dir.resolve()), threading.Lock())


def _fail(doc: dict, stage: str, message: str, retryable: bool = True, refused: list | None = None) -> dict:
    """The document as failed, with ``run.error`` in words. Creates ``run`` when the document has none yet."""
    doc = copy.deepcopy(doc)
    doc.setdefault("run", {"state": "draft", "approvals": {}, "decisions": []})
    doc["run"].setdefault("stages", [{"id": s, "name": n, "status": "next"} for s, n in gates.STAGES])
    out = gates._fail(doc, stage if stage in dict(gates.STAGES) else "pick", message, retryable)
    if refused:
        out["run"]["error"]["refused"] = [str(r)[:300] for r in refused][: contract.limit("run", "error", "refused")]
    return out


# ---------------------------------------------------------------- the document a run starts from


def prepare(doc: dict) -> dict:
    """A document with every member the engine reads, from a spun-off one that has only ``upstream`` (the seed's empty members fill the rest)."""
    seed = json.loads((contract.TEMPLATE / "seed.json").read_text())
    d = copy.deepcopy(doc)
    for k, v in seed.items():
        d.setdefault(k, copy.deepcopy(v))
    for k in ("finds", "actions"):
        d.setdefault(k, [])
    d["run"].setdefault("approvals", {})
    d["run"].setdefault("decisions", [])
    return d


def card(doc: dict) -> dict:
    """The cost card for a run of ``doc``: calls and an estimate, from the shared price table. It is the ``ask`` entry's content: named
    BEFORE the first paid call."""
    from .llm import STAGE_MODEL
    crew = len(doc.get("crew") or routes.CREW)
    rows = ([("insights", 1)] if not (doc.get("focus") or {}).get("insights") else []) + \
           [(f"route_{c['direction']}", 1) for c in (doc.get("crew") or routes.CREW)] + \
           [("kill", 1), ("sort", 1), ("distance", 1), ("spread_repair", 2), ("world", 3), ("world_checks", 2), ("judge", 1)]
    est = sum(sp.estimate_call(s, STAGE_MODEL.get(s)) * n for s, n in rows)
    return {"calls": sum(n for _, n in rows), "est_usd": round(est, 2), "crew": crew}


# ---------------------------------------------------------------- the model, wrapped


class _Session:
    """One locked run: the Spend, the cancel flag, and the ``llm`` every stage calls."""

    def __init__(self, store: Store, inner, *, cancel, cap_usd, doc_id, on_line):
        self.store, self.inner, self.cancel = store, inner, cancel
        self.spend = sp.Spend(cap_usd=cap_usd, doc=doc_id, store=store.spend_path, on_line=on_line)
        self.wrapped: dict[str, object] = {}
        self.counts: dict[str, int] = {}
        self.lock = threading.Lock()

    def _timed(self, stage, system, user):
        t = time.monotonic()
        out = self.inner(stage, system, user)
        self.store.note_latency(stage, time.monotonic() - t)       # measured on success only: a failure says nothing about speed
        return out

    def llm(self, stage: str, system: str, user: str):
        if self.cancel is not None and self.cancel.is_set():
            raise RunStopped(STOPPED_WORDS)
        with self.lock:
            self.counts[stage] = self.counts.get(stage, 0) + 1
            w = self.wrapped.get(stage)
            if w is None:
                w = self.wrapped[stage] = self.spend.wrap(self._timed, timeout=self.store.timeout_for(stage))
        return w(stage, system, user)

    @property
    def stopped(self) -> bool:
        return self.cancel is not None and self.cancel.is_set()


def _segment(session: _Session, stage: str, fn):
    """A stage function that records its segment: started, then finished or failed. The record is progress for the job's log; the resume
    itself is the spend store (a finished call is never made again)."""
    def go(doc):
        t = time.monotonic()
        session.store.note_segment(stage, "started")
        try:
            out = fn(doc)
        except BaseException:
            session.store.note_segment(stage, "failed", calls=session.counts.get(stage, 0), secs=round(time.monotonic() - t, 2))
            raise
        err = (out.get("run") or {}).get("error")
        session.store.note_segment(stage, "failed" if err else "finished", calls=session.counts.get(stage, 0), secs=round(time.monotonic() - t, 2))
        return out
    return go


def _insights_stage(session: _Session, doc: dict, facts, findings, sources, category, market, prompt_text) -> dict:
    t0 = time.monotonic()
    session.store.note_segment("insights", "started")
    res = insights.run(doc, session.llm, facts=facts, findings=findings, sources=sources, category=category, market=market, prompt_text=prompt_text)
    if res.get("error"):
        e = res["error"]
        session.store.note_segment("insights", "failed", calls=session.counts.get("insights", 0), secs=round(time.monotonic() - t0, 2))
        return _fail(doc, "pick", e["message"], e.get("retryable", True), e.get("refused"))
    if res.get("gate") or not res.get("insights"):
        session.store.note_segment("insights", "failed", calls=session.counts.get("insights", 0), secs=round(time.monotonic() - t0, 2))
        return _fail(doc, "pick", res.get("words") or "There is not enough to work from, so no insights were made.", retryable=False)
    d = _with_sources(doc, res["insights"], facts, findings, sources)
    session.store.note_segment("insights", "finished", calls=session.counts.get("insights", 0), secs=round(time.monotonic() - t0, 2))
    return d


def _with_sources(doc: dict, insights: list, facts, findings, sources) -> dict:
    """The document with these insights and one source, in play, per brief field, research pin and finding the crew may quote, as a fresh
    draft. Try again after a Pick that could not be saved comes back here with the insights it kept: no model call, the same pick rebuilt."""
    d = copy.deepcopy(doc)
    inp = carried.engine_input(d, facts, findings, sources)
    ids = [f"brief:{k}" for k in inp["brief"]] + [p["id"] for p in inp["facts"]] + [f["id"] for f in inp["findings"]]
    d["focus"] = {"sources": [{"id": i, "in_play": True} for i in ids], "insights": insights}
    d["run"].pop("error", None)
    d["run"]["state"] = "draft"
    return d


def _check_final(doc: dict, facts, findings, start: dict | None = None) -> dict:
    """The document the host would refuse is never returned as if it were fine: it becomes a retryable error naming what to fix. The failed
    document must itself be one the host takes, or the person sees nothing at all (acceptance A13: a refused Pick left neither the run nor its
    insights): the members that broke are put back as the run found them (the rest, the insights first, kept), and if that still does not fit,
    the error is written onto the document the run started from."""
    ps = contract.check(doc, facts=facts or [], findings=findings or [])      # structure first, then the contract's own rules
    if not ps:
        return doc
    if (doc.get("run") or {}).get("state") == "failed" and start is None:
        return doc
    stage = (doc.get("run") or {}).get("stage") or "pick"
    if (doc.get("run") or {}).get("state") == "failed":
        e = (doc.get("run") or {}).get("error") or contract.refusal_error(ps, stage)
    else:
        e = contract.refusal_error(ps, stage)
    out = _fail(_put_back(doc, start or {}, ps), stage, e["message"], True, e.get("refused"))
    if not contract.check(out, facts=facts or [], findings=findings or []) or start is None:
        return out
    return _fail(start, stage, e["message"], True, e.get("refused"))


def _put_back(doc: dict, start: dict, ps) -> dict:
    """Each member a problem names (two levels deep: ``focus.sources``) as ``start`` had it; one it had not: an empty list, or gone."""
    d = copy.deepcopy(doc)
    for p in ps:
        keys = [k for k in re.split(r"[.\[\]]", str(getattr(p, "path", "") or "")) if k and not k.isdigit()][:2]
        if not keys or keys[0] == "run":
            continue
        src, dst = start, d
        for k in keys[:-1]:
            src = src.get(k) if isinstance(src, dict) else None
            dst = dst.get(k) if isinstance(dst, dict) else None
        if not isinstance(dst, dict):
            continue
        if isinstance(src, dict) and keys[-1] in src:
            dst[keys[-1]] = copy.deepcopy(src[keys[-1]])
        elif isinstance(dst.get(keys[-1]), list):
            dst[keys[-1]] = []       # a list the run added: empty is its plain state (for the Pick's sources, everything in play)
        else:
            dst.pop(keys[-1], None)
    return d


def _result(session: _Session, doc: dict, **info) -> Result:
    session.spend.outcome("run", routes=len([t for t in doc.get("territories") or [] if t.get("status") == "live"]),
                          developed=len([t for t in doc.get("territories") or [] if t.get("state") == "developed"]))
    return Result(doc, session.spend.decisions(), {"calls": dict(session.counts), "segments": session.store.segments(), **_telemetry(session), **info},
                  stopped=session.stopped)


def _telemetry(session: _Session) -> dict:
    """What this session saw that the ledger does not keep: the paid calls the cap refused and the calls that paid nothing (read or joined)."""
    return {"cap_stops": list(session.spend.stops), "reused": session.spend.reused}


# ---------------------------------------------------------------- the entry


def run(doc: dict, *, llm, store: Store, facts=None, findings=None, sources=None, marks=None, cancel: threading.Event | None = None,
        cap_usd: float | None = None, category: str | None = None, market: str | None = None, prompt_text: str = "",
        on_progress=None, on_line=None, doc_id: str = "", max_steps: int = 12) -> Result:
    """Take the document and the carried members as far as the gates allow, then stop.

    Starts from what the document holds: no insights yet, the insights segment first (one call), then ``gates.drive``, which opens the pick gate
    and stops. With the pick approved (the person's move, ``gates.approve``) it runs explore, then develop, then opens the greenlight gate. It
    never runs a stage a gate holds. ``llm`` is ``llm(stage, system, user) -> (obj, usage)``: ``LiveLLM`` live, ``FakeLLM`` in tests.
    ``on_progress`` receives ``{crew, state, routes}`` as headings come back; ``on_line`` receives each paid call as ``RunLog.model`` kwargs.
    Never raises: a failure is the returned document's ``run.error`` in words."""
    lock = _lock_of(store)
    key = str(store.dir.resolve())
    if not _acquire_after_stop(lock, cancel, lambda: _stopped_holder(key)):
        return _busy(doc)
    _HOLDERS[key] = cancel
    try:
        doc = prepare(doc)
        start = copy.deepcopy(doc)
        try:
            session = _Session(store, llm, cancel=cancel, cap_usd=cap_usd, doc_id=doc_id, on_line=on_line)
        except (ValueError, OSError):
            return Result(_fail(doc, "pick", "The limit for this run could not be read, so nothing was run.", retryable=False))
        if not any(e["kind"] == "ask" for e in session.spend.events):
            session.spend.ask(card(doc))
        try:
            r0 = doc.get("run") or {}
            if not (doc.get("focus") or {}).get("insights") and r0.get("state") in (None, "draft", "failed"):
                doc = _insights_stage(session, doc, facts, findings, sources, category, market, prompt_text)
            elif r0.get("state") == "failed" and (r0.get("stage") or "pick") == "pick" and not (r0.get("approvals") or {}).get("pick"):
                doc = _with_sources(doc, doc["focus"]["insights"], facts, findings, sources)     # Try again on a Pick that was not saved
            if (doc.get("run") or {}).get("state") != "failed" or any(r.get("kind") == "retry" for r in (doc.get("run") or {}).get("gate_requests") or []):
                kw = dict(facts=facts, findings=findings, sources=sources, marks=marks, cancel=cancel, on_progress=on_progress)
                doc = gates.drive(doc, {"explore": _segment(session, "explore", routes.stage(session.llm, **kw)),
                                        "develop": _segment(session, "develop", world.stage(session.llm, **kw))},
                                  findings=findings, max_steps=max_steps)
            if session.stopped and (doc.get("run") or {}).get("state") == "failed":
                doc = _fail(doc, doc["run"]["error"]["stage"], STOPPED_WORDS)
            doc = _check_final(doc, facts, findings, start)
        except Exception:     # noqa: BLE001 - the contract is plain words, never a trace
            doc = _fail(doc, (doc.get("run") or {}).get("stage") or "pick", STOPPED_WORDS if session.stopped else UNEXPECTED_WORDS)
        return _result(session, doc)
    finally:
        _HOLDERS.pop(key, None)
        lock.release()


# A run asked for right after a person stopped one (Stop, then Try again) meets the stopped run's thread still finishing the model call it was
# in: the middleware refuses a second run while a job is unfinished, so the only holder a new run can meet is a stopped one. It waits for that
# thread to let go (it stops at its next call) instead of answering "already going" (Territories live test T2, 2026-11-24).
WAIT_FOR_STOPPED_SECS = 180


_HOLDERS: dict[str, threading.Event | None] = {}     # the run holding each document's lock: its cancel event


def _stopped_holder(key: str) -> bool:
    ev = _HOLDERS.get(key)
    return ev is not None and ev.is_set()


def _acquire_after_stop(lock: threading.Lock, cancel: threading.Event | None, holder_stopped=lambda: True, wait: float | None = None) -> bool:
    """Take the document's lock. Free: at once. Held by a run a person stopped: wait for it to let go (up to the wait, unless this run is
    stopped too). Held by a live run: no wait, the caller says busy (one run per document)."""
    if lock.acquire(blocking=False):
        return True
    deadline = time.monotonic() + (WAIT_FOR_STOPPED_SECS if wait is None else wait)
    while holder_stopped():
        if lock.acquire(timeout=1.0):
            return True
        if (cancel is not None and cancel.is_set()) or time.monotonic() >= deadline:
            return False
    return lock.acquire(blocking=False)


def _busy(doc: dict) -> Result:
    return Result(doc, busy=True, info={"busy": True}, refusals=[BUSY_WORDS])


# ---------------------------------------------------------------- the person's moves (same store, spend and lock)


def _move(doc, store, llm, cancel, cap_usd, doc_id, on_line, fn):
    lock = _lock_of(store)
    if not lock.acquire(blocking=False):
        return _busy(doc)
    try:
        session = _Session(store, llm, cancel=cancel, cap_usd=cap_usd, doc_id=doc_id, on_line=on_line)
        try:
            out, refusals = fn(prepare(doc), session.llm)
        except sp.CapReached as e:
            return Result(doc, session.spend.decisions(), _telemetry(session), refusals=[str(e)])
        except Exception:     # noqa: BLE001
            return Result(doc, session.spend.decisions(), {"calls": dict(session.counts), **_telemetry(session)},
                          refusals=[STOPPED_WORDS if session.stopped else UNEXPECTED_WORDS], stopped=session.stopped)
        res = Result(out, session.spend.decisions(), {"calls": dict(session.counts), **_telemetry(session)}, refusals=list(refusals), stopped=session.stopped)
        return res
    finally:
        lock.release()


def steer(doc, crew_id, kind, by, *, llm, store, with_=None, facts=None, findings=None, sources=None, marks=None, cancel=None, cap_usd=None,
          doc_id="", on_line=None) -> Result:
    """``routes.steer`` on the store: further, pull, cross (``with_``) or stop for ONE heading. Only that heading goes out again."""
    return _move(doc, store, llm, cancel, cap_usd, doc_id, on_line, lambda d, m: routes.steer(
        d, m, crew_id, kind, by, with_=with_, facts=facts, findings=findings, sources=sources, marks=marks))


def undo(doc, action_id, by) -> Result:
    """``routes.undo``: takes an automatic fix back. No model call, so no store and no lock."""
    out, refusals = routes.undo(prepare(doc), action_id, by)
    return Result(out, refusals=list(refusals))


def more(doc, territory_id, by, *, llm, store, steer_text=None, n=None, facts=None, findings=None, sources=None, marks=None, cancel=None,
         cap_usd=None, doc_id="", on_line=None) -> Result:
    """``world.more``: more lines for ONE developed route."""
    return _move(doc, store, llm, cancel, cap_usd, doc_id, on_line, lambda d, m: world.more(
        d, m, territory_id, by, steer=steer_text, n=n, facts=facts, findings=findings, sources=sources, marks=marks))


def push(doc, territory_id, by, *, llm, store, instruction=None, facts=None, findings=None, sources=None, marks=None, cancel=None, cap_usd=None,
         doc_id="", on_line=None, **kw) -> Result:
    """``world.push``: write ONE developed route's world again, further."""
    def go(d, m):
        out, refusals, _info = world.push(d, m, territory_id, by, instruction=instruction, facts=facts, findings=findings, sources=sources,
                                          marks=marks, cancel=cancel, **kw)
        return out, refusals
    return _move(doc, store, llm, cancel, cap_usd, doc_id, on_line, go)


def rerank(doc, by, *, llm, store, facts=None, findings=None, sources=None, marks=None, cancel=None, cap_usd=None, doc_id="", on_line=None) -> Result:
    """``world.rerank``: the blind judge orders the live developed routes again (one call)."""
    return _move(doc, store, llm, cancel, cap_usd, doc_id, on_line, lambda d, m: world.rerank(
        d, m, by, facts=facts, findings=findings, sources=sources, marks=marks))
