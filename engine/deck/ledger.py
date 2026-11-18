"""The token ledger (deck-repair-loop): the words that carry a claim, in reading order, read from a deck's blocks and back from a
rendered .pptx, so a repair round can be refused when it changed one.

The ledger of a block is the list of its tokens:

* numbers, including letter-attached ones (``Q3``, ``B2B``, ``5m``, ``5k``, ``2x``, ``H1``, ``FY26``) and ranges, as written;
* the unit, percent sign or currency attached to or next to each number (``%``, ``pp``, ``m``, ``bn``, ``k``, EUR, GBP, USD,
  the symbols);
* capitalised names (a capitalised word that is not the first of a sentence, every acronym), months and years;
* negations (not, no, never, without, none, nor, n't) and hedges (up to, about, around, approximately, at least, at most, more
  than, less than, est., estimated, forecast, assumed, illustrative, projected, target).

Two ledgers are equal when their token lists are equal, so a figure that moved, changed form or vanished is a difference, and so is
the order of the numbers in a block (a from/to swap, ``5m`` for ``5k``). One function (``tokens``) builds every ledger: the keep gate
(K3), the shorten guard and the tests all call it. No model, no network.
"""
from __future__ import annotations

import re

from . import spec

MONTHS = ("january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december",
          "jan", "feb", "mar", "apr", "jun", "jul", "aug", "sep", "sept", "oct", "nov", "dec")
NEGATIONS = ("not", "no", "never", "without", "none", "nor", "cannot")
HEDGE_WORDS = ("about", "around", "approximately", "est", "estimated", "forecast", "assumed", "illustrative", "projected", "target")
HEDGE_PHRASES = ("up to", "at least", "at most", "more than", "less than")
UNITS = ("%", "pp", "m", "bn", "k", "x", "eur", "gbp", "usd", "euro", "euros", "million", "billion", "thousand", "percent", "cent")
_WORD = re.compile(r"[A-Za-z0-9€£$%][A-Za-z0-9€£$%.,'’/–\-]*")
_STRIP = ".,;:!?\"“”()[]"


def _words(text: str) -> list:
    """``[(word as written without trailing punctuation, ends a sentence)]``: ``ends`` is true when the word closes a sentence."""
    out = []
    for m in _WORD.finditer(text):
        raw = m.group(0)
        w = raw.rstrip(_STRIP + "-–/")
        numeric = bool(re.fullmatch(r"[\d,.]+", raw.rstrip(".!?:;")))
        ends = raw.endswith((".", "!", "?", ":", ";")) and not numeric and w.lower().rstrip(".") != "est"
        out.append((w.rstrip("."), ends or text[m.end():m.end() + 1] == "\n"))
    return out


def tokens(text, known: frozenset | set = frozenset()) -> list:
    """The ledger of one text: ``[(kind, value)]`` in reading order. ``known`` holds names (lower-case) that count even at the start of
    a sentence: the capitalised words found inside sentences of the same slide's base text."""
    ws = _words(str(text or ""))
    out: list = []
    first = True
    for i, (w, ends) in enumerate(ws):
        lw = w.lower().strip("'’")
        nxt = ws[i + 1][0].lower() if i + 1 < len(ws) else ""
        if any(c.isdigit() for c in w):
            out.append(("num", w))
            if nxt in UNITS or (nxt == "per" and i + 2 < len(ws) and ws[i + 2][0].lower() == "cent"):
                pass   # the unit joins the ledger as its own word below
        elif w in ("%", "€", "£", "$") or lw in UNITS and i > 0 and any(c.isdigit() for c in ws[i - 1][0]) and not (len(w) > 1 and w.isupper()):
            out.append(("unit", lw))
        elif lw in NEGATIONS or lw.endswith("n't") or lw.endswith("n’t"):
            out.append(("neg", "n't" if lw.endswith(("n't", "n’t")) else lw))
        elif lw.rstrip(".") in MONTHS and w[0].isupper():
            out.append(("month", lw.rstrip(".")))
        elif len(w) >= 2 and w.isupper() and w.isalpha():
            out.append(("name", w))
        elif w[0].isupper() and (not first or lw in known):
            out.append(("name", w))
        if lw in HEDGE_WORDS or lw.rstrip(".") == "est":
            out.append(("hedge", lw.rstrip(".")))
        elif nxt and f"{lw} {nxt}" in HEDGE_PHRASES:
            out.append(("hedge", f"{lw} {nxt}"))
        first = ends
    return out


