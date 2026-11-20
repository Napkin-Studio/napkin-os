"""Pitch-ready and evidence fixes (spec.PITCH_READY, deck/pitch_ready.py), held in code.

Blind judging of decks built from three real client briefs (20 Nov 2026): evidence 3-5/10 (nothing beyond the brief), take-to-pitch 3-6/10
(a placeholder cover, a DRAFT banner on every slide, empty picture frames, internal reference codes on client slides). So: the evidence
track's sourced figures on the insight, audience and proposition slides with a source tag; "to confirm" only beside an unverified figure;
uncited market claims softened; a real cover; a quiet footer draft tag with the list in the notes and an appendix slide; picture subjects
from the chosen territory; every internal code scrubbed, and code_leak an error in validate and in the rendered-slide QA.

Offline: no model, no LibreOffice. Every brand, brief, finding and URL is invented. The suite runs with DECK_PITCH_READY=0 (conftest), so
each test turns it on."""
from __future__ import annotations

import json
from pathlib import Path

import pytest
from pptx import Presentation

from deck import assemble, imagegen, inputs, pitch_ready as PR, profiles, qa_render, render_pptx, spec, stages, validate

HERE = Path(__file__).parent
TYPES = HERE / "fixtures" / "types" / "agency_pitch"
FILES = {"a": "a_requirements.json", "b": "b_storyline.json", "c": "c_territories.json", "d": "d_idea.json"}
EVIDENCE = {"version": 1, "market": "Ireland", "category": "public_sector", "local": 2, "short_of_local": True, "findings": [
    {"claim": "Households in Ireland used 128 litres a day per person in 2023.", "short": "Irish homes used 128 litres a person a day",
     "figure": "128 litres", "value": 128, "unit": "litres a day", "metric": "daily use", "market": "Ireland", "local": True, "year": "2023",
     "source": "Statistics Office (Water Survey 2023)", "source_kind": "statistics office", "url": "https://stats.example.ie/water",
     "supports": "insight"},
    {"claim": "Only 31% of adults could say what their household uses in a week.", "short": "31% of adults know their weekly household use",
     "figure": "31%", "value": 31, "unit": "percent", "market": "Ireland", "local": True, "year": "2024", "source": "Utility Regulator",
     "source_kind": "regulator", "url": "https://regulator.example.ie/r", "supports": "audience"},
    {"claim": "Neighbour comparison letters cut household use by 5.6%.", "figure": "5.6%", "value": 5.6, "unit": "percent",
     "market": "US figure", "local": False, "year": "2019", "source": "Example Journal", "url": "https://journal.example.org/a",
     "supports": "proposition"},
    {"claim": "No URL, never read.", "market": "Ireland"}]}


@pytest.fixture
def on(monkeypatch):
    monkeypatch.setattr(spec, "PITCH_READY", True)


def _st() -> dict:
    return {k: json.loads((TYPES / f).read_text()) for k, f in FILES.items()}


def _inp(tmp_path=None, evidence=True):
    inp = inputs.load(None, prompt_text=(TYPES / "prompt.txt").read_text().strip())
    if evidence and tmp_path is not None:
        p = tmp_path / "evidence.json"
        p.write_text(json.dumps(EVIDENCE))
        f, s = PR.load_evidence(p)
        inp.facts.update(f)
        inp.sources.update(s)
    return inp


def _deck(inp, client="Lumen Water", project="Water saving", st=None):
    return assemble.build(inp, st or _st(), client=client, project=project, profile=profiles.load("agency_pitch"))


def _pres(d) -> list:
    return [d["slides"][x] for x in validate.presented(d)]


# ------------------------------------------------------------------------------------------------ evidence

