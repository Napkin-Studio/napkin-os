"""Blind judge packets: the deck's presented text with no arm, run name or provenance, under a shuffled label."""
from __future__ import annotations

import json
import random
import re
from pathlib import Path

from ..evaluate import _presented

#: Keys whose values are never shown to a judge: provenance, structure and agency-only notes.
SKIP_KEYS = {"refs", "kind", "visual", "human", "status", "requirements", "footnotes", "notes", "built_from", "id", "claims", "layout", "hint"}


def _strings(x, out: list) -> None:
    """Collect the text strings of a block tree in reading order, skipping SKIP_KEYS."""
    if isinstance(x, str):
        out.append(x)
    elif isinstance(x, dict):
        for k, v in x.items():
            if k not in SKIP_KEYS:
                _strings(v, out)
    elif isinstance(x, list):
        for v in x:
            _strings(v, out)


def deck_text(deck: dict, hide: list | None = None, hide_words: list | None = None) -> tuple[str, int]:
    """The presented slides as plain text (``Slide n: title`` then its lines) and the slide count.

    Nothing from ``meta`` is included (so no ``built_from``, stage sources or arm). Any string in ``hide``
    (arm names) is replaced by ``[hidden]`` case-insensitively; a string in ``hide_words`` (run names) only where it
    is a whole word, so a generic name such as ``new`` does not damage ``something new``."""
    parts = []
    shown = _presented(deck)
    for n, sid in enumerate(shown, 1):
        s = deck["slides"][sid]
        lines: list = []
        _strings(s.get("blocks", []), lines)
        parts.append(f"Slide {n}: {s.get('title', '')}\n" + "\n".join(f"- {t}" for t in lines if t.strip()))
    text = "\n\n".join(parts)
    for h in sorted({h for h in hide or [] if h}, key=len, reverse=True):
        text = re.sub(re.escape(h), "[hidden]", text, flags=re.I)
    for h in sorted({h for h in hide_words or [] if h}, key=len, reverse=True):
        text = re.sub(r"(?<!\w)" + re.escape(h) + r"(?!\w)", "[hidden]", text, flags=re.I)
    return text, len(shown)


def run_ids(runs: list) -> list:
    """A unique deck id for each run directory, in order: the directory name when the names are all different, else
    the shortest trailing path (``agency_A/new``) that tells them apart. Real recorded runs are often all named ``new``."""
    parts = [Path(r).resolve().parts for r in runs]
    for k in range(1, max((len(x) for x in parts), default=1) + 1):
        ids = ["/".join(x[-k:]) for x in parts]
        if len(set(ids)) == len(ids):
            return ids
    return ["/".join(x) for x in parts]


def scrub_words(ids: list) -> list:
    """The words to scrub from packets for these run ids: every path part of an id except a part shared by two or
    more ids (such as ``new``), which names no deck. A name that is unique is scrubbed whole, as before."""
    from collections import Counter
    count = Counter(part for i in ids for part in set(i.split("/")))
    return sorted({part for i in ids for part in i.split("/") if count[part] == 1} | ({i for i in ids if "/" in i}))


def words(text: str) -> int:
    """Word count of a packet's text."""
    return len(re.findall(r"\S+", text))


def build_packets(runs: list, seed: int, hide: list | None = None) -> tuple[list, dict]:
    """Blind packets for run directories: ``(packets, mapping)``.

    A packet is ``{label, text, slides, words}``: labels ``D1..Dn`` are assigned by a seeded permutation of
    ``runs`` and the packets come back in label order. ``mapping`` (label -> unique run id, see run_ids) and the seed
    belong in bench.json, never in a packet. The distinguishing parts of each run id are scrubbed from the text."""
    runs = [Path(r) for r in runs]
    ids = run_ids(runs)
    scrub = scrub_words(ids)
    order = list(range(len(runs)))
    random.Random(seed).shuffle(order)
    packets, mapping = [], {}
    for pos, i in enumerate(order, 1):
        r = runs[i]
        deck = json.loads((r / "deck.json").read_text(encoding="utf-8"))
        text, n = deck_text(deck, list(hide or []), scrub)
        label = f"D{pos}"
        packets.append({"label": label, "text": text, "slides": n, "words": words(text)})
        mapping[label] = ids[i]
    return packets, mapping


def both_orders(packets: list, seed: int) -> dict:
    """The presentation orders for ranking: ``{"forward": [labels], "reverse": [labels reversed]}``.

    The forward order is a seeded shuffle of the labels (so label number does not set position), the reverse is
    its mirror, so every deck is seen early once and late once."""
    labels = [p["label"] for p in packets]
    random.Random(seed + 1).shuffle(labels)
    return {"forward": labels, "reverse": list(reversed(labels))}
