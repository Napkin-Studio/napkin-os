"""Step 0: the cost card. Shown before any paid run; the run waits for a yes. The numbers are ESTIMATES
from fixed per-call token sizes (unmeasured: the first live run replaces them with real usage)."""
from __future__ import annotations

#: stage -> (calls, prompt tokens, completion tokens, model); estimates, to be replaced by measured usage
STAGES = {
    "assumed_brief": (1, 3000, 1200, "claude-sonnet-5-5"),
    "tensions": (1, 4000, 1500, "claude-sonnet-5-5"),
    "seeds": (1, 5000, 4000, "claude-opus-5-5"),
    "kill": (1, 5000, 2000, "claude-sonnet-5-5"),
    "sort": (1, 3000, 800, "claude-sonnet-5-5"),
    "score": (1, 5000, 2000, "claude-sonnet-5-5"),
    "propositions": (1, 4000, 1500, "claude-opus-5-5"),
}


#: develop (territories-engine-develop): estimated sizes of one call each (a batch of four routes is about 7k out), for the cap's pre-check
DEVELOP = {
    "world": (1, 6000, 7000, "claude-opus-5-5"),
    "world_more": (1, 3000, 400, "claude-opus-5-5"),
    "world_checks": (1, 9000, 3500, "claude-sonnet-5-5"),
    "judge": (1, 8000, 3500, "claude-sonnet-5-5"),
}


def _price(model, tin, tout):
    """The card's dollars for one stage: the shared price table (engine/prices.json), the one every tool reads. There is no
    stand-in copy any more (it was one of three tables that disagreed)."""
    import price_table
    return round(price_table.usd(model, tin, tout), 4)


#: measured 2026-11-02: four live runs (client A, client B, client C, client D), 8 calls each, token-based
#: estimates of $0.62, $0.68, $0.86 and $0.80, mean $0.74, against an uncalibrated card of $0.43 (at the price table then;
#: after the 17 Nov 2026 price fix, Sonnet 5.5 2/10 and Opus 5.5 4/20, the same tokens and this factor give about $0.55)
CALIBRATION = 1.71


def estimate(baseline: bool = True) -> dict:
    """The card: per-stage calls, tokens and dollars, and a total. ``baseline`` adds the one plain-prompt call."""
    rows, calls, usd = [], 0, 0.0
    for name, (c, tin, tout, model) in STAGES.items():
        u = round(_price(model, tin, tout) * CALIBRATION, 4)
        rows.append({"stage": name, "calls": c, "model": model, "est_prompt_tokens": tin, "est_completion_tokens": tout, "est_usd": u})
        calls += c
        usd += u
    if baseline:
        u = round(_price("claude-opus-5-5", 3000, 2500) * CALIBRATION, 4)
        rows.append({"stage": "baseline", "calls": 1, "model": "claude-opus-5-5", "est_prompt_tokens": 3000, "est_completion_tokens": 2500, "est_usd": u})
        calls += 1
        usd += u
    return {"rows": rows, "calls": calls, "est_usd": round(usd, 2), "estimated": True,
            "note": "Estimate from fixed token sizes, scaled to the mean of four measured runs ($0.74). Those are token-based estimates, not charges, and a longer brief costs more (a 38k-character brief, $0.86)."}


def render(card: dict) -> str:
    lines = ["COST CARD (estimate, not measured)"]
    for r in card["rows"]:
        lines.append(f"  {r['stage']:<14} {r['calls']} call  {r['model']:<18} ~${r['est_usd']:.3f}")
    lines.append(f"  total          {card['calls']} calls  ~${card['est_usd']:.2f}")
    return "\n".join(lines)
