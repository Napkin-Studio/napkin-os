"""What an agent's Claude calls cost: their tokens at the model's price (UAT 2026-11-21, F21: 22 Dex and Skye calls,
498k tokens in and 31k out, showed $0 in the ledger). The one place it is worked out; the relay adds it to the job's
cost (cost.agentUsd) and to the ledger, as recorded spend (never shown: no prices in the UI).

Prices are config.json director.prices ({model id: {inputPerMTok, outputPerMTok}}, matched by the id's tail so
"eu.anthropic.claude-sonnet-5-5" finds "claude-sonnet-5-5"), else these list prices (USD per million tokens).
Bedrock's own price for a region may differ; config sets it without a deploy."""

from __future__ import annotations

DEFAULT_PRICES = {
    "claude-sonnet-5-5": {"inputPerMTok": 2.0, "outputPerMTok": 10.0},
    "claude-opus-5-5": {"inputPerMTok": 4.0, "outputPerMTok": 20.0},
    "claude-haiku-5-5": {"inputPerMTok": 0.10, "outputPerMTok": 0.50},
}


def price(model: str | None, prices: dict | None = None) -> dict | None:
    """The price of `model`: config's, else the list price, by the longest id it ends with or contains."""
    if not model:
        return None
    table = {**DEFAULT_PRICES, **(prices or {})}
    hits = [k for k in table if model == k or model.endswith(k) or k in model]
    return table[max(hits, key=len)] if hits else None


def usd(usage: dict | None, model: str | None, prices: dict | None = None) -> float:
    """The calls' cost in USD (0 when no usage was reported or the model has no price)."""
    p = price(model, prices)
    if not usage or not p:
        return 0.0
    tin, tout = int(usage.get("input_tokens") or 0), int(usage.get("output_tokens") or 0)
    return round((tin * float(p.get("inputPerMTok", 0)) + tout * float(p.get("outputPerMTok", 0))) / 1_000_000, 6)
