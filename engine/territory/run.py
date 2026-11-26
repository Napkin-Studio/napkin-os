"""Run the Territory pipeline from the command line.

    python3 -m territory.run --category "non-alcoholic beer" --market IE --prompt "..."                  # dry run: gate + cost card and its id, no calls
    python3 -m territory.run ... --material demo --live --yes-cost <card id> --out runs/x.json            # paid: only after the card is shown

A dry run never calls a model. A live run needs the card's id (``--yes-cost c_...``, the owner's rule: every paid run shows its cost and
waits for a yes; a stale or wrong id is refused) and ``--out``, a file that does not exist yet: the paid result is written there straight
after the pipeline, before anything else can fail. ``--material`` says what the run is made from (invented, demo or client); the run keeps
it with the brief's marks, and the frames tool (territory.visuals) reads both. Output is rough cards, not a report."""
from __future__ import annotations

import argparse
import hashlib
import json
import math
import sys
from pathlib import Path

from . import cards, compare, cost, intake, material, pipeline
from .spend import Spend
from .llm import LiveLLM

#: The most one text run may cost (the Deck's and the frames tool's rule): --max-usd lowers it, nothing raises it.
MAX_USD_CAP = 2.5


def card_id(card: dict, inputs: dict, max_usd: float, out: str | None) -> str:
    """``c_`` and 16 hex over the card, what the run is made from, the cap and the output file: a yes names exactly this run."""
    blob = json.dumps(["territory-text", card["calls"], card["est_usd"], inputs, round(max_usd, 4), str(Path(out).resolve()) if out else None],
                      sort_keys=True, ensure_ascii=False, default=str)
    return "c_" + hashlib.sha256(blob.encode()).hexdigest()[:16]


def main(argv=None, *, llm_factory=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--brief", help="a Brief Maker .clan or brief_object.json")
    ap.add_argument("--category"), ap.add_argument("--market"), ap.add_argument("--prompt", default=""), ap.add_argument("--brand")
    ap.add_argument("--material", choices=material.ORIGINS, help="what this run is made from: invented, demo or client (recorded in the run)")
    ap.add_argument("--live", action="store_true")
    ap.add_argument("--yes-cost", nargs="?", const="", default=None, metavar="CARD_ID", help="the id printed on the cost card you have read")
    ap.add_argument("--out", help="write the full result JSON here (required for a live run; must not exist yet)")
    ap.add_argument("--max-usd", type=float, default=2.0, help=f"hard stop: no call is made once this much (token-based estimate) is spent; "
                    f"default 2.00, above 0 and at most {MAX_USD_CAP:.2f}")
    a = ap.parse_args(argv)
    if not (math.isfinite(a.max_usd) and 0 < a.max_usd <= MAX_USD_CAP):   # nan passes every comparison and inf removes the cap: both refused
        print(f"--max-usd {a.max_usd} is refused: give a number above 0 and at most {MAX_USD_CAP:.2f}. No flag raises the cap. Nothing was run.")
        return 2
    fields, marks = {}, []
    brief_sha = None
    if a.brief:
        sys.path[:0] = [str(Path(__file__).resolve().parents[1])]
        from deck import inputs
        loader = inputs.load_brief_clan if a.brief.endswith(".clan") else inputs.load_brief
        got = loader(Path(a.brief))
        fields, marks = got[0], got[3].get("marks")         # None from a brief_object.json: it carries no mark data
        brief_sha = hashlib.sha256(Path(a.brief).read_bytes()).hexdigest()
    mat = material.block(a.material, a.brief, marks, a.brand, brief_sha)   # the marks' count and the brief's hash, never their text
    gate = intake.assess(fields, a.category, a.market, a.prompt, a.brand)
    print(f"Gate: {gate['action']}: {gate['why']}. Thinness {gate['thinness']['score']}.")
    if gate["action"] != "proceed":
        print("No model call made.")
        return 0
    card = cost.estimate()
    cid = card_id(card, {"brief": brief_sha, "category": a.category, "market": a.market, "prompt": a.prompt, "brand": a.brand, "material": a.material}, a.max_usd, a.out)
    print(cost.render(card))
    print(f"  hard stop    cap ${a.max_usd:.2f} for this run (--max-usd)")
    print(f"  card         {cid}   yes: --live --yes-cost {cid} --out <a new file>")
    print(f"  material     {mat['origin']}" + ("" if a.material else " (say --material invented|demo|client: the frames tool reads it)")
          + (f"; brief marks: {'unknown (a brief_object.json has none)' if mat['marks_count'] is None else mat['marks_count']} part(s) marked Confidential"
             + (" (the run keeps only the count: give the frames tool --brief with this same file)" if mat["marks_count"] else "") if a.brief else ""))
    if not a.live:
        print("Dry run: no model call made.")
        return 0
    if not a.out:
        print("A live run needs --out <file>: the paid result is saved there straight after the pipeline. Nothing was run.")
        return 2
    out = Path(a.out)
    if out.exists():
        print(f"{out} exists already: a live run never overwrites paid output. Choose a new file (the card id changes with it). Nothing was run.")
        return 2
    if not a.yes_cost:
        print(f"Live run needs --yes-cost {cid} after you have read the card.")
        return 0
    if a.yes_cost != cid:
        print(f"--yes-cost {a.yes_cost} is not this card's id ({cid}): the inputs, the cap or --out changed, or the id is wrong. Nothing was run.")
        return 2
    if not card["est_usd"] <= a.max_usd:
        print(f"The card (~${card['est_usd']:.2f}) is over the cap (${a.max_usd:.2f}): nothing will run. Raise --max-usd if you mean it.")
        return 2
    # one spend module for every entry point: the cap is checked before each call and a finished call is never paid twice
    spend = Spend(cap_usd=a.max_usd, store=out.with_name(out.stem + ".spend.json"))
    spend.ask(card)
    llm = spend.wrap(llm_factory() if llm_factory else LiveLLM(approved=True))
    res = pipeline.run({"fields": fields, "category": a.category, "market": a.market, "prompt": a.prompt, "brand": a.brand}, llm)
    res["material"] = mat

    def save():
        out.write_text(json.dumps({**res, "usage": list(llm.usage) if hasattr(llm, "usage") else []}, indent=1, ensure_ascii=False))

    save()                                        # paid output on disk before anything else runs or can fail
    print(f"Saved: {out}")
    print(cards.render_text(res))
    base = compare.baseline({"fields": fields, "category": a.category, "market": a.market, "prompt": a.prompt}, llm)
    out.with_name(out.stem + ".baseline.json").write_text(json.dumps(base, indent=1, ensure_ascii=False))
    save()                                        # again, with the baseline call's usage
    for w in compare.shape_warnings(base):
        print("WARNING blind pack: " + w)
    try:
        pack, key = compare.blind_pack(cards.cards(res), base, seed=compare.pack_seed(a.brief, a.category, a.market, a.prompt, a.brand))
    except ValueError as e:
        print(f"Blind pack NOT made: {e}")
    else:
        out.with_name(out.stem + ".blind-pack.json").write_text(json.dumps(pack, indent=1, ensure_ascii=False))
        out.with_name(out.stem + ".blind-key.json").write_text(json.dumps(key, indent=1))   # keep this from the grader
    usage = getattr(llm, "usage", [])
    est = any(u.get("usd_estimated") for u in usage)
    print(f"{'Estimated' if est else 'Real'} usage: ${sum(u.get('usd', 0) for u in usage):.2f} over {len(usage)} calls" + (" (token-based estimate: the CLI login reports no charge)." if est else "."))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
