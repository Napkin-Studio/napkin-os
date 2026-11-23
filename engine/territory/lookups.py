"""Look-ups (feature territories-lookups): the Booth's "Look it up" box, through the research port.

Three small moves on the document, each ``fn(doc, ...) -> (doc, refusals, note)`` like ``gates``; no network except in ``run``:

    propose(doc, q, by, proposer=)     the OK card: a look-up in the document with status ``ask`` (what will be looked up, and who wants it). No call.
    decline(doc, lookup_id, by)        the person says no: status ``refused``. No call.
    run(doc, lookup_id, by, research=, spend=)
                                       the person said OK: ONE search through the research port (``napkin.research/1``: Tavily, Nova grounding
                                       when it fails; the port checks every quote against its page), paid through ``spend`` (its own count and
                                       money caps), recorded once per look-up. The results arrive as finds (``in_play`` false: candidates, with the
                                       page they were read on) and ONE Booth note naming them.
    pin_quote(doc, find_id, by, on)    a named person pins a CHECKED quote into the document (``in_play``), or takes it out again.

The look-up is the one place a find is made; nothing is written to Research or the brief (the finds are separate from research pins). No price
appears in the document: the ask, spend and outcome entries in the decision history are the only place (``Spend.decisions``).
"""
from __future__ import annotations

import copy
import hashlib

from . import contract, gates, spend as sp

MAX_Q = 240
MAX_FIND_CHARS = 400
PER_SOURCE = 2                  # quotes taken from one page
SOURCES = 4                     # pages asked of the port
LENS = "consumer_culture"       # the port's default lens for an open question; a caller may name another
WORDS_NOT_NAMED = "Say who is asking. Only a named person can say OK to a look-up."


def _norm(q: str) -> str:
    return " ".join(str(q or "").split())


def _get(doc: dict, lookup_id: str):
    return next((x for x in doc.get("lookups") or [] if x.get("id") == lookup_id), None)


def card(doc: dict, lookup_id: str) -> dict | None:
    """What the OK card says: the question and who wants it. No price (LESSONS 19); the counts are the history's."""
    lq = _get(doc, lookup_id)
    return None if lq is None else {"id": lq["id"], "q": lq["q"], "by": lq.get("by"), "status": lq["status"]}


def propose(doc: dict, q: str, by: str, proposer: str | None = None) -> tuple[dict, list[str], str]:
    who = gates._who(by)
    if not who:
        return doc, [WORDS_NOT_NAMED], ""
    q = _norm(q)
    if not q:
        return doc, ["Say what to look up."], ""
    if len(q) > MAX_Q:
        return doc, [f"Keep the question to {MAX_Q} characters or fewer."], ""
    old = next((x for x in doc.get("lookups") or [] if _norm(x["q"]).lower() == q.lower() and x["status"] in ("ask", "done")), None)
    if old:
        return doc, ["That was already looked up. Its note is in the Booth." if old["status"] == "done" else "That is already waiting for an OK."], ""
    if len(doc.get("lookups") or []) >= contract.limit("lookups"):
        return doc, ["This document already holds as many look-ups as it can."], ""
    d = copy.deepcopy(doc)
    lq = {"id": contract.mint("lookup", f"{q}:{len(d.get('lookups') or [])}"), "q": q, "status": "ask", "by": (proposer or who).strip()[:160]}
    d.setdefault("lookups", []).append(lq)
    return d, [], "Waiting for your OK before anything is looked up."


def decline(doc: dict, lookup_id: str, by: str) -> tuple[dict, list[str], str]:
    if not gates._who(by):
        return doc, [WORDS_NOT_NAMED], ""
    lq = _get(doc, lookup_id)
    if lq is None:
        return doc, ["That look-up is not in this document."], ""
    if lq["status"] != "ask":
        return doc, ["That look-up is already settled."], ""
    d = copy.deepcopy(doc)
    _get(d, lookup_id)["status"] = "refused"
    return d, [], "Not looked up."


def _excerpt(e) -> tuple[str, bool]:
    """(quote, checked). The port keeps only quotes it checked against the page; an excerpt it marks otherwise is carried as unchecked."""
    if isinstance(e, dict):
        return _norm(e.get("quote")), e.get("checked") is not False
    return _norm(e), True


def candidates(out: dict, lookup_id: str) -> list[dict]:
    """The port's sources as finds: ``{id, kind found, text, source, date, quote_checked, lookup, in_play false, url}``. A quote that does not fit
    a find whole (over its limit) or that carries text a person must never see is left out, never cut: a cut quote is no longer on the page."""
    rows, seen = [], set()
    for s in (out or {}).get("sources") or []:
        url = str(s.get("url") or "")
        if not url.startswith(("http://", "https://")):
            continue
        n = 0
        for e in s.get("excerpts") or []:
            text, checked = _excerpt(e)
            if not text or len(text) > MAX_FIND_CHARS or any(t in text for t in contract.TEXT_LEAKS) or text in seen:
                continue
            seen.add(text)
            when = _norm(s.get("published_at")) or (f"read {_norm(s.get('retrieved_at'))}" if s.get("retrieved_at") else "undated")
            rows.append({"id": contract.mint("find", f"{lookup_id}:{url}:{text}"), "kind": "found", "text": text,
                         "source": (_norm(s.get("publisher")) or _norm(s.get("title")) or url)[:200], "date": when[:40], "quote_checked": checked,
                         "lookup": lookup_id, "in_play": False, "url": url[:500]})
            n += 1
            if n >= PER_SOURCE:
                break
    return rows


