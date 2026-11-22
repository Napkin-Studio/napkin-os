"""Brief gaps (spec.BRIEF_GAPS) and the leftovers of the last blind re-judge (spec.FINISH), held in code.

A blind test on three weak real client briefs (19 Nov 2026): decks built from the raw brief beat the brief-research-deck pipeline 3 of 3,
and no deck said what was wrong with the brief. So: a presented "What the brief doesn't tell us" slide from the brief's ``brief_issues``
(on a prompt-only run, the intake's own detection); a passage another brief left behind never becomes an objective; a clean ask with
"What we need from you" as one appendix list; script annotations in the notes; a hero figure fitted on its digits' real width, and a QA
error when text runs out of its frame into other text; a reply with prose after its JSON read in one call.

Offline: no model, no LibreOffice. Every brand, brief and reply is invented. The suite runs with DECK_FINISH=0 and DECK_BRIEF_GAPS=0
(conftest), so each test turns what it needs on."""
from __future__ import annotations

import copy
import json
import sys
from pathlib import Path

import pytest
from pptx import Presentation
from pptx.util import Inches, Pt

from deck import assemble, finish, inputs, numfmt, profiles, qa_render, render_pptx as R, spec, stages, validate
from deck import theme as T
from deck.inputs import Inputs

HERE = Path(__file__).parent
FIX = HERE / "fixtures" / "lumen_water"
TYPES = HERE / "fixtures" / "types"
FILES = {"a": "a_requirements.json", "b": "b_storyline.json", "c": "c_territories.json", "d": "d_idea.json"}
FOREIGN = "Celebrate 30 years of Crumbly Biscuits with a family-recipe story"


@pytest.fixture
def gaps(monkeypatch):
    """Brief gaps and the finish fixes on, with the look they ship with."""
    monkeypatch.setattr(spec, "BRIEF_GAPS", True)
    monkeypatch.setattr(spec, "FINISH", True)
    monkeypatch.setattr(spec, "LOOK_V3", True)
    monkeypatch.setattr(numfmt, "UNITS_METRIC", False)


def _st(folder: Path) -> dict:
    return {k: json.loads((folder / f).read_text()) for k, f in FILES.items() if (folder / f).exists()}


def _sketch():
    """A prompt-only deck (path A): no brief tool ran, the recorded intake has no brief_issues, so the rule checks stand in."""
    inp = inputs.load(None, prompt_text=(TYPES / "agency_pitch" / "prompt.txt").read_text().strip())
    return assemble.build(inp, _st(TYPES / "agency_pitch"), client="Lumen Water", project="Water saving", profile=profiles.load("agency_pitch"))


def _pres(d) -> list:
    return [d["slides"][x] for x in validate.presented(d)]


def _texts(sl) -> list:
    return [str(i.get("text") if isinstance(i, dict) else i) for b in sl["blocks"] for i in b.get("items") or []] + \
           [str(b.get("text") or "") for b in sl["blocks"]]


# ------------------------------------------------------------------------------------------------ the slide, both paths

def test_a_prompt_only_deck_shows_what_the_brief_doesnt_tell_us(gaps):
    d = _sketch()
    pres = _pres(d)
    at = next(i for i, s in enumerate(pres) if s.get("role") == "brief_gaps")
    sl = pres[at]
    assert sl["title"] == spec.BRIEF_GAPS_TITLE and pres[at - 1]["type"] in ("objective", "title")   # right after what the brief asks
    assert any("budget" in t.lower() for t in _texts(sl))   # the prompt gives no budget figure (a rule check, no model)
    assert sl["section"] == "The brief" and "Why it matters" in sl["notes"]
    assert d["meta"]["brief_gaps"][0]["kind"] == "missing"


def test_the_slide_is_off_with_the_flag_off(monkeypatch):
    monkeypatch.setattr(spec, "FINISH", True)
    monkeypatch.setattr(spec, "LOOK_V3", True)
    d = _sketch()
    assert not [s for s in d["slides"].values() if s.get("role") == "brief_gaps"] and "brief_gaps" not in d["meta"]


