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


# ---------------------------------------------------------------------------------------------------------- the scene lint (picture plan)
# Round 3 (20 Nov 2026): the allow-list refused 32 of 57 stage g subjects for ordinary visual words ('kraft', 'one', 'kibble', 'homewares',
# 'teal', 'pegboard') and a template replaced each. The scene lint keeps every protection that matters (Confidential parts, the shape rules,
# names, figures, banned imagery) as DENY-lists and lets an everyday word through: a listed word, two listed words joined (floor + boards),
# a listed word with a common prefix or ending (un + hurried), or a count of visible things (one to twelve, half, pair, couple, dozen).
# A word in none of these is still read as a possible name and refused: fail-closed on names, not on vocabulary.

#: Counts of visible things that pass the scene lint (a number word above twelve, a percent or a statistic shape never does).
COUNT_WORDS = frozenset("one two three four five six seven eight nine ten eleven twelve half pair couple dozen".split())
STATISTIC = re.compile(r"\b(?:one|two|three|four|five|six|seven|eight|nine|ten)\s+(?:in|out\s+of)\s+(?:every\s+)?"
                       r"(?:two|three|four|five|six|seven|eight|nine|ten|hundred|thousand)\b|\bper\s?cent\b|\bpercent\b", re.I)
PREFIXES = ("un", "re", "pre", "over", "under", "mid", "half", "non", "out", "up", "down", "semi", "multi")
SUFFIXES = ("ers", "er", "ed", "ing", "ly", "ness", "ful", "less", "y", "ish", "es", "s", "ware", "wares")


def _known(w: str, ok: frozenset) -> bool:
    """A word the scene lint accepts as vocabulary: listed (or a plural), two listed words joined, or a listed word with a common prefix or
    ending."""
    if w in ok or (w.endswith("s") and w[:-1] in ok) or (w.endswith("es") and w[:-2] in ok):
        return True
    for p in PREFIXES:
        if w.startswith(p) and len(w) - len(p) >= 3 and _known_simple(w[len(p):], ok):
            return True
    for sfx in SUFFIXES:
        if w.endswith(sfx) and len(w) - len(sfx) >= 3 and (w[:-len(sfx)] in ok or (w[:-len(sfx)] + "e") in ok):
            return True
    for i in range(3, len(w) - 2):   # floor + boards, light + bulb, job + seeker
        if _known_simple(w[:i], ok) and _known_simple(w[i:], ok):
            return True
    return False


def _known_simple(w: str, ok: frozenset) -> bool:
    if w in ok or (w.endswith("s") and w[:-1] in ok):
        return True
    return any(w.endswith(sfx) and len(w) - len(sfx) >= 3 and (w[:-len(sfx)] in ok or (w[:-len(sfx)] + "e") in ok) for sfx in SUFFIXES)


def name_words(names) -> dict:
    """A per-brief names deny-list from ``names`` (client, brands, products, competitors, people, places, job codes, and every capitalised
    word of the brief that is not a common word): ``{"words": {...}, "phrases": [...]}``, all lower case."""
    ok = allowed()
    words, phrases = set(), []
    for n in names or ():
        toks = tokens(n)
        if len(toks) > 1:
            phrases.append(" ".join(toks))
        words |= {t for t in toks if len(t) >= 3 and (t not in ok or len(toks) == 1)}
    return {"words": words, "phrases": phrases}


#: Typographic marks a model writes in plain prose, as their ASCII forms (a scene card is normalised before it is linted or sent).
TYPOGRAPHIC = {"\u2019": "'", "\u2018": "'", "\u201c": "", "\u201d": "", "\u2014": ", ", "\u2013": "-", "\u2026": "...", "\u00a0": " ", "\u00ad": ""}


def plain(text: str) -> str:
    """``text`` with typographic apostrophes, dashes, ellipses and spaces as plain ASCII (curly double quotes dropped)."""
    t = str(text or "")
    for k, v in TYPOGRAPHIC.items():
        t = t.replace(k, v)
    return re.sub(r"\s+([,.;:])", r"\1", " ".join(t.split()))


def unapostrophe(text: str) -> str:
    """For the lint only: possessives and contractions without their apostrophe (household's -> household, doesn't -> does not,
    o'clock -> clock), so an apostrophe left over is a real quotation mark."""
    t = re.sub(r"\bo'clock\b", "clock", str(text or ""), flags=re.I)
    t = re.sub(r"(?<=[A-Za-z])n't\b", " not", t)
    t = re.sub(r"(?<=[A-Za-z])'(?:re|ll|ve|d|m)\b", "", t)
    t = re.sub(r"(?<=[A-Za-z])'s\b", "", t)
    return re.sub(r"(?<=[A-Za-z]s)'(?=[\s,.;:!?]|$)", "", t)


def lint_scene(text: str, banned=(), deny: dict | None = None, names: dict | None = None) -> str | None:
    """Why a scene may not go to a picture model, or None when it may (the deny-list lint of the picture plan). Fails closed on: a part
    marked Confidential; the shape (printable ASCII, no quotation mark, no digit, no capital in mid-sentence, no 'style of'); a brand or a
    per-brief name (``names``: name_words) in any case; a number above twelve, a percent or a statistic ('three in four'); a word that is
    no listed word, join or affix form (a possible name); banned imagery."""
    t = str(text or "")
    if not t.strip():
        return "it is empty"
    if not ascii_only(t):
        return "it holds a character outside printable ASCII (fullwidth, non-Latin, invisible, emoji or a symbol form of a digit)"
    if deny:
        why = confidential_hit(t, deny)
        if why:
            return why
    t = unapostrophe(t)   # a possessive or a contraction is not a quotation mark ('the household's meter', 'doesn't')
    if any(c in QUOTES for c in t):
        return "it holds a quotation mark"
    if re.search(r"\d", t):
        return "it holds a digit"
    if STYLE_OF.search(t):
        return "it asks for the style of someone"
    for m in re.finditer(r"(?<![.!?:]\s)(?<!^)\b[A-Z][a-z]+", t):
        before = t[:m.start()].rstrip()
        if before and before[-1] not in ".!?:(\n":
            return f"{m.group(0)!r} is a capital in mid-sentence (a name)"
    if STATISTIC.search(t):
        return "it holds a statistic"
    low = " ".join(tokens(t))
    nm = names or {"words": set(), "phrases": []}
    for ph in nm["phrases"]:
        if re.search(rf"\b{re.escape(ph)}\b", low):
            return "it names the client, a brand or a person of this brief"
    ok = allowed()
    for w in tokens(t):
        if w in BRAND_WORDS or (w.endswith("s") and w[:-1] in BRAND_WORDS):
            return f"{w!r} is a brand name"
        if w in nm["words"] or (w.endswith("s") and w[:-1] in nm["words"]):
            return "it names the client, a brand or a person of this brief"
        if w in NUMBER_WORDS and w not in COUNT_WORDS:
            return f"{w!r} is a number above a count of visible things"
        if w in COUNT_WORDS:
            continue
        if not _known(w, ok):
            return f"{w!r} is not a known word (read as a possible name)"
    for b in banned or ():
        if re.search(rf"\b{re.escape(str(b).lower())}s?\b", low):
            return f"it names banned imagery ({b})"
    return None
