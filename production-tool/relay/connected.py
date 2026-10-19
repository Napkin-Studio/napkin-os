"""Connected video (features/connected-video.clan, phases A and B): a clip's mode, its last frame and the
timed prompt of a take, as the relay and both directors read them. Pure functions; service.py runs the
stages (the stills a window or a take frame needs, take_cuts after a take lands).

Modes (JobInput.mode, chosen by the web's run planner):
  take        one generation over a run's shots (input.shots), pinned on the first shot's frame, no refs
              (Runway keyframes and references cannot mix), a timed prompt "Shot k [a-b s] ...".
  take_refs   the same with no frame: the storyboard frames and named pictures go as references.
  frames      one shot from its own frame, landing on input.lastFrame (a continue join) when given.
  alone       today's clip.
  redo_window one shot's window of a take made again from the take's own stills at its ends.
A clip with a lastFrame and no mode is frames; one with neither is alone, exactly as before.
"""

from __future__ import annotations

import re

from director.base import fit_duration
from providers.tags import TAG as TAG_IN_TEXT, unsent_in_words

MODES = ("take", "take_refs", "frames", "alone", "redo_window")
TAKE_MODES = ("take", "take_refs")
ANCHOR_MAX = 300  # the take's anchor block (cast, place, light, palette, lens): at most this many characters
# A take's cuts (take_cuts): ffmpeg's scene score at or above this counts (T4's 0.25 missed one cut a take),
# searched within the model's cutAccuracyS of each planned cut, never wider than CUT_SEARCH_MAX_S and never
# narrower than CUT_SEARCH_MIN_S (a frame of rounding either side at 24-30 fps, plus a frame of the model's).
CUT_THRESHOLD = 0.10
CUT_SEARCH_MAX_S = 1.0
CUT_SEARCH_MIN_S = 0.1
TIME_EPS_S = 0.05  # a timed line's start may differ from the plan's by this much
LANDING = "The last moment is exactly the given last frame; keep moving into it."
TIMED = re.compile(r"^Shot (\d+) \[(\d+(?:\.\d+)?)-(\d+(?:\.\d+)?) s\]", re.M)


def mode_of(inp: dict) -> str | None:
    """The clip's mode: as asked, frames for a last frame alone, else None (today's clip)."""
    return inp.get("mode") or ("frames" if inp.get("lastFrame") else None)


def is_redo(inp: dict) -> bool:
    return isinstance(inp.get("window"), dict) and "source" in inp["window"]


def asks_connected(inp: dict) -> bool:
    """Whether a clip request uses any connected-video field (flags.connectedVideo gates them all)."""
    return any(k in inp for k in ("mode", "lastFrame", "cuts")) or is_redo(inp)


def is_picture(ref: dict | None) -> bool:
    """A KeyframeRef that is a picture already (an assetRef), not a frame of a video still to cut."""
    return bool(ref) and "sha256" in ref


def stills_needed(inp: dict) -> list[dict]:
    """The frames the relay cuts from a video before the clip is made: [{role, asset, atS}], role first or
    last. A redo window's ends (the last only with withLast), or a lastFrame given as a take's frame."""
    if is_redo(inp):
        w = inp["window"]
        out = [{"role": "first", "asset": w["source"], "atS": w["inS"]}]
        if w.get("withLast"):
            out.append({"role": "last", "asset": w["source"], "atS": w["outS"]})
        return out
    last = inp.get("lastFrame")
    if last and not is_picture(last):
        return [{"role": "last", "asset": last["asset"], "atS": last["atS"]}]
    return []


def with_stills(inp: dict, frames: dict) -> dict:
    """The input as the director reads it once the stills are cut: the first still is the clip's frame
    (input.image) and the last its lastFrame, both pictures."""
    out = dict(inp)
    if frames.get("first"):
        out["image"] = frames["first"]
    if frames.get("last"):
        out["lastFrame"] = frames["last"]
    elif not is_picture(out.get("lastFrame")):
        out.pop("lastFrame", None)
    return out


def frames_sent(inp: dict) -> int:
    """The keyframes a clip sends (a first frame, a last frame), for a model that bills each picture."""
    w = inp.get("window") if is_redo(inp) else {}
    return bool(inp.get("image") or w) + bool(inp.get("lastFrame") or (w or {}).get("withLast"))


def take_s(inp: dict) -> float:
    return round(sum(float(s["duration_s"]) for s in inp.get("shots") or []), 3)


def clip_seconds(inp: dict) -> float | None:
    """The length a connected clip is asked for before the model's fitting: a take's shots together, a redo
    window's width; None for the rest (the shot's own duration_s, as before)."""
    if mode_of(inp) in TAKE_MODES:
        return take_s(inp)
    if is_redo(inp):
        w = inp["window"]
        return round(float(w["outS"]) - float(w["inS"]), 3)
    return None


