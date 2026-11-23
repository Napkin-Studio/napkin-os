"""Detection: is this file a brand bible, and what should the one question offer?

  1. signals.read: free rules over the file name and its text. `no` stops here: no model call, no question.
  2. one Claude Haiku call (purpose `brand_identify`, about a cent) on the name, the page count and the first pages' text:
     {brand_bible, brand_name, confidence}. It counts in the job's usage (`trace.usage`), as every model call does.
  3. the question (mock a1): offered when the model says yes with confidence of at least ASK_AT.

Detection that fails or times out asks nothing: the file chip keeps its small "Build a Brand Clan from this" action (DESIGN 3).
The brand name is matched to the client record, never typed by the person."""

import re

from . import PAGE_CAP
from .signals import SIZE, read

ASK_AT = 0.5
PURPOSE = "brand_identify"
SYSTEM = """You decide whether a file an advertising agency added to a job is a BRAND BIBLE: a brand's own identity guidelines, the book that says how its logo, colours, typefaces, voice and pictures are used.
These are NOT brand bibles: a campaign brief, a research report or a competitor's deck, call notes, a contract, a price list, a deck of finished work, a press kit, a single logo or photo, a product sheet.
You see the file name, its page count and the text of its first pages. Answer from them only.
brand_bible: true or false. brand_name: the brand the book is for, as the book writes it, or null when it names none; never guess one. confidence: 0 to 1."""
SCHEMA = {"type": "object", "additionalProperties": False, "required": ["brand_bible", "brand_name", "confidence"],
          "properties": {"brand_bible": {"type": "boolean"}, "brand_name": {"type": ["string", "null"]},
                         "confidence": {"type": "number"}}}


def norm(s) -> str:
    return re.sub(r"[^a-z0-9]+", " ", str(s or "").lower()).strip()


def same_brand(brand_name, client_name) -> bool | None:
    """Does the name the book gives match the client record? None when either is unknown."""
    a, b = norm(brand_name), norm(client_name)
    if not a or not b:
        return None
    return a == b or a in b or b in a


def preselect(file_name: str, clans: list, client_name: str | None = None) -> dict | None:
    """Which of the client's Brand Clans the question offers to update: the one whose name is in the file's name
    ("Tidewell-Zero-brand-book.pdf" -> Zero), else the default, else the only one. Never the one that is not asked: the person still answers."""
    clans = [c for c in clans or [] if isinstance(c, dict) and c.get("name")]
    if not clans:
        return None
    base = f" {norm(file_name.rsplit('.', 1)[0] if '.' in file_name else file_name)} "
    skip = norm(client_name)
    named = [c for c in clans if not c.get("default") and f" {norm(c['name'])} " in base and norm(c["name"]) != skip]
    if len(named) == 1:
        return named[0]
    default = next((c for c in clans if c.get("default")), None)
    return default or (clans[0] if len(clans) == 1 else None)


def question(name: str, pages: int, clans: list, client_name: str | None) -> dict:
    """What mock a1 shows: the choices, and the one preselected. Not a decision: nothing is built until the person answers."""
    pick = preselect(name, clans, client_name)
    if not clans:
        mode, options = "new", ["build", "not_bible"]
    else:
        mode, options = "choose", ["update", "new", "not_bible"]
    return {"mode": mode, "options": options, "update": ({"document_id": pick.get("document_id"), "name": pick.get("name")} if pick else None),
            "pages": pages, "over_cap": pages > PAGE_CAP, "page_cap": PAGE_CAP}


def identify(model, name: str, text: str | None, pages: int | None, members: list | None, client: dict | None, clans: list | None) -> dict:
    sig = read(name, text, pages, members)
    out = {"ask": False, "reason": None, "pages": pages or 0, "signals": {"score": sig.score, "verdict": sig.verdict, "found": sig.found},
           "model_called": False, "brand_bible": None, "brand_name": None, "confidence": None, "matches_client": None, "question": None}
    if sig.verdict == "no":
        out["reason"] = "not_a_bible_by_rules"
        return out
    payload = {"file_name": name, "pages": pages, "members": (members or [])[:40], "text": (text or "")[:SIZE]}
    out["model_called"] = True
    try:
        got = model.structured(PURPOSE, SYSTEM, payload, SCHEMA, max_tokens=200)
    except Exception as e:  # noqa: BLE001 - detection failing asks nothing; the chip's own action stays
        out["reason"] = "detection_failed"
        out["error"] = getattr(e, "kind", type(e).__name__)
        return out
    conf = max(0.0, min(1.0, float(got.get("confidence") or 0)))
    out.update(brand_bible=bool(got.get("brand_bible")), brand_name=(got.get("brand_name") or None), confidence=conf)
    out["matches_client"] = same_brand(out["brand_name"], (client or {}).get("name"))
    if out["brand_bible"] and conf >= ASK_AT:
        out["ask"] = True
        out["question"] = question(name, pages or 0, clans or [], (client or {}).get("name"))
    else:
        out["reason"] = "not_a_bible"
    return out
