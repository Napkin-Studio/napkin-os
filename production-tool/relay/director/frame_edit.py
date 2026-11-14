"""Change this frame without a model (features/frame-change-edit.clan): the passthrough's reading of
the words, from common.schema.json's cameraWords, the table director.v7's camera lines and the web's
chip labels are written from too.

Camera words read as a camera change, size words that could mean either ("bigger", "smaller",
"larger", "closer") ask "Bigger how?", and anything else is a local change sent as written. It
never defaults on ambiguous words: those ask, or follow the person's answer.
"""

from __future__ import annotations

import re
from functools import lru_cache
from typing import Optional

from .director import MOVE_LEAVES, READINGS, camera_words

# Words that could mean the camera or the thing itself (ui-behaviour 3.11: "Bigger how?"), and which
# way along the size ladder a camera reading of them moves.
SIZE_WORDS = {"bigger": 1, "larger": 1, "closer": 1, "smaller": -1}
LADDER = ["extreme_wide", "wide", "medium_wide", "medium", "medium_close", "close", "extreme_close"]
LENS = re.compile(r"\b(\d{1,3})\s?mm\b")
MACRO = re.compile(r"\bmacro\b")
WORD = re.compile(r"[a-z]+")


@lru_cache(maxsize=1)
def _phrases() -> list[tuple[str, str, str]]:
    """(phrase, field, value), longest phrase first, so 'dutch tilt' wins over 'tilt'."""
    out = [(w.lower(), field, value) for field, values in camera_words().items()
           for value, row in values.items() if value != "graphic" for w in row["words"]]
    return sorted(out, key=lambda p: -len(p[0]))


def camera_in_words(text: str) -> dict:
    """The camera leaves the words name: each phrase's span is used once, and a field named twice
    takes its first mention. A speed counts only beside a movement ('push in slowly'), so 'she slowly
    turns' is no camera change."""
    low = re.sub(r"\s+", " ", (text or "").lower())
    taken = [False] * len(low)
    found: dict[str, tuple[int, str]] = {}
    for phrase, field, value in _phrases():
        for m in re.finditer(r"(?<![a-z])" + re.escape(phrase) + r"(?![a-z])", low):
            if any(taken[m.start():m.end()]):
                continue
            for i in range(m.start(), m.end()):
                taken[i] = True
            if field not in found or m.start() < found[field][0]:
                found[field] = (m.start(), value)
    patch: dict = {field: value for field, (_, value) in found.items()}
    if "movement_speed" in patch and "movement" not in patch:
        del patch["movement_speed"]
    lens = LENS.search(low)
    if lens and 8 <= int(lens.group(1)) <= 800:
        patch["lens_mm"] = int(lens.group(1))
    if MACRO.search(low):
        patch["macro"] = True
    return patch


def size_word(text: str) -> Optional[str]:
    return next((w for w in WORD.findall((text or "").lower()) if w in SIZE_WORDS), None)


def reading_of(text: str, camera: dict, answer: Optional[str] = None) -> tuple[str, dict]:
    """("camera" | "local" | "both" | "ask", the camera leaves that change). An answer (camera, local or
    both) settles the reading; a size word with no answer asks."""
    camera = camera or {}
    patch = {k: v for k, v in camera_in_words(text).items() if camera.get(k) != v}
    sized = size_word(text)
    if answer in READINGS:
        if answer == "local":
            return "local", {}
        if not patch and sized:
            stepped = _step(camera.get("size"), SIZE_WORDS[sized])
            patch = {"size": stepped} if stepped else {}
        return answer, patch
    if sized:
        return "ask", {}
    return ("camera", patch) if patch else ("local", {})


def run_as(reading: str, patch: dict, regioned: bool) -> str:
    """The op the provider job runs as (director.schema.json frameEdit.runAs)."""
    if reading == "local":
        return "region_edit" if regioned else "frame"
    if reading == "camera" and patch and set(patch) <= MOVE_LEAVES:
        return "none"
    return "frame"


def question(word: str) -> dict:
    """'Bigger how?': an ambiguity, with no option recommended and no cost (owner decision 2026-10-13)."""
    return {"kind": "ambiguity", "text": f"{word.capitalize()} how?",
            "why": f"\"{word}\" could mean moving the camera, or changing the thing itself in the frame.",
            "options": [{"id": "camera", "label": "Move the camera", "value": "camera"},
                        {"id": "local", "label": "Change it in the frame", "value": "local"},
                        {"id": "both", "label": "Both", "value": "both"}],
            "allow_text": False}


def _step(size: Optional[str], by: int) -> Optional[str]:
    if size not in LADDER:
        return None
    i = min(max(LADDER.index(size) + by, 0), len(LADDER) - 1)
    return LADDER[i] if LADDER[i] != size else None
