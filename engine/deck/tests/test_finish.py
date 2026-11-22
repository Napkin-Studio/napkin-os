"""The finish fixes (spec.FINISH, features/deck-repair-loop.clan): what a blind review of six decks marked down on finish, held in code.
Check ids, agency notes, picture prompts and the sketch label never sit on a slide; placeholder-only slides leave the presented story with
one 'What we need from you' line in their place; a thought is said once; the title and objective state what the brief states; bracketed
slots are filled; evidence reads in metric units; the last fit rung moves points to the notes; the proposition never argues against the
alternative the deck rejects. The ask is clean: what only the client can give is one appendix list. Offline: no model, no LibreOffice. Every client and person here is invented. The suite runs with
DECK_FINISH=0 (conftest), so each test turns the flag on itself."""
from __future__ import annotations

import json
from pathlib import Path
from types import SimpleNamespace

import pytest
from pptx import Presentation

from deck import assemble, finish, inputs, layouts, numfmt, profiles, refs, render_pptx, render_web, spec, validate

HERE = Path(__file__).parent
FIX = HERE / "fixtures" / "lumen_water"
TYPES = HERE / "fixtures" / "types"
FILES = {"a": "a_requirements.json", "b": "b_storyline.json", "c": "c_territories.json", "d": "d_idea.json"}


@pytest.fixture
def fin(monkeypatch):
    """The finish fixes on, with the look they ship with; the metric switch of numfmt restored after the test."""
    monkeypatch.setattr(spec, "FINISH", True)
    monkeypatch.setattr(spec, "LOOK_V3", True)
    monkeypatch.setattr(numfmt, "UNITS_METRIC", False)


def _st(folder: Path = FIX) -> dict:
    return {k: json.loads((folder / f).read_text()) for k, f in FILES.items() if (folder / f).exists()}


def _lumen() -> dict:
    return assemble.build(inputs.load(FIX / "brief_object.json"), _st(), client="Lumen Water", project="National awareness campaign", fmt="pitch")


def _sketch() -> dict:
    inp = inputs.load(None, prompt_text=(TYPES / "agency_pitch" / "prompt.txt").read_text().strip())
    return assemble.build(inp, _st(TYPES / "agency_pitch"), client="Client", project="Project", profile=profiles.load("agency_pitch"))


def _inp(**brief):
    return SimpleNamespace(brief={k: {"value": v} for k, v in brief.items()}, prompt_text="", brief_source={})


# ---------------------------------------------------------------- 1. a failed check is a review note, never a stamp on the slide

def test_a_failed_check_is_in_the_notes_and_never_on_the_slide(monkeypatch, tmp_path):
    monkeypatch.setattr(spec, "FINISH", True)
    import test_render_layouts as TL
    deck = TL._deck()
    deck["meta"]["audience"] = "review"
    sid = deck["order"][4]
    findings = [{"check": "bare_claim", "level": "error", "slide": sid, "message": "x"}]
    out = render_pptx.render(deck, TL._inp(), tmp_path / "r.pptx", findings=findings)
    prs = Presentation(str(out))
    shown = "\n".join(sh.text_frame.text for sl in prs.slides for sh in sl.shapes if sh.has_text_frame)
    assert "CHECK FAILED" not in shown and not any(sh.name == "CheckFailed" for sl in prs.slides for sh in sl.shapes)
    assert "Check failed (review only, never on the slide): bare_claim" in prs.slides[4].notes_slide.notes_text_frame.text
    view = next(v for v in render_web.slide_views(deck, TL._inp(), findings) if v["id"] == sid)
    assert "CHECK FAILED" not in view["html"] and "bare_claim" in view["notes"]


def test_a_client_file_carries_no_review_lines():
    s = {"blocks": [{"kind": "small", "text": "Ranked by: a stand-in.", "internal": True}], "visual": {"kind": "image_prompt", "prompt": "a tap"}}
    spec_finish = spec.FINISH
    try:
        spec.FINISH = True
        assert spec.review_lines(s, "client", ["bare_claim"]) == []
        lines = spec.review_lines(s, "review", ["bare_claim"])
        assert lines[0].startswith("Check failed") and "Internal note: Ranked by: a stand-in." in lines and lines[-1].startswith("Image prompt")
        assert not [b for b in spec.shown_blocks(s, "review") if b.get("internal")]   # an agency note never sits on a slide
    finally:
        spec.FINISH = spec_finish
    assert spec.review_lines(s, "review", ["bare_claim"]) == []   # the flag off: the old renders, unchanged


# ---------------------------------------------------------------- 1b. prompt:<n> refs of a brief-only run resolve to the brief's own sentences

