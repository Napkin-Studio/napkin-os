"""Skye, who scripts (features/script-editor.clan): the relay's `write` op.

One job per action a person presses in the Script editor (Tighten, Make it 10 s, Add a beat,
Write the VO, Say it another way, a draft from one line, Cut him). In: the target's lines, the
neighbouring rows (at most 4,000 characters) and the names of the references with their
roles (relay-api WriteInput). Out: drafts that land as suggestions (relay-api Write), or a
question when the input is too thin to draft from (needs_input). Nothing is sent to an image
or video provider and no Runway money is spent: it is an internal op on the text quota.

`ModelWriter` asks Claude through the director's model port with an explicit model (as the
director does for shot_list), so the relay needs no new setting. `PassthroughWriter` answers
deterministically with no model: the local relay, and the tests' fake-model contract.

The relay, not the model, owns three things: each draft's target and base_hash are the
input's (echoed back, so a draft lands after a reload and a stale one is caught on Keep), a
draft for any other target is dropped, and new beats keep inside the shot.
"""

from __future__ import annotations

import re
import time
from pathlib import Path

from contracts import Contracts

WRITE_MODEL = "claude-sonnet-5-5"
PROMPT_VERSION = "skye.v1"
PURPOSE = "writer"
PROMPTS = Path(__file__).parent / "prompts"
ASK_HOOK = "[ask]"
SENTENCE = re.compile(r"(?<=[.!?])\s+")
MENTION = re.compile(r"(?<![\w@])@([a-z][a-z0-9]{1,23}(?:_[a-z0-9][a-z0-9-]{0,31})?)")


def output_schema(contracts_root: Path) -> dict:
    """What the model must answer: drafts, or a question. Self-contained (the port takes one schema)."""
    from director.director import _inline, load_schemas

    schemas = load_schemas(contracts_root)
    write = _inline({"$ref": "relay-api.schema.json#/$defs/Write"}, schemas, "relay-api.schema.json")
    question = _inline({"$ref": "common.schema.json#/$defs/question"}, schemas, "common.schema.json")
    return {
        "type": "object",
        "properties": {
            "writes": {"type": "array", "maxItems": 16, "items": write},
            "question": question,
            "rationale": {"type": "string", "maxLength": 2000},
        },
        "additionalProperties": False,
    }


def settle(inp: dict, out: dict) -> dict:
    """The relay's part of the answer: target and base_hash from the input, other targets dropped,
    new beats inside the shot, notes cut to 200 characters."""
    w = inp["write"]
    target = w["target"]
    writes = []
    for d in out.get("writes") or []:
        if d.get("target", target) != target:
            continue
        d = {**d, "target": target, "base_hash": w["base_hash"], "note": (d.get("note") or "")[:200]}
        limit = d.get("duration_s") or w.get("seconds")
        if d.get("new_beats") and limit:
            d["new_beats"] = [{**b, "at_s": min(b["at_s"], int(limit * 2) / 2)} for b in d["new_beats"]]
        writes.append(d)
    return {"writes": writes, **({"question": out["question"]} if out.get("question") and not writes else {}),
            "rationale": out.get("rationale", "")}


class ModelWriter:
    model = WRITE_MODEL
    prompt_version = PROMPT_VERSION

    def __init__(self, port, contracts_root: Path, prompt_dir: Path = PROMPTS):
        self.port = port
        self.system = (prompt_dir / f"{PROMPT_VERSION}.md").read_text()
        self.schema = output_schema(contracts_root)

    def write(self, req: dict) -> dict:
        from director.model import Usage

        inp = req["input"]
        usage = Usage()
        t0 = time.monotonic()
        out = self.port.call(PURPOSE, self.system, {"op": "write", "input": inp}, self.schema, usage=usage,
                             attribution=req.get("jobId", "write"), model=self.model, max_tokens=3000)
        res = settle(inp, out)
        res["_latencyMs"] = round((time.monotonic() - t0) * 1000)
        res["_usage"] = {"input_tokens": getattr(usage, "input_tokens", 0), "output_tokens": getattr(usage, "output_tokens", 0)}
        return res


def _first_sentence(text: str) -> str:
    parts = SENTENCE.split(text.strip(), maxsplit=1)
    return parts[0] if parts else text


class PassthroughWriter:
    """No model: a plain, predictable draft for each intent (the local relay; the tests)."""

    model = "passthrough"
    prompt_version = PROMPT_VERSION

    def write(self, req: dict) -> dict:
        inp = req["input"]
        w = inp["write"]
        lines = [dict(x) for x in w["lines"]]
        words = " ".join(x["text"] for x in lines)
        if ASK_HOOK in words and not inp.get("answer"):
            return {"writes": [], "question": {
                "id": "q_00000000000000000000000000", "kind": "block", "text": "Who is this scene about?",
                "why": "There is not enough here to draft from.",
                "options": [{"id": "maya", "label": "Maya", "value": {"route": "draft"}},
                            {"id": "someone", "label": "Someone new", "value": {"route": "draft"}}],
                "allow_text": True}, "rationale": "passthrough: asked (the [ask] hook)"}
        intent = w["intent"]
        note = {"tighten": "I tightened it.", "fit_seconds": f"I tightened it to fit {w.get('seconds', 0):g} s.",
                "rephrase": "I said it another way.", "add_beat": "I added a beat.", "write_vo": "I wrote the VO.",
                "draft": "I drafted it from your line.", "cut_name": f"I cut @{w.get('name', '')}."}[intent]
        draft: dict = {"target": w["target"], "base_hash": w["base_hash"], "note": note}
        if intent in ("tighten", "fit_seconds"):
            draft["lines"] = [{**x, "text": _first_sentence(x["text"])} if x["type"] == "action" else x for x in lines]
            if intent == "fit_seconds" and w.get("seconds"):
                draft["duration_s"] = round(min(30.0, max(0.5, float(w["seconds"]))), 1)
        elif intent == "rephrase":
            draft["lines"] = [{**x, "text": " ".join(reversed(SENTENCE.split(x["text"].strip())))} if x["type"] == "action" else x for x in lines]
        elif intent == "cut_name":
            name = w.get("name", "")
            draft["lines"] = [{**x, "text": re.sub(rf"\s*@{re.escape(name)}(?![a-z0-9_-])", "", x["text"]).strip()} for x in lines]
        elif intent == "draft":
            idea = words.strip() or "An idea in a line."
            draft["lines"] = [{"type": "action", "text": idea}, {"type": "action", "text": "We hold on it, then cut to the end card."}]
        else:
            draft["lines"] = lines
            kind = "vo" if intent == "write_vo" else "moment"
            text = f"VO: {_first_sentence(words)}" if kind == "vo" else "A beat to breathe."
            draft["new_beats"] = [{"kind": kind, "at_s": 0.0 if kind == "vo" else 0.5, "text": text[:500]}]
        return settle(inp, {"writes": [draft], "rationale": f"passthrough: {intent}"})


def make(director) -> PassthroughWriter | ModelWriter:
    """Skye on the director's model port, or the passthrough when the relay has no model."""
    port = getattr(director, "port", None)
    if port is None:
        return PassthroughWriter()
    from contracts_dir import contracts_dir

    return ModelWriter(port, contracts_dir())


def check(contracts: Contracts, out: dict) -> list[str]:
    """Each draft against relay-api Write."""
    errs: list[str] = []
    for d in out.get("writes") or []:
        errs += contracts.errors("relay-api.schema.json#/$defs/Write", d)
    return errs

