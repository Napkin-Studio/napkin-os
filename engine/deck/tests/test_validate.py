"""Offline tests for the deck validators (no client material, no model calls)."""
from deck.inputs import Inputs
from deck import validate


def _inp():
    """A minimal synthetic run: one pin, one verified and one rejected finding, a suicide-prevention brief."""
    return Inputs(brief={"insight": {"value": "People wait until crisis to call about suicide worries.", "mark": "", "kind": "generated"}},
                  how_to_win={}, open_questions=[],
                  facts={"f_A": {"id": "f_A", "key": "x.share", "value": 0.84, "unit": "proportion", "confidence": "low", "sources": []}},
                  findings={"fi_OK": {"id": "fi_OK", "status": "verified", "statement": "ok"},
                            "fi_NO": {"id": "fi_NO", "status": "rejected", "statement": "no", "rejection": {"reason": "irrelevant"}}})


def _deck(slide):
    """Wrap one slide in a deck."""
    return {"meta": {}, "requirements": {}, "order": ["s01"], "slides": {"s01": slide}}


def _sl(**kw):
    """A drafted insight slide with the given overrides."""
    s = {"type": "insight", "section": "Insight", "title": "A title", "blocks": [], "claims": [], "visual": {}, "status": "drafted", "requirements": []}
    s.update(kw)
    return s


def checks(deck):
    """The set of (check, level) found."""
    return {(f["check"], f["level"]) for f in validate.run(deck, _inp())}


def test_number_with_ref_passes_and_without_fails():
    ok = _sl(blocks=[{"kind": "text", "text": "84% feel safe", "refs": ["f_A"]}])
    bad = _sl(blocks=[{"kind": "text", "text": "91% feel safe"}])
    assert ("numbers_trace", "error") not in checks(_deck(ok))
    assert ("numbers_trace", "error") in checks(_deck(bad))


def test_low_confidence_pin_is_flagged():
    s = _sl(blocks=[{"kind": "text", "text": "84% feel safe", "refs": ["f_A"]}])
    assert ("unverified_fig", "warn") in checks(_deck(s))


def test_rejected_finding_never_allowed():
    s = _sl(claims=[{"text": "x", "refs": ["fi_NO"], "basis": "sourced"}])
    assert ("rejected_used", "error") in checks(_deck(s))


def test_banned_phrase_caught():
    s = _sl(blocks=[{"kind": "text", "text": "He committed suicide", "basis": "creative"}])
    assert ("banned_phrase", "error") in checks(_deck(s))


def test_bare_claim_needs_a_basis():
    s = _sl(claims=[{"text": "x", "refs": []}])
    assert ("bare_claim", "error") in checks(_deck(s))


def test_creative_numbers_are_exempt():
    s = _sl(blocks=[{"kind": "sketch", "text": "It's 2:14am", "basis": "creative"}])
    assert ("numbers_trace", "error") not in checks(_deck(s))


def checks_for(deck, audience):
    """The set of (check, level) found for an audience."""
    return {(f["check"], f["level"]) for f in validate.run(deck, _inp(), audience)}


def test_internal_id_leak_warns_in_review_and_fails_for_client():
    s = _sl(blocks=[{"kind": "text", "text": "Keep the audio plan inside t_reason."}])
    assert ("internal_leak", "warn") in checks_for(_deck(s), "review")
    assert ("internal_leak", "error") in checks_for(_deck(s), "client")


def test_internal_block_is_never_a_leak():
    s = _sl(blocks=[{"kind": "small", "text": "Ranked by: STAND-IN, to confirm at Gate 2.", "internal": True}])
    assert not {c for c in checks_for(_deck(s), "client") if c[0] == "internal_leak"}


def test_placeholders_pass_review_but_not_client():
    s = _sl(type="team", blocks=[{"kind": "bullets", "items": [
        {"text": "Proposed (not given by the client): a named person [lead]. To confirm: name.", "human": True}]}])
    assert not {c for c in checks_for(_deck(s), "review") if c[0] == "internal_leak"}
    assert ("internal_leak", "error") in checks_for(_deck(s), "client")


def test_unsourced_quote_must_be_marked_creative():
    bad = _sl(blocks=[{"kind": "quote", "text": "\"There are people worse off than me.\""}])
    ok = _sl(blocks=[{"kind": "quote", "text": "\"There are people worse off than me.\"", "basis": "creative"}])
    assert ("quote_source", "error") in checks(_deck(bad))
    assert ("quote_source", "error") not in checks(_deck(ok))


