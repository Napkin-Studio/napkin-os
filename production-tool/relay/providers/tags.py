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
from typing import Sequence

# A canonical tag: not glued to a word or another @ (so e-mail addresses are left alone).
TAG = re.compile(r"(?<![\w@])@([a-z][a-z0-9_]{2,15})\b")


class UnknownTag(ValueError):
    """The prompt names a @tag that is not among the refs sent with the job."""


def unsent_in_words(prompt: str, names: Sequence[str]) -> str:
    """Say in plain words each @tag that is not among `names`, the refs this request sends: the edited
    image itself ('current' is 'the image'), a picture the endpoint cannot take, the whole character
    beside its front. An adapter calls this before rewrite_tags, so a name never fails a job there
    (2026-10-09); the director's own check still refuses a name that is in none of the job's refs."""
    known = set(names)
    return TAG.sub(lambda m: m.group(0) if m.group(1) in known
                   else "the image" if m.group(1) == "current" else m.group(1).replace("_", " "), prompt)


def _render(syntax: str, name: str) -> str:
    if syntax == "at_tag":
        return f"@{name}"
    if syntax == "none":
        return name
    raise ValueError(f"unknown tagSyntax {syntax!r}")


def rewrite_tags(prompt: str, names: Sequence[str], syntax: str) -> str:
    """Replace each `@name` with the provider's form. `names` lists the refs sent to the provider."""
    known = set(names)

    def sub(m: re.Match) -> str:
        name = m.group(1)
        if name not in known:
            raise UnknownTag(f"@{name} is not one of the refs {list(names)}")
        return _render(syntax, name)

    return TAG.sub(sub, prompt)
