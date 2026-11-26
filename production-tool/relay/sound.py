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

import math

SOUND_KINDS = ("line", "vo", "sound")
SPOKEN = ("line", "vo")
NO_SUBTITLES = "Spoken aloud, no subtitles or captions."


def _shots(inp: dict) -> list[dict]:
    shots = list(inp.get("shots") or [])
    return shots or ([inp["shot"]] if isinstance(inp.get("shot"), dict) else [])


# A beat that asks for no sound ("Silence: the kettle boils with no noise at all") is not a sound: it turned sound on,
# and Veo with sound, for a silent shot (UAT round 3, F22/R3-F6). The web's box sound line reads the same words
# (web/src/rooms/boxModel.ts SILENCE).
import re as _re0

SILENCE = _re0.compile(
    r"\b(?:silence|silent|silently|soundless|noiseless|muted?|no (?:sound|noise)s?|without (?:a |any )?(?:sound|noise)s?"
    r"|nothing (?:is )?heard|not a sound|hushed? quiet)\b", _re0.I)


def is_silence(beat: dict) -> bool:
    """A sound beat that asks for no sound."""
    return beat.get("kind") == "sound" and bool(SILENCE.search(beat.get("text") or ""))


def wants_sound(inp: dict) -> bool:
    """A shot of the clip has a line, a VO or a sound beat with words (a beat asking for silence is none)."""
    return any(b.get("kind") in SOUND_KINDS and (b.get("text") or "").strip() and not is_silence(b)
               for s in _shots(inp) for b in s.get("beats") or [])


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


def sound_lines(inp: dict, starts: list[float] | None = None) -> list[str]:
    """Each sound beat (not one asking for silence) as the provider reads it: '[0 s] Sound: Steady snoring through the
    wall.' (UAT round 4, R4-F10: a clip made with sound never heard of "A soft click... no roar"). In a take the time is
    the take's."""
    out = []
    for k, s in enumerate(_shots(inp)):
        at0 = starts[k] if starts and k < len(starts) else 0.0
        for b in s.get("beats") or []:
            text = (b.get("text") or "").strip()
            if b.get("kind") != "sound" or not text or is_silence(b):
                continue
            out.append(f"[{_secs(at0 + float(b.get('at_s') or 0))} s] Sound: {text}")
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
    sounds = sound_lines(inp, starts)
    prompt = (job.get("prompt") or "").rstrip()
    # The sounds the shots ask for, said as sound (R4-F10), then the spoken lines as speech; each only while the prompt
    # stays within the model's limit, the lines first.
    for said in ([" ".join(lines) + " " + NO_SUBTITLES] if lines else []) + ([" ".join(sounds)] if sounds else []):
        if said in prompt:
            continue
        joined = f"{prompt}\n{said}".strip()
        if prompt_max is None or len(joined.encode("utf-16-le")) // 2 <= prompt_max:
            prompt = joined
    if prompt != (job.get("prompt") or "").rstrip():
        job["prompt"] = prompt


# ── Sound beats only where the script asks (UAT 2026-11-21, F22) ───────────────────────────────────────
# Dex added a sound beat to most shots ("night hum", "faint hush"), and each turned sound on, which doubles Veo's
# price, for shots whose script asks for no sound. A planned sound beat stays only when the script names its sound.
import re as _re

_AIR = {"soft", "faint", "quiet", "gentle", "low", "distant", "ambient", "ambience", "room", "tone", "sound", "sounds",
        "night", "day", "background", "subtle", "light", "slight", "hush", "silence", "silent", "still", "air", "the",
        "and", "with", "from", "into", "over", "under", "one", "two", "some", "a", "an", "of", "in", "on", "at", "its"}


def _words(text: str) -> list[str]:
    return [w for w in _re.findall(r"[a-z]+", (text or "").lower()) if len(w) >= 3 and w not in _AIR]


def asked_sound(beat_text: str, script: str) -> bool:
    """The script names this sound: one of its words (not a word of mood or air) is in the script, by its stem."""
    said = (script or "").lower()
    return any(_re.search(r"\b" + _re.escape(w[:max(3, len(w) - 2)]), said) for w in _words(beat_text))


