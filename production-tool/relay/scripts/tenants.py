#!/usr/bin/env python3
"""Turn the Production Tool on or off for an agency, and set its limits and allowlist
(features/os-sign-in.clan, features/tenant-limits.clan).

The relay serves only agencies whose item in the tenants table says enabled: true. Everyone else
gets "The Production Tool is not on for your agency yet." The relay only reads the table; this
script writes it, run by a person with their own credentials, on the agency's request:

    AWS_PROFILE=napkin uv run --frozen --python 3.12 python scripts/tenants.py put napkin --enabled
    AWS_PROFILE=napkin uv run --frozen --python 3.12 python scripts/tenants.py put napkin --disabled
    AWS_PROFILE=napkin uv run --frozen --python 3.12 python scripts/tenants.py put napkin --cap 400
    AWS_PROFILE=napkin uv run --frozen --python 3.12 python scripts/tenants.py put napkin --cap off
    AWS_PROFILE=napkin uv run --frozen --python 3.12 python scripts/tenants.py put napkin --daily-quotas on
    AWS_PROFILE=napkin uv run --frozen --python 3.12 python scripts/tenants.py put napkin --makers runway
    AWS_PROFILE=napkin uv run --frozen --python 3.12 python scripts/tenants.py put napkin --claude off
    AWS_PROFILE=napkin uv run --frozen --python 3.12 python scripts/tenants.py put napkin --defaults
    AWS_PROFILE=napkin uv run --frozen --python 3.12 python scripts/tenants.py show napkin
    AWS_PROFILE=napkin uv run --frozen --python 3.12 python scripts/tenants.py list

The table is TENANTS_TABLE (default napkin-hackathon-tenants). The relay caches an item for 30 s, so
a change reaches every request within half a minute, with no deploy.

An item: {tenantId, agency, enabled, updatedAt, by} and, when set, capUsdMonthly, dailyQuotas and
allow {claude, makers}. tenantId is napkin-web's TenantId::of_agency (UUIDv5 of
"napkin:agency:<agency>"). A field the item does not hold is contracts/spend-policy.json's: no cap,
daily quotas off, Claude on, makers Runway and Google (owner, 2026-10-13: caps and quotas are built
but off, and each agency chooses its own cap). `put` changes only the fields it is given and keeps
the rest; --defaults drops the limits and allowlist so the policy applies again.

--cap is the agency's monthly limit in USD on new paid work (UTC calendar month), or off. Nothing in
the tool shows it or warns before it: at the limit, new paid jobs are refused in plain words, with
no amount. --makers is the full list of makers whose models may run (contracts/subprocessors.json);
any other maker is off. Turning Google off stops every image and clip step on today's sheet.
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

from contracts_dir import contracts_dir  # noqa: E402
from identity import tenant_id  # noqa: E402

DEFAULT_TABLE = "napkin-hackathon-tenants"
LIMIT_FIELDS = ("capUsdMonthly", "dailyQuotas", "allow")


def known_makers() -> set[str]:
    """The makers the notice lists: an agency may allow only these."""
    notice = json.loads((contracts_dir() / "subprocessors.json").read_text())
    return {e["id"] for e in notice["entries"] if e["control"] == "maker"}


def policy() -> dict:
    return json.loads((contracts_dir() / "spend-policy.json").read_text())


def on_off(value: str) -> bool:
    if value not in ("on", "off"):
        raise argparse.ArgumentTypeError("say on or off")
    return value == "on"


def cap_value(value: str) -> float | None:
    if value == "off":
        return None
    try:
        usd = float(value)
    except ValueError:
        raise argparse.ArgumentTypeError("a number of US dollars, or off") from None
    if usd < 0:
        raise argparse.ArgumentTypeError("a cap is 0 or more")
    return usd


def put(store, agency: str, by: str, now: str, *, enabled: bool | None = None, cap: object = ...,
        daily_quotas: bool | None = None, makers: list[str] | None = None, claude: bool | None = None,
        defaults: bool = False) -> dict:
    """Write the agency's item: only the fields given change; everything else is kept."""
    tid = tenant_id(agency)
    item = dict(store.tenant(tid) or {})
    if not item and enabled is None:
        raise SystemExit(f"{agency} has no item yet: say --enabled or --disabled")
    if defaults:
        for k in LIMIT_FIELDS:
            item.pop(k, None)
    if enabled is not None:
        item["enabled"] = enabled
    if cap is not ...:
        item["capUsdMonthly"] = cap
    if daily_quotas is not None:
        item["dailyQuotas"] = daily_quotas
    if makers is not None or claude is not None:
        allow = dict(item.get("allow") or policy()["allow"])
        if makers is not None:
            unknown = sorted(set(makers) - known_makers())
            if unknown:
                raise SystemExit(f"not a maker in contracts/subprocessors.json: {', '.join(unknown)}")
            allow["makers"] = list(dict.fromkeys(makers))
        if claude is not None:
            allow["claude"] = claude
        item["allow"] = {"claude": bool(allow["claude"]), "makers": list(allow["makers"])}
    item.update({"tenantId": tid, "agency": agency, "enabled": bool(item.get("enabled")), "updatedAt": now, "by": by})
    store.put_tenant(item)
    return item


