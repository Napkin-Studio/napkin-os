"""The director hook (harness lane fills it in).

`direct(job_request, sheet) -> dict` returns an object matching
contracts/director.schema.json: for shot_list, {"op", "shots", "question",
"rationale", "confidence"} (planned shots); for every other op a providerJob in the routed
provider's syntax; or, instead of either, a question (the job waits in needs_input). `sheet` is the routed provider's capability sheet (None for
shot_list, which has no provider).

The relay adds the agent block it logs: {"model", "promptVersion", "output",
"rationale", "latencyMs"}. A director may return "_model" and "_promptVersion"
keys to fill it; they are stripped before validation.
"""

from __future__ import annotations

import hashlib
import math
import os
import re
import time
from typing import Protocol

_CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"


def new_id(prefix: str, seed: str = "") -> str:
    """A prefixed ULID: 48-bit ms time + 80 bits (random, or derived from seed)."""
    ms = int(time.time() * 1000)
    tail = hashlib.sha256(seed.encode()).digest()[:10] if seed else os.urandom(10)
    n = (ms << 80) | int.from_bytes(tail, "big")
    chars = []
    for _ in range(26):
        chars.append(_CROCKFORD[n & 31])
        n >>= 5
    return f"{prefix}_{''.join(reversed(chars))}"


class PromptTooOld(Exception):
    """Contract 3 runs director.v6 or later: an older prompt writes fields contract 3 refuses."""


MIN_PROMPT = 6


def prompt_number(version: str) -> int:
    try:
        return int(version.split(".v", 1)[1].split(".")[0])
    except (IndexError, ValueError):
        return 0


def require_prompt(version: str) -> None:
    if prompt_number(version) < MIN_PROMPT:
        raise PromptTooOld(f"config.json names prompt {version}; contract 3 needs director.v{MIN_PROMPT} or later.")


class Director(Protocol):
    def direct(self, job_request: dict, sheet: dict | None) -> dict: ...


_VIDEO_OPS = {"clip", "clip_edit"}
_SIZES = ["wide", "medium", "close", "medium", "close", "wide", "insert", "medium"]
_MOVES = ["static", "push_in", "pan", "static", "track", "pull_out", "static", "orbit"]
# The dev hook: words that carry this make the passthrough ask before it works, so a Mock run (local.py,
# tests) can exercise needs_input and the answer route without a model. Never in a real director.
ASK_HOOK = "[ask]"


def dev_question(op: str) -> dict:
    """The passthrough's one question (a nudge, as ui-behaviour 3.5's 'Plan a storyboard first?')."""
    return {"kind": "nudge", "text": f"Dev check: ask before the {op.replace('_', ' ')}?",
            "why": "The [ask] dev hook (Mock runs and tests only): a real director never asks this.",
            "options": [{"id": "plan_first", "label": "Dev: plan first", "value": {"route": "plan_storyboard"},
                         "detail": "6 shots", "cost": {"estimate": 1.2, "currency": "USD"}},
                        {"id": "straight", "label": "Dev: go ahead", "value": {"route": "go_ahead"}}],
            "allow_text": False, "recommended_option_id": "plan_first"}
# The camera angle of each turnaround view (director.v4: front 0, three-quarter 45, side 90, back 180).
VIEW_ANGLES = {"front": 0.0, "three-quarter": 45.0, "side": 90.0, "back": 180.0}


def fit_duration(seconds: float, spec: dict) -> float:
    """The clip length the op's model can make for a shot of `seconds` (capabilities ops[op]):
    the next longer allowed value (4/6/8 s models), else the nearest whole second within
    minS-maxS. Never fails the job over length: the stitch trims each clip to its shot (trimS)."""
    if spec.get("durationsS"):
        allowed = sorted(spec["durationsS"])
        if seconds in allowed:
            return seconds
        longer = [d for d in allowed if d >= seconds]
        return longer[0] if longer else allowed[-1]
    if "minS" in spec or "maxS" in spec:
        return min(max(math.ceil(seconds), spec.get("minS", 0)), spec.get("maxS", math.inf))
    return seconds


def view_angle(op: str, inp: dict, sheet: dict | None) -> dict | None:
    """The angle a view job needs where the provider takes angles (sheet "angles"); None where it
    does not (the view is said in words instead)."""
    if op != "view" or not (sheet or {}).get("angles") or inp.get("view") not in VIEW_ANGLES:
        return None
    return {"horizontal": VIEW_ANGLES[inp["view"]], "vertical": 0.0}
def ref_roles(inp: dict, op: str, sheet: dict | None) -> list[tuple[dict, str]]:
    """The input refs in send order, each with its provider role: a character ref is `character`
    and every other role is `object`. Refs carry wire tags (names.py) by now."""
    refs = list(inp.get("refs") or [])
    return [(r, "character" if r["role"] == "character" else "object") for r in refs]


