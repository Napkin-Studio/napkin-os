#!/usr/bin/env python3
"""
cannes_removal.py - plan and carry out the removal of Cannes Lions material (feature cannes-removal).

Decision of record: docs/napkin-os-build-prompt-v3.1.md section 8 (Laurence, 10 Nov 2026).
Cannes Lions material stays out of every model and every retrieval. A PERSON approves and runs
the removal, store by store, following docs/runbooks/cannes-removal.md. An agent never runs
`remove` against real data.

  python cannes_removal.py plan   [--engine-root DIR] [--index DIR ...] [--qdrant --collection NAME ...]
  python cannes_removal.py remove [same options] --approved-by "Full Name" --log FILE [--execute]

`plan` only lists. It prints names, counts and sizes, never content, and changes nothing.
`remove` is also a plan until `--execute` is given together with `--approved-by` and `--log`.
With `--execute` it deletes, in this order, and records counts before and after in the log:
  1. rows whose `source` is `cannes` from each local index (chunks.jsonl rewritten, manifest updated)
  2. points whose `source` is `cannes` from each named Qdrant collection (delete by filter)
  3. the raw export and the generated markdown folders under engine/reference/
It never touches: S3 objects or versions, Qdrant snapshots, the tracked files a person must review
(listed by `plan` under "review by a person"), or any Effie / WARC / award workbook file. Those are
runbook steps for a person. `plan` lists Effie and award files by name and size only, as a report.

To count rows, the local-index step parses each row and reads only its `source` field; nothing
else is printed or kept. Qdrant is asked for counts and a delete by filter, never for passages.
"""
from __future__ import annotations

import argparse
import datetime as _dt
import json
import shutil
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
ENGINE = HERE.parent
SOURCE = "cannes"

# Paths under the engine root, relative. Removal targets (generated or raw, untracked).
RAW_EXPORT = "reference/_raw/cannes.json"
RAG_DIRS = ("reference/rag/cannes", "reference/rag_test/cannes")
# Tracked files a person reviews and decides on (kept, redacted or removed). Never removed here.
REVIEW_FILES = (
    "packs_dist/cannes",
    "rag/packs.lock",
    "rag/golden/labels/pairs.jsonl",
    "rag/golden/labels/prelabels.jsonl",
    "rag/golden/remeasure_2026-09-23/eval_ipa_cannes_playbook_500.json",
    "eval/baselines/v2-grounded-postrefactor.json",
    "rag/calibration/local.json",
    "rag/calibration/nemotron.json",
    "deck/rubric.json",
    "reference/awardlib/brand_categories.json",
)
# Reported by name and size only, for the owner's decision. Never listed for removal.
REPORT_ONLY = (
    "reference/_raw/effie.csv",
    "reference/_raw/effie.json",
    "reference/rag/effie",
    "reference/_raw/awardlib/cases.xlsx",
    "reference/rag/awardlib",
)


def _size(path: Path) -> tuple[int, int]:
    """(file count, bytes) for a file or a folder; (0, 0) when absent."""
    if path.is_file():
        return 1, path.stat().st_size
    if path.is_dir():
        files = [p for p in path.rglob("*") if p.is_file()]
        return len(files), sum(p.stat().st_size for p in files)
    return 0, 0


def default_indexes(engine_root: Path) -> list[Path]:
    rag = engine_root / "rag"
    found = sorted(p for p in rag.glob("_index*") if p.is_dir())
    if (rag / "index").is_dir():
        found.append(rag / "index")
    return found


def count_local(index_dir: Path) -> tuple[int, int]:
    """(rows, rows with source cannes) in index_dir/chunks.jsonl. Reads only `source`."""
    path = index_dir / "chunks.jsonl"
    total = hits = 0
    if not path.exists():
        return 0, 0
    with open(path, encoding="utf-8") as fh:
        for line in fh:
            if not line.strip():
                continue
            total += 1
            if json.loads(line).get("source") == SOURCE:
                hits += 1
    return total, hits


