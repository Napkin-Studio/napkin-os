"""Step 0: the cost card. Shown before any paid run; the run waits for a yes. The numbers are ESTIMATES
from fixed per-call token sizes (unmeasured: the first live run replaces them with real usage)."""
from __future__ import annotations

#: stage -> (calls, prompt tokens, completion tokens, model); estimates, to be replaced by measured usage
STAGES = {
    "assumed_brief": (1, 3000, 1200, "claude-sonnet-5-5"),
    "conventions": (1, 5000, 1500, "claude-sonnet-5-5"),
    "tensions": (1, 4000, 1500, "claude-sonnet-5-5"),
    "seeds": (1, 5000, 4000, "claude-opus-5-5"),
    "score": (1, 5000, 2000, "claude-sonnet-5-5"),
    "propositions": (1, 4000, 1500, "claude-opus-5-5"),
}
#: dollars per million tokens (in, out); a stand-in table for the card only, deck.spec.PRICE_PER_MTOK is used when importable
_FALLBACK = {"claude-sonnet-5-5": (3.0, 15.0), "claude-opus-5-5": (15.0, 75.0)}


def _price(model, tin, tout):
    try:
        from deck import spec
        usd = spec.estimate_usd(model, tin, tout)
        if usd:
            return usd
    except Exception:
        pass
    pin, pout = _FALLBACK.get(model, (15.0, 75.0))
    return round(tin / 1e6 * pin + tout / 1e6 * pout, 4)


#: measured 2026-11-02: the first live Ballymaloe run cost $0.53 over 7 calls against a $0.40 estimate
CALIBRATION = 1.35


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
            "note": "Estimate from fixed token sizes, scaled by one measured run (Ballymaloe, $0.53 vs $0.40). Per-stage actuals are not yet recorded."}


def render(card: dict) -> str:
    lines = ["COST CARD (estimate, not measured)"]
    for r in card["rows"]:
        lines.append(f"  {r['stage']:<14} {r['calls']} call  {r['model']:<18} ~${r['est_usd']:.3f}")
    lines.append(f"  total          {card['calls']} calls  ~${card['est_usd']:.2f}")
    return "\n".join(lines)
