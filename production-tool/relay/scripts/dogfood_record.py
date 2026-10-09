#!/usr/bin/env python3
"""Read and prune the beta's record (features/production-tool-dogfood.clan; relay/dogfood.py).

Run by a person with AWS access; there is no page for it. Nothing expires on its own.

  export   every event, folded (a run of identical events is its first line plus one repeat
           line) and in time order across people, as JSON lines; each line gains the person's
           handle (and team) from their consent record.
             --date YYYY-MM-DD   one day          --participant PID [...]   those people
             --name 'Team/Name'  as people sign in (any case and spacing; a name alone matches
                                 a record without a team)
             --raw               as stored, unfolded          --out FILE (default: stdout)
  prune    deletes the record. A DRY RUN by default: it lists what it would delete and writes the
           same as a JSON report. --yes deletes every version of every key (the bucket is
           versioned, so a plain delete would leave the data behind for 30 days).
             --all | --participant PID [...] | --name 'Team/Name' [...] | --before YYYY-MM-DD
           --before removes the days before that date for everyone and keeps consent records;
           --participant and --name remove that person's days and their consent record.
             --report FILE (default dogfood-prune-report-<UTC time>.json here)

Where:
  AWS (default): BUCKET (and AWS_PROFILE / AWS_REGION), e.g.
    AWS_PROFILE=napkin BUCKET=… uv run --frozen --python 3.12 python scripts/dogfood_record.py export --date 2026-10-20
  --local [DIR]: the dev server's files (default relay/.local-data)

prune() is importable, so a workspace prune can remove a person's record with the rest.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import unicodedata
from datetime import datetime, timezone
from pathlib import Path

HERE = Path(__file__).resolve().parent
RELAY = HERE.parent
sys.path.insert(0, str(RELAY))

from dogfood import CONSENT, EVENTS, fold_lines  # noqa: E402


def same_text(s: str) -> str:
    """One spelling for a team or a name, as the relay compares them (NFKC, case folded, one space)."""
    return " ".join(unicodedata.normalize("NFKC", s).casefold().split())


class S3Source:
    def __init__(self, bucket: str, client=None):
        import boto3

        self.bucket = bucket
        self.s3 = client or boto3.client("s3")

    def keys(self, prefix: str) -> list[str]:
        out = []
        for page in self.s3.get_paginator("list_objects_v2").paginate(Bucket=self.bucket, Prefix=prefix):
            out += [o["Key"] for o in page.get("Contents", [])]
        return out

    def get(self, key: str) -> bytes:
        return self.s3.get_object(Bucket=self.bucket, Key=key)["Body"].read()

    def delete(self, keys: list[str]) -> int:
        """Every version and delete marker of each key; the number of versions removed."""
        wanted, versions = set(keys), []
        for prefix in sorted({k.rsplit("/", 1)[0] + "/" for k in keys}):
            for page in self.s3.get_paginator("list_object_versions").paginate(Bucket=self.bucket, Prefix=prefix):
                for v in page.get("Versions", []) + page.get("DeleteMarkers", []):
                    if v["Key"] in wanted:
                        versions.append({"Key": v["Key"], "VersionId": v["VersionId"]})
        for i in range(0, len(versions), 1000):
            self.s3.delete_objects(Bucket=self.bucket, Delete={"Objects": versions[i:i + 1000], "Quiet": True})
        return len(versions)


class LocalSource:
    def __init__(self, root: Path):
        self.root = Path(root)

    def keys(self, prefix: str) -> list[str]:
        base = self.root / prefix
        if not base.exists():
            return []
        return sorted(str(p.relative_to(self.root)) for p in base.rglob("*") if p.is_file() and not p.name.endswith(".mime"))

    def get(self, key: str) -> bytes:
        return (self.root / key).read_bytes()

    def delete(self, keys: list[str]) -> int:
        for k in keys:
            for p in (self.root / k, self.root / (k + ".mime")):
                p.unlink(missing_ok=True)
        return len(keys)


def consents(src) -> dict[str, dict]:
    out = {}
    for key in src.keys(CONSENT):
        try:
            rec = json.loads(src.get(key))
        except ValueError:
            continue
        out[rec.get("participantId") or Path(key).stem] = rec
    return out


def resolve(src, pids: list[str] | None, names: list[str] | None) -> set[str]:
    """Participant ids for --participant and --name ('Team/Name', or a name alone)."""
    chosen = set(pids or [])
    for spec in names or []:
        team, _, name = spec.rpartition("/")
        for pid, rec in consents(src).items():
            if same_text(rec.get("handle") or "") != same_text(name):
                continue
            if (same_text(rec.get("team") or "") if team else "") == (same_text(team) if team else ""):
                chosen.add(pid)
    return chosen


def parts(key: str) -> tuple[str, str]:
    """(date, participant) of dogfood/events/<date>/<pid>/<file>."""
    rest = key[len(EVENTS):].split("/")
    return (rest[0], rest[1]) if len(rest) >= 3 else ("", "")


def event_keys(src, *, date=None, participants=None, before=None) -> list[str]:
    out = []
    for key in src.keys(EVENTS + (f"{date}/" if date else "")):
        day, pid = parts(key)
        if participants is not None and pid not in participants:
            continue
        if before and not day < before:
            continue
        out.append(key)
    return out


def export(src, *, date=None, participants=None, raw=False) -> list[dict]:
    people = consents(src)
    lines = []
    for key in event_keys(src, date=date, participants=participants):
        for line in src.get(key).decode().splitlines():
            if line.strip():
                lines.append(json.loads(line))
    lines = sorted(lines, key=lambda e: e.get("ts", "")) if raw else fold_lines(lines)
    for e in lines:
        rec = people.get(e.get("participant"))
        if rec:
            e["handle"] = rec.get("handle")
            if rec.get("team"):
                e["team"] = rec["team"]
    return lines


def prune(src, *, everything=False, participants=None, before=None, yes=False) -> dict:
    """What a prune deletes (and, with yes, deletes it). participants: a set of ids."""
    if everything:
        keys = src.keys(EVENTS) + src.keys(CONSENT)
    elif participants is not None:
        keys = event_keys(src, participants=participants)
        keys += [k for k in src.keys(CONSENT) if Path(k).stem in participants]
    elif before:
        keys = event_keys(src, before=before)
    else:
        raise ValueError("say what to prune: everything, participants or before")
    report = {"at": datetime.now(timezone.utc).isoformat(timespec="seconds"), "dryRun": not yes,
              "selector": {"all": everything, "participants": sorted(participants or []), "before": before},
              "keys": sorted(keys), "count": len(keys)}
    if yes and keys:
        report["versionsDeleted"] = src.delete(keys)
    return report


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--local", nargs="?", const=str(RELAY / ".local-data"), help="the dev server's data directory")
    sub = ap.add_subparsers(dest="cmd", required=True)
    ex = sub.add_parser("export")
    ex.add_argument("--date")
    ex.add_argument("--participant", nargs="+")
    ex.add_argument("--name", nargs="+")
    ex.add_argument("--raw", action="store_true")
    ex.add_argument("--out")
    pr = sub.add_parser("prune")
    which = pr.add_mutually_exclusive_group(required=True)
    which.add_argument("--all", action="store_true")
    which.add_argument("--participant", nargs="+")
    which.add_argument("--name", nargs="+")
    which.add_argument("--before")
    pr.add_argument("--yes", action="store_true")
    pr.add_argument("--report")
    a = ap.parse_args(argv)

    src = LocalSource(Path(a.local)) if a.local else S3Source(os.environ["BUCKET"])
    if a.cmd == "export":
        people = resolve(src, a.participant, a.name) if (a.participant or a.name) else None
        text = "".join(json.dumps(e, ensure_ascii=False) + "\n" for e in export(src, date=a.date, participants=people, raw=a.raw))
        if a.out:
            Path(a.out).write_text(text)
        else:
            sys.stdout.write(text)
        return 0
    people = resolve(src, a.participant, a.name) if (a.participant or a.name) else None
    if people is not None and not people:
        print("No one matches.", file=sys.stderr)
        return 1
    report = prune(src, everything=a.all, participants=people, before=a.before, yes=a.yes)
    path = Path(a.report or f"dogfood-prune-report-{datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ')}.json")
    path.write_text(json.dumps(report, indent=2) + "\n")
    verb = "Deleted" if a.yes else "Would delete (dry run; --yes to delete)"
    print(f"{verb} {report['count']} objects. Report: {path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
