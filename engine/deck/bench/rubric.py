"""Load rubric.json and decide which weights a deck is judged on (the buyer's when stated, else ours, labelled)."""
from __future__ import annotations

import json
from pathlib import Path

from .. import profiles

RUBRIC_PATH = Path(__file__).resolve().parents[1] / "rubric.json"
DEFAULT_LABEL = profiles.WEIGHTS_LABEL   # "default, not validated"


def load_rubric(path: Path | None = None) -> dict:
    """The rubric (rubric.json beside the engine, or ``path``): its criteria with weight and 1/3/5 anchors."""
    return json.loads(Path(path or RUBRIC_PATH).read_text(encoding="utf-8"))


def criterion_ids(rubric: dict) -> list:
    """The criterion ids in the rubric's order."""
    return [c["id"] for c in rubric["criteria"]]


def default_weights(rubric: dict) -> dict:
    """The rubric's own default split ``{id: percent}``."""
    return {c["id"]: float(c["weight_percent"]) for c in rubric["criteria"]}


def resolve_weights(rubric: dict, profile_id: str | None = None, scoring: list | None = None) -> dict:
    """The weights for a run: ``{source, label, weights, buyer_criteria}``.

    Tender override rule (rubric.json ``tender_override``): when the buyer's scoring (deck.json ``scoring``)
    states a weight for every criterion, ``profiles.weights`` returns them (source ``brief``). If those names are
    exactly rubric ids they are used as the weights; if they are the buyer's own names they are recorded in
    ``buyer_criteria`` and the nine-criterion total keeps the profile's split, still labelled 'default, not
    validated' (the smaller change: mapping a buyer's wording onto our nine ids is a judgement a person makes).
    With no profile the rubric's own split is the default."""
    ids = criterion_ids(rubric)
    if profile_id:
        got = profiles.weights(profiles.load(profile_id), scoring)
        base = dict(profiles.load(profile_id)["rubric_weights"]["weights"])
    else:
        got = {"source": "default_assumption", "label": DEFAULT_LABEL, "weights": default_weights(rubric)}
        base = default_weights(rubric)
    if got["source"] == "brief":
        if set(got["weights"]) == set(ids):
            return {"source": "brief", "label": got["label"], "weights": got["weights"], "buyer_criteria": None}
        return {"source": "default_assumption", "label": DEFAULT_LABEL, "weights": base, "buyer_criteria": got["weights"]}
    return {"source": "default_assumption", "label": DEFAULT_LABEL, "weights": {k: float(got["weights"][k]) for k in ids}, "buyer_criteria": None}


def weighted_total(scores: dict, weights: dict) -> float | None:
    """The weight-normalised mean of ``{criterion: score}`` over the criteria scored, on the 1-5 scale; None with none."""
    use = {k: v for k, v in scores.items() if k in weights and v is not None and weights[k] > 0}
    if not use:
        return None
    tot = sum(weights[k] for k in use)
    return sum(weights[k] * v for k, v in use.items()) / tot