def test_evidence_is_read_as_cited_facts_with_their_sources(tmp_path):
    inp = _inp(tmp_path)
    assert sorted(k for k in inp.facts if k.startswith("f_ev")) == ["f_ev1", "f_ev2", "f_ev3"]   # the finding with no URL is not read
    f1 = inp.facts["f_ev1"]
    assert f1["origin"] == "evidence" and f1["confidence"] == "high" and f1["as_of"] == "2023" and f1["market"] == "Ireland"
    assert inp.facts["f_ev3"]["confidence"] == "medium" and not inp.facts["f_ev3"]["local"]
    assert inp.sources["src_ev1"]["uri"] == "https://stats.example.ie/water"
    assert not inp.has_research()   # a prompt-only run with evidence is still built from a prompt: its tier and sketch rule stand
    assert PR.source_tag(f1) == "Statistics Office, 2023, Ireland" and PR.source_tag(inp.facts["f_ev3"]) == "Example Journal, 2019, US"


def test_the_argument_slides_carry_sourced_figures_with_a_source_tag(tmp_path, on):
    inp = _inp(tmp_path)
    d = _deck(inp)
    key = lambda f: (f["check"], f["slide"], f["message"])  # noqa: E731
    before = {key(f) for f in validate.run(d, inp)}
    got = PR.attach_evidence(d, inp)
    by = {d["slides"][g["slide"]]["type"]: g["refs"] for g in got}
    assert set(by) >= {"insight", "proposition"} and all(1 <= len(v) <= PR.EVIDENCE_PER_SLIDE for v in by.values())
    assert by["insight"][0] == "f_ev1" and by["proposition"][0] == "f_ev3"   # by what each finding supports
    ins = next(s for s in _pres(d) if s["type"] == "insight")
    line = next(b for b in ins["blocks"] if b.get("evidence"))
    assert line["basis"] == "sourced" and line["refs"] == ["f_ev1"] and line["text"].endswith("(Statistics Office, 2023, Ireland)")
    assert any(c["refs"] == ["f_ev1"] for c in ins["claims"])
    src = next(s for s in d["slides"].values() if s["type"] == "appendix_sources")
    assert "https://stats.example.ie/water" in json.dumps(src["blocks"]) and ins["footnotes"]
    new = [f for f in validate.run(d, inp) if key(f) not in before]   # the figures and their tags add no finding of these kinds
    assert not [f for f in new if f["check"] in ("numbers_trace", "numbers_uncited", "source_required", "bare_claim", "repeated_line", "code_leak")]


def test_a_full_slide_takes_the_short_form_and_never_goes_without(tmp_path, on):
    f = _inp(tmp_path).facts["f_ev1"]
    assert len(PR.evidence_line(f, tight=True, cap=5).split()) <= 5 + len(PR.source_tag(f).split())
    assert "128" in PR.evidence_line(f, tight=True, cap=5)


def test_to_confirm_stays_only_beside_an_unverified_figure(tmp_path, on):
    inp = _inp(tmp_path)
    d = _deck(inp)
    ins = next(s for s in _pres(d) if s["type"] == "insight")
    ins["blocks"] += [{"kind": "small", "text": "People use 128 litres a day (to confirm).", "refs": ["prompt:1"]},
                      {"kind": "small", "text": "Leaks waste 9,999 litres a year (to confirm).", "refs": ["prompt:1"]}]
    assert PR.clear_confirmed(d, inp) == 1
    assert ins["blocks"][-2]["text"] == "People use 128 litres a day." and "f_ev1" in ins["blocks"][-2]["refs"]
    assert ins["blocks"][-1]["text"].endswith("(to confirm).")   # nothing verifies it: honesty stays