def effective(item: dict) -> dict:
    """What the relay applies: the item's fields over the policy's."""
    p = policy()
    return {"capUsdMonthly": item.get("capUsdMonthly", p["capUsdMonthly"]),
            "dailyQuotas": item.get("dailyQuotas", p["dailyQuotas"]), "allow": item.get("allow", p["allow"])}


def main(argv: list[str] | None = None, store=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)
    p_put = sub.add_parser("put", help="turn an agency on or off, or change its limits and allowlist")
    p_put.add_argument("agency")
    on = p_put.add_mutually_exclusive_group()
    on.add_argument("--enabled", action="store_true")
    on.add_argument("--disabled", action="store_true")
    p_put.add_argument("--cap", type=cap_value, default=..., help="monthly limit in USD, or off")
    p_put.add_argument("--daily-quotas", type=on_off, default=None, help="on or off: config.json's per-person day quotas")
    p_put.add_argument("--makers", default=None, help="comma-separated makers whose models may run, e.g. runway,google")
    p_put.add_argument("--claude", type=on_off, default=None, help="on or off: the director and character cards")
    p_put.add_argument("--defaults", action="store_true", help="drop the limits and allowlist: the policy applies")
    p_put.add_argument("--by", default=None, help="who made the change (default: your login)")
    p_show = sub.add_parser("show", help="one agency's item, and what the relay applies")
    p_show.add_argument("agency")
    sub.add_parser("list", help="every item")
    a = ap.parse_args(argv)

    if store is None:
        from store import DynamoStore

        table = os.environ.get("TENANTS_TABLE", DEFAULT_TABLE)
        store = DynamoStore("", "", "", tenants_table=table)

    if a.cmd == "put":
        enabled = True if a.enabled else False if a.disabled else None
        makers = [m.strip() for m in a.makers.split(",") if m.strip()] if a.makers is not None else None
        if enabled is None and a.cap is ... and a.daily_quotas is None and makers is None and a.claude is None \
                and not a.defaults:
            ap.error("put: say what changes (--enabled, --disabled, --cap, --daily-quotas, --makers, --claude or --defaults)")
        now = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
        item = put(store, a.agency, a.by or getpass.getuser(), now, enabled=enabled, cap=a.cap,
                   daily_quotas=a.daily_quotas, makers=makers, claude=a.claude, defaults=a.defaults)
        print(json.dumps(item, indent=2))
    elif a.cmd == "show":
        item = store.tenant(tenant_id(a.agency))
        if not item:
            print(f"{a.agency} ({tenant_id(a.agency)}) has no item: the tool is off for it.", file=sys.stderr)
            return 1
        print(json.dumps({**item, "applies": effective(item)}, indent=2))
    else:
        for item in sorted(store.all_tenants(), key=lambda i: i["agency"]):
            eff = effective(item)
            cap = "no cap" if eff["capUsdMonthly"] is None else f"cap {eff['capUsdMonthly']:g}"
            print(f"{item['agency']:<24} {item['tenantId']}  {'on ' if item.get('enabled') else 'off'}  {cap:<10} "
                  f"makers {','.join(eff['allow']['makers'])}{'' if eff['allow']['claude'] else ' no-claude'}  "
                  f"{item.get('updatedAt', '')} {item.get('by', '')}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