def keep_asked_sounds(shots: list[dict], script: str) -> tuple[list[dict], list[str]]:
    """The plan's shots with only the sound beats the script asks for; and the ones left out (for the log)."""
    if not (script or "").strip():
        out = [{**s, "beats": [b for b in s["beats"] if not is_silence(b)]} if any(is_silence(b) for b in s.get("beats") or []) else s for s in shots]
        return out, [b.get("text") or "" for s in shots for b in s.get("beats") or [] if is_silence(b)]
    gone: list[str] = []
    out = []
    for s in shots:
        beats = s.get("beats")
        if not beats:
            out.append(s)
            continue
        kept = [b for b in beats if b.get("kind") != "sound" or (not is_silence(b) and asked_sound(b.get("text") or "", script))]
        gone += [b.get("text") or "" for b in beats if b not in kept]
        out.append({**s, "beats": kept} if len(kept) != len(beats) else s)
    return out, gone


# ── A spoken line's length (UAT round 5, R5-F2) ──────────────────────────────────────────────────────────────────
# Plan shots gave the whispered "Good boy." 1.0 s; WAN 3 voiced it from 0.4 s to 1.7 s of its 2 s take, and the ad
# played 0-1.0 s. A shot that speaks gets at least its line's spoken length: the twin of web script/spoken.ts.
SPOKEN_RATE = 2.5   # words a second: skye rule 10, web compose roughSeconds
WHISPER_RATE = 2.0
LEAD_IN_S = 0.5
TAIL_S = 0.5
MIN_SHOT_S = 1.0    # a shot that gives time back never goes below this
_SOFT = _re0.compile(r"\b(?:whisper\w*|murmur\w*|mutter\w*|hush\w*|softly|under (?:her|his|their) breath)\b", _re0.I)


def _half_up(s: float) -> float:
    return math.ceil(s * 2 - 1e-6) / 2


def spoken_seconds(text: str, parenthetical: str = "") -> float:
    """The seconds a line's words take to say: whispered (its parenthetical says so) slower."""
    words = len(_re0.findall(r"[\w']+", text or ""))
    return words / (WHISPER_RATE if _SOFT.search(parenthetical or "") else SPOKEN_RATE)


def spoken_need(shot: dict) -> float:
    """Where a shot's spoken lines end, from its start (the latest line's start, at least the lead-in, its words, the
    tail), in half seconds; 0 when it says nothing."""
    end = 0.0
    for b in shot.get("beats") or []:
        if b.get("kind") in SPOKEN and (b.get("text") or "").strip():
            end = max(end, max(float(b.get("at_s") or 0), LEAD_IN_S) + spoken_seconds(b["text"], b.get("parenthetical") or "") + TAIL_S)
    return _half_up(end) if end else 0.0


def _floor(shot: dict) -> float:
    """The least a shot that says nothing keeps: MIN_SHOT_S, and half a second past its last beat."""
    last = max([float(b.get("at_s") or 0) for b in shot.get("beats") or []] or [0.0])
    return max(MIN_SHOT_S, _half_up(last + 0.5) if shot.get("beats") else 0.0)


def spoken_floor(shots: list[dict], target_s: float | None = None) -> tuple[list[dict], list[str]]:
    """Every shot that speaks gets at least its line's spoken length (spoken_need); the time comes back from shots that
    say nothing, half a second at a time from the one with most room, so the film keeps its target length where it
    can. When they have no room left the film runs long rather than cut a line. The shots, and what changed (for the
    log). The end card is left as it is."""
    out = [dict(s) for s in shots]
    notes: list[str] = []
    grew = 0.0
    for i, s in enumerate(out):
        need = spoken_need(s)
        if s.get("kind") != "end_card" and need > float(s.get("duration_s") or 0) + 1e-6:
            notes.append(f"shot {i + 1} {s.get('duration_s')} s -> {need:g} s for its line")
            grew += need - float(s.get("duration_s") or 0)
            s["duration_s"] = need
    if not grew or target_s is None:
        return out, notes
    over = sum(float(s.get("duration_s") or 0) for s in out) - float(target_s)
    while over > 0.25:
        donors = [(float(s["duration_s"]) - _floor(s), i) for i, s in enumerate(out)
                  if s.get("kind") != "end_card" and not spoken_need(s) and float(s["duration_s"]) - _floor(s) >= 0.5 - 1e-6]
        if not donors:
            notes.append(f"the film runs {over:g} s long: no shot without a line had time to give")
            break
        _, i = max(donors, key=lambda x: (x[0], -x[1]))
        out[i]["duration_s"] = round(float(out[i]["duration_s"]) - 0.5, 3)
        notes.append(f"shot {i + 1} gave 0.5 s")
        over -= 0.5
    return out, notes
