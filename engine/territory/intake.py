"""Step 0 and 1: read the brief, score how thin it is, tag every field given / inferred / missing,
and decide whether the tool may run (the zero-input tree, design 4b). Nothing here calls a model."""
from __future__ import annotations

BRIEF_FIELDS = ["background", "objectives", "audience", "competitor_context", "insight", "smp",
                "reasons_to_believe", "desired_response", "tone_world_assets", "budget_scope", "mandatories"]

#: a brief field is "inferred" when its kind or mark says so, or it carries a To confirm flag
_INFERRED = ("inferred", "assumption", "assumed", "to confirm", "to_confirm")


def tag_field(f: dict | None) -> str:
    """given | inferred | missing for one brief field ({value, kind, mark})."""
    f = f or {}
    if not f.get("value"):
        return "missing"
    text = f"{f.get('kind', '')} {f.get('mark', '')} {f.get('value') if isinstance(f.get('value'), str) else ''}".lower()
    if any(w in text for w in _INFERRED):
        return "inferred"
    return "given"


def thinness(fields: dict) -> dict:
    """Tags per field and a 0-1 thinness score: missing counts 1, inferred 0.5, given 0."""
    tags = {k: tag_field(fields.get(k)) for k in BRIEF_FIELDS}
    score = sum({"missing": 1.0, "inferred": 0.5, "given": 0.0}[t] for t in tags.values()) / len(tags)
    return {"tags": tags, "score": round(score, 2),
            "missing": [k for k, t in tags.items() if t == "missing"],
            "inferred": [k for k, t in tags.items() if t == "inferred"]}


def assess(fields: dict | None, category: str | None = None, market: str | None = None,
           prompt: str = "", brand: str | None = None, asked: bool = False) -> dict:
    """The zero-input tree. ``action`` is one of:

    proceed           category and market are both known: run
    confirm           a brand, prompt or brief exists but the floor is not met: infer, then ask one question
    ask               nothing usable: ask one question for category and market
    refuse            asked already and still no category and market: produce no territories

    The tool never runs on a guessed category (the floor is a confirmed category and market)."""
    fields = fields or {}
    th = thinness(fields)
    has_any = bool((prompt or "").strip() or brand or any(th["tags"][k] != "missing" for k in th["tags"]))
    audience_ok = th["tags"]["audience"] == "given"
    if category and market:
        action, why = "proceed", "category and market confirmed"
    elif has_any:
        action, why = "confirm", "category or market missing: infer both, then ask one confirmation question"
    elif asked:
        action, why = "refuse", "no category and market after one question: no territories produced"
    else:
        action, why = "ask", "nothing to work from: ask for category and market"
    return {"action": action, "why": why, "category": category, "market": market, "thinness": th,
            "assumption_dependent": (not audience_ok) or th["score"] >= 0.5,
            "audience_assumed": not audience_ok}


def from_deck_inputs(inp) -> dict:
    """Adapter: a deck.inputs.Inputs (what Brief Maker's clan loads into) to this tool's brief fields."""
    return {k: (inp.brief.get(k) or {}) for k in BRIEF_FIELDS}
