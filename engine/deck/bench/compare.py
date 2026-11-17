"""Compare two checklist files (before and after a slice): what moved, per deck.

    python3 -m deck.bench compare BEFORE.json AFTER.json [--format text|md|json] [--fail-on-regress]

An n/a never counts as a pass: yes to n/a and n/a to yes are changes of their own, never "unchanged". Metrics are shown
as before, after and the difference. Decks or items on one side only are listed. Exit 0 unless ``--fail-on-regress`` and
some yes became no. Pure over two files: no model, no network.
"""
from __future__ import annotations

import json

LABEL = {"yes": "yes", "no": "no", "n/a": "n/a", "value": "value"}


def _answer(res: dict | None):
    return None if res is None else (res["value"] if res["answer"] == "value" else res["answer"])


def compare(before: dict, after: dict) -> dict:
    """The diff as data: ``{items_version, decks: {id: {before, after, changes, metrics, only_before, only_after}}, only_before, only_after, regressions}``."""
    out = {"items_version": {"before": before.get("items_version"), "after": after.get("items_version")},
           "decks": {}, "only_before": sorted(set(before["decks"]) - set(after["decks"])),
           "only_after": sorted(set(after["decks"]) - set(before["decks"])), "regressions": 0}
    out["items_changed"] = out["items_version"]["before"] != out["items_version"]["after"]
    for d in sorted(set(before["decks"]) & set(after["decks"])):
        b, a = before["decks"][d], after["decks"][d]
        changes, metrics = [], []
        for item in sorted(set(b["results"]) & set(a["results"])):
            rb, ra = b["results"][item], a["results"][item]
            if rb["answer"] == "value" or ra["answer"] == "value":
                vb, va = _answer(rb), _answer(ra)
                if vb != va:
                    delta = round(va - vb, 4) if isinstance(vb, (int, float)) and isinstance(va, (int, float)) else None
                    metrics.append({"item": item, "before": vb, "after": va, "delta": delta})
            elif rb["answer"] != ra["answer"]:
                changes.append({"item": item, "from": rb["answer"], "to": ra["answer"], "slides": ra.get("slides"), "reason": ra.get("reason")})
        out["regressions"] += sum(1 for c in changes if c["from"] == "yes" and c["to"] == "no")
        out["decks"][d] = {"before": b["summary"] | {"metrics": None}, "after": a["summary"] | {"metrics": None},
                           "changes": changes, "metrics": metrics,
                           "only_before": sorted(set(b["results"]) - set(a["results"])),
                           "only_after": sorted(set(a["results"]) - set(b["results"]))}
    return out


def _counts(s: dict) -> str:
    return f"{s['yes']} yes / {s['no']} no / {s['na']} n/a"


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
                lines.append(f"\n{d} metric {m['item']}: {m['before']} to {m['after']}" + (f" ({m['delta']:+g})" if m["delta"] is not None else ""))
    else:
        for d, x in diff["decks"].items():
            lines.append(f"{d}: {_counts(x['before'])}  ->  {_counts(x['after'])}")
            lines += [f"  {c['item']}: {c['from']} -> {c['to']}" + (f"  slides {', '.join(c['slides'])}" if c.get("slides") else "") for c in x["changes"]]
            lines += [f"  metric {m['item']}: {m['before']} -> {m['after']}" + (f" ({m['delta']:+g})" if m["delta"] is not None else "") for m in x["metrics"]]
            if x["only_before"] or x["only_after"]:
                lines.append(f"  items only before: {x['only_before']}; only after: {x['only_after']}")
    for key, label in (("only_before", "Decks only in BEFORE"), ("only_after", "Decks only in AFTER")):
        if diff[key]:
            lines.append(f"{label}: {', '.join(diff[key])}")
    lines.append(f"Regressions (yes to no): {diff['regressions']}")
    return "\n".join(lines)
