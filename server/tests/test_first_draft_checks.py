"""First-draft checks (feature brief-first-draft-checks, ADR 0035): what code measures, the marking of
assumptions, and Jude given the planning skill's tests on a first draft."""

from napkin.brief import checks
from napkin.brief.fields import RUBRIC_FIELDS

from conftest import Server
from test_brief import Host, retrieval, run
from test_planned_brief import THIN, planned_model

W = lambda n: " ".join(f"w{i}" for i in range(n))


def e(value, basis="assumption"):
    return {"value": value, "basis": basis}


def test_code_measures_words_sentences_and_a_standalone_and():
    f = checks.facts({"single_minded_proposition": e("Fast and cheap."), "job": e("One. Two."), "audience": e(W(100)),
                      "insight": e("An insight."), "reasons_to_believe": e(["a", "b"])})
    assert f["single_minded_proposition"] == {"words": 3, "limit": 20, "sentences": 1, "standalone_and": True}
    assert f["job"]["sentences"] == 2 and f["audience"] == {"words": 100, "limit": 80}
    assert f["reasons_to_believe"] == {"items": 2, "max_items": 3}, "the skill keeps the two or three that matter"
    assert checks.facts({"single_minded_proposition": e("Tea you tried.")})["single_minded_proposition"]["standalone_and"] is False


def test_only_what_code_can_measure_is_sent_back_and_a_few_words_over_is_not():
    ok = checks.revisions({"audience": e(W(90)), "single_minded_proposition": e(W(20)), "job": e("A job.")})
    assert ok == [], "within the 15 percent margin (80 -> 92) and one sentence each"
    bad = checks.revisions({"audience": e(W(120)), "job": e("One. Two."), "objection": e("Why? Because. Really.")})
    assert [x["part"] for x in bad] == ["audience", "job", "objection"]
    assert "120 words and the limit is 80" in bad[0]["instruction"] and "at most 80 words" in bad[0]["instruction"]
    assert "2 sentences" in bad[1]["instruction"] and "a word or a phrase is fine" in bad[1]["instruction"]
    # a proposition may be a word or a phrase (Laurence, 3 Oct)
    assert checks.revisions({"single_minded_proposition": e("Guinness")}) == []


def test_the_skills_tests_go_to_jude_for_the_tested_parts_only():
    t = checks.tests(["insight", "single_minded_proposition", "job", "barrier", "objection", "audience", "background"])
    assert set(t) == {"insight", "single_minded_proposition", "job", "barrier", "objection"}
    assert "rings_true" in t["insight"] and "fresh" in t["insight"] and "single_minded" in t["single_minded_proposition"]
    assert "one_doubt" in t["objection"] and "one_change" in t["job"] and "in_their_heads" in t["barrier"]
    assert all(isinstance(x, str) and x for p in t.values() for x in p.values())
    assert "names_open_space" in {c["id"] for c in RUBRIC_FIELDS["competitor_context"]["rubric"]}


def test_an_assumption_says_it_is_one_and_the_proposition_and_objection_follow_the_insight():
    out = {"insight": e("People skip the small thing."), "single_minded_proposition": e("Tea you tried.", "library"),
           "objection": e("Not worth it.", "library"), "job": e("A job.", "client"), "background": e("Why now.", "client"),
           "reasons_to_believe": e(["a proof"]), "audience": e("To confirm: already marked")}
    marked = checks.mark_assumptions(out)
    assert out["insight"]["value"] == "To confirm: People skip the small thing."
    assert out["single_minded_proposition"]["value"] == "To confirm: Tea you tried.", "it rests on an assumed insight"
    assert out["objection"]["value"] == "To confirm: Not worth it."
    assert out["job"]["value"] == "A job." and out["background"]["value"] == "Why now.", "the client's words are theirs"
    assert out["reasons_to_believe"]["value"] == ["a proof"], "lists carry their own marks"
    assert out["audience"]["value"] == "To confirm: already marked"
    assert sorted(marked) == ["insight", "objection", "single_minded_proposition"]
    assert checks.mark_assumptions(out) == [], "idempotent: never To confirm: To confirm:"
    # a client's or a researched proposition does not take the mark from the insight
    keep = {"insight": e("Assumed."), "single_minded_proposition": e("Said by the client.", "client"), "objection": e("Researched.", "research")}
    checks.mark_assumptions(keep)
    assert keep["single_minded_proposition"]["value"] == "Said by the client." and keep["objection"]["value"] == "Researched."
    # the insight already held by the job can carry the inheritance when this output has none
    only = {"single_minded_proposition": e("A line.", "library")}
    checks.mark_assumptions(only, {"value": "To confirm: held insight", "basis": "assumption"})
    assert only["single_minded_proposition"]["value"] == "To confirm: A line."


