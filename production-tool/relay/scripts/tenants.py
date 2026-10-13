#!/usr/bin/env python3
"""Turn the Production Tool on or off for an agency (features/os-sign-in.clan).

The relay serves only agencies whose item in the tenants table says enabled: true. Everyone else
gets "The Production Tool is not on for your agency yet." The relay only reads the table; this
script writes it, run by a person with their own credentials:

    AWS_PROFILE=napkin uv run --frozen --python 3.12 python scripts/tenants.py put napkin --enabled
    AWS_PROFILE=napkin uv run --frozen --python 3.12 python scripts/tenants.py put napkin --disabled
    AWS_PROFILE=napkin uv run --frozen --python 3.12 python scripts/tenants.py show napkin
    AWS_PROFILE=napkin uv run --frozen --python 3.12 python scripts/tenants.py list

The table is TENANTS_TABLE (default napkin-hackathon-tenants). The relay caches an item for 30 s, so
a change reaches every request within half a minute, with no deploy.

An item: {tenantId, agency, enabled, updatedAt, by}. tenantId is napkin-web's TenantId::of_agency
(UUIDv5 of "napkin:agency:<agency>"). tenant-limits adds capUsdMonthly, allow {claude, models} and
adminOverride to the same item; `put` keeps whatever else the item already holds.
"""

from __future__ import annotations

import argparse
import getpass
import json
import os
import sys
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent))

from identity import tenant_id  # noqa: E402

DEFAULT_TABLE = "napkin-hackathon-tenants"


def put(store, agency: str, enabled: bool, by: str, now: str) -> dict:
    """Write the agency's item, keeping fields this script does not own."""
    tid = tenant_id(agency)
    item = dict(store.tenant(tid) or {})
    item.update({"tenantId": tid, "agency": agency, "enabled": enabled, "updatedAt": now, "by": by})
    store.put_tenant(item)
    return item


def main(argv: list[str] | None = None, store=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)
    p_put = sub.add_parser("put", help="turn an agency on or off")
    p_put.add_argument("agency")
    on = p_put.add_mutually_exclusive_group(required=True)
    on.add_argument("--enabled", action="store_true")
    on.add_argument("--disabled", action="store_true")
    p_put.add_argument("--by", default=None, help="who made the change (default: your login)")
    p_show = sub.add_parser("show", help="one agency's item")
    p_show.add_argument("agency")
    sub.add_parser("list", help="every item")
    a = ap.parse_args(argv)

    if store is None:
        from store import DynamoStore

        table = os.environ.get("TENANTS_TABLE", DEFAULT_TABLE)
        store = DynamoStore("", "", "", tenants_table=table)

    if a.cmd == "put":
        now = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
        item = put(store, a.agency, bool(a.enabled), a.by or getpass.getuser(), now)
        print(json.dumps(item, indent=2))
    elif a.cmd == "show":
        item = store.tenant(tenant_id(a.agency))
        if not item:
            print(f"{a.agency} ({tenant_id(a.agency)}) has no item: the tool is off for it.", file=sys.stderr)
            return 1
        print(json.dumps(item, indent=2))
    else:
        for item in sorted(store.all_tenants(), key=lambda i: i["agency"]):
            print(f"{item['agency']:<24} {item['tenantId']}  {'on ' if item.get('enabled') else 'off'}  "
                  f"{item.get('updatedAt', '')} {item.get('by', '')}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
