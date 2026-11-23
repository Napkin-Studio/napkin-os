"""The exported deck carries no agency-only text (``--clean-export``, the cloud's web render).

A built deck is a working draft: its sentences that wait for a person say "To confirm: ...", a line the client never gave is a
``[bracketed blank]``, and an internal block explains how a slide was made. That is right in review and wrong in a file that is sent. This
pass runs on the finished deck, before the layout plan, and moves every such open item OFF the slides and into one appendix slide, "Open
items to confirm", beside the 'To supply' list. It never rewords: a sentence is kept word for word or moved word for word.

* A sentence that begins ``To confirm:`` keeps its content (the proposal) and loses the label; its content is listed as an open item.
  A sentence that begins ``To confirm`` with no colon is an open question: it moves to the list whole.
* A ``[bracketed blank]`` of several words in a text, a copy line or a cell leaves the slide for the list; a copy line that is only a
  blank goes whole.
* A block marked ``internal`` (agency notes) is dropped; an empty bullet, line or cell is dropped.
* The title and label lose a leading ``To confirm:``.
* Blocks a person must fill (``human``: the 'To supply' and proposal cards) are never touched: they are the list.
"""
from __future__ import annotations

import re

_SENT = re.compile(r"(?<=[.!?])\s+")
_LEAD = re.compile(r"^\s*to confirm\b\s*(:)?\s*", re.I)
_BLANK = re.compile(r"\s*\[(?:[^\]\n]*\s[^\]\n]*|Agency|Client|Project)\]")   # a bracket holding at least two words ('[presenter and date]'); '[1]' and '[req:R3]' stay
_NO_AGENCY = re.compile(r"^\s*a response from \[(?:agency|[^\]]*)\]\.?\s*$", re.I)
_TEXT_KEYS = ("text", "title", "answer", "kicker", "caption", "from", "to", "label", "quote", "attribution")
_SKIP_KEYS = {"refs", "basis", "kind", "id", "ref", "src", "source", "layout", "hint"}
OPEN_TITLE = "Open items to confirm"
OPEN_MAX = 60
_NOTE = 220


def clean_text(text: str) -> tuple[str, list]:
    """``(text without its open items, [the open items, word for word])``."""
    if not isinstance(text, str) or not text.strip():
        return text, []
    found, kept = [], []
    for sent in _SENT.split(text.strip()):
        if _NO_AGENCY.match(sent):   # 'A response from [Agency]': no agency named, so no line (never a placeholder, never 'Napkin Studio' twice)
            continue
        m = _LEAD.match(sent)
        if m:
            rest = sent[m.end():].strip()
            found.append(sent.strip())
            if m.group(1) and rest:   # 'To confirm: <proposal>.': the proposal stays, the label goes
                kept.append(rest)
            continue
        kept.append(sent)
    out = " ".join(kept)
    blanks = [b.strip() for b in _BLANK.findall(out)]
    if blanks:
        found += blanks
        out = _BLANK.sub("", out)
    out = re.sub(r"\s+([.,;:!?])", r"\1", out).strip()
    out = re.sub(r"^[\s.,;:]+(?=\w)", "", out) if not out.startswith(("...", "…")) else out
    return out, found


def _walk(node, found: list):
    """``node`` cleaned in place of its text, returning the cleaned node, or None when it is empty after cleaning."""
    if isinstance(node, str):
        out, f = clean_text(node)
        found.extend(f)
        return out if out.strip() else None
    if isinstance(node, list):
        out = [x for x in (_walk(i, found) for i in node) if x is not None]
        return out
    if isinstance(node, dict):
        if node.get("human"):   # a card a person fills: it is the list itself
            return node
        out = {}
        for k, v in node.items():
            if k == "rows" and isinstance(v, list):   # a table keeps its shape: a cell that was only an open item is left empty
                out[k] = [[(_walk(c, found) or "") if isinstance(c, str) else c for c in r] if isinstance(r, list) else r for r in v]
            elif k in _SKIP_KEYS or not isinstance(v, (str, list, dict)):
                out[k] = v
            elif k in _TEXT_KEYS or isinstance(v, (list, dict)):
                got = _walk(v, found)
                if got is None and k == "text":
                    return None   # a bullet or line whose text was only an open item
                out[k] = got if got is not None else ("" if isinstance(v, str) else v)
            else:
                out[k] = v
        return out
    return node


def scrub(deck: dict) -> dict:
    """Move the deck's open items to one appendix slide, in place. Returns ``{items, slides}``: how many were moved and from how many slides."""
    open_items, touched = [], 0
    for sid in deck["order"]:
        s = deck["slides"][sid]
        if s["type"] in ("requirement_trace", "appendix_sources"):
            continue
        found = []
        t, f = clean_text(str(s.get("title") or ""))
        if t.strip():
            s["title"] = t
        found += f
        lab, _ = clean_text(str(s.get("label") or ""))
        if lab.strip():
            s["label"] = lab[:80]
        s["blocks"] = [b for b in (_walk(b, found) for b in s.get("blocks") or [] if not (isinstance(b, dict) and b.get("internal"))) if b]
        if found:
            touched += 1
            on = str(s.get("title") or s.get("label") or sid)
            open_items += [{"text": f"On \"{on[:70]}\": {x[:_NOTE]}"} for x in found]
    if open_items:
        from .assemble import _slide   # noqa: PLC0415
        items = open_items[:OPEN_MAX]
        if len(open_items) > OPEN_MAX:
            items.append({"text": f"{len(open_items) - OPEN_MAX} more open items, on the slides' notes."})
        new = _slide("appendix", OPEN_TITLE, [{"kind": "bullets", "items": items}], status="from_source")
        new["requirements"], new["footnotes"] = [], []
        n = 1 + max([int(re.sub(r"\D", "", k) or 0) for k in deck["slides"]] or [0])
        nid = f"s{n:02d}"
        at = next((i for i, k in enumerate(deck["order"]) if deck["slides"][k]["type"] in ("requirement_trace", "appendix_sources")), len(deck["order"]))
        deck["slides"][nid] = new
        deck["order"].insert(at, nid)
    deck.setdefault("meta", {})["export_clean"] = {"open_items": len(open_items), "slides": touched}
    return {"items": len(open_items), "slides": touched}


def has_marks(text: str) -> bool:
    """True when a text still holds an open item or a bracketed blank (what a clean export must not)."""
    return bool(_LEAD.match(str(text or ""))) or bool(_BLANK.search(str(text or ""))) or bool(re.search(r"(?i)\bto confirm\b", str(text or "")))


_EVID = re.compile(r"^\s*\[(?:req|f|fi|doc|prompt|brief|answer|src)[:_][^\]]*\]\s*$")


def notes_of(notes) -> str:
    """A slide's notes for an export: without the evidence ids (``Evidence:`` and its ``[req:R3]`` lines), which are the build's, not the room's."""
    lines = [ln for ln in str(notes or "").splitlines() if not _EVID.match(ln)]
    while lines and lines[-1].strip().lower() in ("evidence:", ""):
        lines.pop()
    out = "\n".join(lines).strip()
    return "" if out.lower() == "evidence:" else out
