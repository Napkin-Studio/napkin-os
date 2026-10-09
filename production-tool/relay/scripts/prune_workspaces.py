#!/usr/bin/env python3
"""Remove people's workspaces after an event (features/personal-workspaces.clan).

Run it by hand, and only once the event's data has been studied: nothing expires on its own.
A DRY RUN by default: it lists every object, job record and counter it would delete, and writes
the same as a JSON report. Pass --yes to delete.

Which workspaces:
  --name Maya [--name Sam …]   a name as people sign in with it (any case): its participant's workspace
  --workspace ID [...]         a workspace by its id: a participant id (p_…), or a team library left
                               from before personal workspaces (library/event/, library/acme/)
  --all                        every workspace in the stores
  --before YYYY-MM-DD          only workspaces with nothing saved, published or made on or after that
                               day (UTC); a workspace with anything newer is kept whole

What goes, for each chosen workspace:
  clan/<pid>/…        its saved projects, every timed copy, latest.clan, canvases, projects.json
  library/<pid>/…     its library (index and every version)
  jobs                its job records (DynamoDB jobs table)
  quotas              its counters: <pid>#<day>, inflight#<pid>, slots#<provider>#own#<pid>#<class>
  in/ out/ cards/     every upload, result and character card its projects, library or jobs use,
                      unless a workspace that stays uses the same picture (counted by sha256 across
                      every remaining project copy, library version and job)
  ads/<jobId>.*       the stitched ads of its jobs, unless a remaining workspace uses the same ad
With --all, uploads and results nobody remaining uses go too, even ones no project names (with
--before, only those last written before that day). The shared counters (spend, the event's slots)
and the blocked list are never touched. A workspace with a job still running is skipped.

Where:
  AWS (default): the relay's own stores and environment: BUCKET, JOBS_TABLE, QUOTAS_TABLE (and
                 AWS_PROFILE / AWS_REGION, credentials from the environment), e.g.
                   AWS_PROFILE=napkin BUCKET=… JOBS_TABLE=… QUOTAS_TABLE=… \\
                     uv run --frozen --python 3.12 python scripts/prune_workspaces.py --all
  --local [DIR]: the dev server's files (default relay/.local-data). Its jobs live in memory, so
                 there are none to delete.

    uv run --frozen --python 3.12 python scripts/prune_workspaces.py --name Maya            # dry run
    uv run --frozen --python 3.12 python scripts/prune_workspaces.py --name Maya --yes      # delete
    uv run --frozen --python 3.12 python scripts/prune_workspaces.py --all --before 2026-10-20 --yes

The report (--report, default prune-report-<UTC time>.json here) names every workspace chosen and
kept, everything deleted (or that would be), and each shared picture kept and why.
"""

from __future__ import annotations

import argparse
import io
import json
import os
import re
import sys
import zipfile
from datetime import datetime, timezone
from pathlib import Path

HERE = Path(__file__).resolve().parent
RELAY = HERE.parent
sys.path.insert(0, str(RELAY))

from service import TERMINAL, participant_id  # noqa: E402

SHA = re.compile(rb"sha256:([0-9a-f]{64})")
ASSET_PREFIXES = ("in/", "out/", "cards/", "ads/")


def shas_in(data: bytes) -> set[str]:
    """Every sha256:<hex> named anywhere in a saved .clan (each zip entry, decompressed) or a JSON."""
    found = set(SHA.findall(data))
    if data.startswith(b"PK\x03\x04"):
        try:
            with zipfile.ZipFile(io.BytesIO(data)) as z:
                for name in z.namelist():
                    found |= set(SHA.findall(z.read(name)))
        except (zipfile.BadZipFile, OSError, ValueError):
            pass  # what the raw bytes name is all we can read
    return {h.decode() for h in found}


def workspace_of_key(key: str) -> str | None:
    parts = key.split("/")
    return parts[1] if len(parts) > 2 and parts[0] in ("clan", "library") else None


def counter_owner(key: str) -> str | None:
    """The participant a quota counter belongs to, or None for the event's own (spend, slots)."""
    if key.startswith("inflight#"):
        return key[len("inflight#"):]
    if key.startswith("slots#"):
        parts = key.split("#")  # slots#<provider>#own#<pid>#<class>
        return parts[3] if len(parts) == 5 and parts[2] == "own" else None
    if key.startswith("p_") and "#" in key:
        return key.split("#", 1)[0]
    return None


