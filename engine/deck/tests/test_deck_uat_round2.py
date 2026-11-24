"""The final full-flow UAT run on Tidewell (2026-11-23) found more Deck faults. One test per fault, offline.
Run from engine/: ``PYTHONPATH=. python3 -m pytest deck/tests/test_deck_uat_round2.py``."""
from __future__ import annotations

from deck import assemble, inputs


def test_a_number_in_the_brief_or_the_plan_is_text_not_a_float():
    inp = inputs.Inputs(brief={"budget_scope": {"value": 150000.0}})
    assert assemble._brief_text(inp, "budget_scope", "") == "150,000"   # was a float: "Budget given: " + 150000.0 raised TypeError
    inp = inputs.Inputs(brief={"budget_scope": {"value": 12.5}})
    assert assemble._brief_text(inp, "budget_scope", "") == "12.5"


# ---- helpers: the invented Lumen Water project the suite builds decks from
import copy
import json
from pathlib import Path

from deck import export_clean, images

HERE = Path(__file__).parent
LUMEN = HERE / "fixtures" / "lumen_water"
_FILES = {"a": "a_requirements.json", "b": "b_storyline.json", "c": "c_territories.json", "d": "d_idea.json"}


def _stages():
    return {k: json.loads((LUMEN / f).read_text()) for k, f in _FILES.items() if (LUMEN / f).exists()}


def _inp(**kw):
    return inputs.load(LUMEN / "brief_object.json", **kw)


def _build(st=None, inp=None, **kw):
    return assemble.build(inp or _inp(), st or _stages(), client="Lumen Water", project="Working name", **kw)


def _text_of(deck, kinds=None):
    out = []
    for sid in deck["order"]:
        sl = deck["slides"][sid]
        out.append((sid, sl["type"], json.dumps([sl["title"], sl["blocks"]], ensure_ascii=False)))
    return out


def test_a_float_baseline_in_the_measurement_plan_builds_a_deck():
    st = _stages()
    d = copy.deepcopy(st["d"])
    d["measurement"] = [{"kpi": "Cans sampled", "baseline": 23.8, "how": 3, "refs": []}, {"kpi": 12, "baseline": 0.0, "how": "x", "refs": []}]
    st["d"] = d
    deck = _build(st)   # was: TypeError: can only concatenate str (not "float") to str
    sl = next(x for x in deck["slides"].values() if x["type"] == "measurement")
    assert sl["claims"][0]["text"] == "Cans sampled baseline 23.8"
    assert sl["blocks"][0]["rows"][1][1] == "23.8"


def test_no_evidence_id_reaches_a_slide_or_a_clean_note():
    st = _stages()
    t = st["c"]["territories"][0]
    t["why"] = "Discomfort persists (f_5DEE970AA5E35B536007FC08, f_CD3B112B9AF2355CA99D9D81), even though most do not mind (brief:audience, req:r6)."
    t["risks"] = "The swap test fails this insight (c2), and alcohol cues bring stricter rules (fi_VJVH7RS7CNRE)."
    deck = _build(st)
    sl = next(x for x in deck["slides"].values() if x["type"] == "territory")
    shown = json.dumps(sl["blocks"])
    for bad in ("f_5DEE", "brief:audience", "req:r6", "(c2)", "fi_VJVH"):
        assert bad not in shown, bad
    assert "Discomfort persists, even though most do not mind." in shown
    # the notes of an export keep no id either, wherever it sits in a line
    assert export_clean.notes_of("Said once (brief:objectives, req:r2).\n\nEvidence:\n[req:R3]") == "Said once."
    assert export_clean.strip_ids("a [brief:insight, f_ab12cdef] b") == "a b"
    assert export_clean.strip_ids("Plain 'c2' text and brief:foo.") == "Plain 'c2' text and."