def _secs(x: float) -> str:
    return f"{round(float(x), 2):g}"


def take_plan(inp: dict, spec: dict) -> tuple[float, list[float], list[str]]:
    """(durationS, each shot's start in the take, each shot's line). The length is the shots' sum fitted to
    the model (whole seconds); with no input.cuts the slack goes to the heads of the shots after the first
    (never the first, whose frame is pinned, and never the end, which may land), split evenly."""
    shots = inp["shots"]
    duration = fit_duration(take_s(inp), spec)
    if inp.get("cuts"):
        cuts = inp["cuts"]
        return duration, [round(float(c["atS"]), 3) for c in cuts], [c["text"] for c in cuts]
    slack = max(0.0, duration - take_s(inp))
    each = slack / (len(shots) - 1) if len(shots) > 1 else 0.0
    starts, at = [], 0.0
    for k, s in enumerate(shots):
        starts.append(round(at, 3))
        at += float(s["duration_s"]) + (each if k else 0.0)
    return duration, starts, [(s.get("action") or "").strip() for s in shots]


def cuts_problem(inp: dict, duration: float) -> str | None:
    """Why input.cuts cannot time this take, or None."""
    cuts, shots = inp.get("cuts"), inp.get("shots") or []
    if not cuts:
        return None
    if len(cuts) != len(shots):
        return f"cuts has {len(cuts)} lines for {len(shots)} shots"
    times = [float(c["atS"]) for c in cuts]
    if times[0] != 0:
        return "the first cut starts at 0"
    if any(b <= a for a, b in zip(times, times[1:])) or times[-1] >= duration:
        return f"cut times must rise and stay inside the {_secs(duration)} s take"
    return None


def anchor_of(inp: dict) -> str:
    """The passthrough's anchor block: the request's own words (the run's look), cut to ANCHOR_MAX at a word."""
    text = " ".join((inp.get("text") or "").split())
    if len(text) <= ANCHOR_MAX:
        return text
    cut = text[:ANCHOR_MAX].rsplit(" ", 1)[0].rstrip(",;:")
    return cut


def timed_lines(starts: list[float], texts: list[str], duration: float) -> list[str]:
    ends = [*starts[1:], duration]
    return [f"Shot {k + 1} [{_secs(a)}-{_secs(b)} s] {t}".rstrip() for k, (a, b, t) in enumerate(zip(starts, ends, texts))]


