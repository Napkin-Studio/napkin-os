"""The Territories gates as ONE pure state machine (feature territories-gates).

Everything the run needs to know about a gate is a function of the document alone: ``data.run`` (gate, approvals, decisions, requests),
the picks, the routes, ``greenlit``, ``asks`` and ``review``. Nothing lives in a server's memory, so a job that dies resumes from the
document and replay, live and the tests all call the same functions (LESSONS 11).

    evaluate(doc)                  what the screen needs: gate, blockers in words, whether Approve works, asks, what happens next
    next_step(doc)                 what the engine may do now: run a stage, open a gate, hold (and why), finish, or refuse (in words)
    approve / answer_ask / record_review / settle_requests    the person's moves; each returns (doc, refusals), never raises
    open_gate / sync_asks          what the engine writes when it reaches a gate
    drive(doc, stages)             the loop a middleware handler runs: next_step, run the stage function, repeat, until it must wait

Rules in force:

* An approval counts only for the inputs it was given for. It carries ``inputs`` (``inputs_hash``); change a tick, a route or a
  greenlight and it no longer matches, so it passes nothing. Approve itself is never disabled by an old approval: ``can_approve`` depends
  only on what blocks the gate now, and a new approval replaces the old one (LESSONS 18).
* Pick needs one ticked insight. Greenlight needs a developed route; a greenlit route resting on a derived finding is asked about
  (verify, or send flagged); a route whose mandatory check failed needs a reason on record; a sensitive pack needs a named person's
  review that is void when the greenlit routes change. A greenlight of nothing needs a reason and sends nothing.
* A refusal or a hold is a sentence a person can read: never a field name, a status code or a stack trace (LESSONS 17).
* A held gate makes no model call: only ``drive`` runs stages, and it runs one only when ``next_step`` says so.

The names are the contract's (docs/contracts/territories.md section 5). Enums come from schema.json through ``contract``.
"""
from __future__ import annotations

import copy
import hashlib
import json
from datetime import datetime, timezone

from . import contract

GATES = ("pick", "greenlight")
RELEASES = {"pick": "explore", "greenlight": "send"}          # the stage a gate lets through
STAGES = (("pick", "Pick"), ("explore", "Explore"), ("develop", "Develop"), ("greenlight", "Greenlight"), ("send", "Send"))
GATE_AGENT = {"pick": "strategy", "greenlight": "approval"}
GATE_DEX = {"pick": "Tick the insights the crew should explore.", "greenlight": "Greenlight the routes worth making."}
GATE_N = {"pick": 1, "greenlight": 2}
#: Person-only touches that do not change what was approved.
VOLATILE = ("vote", "rank")


def now() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


# ---------------------------------------------------------------- what an approval was given for


def _digest(obj) -> str:
    return hashlib.sha256(json.dumps(obj, sort_keys=True, ensure_ascii=False, separators=(",", ":")).encode()).hexdigest()[:12]


def _insights(doc: dict) -> list[dict]:
    return (doc.get("focus") or {}).get("insights") or []


def _ticked(doc: dict) -> list[dict]:
    return [i for i in _insights(doc) if i.get("ticked")]


def _routes(doc: dict) -> dict:
    return {t["id"]: t for t in doc.get("territories") or []}


def _live(doc: dict) -> list[dict]:
    return [t for t in doc.get("territories") or [] if t.get("state") == "developed" and t.get("status") == "live"]


def _name(t: dict | None, fallback: str = "A route") -> str:
    return (t or {}).get("name") or fallback


def inputs_hash(doc: dict, gate: str) -> str:
    """A short hash of what a person looks at when they decide at ``gate``.

    pick: the ticked insights (id and text) and the sources in play. greenlight: the picks, every live developed route, each greenlit
    route with how its derived evidence was settled, and the answers given. It leaves out who approved and when, and the people-only
    ``vote`` and ``rank``, so nothing but a real change to the decision's inputs moves it."""
    pick = {"ticked": sorted((i["id"], i.get("text", "")) for i in _ticked(doc)),
            "sources": sorted(s["id"] for s in (doc.get("focus") or {}).get("sources") or [] if s.get("in_play"))}
    if gate == "pick":
        return _digest(pick)
    routes = [{k: v for k, v in t.items() if k not in VOLATILE} for t in sorted(_live(doc), key=lambda t: t["id"])]
    green = sorted(({"id": g["territory_id"], "rests": sorted(g.get("rests_on_derived") or []), "res": g.get("derived_resolution"),
                     "note": g.get("note") or ""} for g in doc.get("greenlit") or []), key=lambda g: g["id"])
    answers = sorted((a["id"], a.get("answer")) for a in doc.get("asks") or []
                     if a.get("status") == "answered" and a.get("kind") != "sensitive_review")
    return _digest({"pick": pick, "routes": routes, "greenlit": green, "answers": answers})


