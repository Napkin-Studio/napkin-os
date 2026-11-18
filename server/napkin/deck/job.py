"""build_deck@1: one segment of a Deck Maker run, through the engine's port (middleware-api.md §12).

A job is one segment: it asks the deck engine to run the document's next stretch (up to the storyline, territories or idea gate, or on
to the finished deck), polls it, and turns what the engine reports into staged changes the host applies: the run object the screens
read (rows, items, agent, gate, checks, cost), and once built the deck, validation, evidence, report and export names. It never writes
what the app writes (`run.approvals`, `run.decisions`, `run.gate_requests`), and it never writes a made-up success: an engine that fails,
does not answer or answers garbage ends the job as failed with that message and the run as failed with the same.

The engine keeps each run's stage outputs in a cache of its own and holds nothing open across a gate, so nothing here waits for a
person: the gate is a finished segment, and the person's approval (a decision the app wrote) is read from the document on the next call.
"""
from __future__ import annotations

import copy
import logging
import threading
import time
import traceback

from .. import reasoning as rsn
from ..brief.job import Chunk, combine
from ..doc import apply_patch, ctx_data, decision, get_dotted
from ..jobs import Abandoned
from ..util import iso, uid
from . import engine as eng

log = logging.getLogger("napkin.deck")

#: The run keys the middleware writes. The app writes the others (approvals, decisions, gate_requests): never touched here.
RUN_OWNED = ("state", "stage", "stages", "gate", "agent", "checks", "error", "done", "cost_usd", "images", "types")
#: Written whole once the deck is built.
PAYLOAD = ("deck", "validation", "evidence", "report", "exports", "qa", "repair", "production")   # production: the picker's view (deck-prod-picker P6)
#: Seconds between polls of the engine, and the longest a segment may take (a high-effort stage can run for minutes).
POLL = 1.0
MAX_WAIT = 3600.0
UNFINISHED = ("queued", "running")


def diff(old, new):
    """The merge patch that turns old into new: objects key by key (a missing key as null), anything else whole."""
    if isinstance(new, dict) and isinstance(old, dict):
        out = {k: None for k in old if k not in new}
        for k, v in new.items():
            if v is None:
                if k in old:
                    out[k] = None
            else:
                d = diff(old.get(k), v)
                if d != {} or k not in old:
                    out[k] = d
        return out
    if isinstance(new, dict):
        return {k: v for k, v in new.items() if v is not None}
    return new


