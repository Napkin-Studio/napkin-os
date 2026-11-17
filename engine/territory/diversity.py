"""Step 5 helpers: a grid of distinct seed recipes, and one-per-cluster filtering. Pure code, no model.
The similarity function is injectable; the default is word overlap, so tests need no embedding service."""
from __future__ import annotations

import re
from itertools import product

FRAMINGS = ["a truth about the audience", "a tension in the category", "a moment in the day or year", "a ritual worth keeping", "a fear nobody names"]
INVERSIONS = ["drop the convention", "reverse it", "exaggerate it", "borrow a code from elsewhere", "keep it and make it honest"]
ANALOGIES = ["sport", "film", "science", "music", "nature", "history", "everyday behaviour", "craft"]
CONSTRAINTS = ["a person who is sceptical", "a person who is time-poor", "a person who is loyal", "a person who is new to the category"]


def seed_recipes(n: int = 30, framings=None, inversions=None, analogies=None, constraints=None) -> list[dict]:
    """n recipes, each a different combination, spread evenly over the grid (deterministic: no randomness)."""
    grid = list(product(framings or FRAMINGS, inversions or INVERSIONS, analogies or ANALOGIES, constraints or CONSTRAINTS))
    if n >= len(grid):
        picked = grid
    else:
        step = len(grid) / n
        picked = [grid[int(i * step)] for i in range(n)]
    return [{"id": f"r{i + 1}", "framing": f, "inversion": v, "analogy": a, "constraint": c} for i, (f, v, a, c) in enumerate(picked)]


def _words(text: str) -> set:
    return set(re.findall(r"[a-z]{3,}", (text or "").lower()))


def jaccard(a: str, b: str) -> float:
    wa, wb = _words(a), _words(b)
    return len(wa & wb) / len(wa | wb) if wa and wb else 0.0


def keep_one_per_cluster(items: list[dict], text=lambda x: x.get("line", "") + " " + x.get("mechanism", ""),
                         sim=jaccard, threshold: float = 0.4) -> tuple[list[dict], list[dict]]:
    """Greedy: walk the items in order, drop one whose similarity to an item already kept is at or above the
    threshold. Returns (kept, dropped). The order is the caller's priority."""
    kept, dropped = [], []
    for it in items:
        if any(sim(text(it), text(k)) >= threshold for k in kept):
            dropped.append(it)
        else:
            kept.append(it)
    return kept, dropped


def duplicate_rate(kept: list[dict], dropped: list[dict]) -> float:
    total = len(kept) + len(dropped)
    return round(len(dropped) / total, 2) if total else 0.0
