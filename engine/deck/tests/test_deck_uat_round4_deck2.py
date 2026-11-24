"""UAT round 4, the second deck (Copperell, a fictional refill brand): F27 the cover's picture, F28 the legal line, F29 the pitch's length,
F30 the idea line's case."""

from __future__ import annotations

import copy
import json
from pathlib import Path

import pytest

from deck import assemble, inputs, layouts, profiles, spec

HERE = Path(__file__).parent
LUMEN = HERE / "fixtures" / "lumen_water"
LONG = "Copperell Home Ltd: watch one tablet fizz into 500 ml of cleaner in tap water, and the bottle earns its place on your worktop."
LEGAL = "Keep out of reach of children. Read the label before use."


@pytest.fixture(autouse=True)
def look(monkeypatch):
    monkeypatch.setattr(spec, "LOOK_V2", True)
    monkeypatch.setattr(spec, "LOOK_V3", True)
    monkeypatch.setattr(spec, "GRAPHICS", True)


def _stages():
    return {k: json.loads((LUMEN / f).read_text()) for k, f in (("a", "a_requirements.json"), ("b", "b_storyline.json"), ("c", "c_territories.json"), ("d", "d_idea.json"))}


def _story(deck):
    o = deck["order"]
    cut = next((i for i, k in enumerate(o) if deck["slides"][k]["type"] == "appendix"), len(o))
    return [deck["slides"][k] for k in o[:cut]]


# ================================================================================================ F27 the cover keeps the key visual
def _cover_deck():
    """The UAT cover as built: a long title and the Final key visual from Production on its picture slot (before the plan)."""
    s = {"type": "title", "section": "Opening", "title": LONG, "label": LONG[:80], "blocks": [], "claims": [], "notes": "", "status": "needs_human",
         "requirements": [], "visual": {"kind": "layout", "hint": "title"},
         "slots": {"picture": {"kind": "image", "image": {"kind": "illustration", "status": "made", "asset": "img_9f7635eef9b0", "basis": "creative",
                                                          "alt": "The campaign's key visual", "focal": {"x": 0.5, "y": 0.43},
                                                          "from": {"kind": "production", "key": "fset_x#master"}}}}}
    return {"meta": {"client": "Copperell Home Ltd", "project": "Copperell Refill", "audience": "review"}, "order": ["s01"], "slides": {"s01": s},
            "assets": {"img_9f7635eef9b0": {"mime": "image/jpeg", "width": 922, "height": 1152}}}


def test_a_cover_holding_productions_key_visual_never_switches_to_a_layout_without_a_picture():
    planned, _issues, _pending = layouts.plan(_cover_deck(), prefs={"density": "lean"})
    lay = planned["slides"]["s01"]["layout"]
    lib = layouts.load()
    assert layouts.image_slots(lib[lay["id"]]), lay   # round 4: 'cards' ("fit ladder: cover too full"), so the cover had no picture


def test_the_cover_names_the_project_when_the_line_is_a_proposition_not_a_line():
    inp = inputs.load(LUMEN / "brief_object.json")
    st = _stages()
    st["d"] = {**st["d"], "campaign_line": "Watch one tablet fizz into 500 ml of cleaner in tap water, and the bottle earns its place on your worktop."}
    deck = assemble.build(inp, st, client="Copperell Home Ltd", project="Copperell Refill", production=True, working_title="Copperell Refill")
    assert deck["slides"][deck["order"][0]]["title"] == "Copperell Home Ltd: Copperell Refill"
    st["d"] = {**st["d"], "campaign_line": "Refill. Not landfill."}   # a short line still names the cover
    deck = assemble.build(inp, st, client="Copperell Home Ltd", project="Copperell Refill", production=True, working_title="Copperell Refill")
    assert deck["slides"][deck["order"][0]]["title"] == "Copperell Home Ltd: Refill. Not landfill."


# ================================================================================================ F28 the legal line is small print, never copy
def test_legal_lines_read_the_mandatories_that_name_words_to_carry():
    inp = inputs.Inputs(brief={"mandatories": {"value": ["The bottle is the hero, logo top right", f"Include '{LEGAL}'",
                                                          "Legal: Terms apply.", "No children near the product"]}})
    assert assemble.legal_lines(inp) == [LEGAL, "Terms apply."]
    keep, took = assemble.take_legal_lines(["Drop. Shake. Now judge us.", "Ribbed amber glass. Keep it for life.", LEGAL], assemble.legal_lines(inp))
    assert keep == ["Drop. Shake. Now judge us.", "Ribbed amber glass. Keep it for life."] and took == [LEGAL]


