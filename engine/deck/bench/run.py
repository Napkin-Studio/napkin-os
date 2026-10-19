"""Score a set of decks with judges, in both orders: per-criterion means, the weakest criterion, any 1,
judge agreement, the flip rate, length and a length-adjusted score; then scoring_run_meta and its trust label."""
from __future__ import annotations

import json
from itertools import combinations
from pathlib import Path

from . import packets as P
from .judges import BenchError, check_judgment, norm_family
from .rubric import criterion_ids, load_rubric, resolve_weights, weighted_total
from .stats import ols

ORDERS = ("forward", "reverse")


def _pos(ranking: list) -> dict:
    """Label -> position in a ranking (0 is best)."""
    return {lab: i for i, lab in enumerate(ranking)}


def flip_rate(rank_runs: list) -> dict:
    """The flip rate between the two orders, per judge and overall.

    ``rank_runs`` holds ``{judge, forward, reverse}`` (label lists best first). A pair of decks flips when the judge
    prefers a different one in the two orders; a flip counts as a tie. Returns ``{overall, by_judge, pairs, ties}``
    where ``ties`` are the label pairs that flipped for at least one judge (None rates with under 2 decks)."""
    by, flips, total, ties = {}, 0, 0, set()
    for r in rank_runs:
        f, b = _pos(r["forward"]), _pos(r["reverse"])
        pairs = list(combinations(sorted(f), 2))
        n = fl = 0
        for a, c in pairs:
            n += 1
            if (f[a] < f[c]) != (b[a] < b[c]):
                fl += 1
                ties.add((a, c))
        by[r["judge"]] = round(fl / n, 3) if n else None
        flips, total = flips + fl, total + n
    return {"overall": round(flips / total, 3) if total else None, "by_judge": by, "pairs": total, "ties": sorted(ties)}


def agreement(judgments: list, ids: list) -> dict:
    """Judge agreement over every (deck, criterion) scored by 2 or more judges: the share exactly equal, the share within
    1 point, and the cells that differ by 2 or more (for a person to settle: RUBRIC step 8). None with one judge."""
    judges = sorted({j["judge"] for j in judgments})
    if len(judges) < 2:
        return {"judges": judges, "exact": None, "within_1": None, "disagreements": [], "cells": 0}
    table: dict = {}
    for j in judgments:
        for cid in ids:
            table.setdefault((j["label"], cid), {})[j["judge"]] = j["scores"][cid]["score"]
    exact = near = cells = 0
    dis = []
    for (lab, cid), by in sorted(table.items()):
        vals = list(by.values())
        if len(vals) < 2:
            continue
        spread = max(vals) - min(vals)
        cells += 1
        exact += spread == 0
        near += spread <= 1
        if spread >= 2:
            dis.append({"label": lab, "criterion": cid, "scores": by})
    return {"judges": judges, "exact": round(exact / cells, 3), "within_1": round(near / cells, 3), "disagreements": dis, "cells": cells}


def scoring_run_meta(*, weights: dict, judges: list, orders: list, flip: dict, length: dict, waiver: str | None = None, extra: dict | None = None) -> dict:
    """The run's meta (NAPKIN-EDGE scoring_run_meta): weights source and label, judge families, orders, flip rate,
    length adjustment, a waiver note, and ``trusted`` with the reasons when it is not.

    Trusted needs: 2 or more judge families, or a waiver note together with 3 or more distinct judges (rubric
    principle 6; one judge plus a note is not enough); both orders; a recorded flip rate; a recorded
    length-adjusted score."""
    families = sorted({norm_family(j["family"]) for j in judges})
    why = []
    waived = bool(waiver and waiver.strip())
    if len(families) < 2 and not waived:
        why.append("fewer than 2 judge families and no waiver note")
    elif len(families) < 2 and len({j["judge"] for j in judges}) < 3:
        why.append("a waiver needs 3 or more distinct judges (rubric principle 6)")
    if sorted(orders) != sorted(ORDERS):
        why.append("both orders were not run")
    if flip.get("overall") is None:
        why.append("flip rate not recorded")
    if not length.get("adjusted_recorded"):
        why.append("length-adjusted score not recorded")
    meta = {"weights_source": weights["source"], "weights_label": weights["label"], "judge_families": families,
            "judges": sorted({j["judge"] for j in judges}), "orders": list(orders), "flip_rate": flip.get("overall"),
            "length_adjusted": bool(length.get("adjusted_recorded")), "waiver": waiver, "trusted": not why, "untrusted_because": why}
    meta.update(extra or {})
    return meta


def label_run(meta: dict, label: str = "trusted") -> dict:
    """Stamp ``label`` on a run's meta. ``trusted`` is refused (BenchError) unless scoring_run_meta found it earned;
    any other label (e.g. ``smoke``) is allowed."""
    if label == "trusted" and not meta.get("trusted"):
        raise BenchError("refusing to label this run trusted: " + "; ".join(meta.get("untrusted_because") or ["controls missing"]))
    return {**meta, "label": label}


