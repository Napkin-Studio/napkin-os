"""The dogfood run log: everything a job did, in order, with what it cost.

One JSON-lines file per job, under NAPKIN_RUNLOG_DIR/<yyyy-mm-dd>/<task>-<job>.jsonl
(off when the setting is unset). Each line is one event:

  job_start   task, handler, doc, the stages it will run, the model configured
  stage_start / stage_end   a stage, its time, and what it spent (calls, tokens, cost, searches)
  model       one structured call: stage, purpose, model, attempts, seconds, tokens, cost, ok or the error
  research    one web search: stage, lens, market, query, sources found, their urls, seconds, cost (as
              reported); with bodies on, each result's url, title, published date and text (capped)
  retrieval   one library lookup: stage, purpose, k, passages found, seconds
  decision    one decision the job wrote: agent, action, targets, certainty level, cite count, basis and its
              claims' kinds; with bodies on, what was decided, why that certainty, its reasons and attention
  gap         a stage the job went on without, and why
  question / answer   what the job asked a person, and what came back
  note        anything else a stage wants on record (a plan, a research ask, a check's outcome)
  layers      one knowledge-layers call: stage, op, seconds, the error
  layers_connect   a fresh connection to a layers database: db, seconds (Aurora waking shows here)
  waiting     the job is waiting on something that is not a call: `what` it waits on (the knowledge layers
              waking, a person's answers, a poll bringing the earlier stages, a model slot)
  heartbeat   every HEARTBEAT_S while a stage runs: the stage, its seconds, and what is in flight
  job_end     state, summary, the error, the stages that failed, every field's end state, and the totals per
              stage. `lost` when the middleware stopped (a deploy) while the job ran.

Every event is also one stdout line, `runlog {json}`, through the `napkin.runlog` logger (CloudWatch),
with the job's task and org, and WITHOUT any body key (STDOUT_DROPS), whatever NAPKIN_RUNLOG_BODIES
says. The stdout lines are written whether or not NAPKIN_RUNLOG_DIR is set.

Costs: a model call's cost is estimated from its tokens and the price table below
(NAPKIN_PRICES, a JSON object {model-prefix: [usd per M input, usd per M output]}, overrides
it); `cost_src` says "est". A web search's cost is the research service's own report when it
gives one ("reported"), else unknown (null).

What a call sent and got back, what a search returned and a decision's words are NOT written unless
NAPKIN_RUNLOG_BODIES=1: client material is confidential, so by default a call is logged by its sizes,
a search by its urls and counts, a decision by its ids, kinds and counts. The policy (owner, 2026-10-19):
bodies are on for staging only, where NAPKIN_RUNLOG_BODIES=1 is set on the middleware's task, the run
log is readable only by Napkin accounts (/api/dogfood/runlog) and the dogfood purge empties it; never in
production. Locally, turn bodies on for test prompts.

`python -m napkin.runlog [file | dir | --latest]` prints a run as tables.
"""
from __future__ import annotations

import contextlib
import datetime as _dt
import json
import logging
import os
import sys
import threading
import time
from pathlib import Path

# USD per million tokens (input, output). Estimates: check them against the current price list.
PRICES = {"claude-opus-4-1": (15.0, 75.0), "claude-opus-4-0": (15.0, 75.0), "claude-opus-4-2": (15.0, 75.0),
          "claude-opus": (5.0, 25.0), "claude-sonnet-5": (2.0, 10.0), "claude-sonnet": (3.0, 15.0),
          "claude-haiku": (1.0, 5.0)}
# Prompt-cache input, as a multiple of the model's input price: a read, and a 5-minute write.
CACHE_READ, CACHE_WRITE = 0.1, 1.25

_cfg = {"dir": None, "bodies": False}
RESULT_CHARS = 4000  # of each search result's text, with bodies on
HEARTBEAT_S = 30.0   # a running stage writes a heartbeat at least this often
# In-flight kinds with a bounded wait of their own, which the stall budget does not cut short: a person's
# answers (the intake wait) and the briefing engine's call (its own timeout, then the fallback).
OWN_WAIT = frozenset({"person", "engine"})
ERROR_CHARS = 1000   # of an error's message, in stage_end
_out = logging.getLogger("napkin.runlog")
# Never on stdout (CloudWatch), bodies on or off: what a call sent or got back, what a search
# returned or was asked, a decision's words, a person's answer, a question's words, a plan's
# strategy, and the client's brand names.
STDOUT_DROPS = frozenset({"payload", "reply", "results", "query", "queries", "decided", "why_certain", "because",
                          "attention", "answer", "text", "options", "strategy", "brand", "competitors"})


