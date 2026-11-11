"""Backfill the source records a research document's pins cite but the document does not hold.

Before identify carried the roster's source records (feature research-new-ui), a
roster pin could cite a `src_` id with no record in shared/sources.yaml: the
"src_... not in the document" box. This finds every `src_` id the document's facts
cite with no record, asks the knowledge layers for it (GET /v1/layers/sources, then
the pin's own layer row by its fact:// address), and adds what it finds:

  - the record to shared/sources.yaml, as the middleware writes it now
    (napkin.layers.layer_source_record: origin_kind "layer");
  - its copy to the projection (projection.sources and built_from.sources_sha256),
    through `clan patch-data --agent claude --action ...`, which records the change.

An id the layers do not know is left as it is and reported. Running it again
changes nothing. With --dry-run it only says what it would add.

    cd server && uv run --with pyyaml python scripts/repair_sources.py --org org/dev-agency --brand brand/dev-brand \\
        [--layers-url http://127.0.0.1:18797] [--dry-run] DOC.clan [DOC.clan ...]

--layers-url defaults to NAPKIN_LAYERS_URL. The scope (--org, --brand) is the one the
document's research ran under; a client-confidential record is only given to its org.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import subprocess
import sys
import zipfile
from pathlib import Path

import httpx
import yaml

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from napkin.layers import SOURCE_FIELDS, layer_source_record  # noqa: E402

FACTS, SOURCES, MANIFEST = "shared/facts.yaml", "shared/sources.yaml", "manifest.yaml"


def sha(b: bytes) -> str:
    return "sha256:" + hashlib.sha256(b).hexdigest()


def read(path: Path) -> dict[str, bytes]:
    with zipfile.ZipFile(path) as z:
        return {n: z.read(n) for n in z.namelist()}


def missing_ids(files: dict[str, bytes]) -> tuple[list[str], dict[str, list[dict]]]:
    """(cited src_ ids with no record, in first-cited order; the facts citing each)."""
    facts = (yaml.safe_load(files.get(FACTS) or b"") or {}).get("facts") or []
    held = {s.get("id") for s in (yaml.safe_load(files.get(SOURCES) or b"") or {}).get("sources") or []}
    by: dict[str, list[dict]] = {}
    for f in facts:
        for sid in f.get("sources") or []:
            if str(sid).startswith("src_") and sid not in held:
                by.setdefault(sid, []).append(f)
    return list(by), by


class LayersClient:
    def __init__(self, url: str, org: str, brand: str):
        self.url = url.rstrip("/")
        self.h = {"X-Napkin-Org": org, "X-Napkin-Brand": brand, "X-Napkin-Handler": "repair_sources",
                  "X-Napkin-Job": "-"}
        self.c = httpx.Client(timeout=20)

    def sources(self, ids: list[str]) -> dict[str, dict]:
        r = self.c.get(f"{self.url}/v1/layers/sources", params={"ids": ",".join(ids)}, headers=self.h)
        r.raise_for_status()
        return {s["id"]: s for s in r.json().get("sources") or [] if isinstance(s, dict) and s.get("id")}

    def row(self, uri: str) -> dict | None:
        r = self.c.get(f"{self.url}/v1/layers/facts/by-uri", params={"uri": uri}, headers=self.h)
        if r.status_code == 404:
            return None
        r.raise_for_status()
        return r.json().get("fact")


def find_records(client: LayersClient, ids: list[str], citing: dict[str, list[dict]]) -> dict[str, dict]:
    found = {sid: rec for sid, s in client.sources(ids).items() if (rec := layer_source_record(s))}
    for sid in [s for s in ids if s not in found]:
        for f in citing[sid]:  # the pin's own layer row carries the records it cites
            o = f.get("origin")
            row = client.row(o) if isinstance(o, str) and o.startswith("fact://") else None
            r = next((x for x in (row or {}).get("source_records") or [] if x.get("id") == sid), None)
            if r and (rec := layer_source_record(r)):
                found[sid] = rec
                break
    return found


def write(path: Path, files: dict[str, bytes], recs: list[dict]) -> str:
    """Append the records to shared/sources.yaml (existing entries kept byte for byte) and
    re-register its hash; returns the member's new hash."""
    old = files[SOURCES]
    body = old if old.endswith(b"\n") else old + b"\n"
    new = body + yaml.safe_dump(recs, sort_keys=True, allow_unicode=True, default_flow_style=False,
                                width=10_000).encode()
    parsed = (yaml.safe_load(new) or {}).get("sources") or []
    assert [s["id"] for s in parsed][-len(recs):] == [r["id"] for r in recs], "sources.yaml did not take the records"
    man = files[MANIFEST].decode()
    assert man.count(sha(old)) == 1, "the manifest does not register shared/sources.yaml's current hash"
    files = dict(files, **{SOURCES: new, MANIFEST: man.replace(sha(old), sha(new)).encode()})
    tmp = path.with_suffix(path.suffix + ".tmp")
    with zipfile.ZipFile(path) as zin, zipfile.ZipFile(tmp, "w") as zout:
        for info in zin.infolist():
            zout.writestr(info, files[info.filename])
    tmp.replace(path)
    return sha(new)


def repair(path: Path, client: LayersClient | None, dry: bool) -> dict:
    files = read(path)
    ids, citing = missing_ids(files)
    out = {"doc": str(path), "missing": ids, "filled": [], "left": []}
    if not ids:
        return out
    if SOURCES not in files:
        out["left"] = [{"id": s, "why": "the document has no shared/sources.yaml member"} for s in ids]
        return out
    found = find_records(client, ids, citing)
    recs = [found[s] for s in ids if s in found]
    out["filled"] = recs
    out["left"] = [{"id": s, "why": "the layers hold no record of it in this scope",
                    "cited_by": [f.get("id") for f in citing[s]]} for s in ids if s not in found]
    if dry or not recs:
        return out
    new_sha = write(path, files, recs)
    patch = {"projection": {"built_from": {"sources_sha256": new_sha},
                            "sources": {r["id"]: {k: r[k] for k in SOURCE_FIELDS if k in r} for r in recs}}}
    said = ", ".join(f"{r['id']} ({r.get('title') or r['uri']})" for r in recs)
    subprocess.run(["clan", "patch-data", str(path), json.dumps(patch), "--agent", "claude", "--quiet",
                    "--action", "backfill: source records the pins cite",
                    "--rationale", f"The document's pins cited {len(recs)} source(s) it held no record of; "
                                   f"filled from the knowledge layers: {said}."], check=True)
    return out


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("docs", nargs="+", type=Path)
    ap.add_argument("--layers-url", default=os.environ.get("NAPKIN_LAYERS_URL"))
    ap.add_argument("--org", required=True)
    ap.add_argument("--brand", required=True)
    ap.add_argument("--dry-run", action="store_true")
    a = ap.parse_args(argv)
    if not a.layers_url:
        ap.error("--layers-url or NAPKIN_LAYERS_URL is required")
    client = LayersClient(a.layers_url, a.org, a.brand)
    for p in a.docs:
        r = repair(p, client, a.dry_run)
        verb = "would fill" if a.dry_run else "filled"
        print(f"{p.name}: {len(r['missing'])} cited id(s) with no record")
        for rec in r["filled"]:
            print(f"  {verb} {rec['id']}: title={rec.get('title')!r} publisher={rec.get('publisher')!r} "
                  f"uri={rec['uri']!r} tier={rec.get('tier')!r} licence={rec.get('licence')!r} "
                  f"origin_kind={rec['origin_kind']!r}")
        for x in r["left"]:
            print(f"  left {x['id']}: {x['why']}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
