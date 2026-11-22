"""Compare two checklist files (before and after a slice): what moved, per deck.

    python3 -m deck.bench compare BEFORE.json AFTER.json [--format text|md|json] [--fail-on-regress] [--tolerance X]

An n/a never counts as a pass: yes to n/a and n/a to yes are changes of their own, never "unchanged". Metrics are shown
as before, after and the difference. Decks or items on one side only are listed. Exit 0 unless ``--fail-on-regress`` and there is a
regression (yes to no, n/a to no, a metric moved the worse way past ``--tolerance``) or lost coverage (yes to n/a, a metric
that became n/a, a deck or an item gone, a changed items version). Pure over two files: no model, no network.
"""
from __future__ import annotations

import json
from pathlib import Path

LABEL = {"yes": "yes", "no": "no", "n/a": "n/a", "value": "value"}


def _answer(res: dict | None):
    return None if res is None else (res["value"] if res["answer"] == "value" else res["answer"])


def directions() -> dict:
    """``{metric id: higher|lower}`` from checklist.json: which way a metric should move."""
    from .checklist import load_items
    return {i["id"]: i.get("direction") for i in load_items()["items"] if i["kind"] == "metric"}


def tiers() -> dict:
    """``{item id: gate|advisory}`` from checklist.json. An item the list does not know is a gate."""
    from .checklist import load_items
    return {i["id"]: i.get("tier", "gate") for i in load_items()["items"]}


def compare(before: dict, after: dict, tolerance: float = 0.0, direction: dict | None = None, tier: dict | None = None) -> dict:
    """The diff as data: ``{items_version, decks: {id: {before, after, changes, metrics, only_before, only_after}}, only_before,
    only_after, regressions, lost_coverage, metric_regressions, advisory}``. ``regressions`` counts yes to no and n/a to no;
    ``lost_coverage`` counts yes to n/a, a metric that became n/a, a deck or item gone and a changed items version;
    ``metric_regressions`` counts metrics that moved the worse way by more than ``tolerance`` (direction ``same``: any
    change). Only gate items count in those; advisory items are counted in ``advisory`` and shown, never failing."""
    sb, sa = before.get("size", "16:9"), after.get("size", "16:9")
    if sb != sa:   # deck-slide-size: a 4:3 run against a 16:9 baseline shows false regressions; compare one size with itself
        raise ValueError(f"the two checklists were built at different slide sizes ({sb} and {sa}): compare each size with its own baseline "
                         "(bench/baseline/checklist.json is 16:9; checklist_4x3.json and checklist_a4.json hold the others)")
    direction = direction if direction is not None else directions()
    tier = tier if tier is not None else tiers()
    gate = lambda item: tier.get(item, "gate") == "gate"
    out = {"items_version": {"before": before.get("items_version"), "after": after.get("items_version")},
           "decks": {}, "only_before": sorted(set(before["decks"]) - set(after["decks"])),
           "only_after": sorted(set(after["decks"]) - set(before["decks"])), "regressions": 0, "metric_regressions": 0, "advisory": 0}
    out["items_changed"] = out["items_version"]["before"] != out["items_version"]["after"]
    out["lost_coverage"] = len(out["only_before"]) + int(out["items_changed"])
    for d in sorted(set(before["decks"]) & set(after["decks"])):
        b, a = before["decks"][d], after["decks"][d]
        changes, metrics = [], []
        for item in sorted(set(b["results"]) & set(a["results"])):
            rb, ra = b["results"][item], a["results"][item]
            if rb["answer"] == "value" or ra["answer"] == "value":
                vb, va = _answer(rb), _answer(ra)
                if vb != va:
                    num = isinstance(vb, (int, float)) and isinstance(va, (int, float))
                    delta = round(va - vb, 4) if num else None
                    both = rb["answer"] == "value" and ra["answer"] == "value"
                    worse = (direction.get(item) == "same" and both) or bool(num and ((direction.get(item) == "higher" and delta < -tolerance) or (direction.get(item) == "lower" and delta > tolerance)))
                    lost = rb["answer"] == "value" and ra["answer"] != "value"
                    metrics.append({"item": item, "before": vb, "after": va, "delta": delta, "direction": direction.get(item), "worse": bool(worse), "lost": lost, "tier": tier.get(item, "gate")})
                    if gate(item):
                        out["metric_regressions"] += int(bool(worse))
                        out["lost_coverage"] += int(lost)
                    else:
                        out["advisory"] += int(bool(worse or lost))
            elif rb["answer"] != ra["answer"]:
                changes.append({"item": item, "from": rb["answer"], "to": ra["answer"], "slides": ra.get("slides"), "reason": ra.get("reason"), "tier": tier.get(item, "gate")})
        out["regressions"] += sum(1 for c in changes if c["tier"] == "gate" and c["to"] == "no" and c["from"] in ("yes", "n/a"))
        out["advisory"] += sum(1 for c in changes if c["tier"] != "gate" and c["to"] == "no" and c["from"] in ("yes", "n/a"))
        out["lost_coverage"] += sum(1 for c in changes if c["tier"] == "gate" and c["from"] == "yes" and c["to"] == "n/a") + len(set(b["results"]) - set(a["results"]))
        out["decks"][d] = {"before": b["summary"] | {"metrics": None}, "after": a["summary"] | {"metrics": None},
                           "changes": changes, "metrics": metrics,
                           "only_before": sorted(set(b["results"]) - set(a["results"])),
                           "only_after": sorted(set(a["results"]) - set(b["results"]))}
    return out