def _foreign_brief():
    """Path B: a brief object whose brief tool flagged another company's objective, and a requirement that still carries it."""
    inp = inputs.load(FIX / "brief_object.json")
    inp.brief_issues = [
        {"id": "bi_01", "kind": "foreign_content", "topic": "objective", "what": "One objective is another company's anniversary.",
         "why_it_matters": "The work would chase someone else's goal.", "question": "Which objectives belong to this campaign?",
         "quote": FOREIGN, "source": "model"},
        {"id": "bi_02", "kind": "missing", "topic": "timing", "what": "No launch date.", "why_it_matters": "Media cannot be booked.",
         "question": "When should the campaign go live?", "quote": "", "source": "rule"}]
    st = _st(FIX)
    st["a"] = copy.deepcopy(st["a"])
    st["a"]["requirements"].append({"id": "r_04", "kind": "objective", "text": FOREIGN, "ref": "doc:brief#objectives"})
    inp.brief["background"]["value"] = FOREIGN + "."
    return inp, st


def test_a_foreign_objective_never_reaches_a_slide_and_leads_the_questions(gaps):
    inp, st = _foreign_brief()
    d = assemble.build(inp, st, client="Lumen Water", project="Water saving", fmt="pitch")
    shown = json.dumps([d["slides"][x]["blocks"] for x in d["order"] if d["slides"][x].get("role") != "brief_gaps"], ensure_ascii=False)
    assert "Crumbly" not in shown   # not on the objective slide, the read-back or anywhere else
    assert inp.brief["background"]["value"] is None   # the brief field that repeated it is emptied
    gs = next(s for s in _pres(d) if s.get("role") == "brief_gaps")
    assert _texts(gs)[0] == ("Part of the brief (the objective) appears to come from another brand's brief; we've set it aside. "
                             "Which objectives belong to this campaign?") and "another brief's text" in gs["notes"]
    assert _texts(gs)[1] == "When should the campaign go live?"   # a missing basic stays its question


def test_a_contradiction_is_stated_plainly_on_the_gaps_slide():
    line = assemble.gap_line({"kind": "contradiction", "topic": "timing", "question": "Which dates hold?"})
    assert line == "The brief contradicts itself on the timing. Which dates hold?"
    assert assemble.gap_line({"kind": "foreign_content", "topic": "other", "question": ""}) == (
        "Part of the brief appears to come from another brand's brief; we've set it aside. Please confirm.")
    assert assemble.gap_line({"kind": "missing", "topic": "budget", "question": "What is the budget?"}) == "What is the budget?"


def test_the_intake_runs_the_same_detection_and_verifies_its_quotes(monkeypatch):
    monkeypatch.setattr(spec, "BRIEF_GAPS", True)
    prompt = (f"Brightbarn opens two stores this spring. {FOREIGN}. We want 5,000 loyalty sign-ups by June. "
              "Our audience is families nearby. The budget is EUR 80,000.")
    inp = inputs.load(None, prompt_text=prompt)
    part = {"fields": {}, "questions": [], "brief_issues": [
        {"kind": "foreign_content", "topic": "objective", "what": "A biscuit anniversary in a store brief.", "why_it_matters": "Wrong goal.",
         "question": "Is the biscuit anniversary part of this brief?", "quote": FOREIGN},
        {"kind": "contradiction", "topic": "brand", "what": "Made up.", "why_it_matters": "x", "question": "Which?", "quote": "never said"}]}
    out = stages.merge_a0([part], set(), "agency", inp)
    assert [i["kind"] for i in out["brief_issues"]] == ["foreign_content"] and out["brief_issues"][0]["source"] == "model"
    import brief_issues
    assert brief_issues.PROMPT.splitlines()[0] in _a0_system(monkeypatch, inp)


def _a0_system(monkeypatch, inp) -> str:
    """The system prompt stage a0 sends for ``inp`` (the call is faked)."""
    seen = {}

    def call(stage, user, system):
        seen["system"] = system
        return {"fields": {}, "questions": []}, {"usd": 0}
    monkeypatch.setattr(stages, "_call", call)
    monkeypatch.setattr(stages, "_sum", lambda us: {})
    try:
        stages.intake(inp)
    except Exception:   # noqa: BLE001  (only the prompt it sent is read here)
        pass
    return seen.get("system", "")


