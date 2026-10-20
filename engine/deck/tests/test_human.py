"""Offline tests for supply cards, human-only fills and the confirm list (roadmap item 5).

No model call; every client, person and document here is invented (Lumen Water, Harbour Lane Studio). Run from
``engine/``: ``PYTHONPATH=. python3 -m pytest -q deck/tests``.
"""
from __future__ import annotations

import json
from pathlib import Path

from deck import assemble, inputs, intake, profiles, run_deck, validate

FIX = Path(__file__).parent / "fixtures"
BRIEF = FIX / "lumen_water"
PROMPT = FIX / "lumen_water_prompt"
STAGES = {"a": "a_requirements.json", "b": "b_storyline.json", "c": "c_territories.json", "d": "d_idea.json"}

TEAM = "Aoife Byrne, Strategy Director\nCian Doyle, Creative Lead\n- Niamh Walsh, Account Director"
DOC = """[p1]
About Harbour Lane Studio

[p2]
Our team
- Aoife Byrne, Strategy Director
- Cian Doyle, Creative Lead

Case studies
- Tidewater Cider: a launch that doubled trial in six months
- Provide three case studies with referees

Fees
- Strategy and planning: 40,000 euro

Next steps
We expect the decision on 14 March 2027 and a start in April.
"""


def _st(folder: Path = BRIEF) -> dict:
    """The recorded stages of a fixture folder."""
    return {k: json.loads((folder / f).read_text()) for k, f in STAGES.items() if (folder / f).exists()}


def _build(inp, folder: Path = BRIEF, fmt: str = "full", **kw):
    """Build the agency deck for the Lumen Water fixture (the full format by default: no merged slides)."""
    return assemble.build(inp, _st(folder), client="Lumen Water", project="Awareness", fmt=fmt, **kw)


def _brief(answers=None, verified=None, docs=None, tmp_path=None):
    """Inputs for the brief fixture with the given answers, verify decisions and documents (key -> text)."""
    paths = []
    for k, text in (docs or {}).items():
        (tmp_path / f"{k}.txt").write_text(text)
        paths.append((k, tmp_path / f"{k}.txt"))
    return inputs.load(BRIEF / "brief_object.json", docs=paths, answers=answers or {}, verified=verified or {})


def _slide(deck, type_):
    """The first slide of a type."""
    return next(s for s in deck["slides"].values() if s["type"] == type_)


def _ans(text, **kw):
    """An answer record."""
    return {"text": text, "at": "2026-10-18T10:00:00", **kw}


# ---------------------------------------------------------------- answers fill the slides

def test_answers_fill_a_team_slide_and_the_to_supply_count_falls():
    """A team answer fills the team slide from_source, cited answer:<qid>; the DRAFT count falls by one."""
    base = _build(_brief())
    deck = _build(_brief({"q_supply_team": _ans(TEAM, by="Sai")}))
    t = _slide(deck, "team")
    assert t["status"] == "from_source" and t["supplied"] == {"basis": "supplied by Sai", "by": "Sai", "refs": ["answer:q_supply_team"]}
    items = [i["text"] for b in t["blocks"] for i in b["items"]]
    assert items == ["Aoife Byrne, Strategy Director", "Cian Doyle, Creative Lead", "Niamh Walsh, Account Director"]   # the person's lines, whole, bullet taken off
    assert all(i["refs"] == ["answer:q_supply_team"] for b in t["blocks"] for i in b["items"])
    n = lambda d: sum(1 for s in d["slides"].values() if s["status"] == "needs_human")
    assert n(deck) == n(base) - 1
    assert not any(f["check"] in ("placeholder", "unknown_ref", "bare_claim") and f["level"] == "error" for f in validate.run(deck, _brief({"q_supply_team": _ans(TEAM)})))


def test_investment_credentials_and_next_step_fill_from_their_cards():
    """Budget split and options fill the investment slide; credentials and the decision date theirs; the platform ask stays."""
    ans = {"q_supply_budget": _ans("Fees 30%\nMedia 70%"), "q_supply_options": _ans("Option A: lean, 90,000 euro"),
           "q_supply_credentials": _ans("Tidewater Cider: doubled trial"), "q_supply_decision_date": _ans("12 March 2027")}
    deck = _build(_brief(ans))
    for t in ("investment", "credentials", "next_step"):
        assert _slide(deck, t)["status"] == "from_source" and _slide(deck, t)["supplied"]["basis"] == "supplied by the person"
    inv = _slide(deck, "investment")
    assert [b["kind"] for b in inv["blocks"]] == ["text", "bullets"] and "Budget given:" in inv["blocks"][0]["text"]
    assert [i["text"] for i in inv["blocks"][1]["items"]] == ["Fees 30%", "Media 70%", "Option A: lean, 90,000 euro"]
    ns = [i["text"] for b in _slide(deck, "next_step")["blocks"] for i in b["items"]]
    assert ns[0].startswith("Agree") and ns[1] == "Decision date: 12 March 2027"
    assert validate.run(deck, _brief(ans)) is not None


