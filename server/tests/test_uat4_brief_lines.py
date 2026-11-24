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


def test_a_draft_that_settles_nothing_gets_the_question_and_one_that_settles_it_does_not():
    c = checks.candidate_lines(COPPERELL)
    q = checks.line_question(c)
    assert q.startswith("Which line does the board prefer, 'Clean, without the plastic.' or 'Refill. Not landfill.'?")
    assert not checks.line_settled(c, ["Bottle is the hero, logo top right"], ["What is the budget?"])
    assert not checks.line_settled(c, ["Avoid 'Clean, without the plastic.' as a plastic-free claim"], []), "a mention is not an end line"
    assert checks.line_settled(c, ["End line: 'Refill. Not landfill.' (word for word)"], [])
    assert checks.line_settled(c, [], ["Which message does the board prefer, A or B?"])
    assert checks.line_settled(c, [], ["Which line does the board prefer? — Answer: Refill. Not landfill. Use it word for word everywhere."])
    assert not checks.line_settled(c, [], ["What legal line must every piece carry?"])
    # the code's own question is a line question the fixed-line step reads
    assert checks.fixed_line([q.split(" — ")[0] + " — Answer: Refill. Not landfill."]) == "Refill. Not landfill."


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
    assert "'Clean, without the plastic.'" in asked[0] and "'Refill. Not landfill.'" in asked[0]
    assert not any(str(m).startswith("End line:") for m in host.data["mandatories"]), "nothing chosen yet, so no end line"


def test_a_brief_without_candidate_lines_gets_no_line_question(tmp_path):
    s = Server(tmp_path, model=planned_model({}), retrieval=retrieval(), settings_kw={"brief_flow": "planned"})
    try:
        host = Host()
        run(s, host, inp={"prompt": "Can you make me a brief? Brewline, an Irish coffee chain, is launching an oat-milk iced latte this summer.", "attachments": []})
    finally:
        s.stop()
    assert not [q for q in host.data["open_questions"] if q.startswith("Which line does the board prefer")]
