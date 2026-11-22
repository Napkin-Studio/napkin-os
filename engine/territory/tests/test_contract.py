"""The Territories document contract (feature territories-contract): the schema, its fixtures and the validator every other feature calls.

Run from engine/: ``PYTHONPATH=. python -m pytest -q territory/tests/test_contract.py`` (needs jsonschema; check.sh's PY_ENGINE_DEPS has it).
A failing validation is a failing test, never a skipped step (LESSONS 12): the engine's emitted shapes are validated here against the
SAME schema.json the host validates the document against.
"""
from __future__ import annotations

import copy
import json
import re
from pathlib import Path

import pytest

jsonschema = pytest.importorskip("jsonschema")

from territory import cards, contract, example_build, ladder  # noqa: E402

RESEARCH = Path(__file__).resolve().parents[3] / "app" / "templates" / "campaign-research"
FACTS, FINDINGS = contract.example("facts"), contract.example("findings")
NAMES = ["data"] + contract.example_states()


def doc(name="data"):
    return copy.deepcopy(contract.example(name))


def check(d):
    return contract.check(d, facts=FACTS, findings=FINDINGS)


def rules(ps):
    return {p.rule for p in ps}


# ------------------------------------------------------------ the schema and its fixtures


def test_the_schema_is_valid_draft7_and_closed():
    jsonschema.Draft7Validator.check_schema(contract.schema())
    assert contract.schema()["additionalProperties"] is False


@pytest.mark.parametrize("name", NAMES)
def test_every_fixture_passes_the_whole_contract(name):
    assert check(doc(name)) == []
    contract.validate(doc(name))


def test_the_expected_states_exist():
    assert set(contract.example_states()) == {"pick", "explore_running", "greenlight_open", "greenlight_derived_pending",
                                              "greenlight_sensitive_missing", "failed_refused"}


def test_fixtures_are_the_builders_output_not_hand_edits():
    assert example_build.main.__module__ and not [n for n, o in example_build.build().items()
                                                  if (contract.EXAMPLE_DIR / f"{n}.json").read_text() != json.dumps(o, indent=1, ensure_ascii=False) + "\n"]


def test_the_carried_members_are_valid_research_pins_and_findings():
    for member, name in ((FACTS, "facts"), (FINDINGS, "findings")):
        schema = json.loads((RESEARCH / f"{name}.schema.json").read_text())
        jsonschema.Draft7Validator(schema).validate(member)


def test_the_run_follows_the_demo_flow():
    d = doc()
    assert [s["id"] for s in d["run"]["stages"]] == ["pick", "explore", "develop", "greenlight", "send"]
    assert len(d["crew"]) == 5 and {c["direction"] for c in d["crew"]} == set(contract.enum("direction")) - {"yours", "custom"}
    assert sum(len(e["routes"]) for e in d["expeditions"]) == len(d["territories"])
    assert {t["state"] for t in d["territories"]} == {"found", "developed"} and {t["status"] for t in d["territories"]} == {"live", "killed"}
    assert [g["territory_id"] for g in d["greenlit"]] == d["sends"][0]["territory_ids"]


# ------------------------------------------------------------ every id and shape the engine emits validates


def _shapes(d):
    f = d["focus"]
    yield "insight", f["insights"]
    yield "source_play", f["sources"]
    yield "crew_member", d["crew"]
    yield "expedition", d["expeditions"]
    yield "territory", d["territories"]
    yield "find", d["finds"]
    yield "journey", d["journey"]
    for k, kind in (("greenlit", "greenlit"), ("asks", "ask"), ("actions", "action"), ("lookups", "lookup"), ("notes", "note"), ("sends", "send")):
        yield kind, d[k]
    for t in d["territories"]:
        if "world" in t:
            yield "world", [t["world"]]
            yield "check", t["checks"]
            yield "picture", t["pictures"]
            yield "marks", [t["marks"]]
            yield "blind", [t["blind"]]
    yield "spread", [d["spread"]]
    yield "run", [d["run"]]


