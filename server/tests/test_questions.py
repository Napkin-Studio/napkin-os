"""The client questions, each gap asked once (brief/questions.py)."""

from napkin.brief.questions import dedupe, same_ask, terms


def test_the_same_ask_in_other_words_is_one_question():
    assert same_ask("What is the launch budget?", "What budget has been set for this campaign?")
    assert same_ask("What are the success measures?", "What success measures should the campaign be judged on?")
    assert same_ask("What mandatory legal lines must appear?", "Are there legal lines that must appear?")
    assert same_ask("What is the budget?", "what is the  budget?")


def test_asks_that_look_alike_but_differ_stay_two_questions():
    assert not same_ask("What is the media budget?", "What is the production budget?")
    assert not same_ask("What are the commercial objectives?", "What are the behavioural objectives?")
    assert not same_ask("Who is the agency lead?", "Who is the client lead?")
    assert not same_ask("When is the tender due?", "When does the campaign go live?")
    assert not same_ask("What is the budget?", "What is the timing?")
    # a one-word ask only matches an identical one, so a narrower question is not swallowed
    assert not same_ask("What is the budget?", "What is the media budget?")


def test_the_priority_and_the_why_are_not_the_ask():
    assert terms("[high] What is the budget? — Without it we cannot size the media plan.") == terms("What is the budget?")
    assert same_ask("What is the launch budget?", "[high] What is the budget? — Without it we cannot size the media plan.")


def test_question_words_alone_match_only_an_identical_question():
    assert same_ask("When is it?", "when is it?")
    assert not same_ask("When is it?", "Who is it?")


def test_the_first_wording_and_place_are_kept_and_merges_are_reported():
    qs = ["Who is the primary audience?", "What is the launch budget?", "What budget has been set for this campaign?",
          "  ", "What is the launch budget?"]
    kept, merged = dedupe(qs)
    assert kept == ["Who is the primary audience?", "What is the launch budget?"]
    # an exact repeat is dropped quietly; only a reworded one is reported as a merge
    assert merged == [("What is the launch budget?", "What budget has been set for this campaign?")]


def test_the_eleven_questions_of_a_repetitive_run_come_down_to_the_distinct_asks():
    eleven = ["What is the launch budget?", "Who is the primary audience?", "What are the success measures?",
              "What budget has been set for this campaign?", "Which audience should we prioritise?",
              "[high] What is the budget? — Without it we cannot size the media plan.",
              "What success measures should the campaign be judged on?", "When is the tender due?",
              "What is the media budget?", "What mandatory legal lines must appear?",
              "Are there legal lines that must appear?"]
    kept, _ = dedupe(eleven)
    assert len(kept) == 7
    assert "What is the media budget?" in kept
