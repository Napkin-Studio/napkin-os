"""Offline tests for the Territory slice. No model call: a FakeLLM replays recorded outputs. Every brand and case is invented.
Run from ``engine/``: ``PYTHONPATH=. python3 -m pytest -q territory/tests``."""
from __future__ import annotations

import json

import pytest

from territory import cards, compare, cost, diversity, intake, ladder, pipeline
from territory.llm import FakeLLM, LiveLLM

FIELDS = {"background": {"value": "Sales flat", "kind": "client_stated"}, "audience": {"value": "Under-35s", "kind": "client_stated"},
          "insight": {"value": "They never think about it", "kind": "inferred", "mark": "To confirm"}}
CASES = [{"id": f"k{i}", "brand": f"Brand{i}", "title": f"Case {i}", "year": 2024, "category": "food_drink" if i < 3 else "retail",
          "summary": "elevating an overlooked ritual" if i == 4 else "a family table and heritage", "source_url": f"https://example.org/{i}"} for i in range(1, 6)]


def task(**kw):
    t = {"fields": FIELDS, "category": "condiments", "market": "IE", "prompt": "a brief"}
    t.update(kw)
    return t


def outputs():
    return {
        "assumed_brief": {"fields": [{"key": "audience", "value": "under-35s", "tag": "given"}, {"key": "budget_scope", "value": "TBC", "tag": "wrong-tag"}],
                          "diagnosis": "d", "audiences": ["a"], "questions": [{"question": f"q{i}", "why": "w"} for i in range(5)]},
        "conventions": {"conventions": [{"id": "c1", "convention": "family table", "cases": ["k1", "k2", "k3", "nope"]},
                                        {"id": "c2", "convention": "red hero shot", "cases": ["k1", "k2"]},
                                        {"id": "c3", "convention": "heritage claims", "cases": ["k2", "k3", "k5"]}]},
        "tensions": {"tensions": [{"id": "t1", "x_but_y": "invented one, but", "evidence": "invented"},
                                  {"id": "t2", "x_but_y": "observed one, but", "evidence": "observed"},
                                  {"id": "t3", "x_but_y": "generic, but", "evidence": "observed", "swap_test": "fail"}]},
        "seeds": {"seeds": [
            {"id": "s1", "line": "the last decision at the table", "tension": "t2", "mechanism": "elevating an overlooked ritual", "breaks": ["c1"]},
            {"id": "s2", "line": "the last decision at the table again", "tension": "t2", "mechanism": "elevating an overlooked ritual", "breaks": ["c1"]},
            {"id": "s3", "line": "sauce as a dare", "tension": "t1", "mechanism": "dare", "breaks": ["c1", "c3", "ghost"]},
            {"id": "s4", "line": "heritage told honestly", "tension": "t2", "mechanism": "plain honesty", "breaks": []}]},
        "score": {"scores": [{"id": "s1", "fit": 5, "truth": 5, "ownability": 4, "distinct": 3, "travel": 4, "fame": 3, "assets": 3},
                             {"id": "s3", "fit": 3, "truth": 3, "ownability": 4, "distinct": 5, "travel": 3, "fame": 4, "assets": 3},
                             {"id": "s4", "fit": 4, "truth": 4, "ownability": 2, "distinct": 1, "travel": 4, "fame": 2, "assets": 2}]},
        "propositions": {"propositions": [{"id": "s1", "wordings": ["Choose the sauce and the meal", "The part you tell friends about"], "would_have_to_be_true": ["they cook weekly"], "cheapest_test": "ask 20 shoppers"},
                                          {"id": "s3", "wordings": ["x " * 25], "would_have_to_be_true": [], "cheapest_test": "t"},
                                          {"id": "s4", "wordings": ["Honest from the jar"]}]},
        "baseline": {"territories": [{"id": "b1", "name": "Plain one", "thought": "x", "why": "y", "mood": "m", "references": [], "risks": [], "sketch": "s"}]},
    }


def precedent(cat, market):
    return CASES


# ---------------------------------------------------------------- intake

def test_tag_field_and_thinness():
    assert intake.tag_field({"value": "x", "kind": "client_stated"}) == "given"
    assert intake.tag_field({"value": "x", "kind": "inferred"}) == "inferred"
    assert intake.tag_field({"value": "x", "mark": "To confirm"}) == "inferred"
    assert intake.tag_field({"value": ""}) == "missing" and intake.tag_field(None) == "missing"
    th = intake.thinness({})
    assert th["score"] == 1.0 and len(th["missing"]) == len(intake.BRIEF_FIELDS)
    assert intake.thinness({k: {"value": "v", "kind": "client_stated"} for k in intake.BRIEF_FIELDS})["score"] == 0.0


