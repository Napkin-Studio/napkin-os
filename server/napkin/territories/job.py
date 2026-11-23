"""run_territories@1: one step of a Territories run, in this process (middleware-api.md §13, features/territories-handlers).

Territories runs inside the middleware like Brief and Research: the job calls ``engine/territory/runner.py`` in its own thread, with a
per-document ``Store`` (the resume cache), the carried facts, findings and sources, the Confidential marks (``build_deck.marks_of``) and the
job's cancel Event. What the runner returns is written back as ONE change: the diff of the document it returned against the document it
read, with the runner's ask / spend / outcome entries as decisions (the only place a price is written). A step the person asks for that
needs no model (a greenlight, an answer, a send) runs inside the request and the first reply is already finished.

A model step never writes what the person writes (``run.approvals``, ``run.decisions``, ``run.gate_requests``): the read-set names ``run.<key>``,
never the whole ``run``, so a tick or an approval made while the job ran does not make the host judge the job stale. A failed step is a run
written ``failed`` with its words in ``run.error`` (the runner's), and a move the engine refuses is a failed job carrying the refusal.
"""
from __future__ import annotations

import copy
import logging
import threading
import time
import traceback

from .. import reasoning as rsn
from ..brief.job import Chunk, combine
from ..doc import apply_patch, ctx_data_carried, decision, get_dotted
from ..jobs import Abandoned
from ..util import TaskError, iso, uid
from . import telemetry

log = logging.getLogger("napkin.territories")

#: What the person writes. A model step leaves these as the document had them.
PERSON_KEYS = ("approvals", "decisions", "gate_requests")
UNFINISHED = ("queued", "running")
BUSY_WORDS = "This run is already going. Wait for it to finish, then look again."


def make_llm():
    """The live model: ``engine/territory/llm.py``'s LiveLLM, whose transport is ``engine/brief_llm.py`` (the Anthropic API, the local model
    backend, or Claude in Bedrock with the task role when NAPKIN_MODEL_API=bedrock). A test replaces this function."""
    from territory.llm import LiveLLM
    return LiveLLM(approved=True)


def _words(e: dict) -> str:
    """One runner history entry as a sentence for the decision history. A price is written here and nowhere else."""
    k = e.get("kind")
    if k == "ask" and e.get("what") == "lookup":
        return f"A look-up was approved by {e.get('by') or 'a person'} before it was made, estimated at ${float(e.get('estimate_usd') or 0):.3f}."
    if k == "ask" and e.get("what") == "frames":
        cap = e.get("cap_usd") or {}
        return (f"Pictures were costed before the first one was made: {e.get('frames', '?')} pictures for {e.get('routes', '?')} greenlit routes, estimated at "
                f"${float(e.get('estimate_usd') or 0):.2f}, capped at ${float(cap.get('pictures') or 0):.2f} for pictures. Asked by {e.get('by') or 'a person'}.")
    if k == "ask":
        cap = e.get("cap_usd") or {}
        return (f"The run was costed before the first paid call: about {e.get('calls', '?')} model calls, estimated at ${float(e.get('estimate_usd') or 0):.2f}"
                + (f", capped at ${float(cap['claude']):.2f} for model work" if cap.get("claude") is not None else "") + f". Asked by {e.get('by') or 'the engine'}.")
    if k == "spend" and e.get("provider") == "search":
        return f"A look-up was made through the research port: ${float(e.get('usd') or 0):.4f}."
    if k == "spend" and e.get("provider") == "runway":
        return f"A picture attempt was made through the picture provider: ${float(e.get('usd') or 0):.2f}."
    if k == "spend":
        return (f"{e.get('stage')}: {e.get('model') or e.get('provider')}, {e.get('tokens_in', 0)} tokens in, {e.get('tokens_out', 0)} out, "
                f"${float(e.get('usd') or 0):.4f}" + (" (estimated)" if e.get("estimated") else "") + ".")
    if k == "outcome" and e.get("what") == "frames":
        c = e.get("counts") or {}
        return f"The pictures step made {c.get('made', 0)}, placed {c.get('placed', 0)} and held {c.get('held', 0)} for a person to look at."
    if k == "outcome" and e.get("what") == "look-up":
        c = e.get("counts") or {}
        return f"The look-up found {c.get('finds', 0)} quotes on {c.get('pages', 0)} pages."
    sp = e.get("spent_usd") or {}
    counts = ", ".join(f"{n} {x}" for x, n in (e.get("counts") or {}).items())
    return f"The run came to {counts or 'nothing yet'}; spent so far ${float(sp.get('claude') or 0):.2f} on model work."