def _brief_with_source(tmp_path) -> Path:
    b = {"loop2_golden": {"fields": {"background": {"value": "Brightwell runs a small ferry.", "source": "client_stated"}}},
         "loop1_capture": {"fields": {"objective": [{"value": "x", "source_quote": "We want 400 new riders. By June.", "source_refs": [2, 3]}]},
                           "how_to_win": {"stated_evaluation_criteria": [{"point": "p", "evidence": "Brightwell runs a small ferry.", "source_refs": [1]}]}}}
    p = tmp_path / "brief_object.json"
    p.write_text(json.dumps(b))
    return p


def test_prompt_refs_of_a_brief_only_run_resolve_to_the_brief_source(fin, tmp_path, monkeypatch):
    inp = inputs.load(_brief_with_source(tmp_path))
    assert inp.brief_source == {1: "Brightwell runs a small ferry.", 2: "We want 400 new riders.", 3: "By June."}
    assert "source_sentences" not in inp.coverage
    R = refs.Resolver(inp)
    assert R.kind("prompt:2") == "prompt" and R.kind("prompt:4") == "unknown" and 400.0 in R.numbers("prompt:2")
    assert "client's brief" in R.source_key("prompt:1")[1] and "We want 400 new riders." in R.describe("prompt:2")
    monkeypatch.setattr(spec, "FINISH", False)
    assert R.kind("prompt:2") == "unknown"   # before the fix: unknown_ref on every slide citing one


# ---------------------------------------------------------------- 2. placeholder-only slides leave the presented story

def test_placeholder_slides_go_to_to_supply_and_the_client_asks_are_one_appendix_list(fin):
    d = _lumen()
    pres = [d["slides"][x] for x in validate.presented(d)]
    assert not [s for s in pres if finish.placeholder_only(s)] and {"team", "credentials", "investment"}.isdisjoint(s["type"] for s in pres)
    back = [d["slides"][x] for x in d["order"][len(pres):]]
    at = next(i for i, s in enumerate(back) if s["title"] == spec.TO_SUPPLY_TITLE)
    assert {"team", "credentials", "investment"} <= {s["type"] for s in back[at:]}
    # the close is a clean ask (blind re-judge, 19 Nov 2026): no 'What we need from you' line asking the client for the agency's own team
    lines = [i["text"] for s in pres for b in s["blocks"] for i in b.get("items") or [] if isinstance(i, dict) and str(i.get("text", "")).startswith("What we need from you")]
    assert lines == []
    asks = next(s for s in back if s.get("role") == "client_asks")
    items = [i["text"] for b in asks["blocks"] for i in b.get("items") or []]
    assert asks["title"] == spec.CLIENT_ASKS_TITLE and finish.DECISION_ASK in items and not [t for t in items if "team" in t or "case stud" in t]
    assert not [b for s in pres for b in s["blocks"] if b.get("internal") and "To supply:" in str(b.get("text"))]


def test_a_sketch_fills_the_places_with_the_audience_and_the_work(fin):
    d = _sketch()
    pres = [d["slides"][x] for x in validate.presented(d)]
    assert len(pres) <= spec.SKETCH_MAX_SLIDES and "audience" in [s["type"] for s in pres]
    assert not [s for s in pres if finish.placeholder_only(s)]


def test_placeholder_only_reads_past_the_budget_line_but_not_past_real_words():
    inv = {"type": "investment", "status": "needs_human", "blocks": [{"kind": "text", "text": "Budget given: EUR 90,000"},
                                                                   {"kind": "bullets", "items": [{"text": "option", "human": True}]}]}
    assert finish.placeholder_only(inv)
    inv["blocks"][1]["items"].append({"text": "Agree the platform", "basis": "proposal"})
    assert not finish.placeholder_only(inv)
    assert finish.supply_line([{"type": "team"}, {"type": "credentials"}], ["the decision date"]) == \
        "What we need from you: the team, two case studies and the decision date."


# ---------------------------------------------------------------- 3. said once

def test_two_spine_slides_that_say_the_same_thing_become_one():
    rq = {"type": "real_question", "title": "Riders doubt the ferry is for them, so the launch must prove it is.", "blocks": [{"kind": "statement", "text": "The gap is doubt, not supply."}],
          "claims": [], "requirements": [], "notes": ""}
    ins = {"type": "insight", "title": "Riders doubt the ferry is for them, so Brightwell must prove it is.", "blocks": [{"kind": "statement", "text": "Show a rider."}],
           "claims": [], "requirements": [], "notes": ""}
    pairs = finish.repeats([rq, ins])
    assert pairs == [(ins, rq)]
    finish.merge_repeat(ins, rq)
    assert [b["text"] for b in ins["blocks"]] == ["Show a rider.", "The gap is doubt, not supply."] and "Said once" in ins["notes"]
    a, b = {"type": "real_question", "section": "The real question"}, {"type": "chart", "section": "The real question"}
    finish.sections([a, b])
    assert b["section"] == "The barrier"


