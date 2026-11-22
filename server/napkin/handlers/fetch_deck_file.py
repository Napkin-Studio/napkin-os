"""fetch_deck_file@1 — Deck Maker: hand the app a finished file of its deck (deck-cloud).

The engine keeps each deck's files (deck.html, deck.pptx) on its own disk; the document holds only their names. The app asks here for
one by name and gets its bytes as base64. The PDF is not a file of the engine's in the cloud: the app sends deck.html to the host's
export (`clan.exportDoc('pdf', ...)`), and napkin-web prints it with Chromium, as it prints a Brief. This task writes nothing to the
document."""

import base64

from ..deck import engine as eng
from ..util import TaskError, bad

NAME, TASK, VERSION, KIND, CAPABILITY_MAJOR = "fetch_deck_file", "fetch_deck_file", "1.0", "deck_file", 1
#: The files the app may ask for, and their media types.
FILES = {"deck.html": "text/html; charset=utf-8",
         "deck.pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation"}


def run(req, settings) -> dict:
    name = req.inp.get("name")
    if name not in FILES:
        raise bad(f"input.name must be one of {', '.join(FILES)}")
    port = eng.port_for(settings)
    if port is None:
        raise TaskError(503, "engine_unavailable", "no deck engine is configured for this middleware (NAPKIN_DECK_ENGINE_URL)")
    try:
        raw = port.file(req.doc, name)
    except eng.EngineError as e:
        raise TaskError(e.status if 400 <= e.status < 500 else 502, e.etype, e.message) from e
    return {"summary": f"{name}: {len(raw)} bytes", "name": name, "media_type": FILES[name], "bytes": len(raw),
            "data_b64": base64.b64encode(raw).decode()}