def test_an_unanswered_or_skipped_card_leaves_a_labelled_placeholder():
    """No answer, a blank one and a skip leave the slide a labelled placeholder, needs_human."""
    for ans in ({}, {"q_supply_team": {"skipped": True, "at": "t"}}, {"q_supply_team": _ans("   ")}):
        deck = _build(_brief(ans))
        t = _slide(deck, "team")
        assert t["status"] == "needs_human" and "supplied" not in t
        assert all(i["text"].startswith("Proposed (not given by the client):") for b in t["blocks"] for i in b["items"])


def test_old_decks_are_unchanged_when_nothing_is_supplied():
    """No answers, no document section: the build is the golden deck (and so for the other types)."""
    deck = assemble.build(_brief(), _st(), client="Lumen Water", project="National awareness campaign")
    deck["meta"].pop("built_at")
    deck["meta"].pop("built_from")
    assert json.loads(json.dumps(deck, default=str)) == json.loads((BRIEF / "golden_deck.json").read_text())


def test_a_supplied_slide_in_a_thin_deck_stays_from_source():
    """A deck built from a prompt alone is drafted throughout, except what the person supplied."""
    inp = inputs.load(None, prompt_text=(PROMPT / "prompt.txt").read_text().strip(), answers={"q_supply_team": _ans(TEAM)})
    deck = _build(inp, PROMPT)
    assert _slide(deck, "team")["status"] == "from_source"
    assert all(s["status"] != "from_source" or s["type"] in assemble.STRUCTURAL_TYPES or s.get("supplied") for s in deck["slides"].values() if s["type"] != "questions")


def test_a_supplied_claim_that_cites_something_else_still_fails_the_placeholder_check():
    """A slide that says it is supplied but cites a prompt line is not accepted by the placeholder rule."""
    inp = _brief({"q_supply_team": _ans(TEAM)})
    deck = _build(inp)
    for c in _slide(deck, "team")["claims"]:
        c["refs"] = ["brief:audience"]
    assert any(f["check"] == "placeholder" for f in validate.run(deck, inp))


# ---------------------------------------------------------------- documents the person attached

def test_documents_fill_human_only_slides_traced_to_their_page(tmp_path):
    """A team, case-study, fee and decision-date section in the person's own document fills the slides, cited doc:KEY#pN."""
    inp = _brief(docs={"agency": DOC}, tmp_path=tmp_path)
    got = intake.doc_supply(inp)
    assert got["team"] == {"items": ["Aoife Byrne, Strategy Director", "Cian Doyle, Creative Lead"], "doc": "agency", "ref": "doc:agency#p2"}
    assert got["credentials"]["items"] == ["Tidewater Cider: a launch that doubled trial in six months"]   # 'Provide three case studies...' asks, it does not give
    assert got["investment"]["items"] == ["Strategy and planning: 40,000 euro"]
    assert got["next_step"]["items"] == ["We expect the decision on 14 March 2027 and a start in April."] and got["next_step"]["ref"] == "doc:agency#p2"
    deck = _build(inp)
    t = _slide(deck, "team")
    assert t["status"] == "from_source" and t["supplied"]["basis"] == "document" and t["supplied"]["refs"] == ["doc:agency#p2"]
    assert _slide(deck, "investment")["status"] == "from_source" and _slide(deck, "next_step")["status"] == "from_source"
    assert not [f for f in validate.run(deck, inp) if f["level"] == "error" and f["check"] in ("placeholder", "unknown_ref", "bare_claim", "numbers_trace")]


def test_an_answer_wins_over_a_document_and_a_clients_ask_is_never_read_as_the_agencys_team(tmp_path):
    """The person's answer is used over their document; a client's tender text asking for CVs fills nothing."""
    inp = _brief({"q_supply_team": _ans("Una Kelly, Planner")}, docs={"agency": DOC}, tmp_path=tmp_path)
    assert _slide(_build(inp), "team")["supplied"]["basis"] == "supplied by the person"
    tender = "Team\n- Provide CVs of the key personnel\n- Describe the account structure\n\nFees\nTenderers must state fees.\n"
    assert intake.doc_supply(_brief(docs={"itt": tender}, tmp_path=tmp_path)) == {}


def test_a_document_without_page_markers_is_cited_by_its_heading(tmp_path):
    """A text document with no [pN] locators cites doc:KEY#<heading>."""
    inp = _brief(docs={"bios": "Meet the team\nAoife Byrne - Strategy Director\n"}, tmp_path=tmp_path)
    assert intake.doc_supply(inp)["team"]["ref"] == "doc:bios#meet-the-team"