def asset_hex(key: str) -> str | None:
    """The picture an in/, out/ or cards/ key holds."""
    m = re.match(r"^(?:in|out)/sha256:([0-9a-f]{64})$", key) or re.match(r"^cards/([0-9a-f]{64})\.json$", key)
    return m.group(1) if m else None


def plan(blobs, store, *, workspaces: set[str] | None, before: str | None) -> dict:
    """What a prune would delete. workspaces None: all of them. before: YYYY-MM-DD."""
    ws_keys: dict[str, list[dict]] = {}
    for row in blobs.list_keys("clan/") + blobs.list_keys("library/"):
        w = workspace_of_key(row["key"])
        if w:
            ws_keys.setdefault(w, []).append(row)
    jobs = store.all_jobs() if store else []
    ws_jobs: dict[str, list[dict]] = {}
    for j in jobs:
        ws_jobs.setdefault(j["participantId"], []).append(j)
    every = set(ws_keys) | set(ws_jobs)

    def last(w: str) -> str:
        times = [r["modified"] for r in ws_keys.get(w, [])]
        times += [j.get("updatedAt") or j["createdAt"] for j in ws_jobs.get(w, [])]
        return max(times) if times else ""

    asked = every if workspaces is None else workspaces
    chosen, skipped = [], []
    for w in sorted(asked):
        if w not in every:
            skipped.append({"workspace": w, "why": "nothing stored"})
        elif before and last(w) >= before:
            skipped.append({"workspace": w, "why": f"has something from {last(w)}, on or after {before}"})
        elif any(j["state"] not in TERMINAL for j in ws_jobs.get(w, [])):
            skipped.append({"workspace": w, "why": "a job is still running"})
        else:
            chosen.append(w)
    gone = set(chosen)
    staying = every - gone

    def refs_of(ws: set[str]) -> dict[str, list[str]]:
        """sha hex -> where it is named (a key or a job), across these workspaces."""
        out: dict[str, list[str]] = {}
        for w in ws:
            for row in ws_keys.get(w, []):
                if row["key"].endswith((".clan", ".json")):
                    for h in shas_in(blobs.get(row["key"]) or b""):
                        out.setdefault(h, []).append(row["key"])
            for j in ws_jobs.get(w, []):
                for h in shas_in(json.dumps(j).encode()):
                    out.setdefault(h, []).append(f"job {j['jobId']}")
        return out

    used_by_gone, used_by_staying = refs_of(gone), refs_of(staying)
    assets = {r["key"]: r for p in ASSET_PREFIXES for r in blobs.list_keys(p)}

    objects = sorted(r["key"] for w in chosen for r in ws_keys.get(w, []))
    shared: dict[str, list[str]] = {}
    for key, row in assets.items():
        h = asset_hex(key)
        if h is None:
            continue
        orphan = workspaces is None and (not before or row["modified"] < before)
        if h not in used_by_gone and not orphan:
            continue
        if h in used_by_staying:
            shared[h] = sorted(set(used_by_staying[h]))[:5]
            continue
        objects.append(key)
    # Stitched ads belong to the job that made them: they go with it, unless a remaining workspace uses the ad.
    gone_jobs = [j for w in chosen for j in ws_jobs.get(w, [])]
    for j in gone_jobs:
        result = blobs.get(f"ads/{j['jobId']}.json")
        sha = ""
        if result:
            try:
                sha = json.loads(result).get("sha256", "").removeprefix("sha256:")
            except ValueError:
                pass
        if sha and sha in used_by_staying:
            shared[sha] = sorted(set(used_by_staying[sha]))[:5]
            continue
        objects += [k for k in (f"ads/{j['jobId']}.mp4", f"ads/{j['jobId']}.json") if k in assets]
    if workspaces is None:  # --all: ads nobody remaining uses, whoever made them
        for key, row in assets.items():
            m = re.match(r"^ads/(.+)\.(mp4|json)$", key)
            if not m or key in objects or (before and row["modified"] >= before):
                continue
            owner = next((j for j in jobs if j["jobId"] == m.group(1)), None)
            if owner and owner["participantId"] in staying:
                continue
            objects.append(key)
    counters = [k for k in (store.counter_keys() if store else []) if counter_owner(k) in gone]
    size = sum((assets.get(k) or {}).get("bytes", 0) for k in objects)
    size += sum(r["bytes"] for w in chosen for r in ws_keys.get(w, []))
    return {
        "chosen": [{"workspace": w, "lastActivity": last(w)} for w in chosen],
        "skipped": skipped,
        "remaining": sorted(staying),
        "delete": {"objects": sorted(set(objects)), "jobs": sorted(j["jobId"] for j in gone_jobs), "counters": counters},
        "keptShared": [{"sha256": f"sha256:{h}", "usedBy": where} for h, where in sorted(shared.items())],
        "bytes": size,
    }


