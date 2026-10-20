"""Derive: the dates, durations, prices and figures a sentence states, and the arithmetic that
works one out from others (brief-fact-provenance, 2026-10-19).

A brief may draw a conclusion no single fact states: "the offer was over in 10 days" from a
launch on 5 October and a closure on 15 October. This module finds what such a sentence states
(its must-tie spans) and recomputes a working from the facts it rests on. It never edits text
and never drops anything: it only reads.

  dates_in      "5 October", "15 Oct 2026", "October 5th", 2026-10-05, and "today" / "from today"
                anchored to a publication date (a date with no year takes the anchor's year)
  durations_in  "10 days", "10-day", "two weeks", "a fortnight"
  prices_in     €8.99, EUR 8.99, 8.99 euro, £5, $3
  spans         every must-tie span of a sentence: the above, then any other figure; digits in
                names (B2B, 4G, Q4) are names, not figures
  compute       days_between, difference, sum, ratio, percent_change, product
"""
from __future__ import annotations

import datetime as _dt
import re
from dataclasses import dataclass, field

from .figures import _supported, figures

MONTHS = {"jan": 1, "feb": 2, "mar": 3, "apr": 4, "may": 5, "jun": 6, "jul": 7, "aug": 8, "sep": 9, "sept": 9,
          "oct": 10, "nov": 11, "dec": 12}
_MON = (r"(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sept?(?:ember)?|"
        r"oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\.?")
_ORD = r"(?:st|nd|rd|th)?"
_DAY_MON = re.compile(rf"\b(\d{{1,2}}){_ORD}\s+(?:of\s+)?{_MON}(?:,?\s+(\d{{4}}))?\b", re.I)
_MON_DAY = re.compile(rf"\b{_MON}\s+(\d{{1,2}}){_ORD}(?:,?\s+(\d{{4}}))?\b", re.I)
_ISO = re.compile(r"\b(\d{4})-(\d{2})-(\d{2})\b")
_REL = re.compile(r"\b(?:from |as of |until )?(today|yesterday|tomorrow|this morning|tonight)\b", re.I)
_REL_DAYS = {"today": 0, "this morning": 0, "tonight": 0, "yesterday": -1, "tomorrow": 1}

WORDS = {"a": 1, "an": 1, "one": 1, "two": 2, "three": 3, "four": 4, "five": 5, "six": 6, "seven": 7, "eight": 8,
         "nine": 9, "ten": 10, "eleven": 11, "twelve": 12, "fourteen": 14, "twenty": 20, "thirty": 30}
_DUR = re.compile(r"\b(\d+|" + "|".join(WORDS) + r")[\s-](day|week|fortnight)s?\b|\b(a |one )?fortnight\b", re.I)
_PRICE = re.compile(r"(?:(€|£|\$|\bEUR|\bGBP|\bUSD)\s?(\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?))"
                    r"|(?:\b(\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?)\s?(euros?|EUR|pounds?|dollars?|cent)\b)", re.I)
_CUR = {"€": "EUR", "eur": "EUR", "euro": "EUR", "euros": "EUR", "£": "GBP", "gbp": "GBP", "pound": "GBP",
        "pounds": "GBP", "$": "USD", "usd": "USD", "dollar": "USD", "dollars": "USD", "cent": "EUR"}

OPS = ("days_between", "difference", "sum", "ratio", "percent_change", "product")


@dataclass
class Span:
    """One thing a sentence states that must rest on something: kind date | duration | price | number."""
    kind: str
    text: str
    start: int
    end: int
    value: float | None = None          # a number, a price, or a duration in days
    date: _dt.date | None = None        # a date (year from the sentence, else None)
    month_day: tuple | None = None      # (month, day) of a date
    scale: float = 1.0
    dec: int = 0
    anchored: bool = True               # a relative date with a known anchor
    extra: dict = field(default_factory=dict)


def _safe_date(y, m, d) -> _dt.date | None:
    try:
        return _dt.date(int(y), int(m), int(d))
    except (TypeError, ValueError):
        return None


def parse_iso(s) -> _dt.date | None:
    m = _ISO.fullmatch(str(s or "").strip()) if s else None
    return _safe_date(*m.groups()) if m else None


def dates_in(text: str, anchor: _dt.date | None = None) -> list[Span]:
    """Every date `text` states. A date with no year takes the anchor's year (when there is an anchor);
    "today" is the anchor itself, and is `anchored` False when there is none."""
    text = text or ""
    out: list[Span] = []
    taken: list[tuple[int, int]] = []

    def free(a, b):
        return not any(a < y and x < b for x, y in taken)

    for m in _ISO.finditer(text):
        d = _safe_date(*m.groups())
        if d:
            out.append(Span("date", m.group(0), m.start(), m.end(), date=d, month_day=(d.month, d.day),
                            extra={"year_stated": True}))
            taken.append((m.start(), m.end()))
    for rx, order in ((_DAY_MON, "dm"), (_MON_DAY, "md")):
        for m in rx.finditer(text):
            if not free(m.start(), m.end()):
                continue
            day, mon = (m.group(1), m.group(2)) if order == "dm" else (m.group(2), m.group(1))
            mo = MONTHS.get(mon.lower()[:4] if mon.lower().startswith("sept") else mon.lower()[:3])
            if not mo or not 1 <= int(day) <= 31:
                continue
            year = m.group(3)
            d = _safe_date(year, mo, day) if year else (_safe_date(anchor.year, mo, day) if anchor else None)
            out.append(Span("date", m.group(0), m.start(), m.end(), date=d if year or anchor else None,
                            month_day=(mo, int(day)), extra={"year_stated": bool(year)}))
            taken.append((m.start(), m.end()))
    for m in _REL.finditer(text):
        if not free(m.start(), m.end()):
            continue
        word = m.group(1).lower()
        d = anchor + _dt.timedelta(days=_REL_DAYS[word]) if anchor else None
        out.append(Span("date", m.group(0), m.start(), m.end(), date=d, month_day=(d.month, d.day) if d else None,
                        anchored=anchor is not None, extra={"relative": word}))
        taken.append((m.start(), m.end()))
    return sorted(out, key=lambda s: s.start)