def diff(old, new):
    """The merge patch that turns ``old`` into ``new``: objects key by key (a key that went is ``null``), a value that did not change not at
    all, anything else (a list, a scalar) whole."""
    if isinstance(old, dict) and isinstance(new, dict):
        out = {k: None for k in old if k not in new}
        for k, v in new.items():
            if k in old and old[k] == v:
                continue
            if isinstance(v, dict) and isinstance(old.get(k), dict):
                out[k] = diff(old[k], v)
            elif isinstance(v, dict):
                out[k] = {a: b for a, b in v.items() if b is not None}
            elif v is None:
                if k in old:
                    out[k] = None
            else:
                out[k] = copy.deepcopy(v)
        return out
    return new


class TerritoriesJob:
    """One step. ``call(job) -> runner.Result``-shaped ``(doc, decisions, info, busy, stopped, refusals)``; ``quick`` runs it in the request."""
    kind = "territories"
    stages = ["run"]

    def __init__(self, jid, task, handler, req, caps, *, step, call, quick=False, owns_person_keys=False, total=1):
        self.id, self.task, self.handler, self.step = jid, task, handler, step
        self.doc, self.base, self.clan = req.doc, req.base, req.clan
        self.caps, self.scope = caps, caps.scope
        self.call, self.quick, self.owns_person_keys = call, quick, owns_person_keys
        self.data = copy.deepcopy(ctx_data_carried(req.clan))
        self.cancel_event: threading.Event = caps.jobs.stopped
        self.lock = threading.RLock()
        self.state, self.started_at, self.finished_at, self.error = "queued", iso(), None, None
        self.chunks: list[Chunk] = []
        self.last_change = None
        self.hits: list = []
        self.summary = ""
        self.pending: list = []                 # a person's small moves that came while the step ran: applied to the document it returns
        self.done_n, self.total_n = 0, max(1, total)
        self.info: dict = {}
        self.crew: list[dict] = []              # the crew's lanes while explore runs (progress): who is out, who is back and with how many routes
        self.res = None                         # what the runner returned, for the run log's record
        self.store, self.seg_base, self.t0 = None, 0, None    # set when the step starts: the run's store, its segments before it, its start (the ledger's clock)
        self.tele = telemetry.Collector()
        self.thread = threading.Thread(target=self._run, name=f"{task}-{jid}", daemon=True)

    # -- the worker ----------------------------------------------------------------
    def start(self):
        if self.quick:
            self._run()
        else:
            self.thread.start()

    def cancel(self) -> bool:
        """A person stopped the job: ``cancelled`` at once and no further model call is made. What was already paid for is in the store,
        so the next Explore goes on from there and pays for nothing twice. Nothing it computed is written."""
        with self.lock:
            if self.state not in UNFINISHED:
                return False
            self.state, self.finished_at = "cancelled", iso()
            if self.pending:        # what the person chose while it ran is theirs: written as a change of its own, not lost with the step
                doc, _ = self._apply_pending(copy.deepcopy(self.data))
                patch = self._patch(doc)
                if patch:
                    self._take_decisions(type("R", (), {"decisions": []}), patch)
        self.caps.jobs.stop()
        return True

    def defer(self, move) -> bool:
        """Hold a person's move (``fn(doc) -> (doc, refusals)``) until the running step has its document: True when it will be applied there,
        False when the step has already finished (the caller applies the move to the current document). Decided under the job's lock, the one
        the finish takes, so a move is never both missed and lost."""
        with self.lock:
            if self.state not in UNFINISHED:
                return False
            self.pending.append(move)
            return True

    def _apply_pending(self, doc: dict) -> tuple[dict, list]:
        refusals = []
        for mv in self.pending:
            doc, ref = mv(doc)
            refusals += ref
        self.pending = []
        return doc, refusals

    def progress(self, p: dict):
        """The runner's word on the crew: ``{setting_off: [member]}`` once before they go (not counted), then ``{crew, state, routes}`` as each
        is back. The job keeps one entry per member for its status (``crew``), so the page can show who is out and who is back while the
        document is still unwritten (it gets crew, expeditions and territories only at the end)."""
        with self.lock:
            if isinstance(p, dict) and isinstance(p.get("setting_off"), list):
                self.crew = [{"id": m.get("id"), "name": m.get("name"), "short": m.get("short"), "role": m.get("role"), "colour": m.get("colour"),
                              "heading": m.get("heading"), "state": "out", "routes": 0} for m in p["setting_off"] if isinstance(m, dict) and m.get("id")]
                return
            self.done_n = min(self.total_n, self.done_n + 1)
            if isinstance(p, dict) and p.get("crew"):
                for m in self.crew:
                    if m["id"] == p["crew"]:
                        m["state"], m["routes"] = str(p.get("state") or "back"), int(p.get("routes") or 0)

    def _cancelled(self) -> bool:
        return self.state == "cancelled"

    def _run(self):
        with self.lock:
            if self._cancelled():
                return
            self.state = "running"
            self.t0 = time.time()
        rl = getattr(self.caps, "runlog", None)
        if rl is not None:
            rl.start(self.task, self.doc, ["run"], step=self.step)
        try:
            stage = rl.stage("run") if rl is not None else None
            if stage is not None:
                with stage:
                    self._work()
            else:
                self._work()
        except Abandoned:
            return
        except TaskError as e:
            self._fail(e.etype, e.message)
        except Exception as e:  # noqa: BLE001 - the job still ends, and says so in words
            if self._cancelled():
                return
            log.error("%s %s failed: %s\n%s", self.task, self.id, e, traceback.format_exc())
            self._fail("internal", "The step stopped before it finished. What was made is saved; try again.")
        finally:
            if rl is not None:
                telemetry.write(rl, self, self.res)
                rl.end(self.state, error=self.error)

    def _work(self):
        res = self.res = self.call(self)
        with self.lock:
            if self._cancelled():
                return
            if getattr(res, "busy", False):
                self._fail("job_state", BUSY_WORDS, locked=True)
                return
            self.info = dict(getattr(res, "info", {}) or {})
            refusals = list(getattr(res, "refusals", []) or [])
            if refusals:                                  # the engine said no, in words: nothing is written, whatever it spent is recorded
                self._fail("refused", " ".join(refusals), locked=True)
                self._take_decisions(res, patch={})
                return
            if self.pending:
                res.doc, _ = self._apply_pending(res.doc)
            patch = self._patch(res.doc)
            self._take_decisions(res, patch)
            self.summary = getattr(res, "note", "") or self._summary(res)
            self.state, self.finished_at = "done", iso()

    def _fail(self, etype: str, message: str, locked: bool = False):
        def go():
            if self._cancelled():
                return
            self.state, self.error, self.finished_at = "failed", {"type": etype, "message": message}, iso()
        if locked:
            go()
        else:
            with self.lock:
                go()

    # -- what the step wrote, as a change ----------------------------------------------
    def _patch(self, new: dict) -> dict:
        old = self.data
        new = copy.deepcopy(new)
        if not self.owns_person_keys and isinstance(new.get("run"), dict):
            orun = old.get("run") if isinstance(old.get("run"), dict) else {}
            for k in PERSON_KEYS:
                if k in orun:
                    new["run"][k] = copy.deepcopy(orun[k])
                else:
                    new["run"].pop(k, None)
        return diff(old, new)

    def _paths(self, patch: dict) -> list[str]:
        out = []
        for k, v in patch.items():
            if k == "run" and isinstance(v, dict):
                out += [f"run.{x}" for x in v]
            else:
                out.append(k)
        return out

    def _take_decisions(self, res, patch: dict):
        paths = self._paths(patch) or ["run"]
        known = {d.get("id") for d in ((self.clan or {}).get("decision_chain") or {}).get("decisions") or [] if isinstance(d, dict)}
        decs = []
        wrote = bool(patch)
        if wrote:
            r = rsn.make(f"Ran the Territories {self.step.replace('_', ' ')} step.",
                         [rsn.point("The document is what the engine returned for the document it was given; the person's approvals, decisions and requests are untouched"
                                    if not self.owns_person_keys else "The person asked for this move, and the engine applied its own rules to it")],
                         rsn.certainty("high", "these are the engine's outputs, read back from it"),
                         "the picks or the routes change, or the person asks again", only_option="the screens show only what the engine writes")
            d = decision(self.doc, uid("d_", self.doc, self.id, "step"), "edit", self.handler, self.step, "", paths, [], reasoning=r)
            d["agent"] = f"{self.handler}/engine"
            decs.append(d)
        for i, e in enumerate(getattr(res, "decisions", []) or []):
            did = uid("d_", self.doc, "territories", e.get("kind"), e.get("at"), e.get("stage"), e.get("provider"), e.get("usd"), e.get("model"), i if e.get("kind") == "outcome" else 0)
            if did in known:
                continue
            r = rsn.make(_words(e), [rsn.point("Written by the run's ledger when it happened")], rsn.certainty("high", "read from the ledger the run keeps"),
                         "it is a record of what happened", only_option="it is a record")
            d = decision(self.doc, did, "edit", self.handler, str(e.get("kind")), _words(e), paths, [], reasoning=r)
            d["agent"] = f"{self.handler}/ledger"
            decs.append(d)
        if not decs and not wrote:
            return
        read = {p: get_dotted(self.data, p) for p in paths} if wrote else {}
        self.chunks.append(Chunk("run", self.base, copy.deepcopy(patch), read, decs))

    def _summary(self, res) -> str:
        err = (getattr(res, "doc", {}).get("run") or {}).get("error")
        if err:
            return "Failed: " + str(err.get("message") or "the step stopped.")
        run = getattr(res, "doc", {}).get("run") or {}
        gate = (run.get("gate") or {}).get("id")
        if run.get("state") == "gate" and gate:
            return f"Held at the {gate} gate: nothing runs until the person approves it."
        if run.get("state") == "done":
            return "The run is finished."
        return "Done."

    # -- replies -------------------------------------------------------------------
    def reply_change(self, clan):
        with self.lock:
            known = {d.get("id") for d in (clan.get("decision_chain") or {}).get("decisions") or []}
            pending = [c for c in self.chunks if not c.ids <= known]
            change = combine(self.doc, pending)
            if change is None and self.state in ("done", "failed", "cancelled"):
                change = self.last_change
            if change is not None:
                self.last_change = change
            return change

    def view(self):
        with self.lock:
            return {"id": self.id, "state": self.state, "progress": {"done": self.total_n if self.state == "done" else self.done_n, "total": self.total_n},
                    "stage": self.step, "question": None, "started_at": self.started_at, "finished_at": self.finished_at, "error": self.error,
                    "crew": [dict(m) for m in self.crew]}

    def result(self):
        with self.lock:
            s = {"done": self.summary or "Done.", "failed": f"Failed: {(self.error or {}).get('message')}",
                 "cancelled": "Cancelled: what was already paid for is saved, and the next run goes on from there."}.get(
                     self.state, "The crew is working." if self.state == "running" else "queued")
            return {"summary": s, "step": self.step, "info": {k: v for k, v in self.info.items() if k in ("calls", "frames", "card")}}
