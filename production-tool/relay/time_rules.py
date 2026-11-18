"""The note window (ui-behaviour 3.13): the twin of production-tool/clan-store/src/time.ts.
Both pass contracts/examples/windows.json.

A note at shot time t gets the window [floor(t) - 1, ceil(t) + 1] in whole seconds (Aleph 2
on Runway takes whole-second ranges). It is clamped to the shot, never less than 2 s wide,
and never crosses a cut: near either end it shifts inward rather than shrinking. A shot too
short to hold 2 whole seconds has no window (None)."""

from __future__ import annotations

import math

MIN_WINDOW_S = 2


def note_window(t: float, shot_s: float) -> dict | None:
    end = math.floor(shot_s + 1e-9)  # the last whole second inside the shot
    if end < MIN_WINDOW_S or t < 0 or t > shot_s:
        return None
    lo, hi = math.floor(t) - 1, math.ceil(t) + 1
    if lo < 0:
        hi, lo = hi - lo, 0
    if hi > end:
        lo, hi = lo - (hi - end), end
    lo = max(lo, 0)
    return {"from_s": lo, "to_s": hi}


def window_problem(window: dict, shot_s: float) -> str | None:
    """Why a stored window breaks the rule, or None."""
    lo, hi = window["from_s"], window["to_s"]
    if hi - lo < MIN_WINDOW_S:
        return f"the window is {hi - lo} s; a fix needs at least {MIN_WINDOW_S} s"
    if lo < 0 or hi > shot_s + 1e-9:
        return f"the window {lo}-{hi} s crosses a cut (the shot is {shot_s} s)"
    return None


# ── Fix this moment (features/clip-moment-edit.clan): the twins of clan-store/src/patch.ts ──
# Both pass contracts/examples/patches.json.

EPS = 1e-9
KEYFRAME_EPS_S = 0.05  # a keyframe sits this far inside the end of its range (end exclusive)


def _r3(x: float) -> float:
    """Rounded to the millisecond as JavaScript's Math.round(x * 1000) / 1000 does (half up)."""
    v = math.floor(x * 1000 + 0.5) / 1000
    return int(v) if v == int(v) else v


def note_to_take_window(note: dict, take_s: float, item: dict | None = None) -> dict | None:
    """A note's window on its generation: {"window", "atS", "inCut"}, or None. A note on a generation
    (target kind generation) is in its own time and passes through; any other is in shot time and moves
    by the clip's in_s, widened to whole seconds. Fitted inside the generation, at least 2 s, shifting
    inward."""
    if note.get("at_s") is None or not note.get("window"):
        return None
    end = math.floor(take_s + EPS)
    if end < MIN_WINDOW_S:
        return None
    in_s = (item or {}).get("in_s") or 0
    shot_time = note["target"]["kind"] != "generation"
    w = note["window"]
    lo = math.floor(w["from_s"] + in_s + EPS) if shot_time else w["from_s"]
    hi = math.ceil(w["to_s"] + in_s - EPS) if shot_time else w["to_s"]
    width = min(max(MIN_WINDOW_S, hi - lo), end)
    lo = min(max(lo, 0), end - width)
    hi = lo + width
    at = _r3(min(max(note["at_s"] + (in_s if shot_time else 0), lo), hi))
    cut_end = (item or {}).get("out_s")
    cut_end = take_s if cut_end is None else cut_end
    return {"window": {"from_s": lo, "to_s": hi}, "atS": at, "inCut": lo < cut_end - EPS and hi > in_s + EPS}


MAX_INPUT_S = 30  # Aleph 2's longest input; a longer take is cut


