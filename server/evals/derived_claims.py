"""The derived-claims guard (brief-fact-provenance, owner answer 3, 2026-10-19). Opt-in, never in CI.

Does the new prompt, or the rewrite step, cost Dara her worked-out conclusions? Over recorded planned
draft inputs from non-client test briefs (public topics shaped like the Lidl case), it counts the
derived claims (recomputed or stated) the tie pass finds:

  baseline   drafts made with the DRAFT_SYSTEM before this feature (below, as it was), twice, for the
             run-to-run noise
  new        drafts made with today's DRAFT_SYSTEM, before and after one rewrite of every part that holds
             a worked-out claim (REWRITE_NOTE, a neutral instruction)

Every draft is tied offline by provenance.clean_parts (the tie call included). A drop of the new
drafts' derived claims below the baseline's lowest run by more than the noise blocks the release
(exit 1). Real model calls on the drafting route; the run stops at --budget USD (15 by default).

Each input is a JSON file: {"payload": <draft_brief_whole's payload>, "pins": [full pins], "sources":
[source records], "capture_items": {cap_id: item}, "brand": "...", "competitors": [...]}.

    cd server && uv run python -m evals.derived_claims <inputs dir> [--budget 15]

Run it locally only: never against the owner's live relay (ports 8091, 8788)."""
from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path

from napkin import runlog
from napkin.brief import planned
from napkin.brief import provenance as prov
from napkin.config import Settings
from napkin.model import ModelPort, Usage, build_wire

# DRAFT_SYSTEM as it stood before this feature (fb67036), the baseline's prompt.
OLD_DRAFT_SYSTEM = planned.DRAFT_SYSTEM.replace(
    "Cite the cap_ ids\n  of the client's words (client_words) it rests on.", "Cite nothing.").replace(
    "Use their\n  numbers exactly as given.",
    "Use their\n  numbers exactly as given; never a number that is not in a cited fact.")
REWRITE_INSTRUCTION = "Make it sharper and more specific, keeping what it rests on."


class Budget:
    def __init__(self, port: ModelPort, usd: float):
        self.port, self.usd, self.spent = port, usd, 0.0

    def structured(self, purpose, system, payload, schema, max_tokens=None, **_):
        if self.spent >= self.usd:
            raise SystemExit(f"stopped: the budget of USD {self.usd:.2f} is spent")
        u = Usage()
        try:
            return self.port.call(purpose, system, payload, schema, usage=u, attribution="eval derived_claims",
                                  max_tokens=max_tokens)
        finally:
            for model, t in u.by_model.items():
                self.spent += runlog.price(model, t["input_tokens"], t["output_tokens"]) or 0.0


def _ctx(rec, model):
    clan = {"facts": rec.get("pins") or [], "sources": rec.get("sources") or [], "findings": [], "data": {}}
    ev = prov.evidence(clan, {})
    return prov.Ctx(ev, prov.ClientWords(rec.get("capture_items") or {}, {}, {}), {}, rec.get("brand"),
                    rec.get("competitors") or [], model, runlog.NULL)


def derived(parts) -> int:
    return sum(1 for v in parts.values() for c in v.get("claims") or []
               if c["kind"] == "derived" and c.get("check") in ("recomputed", "stated"))


def one(rec, model, system, rewrite=False) -> tuple[int, int | None]:
    keys = list(rec["payload"]["parts"])
    out = model.structured("draft_brief_whole", system, rec["payload"], planned.draft_schema(keys), max_tokens=16000)
    ctx = _ctx(rec, model)
    parts = prov.clean_parts(out, ctx, stage="draft")
    if not rewrite:
        return derived(parts), None
    todo = [k for k, v in parts.items() if any(c["kind"] == "derived" for c in v.get("claims") or [])]
    if not todo:
        return derived(parts), derived(parts)
    pay = {**rec["payload"], "brief": {k: v["value"] for k, v in parts.items()},
           "rewrite": {k: REWRITE_INSTRUCTION for k in todo},
           "prior_claims": {k: parts[k]["claims"] for k in todo}, "parts": {k: rec["payload"]["parts"][k] for k in todo}}
    got = model.structured("rewrite_brief_parts", planned.DRAFT_SYSTEM + planned.REWRITE_NOTE, pay,
                           planned.draft_schema(todo), max_tokens=8000)
    after = {**parts, **prov.clean_parts(got, ctx, stage="revise", prior={k: parts[k]["claims"] for k in todo})}
    return derived(parts), derived(after)


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("inputs", type=Path)
    ap.add_argument("--budget", type=float, default=15.0)
    a = ap.parse_args(argv)
    s = Settings.from_env()
    if any(p in str(getattr(s, "model_base_url", "") or "") for p in (":8091", ":8788")) or \
            any(p in os.environ.get("NAPKIN_RELAY_URL", "") for p in (":8091", ":8788")):
        sys.exit("refused: never run this against the owner's live relay (8091/8788)")
    port = ModelPort(build_wire(s), s.model, s.model_timeout)
    model = Budget(port, a.budget)
    recs = [json.loads(p.read_text()) for p in sorted(a.inputs.glob("*.json"))]
    if not recs:
        sys.exit(f"no inputs in {a.inputs}")
    base = [[one(r, model, OLD_DRAFT_SYSTEM)[0] for r in recs] for _ in range(2)]
    new = [one(r, model, planned.DRAFT_SYSTEM, rewrite=True) for r in recs]
    b1, b2 = sum(base[0]), sum(base[1])
    noise = abs(b1 - b2)
    before, after = sum(x for x, _ in new), sum(y for _, y in new)
    print(json.dumps({"inputs": len(recs), "baseline_runs": [b1, b2], "noise": noise, "new_draft": before,
                      "new_after_rewrite": after, "usd": round(model.spent, 2)}, indent=1))
    floor = min(b1, b2) - noise
    if before < floor or after < floor:
        print("BLOCK: worked-out claims dropped beyond run-to-run noise")
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
