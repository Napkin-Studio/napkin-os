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
        "tensions": {"tensions": [{"id": "t1", "x_but_y": "invented one, but", "evidence": "invented"},
                                  {"id": "t2", "x_but_y": "observed one, but", "evidence": "observed"},
                                  {"id": "t3", "x_but_y": "generic, but", "evidence": "observed", "swap_test": "fail"}]},
        "seeds": {"seeds": [
            {"id": "s1", "line": "the last decision at the table", "tension": "t2", "mechanism": "elevating an overlooked ritual"},
            {"id": "s2", "line": "the last decision at the table again", "tension": "t2", "mechanism": "elevating an overlooked ritual"},
            {"id": "s3", "line": "sauce as a dare", "tension": "t1", "mechanism": "dare"},
            {"id": "s4", "line": "heritage told honestly", "tension": "t2", "mechanism": "plain honesty"},
            {"id": "s5", "line": "a thing", "tension": "t1", "mechanism": "vague"}]},
        "kill": {"verdicts": [{"id": "s1", "keep": True, "strength": 4}, {"id": "s3", "keep": True, "strength": 4}, {"id": "s4", "keep": True, "strength": 3},
                              {"id": "s5", "keep": False, "strength": 1, "tests": {"say_it_out_loud": {"fails": True, "reason": "'a thing' says nothing"}}}]},
        "sort": {"tiers": [{"id": "s1", "tier": "stretch", "reason": "a sharper door", "group": "ritual"}, {"id": "s3", "tier": "Brave", "reason": "the dare is the format", "group": "dare"},
                           {"id": "s4", "tier": "safe", "reason": "answers the brief as written", "group": "honesty"}]},
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
    assert intake.tag_field({"value": ["To confirm: pack shot", "x"], "kind": "brief-maker"}) == "inferred"
    assert intake.tag_field({"value": {"do": "To confirm: buy a jar"}, "kind": "brief-maker"}) == "inferred"
    assert intake.tag_field({"value": ["plain", "list"], "kind": "brief-maker"}) == "given"
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

def test_ladder_tiers_and_score():
    assert ladder.clean_tier("Brave") == ("brave", False) and ladder.clean_tier(" SAFE ") == ("safe", False)
    assert ladder.clean_tier("wild") == ("stretch", True) and ladder.clean_tier(None) == ("stretch", True)
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
    assert c["estimated"] and c["calls"] == 8 and c["est_usd"] > 0
    assert cost.estimate(baseline=False)["calls"] == 7 and "total" in cost.render(c)


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
    assert llm.calls == ["assumed_brief", "tensions", "seeds", "kill", "sort", "score", "propositions"]
    assert "conventions" not in res and res["status"] == "proceed" and res["coverage"] == {"n": 5, "label": "thin: treat as anecdote"}
    # a wrong tag becomes assumed; only the top three questions are kept
    assert {f["key"]: f["tag"] for f in res["assumed_brief"]["fields"]}["budget_scope"] == "assumed" and len(res["client_questions"]) == 3
    # swap-test failures are dropped, invented tensions sort last
    assert [t["id"] for t in res["tensions"]] == ["t2", "t1"]
    # s2 duplicates s1 and is clustered away; the kill gate then drops s5 with its reasons
    assert res["diversity"]["seeds_made"] == 5 and res["diversity"]["kept_after_clustering"] == 4
    kg = res["kill_gate"]
    assert kg["seeds_in"] == 4 and kg["survivors"] == 3 and [k["id"] for k in kg["killed"]] == ["s5"] and kg["restored"] == []
    assert kg["killed"][0]["kill_gate"]["tests"]["say_it_out_loud"]["fails"] is True
    ids = [t["id"] for t in res["territories"]]
    t = {x["id"]: x for x in res["territories"]}
    assert ids == ["s1", "s3", "s4"] and "s5" not in ids and res["spread_ok"]
    # the sort happens after the kill gate, by definition; tier text is cleaned
    assert t["s3"]["tier"] == "brave" and t["s1"]["tier"] == "stretch" and t["s4"]["tier"] == "safe" and not t["s1"]["tier_defaulted"]
    assert t["s1"]["score"]["total"] == 27 and t["s1"]["score"]["advisory"] is True
    # propositions: the one-thought rule picks the first valid wording; none valid is flagged
    assert t["s1"]["proposition"] == "The part you tell friends about" and t["s1"]["proposition_ok"]
    assert t["s3"]["proposition"] is None and not t["s3"]["proposition_ok"] and t["s3"]["proposition_problems"]
    assert t["s3"]["assumption_dependent"] and not t["s3"]["ready"] and t["s1"]["tension_evidence"] == "observed"
    # proof prefers a case from another category and is always UNVERIFIED until a person verifies
    assert t["s1"]["proof"]["id"] == "k4" and t["s1"]["proof"]["badge"] == "UNVERIFIED" and "mechanism, not the execution" in t["s1"]["proof"]["note"]