def _approval(doc: dict, gate: str) -> dict | None:
    return ((doc.get("run") or {}).get("approvals") or {}).get(gate)


def approval_state(doc: dict, gate: str) -> dict:
    """``{given, valid, stale, by, at, words}``: ``valid`` only while the approval's inputs equal the current ones."""
    a = _approval(doc, gate)
    if not a:
        return {"given": False, "valid": False, "stale": False, "by": None, "at": None, "words": "Not approved yet."}
    valid = a.get("inputs") == inputs_hash(doc, gate)
    words = (f"Approved by {a['by']}." if valid else
             "It was approved, but the choices have changed since, so it needs approving again." if a.get("inputs") else
             "It was approved before approvals were tied to the choices, so it needs approving again.")
    return {"given": True, "valid": valid, "stale": not valid, "by": a.get("by"), "at": a.get("at"), "words": words}


# ---------------------------------------------------------------- what blocks a gate


def _findings_derived(findings) -> set:
    rows = (findings.get("findings") if isinstance(findings, dict) else findings) or []
    return {f["id"] for f in rows if f.get("status") == "proposed"}


def _derived_of(t: dict, g: dict, derived: set) -> list[str]:
    return sorted(set(g.get("rests_on_derived") or []) | (set(t.get("evidence") or []) & derived))


def _ask_for(doc: dict, kind: str, tid: str | None = None) -> dict | None:
    for a in doc.get("asks") or []:
        if a.get("kind") == kind and a.get("territory_id") == tid:
            return a
    return None


def _mandatory(t: dict) -> str:
    """``fail``, ``warn`` or ``ok``: the worst mandatory check of a route."""
    st = {c.get("status") for c in t.get("checks") or [] if c.get("kind") == "mandatory"}
    return "fail" if "fail" in st else "warn" if "warn" in st else "ok"


def _sensitive(doc: dict) -> dict:
    return ((doc.get("review") or {}).get("sensitive")) or {"required": False, "status": "not_needed"}


def sensitive_state(doc: dict) -> dict:
    """``{required, done, voided, by, words}``. A review is done only if a named person did it for the CURRENT greenlight inputs."""
    s = _sensitive(doc)
    if not s.get("required"):
        return {"required": False, "done": False, "voided": False, "by": None, "words": "No sensitive-topic review is needed."}
    named = s.get("status") == "done" and str(s.get("by") or "").strip() not in ("", "engine")
    same = s.get("inputs") == inputs_hash(doc, "greenlight")
    if named and same:
        return {"required": True, "done": True, "voided": False, "by": s["by"], "words": f"Reviewed by {s['by']}."}
    if named:
        return {"required": True, "done": False, "voided": True, "by": s["by"],
                "words": f"{s['by']} reviewed an earlier version. The routes have changed since, so the review has to be done again."}
    return {"required": True, "done": False, "voided": False, "by": None,
            "words": "This category needs a named person to review the routes before they are sent."}


