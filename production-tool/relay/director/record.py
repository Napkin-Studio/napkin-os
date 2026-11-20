"""What Dex received, kept on the job record (features/pt-canvas-r1.clan; director.schema.json agentBlock.input).

The job record kept Dex's answer but not its question, so the ledger could not show what Dex was given (UAT
round 1, 2026-11-21). This is the input after the relay's own cuts (the brief and the context per op, the wire
tags, the cards), made small enough to live on the record: asset urls go (the sha256 names the picture), each
string is cut to STRING_MAX, each list to LIST_MAX, and when the whole is still over TOTAL_MAX bytes the biggest
fields are summarised until it fits. Pure: the payload is never changed.
"""

from __future__ import annotations

import json

STRING_MAX = 400
LIST_MAX = 16
TOTAL_MAX = 8_000
# Never kept: a picture's bytes or its address; the sha256 says which picture it was.
DROP = {"url", "data", "mime"}


def _cut(value, depth: int = 0):
    if isinstance(value, str):
        return value if len(value) <= STRING_MAX else value[: STRING_MAX - 1] + "…"
    if isinstance(value, list):
        kept = [_cut(v, depth + 1) for v in value[:LIST_MAX]]
        if len(value) > LIST_MAX:
            kept.append(f"… {len(value) - LIST_MAX} more")
        return kept
    if isinstance(value, dict):
        if depth > 6:
            return "…"
        return {k: _cut(v, depth + 1) for k, v in value.items() if k not in DROP}
    return value


def _size(value) -> int:
    return len(json.dumps(value, ensure_ascii=False, separators=(",", ":")).encode())


def for_record(payload: dict) -> dict:
    """The director's input as the job record keeps it: at most TOTAL_MAX bytes of JSON."""
    out = _cut(payload or {})
    if not isinstance(out, dict):
        return {}
    while _size(out) > TOTAL_MAX:
        # The biggest field gives way first, as a note of what it was.
        key = max(out, key=lambda k: _size(out[k]))
        was = out[key]
        if isinstance(was, str) and was.startswith("… ") and was.endswith("left out"):
            break  # every field is a note already
        what = f"{len(was)} items" if isinstance(was, list) else f"{_size(was)} bytes"
        out[key] = f"… {what} left out"
    return out