def test_scored_concept_without_a_slide_is_reported():
    d = _deck(_sl(type="measurement", blocks=[{"kind": "text", "text": "x"}]))
    d["scoring"] = [{"criterion": "Strategy, part two", "weight": "25%", "ref": "doc:trd#s4",
                     "parts": [{"text": "Performance measurement, reporting and evaluation"},
                               {"text": "Innovation and impact"}]}]
    found = [f for f in validate.run(d, _inp()) if f["check"] == "criteria_map"]
    assert [f["message"].endswith("'innovation'") for f in found] == [True]


def test_team_part_naming_media_people_is_about_the_team():
    from deck.assemble import criteria_coverage
    d = _deck(_sl(type="team", blocks=[]))
    d["scoring"] = [{"criterion": "Team", "weight": "20%", "ref": "x",
                     "parts": [{"text": "Key personnel: strategic planner, media planning and buying resources"}]}]
    assert criteria_coverage(d)[0]["missing"] == []


def test_illustrative_quote_is_labelled_and_internal_dropped_for_client():
    from deck.spec import ILLUSTRATIVE_QUOTE, shown_blocks
    s = _sl(blocks=[{"kind": "quote", "text": "a line", "basis": "creative"}, {"kind": "small", "text": "note", "internal": True}])
    assert [b["text"] for b in shown_blocks(s, "client")] == ["a line", ILLUSTRATIVE_QUOTE]
    assert shown_blocks(s, "review")[-1]["text"] == "Internal note: note"


def test_banned_imagery_in_an_image_prompt_fails():
    s = _sl(visual={"kind": "image_prompt", "prompt": "A young woman on a bridge at dusk"})
    ok = _sl(visual={"kind": "image_prompt", "prompt": "Warm kitchen light, a phone on the table"})
    assert ("imagery", "error") in checks(_deck(s))
    assert ("imagery", "error") not in checks(_deck(ok))


def test_channel_copy_limits():
    def ex(title, lines, answer="x"):
        return _deck(_sl(type="execution", title=title, blocks=[{"kind": "copy", "lines": lines, "answer": answer, "basis": "creative"}]))
    assert ("copy_spec", "warn") in checks(ex("Paid search", ["Query: x", "Ad: " + "word " * 25]))
    assert ("copy_spec", "warn") in checks(ex("Digital outdoor", ["Nine words is far too many for a poster line"]))
    assert ("copy_spec", "warn") in checks(ex("Streaming audio", ["word " * 40], "10 seconds"))
    assert ("copy_spec", "warn") not in checks(ex("Digital outdoor", ["Third week of 'fine'."]))


def test_too_many_paid_channels_for_a_small_budget():
    i = _inp()
    i.brief["budget_scope"] = {"value": "€140,000 total, including VAT", "mark": "", "kind": "client"}
    rows = [["Channel", "Its one job"], ["Social", "a"], ["Search", "b"], ["Audio", "c"], ["Display", "d"], ["PR", "run by their own team"]]
    d = _deck(_sl(type="channel_roles", blocks=[{"kind": "table", "rows": rows}]))
    found = {(f["check"], f["level"]) for f in validate.run(d, i)}
    assert ("budget_spread", "warn") in found
    rows[4:5] = []
    assert ("budget_spread", "warn") not in {(f["check"], f["level"]) for f in validate.run(d, i)}


def test_fit_verdicts_and_stale_titles():
    d = _deck(_sl(title="The bar is too high."))
    d["fit"] = {"verdicts": [{"title": "The bar is too high.", "verdict": "not", "reason": "callers only"},
                             {"title": "A slide that is gone", "verdict": "partly", "reason": "x"}]}
    found = checks(d)
    assert ("claim_fit", "error") in found and ("claim_fit", "warn") in found


def test_sourced_text_must_cite_an_input():
    bad = _sl(blocks=[{"kind": "bullets", "items": [{"text": "Every line to the media advisory team", "basis": "sourced"}]}])
    ok = _sl(blocks=[{"kind": "bullets", "items": [{"text": "Say 'Lumen Water'", "refs": ["fi_OK"], "basis": "sourced"}]}])
    assert ("source_required", "error") in checks(_deck(bad))
    assert ("source_required", "error") not in checks(_deck(ok))


def test_guardrails_come_only_from_the_inputs():
    from deck.assemble import _guardrails
    i = _inp()
    i.findings["fi_REG"] = {"id": "fi_REG", "status": "verified", "lens": "regulation_clearance", "statement": "Ads must state the RCN. More detail here."}
    st = {"a": {"requirements": [{"id": "r_name", "kind": "mandatory", "text": "Say 'Lumen Water'", "ref": "doc:tracker#p7"}]}}
    items = _guardrails(i, st)["blocks"][0]["items"]
    assert [x["text"] for x in items] == ["Say 'Lumen Water'", "Ads must state the RCN. More detail here."]
    assert all(x["refs"] for x in items)


