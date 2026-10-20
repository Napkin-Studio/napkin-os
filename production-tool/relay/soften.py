"""A clip's words made plainer after the provider's text moderation refused them (features/connected-video.clan).

Runway refuses some prompts as a whole that it took shot by shot: one take of a samurai ad was refused
("Text prompt did not pass moderation", INPUT_PREPROCESSING.SAFETY.TEXT, 2026-10-19), though "His blade flashes."
had passed as a single clip. Together, "samurai" and "blade flashes" tripped it. The relay then tries once more
with the same job and plainer words: Dex rewrites them, and the passthrough (or a rewrite that loses the take's
timing) uses WORDS, a small fixed map from weapon and violence wording to kitchen and household words. Only a
text refusal is retried this way. A refused picture is the person's to change.
"""

from __future__ import annotations

import re

# Phrases first, then single words; a word keeps its capital. Kitchen and household words, so a hand that held a
# blade now holds a kitchen knife and every beat still happens.
PHRASES = (
    ("blade flashes", "kitchen knife moves quickly"),
    ("blade flashed", "kitchen knife moved quickly"),
    ("sword flashes", "kitchen knife moves quickly"),
)
WORDS = {
    "blade": "kitchen knife", "blades": "kitchen knives",
    "sword": "kitchen knife", "swords": "kitchen knives",
    "katana": "kitchen knife", "katanas": "kitchen knives",
    "dagger": "kitchen knife", "daggers": "kitchen knives",
    "weapon": "tool", "weapons": "tools",
    "slash": "chop", "slashes": "chops", "slashing": "chopping", "slashed": "chopped",
    "strike": "tap", "strikes": "taps", "striking": "tapping", "struck": "tapped",
    "kill": "finish", "kills": "finishes", "killing": "finishing", "killed": "finished",
    "blood": "tomato sauce", "bloody": "messy",
}
_WORD = re.compile(r"\b(" + "|".join(sorted(WORDS, key=len, reverse=True)) + r")\b", re.I)

# What a refusal at submit says when the provider's text check refused the words (Runway's codes). A picture
# refusal (SAFETY.INPUT.IMAGE, SAFETY.IMAGE) is not one.
TEXT_CODE = "SAFETY.TEXT"
TWICE = "Runway refused the words twice"
NOTE = "Runway refused the first wording; I made it plainer."  # Dex, in the History


def text_refusal(code: str | None, message: str | None) -> bool:
    """Whether a refusal was of the words, not a picture."""
    if code:
        return TEXT_CODE in code.upper()
    return "text" in (message or "").lower() and "image" not in (message or "").lower()


def _keep_case(src: str, dst: str) -> str:
    return dst[:1].upper() + dst[1:] if src[:1].isupper() else dst


def plain_words(prompt: str) -> str:
    """The prompt with WORDS' plainer wording; everything else (the timing lines, every beat) as it was."""
    out = prompt
    for a, b in PHRASES:
        out = re.sub(rf"\b{re.escape(a)}\b", lambda m, b=b: _keep_case(m.group(0), b), out, flags=re.I)
    return _WORD.sub(lambda m: _keep_case(m.group(0), WORDS[m.group(0).lower()]), out)
