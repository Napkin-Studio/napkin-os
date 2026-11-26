"""What a territory run was made from: the material question, answered by a named person, recorded with the frames.

Pictures are made from client material the same way the words are (Shrey, 26 Nov 2026: Confidential keeps a part out of Napkin's own
RAG, layers, training and evals only, ``visuals.policy``). What a person still says before the first picture is what the material IS
(invented, a demo, or the client's), so every frame and the deck that uses it carry that provenance. A run that records no origin, and
has no declaration, asks the question; it is never assumed.

``territory.run`` records the brief's marked parts only as a COUNT beside the brief's sha256 (``material.marks_count``): the marked text
never reaches the run file (it is not gitignored).
"""
from __future__ import annotations

import json
from datetime import date
from pathlib import Path

from visuals import policy

ORIGINS = ("invented", "demo", "client")
#: The label a manifest carries so a reader of the frames knows what they were made from (a person marked the origin).
PROVENANCE = {"invented": "Invented (no brief)", "demo": "Demo (not a client)", "client": "Client material"}


def block(origin: str | None, brief: str | None, marks, brand: str | None = None, brief_sha256: str | None = None) -> dict:
    """The ``material`` block ``territory.run`` writes into a run. ``marks``: the brief's marked parts (a list, empty when none is marked), or
    None when they cannot be known (a brief_object.json carries no mark data). Only their COUNT is kept, beside the brief's sha256: the
    marked text never reaches the run file (it is not gitignored). With no brief there is nothing to mark: a count of 0."""
    return {"origin": origin if origin in ORIGINS else "unknown", "brief": bool(brief),
            "brief_kind": (("clan" if str(brief).endswith(".clan") else "json") if brief else None),
            "marks_count": (len(marks) if marks is not None else None) if brief else 0,
            "brief_sha256": (brief_sha256 or None) if brief else None, "brand": brand or None}


def declaration_path(run_path: Path) -> Path:
    return run_path.with_name(run_path.stem + ".material.json")


def record_declaration(run_path: Path, run_hash: str, origin: str, by: str) -> dict:
    by = (by or "").strip()
    if origin not in ORIGINS:
        raise ValueError(f"--material {origin}: say invented, demo or client")
    if not by:
        raise ValueError("--material needs --declared-by NAME: the person who vouches for what this run was made from")
    rec = {"origin": origin, "by": by, "date": date.today().isoformat(), "run_sha256_12": run_hash}
    declaration_path(run_path).write_text(json.dumps(rec, indent=1))
    return rec


def load_declaration(run_path: Path, run_hash: str) -> dict | None:
    """The declaration, only if it names a person and was made for THIS run file."""
    try:
        rec = json.loads(declaration_path(run_path).read_text())
    except (OSError, ValueError):
        return None
    if not isinstance(rec, dict) or not str(rec.get("by") or "").strip() or rec.get("run_sha256_12") != run_hash or rec.get("origin") not in ORIGINS:
        return None
    return rec


ASK = "Say what this material is (invented, a demo or the client's) and who says so; the frames record it."


def gate(run: dict, declaration: dict | None = None) -> dict:
    """``{ok, why, origin, by, brand, policy_label}``. Ok once the run records its origin (``territory.run --material``) or a named person
    declared it; otherwise ``why`` asks the material question. Client material is ok: it goes to the picture models like it goes to Bedrock."""
    m = run.get("material") if isinstance(run.get("material"), dict) else {}
    if m.get("origin") in ORIGINS:
        origin, by = m["origin"], "territory.run --material"
    elif (declaration or {}).get("origin") in ORIGINS and str((declaration or {}).get("by") or "").strip():
        origin, by = declaration["origin"], str(declaration["by"]).strip()
    else:
        origin, by = "unknown", None
    out = {"ok": origin in ORIGINS, "why": "", "origin": origin, "by": by, "brand": m.get("brand"), "policy_label": policy.label()}
    if not out["ok"]:
        out["why"] = "nobody has said what this material is. " + ASK
    return out
