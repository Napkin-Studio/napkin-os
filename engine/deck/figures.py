"""The figure guard: a number no input states never reaches a slide (the backstop behind stage b and d's figures rule).

Runs on the assembled deck, after stage e and the red team and before the pictures, the layout plan and validate. It reads the
slide texts numbers_trace reads (validate._texts: the title and every shown block field) and judges each number exactly as
numbers_trace does (validate.number_corpus, slide_allowed, untraced). For each figure it cannot trace it either rewords the
sentence without the number, or drops the sentence, line or item when no wording is left. Each change goes in the slide's
speaker notes ("Figure removed: ...") and in ``meta.figures_removed``, which the needs-a-person list (pitch_ready.needs_person)
reads, so a reviewer sees what was taken off. numbers_trace stays the final check; after this pass it finds nothing to fail.
"""
from __future__ import annotations

import re

from . import spec, validate
from .refs import NUM, Resolver, numbers_in

#: Units that make a time range ("Months 2 to 8", "weeks 3-5", "2 to 8 weeks").
_UNITS = r"(?:days?|weeks?|months?|quarters?|years?|phases?|waves?|stages?|steps?|sprints?)"
_DASH = r"\s*(?:-|–|—|to)\s*"
#: A figure's own symbols and units, removed with it ("40%", "€2m", "3x", "12 per cent").
_PRE = r"(?:[£$€]\s?)?"
_POST = r"(?:\s?(?:%|per\s?cent|percent|k\b|m\b|bn\b|x\b))?"
#: A word that only says how much, removed with its figure ("by 40%", "up to 500", "more than 3").
_QUANT = (r"(?:\b(?:by|up to|about|around|nearly|almost|over|under|more than|fewer than|less than|at least|at most|some|roughly|"
          r"approximately|only|just)\s+)?")
#: A single step of a timeline ("Month 2", "Week 3"): with its figure gone, the timing is a person's to agree.
_STEP = re.compile(rf"\b{_UNITS}\s+(\d+)\b", re.I)
#: The note a removal leaves in the slide's speaker notes, and the line the needs-a-person list shows (no figure in it).
NOTE = "Figure removed: '{n}' in \"{text}\" is in none of the inputs, so it was taken off the slide. Source it before you put it back."
NEEDS = "a figure no input states was taken off this slide; source it or leave it out"


def _fmt(n: float) -> str:
    return f"{n:g}"


def _is(m: re.Match, n: float) -> bool:
    try:
        return float(m.group(0).replace(",", "")) == n
    except ValueError:
        return False


def _tidy(t: str) -> str:
    t = re.sub(r"\(\s*\)", "", t)
    t = re.sub(r"\s+([,.;:)])", r"\1", t)
    t = re.sub(r"([(])\s+", r"\1", t)
    t = re.sub(r",\s*([,.;])", r"\1", t)
    t = re.sub(r"\b(a|an|the)\s+(a|an|the)\b", r"\2", t, flags=re.I)
    t = re.sub(r"\s{2,}", " ", t)
    return t.strip(" ,;:-–—")


def _words(t: str) -> int:
    return len(re.findall(r"[A-Za-z]{2,}", t))


def _range(text: str, bad: set, ok) -> str | None:
    """A time range with an untraced end: "Months 2 to 8" (both ends untraced) becomes "Timing to agree"; with one end traced it
    keeps that end in words ("From month 1", "By month 9"). None when no range holds an untraced figure."""
    pat = re.compile(rf"\b(?P<u>{_UNITS})\s+(?P<a>\d+){_DASH}(?P<b>\d+)\b|(?<![\w.])(?P<a2>\d+){_DASH}(?P<b2>\d+)\s+(?P<u2>{_UNITS})\b", re.I)
    for m in pat.finditer(text):
        a, b = float(m.group("a") or m.group("a2")), float(m.group("b") or m.group("b2"))
        unit = (m.group("u") or m.group("u2")).lower()
        unit = unit[:-1] if unit.endswith("s") else unit
        if a not in bad and b not in bad:
            continue
        if a in bad and b in bad:
            word = "timing to agree"
        elif ok(a):
            word = f"from {unit} {m.group('a') or m.group('a2')}"
        else:
            word = f"by {unit} {m.group('b') or m.group('b2')}"
        out = text[:m.start()] + word + text[m.end():]
        if not out[:m.start()].strip():
            out = out[0].upper() + out[1:]
        return out
    return None


def strip_figure(text: str, n: float) -> str:
    """``text`` without the figure ``n``: its parenthesis ("Radio (30 seconds)"), its compound ("a 30-second spot"), an age after a
    name ("Mary, 68."), or the number with its own symbol and unit. The rest of the sentence is kept and tidied."""
    t = str(text)
    for m in reversed([m for m in NUM.finditer(t) if _is(m, n)]):
        s, e = m.start(), m.end()
        paren = re.search(r"\(([^()]*)\)", t[max(0, s - 40):e + 40])
        if paren:
            ps, pe = paren.span()
            ps, pe = ps + max(0, s - 40), pe + max(0, s - 40)
            if ps < s and e <= pe and _words(t[ps + 1:pe - 1].replace(m.group(0), "")) <= 4:
                t = t[:ps] + t[pe:]
                continue
        comp = re.match(r"-[A-Za-z]+\b\s?", t[e:])
        if comp:   # "30-second spot" -> "spot"
            t = t[:s] + t[e + comp.end():]
            continue
        age = re.match(r",\s*$", t[:s][-3:]) and re.match(r"\s*(?=[.,;)]|$)", t[e:])
        if age:   # "Mary, 68." -> "Mary."
            t = re.sub(r",\s*$", "", t[:s]) + t[e:]
            continue
        pre = re.search(_QUANT + _PRE + r"$", t[:s], re.I)
        post = re.match(_POST, t[e:], re.I)
        t = t[:pre.start()] + t[e + (post.end() if post else 0):]
    return _tidy(t)