def known_names(texts: list) -> frozenset:
    """The capitalised words found inside sentences (not first) in ``texts``: they count as names wherever they stand."""
    out = set()
    for t in texts:
        first = True
        for w, ends in _words(str(t or "")):
            if w[0].isupper() and not first and w.isalpha():
                out.add(w.lower())
            first = ends
    return frozenset(out)


# ---------------------------------------------------------------------------------------------------- the base deck's ledger
def block_texts(b: dict, skip_items: frozenset = frozenset()) -> list:
    """The texts of one block in reading order: a title or heading, the block text, from and to, items (a key-value item reads key then
    value), table cells. ``skip_items`` are item indexes moved to the notes."""
    out = []
    for k in ("heading", "title"):
        if b.get(k):
            out.append(str(b[k]))
    if str(b.get("text", "")).strip():
        out.append(("Internal note: " if b.get("internal") else "") + str(b["text"]))
    for k in ("from", "to", "answer"):
        if b.get(k):
            out.append(str(b[k]))
    for ii, i in enumerate(b.get("items") or []):
        if ii in skip_items:
            continue
        if isinstance(i, list):
            out += [str(x) for x in i]
        elif isinstance(i, dict):
            out += [str(i[k]) for k in ("label", "key", "value", "text", "caption") if i.get(k)]
        else:
            out.append(str(i))
    for r in b.get("rows") or []:
        out += [str(c) for c in r]
    out += [str(x) for x in b.get("lines") or []]
    return out


def item_text(it) -> str:
    """One item as the notes line carries it: a key-value item reads ``key: value``."""
    if isinstance(it, list):
        return ": ".join(str(x) for x in it)
    return str(it.get("text", "")) if isinstance(it, dict) else str(it)


def shown_to_base(s: dict, audience: str = "review") -> list:
    """For each block the renderer was given (``spec.shown_blocks``), the base block index it came from (None for the label under an
    unsourced quote). Unlike ``layouts.shown_map`` this skips the whole blocks the plan moved to the notes."""
    moved = spec.moved_map(s, audience)
    out = []
    for bi, b in enumerate(s["blocks"]):
        if bi in moved and moved[bi] is None:
            continue
        if b.get("internal") and audience == "client":
            continue
        out.append(bi)
        if b["kind"] == "quote" and not b.get("refs") and str(b.get("text", "")).strip():
            out.append(None)
    return out


def slide_known(s: dict) -> frozenset:
    """The names of a slide's BASE text (the title and every block), for ``tokens``."""
    texts = [s.get("title", "")]
    for b in s["blocks"]:
        texts += block_texts(b)
    return known_names(texts)


def base_ledger(s: dict, audience: str = "review", moved: dict | None = None) -> dict:
    """``{base block index: {"shown": [tokens of what stays on the slide], "moved": [tokens of the moved points]}}`` from the slide's
    BASE blocks. ``moved`` is ``spec.moved_map`` (default: the slide's own overlay). Blocks the audience does not see (agency notes for a
    client) are left out. The title is not a block: a repair never touches it."""
    known = slide_known(s)
    moved = spec.moved_map(s, audience) if moved is None else moved
    out = {}
    for bi, b in enumerate(s["blocks"]):
        if b.get("internal") and audience == "client":
            continue
        mv = moved.get(bi, "no")
        if mv is None:
            out[bi] = {"shown": [], "moved": tokens("\n".join(block_texts(b)), known)}
            continue
        skip = frozenset(mv) if isinstance(mv, set) else frozenset()
        out[bi] = {"shown": tokens("\n".join(block_texts(b, skip)), known),
                   "moved": [t for ii in sorted(skip) for t in tokens(item_text(b["items"][ii]), known)]}
    return out


# ---------------------------------------------------------------------------------------------------- read back from the pptx
def _shape_text(sh) -> str:
    """The text of a shape, its paragraphs joined by a space (a table: its cells, row by row)."""
    if getattr(sh, "has_text_frame", False) and sh.has_text_frame:
        return "\n".join(p.text for p in sh.text_frame.paragraphs if p.text.strip())
    if getattr(sh, "has_table", False) and sh.has_table:
        return "\n".join(c.text for r in sh.table.rows for c in r.cells if c.text.strip())
    return ""


