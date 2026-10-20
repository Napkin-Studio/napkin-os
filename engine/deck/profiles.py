"""Deck types: what a deck is for decides its spine, stages, strictness and guidance (deck types: features/deck-maker-intake.clan).

A tender response, a credentials deck, an investor deck and an agency pitch need different things, so
the engine does not guess one shape. Each type is one data file, ``profiles/<id>.yaml``, loaded and
checked here (``load`` fails loudly on an unknown slide type, stage, check or brief field). Code in
this module reads those files; it never rewords a slide. A profile may

* order and filter the slides (``spine``, ``appendix``, ``buyer_order``: assemble._arrange_spine);
* say which model stages run (``stages``);
* set the length (``length``: the most presented slides, minutes, an optional least);
* name the validator checks that are errors rather than warnings (``strict``: validate.run);
* append guidance lines to a stage's prompt (``prompt_guidance``: stages._sysmsg) and ask type-specific
  intake questions (``questions``).

A profile may not add a fact, a name or a legal line to a slide (ADR 0023, 0028): guidance reaches a
model's prompt, and the model's words are still traced, cited and checked like any other.
``arrange: legacy`` keeps the assembler's own arrangement (agency_pitch and investor_seed build exactly
as they did before types existed); ``arrange: spine`` orders and filters by the profile.

Each profile derives from the research in docs/deck-maker/winning-pitch (GUIDE.md, RUBRIC.md,
rubric.json, NAPKIN-EDGE.md); the source is named in a comment in its file.
"""
from __future__ import annotations

import copy
import re
from pathlib import Path

import yaml

from . import spec
from .inputs import BRIEF_FIELDS

PROFILE_DIR = Path(__file__).parent / "profiles"
#: The ``--kind`` values and the profile each selects (agency and investor are unchanged).
KIND_TO_PROFILE = {"agency": "agency_pitch", "investor": "investor_seed", "tender": "tender_response", "credentials": "credentials"}
#: Every model stage a profile may run (stages.py). ``fit`` and ``e`` run on the assembled deck.
STAGES = ("a0", "a", "b", "c", "d", "i", "fit", "e")
#: The assemblers a profile's ``kind`` names (spec.KINDS).
KINDS = spec.KINDS
ARRANGE = ("legacy", "spine")
#: The nine criteria of rubric.json, in its order: a profile's ``rubric_weights.weights`` has exactly these.
RUBRIC_IDS = ("compliance_gate", "problem_objective", "insight", "idea_chain", "evidence_trace",
              "headline_fit_limits", "team_proof", "commercials_ask", "presentability")
#: rubric.json (2026-10-16): our own default split, not a published standard and not validated.
DEFAULT_WEIGHTS = {"compliance_gate": 12, "problem_objective": 12, "insight": 14, "idea_chain": 14, "evidence_trace": 14,
                   "headline_fit_limits": 8, "team_proof": 10, "commercials_ask": 6, "presentability": 10}
WEIGHTS_LABEL = "default, not validated"

#: The shape of a profile file: field -> (python type, required). Checked by ``validate_profile``.
SCHEMA = {
    "id": (str, True), "label": (str, True), "one_line": (str, True), "kind": (str, True), "arrange": (str, True),
    "spine": (list, True), "appendix": (list, False), "buyer_order": (list, False), "stages": (list, True),
    "length": (dict, True), "rubric_weights": (dict, True), "strict": (dict, True), "prompt_guidance": (dict, True),
    "questions": (list, True), "sources": (list, False),
}


class ProfileError(ValueError):
    """A profile file that is not valid, or an id with no profile."""


def _is_int(v) -> bool:
    """True for a real integer: a bool is not one here."""
    return isinstance(v, int) and not isinstance(v, bool)


