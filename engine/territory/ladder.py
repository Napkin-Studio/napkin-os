"""Safe / Stretch / Brave by stated definition (Laurence's cut of the conventions step, 2 Nov 2026), judged by a model
after the kill gate. Safe answers the brief as written; Stretch is the same job through a sharper door; Brave changes
the shape (the media, behaviour or format becomes the idea). The placement is a working label for a person to check."""
from __future__ import annotations

TIERS = ("safe", "stretch", "brave")


def clean_tier(x) -> tuple[str, bool]:
    """(tier, defaulted): an unknown or missing tier reads as stretch and is flagged."""
    x = str(x or "").strip().lower()
    return (x, False) if x in TIERS else ("stretch", True)


SCORE_DIMS = ["fit", "truth", "ownability", "distinct", "travel", "fame", "assets"]   # 7 x 5 = 35
MAX_SCORE = 5 * len(SCORE_DIMS)


def total(scores: dict) -> int:
    """Sum of the seven dimensions, each clamped to 1-5; a missing one counts 1."""
    t = 0
    for d in SCORE_DIMS:
        try:
            v = int(round(float((scores or {}).get(d, 1))))
        except (TypeError, ValueError):
            v = 1
        t += max(1, min(5, v))
    return t


def spread_ok(terrs: list[dict]) -> bool:
    """No two survivors share a mechanism."""
    seen = set()
    for t in terrs:
        m = (t.get("mechanism") or "").strip().lower()
        if m and m in seen:
            return False
        seen.add(m)
    return True


def proposition_ok(text: str, limit: int = 20) -> tuple[bool, list[str]]:
    """House SMP rule: one thought, at most 20 words, no 'and'. Returns (ok, reasons)."""
    words = (text or "").split()
    reasons = []
    if not words:
        reasons.append("empty")
    if len(words) > limit:
        reasons.append(f"{len(words)} words, limit {limit}")
    if any(w.strip(".,;:!?").lower() == "and" for w in words):
        reasons.append("contains 'and': two thoughts")
    return (not reasons), reasons
