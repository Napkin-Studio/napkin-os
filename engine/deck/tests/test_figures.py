"""The figure guard (deck/figures.py): a number no input states is taken off the slide, logged, and numbers_trace then passes.
Invented fixtures only (a made-up home-heating brief); no model, no renderer, no client material."""
from deck import figures, pitch_ready, validate
from deck.inputs import Inputs

PROMPTS = figures.__file__.rsplit("/", 1)[0] + "/prompts/"


def _inp():
    """An invented brief that states two figures: a nine-month run and 4,000 homes."""
    return Inputs(brief={"objective": {"value": "Sign up 4,000 homes over a 9 month run.", "mark": "", "kind": "client"}},
                  how_to_win={}, open_questions=[], facts={}, findings={})


def _sl(type_="audience", title="Wary owners wait to hear who pays", **kw):
    s = {"type": type_, "section": "x", "title": title, "blocks": [], "claims": [], "visual": {}, "status": "drafted", "requirements": [], "notes": ""}
    s.update(kw)
    return s


def _deck(*slides):
    order = [f"s{i:02d}" for i in range(1, len(slides) + 1)]
    return {"meta": {}, "requirements": {}, "order": order, "slides": dict(zip(order, slides))}


def _trace(deck, inp):
    return [f for f in validate.run(deck, inp) if f["check"] == "numbers_trace"]


def test_the_phase_27_shapes_are_reworded_without_the_figure():
    bad = lambda *n: {float(x) for x in n}   # noqa: E731
    none = lambda n: False                   # noqa: E731
    assert figures.reword("Nora, 71. Keeps the heating low and wants to know who pays.", bad(71), none) == "Nora. Keeps the heating low and wants to know who pays."
    assert figures.reword("Radio (40 seconds) and a weekly audio update", bad(40), none) == "Radio and a weekly audio update"
    assert figures.reword("Role: Hero 45-second spot that turns doubt into the call.", bad(45), none) == "Role: Hero spot that turns doubt into the call."
    assert figures.reword("Turns each of the 75 docking points into proof.", bad(75), none) == "Turns each of the docking points into proof."
    assert figures.reword("Months 3 to 7", bad(3, 7), none) == "Timing to agree"
    assert figures.reword("Months 1–4", bad(4), lambda n: n == 1) == "From month 1"
    assert figures.reword("Months 6–9", bad(6), lambda n: n == 9) == "By month 9"
    assert figures.reword("Up to 12 per cent less heat lost.", bad(12), none) == "Less heat lost."
    assert figures.reword("63", bad(63), none) is None


def test_the_guard_takes_every_untraced_figure_off_and_numbers_trace_passes():
    inp = _inp()
    d = _deck(
        _sl(blocks=[{"kind": "text", "text": "Nora, 71. Keeps the heating low and wants to know who pays."}]),
        _sl("execution", "Radio carries the answer", blocks=[{"kind": "text", "text": "Role: Hero 45-second spot that turns doubt into the call."},
                                                            {"kind": "copy", "lines": ["Who pays? We do."], "basis": "creative"}]),
        _sl("timeline", "The run builds over 9 months", blocks=[{"kind": "bullets", "items": [{"text": "Months 3 to 7: door drops"}, {"text": "Month 9: results"}]}]),
        _sl("objective", "We aim for 4,000 homes", blocks=[{"kind": "stats", "items": [{"value": "38%", "label": "of owners say yes"}, {"value": "4,000", "label": "homes"}]},
                                                          {"kind": "text", "text": "63"}]),
    )
    assert len(_trace(d, inp)) >= 5
    cut = figures.guard(d, inp)
    assert _trace(d, inp) == []
    s = d["slides"]
    assert s["s01"]["blocks"][0]["text"] == "Nora. Keeps the heating low and wants to know who pays."
    assert s["s02"]["blocks"][0]["text"] == "Role: Hero spot that turns doubt into the call."
    assert s["s02"]["blocks"][1]["lines"] == ["Who pays? We do."]                       # creative copy is copy_number's, not the guard's
    assert [i["text"] for i in s["s03"]["blocks"][0]["items"]] == ["Timing to agree: door drops", "Month 9: results"]   # 9 is in the brief
    assert [i["value"] for i in s["s04"]["blocks"][0]["items"]] == ["4,000"]              # the untraced stat goes; the brief's stays
    assert len(s["s04"]["blocks"]) == 1                                                   # a block that was only a figure goes
    assert {c["figure"] for c in cut} == {"71", "45", "3", "7", "38", "63"}
    assert d["meta"]["figures_removed"] == cut
    for sid in ("s01", "s02", "s03", "s04"):
        assert "Figure removed:" in s[sid]["notes"]


def test_a_cited_or_stated_figure_is_left_alone():
    inp = _inp()
    d = _deck(_sl(blocks=[{"kind": "text", "text": "Sign up 4,000 homes over the 9 month run."}]))
    assert figures.guard(d, inp) == [] and "figures_removed" not in d["meta"]
    assert d["slides"]["s01"]["blocks"][0]["text"] == "Sign up 4,000 homes over the 9 month run."


def test_a_title_with_an_untraced_figure_is_reworded():
    inp = _inp()
    d = _deck(_sl(title="Three in 5 owners wait for a neighbour to go first"))
    figures.guard(d, inp)
    assert "5" not in d["slides"]["s01"]["title"] and d["slides"]["s01"]["title"]
    assert _trace(d, inp) == []


def test_the_removed_figures_join_the_needs_a_person_list():
    inp = _inp()
    d = _deck(_sl("title", "Warm homes, said plainly", notes="cover"),
              _sl(blocks=[{"kind": "text", "text": "Nora, 71. Keeps the heating low."}]))
    pitch_ready.needs_person(d)                       # nothing needs a person yet: no list
    figures.guard(d, inp)
    added = pitch_ready.list_removed_figures(d)
    page = next(x for x in d["slides"].values() if x.get("role") == "needs_person")
    assert added and any(figures.NEEDS in i["text"] for i in page["blocks"][0]["items"])
    assert figures.NEEDS in d["slides"]["s01"]["notes"]
    assert "71" not in " ".join(i["text"] for i in page["blocks"][0]["items"])   # the list names the slide, never the figure


def test_stage_b_and_d_prompts_hold_the_figures_rule():
    for name in ("b_storyline.md", "d_idea.md"):
        text = open(PROMPTS + name).read()
        assert "Figures: every number you write" in text and "write no digit" in text, name
        assert text.index("Figures:") < text.index("Inputs are the only source:"), name
    assert "no age, income or family size" in open(PROMPTS + "b_storyline.md").read()
