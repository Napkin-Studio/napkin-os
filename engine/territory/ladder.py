"""Safe / Stretch / Brave by a stated rule, never by mood (design step 7). The count of dominant conventions a
territory breaks places it: 0 is Safe, 1 is Stretch, 2 or more is Brave. The conventions are model-inferred and
unvalidated, so the tier is a working label for Laurence to check."""
from __future__ import annotations

SCORE_DIMS = ["fit", "truth", "ownability", "distinct", "travel", "fame", "assets"]   # 7 x 5 = 35
MAX_SCORE = 5 * len(SCORE_DIMS)


def tier(breaks: list) -> str:
    n = len(set(breaks or []))
    return "safe" if n == 0 else "stretch" if n == 1 else "brave"


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
