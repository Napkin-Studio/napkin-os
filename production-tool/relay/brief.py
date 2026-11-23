"""The brief block (features/brief-node.clan, owner 2026-11-17): what Dex, Skye and the cutter read of a
linked brief, cut to each op's budget, and the Review flags they may answer with.

JobInput.brief carries a Brief node's spine (common.schema.json briefSpine: insight, proposition,
audience, tone, feel, mandatories, don'ts, format), never the whole brief. Before a model sees it, the
relay keeps only the parts each op reads, most important first, within that op's character budget:
a plan or a draft reads most of it; a frame or a clip reads the tone, the feeling and the don'ts in a
few hundred characters, so a provider prompt never grows past its own budget (director ADD_BUDGET still
counts every word Dex adds, the brief's included). A job with no brief is passed on exactly as it came.

`briefFlags`: when what a job makes (a plan, a frame, a clip, a cut, a size) breaks one of the brief's
mandatories or don'ts, the model still makes it and names the line. It never blocks or asks. The relay
keeps only flags that quote a line the job was given.
"""

from __future__ import annotations

import re

# The ops whose model reads the brief (the web sends it on the same ops: web/src/brief/model.ts BRIEF_OPS).
# generate and region_edit since features/pt-dex-context.clan: a Generate reads the don'ts, the tone and the feeling
# in a few words; an edit inside a picture only the don'ts (its look is the picture's). A view (the same character
# turned) reads none.
BRIEF_OPS = ("write", "shot_list", "generate", "frame", "frame_edit", "region_edit", "clip", "clip_edit", "clip_patch",
             "cutdown", "resize")

# Per op: the characters of spine it reads in all, and its parts in priority order (features/pt-film-r1.clan, UAT
# 2026-11-21: the Script agent's 900 characters went on the proposition, audience, tone, feel and insight, and the
# end line, a mandatory, and every don't were dropped). The parts before "|" are kept whole first (a list keeps
# each line that fits); the rest share what is left, each cut at a word to its share.
BUDGET: dict[str, tuple[int, tuple[str, ...]]] = {
    "write": (900, ("mandatories", "donts", "proposition", "|", "tone", "feel", "audience", "insight", "format")),
    "shot_list": (900, ("mandatories", "donts", "proposition", "|", "tone", "feel", "audience", "format", "insight")),
    "generate": (200, ("donts", "|", "tone", "feel")),
    "frame": (360, ("donts", "|", "tone", "feel", "audience", "mandatories")),
    "frame_edit": (240, ("donts", "|", "tone", "feel")),
    "region_edit": (160, ("donts",)),
    "clip": (300, ("donts", "|", "tone", "feel", "audience")),
    "clip_edit": (200, ("donts", "|", "tone")),
    "clip_patch": (160, ("donts", "|", "tone")),
    "cutdown": (600, ("mandatories", "donts", "proposition", "|", "format", "tone")),
    "resize": (300, ("mandatories", "donts", "proposition")),
}
LISTS = ("mandatories", "donts")
MIN_CUT = 40  # a text part is cut at a word only when at least this much room is left
FLAG_KINDS = {"mandatory": "mandatories", "dont": "donts"}


def _cut(text: str, room: int) -> str:
    if len(text) <= room:
        return text
    head = text[:room - 1]
    at = head.rfind(" ")
    return (head[:at] if at > room * 0.6 else head).rstrip(" ,;:.") + "…"


def parts_of(op: str) -> tuple[str, ...]:
    """The spine parts an op reads, in priority order (the web's send preview lists these)."""
    return tuple(p for p in BUDGET[op][1] if p != "|")


def spine_for(op: str, spine: dict) -> dict:
    """The parts of `spine` this op reads, within its budget, by priority, never first come first kept: the parts
    before "|" whole first (a list keeps each line that fits, in order; a text that does not fit is cut at a
    word when MIN_CUT or more is left); then the rest share what is left evenly, a part shorter than its share
    giving the remainder to the next, each cut at a word to its share. Kept in the op's order."""
    budget, order = BUDGET[op]
    first = order[:order.index("|")] if "|" in order else order
    rest = [p for p in order[len(first) + 1:] if spine.get(p)] if "|" in order else []
    out: dict = {}
    room = budget
    for part in first:
        v = spine.get(part)
        if not v or room <= 0:
            continue
        if part in LISTS:
            kept = [line for line in v if len(line) <= room and (room := room - len(line)) >= 0]
            if kept:
                out[part] = kept
        elif len(v) <= room:
            out[part] = v
            room -= len(v)
        elif room >= MIN_CUT:
            out[part] = _cut(v, room)
            room -= len(out[part])
    for k, part in enumerate(rest):
        v = spine[part]
        share = room // max(1, len(rest) - k)
        if part in LISTS:
            kept = [line for line in v if len(line) <= share and (share := share - len(line)) >= 0]
            if kept:
                out[part] = kept
                room -= sum(len(x) for x in kept)
        elif len(v) <= share:
            out[part] = v
            room -= len(v)
        elif share >= MIN_CUT:
            out[part] = _cut(v, share)
            room -= len(out[part])
    return {p: out[p] for p in order if p in out}


def size(spine: dict) -> int:
    """The characters of a spine as the budget counts them: its words, not its JSON."""
    return sum(sum(len(x) for x in v) if isinstance(v, list) else len(v) for v in spine.values())


def for_op(op: str, payload: dict) -> dict:
    """The job input as the model reads it: the brief cut to this op, or left out on an op that reads none.
    No brief: the same dict, untouched (the director's input is byte for byte as before)."""
    brief = payload.get("brief")
    if not brief:
        return payload
    rest = {k: v for k, v in payload.items() if k != "brief"}
    if op not in BUDGET:
        return rest
    cut = spine_for(op, brief.get("spine") or {})
    return {**rest, "brief": {"title": brief.get("title", "Brief"), "spine": cut}} if cut else rest


def _plain(s: str) -> str:
    return re.sub(r"\s+", " ", (s or "").strip().lower().rstrip(".!"))


def settle_flags(output: dict, payload: dict) -> None:
    """Keep only the flags that quote a mandatory or a don't the job was given (by kind), at most one a
    line; drop the key when none are left or the job had no brief. In place."""
    flags = output.pop("briefFlags", None)
    spine = ((payload.get("brief") or {}).get("spine")) or {}
    if not flags or not spine:
        return
    kept, seen = [], set()
    for f in flags:
        lines = {_plain(x): x for x in spine.get(FLAG_KINDS.get(f.get("kind"), ""), [])}
        line = lines.get(_plain(f.get("line", "")))
        if line and (f["kind"], line) not in seen:
            seen.add((f["kind"], line))
            kept.append({"kind": f["kind"], "line": line, "note": (f.get("note") or "")[:300]})
    if kept:
        output["briefFlags"] = kept
