"""The workspace library: solid reference keys shared by everyone signed in to one workspace.

A key's versions are immutable JSON files; an index lists the latest of each. Both live in the
relay's bucket, so there is no table to run:

  library/<workspace>/index.json        LibraryIndex, written with If-Match on its ETag (claims a version)
  library/<workspace>/<key>/<ver>.json  LibraryEntry, written once the index names it

Publishing names the version the document holds (baseVer). When the index already has a newer one
someone else published first, the publish is a conflict, never an overwrite. Images are not copied:
a ref points at the content-addressed upload (in/sha256:…), which nothing deletes.
"""

from __future__ import annotations

import json
from typing import Callable

INDEX = "library/{w}/index.json"
ENTRY = "library/{w}/{key}/{ver}.json"
RETRIES = 5


class Conflict(Exception):
    """Someone published a newer version of this key since the document's copy."""

    def __init__(self, latest: int):
        super().__init__(f"Someone published version {latest} of this key since yours. Import it first, then publish.")
        self.latest = latest


class Missing(Exception):
    """No such key or version, or an image the relay does not have."""


def _cover(refs: list[dict]) -> dict:
    front = next((r for r in refs if r["variant"] == "front"), None)
    return (front or refs[0])["asset"]


class Library:
    def __init__(self, blobs, clock_iso: Callable[[], str]):
        self.blobs, self.now = blobs, clock_iso

    def index(self, workspace: str) -> dict:
        data = self.blobs.get_json(INDEX.format(w=workspace))
        return data or {"workspace": workspace, "keys": []}

    def entry(self, workspace: str, key: str, ver: int | None = None) -> dict:
        if ver is None:
            row = next((k for k in self.index(workspace)["keys"] if k["key"] == key), None)
            if not row:
                raise Missing(f"There is no {key} in your workspace's library.")
            ver = row["ver"]
        data = self.blobs.get_json(ENTRY.format(w=workspace, key=key, ver=ver))
        if not data:
            raise Missing(f"There is no version {ver} of {key}.")
        return data

    def publish(self, workspace: str, key: str, req: dict, by: str) -> dict:
        variants = [r["variant"] for r in req["refs"]]
        if len(set(variants)) != len(variants):
            raise ValueError("Each variant can be published once.")
        for r in req["refs"]:
            upload = self.blobs.key_for_url(r["asset"]["url"])
            if not upload or not self.blobs.exists(upload):
                raise Missing(f"The image for {key}_{r['variant']} has not been uploaded.")
        for _ in range(RETRIES):
            index, etag = self.blobs.get_json_tagged(INDEX.format(w=workspace))
            index = index or {"workspace": workspace, "keys": []}
            row = next((k for k in index["keys"] if k["key"] == key), None)
            latest = row["ver"] if row else 0
            if req["baseVer"] != latest:
                raise Conflict(latest)
            entry = {"workspace": workspace, "key": key, "ver": latest + 1, "role": req["role"], "by": by,
                     "at": self.now(), "refs": req["refs"]}
            new_row = {"key": key, "ver": entry["ver"], "role": entry["role"], "by": by, "at": entry["at"],
                       "variants": variants, "cover": _cover(req["refs"])}
            index["keys"] = sorted([k for k in index["keys"] if k["key"] != key] + [new_row], key=lambda k: k["key"])
            # The index write claims the version; a lost race (any key) reads again.
            if self.blobs.put_json_if(INDEX.format(w=workspace), index, etag):
                self.blobs.put(ENTRY.format(w=workspace, key=key, ver=entry["ver"]),
                               json.dumps(entry).encode(), "application/json")
                return entry
        raise Conflict(latest)