def patch_plan(window: dict, at_s: float, take_s: float, context_s: int = 0, edited: bool = False,
               send: str = "range", max_input_s: float = MAX_INPUT_S) -> dict:
    """What a clip_patch sends. range (the default): the whole take, one keyframe (the edited still or the
    frame at t) whose range is the window; Aleph bills only the range. cut: the window plus context_s each
    side, inside the take, with a keyframe only for an edited still at context 0. `seconds` is what Aleph
    bills before its minimum."""
    a, b = window["from_s"], window["to_s"]
    send = "range" if send == "range" and take_s <= max_input_s + EPS else "cut"
    if send == "range":
        return {"send": send, "cut": {"from_s": 0, "to_s": _r3(take_s)}, "seconds": b - a,
                "keyframe": "edited" if edited else "still", "keyframeS": _r3(min(max(at_s, a), b - KEYFRAME_EPS_S)),
                "range": {"start_s": a, "end_s": b}}
    frm = max(0, a - context_s)
    to = _r3(min(take_s, b + context_s))
    seconds = _r3(to - frm)
    plan: dict = {"send": send, "cut": {"from_s": frm, "to_s": to}, "seconds": seconds, "keyframe": "none"}
    if context_s > 0:
        plan["range"] = {"start_s": a - frm, "end_s": b - frm}
        plan["keyframe"] = "edited" if edited else "still"
    elif edited:
        plan["keyframe"] = "edited"
    if plan["keyframe"] != "none":
        lo = plan["range"]["start_s"] if "range" in plan else 0
        hi = (plan["range"]["end_s"] if "range" in plan else seconds) - KEYFRAME_EPS_S
        plan["keyframeS"] = _r3(min(max(at_s - frm, lo), hi))
    return plan


# ── Make and Edit (features/make-and-edit.clan): the twins of clan-store/src/timeline.ts and patch.ts ──
# Both pass contracts/examples/timeline.json.

def moment_window(in_s: float, out_s: float, take_s: float) -> dict | None:
    """A marked stretch of a generation (Change → A moment, in its own time) as the window a clip_patch
    makes again: whole seconds around in_s..out_s, at least 2 s, inside the generation, shifting inward;
    atS the middle of the mark. None when the generation cannot hold 2 whole seconds."""
    lo, hi = min(in_s, out_s), max(in_s, out_s)
    note = {"target": {"kind": "generation"}, "at_s": _r3((lo + hi) / 2),
            "window": {"from_s": math.floor(lo + EPS), "to_s": math.ceil(hi - EPS)}}
    return note_to_take_window(note, take_s)


def item_length(item: dict) -> float:
    """How long a timeline item lasts: (out_s - in_s) / speed + hold_s; a text, to_s - from_s."""
    if item.get("track") == "text":
        return max(0.0, item.get("to_s", 0) - item.get("from_s", 0))
    src = item.get("source") or {}
    return max(0.0, src.get("out_s", 0) - src.get("in_s", 0)) / item.get("speed", 1) + item.get("hold_s", 0)


def ad_time_to_source(timeline: dict, ad_s: float) -> dict | None:
    """The clip seen at ad time `ad_s` and the moment of its footage: V2 over V1 (the one that starts last),
    at a cut the incoming clip; source_s = in_s + (ad_s - start_s) * speed, out_s while its last frame is
    held. None over a gap, the end card or past the end."""
    def under(track: str):
        hits = [(k, i) for k, i in timeline.items()
                if i.get("track") == track and i.get("source") and i.get("start_s") is not None
                and i["start_s"] - EPS <= ad_s < i["start_s"] + item_length(i) - EPS]
        hits.sort(key=lambda kv: (kv[1]["start_s"], kv[0]), reverse=True)
        return hits[0] if hits else None
    hit = under("V2") or under("V1")
    if not hit:
        return None
    key, item = hit
    src = item["source"]
    into = max(0.0, ad_s - item["start_s"]) * item.get("speed", 1)
    held = src["in_s"] + into > src["out_s"] + EPS
    out: dict = {"item_id": key, "track": item["track"]}
    if src.get("generation_id"):
        out["generation_id"] = src["generation_id"]
    if src.get("asset"):
        out["asset"] = src["asset"]
    out["source_s"] = _r3(src["out_s"] if held else src["in_s"] + into)
    out["held"] = held
    follows = item.get("follows") or {}
    if follows.get("shot_id"):
        out["shot_id"] = follows["shot_id"]
    if follows.get("box_id"):
        out["box_id"] = follows["box_id"]
    return out
