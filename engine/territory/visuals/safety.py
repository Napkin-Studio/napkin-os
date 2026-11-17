"""The safe-messaging gate. A run whose category, assumed brief, territories or tensions name suicide or self-harm (the
``when_any`` words of engine/deck/packs/suicide_prevention.yaml) gets no frame plan and no frames until a person has reviewed
it. The review is a NAMED RECORD bound to the run file's hash (``<run>.safe-review.json``, made by ``--reviewed-by NAME``), so
a bare flag does not open the gate and a run edited after its review needs a new one. Its ``banned_imagery`` (method or
location, in pictures too) always goes into the negative guidance and the guard check, reviewed or not. Any pack under
engine/deck/packs that carries a ``banned_imagery`` list is applied the same way."""
from __future__ import annotations

import hashlib
import json
import re
from datetime import date
from pathlib import Path

import yaml

PACKS = Path(__file__).resolve().parents[2] / "deck" / "packs"


def _haystack(run: dict) -> str:
    """Everything in the saved run that could name the subject: the gate's own words, the assumed brief, and the model's text
    (a category field that says only 'helplines' is not the only place a run says what it is about)."""
    gate = run.get("gate") or {}
    parts = [gate.get("category"), gate.get("why"), json.dumps(run.get("assumed_brief") or {}, ensure_ascii=False),
             json.dumps(run.get("tensions") or [], ensure_ascii=False)]
    for t in run.get("territories") or []:
        parts += [t.get("line"), t.get("proposition"), t.get("tension_text"), t.get("mechanism")]
    return " ".join(str(p) for p in parts if p).lower()


def packs_for(run: dict, packs_dir: Path | None = None) -> list[dict]:
    hay = _haystack(run)
    out = []
    for p in sorted((packs_dir or PACKS).glob("*.yaml")):
        pk = yaml.safe_load(p.read_text()) or {}
        if pk.get("banned_imagery") and any(str(w).lower() in hay for w in pk.get("when_any", [])):
            out.append(pk)
    return out


def check(run: dict, reviewed: bool = False, packs_dir: Path | None = None) -> dict:
    """``blocked`` is True when a safe-messaging pack applies and no person has reviewed. ``banned`` is the imagery to keep out."""
    packs = packs_for(run, packs_dir)
    banned = list(dict.fromkeys(b["text"] for pk in packs for b in pk["banned_imagery"]))
    return {"applies": bool(packs), "packs": [pk["id"] for pk in packs], "banned": banned, "reviewed": bool(reviewed and packs),
            "blocked": bool(packs) and not reviewed}


def banned_sha(banned: list[str]) -> str:
    return hashlib.sha256(json.dumps(sorted(banned), ensure_ascii=False).encode()).hexdigest()[:12]


def banned_in(text: str, banned: list[str]) -> list[str]:
    """Banned imagery named in a shot description (whole words), so the shot is refused, not painted."""
    return [b for b in banned if re.search(rf"\b{re.escape(b)}s?\b", text or "", re.I)]


# ---------------------------------------------------------------------------------------------------- the review record

def review_path(run_path: Path) -> Path:
    return run_path.with_name(run_path.stem + ".safe-review.json")


def load_review(run_path: Path, run_hash: str) -> dict | None:
    """The review record, only if it names a reviewer and was made for THIS run file (its hash)."""
    p = review_path(run_path)
    try:
        rec = json.loads(p.read_text())
    except (OSError, ValueError):
        return None
    if not isinstance(rec, dict) or not str(rec.get("reviewer") or "").strip() or rec.get("run_sha256_12") != run_hash:
        return None
    return rec


def record_review(run_path: Path, run_hash: str, reviewer: str, packs: list[str]) -> dict:
    reviewer = (reviewer or "").strip()
    if not reviewer:
        raise ValueError("--reviewed-by needs the name of the person who read this run")
    rec = {"reviewer": reviewer, "date": date.today().isoformat(), "run_sha256_12": run_hash, "packs": packs}
    review_path(run_path).write_text(json.dumps(rec, indent=1))
    return rec
