"""attach_production@1 — Deck Maker: keep the person's Production .clan or export zip with the deck engine (deck-prod-picker).

The app reads a file the person attached to the deck (a .clan, or Production's export zip) and sends its bytes here once; the engine checks
it as its picker reads it (contract 3, the importer's caps), stores it by its sha256 and answers what it holds. The app then records
inputs.production {name, sha256, fetch, look}, and every build_deck passes it on, so the engine runs with --production FILE. Nothing is
fetched from anywhere: fetching picked pictures stays the person's opt-in (inputs.production.fetch) behind the engine's host allow-list.
This task writes nothing to the document."""

import base64
import binascii
import re

from ..deck import engine as eng
from ..util import TaskError, bad

NAME, TASK, VERSION, KIND, CAPABILITY_MAJOR = "attach_production", "attach_production", "1.0", "deck_file", 1
#: The importer's cap on a .clan (64 MB); the middleware's request cap is 64 MB, base64 included, so this route carries about 47 MB at most.
MAX_BYTES = 64_000_000


def check(inp: dict) -> tuple[str, str]:
    """(name, data_b64) from the task input, or a 400: a .clan or .zip name, base64 bytes under the cap."""
    name = inp.get("name")
    if not isinstance(name, str) or not re.fullmatch(r"[^/\\]{1,200}\.(clan|zip)", name, re.IGNORECASE):
        raise bad("input.name must be the attached file's name, ending .clan or .zip")
    data = inp.get("data_b64")
    if not isinstance(data, str) or not data:
        raise bad("input.data_b64 must be the file's bytes as base64")
    if len(data) > MAX_BYTES * 4 // 3 + 4:
        raise TaskError(413, "too_large", f"the Production file is over {MAX_BYTES // 1_000_000} MB")
    try:
        base64.b64decode(data, validate=True)
    except (binascii.Error, ValueError):
        raise bad("input.data_b64 is not valid base64") from None
    return name, data


def run(req, settings) -> dict:
    """Send the file to the engine; the result is what the engine stored (no change: the app records inputs.production itself)."""
    name, data = check(req.inp)
    port = eng.port_for(settings)
    if port is None:
        raise TaskError(503, "engine_unavailable", "no deck engine is configured for this middleware (NAPKIN_DECK_ENGINE_URL)")
    try:
        got = port.store_production({"doc": req.doc, "name": name, "data_b64": data})
    except eng.EngineError as e:
        raise TaskError(e.status if 400 <= e.status < 500 else 502, e.etype, e.message) from e
    return {"summary": f"The engine holds {got.get('name') or name}: {got.get('rows', 0)} asset(s), {got.get('eligible', 0)} the deck could place.",
            "sha256": str(got.get("sha256") or ""), "name": str(got.get("name") or name), "kind": str(got.get("kind") or ""),
            "rows": int(got.get("rows") or 0), "eligible": int(got.get("eligible") or 0)}