def apply(blobs, store, p: dict) -> None:
    blobs.delete(p["delete"]["objects"])
    for job_id in p["delete"]["jobs"]:
        store.delete_job(job_id)
    for key in p["delete"]["counters"]:
        store.delete_counter(key)


def stores(args):
    """The blob store and the job store: the relay's AWS ones from its environment, or the dev server's files."""
    if args.local is not None:
        from blobs import LocalBlobs

        root = Path(args.local or RELAY / ".local-data")
        if not root.exists():
            sys.exit(f"no local data at {root}")
        return LocalBlobs(root, "http://localhost"), None, f"local:{root}"
    from blobs import S3Blobs
    from store import DynamoStore

    missing = [k for k in ("BUCKET", "JOBS_TABLE", "QUOTAS_TABLE") if not os.environ.get(k)]
    if missing:
        sys.exit(f"set {', '.join(missing)} (the relay's own names), or pass --local")
    blobs = S3Blobs(os.environ["BUCKET"], os.environ.get("PUBLIC_BASE_URL", ""))
    store = DynamoStore(os.environ["JOBS_TABLE"], os.environ["QUOTAS_TABLE"], os.environ.get("BLOCKED_TABLE", ""))
    return blobs, store, f"s3://{os.environ['BUCKET']} + {os.environ['JOBS_TABLE']}, {os.environ['QUOTAS_TABLE']}"


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0], formatter_class=argparse.RawDescriptionHelpFormatter)
    who = ap.add_mutually_exclusive_group(required=True)
    who.add_argument("--name", action="append", help="a name as people sign in with it (repeat for more)")
    who.add_argument("--workspace", action="append", help="a workspace id: p_… or an old team library (event)")
    who.add_argument("--all", action="store_true", help="every workspace")
    ap.add_argument("--before", help="only workspaces with nothing on or after this day (YYYY-MM-DD, UTC)")
    ap.add_argument("--yes", action="store_true", help="delete (otherwise a dry run)")
    ap.add_argument("--local", nargs="?", const="", default=None, metavar="DIR", help="the dev server's files instead of AWS")
    ap.add_argument("--report", help="where to write the JSON report")
    args = ap.parse_args(argv)
    if args.before:
        try:
            datetime.strptime(args.before, "%Y-%m-%d")
        except ValueError:
            ap.error("--before is YYYY-MM-DD")
    blobs, store, where = stores(args)
    names = {participant_id(n): n for n in args.name or []}
    targets = None if args.all else (set(names) | set(args.workspace or []))
    p = plan(blobs, store, workspaces=targets, before=args.before)

    now = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    for c in p["chosen"]:
        if c["workspace"] in names:
            c["name"] = names[c["workspace"]]
    report = {"at": now, "dryRun": not args.yes, "store": where, "asked": sorted(targets) if targets else "all",
              "before": args.before, **p}
    verb = "Deleting" if args.yes else "Would delete"
    print(f"{'DELETE' if args.yes else 'DRY RUN'} on {where}")
    for c in p["chosen"]:
        print(f"  workspace {c['workspace']}{' (' + c['name'] + ')' if c.get('name') else ''}, last activity {c['lastActivity']}")
    for s in p["skipped"]:
        print(f"  kept {s['workspace']}: {s['why']}")
    d = p["delete"]
    print(f"{verb} {len(d['objects'])} objects ({p['bytes']} bytes), {len(d['jobs'])} job records, {len(d['counters'])} counters:")
    for k in d["objects"]:
        print(f"  object  {k}")
    for k in d["jobs"]:
        print(f"  job     {k}")
    for k in d["counters"]:
        print(f"  counter {k}")
    for s in p["keptShared"]:
        print(f"  kept {s['sha256']}: still used by {', '.join(s['usedBy'])}")
    if args.yes:
        apply(blobs, store, p)
    out = Path(args.report or f"prune-report-{now.replace(':', '')}.json")
    out.write_text(json.dumps(report, indent=2) + "\n")
    print(f"report: {out}{'' if args.yes else '   (nothing deleted: pass --yes to delete)'}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
