"""Money as people write it, at render time only (deck-layout-library, final review fix 1).

``1500000 euro`` reads as a typo on a slide. The renderers show ``€1.5m`` (a currency word or symbol in the source) or ``EUR 1,500,000`` (a currency
code in the source). The stored words never change, so the deck's words_sha does not either; the form is lossless (``€1.5m`` is exactly 1,500,000, and a value
that cannot be written short is written in full with thousands separators), so two different amounts never format alike. Formatting a formatted text changes
nothing. Pure: no model, no network, no deck.
"""
from __future__ import annotations

import re
from decimal import Decimal, InvalidOperation

SYMBOLS = {"euro": "€", "euros": "€", "dollar": "$", "dollars": "$", "pound": "£", "pounds": "£"}
CODES = ("EUR", "USD", "GBP")
_NUM = r"\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?"
_WORD_AFTER = re.compile(rf"(?<![\w.,€$£])({_NUM})\s+(euros?|dollars?|pounds?)\b", re.I)
_CODE_AFTER = re.compile(rf"(?<![\w.,])({_NUM})\s+(EUR|USD|GBP)\b")
_CODE_BEFORE = re.compile(rf"\b(EUR|USD|GBP)\s+({_NUM})(?![\w,]|\.\d)")
_SYMBOL_BEFORE = re.compile(rf"([€$£])({_NUM})(?![\w,]|\.\d)")
MIN = Decimal(1000)   # below this a figure is left as written


def _dec(n: str) -> Decimal | None:
    try:
        return Decimal(n.replace(",", ""))
    except InvalidOperation:
        return None


def _grouped(v: Decimal) -> str:
    whole, _, frac = f"{v:f}".partition(".")
    return f"{int(whole):,}" + (f".{frac}" if frac.strip("0") else "")


def _short(v: Decimal) -> str | None:
    """``1.5m`` / ``2m`` / ``1.2bn`` when v is a whole number of those with at most two decimals; None when it cannot be written short without loss."""
    for div, suffix in ((Decimal(10) ** 9, "bn"), (Decimal(10) ** 6, "m")):
        if v >= div:
            q = v / div
            if q == q.quantize(Decimal("0.01")):
                return f"{q.normalize():f}{suffix}"
            return None
    return None


def _symbol(sym: str, v: Decimal) -> str:
    short = _short(v)
    return f"{sym}{short}" if short else f"{sym}{_grouped(v)}"


def format_text(text: str) -> str:
    """``text`` with its money written for a slide; anything else, and every value, as it was."""
    if not text or not any(c.isdigit() for c in text):
        return text

    def word_after(m):
        v = _dec(m.group(1))
        return m.group(0) if v is None or v < MIN else _symbol(SYMBOLS[m.group(2).lower()], v)

    def code_after(m):
        v = _dec(m.group(1))
        return m.group(0) if v is None or v < MIN else f"{m.group(2)} {_grouped(v)}"

    def code_before(m):
        v = _dec(m.group(2))
        return m.group(0) if v is None or v < MIN else f"{m.group(1)} {_grouped(v)}"

    def symbol_before(m):
        v = _dec(m.group(2))
        return m.group(0) if v is None or v < MIN else _symbol(m.group(1), v)

    out = _WORD_AFTER.sub(word_after, text)
    out = _CODE_AFTER.sub(code_after, out)
    out = _CODE_BEFORE.sub(code_before, out)
    return _SYMBOL_BEFORE.sub(symbol_before, out)
