"""Stable item ids (`^[a-z0-9][a-z0-9_-]{0,39}$`): the same item gets the same id on every build, so a diff matches by id."""

import hashlib
import re
import unicodedata

ID = re.compile(r"^[a-z0-9][a-z0-9_-]{0,39}$")


def slug(text: str, fallback: str = "item", n: int = 32) -> str:
    t = unicodedata.normalize("NFKD", str(text or "")).encode("ascii", "ignore").decode().lower()
    t = re.sub(r"[^a-z0-9]+", "-", t).strip("-")[:n].strip("-")
    return t or fallback


def digest(text: str, n: int = 6) -> str:
    return hashlib.sha256(str(text).encode()).hexdigest()[:n]


class Ids:
    """One namespace per list: `take(base)` is `base`, then `base-2`, `base-3` for a repeat."""

    def __init__(self):
        self.used = set()

    def take(self, base: str) -> str:
        base = slug(base)[:36].strip("-") or "item"
        out, i = base, 2
        while out in self.used:
            out = f"{base}-{i}"
            i += 1
        self.used.add(out)
        return out