def _counts(s: dict) -> str:
    return f"{s['yes']} yes / {s['no']} no / {s['na']} n/a"


def failed(diff: dict) -> bool:
    """True when ``--fail-on-regress`` should exit non-zero."""
    return bool(diff["regressions"] or diff["metric_regressions"] or diff["lost_coverage"])


def _flag(m: dict) -> str:
    """The marks after a metric line: WORDS CHANGED (direction same), WORSE, and (advisory)."""
    return (" WORDS CHANGED" if m["worse"] and m["direction"] == "same" else " WORSE" if m["worse"] else "") + (" (advisory)" if m["tier"] != "gate" else "")


def render(diff: dict, fmt: str = "text") -> str:
    """The diff as text, a Markdown table for a PR body, or JSON."""
    if fmt == "json":
        return json.dumps(diff, indent=1, ensure_ascii=False)
    md = fmt == "md"
    lines = []
    if diff["items_changed"]:
        lines.append(f"Note: the checklist items changed (version {diff['items_version']['before']} to {diff['items_version']['after']}).")
    if md:
        lines += ["| Deck | Before | After | Changed items |", "|---|---|---|---|"]
        for d, x in diff["decks"].items():
            ch = "; ".join(f"{c['item']} {c['from']} to {c['to']}" for c in x["changes"]) or "none"
            lines.append(f"| {d} | {_counts(x['before'])} | {_counts(x['after'])} | {ch} |")
        for d, x in diff["decks"].items():
            for m in x["metrics"]:
                lines.append(f"\n{d} metric {m['item']}: {m['before']} to {m['after']}" + (f" ({m['delta']:+g})" if m["delta"] is not None else "") + _flag(m))
    else:
        for d, x in diff["decks"].items():
            lines.append(f"{d}: {_counts(x['before'])}  ->  {_counts(x['after'])}")
            lines += [f"  {c['item']}: {c['from']} -> {c['to']}" + ("  (advisory)" if c["tier"] != "gate" else "") + (f"  slides {', '.join(c['slides'])}" if c.get("slides") else "") for c in x["changes"]]
            lines += [f"  metric {m['item']}: {m['before']} -> {m['after']}" + (f" ({m['delta']:+g})" if m["delta"] is not None else "") + _flag(m) for m in x["metrics"]]
            if x["only_before"] or x["only_after"]:
                lines.append(f"  items only before: {x['only_before']}; only after: {x['only_after']}")
    for key, label in (("only_before", "Decks only in BEFORE"), ("only_after", "Decks only in AFTER")):
        if diff[key]:
            lines.append(f"{label}: {', '.join(diff[key])}")
    lines.append(f"Regressions (yes or n/a to no): {diff['regressions']}; metrics worse: {diff['metric_regressions']}; lost coverage: {diff['lost_coverage']}; advisory (never failing): {diff['advisory']}")
    return "\n".join(lines)
