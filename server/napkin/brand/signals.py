"""Detection step 1, free: does the file look like a brand bible? Rules over the file name and the text the host already read.

  read(name, text, pages, members) -> Signals(score, verdict, found)

`verdict` is `no` (nothing to ask, no model call), `unsure` or `yes`; both of the last two go on to the one Haiku call
(identify.py), which also gives the brand's name. Nothing here costs anything."""

import re
from dataclasses import dataclass, field

NAME_WORDS = re.compile(r"brand[\s_-]*(book|bible|guide|guidelines|identity|standards|manual)|style[\s_-]*guide|"
                        r"identity[\s_-]*(guide|guidelines|manual|book)|guidelines|brandbook|brand[\s_-]*book", re.I)
NAME_WEAK = re.compile(r"\b(brand|identity|guidelines?|book)\b", re.I)
PHRASES = [
    ("clear space", re.compile(r"clear[\s-]*space|exclusion zone|protection zone|safe area", re.I)),
    ("logo", re.compile(r"\blogo(type)?s?\b|\bwordmark\b", re.I)),
    ("colour palette", re.compile(r"colou?r\s+(palette|system|scheme)|brand\s+colou?rs?|primary\s+colou?rs?|secondary\s+colou?rs?", re.I)),
    ("typography", re.compile(r"\btypograph(y|ic)\b|\btypefaces?\b|brand\s+fonts?|\bfont\s+family\b", re.I)),
    ("tone of voice", re.compile(r"tone\s+of\s+voice|brand\s+voice|voice\s+and\s+tone|how\s+we\s+(sound|speak|write)", re.I)),
    ("imagery", re.compile(r"photograph(y|ic)\s+(style|guidelines)|imagery|image\s+style|art\s+direction", re.I)),
    ("misuse", re.compile(r"do'?s\s+and\s+don'?ts|incorrect\s+usage|logo\s+misuse|never\s+(stretch|rotate|recolou?r)", re.I)),
    ("minimum size", re.compile(r"minimum\s+size|min\.?\s+size", re.I)),
]
HEX = re.compile(r"#[0-9a-f]{6}\b|#[0-9a-f]{3}\b", re.I)
SPEC = re.compile(r"\bpantone\b|\bpms\s*\d|\bcmyk\b|\brgb\b|\bhex\b|\bral\s*\d{4}", re.I)
MEMBERS = re.compile(r"(^|/)(logos?|fonts?|typefaces?|brand|guidelines?)(/|$)|\.(otf|ttf|woff2?|ai|eps)$", re.I)
SIZE = 6000   # characters of text read: the first pages are enough to tell


@dataclass
class Signals:
    score: int = 0
    verdict: str = "no"
    found: list = field(default_factory=list)


def read(name: str, text: str | None, pages: int | None = None, members: list | None = None) -> Signals:
    found, score = [], 0
    n = name or ""
    if NAME_WORDS.search(n):
        found.append("file name"); score += 3
    elif NAME_WEAK.search(n):
        found.append("file name (weak)"); score += 1
    body = (text or "")[:SIZE * 4]
    hits = [label for label, rx in PHRASES if rx.search(body)]
    if hits:
        found += hits
        score += min(len(hits), 5)
    if len(HEX.findall(body)) >= 3:
        found.append("hex codes"); score += 1
    if len(SPEC.findall(body)) >= 2:
        found.append("colour specs"); score += 1
    if pages and pages > 8:
        found.append(f"{pages} pages"); score += 1
    ms = [m for m in (members or []) if MEMBERS.search(m)]
    if ms:
        found.append("logo or font files"); score += 2
    verdict = "yes" if score >= 5 else "unsure" if score >= 2 else "no"
    return Signals(score, verdict, found)
