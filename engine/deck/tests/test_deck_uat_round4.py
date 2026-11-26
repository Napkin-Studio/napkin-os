"""UAT round 4 (Copperell, a fictional refill brand): the deck's idea line reads the brief's end-line mandatory, word for word (F4)."""

from __future__ import annotations

import json
from pathlib import Path

from deck import assemble, inputs

HERE = Path(__file__).parent
LUMEN = HERE / "fixtures" / "lumen_water"
COPPERELL_END = "End line: 'Refill. Not landfill.' (word for word)"   # what Brief Maker writes (fix/uat4-brief, server/napkin/brief/checks.py)


def test_end_line_of_reads_a_mandatory_as_productions_end_card_does():
    # the same cases as production-tool/web/src/brief/brief.test.ts endLineOf
    assert assemble.end_line_of(["Show the lamp in a small bedroom", "Do not show alcohol", "End on the line: Lumo. Dein Licht."]) == "Lumo. Dein Licht."
    assert assemble.end_line_of(["End line – “Lumo. Calm, on.”"]) == "Lumo. Calm, on."
    assert assemble.end_line_of(["Sign-off: 'Hearth. Every morning.'"]) == "Hearth. Every morning."
    assert assemble.end_line_of(["Never show a phone screen"]) == ""
    assert assemble.end_line_of([COPPERELL_END, "Carry the biocide label line"]) == "Refill. Not landfill."
    assert assemble.end_line_of(None) == "" and assemble.end_line_of([]) == ""


def test_the_briefs_end_line_is_the_stated_line_ahead_of_the_proposition_and_the_prompt():
    inp = inputs.Inputs(brief={"mandatories": {"value": [COPPERELL_END]}, "smp": {"value": "Refills that end the plastic habit."}},
                        prompt_text="A pitch for Copperell. One line: Something else.")
    assert assemble.stated_line(inp) == ("Refill. Not landfill.", True)
    # no end line: unchanged behaviour (the prompt's line, then a short proposition)
    assert assemble.stated_line(inputs.Inputs(brief={"mandatories": {"value": ["Never show a child"]}}, prompt_text="One line: Proper crunch.")) == ("Proper crunch.", True)
    assert assemble.stated_line(inputs.Inputs(brief={"smp": {"value": "Proper crunch."}})) == ("Proper crunch.", False)


def test_the_idea_slide_carries_the_briefs_end_line_word_for_word():
    inp = inputs.load(LUMEN / "brief_object.json")
    inp.brief = {**inp.brief, "mandatories": {"value": [COPPERELL_END]}}
    st = {k: json.loads((LUMEN / f).read_text()) for k, f in (("a", "a_requirements.json"), ("b", "b_storyline.json"), ("c", "c_territories.json"), ("d", "d_idea.json"))}
    st["d"] = {**st["d"], "campaign_line": "Refill more. Not landfill."}   # a model's reworded line
    deck = assemble.build(inp, st, client="Copperell", project="Copperell Refill")
    idea = next(s for s in deck["slides"].values() if s["type"] == "idea")
    assert idea["title"] == "Refill. Not landfill."
    assert "Refill more" not in json.dumps(deck["slides"], ensure_ascii=False)
