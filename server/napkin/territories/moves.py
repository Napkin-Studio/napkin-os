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


# ---------------------------------------------------------------- a person's choices about a world (small moves, never the whole `territories` array)
#
# The World view used to write these by sending the whole ``territories`` array as a patch; RFC 7396 replaces arrays, so an engine write (a
# push or more) and a person's choice at the same moment lost one of the two. They are moves now: applied to the CURRENT document, and while a
# model step of the document is running they wait inside that job and are applied to the document it returns, so both survive
# (``TerritoriesJob.defer``, the request path in app.py). Each is ``fn(doc) -> (doc, refusals)`` built by ``live_move``.

LIVE_STEPS = ("set_lead", "star_line", "keep_feel", "set_final", "set_rights")
MAX_STARS, DIALS = 16, ("tone", "energy", "register", "brand")


def _route_of(doc: dict, tid: str):
    return next((t for t in doc.get("territories") or [] if t.get("id") == tid), None)


def _lines_of(w: dict) -> list:
    return [*(w.get("lines") or []), *((w.get("headlines") or {}).values())]


def live_move(step: str, inp: dict, findings=None):
    """The move ``step`` asks for as ``fn(doc) -> (doc, refusals)``; a 400 for a missing or malformed input."""
    if step == "set_rights":
        return _picture_move(step, "", inp, findings)
    tid = need(inp, "territory_id", "the route")
    if step == "set_lead":
        line = inp.get("line")
        if line is not None and (not isinstance(line, str) or len(line.strip()) > 160):
            raise bad("input.line must be a line of the world, or null to let the dials choose")
        line = line.strip() if isinstance(line, str) and line.strip() else None
        return lambda d: _edit(d, tid, lambda w: _set(w, "lead", line) if line is None or line in _lines_of(w) else "That line is not in this world.")
    if step == "star_line":
        line, on = need(inp, "line", "the line"), inp.get("on")
        if not isinstance(on, bool):
            raise bad("input.on must be true or false")

        def star(w):
            st = [x for x in w.get("starred") or [] if x != line]
            if on:
                if line not in _lines_of(w):
                    return "That line is not in this world."
                if len(st) >= MAX_STARS:
                    return "Sixteen starred lines is the most a route holds. Unstar one first."
                st.append(line)
            return _set(w, "starred", st)
        return lambda d: _edit(d, tid, star)
    if step == "set_final":
        return _picture_move(step, tid, inp, findings)
    dial = inp.get("dial_set")
    if dial is not None and not (isinstance(dial, dict) and set(dial) == set(DIALS) and all(isinstance(dial[k], int) and not isinstance(dial[k], bool) and 0 <= dial[k] <= 10 for k in DIALS)):
        raise bad("input.dial_set must be four whole numbers from 0 to 10 (tone, energy, register, brand), or null for the natural feel")
    return lambda d: _edit(d, tid, lambda w: _set(w, "dial_set", dial))


def _set(w: dict, key: str, value) -> None:
    if value is None or value == []:
        w.pop(key, None) if key != "starred" else w.__setitem__("starred", [])
    else:
        w[key] = value
    return None


def _edit(doc: dict, tid: str, fn):
    """Apply ``fn(world)`` to route ``tid`` of ``doc``: ``(doc, refusals)``. ``fn`` returns a refusal in words, or None."""
    from territory import contract
    t = _route_of(doc, tid)
    if t is None or not isinstance(t.get("world"), dict):
        return doc, ["That route has no world yet, so there is nothing to change."]
    d = copy.deepcopy(doc)
    w = _route_of(d, tid)["world"]
    why = fn(w)
    if why:
        return doc, [why]
    ps = contract.problems(d)
    if ps:
        return doc, [ps[0].words]
    return d, []


def _picture_move(step: str, tid: str, inp: dict, findings=None):
    """``set_final`` (``territory_id``, ``slot_id`` or ``sha256``, ``final`` true/false) and ``set_rights`` (``sha256``, ``rights``): the Pictures
    view's choices, through ``territory.pictures``. A picture is found by its slot id or its hash; ``set_rights`` needs only the hash (it is on one
    route). The open gate is refreshed, since a Final with no stated rights holds the greenlight."""
    from territory import pictures
    ref = _s(inp, "slot_id", 80) or _s(inp, "sha256", 80)
    if not ref:
        raise bad("input.slot_id or input.sha256 is required: which picture")
    if step == "set_final":
        on = inp.get("final")
        if not isinstance(on, bool):
            raise bad("input.final must be true or false")
        act = lambda t: pictures.set_final(t, ref, on)      # noqa: E731
    else:
        rights = _s(inp, "rights", 20)
        if rights not in ("generated", "own", "licensed", "unknown"):
            raise bad("input.rights must be generated, own, licensed or unknown")
        act = lambda t: pictures.set_rights(t, ref, rights)     # noqa: E731

    def move(doc):
        from territory import contract
        d = copy.deepcopy(doc)
        ts = [t for t in d.get("territories") or [] if (not tid or t.get("id") == tid) and t.get("pictures")]
        if step == "set_rights":
            try:
                sha = pictures.bare(ref)
            except pictures.PictureError as e:
                return doc, [str(e)]
            ts = [t for t in ts if any(s.get("sha256") == sha for s in t["pictures"])]
        if not ts:
            return doc, ["That picture is not on any route of this document."]
        try:
            act(ts[0])
        except pictures.PictureError as e:
            return doc, [str(e)]
        ps = contract.problems(d)
        if ps:
            return doc, [ps[0].words]
        return _refresh(d, findings), []
    return move
