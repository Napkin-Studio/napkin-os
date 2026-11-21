"""Rewrite canonical @tags in a prompt into a provider's reference syntax.

Tags are stored once in the strictest form (common.schema.json#/$defs/tag) and
written in prompts as `@hero`. Each provider names references differently
(capabilities.schema.json tagSyntax), so the adapter rewrites them here, in one
deterministic function, instead of trusting a model to write each dialect.

A prompt the director already wrote in a provider's dialect holds no canonical
@tags, so rewriting it is a no-op.
"""

from __future__ import annotations

import re
from typing import Iterable, Sequence

# A canonical tag: not glued to a word or another @ (so e-mail addresses are left alone).
TAG = re.compile(r"(?<![\w@])@([a-z][a-z0-9_]{2,15})\b")


class UnknownTag(ValueError):
    """The prompt names a @tag that is not among the refs sent with the job."""


# A view of a character ("maya_front"): said as its name ("Maya"), never "maya front" (UAT round 5, R5-F8: the
# Omni prompt read "The woman is maya front, also seen in maya full"). "in_1" (a take's frame) is not a key.
_VIEW = re.compile(r"^([a-z][a-z0-9]{1,23})_([a-z0-9][a-z0-9-]*)$")


def as_words(name: str, characters: Iterable[str] = ()) -> str:
    """A tag's name as words: a view of a character is the character's name ("Maya", never "maya front"); any other
    name with its _ as a space ("hat front"). `characters`: the keys the job knows as characters."""
    m = _VIEW.match(name)
    if m and m.group(1) != "in" and m.group(1) in set(characters):
        return m.group(1).capitalize()
    return name.replace("_", " ")


# Once each tag is the key's name, one character's views read "Maya, also seen in Maya" and "Maya and Maya are views
# of one single character…": said once.
_ALSO_SEEN = re.compile(r"\b([A-Z][a-z0-9]+), also seen in \1\b")
_SAME_LIST = re.compile(r"\b([A-Z][a-z0-9]+)(?:(?:,| and|, and) \1\b)+")
_VIEWS_ONE = re.compile(r"\b([A-Z][a-z0-9]+) are views of one single character from different sides: "
                        r"show exactly one of it, never copies\.")


def said_once(prompt: str) -> str:
    """A tagless prompt with one character's views said as one name once."""
    prompt = _ALSO_SEEN.sub(r"\1", prompt)
    prompt = _SAME_LIST.sub(r"\1", prompt)
    return _VIEWS_ONE.sub(r"Show exactly one \1, never copies.", prompt)


def unsent_in_words(prompt: str, names: Sequence[str], characters: Iterable[str] = ()) -> str:
    """Say in plain words each @tag that is not among `names`, the refs this request sends: the edited
    image itself ('current' is 'the image'), a picture the endpoint cannot take, the whole character
    beside its front. An adapter calls this before rewrite_tags, so a name never fails a job there
    (2026-10-09); the director's own check still refuses a name that is in none of the job's refs."""
    known, cast = set(names), set(characters)
    return TAG.sub(lambda m: m.group(0) if m.group(1) in known
                   else "the image" if m.group(1) == "current" else as_words(m.group(1), cast), prompt)


TIED_TAG = re.compile(r"(follows image \d+)[ \t]*\(@[a-z][a-z0-9_]*\)", re.I)


def _render(syntax: str, name: str, characters: Iterable[str] = ()) -> str:
    if syntax == "at_tag":
        return f"@{name}"
    if syntax == "none":  # a model that names no picture by tag: the name as words ("Maya", "hat"; R5-F8)
        return as_words(name, characters)
    raise ValueError(f"unknown tagSyntax {syntax!r}")


def rewrite_tags(prompt: str, names: Sequence[str], syntax: str, characters: Iterable[str] = ()) -> str:
    """Replace each `@name` with the provider's form. `names` lists the refs sent to the provider; `characters` the
    keys the job knows as characters (said as names by a tagless model)."""
    known, cast = set(names), set(characters)

    def sub(m: re.Match) -> str:
        name = m.group(1)
        if name not in known:
            raise UnknownTag(f"@{name} is not one of the refs {list(names)}")
        return _render(syntax, name, cast)

    if syntax == "none":
        # A take's "follows image 2 (@in_2)": a tagless model knows a picture by its place only, so the tag in
        # brackets goes, not said as words ("follows image 1 (in 1)", UAT 2026-11-21).
        prompt = TIED_TAG.sub(r"\1", prompt)
        return said_once(TAG.sub(sub, prompt))
    return TAG.sub(sub, prompt)