def blockers(doc: dict, gate: str, *, findings=None) -> list[dict]:
    """``run.gate.blocked_by`` entries (kind, ids, text) for ``gate`` as the document stands. Empty means nothing holds it."""
    out: list[dict] = []
    if gate == "pick":
        if not _ticked(doc):
            out.append({"kind": "nothing_picked", "text": "Tick at least one insight for the crew to explore."})
        return out
    live = {t["id"]: t for t in _live(doc)}
    if not live:
        return [{"kind": "no_routes", "text": "There are no developed routes to greenlight yet."}]
    derived = _findings_derived(findings)
    routes = _routes(doc)
    gone = [g["territory_id"] for g in doc.get("greenlit") or [] if g["territory_id"] not in live]
    if gone:
        out.append({"kind": "no_routes", "ids": gone, "text": "A greenlit route is no longer live. Take it off the list before approving."})
    if not (doc.get("greenlit") or []):
        out.append({"kind": "nothing_picked", "text": "Greenlight at least one route, or approve with a reason why none is worth making."})
    pending, near, failed = [], [], []
    for g in doc.get("greenlit") or []:
        t = live.get(g["territory_id"])
        if not t:
            continue
        rests = _derived_of(t, g, derived)
        if rests and (g.get("derived_resolution") == "pending" or set(rests) - set(g.get("rests_on_derived") or [])
                      or (g.get("derived_resolution") not in ("verified", "sent_flagged"))):
            pending.append(t["id"])
        m = _mandatory(t)
        if m != "ok":
            a = _ask_for(doc, "near_mandatory", t["id"])
            answered = bool(a and a.get("status") == "answered" and a.get("answer") == "ok")
            if m == "fail" and not (answered and str(g.get("note") or "").strip()):
                failed.append(t["id"])
            elif m == "warn" and not answered:
                near.append(t["id"])
    if pending:
        out.append({"kind": "derived_evidence", "ids": pending,
                    "text": _list_words([_name(routes.get(i)) for i in pending]) + (" rests" if len(pending) == 1 else " rest") +
                            " on a finding nobody has verified. Verify it, or send it flagged."})
    if failed:
        out.append({"kind": "near_mandatory", "ids": failed,
                    "text": _list_words([_name(routes.get(i)) for i in failed]) + (" fails" if len(failed) == 1 else " fail") +
                            " a mandatory. Say why it goes ahead, or take it off the list."})
    if near:
        out.append({"kind": "near_mandatory", "ids": near,
                    "text": _list_words([_name(routes.get(i)) for i in near]) + (" is" if len(near) == 1 else " are") +
                            " close to a mandatory. Confirm it is fine, or change it."})
    if sensitive_state(doc)["required"] and not sensitive_state(doc)["done"]:
        out.append({"kind": "sensitive_review", "text": sensitive_state(doc)["words"]})
    return out


def _list_words(names: list[str]) -> str:
    return names[0] if len(names) == 1 else ", ".join(names[:-1]) + " and " + names[-1]


def needed_asks(doc: dict, *, findings=None) -> list[dict]:
    """The asks the Booth must have open or answered for the current greenlit routes (contract ``ask`` shape, status ``open``)."""
    derived = _findings_derived(findings)
    routes, out = _routes(doc), []
    for g in doc.get("greenlit") or []:
        t = routes.get(g["territory_id"])
        if not t or t.get("status") != "live":
            continue
        rests = _derived_of(t, g, derived)
        if rests:
            out.append({"id": contract.mint("ask", f"derived:{t['id']}"), "kind": "derived_evidence", "territory_id": t["id"], "ids": rests[:8],
                        "status": "open", "text": f"{_name(t)} rests on a finding the agent derived and nobody has verified. Verify it, or send it flagged?"})
        m = _mandatory(t)
        if m != "ok":
            out.append({"id": contract.mint("ask", f"mandatory:{t['id']}"), "kind": "near_mandatory", "territory_id": t["id"], "status": "open",
                        "text": (f"{_name(t)} fails a mandatory. Say why it goes ahead, or take it off the list." if m == "fail"
                                 else f"{_name(t)} is close to a mandatory. Is that fine, or should it change?")})
    if _sensitive(doc).get("required"):
        out.append({"id": contract.mint("ask", "sensitive"), "kind": "sensitive_review", "status": "open",
                    "text": "This category needs a person to review the routes before they are sent."})
    return out


