"""The one price table (engine/prices.json) and the arithmetic every tool prices tokens with.

Before 19 Nov 2026 there were three tables that disagreed: deck/spec.py (Opus 5.5 and Sonnet 5.5 only, cache reads at 0.05x, Haiku and
every other model priced as Opus), territory/cost.py (a stand-in copy) and server/napkin/runlog.py (cache reads at 0.1x for every model,
and Opus 5.5 caught by its generic ``claude-opus`` key at 5/25). Both cache shares were right for some models and wrong for others: a cache
read is listed per model here. deck/spec.py, territory/cost.py and rag/e2e_eval.py call this module; server/napkin/runlog.py and server/tools/run_report.py
read the same JSON file."""
from __future__ import annotations

import json
from functools import lru_cache
from pathlib import Path

PATH = Path(__file__).resolve().parent / "prices.json"   # engine/prices.json


@lru_cache(maxsize=1)
def table() -> dict:
    return json.loads(PATH.read_text())


def version() -> str:
    return table()["version"]


def model_name(model: str | None) -> str:
    """The model's own id, without a wire or a Bedrock region and provider: 'bedrock/global.anthropic.claude-opus-5-5' and
    'eu.anthropic.claude-opus-5-5' are both 'claude-opus-5-5'."""
    m = str(model or "").strip()
    m = m.rsplit("/", 1)[-1]
    if "anthropic." in m:
        m = m.split("anthropic.", 1)[1]
    return m


def lookup(model: str | None) -> tuple[float, float, float] | None:
    """``(input, output, cache read)`` USD per million tokens for the longest listed prefix of the model's id; None when nothing matches."""
    m = model_name(model)
    models = table()["models"]
    best = max((k for k in models if m.startswith(k)), key=len, default=None)
    return tuple(float(x) for x in models[best]) if best else None


def priced(model: str | None) -> tuple[float, float, float]:
    """``lookup``, with an unlisted id priced as ``unlisted_as`` (never 0)."""
    return lookup(model) or lookup(table()["unlisted_as"])


def usd(model: str | None, tokens_in: int, tokens_out: int, cache_read: int = 0, cache_write: int = 0) -> float:
    """Dollars for one call. ``tokens_in`` is the UNCACHED input (Anthropic's ``input_tokens``); the cache reads and writes are separate
    counts. ``model`` may be a comma list (a summed stage): the dearest of them prices the lot, and one unlisted name prices it as
    ``unlisted_as`` at least, so an estimate is never low."""
    names = [x.strip() for x in str(model or "").split(",") if x.strip()]
    rows = [priced(n) for n in names] or [priced(None)]
    pin, pout, pread = max(rows, key=lambda r: r[1])
    w = float(table()["cache_write_mult"])
    return round(((tokens_in or 0) * pin + (tokens_out or 0) * pout + (cache_read or 0) * pread + (cache_write or 0) * pin * w) / 1e6, 6)


def search_usd() -> float:
    """What one web search costs (a Tavily advanced search: credits x the credit price), from the table, never a constant elsewhere."""
    s = table().get("search") or {}
    return round(float(s.get("tavily_credit_usd", 0.008)) * float(s.get("tavily_credits_per_search", 2)), 6)
