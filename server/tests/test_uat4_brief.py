"""UAT round 4 (Copperell, fictional): Brief Maker findings F3, F4 and F5, offline."""

from napkin.brief import checks
from napkin.brief.questions import dedupe, same_ask

LINE_Q = ("Which line does the board prefer, 'Clean, without the plastic' or 'Refill. Not landfill'? — "
          "Answer: Refill. Not landfill. Use it word for word everywhere.")


# ── F4: the line the planner fixed lands in mandatories, as the end line ──────────────────────────────────────────
def test_the_answered_line_is_the_fixed_line_in_the_answers_own_words():
    assert checks.fixed_line([LINE_Q]) == "Refill. Not landfill."


def test_a_quoted_answer_wins_and_a_no_or_an_unrelated_answer_fixes_nothing():
    q = "Is there a sign-off line we must use? — Answer: Yes, 'Lumo. Dein Licht.' on every piece."
    assert checks.fixed_line([q]) == "Lumo. Dein Licht."
    assert checks.fixed_line(["Which line does the board prefer, 'A b' or 'C d'? — Answer: No, not yet."]) == ""
    assert checks.fixed_line(["What is the budget? — Answer: £200k excluding VAT."]) == ""
    assert checks.fixed_line(["Which line does the board prefer? — Left open: the board meets Friday."]) == ""
    assert checks.fixed_line([]) == ""


def test_the_fixed_line_goes_first_into_mandatories_as_the_end_line_production_reads():
    mands = ["The bottle is the hero, logo top right", "No real, recognisable faces"]
    got = checks.carry_fixed_line(mands, "Refill. Not landfill.")
    assert got[0] == "End line: 'Refill. Not landfill.' (word for word)"
    assert got[1:] == mands
    # Production's endLineOf reads "End line: '<quoted>'" (production-tool/web/src/brief/model.ts)
    assert got[0].startswith("End line: '") and "'Refill. Not landfill.'" in got[0]


def test_carrying_is_idempotent_and_replaces_another_end_line():
    once = checks.carry_fixed_line(["No children near the product"], "Refill. Not landfill.")
    assert checks.carry_fixed_line(once, "Refill. Not landfill.") is None, "already there: nothing changes"
    swapped = checks.carry_fixed_line(["End line: 'Clean, without the plastic'", "No faces"], "Refill. Not landfill.")
    assert swapped == ["End line: 'Refill. Not landfill.' (word for word)", "No faces"]
    assert checks.carry_fixed_line(["No faces"], "") is None
    assert checks.carry_fixed_line("Posters; social", "Refill. Not landfill.")[0].startswith("End line:")


# ── F5: an invented person in the audience goes back to the Brief agent ───────────────────────────────────────────
PRIYA = ("To confirm: Meet Priya, 28, who rents a one-bed flat with a friend's old sofa and one good thing she chose "
         "herself: a fig candle on the shelf.")


def test_a_named_person_with_an_age_is_an_invented_person():
    assert checks.invented_person(PRIYA) == "Priya, 28"
    assert checks.invented_person("Meet Dara: she shops on Sundays.") == "Dara"
    assert checks.invented_person("Tom (34) cleans on Sundays.") == "Tom, 34"


def test_a_group_with_ages_dates_or_figures_is_not_a_person():
    for t in ("Renters aged 22 to 35 who already buy one nice household item. Families are secondary.",
              "In shops from April, 25 stores first.", "London, 30% of sales.", "Busy (working) mothers.",
              "Primarily, owners/directors of companies with a turnover of £1m to £130m."):
        assert checks.invented_person(t) == "", t


def test_code_sends_an_invented_audience_back_with_the_reason_but_never_the_clients_own_words():
    e = lambda v, basis="assumption": {"value": v, "basis": basis}  # noqa: E731
    back = checks.revisions({"audience": e(PRIYA)})
    assert len(back) == 1 and back[0]["part"] == "audience"
    assert "Priya, 28" in back[0]["instruction"] and "no name, age" in back[0]["instruction"]
    assert checks.revisions({"audience": e(PRIYA, "client")}) == [], "the client's own persona is theirs to give"
    assert checks.revisions({"audience": e("Renters aged 22 to 35. Not for lowest-price buyers.")}) == []


# ── F3: the same ask, answered twice ──────────────────────────────────────────────────────────────────────────────
def test_the_lab_report_question_in_two_wordings_is_one_question():
    first = ("When is the lab report due, and what exactly will it show for the 99.9% germ claim? — Answer: Drop "
             "\"kills 99.9%\" until the lab report and the biocide check are done.")
    again = "When is the lab report due, and does it support 99.9% against the relevant standard?"
    kept, merged = dedupe([first, again])
    assert kept == [first]
    assert merged


def test_the_switch_question_in_two_wordings_is_one_question():
    a = "Do you want existing Copperell liquid customers to switch, or is the aim new buyers and those leaving single-use plastic sprays?"
    b = "Do you want existing liquid customers to switch, given the cannibalisation risk?"
    assert same_ask(a, b)
    assert dedupe([a, b])[0] == [a]


def test_a_leaning_leftover_about_another_figure_still_stays():
    first = "When is the lab report due, and what will it show for the 99.9% claim?"
    other = "When is the lab report due, and does it cover the 95% packaging figure?"
    kept, _ = dedupe([first, other])
    assert other in kept, "a different figure is a different ask"