class PassthroughDirector:
    """No model: turns the input into a provider job as literally as it can.

    Used until the harness lane's director exists, and by the local dev server.
    """

    model = "passthrough"
    prompt_version = "director.v0"

    def direct(self, job_request: dict, sheet: dict | None) -> dict:
        op = job_request["op"]
        inp = job_request.get("input", {})
        if ASK_HOOK in (inp.get("text") or inp.get("script") or "") and not inp.get("answer"):
            return {"op": op, "question": dev_question(op), "rationale": "passthrough: asked (the [ask] hook)",
                    "confidence": 0.1}
        if op == "shot_list":
            return self._shot_list(job_request)
        provider = (sheet or {}).get("provider", "mock")
        model = ((sheet or {}).get("ops", {}).get(op) or {}).get("model", "unknown")
        refs = []
        seen = set()

        def add(asset: dict | None, name: str, role: str) -> None:
            if asset and asset["sha256"] not in seen:
                seen.add(asset["sha256"])
                refs.append({"sha256": asset["sha256"], "name": name, "role": role})

        if op == "view":
            add(inp.get("image"), "current", "current")
        for ref, role in ref_roles(inp, op, sheet):
            add(ref["asset"], ref["tag"], role)
        masked = op == "region_edit" and bool(inp.get("mask")) and (sheet or {}).get("mask", "none") != "none"
        if op in ("frame", "region_edit"):
            add(inp.get("image"), "current", "current")
            # The storyboard's continuity anchors (director.v3 on): the frame before, then shot 1's
            # frame for setting and style (the same picture is sent once, as previous). Not on a masked
            # edit (director.v4): an edit model copies a reference into the mask, so the fix painted
            # shot 1's character into the box, or turned the frame into shot 2 (2026-10-08).
            if not masked:
                add(inp.get("previousFrame"), "previous", "object")
                add(inp.get("anchorFrame"), "anchor", "object")
        if op == "clip_edit":
            add(inp.get("video"), "current", "current")  # the clip being changed
        prompt = inp.get("text") or ""
        shot = inp.get("shot")
        if shot:
            prompt = f"{shot.get('action', '')} {prompt}".strip()
        if inp.get("view"):
            prompt = f"{inp['view'].replace('-', ' ')} view of @current. {prompt}".strip()
        job = {"provider": provider, "model": model, "prompt": prompt or "the character", "refs": refs}
        angle = view_angle(op, inp, sheet)
        if angle:
            job["angle"] = angle
        if op == "clip" and inp.get("image"):
            job["firstFrame"] = inp["image"]["sha256"]
        if inp.get("mask") and (sheet or {}).get("mask", "none") != "none":
            job["mask"] = inp["mask"]["sha256"]  # a provider without masks goes by the box
        if inp.get("region"):
            job["region"] = inp["region"]
        if inp.get("feel") and ((sheet or {}).get("video") or {}).get("feelEdit") == "strength":
            job["strength"] = inp["feel"].get("strength", "flex")
        # As the director does (pathway matrix, 2026-10-08): the ratio in the provider's own form,
        # and no refs beside a first frame where the provider cannot take both.
        from .director import _clip_frame_only, provider_ratio
        ratio = provider_ratio(provider, op, inp.get("ratio"), model)
        if ratio:
            job["ratio"] = ratio
        if sheet:
            _clip_frame_only(job, op, sheet)
        if op in _VIDEO_OPS:
            job["audio"] = False
            if shot:
                spec = ((sheet or {}).get("ops") or {}).get(op) or {}
                job["durationS"] = fit_duration(shot["duration_s"], spec) if op == "clip" else shot["duration_s"]
        job["outputs"] = 1
        return {"op": op, "providerJob": job, "question": None,
                "rationale": "passthrough: no director model", "confidence": 0.1}

    def _shot_list(self, job_request: dict) -> dict:
        inp = job_request.get("input", {})
        script = (inp.get("script") or inp.get("text") or "").strip()
        names = [r["name"] for r in inp.get("refs") or [] if r.get("name")]
        # Whole characters by their bare key (those with a front), then the other keys' pictures.
        keys = [n.split("_", 1)[0] for n in names if n.endswith("_front")]
        named = (keys + [n for n in names if n.split("_", 1)[0] not in keys])[:9]
        target = int(inp.get("targetS") or 15)
        # A re-plan keeps the shots already there (input.shots) by their words; the new words come after.
        kept, pieces = plan_pieces(script, inp.get("shots") or [], target)
        if not kept and not pieces:
            pieces = [("The character", None)]
        n = min(24, len(kept) + len(pieces))
        base, extra = divmod(target, n)
        shots = []
        for i in range(n):
            seconds = max(1, base + (1 if i < extra else 0))
            if i < len(kept):
                was, action = kept[i]
                shots.append({"id": was["id"], "kind": was.get("kind", "shot"), "duration_s": seconds,
                              "camera": was.get("camera") or {"size": "medium"}, "action": action[:600],
                              "refs": [r for r in was.get("refs") or [] if isinstance(r, str)][:9] or named})
                continue
            action, heading = pieces[i - len(kept)]
            shots.append({
                "id": new_id("shot", f"{job_request['jobId']}:{i}"),
                "kind": "shot",
                **({"scene_heading": heading} if heading else {}),
                "duration_s": seconds,
                "camera": {"size": _SIZES[i % len(_SIZES)], "movement": _MOVES[i % len(_MOVES)]},
                "action": action[:600],
                "refs": named,
            })
        return {"op": "shot_list", "shots": shots, "question": None,
                "rationale": f"passthrough: {n} shots for {target} s, {len(kept)} kept", "confidence": 0.1}