def validate_profile(p) -> list:
    """Errors in a profile dict against SCHEMA and the engine's own vocabularies; an empty list means
    valid. Slide types must be in spec.SLIDE_TYPES, stages in STAGES, strict checks in spec.CHECKS,
    guidance stages in STAGES, questions addressed ``brief.<field>``, and the weights must be the
    rubric's nine criteria summing to 100."""
    if not isinstance(p, dict):
        return ["a profile is not an object"]
    errs = []
    for k, (typ, req) in SCHEMA.items():
        if k not in p:
            if req:
                errs.append(f"missing {k}")
        elif not isinstance(p[k], typ):
            errs.append(f"{k} must be a {typ.__name__}")
    errs += [f"unknown field {k}" for k in p if k not in SCHEMA]
    if errs:
        return errs
    if not re.fullmatch(r"[a-z][a-z0-9_]*", p["id"]):
        errs.append(f"id {p['id']!r} must be lower-case words joined by _")
    if p["kind"] not in KINDS:
        errs.append(f"kind {p['kind']!r} must be one of {', '.join(KINDS)}")
    if p["arrange"] not in ARRANGE:
        errs.append(f"arrange {p['arrange']!r} must be one of {', '.join(ARRANGE)}")
    for k in ("spine", "appendix", "buyer_order"):
        for t in p.get(k) or []:
            if not isinstance(t, str) or t not in spec.SLIDE_TYPES:
                errs.append(f"{k}: unknown slide type {t!r}")
    if not p["spine"]:
        errs.append("spine is empty")
    if errs:
        return errs
    if p.get("buyer_order") and not set(p["buyer_order"]) <= set(p["spine"]):
        errs.append("buyer_order may only name types in the spine")
    for s in p["stages"]:
        if s not in STAGES:
            errs.append(f"stages: unknown stage {s!r}")
    L = p["length"]
    for k in ("max_slides", "minutes"):
        if not _is_int(L.get(k)) or L[k] < 1:
            errs.append(f"length.{k} must be a whole number of at least 1")
    if L.get("min_slides") is not None and not (_is_int(L["min_slides"]) and 1 <= L["min_slides"] <= L.get("max_slides", 0)):
        errs.append("length.min_slides must be a whole number from 1 to max_slides")
    w = p["rubric_weights"]
    ws = w.get("weights")
    if not isinstance(ws, dict) or set(ws) != set(RUBRIC_IDS):
        errs.append("rubric_weights.weights must hold exactly the rubric's nine criteria")
    elif not all(_is_int(v) or (isinstance(v, float)) for v in ws.values()) or any(isinstance(v, bool) for v in ws.values()):
        errs.append("rubric_weights.weights must all be numbers")
    elif sum(ws.values()) != 100:
        errs.append(f"rubric_weights.weights sum to {sum(ws.values())}, not 100")
    if w.get("basis") != WEIGHTS_LABEL:
        errs.append(f"rubric_weights.basis must say {WEIGHTS_LABEL!r}")
    for a in w.get("adjustments") or []:
        if not (isinstance(a, dict) and a.get("criterion") in RUBRIC_IDS and a.get("why")):
            errs.append(f"rubric_weights.adjustments: {a!r} needs a rubric criterion and a why")
    for c, lvl in p["strict"].items():
        if c not in spec.CHECKS:
            errs.append(f"strict: unknown check {c!r}")
        if lvl not in ("error", "warn"):
            errs.append(f"strict.{c} must be 'error' or 'warn'")
    for st, lines in p["prompt_guidance"].items():
        if st not in STAGES:
            errs.append(f"prompt_guidance: unknown stage {st!r}")
        if not (isinstance(lines, list) and all(isinstance(x, str) and x.strip() for x in lines)):
            errs.append(f"prompt_guidance.{st} must be a list of lines")
    for q in p["questions"]:
        if not isinstance(q, dict):
            errs.append(f"questions: {q!r} needs a 'q_' id, text, allow_text and a 'brief.<field>' address")
            continue
        addr = str(q.get("address") or "")
        if not (str(q.get("id", "")).startswith("q_") and q.get("text") and addr.startswith("brief.")
                and addr[6:].split(".")[0] in BRIEF_FIELDS and isinstance(q.get("allow_text"), bool)):
            errs.append(f"questions: {q!r} needs a 'q_' id, text, allow_text and a 'brief.<field>' address")
    return errs


