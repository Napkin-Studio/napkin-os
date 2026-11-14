#!/usr/bin/env python3
"""What one ad costs Napkin to make, at the provider's list prices (features/runway-sheet-sync.clan).

    uv run --frozen --python 3.12 python scripts/ad_costs.py          a table
    uv run --frozen --python 3.12 python scripts/ad_costs.py --json   the same as JSON
    uv run --frozen --python 3.12 python scripts/ad_costs.py --check  fail when a total moved

The scenarios are contracts/cost-model.json: lists of {op, model, settings, count}. Each line is
priced by contracts/pricing.py from contracts/capabilities/<provider>.json, so a price lives only
in the sheet. A line whose model has no price fails loudly; nothing is ever counted as free.
Placeholders (Claude on Bedrock, billed failures) and fixed monthly infrastructure are listed beside
the totals, marked when they are not yet measured. Costs are for Napkin's own planning: the UI
shows no price (Shrey, 2026-10-13).
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent))
from contracts_dir import contracts_dir, pricing  # noqa: E402


def cost_model(root: Path | None = None) -> dict:
    return json.loads(((root or contracts_dir()) / "cost-model.json").read_text())


def sheet(provider: str, root: Path | None = None) -> dict:
    return json.loads(((root or contracts_dir()) / "capabilities" / f"{provider}.json").read_text())


def costs(model: dict | None = None, the_sheet: dict | None = None) -> list[dict]:
    """Each scenario with its priced lines and total, in credits and USD."""
    model = model or cost_model()
    the_sheet = the_sheet or sheet(model["provider"])
    price = pricing()
    out = []
    for sc in model["scenarios"]:
        lines, total = [], 0
        for ln in sc["lines"]:
            each = price.credits(the_sheet, ln["model"], ln["settings"])
            lines.append({**ln, "eachCredits": each, "credits": each * ln["count"]})
            total += each * ln["count"]
        out.append({"id": sc["id"], "label": sc["label"], "lines": lines, "credits": total,
                    "usd": round(total * the_sheet["usdPerCredit"], 2),
                    "expected": model["expected"].get(sc["id"])})
    return out


def _usd(v: float) -> str:
    return f"${v:,.2f}"


def table(model: dict | None = None, the_sheet: dict | None = None) -> str:
    """The summary as Markdown, for docs/production-tool/provider-reference.md."""
    model = model or cost_model()
    rows = costs(model, the_sheet)
    lines = ["| Scenario | Credits | USD |", "|---|---:|---:|"]
    lines += [f"| {r['label']} | {r['credits']:,} | {_usd(r['usd'])} |" for r in rows]
    extra = [f"- {p['what']}: " + (_usd(p['usd']) if 'usd' in p else f"{p['rate']:.0%}") +
             ("" if p["measured"] else " (placeholder, not measured)") for p in model["placeholders"]]
    fixed = [f"- {f['what']}: " + ("not yet entered" if f["usd"] is None else f"{_usd(f['usd'])} a month")
             for f in model["fixedMonthly"]]
    return "\n".join(lines + ["", "Not in the totals:", *extra, "", "Fixed monthly infrastructure:", *fixed])


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--json", action="store_true")
    ap.add_argument("--check", action="store_true", help="exit 1 when a scenario's total differs from cost-model.json expected")
    args = ap.parse_args(argv)
    rows = costs()
    if args.json:
        print(json.dumps(rows, indent=1))
    else:
        for r in rows:
            print(f"\n{r['label']}: {r['credits']:,} credits = {_usd(r['usd'])}")
            for ln in r["lines"]:
                print(f"  {ln['count']:>2} x {ln['what']:<62} {ln['model']:<32} {ln['credits']:>6,} cr")
        print()
        print(table())
    moved = [r for r in rows if r["credits"] != r["expected"]]
    for r in moved:
        print(f"{r['id']}: {r['credits']} credits at today's sheet; cost-model.json expects {r['expected']}", file=sys.stderr)
    return 1 if args.check and moved else 0


if __name__ == "__main__":
    sys.exit(main())