def sync_asks(doc: dict, *, findings=None) -> dict:
    """The document with ``asks`` matching what the greenlight needs now: new ones opened, answered ones kept (never re-asked, LESSONS 18),
    an ask nobody needs any more (route taken off the list) dropped, and the sensitive ask reopened if its review was voided."""
    doc = copy.deepcopy(doc)
    key = lambda a: (a["kind"], a.get("territory_id"))
    want = {key(a): a for a in needed_asks(doc, findings=findings)}
    have = {key(a): a for a in doc.get("asks") or []}
    kept = [a for k, a in have.items() if k in want] + [a for k, a in want.items() if k not in have]
    for a in kept:
        if a["kind"] == "sensitive_review" and not sensitive_state(doc)["done"]:
            a.pop("answer", None), a.pop("by", None), a.pop("at", None)
            a["status"] = "open"
    if kept or "asks" in doc:
        doc["asks"] = kept
    return doc


# ---------------------------------------------------------------- the screen's view and what happens next


def stage_outputs(doc: dict) -> dict:
    """Which stage outputs already exist in the document: the engine moves on from what is there, not from what a flag says."""
    ts = doc.get("territories") or []
    return {"pick": bool(_insights(doc)), "explore": bool(doc.get("expeditions")) and bool(ts),
            "develop": any(t.get("state") == "developed" for t in ts),
            "greenlight": bool(doc.get("greenlit")), "send": bool(doc.get("sends"))}


def evaluate(doc: dict, *, findings=None) -> dict:
    """What the screen needs, in one call. ``gate`` is the open gate id or None. ``can_approve`` is True whenever nothing blocks the gate
    (an old approval never disables it). ``can_approve_with_reason``: greenlighting nothing is allowed when Approve carries a note. ``next`` is ``next_step``."""
    run = doc.get("run") or {}
    gate = (run.get("gate") or {}).get("id") if run.get("state") == "gate" else None
    out = {"gate": gate, "state": run.get("state"), "blocked_by": [], "can_approve": False, "approval": None, "can_approve_with_reason": False,
           "asks": [a for a in doc.get("asks") or [] if a.get("status") == "open"], "sensitive": sensitive_state(doc),
           "inputs": None, "checks": [], "words": "", "requests": list(run.get("gate_requests") or [])}
    if gate:
        out["blocked_by"] = blockers(doc, gate, findings=findings)
        out["approval"] = approval_state(doc, gate)
        out["inputs"] = inputs_hash(doc, gate)
        out["can_approve"] = not out["blocked_by"]
        out["can_approve_with_reason"] = bool(out["blocked_by"]) and all(b["kind"] == "nothing_picked" for b in out["blocked_by"]) and gate == "greenlight"
        out["checks"] = _checks(doc, gate, out["blocked_by"])
    out["next"] = next_step(doc, findings=findings)
    out["words"] = out["next"]["words"]
    return out


def _checks(doc: dict, gate: str, blocked: list[dict]) -> list[dict]:
    if gate == "pick":
        n = len(_ticked(doc))
        return [{"ok": n > 0, "text": f"{n} insight{'s' if n != 1 else ''} ticked"}]
    return [{"ok": not blocked, "text": f"{len(doc.get('greenlit') or [])} of {len(_live(doc))} routes greenlit"}] + \
           [{"ok": False, "text": b["text"][:200]} for b in blocked][:7]


def _after(stage: str) -> str | None:
    ids = [s for s, _ in STAGES]
    return ids[ids.index(stage) + 1] if stage != ids[-1] else None


