"""The picture-prompt lint (deck-image-gen). It fails closed: a subject, a Replace note or an assembled style block passes only if every word is
on the allow-list (data/common_words.txt: about 40,000 common English words, SCOWL size 35, plus words/visual.txt, reviewed by PR) and it holds nothing a picture model should be told: a capital letter
in mid-sentence (a name), a digit, a spelled-out number, a quotation mark, 'in the style of' or any banned imagery. It judges content only:
a part a person marked Confidential may reach the picture model (owner, 26 Nov 2026: Confidential keeps a part out of Napkin's own RAG,
layers and training, nothing else)."""
from __future__ import annotations

import re
import unicodedata
from functools import lru_cache
from pathlib import Path

WORDS = Path(__file__).resolve().parent / "words"
DATA = Path(__file__).resolve().parent / "data"
#: Well-known brand words that never pass, even lower-cased and even if a word list holds them (the capital check only sees capitalised ones).
BRAND_WORDS = frozenset("apple coca cola coke pepsi nike adidas google ford amazon facebook instagram twitter microsoft tesla uber netflix samsung sony toyota bmw ikea starbucks mcdonald disney lego visa gucci prada rolex honda nissan walmart tesco oracle intel nvidia yahoo youtube tiktok whatsapp snapchat spotify paypal ebay airbnb zara chanel dior hermes levi reebok puma nestle unilever heineken guinness".split())
NUMBER_WORDS = set("one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen seventeen eighteen nineteen twenty thirty forty fifty sixty seventy eighty ninety hundred thousand million billion dozen half".split())
QUOTES = set("\"'`«»“”‘’„‚‹›「」『』")
STYLE_OF = re.compile(r"\b(in the style of|style of|in the manner of|inspired by|à la)\b", re.I)


@lru_cache(maxsize=1)
def allowed() -> frozenset:
    out = set()
    for d, f in ((DATA, "common_words.txt"), (WORDS, "visual.txt")):
        for ln in (d / f).read_text().splitlines():
            ln = ln.strip().lower()
            if ln and not ln.startswith("#"):
                out.add(ln)
    return frozenset(out - BRAND_WORDS)


def ascii_only(text: str) -> bool:
    """True when the text, and its NFKC form, is printable ASCII (a space, a newline or a tab included) and nothing else."""
    s = str(text or "")
    ok = lambda x: all(32 <= ord(c) <= 126 or c in "\n\t" for c in x)  # noqa: E731
    return ok(s) and ok(unicodedata.normalize("NFKC", s))


def tokens(text: str) -> list[str]:
    return re.findall(r"[a-z]+", str(text).lower())


def lint_text(text: str, banned=(), allow=()) -> str | None:
    """Why this text may not go to a picture model, or None when it is clean. ``allow``: extra words that pass (the banned imagery named in
    a 'Never show' line: curated by a pack steward or a brand, and a pack refuses digits and quotes already)."""
    t = str(text or "")
    if not t.strip():
        return "it is empty"
    if not ascii_only(t):
        return "it holds a character outside printable ASCII (fullwidth, non-Latin, invisible, emoji or a symbol form of a digit)"
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
        if w in BRAND_WORDS or (w.endswith("s") and w[:-1] in BRAND_WORDS):
            return f"{w!r} is a brand name"
        if w in NUMBER_WORDS:
            return f"{w!r} is a number in words"
        if w not in ok and not (w.endswith("s") and w[:-1] in ok) and not (w.endswith("es") and w[:-2] in ok):   # a plural of a listed word passes
            return f"{w!r} is not on the allowed word list"
    low = t.lower()
    for b in banned or ():
        if re.search(rf"\b{re.escape(str(b).lower())}s?\b", low):
            return f"it names banned imagery ({b})"
    return None