def _usd(out: dict) -> float:
    """What this search really cost: the port's own figure when it gave one (Tavily credits), else the table's price of a search; plus the model
    tokens the port used to choose and check, priced from the shared table."""
    import price_table
    trace = (out or {}).get("trace") or {}
    base = trace.get("cost_usd")
    usd = float(base) if base is not None else price_table.search_usd()
    tok = trace.get("tokens") or {}
    if trace.get("model") and (tok.get("input") or tok.get("output")):
        usd += price_table.usd(trace["model"], int(tok.get("input") or 0), int(tok.get("output") or 0))
    return round(usd, 6)


def run(doc: dict, lookup_id: str, by: str, *, research, spend: sp.Spend, market: str = "", lens: str = LENS) -> tuple[dict, list[str], str]:
    """The OK was given by ``by``: look it up once. ``research`` is a ``search(query, lens, market, ..., max_sources=)`` (the middleware's
    ``caps.research``). Refused in words (nothing paid) when nobody is named, the look-up is not waiting for an OK (a replay of an approved one
    is refused here: the first run's finds are in the document), or the search cannot run."""
    who = gates._who(by)
    if not who:
        return doc, [WORDS_NOT_NAMED], ""
    lq = _get(doc, lookup_id)
    if lq is None:
        return doc, ["That look-up is not in this document."], ""
    if lq["status"] != "ask":
        return doc, ["That look-up was already settled, so it was not run again."], ""
    est = _usd({})
    if not any(e.get("kind") == "ask" and e.get("lookup") == lookup_id for e in spend.events):
        spend.ask({"calls": 1, "est_usd": round(est, 4), "what": "lookup", "lookup": lookup_id}, by=who)
    key = "lookup:" + hashlib.sha256(f"{lookup_id}\n{lq['q']}".encode()).hexdigest()[:20]

    def go():
        out = research.search(lq["q"], lens, market, max_sources=SOURCES)
        return out, _usd(out)
    try:
        out = spend.charge_lookup(key, est, go)
    except sp.CapReached as e:
        return doc, [str(e)], ""
    except Exception as e:      # noqa: BLE001 - the port's own words, never a trace
        if "no research service" in str(e) or "not configured" in str(e):
            return doc, ["Searching is not set up here, so nothing was looked up and nothing was spent."], ""
        return doc, ["The search did not answer, so nothing was looked up and nothing was spent. Try again in a moment."], ""
    d = copy.deepcopy(doc)
    mine = _get(d, lookup_id)
    have = {f["id"] for f in d.get("finds") or []}
    room = max(0, contract.limit("finds") - len(d.get("finds") or []))
    new = [f for f in candidates(out, lookup_id) if f["id"] not in have][:min(room, contract.limit("lookup", "found"))]
    d.setdefault("finds", []).extend(new)
    at = gates.now()
    mine.update(status="done", found=[f["id"] for f in new], at=at)
    mine["ok_by"] = who
    srcs = {f["url"] for f in new}
    if new:
        n_ok = sum(1 for f in new if f["quote_checked"])
        text = (f"Looked up: {mine['q']} Found {len(new)} quote{'s' if len(new) != 1 else ''} on {len(srcs)} page{'s' if len(srcs) != 1 else ''}, "
                f"{n_ok} checked against the page. Pin the ones worth keeping.")
    else:
        text = f"Looked up: {mine['q']} Nothing usable came back, so nothing was added."
    nid = contract.mint("note", f"{lookup_id}:{len(d.get('notes') or [])}")
    d.setdefault("notes", []).append({"id": nid, "agent": "research", "text": text[:400], "at": at, "cite": [f["id"] for f in new][:6]})
    run_ = d.setdefault("run", {"state": "building"})
    calls = run_.setdefault("calls", {"model": 0, "lookups": 0})
    calls["lookups"] = int(calls.get("lookups") or 0) + 1
    ps = contract.problems(d) or contract.lint(d)
    if ps:
        return doc, [ps[0].words], ""
    spend.outcome("look-up", finds=len(new), pages=len(srcs))
    return d, [], text


def pin_quote(doc: dict, find_id: str, by: str, on: bool = True, text: str | None = None) -> tuple[dict, list[str]]:
    """A named person pins a checked quote (``in_play``) or takes it out. ``text``, when given, must be the quote as stored: a quote changed on
    its way here is not pinned."""
    if not gates._who(by):
        return doc, ["Say who is pinning it. Only a named person can pin a quote."]
    f = next((x for x in doc.get("finds") or [] if x.get("id") == find_id), None)
    if f is None:
        return doc, ["That find is not in this document."]
    if on and f.get("kind") != "found":
        return doc, ["Only a quote read by a look-up can be pinned here."]
    if on and f.get("quote_checked") is not True:
        return doc, ["That quote was not checked against its page, so it cannot be pinned."]
    if text is not None and _norm(text) != _norm(f["text"]):
        return doc, ["That quote is not the one the look-up read, so it was not pinned."]
    d = copy.deepcopy(doc)
    next(x for x in d["finds"] if x["id"] == find_id)["in_play"] = bool(on)
    return d, []