def next_step(doc: dict, *, findings=None) -> dict:
    """``{do, stage, gate, words}``. ``do`` is one of: ``open_gate`` (the engine puts a gate in front of the person), ``hold`` (waiting,
    ``words`` says on what), ``run`` (run ``stage`` now), ``finish``, ``idle`` (nothing to do), ``failed`` (waiting for Try again, or a
    retry request makes it ``run``). Every ``words`` is a sentence for a person."""
    run = doc.get("run") or {}
    st, out = run.get("state"), stage_outputs(doc)

    def step(do, words, stage=None, gate=None):
        return {"do": do, "stage": stage, "gate": gate, "words": words}

    if st == "done":
        return step("idle", "This run is finished.")
    if st == "failed":
        err = run.get("error") or {}
        retry = any(r.get("kind") == "retry" for r in run.get("gate_requests") or [])
        if retry and err.get("retryable", True):
            return step("run", "Trying that step again.", stage=err.get("stage"))
        return step("failed", (err.get("message") or "The run stopped.") + (" Try again to continue." if err.get("retryable", True) else ""))
    if st == "gate":
        gate = (run.get("gate") or {}).get("id")
        if gate not in GATES:
            return step("hold", "The run is waiting at a step this tool does not know. Nothing was run.")
        bl = blockers(doc, gate, findings=findings)
        a = approval_state(doc, gate)
        if gate == "greenlight" and not (doc.get("greenlit") or []) and a["valid"] and str(_approval(doc, gate).get("note") or "").strip():
            bl = [b for b in bl if b["kind"] != "nothing_picked"]
        if bl:
            return step("hold", " ".join(b["text"] for b in bl), gate=gate)
        if not a["valid"]:
            return step("hold", ("Waiting for you to approve. " if not a["given"] else "") + (a["words"] if a["given"] else
                        "Check the choices, then approve to let the run go on."), gate=gate)
        if gate == "greenlight" and not (doc.get("greenlit") or []):
            return step("finish", "Nothing was greenlit, so nothing is sent. The reason is on record.", gate=gate)
        if gate == "pick":                                        # resume: move on from the stage outputs already there
            missing = [x for x in ("explore", "develop") if not out[x]]
            if not missing:
                return step("open_gate", "The routes are ready. Waiting for you to greenlight.", gate="greenlight")
            return step("run", f"Approved. The run goes on to {missing[0]}.", stage=missing[0], gate=gate)
        if out["send"]:
            return step("finish", "Everything greenlit has been sent.", gate=gate)
        return step("run", f"Approved. The run goes on to {RELEASES[gate]}.", stage=RELEASES[gate], gate=gate)
    if st == "draft" or st is None:
        if not out["pick"]:
            return step("hold", "There is nothing to pick yet: the insights have not been made.")
        return step("open_gate", "The insights are ready. Waiting for you to pick.", gate="pick")
    # building: move on from what exists, and never past a gate whose approval does not match the current choices
    pa = approval_state(doc, "pick")
    if not out["explore"] or not out["develop"]:
        if not pa["valid"]:
            return step("open_gate", "The picks changed since you approved them, so they need approving again.", gate="pick")
        return step("run", "The crew is going out." if not out["explore"] else "Developing the routes.",
                    stage="explore" if not out["explore"] else "develop")
    ga = approval_state(doc, "greenlight")
    gb = [b for b in blockers(doc, "greenlight", findings=findings)
          if not (b["kind"] == "nothing_picked" and not (doc.get("greenlit") or []) and ga["valid"] and str((_approval(doc, "greenlight") or {}).get("note") or "").strip())]
    if not gb and ga["valid"] and _live(doc):
        if (doc.get("greenlit") or []) and not out["send"]:
            return step("run", "Approved. Sending the greenlit routes.", stage="send", gate="greenlight")
        if out["send"] or not (doc.get("greenlit") or []):
            return step("finish", "Everything greenlit has been sent.")
    return step("open_gate", "The routes are ready. Waiting for you to greenlight.", gate="greenlight")


# ---------------------------------------------------------------- the engine's moves


def _stages(doc: dict, current: str, failed: bool = False) -> list[dict]:
    ids = [s for s, _ in STAGES]
    i = ids.index(current)
    return [{"id": s, "name": n, "status": ("failed" if failed else "now") if k == i else "done" if k < i else "next"}
            for k, (s, n) in enumerate(STAGES)]


def open_gate(doc: dict, gate: str, *, findings=None) -> dict:
    """Put ``gate`` in front of the person, or refresh it after an edit. ``blocked_by`` and ``checks`` always match the document, so the
    contract's rule (a blocked gate says so) holds; ``asks`` are brought up to date."""
    if gate not in GATES:
        raise ValueError(f"unknown gate {gate!r}")
    doc = sync_asks(doc, findings=findings) if gate == "greenlight" else copy.deepcopy(doc)
    run = doc.setdefault("run", {"state": "gate"})
    bl = blockers(doc, gate, findings=findings)
    run.update(state="gate", stage=gate, stages=_stages(doc, gate), agent={"key": GATE_AGENT[gate], "activity": "human"},
               gate={"id": gate, "n": GATE_N[gate], "of": 2, "agent": GATE_AGENT[gate], "dex": GATE_DEX[gate],
                     "checks": _checks(doc, gate, bl), "blocked_by": bl})
    run.pop("error", None)
    return doc