# ---------------------------------------------------------------- the supply cards

def test_supply_cards_have_the_question_shape_and_priority():
    """Cards are free text, skippable, kind supply, ordered; a brief-given budget is never asked."""
    cards = intake.supply_questions(_brief())
    ids = [c["id"] for c in cards]
    assert ids == ["q_supply_team", "q_supply_credentials", "q_supply_options", "q_supply_decision_date"]   # the brief gives a budget
    assert all(c["allow_text"] and c["skippable"] and c["kind"] == "supply" and c["options"] == [] and c["address"].startswith("slide.") for c in cards)
    nob = inputs.load(None, prompt_text="Lumen Water wants a campaign.")
    assert [c["id"] for c in intake.supply_questions(nob)][0] == "q_supply_budget"   # no budget at all: asked first
    assert intake.supply_questions(nob, "investor") == []


def test_cards_follow_the_deck_types_spine_and_documents(tmp_path):
    """A credentials deck is asked only what its spine presents; a team the documents give is not asked again."""
    cred = profiles.load("credentials")
    ids = [c["id"] for c in intake.supply_questions(_brief(), "agency", cred)]
    assert set(ids) <= {"q_supply_team", "q_supply_credentials", "q_supply_budget", "q_supply_options", "q_supply_decision_date"}
    assert [i for i in ids if i.endswith("team")] == (["q_supply_team"] if "team" in cred["spine"] else [])
    assert "q_supply_team" not in [c["id"] for c in intake.supply_questions(_brief(docs={"agency": DOC}, tmp_path=tmp_path))]


def test_supply_cards_come_after_the_type_question_within_the_five_cap():
    """The type question stays first, the objectives question is never dropped, the list is at most five, adding twice changes nothing."""
    a0 = {"questions": [{"id": f"q{i}", "text": "t", "address": "brief.objectives" if i == 4 else "brief.audience"} for i in range(1, 5)]}
    intake.add_type_question(a0, intake.type_card_for(_brief()))
    cards = intake.supply_questions(_brief())
    intake.add_supply_questions(a0, cards)
    ids = [q["id"] for q in a0["questions"]]
    assert ids[0] == intake.TYPE_QUESTION_ID and len(ids) == 5 and "q4" in ids and ids[-2:] == ["q_supply_team", "q_supply_credentials"]
    before = list(a0["questions"])
    intake.add_supply_questions(a0, cards)
    assert a0["questions"] == before
    room = {"questions": [intake.type_card_for(_brief())]}
    intake.add_supply_questions(room, cards)
    assert [q["id"] for q in room["questions"]] == [intake.TYPE_QUESTION_ID] + [c["id"] for c in cards]


# ---------------------------------------------------------------- the confirm list and verify

def test_the_confirm_list_holds_proposals_own_statement_figures_and_slides_needing_a_person():
    """Proposals, a figure only the person's statement supports, and every needs_human slide are listed, each with a stable ref."""
    inp = inputs.load(None, prompt_text="Lumen Water wants a campaign. We have 12,000 members today.", answers={"q_supply_team": _ans(TEAM)})
    inp.brief["insight"] = {"value": "People trust the tap", "kind": "proposal", "from_intake": True}
    deck = {"meta": {}, "order": ["s01", "s02", "s03"], "slides": {
        "s01": {"type": "insight", "title": "A", "status": "drafted", "label": "A", "blocks": [], "claims": [{"text": "We have 12,000 members", "refs": ["prompt:2"], "basis": "sourced"}]},
        "s02": {"type": "idea", "title": "B", "status": "drafted", "label": "B", "blocks": [], "claims": [{"text": "A bold plan", "refs": [], "basis": "proposal"}]},
        "s03": {"type": "credentials", "title": "C", "status": "needs_human", "label": "C", "blocks": [], "claims": []}}}
    items = intake.confirm_list(deck, inp)
    by = {i["ref"]: i for i in items}
    assert by["brief:insight"]["kind"] == "proposal" and by["prompt:2"]["kind"] == "figure" and by["slide:credentials"]["kind"] == "slide"
    assert [i["kind"] for i in items if i["kind"] == "proposal"] == ["proposal", "proposal"]
    assert all(i["verified"] is None for i in items)
    assert [i["ref"] for i in intake.confirm_list(deck, inp)] == [i["ref"] for i in items]   # stable