@pytest.mark.parametrize("name", NAMES)
def test_every_emitted_shape_validates_on_its_own(name):
    for kind, values in _shapes(doc(name)):
        assert contract.validate_all(kind, values) == [], kind


def test_every_id_kind_is_in_the_fixture_and_matches_its_pattern():
    d = doc()
    seen = {"insight": [i["id"] for i in d["focus"]["insights"]], "territory": [t["id"] for t in d["territories"]], "crew": [c["id"] for c in d["crew"]],
            "expedition": [e["id"] for e in d["expeditions"]], "check": [c["id"] for t in d["territories"] for c in t.get("checks", [])],
            "ask": [a["id"] for a in d["asks"]], "action": [a["id"] for a in d["actions"]], "lookup": [a["id"] for a in d["lookups"]],
            "note": [a["id"] for a in d["notes"]], "send": [a["id"] for a in d["sends"]], "find": [a["id"] for a in d["finds"]],
            "picture": [p["id"] for t in d["territories"] for p in t.get("pictures", [])],
            "fact": [f["id"] for f in FACTS["facts"]], "finding": [f["id"] for f in FINDINGS["findings"]]}
    assert set(seen) == set(contract.ID_KINDS())
    for kind, ids in seen.items():
        assert ids, kind
        rx = contract.pattern(contract.ID_KINDS()[kind])
        assert all(rx.match(i) for i in ids), kind


@pytest.mark.parametrize("kind", sorted(contract.ID_KINDS()))
def test_minted_ids_match_their_pattern_and_are_deterministic(kind):
    a, b = contract.mint(kind, "linea:1"), contract.mint(kind, "linea:1")
    assert a == b != contract.mint(kind, "linea:2")
    assert contract.pattern(contract.ID_KINDS()[kind]).match(a)


def test_a_minted_territory_validates_inside_a_document():
    d = doc("pick")
    d["crew"] = [doc()["crew"][0]]
    t = copy.deepcopy(doc()["territories"][-3])
    t["id"] = contract.mint("territory", "x")
    t["crew"] = "cr_core"
    t["distance"] = 0.2
    t["band"] = contract.band_of(0.2)
    t["evidence"] = []
    d["territories"] = [t]
    d["expeditions"] = []
    assert check(d) == []


def test_the_engines_vocabularies_are_the_schemas():
    assert tuple(contract.enum("tier")) == ladder.TIERS
    dims = set(contract.schema()["definitions"]["blind"]["properties"]["by_dimension"]["properties"])
    assert dims == set(ladder.SCORE_DIMS)
    assert contract.schema()["definitions"]["blind"]["properties"]["of"]["const"] == ladder.MAX_SCORE
    roles = Path(__file__).resolve().parents[3] / "app" / "templates" / "shared" / "agent-sphere" / "roles.js"
    keys = set(re.findall(r"^\s{4}(\w+): \{ name:", roles.read_text(), re.M))
    assert keys == set(contract.enum("agent_key"))
    inputs = pytest.importorskip("deck.inputs")
    assert list(contract.enum("brief_field")) == inputs.BRIEF_FIELDS


def test_a_territory_is_a_superset_of_the_deck_card_and_of_cards_py():
    props = contract.schema()["definitions"]["territory"]["properties"]
    required = set(contract.schema()["definitions"]["territory"]["required"])
    deck_keys = {"id", "name", "thought", "why", "mood", "references", "risks", "sketch"}
    assert deck_keys <= required
    sample = cards.card({"id": "t_x", "line": "L", "tier": "safe", "proposition_ok": True, "tension_text": "T", "proposition": "P"}, {"territories": []})
    # develop's blind /35 `score` is stored as `blind` (the contract doc says so); everything else carries over by name
    assert set(sample) - {"score"} <= set(props), set(sample) - set(props)
    assert "blind" in props and "score" not in props
    gate = json.loads((Path(__file__).resolve().parents[3] / "app/templates/deck-maker/schema.json").read_text())
    g2 = gate["properties"]["run"]["properties"]["gate"]["properties"]["territories"]["items"]["properties"]
    assert set(g2) - {"n"} <= set(props)       # a pick lands in Gate 2 without translation


