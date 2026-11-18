"""The picture-prompt lint (deck-image-gen). It fails closed: a subject, a Replace note or an assembled style block passes only if every word is
on the allow-list (words/common.txt and words/visual.txt, reviewed by PR) and it holds nothing a picture model should be told: a capital letter
in mid-sentence (a name), a digit, a spelled-out number, a quotation mark, 'in the style of', any banned imagery, or anything from a part a
person marked Confidential (a deny-list of the marked texts: every word not on the list, their 3-word shingles, and a paraphrase test)."""
from __future__ import annotations

import re
from functools import lru_cache
from pathlib import Path

WORDS = Path(__file__).resolve().parent / "words"
NUMBER_WORDS = set("one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen seventeen eighteen nineteen twenty thirty forty fifty sixty seventy eighty ninety hundred thousand million billion dozen half".split())
QUOTES = set("\"'`«»“”‘’„‚‹›「」『』")
STYLE_OF = re.compile(r"\b(in the style of|style of|in the manner of|inspired by|à la)\b", re.I)
MARKED_SHARED_WORDS = 3     # a subject that shares this many distinct content words with one marked text is a paraphrase of it


@lru_cache(maxsize=1)
def allowed() -> frozenset:
    out = set()
    for f in ("common.txt", "visual.txt"):
        for ln in (WORDS / f).read_text().splitlines():
            ln = ln.strip().lower()
            if ln and not ln.startswith("#"):
                out.add(ln)
    return frozenset(out)


def tokens(text: str) -> list[str]:
    return re.findall(r"[a-z]+", str(text).lower())


def lint_text(text: str, banned=(), deny: dict | None = None, allow=()) -> str | None:
    """Why this text may not go to a picture model, or None when it is clean. ``allow``: extra words that pass (the banned imagery named in
    a 'Never show' line: curated by a pack steward or a brand, and a pack refuses digits and quotes already)."""
    t = str(text or "")
    if not t.strip():
        return "it is empty"
    if deny:
        why = confidential_hit(t, deny)
        if why:
            return why
    if any(c in QUOTES for c in t):
        return "it holds a quotation mark"
    if re.search(r"\d", t):
        return "it holds a digit"
    if STYLE_OF.search(t):
        return "it asks for the style of someone"
    # a capital letter that does not start a sentence reads as a name
    for m in re.finditer(r"(?<![.!?:]\s)(?<!^)\b[A-Z][a-z]+", t):
        before = t[:m.start()].rstrip()
        if before and before[-1] not in ".!?:(\n":
            return f"{m.group(0)!r} is a capital in mid-sentence (a name)"
    ok = allowed() | {w for a in allow for w in tokens(a)}
    for w in tokens(t):
        if w in NUMBER_WORDS:
            return f"{w!r} is a number in words"
        if w not in ok and not (w.endswith("s") and w[:-1] in ok) and not (w.endswith("es") and w[:-2] in ok):   # a plural of a listed word passes
            return f"{w!r} is not on the allowed word list"
    low = t.lower()
    for b in banned or ():
        if re.search(rf"\b{re.escape(str(b).lower())}s?\b", low):
            return f"it names banned imagery ({b})"
    return None


def deny_list(marks) -> dict:
    """What a subject may not carry, built from the marked texts: ``{"words": {...}, "shingles": {...}, "texts": [content word sets]}``. Every
    word of a marked text that is not on the common list (codenames, names, figures) is denied; so is every 3-word run of it."""
    ok = allowed()
    words, shingles, texts = set(), set(), []
    for m in marks or ():
        toks = tokens(m.get("text") if isinstance(m, dict) else m)
        words |= {w for w in toks if w not in ok}
        shingles |= {tuple(toks[i:i + 3]) for i in range(len(toks) - 2)}
        for d in re.findall(r"\d+", str(m.get("text") if isinstance(m, dict) else m)):
            words.add(d)
        texts.append({w for w in toks if len(w) >= 4})
    return {"words": words, "shingles": shingles, "texts": texts}


def confidential_hit(text: str, deny: dict) -> str | None:
    toks = tokens(text)
    for w in toks:
        if w in deny["words"]:
            return "would draw on a Confidential part"
    for i in range(len(toks) - 2):
        tri = tuple(toks[i:i + 3])
        if tri in deny["shingles"]:
            return "would draw on a Confidential part"
    mine = {w for w in toks if len(w) >= 4}
    for ms in deny["texts"]:
        if len(mine & ms) >= MARKED_SHARED_WORDS:
            return "would draw on a Confidential part"
    if re.search(r"\d", text) and any(re.fullmatch(r"\d+", w) for w in deny["words"]):
        return "would draw on a Confidential part"
    return None
