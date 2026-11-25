"""UAT round 4 blocker 3 (a deck made from a Production project, Copperell, a fictional brand): working text leaked onto client slides. A raw
Python list (slide 7), a planner's note on the proposition (slide 8), "the earlier £200k figure is not theirs" beside the brief's own answer of
£200k (slide 12), a bullet said twice (slide 2). Each is fixed at its source, and a guard checks every slide of a built deck."""

from __future__ import annotations

import json
import re
from pathlib import Path

from deck import assemble, inputs

HERE = Path(__file__).parent
LUMEN = HERE / "fixtures" / "lumen_water"

NOTE = "(Once a cleaning-performance test is held, move to the stronger 'cleans as well as' version.)"
SMP = "One tablet, a shake, and your home is properly clean, with nothing to fuss over. " + NOTE
LIST_REPR = re.compile(r"\[\s*['\"]|['\"]\s*\]|\{\s*['\"]\w+['\"]\s*:")   # ['…', '…'] or {"key": …}
PLANNER = assemble._PLANNER_NOTE


def _stages():
    return {k: json.loads((LUMEN / f).read_text()) for k, f in (("a", "a_requirements.json"), ("b", "b_storyline.json"), ("c", "c_territories.json"), ("d", "d_idea.json"))}


def client_text_problems(deck: dict) -> list:
    """Every slide's shown words (title, block text, items, lines, from/to) that hold a list repr or a planner's parenthetical note."""
    bad = []
    for sid in deck["order"]:
        s = deck["slides"][sid]
        words = [s.get("title") or ""]
        for b in s.get("blocks") or []:
            for k in ("text", "from", "to", "title", "statement"):
                if k in b:
                    words.append(b[k] if isinstance(b[k], str) else repr(b[k]))
            for i in b.get("items") or []:   # a steps or kv item is a [label, text] pair the renderers draw as parts: each part is checked
                words += [str(x) for x in i] if isinstance(i, (list, tuple)) else [(i.get("text") if isinstance(i, dict) else str(i)) or ""]
            words += [str(x) for x in b.get("lines") or []]
        for w in words:
            if LIST_REPR.search(w) or PLANNER.search(w):
                bad.append((sid, w[:120]))
    return bad


def _uat_inputs():
    inp = inputs.load(LUMEN / "brief_object.json")
    inp.brief = {**inp.brief, "smp": {"value": SMP, "kind": "brief-maker"},
                 "budget_scope": {"value": "To confirm: budget. The client said only 'mid-size', and the earlier £200k figure is not theirs.", "kind": "brief-maker"}}
    inp.answered = [{"question": "Is the budget inclusive of VAT, and does it cover media as well as production?", "answer": "£200k excluding VAT, media included."}]
    return inp


def test_a_list_given_as_text_is_one_block_per_item_never_a_python_list():
    sl = assemble._slide("audience", "We lead with the pragmatic home cleaner",
                         [{"kind": "text", "text": ["The half that wants it: 64% are motivated by cutting single-use plastic.",
                                                    "The half that doubts it: they fear a tablet cleans less well."]}])
    assert [b["text"] for b in sl["blocks"]] == ["The half that wants it: 64% are motivated by cutting single-use plastic.",
                                               "The half that doubts it: they fear a tablet cleans less well."]


def test_a_planners_note_leaves_the_slide_for_its_notes_word_for_word():
    text, notes = assemble.take_planner_notes(SMP)
    assert text == "One tablet, a shake, and your home is properly clean, with nothing to fuss over."
    assert notes == [NOTE[1:-1]]
    assert assemble.take_planner_notes("Price drives choice (78.6%) more than planet (64%).") == ("Price drives choice (78.6%) more than planet (64%).", [])


def test_the_budget_given_is_the_briefs_answer_when_its_field_is_still_open():
    text, ref, notes = assemble._budget_given(_uat_inputs())
    assert text == "£200k excluding VAT, media included." and ref == "brief:open_questions"
    assert "not theirs" in notes   # the field's words kept for the person, off the slide
    settled = _uat_inputs()
    settled.brief["budget_scope"] = {"value": "£180k including media.", "kind": "brief-maker"}
    assert assemble._budget_given(settled)[0] == "£180k including media."   # a settled field stands


def test_a_bullet_that_repeats_two_others_word_for_word_leaves_the_list():
    items = [{"text": "Shift belief from 'refill is a fussy eco luxury' to 'this is the nicest, easiest way to clean my home'."},
             {"text": "Remove the doubt that a tablet cleans as well as a spray."},
             {"text": "First action: a new buyer buys the starter bottle."},
             {"text": "Shift belief from 'refill is a fussy eco luxury' to 'this is the nicest, easiest way to clean my home', and remove the doubt that "
                      "a tablet cleans as well as a spray. It should look premium like a candle brand."}]
    S = [assemble._slide("objective", "What has to change", [{"kind": "bullets", "items": items}])]
    assemble._drop_repeated_items(S)
    assert len(S[0]["blocks"][0]["items"]) == 3
    assert "candle brand" in S[0]["notes"]   # its extra words are kept, in the notes


def test_guard_no_client_slide_holds_a_list_repr_or_a_planners_note():
    st = _stages()
    deck = assemble.build(_uat_inputs(), st, client="Copperell Home Ltd", project="Copperell Refill", production=True)
    assert not client_text_problems(deck), client_text_problems(deck)
    inv = next(s for s in deck["slides"].values() if s["type"] == "investment")
    assert "£200k excluding VAT" in json.dumps(inv["blocks"], ensure_ascii=False) and "not theirs" not in json.dumps(inv["blocks"])
    prop = next(s for s in deck["slides"].values() if s["type"] == "proposition")
    assert NOTE[1:-1] in prop["notes"]