def test_a_sentence_an_earlier_slide_said_leaves_for_the_notes(fin):
    s1 = assemble._slide("objective", "What has to change", [{"kind": "bullets", "items": [{"text": "Riders must take four hundred first trips by June."}]}])
    s2 = assemble._slide("insight", "Riders doubt it", [{"kind": "statement", "text": "Show a rider."},
                                                         {"kind": "small", "text": "Riders must take four hundred first trips by June."}])
    assemble._say_once([assemble._slide("title", "T", []), s1, s2])
    assert [b["text"] for b in s2["blocks"]] == ["Show a rider."] and spec.SAID_ONCE_NOTE.format(n=2) in s2["notes"]


def test_a_near_repeat_is_not_surfaced_twice_on_the_objective(fin):
    inp = inputs.load(FIX / "brief_object.json")
    inp.brief["objectives"]["value"] = {"attitudinal": "Shift perception of the ferry to something ordinary people use"}
    ob = assemble._slide("objective", "What has to change", [{"kind": "bullets", "items": [{"text": "Shift the perception of the ferry to something ordinary people use."}]}])
    assemble._surface_brief_fields([ob], inp)
    assert len(ob["blocks"][0]["items"]) == 1


# ---------------------------------------------------------------- 4. nothing internal on a client slide

def test_the_sketch_label_is_in_the_cover_notes_not_on_the_cover(fin):
    d = _sketch()
    cover = d["slides"][d["order"][0]]
    assert not any(b.get("text") == spec.SKETCH_LABEL for b in cover["blocks"]) and spec.SKETCH_LABEL in cover["notes"]
    assert d["meta"]["sketch"]["label"] == spec.SKETCH_LABEL   # the deck still knows it is a sketch (the DRAFT mark stays)


def test_bracketed_slots_take_the_brief_value_or_a_neutral_phrase():
    S = [{"type": "execution", "title": "Local radio", "notes": "", "blocks": [{"kind": "copy", "lines": [
        "Hello, [County] County Council.", "Call: [council's published number]", "[First name]. Going to: [their destination].",
        "[Silence. A slow drip rises.]", "Made by [Agency]"]}]}]
    done = finish.fill_brackets(S, _inp(background="A ferry in a coastal county."), "Brightwell")
    assert S[0]["blocks"][0]["lines"] == ["Hello, your County Council.", "Call: the council's number", "A neighbour. Going to: their destination.",
                                          "[Silence. A slow drip rises.]", "Made by [Agency]"]
    assert len(done) == 4 and "To supply: '[County]'" in S[0]["notes"]
    S[0]["blocks"][0]["lines"] = ["Ring [County] County Council", "In [County] now"]
    finish.fill_brackets(S, _inp(background="A ferry in County Seaford."), "Brightwell")
    assert S[0]["blocks"][0]["lines"] == ["Ring Seaford County Council", "In County Seaford now"]


# ---------------------------------------------------------------- 5. the title and the objective state what the brief states

def test_a_scope_word_the_brief_never_states_leaves_the_title():
    assert finish.scope_checked("National awareness campaign", _inp(audience="Adults in the region")) == ("Awareness campaign", ["National"])
    assert finish.scope_checked("National awareness campaign", _inp(background="A national campaign for every county"))[1] == []
    assert finish.scope_checked("National awareness campaign", _inp(budget_scope="One county, not a national splash"))[1] == ["National"]


def test_the_objective_is_the_briefs_primary_first_and_said_once():
    inp = _inp(objectives={"commercial": "400 new riders by June.", "behavioural": "At least a third take a second trip within a month.",
                           "attitudinal": "Shift perception of the ferry to something ordinary people use."})
    items = [{"text": "Convert at least 33% of riders to a second trip.", "refs": ["req:R2"]},
             {"text": "Win 400 new riders by June. Taken from the research summary, so check it against the original.", "refs": ["req:R1"]},
             {"text": "Shift the perception of the ferry to something ordinary people use.", "refs": ["req:R3"]}]
    got, notes = finish.objectives(inp, items)
    assert [i["text"] for i in got] == ["400 new riders by June.", "At least a third take a second trip within a month.",
                                        "Shift perception of the ferry to something ordinary people use."]   # the 33% item is the second objective said again
    assert "req:R1" in got[0]["refs"] and "req:R2" in got[1]["refs"] and "req:R3" in got[2]["refs"]
    alone, notes = finish.objectives(_inp(), [items[1], {"text": "Win 400 new riders by June.", "refs": []}])
    assert [i["text"] for i in alone] == ["Win 400 new riders by June."] and any("agency" in n for n in notes)


