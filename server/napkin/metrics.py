"""The run ledger: one JSON line per model attempt, research call and stage.

A served middleware (`python -m napkin.app`) appends to `runs/metrics/middleware.jsonl`
by default; set `NAPKIN_METRICS_FILE` to another path, or to an empty string to
switch it off. Tests and embedded use write nothing unless the variable is set. The ledger is
metadata only, never a prompt or a reply. Read it back with `server/tools/run_report.py`.

`NAPKIN_RECORD_DIR` is a separate, opt-in switch for test recordings: when set, every model
attempt is also written in full (system prompt, input, schema, reply) to
`<dir>/model_calls.jsonl`, so a stage can be replayed or a cheaper model tried on the same
input. Recordings hold whatever the job read; keep the directory out of git and away from
client material. A Production Tool brief's spine (`{"title", "spine"}` under a `brief` key, the
relay's JobInput.brief) is never recorded: it can carry parts a client marked Confidential, which
Napkin's own systems never take in (features/brief-node.clan, owner 2026-11-13 and 2026-11-18).
"""

from __future__ import annotations

import contextvars
import json
import os
import threading
import time
from pathlib import Path

_LOCK = threading.Lock()
UNIT: contextvars.ContextVar = contextvars.ContextVar("napkin_unit", default=None)  # "<lens>/<market>" while a unit runs
DEFAULT_FILE = Path(__file__).resolve().parents[2] / "runs" / "metrics" / "middleware.jsonl"


def enable_by_default() -> None:
    """Called by the server's `main`: turn the ledger on unless the operator set the variable (empty = off)."""
    if "NAPKIN_METRICS_FILE" not in os.environ:
        DEFAULT_FILE.parent.mkdir(parents=True, exist_ok=True)
        os.environ["NAPKIN_METRICS_FILE"] = str(DEFAULT_FILE)


def emit(kind: str, **fields) -> None:
    """Append one ledger line. Never raises: metrics must not fail a job."""
    path = os.environ.get("NAPKIN_METRICS_FILE", "").strip()
    if not path:
        return
    rec = {"ts": time.strftime("%Y-%m-%dT%H:%M:%S", time.gmtime()), "kind": kind, **fields}
    if "unit" not in rec and UNIT.get():
        rec["unit"] = UNIT.get()
    try:
        with _LOCK, open(path, "a", encoding="utf-8") as f:
            f.write(json.dumps(rec, ensure_ascii=False) + "\n")
    except (OSError, TypeError, ValueError):
        pass


_INPUT_OPEN, _INPUT_CLOSE = "<input>\n", "\n</input>"


def _drop_briefs(node) -> int:
    """Take every brief spine (`brief: {"spine": ...}`) out of a payload, in place; how many went."""
    n = 0
    if isinstance(node, dict):
        b = node.get("brief")
        if isinstance(b, dict) and "spine" in b:
            del node["brief"]
            n += 1
        for v in node.values():
            n += _drop_briefs(v)
    elif isinstance(node, list):
        for v in node:
            n += _drop_briefs(v)
    return n


def _reply_without_flags(text: str) -> tuple[str, int]:
    """A JSON reply with its `briefFlags` left out (each quotes a line of the brief); any other text as it came."""
    if not text.lstrip().startswith("{") or "briefFlags" not in text:
        return text, 0
    try:
        reply = json.loads(text)
    except ValueError:
        return text, 0
    if not isinstance(reply, dict) or "briefFlags" not in reply:
        return text, 0
    del reply["briefFlags"]
    return json.dumps(reply, ensure_ascii=False), 1


def without_briefs(text: str) -> tuple[str, int]:
    """A model turn's text (`Task: ...\\n\\n<input>\\n{json}\\n</input>`) with any brief spine left out of its
    input; any other text as it came."""
    if not isinstance(text, str):
        return text, 0
    if _INPUT_OPEN not in text or _INPUT_CLOSE not in text:
        return _reply_without_flags(text)
    head, rest = text.split(_INPUT_OPEN, 1)
    body, tail = rest.rsplit(_INPUT_CLOSE, 1)
    try:
        payload = json.loads(body)
    except ValueError:
        return text, 0
    n = _drop_briefs(payload)
    if not n:
        return text, 0
    return head + _INPUT_OPEN + json.dumps(payload, ensure_ascii=False, separators=(",", ":")) + _INPUT_CLOSE + tail, n


def record(kind: str, **fields) -> None:
    """Append one full recording line to `$NAPKIN_RECORD_DIR/<kind>.jsonl`. Off unless the variable is set. Never raises.
    A brief's spine is left out of every text field (without_briefs), and the line says how many went."""
    d = os.environ.get("NAPKIN_RECORD_DIR", "").strip()
    if not d:
        return
    gone = 0
    for k, v in list(fields.items()):
        if isinstance(v, str):
            fields[k], n = without_briefs(v)
            gone += n
    if gone:
        fields["briefs_left_out"] = gone
    rec = {"ts": time.strftime("%Y-%m-%dT%H:%M:%S", time.gmtime()), "unit": UNIT.get(), **fields}
    try:
        Path(d).mkdir(parents=True, exist_ok=True)
        with _LOCK, open(Path(d) / f"{kind}.jsonl", "a", encoding="utf-8") as f:
            f.write(json.dumps(rec, ensure_ascii=False) + "\n")
    except (OSError, TypeError, ValueError):
        pass