def notes_moved_lines(slide) -> list:
    """The verbatim lines under ``Moved from the slide:`` in a slide's speaker notes, as written (``- text [refs: a,b]`` without the ``- ``)."""
    if not slide.has_notes_slide:
        return []
    text = slide.notes_slide.notes_text_frame.text
    if "Moved from the slide:" not in text:
        return []
    lines = []
    for ln in text.split("Moved from the slide:", 1)[1].lstrip("\n").split("\n"):
        if not ln.startswith("- "):
            break
        lines.append(ln[2:])
    return lines


def read_pptx(prs, deck: dict, layouts_rec: dict, audience: str = "review") -> dict:
    """The round side of the ledger, read from the rendered deck: ``{slide id: {"groups": [{"blocks": [base block], "tokens": [...],
    "text": str}], "moved": [lines]}}``. A group is what the ``slot:<name>`` shapes of one slot hold (layouts.json ``shapes[].blocks``,
    shown indexes mapped to base blocks): one block when the slot holds one, the slot's blocks together when its shapes cannot be told
    apart. ``moved`` is each ``Moved from the slide:`` notes line as written. Slides the .pptx does not have are absent."""
    out = {}
    slides = list(prs.slides)
    for n, sid in enumerate(deck["order"]):
        if n >= len(slides):
            break
        s = deck["slides"][sid]
        rec = ((layouts_rec or {}).get("slides") or {}).get(sid) or {}
        mapping = shown_to_base(s, audience)
        known = slide_known(s)
        by_name: dict = {}
        for sh in slides[n].shapes:
            by_name.setdefault(sh.name, []).append(sh)
        ents: dict = {}
        for ent in rec.get("shapes") or []:
            ents.setdefault(ent["name"], []).append(ent)
        groups = []
        for name, es in ents.items():
            bis = [mapping[bi] for e in es for bi in e["blocks"] if bi < len(mapping) and mapping[bi] is not None]
            texts = [t for t in (_shape_text(sh) for sh in by_name.get(name, [])) if t.strip()]
            if not bis:
                continue
            if len(es) == 1 or len(set(bis)) == 1:
                groups.append((sorted(set(bis)), texts))
            elif len(texts) == len(es):   # one text shape per record, in order
                for e, t in zip(es, texts):
                    b = [mapping[bi] for bi in e["blocks"] if bi < len(mapping) and mapping[bi] is not None]
                    if b:
                        groups.append((b, [t]))
            else:
                groups.append((sorted(set(bis)), texts))
        out[sid] = {"groups": [{"blocks": b, "text": "\n".join(t), "tokens": tokens("\n".join(t), known)} for b, t in groups],
                    "moved": notes_moved_lines(slides[n])}
    return out


def expected(s: dict, base: dict, blocks: list) -> list:
    """The tokens a group of blocks should show: their base ``shown`` tokens in order, as one list (headings and titles are drawn outside the
    slot shape in some looks: ``compare_group`` accepts either)."""
    return [t for b in blocks for t in base[b]["shown"]]


def compare_group(s: dict, base: dict, blocks: list, got: list, known: frozenset, moved: dict | None = None) -> bool:
    """True when what a slot's shapes show equals the base ledger of its blocks, with or without the blocks' headings and titles (a look
    may draw those in a shape of its own; a repair never edits them)."""
    full = expected(s, base, blocks)
    kinds = {s["blocks"][b]["kind"] for b in blocks}
    if "fromto" in kinds:   # the look prints FROM and TO above the two sides
        got = [t for t in got if t not in (("name", "FROM"), ("name", "TO"))]
    if got == full:
        return True
    bare = []
    for bi in blocks:
        b = s["blocks"][bi]
        mv = (spec.moved_map(s) if moved is None else moved).get(bi, "no")
        skip = frozenset(mv) if isinstance(mv, set) else frozenset()
        texts = [t for t in block_texts(b, skip) if t not in (str(b.get("heading") or ""), str(b.get("title") or ""))]
        bare += tokens("\n".join(texts), known)
    return got == bare