def _fail(doc: dict, stage: str, message: str, retryable: bool = True) -> dict:
    doc = copy.deepcopy(doc)
    run = doc["run"]
    run.update(state="failed", stage=stage, stages=_stages(doc, stage, failed=True), gate=None, agent={"key": "orchestrator", "activity": "error"},
               error={"stage": stage, "message": message[:400], "retryable": retryable})
    run["gate_requests"] = [r for r in run.get("gate_requests") or [] if r.get("kind") != "retry"]
    return doc


def _finish(doc: dict) -> dict:
    doc = copy.deepcopy(doc)
    run = doc["run"]
    sent = sum(len(s["territory_ids"]) for s in doc.get("sends") or [] if s.get("status") in ("sent", "not_built", "queued"))
    run.update(state="done", gate=None, stages=[{**s, "status": "done"} for s in _stages(doc, "send")], agent={"key": "orchestrator", "activity": "complete"})
    run["done"] = {"routes": len(_live(doc)), "greenlit": len(doc.get("greenlit") or []), "sent": sent,
                   "summary": "Nothing was greenlit, so nothing was sent." if not doc.get("greenlit") else "The greenlit routes were sent."}
    run.pop("error", None)
    return doc


def drive(doc: dict, stages: dict, *, findings=None, max_steps: int = 12) -> dict:
    """The loop a middleware handler runs. ``stages`` maps ``explore``, ``develop``, ``send`` to ``fn(doc) -> doc``. It opens gates, runs a stage
    only when ``next_step`` says so, and stops at a gate, a finish or a failure. A stage that is not built, a spend cap, or any error ends in
    ``run.error`` in words (retryable where a retry could help), never in a silent stop, and nothing runs while a gate is held."""
    from .spend import CapReached
    doc = copy.deepcopy(doc)
    for _ in range(max_steps):
        n = next_step(doc, findings=findings)
        if n["do"] == "open_gate":
            return open_gate(doc, n["gate"], findings=findings)
        if n["do"] == "finish":
            return _finish(doc)
        if n["do"] != "run":
            return doc
        stage, fn = n["stage"], stages.get(n["stage"])
        run = doc["run"]
        if fn is None:
            return _fail(doc, stage, f"The {stage} step is not built yet, so nothing was run.", retryable=False)
        run.update(state="building", stage=stage, gate=None, stages=_stages(doc, stage), agent={"key": "orchestrator", "activity": "work"})
        run["gate_requests"] = [r for r in run.get("gate_requests") or [] if r.get("kind") != "retry"]
        run.pop("error", None)
        try:
            doc = fn(copy.deepcopy(doc))
        except CapReached as e:
            return _fail(doc, stage, str(e), retryable=True)
        except Exception:
            return _fail(doc, stage, f"The {stage} step stopped before it finished. What was made is saved; try again.", retryable=True)
    return doc


# ---------------------------------------------------------------- the person's moves


def _refuse(doc, *words):
    return doc, list(words)


def _who(by) -> str | None:
    by = str(by or "").strip()
    return by if by and by.lower() != "engine" else None