def reword(text: str, bad: set, ok) -> str | None:
    """``text`` with every figure in ``bad`` taken out: a time range or step first, then each figure; a sentence left with no word
    is dropped. None when nothing worth showing is left (the caller drops the line, item or block)."""
    t = str(text)
    for _ in range(4):   # a text with several ranges
        r = _range(t, bad, ok)
        if r is None:
            break
        t = r
    t = _STEP.sub(lambda m: "timing to agree" if float(m.group(1)) in bad else m.group(0), t)
    if t[:1].islower() and str(text)[:1].isupper():
        t = t[0].upper() + t[1:]
    sents = re.split(r"(?<=[.!?])\s+", t.strip())
    keep = []
    for s in sents:
        hit = {n for n in numbers_in(s) if n in bad}
        cap = s[:1].isupper()
        for n in sorted(hit, reverse=True):
            s = strip_figure(s, n)
        if cap and s[:1].islower():
            s = s[0].upper() + s[1:]
        if hit and _words(s) < 1:
            continue
        if s:
            keep.append(s)
    out = _tidy(" ".join(keep))
    return out if _words(out) >= 1 else None


def _note(sl: dict, n: float, text: str) -> None:
    line = NOTE.format(n=_fmt(n), text=str(text)[:90])
    if line not in str(sl.get("notes") or ""):
        sl["notes"] = "\n\n".join(x for x in [str(sl.get("notes") or "").strip(), line] if x)


def guard(deck: dict, inp) -> list:
    """Take every figure numbers_trace would fail off the deck's slides (see the module docstring). Returns the removals,
    ``[{slide, figure, text, now}]`` (``now`` is None when the line, item or block was dropped), also kept in ``meta.figures_removed``."""
    R = Resolver(inp, list(deck.get("requirements", {}).values()))
    corpus = validate.number_corpus(deck, inp)
    done = []
    for sid in deck["order"]:
        sl = deck["slides"][sid]
        allowed = validate.slide_allowed(sl, R)
        ok = lambda n: not validate.untraced(n, allowed, corpus)   # noqa: E731

        def fix(text, basis):
            """(new text or None, the untraced figures) for one shown text; unchanged when it holds none."""
            if basis in ("creative", "proposal", "meta") or not str(text or "").strip():
                return text, set()
            bad = {n for n in numbers_in(text) if not ok(n)}
            if not bad:
                return text, set()
            return reword(text, bad, ok), bad

        def log(text, now, bad):
            for n in sorted(bad):
                _note(sl, n, text)
                done.append({"slide": sid, "figure": _fmt(n), "text": str(text), "now": now})

        moved = spec.moved_map(sl) if sl.get("layout") else {}
        new, bad = fix(sl.get("title", ""), None)
        if bad:
            log(sl["title"], new, bad)
            sl["title"] = new or sl.get("label") or ""
        keep_blocks = []
        for bi, bl in enumerate(sl.get("blocks", []) or []):
            if bi in moved and moved[bi] is None:
                keep_blocks.append(bl)
                continue
            basis = bl.get("basis")
            before = len(done)
            for k in ("text", "title", "from", "to", "answer"):
                if bl.get(k):
                    new, bad = fix(bl[k], basis)
                    if bad:
                        log(bl[k], new, bad)
                        bl[k] = new or ""
            if bl.get("lines"):
                lines = []
                for ln in bl["lines"]:
                    new, bad = fix(ln, basis)
                    if bad:
                        log(ln, new, bad)
                    if new:
                        lines.append(new)
                bl["lines"] = lines
            if bl.get("items"):
                items = []
                for ii, it in enumerate(bl["items"]):
                    if ii in (moved.get(bi) or ()):
                        items.append(it)
                        continue
                    if isinstance(it, dict):
                        ib = it.get("basis") or ("proposal" if it.get("human") else basis)
                        if it.get("text"):
                            new, bad = fix(it["text"], ib)
                            if bad:
                                log(it["text"], new, bad)
                                if not new:
                                    continue
                                it["text"] = new
                        else:   # a stat (value and label): the figure is the item, so an untraced one drops it
                            shown = f"{it.get('value', '')} {it.get('label', '')}".strip()
                            _, bad = fix(shown, ib)
                            if bad:
                                log(shown, None, bad)
                                continue
                        items.append(it)
                    elif isinstance(it, list):
                        row = []
                        for x in it:
                            new, bad = fix(x, basis)
                            if bad:
                                log(x, new, bad)
                            row.append(new or "" if bad else x)
                        items.append(row)
                    else:
                        items.append(it)
                bl["items"] = items
            for row in bl.get("rows", []) or []:
                for ci, x in enumerate(row):
                    new, bad = fix(x, basis)
                    if bad:
                        log(x, new, bad)
                        row[ci] = new or ""
            for s in (bl.get("chart") or {}).get("series", []) or []:
                new, bad = fix(s.get("label", ""), basis)
                if bad:
                    log(s["label"], new, bad)
                    s["label"] = new or ""
            empty = not any(bl.get(k) for k in ("text", "title", "from", "to", "answer", "lines", "items", "rows", "chart"))
            if empty and len(done) > before and not sl.get("layout"):
                continue   # everything it said was an untraced figure: the block goes (never once a layout has bound blocks to slots)
            keep_blocks.append(bl)
        if "blocks" in sl:
            sl["blocks"] = keep_blocks
    if done:
        deck["meta"].setdefault("figures_removed", []).extend(done)
    return done