def durations_in(text: str) -> list[Span]:
    """Every length of time in days `text` states: "10 days", "10-day", "two weeks", "a fortnight"."""
    out = []
    for m in _DUR.finditer(text or ""):
        if m.group(2) is None:  # "a fortnight"
            out.append(Span("duration", m.group(0), m.start(), m.end(), value=14.0))
            continue
        n = m.group(1).lower()
        n = float(WORDS[n]) if n in WORDS else float(n)
        unit = m.group(2).lower()
        out.append(Span("duration", m.group(0), m.start(), m.end(),
                        value=n * {"day": 1, "week": 7, "fortnight": 14}[unit]))
    return out


def prices_in(text: str) -> list[Span]:
    out = []
    for m in _PRICE.finditer(text or ""):
        sym, num = (m.group(1), m.group(2)) if m.group(2) else (m.group(4), m.group(3))
        v = float(num.replace(",", ""))
        if (sym or "").lower() == "cent":
            v = v / 100
        out.append(Span("price", m.group(0), m.start(), m.end(), value=v,
                        dec=len(num.split(".")[1]) if "." in num else 0,
                        extra={"currency": _CUR.get((sym or "").lower(), _CUR.get(sym or "", None))}))
    return out


def _glued(text: str, a: int, b: int) -> bool:
    """Digits that are part of a name (B2B, 4G, Q4, i4) rather than a quantity."""
    return (a > 0 and text[a - 1].isalpha()) or (b < len(text) and text[b].isalpha() and
                                                  not re.match(r"(k|m|b|bn|mn|st|nd|rd|th)\b", text[b:], re.I))


def spans(text: str, anchor: _dt.date | None = None) -> list[Span]:
    """Every must-tie span of a sentence, in order: dates, durations, prices, then any other figure."""
    text = text or ""
    got = dates_in(text, anchor) + durations_in(text) + prices_in(text)
    keep: list[Span] = []
    for s in sorted(got, key=lambda s: (s.start, -(s.end - s.start))):
        if not any(s.start < k.end and k.start < s.end for k in keep):
            keep.append(s)
    for m in re.finditer(r"\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:[.,]\d+)?", text):
        if any(m.start() < k.end and k.start < m.end() for k in keep) or _glued(text, m.start(), m.end()):
            continue
        f = figures(text[m.start():])
        if not f:
            continue
        raw, value, scale, dec = f[0]
        keep.append(Span("number", raw, m.start(), m.end(), value=value, scale=scale, dec=dec))
    return sorted(keep, key=lambda s: s.start)


def numbers(text: str) -> list[float]:
    """The figures in `text` that are quantities, with any scale applied (dates and names left out)."""
    out = []
    for s in spans(text):
        if s.kind in ("number", "price"):
            out.append(s.value * s.scale)
            if s.scale != 1:
                out.append(s.value)
        elif s.kind == "duration":
            out.append(s.value)
    return out


def number_supported(s: Span, allowed: list[float]) -> bool:
    return _supported(s.value, s.scale, s.dec, allowed)


def same_date(claim: Span, d: _dt.date) -> bool:
    """A date the sentence states equals `d`: the whole date when it states a year, else the day and month."""
    if d is None:
        return False
    if claim.date is not None and (claim.extra.get("year_stated") or claim.extra.get("relative")):
        return claim.date == d
    return claim.month_day == (d.month, d.day)


def compute(op: str, xs: list):
    """The result of a working, or None when it cannot be done. Dates for days_between."""
    try:
        if op == "days_between" and len(xs) == 2:
            return float(abs((xs[1] - xs[0]).days))
        xs = [float(x) for x in xs]
        if op == "difference" and len(xs) == 2:
            return abs(xs[0] - xs[1])
        if op == "sum" and xs:
            return sum(xs)
        if op == "ratio" and len(xs) == 2 and xs[1]:
            return xs[0] / xs[1]
        if op == "percent_change" and len(xs) == 2 and xs[0]:
            return (xs[1] - xs[0]) / xs[0] * 100
        if op == "product" and xs:
            out = 1.0
            for x in xs:
                out *= x
            return out
    except (TypeError, ValueError, AttributeError):
        return None
    return None


def fmt_date(d: _dt.date) -> str:
    return f"{d.day} {d.strftime('%b')} {d.year}"


def fmt_num(x: float) -> str:
    return f"{x:g}" if abs(x - round(x)) > 1e-9 else str(int(round(x)))
