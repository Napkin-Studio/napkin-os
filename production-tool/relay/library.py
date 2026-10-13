"""The agency library: shelves of published items shared by everyone in one agency (the tenant,
features/os-sign-in.clan), one shelf per client and 'agency' for what no client owns
(contract 3, features/contract-v3.clan; ui-behaviour 3.18, 4.8). The workspace is the tenant id.

An item is a reference key with its variants (kind key), a brand kit (kind brand_kit) or a client's
own format pack (kind format_pack). Its versions are immutable JSON files; one index per shelf lists
the latest of each. Both live in the relay's bucket, so there is no table to run:

  tenants/<tenantId>/library/<shelf>/index.json          LibraryIndex, written with If-Match on its ETag (claims a version)
  tenants/<tenantId>/library/<shelf>/<key>/<ver>.json    LibraryEntry, written once the index names it

Publishing names the version the document holds (baseVer). When the index already has a newer one
someone else published first, the publish is a conflict, never an overwrite. Images are not copied:
a ref points at the content-addressed upload (in/sha256:…), which nothing deletes. The hackathon's
library/<workspace>/ and os-sign-in's unshelved tenants/<t>/library/index.json are left as they are.
"""

from __future__ import annotations

import json
import re
from typing import Callable

INDEX = "tenants/{w}/library/{shelf}/index.json"
ENTRY = "tenants/{w}/library/{shelf}/{key}/{ver}.json"
SHELF = re.compile(r"^[a-z0-9][a-z0-9_-]{0,63}$")
AGENCY = "agency"
RETRIES = 5


class Conflict(Exception):
    """Someone published a newer version of this item since the document's copy."""

    def __init__(self, latest: int, by: str | None = None):
        who = f"{by} published" if by else "Someone published"
        super().__init__(f"{who} version {latest} a moment ago. Import it first, then publish yours as version {latest + 1}.")
        self.latest = latest


class Missing(Exception):
    """No such item or version, or an image the relay does not have."""


def _cover(refs: list[dict]) -> dict:
    front = next((r for r in refs if r["variant"] == "front"), None)
    return (front or refs[0])["asset"]


def _assets(node) -> list[dict]:
    """Every assetRef inside a payload (a brand kit's logos, fonts)."""
    if isinstance(node, dict):
        if {"sha256", "url", "mime"} <= node.keys():
            return [node]
        return [a for v in node.values() for a in _assets(v)]
    if isinstance(node, list):
        return [a for v in node for a in _assets(v)]
    return []


class Library:
    def __init__(self, blobs, clock_iso: Callable[[], str]):
        self.blobs, self.now = blobs, clock_iso

    def index(self, workspace: str, shelf: str) -> dict:
        data = self.blobs.get_json(INDEX.format(w=workspace, shelf=shelf))
        return data or {"workspace": workspace, "shelf": shelf, "keys": []}

    def entry(self, workspace: str, shelf: str, key: str, ver: int | None = None) -> dict:
        if ver is None:
            row = next((k for k in self.index(workspace, shelf)["keys"] if k["key"] == key), None)
            if not row:
                raise Missing(f"There is no {key} on this shelf of your agency's library.")
            ver = row["ver"]
        data = self.blobs.get_json(ENTRY.format(w=workspace, shelf=shelf, key=key, ver=ver))
        if not data:
            raise Missing(f"There is no version {ver} of {key}.")
        return data

    def publish(self, workspace: str, shelf: str, key: str, req: dict, by: str) -> dict:
        kind = req["kind"]
        refs = req.get("refs") or []
        variants = [r["variant"] for r in refs]
        if len(set(variants)) != len(variants):
            raise ValueError("Each variant can be published once.")
        for a in [r["asset"] for r in refs] + _assets(req.get("payload")):
            upload = self.blobs.key_for_url(a["url"])
            if not upload or not self.blobs.exists(upload):
                raise Missing(f"A file of {key} has not been uploaded.")
        for _ in range(RETRIES):
            path = INDEX.format(w=workspace, shelf=shelf)
            index, etag = self.blobs.get_json_tagged(path)
            index = index or {"workspace": workspace, "shelf": shelf, "keys": []}
            row = next((k for k in index["keys"] if k["key"] == key), None)
            latest = row["ver"] if row else 0
            if req["baseVer"] != latest:
                raise Conflict(latest, row.get("by") if row else None)
            if row and row.get("kind", "key") != kind:
                raise ValueError(f"{key} on this shelf is a {row.get('kind', 'key')}, not a {kind}.")
            entry = {"workspace": workspace, "shelf": shelf, "kind": kind, "key": key, "ver": latest + 1,
                     "by": by, "at": self.now()}
            new_row = {"key": key, "kind": kind, "ver": entry["ver"], "by": by, "at": entry["at"]}
            if kind == "key":
                entry.update(role=req["role"], refs=refs)
                new_row.update(role=req["role"], variants=variants, cover=_cover(refs))
            else:
                entry["payload"] = req["payload"]
            index["keys"] = sorted([k for k in index["keys"] if k["key"] != key] + [new_row], key=lambda k: k["key"])
            # The index write claims the version; a lost race (any key) reads again.
            if self.blobs.put_json_if(path, index, etag):
                self.blobs.put(ENTRY.format(w=workspace, shelf=shelf, key=key, ver=entry["ver"]),
                               json.dumps(entry).encode(), "application/json")
                return entry
        raise Conflict(latest)
