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

from . import cards, compare, cost, intake, pipeline
from .llm import LiveLLM


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--brief", help="a Brief Maker .clan or brief_object.json")
    ap.add_argument("--category"), ap.add_argument("--market"), ap.add_argument("--prompt", default=""), ap.add_argument("--brand")
    ap.add_argument("--live", action="store_true"), ap.add_argument("--yes-cost", action="store_true")
    ap.add_argument("--out", help="write the full result JSON here")
    ap.add_argument("--max-usd", type=float, default=2.0, help="hard stop: no call is made once this much (token-based estimate) is spent; default 2.00")
    a = ap.parse_args(argv)
    fields = {}
    if a.brief:
        sys.path[:0] = [str(Path(__file__).resolve().parents[1])]
        from deck import inputs
        loader = inputs.load_brief_clan if a.brief.endswith(".clan") else inputs.load_brief
        fields = loader(Path(a.brief))[0]
    gate = intake.assess(fields, a.category, a.market, a.prompt, a.brand)
    print(f"Gate: {gate['action']}: {gate['why']}. Thinness {gate['thinness']['score']}.")
    if gate["action"] != "proceed":
        print("No model call made.")
        return 0
    card = cost.estimate()
    print(cost.render(card))
    print(f"  hard stop    cap ${a.max_usd:.2f} for this run (--max-usd)")
    if a.live and a.yes_cost and card["est_usd"] > a.max_usd:
        print(f"The card (~${card['est_usd']:.2f}) is over the cap (${a.max_usd:.2f}): nothing will run. Raise --max-usd if you mean it.")
        return 2
    if not (a.live and a.yes_cost):
        print("Dry run: no model call made." if not a.live else "Live run needs --yes-cost after you have read the card.")
        return 0
    llm = LiveLLM(approved=True, max_usd=a.max_usd)
    res = pipeline.run({"fields": fields, "category": a.category, "market": a.market, "prompt": a.prompt, "brand": a.brand}, llm)
    print(cards.render_text(res))
    base = compare.baseline({"fields": fields, "category": a.category, "market": a.market, "prompt": a.prompt}, llm)
    for w in compare.shape_warnings(base):
        print("WARNING blind pack: " + w)
    if a.out:                                     # saved BEFORE the pack is built: a refused pack must not lose paid output
        out = Path(a.out)
        out.write_text(json.dumps({**res, "usage": llm.usage}, indent=1, ensure_ascii=False))
        out.with_name(out.stem + ".baseline.json").write_text(json.dumps(base, indent=1, ensure_ascii=False))
    try:
        pack, key = compare.blind_pack(cards.cards(res), base, seed=compare.pack_seed(a.brief, a.category, a.market, a.prompt, a.brand))
    except ValueError as e:
        print(f"Blind pack NOT made: {e}")
    else:
        if a.out:
            out.with_name(out.stem + ".blind-pack.json").write_text(json.dumps(pack, indent=1, ensure_ascii=False))
            out.with_name(out.stem + ".blind-key.json").write_text(json.dumps(key, indent=1))   # keep this from the grader
    est = any(u.get("usd_estimated") for u in llm.usage)
    print(f"{'Estimated' if est else 'Real'} usage: ${sum(u.get('usd', 0) for u in llm.usage):.2f} over {len(llm.usage)} calls" + (" (token-based estimate: the CLI login reports no charge)." if est else "."))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