@pytest.mark.parametrize("kw, action", [
    (dict(fields=FIELDS, category="c", market="IE"), "proceed"),
    (dict(fields=FIELDS, category=None, market="IE"), "confirm"),
    (dict(fields=FIELDS, category="c", market=None), "confirm"),
    (dict(fields={}, prompt="make me a sauce brief"), "confirm"),
    (dict(fields={}, brand="Ballymaloe"), "confirm"),
    (dict(fields={}), "ask"),
    (dict(fields={}, asked=True), "refuse"),
])
def test_zero_input_tree(kw, action):
    assert intake.assess(**kw)["action"] == action


def test_assumed_audience_marks_assumption_dependent():
    assert intake.assess({}, "c", "IE")["assumption_dependent"] is True
    full = {k: {"value": "v", "kind": "client_stated"} for k in intake.BRIEF_FIELDS}
    assert intake.assess(full, "c", "IE")["assumption_dependent"] is False


# ---------------------------------------------------------------- ladder, diversity, cost

def test_ladder_rule_and_score():
    assert [ladder.tier(b) for b in ([], ["a"], ["a", "b"], ["a", "a"])] == ["safe", "stretch", "brave", "stretch"]
    assert ladder.total({d: 5 for d in ladder.SCORE_DIMS}) == 35
    assert ladder.total({}) == 7 and ladder.total({"fit": 99, "truth": 0, "ownability": "x"}) == 5 + 1 + 1 + 4
    assert not ladder.spread_ok([{"mechanism": "Dare"}, {"mechanism": "dare "}]) and ladder.spread_ok([{"mechanism": "a"}, {"mechanism": "b"}])


def test_proposition_rule():
    assert ladder.proposition_ok("Honest from the jar")[0]
    ok, why = ladder.proposition_ok("Fast and cheap")
    assert not ok and "and" in why[0]
    assert not ladder.proposition_ok("w " * 21)[0] and not ladder.proposition_ok("")[0]


def test_seed_recipes_are_distinct_and_deterministic():
    r = diversity.seed_recipes(30)
    assert len(r) == 30 and len({(x["framing"], x["inversion"], x["analogy"], x["constraint"]) for x in r}) == 30
    assert r == diversity.seed_recipes(30)


def test_keep_one_per_cluster():
    items = [{"line": "last decision at the table", "mechanism": "ritual"}, {"line": "the last decision at the table", "mechanism": "ritual"},
             {"line": "sauce as a dare", "mechanism": "dare"}]
    kept, dropped = diversity.keep_one_per_cluster(items)
    assert len(kept) == 2 and len(dropped) == 1 and diversity.duplicate_rate(kept, dropped) == 0.33


def test_cost_card_is_flagged_as_an_estimate():
    c = cost.estimate()
    assert c["estimated"] and c["calls"] == 7 and c["est_usd"] > 0
    assert cost.estimate(baseline=False)["calls"] == 6 and "total" in cost.render(c)


def test_live_llm_refuses_without_approval():
    with pytest.raises(PermissionError):
        LiveLLM()


# ---------------------------------------------------------------- pipeline

def test_gate_refusal_makes_no_model_call():
    llm = FakeLLM(outputs())
    res = pipeline.run({"fields": {}, "category": None, "market": None}, llm)
    assert res["status"] == "ask" and llm.calls == [] and res["territories"] == []
    assert "No territories produced" in cards.render_text(pipeline.run({"fields": {}, "asked": True}, llm))


