"""The calibration report: python -m napkin.judge.calibrate <export.json>

Reads the telemetry export ({"rows": [...]}: ids, numbers and codes only, no content) and says whether a
Judge version has earned trust: how often its advised route agrees with what the creative director then
did, whether the same version repeats itself, and which tests flip. It measures pieces of work, never people.
"""

from __future__ import annotations

import json
import math
import sys
from collections import defaultdict

MIN_DECIDED, MIN_EACH, MIN_AGREE_LOWER, MIN_REPEAT, MAX_FLIP = 60, 20, 0.80, 0.95, 0.10


def wilson_lower(k: int, n: int, z: float = 1.96) -> float:
    if n == 0:
        return 0.0
    p = k / n
    d = 1 + z * z / n
    centre = p + z * z / (2 * n)
    margin = z * math.sqrt(p * (1 - p) / n + z * z / (4 * n * n))
    return max(0.0, (centre - margin) / d)


def _expected(route: str) -> str:
    return "returned" if route == "team" else "kept"


def report(rows: list[dict]) -> dict:
    # the newest score of each piece+version is the one the director saw; decided pieces only
    decided = {}
    for r in sorted(rows, key=lambda r: r.get("at", "")):
        d = (r.get("then") or {}).get("decision")
        if d in ("kept", "returned"):
            decided[(r.get("piece"), r.get("work_hash"), r.get("judge_version"))] = r
    n = len(decided)
    kept = sum(1 for r in decided.values() if r["then"]["decision"] == "kept")
    agree = sum(1 for r in decided.values() if _expected(r["advised_route"]) == r["then"]["decision"])
    groups = defaultdict(list)
    for r in rows:
        groups[(r.get("piece"), r.get("work_hash"), r.get("judge_version"))].append(r)
    repeated = {k: v for k, v in groups.items() if len(v) > 1}
    same = sum(1 for v in repeated.values() if len({x["advised_route"] for x in v}) == 1)
    flips, seen = defaultdict(int), defaultdict(int)
    for v in repeated.values():
        values = defaultdict(set)
        for x in v:
            for t in x.get("tests", []):
                values[t["id"]].add(t["value"])
        for tid, vals in values.items():
            seen[tid] += 1
            flips[tid] += len(vals) > 1
    flip_rate = {t: flips[t] / seen[t] for t in seen if flips[t]}
    out = {"decided": n, "kept": kept, "returned": n - kept, "agree": agree,
           "agreement": agree / n if n else None, "agreement_lower": wilson_lower(agree, n),
           "repeated_pieces": len(repeated), "repeat": same / len(repeated) if repeated else None,
           "flips": dict(sorted(flip_rate.items(), key=lambda kv: -kv[1]))}
    why = []
    if n < MIN_DECIDED:
        why.append(f"only {n} decided pieces; {MIN_DECIDED} are needed")
    if kept < MIN_EACH or n - kept < MIN_EACH:
        why.append(f"{kept} kept and {n - kept} returned; at least {MIN_EACH} of each are needed")
    if out["agreement_lower"] < MIN_AGREE_LOWER:
        why.append(f"agreement lower bound {out['agreement_lower']:.2f} is under {MIN_AGREE_LOWER:.2f}")
    if out["repeat"] is None or out["repeat"] < MIN_REPEAT:
        why.append("repeat route agreement " + ("not measured: score a sample twice" if out["repeat"] is None
                                                else f"{out['repeat']:.2f} is under {MIN_REPEAT:.2f}"))
    bad = [t for t, f in flip_rate.items() if f > MAX_FLIP]
    if bad:
        why.append(f"{len(bad)} tests flip on repeat more than {int(MAX_FLIP * 100)} percent: {', '.join(bad)}")
    out["earned"], out["failing"] = not why, why
    return out


def render(r: dict) -> str:
    pct = lambda x: "n/a" if x is None else f"{x * 100:.0f} percent"  # noqa: E731
    lines = [f"Decided pieces: {r['decided']} ({r['kept']} kept, {r['returned']} returned)",
             f"Agreement with the creative director: {pct(r['agreement'])} (lower bound {pct(r['agreement_lower'])})",
             f"Repeatability: {pct(r['repeat'])} of {r['repeated_pieces']} pieces scored twice kept the same route"]
    lines += [f"Test flips: {t} {pct(f)}" for t, f in r["flips"].items()] or ["Test flips: none"]
    lines.append("earned: " + ("yes" if r["earned"] else "no"))
    lines += [f"  - {w}" for w in r["failing"]]
    lines.append("Advice only until a recorded decision marks this Judge version as earned.")
    return "\n".join(lines)


def main(argv=None) -> int:
    argv = sys.argv[1:] if argv is None else argv
    if len(argv) != 1:
        print("usage: python -m napkin.judge.calibrate <export.json>", file=sys.stderr)
        return 2
    with open(argv[0]) as f:
        rows = json.load(f).get("rows", [])
    print(render(report(rows)))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