def test_the_key_visual_slide_never_prints_the_legal_line_as_its_copy():
    inp = inputs.load(LUMEN / "brief_object.json")
    inp.brief = {**inp.brief, "mandatories": {"value": [f"Include '{LEGAL}'"]}}
    st = _stages()
    ex = copy.deepcopy(st["d"]["executions"][0])
    ex.update(channel="Key visual", copy=["Drop. Shake. Now judge us.", "Ribbed amber glass. Keep it for life.", LEGAL])
    st["d"] = {**st["d"], "executions": [ex] + st["d"]["executions"][1:]}
    deck = assemble.build(inp, st, client="Copperell", project="Copperell Refill", production=True)   # a Production deck keeps the slide
    kv = next(s for s in deck["slides"].values() if s["type"] == "execution" and s["title"] == "Key visual")
    lines = [ln for b in kv["blocks"] if b["kind"] == "copy" for ln in b["lines"]]
    assert LEGAL not in lines and "Drop. Shake. Now judge us." in lines   # round 4: printed beside the headline, at its size
    assert LEGAL in kv["notes"]


# ================================================================================================ F29 an agency pitch holds to its cap
def _pitch_19():
    t = lambda ty, title=None: assemble._slide(ty, title or f"A full sentence title for the {ty} slide", [{"kind": "text", "text": f"{ty} line", "basis": "opinion"}])   # noqa: E731
    S = [t(x) for x in ("title", "objective", "real_question", "chart", "insight", "audience", "proposition", "competition", "idea")]
    S += [assemble._slide("execution", ch, [{"kind": "copy", "lines": [ch], "basis": "creative"}]) for ch in ("Key visual", "Storyboard frames", "Out of home")]
    S += [t(x) for x in ("channel_roles", "innovation", "measurement", "measurement_plan", "timeline", "risks", "investment")]
    return S


def test_a_pitch_with_no_stated_limit_holds_to_its_types_cap_by_folding_first():
    S = _pitch_19()
    words = {b["text"] for s in S for b in s["blocks"] if "text" in b}
    out = assemble._arrange_pitch(S, production=True, target=10, cap=12)   # round 4: 19 presented slides, Start said 'usually at most 12'
    story = out[:next(i for i, x in enumerate(out) if x["type"] == "appendix")]
    assert len(story) == 12
    types = [x["type"] for x in story]
    for keep in ("title", "objective", "real_question", "insight", "audience", "proposition", "idea", "investment"):
        assert keep in types
    assert types.count("execution") == 3   # the executions Production's pictures fill never move
    folded = next(x for x in story if x["type"] == "investment")
    assert any(m["type"] == "timeline" for m in folded.get("merged", []))
    after = {b["text"] for s in out for b in s["blocks"] if "text" in b}
    assert words <= after   # nothing dropped: every slide's words are on a presented slide or in the appendix


def test_the_agency_pitch_profiles_cap_reaches_the_arrangement():
    rec = profiles.recipe(profiles.load("agency_pitch"), "pitch")
    assert rec["length"]["cap"] == 12


def test_a_story_of_only_what_never_moves_stays_over_the_cap():
    S = [assemble._slide(t, f"Title {t}", [{"kind": "text", "text": t, "basis": "opinion"}]) for t in ("title", "objective", "real_question", "insight", "audience", "proposition")]
    S += [assemble._slide("territory", f"Territory: Route {n}", [{"kind": "statement", "text": f"Route {n}", "basis": "creative"}]) for n in (1, 2, 3)]
    S += [assemble._slide("idea", "One idea", [{"kind": "statement", "text": "The idea", "basis": "creative"}])]
    S += [assemble._slide("execution", ch, [{"kind": "text", "text": f"Role: {ch}"}]) for ch in ("Outdoor", "Radio", "Social")]
    S += [assemble._slide("investment", "What it costs", [{"kind": "text", "text": "Budget", "basis": "sourced"}])]
    out = assemble._arrange_pitch(S, routes=3, cap=12)
    story = out[:next((i for i, x in enumerate(out) if x["type"] == "appendix"), len(out))]
    assert len(story) == 14   # routes asked for and three executions: the cap never takes them (validate's pitch_cap still warns)


# ================================================================================================ F30 the idea line keeps the brief's case
def test_the_idea_line_takes_the_briefs_case_and_never_starts_lower_case():
    inp = inputs.Inputs(brief={"smp": {"value": "To confirm: Watch one tablet fizz into 500 ml of cleaner."}})
    assert assemble.line_case("watch one tablet fizz into 500 ml of cleaner.", inp) == "Watch one tablet fizz into 500 ml of cleaner."
    assert assemble.line_case("refill. not landfill.", inputs.Inputs(brief={})) == "Refill. not landfill."   # a capital, nothing else changed
    assert assemble.line_case("iPhone made it", inputs.Inputs(brief={})) == "iPhone made it"   # cased on purpose
    inp2 = inputs.load(LUMEN / "brief_object.json")
    st = _stages()
    st["d"] = {**st["d"], "campaign_line": "tide's in."}
    deck = assemble.build(inp2, st, client="Lumen Water", project="Working name")
    idea = next(s for s in deck["slides"].values() if s["type"] == "idea")
    assert idea["title"] == "Tide's in."
