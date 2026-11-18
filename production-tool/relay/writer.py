"""Skye, who scripts (features/script-editor.clan): the relay's `write` op.

One job per action a person presses in the Script editor (Tighten, Make it 10 s, Add a beat,
Write the VO, Say it another way, a draft from one line, Cut him). In: the target's lines, the
neighbouring rows (at most 4,000 characters) and the names of the references with their
roles (relay-api WriteInput). Out: drafts that land as suggestions (relay-api Write), or a
question when she cannot go on without the person (needs_input): a real choice or a fact only
they know. A question that offers no choice (one option that restates the press) is answered by
the relay for them, and she drafts (`empty_nudge`, skye.v3). Nothing is sent to an image
or video provider and no Runway money is spent: it is an internal op on the text quota.

`ModelWriter` asks Claude through the director's model port with an explicit model (as the
director does for shot_list), so the relay needs no new setting. `PassthroughWriter` answers
deterministically with no model: the local relay, and the tests' fake-model contract.

The relay, not the model, owns four things: each draft's target and base_hash are the input's
(echoed back, so a draft lands after a reload and a stale one is caught on Keep), a draft for any
other target is dropped, new beats keep inside the shot, and a one-option nudge goes ahead.
"""

from __future__ import annotations

import re
import time
from pathlib import Path

from contracts import Contracts

WRITE_MODEL = "claude-sonnet-5-5"
PROMPT_VERSION = "skye.v6"  # skye.v1–v5 stay bundled: ModelWriter(prompt_version="skye.v5") rolls back (v5: the brief, features/brief-node.clan; v6: one length rule with the band, rough_seconds)
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


def keep_names(before: str, lines: list[dict]) -> list[dict]:
    """A draft keeps the person's @names (owner 2026-10-15: the script turned '@samurai' into
    @samurai_front, @samurai_side… shot by shot). Where the words say a bare @samurai, a view of it the
    words never name (@samurai_back) goes back to @samurai."""
    said = set(MENTION.findall(before))
    bare = {n for n in said if "_" not in n}

    def back(m: re.Match) -> str:
        name = m.group(1)
        key = name.split("_", 1)[0]
        return "@" + (key if "_" in name and key in bare and name not in said else name)
    return [{**x, "text": MENTION.sub(back, x["text"])} for x in lines]


def mode_of(w: dict) -> str:
    """How the write runs: explicit, else draft for the draft intent and revise for the rest."""
    return w.get("mode") or ("draft" if w.get("intent") == "draft" else "revise")


def settle(inp: dict, out: dict) -> dict:
    """The relay's part of the answer: target, base_hash and mode from the input (echoed, so a draft
    lands the right way after a reload), other targets dropped, the person's @names kept (keep_names),
    new beats inside the shot, notes cut to 200 characters."""
    w = inp["write"]
    before = " ".join(x["text"] for x in w["lines"])
    target = w["target"]
    mode = mode_of(w)
    writes = []
    for d in out.get("writes") or []:
        if d.get("target", target) != target:
            continue
        d = {**d, "target": target, "base_hash": w["base_hash"], "mode": mode, "note": (d.get("note") or "")[:200]}
        if d.get("lines"):
            d["lines"] = keep_names(before, d["lines"])
        if d.get("new_beats"):
            d["new_beats"] = [{**b, "text": keep_names(before, [{"text": b["text"]}])[0]["text"]} for b in d["new_beats"]]
        limit = d.get("duration_s") or w.get("seconds")
        if d.get("new_beats") and limit:
            d["new_beats"] = [{**b, "at_s": min(b["at_s"], int(limit * 2) / 2)} for b in d["new_beats"]]
        writes.append(d)
    return {"writes": writes, **({"question": out["question"]} if out.get("question") and not writes else {}),
            "rationale": out.get("rationale", "")}


SLUG = re.compile(r"^(?:INT|EXT|EST|INT\.?/EXT|I/E)[. ]", re.IGNORECASE)


def rough_seconds(lines: list[dict]) -> float:
    """A page's rough length by the one rule the Script editor's band uses (web script/compose.ts
    roughSeconds, skye.v6 rule 10): an action line is one beat, max(2, words / 6) s; a dialogue line
    2.5 words a second; a slugline, a cue, a parenthetical and a transition take no time."""
    s = 0.0
    for x in lines:
        kind, text = x.get("type") or x.get("kind") or "action", (x.get("text") or "").strip()
        if not text or kind in ("character", "parenthetical", "transition", "centered", "direction"):
            continue
        words = len(text.split())
        if kind == "dialogue":
            s += words / 2.5
        elif not SLUG.match(text):
            s += max(2.0, words / 6)
    return round(s, 1)


