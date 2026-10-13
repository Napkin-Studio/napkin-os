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
