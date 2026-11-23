"""One JSON log line per thing that happens to a job (features/pt-relay-trace.clan).

Every line is `{"evt": ..., "jobId": ..., ...}` on the "relay" logger, so
`aws logs filter-log-events --filter-pattern '"<jobId>"'` finds a whole job.
Never a key, an auth header or a presigned query string: a URI is logged as
scheme, host and path only (uri_of), a data: URI as its type and size.
"""

from __future__ import annotations

import json
import logging
from urllib.parse import urlsplit

log = logging.getLogger("relay")

TEXT_MAX = 8192  # a rejected answer or a reason is kept up to this many characters


def clip(text, limit: int = TEXT_MAX) -> str | None:
    """`text` as a string of at most `limit` characters, marked when it was cut."""
    if text is None:
        return None
    text = text if isinstance(text, str) else json.dumps(text, ensure_ascii=False, default=str)
    if len(text) <= limit:
        return text
    return text[:limit] + f"…[cut, {len(text)} chars]"


def uri_of(uri) -> str | None:
    """A URI with no secret in it: scheme://host/path (no query string, fragment or user info);
    a data: URI as data:<mime>,<n> chars."""
    if not uri or not isinstance(uri, str):
        return None
    if uri.startswith("data:"):
        head = uri[5:].split(",", 1)[0].split(";", 1)[0]
        return f"data:{head or '?'},{len(uri)} chars"
    try:
        parts = urlsplit(uri)
    except ValueError:
        return "?"
    if not parts.scheme:
        return parts.path or "?"
    return f"{parts.scheme}://{parts.hostname or ''}{parts.path}"


def trace(evt: str, job_id, **fields) -> None:
    """Log one event. Never raises: tracing must not fail a job."""
    try:
        rec = {"evt": evt, "jobId": job_id or None}
        rec.update({k: v for k, v in fields.items() if v is not None})
        log.info(json.dumps(rec, ensure_ascii=False, default=str))
    except Exception:  # pragma: no cover - a field json cannot write even with default=str
        log.warning("trace %s for %s could not be written", evt, job_id)


def ms(seconds) -> int | None:
    return None if seconds is None else int(round(seconds * 1000))