# ------------------------------------------------------------ the host's refusals: tampered documents fail, in words


def test_limits_are_the_schemas_and_the_fixture_is_inside_them():
    assert contract.limit("territories") == 32 and contract.limit("expedition", "routes") == 4 and contract.limit("focus", "insights") == 25
    assert contract.limit("world", "lines") == 16 and contract.limit("run", "error", "refused") == 8
    assert contract.band_of(0.2) == "core" and contract.band_of(0.5) == "stretch" and contract.band_of(1.0) == "far_out"


def _tamper(fn):
    d = doc()
    fn(d)
    return check(d)


@pytest.mark.parametrize("label,fn,rule", [
    ("five routes under one heading", lambda d: d["expeditions"][0]["routes"].extend(d["expeditions"][0]["routes"] * 2), "maxItems"),
    ("17 lines in a world", lambda d: d["territories"][0]["world"].__setitem__("lines", [f"l{i}" for i in range(17)]), "maxItems"),
    ("an unknown id shape", lambda d: d["territories"][0].__setitem__("id", "T-1"), "pattern"),
    ("an unknown band", lambda d: d["territories"][0].__setitem__("band", "faraway"), "enum"),
    ("an unknown tier", lambda d: d["territories"][0].__setitem__("tier", "wild"), "enum"),
    ("an unlicensed font", lambda d: d["territories"][0]["world"]["type"].__setitem__("font", "fraunces"), "enum"),
    ("an unknown check kind", lambda d: d["territories"][0]["checks"][0].__setitem__("kind", "vibes"), "enum"),
    ("a missing required member", lambda d: d["territories"][0].pop("thought"), "required"),
    ("a member nobody knows", lambda d: d["territories"][0].__setitem__("zodiac", "leo"), "additionalProperties"),
    ("a bad cite shape", lambda d: d["territories"][0]["evidence"].append("fact 12"), "pattern"),
    ("a too-long name", lambda d: d["territories"][0].__setitem__("name", "x" * 81), "maxLength"),
    ("a developed route without its world", lambda d: d["territories"][0].pop("world"), "required"),
    ("a killed route without its reason", lambda d: d["territories"][-1].pop("kill_reason"), "required"),
    ("a frame without its hash", lambda d: d["territories"][0]["pictures"].append({"id": "pic_x1", "touchpoint": "tv", "kind": "frame", "image": "a.png", "rights": "licensed"}), "required"),
    ("a picture gap without a reason", lambda d: d["territories"][0]["pictures"].append({"id": "pic_x2", "touchpoint": "tv", "kind": "gap"}), "required"),
    ("a price member", lambda d: d["run"].__setitem__("cost_usd", 1.2), "additionalProperties"),
    ("an old schema version", lambda d: d.__setitem__("schema_version", 2), "const"),
])
def test_tampered_documents_are_refused(label, fn, rule):
    assert rule in rules(_tamper(fn)), label