# ------------------------------------------------------------------------------------------------ the ask and the appendix list

def test_the_close_is_a_clean_ask_with_no_blank(gaps):
    d = _sketch()
    ask = next(s for s in _pres(d) if s["type"] == "next_step")
    words = " ".join(_texts(ask))
    assert ask["status"] == "drafted" and ask["blocks"][0]["kind"] == "statement" and "Every drop has a story" in ask["blocks"][0]["text"]
    assert "[" not in words and "decision date" not in words.lower() and "case stud" not in words and "the team" not in words
    assert "Answer the questions the brief leaves open" in words
    found = validate.run(d, inputs.load(None, prompt_text="x"))
    assert not [f for f in found if f["check"] == "placeholder" and f.get("slide") == next(k for k, v in d["slides"].items() if v is ask)]
    asks = next(s for s in d["slides"].values() if s.get("role") == "client_asks")
    items = _texts(asks)
    assert asks["title"] == spec.CLIENT_ASKS_TITLE and finish.DECISION_ASK in items and any("budget" in t.lower() for t in items)


def test_a_stated_decision_date_is_the_only_date_the_ask_shows():
    assert finish.decision_date("We will decide on 14 March 2027 after the presentations.") == "14 March 2027"
    assert finish.decision_date("The campaign runs in March.") is None
    rows = finish.close_blocks("Every drop has a story.", "14 March 2027", gaps=False)[1]["items"]
    assert [r["text"] for r in rows] == ["A decision by 14 March 2027."]
    assert finish.client_asks(["What budget should the work fit?"], [{"type": "team"}, {"type": "competition"}], None) == \
        ["What budget should the work fit?", finish.CLIENT_ASKS["competition"], finish.DECISION_ASK]


# ------------------------------------------------------------------------------------------------ annotations go to the notes

def test_script_annotations_and_source_talk_go_to_the_notes():
    S = [{"type": "execution", "title": "Radio", "notes": "", "blocks": [
            {"kind": "text", "text": "Role: make the saving feel shared."},
            {"kind": "copy", "lines": ["Every drop has a story."], "answer": "Dramatises the 'careful already' half: the count comes home."}]},
         {"type": "proposition", "title": "One thought", "notes": "", "blocks": [
            {"kind": "bullets", "items": [{"text": "A shared goal of 5%."}, {"text": "Proof points are not in the inputs; the client supplies them."}]},
            {"kind": "quote", "text": "The inputs are what we use."}]},
         {"type": "competition", "title": "The alternative", "notes": "", "blocks": [
            {"kind": "table", "rows": [["The inputs", "Why"], ["Do nothing", "The inputs note a past scheme. It costs less."]]}]}]
    assert finish.annotations_to_notes(S) == 3
    assert S[2]["blocks"][0]["rows"] == [["The inputs", "Why"], ["Do nothing", "It costs less."]]   # a cell loses it; the header stays
    assert S[0]["blocks"][1]["answer"] == "" and S[0]["blocks"][1]["lines"] == ["Every drop has a story."]
    assert "Dramatises the 'careful already' half" in S[0]["notes"] and finish.ANNOTATION_NOTE in S[0]["notes"]
    assert [i["text"] for i in S[1]["blocks"][0]["items"]] == ["A shared goal of 5%."]
    assert S[1]["blocks"][1]["text"] == "The inputs are what we use."   # a quote is the client's words: never split


# ------------------------------------------------------------------------------------------------ the hero figure and the QA