def approve(doc: dict, gate: str, by: str, at: str | None = None, note: str | None = None, *, findings=None) -> tuple[dict, list[str]]:
    """The person approves ``gate``. Returns ``(doc, refusals)``: refused in words (doc unchanged) when it is not the open gate, nobody is
    named, something still blocks it, or a greenlight of nothing has no reason. A valid approval REPLACES any older one, stamped with
    the inputs it was given for."""
    run = doc.get("run") or {}
    cur = (run.get("gate") or {}).get("id") if run.get("state") == "gate" else None
    if cur != gate:
        where = f"The run is at the {cur} step." if cur else f"The run is {'finished' if run.get('state') == 'done' else 'working'}, not waiting for you."
        return _refuse(doc, f"There is nothing to approve at {gate} right now. {where}")
    if not _who(by):
        return _refuse(doc, "Say who is approving. Only a named person can approve.")
    bl = blockers(doc, gate, findings=findings)
    if gate == "greenlight" and not (doc.get("greenlit") or []) and str(note or "").strip():
        bl = [b for b in bl if b["kind"] != "nothing_picked"]       # greenlighting nothing, with a reason on record
    if bl:
        return _refuse(doc, *[b["text"] for b in bl])
    doc, at = copy.deepcopy(doc), at or now()
    run = doc["run"]
    entry = {"by": _who(by), "at": at, "decision": "approve", "inputs": inputs_hash(doc, gate)}
    if str(note or "").strip():
        entry["note"] = str(note).strip()[:300]
    run.setdefault("approvals", {})[gate] = entry
    run.setdefault("decisions", []).append({"gate": gate, "kind": "approve", "by": _who(by), "at": at, "inputs": entry["inputs"]})
    run["decisions"] = run["decisions"][-contract.limit("run", "decisions"):]
    run["gate_requests"] = [r for r in run.get("gate_requests") or [] if r.get("gate") != gate]
    return doc, []


def answer_ask(doc: dict, ask_id: str, answer: str, by: str, at: str | None = None, note: str | None = None, *, findings=None) -> tuple[dict, list[str]]:
    """The person answers an open ask. ``verify`` / ``send_flagged`` settle a derived finding on that route; ``ok`` confirms a near-mandatory
    (a failed mandatory also needs ``note``, the reason, kept on the greenlit route); ``change`` takes the route off the greenlit list.
    Asks of the sensitive review are answered by ``record_review``, not here."""
    a = next((a for a in doc.get("asks") or [] if a["id"] == ask_id), None)
    if not a:
        return _refuse(doc, "That question is no longer on the board.")
    if not _who(by):
        return _refuse(doc, "Say who is answering. Only a named person can.")
    if a["kind"] == "sensitive_review":
        return _refuse(doc, "The sensitive-topic review is done by a named reviewer, with Mark as reviewed, not by answering a question.")
    allowed = {"derived_evidence": ("verify", "send_flagged", "change"), "near_mandatory": ("ok", "change")}[a["kind"]]
    if answer not in allowed:
        return _refuse(doc, "Choose " + " or ".join({"verify": "verify it", "send_flagged": "send it flagged", "change": "change the route", "ok": "go ahead"}[x] for x in allowed) + ".")
    doc, at = copy.deepcopy(doc), at or now()
    a = next(x for x in doc["asks"] if x["id"] == ask_id)
    g = next((g for g in doc.get("greenlit") or [] if g["territory_id"] == a.get("territory_id")), None)
    if answer == "ok" and a["kind"] == "near_mandatory":
        t = _routes(doc).get(a.get("territory_id"))
        if t and _mandatory(t) == "fail" and not (str(note or "").strip() or str((g or {}).get("note") or "").strip()):
            return _refuse(doc, "That route fails a mandatory. Say why it goes ahead.")
        if g is not None and str(note or "").strip():
            g["note"] = str(note).strip()[:300]
    if answer == "change":
        doc["greenlit"] = [x for x in doc.get("greenlit") or [] if x is not g]
        doc["asks"] = [x for x in doc["asks"] if x.get("territory_id") != a.get("territory_id")]
    else:
        a.update(status="answered", answer=answer, by=_who(by), at=at)
        if a["kind"] == "derived_evidence" and g is not None:
            t = _routes(doc).get(g["territory_id"])
            g["rests_on_derived"] = (_derived_of(t, g, _findings_derived(findings))[:8] if t else g.get("rests_on_derived") or [])
            g["derived_resolution"] = "verified" if answer == "verify" else "sent_flagged"
    return doc, []


def record_review(doc: dict, by: str, at: str | None = None, *, findings=None) -> tuple[dict, list[str]]:
    """A named person reviews the greenlit routes of a sensitive pack. Tied to the current greenlight inputs: any later change voids it."""
    if not _sensitive(doc).get("required"):
        return _refuse(doc, "This pack is not marked as sensitive, so there is nothing to review.")
    if not _who(by):
        return _refuse(doc, "A sensitive-topic review needs a named reviewer. The engine cannot review its own work.")
    if not (doc.get("greenlit") or []):
        return _refuse(doc, "Greenlight the routes first. The review is of the routes that will be sent.")
    doc, at = copy.deepcopy(doc), at or now()
    doc.setdefault("review", {})["sensitive"] = {"required": True, "status": "done", "by": _who(by), "at": at, "inputs": inputs_hash(doc, "greenlight")}
    for a in doc.get("asks") or []:
        if a["kind"] == "sensitive_review":
            a.update(status="answered", answer="ok", by=_who(by), at=at)
    return doc, []