def remove_local(index_dir: Path) -> tuple[int, int]:
    """Rewrite chunks.jsonl without cannes rows. Returns (removed, kept). Atomic; no backup is
    kept, because a backup would keep the material."""
    path = index_dir / "chunks.jsonl"
    tmp = path.with_suffix(".jsonl.tmp")
    kept = removed = 0
    with open(path, encoding="utf-8") as src, open(tmp, "w", encoding="utf-8") as out:
        for line in src:
            if not line.strip():
                continue
            if json.loads(line).get("source") == SOURCE:
                removed += 1
            else:
                out.write(line if line.endswith("\n") else line + "\n")
                kept += 1
    tmp.replace(path)
    man = index_dir / "manifest.json"
    if man.exists():
        try:
            data = json.loads(man.read_text())
            data["chunks"] = kept
            man.write_text(json.dumps(data, indent=2))
        except json.JSONDecodeError:
            pass
    return removed, kept


def _qdrant_req(method, path, body=None):
    sys.path.insert(0, str(HERE))
    import store_qdrant
    return store_qdrant._req(method, path, body, timeout=120)


def qdrant_count(collection: str, req=_qdrant_req) -> int:
    body = {"exact": True, "filter": {"must": [{"key": "source", "match": {"value": SOURCE}}]}}
    r = req("POST", f"/collections/{collection}/points/count", body)
    return int((r.get("result") or {}).get("count") or 0)


def qdrant_delete(collection: str, req=_qdrant_req) -> None:
    body = {"filter": {"must": [{"key": "source", "match": {"value": SOURCE}}]}}
    req("POST", f"/collections/{collection}/points/delete?wait=true", body)


def build_plan(engine_root: Path, indexes: list[Path], collections: list[str], req=_qdrant_req) -> dict:
    plan: dict = {"local_indexes": [], "files": [], "review": [], "report_only": [], "qdrant": []}
    for d in indexes:
        total, hits = count_local(d)
        n, size = _size(d / "chunks.jsonl")
        plan["local_indexes"].append({"path": str(d), "rows": total, "cannes_rows": hits, "bytes": size})
    for rel in (RAW_EXPORT, *RAG_DIRS):
        n, size = _size(engine_root / rel)
        plan["files"].append({"path": rel, "files": n, "bytes": size})
    for rel in REVIEW_FILES:
        n, size = _size(engine_root / rel)
        plan["review"].append({"path": rel, "files": n, "bytes": size})
    for rel in REPORT_ONLY:
        n, size = _size(engine_root / rel)
        plan["report_only"].append({"path": rel, "files": n, "bytes": size})
    for c in collections:
        plan["qdrant"].append({"collection": c, "cannes_points": qdrant_count(c, req)})
    return plan


def print_plan(plan: dict, out=print) -> None:
    out("DRY RUN: names, counts and sizes only. Nothing is read for content and nothing is changed.")
    out("\nLocal indexes (rows with source cannes):")
    for e in plan["local_indexes"] or [{"path": "(none found)", "rows": 0, "cannes_rows": 0, "bytes": 0}]:
        out(f"  {e['path']}: {e['cannes_rows']} of {e['rows']} rows, chunks.jsonl {e['bytes']} B")
    out("\nQdrant collections (points with source cannes):")
    for e in plan["qdrant"] or [{"collection": "(none named; pass --qdrant --collection NAME)", "cannes_points": 0}]:
        out(f"  {e['collection']}: {e['cannes_points']} points")
    out("\nFiles this tool would delete:")
    for e in plan["files"]:
        state = "absent" if not e["files"] else f"{e['files']} file(s), {e['bytes']} B"
        out(f"  {e['path']}: {state}")
    out("\nTracked or derived files to review by a person (this tool never removes these):")
    for e in plan["review"]:
        state = "absent" if not e["files"] else f"{e['files']} file(s), {e['bytes']} B"
        out(f"  {e['path']}: {state}")
    out("\nReport only, for the owner (Effie, award library; this tool never removes these):")
    for e in plan["report_only"]:
        state = "absent" if not e["files"] else f"{e['files']} file(s), {e['bytes']} B"
        out(f"  {e['path']}: {state}")
    out("\nNot handled here, a person does these by hand (runbook): S3 corpus objects and versions,")
    out("S3 backups, Qdrant snapshots, the RAG host disk, other people's machines, packs.lock regeneration.")