# ── F10: an item the planner's answer gives is not marked 'To confirm' ────────────────────────────────────────────
ANSWERED = ["What sales, distribution or share target should the launch hit, and by when? — Answer: Launch target: 1,500 "
            "stockists and 60,000 starter bottles sold by end of May; repeat-refill rate of 35% within 8 weeks."]


def test_the_mark_skips_a_measurement_item_the_planners_answer_gives():
    answers = checks.answers_text(ANSWERED)
    e = {"basis": "assumption", "value": ["Judged by: 1,500 stockists, 60,000 starter bottles, 35% repeat refill within 8 weeks.",
                                          "Also: a pre-launch tracker wave on premium perception, if budgeted."]}
    assert checks.mark_assumptions({"measurement": e}, answers=answers) == ["measurement"]
    assert e["value"][0].startswith("Judged by"), "the planner's own figures are not an assumption"
    assert e["value"][1].startswith("To confirm: Also")
    assert checks.mark_assumptions({"measurement": e}, answers=answers) == [], "idempotent"


def test_without_answers_or_with_another_figure_the_first_item_is_marked_as_before():
    e = {"basis": "assumption", "value": ["Judged by: 1,500 stockists.", "A tracker."]}
    checks.mark_assumptions({"measurement": e})
    assert e["value"][0].startswith("To confirm: Judged by")
    f = {"basis": "assumption", "value": ["Judged by: 2,000 stockists.", "A tracker."]}
    checks.mark_assumptions({"measurement": f}, answers=checks.answers_text(ANSWERED))
    assert f["value"][0].startswith("To confirm:"), "a figure the planner never gave is still to confirm"
    assert not checks.answer_backed("A tracker wave, if budgeted.", checks.answers_text(ANSWERED)), "no figure, no backing"


# ── re-test on UAT (develop 1701c768): the real document's words ───────────────────────────────────────────────────
# doc-ie-napkin-brief-maker-adfbb3d3, open_questions as the planner answered them (the driver typed one answer into
# three questions; only the line question offers the line)
R2_ANSWERED = [
    "Is the foil-lined sachet recyclable, and what bottle does the 95% less packaging weight compare against? — Answer: Refill. Not landfill. Use it word for word everywhere.",
    "Which message does the board prefer: 'Clean, without the plastic' or 'Refill. Not landfill'? — Answer: Refill. Not landfill. Use it word for word everywhere.",
    "What exactly is the foil-lined sachet made of, and is it recyclable or plastic-free in real conditions? — Answer: Refill. Not landfill. Use it word for word everywhere.",
    "What is the sachet made of, and can you share the packaging spec so we can check the 'plastic-free' wording? — Answer: The sachet is foil-lined, so drop \"plastic-free\" entirely.",
]
R2_MANDATORIES = ["Bottle is hero, logo top right", "No real, recognisable faces", "No children near the product",
                  "Include 'Keep out of reach of children. Read the label before use.'"]


def test_a_message_question_answered_word_for_word_fixes_the_line():
    assert checks.fixed_line(R2_ANSWERED) == "Refill. Not landfill."
    got = checks.carry_fixed_line(R2_MANDATORIES, checks.fixed_line(R2_ANSWERED))
    assert got[0] == "End line: 'Refill. Not landfill.' (word for word)" and got[1:] == R2_MANDATORIES


def test_a_wording_or_legal_question_never_becomes_the_line():
    assert checks.fixed_line([R2_ANSWERED[3]]) == "", "'plastic-free' wording is not the campaign's line"
    assert checks.fixed_line(["What legal line must every piece carry? — Answer: 'Keep out of reach of children.'"]) == ""
    assert checks.fixed_line(["Which warning goes on the label, 'A b' or 'C d'? — Answer: C d, word for word."]) == ""


def test_an_answer_that_says_word_for_word_fixes_the_option_it_repeats_whatever_the_question_calls_it():
    q = "Which of the two does the board want, 'Clean, without the plastic' or 'Refill. Not landfill'? — Answer: Clean, without the plastic. Word for word, please."
    assert checks.fixed_line([q]) == "Clean, without the plastic."


def test_a_name_with_an_age_range_or_a_lead_label_is_an_invented_person():
    assert checks.invented_person("Lead: Hannah, 25-45, renting or newly owning.") == "Hannah, 25-45"
    assert checks.invented_person("Hannah (25 to 45) rents.") == "Hannah, 25 to 45"
    assert checks.invented_person("Lead: Hannah, renting or newly owning.") == "Hannah"
    assert checks.invented_person("Persona: Priya rents a flat.") == "Priya"
    assert checks.invented_person("Priya, aged 28, rents.") == "Priya, aged 28"


def test_groups_with_age_ranges_and_lead_labels_are_not_people():
    for t in ("Lead: renters aged 22 to 35 who already spend a little extra on one nice household item.",
              "Lead: Renters, 22-35, who hide ugly sprays. Secondary: Families, 30 to 45.",
              "Lead: Busy (working) mothers. Secondary: Students, 18-24.", "Homeowners, 25-45, in the South East.",
              "Parents, 30-45, with young children.", "Spring, 40% start cleaning in March."):
        assert checks.invented_person(t) == "", t


def test_code_sends_the_first_drafts_lead_persona_back():
    back = checks.revisions({"audience": {"value": "Lead: Hannah, 25-45, renting or newly owning.", "basis": "research"}})
    assert back and back[0]["part"] == "audience" and "Hannah, 25-45" in back[0]["instruction"]