def take_prompt(anchor: str, starts: list[float], texts: list[str], duration: float, landing: bool,
                limit: int | None = None) -> str:
    """Wan's formula (overall description, then each shot by number and time): the anchor block, one
    'Shot k [a-b s] ...' line per shot covering the whole take, and the landing line when the take ends on a
    given frame. Within `limit` (the model's promptMax): the shots' words are shortened evenly, at a word."""
    head = [anchor] if anchor else []
    tail = [LANDING] if landing else []

    def build(words: list[str]) -> str:
        return "\n".join([*head, *timed_lines(starts, words, duration), *tail])

    prompt = build(texts)
    if limit is None or len(prompt) <= limit:
        return prompt
    fixed = len(build([""] * len(texts)))
    room = max(0, (limit - fixed) // max(1, len(texts)) - 1)
    short = [t if len(t) <= room else (t[:room].rsplit(" ", 1)[0] if " " in t[:room] else t[:room]) for t in texts]
    return build(short)


def timing_problem(prompt: str, starts: list[float], duration: float) -> str | None:
    """Why a take prompt's 'Shot k [a-b s]' lines do not time the planned take, or None: one line per shot,
    numbered from 1, each starting where the plan starts it, joined end to start, the last ending at the take's
    length (so the lines add up to the duration)."""
    found = [(int(n), float(a), float(b)) for n, a, b in TIMED.findall(prompt)]
    if len(found) != len(starts):
        return f"the take prompt times {len(found)} shots, not {len(starts)}"
    ends = [*starts[1:], duration]
    for k, ((n, a, b), want_a, want_b) in enumerate(zip(found, starts, ends)):
        if n != k + 1 or abs(a - want_a) > TIME_EPS_S or abs(b - want_b) > TIME_EPS_S:
            return f"Shot {n} is timed {_secs(a)}-{_secs(b)} s, not {_secs(want_a)}-{_secs(want_b)} s"
    return None


def search_s(take: dict | None) -> float:
    """How far either side of a planned cut take_cuts looks: the model's cutAccuracyS, within the bounds."""
    acc = (take or {}).get("cutAccuracyS")
    return min(CUT_SEARCH_MAX_S, max(CUT_SEARCH_MIN_S, acc if acc is not None else CUT_SEARCH_MAX_S))


def in_words(text: str) -> str:
    """@tags said as plain words: a take sends no pictures beside its frame."""
    return TAG_IN_TEXT.sub(lambda m: unsent_in_words(m.group(0), []), text)


def shape(job: dict, inp: dict, sheet: dict, spec: dict, *, passthrough: bool) -> None:
    """Give a clip's provider job what its mode fixes, whichever director wrote it: the frames, the refs, the
    length, the audio switch, and (passthrough) the prompt. Raises ValueError where Dex's take prompt does
    not time the planned take (the passthrough then makes the job, deterministically)."""
    mode = mode_of(inp)
    if mode is None:
        return
    video = sheet.get("video") or {}
    if video.get("audioControl"):
        job["audio"] = False  # Path 2: one bed covers the film, so the models with a switch make none
    else:
        job.pop("audio", None)  # no switch (Omni Flash, Hailuo 3): the take keeps its own continuous sound
    last = inp.get("lastFrame")
    if mode in TAKE_MODES:
        duration, starts, texts = take_plan(inp, spec)
        job["durationS"] = duration
        if mode == "take":
            job["firstFrame"] = inp["image"]["sha256"]
            job["refs"] = []
            texts = [in_words(t) for t in texts]
        else:
            job.pop("firstFrame", None)
        if last:
            job["lastFrame"] = last["sha256"]
        if passthrough:
            from providers.types import prompt_max
            anchor = anchor_of(inp)
            job["prompt"] = take_prompt(in_words(anchor) if mode == "take" else anchor, starts, texts, duration,
                                        bool(last), prompt_max(sheet, job.get("model") or spec["model"]))
            return
        why = timing_problem(job.get("prompt") or "", starts, duration)
        if why:
            raise ValueError(why)
        return
    if inp.get("image"):
        job["firstFrame"] = inp["image"]["sha256"]
    if last and mode in ("frames", "redo_window"):
        job["lastFrame"] = last["sha256"]
        if passthrough and LANDING not in job.get("prompt", ""):
            job["prompt"] = f"{job.get('prompt', '').rstrip()} {LANDING}".strip()
    seconds = clip_seconds(inp)
    if seconds is not None:
        job["durationS"] = fit_duration(seconds, spec)


def problems(inp: dict, sheet: dict, spec: dict) -> str | None:
    """Why the routed model cannot make this connected clip, in the person's terms, or None. The sheet is
    the model's own view (effective_sheet); spec its ops.clip entry."""
    mode = mode_of(inp)
    video = sheet.get("video") or {}
    take = video.get("take") or {}
    label = spec.get("label") or spec.get("model", "This model")
    last = inp.get("lastFrame") or (is_redo(inp) and inp["window"].get("withLast"))
    if mode not in (None, *MODES):
        return f"Unknown clip mode {mode!r}."
    if is_redo(inp) != (mode == "redo_window"):
        return "A take's window is made again only in redo_window mode, and that mode needs one."
    if last and not video.get("lastFrame"):
        return f"{label} cannot land on a last frame."
    if last and mode in ("alone", "take_refs"):
        return f"A clip made {mode.replace('_', ' ')} lands on no last frame."
    if mode in TAKE_MODES:
        shots = inp.get("shots") or []
        if not take.get("ok"):
            return f"{label} does not make one take of several shots."
        if len(shots) > take["maxShots"]:
            return f"{label} makes a take of at most {take['maxShots']} shots, not {len(shots)}."
        if take_s(inp) > take["maxS"] + 1e-9:
            return f"{label} makes a take of at most {_secs(take['maxS'])} s; these shots are {_secs(take_s(inp))} s."
        if last and not take.get("withLast"):
            return f"{label}'s takes cannot land on a last frame yet."
        if mode == "take" and not inp.get("image"):
            return "A take starts on its first shot's frame (input.image); without frames it is take_refs."
        if mode == "take_refs" and inp.get("image"):
            return "A take from references has no frame; with one it is a take."
        return cuts_problem(inp, fit_duration(take_s(inp), spec))
    if mode == "frames" and not inp.get("image"):
        return "A clip that lands on the next frame starts on its own frame (input.image)."
    if is_redo(inp):
        w = inp["window"]
        if float(w["outS"]) <= float(w["inS"]):
            return "The window ends before it starts."
    return None


def merge_cuts(starts: list[float], found: list | None) -> list[dict]:
    """The job's cuts: each planned start after the first with what take_cuts found (None: not found)."""
    planned = starts[1:]
    found = list(found or [])
    found += [None] * (len(planned) - len(found))
    return [{"planned_s": p, "found_s": f} for p, f in zip(planned, found)]