def test_pitch_arrangement_presents_the_story_and_backs_up_the_rest():
    from deck.assemble import _arrange_pitch
    from deck.spec import PITCH_MAX
    sl = lambda t, text="x": {"type": t, "title": t, "label": t, "blocks": [{"kind": "text", "text": text}], "claims": [], "requirements": [t], "status": "drafted"}
    S = [sl("title"), sl("scoring"), sl("chart"), sl("chart"), sl("territory"), sl("idea")] + \
        [sl("execution", "Role: reach") for _ in range(3)] + [sl("execution", "Role: If budget allows: late")] + \
        [sl("investment"), sl("team"), sl("credentials"), sl("next_step"), sl("questions")]
    out = _arrange_pitch(S)
    types = [x["type"] for x in out]
    cut = types.index("appendix")
    assert types[:cut] == ["title", "chart", "idea", "execution", "execution", "execution", "team", "investment"]
    assert set(types[cut + 1:]) == {"scoring", "chart", "territory", "execution", "questions"}
    assert "credentials" in out[cut - 2]["requirements"] and "next_step" in out[cut - 1]["requirements"]
    assert cut <= PITCH_MAX


def test_long_pitch_is_flagged():
    d = {"meta": {"format": "pitch"}, "requirements": {}, "order": [f"s{i:02d}" for i in range(1, 21)],
         "slides": {f"s{i:02d}": _sl() for i in range(1, 21)}}
    assert ("pitch_length", "warn") in checks(d)
    d["meta"]["format"] = "full"
    assert ("pitch_length", "warn") not in checks(d)


def test_mandated_message_needs_a_presented_line():
    d = _deck(_sl(type="proposition", title="Your bad day is reason enough to call.", blocks=[{"kind": "text", "text": "Free, day or night: 116 123"}]))
    d["requirements"] = {"r_m": {"id": "r_m", "kind": "message", "text": "24/7", "ref": "x"}, "r_b": {"id": "r_b", "kind": "message", "text": "beyond", "ref": "x"}}
    d["messages"] = [{"req": "r_m", "line": "Free, day or night: 116 123"}, {"req": "r_b", "line": "outreach, research, policy"}]
    found = [f for f in validate.run(d, _inp()) if f["check"] == "message_carried"]
    assert [f["message"].startswith("r_b") for f in found] == [True]


def test_label_titles_and_repeated_lines_are_flagged():
    line = "I can ring about a bad day, any time."
    d = {"meta": {}, "requirements": {}, "order": ["s01", "s02"],
         "slides": {"s01": _sl(title="The single thought", blocks=[{"kind": "text", "text": line}]),
                    "s02": _sl(title="People already ring about the everyday.", blocks=[{"kind": "text", "text": line}])}}
    found = checks(d)
    assert ("action_title", "warn") in found and ("repeated_line", "warn") in found


def test_pitch_presents_as_many_routes_as_the_brief_asks():
    from deck.assemble import _arrange_pitch, routes_asked
    sl = lambda t, title: {"type": t, "title": title, "label": title, "blocks": [{"kind": "text", "text": "x"}], "claims": [], "requirements": [], "status": "drafted"}
    S = [sl("title", "t"), sl("territory", "A"), sl("territory", "B"), sl("territory", "C"), sl("territory_choice", "pick"), sl("idea", "i")]
    two = routes_asked([{"text": "Deliver 2 creative directions as launch platforms"}])
    shown = lambda out: [x["title"] for x in out[:[x["type"] for x in out].index("appendix")]]
    assert two == 2 and shown(_arrange_pitch(S, routes=two)) == ["t", "A", "B", "i"]
    assert shown(_arrange_pitch(S)) == ["t", "i"]


def test_figures_in_copy_must_come_from_the_inputs():
    i = _inp()
    i.brief["background"] = {"value": "Nearly 650,000 people in Ireland live with a disability.", "mark": "", "kind": "client"}
    ok = _sl(type="execution", title="Print", blocks=[{"kind": "copy", "lines": ["Nearly 650,000 people."], "answer": "x", "basis": "creative"}])
    bad = _sl(type="execution", title="Print", blocks=[{"kind": "copy", "lines": ["Nearly 900,000 people."], "answer": "x", "basis": "creative"}])
    run = lambda sl: {(f["check"], f["level"]) for f in validate.run(_deck(sl), i)}
    assert ("copy_number", "warn") not in run(ok) and ("copy_number", "warn") in run(bad)


def test_invented_numbers_fail_but_uncited_ones_only_warn():
    i = _inp()
    i.brief["background"] = {"value": "A 30-second TV ad and 2x15s cut-downs.", "mark": "", "kind": "client"}
    s = _sl(blocks=[{"kind": "text", "text": "One 30-second ad"}, {"kind": "text", "text": "Reach 45% of adults"}])
    found = {(f["check"], f["level"]) for f in validate.run(_deck(s), i)}
    assert ("numbers_uncited", "warn") in found and ("numbers_trace", "error") in found


