"""The gold set: human scores against the judges' scores, as Spearman rank correlation per criterion."""
from __future__ import annotations

from .stats import spearman

TRUST_RHO = 0.6     # plan 4.3: trust a criterion's judge only when rho >= 0.6 on 12 decks
GOLD_SIZE = 12


def load_human(data: dict) -> dict:
    """Human scores as ``{deck_id: {criterion: score}}`` from ``{"decks": {id: {criterion: score}}}`` or
    ``{"decks": [{"id": id, "scores": {...}}]}`` (a mean of several raters may be given as a number)."""
    d = data.get("decks", data)
    if isinstance(d, list):
        return {x["id"]: dict(x["scores"]) for x in d}
    return {k: dict(v) for k, v in d.items()}


def judged_from_bench(bench: dict) -> dict:
    """``{deck_id: {criterion: mean judge score}}`` from a bench.json (deck ids are the run names in its mapping)."""
    mapping = bench["mapping"]
    return {mapping[r["label"]]: r["criteria"] for r in bench["decks"]}


def gold_report(human: dict, judged: dict, criteria: list) -> dict:
    """Spearman rho between human and judged scores for each criterion, over the decks both have.

    A criterion is ``trusted`` only at rho >= 0.6 on 12 or more decks; at rho >= 0.6 on fewer it is ``smoke`` and, like
    ``untrusted`` (rho under 0.6 or not computable), stays in ``untrusted`` (judged by people only). ``warnings`` says when the gold set is smaller than 12 decks (then it is a smoke check)."""
    ids = sorted(set(human) & set(judged))
    out = {}
    for c in criteria:
        pairs = [(human[i][c], judged[i][c]) for i in ids if c in human[i] and c in judged[i]]
        rho = spearman([a for a, _ in pairs], [b for _, b in pairs]) if len(pairs) >= 3 else None
        out[c] = {"rho": None if rho is None else round(rho, 3), "n": len(pairs),
                  "status": ("trusted" if len(ids) >= GOLD_SIZE else "smoke") if rho is not None and rho >= TRUST_RHO else "untrusted",
                  "note": (None if len(ids) >= GOLD_SIZE else f"rho {rho:.2f} on {len(ids)} decks is a smoke check, not validation (needs {GOLD_SIZE})") if rho is not None and rho >= TRUST_RHO else ("rho cannot be computed" if rho is None else f"rho {rho:.2f} is under {TRUST_RHO}: judged by people only until the prompt improves")}
    warn = [] if len(ids) >= GOLD_SIZE else [f"only {len(ids)} gold decks (the plan asks for {GOLD_SIZE}): treat rho as a smoke check"]
    return {"decks": len(ids), "criteria": out, "untrusted": [c for c, v in out.items() if v["status"] != "trusted"], "warnings": warn}
