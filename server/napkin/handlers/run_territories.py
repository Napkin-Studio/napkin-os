"""run_territories@1: Territories, one step of a run, in this process (middleware-api.md §13).

One task with a ``step`` (the app's own seam, TASKS in app/templates/territories/index.html):

    (no step) / run      explore: the insights, then the gates, to the next stop        long: runner.run
    steer                one crew member: further, pull, cross or stop                  long: runner.steer
    more                 more lines for one developed route                              long: runner.more
    push                 one route's world, written again further                        long: runner.push
    rerank_routes        the blind judge orders the routes again                         long: runner.rerank
    undo                 take one of the Review agent's fixes back                       quick, no model
    greenlight_route, remove_route, answer_ask, record_review, approve, send_routes      quick, no model (territory/gates.py's rules)
    set_lead, star_line, keep_feel, set_final, set_rights   a person's choices about a world and its pictures (small moves; while a model step runs they wait in it and both survive)
    lookup               the Booth's "Look it up": q alone asks (the OK card, no call); lookup_id + ok true runs ONE search through the research port
                         (long, paid through the spend module's caps, once per look-up); ok false says no. Results arrive as finds and a Booth note
    pin_quote            a named person pins a checked quote into the document (find_id, on)
    place_pictures       arrived pictures into route slots by link (pictures.fill / attach)      quick, no model

A document that arrives with pictures (``assets``) has every one put on the workspace store before a run reads it (pictures.rehome, require_all):
a partial arrival is refused in words and nothing runs (territories/arrival.py).

The carried facts, findings and sources, and the Confidential marks (``build_deck.marks_of``, the same reading as the deck), go to the
runner on every call. A long step runs in a job thread with a store of its own for the document (``NAPKIN_TERRITORY_DATA``) and the job's
cancel Event; a document with a step already going is a 409. What the runner returns is written back as the change (territories/job.py).
"""
from __future__ import annotations

from ..doc import ctx_data
from ..territories import arrival
from ..territories import job as J
from ..territories import moves
from ..territories import to_deck  # noqa: F401  (registers the deck-maker destination of send_routes)
from ..territories.job import TerritoriesJob
from ..util import TaskError, bad
from .build_deck import marks_of

NAME, TASK, VERSION, KIND, CAPABILITY_MAJOR = "run_territories", "run_territories", "1.0", "territories", 1

#: steps that call the model (long) and the ones that do not (answered in the request)
MODEL_STEPS = ("run", "steer", "more", "push", "rerank_routes")
QUICK_STEPS = (*moves.LIVE_STEPS, "lookup", "place_pictures", "undo", "greenlight_route", "remove_route", "answer_ask", "record_review", "approve", "send_routes")
#: the four pushes the World view offers, by name (any other text is the person's own instruction)
PUSH_WORDS = {"braver": "Push this world further: braver, bolder, more specific, same thought.", "safer": "Pull this world back: safer, plainer, less risky, same thought.",
              "more ownable": "Make this world more ownable: lines only this brand could say, same thought.",
              "more proof": "Make this world lean harder on the evidence the brief and the research carry, same thought."}
STEERS = ("further", "pull", "cross", "stop")


class _Done:
    """What a quick move hands the job: the runner's Result shape."""

    def __init__(self, doc, refusals=(), note=""):
        self.doc, self.refusals, self.note = doc, list(refusals), note
        self.decisions, self.info, self.busy, self.stopped = [], {}, False, False


def _engine():
    import importlib
    try:
        runner, routes = importlib.import_module("territory.runner"), importlib.import_module("territory.routes")
    except ImportError as e:     # the middleware was started without the engine on its path
        raise TaskError(503, "engine_unavailable", "Territories is not available in this middleware: the engine package is not installed.") from e
    return runner, routes


def _arrive(doc_id, data):
    """The arrival report, or the refusal in words."""
    from territory import pictures
    try:
        return arrival.arrive(doc_id, data)
    except pictures.PictureError as e:
        return str(e)


