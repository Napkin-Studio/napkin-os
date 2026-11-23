"""fetch_territories_file@1: hand the app a finished file of its Territories document (middleware-api.md §13).

The files are made by the features that own them (territories-exports registers a board PDF, a one-pager, ...) through
``territories/delivery.register_file``; this task is the delivery path, so the export buttons never ship without one (LESSONS 5). It is
the same envelope as ``fetch_deck_file``: base64 bytes in the reply. It writes nothing to the document. With nothing registered it says
so in words."""
from __future__ import annotations

import base64

from ..doc import ctx_data
from ..territories import delivery, exports
from ..util import TaskError, bad

exports.register()   # territories-exports: the board, the one-pagers, the JSON

NAME, TASK, VERSION, KIND, CAPABILITY_MAJOR = "fetch_territories_file", "fetch_territories_file", "1.0", "territories_file", 1


def run(req, settings) -> dict:
    name = req.inp.get("name")
    if not isinstance(name, str) or not name:
        raise bad("input.name is required: the file to fetch")
    if not (delivery.FILES or delivery.FAMILIES):
        raise TaskError(503, "not_built", "Exports are not built yet, so there is no file to download.")
    found = delivery.resolve(name)
    if found is None:
        raise bad(f"input.name must be one of {', '.join(delivery.names())}", "unknown_file")
    media, make = found
    try:
        raw = make(req.doc, ctx_data(req.clan))
    except TaskError:
        raise
    except Exception as e:   # noqa: BLE001 - words, never a trace
        raise TaskError(502, "file_failed", f"{name} could not be made just now. Nothing was changed; try again.") from e
    if len(raw) > delivery.MAX_FILE_BYTES:
        raise TaskError(413, "file_too_large", f"{name} is too large to hand over in one piece.")
    return {"summary": f"{name}: {len(raw)} bytes", "name": name, "media_type": media, "bytes": len(raw),
            "data_b64": base64.b64encode(raw).decode()}