def test_a_figure_is_fitted_on_its_digits_real_width(monkeypatch):
    monkeypatch.setattr(spec, "LOOK_V3", True)
    assert T.is_figure("20,000") and T.is_figure("15%") and not T.is_figure("Within 6 months") and not T.is_figure("EUR 120,000")
    r = R.Renderer(json.loads((FIX / "golden_deck.json").read_text()), Inputs(brief={}), theme="napkin")
    w = 6 * 98 * T.fit_wf("Archivo", True) / 72 + 0.05   # wide enough for six mean-width glyphs at 98 pt, not for six digits
    assert r.nlines("20,000", w, 98, True, r.th.head) == 2 and not r._units_fit("20,000", w, 98)
    assert r.nlines("Abcdef", w, 98, True, r.th.head) == 1   # running text keeps the mean width


def _deck_pptx(tmp_path, build):
    prs = Presentation()
    prs.slide_width, prs.slide_height = Inches(13.333), Inches(7.5)
    sl = prs.slides.add_slide(prs.slide_layouts[6])
    build(sl)
    p = tmp_path / "d.pptx"
    prs.save(p)
    return p


def _box(sl, x, y, w, h, text, size, name, font="Archivo"):
    tb = sl.shapes.add_textbox(Inches(x), Inches(y), Inches(w), Inches(h))
    tb.name = name
    tb.text_frame.word_wrap = True
    r = tb.text_frame.paragraphs[0].add_run()
    r.text, r.font.size, r.font.bold, r.font.name = text, Pt(size), True, font
    return tb


def _broken_hero(sl):
    """The re-judged slide 2: '20,000' at 98 pt in a 3.6 in panel (it wraps as '20,00' over '0'), 'By when' right under its first line."""
    _box(sl, 0.8, 2.0, 3.6, 1.3, "20,000", 98, "Hero")
    _box(sl, 0.8, 3.4, 3.6, 0.4, "BY WHEN", 12, "Caption")
    _box(sl, 0.8, 3.8, 3.6, 0.6, "WITHIN 6 MONTHS", 30, "Date")


def test_qa_errors_when_a_hero_runs_out_of_its_frame_into_other_text(monkeypatch, tmp_path):
    monkeypatch.setattr(spec, "LOOK_V3", True)
    monkeypatch.setattr(spec, "FINISH", True)
    res = qa_render.check_pptx(_deck_pptx(tmp_path, _broken_hero))
    found = [f for fs in res["slides"].values() for f in fs]
    assert {"text_collision", "word_break"} <= {f["check"] for f in found if f["level"] == "error"}
    monkeypatch.setattr(spec, "FINISH", False)   # the flag off: the old warning only, as before
    res = qa_render.check_pptx(_deck_pptx(tmp_path, _broken_hero))
    assert not [f for fs in res["slides"].values() for f in fs if f["check"] in ("text_collision", "word_break")]


def test_frames_that_fit_raise_no_collision(monkeypatch, tmp_path):
    monkeypatch.setattr(spec, "LOOK_V3", True)
    monkeypatch.setattr(spec, "FINISH", True)

    def fine(sl):
        _box(sl, 0.8, 2.0, 4.4, 1.3, "20,000", 72, "Hero")
        _box(sl, 0.8, 3.5, 4.4, 0.4, "BY WHEN", 12, "Caption")
    res = qa_render.check_pptx(_deck_pptx(tmp_path, fine))
    assert not [f for fs in res["slides"].values() for f in fs if f["check"] in ("text_collision", "word_break")]


# ------------------------------------------------------------------------------------------------ one call, not four

#: The shape of a captured stage b reply (19 Nov 2026), content invented: fenced JSON, then a paragraph after the fence.
TRAILING_PROSE = '```json\n{"reframe": {"title": "The job is a shared saving", "line": "Use less, together.", "claims": []}}\n```\n\n' \
                 '**Questions for the client.** The evidence is thin:\n1. What is the baseline?\n2. When is the budget set?'


def test_a_reply_with_prose_after_its_json_is_read_in_one_call(monkeypatch):
    import brief_llm
    calls = []

    def link(provider, model, user, **kw):
        calls.append(model)
        return TRAILING_PROSE
    monkeypatch.setattr(brief_llm, "_call_link", link)
    obj, usage = stages._call("b", "the storyline input", "the storyline prompt")
    assert obj["reframe"]["line"] == "Use less, together." and calls == [stages.MODELS["b"]] and "repaired" not in usage
