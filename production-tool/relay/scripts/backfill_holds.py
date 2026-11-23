#!/usr/bin/env python3
"""Index past job outputs for their agencies, so GET /assets/{sha256} serves them (features/production-spinoff.clan).

Before the fix, a picture the relay cropped to the job's frame shape (a new hash) was never recorded as held by
the agency that asked for it, so the assets route answered 404 for it. This reads every job record and, for each
completed job with a tenant, writes the missing has#<tenant>#<sha256> row for every hash its outputs name.
It writes nothing else. A DRY RUN by default; pass --yes to write. Safe to run again: a row already there is
skipped. It never makes, moves or deletes a picture.

  AWS_PROFILE=napkin JOBS_TABLE=napkin-hackathon-jobs QUOTAS_TABLE=napkin-hackathon-quotas BLOCKED_TABLE=napkin-hackathon-blocked \\
    uv run --frozen --python 3.12 python scripts/backfill_holds.py            # dry run
  ... python scripts/backfill_holds.py --tenant <tenant id> --yes             # write, one agency
"""

from __future__ import annotations

import argparse
import os
import sys
from pathlib import Path

RELAY = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(RELAY))

from service import output_shas  # noqa: E402


def backfill(store, tenant: str | None = None, apply: bool = False) -> dict:
    """Walk the jobs; hold what is missing. Returns counts and the (tenant, sha) pairs missing."""
    seen: set[tuple[str, str]] = set()
    missing: list[tuple[str, str]] = []
    jobs = 0
    for job in store.all_jobs():
        t = job.get("_tenant")
        if not t or job.get("state") != "completed" or (tenant and t != tenant):
            continue
        jobs += 1
        for sha in output_shas(job.get("outputs")):
            if (t, sha) in seen:
                continue
            seen.add((t, sha))
            if not store.holds(t, sha):
                missing.append((t, sha))
                if apply:
                    store.hold(t, sha)
    return {"jobs": jobs, "hashes": len(seen), "missing": missing, "written": len(missing) if apply else 0}


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--tenant", help="only this agency's tenant id")
    ap.add_argument("--yes", action="store_true", help="write the rows (otherwise a dry run)")
    args = ap.parse_args(argv)
    missing = [k for k in ("JOBS_TABLE", "QUOTAS_TABLE") if not os.environ.get(k)]
    if missing:
        sys.exit(f"set {', '.join(missing)} (the relay's own names)")
    from store import DynamoStore

    store = DynamoStore(os.environ["JOBS_TABLE"], os.environ["QUOTAS_TABLE"], os.environ.get("BLOCKED_TABLE", ""))
    r = backfill(store, args.tenant, args.yes)
    for t, sha in r["missing"]:
        print(("held " if args.yes else "would hold ") + f"{t} {sha}")
    print(f"{r['jobs']} completed jobs, {r['hashes']} output hashes, {len(r['missing'])} not held, {r['written']} written"
          + ("" if args.yes else " (dry run: pass --yes to write)"))
    return 0


if __name__ == "__main__":
    sys.exit(main())
