"""The capability object (W2-C1, decision M3).

A handler receives already-scoped data and one `Capabilities` instance. It
never receives credentials, never reads the environment, and never computes
its own scope: the scope is bound here at construction, from auth (in
development, the fixed tenant in configuration), and no method accepts a
scope argument. Every call is attributed to the handler name, version, job
and scope — in the log and in the peripherals' `X-Napkin-Handler` /
`X-Napkin-Job` headers — so a slow or expensive handler is visible.

  caps.model      structured(purpose, system, payload, schema, images?, vision?) -> validated dict
  caps.research   search(query, lens, market, entity?, category?) -> sources
  caps.retrieval  packs(), retrieve(query, k, packs?, where?, purpose?) -> verbatim passages
  caps.layers     the layers protocol, bound to the scope
  caps.jobs       progress(done, total), for long tasks

`caps.capture_view()` is the object Brief Maker's extract stage gets: model
and jobs only. It has no `retrieval`, `research` or `layers` attribute, so
Loop-1 capture cannot reach a passage (peripherals.md §3.4) rather than being
trusted not to.
"""

from __future__ import annotations

import contextlib
import json
import logging
import threading
import time

from . import runlog
from .jobs import Cancelled
from .metrics import emit
from .model import ModelError, ModelPort, Usage
from .research import ResearchError, ResearchPort
from .retrieval import RetrievalError, RetrievalPort

CAPABILITY_VERSION = 1
log = logging.getLogger("napkin.caps")


def _not_cancelled(stopped):
    if stopped is not None and stopped.is_set():
        raise Cancelled()


class ModelCap:
    def __init__(self, port: ModelPort | None, usage: Usage, attribution: dict, semaphore: threading.Semaphore | None,
                 runlog_of=lambda: runlog.NULL, stopped: threading.Event | None = None):
        self._port, self._usage, self._attr, self._sem = port, usage, attribution, semaphore
        self._log = runlog_of
        self._stopped = stopped

    @property
    def model_id(self) -> str | None:
        return self._port.model if self._port else None

    @property
    def vision_model_id(self) -> str | None:
        return self._port.vision_model if self._port else None

    @property
    def api(self) -> str | None:
        return self._port.api if self._port else None

    def structured(self, purpose: str, system: str, payload: dict, schema: dict, max_tokens: int | None = None,
                   effort: str | None = None, images=None, vision: bool = False, private: bool = False) -> dict:
        if self._port is None:
            raise ModelError("no model is configured", "server")
        attr = _attr_str(self._attr)
        mine = Usage()  # this call's own tokens and attempts, for the run log; folded into the job's below
        kw = dict(usage=mine, attribution=attr, max_tokens=max_tokens, effort=effort, images=images,
                  vision=vision,
                  headers={"X-Napkin-Handler": str(self._attr.get("handler") or "-"),
                           "X-Napkin-Job": str(self._attr.get("job") or "-")})
        _not_cancelled(self._stopped)
        t0, out, err = time.monotonic(), None, None
        rl = self._log()
        try:
            if self._sem is None:
                with _busy(rl, "model", purpose):
                    out = self._port.call(purpose, system, payload, schema, **kw)
            else:
                _slot(self._sem, rl, "model", purpose)
                try:
                    _not_cancelled(self._stopped)  # it may have waited for a slot
                    t0 = time.monotonic()  # the call's own seconds; the slot's wait is its own event
                    with _busy(rl, "model", purpose):
                        out = self._port.call(purpose, system, payload, schema, **kw)
                finally:
                    self._sem.release()
            return out
        except Exception as e:
            err = f"{getattr(e, 'kind', type(e).__name__)}: {str(e)[:300]}"
            raise
        finally:
            with self._usage._lock:
                self._usage.calls += mine.calls
                self._usage.input_tokens += mine.input_tokens
                self._usage.output_tokens += mine.output_tokens
                self._usage.cache_read += mine.cache_read
                self._usage.cache_write += mine.cache_write
                for m, u in mine.by_model.items():
                    t = self._usage.by_model.setdefault(m, {"calls": 0, "input_tokens": 0, "output_tokens": 0})
                    for k in t:
                        t[k] += u[k]
            log_ = self._log()
            if log_.on:
                body = runlog.bodies() and not private  # private: a client's work is never written to the run log
                pj = json.dumps(payload, ensure_ascii=False, default=str)
                log_.model(purpose=purpose, model=next(iter(mine.by_model), None) or self._port.model, secs=time.monotonic() - t0,
                           tin=mine.input_tokens, tout=mine.output_tokens, cache_read=mine.cache_read,
                           cache_write=mine.cache_write, attempts=mine.calls, ok=err is None,
                           error=err, payload_chars=len(pj) + len(system or ""),
                           reply_chars=len(json.dumps(out, ensure_ascii=False)) if out is not None else None,
                           payload={"system": system, "payload": payload} if body else None, reply=out if body else None)