@pytest.mark.parametrize("label,fn,rule", [
    ("a missing cite: the route cites a pin nobody carries", lambda d: d["territories"][0]["evidence"].append("f_NOSUCH0001"), "cite"),
    ("a brief field the upstream brief does not hold", lambda d: d["upstream"].clear(), "cite"),
    ("a route whose band disagrees with its distance", lambda d: d["territories"][0].__setitem__("band", "far_out"), "band"),
    ("a route under a crew member who does not exist", lambda d: d["territories"][0].__setitem__("crew", "cr_nobody"), "ref"),
    ("a trail ending in a route that does not exist", lambda d: d["expeditions"][0]["routes"].__setitem__(0, {"territory_id": "t_ghost", "distance": 0.1}), "ref"),
    ("two routes with one id", lambda d: d["territories"][1].__setitem__("id", d["territories"][0]["id"]), "unique"),
    ("unreadable text on a palette", lambda d: d["territories"][0]["world"]["palette"].__setitem__("ink", "#F5F0E0"), "contrast"),
    ("greenlighting a route that is only found", lambda d: d["greenlit"].append({"territory_id": "t_breakfast", "by": "Shrey", "at": "2026-11-18T10:05:00Z", "rests_on_derived": [], "derived_resolution": "verified"}), "state"),
    ("a derived finding the greenlight does not list", lambda d: d["greenlit"][2].__setitem__("rests_on_derived", []), "derived"),
    ("a sent route that was never greenlit", lambda d: d["sends"][0]["territory_ids"].append("t_small"), "ref"),
    ("the same picture in two slots", lambda d: d["territories"][0]["pictures"].extend([{"id": "pic_d1", "touchpoint": "tv", "kind": "frame", "image": "a.png", "sha256": "a" * 64, "rights": "licensed"}, {"id": "pic_d2", "touchpoint": "tv", "kind": "frame", "image": "b.png", "sha256": "a" * 64, "rights": "licensed"}]), "dup_picture"),
    ("a failed run that does not say why", lambda d: d["run"].update({"state": "failed", "gate": None}), "error"),
    ("a done run with a gate still open", lambda d: d["run"].update({"gate": {"id": "pick", "n": 1, "of": 2}}), "state"),
])
def test_rules_a_schema_cannot_say_are_checked(label, fn, rule):
    assert rule in rules(_tamper(fn)), label


def test_a_tampered_document_is_a_failure_not_a_skip():
    d = doc()
    d["territories"][0]["band"] = "faraway"
    with pytest.raises(contract.ContractError) as e:
        contract.validate(d)
    assert e.value.words and e.value.problems[0].path.startswith("territories[0]")


# ------------------------------------------------------------ gates (LESSONS 11): every blocked state is representable and held


def test_sending_past_a_pending_derived_finding_is_refused():
    d = doc("greenlight_derived_pending")
    d["sends"] = [{"id": "snd_tamper", "to": "deck-maker", "territory_ids": ["t_started"], "not_chosen": [], "by": "Shrey", "at": "2026-11-18T10:20:00Z", "status": "sent"}]
    assert "gate" in rules(check(d))


def test_sending_past_a_missing_sensitive_review_is_refused():
    d = doc("greenlight_sensitive_missing")
    d["sends"] = [{"id": "snd_tamper", "to": "deck-maker", "territory_ids": ["t_started"], "not_chosen": [], "by": "Shrey", "at": "2026-11-18T10:20:00Z", "status": "sent"}]
    assert "gate" in rules(check(d))


def test_a_gate_must_say_what_blocks_it():
    d = doc("greenlight_derived_pending")
    d["run"]["gate"]["blocked_by"] = []
    assert "gate" in rules(check(d))
    d = doc("greenlight_sensitive_missing")
    d["run"]["gate"]["blocked_by"] = []
    assert "gate" in rules(check(d))


def test_blocked_states_carry_the_question_for_the_booth():
    assert doc("greenlight_derived_pending")["asks"][0]["kind"] == "derived_evidence"
    assert doc("greenlight_sensitive_missing")["asks"][0]["kind"] == "sensitive_review"
    assert doc("greenlight_open")["run"]["gate"]["blocked_by"][0]["kind"] == "nothing_picked"


# ------------------------------------------------------------ a host refusal reaches run.error in words (done_when 4)


