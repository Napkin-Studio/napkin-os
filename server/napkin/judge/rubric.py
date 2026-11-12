"""The rubric file (rubric.json): versioned, ten tests per dimension, craft per kind of work."""

from __future__ import annotations

import json
from functools import lru_cache
from pathlib import Path

FILE = Path(__file__).with_name("rubric.json")
DIMS = ("idea", "craft", "effect")


@lru_cache(maxsize=1)
def load() -> dict:
    return json.loads(FILE.read_text())


def version() -> str:
    return str(load()["version"])


def kinds() -> list[str]:
    return list(load()["kinds"])


def tests_for(kind: str) -> list[dict]:
    """The thirty tests of one work kind: idea, then craft of that kind, then effect."""
    ts = load()["tests"]
    out = []
    for dim in DIMS:
        out += [t for t in ts if t["dim"] == dim and t["kind"] in (None, kind)]
    return out