def test_kill_gate_runs_before_the_sort_and_the_sort_never_sees_killed_seeds():
    seen = {}
    o = outputs()
    o["sort"] = lambda user: (seen.setdefault("user", user), outputs()["sort"])[1]
    pipeline.run(task(), FakeLLM(o), precedent)
    assert "s5" not in seen["user"] and "s1" in seen["user"]


def test_kill_gate_keeps_an_unjudged_seed_and_flags_it():
    o = outputs()
    o["kill"] = {"verdicts": [{"id": "s1", "keep": True, "strength": 4}]}          # s3, s4, s5 not judged
    res = pipeline.run(task(), FakeLLM(o), precedent)
    assert res["kill_gate"]["killed"] == [] and res["kill_gate"]["survivors"] == 4
    assert {x["id"]: x["kill_gate"]["judged"] for x in res["territories"]}["s4"] is False


def test_kill_gate_restores_the_strongest_to_reach_three():
    o = outputs()
    o["kill"] = {"verdicts": [{"id": "s1", "keep": False, "strength": 2}, {"id": "s3", "keep": False, "strength": 5},
                              {"id": "s4", "keep": False, "strength": 4}, {"id": "s5", "keep": False, "strength": 1}]}
    res = pipeline.run(task(), FakeLLM(o), precedent)
    assert set(res["kill_gate"]["restored"]) == {"s3", "s4", "s1"} and [k["id"] for k in res["kill_gate"]["killed"]] == ["s5"]
    assert all(x["kill_gate"].get("restored") for x in res["territories"])


def test_unknown_tier_defaults_to_stretch_and_is_flagged():
    o = outputs()
    o["sort"] = {"tiers": [{"id": "s1", "tier": "medium"}]}
    t = {x["id"]: x for x in pipeline.run(task(), FakeLLM(o), precedent)["territories"]}
    assert t["s1"]["tier"] == "stretch" and t["s1"]["tier_defaulted"] is True
    assert any("tier unclear" in r for r in cards.card(t["s1"], {})["risks"])


def test_scorer_is_blind_to_tier():
    seen = {}
    o = outputs()
    o["score"] = lambda user: (seen.setdefault("user", user), outputs()["score"])[1]
    pipeline.run(task(), FakeLLM(o), precedent)
    assert "tier" not in seen["user"]


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


def test_blind_pack_sets_are_the_same_size_and_keep_the_best_pipeline_cards():
    pipe = [{"name": f"p{i}", "thought": f"t{i}", "why": "w", "score": {"total": s}} for i, s in enumerate([20, 30, 25, 28, 10])]
    base = [{"name": f"b{i}", "thought": f"u{i}", "why": "w"} for i in range(3)]
    pack, key = compare.blind_pack(pipe, base, seed=5)
    assert [len(v) for v in pack.values()] == [3, 3]
    kept = pack[next(s for s, arm in key.items() if arm == "pipeline")]
    assert sorted(c["line"] for c in kept) == ["p1", "p2", "p3"]   # scores 30, 25, 28: the top three


def test_pack_seed_varies_by_brief_so_the_plain_prompt_is_not_always_set_a():
    base = [{"name": "b", "thought": "u", "why": "w"}]
    pipe = [{"name": "p", "thought": "t", "why": "w", "score": {"total": 1}}]
    firsts = {compare.blind_pack(pipe, base, seed=compare.pack_seed("brief", i))[1]["Set A"] for i in range(12)}
    assert firsts == {"pipeline", "plain_prompt"}
    assert compare.pack_seed("x", "IE") == compare.pack_seed("x", "IE")