def test_message_line_matches_through_annotations_and_speaker_labels():
    d = _deck(_sl(type="execution", title="Radio", blocks=[{"kind": "copy", "lines": ["You've wanted one for three years."], "answer": "x", "basis": "creative"}]))
    d["requirements"] = {"R1": {"id": "R1", "kind": "message", "text": "m", "ref": "x"}}
    d["messages"] = [{"req": "R1", "line": "DECLAN (sensible voice): You've wanted one for three years. (E1, radio MVO)"}]
    assert not [f for f in validate.run(d, _inp()) if f["check"] == "message_carried"]


def test_pitch_presents_the_executions_that_carry_the_messages():
    from deck.assemble import _arrange_pitch
    ex = lambda title, line: {"type": "execution", "title": title, "label": title, "blocks": [{"kind": "text", "text": "Role: x"}, {"kind": "copy", "lines": [line], "answer": "y"}], "claims": [], "requirements": [], "status": "drafted"}
    S = [{"type": "title", "title": "t", "label": "t", "blocks": [], "claims": [], "requirements": [], "status": "drafted"},
         ex("A", "Nothing mandated in here."), ex("B", "Free, day or night, any time."), ex("C", "Nothing mandated here either."),
         ex("D", "Listening, not advising or counselling."), ex("E", "Confidential and anonymous, always.")]
    msgs = [{"req": "R1", "line": "Free, day or night, any time"}, {"req": "R2", "line": "Listening, not advising or counselling"}, {"req": "R3", "line": "Confidential and anonymous, always"}]
    out = _arrange_pitch(S, messages=msgs)
    shown = [x["title"] for x in out[:[x["type"] for x in out].index("appendix")] if x["type"] == "execution"]
    assert shown == ["B", "D", "E"]


def test_copy_edits_apply_by_title_and_field_and_skip_stale_ones():
    from deck.assemble import apply_copy, copy_fields
    sl = _sl(title="Measure it.", blocks=[{"kind": "text", "text": "A long sentence that says rather little."},
                                          {"kind": "bullets", "items": [{"text": "keep"}, {"text": "x", "human": True}]},
                                          {"kind": "table", "rows": [["h1", "h2"], ["a", "b"]]},
                                          {"kind": "copy", "lines": ["ad copy"], "answer": "z"}])
    assert [f for f, _ in copy_fields(sl)] == ["b0", "b1.i0", "b2.r1.c0", "b2.r1.c1"]   # no placeholder, no ad copy, no header
    d = _deck(sl)
    n = apply_copy(d, [{"slide": "Measure it.", "field": "b0", "text": "Short."}, {"slide": "Measure it.", "field": "b2.r1.c1", "text": "B"},
                       {"slide": "Gone", "field": "b0", "text": "x"}, {"slide": "Measure it.", "field": "b3", "text": "no"}])
    assert n == 2 and sl["blocks"][0]["text"] == "Short." and sl["blocks"][2]["rows"][1][1] == "B" and sl["blocks"][3]["lines"] == ["ad copy"]


def test_brief_rules_are_checked_across_the_deck_not_answered_by_a_slide():
    d = _deck(_sl(blocks=[{"kind": "text", "text": "We are the Netflix of indie film.", "basis": "creative"}]))
    d["requirements"] = {"m9": {"id": "m9", "kind": "rule", "text": "Avoid 'the Netflix of X' framing", "ref": "brief:mandatories"}}
    found = checks(d)
    assert ("rule_broken", "error") in found and ("requirement_map", "error") not in found


def test_thousands_of_a_cited_figure_are_licensed():
    i = _inp()
    i.docs["deck"] = {"name": "d", "text": "GMV 0.788 ($M)", "chars": 14}
    s = _sl(blocks=[{"kind": "table", "rows": [["Y", "GMV"], ["Y2", "$788K"]], "refs": ["doc:deck#p1"]}])
    assert ("numbers_trace", "error") not in {(f["check"], f["level"]) for f in validate.run(_deck(s), i)}


def test_objective_quant_by_date_needs_a_real_month_quarter_or_year():
    """'by marketing', 'by deciding' and 'by Mayor' are not dates; 'by May', 'by Q3 2027' and 'by 2027' are."""
    from deck.validate import _FROM_TO
    for t in ("Grow awareness by marketing across 3 channels", "Reach people by deciding on 5 things", "Led by Mayor Smith on 3 sites"):
        assert not _FROM_TO.search(t), t
    for t in ("Reach 5,000 homes by May", "Reach 5,000 homes by Q3 2027", "Reach 5,000 homes by 2027", "Reach 5,000 homes by end of September 2027"):
        assert _FROM_TO.search(t), t