def too_long(w: dict, res: dict) -> dict | None:
    """A page draft (a scene) that runs well past its length (live test 2026-11-18: a 15 s film drafted
    at about 60 s, "Make it 15 s" at 53 s): how long it ran and what it was for; None when it fits."""
    if w["target"].get("kind") != "scene" or not res.get("writes"):
        return None
    goal = w.get("seconds") if w.get("intent") == "fit_seconds" else (w.get("context") or {}).get("target_s") if w.get("intent") == "draft" else None
    if not goal:
        return None
    about = rough_seconds(res["writes"][0].get("lines") or [])
    return {"about_s": about, "target_s": goal} if about > goal + max(3.0, goal * 0.2) else None


def empty_nudge(question: dict | None) -> bool:
    """A question that offers no choice (owner 2026-10-15: "Draft the scene as written?" with one option,
    "Draft it", on an empty script): a nudge with exactly one option that goes ahead. The person already
    pressed what they want, so the relay takes it as asked and Skye drafts. A real choice (two options or
    more) and a question for a fact only the person knows (no options, text) still reach them."""
    if not question or question.get("kind") != "nudge":
        return False
    return len([o for o in question.get("options") or [] if "value" in o]) == 1


def went_ahead(question: dict) -> dict:
    """The answer the relay gives for the person to a one-option nudge: its one option."""
    [opt] = [o for o in question["options"] if "value" in o]
    return {k: v for k, v in (("questionId", question.get("id")), ("optionId", opt.get("id")), ("label", opt.get("label"))) if v}


class ModelWriter:
    model = WRITE_MODEL
    prompt_version = PROMPT_VERSION

    def __init__(self, port, contracts_root: Path, prompt_dir: Path = PROMPTS, prompt_version: str = PROMPT_VERSION):
        self.port = port
        self.prompt_version = prompt_version
        self.system = (prompt_dir / f"{prompt_version}.md").read_text()
        self.schema = output_schema(contracts_root)

    def write(self, req: dict) -> dict:
        from director.model import Usage

        import brief as briefs

        # A linked brief, cut to the write op's budget (features/brief-node.clan); none: the input as it came.
        inp = briefs.for_op("write", req["input"])
        usage = Usage()
        t0 = time.monotonic()

        def ask(payload: dict) -> dict:
            return self.port.call(PURPOSE, self.system, {"op": "write", "input": payload}, self.schema, usage=usage,
                                  attribution=req.get("jobId", "write"), model=self.model, max_tokens=3000)

        res = settle(inp, ask(inp))
        if empty_nudge(res.get("question")) and not inp.get("answer"):
            # Skye asked whether to do what the person pressed: go ahead, once, as if they chose it.
            q = res["question"]
            res = settle(inp, ask({**inp, "answer": went_ahead(q)}))
            if empty_nudge(res.get("question")):
                # Asked the same again: no draft and no question, so the job fails with "Try again".
                res.pop("question")
            res["rationale"] = f"relay: went ahead on a one-option nudge ({q.get('text', '')[:120]}). {res.get('rationale', '')}".strip()
        over = too_long(inp["write"], res)
        if over:
            # Ran well past its length: one more ask to fit, by the same rule (skye.v6 rule 10). The second
            # answer stands either way; the band shows its length.
            again = settle(inp, ask({**inp, "write": {**inp["write"], "too_long": over}}))
            if again.get("writes"):
                res = {**again, "rationale": f"relay: the first draft ran about {over['about_s']:g} s for {over['target_s']:g} s; asked once to fit. {again.get('rationale', '')}".strip()}
        res["_latencyMs"] = round((time.monotonic() - t0) * 1000)
        res["_usage"] = {"input_tokens": getattr(usage, "input_tokens", 0), "output_tokens": getattr(usage, "output_tokens", 0)}
        return res


def _first_sentence(text: str) -> str:
    parts = SENTENCE.split(text.strip(), maxsplit=1)
    return parts[0] if parts else text


WHERE = re.compile(r"\b(?:at|in|inside)\s+(?:the\s+)?([a-z][a-z'-]+)", re.IGNORECASE)