class DeckJob:
    kind = "deck"
    stages = ["build"]

    def __init__(self, jid, task, handler, req, caps, *, port, body):
        self.id, self.task, self.handler = jid, task, handler
        self.doc, self.base, self.clan = req.doc, req.base, req.clan
        self.caps, self.scope = caps, caps.scope
        self.port, self.body = port, body
        self.W = copy.deepcopy(ctx_data(req.clan))
        self.lock = threading.RLock()
        self.state, self.started_at, self.finished_at, self.error = "queued", iso(), None, None
        self.chunks: list[Chunk] = []
        self.last_change = None
        self.hits: list = []
        self.seq = 0
        self.engine_state, self.run_stage, self.mode, self.notices, self.cost = None, None, None, [], None
        self.held = None
        self.thread = threading.Thread(target=self._run, name=f"{task}-{jid}", daemon=True)

    # -- the worker ----------------------------------------------------------------
    def start(self):
        self.thread.start()

    def cancel(self) -> bool:
        """A person stopped the job: `cancelled` at once. What it already sent stays. The engine's own segment cannot be stopped from
        here: it finishes, and its stage outputs are in its cache for the next call."""
        with self.lock:
            if self.state not in UNFINISHED:
                return False
            self.state, self.finished_at = "cancelled", iso()
            self.caps.jobs.stop()
        log.info("%s %s cancelled; the engine's segment goes on and its output stays in the engine's cache", self.task, self.id)
        return True

    def _cancelled(self) -> bool:
        return self.state == "cancelled"

    def _run(self):
        with self.lock:
            if self._cancelled():
                return
            self.state = "running"
        try:
            view = self.port.start(self.body)
            self._take(view)
            deadline = time.monotonic() + MAX_WAIT
            while view["state"] == "building":
                if self._cancelled():
                    return
                if time.monotonic() > deadline:
                    raise eng.EngineError(0, "engine_timeout", "the deck engine took too long to finish this stage")
                time.sleep(POLL)
                view = self.port.poll(self.doc)
                self._take(view)
            with self.lock:
                if self._cancelled():
                    return
                if view["state"] == "failed":
                    e = view.get("error") or (view.get("run") or {}).get("error") or {}
                    self.state, self.error = "failed", {"type": "engine", "message": str(e.get("message") or "the deck engine stopped")}
                else:
                    self.state = "done"
                self.finished_at = iso()
        except eng.EngineError as e:
            self._fail(e.etype, e.message)
        except Abandoned:
            return
        except Exception as e:  # noqa: BLE001 - the runner itself: the job still ends, and says so
            if self._cancelled():
                return
            log.error("%s %s runner failed: %s\n%s", self.task, self.id, e, traceback.format_exc())
            self._fail("internal", f"the deck job's runner failed ({type(e).__name__})")

    def _fail(self, etype: str, message: str):
        """The engine failed or could not be read: the run is failed with the same message, as a change, so the screens say so."""
        with self.lock:
            if self._cancelled():
                return
            old = self.W.get("run") if isinstance(self.W.get("run"), dict) else {}
            row = old.get("stage") or "inputs"
            stages = []
            for s in old.get("stages") or []:
                s = dict(s)
                if s.get("id") == row and s.get("status") == "now":
                    s["status"], s["sub"] = "failed", "Stopped"
                stages.append(s)
            run = {"state": "failed", "stage": row, "stages": stages or None, "gate": None, "error": {"stage": row, "message": message, "retryable": True},
                   "agent": {"key": ((old.get("agent") or {}).get("key") or "brief"), "activity": "error"}}
            self._add({k: v for k, v in run.items() if v is not None or k == "gate"}, {}, f"the engine failed: {message}")
            self.state, self.error, self.finished_at = "failed", {"type": etype, "message": message}, iso()

    # -- what the engine said, as a change ---------------------------------------------
    def _take(self, view: dict):
        run = view["run"]
        with self.lock:
            self.engine_state, self.run_stage, self.mode = view["state"], run.get("stage"), view.get("mode")
            self.notices, self.cost = list(view.get("notices") or []), run.get("cost_usd")
            self.held = (run.get("gate") or {}).get("id") if view["state"] == "gate" else None
            old = self.W.get("run") if isinstance(self.W.get("run"), dict) else {}
            patch_run = {}
            for k in RUN_OWNED:
                nv = run.get(k)
                if nv is None:
                    if old.get(k) is not None:
                        patch_run[k] = None   # a key the run no longer has (the agent at a gate, the gate once approved) is deleted
                elif old.get(k) != nv:
                    patch_run[k] = diff(old.get(k), nv)
            payload = {}
            for k in PAYLOAD:
                v = (view.get("payload") or {}).get(k)
                if v is not None and self.W.get(k) != v:
                    payload[k] = v
            if patch_run or payload:
                where = {"building": "under way", "gate": f"held at the {self.held} gate", "done": "the deck is built", "failed": "stopped"}[view["state"]]
                self._add(patch_run, payload, f"the engine reports {where}")

    def _add(self, run_patch: dict, payload: dict, why: str):
        patch = {}
        if run_patch:
            patch["run"] = run_patch
        patch.update(payload)
        # The read-set at the finest grain the app does not share: the app writes run.approvals beside these keys, so the host must
        # not judge the whole run object stale because of a decision the person made while the job ran.
        paths = [f"run.{k}" for k in run_patch] + list(payload)
        read = {p: get_dotted(self.W, p) for p in paths}
        self.seq += 1
        r = rsn.make(f"Ran the deck engine: {why}.", [rsn.point("The run is the engine's own report of what it wrote")],
                     rsn.certainty("high", "these are the engine's outputs, read back from it"),
                     "the inputs change, or the person asks for a stage again", only_option="the screens show only what the engine reports")
        d = decision(self.doc, uid("d_", self.doc, self.id, "run", self.seq), "edit", self.handler, "build_deck", "", paths, [], reasoning=r)
        d["agent"] = f"{self.handler}/engine"
        with self.lock:
            self.chunks.append(Chunk("build", self.base, copy.deepcopy(patch), read, [d]))
            self.W = apply_patch(self.W, patch)

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
            return {"id": self.id, "state": self.state, "progress": {"done": 1 if self.state == "done" else 0, "total": 1},
                    "stage": self.run_stage or "build", "question": None, "started_at": self.started_at,
                    "finished_at": self.finished_at, "error": self.error}

    def result(self):
        with self.lock:
            if self.state == "done":
                s = ({"gate": f"Held at the {self.held} gate: nothing runs until the person approves it.",
                      "done": "The deck is built."}.get("gate" if self.held else "done"))
            elif self.state == "failed":
                s = f"Failed: {self.error['message']}"
            elif self.state == "cancelled":
                s = "Cancelled: what the engine had written stays in its cache."
            else:
                s = "The deck engine is running." if self.state == "running" else "queued"
            return {"summary": s, "engine": {"state": self.engine_state, "mode": self.mode, "notices": list(self.notices), "cost_usd": self.cost}}