def test_the_first_draft_goes_to_jude_with_the_tests_and_what_code_measured_and_the_long_parts_go_back(tmp_path):
    seen = {}
    m = planned_model(seen)
    orig = m.overrides["draft_brief_whole"]

    def draft(p):
        out = orig(p)
        out["single_minded_proposition"] = {"value": W(40), "basis": "assumption", "cites": [], "builds_on_client": False, "why": "x"}
        out["job"] = {"value": "Move them. Then move them again.", "basis": "assumption", "cites": [], "builds_on_client": False, "why": "x"}
        out["insight"] = {"value": "An assumed insight.", "basis": "assumption", "cites": [], "builds_on_client": False, "why": "x"}
        return out
    m.overrides["draft_brief_whole"] = draft
    s = Server(tmp_path, model=m, retrieval=retrieval(),
               settings_kw={"brief_flow": "planned", "brief_research_max": 2})
    try:
        host = Host()
        replies = run(s, host, inp={"prompt": THIN, "attachments": []})
    finally:
        s.stop()
    assert replies[-1]["job"]["state"] == "done"
    first = seen["reviews"][0]
    assert first["part_checks"]["single_minded_proposition"]["words"] > 20
    assert first["part_checks"]["job"]["sentences"] == 2
    assert set(first["tests"]) == set(checks.TESTED), "the seven parts the draft wrote carry their tests"
    assert first["part_checks"]["media_roles"] == {"items": 1, "max_items": 4, "words": 2, "limit": 55}
    assert first["part_checks"]["measurement"]["max_items"] == 5
    # what code can measure went back with Jude's own list, once, with the instruction that says why
    told = seen["rewrite"]["rewrite"]
    assert "single_minded_proposition" in told and "at most 20 words" in told["single_minded_proposition"]
    assert "job" in told and "2 sentences" in told["job"]
    # the draft's assumptions said so before Jude read them, the proposition following the insight
    brief = first["brief"]
    assert brief["insight"]["value"] == "To confirm: An assumed insight."
    assert brief["single_minded_proposition"]["value"].startswith("To confirm: ")


def test_more_than_three_reasons_to_believe_go_back_and_the_schema_says_three():
    assert RUBRIC_FIELDS["reasons_to_believe"]["max_items"] == 3
    five = checks.revisions({"reasons_to_believe": e(["a", "b", "c", "d", "e"])})
    assert [x["part"] for x in five] == ["reasons_to_believe"] and "keep the 3 strongest" in five[0]["instruction"]
    assert checks.revisions({"reasons_to_believe": e(["a", "b", "c"])}) == []
    for k in ("insight", "smp"):
        assert "plain_words" in {c["id"] for c in RUBRIC_FIELDS[k]["rubric"]}, "plain human language is the skill's second rule"
    assert "what the budget does not buy" in RUBRIC_FIELDS["budget_scope"]["prompt"]


def test_a_standalone_and_in_the_proposition_goes_back_with_the_other_measurable_faults():
    e = lambda v: {"value": v, "basis": "assumption"}
    out = checks.revisions({"single_minded_proposition": e("Easy and fresh.")})
    assert [x["part"] for x in out] == ["single_minded_proposition"]
    assert "'and'" in out[0]["instruction"]
    assert checks.revisions({"single_minded_proposition": e("Easy, fresh.")}) == []


def test_a_name_with_an_ampersand_is_not_an_and():
    e = lambda v: {"value": v, "basis": "assumption"}
    assert checks.revisions({"single_minded_proposition": e("Crust & Co makes your weekday morning yours.")}) == []
    assert checks.revisions({"single_minded_proposition": e("Fresh & easy.")})  # lower case: still two thoughts


def test_the_names_a_brief_is_filed_under_are_never_marked():
    e = lambda v, b="assumption": {"value": v, "basis": b}
    out = {"project_name": e("Bake Off"), "client": e("Acme"), "insight": e("A tension."), "objection": e("A doubt.", "client")}
    marked = checks.mark_assumptions(out)
    assert "project_name" not in marked and "client" not in marked
    assert out["project_name"]["value"] == "Bake Off" and out["objection"]["value"] == "A doubt."


def test_the_clients_own_words_are_not_cut_to_a_limit_and_the_mark_is_not_counted():
    long_text = " ".join(["word"] * 90)
    assert checks.revisions({"background": {"value": long_text, "basis": "client"}}) == []
    assert checks.revisions({"background": {"value": long_text, "basis": "assumption"}})
    near = "To confirm: " + " ".join(["word"] * 68)  # 68 words, 70 with the mark
    assert checks.facts({"background": {"value": near, "basis": "assumption"}})["background"]["words"] == 68


def test_a_part_provenance_downgraded_to_an_assumption_says_so_unless_it_carries_figures():
    out = {"audience": {"value": "Women who skip breakfast.", "basis": "assumption", "downgraded": True},
           "background": {"value": "Sales fell 12% last year.", "basis": "assumption", "downgraded": True},
           "budget_and_scope": {"value": "Fine.", "basis": "assumption"}}
    assert checks.mark_downgraded(out) == ["audience"]
    assert out["audience"]["value"].startswith("To confirm:") and out["background"]["value"] == "Sales fell 12% last year."


# -- the role of each medium and how we will know it worked (feature brief-media-measure) -------------------

LISTS = {"media_roles": (4, 55), "measurement": (5, 70)}


