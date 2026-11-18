"""What a territory run was made from, and whether its pictures may be made (the 18 Nov 2026 review, blocker 1).

The frame pictures are made by Runway's Gemini image models. Whether a prompt derived from client material may go there is ONE switch,
``visuals.policy.CLIENT_TO_RUNWAY`` (Sai, 18 Nov 2026: allowed for testing; may change). Whatever it says:

* the brief's marks are carried from ``territory.run`` into the run (``material.marks``) and every shot passes the picture-prompt lint and
  the Confidential deny-list built from them (cli.build_jobs), so a part marked Confidential is never drawn;
* marks that cannot be known (a brief_object.json carries none, or a run saved before ``territory.run --material`` with no declaration)
  refuse the frames: the deny-list cannot run without them.

Material marked ``invented`` or ``demo`` by a person is never client-derived. Anything else (``client``, unmarked, or a brief with parts
marked Confidential) is client-derived: sent under ``allow`` after the lint, refused under ``refuse``. For a run saved before the
``--material`` flag, a person declares it with ``--material invented|demo|client --declared-by NAME`` (``<run>.material.json``, bound to
the run's hash); the declaration also says that no part of it is marked Confidential.
"""
from __future__ import annotations

import json
from datetime import date
from pathlib import Path

from visuals import policy

ORIGINS = ("invented", "demo", "client")
SENDABLE = ("invented", "demo")


def block(origin: str | None, brief: str | None, marks, brand: str | None = None) -> dict:
    """The ``material`` block ``territory.run`` writes into a run. ``marks``: the brief's marked parts (a list, empty when none is marked), or
    None when they cannot be known (a brief_object.json carries no mark data). With no brief there is nothing to mark: an empty list."""
    return {"origin": origin if origin in ORIGINS else "unknown", "brief": bool(brief),
            "brief_kind": (("clan" if str(brief).endswith(".clan") else "json") if brief else None),
            "marks": (list(marks) if marks is not None else None) if brief else [], "brand": brand or None}


def declaration_path(run_path: Path) -> Path:
    return run_path.with_name(run_path.stem + ".material.json")


def record_declaration(run_path: Path, run_hash: str, origin: str, by: str) -> dict:
    by = (by or "").strip()
    if origin not in ORIGINS:
        raise ValueError(f"--material {origin}: say invented, demo or client")
    if not by:
        raise ValueError("--material needs --declared-by NAME: the person who vouches for what this run was made from and that no part of it is marked Confidential")
    rec = {"origin": origin, "by": by, "date": date.today().isoformat(), "run_sha256_12": run_hash, "confidential_parts": 0}
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


UNLOCK_MARKS = ("To unlock: make the run from a Brief Maker .clan (it carries its marks) or with no brief (territory.run --material "
                "invented|demo|client), or, for a run saved before that flag, declare it: --material invented|demo|client --declared-by <your name>.")


def gate(run: dict, declaration: dict | None = None, environ=None) -> dict:
    """``{ok, why, origin, client_derived, marks, by, policy, policy_label, brand}``. ``marks`` (when ok) feed the Confidential deny-list."""
    pol = policy.client_to_runway(environ)
    m = run.get("material") if isinstance(run.get("material"), dict) else None
    out = {"ok": False, "why": "", "origin": "unknown", "client_derived": True, "marks": None, "by": None, "policy": pol,
           "policy_label": policy.label(environ), "brand": (m or {}).get("brand")}
    if m and m.get("brief") and m.get("marks") is None:
        out["why"] = ("this run was made from a brief that carries no mark data (a brief_object.json has none), so the Confidential deny-list "
                      "cannot run. " + UNLOCK_MARKS)
        return out
    if m is None and declaration is None:
        out["why"] = "this run does not record what it was made from or its marks, so the Confidential deny-list cannot run. " + UNLOCK_MARKS
        return out
    marks = list(m.get("marks") or []) if m else []
    origin = (m or {}).get("origin") if (m or {}).get("origin") in ORIGINS else ((declaration or {}).get("origin") or "unknown")
    by = "territory.run --material" if (m or {}).get("origin") in ORIGINS else ((declaration or {}).get("by") or "nobody (unmarked)")
    client = origin not in SENDABLE or bool(marks)
    out.update(origin=origin, client_derived=client, marks=marks, by=by)
    if client and pol == "refuse":
        why = (f"{len(marks)} part(s) marked Confidential" if marks else f"material {origin}")
        out["why"] = (f"this run is client-derived ({why}) and the policy refuses client-derived prompts to Runway "
                      "(visuals.policy.CLIENT_TO_RUNWAY). Only material a person marked invented or demo is sent.")
        return out
    out["ok"] = True
    return out
