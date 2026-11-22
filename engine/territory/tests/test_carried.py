"""What a spin-off carried into a Territories document reaches the reader (feature territories-spinoff-in, LESSONS 7).

The fixture is what the HOST produced: crates/napkin-host/tests/territories_spinoff.rs spins a real research document and a brief written
in Brief Maker's own keys into the packed Territories template and writes example/spunoff/. These tests read it the way the engine does and
the way the screen counts it, and fail when a field that arrived is not read.

Run from engine/: ``PYTHONPATH=. python -m pytest -q territory/tests/test_carried.py``.
"""
from __future__ import annotations

import copy
import json
from pathlib import Path

import pytest

jsonschema = pytest.importorskip("jsonschema")

from territory import carried, contract  # noqa: E402

DIR = carried.spunoff_dir()
DATA = json.loads((DIR / "data.json").read_text())
FACTS = json.loads((DIR / "facts.json").read_text())
FINDINGS = json.loads((DIR / "findings.json").read_text())
BRIEF_ID = "5b0d3a7e-4c1f-4e2a-9a55-1d6c0f2b7e11"
RESEARCH_ID = "7c1e9a42-5b3d-4f8e-9a6c-2d1f0e8b4a17"
#: Brief Maker's keys as the host test writes them: key -> the contract name it is read as
WRITTEN = {"background": "background", "objectives": "objectives", "audience": "audience", "insight": "insight",
           "single_minded_proposition": "smp", "tone_and_world": "tone_world_assets", "mandatories": "mandatories"}


def test_the_fixture_is_a_real_spinoff_not_a_hand_edit():
    assert sorted(DATA) == ["projection", "upstream"]
    assert set(DATA["upstream"]) == {BRIEF_ID, RESEARCH_ID}
    assert "projection" not in DATA["upstream"][BRIEF_ID] and "upstream" not in DATA["upstream"][BRIEF_ID]


def test_every_brief_field_that_arrived_reaches_the_reader():
    got = carried.engine_input(DATA, FACTS, FINDINGS)
    for key, name in WRITTEN.items():
        assert name in got["brief"], f"{key} arrived but the reader dropped it"
        assert got["brief"][name] == carried.text_of(DATA["upstream"][BRIEF_ID][key]).strip()
        assert "None" not in got["brief"][name] and "null" not in got["brief"][name]
    assert len(got["brief"]) == len(WRITTEN)
    # the mandatories are lines, not a Python list
    assert got["brief"]["mandatories"] == "0.0% ABV on the front of pack\nNo health claims"
    # a field wrapped with its provenance ({value, origin}) reads as its value
    assert got["brief"]["audience"].startswith("Moderate drinkers")
    assert got["brief_title"] == "Lúnasa 0.0 launch brief"
    assert got["from"] == "brief+research"


def test_every_pin_and_finding_reaches_the_reader_and_a_rejected_one_is_set_apart():
    got = carried.engine_input(DATA, FACTS, FINDINGS)
    assert [f["id"] for f in got["facts"]] == [f["id"] for f in FACTS["facts"]]
    rejected = [f["id"] for f in FINDINGS["findings"] if f.get("status") == "rejected"]
    assert got["rejected_findings"] == rejected
    assert [f["id"] for f in got["findings"]] == [f["id"] for f in FINDINGS["findings"] if f["id"] not in rejected]
    assert got["research_title"]


def test_the_screens_counts_equal_the_members():
    """The app counts from data.projection (it cannot read members); the engine from the members. They must agree."""
    from_projection = carried.read(DATA)
    from_members = carried.read(DATA, FACTS, FINDINGS)
    assert from_projection["research"]["pins"] == len(FACTS["facts"]) == from_members["research"]["pins"]
    assert from_projection["research"]["findings"] == len(FINDINGS["findings"]) == from_members["research"]["findings"]
    for k in ("verified", "proposed", "rejected"):
        assert from_projection["research"][k] == from_members["research"][k]
    assert from_projection["brief"] == from_members["brief"]
    assert from_projection["brief"]["filled"] == len(WRITTEN)
    assert from_projection["brief"]["mandatories"] == 2