def test_uncited_market_claims_are_softened_and_bare_claims_agree(tmp_path, on):
    inp = _inp(tmp_path, evidence=False)
    d = _deck(inp)
    ins = next(s for s in _pres(d) if s["type"] == "insight")
    ins["blocks"].append({"kind": "text", "text": "Most households say they already save water."})
    ins["claims"] += [{"text": "Most households say they already save water."}, {"text": "Proposal: a monthly household count."}]
    PR.soften_uncited(d)
    assert ins["blocks"][-1]["text"] == PR.SOFT_PREFIX + "Most households say they already save water." and ins["blocks"][-1]["basis"] == "opinion"
    assert [c["basis"] for c in ins["claims"][-2:]] == ["opinion", "proposal"]
    sid = next(x for x in d["order"] if d["slides"][x] is ins)
    assert not [f for f in validate.run(d, inp) if f["check"] == "bare_claim" and f["slide"] == sid]


# ------------------------------------------------------------------------------------------------ internal codes

@pytest.mark.parametrize("raw,want", [
    ("It frames the chosen insight (brief:insight via ic_feeling) as one picture (prompt:29, prompt:9).",
     "It frames the chosen insight as one picture."),
    ("The copy means more reading than prompt:32 wants.", "The copy means more reading than the brief wants."),
    ("It answers the chosen insight (IC1) directly, as candidate C2 asked.", "It answers the chosen insight directly, as an option asked."),
    ("Rests on the brief's audience [req:R4, T1].", "Rests on the brief's audience."),
    ("See https://example.org/a_b_c for more.", "See https://example.org/a_b_c for more."),
])
def test_codes_come_off_a_shown_text(raw, want):
    assert PR.scrub_codes(raw) == want
    assert PR.has_code(PR.scrub_codes(raw)) is None


def test_no_code_reaches_a_slide_and_one_left_is_an_error(tmp_path, on):
    inp = _inp(tmp_path, evidence=False)
    d = _deck(inp)
    terr = next(s for s in d["slides"].values() if s["type"] == "territory")
    terr["blocks"].append({"kind": "bullets", "items": [{"text": "Fits the insight (brief:insight, prompt:2) and T1."}, "Plain line (req:R4)."]})
    terr["notes"] = "Rests on prompt:2."
    assert PR.scrub_deck(d) >= 2
    assert not PR.code_findings(d) and "prompt:2" in terr["notes"]   # the notes keep the codes for the agency
    terr["blocks"].append({"kind": "text", "text": "Left over: ic_behaviour."})
    assert [f["check"] for f in validate.run(d, inp) if f["level"] == "error" and f["check"] == "code_leak"] == ["code_leak"]


def test_the_rendered_slide_qa_fails_on_a_code(on):
    out = []
    qa_render._scan_codes("The brief says so (prompt:43).", out)
    qa_render._scan_codes("Nothing internal here.", out)
    assert [f["check"] for f in out] == ["code_leak"] and out[0]["level"] == "error"


# ------------------------------------------------------------------------------------------------ the cover and the draft tag

def test_a_placeholder_cover_takes_the_brief_names_and_the_month(tmp_path, on):
    inp = _inp(tmp_path, evidence=False)
    d = _deck(inp, client="Brief 2", project="Brief 2")
    rec = PR.cover(d, _st(), "Brief 2", "Brief 2", "[Agency]", brief_meta={"client": "Brief 2", "project": None},
                   names={"client": "Lumen Water", "project": "Every Drop"})
    cov = d["slides"][d["order"][0]]
    assert cov["title"] == "Lumen Water: Every Drop" and rec["from"] == "brief"
    assert cov["blocks"] == [] and cov["status"] == "drafted"   # no placeholder line on the cover; the to-do is in the notes
    assert "who presents, and the date" in cov["notes"] and "picture" in cov["slots"]
    assert d["meta"]["cover_kicker"] == PR.month_year(d) and render_pptx._kicker(d["meta"]) == PR.month_year(d)


