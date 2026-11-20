"""Sound on a clip (features/pt-film-r1.clan, UAT 2026-11-21 B6: every clip came out silent, and the snore the
words-only film turned on went into a sound beat nothing played). The smallest part of features/audio-native.clan:
one rule, here, for whether a clip is made with sound, read by the director (the provider job's audio), the
passthrough and the reservation (the price: audioCredits where a model has them).

  A clip or take is made with sound when one of its shots has a spoken line, a VO or a sound beat, and the
  model has an audio switch (capability video.audioControl). A model with no switch (Omni Flash 1.1, Hailuo 3)
  is told "no music, no dialogue" as before (decided 2026-10-06), and the box says it makes no line.

The shots' spoken lines reach a clip only when it is made with sound (web jobs/select jobShot keeps them then,
and the director's _without_dialogue strips them otherwise: a model told the words draws them, 2026-10-07). The
relay says them in the provider prompt as speech, with who says them and when, and asks for no subtitles: Dex
never sees them, so his prompt is unchanged.
"""

from __future__ import annotations

SOUND_KINDS = ("line", "vo", "sound")
SPOKEN = ("line", "vo")
NO_SUBTITLES = "Spoken aloud, no subtitles or captions."


def _shots(inp: dict) -> list[dict]:
    shots = list(inp.get("shots") or [])
    return shots or ([inp["shot"]] if isinstance(inp.get("shot"), dict) else [])


def wants_sound(inp: dict) -> bool:
    """A shot of the clip has a line, a VO or a sound beat with words."""
    return any(b.get("kind") in SOUND_KINDS and (b.get("text") or "").strip() for s in _shots(inp) for b in s.get("beats") or [])


def audio_on(inp: dict, sheet: dict | None) -> bool:
    """The provider job's audio switch: on for a clip with sound on a model that has the switch."""
    return bool(((sheet or {}).get("video") or {}).get("audioControl")) and wants_sound(inp)


def _secs(x: float) -> str:
    return f"{round(float(x), 1):g}"


def spoken_lines(inp: dict, starts: list[float] | None = None) -> list[str]:
    """Each spoken line as the provider reads it: '[1 s] HER, whispering: "Quietboil. Let them sleep."'. In a take
    the time is the take's (each shot's start plus the beat's)."""
    out = []
    for k, s in enumerate(_shots(inp)):
        at0 = starts[k] if starts and k < len(starts) else 0.0
        for b in s.get("beats") or []:
            text = (b.get("text") or "").strip().strip('"“”')
            if b.get("kind") not in SPOKEN or not text:
                continue
            who = "A voice over" if b["kind"] == "vo" else (b.get("speaker") or "Someone").strip()
            how = (b.get("parenthetical") or "").strip().strip("()").strip()
            out.append(f"[{_secs(at0 + float(b.get('at_s') or 0))} s] {who}{', ' + how if how else ''}: “{text}”")
    return out


def apply(job: dict, inp: dict, sheet: dict | None, *, starts: list[float] | None = None, prompt_max: int | None = None) -> None:
    """Set the clip's audio switch by the rule, and with sound on, say its spoken lines in the prompt (only while
    the prompt stays within the model's limit). In place."""
    video = (sheet or {}).get("video") or {}
    if video.get("audioControl"):
        job["audio"] = audio_on(inp, sheet)
    else:
        job.pop("audio", None)  # no switch: the adapter sends none
    if not job.get("audio"):
        return  # a silent clip, or a model with no switch: the director wrote "no music, no dialogue" (2026-10-06)
    lines = spoken_lines(inp, starts)
    if not lines:
        return
    prompt = (job.get("prompt") or "").rstrip()
    said = " ".join(lines) + " " + NO_SUBTITLES
    if said in prompt:
        return
    joined = f"{prompt}\n{said}".strip()
    if prompt_max is None or len(joined.encode("utf-16-le")) // 2 <= prompt_max:
        job["prompt"] = joined