def stdout_record(rec: dict) -> dict:
    """What of a run-log event goes to stdout: everything but the body keys."""
    return {k: v for k, v in rec.items() if k not in STDOUT_DROPS}


def timeout_message(stage: str, secs: float, waiting_on: str) -> str:
    return f"timed out in {stage} after {int(round(secs))} s waiting on {waiting_on}"


def error_parts(e: BaseException) -> dict:
    """An exception as the run log records it: its type, its message, and the chain of what caused it
    (`raise ... from`, or raised while handling another)."""
    cause, seen, chain = e.__cause__ or e.__context__, {id(e)}, []
    while cause is not None and id(cause) not in seen and len(chain) < 5:
        seen.add(id(cause))
        chain.append(f"{type(cause).__module__}.{type(cause).__name__}: {str(cause)[:400]}")
        cause = cause.__cause__ or cause.__context__
    return {"error_type": f"{type(e).__module__}.{type(e).__name__}", "error": str(e)[:ERROR_CHARS] or repr(e),
            "cause": chain or None}


def configure(directory: str | None, bodies: bool = False, prices: str | None = None):
    _cfg["dir"] = Path(directory) if directory else None
    _cfg["bodies"] = bool(bodies)
    if prices:
        try:
            PRICES.update({k: tuple(v) for k, v in json.loads(prices).items()})
        except (ValueError, TypeError):
            print("napkin.runlog: NAPKIN_PRICES is not a JSON object of [in, out]; ignored", file=sys.stderr)


def price(model: str | None, tin: int, tout: int, cache_read: int = 0, cache_write: int = 0) -> float | None:
    """`tin` counts every input token; `cache_read` and `cache_write` are the part of it the
    prompt cache served or stored, priced at their own multiples of the input price."""
    m = _model_name(model)
    best = max((k for k in PRICES if m.startswith(k)), key=len, default=None)
    if best is None:
        return None
    pi, po = PRICES[best]
    fresh = max(0, tin - cache_read - cache_write)
    return round((fresh + cache_read * CACHE_READ + cache_write * CACHE_WRITE) / 1e6 * pi + tout / 1e6 * po, 6)


def _model_name(model: str | None) -> str:
    """The model's own name, without a wire or a Bedrock region and provider:
    'bedrock/global.anthropic.claude-opus-5-5' and 'eu.anthropic.claude-opus-5-5'
    are both 'claude-opus-5-5'. A NAPKIN_PRICES key written whole still matches."""
    m = str(model or "")
    if any(m.startswith(k) for k in PRICES):
        return m
    m = m.rsplit("/", 1)[-1]
    if "anthropic." in m:
        m = m.split("anthropic.", 1)[1]
    return m


def bodies() -> bool:
    return _cfg["bodies"]


class _Stage:
    """What `RunLog.stage` yields: the job tells it how the stage ended, and stage_end says so."""

    def __init__(self):
        self.error = None   # error_parts(...) of what the stage raised
        self.timed_out = None  # {after_s, waiting_on}

    def failed(self, e: BaseException):
        self.error = error_parts(e)

    def ran_out(self, after_s, waiting_on):
        self.timed_out = {"after_s": round(after_s, 1), "waiting_on": waiting_on}