_CACHE: dict = {}


def load(pid: str) -> dict:
    """The profile with this id (a copy, so a caller may change it), checked against the schema.
    Raises ProfileError for an unknown id, a file that is not valid YAML, or any error validate_profile finds."""
    if not isinstance(pid, str) or not re.fullmatch(r"[a-z][a-z0-9_]*", pid):
        raise ProfileError(f"no deck type {pid!r}")
    path = PROFILE_DIR / f"{pid}.yaml"
    if not path.exists():
        raise ProfileError(f"no deck type {pid!r}: known types are {', '.join(ids())}")
    if pid not in _CACHE:
        try:
            p = yaml.safe_load(path.read_text(encoding="utf-8"))
        except yaml.YAMLError as e:
            raise ProfileError(f"{path.name}: not valid YAML: {e}") from e
        errs = validate_profile(p)
        if not errs and p["id"] != pid:
            errs.append(f"id {p['id']!r} does not match the file name")
        if errs:
            raise ProfileError(f"{path.name}: " + "; ".join(errs))
        _CACHE[pid] = p
    return copy.deepcopy(_CACHE[pid])


def ids() -> list:
    """The ids of the profiles on disk: the four known types first, in their question order, then any added."""
    found = sorted(p.stem for p in PROFILE_DIR.glob("*.yaml"))
    return [t for t in spec.DECK_TYPES if t in found] + [t for t in found if t not in spec.DECK_TYPES]


def all_profiles() -> list:
    """Every profile, loaded and checked."""
    return [load(i) for i in ids()]


def for_kind(kind: str) -> dict:
    """The profile a ``--kind`` value selects (agency, investor, tender, credentials)."""
    if kind not in KIND_TO_PROFILE:
        raise ProfileError(f"no --kind {kind!r}: choose one of {', '.join(KIND_TO_PROFILE)}")
    return load(KIND_TO_PROFILE[kind])


def default_for_kind(kind: str) -> dict:
    """The profile a deck of this assembler kind (spec.KINDS) gets when nothing chose one: agency_pitch or investor_seed."""
    return load("investor_seed" if kind == "investor" else spec.DEFAULT_TYPE)


def guidance(profile: dict | None, stage: str) -> list:
    """The profile's guidance lines for a stage (empty when there is no profile or none for the stage)."""
    return list(((profile or {}).get("prompt_guidance") or {}).get(stage) or [])


def stage_names(profile: dict | None, base: dict) -> dict:
    """``base`` (stage -> recorded file) cut to the stages the profile runs; all of it with no profile.
    A stage the profile drops is not needed, so its recorded file is not either."""
    if not profile:
        return dict(base)
    return {k: v for k, v in base.items() if k in profile["stages"]}


def runs(profile: dict | None, stage: str) -> bool:
    """True when the profile runs the stage (always true with no profile)."""
    return not profile or stage in profile["stages"]


_NUM = re.compile(r"(\d+(?:\.\d+)?)")


def weights(profile: dict, scoring: list | None) -> dict:
    """The criterion weights a deck is judged on: ``{source, label, weights}``. A tender's scoring
    (the buyer's criteria with their weights, from stage a) wins when it states a weight for every
    criterion (``source: brief``); otherwise the profile's split, labelled as our default
    (``source: default_assumption``, 'default, not validated': GUIDE.md section 3.2, never assume)."""
    rows = [(c.get("criterion"), c.get("weight")) for c in scoring or []]
    parsed = {}
    for name, w in rows:
        m = _NUM.search(str(w))
        if name and m:
            parsed[str(name)] = float(m.group(1))
    if rows and len(parsed) == len(rows) and sum(parsed.values()) > 0:
        return {"source": "brief", "label": "the buyer's own weights", "weights": parsed}
    return {"source": "default_assumption", "label": WEIGHTS_LABEL, "weights": dict(profile["rubric_weights"]["weights"])}
