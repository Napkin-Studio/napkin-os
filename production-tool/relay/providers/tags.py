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


def _render(syntax: str, name: str, n: int) -> str:
    if syntax == "at_tag":
        return f"@{name}"
    if syntax == "at_image_n":
        return f"@Image{n}"
    if syntax == "picture_n":
        return f"<Picture {n}>"
    if syntax == "figure_n":
        return f"Figure {n}"
    if syntax == "image_n":
        return f"image {n}"
    if syntax == "none":
        return name
    raise ValueError(f"unknown tagSyntax {syntax!r}")


def rewrite_tags(prompt: str, names: Sequence[str], syntax: str) -> str:
    """Replace each `@name` with the provider's form.

    `names` lists the refs in the order they are sent to the provider; a ref's
    position (1-based) is its number in the numbered syntaxes.
    """
    position = {name: i + 1 for i, name in enumerate(names)}

    def sub(m: re.Match) -> str:
        name = m.group(1)
        if name not in position:
            raise UnknownTag(f"@{name} is not one of the refs {list(names)}")
        return _render(syntax, name, position[name])

    return TAG.sub(sub, prompt)