def test_the_hero_number_is_the_primary_objectives_count(monkeypatch):
    texts = ["Win 20,000 registered riders within 6 months.", "Convert at least 33% of riders to a first trip."]
    monkeypatch.setattr(spec, "FINISH", True)
    assert render_pptx._objective_facts(texts)["target"] == "20,000"
    assert render_pptx._objective_facts(["Spend up to EUR 150,000 on media."]) is None   # a budget is never the target
    monkeypatch.setattr(spec, "FINISH", False)
    assert render_pptx._objective_facts(texts)["target"] == "33%"


# ---------------------------------------------------------------- 6. evidence in metric units, labelled with its market

def test_an_imperial_figure_reads_in_metric_with_its_market(monkeypatch):
    t = finish.metric_text("Leaks waste over 9,300 gallons a year; a tap drips 3,000 gallons.")
    assert t == "Leaks waste over 35,200 litres (US figure: 9,300 gallons) a year; a tap drips about 11,400 litres (US figure: 3,000 gallons)."
    assert finish.metric_text(t) == t
    monkeypatch.setattr(numfmt, "UNITS_METRIC", True)
    assert "litres" in numfmt.format_text("9,300 gallons")
    monkeypatch.setattr(numfmt, "UNITS_METRIC", False)
    assert numfmt.format_text("9,300 gallons") == "9,300 gallons"
    assert finish.metric_market(None, "a scheme in an irish county") and not finish.metric_market(None, "a utility in the united states")


# ---------------------------------------------------------------- 7. the last fit rung moves points before anything runs off the slide

def test_the_last_rung_offers_the_richer_points_of_an_appendix_slide():
    s = {"type": "territory", "title": "Territory: Ordinary", "blocks": [
        {"kind": "statement", "text": "Ordinary people ride."},
        {"kind": "kv", "items": [["Why it fits", "It answers the doubt."], ["Mood", "Plain."], ["Risks", "It may read as dull, 3 in 4 say."]]},
        {"kind": "sketch", "text": "A rider -> a stop -> a wave"}]}
    got = [(c[0], c[1]) for c in layouts._last_resort({}, "s21", s, "review")]
    assert got[0] == (1, 1) and (2, None) in got and (1, 2) in got and (0, None) not in got and (1, 0) not in got


def test_a_long_script_keeps_its_answer_as_a_line_of_its_own(fin):
    sl = assemble._slide("execution", "Radio", [{"kind": "text", "text": "Role: say it."},
                                                {"kind": "copy", "lines": ["word " * 70], "answer": "Why it works, in a sentence of its own."}])
    assert assemble._long_copy_answers([sl]) == 1
    assert sl["blocks"][1]["answer"] == "" and sl["blocks"][2] == {"kind": "small", "text": "Why it works, in a sentence of its own.", "basis": "creative"}


def test_a_stale_copy_edit_is_skipped(fin, monkeypatch):
    deck = {"order": ["s01"], "slides": {"s01": {"title": "T", "blocks": [{"kind": "text", "text": "Riders doubt the ferry is for them."}]}}}
    assert assemble.apply_copy(deck, [{"slide": "T", "field": "b0", "text": "A different point entirely now."}]) == 0
    assert assemble.apply_copy(deck, [{"slide": "T", "field": "b0", "text": "Riders doubt the ferry."}]) == 1


# ---------------------------------------------------------------- 8. the proposition never argues against the rejected alternative

def _pair(title):
    prop = {"type": "proposition", "status": "drafted", "title": title, "blocks": [], "notes": ""}
    comp = {"type": "competition", "status": "drafted", "title": "The real alternative is the brief's own 'No catch' line.", "notes": "",
            "blocks": [{"kind": "table", "rows": [["The alternative", "Why", "How we win"], ["A campaign that leads with 'free, no catch'", "Safe", "Ours asks"]]}]}
    return prop, comp


def test_the_contradiction_is_fixed_when_a_sentence_can_leave():
    prop, comp = _pair("Free help from your own council. No catch.")
    got = finish.contradictions([prop, comp])
    assert prop["title"] == "Free help from your own council." and got[0]["fixed"] and "Contradiction check" in prop["notes"]


def test_the_contradiction_is_flagged_when_nothing_can_leave():
    prop, comp = _pair("No catch.")
    got = finish.contradictions([prop, comp])
    assert prop["title"] == "No catch." and not got[0]["fixed"] and "to fix by hand" in comp["notes"]
    prop, comp = _pair("Help from your own council.")
    assert finish.contradictions([prop, comp]) == []
