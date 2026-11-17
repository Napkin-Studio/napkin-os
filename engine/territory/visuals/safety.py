"""The safe-messaging gate. A run whose category or assumed brief names suicide or self-harm (the ``when_any`` words of
engine/deck/packs/suicide_prevention.yaml) gets no frame plan and no frames until a person passes ``--reviewed``.
Its ``banned_imagery`` (method or location, in pictures too) always goes into the negative guidance and the guard check,
reviewed or not. Any pack under engine/deck/packs that carries a ``banned_imagery`` list is applied the same way."""
from __future__ import annotations

import json
import re
from pathlib import Path

import yaml

PACKS = Path(__file__).resolve().parents[2] / "deck" / "packs"


def _haystack(run: dict) -> str:
    gate = run.get("gate") or {}
    parts = [gate.get("category"), gate.get("why"), json.dumps(run.get("assumed_brief") or {}, ensure_ascii=False)]
    return " ".join(str(p) for p in parts if p).lower()


def packs_for(run: dict, packs_dir: Path | None = None) -> list[dict]:
    hay = _haystack(run)
    out = []
    for p in sorted((packs_dir or PACKS).glob("*.yaml")):
        pk = yaml.safe_load(p.read_text()) or {}
        if pk.get("banned_imagery") and any(w in hay for w in pk.get("when_any", [])):
            out.append(pk)
    return out


def check(run: dict, reviewed: bool = False, packs_dir: Path | None = None) -> dict:
    """``blocked`` is True when a safe-messaging pack applies and no person has reviewed. ``banned`` is the imagery to keep out."""
    packs = packs_for(run, packs_dir)
    banned = list(dict.fromkeys(b["text"] for pk in packs for b in pk["banned_imagery"]))
    return {"applies": bool(packs), "packs": [pk["id"] for pk in packs], "banned": banned, "reviewed": bool(reviewed and packs),
            "blocked": bool(packs) and not reviewed}


def banned_in(text: str, banned: list[str]) -> list[str]:
    """Banned imagery named in a shot description (whole words), so the shot is refused, not painted."""
    return [b for b in banned if re.search(rf"\b{re.escape(b)}s?\b", text or "", re.I)]
