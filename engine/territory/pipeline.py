"""The first-slice pipeline (design steps 1-8): assumed brief, conventions, tensions, seeds, cull, proof, score,
propositions. ``run(task, llm, precedent)`` makes at most six model calls and none when the gate says no.

Everything labelled a design bet in docs/territory-research-2026-11-02.md (the ladder rule, the /35 score,
one-seed-per-cluster) is a working label here, not a validated method. Scores are advisory: a person decides."""
from __future__ import annotations

import json

from . import diversity, intake, ladder
from .llm import prompt

EVIDENCE_RANK = {"observed": 0, "triangulated": 1, "invented": 2}
CAVEAT = "dominant among award winners, not dominant in the market"
THIN_N = 30


def _ask(llm, stage: str, system: str, payload: dict) -> dict:
    obj, _ = llm(stage, system, json.dumps(payload, ensure_ascii=False))
    return obj or {}


def coverage(cases: list[dict]) -> dict:
    n = len(cases)
    label = "empty" if n == 0 else "thin: treat as anecdote" if n < THIN_N else "filled"
    return {"n": n, "label": label}


def _assumed(llm, task, gate) -> dict:
    out = _ask(llm, "assumed_brief", prompt("assumed_brief"),
               {"brief": task.get("fields") or {}, "prompt": task.get("prompt", ""), "category": task["category"], "market": task["market"],
                "thinness": gate["thinness"]})
    fields = []
    for f in out.get("fields") or []:
        tag = f.get("tag") if f.get("tag") in ("given", "inferred", "assumed") else "assumed"
        fields.append({**f, "tag": tag})
    out["fields"] = fields
    out["questions"] = (out.get("questions") or [])[:3]
    return out


def _conventions(llm, task, cases) -> list[dict]:
    ids = {c["id"] for c in cases}
    out = _ask(llm, "conventions", prompt("conventions"), {"category": task["category"], "market": task["market"], "cases": cases})
    res = []
    for i, c in enumerate(out.get("conventions") or []):
        cited = [x for x in (c.get("cases") or []) if x in ids]
        if len(cited) < 3:
            c = {**c, "cases": [], "evidence": "inferred"}
        else:
            c = {**c, "cases": cited, "evidence": "cases"}
        c.setdefault("id", f"c{i + 1}")
        c["caveat"] = c.get("caveat") or CAVEAT
        if CAVEAT not in c["caveat"]:
            c["caveat"] = f"{c['caveat']} ({CAVEAT})"
        res.append(c)
    return res


def _tensions(llm, task, assumed, conventions) -> list[dict]:
    out = _ask(llm, "tensions", prompt("tensions"), {"assumed_brief": assumed, "conventions": conventions})
    ts = [t for t in (out.get("tensions") or []) if t.get("swap_test", "pass") == "pass"]
    ts = [{**t, "evidence": t.get("evidence") if t.get("evidence") in EVIDENCE_RANK else "invented"} for t in ts]
    ts.sort(key=lambda t: EVIDENCE_RANK[t["evidence"]])      # invented tensions sort last
    return ts[:10]


def _seeds(llm, tensions, conventions, n_seeds, threshold):
    recipes = diversity.seed_recipes(n_seeds)
    out = _ask(llm, "seeds", prompt("seeds"), {"tensions": tensions, "conventions": conventions, "recipes": recipes})
    known = {c["id"] for c in conventions}
    seeds = []
    for s in out.get("seeds") or []:
        s = {**s, "breaks": [b for b in (s.get("breaks") or []) if b in known]}
        s["tier"] = ladder.tier(s["breaks"])
        seeds.append(s)
    kept, dropped = diversity.keep_one_per_cluster(seeds, threshold=threshold)
    return kept, dropped, len(seeds)


def _score(llm, kept) -> dict:
    """Blind: the scorer is sent no tier."""
    blind = [{k: s.get(k) for k in ("id", "line", "tension", "mechanism")} for s in kept]
    out = _ask(llm, "score", prompt("score"), {"territories": blind})
    return {r["id"]: r for r in out.get("scores") or [] if "id" in r}