def test_the_golden_the_app_is_tested_against_is_current():
    assert json.loads((DIR / "seen.json").read_text()) == carried.read(DATA), \
        "example/spunoff/seen.json is stale: cd engine && PYTHONPATH=. python -m territory.carried write"


def test_the_key_fields_are_in_the_order_the_screen_shows():
    seen = carried.read(DATA)
    assert [f["id"] for f in seen["brief"]["key_fields"]] == ["insight", "smp", "objectives", "audience", "mandatories"]
    assert all(f["label"] and f["label"][0].isupper() and "_" not in f["label"] for f in seen["brief"]["fields"])


def test_no_text_leaks_onto_the_screen():
    seen = json.dumps(carried.read(DATA), ensure_ascii=False)
    for bad in contract.TEXT_LEAKS:
        assert bad not in seen
    assert not contract.lint({"x": json.loads(seen)})


def test_a_blank_or_empty_document_says_nothing_came_in_and_never_invents_a_zero():
    for blank in ({}, {"upstream": {}}):
        seen = carried.read(blank)
        assert seen == {"brief": None, "research": None, "from": "none"}
    only_brief = {"upstream": {BRIEF_ID: DATA["upstream"][BRIEF_ID]}}
    seen = carried.read(only_brief)
    assert seen["from"] == "brief" and seen["research"] is None
    only_research = {"upstream": {RESEARCH_ID: DATA["upstream"][RESEARCH_ID]}}
    seen = carried.read(only_research)
    assert seen["from"] == "research" and seen["brief"] is None
    # research with no projection and no members: the counts are unknown (None), not 0
    assert seen["research"]["pins"] is None and seen["research"]["findings"] is None


def test_a_style_pack_or_brand_clan_is_neither_the_brief_nor_the_research():
    data = copy.deepcopy(DATA)
    data["upstream"]["kit-1"] = {"kit": {"version": 1}, "name": "A look"}
    assert carried.read(data) == carried.read(DATA)


def test_brief_makers_keys_are_the_decks_mapping():
    """engine/deck/inputs.py CLAN_FIELDS is the same mapping; they must not drift."""
    deck_inputs = pytest.importorskip("deck.inputs")
    assert carried.BRIEF_KEYS == deck_inputs.CLAN_FIELDS


def test_the_contract_names_are_the_schemas_brief_fields():
    assert set(carried.BRIEF_KEYS) == set(contract.enum("brief_field"))
    assert set(carried.LABELS) == set(carried.BRIEF_KEYS)


def test_a_cite_of_a_brief_field_resolves_against_a_real_brief_makers_keys():
    """`brief:smp` is cited by the contract's name; Brief Maker keeps it as single_minded_proposition."""
    known = contract.known_cites(DATA, FACTS, FINDINGS)
    for key, name in WRITTEN.items():
        assert f"brief:{name}" in known, f"brief:{name} does not resolve though the brief carried {key}"
    assert "brief:budget_scope" not in known, "a part the brief does not hold is not citable"
    assert {f["id"] for f in FACTS["facts"]} <= known


def test_the_carried_document_is_valid_but_for_the_members_the_engine_writes_first():
    """A just-spun-off document holds upstream and projection only. Schema-wise the only missing things are the engine's required members."""
    problems = contract.problems(DATA)
    words = [p.words if hasattr(p, "words") else str(p) for p in problems]
    assert problems, "the contract requires the engine's members; a spin-off does not write them"
    assert all(getattr(p, "rule", "") == "required" or "required" in str(p).lower() for p in problems), words
    # and once the engine has written them, with the carried parts in place, it passes the whole contract
    full = contract.example("data")
    full["upstream"] = copy.deepcopy(DATA["upstream"])
    full["projection"] = copy.deepcopy(DATA["projection"])
    contract.validate(full)