def test_code_measures_the_words_and_items_of_both_new_parts():
    f = checks.facts({"media_roles": e(["Radio: reaches them in the car", "Social: cheap repeats"]),
                      "measurement": e(["Judged by: sales", "Attribution: two regions held back", "The lag: after"])})
    assert f["media_roles"] == {"items": 2, "max_items": 4, "words": 9, "limit": 55}
    assert f["measurement"] == {"items": 3, "max_items": 5, "words": 11, "limit": 70}
    assert "sentences" not in f["media_roles"], "a list is judged by its items, not its sentences"


def test_a_part_over_its_words_or_its_item_cap_goes_back_with_a_message_from_its_own_rule():
    for k, (items, words) in LISTS.items():
        assert checks.revisions({k: e([W(words // items)] * items)}) == [], f"{k} at its limit is not sent back"
        # 16 percent over the words goes back, 14 percent does not
        assert checks.revisions({k: e([W(int(words * 1.14))])}) == []
        long = checks.revisions({k: e([W(int(words * 1.16) + 1)])})
        assert [x["part"] for x in long] == [k] and f"the limit is {words}" in long[0]["instruction"]
        many = checks.revisions({k: e(["a"] * (items + 1))})
        assert [x["part"] for x in many] == [k]
        ins = many[0]["instruction"].lower()
        assert f"it has {items + 1} items" in ins and f"keep the {items} strongest" in ins
        assert "two or three that matter" not in ins, "not the reasons-to-believe sentence"
    assert "no more than four media" in checks.revisions({"media_roles": e(["a"] * 5)})[0]["instruction"].lower()
    assert "no more than five lines" in checks.revisions({"measurement": e(["a"] * 6)})[0]["instruction"].lower()
    assert "two or three that actually matter" in checks.revisions({"reasons_to_believe": e(["a"] * 4)})[0]["instruction"].lower()


def test_both_parts_carry_the_skills_tests_and_the_schema_declares_them_required_with_limits():
    t = checks.tests(["media_roles", "measurement", "budget_and_scope"])
    assert set(t) == {"media_roles", "measurement"}
    assert {"reason_in_a_line", "from_the_job", "fits_the_audience", "fits_the_budget", "no_invented_numbers", "plain_words"} == set(t["media_roles"])
    assert {"ties_to_objectives", "can_attribute", "starts_before_launch", "says_the_lag", "no_invented_targets", "fits_the_budget"} <= set(t["measurement"])
    for k, (items, words) in LISTS.items():
        f = RUBRIC_FIELDS[k]
        assert f["required"] and f["type"] == "list" and (f["max_items"], f["max_words"]) == (items, words)
        assert f["prompt"] and f["good_example"] and f["bad_example"]
        assert len(f["good_example"].replace("·", " ").split()) <= words, "its own good example fits its limit"
        assert len(f["good_example"].split(" · ")) <= items
    hard = {c["id"] for k in LISTS for c in RUBRIC_FIELDS[k]["rubric"] if c.get("tolerance") == "hard"}
    assert {"fits_the_audience", "can_attribute", "says_the_lag"} == hard


def test_an_assumed_list_part_marks_its_first_item_and_other_lists_stay_as_they_are():
    out = {"media_roles": e(["Radio: the car", "Social: repeats"]), "measurement": e(["Judged by: sales"], "client"),
           "reasons_to_believe": e(["a proof"]), "tone_and_world": e(["warm"])}
    assert checks.mark_assumptions(out) == ["media_roles"]
    assert out["media_roles"]["value"] == ["To confirm: Radio: the car", "Social: repeats"]
    assert out["measurement"]["value"] == ["Judged by: sales"], "the client's own words are theirs"
    assert out["reasons_to_believe"]["value"] == ["a proof"] and out["tone_and_world"]["value"] == ["warm"]
    assert checks.mark_assumptions(out) == [], "idempotent"
    # the mark is not counted as words said
    assert checks.facts(out)["media_roles"]["words"] == 5
    # a part provenance moved to assumption says so too, unless it holds a figure
    down = {"measurement": {**e(["Attribution: a holdout"]), "downgraded": True},
            "media_roles": {**e(["Radio: 60% listen"]), "downgraded": True}}
    assert checks.mark_downgraded(down) == ["measurement"]
    assert down["measurement"]["value"][0].startswith("To confirm: ") and down["media_roles"]["value"] == ["Radio: 60% listen"]


def test_jude_is_told_to_judge_both_parts_and_the_measurement_part_is_what_evaluation_criteria_reads():
    from napkin.brief.planned import REVIEW_SYSTEM
    assert "@TESTED@" not in REVIEW_SYSTEM
    item8 = REVIEW_SYSTEM.split("8. part tests:")[1].split("9. anti-patterns")[0]
    for words in checks.TESTED_WORDS.values():
        assert words in item8, f"item 8 names {words}"
    assert "how we will know it worked: the\n   measurement part" in REVIEW_SYSTEM
    assert "items against the item cap" in item8
    assert set(checks.TESTED_WORDS) == set(checks.TESTED) and set(checks.TESTED) <= set(checks.APP_RUBRIC)
