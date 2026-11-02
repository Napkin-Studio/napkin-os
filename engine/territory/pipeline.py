"""The first-slice pipeline: assumed brief, tensions, 30 seeds, a kill gate, the Safe/Stretch/Brave sort, a blind score,
propositions, proof cases. ``run(task, llm, precedent)`` makes at most seven model calls and none when the gate says no.
Laurence cut the conventions step on 2 Nov 2026 and added the kill gate straight after the seeds.

Everything labelled a design bet in docs/territory-research-2026-11-02.md (the ladder, the /35 score,
one-seed-per-cluster) is a working label here, not a validated method. Scores are advisory: a person decides."""
from __future__ import annotations

import json

from . import diversity, intake, ladder
from .llm import prompt

EVIDENCE_RANK = {"observed": 0, "triangulated": 1, "invented": 2}
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


def _tensions(llm, task, assumed) -> list[dict]:
    out = _ask(llm, "tensions", prompt("tensions"), {"assumed_brief": assumed})
    ts = [t for t in (out.get("tensions") or []) if t.get("swap_test", "pass") == "pass"]
    ts = [{**t, "evidence": t.get("evidence") if t.get("evidence") in EVIDENCE_RANK else "invented"} for t in ts]
    ts.sort(key=lambda t: EVIDENCE_RANK[t["evidence"]])      # invented tensions sort last
    return ts[:10]


def _seeds(llm, tensions, n_seeds, threshold):
    recipes = diversity.seed_recipes(n_seeds)
    out = _ask(llm, "seeds", prompt("seeds"), {"tensions": tensions, "recipes": recipes})
    seeds = list(out.get("seeds") or [])
    kept, dropped = diversity.keep_one_per_cluster(seeds, threshold=threshold)
    return kept, dropped, len(seeds)


def _kill(llm, task, assumed, tensions, seeds, min_keep) -> tuple[list[dict], list[dict], list[dict]]:
    """The kill gate (Laurence, 2 Nov 2026): drop the weak seeds before they are sorted onto the ladder.
    Returns (survivors, killed, restored). A seed the gate did not judge is kept and flagged. If fewer than
    min_keep survive, the strongest killed seeds are restored and flagged, so the run never ends empty-handed."""
    blind = [{k: s.get(k) for k in ("id", "line", "tension", "mechanism")} for s in seeds]
    out = _ask(llm, "kill", prompt("kill_gate"), {"assumed_brief": assumed, "tensions": tensions, "seeds": blind})
    verdicts = {v["id"]: v for v in out.get("verdicts") or [] if "id" in v}
    survivors, killed = [], []
    for s in seeds:
        v = verdicts.get(s["id"])
        if v is None:
            survivors.append({**s, "kill_gate": {"judged": False}})
        elif v.get("keep") is True:
            survivors.append({**s, "kill_gate": {"judged": True, "strength": v.get("strength")}})
        else:
            killed.append({**s, "kill_gate": {"judged": True, "strength": v.get("strength"), "tests": v.get("tests") or {}}})
    restored = []
    if len(survivors) < min_keep:
        for s in sorted(killed, key=lambda s: -(s["kill_gate"].get("strength") or 0)):
            if len(survivors) >= min_keep:
                break
            s["kill_gate"]["restored"] = True
            survivors.append(s)
            restored.append(s)
        killed = [s for s in killed if s not in restored]
    return survivors, killed, restored


def _sort(llm, survivors) -> list[dict]:
    """Place each survivor on the ladder by the stated definitions. The scorer never sees this."""
    out = _ask(llm, "sort", prompt("sort"), {"territories": [{k: s.get(k) for k in ("id", "line", "tension", "mechanism")} for s in survivors]})
    by = {x["id"]: x for x in out.get("tiers") or [] if "id" in x}
    res = []
    for s in survivors:
        x = by.get(s["id"]) or {}
        tier, defaulted = ladder.clean_tier(x.get("tier"))
        res.append({**s, "tier": tier, "tier_reason": x.get("reason"), "tier_defaulted": defaulted})
    return res


def _score(llm, kept) -> dict:
    """Blind: the scorer is sent no tier."""
    blind = [{k: s.get(k) for k in ("id", "line", "tension", "mechanism")} for s in kept]
    out = _ask(llm, "score", prompt("score"), {"territories": blind})
    return {r["id"]: r for r in out.get("scores") or [] if "id" in r}


def _choose(kept, scores, max_keep, min_keep=3) -> list[dict]:
    """Best total first, no two sharing a mechanism or a tension (relaxed only to reach min_keep), and keep one
    deliberately Safe territory if any exists."""
    for s in kept:
        sc = scores.get(s["id"]) or {}
        s["score"] = {"total": ladder.total(sc), "of": ladder.MAX_SCORE, "by_dimension": {d: sc.get(d) for d in ladder.SCORE_DIMS}, "reasons": sc.get("reasons") or {}, "advisory": True}
    ranked = sorted(kept, key=lambda s: -s["score"]["total"])
    min_keep = min(min_keep, max_keep)
    chosen, mechs, tens = [], set(), set()

    def take(s, unique_tension):
        m = (s.get("mechanism") or "").strip().lower()
        if (m and m in mechs) or (unique_tension and s.get("tension") in tens):
            return False
        chosen.append(s)
        mechs.add(m)
        tens.add(s.get("tension"))
        return True

    for s in ranked:
        if len(chosen) < max_keep:
            take(s, True)
    for s in ranked:                                   # too few distinct tensions: relax that rule, never the mechanism rule
        if len(chosen) >= min_keep:
            break
        if s not in chosen:
            take(s, False)
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
    tensions = _tensions(llm, task, assumed)
    kept, dropped, n_made = _seeds(llm, tensions, n_seeds, threshold)
    survivors, killed, restored = _kill(llm, task, assumed, tensions, kept, min_keep=3)
    sorted_ = _sort(llm, survivors)
    scores = _score(llm, sorted_)
    chosen = _choose(sorted_, scores, max_keep)
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
    res.update(territories=out, assumed_brief=assumed, tensions=tensions,
               diversity={"seeds_made": n_made, "kept_after_clustering": len(kept), "duplicate_rate": diversity.duplicate_rate(kept, dropped)},
               kill_gate={"seeds_in": len(kept), "killed": killed, "survivors": len(survivors), "restored": [s["id"] for s in restored]},
               spread_ok=ladder.spread_ok(out), notes=[] if len(out) >= 3 else [f"only {len(out)} territories survived the cull"],
               client_questions=assumed.get("questions", []))
    return res