class ResearchCap:
    def __init__(self, port: ResearchPort | None, attribution: dict, semaphore: threading.Semaphore,
                 runlog_of=lambda: runlog.NULL, stopped: threading.Event | None = None):
        self._port, self._attr, self._sem = port, attribution, semaphore
        self._log = runlog_of
        self._stopped = stopped

    def search(self, query: str, lens: str, market: str, entity: str | None = None, category: str | None = None,
               max_sources: int = 6) -> dict:
        if self._port is None:
            raise ResearchError("no research service is configured")
        _not_cancelled(self._stopped)
        _slot(self._sem, self._log(), "research", f"{lens}/{market}")
        try:
            _not_cancelled(self._stopped)  # it may have waited for a slot
            t0, out, err = time.monotonic(), None, None
            try:
                with _busy(self._log(), "research", f"{lens}/{market}"):
                    out = self._port.search(query, lens, market, entity=entity, category=category,
                                            max_sources=max_sources, attribution=dict(self._attr))
                return out
            except Exception as e:
                err = f"{type(e).__name__}: {str(e)[:300]}"
                raise
            finally:
                log.info("research %s/%s %.1fs [%s]", lens, market, time.monotonic() - t0, _attr_str(self._attr))
                tr = (out or {}).get("trace") or {}
                self._log().research(lens=lens, market=market, query=query, secs=time.monotonic() - t0,
                                     sources=len((out or {}).get("sources") or []) if out is not None else None,
                                     urls=[x.get("url") for x in (out or {}).get("sources") or []][:12] or None,
                                     cost=tr.get("cost_usd"), cached=tr.get("cached"), error=err,
                                     queries=tr.get("queries") or None,
                                     results=[{"url": x.get("url"), "title": x.get("title"),
                                               "published_at": x.get("published_at"),
                                               "text": "\n".join(str(e) for e in x.get("excerpts") or [])}
                                              for x in (out or {}).get("sources") or []] if out is not None else None)
                emit("research", lens=lens, market=market, secs=round(time.monotonic() - t0, 2),
                     sources=len((out or {}).get("sources") or []), queries=len(tr.get("queries") or []),
                     error=err.split(":", 1)[0] if err else None,
                     job=self._attr.get("job"), handler=self._attr.get("handler"))
        finally:
            self._sem.release()


class JevCap:
    """jev's yes/no and choice answers about one text (napkin.jev). `configured` False when no
    key is set: a caller then goes on unchecked."""

    def __init__(self, port, runlog_of=lambda: runlog.NULL, stopped: threading.Event | None = None):
        self._port, self._log, self._stopped = port, runlog_of, stopped

    @property
    def configured(self) -> bool:
        return self._port is not None

    def ask(self, state: dict, questions: dict, what: str = "-") -> dict:
        from .jev import JevError
        if self._port is None:
            raise JevError("no jev key is configured")
        _not_cancelled(self._stopped)
        t0, out, err = time.monotonic(), None, None
        chars = len(json.dumps(state, ensure_ascii=False, default=str)) + len(json.dumps(questions))
        try:
            with _busy(self._log(), "jev", what):
                out = self._port.ask(state, questions)
            return out
        except Exception as e:
            err = f"{type(e).__name__}: {str(e)[:300]}"
            raise
        finally:
            # jev bills input tokens only, about $0.04 per million (Sai's 2026-09-24 lab); ~4 chars a token
            self._log().jev(check=what, questions=len(questions), secs=time.monotonic() - t0, state_chars=chars,
                            cost=round(chars / 4 / 1e6 * 0.04, 6), error=err)


class RetrievalCap:
    """Passages from the knowledge packs, under the bound scope. The packs list
    is read once per job."""

    def __init__(self, port: RetrievalPort | None, scope: dict, attribution: dict, runlog_of=lambda: runlog.NULL,
                 stopped: threading.Event | None = None):
        self._port, self._scope, self._attr = port, scope, attribution
        self._log = runlog_of
        self._stopped = stopped
        self._packs = None
        self._lock = threading.Lock()

    @property
    def configured(self) -> bool:
        return self._port is not None

    def packs(self) -> list[dict]:
        if self._port is None:
            raise RetrievalError("no retrieval service is configured")
        with self._lock:
            if self._packs is None:
                self._packs = self._port.packs(self._scope, dict(self._attr))
            return [dict(p) for p in self._packs]

    def retrieve(self, query: str, k: int, packs=None, where=None, purpose: str | None = None) -> dict:
        if self._port is None:
            raise RetrievalError("no retrieval service is configured")
        _not_cancelled(self._stopped)
        t0, out, err = time.monotonic(), None, None
        try:
            with _busy(self._log(), "retrieval", purpose):
                out = self._port.retrieve(self._scope, dict(self._attr), query, k, packs=packs, where=where,
                                          purpose=purpose)
            return out
        except Exception as e:
            err = f"{type(e).__name__}: {str(e)[:300]}"
            raise
        finally:
            log.info("retrieval %s %.1fs [%s]", purpose or "-", time.monotonic() - t0, _attr_str(self._attr))
            found = None
            if isinstance(out, dict):
                found = len(out.get("passages") or out.get("hits") or [])
            self._log().retrieval(purpose=purpose, k=k, secs=time.monotonic() - t0, found=found, error=err,
                                  query=query)