def greenlight_route(doc: dict, territory_id: str, by: str, at: str | None = None, *, findings=None) -> tuple[dict, list[str]]:
    """The person greenlights one live, developed route. The entry lists the derived findings it rests on and starts ``pending`` if any."""
    t = next((t for t in _live(doc) if t["id"] == territory_id), None)
    if not t:
        return _refuse(doc, "That route is not a live, developed route, so it cannot be greenlit.")
    if not _who(by):
        return _refuse(doc, "Say who is greenlighting. Only a named person can.")
    doc = copy.deepcopy(doc)
    if any(g["territory_id"] == territory_id for g in doc.get("greenlit") or []):
        return doc, []
    rests = _derived_of(t, {}, _findings_derived(findings))[:8]
    doc.setdefault("greenlit", []).append({"territory_id": territory_id, "by": _who(by), "at": at or now(), "rests_on_derived": rests,
                                           "derived_resolution": "pending" if rests else "verified"})
    return doc, []


def request(doc: dict, gate: str, kind: str, at: str | None = None) -> dict:
    """The person asks for ``edit`` or ``retry`` at ``gate``. Recorded as a waiting request; ``settle_requests`` answers it."""
    doc = copy.deepcopy(doc)
    reqs = [r for r in doc["run"].get("gate_requests") or [] if (r.get("gate"), r.get("kind")) != (gate, kind)]
    reqs.append({"gate": gate, "kind": kind, "at": at or now(), "status": "waiting"})
    doc["run"]["gate_requests"] = reqs[-contract.limit("run", "gate_requests"):]
    return doc


def settle_requests(doc: dict, *, findings=None) -> tuple[dict, list[dict]]:
    """Answer every waiting request with something the engine did or a sentence saying why not (LESSONS 17: nothing only records).
    Returns ``(doc, answers)``, each ``{gate, kind, did, words}``. An ``edit`` at an open gate refreshes the gate (blockers, asks) and the
    approval is judged against the new choices; a ``retry`` of a failed run is left for ``drive`` (it says ``run``)."""
    answers, run = [], doc.get("run") or {}
    for r in list(run.get("gate_requests") or []):
        g, k = r.get("gate"), r.get("kind")
        open_id = (run.get("gate") or {}).get("id") if run.get("state") == "gate" else None
        if k == "edit" and open_id == g:
            doc = open_gate(doc, g, findings=findings)
            a = approval_state(doc, g)
            words = ("Updated. " + ("Approve whenever you are ready." if not blockers(doc, g, findings=findings) else
                     " ".join(b["text"] for b in blockers(doc, g, findings=findings))))
            answers.append({"gate": g, "kind": k, "did": "refreshed", "words": words + (" The earlier approval no longer applies." if a["stale"] else "")})
        elif k == "retry" and run.get("state") == "failed" and (run.get("error") or {}).get("retryable", True):
            answers.append({"gate": g, "kind": k, "did": "queued", "words": "Trying that step again."})
            continue                                   # stays until drive runs it
        elif k == "retry":
            answers.append({"gate": g, "kind": k, "did": "none", "words": "There is nothing to try again: the run has not failed." if run.get("state") != "failed"
                            else "That step cannot be tried again. " + ((run.get("error") or {}).get("message") or "")})
        else:
            where = {"gate": f"The run is at the {open_id} step.", "building": "The run is working.", "done": "The run is finished."}.get(
                open_id and "gate" or run.get("state"), "The run is not waiting there.")
            answers.append({"gate": g, "kind": k, "did": "none", "words": f"That cannot be changed there now. {where}"})
        doc = copy.deepcopy(doc)
        doc["run"]["gate_requests"] = [x for x in doc["run"].get("gate_requests") or [] if x is not r and x != r]
    return doc, answers
