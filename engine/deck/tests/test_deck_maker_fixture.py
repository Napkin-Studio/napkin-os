"""The Deck Maker app's sample run holds a deck the engine's own schema accepts."""
from __future__ import annotations

import json
from pathlib import Path

import pytest
import yaml

jsonschema = pytest.importorskip("jsonschema")

ROOT = Path(__file__).resolve().parents[3]
TEMPLATE = ROOT / "app" / "templates" / "deck-maker"
SCHEMA = Path(__file__).resolve().parents[1] / "deck.schema.json"


def _data() -> dict:
    return yaml.safe_load((TEMPLATE / "example" / "data.yaml").read_text())


def test_sample_deck_matches_the_engines_deck_schema():
    data = _data()
    deck = {k: v for k, v in data["deck"].items() if k != "appendix_count"}
    deck.setdefault("territories", {})
    deck.setdefault("scoring", [])
    jsonschema.validate(deck, json.loads(SCHEMA.read_text()))


def test_sample_run_matches_the_apps_own_schema():
    jsonschema.validate(_data(), json.loads((TEMPLATE / "schema.json").read_text()))


def test_sample_cites_only_refs_it_holds_evidence_for():
    data = _data()
    held = set(data["evidence"])
    cited = {
        r
        for s in data["deck"]["slides"].values()
        for part in (s["blocks"], s["claims"])
        for item in part
        for r in item.get("refs", [])
    }
    assert cited <= held, cited - held


def test_sample_gate_holds_and_library_is_off():
    run = _data()["run"]
    gate = run["gate"]
    ids = [s["id"] for s in run["stages"]]
    after = ids[ids.index(gate["id"]) + 1 :]
    assert all(s["status"] == "next" for s in run["stages"] if s["id"] in after)
    assert _data()["inputs"]["library"]["enabled"] is False


def test_sample_names_no_real_client():
    text = (TEMPLATE / "example" / "data.yaml").read_text().lower()
    assert _data()["inputs"]["prompt"]["client"] == "Lumen Water"


def test_sample_rows_have_exactly_their_keys():
    """A comma inside an unquoted flow value splits it into a stray key; catch that."""
    data = _data()
    assert all(set(v) == {"kind", "text"} for v in data["evidence"].values())
    assert all(set(v) == {"id", "kind", "text", "ref"} for v in data["deck"]["requirements"].values())
    assert data["evidence"]["f_12"]["text"].endswith("High confidence.")
