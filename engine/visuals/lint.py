"""The picture-prompt lint (deck-image-gen). It fails closed: a subject, a Replace note or an assembled style block passes only if every word is
on the allow-list (data/common_words.txt: about 40,000 common English words, SCOWL size 35, plus words/visual.txt, reviewed by PR) and it holds nothing a picture model should be told: a capital letter
in mid-sentence (a name), a digit, a spelled-out number, a quotation mark, 'in the style of', any banned imagery, or anything from a part a
person marked Confidential (a deny-list of the marked texts: every word not on the list, their 3-word shingles, and a paraphrase test)."""
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
MARKED_SHARED_WORDS = 3     # a subject that shares this many distinct content words with one marked text is a paraphrase of it


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


def lint_text(text: str, banned=(), deny: dict | None = None, allow=()) -> str | None:
    """Why this text may not go to a picture model, or None when it is clean. ``allow``: extra words that pass (the banned imagery named in
    a 'Never show' line: curated by a pack steward or a brand, and a pack refuses digits and quotes already)."""
    t = str(text or "")
    if not t.strip():
        return "it is empty"
    if not ascii_only(t):
        return "it holds a character outside printable ASCII (fullwidth, non-Latin, invisible, emoji or a symbol form of a digit)"
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
    # Hard rules only (owner, 26 Nov 2026): there is no approved-word list any more. A describing word ('unhurried', 'tarmac', 'shopfronts')
    # passes; a name, a number, a brand, a quotation mark, a style of someone and banned imagery are still refused. (``allowed()`` stays
    # only for the Confidential deny-list below, which #370 removes.)
    if re.search(r"\b[A-Z][a-z]+[- ]style\b", t):      # "Banksy style": a name before "style", even where a sentence starts (the list caught it)
        return "it asks for the style of someone"
    for w in tokens(t):
        if w in BRAND_WORDS or (w.endswith("s") and w[:-1] in BRAND_WORDS):
            return f"{w!r} is a brand name"
        if w in NUMBER_WORDS:
            return f"{w!r} is a number in words"
    low = t.lower()
    for b in banned or ():
        if re.search(rf"\b{re.escape(str(b).lower())}s?\b", low):
            return f"it names banned imagery ({b})"
    return None


def deny_list(marks) -> dict:
    """What a subject may not carry, built from the marked texts: ``{"words": {...}, "shingles": {...}, "texts": [content word sets]}``. Every
    word of a marked text that is not on the common list (codenames, names, figures) is denied; so is every 3-word run of it."""
    ok = allowed()
    words, shingles, texts, whole = set(), set(), [], False
    for m in marks or ():
        if not ascii_only(m.get("text") if isinstance(m, dict) else m):
            whole = True   # marked text this lint cannot read word by word (non-Latin, fullwidth, invisible) is denied as a whole
        toks = tokens(m.get("text") if isinstance(m, dict) else m)
        words |= {w for w in toks if w not in ok}
        shingles |= {tuple(toks[i:i + 3]) for i in range(len(toks) - 2)}
        for d in re.findall(r"\d+", str(m.get("text") if isinstance(m, dict) else m)):
            words.add(d)
        texts.append({w for w in toks if len(w) >= 4})
    return {"words": words, "shingles": shingles, "texts": texts, "whole": whole}


def confidential_hit(text: str, deny: dict) -> str | None:
    if deny.get("whole"):
        return "would draw on a Confidential part"
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
