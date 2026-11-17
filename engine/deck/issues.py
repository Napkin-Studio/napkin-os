"""Issues, the read-only part (contract section 7): a severity for a finding and the slide id for a qa.json key.

``deck-repair-loop`` extends this module (ids, fixes, status, the policy file); the visual checklist calls the two
functions below so there is one mapper, not two. No model, no network, no file read.
"""
from __future__ import annotations

from . import spec

#: The contract's default mapping when a policy has no entry for a check (section 7).
DEFAULT_SEVERITY = {"error": "blocker", "warn": "minor"}
DECK_KEY = "deck"


def severity(check: str, level: str, policy: dict | None = None) -> str:
    """``blocker``, ``major`` or ``minor`` for a finding: the policy's ``severity`` map first (by check name, or
    ``check:level``), else the default (error is blocker, warn is minor). An unknown level counts as warn."""
    sev = (policy or {}).get("severity") or {}
    for key in (f"{check}:{level}", check):
        if sev.get(key) in spec.ISSUE_SEVERITIES:
            return sev[key]
    return DEFAULT_SEVERITY.get(level, "minor")


def slide_id_of(qa_key, deck: dict) -> str:
    """The slide id for a qa.json key: a 1-based slide number (``"3"``) through ``deck.order`` (the rendered order),
    ``"deck"`` for the deck-wide key. A number outside the order gives ``"deck"``, never a wrong slide."""
    if qa_key == DECK_KEY:
        return DECK_KEY
    try:
        n = int(qa_key)
    except (TypeError, ValueError):
        return DECK_KEY
    order = deck.get("order") or []
    return order[n - 1] if 1 <= n <= len(order) else DECK_KEY
