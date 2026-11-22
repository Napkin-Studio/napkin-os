"""Agreement statistics for the vision critic bench, standard library only (feature deck-vision-critic).

A pair is ``(person_fail, other_fail)``: booleans where True is the positive class (a fail). Everything here is
deterministic: the bootstrap takes a seed.
"""
from __future__ import annotations

import math
import random

Z95 = 1.96


def kappa(pairs: list) -> float | None:
    """Cohen's kappa for two raters on a fail/pass call. None (undefined) with no pairs, or when either rater has no
    fails or no passes: there is nothing to agree beyond chance about."""
    n = len(pairs)
    if not n:
        return None
    a1 = sum(1 for a, _ in pairs if a)
    b1 = sum(1 for _, b in pairs if b)
    if a1 in (0, n) or b1 in (0, n):
        return None
    po = sum(1 for a, b in pairs if a == b) / n
    pe = (a1 / n) * (b1 / n) + ((n - a1) / n) * ((n - b1) / n)
    return (po - pe) / (1 - pe)


def wilson_lower(k: int, n: int, z: float = Z95) -> float | None:
    """Lower bound of the Wilson score interval for k successes in n (None with n == 0)."""
    if n <= 0:
        return None
    p = k / n
    d = 1 + z * z / n
    centre = p + z * z / (2 * n)
    margin = z * math.sqrt(p * (1 - p) / n + z * z / (4 * n * n))
    return max(0.0, (centre - margin) / d)


def cluster_bootstrap(rows: list, stat, cluster_of, n_boot: int = 2000, seed: int = 0, level: float = 0.90) -> dict:
    """Percentile interval of ``stat(rows)`` resampling whole clusters (the contents, each with its renders) with
    replacement. A resample where the statistic is undefined is skipped; with under half the resamples defined the
    interval is None. Returns ``{lo, hi, defined, point}``."""
    point = stat(rows)
    groups: dict = {}
    for r in rows:
        groups.setdefault(cluster_of(r), []).append(r)
    keys = sorted(groups, key=str)
    if not keys:
        return {"lo": None, "hi": None, "defined": 0, "point": point}
    rng = random.Random(seed)
    vals = []
    for _ in range(n_boot):
        sample = []
        for _k in keys:
            sample += groups[keys[rng.randrange(len(keys))]]
        v = stat(sample)
        if v is not None:
            vals.append(v)
    if len(vals) < n_boot / 2:
        return {"lo": None, "hi": None, "defined": len(vals), "point": point}
    vals.sort()
    tail = (1 - level) / 2
    lo = vals[int(tail * len(vals))]
    hi = vals[min(len(vals) - 1, int((1 - tail) * len(vals)))]
    return {"lo": lo, "hi": hi, "defined": len(vals), "point": point}


def flip_rate(by_slide: list) -> float | None:
    """``by_slide``: one ``(fail_in_order_1, fail_in_order_2)`` per slide judged in both orders. The flip rate is the
    slides whose answer differs between the orders over the slides where either order says fail; None when no slide
    fails in either order."""
    either = [(a, b) for a, b in by_slide if a or b]
    if not either:
        return None
    return sum(1 for a, b in either if a != b) / len(either)


def self_agreement(pairs: list) -> float | None:
    """Pooled share of repeated answers that match, ``pairs`` being ``(first, second)`` answers over all items."""
    if not pairs:
        return None
    return sum(1 for a, b in pairs if a == b) / len(pairs)


def rate(k: int, n: int) -> float | None:
    return None if n == 0 else k / n
