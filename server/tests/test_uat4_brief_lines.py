"""UAT round 4, L1: the client named two candidate lines and could not choose; a first draft that keeps neither and asks
nothing about them now gets the question from code, so the fixed-line step (carry_fixed_line) has an answer to act on.
The client brief is the Copperell one (a fictional brand) as the UAT driver pasted it."""

from napkin.brief import checks

from conftest import Server
from test_brief import Host, retrieval, run
from test_planned_brief import planned_model

COPPERELL = 'From: Marketing, Copperell Home Ltd\nSubject: refill launch - brief (rough, sorry)\n\nHi team,\n\nWe\'re launching Copperell Refill: a ribbed amber glass spray bottle you keep for life, plus refill\ntablets. Drop one tablet in tap water, shake, done. 500 ml per tablet. First scent is "Fig & Cedar"\nmulti-surface, then kitchen and bathroom later in the year. In shops from April; online now-ish.\n\nWHAT WE WANT:\n- Get people off single-use plastic sprays AND get our existing liquid customers to switch (??)\n- Look premium like a candle brand but sit next to the big brands in the supermarket\n- Something for students in flatshares AND for families AND for "eco people"\n- A TikTok thing where people drop the tablet in and it fizzes?\n\nWHO: renters, homeowners, parents, students, 20-60 really. Anyone who cleans.\n\nMESSAGE: "Clean, without the plastic." or "Refill. Not landfill." Board can\'t decide. Also say:\nkills 99.9% of germs (we think - lab report due), plastic-free (the sachet is foil-lined, is that\nok?), 95% less packaging weight than a new bottle (vs which bottle?), vegan, made in Yorkshire.\n\nTONE: Calm but confident. Premium but not posh. Definitely not preachy about the planet.\n\nCHANNELS: posters at stations and big supermarkets, Instagram and TikTok, a 15 second film for\nYouTube and cinema, sampling sachets with online grocery orders.\n\nBUDGET: TBC, mid-size.\n\nMANDATORIES: the bottle must be the hero, logo top right. No real, recognisable faces (we can\'t do\nmodel releases this time). No children near the product. Include "Keep out of reach of children.\nRead the label before use."\n\nCOMPETITORS: the big supermarket sprays, the other refill startups, and our own liquid range.\n\nNeed something to show the board Friday!\nCopperell marketing'


def test_the_copperell_brief_names_two_candidate_lines():
    assert checks.candidate_lines(COPPERELL) == ["Clean, without the plastic.", "Refill. Not landfill."]


def test_other_quoted_words_are_not_candidate_lines():
    assert checks.candidate_lines('Include "Keep out of reach of children. Read the label before use."') == []
    assert checks.candidate_lines('First scent is "Fig & Cedar" multi-surface, then "Lemon" later.') == []
    assert checks.candidate_lines("TAGLINE: 'Proper crunch.' or 'Crunch, properly.'") == ["Proper crunch.", "Crunch, properly."]
    assert checks.candidate_lines("The board can't decide between \"Lumo. Dein Licht.\" or \"Licht an.\"") == ["Lumo. Dein Licht.", "Licht an."]


C = ["Clean, without the plastic.", "Refill. Not landfill."]
MODEL_Q = "Which line does the board prefer, given we recommend 'The last spray bottle you'll ever need to buy'?"  # local run, 2026-11-24
REWRITTEN = ("Which line does the board prefer: the client's 'Clean, without the plastic.' or 'Refill. Not landfill.', "
             "or our suggestion 'The last spray bottle you'll ever need to buy'?")


def test_with_no_line_question_code_asks_one_after_the_answers():
    qs = ["What is the budget? — Answer: £200k excluding VAT.", "How will the board judge success?"]
    got = checks.settle_line_question(C, ["Bottle is the hero, logo top right"], qs, answered=1)
    assert got[0] == qs[0] and got[2] == qs[1]
    assert got[1].startswith("Which line does the board prefer: the client's 'Clean, without the plastic.' or 'Refill. Not landfill.'?")


