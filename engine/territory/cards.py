"""Rough cards in Deck Maker's stage-c key names (id, name, thought, why, mood, references, risks, sketch),
plus tension, tier, assumes, score and proof_cases. Cards are deliberately rough: no layout, no polish."""
from __future__ import annotations


def card(t: dict, result: dict, frames: list | None = None) -> dict:
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
            "vote": None,                                    # kill / keep / combine, set by a person
            "frames": list(frames or []),                    # {path, shot, model, style_version, flagged, ...}: territory.visuals.board
            "visual": deck_visual(frames or [], t.get("line"))}


def deck_visual(frames: list, name: str | None) -> dict | None:
    """The Deck Maker image slot (deck.schema.json ``visual``: kind image_prompt, prompt, status) plus an ``image`` path:
    the first frame that is not flagged AND has either passed the guard check or been accepted by a person. None when there is
    none: a flagged frame, and a frame nobody has checked (guard skipped, Ollama down), never flow into a deck (fail closed)."""
    ok = next((f for f in frames if not f.get("flagged") and (f.get("guard_checked") or f.get("approved"))), None)
    if not ok:
        return None
    return {"kind": "image_prompt", "prompt": f"Mood frame for '{name}': {ok.get('prompt', '')}".strip(), "status": "illustrative, not final",
            "image": ok["path"]}


def cards(result: dict, frames: dict | None = None) -> list[dict]:
    """``frames`` maps a territory id to its frames list (territory.visuals.board.frames_for); absent, every card has none."""
    return [card(t, result, (frames or {}).get(t["id"])) for t in result.get("territories", [])]


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