def start(req, caps, settings, jid):
    """Validate now (a 400 before any job, a 503 when the engine package is missing); build the job (the caller starts it)."""
    inp = req.inp
    step = inp.get("step") or "run"
    if step not in MODEL_STEPS + QUICK_STEPS:
        raise bad(f"input.step must be one of {', '.join(MODEL_STEPS + QUICK_STEPS)}")
    data = ctx_data(req.clan)
    if not data:
        raise bad("this document has no Territories data to work on")
    runner, routes = _engine()
    clan = req.clan or {}
    facts, findings, sources = clan.get("facts"), clan.get("findings"), clan.get("sources")
    marks = marks_of(data, (clan.get("decision_chain") or {}).get("decisions") or [])
    by = moves._s(inp, "by", 80)
    rl = caps.runlog

    def on_line(kw, job=None):
        try:
            rl.model(**kw)
        except Exception:   # noqa: BLE001 - the run log never stops a run
            pass
        if job is not None:
            job.tele.line(kw)

    def common(job):
        store = runner.Store.for_doc(req.doc)
        job.store, job.seg_base = store, len(store.segments())      # the run log's record counts only what this step does
        return dict(llm=J.make_llm(), store=store, facts=facts, findings=findings, sources=sources, marks=marks,
                    cancel=job.cancel_event, doc_id=req.doc, on_line=lambda kw: on_line(kw, job))

    if step == "run":
        total = max(1, len(data.get("crew") or routes.CREW))
        def go(job):
            if arrival.has_pictures(data):
                refused = _arrive(req.doc, data)
                if isinstance(refused, str):
                    return _Done(data, [refused])
            return runner.run(data, on_progress=job.progress, **common(job))
        return TerritoriesJob(jid, TASK, req.handler, req, caps, step=step, total=total, call=go)
    if step == "steer":
        cid, kind = moves.need(inp, "crew_id", "which agent"), moves._s(inp, "kind", 20)
        if kind not in STEERS:
            raise bad("input.kind must be further, pull, cross or stop")
        return TerritoriesJob(jid, TASK, req.handler, req, caps, step=step,
                              call=lambda job: runner.steer(data, cid, kind, by, with_=moves._s(inp, "with", 80) or None, **common(job)))
    if step == "more":
        tid = moves.need(inp, "territory_id", "the route")
        n = inp.get("n")
        if n is not None and (not isinstance(n, int) or isinstance(n, bool) or n < 1):
            raise bad("input.n must be a whole number above 0")
        return TerritoriesJob(jid, TASK, req.handler, req, caps, step=step,
                              call=lambda job: runner.more(data, tid, by, steer_text=moves._s(inp, "steer", 300) or None, n=n, **common(job)))
    if step == "push":
        tid = moves.need(inp, "territory_id", "the route")
        ins = moves._s(inp, "instruction", 300)
        ins = PUSH_WORDS.get(ins.lower(), ins) or None
        return TerritoriesJob(jid, TASK, req.handler, req, caps, step=step,
                              call=lambda job: runner.push(data, tid, by, instruction=ins, **common(job)))
    if step == "rerank_routes":
        return TerritoriesJob(jid, TASK, req.handler, req, caps, step=step, call=lambda job: runner.rerank(data, by, **common(job)))
    # the quick moves: no model, no store, answered in the request
    if step in moves.LIVE_STEPS:
        mv = moves.live_move(step, inp, findings)
        job = TerritoriesJob(jid, TASK, req.handler, req, caps, step=step, quick=True, owns_person_keys=True, call=lambda job: _Done(*mv(data), note="Saved."))
        job.move = mv
        return job
    if step == "lookup":
        return _lookup(inp, req, caps, jid, data, by, on_line)
    if step == "undo":
        aid = moves.need(inp, "action_id", "which fix")
        return TerritoriesJob(jid, TASK, req.handler, req, caps, step=step, quick=True, call=lambda job: runner.undo(data, aid, by))
    if step == "place_pictures":
        def place(job):
            rep = _arrive(req.doc, data)
            if isinstance(rep, str):
                return _Done(data, [rep])
            return _Done(*arrival.place(data, data, rep, territory_id=moves._s(inp, "territory_id", 80) or None,
                                        slot_id=moves._s(inp, "slot_id", 80) or None, sha256=moves._s(inp, "sha256", 80) or None))
        return TerritoriesJob(jid, TASK, req.handler, req, caps, step=step, quick=True, call=place)
    if step == "send_routes":
        return TerritoriesJob(jid, TASK, req.handler, req, caps, step=step, quick=True, owns_person_keys=True,
                              call=lambda job: _Done(*moves.send_routes(data, inp, findings, doc_id=req.doc, data=data)))
    fn = getattr(moves, step)
    return TerritoriesJob(jid, TASK, req.handler, req, caps, step=step, quick=True, owns_person_keys=step in ("approve", "answer_ask", "record_review"),
                          call=lambda job: _Done(*fn(data, inp, findings)))


def _lookup(inp, req, caps, jid, data, by, on_line):
    """The ``lookup`` step. No ``lookup_id``: ask (the OK card is the new look-up, status ask; nothing is called). ``lookup_id`` with ``ok``
    false: no. With ``ok`` true: the one paid call, in a job thread, through ``engine/territory/lookups.run`` and the spend module."""
    from territory import lookups
    lid = moves._s(inp, "lookup_id", 80)
    if not lid:
        q, proposer = moves.need(inp, "q", "what to look up"), moves._s(inp, "proposer", 160) or None
        mv = lambda d: lookups.propose(d, q, by, proposer)[:2]      # noqa: E731
        job = TerritoriesJob(jid, TASK, req.handler, req, caps, step="lookup", quick=True, owns_person_keys=True,
                             call=lambda job: _Done(*lookups.propose(data, q, by, proposer)))
        job.move = mv
        return job
    ok = inp.get("ok")
    if not isinstance(ok, bool):
        raise bad("input.ok must be true (look it up) or false (do not)")
    if not ok:
        return TerritoriesJob(jid, TASK, req.handler, req, caps, step="lookup", quick=True, owns_person_keys=True,
                              call=lambda job: _Done(*lookups.decline(data, lid, by)))
    runner, _ = _engine()

    def go(job):
        from territory import spend as sp
        store = runner.Store.for_doc(req.doc)
        lock = runner._lock_of(store)
        if not lock.acquire(blocking=False):
            return runner._busy(data)
        try:
            spend = sp.Spend(doc=req.doc, store=store.spend_path, on_line=on_line)
            doc, refusals, note = lookups.run(data, lid, by, research=caps.research, spend=spend, market=moves._s(inp, "market", 8))
            res = _Done(doc, refusals, note)
            res.decisions = spend.decisions()
            return res
        finally:
            lock.release()
    return TerritoriesJob(jid, TASK, req.handler, req, caps, step="lookup", call=go)
