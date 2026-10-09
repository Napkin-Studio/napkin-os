#!/usr/bin/env python3
"""What a reference production costs on each provider pathway (features/harness-pathways.clan).

    uv run --frozen --python 3.12 python scripts/pathway_costs.py          a table
    uv run --frozen --python 3.12 python scripts/pathway_costs.py --json   the same as JSON

The reference production: one character (generate, then 3 views), six shots (6 frames plus 2
regenerates), six clips of the default length and one clip edit. Prices are each capability
sheet's estimateUsd for one job at its default settings (contracts/capabilities/*.json, which say
where each figure came from). Two columns: the routing's default models, and the best alternate
the regenerate menu offers for each step (features/model-choice.clan). A step whose model has no
published price (HeyGen) is counted as unknown, never as free.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent))
from contracts_dir import contracts_dir  # noqa: E402

PATHWAYS = ("runway", "fal", "heygen", "mix")
# step -> how many jobs the reference production runs
PRODUCTION = {"generate": 1, "view": 3, "frame": 8, "region_edit": 0, "clip": 6, "clip_edit": 1}


def sheets() -> dict[str, dict]:
    out = {}
    for p in (contracts_dir() / "capabilities").glob("*.json"):
        s = json.loads(p.read_text())
        out[s["provider"]] = s
    return out


def config(name: str) -> dict:
    return json.loads((contracts_dir() / "examples" / f"config.pathway.{name}.json").read_text())


def _best(spec: dict) -> dict:
    """The priciest model offered for a step (the menu's top tier), else the step's own."""
    priced = [m for m in [spec, *spec.get("alternates", [])] if m.get("estimateUsd") is not None]
    return max(priced, key=lambda m: m["estimateUsd"]) if priced else spec


def costs(name: str, all_sheets: dict[str, dict] | None = None) -> dict:
    all_sheets = all_sheets or sheets()
    cfg = config(name)
    rows, total, best_total, unknown = [], 0.0, 0.0, []
    for op, count in PRODUCTION.items():
        provider = next((p for p in cfg["routing"].get(op, []) if op in all_sheets.get(p, {}).get("ops", {})), None)
        if provider is None or count == 0:
            continue
        spec = all_sheets[provider]["ops"][op]
        best = _best(spec)  # every routed provider's models are offered, Runway's too
        each, best_each = spec.get("estimateUsd"), best.get("estimateUsd")
        if each is None:
            unknown.append(f"{op} on {provider}")
        rows.append({"step": op, "jobs": count, "provider": provider, "model": spec["model"], "eachUsd": each,
                     "bestModel": best["model"], "bestEachUsd": best_each})
        total += (each or 0) * count
        best_total += (best_each or 0) * count
    return {"pathway": name, "rows": rows, "totalUsd": round(total, 3), "bestTotalUsd": round(best_total, 3),
            "unknown": unknown}


def _usd(v) -> str:
    return "unpublished" if v is None else f"${v:.3f}" if v < 0.1 else f"${v:.2f}"


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--json", action="store_true")
    args = ap.parse_args(argv)
    all_sheets = sheets()
    out = [costs(n, all_sheets) for n in PATHWAYS]
    if args.json:
        print(json.dumps(out, indent=1))
        return 0
    print("Reference production: " + ", ".join(f"{n} {op}" for op, n in PRODUCTION.items() if n))
    for c in out:
        print(f"\n{c['pathway']}: {_usd(c['totalUsd'])} with default models, {_usd(c['bestTotalUsd'])} with the best "
              f"offered" + (f" (plus {', '.join(c['unknown'])}: price unpublished)" if c["unknown"] else ""))
        for r in c["rows"]:
            best = "" if r["bestModel"] == r["model"] else f"   best: {r['bestModel']} {_usd(r['bestEachUsd'])}"
            print(f"  {r['jobs']:>2} x {r['step']:<11} {r['provider']:<7} {r['model']:<38} {_usd(r['eachUsd'])}{best}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