def _choose(kept, scores, max_keep) -> list[dict]:
    """Best total first, no two sharing a mechanism, and keep one deliberately Safe territory if any exists."""
    for s in kept:
        sc = scores.get(s["id"]) or {}
        s["score"] = {"total": ladder.total(sc), "of": ladder.MAX_SCORE, "by_dimension": {d: sc.get(d) for d in ladder.SCORE_DIMS}, "reasons": sc.get("reasons") or {}, "advisory": True}
    ranked = sorted(kept, key=lambda s: -s["score"]["total"])
    chosen, mechs = [], set()
    for s in ranked:
        m = (s.get("mechanism") or "").strip().lower()
        if m and m in mechs:
            continue
        chosen.append(s)
        mechs.add(m)
        if len(chosen) == max_keep:
            break
    if chosen and not any(s["tier"] == "safe" for s in chosen):
        safe = next((s for s in ranked if s["tier"] == "safe" and s not in chosen), None)
        if safe:
            chosen[-1] = safe
    return chosen


def _proof(terr: dict, cases: list[dict], brief_category: str) -> dict | None:
    """The best-matching precedent by word overlap, preferring another category (borrow the mechanism)."""
    text = f"{terr.get('line', '')} {terr.get('mechanism', '')}"
    best, best_s = None, 0.0
    for c in cases:
        s = diversity.jaccard(text, f"{c.get('title', '')} {c.get('summary', '')}")
        if c.get("category") and c.get("category") != brief_category:
            s += 0.05
        if s > best_s:
            best, best_s = c, s
    if not best:
        return None
    return {"id": best["id"], "brand": best.get("brand"), "title": best.get("title"), "year": best.get("year"),
            "source_url": best.get("source_url"), "evidence_level": best.get("evidence_level", "creative-only: inspiration, not proof"),
            "badge": "VERIFIED" if best.get("verified") else "UNVERIFIED", "note": "borrow the mechanism, not the execution"}


def run(task: dict, llm, precedent=None, n_seeds: int = 30, max_keep: int = 5, threshold: float = 0.4) -> dict:
    """task: {fields, category, market, prompt, brand, asked}. precedent: callable(category, market) -> [case dicts]."""
    gate = intake.assess(task.get("fields"), task.get("category"), task.get("market"), task.get("prompt", ""), task.get("brand"), task.get("asked", False))
    res = {"status": gate["action"], "gate": gate, "territories": [], "banner": None}
    if gate["action"] != "proceed":
        return res
    cases = list(precedent(task["category"], task["market"])) if precedent else []
    res["coverage"] = coverage(cases)
    if gate["assumption_dependent"]:
        res["banner"] = "Built on an assumed brief. Confirm the category and audience before relying on these."
    assumed = _assumed(llm, task, gate)
    conventions = _conventions(llm, task, cases)
    tensions = _tensions(llm, task, assumed, conventions)
    kept, dropped, n_made = _seeds(llm, tensions, conventions, n_seeds, threshold)
    scores = _score(llm, kept)
    chosen = _choose(kept, scores, max_keep)
    props = {p["id"]: p for p in (_ask(llm, "propositions", prompt("propositions"), {"territories": [{k: s.get(k) for k in ("id", "line", "tension", "mechanism")} for s in chosen]}).get("propositions") or [])}
    by_tension = {t["id"]: t for t in tensions}
    out = []
    for s in chosen:
        p = props.get(s["id"]) or {}
        wordings = p.get("wordings") or []
        valid = [(w, ladder.proposition_ok(w)) for w in wordings]
        good = next((w for w, (ok, _) in valid if ok), None)
        t = by_tension.get(s.get("tension"), {})
        dep = gate["assumption_dependent"] or t.get("evidence") == "invented"
        out.append({**s, "tension_text": t.get("x_but_y"), "tension_evidence": t.get("evidence", "invented"),
                    "proposition": good, "proposition_ok": good is not None,
                    "proposition_problems": [r for _, (ok, rs) in valid if not ok for r in rs],
                    "would_have_to_be_true": p.get("would_have_to_be_true") or [], "cheapest_test": p.get("cheapest_test"),
                    "proof": _proof(s, cases, task["category"]), "assumption_dependent": dep, "ready": not dep})
    res.update(territories=out, assumed_brief=assumed, conventions=conventions, tensions=tensions,
               diversity={"seeds_made": n_made, "kept_after_clustering": len(kept), "duplicate_rate": diversity.duplicate_rate(kept, dropped)},
               spread_ok=ladder.spread_ok(out), notes=[] if len(out) >= 3 else [f"only {len(out)} territories survived the cull"],
               client_questions=assumed.get("questions", []))
    return res
