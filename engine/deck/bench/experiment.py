"""The experiment designer: the run matrix (clients x arms x seeds) and its cost estimate. It runs nothing."""
from __future__ import annotations

ARMS = ("prompt", "prompt+documents", "brief+research")
#: Assumed prices in USD, extrapolated in DECK-CRAFT-PLAN 4.3 (about $70-90 for 72 decks, $40-60 for 432 judge calls):
#: +-30%, not a quote. Replace with a measured table once a first run has report.json usage.
PRICES = {"basis": "DECK-CRAFT-PLAN 4.3 extrapolation (+-30%)",
          "deck_usd": {"low": 70 / 72, "high": 90 / 72},
          "judge_call_usd": {"low": 40 / 432, "high": 60 / 432}}


def design(clients: list, arms: list, seeds: list, judges: int = 3, orders: int = 2, prices: dict | None = None) -> dict:
    """The matrix and the cost. One row per (client, arm, seed) with a ``run_id``; ``builds`` is its length.

    Judge calls are builds x judges x orders (12 x 3 x 2 x (3 judges, 2 orders) = 432). The cost is shown low and high
    for decks, judging and the total."""
    pr = prices or PRICES
    rows = [{"run_id": f"{c}__{a}__s{s}".replace("+", "_"), "client": c, "arm": a, "seed": s} for c in clients for a in arms for s in seeds]
    n = len(rows)
    calls = n * judges * orders
    cost = {k: round(n * pr["deck_usd"][k] + calls * pr["judge_call_usd"][k], 2) for k in ("low", "high")}
    cost["decks"] = {k: round(n * pr["deck_usd"][k], 2) for k in ("low", "high")}
    cost["judging"] = {k: round(calls * pr["judge_call_usd"][k], 2) for k in ("low", "high")}
    line = (f"{n} builds ({len(clients)} clients x {len(arms)} arms x {len(seeds)} seeds), {calls} judge calls "
            f"({judges} judges x {orders} orders); estimated ${cost['low']:.0f}-{cost['high']:.0f} ({pr['basis']}). Nothing is run.")
    return {"clients": list(clients), "arms": list(arms), "seeds": list(seeds), "builds": n, "judge_calls": calls,
            "prices": pr, "cost_usd": cost, "line": line, "matrix": rows}