class RunLog:
    """A job's log. Thread-safe; the stage is the job's (stages run one at a time), so a
    call made by a stage's worker threads is counted to that stage.

    `path` None: no file (NAPKIN_RUNLOG_DIR unset), but every event still goes to stdout
    unless `echo` is off (the NULL log of a request no job is bound to)."""

    def __init__(self, path: Path | None, job: str, handler: str, org: str | None = None, echo: bool = True):
        self.path, self.job, self.handler, self.org = path, job, handler, org
        self.task = handler.split("@", 1)[0]
        self.echo = echo
        self.stage_name = None
        self.t0 = time.monotonic()
        self._lock = threading.Lock()
        self._fh = None
        self.totals: dict = {}
        self._stage_t0 = {}
        self._busy: dict = {}       # token -> (kind, what, t0): what is in flight now
        self._failed: list = []     # [{stage, error_type, error, cause} | {stage, timed_out}]
        self._ended = False
        self.last_progress = time.monotonic()  # the last event that was not a heartbeat

    @property
    def on(self) -> bool:
        return self.path is not None or self.echo

    def _write(self, ev: str, **kw):
        if not self.on:
            return
        rec = {"t": _dt.datetime.now(_dt.timezone.utc).isoformat(timespec="milliseconds"),
               "s": round(time.monotonic() - self.t0, 3), "ev": ev, "job": self.job}
        rec.update({k: v for k, v in kw.items() if v is not None})
        if ev != "heartbeat":  # a heartbeat says the stage is alive, never that it moved
            self.last_progress = time.monotonic()
        if self.echo:
            try:
                out = {"ev": ev, "job": self.job, "task": self.task, "org": self.org,
                       **{k: v for k, v in stdout_record(rec).items() if k not in ("ev", "job")}}
                bad = rec.get("error") or rec.get("error_type") or ev == "job_end" and (
                    rec.get("state") != "done" or rec.get("stages_failed"))
                _out.log(logging.WARNING if bad else logging.INFO, "runlog %s",
                         json.dumps(out, ensure_ascii=False, default=str))
            except Exception:  # noqa: BLE001 - the log never stops a job
                pass
        if self.path is None:
            return
        line = json.dumps(rec, ensure_ascii=False, default=str)
        with self._lock:
            try:
                if self._fh is None:
                    self.path.parent.mkdir(parents=True, exist_ok=True)
                    self._fh = open(self.path, "a", encoding="utf-8")
                self._fh.write(line + "\n")
                self._fh.flush()
            except OSError as e:  # the log never stops a job
                _out.error("napkin.runlog: cannot write %s: %s; job %s goes on logging to stdout only",
                           self.path, e, self.job)
                self.path = None

    def _tot(self, stage=None) -> dict:
        s = stage or self.stage_name or "-"
        return self.totals.setdefault(s, {"model_calls": 0, "attempts": 0, "in_tokens": 0, "out_tokens": 0,
                                          "model_cost": 0.0, "model_s": 0.0, "searches": 0, "search_cost": 0.0,
                                          "search_s": 0.0, "lookups": 0, "jev_calls": 0, "jev_cost": 0.0,
                                          "layers_calls": 0, "layers_s": 0.0, "decisions": 0, "errors": 0})

    # -- what is in flight ---------------------------------------------------------------
    @contextlib.contextmanager
    def busy(self, kind: str, what: str | None = None):
        """Mark a call or a wait as in flight for as long as the block runs: the heartbeat names it, and a
        stage that runs out of time says it was waiting on it."""
        tok = object()
        with self._lock:
            self._busy[tok] = (kind, what, time.monotonic())
        try:
            yield
        finally:
            with self._lock:
                self._busy.pop(tok, None)

    def inflight(self) -> list[dict]:
        """What is in flight, the longest-running first: [{kind, what, secs}]."""
        now = time.monotonic()
        with self._lock:
            items = list(self._busy.values())
        items.sort(key=lambda x: x[2])
        return [{"kind": k, "what": w, "secs": round(now - t, 1)} for k, w, t in items]

    def waiting_on(self) -> str:
        """In words, what the job is waiting on now ("nothing in flight" when nothing is)."""
        items = self.inflight()
        if not items:
            return "nothing in flight"
        return "; ".join(f"{x['kind']}{' ' + x['what'] if x['what'] else ''} ({x['secs']} s)" for x in items[:4])

    def stalled(self, budget: float) -> bool:
        """No event but heartbeats for `budget` seconds, while nothing with a wait of its own is in flight
        (a person's answer, the briefing engine's call: OWN_WAIT): the stage is making no progress. A log
        that writes nothing (NULL, no job bound) cannot tell, and never says so."""
        if not self.on or time.monotonic() - self.last_progress <= budget:
            return False
        with self._lock:
            return not any(k in OWN_WAIT for k, _w, _t in self._busy.values())

    def _beat(self, name: str, t: float, stop: threading.Event):
        while not stop.wait(HEARTBEAT_S):
            if self._ended:
                return
            self._write("heartbeat", stage=name, secs=round(time.monotonic() - t, 1), busy=self.inflight())

    # -- the job --------------------------------------------------------------------
    def start(self, task, doc, stages, model=None, **kw):
        self._write("job_start", task=task, handler=self.handler, doc=doc, stages=list(stages), model=model,
                    bodies=_cfg["bodies"], **kw)

    @contextlib.contextmanager
    def stage(self, name):
        """A stage, from stage_start to stage_end, with a heartbeat every HEARTBEAT_S while it runs. The
        block may tell the yielded `_Stage` how the stage ended (`failed`, `ran_out`); what the block itself
        raises is recorded the same way."""
        self.stage_name = name
        t = time.monotonic()
        self._write("stage_start", stage=name)
        st = _Stage()
        stop = threading.Event()
        if self.on:
            threading.Thread(target=self._beat, args=(name, t, stop), name=f"runlog-beat-{self.job}-{name}",
                             daemon=True).start()
        try:
            yield st
        except BaseException as e:
            st.failed(e)
            raise
        finally:
            stop.set()
            with self._lock:
                tot = dict(self._tot(name))
            fail = st.error or ({"error_type": "timeout", "error": timeout_message(
                name, st.timed_out["after_s"], st.timed_out["waiting_on"])} if st.timed_out else None)
            if fail:
                with self._lock:
                    self._failed.append({"stage": name, **fail})
            self._write("stage_end", stage=name, secs=round(time.monotonic() - t, 2), **(fail or {}),
                        waiting_on=(st.timed_out or {}).get("waiting_on"),
                        **{k: (round(v, 4) if isinstance(v, float) else v) for k, v in tot.items()})

    def end(self, state, summary=None, fields=None, gaps=None, error=None, **kw):
        with self._lock:
            if self._ended:
                return
            self._ended = True
            tots = json.loads(json.dumps(self.totals))
            failed = [dict(f) for f in self._failed]
        allc = {k: round(sum(t.get(k, 0) for t in tots.values()), 4) for k in
                ("model_calls", "in_tokens", "out_tokens", "model_cost", "searches", "search_cost", "jev_calls",
                 "jev_cost", "layers_calls", "layers_s", "decisions", "errors")}
        allc["cost"] = round(allc["model_cost"] + allc["search_cost"] + allc["jev_cost"], 4)
        first = failed[0] if failed else None
        self._write("job_end", state=state, secs=round(time.monotonic() - self.t0, 2), summary=summary,
                    error=error, stages_failed=[f["stage"] for f in failed] or None,
                    first_error=f"{first['stage']}: {first['error_type']}: {first['error']}" if first else None,
                    fields=fields, gaps=gaps, per_stage=tots, total=allc, **kw)
        with self._lock:
            if self._fh is not None:
                self._fh.close()
                self._fh = None

    def lost(self, why: str):
        """The middleware is stopping with this job unfinished: its log ends `lost`, saying where it was."""
        self.end("lost", summary=why, error={"type": "lost", "message": why}, stage=self.stage_name,
                 waiting_on=self.waiting_on())

    def waiting(self, what: str, **kw):
        """The job waits on something that is not a call (the knowledge layers waking, a person, a poll)."""
        self._write("waiting", stage=kw.pop("stage", None) or self.stage_name, what=what, **kw)

    # -- what happened ----------------------------------------------------------------
    def model(self, *, purpose, model, secs, tin, tout, attempts, ok, error=None, payload=None, reply=None,
              payload_chars=None, reply_chars=None, cache_read=0, cache_write=0):
        cost = price(model, tin, tout, cache_read, cache_write)
        with self._lock:
            t = self._tot()
            t["model_calls"] += 1
            t["attempts"] += attempts
            t["in_tokens"] += tin
            t["out_tokens"] += tout
            t["model_cost"] += cost or 0.0
            t["model_s"] += secs
            t["errors"] += 0 if ok else 1
        self._write("model", stage=self.stage_name, purpose=purpose, model=model, secs=round(secs, 2),
                    attempts=attempts, in_tokens=tin, out_tokens=tout, cache_read=cache_read or None,
                    cache_write=cache_write or None, cost=cost, cost_src="est" if cost is not None
                    else None, ok=ok, error=error, payload_chars=payload_chars, reply_chars=reply_chars,
                    payload=payload if _cfg["bodies"] else None, reply=reply if _cfg["bodies"] else None)

    def research(self, *, lens, market, query, secs, sources=None, cost=None, cached=None, error=None,
                 queries=None, urls=None, results=None):
        """`results`: what the search returned, [{url, title, published_at, text}]; with bodies off only
        each result's size is written (its url is in `urls`)."""
        with self._lock:
            t = self._tot()
            t["searches"] += 1
            t["search_cost"] += cost or 0.0
            t["search_s"] += secs
            t["errors"] += 1 if error else 0
        self._write("research", stage=self.stage_name, lens=lens, market=market, query=query, secs=round(secs, 2),
                    sources=sources, urls=urls, cost=cost, cost_src="reported" if cost is not None else None,
                    cached=cached, error=error, queries=queries,
                    results=[{**{k: r.get(k) for k in ("url", "title", "published_at")},
                              "text": str(r.get("text") or "")[:RESULT_CHARS]} for r in results or []]
                    if _cfg["bodies"] and results else None,
                    result_chars=[len(str(r.get("text") or "")) for r in results] if results is not None else None)

    def jev(self, *, check, questions, secs, state_chars, cost, error=None):
        with self._lock:
            t = self._tot()
            t["jev_calls"] += 1
            t["jev_cost"] += cost or 0.0
            t["errors"] += 1 if error else 0
        self._write("jev", stage=self.stage_name, check=check, questions=questions, secs=round(secs, 2),
                    state_chars=state_chars, cost=cost, cost_src="est", error=error)

    def layers(self, *, op, secs, error=None):
        with self._lock:
            t = self._tot()
            t["layers_calls"] += 1
            t["layers_s"] += secs
            t["errors"] += 1 if error else 0
        self._write("layers", stage=self.stage_name, op=op, secs=round(secs, 3), error=error)

    def layers_connect(self, *, db, secs, error=None):
        self._write("layers_connect", stage=self.stage_name, db=db, secs=round(secs, 2), error=error)

    def retrieval(self, *, purpose, k, secs, found=None, error=None, query=None):
        with self._lock:
            t = self._tot()
            t["lookups"] += 1
            t["errors"] += 1 if error else 0
        self._write("retrieval", stage=self.stage_name, purpose=purpose, k=k, secs=round(secs, 2), found=found,
                    error=error, query=query if _cfg["bodies"] else None)

    def decisions(self, decs, stage=None):
        for d in decs or []:
            r = d.get("reasoning") or {}
            cert = r.get("certainty") or {}
            with self._lock:
                self._tot(stage)["decisions"] += 1
            body = _cfg["bodies"]
            self._write("decision", stage=stage or self.stage_name, id=d.get("id"), agent=d.get("agent"),
                        kind=d.get("kind"), action=d.get("action"),
                        targets=[str(t).split("#", 1)[-1] for t in d.get("targets") or []],
                        decided=r.get("decided") if body else None, certainty=cert.get("level"),
                        why_certain=cert.get("why") if body else None,
                        because=[p.get("point") for p in r.get("because") or [] if isinstance(p, dict)][:8]
                        if body else None, points=len(r.get("because") or []),
                        attention=r.get("attention") if body else None, flagged=bool(r.get("attention")) or None,
                        polarity=d.get("polarity"), basis=d.get("basis"), cites=len(d.get("cites") or []),
                        claims=[c.get("kind") for c in d.get("claims") or [] if isinstance(c, dict)] or None)

    def gap(self, stage, reason, detail):
        self._write("gap", stage=stage, reason=reason, detail=detail)

    def question(self, stage, text, options=None):
        self._write("question", stage=stage, text=text, options=options)

    def answer(self, stage, answer):
        self._write("answer", stage=stage, answer=answer if _cfg["bodies"] else "(answered)")

    def note(self, what, **kw):
        self._write("note", **{"stage": self.stage_name, "what": what, **kw})  # a note may name its own stage


