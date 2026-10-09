"""A person's saved projects (features/personal-workspaces.clan): what POST /clan keeps, listed and
read back, so the work follows the name to any browser.

Everything lives in the relay's bucket under the participant, beside the copies POST /clan has
always kept for the organisers:

  clan/<participantId>/projects.json                       ProjectIndex: one row per project, the
                                                           latest save of each (written with If-Match
                                                           on its ETag, so two saves never both win)
  clan/<participantId>/<projectId>/<UTC time>-<etag8>-<reason>.clan
                                                           every save, never overwritten; the index row
                                                           names the one that is the project now
  clan/<participantId>/<projectId>/latest.clan             the newest bytes, for the organisers
  clan/<participantId>/<projectId>/canvas.json             the canvas that goes with them (PUT .../canvas)

A project's ETag is the SHA-256 (hex) of its .clan bytes. A save that names the ETag it started from
(If-Match) is refused when someone saved the project since (Stale): nothing is overwritten without the
person choosing. A save without If-Match is taken as before.

The index needs only GetObject and PutObject under clan/, which the relay already has: no listing.
"""

from __future__ import annotations

import hashlib
import json
from typing import Callable

INDEX = "clan/{w}/projects.json"
BASE = "clan/{w}/{project}"
CANVAS = "clan/{w}/{project}/canvas.json"
CLAN_MIME = "application/vnd.clan+zip"
RETRIES = 5


class Stale(Exception):
    """Someone saved this project since the copy this save started from."""

    def __init__(self, latest: dict):
        when = latest.get("savedAt", "")
        super().__init__(f"This project was saved from somewhere else at {when} since you opened it.")
        self.latest = latest


class Busy(Exception):
    """Lost the index race every time: try again."""


class Missing(Exception):
    """No such project saved for this person."""


def etag_of(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def parse_if_match(value: str | None) -> str | None:
    """The ETag in an If-Match header, without W/ or quotes. None when absent or '*'."""
    if value is None:
        return None
    v = value.strip()
    if v.startswith("W/"):
        v = v[2:]
    v = v.strip('"')
    return v if v and v != "*" else None


def public_row(row: dict) -> dict:
    out = {"id": row["id"], "savedAt": row["savedAt"], "bytes": row["bytes"], "etag": row["etag"]}
    if row.get("name"):
        out["name"] = row["name"]
    return out


class Projects:
    def __init__(self, blobs, clock_iso: Callable[[], str]):
        self.blobs, self.now = blobs, clock_iso

    def _rows(self, workspace: str) -> list[dict]:
        data = self.blobs.get_json(INDEX.format(w=workspace)) or {}
        return list(data.get("projects", []))

    def list(self, workspace: str) -> list[dict]:
        """The person's projects, newest save first."""
        return sorted(self._rows(workspace), key=lambda r: (r["savedAt"], r["id"]), reverse=True)

    def count(self, workspace: str) -> int:
        return len(self._rows(workspace))

    def row(self, workspace: str, project: str) -> dict:
        row = next((r for r in self._rows(workspace) if r["id"] == project), None)
        if not row:
            raise Missing("That project is not saved on the server.")
        return row

    def read(self, workspace: str, project: str) -> tuple[bytes, dict]:
        """The project's bytes as its index row names them, and the row."""
        row = self.row(workspace, project)
        data = self.blobs.get(row["key"])
        if data is None:
            raise Missing("That project's saved copy is missing on the server.")
        return data, row

    def save(self, workspace: str, project: str, data: bytes, reason: str, *, if_match: str | None = None,
             name: str | None = None) -> dict:
        """Keep a save of the project. The new index row; Stale when if_match is not the latest."""
        etag = etag_of(data)
        at = self.now()
        base = BASE.format(w=workspace, project=project)
        # Its own key, written first: the index names it only once the claim below succeeds.
        key = f"{base}/{at.replace(':', '')}-{etag[:8]}-{reason}.clan"
        self.blobs.put(key, data, CLAN_MIME)
        for _ in range(RETRIES):
            index, tag = self.blobs.get_json_tagged(INDEX.format(w=workspace))
            rows = list((index or {}).get("projects", []))
            old = next((r for r in rows if r["id"] == project), None)
            if if_match is not None and old is not None and old["etag"] != if_match:
                raise Stale(public_row(old))
            row = {"id": project, "savedAt": at, "bytes": len(data), "etag": etag, "key": key}
            kept = name if name is not None else (old or {}).get("name")
            if kept:
                row["name"] = kept
            rows = [r for r in rows if r["id"] != project] + [row]
            if self.blobs.put_json_if(INDEX.format(w=workspace), {"workspace": workspace, "projects": rows}, tag):
                self.blobs.put(f"{base}/latest.clan", data, CLAN_MIME)
                return row
        raise Busy("The server was busy saving; try again.")

    def put_canvas(self, workspace: str, project: str, canvas: dict) -> None:
        self.row(workspace, project)  # a canvas goes with a saved project
        self.blobs.put(CANVAS.format(w=workspace, project=project), json.dumps(canvas).encode(), "application/json")

    def canvas(self, workspace: str, project: str) -> dict:
        data = self.blobs.get_json(CANVAS.format(w=workspace, project=project))
        if data is None:
            raise Missing("That project has no canvas saved on the server.")
        return data