def execute(engine_root, indexes, collections, approved_by, log_path, req=_qdrant_req, now=None) -> dict:
    """Delete, then verify. Returns the log dict (also written to log_path)."""
    log = {"approved_by": approved_by,
           "at": (now or _dt.datetime.now(_dt.timezone.utc)).isoformat(),
           "local_indexes": [], "qdrant": [], "files": []}
    for d in indexes:
        _, before = count_local(d)
        removed, kept = remove_local(d) if (d / "chunks.jsonl").exists() else (0, 0)
        _, after = count_local(d)
        log["local_indexes"].append({"path": str(d), "before": before, "removed": removed, "kept": kept, "after": after})
    for c in collections:
        before = qdrant_count(c, req)
        qdrant_delete(c, req)
        after = qdrant_count(c, req)
        log["qdrant"].append({"collection": c, "before": before, "after": after})
    for rel in (RAW_EXPORT, *RAG_DIRS):
        p = engine_root / rel
        n, size = _size(p)
        if p.is_file():
            p.unlink()
        elif p.is_dir():
            shutil.rmtree(p)
        log["files"].append({"path": rel, "files_removed": n, "bytes_removed": size, "exists_after": p.exists()})
    Path(log_path).write_text(json.dumps(log, indent=2) + "\n")
    ok = all(e["after"] == 0 for e in log["local_indexes"] + log["qdrant"]) and \
        not any(e["exists_after"] for e in log["files"])
    log["verified_zero"] = ok
    Path(log_path).write_text(json.dumps(log, indent=2) + "\n")
    return log


def main(argv=None, req=_qdrant_req) -> int:
    ap = argparse.ArgumentParser(prog="cannes_removal", description=__doc__.split("\n\n")[0])
    sub = ap.add_subparsers(dest="cmd", required=True)
    for name in ("plan", "remove"):
        sp = sub.add_parser(name)
        sp.add_argument("--engine-root", type=Path, default=ENGINE)
        sp.add_argument("--index", type=Path, action="append", default=None,
                        help="a local index folder (repeat). Default: rag/_index*, rag/index")
        sp.add_argument("--qdrant", action="store_true", help="include Qdrant (needs QDRANT_URL)")
        sp.add_argument("--collection", action="append", default=[], help="a Qdrant collection (repeat)")
        if name == "remove":
            sp.add_argument("--approved-by", default="", help="the person who approved this removal")
            sp.add_argument("--log", type=Path, default=None, help="where to write the counts record")
            sp.add_argument("--execute", action="store_true", help="really delete (default is a dry run)")
    a = ap.parse_args(argv)
    if a.qdrant and not a.collection:
        ap.error("--qdrant needs at least one --collection NAME")
    collections = a.collection if a.qdrant else []
    root = a.engine_root.resolve()
    indexes = [p.resolve() for p in a.index] if a.index is not None else default_indexes(root)
    if a.cmd == "remove" and a.execute:
        if not a.approved_by.strip() or a.log is None:
            ap.error("--execute needs --approved-by NAME and --log FILE")
        log = execute(root, indexes, collections, a.approved_by.strip(), a.log, req)
        print(f"Removed. Counts recorded in {a.log}. verified_zero={log['verified_zero']}")
        return 0 if log["verified_zero"] else 1
    print_plan(build_plan(root, indexes, collections, req))
    if a.cmd == "remove":
        print("\nNo --execute: nothing was deleted.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
