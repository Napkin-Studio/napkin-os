"""Clock times kept out of a clip's prompt unless a shot asks for words on screen (UAT 2026-11-21, F11: "A dark
shared kitchen, 1 a.m." reached Omni Flash as words, and it burned "1 a.m. 1 a.m." into the take despite "No
text"). A video model told a time draws it; the time of day is said as light and hour words instead."""

from __future__ import annotations

import re

TIME = re.compile(r"(?P<at>\bat\s+)?\b(?P<h>\d{1,2})(?::(?P<m>\d{2}))?\s*(?P<ap>a\.?\s?m\.?|p\.?\s?m\.?)(?=[\s,.;:!?)]|$)", re.I)
# A shot that asks for words on screen keeps its time: a clock face, a sign or a screen that shows it.
ON_SCREEN = re.compile(r"\b(clock|watch face|display|screen (?:shows|reads)|reads|sign|caption|title card|super|text on screen|on-screen)\b", re.I)


def _hour_words(h: int, pm: bool) -> str:
    h = h % 12 + (12 if pm else 0)
    if h < 5:
        return "in the small hours"
    if h < 12:
        return "in the morning"
    if h < 17:
        return "in the afternoon"
    if h < 21:
        return "in the evening"
    return "late at night"


def asks_on_screen(inp: dict) -> bool:
    """Whether a shot of the clip asks for words on screen (its action or direction)."""
    shots = inp.get("shots") or ([inp["shot"]] if inp.get("shot") else [])
    return any(ON_SCREEN.search(f"{s.get('action') or ''} {s.get('direction') or ''}") for s in shots if isinstance(s, dict))


def soften(prompt: str) -> str:
    """The prompt with each clock time said as the time of day ("at 1 a.m." -> "in the small hours")."""
    def word(m: re.Match) -> str:
        said = _hour_words(int(m.group("h")), m.group("ap").lower().startswith("p"))
        # "a.m." that also ended its sentence keeps the full stop.
        rest = m.string[m.end():]
        ends = m.group(0).endswith(".") and (not rest or rest[0] == "\n" or re.match(r"\s+[A-Z]", rest))
        return said + "." if ends else said
    out = TIME.sub(word, prompt)
    return re.sub(r"(in the small hours|in the morning|in the afternoon|in the evening|late at night)(\s+\1)+", r"\1", out)


def apply(job: dict, inp: dict) -> None:
    """In place: the provider job's prompt without clock times, unless a shot asks for words on screen."""
    prompt = job.get("prompt")
    if not prompt or asks_on_screen(inp):
        return
    job["prompt"] = soften(prompt)