def _draft_script(instruction: str | None) -> list[dict]:
    """A short screenplay from a brief: a slugline, the premise as action, a close. Mirrors the web
    mock (mockWrite.draftScript); the real model writes a proper draft (prompts/skye.v4.md)."""
    brief = (instruction or "").strip()
    where = WHERE.findall(brief)
    slug = f"INT. {(where[-1] if where else 'location').upper()} - DAY"
    premise = (brief[:1].upper() + brief[1:]).rstrip(". ") + "." if brief else "An idea in a line."
    return [{"type": "action", "text": slug},
            {"type": "action", "text": premise},
            {"type": "action", "text": "We stay on the effort, then cut to the end card."}]


class PassthroughWriter:
    """No model: a plain, predictable draft for each intent (the local relay; the tests)."""

    model = "passthrough"
    prompt_version = PROMPT_VERSION

    def write(self, req: dict) -> dict:
        inp = req["input"]
        w = inp["write"]
        lines = [dict(x) for x in w["lines"]]
        words = " ".join(x["text"] for x in lines)
        # The brief a draft writes from (the hook may be planted there, as a draft carries no item words).
        brief = (w.get("instruction") or "").strip()
        if ASK_HOOK in f"{words} {brief}" and not inp.get("answer"):
            return {"writes": [], "question": {
                "id": "q_00000000000000000000000000", "kind": "block", "text": "Who is this scene about?",
                "why": "There is not enough here to draft from.",
                "options": [{"id": "maya", "label": "Maya", "value": {"route": "draft"}},
                            {"id": "someone", "label": "Someone new", "value": {"route": "draft"}}],
                "allow_text": True}, "rationale": "passthrough: asked (the [ask] hook)"}
        intent = w["intent"]
        note = {"tighten": "I tightened it.", "fit_seconds": f"I tightened it to fit {w.get('seconds', 0):g} s.",
                "rephrase": "I said it another way.", "add_beat": "I added a beat.", "write_vo": "I wrote the VO.",
                "draft": "I drafted it from your line.", "cut_name": f"I cut @{w.get('name', '')}.",
                "instruct": "I did what you asked."}[intent]
        draft: dict = {"target": w["target"], "base_hash": w["base_hash"], "note": note}
        if intent in ("tighten", "fit_seconds"):
            draft["lines"] = [{**x, "text": _first_sentence(x["text"])} if x["type"] == "action" else x for x in lines]
            if intent == "fit_seconds" and w.get("seconds"):
                draft["duration_s"] = round(min(30.0, max(0.5, float(w["seconds"]))), 1)
        elif intent == "rephrase":
            draft["lines"] = [{**x, "text": " ".join(reversed(SENTENCE.split(x["text"].strip())))} if x["type"] == "action" else x for x in lines]
        elif intent == "instruct":
            # A free 'Tell Skye' ask: the model follows the instruction. The passthrough cannot, so it
            # returns the words unchanged (the instruction is carried for the model; mode is echoed).
            draft["lines"] = lines
        elif intent == "cut_name":
            name = w.get("name", "")
            draft["lines"] = [{**x, "text": re.sub(rf"\s*@{re.escape(name)}(?![a-z0-9_-])", "", x["text"]).strip()} for x in lines]
        elif intent == "draft":
            # A draft writes a short screenplay from the instruction (the brief), never the item's words,
            # so the prompt is never diffed as the writer's own prose (owner's named bug, 2026-11-03).
            # The real model writes a proper draft (prompts/skye.v4.md); this stub keeps the shape.
            draft["lines"] = _draft_script(inp["write"].get("instruction"))
        else:
            draft["lines"] = lines
            kind = "vo" if intent == "write_vo" else "moment"
            text = f"VO: {_first_sentence(words)}" if kind == "vo" else "A beat to breathe."
            draft["new_beats"] = [{"kind": kind, "at_s": 0.0 if kind == "vo" else 0.5, "text": text[:500]}]
        return settle(inp, {"writes": [draft], "rationale": f"passthrough: {intent}"})


def make(director) -> PassthroughWriter | ModelWriter:
    """Skye on the director's model port, or the passthrough when the relay has no model."""
    inner = getattr(director, "director", director)   # ClaudeDirector wraps the harness lane's Director
    port = getattr(inner, "port", None)
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

