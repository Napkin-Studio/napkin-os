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
    """A note's window on its take: {"window", "atS", "inCut"}, or None. A note on a take (target kind
    take) is in take time and passes through; any other is in shot time and moves by the cut item's in_s,
    widened to whole seconds. Fitted inside the take, at least 2 s, shifting inward."""
    if note.get("at_s") is None or not note.get("window"):
        return None
    end = math.floor(take_s + EPS)
    if end < MIN_WINDOW_S:
        return None
    in_s = (item or {}).get("in_s") or 0
    shot_time = note["target"]["kind"] != "take"
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


def patch_plan(window: dict, at_s: float, take_s: float, context_s: int = 0, edited: bool = False) -> dict:
    """What a clip_patch sends: the cut (the window plus context_s each side, inside the take), its length,
    the keyframe kind and time, and the keyframe's whole-second range with context_s > 0."""
    a, b = window["from_s"], window["to_s"]
    frm = max(0, a - context_s)
    to = _r3(min(take_s, b + context_s))
    seconds = _r3(to - frm)
    plan: dict = {"cut": {"from_s": frm, "to_s": to}, "seconds": seconds, "keyframe": "none"}
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
