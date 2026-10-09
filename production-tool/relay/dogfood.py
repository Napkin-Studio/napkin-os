"""The beta's record of everything a participant does (features/production-tool-dogfood.clan).

On only while config.json says flags.dogfood, and for a participant only after they have
acknowledged the notice (POST /dogfood/consent). Modelled on Napkin OS's dogfood build
(crates/napkin-web/src/dogfood.rs): one JSON object per line, request bodies capped at 64 KiB as
{size, truncated, text}, nothing before consent, read in time order. Without its noise
(features/dogfood-log-quality.clan):

- polls and read-only GETs are never recorded: a job is recorded by its state changes only
  (Relay._save), so a 2 s poll for a minute writes nothing unless the job moved;
- a run of identical events from one person is its first line plus one `repeat` line
  {of, count, first, last}, where count is how many more times it happened after the first line.
  The relay folds what one warm Lambda sees (the repeat line is one object, rewritten as the run
  grows), the web app folds before it sends, and `fold_lines` folds again when the record is
  read, so runs split across Lambdas or batches still read as one.

Where (the hackathon bucket, through the relay's Blobs):
  dogfood/events/<yyyy-mm-dd>/<participantId>/<HHMMSS.mmm>-<source>-<rand>.jsonl
  dogfood/consent/<participantId>.json      {participantId, handle, team?, workspace, role, at}

The participant id is the workspace, so a person's record is one prefix per day, and their name
lives only in the consent object. Read and prune with scripts/dogfood_record.py (a person with AWS
access); nothing expires on its own. Recording never fails or slows a request: every write is
caught and logged.
"""

from __future__ import annotations

import hashlib
import json
import logging
import re
import secrets
from datetime import datetime, timezone

log = logging.getLogger("relay.dogfood")

PREFIX = "dogfood/"
EVENTS = PREFIX + "events/"
CONSENT = PREFIX + "consent/"
BODY_CAP = 64 * 1024
BATCH_MAX = 500
BATCH_BYTES = 256 * 1024
MIME = "application/x-ndjson"
CLOCK_SKEW_S = 300
# Parts of an event that change from one identical call to the next.
VOLATILE = {"at", "seq", "tab", "ms", "latencyMs"}
# Never folded: each one is a person's own statement.
UNFOLDED = {"feedback", "feedback-note", "consent", "repeat"}
SAFE_ID = re.compile(r"[^A-Za-z0-9_-]")