def length_adjust(rows: list) -> dict:
    """Regress each deck's score on its words and report the adjusted score (score minus slope x (words - mean words)).

    ``rows`` are ``{label, words, total}``. Returns ``{slope_per_100_words, adjusted: {label: x}, adjusted_recorded, note}``;
    with under 3 decks no slope exists, adjusted is empty and ``adjusted_recorded`` is False."""
    use = [r for r in rows if r["total"] is not None]
    fit = ols([r["words"] for r in use], [r["total"] for r in use])
    if not fit:
        return {"slope_per_100_words": None, "adjusted": {}, "adjusted_recorded": False, "note": "length regression needs 3 or more decks with different lengths"}
    slope, _ = fit
    mean_w = sum(r["words"] for r in use) / len(use)
    adj = {r["label"]: round(r["total"] - slope * (r["words"] - mean_w), 3) for r in use}
    return {"slope_per_100_words": round(slope * 100, 4), "adjusted": adj, "adjusted_recorded": True, "note": "adjusted = score - slope x (words - mean words)"}


def run_bench(runs: list, judges: list, *, seed: int = 0, profile_id: str | None = None, rubric: dict | None = None,
              hide: list | None = None, waiver: str | None = None) -> dict:
    """Score the decks in ``runs`` (run directories) with each judge, blind and in both orders.

    Returns the bench.json content: ``seed``, ``mapping`` (label -> run), ``orders``, ``weights``, per-criterion means,
    the weakest criterion, any criterion at 1, deck rows (words, slides, total, adjusted), agreement, flip, judgments
    with ``judge`` and ``family`` on each, and ``scoring_run_meta``. The judges only ever see packets."""
    rubric = rubric or load_rubric()
    ids = criterion_ids(rubric)
    pk, mapping = P.build_packets(runs, seed, hide)
    orders = P.both_orders(pk, seed)
    rids = P.run_ids(runs)
    path_of = dict(zip(rids, runs))
    per_deck = {}
    for lab, rid in mapping.items():
        scoring = json.loads((Path(path_of[rid]) / "deck.json").read_text(encoding="utf-8")).get("scoring")
        per_deck[lab] = resolve_weights(rubric, profile_id, scoring)
    firsts = list(per_deck.values())
    if all(w == firsts[0] for w in firsts):
        weights = firsts[0] if firsts else resolve_weights(rubric, profile_id, None)
    else:   # decks from different tenders: each is totalled on its own weights, and the run says so
        weights = {"source": "mixed", "label": "mixed: each deck on its own weights", "weights": {lab: w["weights"] for lab, w in per_deck.items()}, "buyer_criteria": None}
    by_label = {p["label"]: p for p in pk}
    judgments, rank_runs = [], []
    for jd in judges:
        for p in pk:
            sc = check_judgment(jd.score(p, rubric), rubric, p)
            judgments.append({"judge": jd.name, "family": jd.family, "label": p["label"], "scores": {c: sc[c] for c in ids}})
        rr = {"judge": jd.name, "family": jd.family}
        for o in ORDERS:
            shown = [by_label[lab] for lab in orders[o]]
            rr[o] = jd.rank(shown, rubric, o)
        rank_runs.append(rr)
    means = {c: round(sum(j["scores"][c]["score"] for j in judgments) / len(judgments), 3) for c in ids} if judgments else {}
    rows = []
    for p in pk:
        mine = [j for j in judgments if j["label"] == p["label"]]
        per = {c: sum(j["scores"][c]["score"] for j in mine) / len(mine) for c in ids} if mine else {}
        rows.append({"label": p["label"], "words": p["words"], "slides": p["slides"], "criteria": {c: round(v, 3) for c, v in per.items()}, "total": weighted_total(per, per_deck[p["label"]]["weights"] if per_deck else weights["weights"])})
    la = length_adjust(rows)
    for r in rows:
        r["total"] = None if r["total"] is None else round(r["total"], 3)
        r["adjusted_total"] = la["adjusted"].get(r["label"])
    weakest = min(means, key=lambda c: means[c]) if means else None
    ones = [{"label": j["label"], "judge": j["judge"], "criterion": c} for j in judgments for c in ids if j["scores"][c]["score"] == 1]
    flip = flip_rate(rank_runs)
    meta = scoring_run_meta(weights=weights, judges=judgments, orders=list(ORDERS), flip=flip, length=la, waiver=waiver,
                            extra={"buyer_criteria": weights.get("buyer_criteria"), "decks": len(pk)})
    return {"seed": seed, "mapping": mapping, "orders": orders, "weights": {k: weights[k] for k in ("source", "label", "weights")},
            "criterion_means": means, "weakest_criterion": weakest, "criteria_at_1": ones, "decks": rows,
            "length": la, "agreement": agreement(judgments, ids), "flip": flip, "rankings": rank_runs,
            "judgments": judgments, "scoring_run_meta": meta}