def test_to_confirm_never_reaches_a_clean_export_even_in_the_to_supply_cards():
    deck = _build()
    deck["slides"]["s99"] = assemble._slide("team", "The team", [{"kind": "bullets", "items": [
        {"text": "[project lead]. To confirm: name and one-page CV.", "human": True}]}], status="needs_human")
    deck["order"].append("s99")
    export_clean.scrub(deck)
    everything = json.dumps([(s["title"], s["blocks"]) for s in deck["slides"].values()])
    assert "To confirm" not in everything.replace("Open items to confirm", ""), [m for m in __import__("re").findall(r".{30}To confirm.{20}", everything)][:3]
    assert "To settle: name and one-page CV" in everything


def test_a_persona_the_inputs_never_named_is_left_out():
    st = _stages()
    st["b"]["audience"]["persona"] = {"name": "Maya, 31", "line": "I'll get the next round in.", "basis": "creative"}
    deck = _build(st)
    assert "Maya" not in json.dumps([s["blocks"] for s in deck["slides"].values()])
    # a persona the brief itself describes is kept
    inp = _inp()
    inp.brief["audience"]["value"] = "Maya, 31, after-work professional who stays in the round."
    st["b"]["audience"]["persona"] = {"name": "Maya, 31", "line": "I'll get the next round in.", "basis": "creative"}
    deck = _build(st, inp)
    assert "Maya" in json.dumps([s["blocks"] for s in deck["slides"].values() if s["type"] == "audience"])


def test_the_questions_slide_lists_only_open_questions():
    inp = _inp()
    inp.open_questions = [{"question": "What is the budget? — Answer: £150,000 including VAT.", "why": "", "priority": "normal"},
                          {"question": "Who signs off the line?", "why": "", "priority": "normal"}]
    deck = _build(inp=inp)
    sl = next(x for x in deck["slides"].values() if x["type"] == "questions")
    assert [i["text"] for i in sl["blocks"][0]["items"]] == ["Who signs off the line?"]
    assert inputs.answered_question("Is it cleared? — Answer: yes") and not inputs.answered_question("Is it cleared?")


def test_a_clearance_rule_is_a_note_not_a_line_on_the_slide():
    st = _stages()
    st["a"]["requirements"].append({"id": "m99", "kind": "mandatory", "text": "Use 'Cornish' only once legal has cleared it.", "ref": "brief:mandatories"})
    deck = _build(st)
    sl = next(x for x in deck["slides"].values() if x["type"] == "guardrails")
    assert "Cornish" not in json.dumps(sl["blocks"]) and "Cornish" in sl["notes"]


def test_investment_slide_keeps_the_agencys_provenance_off_the_client_text():
    inp = _inp()
    inp.brief["budget_scope"]["value"] = ("Budget: £150,000 including VAT, with media outside it (agreed since the client's email, which said only "
                                          "'smaller than we'd like, TBC'). Scope: April teaser.")
    deck = _build(inp=inp)
    sl = next(x for x in deck["slides"].values() if x["type"] == "investment")
    text = sl["blocks"][0]["text"]
    assert "agreed since" not in text and "email" not in text and text.startswith("Budget given: £150,000 including VAT")


def test_a_production_deck_is_titled_with_the_client_and_its_line_and_the_strip_title_counts_the_frames():
    st = _stages()
    st["d"]["campaign_line"] = "Tide's in."
    first = lambda **kw: next(iter(_build(st, **kw)["slides"].values()))["title"]   # noqa: E731
    assert first(production=True, working_title="Working name") == "Lumen Water: Tide's in."
    assert first(production=True, working_title="Another name") == "Lumen Water: Working name"   # a project name the person typed stays
    assert first() == "Lumen Water: Working name"
    sl = {"title": "Storyboard frames (5 stills)", "label": "Storyboard frames (5 stills)",
          "blocks": [{"kind": "text", "text": "Role: Shows the round in five still pictures, from arrival to the order."}]}
    images.fit_storyboard_copy(sl, [1, 2, 4, 5])
    assert sl["title"] == "Storyboard frames (4 stills)" and "four still pictures" in sl["blocks"][0]["text"]