def _busy(rl, kind: str, what: str | None):
    """The run log's in-flight mark for a call (a log without one, a test's, marks nothing)."""
    busy = getattr(rl, "busy", None)
    return busy(kind, what) if busy is not None else contextlib.nullcontext()


SLOT_WAIT_S = 1.0  # a wait for a model or research slot longer than this is a `waiting` event


def _slot(sem: threading.Semaphore, rl, kind: str, what: str):
    """Acquire `sem` (the caller releases it). A wait longer than SLOT_WAIT_S is in flight while it lasts
    (the heartbeat names it) and a `waiting` event afterwards: every slot was taken by other calls."""
    if sem.acquire(blocking=False):
        return
    t0 = time.monotonic()
    with _busy(rl, "slot", f"a {kind} slot for {what}"):
        sem.acquire()
    secs = time.monotonic() - t0
    if secs >= SLOT_WAIT_S and hasattr(rl, "waiting"):
        rl.waiting(f"a {kind} slot", call=what, secs=round(secs, 2))


class LayersCap:
    """The layers, as the job sees them: every call timed and logged (`layers` event) and in flight
    while it runs. A store that connects lazily (PgLayers) is handed hooks for its connects, so a
    connect that takes long (a paused Aurora resuming) is a `waiting` event while it lasts and a
    `layers_connect` event with its seconds. Returns and raises exactly what the layers do."""

    def __init__(self, inner, runlog_of):
        self._inner, self._log = inner, runlog_of
        if hasattr(inner, "on_wait"):
            inner.on_wait = lambda what, **kw: self._log().waiting(what, **kw)
        if hasattr(inner, "on_connect"):
            inner.on_connect = lambda **kw: self._log().layers_connect(**kw)

    def __getattr__(self, name):
        attr = getattr(self._inner, name)
        if not callable(attr) or name.startswith("_"):
            return attr

        def call(*a, **kw):
            rl = self._log()
            t0, err = time.monotonic(), None
            try:
                with _busy(rl, "layers", name):
                    return attr(*a, **kw)
            except Exception as e:
                err = f"{type(e).__name__}: {str(e)[:300]}"
                raise
            finally:
                rl.layers(op=name, secs=time.monotonic() - t0, error=err)
        return call


class JobCap:
    def __init__(self):
        self._lock = threading.Lock()
        self.done, self.total = 0, 1
        self.stopped = threading.Event()  # set when a person cancels the job

    def stop(self):
        self.stopped.set()

    @property
    def cancelled(self) -> bool:
        return self.stopped.is_set()

    def progress(self, done: int, total: int | None = None):
        with self._lock:
            if total is not None:
                self.total = total
            self.done = max(self.done, min(done, self.total))


class CaptureView:
    """What Loop-1 capture may use: the model and the job. Nothing that reads
    a pack, the web or the layers."""

    __slots__ = ("model", "jobs", "handler")

    def __init__(self, model: ModelCap, jobs: JobCap, handler: str):
        self.model, self.jobs, self.handler = model, jobs, handler


def _attr_str(a: dict) -> str:
    return f"{a.get('handler')} job={a.get('job')} org={a.get('org')} brand={a.get('brand')}"


class Capabilities:
    version = CAPABILITY_VERSION

    def __init__(self, *, handler: str, scope: dict, model_port, research_port, layer_store,
                 research_semaphore: threading.Semaphore, jobs: JobCap | None = None, retrieval_port=None,
                 model_semaphore: threading.Semaphore | None = None, jev_port=None):
        self._scope = dict(scope)
        self.handler = handler
        self.attribution = {"handler": handler, "job": "-", "org": scope["org"], "brand": scope["brand"]}
        self.usage = Usage()
        self.runlog = runlog.NULL  # the dogfood run log, opened when a job is bound
        of = lambda: self.runlog  # noqa: E731
        self.jobs = jobs or JobCap()
        st = self.jobs.stopped
        self.model = ModelCap(model_port, self.usage, self.attribution, model_semaphore, of, st)
        self.research = ResearchCap(research_port, self.attribution, research_semaphore, of, st)
        self.retrieval = RetrievalCap(retrieval_port, self._scope, self.attribution, of, st)
        self.jev = JevCap(jev_port, of, st)
        try:
            layers = layer_store.open(self._scope, self.attribution)
        except TypeError:  # a store whose open() takes the scope only
            layers = layer_store.open(self._scope)
        self.layers = LayersCap(layers, of)

    def bind_job(self, job_id: str):
        """The job id every later call is attributed to, and the job's run log."""
        self.attribution["job"] = job_id
        self.runlog = runlog.open_log(job_id, self.handler, self._scope.get("org"))

    def capture_view(self) -> CaptureView:
        return CaptureView(self.model, self.jobs, self.handler)

    @property
    def scope(self) -> dict:
        """Read-only: reported in trace.scope, never an input."""
        return dict(self._scope)

    def model_ran(self) -> bool:
        return self.usage.calls > 0
