"""Small statistics in the standard library: ranks, Spearman, least squares, spread."""
from __future__ import annotations

import math


def ranks(xs: list) -> list:
    """Average ranks (1-based; ties share the mean of their positions)."""
    order = sorted(range(len(xs)), key=lambda i: xs[i])
    out = [0.0] * len(xs)
    i = 0
    while i < len(order):
        j = i
        while j + 1 < len(order) and xs[order[j + 1]] == xs[order[i]]:
            j += 1
        for k in range(i, j + 1):
            out[order[k]] = (i + j) / 2 + 1
        i = j + 1
    return out


def pearson(x: list, y: list) -> float | None:
    """Pearson correlation; None when fewer than 2 points or either series is constant."""
    n = len(x)
    if n < 2 or n != len(y):
        return None
    mx, my = sum(x) / n, sum(y) / n
    sxx = sum((a - mx) ** 2 for a in x)
    syy = sum((b - my) ** 2 for b in y)
    if sxx == 0 or syy == 0:
        return None
    return sum((a - mx) * (b - my) for a, b in zip(x, y)) / math.sqrt(sxx * syy)


def spearman(x: list, y: list) -> float | None:
    """Spearman rank correlation (Pearson on average ranks, so ties are handled); None when undefined."""
    return pearson(ranks(x), ranks(y))


def ols(x: list, y: list) -> tuple | None:
    """Least squares ``(slope, intercept)`` of y on x; None with under 3 points or constant x."""
    n = len(x)
    if n < 3 or n != len(y):
        return None
    mx, my = sum(x) / n, sum(y) / n
    sxx = sum((a - mx) ** 2 for a in x)
    if sxx == 0:
        return None
    slope = sum((a - mx) * (b - my) for a, b in zip(x, y)) / sxx
    return slope, my - slope * mx


def sd(xs: list) -> float | None:
    """Sample standard deviation (n-1); None with fewer than 2 values."""
    if len(xs) < 2:
        return None
    m = sum(xs) / len(xs)
    return math.sqrt(sum((v - m) ** 2 for v in xs) / (len(xs) - 1))


def noise_line(rows: list) -> dict:
    """The noise from repeated runs. ``rows`` are ``{client, arm, seed, total}``; cells are (client, arm) with
    2 or more seeds. Returns ``{pooled_sd, cells, seeds_per_cell, line}``; the pooled SD is the root mean of the
    cell variances. With no repeated cell the line says so (no noise estimate)."""
    cells: dict = {}
    for r in rows:
        if r.get("total") is not None:
            cells.setdefault((r["client"], r["arm"]), []).append(r["total"])
    var = [sd(v) ** 2 for v in cells.values() if len(v) >= 2]
    if not var:
        return {"pooled_sd": None, "cells": 0, "seeds_per_cell": None, "line": "noise: not estimated (no client and arm was run with 2 or more seeds)"}
    pooled = math.sqrt(sum(var) / len(var))
    per = sorted({len(v) for v in cells.values() if len(v) >= 2})
    return {"pooled_sd": round(pooled, 3), "cells": len(var), "seeds_per_cell": per,
            "line": f"noise: pooled SD {pooled:.2f} points on the 1-5 weighted total, from {len(var)} client-and-arm cells with repeated seeds"}
