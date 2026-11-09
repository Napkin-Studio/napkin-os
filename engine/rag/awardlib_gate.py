"""
awardlib_gate.py — the one place that decides whether the award case library may be shown.

ADR 0033 gates the library behind RAG_AWARDLIB (off | thin | on). The gate began inside
brief_context._bucket_hits; the Brief Maker's retrieval service (features/award-in-brief-maker)
needs the same decision without calling brief_context, so the rule lives here and both call it.
Two copies would drift, and a drift here silently shows reconstructed cases where the index is
already rich (ADR 0033, experiment 1).

    decide(store, category, mode=None) -> Decision(admit, note)

    off   admit nothing (the default; unset or empty means off).
    on    admit everywhere, no gate (what the experiments ran).
    thin  admit only when the category is known and the index holds fewer than
          RAG_AWARDLIB_THIN_MAX (default 30) cases of its own in it.

The gate fails closed: no category, a store that cannot count, or a count that raises all
withhold the library. An unknown RAG_AWARDLIB value raises, like RAG_VALIDATOR: a typo must not
leave the gate in the wrong state. The note strings are part of the contract the trace and the
tests read; change them together.
"""
from __future__ import annotations

import os
import time
from typing import NamedTuple

AWARDLIB_SOURCE = "awardlib"
AWARDLIB_MODES = ("off", "thin", "on")
AWARDLIB_THIN_MAX_DEFAULT = 30
# Sources that are served as cases (a parent chunk per case). D&AD is excluded: its parents
# are discipline groups, and it is stage=production, which the brief never reads.
AWARDLIB_BASELINE_SOURCES = ("ipa", "effie", "cannes")
_COUNTS_TTL_S = 600
_counts_cache: dict = {}


class Decision(NamedTuple):
    admit: bool
    note: str


def awardlib_mode() -> str:
    """RAG_AWARDLIB as one of AWARDLIB_MODES; unset or empty means off. An unknown value
    raises: a typo must not silently leave the gate in the wrong state."""
    raw = (os.environ.get("RAG_AWARDLIB") or "off").strip().lower()
    if raw not in AWARDLIB_MODES:
        raise ValueError(f"RAG_AWARDLIB={raw!r}: expected one of {', '.join(AWARDLIB_MODES)}")
    return raw


def awardlib_thin_max() -> int:
    """RAG_AWARDLIB_THIN_MAX: a category is thin when the index holds fewer cases than this."""
    raw = (os.environ.get("RAG_AWARDLIB_THIN_MAX") or "").strip()
    if not raw:
        return AWARDLIB_THIN_MAX_DEFAULT
    try:
        n = int(raw)
    except ValueError:
        n = 0
    if n < 1:
        raise ValueError(f"RAG_AWARDLIB_THIN_MAX={raw!r}: expected a positive integer")
    return n


def category_case_counts(store) -> dict | None:
    """{category: cases the index holds of its own}, counted from the store (cached for
    _COUNTS_TTL_S), or None when the store cannot count or fails. None makes the gate
    withhold the library: not knowing a category is thin is not a reason to add to it."""
    import contract
    count_where = getattr(store, "count_where", None)
    if count_where is None:
        return None
    hit = _counts_cache.get(id(store))
    if hit and hit[0] is store and time.time() - hit[1] < _COUNTS_TTL_S:
        return hit[2]
    try:
        counts = {c: int(count_where({"source": {"in": list(AWARDLIB_BASELINE_SOURCES)},
                                      "level": "parent", "status": {"ne": "superseded"},
                                      "category": c}))
                  for c in contract.SCHEMA.enum_values("category")}
    except Exception:                       # a store that cannot answer is "unknown", never "thin"
        return None
    _counts_cache[id(store)] = (store, time.time(), counts)
    return counts


def decide(store, category: str | None, mode: str | None = None) -> Decision:
    """May the library be shown for a brief in `category`? `mode` defaults to RAG_AWARDLIB.
    The note says why, in the words the trace carries."""
    mode = awardlib_mode() if mode is None else mode
    if mode not in AWARDLIB_MODES:
        raise ValueError(f"awardlib mode {mode!r}: expected one of {', '.join(AWARDLIB_MODES)}")
    if mode == "off":
        return Decision(False, "awardlib: off")
    if mode == "on":
        return Decision(True, "awardlib: on, no gate")
    if not category:
        return Decision(False, "awardlib: withheld, the brief has no category")
    counts = category_case_counts(store)
    if counts is None:
        return Decision(False, "awardlib: withheld, the store cannot count cases")
    have, limit = counts.get(category, 0), awardlib_thin_max()
    if have >= limit:
        return Decision(False, f"awardlib: not needed, {category} has {have} cases (limit {limit})")
    return Decision(True, f"awardlib: admitted for {category} ({have} cases < {limit})")
