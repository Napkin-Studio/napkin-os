"""Rough cards in Deck Maker's stage-c key names (id, name, thought, why, mood, references, risks, sketch),
plus tension, tier, assumes, score and proof_cases. Cards are deliberately rough: no layout, no polish."""
from __future__ import annotations


def card(t: dict, result: dict) -> dict:
    risks = []
    if t.get("assumption_dependent"):
        risks.append("assumption-dependent: rests on an assumed audience or an invented tension")
    if not t.get("proposition_ok"):
        risks.append("no proposition passed the one-thought rule: " + "; ".join(t.get("proposition_problems") or ["none offered"]))
    if t.get("tier_defaulted"):
        risks.append("tier unclear: placed at stretch by default")
    elif t["tier"] != "safe":
        risks.append(f"{t['tier']}: placed by a model from the definitions; check with a creative director")
    proof = t.get("proof")
    assumes = [f["key"] for f in (result.get("assumed_brief") or {}).get("fields", []) if f.get("tag") == "assumed"]
    return {"id": t["id"], "name": t.get("line"), "thought": t.get("proposition") or t.get("line"), "why": t.get("tension_text"),
            "mood": "", "references": [f"{proof['brand']}: {proof['title']} ({proof['badge']})"] if proof else [],
            "risks": risks, "sketch": t.get("line"),
            "tension": t.get("tension_text"), "tier": t["tier"], "assumes": assumes, "score": t.get("score"),
            "proof_cases": [proof] if proof else [], "ready": t.get("ready", False),
            "vote": None}                                    # kill / keep / combine, set by a person


def cards(result: dict) -> list[dict]:
    return [card(t, result) for t in result.get("territories", [])]


def render_text(result: dict) -> str:
    if result["status"] != "proceed":
        return f"No territories produced: {result['gate']['why']}."
    lines = []
    if result.get("banner"):
        lines += [result["banner"], ""]
    lines.append(f"Coverage: {result['coverage']['n']} precedent cases ({result['coverage']['label']})")
    for c in cards(result):
        lines += ["", f"[{c['tier'].upper()}] {c['name']}", f"  tension: {c['tension']}", f"  proposition: {c['thought']}",
                  f"  score: {c['score']['total']}/{c['score']['of']} (advisory)" if c.get("score") else "",
                  "  proof: " + (c["references"][0] if c["references"] else "none available"),
                  "  ready: " + ("yes" if c["ready"] else "no, assumption-dependent")]
    if result.get("client_questions"):
        lines += ["", "Ask the client:"] + [f"  - {q['question']}" for q in result["client_questions"]]
    return "\n".join(l for l in lines if l is not None)