def test_with_no_names_the_cover_is_the_campaign_and_an_agency_is_named(tmp_path, on):
    inp = _inp(tmp_path, evidence=False)
    d = _deck(inp, client="[Client]", project="Response deck")
    PR.cover(d, _st(), "[Client]", "Response deck", "Fieldhouse")
    cov = d["slides"][d["order"][0]]
    assert cov["title"] == "The Tap Tells" and cov["blocks"][0]["text"] == "A response from Fieldhouse"
    assert d["meta"]["cover_kicker"].startswith("Fieldhouse · ")
    assert PR.is_placeholder_name("Brief 3") and PR.is_placeholder_name("[Agency]") and not PR.is_placeholder_name("Lumen Water")


def test_the_draft_is_a_quiet_footer_tag_and_the_list_is_in_the_notes_and_appendix(tmp_path, on):
    inp = _inp(tmp_path, evidence=False)
    d = _deck(inp)
    PR.apply(d, inp, _st(), client="Lumen Water", project="Water saving", agency="[Agency]")
    lst = next(d["slides"][x] for x in d["order"] if d["slides"][x].get("role") == "needs_person")
    assert lst["title"] == PR.NEEDS_PERSON_TITLE and d["order"].index(next(x for x in d["order"] if d["slides"][x] is lst)) > len(validate.presented(d))
    assert "What still needs a person:" in d["slides"][d["order"][0]]["notes"]
    hum = next(s for s in d["slides"].values() if s["type"] == "team")
    assert "Needs a person:" in hum["notes"]
    out = render_pptx.render(d, inp, tmp_path / "d.pptx", findings=[])
    prs = Presentation(str(out if isinstance(out, (str, Path)) else tmp_path / "d.pptx"))
    marks = [(sh.top / 914400, sh.text_frame.text) for sl in prs.slides for sh in sl.shapes if sh.name == "Watermark"]
    assert marks and all(t == PR.DRAFT_TAG and top > 6.5 for top, t in marks)   # in the footer, never a banner at the top
    assert qa_render.DRAFT_MARK.fullmatch(PR.DRAFT_TAG)


# ------------------------------------------------------------------------------------------------ pictures

def test_picture_subjects_come_from_the_chosen_territory_and_pass_the_lint(on):
    terr = {"mood": "Warm and plain: like a note on the fridge.", "thought": "An older man fills a kettle at the kitchen sink on a grey morning.",
            "sketch": "Your tap, your story."}
    idea = PR.territory_subject({"type": "idea", "title": "x", "blocks": []}, terr)
    assert idea == "An older man fills a kettle at the kitchen sink on a grey morning."
    cover = PR.territory_subject({"type": "title", "title": "Lumen Water: Every Drop", "blocks": []},
                                 {"mood": "Clear, factual and calm. The look is built on one number.", "sketch": "One in twenty, Lumen."})
    assert cover.startswith("An everyday scene") and "Mood: clear, factual and calm." in cover
    from visuals import lint
    assert lint.lint_text(idea) is None and lint.lint_text(cover) is None
    assert PR.territory_subject({"type": "idea", "title": "", "blocks": []}, {"thought": "Brightwell's 5 taps."}) == \
        "An everyday scene with taps, in soft natural light."   # a name and a digit never reach a subject


def test_the_cover_idea_and_work_have_picture_slots_of_the_chosen_territory(tmp_path, on):
    inp = _inp(tmp_path, evidence=False)
    d = _deck(inp)
    st = _st()
    from deck import images
    images.add_empty_slots(d, "creative_cover")
    kinds = {d["slides"][c["sid"]]["type"] for c in imagegen.candidate_slots(d, st["c"]["territories"])}
    assert {"title", "idea", "execution"} <= kinds
    assert PR.chosen_territory(st["c"]["territories"], d)["id"] == "t1"


def test_the_intake_keeps_only_names_the_inputs_state():
    parts = [{"names": {"client": "Lumen Water", "project": "Project Riverbend"}}, {"names": {"project": "Every Drop"}}]
    assert stages.cover_names(parts, "Lumen Water asks for a campaign. Every Drop is its name.") == {"client": "Lumen Water", "project": "Every Drop"}