# ── the passthrough's plan: each sentence once; the shots already there kept by their words ──

_HEADING = re.compile(r"^(INT|EXT|INT/EXT|I/E)[. ]", re.I)
_CLAUSE = re.compile(r",\s+|\s+(?:and|then)\s+")


def _norm(text: str) -> str:
    return " ".join(text.lower().split()).rstrip(".!? ")


def _sentences(line: str) -> list[str]:
    return [t.strip() for t in re.split(r"(?<=[.!?])\s+", line) if t.strip(" .!?")]


def _split_clause(text: str) -> tuple[str, str] | None:
    """A sentence in two at the clause boundary nearest its middle, or None."""
    cuts = [m for m in _CLAUSE.finditer(text) if m.start() > 0 and m.end() < len(text)]
    if not cuts:
        return None
    m = min(cuts, key=lambda c: abs(c.start() - len(text) / 2))
    a, b = text[:m.start()].strip(), text[m.end():].strip()
    return (a, b[:1].upper() + b[1:]) if a and b else None


def plan_pieces(script: str, existing: list[dict], target: int) -> tuple[list[tuple[dict, str]], list[tuple[str, str | None]]]:
    """What a passthrough plan is made of: the shots already there that keep their id, with their words
    (a script line that is a shot's action keeps that shot, in its order; a shot with no words takes the
    next new sentence), and the new shots' words and scene headings, each sentence used once. Fewer
    sentences than shots make fewer shots (a sentence splits at a clause only to reach the fewest shots
    the length needs: 10 s each at most); more sentences than shots share them."""
    used: set[int] = set()
    pieces: list[tuple[str, str | None]] = []
    heading = None

    def keeps(words: str, take: bool = False) -> bool:
        """Whether an unused shot already there says these words (and, with take, use it)."""
        k = next((k for k, s in enumerate(existing) if k not in used and s.get("id")
                  and _norm(s.get("action") or "") and _norm(s.get("action") or "") == _norm(words)), None)
        if k is not None and take:
            used.add(k)
        return k is not None

    for line in (x.strip() for x in script.split("\n")):
        if not line:
            continue
        if _HEADING.match(line):
            heading = line[:200]
            continue
        # A shot's whole action is one line of the script (the web sends them so); a line that is not
        # one is matched sentence by sentence.
        for words in ([line] if keeps(line) else _sentences(line)):
            if not keeps(words, take=True):
                pieces.append((words, heading))
    kept: list[tuple[dict, str]] = []
    for k, s in enumerate(existing):
        if k in used:
            kept.append((s, s["action"]))
        elif s.get("id") and not (s.get("action") or "").strip() and pieces:
            kept.append((s, pieces.pop(0)[0]))  # a shot with no words takes the next new words
    fewest = max(2, -(-target // 10))
    most = max(fewest, -(-target // 5))
    while pieces and len(kept) + len(pieces) < fewest:
        i = max(range(len(pieces)), key=lambda j: len(pieces[j][0]))
        cut = _split_clause(pieces[i][0])
        if not cut:
            break
        pieces[i:i + 1] = [(cut[0], pieces[i][1]), (cut[1], pieces[i][1])]
    slots = max(1, most - len(kept)) if pieces else 0
    if len(pieces) > slots:
        size, rest = divmod(len(pieces), slots)
        grouped, at = [], 0
        for g in range(slots):
            part = pieces[at:at + size + (1 if g < rest else 0)]
            at += len(part)
            grouped.append((" ".join(t for t, _ in part), part[0][1]))
        pieces = grouped
    return kept, pieces