def test_pipeline_end_to_end():
    llm = FakeLLM(outputs())
    res = pipeline.run(task(), llm, precedent)
    assert llm.calls == ["assumed_brief", "conventions", "tensions", "seeds", "score", "propositions"]
    assert res["status"] == "proceed" and res["coverage"] == {"n": 5, "label": "thin: treat as anecdote"}
    # a wrong tag becomes assumed; only the top three questions are kept
    assert {f["key"]: f["tag"] for f in res["assumed_brief"]["fields"]}["budget_scope"] == "assumed" and len(res["client_questions"]) == 3
    # a convention needs three listed cases: unknown ids are dropped, two cases is not enough
    c = {x["id"]: x for x in res["conventions"]}
    assert c["c1"]["cases"] == ["k1", "k2", "k3"] and c["c1"]["evidence"] == "cases"
    assert c["c2"]["evidence"] == "inferred" and c["c2"]["cases"] == []
    assert all("not dominant in the market" in x["caveat"] for x in res["conventions"])
    # swap-test failures are dropped, invented tensions sort last
    assert [t["id"] for t in res["tensions"]] == ["t2", "t1"]
    # s2 duplicates s1 and is clustered away; unknown convention ids are dropped before the tier is set
    ids = [t["id"] for t in res["territories"]]
    assert "s2" not in ids and res["diversity"]["kept_after_clustering"] == 3 and res["diversity"]["seeds_made"] == 4
    t = {x["id"]: x for x in res["territories"]}
    assert t["s3"]["breaks"] == ["c1", "c3"] and t["s3"]["tier"] == "brave" and t["s1"]["tier"] == "stretch" and t["s4"]["tier"] == "safe"
    assert ids == ["s1", "s3", "s4"] and res["spread_ok"]
    assert t["s1"]["score"]["total"] == 27 and t["s1"]["score"]["advisory"] is True
    # propositions: the one-thought rule picks the first valid wording; none valid is flagged
    assert t["s1"]["proposition"] == "The part you tell friends about" and t["s1"]["proposition_ok"]
    assert t["s3"]["proposition"] is None and not t["s3"]["proposition_ok"] and t["s3"]["proposition_problems"]
    # the brief's audience is given but the insight is inferred and tensions can be invented: assumption-dependent is per territory
    assert t["s3"]["assumption_dependent"] and not t["s3"]["ready"]
    assert t["s1"]["tension_evidence"] == "observed"
    # proof prefers a case from another category and is always UNVERIFIED until a person verifies
    assert t["s1"]["proof"]["id"] == "k4" and t["s1"]["proof"]["badge"] == "UNVERIFIED" and "mechanism, not the execution" in t["s1"]["proof"]["note"]


def test_scorer_is_blind_to_tier():
    seen = {}
    o = outputs()
    o["score"] = lambda user: (seen.setdefault("user", user), outputs()["score"])[1]
    pipeline.run(task(), FakeLLM(o), precedent)
    assert "tier" not in seen["user"] and "breaks" not in seen["user"]


def test_one_safe_territory_is_kept_when_one_exists():
    o = outputs()
    o["score"]["scores"] = [{"id": "s1", "fit": 5, "truth": 5, "ownability": 5, "distinct": 5, "travel": 5, "fame": 5, "assets": 5},
                            {"id": "s3", "fit": 5, "truth": 5, "ownability": 5, "distinct": 5, "travel": 5, "fame": 5, "assets": 4},
                            {"id": "s4", "fit": 1, "truth": 1, "ownability": 1, "distinct": 1, "travel": 1, "fame": 1, "assets": 1}]
    res = pipeline.run(task(), FakeLLM(o), precedent, max_keep=2)
    assert any(t["tier"] == "safe" for t in res["territories"]) and len(res["territories"]) == 2


def test_no_precedent_means_no_proof_and_an_empty_coverage_label():
    res = pipeline.run(task(), FakeLLM(outputs()))
    assert res["coverage"]["label"] == "empty" and all(t["proof"] is None for t in res["territories"])


def test_banner_when_the_brief_is_assumed():
    res = pipeline.run(task(fields={}), FakeLLM(outputs()), precedent)
    assert "assumed brief" in res["banner"] and not any(t["ready"] for t in res["territories"])


# ---------------------------------------------------------------- cards and the baseline arm

def test_cards_use_deck_maker_keys_and_extra_fields():
    res = pipeline.run(task(), FakeLLM(outputs()), precedent)
    cs = cards.cards(res)
    for c in cs:
        assert {"id", "name", "thought", "why", "mood", "references", "risks", "sketch", "tension", "tier", "assumes", "score", "proof_cases", "vote"} <= set(c)
        assert c["vote"] is None
    assert any("UNVERIFIED" in r for c in cs for r in c["references"])
    assert "[STRETCH]" in cards.render_text(res) and "Ask the client" in cards.render_text(res)


def test_blind_pack_hides_the_arm_and_keeps_a_key():
    res = pipeline.run(task(), FakeLLM(outputs()), precedent)
    base = compare.baseline(task(), FakeLLM(outputs()))
    pack, key = compare.blind_pack(cards.cards(res), base, seed=3)
    assert set(pack) == {"Set A", "Set B"} and sorted(key.values()) == ["pipeline", "plain_prompt"]
    text = json.dumps(pack)
    assert "tier" not in text and "UNVERIFIED" not in text and "score" not in text
    assert compare.blind_pack(cards.cards(res), base, seed=3)[1] == key