def test_a_refusal_is_carried_into_run_error_in_words():
    d = doc("greenlight_open")
    d["territories"][0]["world"]["lines"] = [f"Line {i}" for i in range(17)]
    d["territories"][1]["id"] = "T-2"
    ps = contract.problems(d)
    err = contract.refusal_error(ps, "develop")
    assert err["retryable"] is True and err["stage"] == "develop" and len(err["refused"]) == 2
    text = " ".join([err["message"], *err["refused"]])
    assert "17 lines" in text and "the most allowed is 16" in text and "does not recognise" in text
    for raw in ("None", "null", "pattern", "maxItems", "additionalProperties", "$ref", "[", "world", "id_territory", "T-2"):
        assert raw not in text, raw
    failed = doc("failed_refused")
    assert failed["run"]["state"] == "failed" and failed["run"]["error"]["refused"]
    contract.validate(failed)                                            # the failed run is itself a valid document


def test_refusals_are_capped_to_the_schemas_own_limit():
    d = doc()
    for t in d["territories"]:
        t["id"] = "BAD"
    err = contract.refusal_error(contract.problems(d))
    assert len(err["refused"]) <= contract.limit("run", "error", "refused")


# ------------------------------------------------------------ text leaks and prices (LESSONS 15, 19)


@pytest.mark.parametrize("leak", ["Fits the brief (to confirm)", "~~struck~~ line", "The field is null", "**bold** line", "None", "{{name}}", "# Heading"])
def test_text_leaks_fail(leak):
    d = doc()
    d["territories"][0]["thought"] = leak
    assert "leak" in rules(check(d))


def test_prose_that_merely_contains_none_is_fine():
    d = doc()
    d["territories"][0]["thought"] = "None of that is your problem."
    assert check(d) == []


def test_prices_are_not_welcome_outside_the_history():
    d = doc()
    d["notes"][0]["cost_usd"] = 0.5
    assert "price" in rules(contract.lint(d))


def test_upstream_is_carried_not_linted():
    d = doc()
    d["upstream"]["5b0d3a7e-4c1f-4e2a-9a55-1d6c0f2b7e11"]["budget_scope"] = "Fixed price of 20k"
    assert check(d) == []


# ------------------------------------------------------------ additive only (LESSONS: a contract we will have to break)


def test_the_lock_matches_the_schema():
    assert contract.lock_problems() == []


def test_the_lock_catches_a_removed_or_retyped_member(monkeypatch):
    s = copy.deepcopy(contract.schema())
    del s["definitions"]["territory"]["properties"]["thought"]
    s["definitions"]["territory"]["properties"]["distance"] = {"type": "string"}
    s["definitions"]["band"]["enum"].remove("far_out")
    s["definitions"]["territory"]["required"].append("mood2")
    monkeypatch.setattr(contract, "schema", lambda: s)
    msgs = " ".join(contract.lock_problems())
    assert "removed: territories[].thought" in msgs and "retyped: territories[].distance" in msgs
    assert "enum value dropped: territories[].band" in msgs and "newly required" in msgs


def test_a_new_optional_member_is_allowed(monkeypatch):
    s = copy.deepcopy(contract.schema())
    s["definitions"]["territory"]["properties"]["landscape"] = {"type": "object"}
    monkeypatch.setattr(contract, "schema", lambda: s)
    assert contract.lock_problems() == []


# ------------------------------------------------------------ the upstream arrives and is read (LESSONS 7)


def test_every_brief_field_cited_is_held_by_the_carried_brief():
    d = doc()
    cited = {c for t in d["territories"] for c in t["evidence"]} | {c for i in d["focus"]["insights"] for c in i["evidence"]}
    cited |= {w["cite"] for e in d["expeditions"] for w in e["way"] if w.get("cite")}
    brief = next(iter(d["upstream"].values()))
    fields = {c.split(":", 1)[1] for c in cited if c.startswith("brief:")}
    assert fields and all(brief.get(f) for f in fields)
    # and every carried pin or finding that a claim cites is in the carried members
    ids = {f["id"] for f in FACTS["facts"]} | {f["id"] for f in FINDINGS["findings"]}
    assert {c for c in cited if c.startswith(("f_", "fi_"))} <= ids