def test_a_model_line_question_without_the_options_is_rewritten_once_naming_both_and_keeping_ours():
    qs = ["What is the budget?", MODEL_Q, "How will the board judge success?"]
    got = checks.settle_line_question(C, [], qs)
    assert got == [qs[0], REWRITTEN, qs[2]], "rewritten in place, never a second question"
    assert sum(1 for q in got if q.startswith("Which line")) == 1
    assert checks.settle_line_question(C, [], got) is None, "once rewritten it names both: unchanged after"


def test_a_model_line_question_that_already_names_both_is_unchanged():
    q = "Which line does the board prefer, 'Clean, without the plastic.' or 'Refill. Not landfill.'?"
    assert checks.settle_line_question(C, [], ["What is the budget?", q]) is None


def test_no_candidate_lines_an_end_line_or_an_answered_line_question_change_nothing():
    assert checks.settle_line_question([], [], [MODEL_Q]) is None
    assert checks.settle_line_question(checks.candidate_lines("Just a brief, no lines."), [], [MODEL_Q]) is None
    assert checks.settle_line_question(C, ["End line: 'Refill. Not landfill.' (word for word)"], [MODEL_Q]) is None
    assert checks.settle_line_question(C, [], [MODEL_Q + " — Answer: Refill. Not landfill. Use it word for word everywhere."]) is None
    legal = ["What legal line must every piece carry?"]
    got = checks.settle_line_question(C, [], legal)
    assert got[0].startswith("Which line") and got[1] == legal[0], "a legal question is not the line question: code asks its own"
    assert checks.settle_line_question(C, ["Avoid 'Clean, without the plastic.' as a plastic-free claim"], [])[0].startswith("Which line"), \
        "a mention in mandatories is not an end line"


def test_answering_the_rewritten_question_with_any_option_sets_the_end_line():
    for answer, line in (("Refill. Not landfill.", "Refill. Not landfill."),
                         ("Clean, without the plastic. We like it.", "Clean, without the plastic."),
                         ("The last spray bottle you'll ever need to buy.", "The last spray bottle you'll ever need to buy.")):
        assert checks.fixed_line([f"{REWRITTEN} — Answer: {answer}"]) == line, answer
    # a new line + "word for word" (#310's stated line) needs only that the question reads as a line question
    assert checks._LINE_Q.search(REWRITTEN) and not checks._LEGAL_Q.search(REWRITTEN)


def test_a_first_draft_of_the_copperell_brief_asks_which_line_when_the_model_did_not(tmp_path):
    seen = {}
    s = Server(tmp_path, model=planned_model(seen), retrieval=retrieval(), settings_kw={"brief_flow": "planned"})
    try:
        host = Host()
        run(s, host, inp={"prompt": COPPERELL, "attachments": []})
    finally:
        s.stop()
    oq = host.data["open_questions"]
    asked = [q for q in oq if q.startswith("Which line does the board prefer")]
    assert len(asked) == 1, oq
    assert "'Clean, without the plastic.'" in asked[0] and "'Refill. Not landfill.'" in asked[0] and "the client's" in asked[0]
    assert not any(str(m).startswith("End line:") for m in host.data["mandatories"]), "nothing chosen yet, so no end line"


def test_a_brief_without_candidate_lines_gets_no_line_question(tmp_path):
    s = Server(tmp_path, model=planned_model({}), retrieval=retrieval(), settings_kw={"brief_flow": "planned"})
    try:
        host = Host()
        run(s, host, inp={"prompt": "Can you make me a brief? Brewline, an Irish coffee chain, is launching an oat-milk iced latte this summer.", "attachments": []})
    finally:
        s.stop()
    assert not [q for q in host.data["open_questions"] if q.startswith("Which line does the board prefer")]


def test_a_first_draft_whose_model_asks_its_own_line_rewrites_that_question_once(tmp_path):
    m = planned_model({})
    for k in ("review_brief", "review_brief_again"):
        orig = m.overrides[k]
        m.overrides[k] = lambda p, orig=orig: {**orig(p), "questions": ["What is the launch budget?", MODEL_Q]}
    s = Server(tmp_path, model=m, retrieval=retrieval(), settings_kw={"brief_flow": "planned"})
    try:
        host = Host()
        run(s, host, inp={"prompt": COPPERELL, "attachments": []})
    finally:
        s.stop()
    lines = [q for q in host.data["open_questions"] if q.startswith("Which line")]
    assert lines == [REWRITTEN], host.data["open_questions"]