NULL = RunLog(None, "-", "-", echo=False)


def open_log(job: str, handler: str, org: str | None = None) -> RunLog:
    d = _cfg["dir"]
    if d is None:
        return RunLog(None, job, handler, org)
    task = handler.split("@", 1)[0]
    return RunLog(d / _dt.date.today().isoformat() / f"{task}-{job}.jsonl", job, handler, org)


# -- reading a run back ------------------------------------------------------------------
def _fmt_cost(c):
    return "-" if c in (None, 0, 0.0) else f"${c:.3f}"


def report(path: Path) -> str:
    evs = [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines() if line.strip()]
    out = []
    st = next((e for e in evs if e["ev"] == "job_start"), {})
    end = next((e for e in reversed(evs) if e["ev"] == "job_end"), None)
    out.append(f"# {st.get('task', '?')} {st.get('job', '?')}  doc {st.get('doc', '?')}  model {st.get('model', '?')}")
    if end:
        tot = end.get("total") or {}
        out.append(f"  {end.get('state')} in {end.get('secs')}s — {tot.get('model_calls')} model calls, "
                   f"{tot.get('in_tokens')}+{tot.get('out_tokens')} tokens, model {_fmt_cost(tot.get('model_cost'))}, "
                   f"{tot.get('searches')} searches {_fmt_cost(tot.get('search_cost'))}, total {_fmt_cost(tot.get('cost'))}")
        out.append(f"  {end.get('summary') or ''}")
    out.append("\n## Stages\n  stage        secs   calls  tokens(in+out)     model$   search  search$  decisions errors")
    for e in evs:
        if e["ev"] == "stage_end":
            out.append(f"  {e['stage']:<11} {e.get('secs', 0):>6}  {e.get('model_calls', 0):>5}  "
                       f"{e.get('in_tokens', 0):>7}+{e.get('out_tokens', 0):<7}  {_fmt_cost(e.get('model_cost')):>8}  "
                       f"{e.get('searches', 0):>6}  {_fmt_cost(e.get('search_cost')):>7}  {e.get('decisions', 0):>9} "
                       f"{e.get('errors', 0):>6}" + (f"  ERROR {e['error']}" if e.get("error") else ""))
    out.append("\n## Calls (in order)")
    for e in evs:
        if e["ev"] == "model":
            out.append(f"  {e['s']:>7.1f}s {e.get('stage') or '-':<9} model    {e['purpose']:<28} {e.get('model', ''):<18} "
                       f"{e['secs']:>6.1f}s x{e['attempts']} {e['in_tokens']:>6}+{e['out_tokens']:<6} "
                       f"{_fmt_cost(e.get('cost')):>8} " + ("ok" if e.get("ok") else f"FAILED {e.get('error', '')}"))
        elif e["ev"] == "research":
            out.append(f"  {e['s']:>7.1f}s {e.get('stage') or '-':<9} research {e['lens']}/{e['market']} "
                       f"“{str(e.get('query') or '')[:70]}” {e['secs']:.1f}s {e.get('sources', '?')} source(s) "
                       f"{_fmt_cost(e.get('cost'))}" + (" cached" if e.get("cached") else "")
                       + (f" FAILED {e['error']}" if e.get("error") else ""))
        elif e["ev"] == "jev":
            out.append(f"  {e['s']:>7.1f}s {e.get('stage') or '-':<9} jev      {e.get('check')} {e['questions']} question(s) "
                       f"{e['secs']:.2f}s {_fmt_cost(e.get('cost'))}" + (f" FAILED {e['error']}" if e.get("error") else ""))
        elif e["ev"] == "retrieval":
            out.append(f"  {e['s']:>7.1f}s {e.get('stage') or '-':<9} library  {e.get('purpose') or '-'} k={e['k']} "
                       f"{e.get('found', '?')} passage(s) {e['secs']:.1f}s" + (f" FAILED {e['error']}" if e.get("error") else ""))
        elif e["ev"] == "note":
            out.append(f"  {e['s']:>7.1f}s {e.get('stage') or '-':<9} note     {e['what']}: "
                       + json.dumps({k: v for k, v in e.items() if k not in ('t', 's', 'ev', 'job', 'stage', 'what')},
                                    ensure_ascii=False)[:400])
        elif e["ev"] in ("gap", "question", "answer"):
            out.append(f"  {e['s']:>7.1f}s {e.get('stage') or '-':<9} {e['ev']:<8} "
                       + json.dumps({k: v for k, v in e.items() if k not in ('t', 's', 'ev', 'job', 'stage')},
                                    ensure_ascii=False)[:400])
    out.append("\n## Decisions")
    for e in evs:
        if e["ev"] == "decision":
            out.append(f"  [{e.get('stage')}] {e.get('agent')} · {e.get('action')} → {', '.join(e.get('targets') or [])[:80]}"
                       f"  ({e.get('certainty') or '-'}{', ' + e['polarity'] if e.get('polarity') else ''})")
            out.append(f"      {e.get('decided') or ''}")
            if e.get("attention"):
                out.append(f"      ! {e['attention'][:300]}")
    if end and end.get("fields"):
        out.append("\n## Fields at the end")
        for k, f in end["fields"].items():
            out.append(f"  {k:<28} {f.get('state'):<9} by {f.get('by')}")
    return "\n".join(out)


def _latest(d: Path) -> Path | None:
    files = sorted(d.rglob("*.jsonl"), key=lambda p: p.stat().st_mtime)
    return files[-1] if files else None


if __name__ == "__main__":
    arg = sys.argv[1] if len(sys.argv) > 1 else "--latest"
    if arg == "--latest":
        base = Path(os.environ.get("NAPKIN_RUNLOG_DIR") or ".")
        p = _latest(base)
    else:
        p = Path(arg)
        p = _latest(p) if p.is_dir() else p
    if not p:
        sys.exit("no run log found")
    print(f"({p})\n" + report(p))
