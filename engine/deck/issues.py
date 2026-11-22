"""Issues, the read-only part (contract section 7): a severity for a finding and the slide id for a qa.json key.

``deck-repair-loop`` extends this module (ids, fixes, status, the policy file); the visual checklist calls the two
functions below so there is one mapper, not two. No model, no network, no file read.
"""
from __future__ import annotations

from . import spec

#: The contract's default mapping when a policy has no entry for a check (section 7).
DEFAULT_SEVERITY = {"error": "blocker", "warn": "minor"}
DECK_KEY = "deck"
#: Checks whose default severity is not the level's (a policy's severity map still wins): a held Style Pack leaves pictures in an old style.
CHECK_SEVERITY = {"style_pack_held": "major"}


def severity(check: str, level: str, policy: dict | None = None) -> str:
    """``blocker``, ``major`` or ``minor`` for a finding: the policy's ``severity`` map first (by check name, or
    ``check:level``), else the default (error is blocker, warn is minor). An unknown level counts as warn."""
    sev = (policy or {}).get("severity") or {}
    for key in (f"{check}:{level}", check):
        if sev.get(key) in spec.ISSUE_SEVERITIES:
            return sev[key]
    return CHECK_SEVERITY.get(check) or DEFAULT_SEVERITY.get(level, "minor")


def slide_id_of(qa_key, deck: dict) -> str:
    """The slide id for a qa.json key: a 1-based slide number (``"3"``) through ``deck.order`` (the rendered order),
    ``"deck"`` for the deck-wide key. A number outside the order gives ``"deck"``, never a wrong slide."""
    if qa_key == DECK_KEY:
        return DECK_KEY
    try:
        n = int(qa_key)
    except (TypeError, ValueError):
        return DECK_KEY
    order = deck.get("order") or []
    return order[n - 1] if 1 <= n <= len(order) else DECK_KEY


# ---------------------------------------------------------------------------------------------------- adapters (deck-repair-loop)
#: Checks the image guard raises (source ``image_guard``); every other validator name is source ``validate``.
IMAGE_GUARD_CHECKS = ("image_missing", "image_unapproved", "image_flagged", "image_rights")
_SHAPE = None


def issue_id(source: str, check: str, slide: str, slot: str | None, n: int) -> str:
    """``i_`` and the first 8 hex of the SHA-256 of ``source|check|slide|slot|n``: the same finding keeps its id across rounds."""
    import hashlib
    return "i_" + hashlib.sha256(f"{source}|{check}|{slide}|{slot or ''}|{n}".encode()).hexdigest()[:8]


def _slot_of(message: str, deck: dict | None, sid: str) -> str | None:
    """The slot a qa finding names: its message quotes the shape (``'slot:body' text is ...``). None when it names no slot shape."""
    import re
    m = re.search(r"'slot:([a-z][a-z0-9_]{1,23})'", message or "")
    return m.group(1) if m else None


def _make(out: list, counts: dict, source: str, f: dict, sid: str, slot: str | None, round_: int, policy: dict | None) -> None:
    check, level = f["check"], f.get("level") or "warn"
    key = (source, check, sid, slot)
    counts[key] = counts.get(key, -1) + 1
    sev = severity(check, level, policy)
    if source == "critic" and sev == "blocker":
        sev = "major"   # the critic never raises a blocker (contract section 7)
    it = {"id": issue_id(source, check, sid, slot, counts[key]), "round": round_, "slide": sid, "source": source, "check": check,
          "level": level, "severity": sev, "message": str(f.get("message") or check)[:300], "status": "open"}
    if slot:
        it["slot"] = slot
    ev = f.get("evidence")
    if isinstance(ev, dict) and ev.get("measured") is not None:
        it["evidence"] = {k: v for k, v in ev.items() if k in ("measured", "limit", "unit") and v is not None}
    out.append(it)


def from_validation(findings: list, deck: dict, policy: dict | None = None, round_: int = 0) -> list:
    """Issues from validation.json (the validator's findings, the plan's slot findings and the picture findings): the slide id is
    already in each finding; a finding with none belongs to the deck."""
    out, counts = [], {}
    for f in findings:
        if not isinstance(f, dict) or "check" not in f:
            continue
        src = "image_guard" if f["check"] in IMAGE_GUARD_CHECKS else "validate"
        _make(out, counts, src, f, f.get("slide") or DECK_KEY, f.get("slot"), round_, policy)
    return out


def from_qa(qa: dict, deck: dict, policy: dict | None = None, round_: int = 0) -> list:
    """Issues from qa.json: the slide number of each key goes through ``deck.order`` (``slide_id_of``), the slot from the shape the message names."""
    out, counts = [], {}
    for key, fs in ((qa or {}).get("slides") or {}).items():
        sid = slide_id_of(key, deck)
        for f in fs:
            if isinstance(f, dict) and "check" in f:
                _make(out, counts, "qa_render", f, sid, _slot_of(f.get("message", ""), deck, sid), round_, policy)
    return out


def derive(findings: list, qa: dict | None, deck: dict, policy: dict | None = None, round_: int = 0) -> list:
    """All issues of one measured round: the validator's first, then the rendered QA's, in file order."""
    return from_validation(findings, deck, policy, round_) + from_qa(qa or {}, deck, policy, round_)
