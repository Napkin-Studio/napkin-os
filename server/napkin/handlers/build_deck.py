"""build_deck@1 — Deck Maker: one segment of a run, through the deck engine (middleware-api.md §12).

The document's prompt (inputs.prompt), kind and format go to the engine with the person's approvals (run.approvals, which the app
writes); the engine runs to the next gate, or on to the finished deck once the last gate is approved. With NAPKIN_DECK_ENGINE_URL
unset there is no engine: the task says so, and writes nothing."""

from ..deck import engine as eng
from ..deck.job import DeckJob
from ..doc import ctx_data
from ..util import TaskError, bad

NAME, TASK, VERSION, KIND, CAPABILITY_MAJOR = "build_deck", "build_deck", "1.0", "deck", 1


def start(req, caps, settings, jid):
    """Validate now (a 400 before any job, a 503 with no engine); build the job (the caller starts it)."""
    data = ctx_data(req.clan)
    inputs = data.get("inputs") if isinstance(data.get("inputs"), dict) else {}
    prompt = inputs.get("prompt") if isinstance(inputs.get("prompt"), dict) else {}
    if not str(prompt.get("text") or "").strip():
        raise bad("give the deck something to build from: inputs.prompt.text is empty")
    port = eng.port_for(settings)
    if port is None:
        raise TaskError(503, "engine_unavailable", "no deck engine is configured for this middleware (NAPKIN_DECK_ENGINE_URL)")
    run = data.get("run") if isinstance(data.get("run"), dict) else {}
    approvals = run.get("approvals") if isinstance(run.get("approvals"), dict) else {}
    body = {"doc": req.doc,
            "inputs": {"prompt": {k: prompt.get(k) or "" for k in ("text", "client", "project", "agency")},
                       "kind": inputs.get("kind") or "agency", "format": inputs.get("format") or "pitch"},
            "approvals": approvals, "render": bool(getattr(settings, "deck_render", True))}
    if inputs.get("text_mode") in ("condense", "preserve"):   # the person's choice: condense lets the repair loop move points to the notes and shorten
        body["inputs"]["text_mode"] = inputs["text_mode"]
    if isinstance(data.get("review"), dict) and data["review"].get("pinned"):   # the slides the person pinned: the repair loop leaves them alone
        body["inputs"]["review"] = {"pinned": data["review"]["pinned"]}
    return DeckJob(jid, TASK, req.handler, req, caps, port=port, body=body)
