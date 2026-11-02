"""Run the Territory pipeline from the command line.

    python3 -m territory.run --category "non-alcoholic beer" --market IE --prompt "..."          # dry run: gate + cost card, no calls
    python3 -m territory.run ... --live --yes-cost                                              # paid: only after the card is shown

A dry run never calls a model. ``--live`` without ``--yes-cost`` stops after printing the card (the owner's rule:
every paid run shows its cost and waits for a yes). Output is rough cards, not a report."""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from . import cards, cost, intake, pipeline
from .llm import LiveLLM


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--brief", help="a Brief Maker brief_object.json")
    ap.add_argument("--category"), ap.add_argument("--market"), ap.add_argument("--prompt", default=""), ap.add_argument("--brand")
    ap.add_argument("--live", action="store_true"), ap.add_argument("--yes-cost", action="store_true")
    ap.add_argument("--out", help="write the full result JSON here")
    a = ap.parse_args(argv)
    fields = {}
    if a.brief:
        sys.path[:0] = [str(Path(__file__).resolve().parents[1])]
        from deck import inputs
        fields = inputs.load_brief(Path(a.brief))[0]
    gate = intake.assess(fields, a.category, a.market, a.prompt, a.brand)
    print(f"Gate: {gate['action']}: {gate['why']}. Thinness {gate['thinness']['score']}.")
    if gate["action"] != "proceed":
        print("No model call made.")
        return 0
    print(cost.render(cost.estimate()))
    if not (a.live and a.yes_cost):
        print("Dry run: no model call made." if not a.live else "Live run needs --yes-cost after you have read the card.")
        return 0
    llm = LiveLLM(approved=True)
    res = pipeline.run({"fields": fields, "category": a.category, "market": a.market, "prompt": a.prompt, "brand": a.brand}, llm)
    print(cards.render_text(res))
    if a.out:
        Path(a.out).write_text(json.dumps(res, indent=1, ensure_ascii=False))
    print(f"Real usage: ${sum(u.get('usd', 0) for u in llm.usage):.2f} over {len(llm.usage)} calls.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