def iso(ts: float) -> str:
    return datetime.fromtimestamp(ts, timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def browser_time(at, now: float) -> str:
    """When the browser saw it, so a click sorts before the job it started; the relay's own time
    when the browser's clock is missing or more than CLOCK_SKEW_S away."""
    try:
        t = datetime.fromisoformat(str(at).replace("Z", "+00:00")).timestamp()
    except (TypeError, ValueError):
        return iso(now)
    return iso(t) if abs(t - now) <= CLOCK_SKEW_S else iso(now)


def safe_id(pid: str) -> str:
    return SAFE_ID.sub("_", pid)[:64] or "unknown"


def body_value(raw: bytes, cap: int = BODY_CAP) -> dict:
    """A body as the record keeps it: text when it is text, cut at cap bytes, saying so."""
    kept = raw[:cap]
    try:
        text = kept.decode()
    except UnicodeDecodeError as e:
        text = kept[:e.start].decode(errors="ignore") if e.start else None
    out = {"size": len(raw), "truncated": len(raw) > cap}
    if text is None:
        out["binary"] = True
    else:
        out["text"] = text
    return out


def capped(data):
    """An event's data, capped like a body: a shell event can carry what was typed."""
    raw = json.dumps(data, separators=(",", ":"), default=str).encode()
    return {"capped": body_value(raw)} if len(raw) > BODY_CAP else data


def fold_key(e: dict) -> str | None:
    """What makes two events the same: kind, name, project, stage and data, minus timings."""
    if e.get("kind") in UNFOLDED:
        return None
    data = e.get("data")
    if isinstance(data, dict):
        data = {k: v for k, v in data.items() if k not in VOLATILE}
    raw = json.dumps([e.get("kind"), e.get("name"), e.get("project"), e.get("stage"), data],
                     sort_keys=True, separators=(",", ":"), default=str)
    return hashlib.sha1(raw.encode()).hexdigest()


def repeat_line(first: dict, count: int, start: str, last: str) -> dict:
    out = {k: first[k] for k in ("participant", "source", "project", "stage") if first.get(k) is not None}
    return {"ts": last, **out, "kind": "repeat", "name": first["name"],
            "data": {"of": first["kind"], "count": count, "first": start, "last": last}}


def fold_stream(events: list[dict]) -> list[dict]:
    """One person's events from one source, in time order: each run of identical events becomes
    its first line plus one repeat line. Repeat lines already written (by the relay or the web app)
    add to the run they follow."""
    out: list[dict] = []
    cur: dict | None = None  # {key, first, count, start, last}

    def close():
        if cur and cur["count"]:
            out.append(repeat_line(cur["first"], cur["count"], cur["start"], cur["last"]))

    for e in events:
        if e.get("kind") == "repeat":
            d = e.get("data") or {}
            if cur and cur["first"]["name"] == e.get("name") and cur["first"]["kind"] == d.get("of"):
                cur["start"] = cur["start"] or d.get("first") or e["ts"]
                cur["count"] += int(d.get("count") or 0)
                cur["last"] = max(cur["last"] or "", d.get("last") or e["ts"])
                continue
            close()
            cur = None
            out.append(e)
            continue
        key = fold_key(e)
        if key is not None and cur and cur["key"] == key:
            cur["start"] = cur["start"] or e["ts"]
            cur["count"] += 1
            cur["last"] = e["ts"]
            continue
        close()
        out.append(e)
        cur = {"key": key, "first": e, "count": 0, "start": "", "last": ""} if key else None
    close()
    return out


def fold_lines(lines: list[dict]) -> list[dict]:
    """The whole record, folded per person and source, in time order across people."""
    streams: dict[tuple, list[dict]] = {}
    for e in lines:
        streams.setdefault((e.get("participant"), e.get("source")), []).append(e)
    out: list[dict] = []
    for events in streams.values():
        events.sort(key=lambda e: (e.get("ts", ""), e.get("kind") == "repeat"))
        out.extend(fold_stream(events))
    out.sort(key=lambda e: e.get("ts", ""))
    return out


class Dogfood:
    """The relay's writer: consent, the web app's batches, and the relay's own events."""

    def __init__(self, blobs, clock, rand=lambda: secrets.token_hex(3)):
        self.blobs, self.clock, self.rand = blobs, clock, rand
        self._consented: set[str] = set()
        # One open run per participant in this warm Lambda: {key, first, count, start, last, object}
        self._runs: dict[str, dict] = {}

    # ── consent ────────────────────────────────────────────────────────────
    def consented(self, pid: str) -> bool:
        if pid in self._consented:
            return True
        try:
            if self.blobs.exists(f"{CONSENT}{safe_id(pid)}.json"):
                self._consented.add(pid)
                return True
        except Exception:
            log.exception("dogfood: consent check failed")
        return False

    def consent(self, who: dict) -> None:
        pid = who["pid"]
        record = {"participantId": pid, "handle": who.get("h"), "workspace": who.get("w") or pid,
                  "role": who.get("r", "participant"), "at": iso(self.clock())}
        if who.get("t"):
            record["team"] = who["t"]
        self.blobs.put(f"{CONSENT}{safe_id(pid)}.json", json.dumps(record).encode(), "application/json")
        self._consented.add(pid)
        self.record(pid, "consent", "dogfood notice acknowledged", {"role": record["role"]})

    # ── writing ────────────────────────────────────────────────────────────
    def _key(self, pid: str, ts: float, source: str, suffix: str = "") -> str:
        stamp = iso(ts)
        return f"{EVENTS}{stamp[:10]}/{safe_id(pid)}/{stamp[11:23].replace(':', '')}-{source}-{self.rand()}{suffix}.jsonl"

    def _put(self, key: str, lines: list[dict]) -> None:
        body = "".join(json.dumps(e, separators=(",", ":"), default=str) + "\n" for e in lines)
        self.blobs.put(key, body.encode(), MIME)

    def write_batch(self, pid: str, events: list[dict]) -> int:
        """The web app's batch: one object. Context comes from the token, the time from here."""
        now = self.clock()
        lines = []
        for s in events[:BATCH_MAX]:
            e = {"ts": browser_time(s.get("at"), now), "participant": pid, "source": "web", "kind": s["kind"], "name": s.get("name", "")}
            for k in ("project", "stage"):
                if s.get(k):
                    e[k] = s[k]
            data = dict(s.get("data") or {})
            for k in ("tab", "seq"):
                if s.get(k) is not None:
                    data[k] = s[k]
            e["data"] = capped(data)
            lines.append(e)
        if lines:
            self._put(self._key(pid, now, "web"), lines)
        return len(lines)

    def record(self, pid: str, kind: str, name: str, data: dict | None = None, *,
               project: str | None = None, stage: str | None = None) -> None:
        """One of the relay's own events, folded into the participant's open run when identical."""
        now = self.clock()
        e = {"ts": iso(now), "participant": pid, "source": "relay", "kind": kind, "name": name}
        if project:
            e["project"] = project
        if stage:
            e["stage"] = stage
        e["data"] = capped(data or {})
        key = fold_key(e)
        run = self._runs.get(pid)
        if key is not None and run and run.get("key") == key:
            run["count"] += 1
            run["start"] = run["start"] or e["ts"]
            run["last"] = e["ts"]
            if not run["object"]:
                run["object"] = self._key(pid, now, "relay", "-r")
            # one object stands for the whole run, rewritten as it grows
            self._put(run["object"], [repeat_line(run["first"], run["count"], run["start"], run["last"])])
            return
        self._runs[pid] = {"key": key, "first": e, "count": 0, "start": "", "last": "", "object": None} if key else {}
        self._put(self._key(pid, now, "relay"), [e])
