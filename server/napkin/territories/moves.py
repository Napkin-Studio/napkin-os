"""The person's quick moves on a Territories document: no model, so they run inside the request and answer at once.

Each takes the document as the job read it and the carried members, and returns a ``runner.Result``-shaped ``(doc, refusals, note)``: the
document after the move, what was refused in words (an empty list when it went through), and a sentence about what was done. The rules are
``engine/territory/gates.py``'s; this module only calls them, refreshes the open gate so ``run.gate.blocked_by`` matches the document, and
records a send. It never decides who may do what: ``gates`` refuses an unnamed or ``engine`` actor in words.
"""
from __future__ import annotations

import copy

from ..util import bad
from . import delivery

DESTINATIONS = {"deck-maker": "Deck Maker", "production-tool": "Production tool"}


def _s(inp: dict, key: str, limit: int = 200) -> str:
    v = inp.get(key)
    return v.strip()[:limit] if isinstance(v, str) else ""


def need(inp: dict, key: str, what: str) -> str:
    v = _s(inp, key)
    if not v:
        raise bad(f"input.{key} is required: {what}")
    return v


def _refresh(doc: dict, findings) -> dict:
    """An open gate is refreshed after a move, so what the screen reads (blocked_by, checks, asks) is what the document now says."""
    from territory import gates
    run = doc.get("run") or {}
    gate = (run.get("gate") or {}).get("id")
    if run.get("state") == "gate" and gate in gates.GATES:
        return gates.open_gate(doc, gate, findings=findings)
    return doc


def greenlight_route(doc, inp, findings):
    from territory import gates
    out, ref = gates.greenlight_route(doc, need(inp, "territory_id", "the route"), _s(inp, "by", 80), findings=findings)
    return (_refresh(out, findings) if not ref else doc), ref, "Greenlit."


def remove_route(doc, inp, findings):
    from territory import gates
    out, ref = gates.remove_route(doc, need(inp, "territory_id", "the route"), _s(inp, "by", 80), findings=findings)
    return (out if not ref else doc), ref, "Taken off the list."


def answer_ask(doc, inp, findings):
    from territory import gates
    out, ref = gates.answer_ask(doc, need(inp, "ask_id", "the question"), need(inp, "answer", "the answer"), _s(inp, "by", 80),
                                note=_s(inp, "note", 300) or None, findings=findings)
    return (_refresh(out, findings) if not ref else doc), ref, "Answered."


def record_review(doc, inp, findings):
    from territory import gates
    out, ref = gates.record_review(doc, _s(inp, "by", 80), findings=findings)
    return (_refresh(out, findings) if not ref else doc), ref, "Marked as reviewed."


def approve(doc, inp, findings):
    from territory import gates
    gate = _s(inp, "gate", 20) or "greenlight"
    if gate not in gates.GATES:
        raise bad("input.gate must be pick or greenlight")
    out, ref = gates.approve(doc, gate, _s(inp, "by", 80), note=_s(inp, "note", 300) or None, findings=findings)
    return (_refresh(out, findings) if not ref else doc), ref, "Approved."


def send_routes(doc, inp, findings, *, doc_id: str, data: dict):
    """Record a hand-off of the greenlit routes. The routes not chosen travel too. A destination with no deliverer registered is
    written ``not_built``: the choice is saved, nothing is sent, and the words say so."""
    from territory import contract, gates
    to = need(inp, "to", "deck-maker or production-tool")
    if to not in DESTINATIONS:
        raise bad("input.to must be deck-maker or production-tool")
    by = gates._who(_s(inp, "by", 80))
    if not by:
        return doc, ["Say who is sending. Only a named person can."], ""
    ids = [i for i in (inp.get("territory_ids") or []) if isinstance(i, str)]
    if not ids:
        return doc, ["Greenlight at least one route first."], ""
    green = {g["territory_id"] for g in doc.get("greenlit") or []}
    if not set(ids) <= green:
        return doc, ["Some of those routes are not on the greenlit list. Greenlight them first."], ""
    if len(doc.get("sends") or []) >= contract.limit("sends"):
        return doc, ["This document has already made as many sends as it can hold."], ""
    gate_open = (doc.get("run") or {}).get("state") == "gate" and ((doc.get("run") or {}).get("gate") or {}).get("id") == "greenlight"
    bl = gates.blockers(doc, "greenlight", findings=findings) if gate_open else []
    if bl:
        return doc, [b["text"] for b in bl], ""
    not_chosen = [i for i in (inp.get("not_chosen") or []) if isinstance(i, str) and i not in ids][:32]
    at = gates.now()
    send = {"id": contract.mint("send", f"{doc_id}:{to}:{','.join(sorted(ids))}:{len(doc.get('sends') or [])}"), "to": to, "territory_ids": ids,
            "not_chosen": not_chosen, "by": by, "at": at, "status": "not_built"}
    deliver = delivery.DESTINATIONS.get(to)
    name = DESTINATIONS[to]
    note = f"{name} is not built yet, so nothing was sent. The choice is saved."
    if deliver is not None:
        try:
            got = deliver(doc_id, data, send) or {}
        except Exception:   # noqa: BLE001 - the contract is plain words, never a trace
            return doc, [f"{name} did not take it. Nothing was sent; try again."], ""
        if got.get("status") in ("sent", "asked"):
            send["status"], note = got["status"], f"Sent to {name}."
    d = copy.deepcopy(doc)
    d.setdefault("sends", []).append(send)
    if send["status"] == "sent":
        d, ref = gates.approve(d, "greenlight", by, at, findings=findings) if gate_open and not gates.approval_state(d, "greenlight")["valid"] else (d, [])
        if ref:
            return doc, ref, ""
        d = gates.drive(d, {}, findings=findings)           # approved and sent: the machine finishes the run
    return d, [], note