def test_a_verify_decision_marks_the_item_and_the_counts_follow():
    """intake.verified.<ref> = {by, at} marks an item verified; only verified or supplied items count as sourced."""
    patch = intake.verify_patch("slide:credentials", "Sai", "2026-10-18T11:00:00")
    assert patch == {"intake": {"verified": {"slide:credentials": {"by": "Sai", "at": "2026-10-18T11:00:00"}}}}
    assert intake.verify_patch("", "Sai", "t") is None and intake.verify_patch("x", "", "t") is None
    inp = _brief({"q_supply_team": _ans(TEAM)}, verified=patch["intake"]["verified"])
    deck = _build(inp)
    items = intake.stamp_confirm(deck, inp)
    assert next(i for i in items if i["ref"] == "slide:credentials")["verified"] == {"by": "Sai", "at": "2026-10-18T11:00:00"}
    s = deck["meta"]["confirm_summary"]
    assert s["verified"] == 1 and s["supplied"] == 1 and s["sourced"] == 2 and s["open"] == s["total"] - 1
    assert s == intake.confirm_summary(deck)
    assert intake.confirm_summary({"meta": {}, "slides": {}}) == {"total": 0, "verified": 0, "supplied": 0, "sourced": 0, "open": 0, "needs_person": 0}


# ---------------------------------------------------------------- the CLI

def _run(monkeypatch, tmp_path, answers, extra=()):
    """Run the CLI on the brief fixture with an answers file."""
    from deck.tests.test_intake import _run_main
    f = tmp_path / "answers.json"
    f.write_text(json.dumps(answers))
    out = tmp_path / "out"
    rep = _run_main(monkeypatch, tmp_path, ["--brief", str(BRIEF / "brief_object.json"), "--stages", str(BRIEF), "--client", "Lumen Water",
                                            "--project", "Awareness", "--answers", str(f), "--out", str(out), "--format", "full", *extra])
    return rep, json.loads((out / "deck.json").read_text())


def test_the_cli_reads_flat_answers_and_the_apps_intake_shape(monkeypatch, tmp_path):
    """--answers takes {qid: answer} as before, or {answers, verified}; the confirm summary is in report.json and deck meta."""
    rep, deck = _run(monkeypatch, tmp_path, {"q_supply_team": _ans(TEAM)})
    assert _slide(deck, "team")["status"] == "from_source" and rep["confirm"]["supplied"] == 1 and rep["supply_questions"]
    assert deck["meta"]["confirm"] and deck["meta"]["confirm_summary"] == rep["confirm"]
    rep2, deck2 = _run(monkeypatch, tmp_path / "b" if (tmp_path / "b").mkdir() is None else tmp_path,
                       {"answers": {"q_supply_team": _ans(TEAM)}, "verified": {"slide:credentials": {"by": "Sai", "at": "t"}}})
    assert rep2["confirm"]["verified"] == 1 and _slide(deck2, "team")["status"] == "from_source"


# ---------------------------------------------------------------- the client's text is never the agency's; merged slides keep 'supplied'

RFT = ("[p1]\nBudget\n- The maximum budget for this contract is EUR 450,000 excluding VAT.\n- Tenders above this will be rejected.\n"
       "Experience\n- Demonstrable experience with HSE campaigns.\n- Evidence of work for the Department of Health.\n"
       "Timeline\nThe Department will announce the award decision by 12 March 2027.\n"
       "Team\nKey personnel\nAoife Byrne: Tender manager at the Department\n")


def test_research_documents_are_the_clients_and_fill_nothing():
    """A client's RFT arriving through the research CLAN (origin research) is never read as the agency's own team, fees,
    credentials or decision date; the same text attached by the person is."""
    inp = inputs.Inputs(brief=inputs.empty_brief())
    inp.docs = {"rft": {"name": "RFT", "chars": len(RFT), "text": RFT, "origin": "research"}}
    assert intake.doc_supply(inp) == {}
    assert intake.human_fill(inp, "team", ("q_supply_team",)) is None
    ids = [c["id"] for c in intake.supply_questions(inp)]
    assert "q_supply_team" in ids and "q_supply_credentials" in ids   # the person is still asked for the real material
    inp.docs = {"rft": {"name": "RFT", "chars": len(RFT), "text": RFT}}
    assert intake.doc_supply(inp)   # attached by the person, it is still read


def test_load_research_tags_extracted_documents_as_research(tmp_path):
    """load_research marks every extracted document origin research."""
    import zipfile
    z = tmp_path / "r.clan"
    with zipfile.ZipFile(z, "w") as f:
        f.writestr("human/assets/.extracted/Tender.txt", RFT)
    assert all(d.get("origin") == "research" for d in inputs.load_research(z)["docs"].values())


def test_pitch_merge_keeps_supplied_when_only_credentials_is_answered():
    """Credentials merged onto the team slide in the pitch still count as supplied."""
    inp = _brief({"q_supply_credentials": _ans("Tidewater Cider launch")})
    deck = _build(inp, fmt="pitch")
    merged = [s for s in deck["slides"].values() if s["type"] == "team"]
    assert merged and merged[0].get("supplied", {}).get("refs") == ["answer:q_supply_credentials"]
    assert intake.confirm_summary(deck)["supplied"] >= 1