def test_choice_spreads_over_tensions_and_relaxes_only_to_reach_three():
    kept = [{"id": f"s{i}", "line": f"l{i}", "tension": ten, "mechanism": f"m{i}", "tier": "stretch", "breaks": ["c1"]}
            for i, ten in enumerate(["t1", "t1", "t1", "t2", "t3"])]
    scores = {f"s{i}": {d: 5 - i for d in ladder.SCORE_DIMS} for i in range(5)}
    chosen = pipeline._choose(kept, scores, max_keep=5)
    assert [s["tension"] for s in chosen] == ["t1", "t2", "t3"]          # one per tension: s0, s3, s4
    only_one = [{**k, "tension": "t1"} for k in kept]
    assert len(pipeline._choose(only_one, scores, max_keep=5)) == 3      # relaxed to reach three, mechanisms still distinct
    same_mech = [{**k, "tension": "t1", "mechanism": "m"} for k in kept]
    assert len(pipeline._choose(same_mech, scores, max_keep=5)) == 1     # the mechanism rule is never relaxed


def test_seed_prompt_asks_for_a_safe_quarter_and_spread_and_has_no_conventions():
    from territory.llm import prompt
    p = prompt("seeds")
    assert "quarter" in p and "Safe" in p and "different tensions" in p and "convention" not in p.lower()
    assert "kill gate" in prompt("kill_gate").lower() and "safe: answers the brief as written" in prompt("sort")


def test_cost_card_is_calibrated_to_the_measured_run():
    assert 0.65 <= cost.estimate()["est_usd"] <= 0.85


def _cand(i, tier, group, tension="t1", mech=None, total=5):
    return {"id": f"s{i}", "line": f"l{i}", "tension": tension, "mechanism": mech or f"m{i}", "tier": tier, "group": group}, {d: total for d in ladder.SCORE_DIMS}


def _choose(rows, **kw):
    kept = [r[0] for r in rows]
    return pipeline._choose(kept, {r[0]["id"]: r[1] for r in rows}, **kw)


def test_versions_of_one_idea_never_both_survive():
    rows = [_cand(1, "stretch", "not-bad-enough", "t1", total=5), _cand(2, "stretch", "not-bad-enough", "t2", total=4),
            _cand(3, "safe", "weather", "t3", total=3), _cand(4, "brave", "pass-it-on", "t4", total=2)]
    chosen = _choose(rows, max_keep=5)
    assert sorted(s["id"] for s in chosen) == ["s1", "s3", "s4"]            # s2 is a version of s1
    assert "not-bad-enough" not in [s["group"] for s in chosen if s["id"] == "s2"]


def test_the_ladder_is_covered_by_replacing_only_a_repeated_tier():
    rows = [_cand(1, "stretch", "a", "t1", total=5), _cand(2, "stretch", "b", "t2", total=4), _cand(3, "stretch", "c", "t3", total=3),
            _cand(4, "safe", "d", "t4", total=2), _cand(5, "brave", "e", "t5", total=2)]
    chosen = _choose(rows, max_keep=3)
    assert {s["tier"] for s in chosen} == {"safe", "stretch", "brave"} and len(chosen) == 3
    assert sorted(s["id"] for s in chosen) == ["s1", "s4", "s5"]            # the best Stretch stays; the weaker repeat makes room
    only = [_cand(1, "stretch", "a", "t1"), _cand(2, "stretch", "b", "t2"), _cand(3, "stretch", "c", "t3")]
    assert {s["tier"] for s in _choose(only, max_keep=3)} == {"stretch"}      # nothing to cover with: no invention


def test_sort_prompt_asks_for_group_labels_and_seeds_for_a_brave_quarter():
    from territory.llm import prompt
    assert '"group"' in prompt("sort") and "versions of one idea" in prompt("sort")
    assert "Brave routes that change the shape" in prompt("seeds")


def test_end_to_end_result_carries_the_group_and_drops_a_variant():
    o = outputs()
    o["sort"]["tiers"][0]["group"] = "dare"                                   # s1 now a version of s3's idea
    ids = [t["id"] for t in pipeline.run(task(), FakeLLM(o), precedent)["territories"]]
    assert ids.count("s1") + ids.count("s3") == 1 and "s4" in ids
