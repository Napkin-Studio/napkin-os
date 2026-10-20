"""Offline tests for the deck types (profiles): inference, the question card, the profile files, the
spine arrangement, strictness and the CLI. No model call, no client material: every fixture under
fixtures/types/<id>/ is invented. Run from ``engine/``: ``PYTHONPATH=. python3 -m pytest -q deck/tests``.
"""
from __future__ import annotations

import ast
import copy
import json
import re
from pathlib import Path

import pytest
import yaml

from deck import assemble, inputs, intake, profiles, run_deck, spec, stages, validate

HERE = Path(__file__).parent
FIX = HERE / "fixtures"
TYPES = FIX / "types"
BRIEF = FIX / "lumen_water"
#: Stage outputs a type's fixture folder may hold, by stage key.
FILES = {"a0": "a0_intake.json", "a": "a_requirements.json", "b": "b_storyline.json", "c": "c_territories.json",
         "d": "d_idea.json", "i": "i_investor.json"}


def _stages(pid: str) -> dict:
    """The recorded stage outputs in fixtures/types/<pid>/."""
    return {k: json.loads((TYPES / pid / f).read_text()) for k, f in FILES.items() if (TYPES / pid / f).exists()}


def _inputs(pid: str, **kw):
    """Inputs for a type's fixture: its prompt, no brief."""
    return inputs.load(None, prompt_text=(TYPES / pid / "prompt.txt").read_text().strip(), **kw)


def _build(pid: str, profile="own", st: dict | None = None, inp=None, **kw) -> tuple:
    """Build a type's fixture deck with its own profile (or the one given, or None); returns (deck, inputs)."""
    inp = inp or _inputs(pid)
    p = profiles.load(pid) if profile == "own" else profile
    builder = assemble.build_investor if profiles.load(pid)["kind"] == "investor" else assemble.build
    return builder(inp, st if st is not None else _stages(pid), client="Fixture Client", project="Fixture Project", profile=p, **kw), inp


def _types(deck: dict) -> list:
    """The slide types in deck order."""
    return [deck["slides"][s]["type"] for s in deck["order"]]


def _presented(deck: dict) -> list:
    """The slide types before the Appendix divider, the trace and the sources."""
    return [deck["slides"][s]["type"] for s in validate.presented(deck)]


# ---------------------------------------------------------------- the profile files

def test_the_four_types_load_and_check():
    """Every deck type has a file that loads and validates; the four known ids come first, in question order."""
    assert profiles.ids() == list(spec.DECK_TYPES) == ["agency_pitch", "tender_response", "investor_seed", "credentials"]
    for p in profiles.all_profiles():
        assert profiles.validate_profile(p) == []
        assert p["kind"] in spec.KINDS and set(p["spine"]) <= set(spec.SLIDE_TYPES) and set(p["stages"]) <= set(profiles.STAGES)
        assert p["rubric_weights"]["basis"] == "default, not validated" and sum(p["rubric_weights"]["weights"].values()) == 100


def test_kinds_select_the_profiles():
    """--kind agency|investor|tender|credentials map to agency_pitch, investor_seed, tender_response, credentials."""
    assert {k: profiles.for_kind(k)["id"] for k in ("agency", "investor", "tender", "credentials")} == \
        {"agency": "agency_pitch", "investor": "investor_seed", "tender": "tender_response", "credentials": "credentials"}
    with pytest.raises(profiles.ProfileError):
        profiles.for_kind("pitch")


def test_default_weights_are_the_rubrics_and_adjustments_are_justified():
    """The default split is rubric.json's, every other type's difference from it is explained, and a weight
    that moved has an adjustment with a why."""
    base = profiles.load("agency_pitch")["rubric_weights"]["weights"]
    assert base == profiles.DEFAULT_WEIGHTS
    for pid in ("tender_response", "investor_seed", "credentials"):
        rw = profiles.load(pid)["rubric_weights"]
        moved = {c for c in base if rw["weights"][c] != base[c]}
        assert moved == {a["criterion"] for a in rw["adjustments"]} and all(a["why"] for a in rw["adjustments"])
        assert {a["criterion"]: a["to"] for a in rw["adjustments"]} == {c: rw["weights"][c] for c in moved}


def _write(tmp_path, monkeypatch, mutate) -> str:
    """Copy the tender profile into a temp profiles folder with ``mutate`` applied, point the loader there, return its id."""
    p = yaml.safe_load((profiles.PROFILE_DIR / "tender_response.yaml").read_text())
    mutate(p)
    (tmp_path / "bad_type.yaml").write_text(yaml.safe_dump(p))
    monkeypatch.setattr(profiles, "PROFILE_DIR", tmp_path)
    monkeypatch.setattr(profiles, "_CACHE", {})
    return "bad_type"


@pytest.mark.parametrize("mutate, message", [
    (lambda p: p.update(id="bad_type", spine=p["spine"] + ["hero_shot"]), "unknown slide type 'hero_shot'"),
    (lambda p: p.update(id="bad_type", appendix=["nonsense"]), "unknown slide type 'nonsense'"),
    (lambda p: p.update(id="bad_type", stages=["a0", "z9"]), "unknown stage 'z9'"),
    (lambda p: p.update(id="bad_type", strict={"made_up_check": "error"}), "unknown check 'made_up_check'"),
    (lambda p: p.update(id="bad_type", strict={"requirement_map": "fatal"}), "must be 'error' or 'warn'"),
    (lambda p: p.update(id="bad_type", prompt_guidance={"zz": ["x"]}), "unknown stage 'zz'"),
    (lambda p: p.update(id="bad_type", kind="podcast"), "kind 'podcast'"),
    (lambda p: p.update(id="bad_type", spine=[]), "spine is empty"),
    (lambda p: (p["rubric_weights"]["weights"].update(compliance_gate=99), p.update(id="bad_type")), "not 100"),
    (lambda p: (p.pop("strict"), p.update(id="bad_type")), "missing strict"),
    (lambda p: p.update(id="bad_type", extra_field=1), "unknown field extra_field"),
    (lambda p: p.update(id="bad_type", questions=[{"id": "q_x", "text": "t", "allow_text": True, "address": "brief.nope"}]), "needs a 'q_' id"),
])
def test_a_bad_profile_fails_loudly(tmp_path, monkeypatch, mutate, message):
    """An unknown slide type, stage, check or field, a weight split that is not 100 or a missing key stops the load with ProfileError."""
    pid = _write(tmp_path, monkeypatch, mutate)
    with pytest.raises(profiles.ProfileError, match=re.escape(message)):
        profiles.load(pid)


def test_unknown_id_and_unreadable_yaml_fail(tmp_path, monkeypatch):
    """No file, a bad id and a file that is not YAML are ProfileErrors that name what is known."""
    monkeypatch.setattr(profiles, "_CACHE", {})
    with pytest.raises(profiles.ProfileError, match="known types are"):
        profiles.load("no_such_type")
    with pytest.raises(profiles.ProfileError):
        profiles.load("../etc")
    (tmp_path / "broken.yaml").write_text("id: [unclosed")
    monkeypatch.setattr(profiles, "PROFILE_DIR", tmp_path)
    with pytest.raises(profiles.ProfileError, match="not valid YAML"):
        profiles.load("broken")


def test_file_name_must_match_id(tmp_path, monkeypatch):
    """A profile whose id differs from its file name is refused (the id is how a deck records its type)."""
    p = yaml.safe_load((profiles.PROFILE_DIR / "credentials.yaml").read_text())
    (tmp_path / "other.yaml").write_text(yaml.safe_dump(p))
    monkeypatch.setattr(profiles, "PROFILE_DIR", tmp_path)
    monkeypatch.setattr(profiles, "_CACHE", {})
    with pytest.raises(profiles.ProfileError, match="does not match the file name"):
        profiles.load("other")


def test_load_returns_a_copy():
    """Changing a loaded profile does not change the next load."""
    p = profiles.load("credentials")
    p["spine"].append("appendix")
    assert profiles.load("credentials")["spine"] != p["spine"]


def test_guidance_adds_lines_only_and_no_facts():
    """A type's guidance is plain instruction lines: no digits (no figure), and none for the legacy types, whose prompts stay as they were."""
    assert profiles.load("agency_pitch")["prompt_guidance"] == {}
    inv = profiles.load("investor_seed")["prompt_guidance"]   # roadmap item 11: the investor prompt now carries guidance, on stage i and the fit judge only
    assert set(inv) == {"i", "fit"} and "why_now is required" in " ".join(inv["i"]) and "what_we_know" in " ".join(inv["i"])
    for pid in ("tender_response", "credentials", "investor_seed"):
        lines = [x for ls in profiles.load(pid)["prompt_guidance"].values() for x in ls]
        assert lines and not any(re.search(r"\d", x) for x in lines)
    assert "answer each scored criterion in the buyer's order" in " ".join(profiles.guidance(profiles.load("tender_response"), "b")).lower()


def test_stage_set_decides_which_recorded_stage_files_are_needed():
    """Credentials needs no c or d stage file; tender and agency need them; investor needs only a0 and i."""
    base = run_deck.STAGE_FILES
    assert set(profiles.stage_names(profiles.load("credentials"), base)) == {"a0", "a", "b"}
    assert set(profiles.stage_names(profiles.load("tender_response"), base)) == set(base)
    assert set(profiles.stage_names(profiles.load("investor_seed"), run_deck.INVESTOR_STAGE_FILES)) == {"a0", "i"}
    assert profiles.stage_names(None, base) == base and not profiles.runs(profiles.load("credentials"), "d")


def test_weights_follow_the_buyers_when_stated_else_our_default():
    """The buyer's stated weights win and say so; with none, or an unweighted criterion, our default split is
    used and labelled 'default, not validated'."""
    p = profiles.load("tender_response")
    buyer = profiles.weights(p, [{"criterion": "Team", "weight": "30%"}, {"criterion": "Price", "weight": 70}])
    assert buyer == {"source": "brief", "label": "the buyer's own weights", "weights": {"Team": 30.0, "Price": 70.0}}
    for scoring in ([], None, [{"criterion": "Team", "weight": "30%"}, {"criterion": "Price", "weight": "to be confirmed"}]):
        d = profiles.weights(p, scoring)
        assert d["source"] == "default_assumption" and d["label"] == "default, not validated" and d["weights"] == p["rubric_weights"]["weights"]


# ---------------------------------------------------------------- inference

def test_a_bare_line_is_an_agency_pitch_with_low_confidence_and_no_evidence():
    """Nothing to go on: agency_pitch, low confidence, empty evidence."""
    assert intake.infer_type("Make me a deck for Lumen Water.") == {"type": "agency_pitch", "confidence": "low", "evidence": []}
    assert intake.infer_type("", None, None) == {"type": "agency_pitch", "confidence": "low", "evidence": []}


def test_a_tender_prompt_is_inferred_with_quoted_evidence():
    """A tender's own words are quoted exactly as written, in their case."""
    text = "We have received an Invitation to Tender from a council. The scoring criteria are on page 3, split into 2 lots."
    inf = intake.infer_type(text)
    assert inf["type"] == "tender_response" and inf["confidence"] == "high"
    assert "Invitation to Tender" in inf["evidence"] and "scoring criteria" in inf["evidence"]
    assert all(e in text for e in inf["evidence"])   # exact words, never paraphrased


def test_investor_and_credentials_are_inferred():
    """Seed and raising point at the investor deck; a chemistry meeting and who we are at credentials."""
    inv = intake.infer_type("We are raising a seed round and talking to investors next month.")
    assert inv["type"] == "investor_seed" and inv["confidence"] == "high" and {"seed", "raising", "investors"} <= {e.lower() for e in inv["evidence"]}
    cred = intake.infer_type("We have a chemistry meeting on Friday: who we are and who the team is.")
    assert cred["type"] == "credentials" and "chemistry meeting" in cred["evidence"] and "who we are" in cred["evidence"]
    assert cred["confidence"] in ("medium", "high")


def test_inference_reads_documents_and_the_brief_too():
    """The signal may be in an attached document or a brief field, not only the prompt."""
    assert intake.infer_type("Build a deck.", {"d": {"name": "itt.pdf", "text": "Invitation to tender for media services. Award criteria: quality 70%."}})["type"] == "tender_response"
    assert intake.infer_type("Build a deck.", None, {"background": {"value": "A pre-seed company raising from investors."}})["type"] == "investor_seed"
    assert intake.infer_type("Build a deck.", ["Request for proposals, RFP 2026"])["type"] == "tender_response"


def test_a_single_weak_hint_is_not_enough_and_a_tie_lowers_confidence():
    """One weak word proposes nothing; two types scoring the same is flagged as less sure."""
    assert intake.infer_type("The round table is ready.")["type"] == "agency_pitch"
    assert intake.infer_type("We use credentials for the lock.")["type"] == "agency_pitch"   # 2 points is a hint, not a proposal
    tie = intake.infer_type("The scoring criteria are attached, and so is a chemistry meeting.")   # 3 points each: tender wins the tie, less sure
    assert tie["type"] == "tender_response" and tie["confidence"] == "low" and tie["evidence"] == ["scoring criteria"]
    assert intake.infer_type("The scoring criteria are attached.")["confidence"] == "medium"


# ---------------------------------------------------------------- the question card

def test_type_question_card_shape():
    """The card is middleware-api 8.3's: id, text, options {id,label,value,origin,source?}, allow_text, address;
    the inferred type is first and 'proposed' with the quoted words as its source; the other three follow;
    it is skippable and names its default."""
    inf = intake.infer_type("Invitation to tender, scored against the scoring criteria.")
    q = intake.type_question(inf)
    assert q["id"] == "q_deck_type" and q["address"] == "deck.type" and q["allow_text"] is True and q["skippable"] is True
    assert q["text"] == "What kind of deck is this?" and q["default"] == "agency_pitch"
    assert [o["id"] for o in q["options"]][0] == "tender_response" and len(q["options"]) == 4
    assert {o["id"] for o in q["options"]} == set(spec.DECK_TYPES)
    first = q["options"][0]
    assert first["origin"] == "proposed" and first["source"] == " / ".join(inf["evidence"])
    assert all(o["origin"] == "asked" and "source" not in o for o in q["options"][1:])
    assert all(set(o) <= {"id", "label", "value", "origin", "source"} and o["value"] == o["id"] for o in q["options"])
    for o in q["options"]:
        p = profiles.load(o["id"])
        assert o["label"] == f"{p['label']}: {p['one_line']}"


def test_bare_line_question_proposes_agency_first_with_no_source():
    """With no evidence the card still exists: agency first, proposed, no source."""
    q = intake.type_question(intake.infer_type("hello"))
    assert q["options"][0]["id"] == "agency_pitch" and q["options"][0]["origin"] == "proposed" and "source" not in q["options"][0]
    assert intake.type_question()["options"][0]["id"] == "agency_pitch"


def _a0(n: int, gaps=()) -> dict:
    """An a0 output with ``n`` model questions about different brief fields."""
    fields = ["audience", "insight", "smp", "budget_scope", "mandatories", "tone_world_assets"]
    return {"stage": "a0_intake", "produced_by": "x", "fields": {}, "abstained": [],
            "gaps": {"brief_fields": [{"field": g, "why": "empty"} for g in gaps], "slide_types": []},
            "questions": [{"id": f"q_{i}", "text": f"Question {i}?", "options": [], "allow_text": True, "address": f"brief.{fields[i]}"} for i in range(n)]}


def test_type_question_is_first_and_the_list_stays_at_five():
    """The type question leads; of the model's questions only four stay (at most 5 in all); a second add changes nothing."""
    card = intake.type_question(intake.infer_type("A seed round."))
    a0 = intake.add_type_question(_a0(5), card)
    assert [q["id"] for q in a0["questions"]] == ["q_deck_type", "q_0", "q_1", "q_2", "q_3"] and len(a0["questions"]) == intake.MAX_QUESTIONS
    again = copy.deepcopy(a0)
    intake.add_type_question(again, card)
    assert again == a0
    assert intake.add_type_question({"stage": "a0_intake"}, card)["questions"] == [card]   # no model questions at all


def test_profile_questions_fill_free_slots_for_gaps_only():
    """A spine type's own questions join only where there is room, the field is still empty and not already asked."""
    card = intake.type_question()
    cred = profiles.load("credentials")
    a0 = intake.add_type_question(_a0(1, gaps=("desired_response", "mandatories")), card, cred)
    ids = [q["id"] for q in a0["questions"]]
    assert ids[0] == "q_deck_type" and "q_decide" in ids and "q_show" in ids and "q_attendees" not in ids   # reasons_to_believe is not a gap
    assert len(ids) <= intake.MAX_QUESTIONS
    full = intake.add_type_question(_a0(4, gaps=("desired_response",)), card, cred)
    assert len(full["questions"]) == intake.MAX_QUESTIONS and [q["id"] for q in full["questions"]].count("q_decide") <= 1


def test_validate_a0_accepts_the_type_question_and_still_caps_at_five():
    """The deck.type address is valid for q_deck_type only; six questions are still refused."""
    a0 = intake.add_type_question(_a0(3), intake.type_question())
    assert intake.validate_a0(a0) == []
    bad = copy.deepcopy(a0)
    bad["questions"][1]["address"] = "deck.type"
    assert any("address must be 'brief.<field>'" in e for e in intake.validate_a0(bad))
    a0["questions"] += _a0(3)["questions"]
    assert any("at most 5" in e for e in intake.validate_a0(a0))


def test_skipped_type_question_is_not_an_open_question():
    """apply_a0 leaves the deck.type question out of the open questions the Questions slide lists."""
    inp = _inputs("credentials")
    a0 = intake.add_type_question(_a0(1), intake.type_question())
    inp.intake = a0
    intake.apply_a0(inp, a0)
    texts = [q["question"] for q in inp.open_questions]
    assert "Question 0?" in texts and not any("What kind of deck" in t for t in texts)


# ---------------------------------------------------------------- choosing the type

def test_answer_selects_the_profile_and_flag_wins():
    """An option id selects the profile; typed words naming a type do too; an explicit --kind beats the answer."""
    inp = _inputs("credentials", answers={"q_deck_type": {"option_id": "tender_response", "at": "t"}})
    assert intake.chosen_type(inp) == {"type": "tender_response", "source": "answer", "note": "the person chose tender_response"}
    typed = _inputs("credentials", answers={"q_deck_type": {"text": "Investor deck"}})
    assert intake.chosen_type(typed)["type"] == "investor_seed" and intake.chosen_type(typed)["source"] == "answer"
    typed2 = _inputs("credentials", answers={"q_deck_type": {"text": "an invitation to tender and its scoring criteria"}})
    assert intake.chosen_type(typed2)["type"] == "tender_response"
    assert intake.chosen_type(inp, "credentials") == {"type": "credentials", "source": "flag", "note": "--kind credentials"}


def test_a_skipped_type_question_defaults_to_agency_and_says_so():
    """Skipped, unrecognised or never asked: agency_pitch, with a note that records why."""
    skipped = intake.chosen_type(_inputs("credentials", answers={"q_deck_type": {"skipped": True}}))
    assert skipped["type"] == "agency_pitch" and skipped["source"] == "skipped" and "skipped" in skipped["note"] and "agency_pitch" in skipped["note"]
    junk = intake.chosen_type(_inputs("credentials", answers={"q_deck_type": {"text": "something else entirely"}}))
    assert junk["type"] == "agency_pitch" and junk["source"] == "skipped"
    unknown_opt = intake.chosen_type(_inputs("credentials", answers={"q_deck_type": {"option_id": "nope"}}))
    assert unknown_opt["type"] == "agency_pitch" and unknown_opt["source"] == "skipped"
    unasked = intake.chosen_type(_inputs("credentials"))
    assert unasked["type"] == "agency_pitch" and unasked["source"] == "default" and "not asked" in unasked["note"]


# ---------------------------------------------------------------- legacy types build exactly as before

def test_agency_pitch_profile_builds_the_golden_deck():
    """The agency_pitch profile changes nothing: the golden brief-only deck, byte for byte, apart from the keys the profile stamps."""
    st = {k: json.loads((BRIEF / f).read_text()) for k, f in (("a", "a_requirements.json"), ("b", "b_storyline.json"), ("c", "c_territories.json"), ("d", "d_idea.json"))}
    inp = inputs.load(BRIEF / "brief_object.json")
    deck = assemble.build(inp, st, client="Lumen Water", project="National awareness campaign", profile=profiles.load("agency_pitch"))
    deck["meta"].pop("built_at")
    assert deck["meta"].pop("built_from") == {"tier": "brief", "documents": [], "brief": True, "research": False, "type": "agency_pitch"}
    assert "profile" not in deck["meta"] and "length" not in deck["meta"] and "weights" not in deck["meta"]
    assert json.loads(json.dumps(deck, default=str)) == json.loads((BRIEF / "golden_deck.json").read_text())
    assert validate.run(deck, inp) == json.loads((BRIEF / "golden_validation.json").read_text())


@pytest.mark.parametrize("pid", ["agency_pitch", "investor_seed"])
def test_legacy_profiles_build_the_same_deck_as_no_profile(pid):
    """With or without its profile, an agency or investor deck is identical (only built_from.type is added), and both formats."""
    for fmt in ("pitch", "full"):
        plain, inp1 = _build(pid, None, fmt=fmt)
        typed, inp2 = _build(pid, fmt=fmt)
        for d in (plain, typed):
            d["meta"].pop("built_at")
        assert typed["meta"]["built_from"].pop("type") == pid
        assert typed == plain
        assert validate.run(typed, inp2) == validate.run(plain, inp1)


def test_investor_deck_is_the_recorded_golden():
    """The invented investor fixture builds the recorded golden deck and validation (recorded from the investor build as it stands:
    the original engine is not in version control here, so this pins it from now on)."""
    deck, inp = _build("investor_seed", None)
    deck["meta"].pop("built_at")
    deck["meta"].pop("built_from")
    assert json.loads(json.dumps(deck, default=str)) == json.loads((TYPES / "investor_seed" / "golden_deck.json").read_text())
    assert validate.run(deck, inp) == json.loads((TYPES / "investor_seed" / "golden_validation.json").read_text())


# ---------------------------------------------------------------- every profile builds

@pytest.mark.parametrize("pid", ["agency_pitch", "tender_response", "investor_seed", "credentials"])
def test_every_profile_builds_a_valid_deck_from_its_fixture(pid):
    """Each type builds a deck from invented stage outputs, offline; the deck passes the gate and records its type."""
    deck, inp = _build(pid)
    findings = validate.run(deck, inp)
    assert validate.summary(findings)["pass"], [f for f in findings if f["level"] == "error"]
    assert deck["meta"]["built_from"]["type"] == pid and deck["order"] and "title" in _types(deck)
    assert set(_types(deck)) <= set(spec.SLIDE_TYPES)


def test_tender_response_is_compliance_first_and_in_the_buyers_order():
    """The response map comes straight after the title, then the objective; slides answering a scored criterion follow the buyer's
    order (team, then insight and strategy, then measurement); routes not chosen sit behind the divider; the weights are the
    buyer's. (The buyer states 20 slides, so the prompt-only fixture is held to 10 as a sketch: the longer limit does not apply
    until the build is not a sketch; here the sketch is switched off to read the profile's own order.)"""
    deck, inp = _build("tender_response", inp=_no_sketch(_inputs("tender_response")))
    pres = _presented(deck)
    assert pres[:3] == ["title", "scoring", "objective"] and "brief_restated" not in pres
    assert pres.index("team") < pres.index("real_question") < pres.index("insight") < pres.index("proposition") < pres.index("measurement")
    back = _types(deck)[len(pres):]
    assert back[0] == "appendix" and "territory" in back and "territory_choice" in back and "territory" not in pres
    assert deck["meta"]["profile"]["id"] == "tender_response"
    assert deck["meta"]["weights"]["source"] == "brief" and deck["meta"]["weights"]["weights"]["Insight and campaign strategy"] == 40.0
    assert deck["meta"]["length"] == {"max_slides": 20, "minutes": 30, "source": "the buyer's stated limit"}
    sc = next(s for s in deck["slides"].values() if s["type"] == "scoring")
    assert [r[0] for r in sc["blocks"][0]["rows"][1:]] == ["Team and personnel", "Insight and campaign strategy", "Measurement and reporting"]
    assert all("not yet answered" not in r[2] for r in sc["blocks"][0]["rows"][1:])   # every criterion has a home


def _no_sketch(inp):
    """The same inputs with a document of real length, so the build is not a sketch (the profile's own length is read)."""
    inp.docs = {"pack": {"name": "Tender pack", "text": "x " * spec.SKETCH_DOC_CHARS, "pages": 1}}
    return inp


def test_tender_without_stated_weights_labels_the_default_split():
    """No weights in the buyer's criteria: the profile's default split, labelled as such; no limit stated: the profile's."""
    st = _stages("tender_response")
    st["a"]["scoring"] = [{**c, "weight": "to be confirmed"} for c in st["a"]["scoring"]]
    st["a"]["rules"] = []
    inp = _no_sketch(_inputs("tender_response"))
    inp.prompt_text = inp.prompt_text.replace("Presentations are limited to 20 slides.", "")   # the prompt is read for a limit too
    deck, _ = _build("tender_response", st=st, inp=inp)
    assert deck["meta"]["weights"]["source"] == "default_assumption" and deck["meta"]["weights"]["label"] == "default, not validated"
    assert deck["meta"]["length"]["source"] == "profile" and deck["meta"]["length"]["max_slides"] == 18


def test_tender_routes_asked_are_presented():
    """When the requirements ask for two routes, the tender deck presents them instead of hiding them behind the divider."""
    st = _stages("tender_response")
    st["a"]["requirements"].append({"id": "r_06", "kind": "scope", "text": "Show two creative routes", "ref": "prompt:2"})
    st["c"]["territories"].append({"id": "t2", "name": "Green Doorstep", "thought": "Start at the doorstep", "why": "It is close", "mood": "Calm", "risks": "Quiet", "sketch": "A doorstep"})
    st["c"]["ranking"]["order"].append("t2")
    st["c"]["ranking"]["reasons"]["t2"] = "Second"
    deck, _ = _build("tender_response", st=st, inp=_no_sketch(_inputs("tender_response")))
    assert _presented(deck).count("territory") == 2


def test_credentials_deck_is_short_and_team_and_proof_led():
    """Ten to fourteen slides; team and credentials right after the title (the objective, when there is one, is slide 2); questions and the next step close;
    no territories, idea, execution, price or measurement; no c or d stage was needed; 'how we work' is a labelled placeholder."""
    deck, inp = _build("credentials", inp=_no_sketch(_inputs("credentials")))
    pres = _presented(deck)
    assert 10 <= len(pres) <= 14
    assert pres[:3] == ["title", "team", "credentials"] and pres[-2:] == ["questions", "next_step"]
    assert "objective" not in pres   # no objective in the inputs: no slide, nothing invented
    assert "questions" in pres and "questions" not in _types(deck)[len(pres):]   # 'questions for the client' is presented, never backup
    assert not set(_types(deck)) & {"territory", "territory_choice", "idea", "execution", "investment", "measurement", "channel_roles", "timeline", "scoring"}
    assert set(_stages("credentials")) == {"a0", "a", "b"}
    proc = next(s for s in deck["slides"].values() if s["type"] == "process")
    assert proc["status"] == "needs_human" and all(i["human"] and i["text"].startswith(spec.PLACEHOLDER_PREFIX) for i in proc["blocks"][0]["items"])
    assert deck["meta"]["length"] == {"max_slides": 14, "minutes": 90, "source": "profile", "min_slides": 10}
    assert deck["meta"]["weights"]["source"] == "default_assumption" and deck["meta"]["weights"]["weights"]["team_proof"] == 30
    assert not [f for f in validate.run(deck, inp) if f["check"] == "pitch_length"]


def test_a_spine_profile_filters_slides_it_does_not_name():
    """Types outside spine and appendix are dropped, and the full format presents spine order with no divider."""
    deck, _ = _build("credentials", st={**_stages("credentials"), "a": {"stage": "a_requirements", "requirements": [{"id": "r_01", "kind": "commercial", "text": "Price the work", "ref": "prompt:2"}], "scoring": [], "rules": []}})
    assert "investment" not in _types(deck)
    full, _ = _build("tender_response", fmt="full")
    assert "appendix" not in _types(full) and _types(full).count("territory") == 1 and _types(full).index("scoring") == 1


@pytest.mark.parametrize("pid", ["agency_pitch", "tender_response", "credentials"])
def test_decks_with_a_type_match_the_deck_schema(pid):
    """meta.profile, meta.length, meta.weights and built_from.type are in deck.schema.json, optional, so these decks validate
    (the investor fixture is left out: its null block basis is an older gap in the schema, not a type field)."""
    jsonschema = pytest.importorskip("jsonschema")
    deck, _ = _build(pid)
    deck["territories"] = deck.get("territories") or {}
    jsonschema.validate(json.loads(json.dumps(deck, default=str)), json.loads((HERE.parent / "deck.schema.json").read_text()))


# ---------------------------------------------------------------- strictness

def _unmapped(deck: dict) -> dict:
    """A deck with one requirement no slide answers."""
    deck = copy.deepcopy(deck)
    deck["requirements"]["r_orphan"] = {"id": "r_orphan", "kind": "commercial", "text": "Quote a day rate", "ref": "prompt:2"}
    return deck


def test_strict_switches_change_error_and_warning_levels():
    """The same unmapped requirement is an error for a tender and an agency pitch and a warning for a credentials deck;
    a stated slide limit is an error for a tender and a warning for an agency pitch."""
    deck, inp = _build("tender_response")
    bad = _unmapped(deck)
    level = lambda p, d=bad, check="requirement_map": {f["level"] for f in validate.run(d, inp, profile=profiles.load(p)) if f["check"] == check}
    assert level("tender_response") == {"error"} and level("agency_pitch") == {"error"} and level("credentials") == {"warn"}
    assert validate.run(bad, inp) and level("tender_response") == {"error"}   # the deck's own profile is read from meta
    short = copy.deepcopy(deck)
    short["meta"]["length"] = {"max_slides": 5, "minutes": 30, "source": "the buyer's stated limit"}
    assert level("tender_response", short, "pitch_length") == {"error"} and level("agency_pitch", short, "pitch_length") == {"warn"}
    assert "at most 5 (the buyer's stated limit)" in next(f["message"] for f in validate.run(short, inp) if f["check"] == "pitch_length")


def test_credentials_length_floor_and_ceiling_are_errors():
    """Fewer than ten or more than fourteen presented slides is a pitch_length error for a credentials deck."""
    deck, inp = _build("credentials")
    few = copy.deepcopy(deck)
    few["meta"]["length"] = {"max_slides": 14, "minutes": 90, "source": "profile", "min_slides": 12}
    f = [x for x in validate.run(few, inp) if x["check"] == "pitch_length"]
    assert f and f[0]["level"] == "error" and "at least 12" in f[0]["message"]
    many = copy.deepcopy(deck)
    many["meta"]["length"] = {"max_slides": 8, "minutes": 90, "source": "profile"}
    assert [x["level"] for x in validate.run(many, inp) if x["check"] == "pitch_length"] == ["error"]


def test_a_deck_with_no_recorded_type_keeps_every_default_level():
    """A deck from before types, or built with no profile, validates as it always did."""
    deck, inp = _build("tender_response", None)
    assert validate.profile_of(deck) is None
    assert {f["level"] for f in validate.run(_unmapped(deck), inp) if f["check"] == "requirement_map"} == {"error"}


def test_tender_rule_broken_is_an_error():
    """A brief rule's quoted phrase on a slide is an error in a tender (compliance first)."""
    st = _stages("tender_response")
    st["b"]["reframe"]["line"] = "Households want zero waste."
    deck, inp = _build("tender_response", st=st)
    assert {f["level"] for f in validate.run(deck, inp) if f["check"] == "rule_broken"} == {"error"}


# ---------------------------------------------------------------- stage prompts

def test_stage_prompt_gets_the_types_guidance_before_the_input_rule():
    """With a profile the stage's prompt carries a <type_guidance> block with the profile's lines and still ends with the
    input rule; with no profile, or a legacy one, it is the file's own text."""
    plain = (stages.PROMPTS / "b_storyline.md").read_text()
    assert stages._sysmsg("b_storyline.md", "b") == plain == stages._sysmsg("b_storyline.md", "b", profiles.load("agency_pitch"))
    t = stages._sysmsg("b_storyline.md", "b", profiles.load("tender_response"))
    assert "<type_guidance>" in t and "buyer's order" in t and "never overrides" in t.replace("never override", "never overrides")
    assert t.index("<type_guidance>") < t.index("Inputs are the only source:") and t.index("</type_guidance>") < t.index("Inputs are the only source:")
    a0 = stages._sysmsg("a0_intake.md", "a0", profiles.load("tender_response"))
    assert a0.rstrip("\n").splitlines()[-1].startswith("Inputs are the only source:") and "<type_guidance>" in a0
    assert stages._sysmsg("c_judge.md", "c_judge", profiles.load("tender_response")) == (stages.PROMPTS / "c_judge.md").read_text()
    assert stages._sysmsg("e_copy.md", "e", profiles.load("credentials")).count("<type_guidance>") == 1


def test_a_stage_a_type_does_not_run_is_refused(monkeypatch):
    """run_stage('d') for a credentials deck raises instead of spending a model call."""
    monkeypatch.setattr(stages, "idea", lambda *a, **k: ({}, {}))
    with pytest.raises(ValueError, match="does not run stage d"):
        stages.run_stage("d", None, {}, profiles.load("credentials"))
    assert stages.run_stage("d", None, {}, profiles.load("tender_response")) == ({}, {})


def test_live_intake_leads_with_the_type_question(monkeypatch):
    """The a0 stage's output (stubbed model) has the type question first, at most five questions, valid."""
    monkeypatch.setattr(stages, "_call", lambda stage, user, system: ({"fields": {}, "questions": [
        {"id": f"q_{i}", "text": f"Question {i}?", "options": [], "allow_text": True, "address": "brief.audience"} for i in range(5)]},
        {"model": "stub", "secs": 0, "calls": 1}))
    inp = _inputs("tender_response")
    out, _ = stages.intake(inp, "agency", profiles.load("tender_response"))
    assert out["questions"][0]["id"] == "q_deck_type" and len(out["questions"]) <= 5 and intake.validate_a0(out) == []
    assert out["questions"][0]["options"][0]["id"] == "tender_response"   # inferred from the prompt's own words


# ---------------------------------------------------------------- the CLI

def _main(monkeypatch, tmp_path, argv):
    """Run run_deck.main with the renderers and LibreOffice stubbed out (no soffice, no model)."""
    for mod, fn in ((run_deck.render_pptx, "render"), (run_deck.render_web, "render")):
        monkeypatch.setattr(mod, fn, lambda *a, **k: tmp_path / "deck.pptx")
    monkeypatch.setattr(run_deck.subprocess, "run", lambda *a, **k: None)
    monkeypatch.setattr(run_deck, "_soffice", lambda: "soffice")
    monkeypatch.setattr(run_deck.qa_render, "run", lambda *a, **k: {"summary": {"line": "qa stub"}})
    return run_deck.main(argv)


def _cli(monkeypatch, tmp_path, pid, *extra):
    """Run the CLI on a type's fixture folder; returns (report, deck, out dir)."""
    out = tmp_path / "out"
    rep = _main(monkeypatch, tmp_path, ["--prompt-file", str(TYPES / pid / "prompt.txt"), "--stages", str(TYPES / pid), "--client", "Fixture Client",
                                        "--project", "Fixture Project", "--out", str(out), *extra])
    return rep, json.loads((out / "deck.json").read_text()), out


def test_kind_tender_and_credentials_build_through_the_cli(monkeypatch, tmp_path):
    """--kind tender and --kind credentials pick their profiles; the deck records type, profile and how it was chosen;
    a credentials run asks for no c or d stage file."""
    rep, deck, out = _cli(monkeypatch, tmp_path / "t", "tender_response", "--kind", "tender")
    assert rep["type"]["id"] == "tender_response" and deck["meta"]["profile"] == deck["meta"]["built_from"]["profile"]
    assert deck["meta"]["built_from"]["type"] == "tender_response" and deck["meta"]["built_from"]["profile"]["source"] == "flag"
    assert rep["validation"]["pass"] and "scoring" in _types(deck)
    rep, deck, out = _cli(monkeypatch, tmp_path / "c", "credentials", "--kind", "credentials")
    assert rep["type"]["id"] == "credentials" and "c" not in rep["stages"] and "d" not in rep["stages"] and rep["stages"]["b"]["source"] == "recorded"
    assert rep["validation"]["pass"] and 10 <= rep["slides"] and "territory" not in _types(deck)


def test_answer_chooses_the_type_and_a_skip_defaults_to_agency(monkeypatch, tmp_path):
    """No --kind: the answer to q_deck_type picks the profile (recorded in meta); a skipped answer builds an agency pitch and
    records the default in meta; no answer builds an agency pitch and leaves meta as it always was."""
    ans = tmp_path / "a.json"
    ans.write_text(json.dumps({"q_deck_type": {"option_id": "credentials", "at": "now"}}))
    rep, deck, _ = _cli(monkeypatch, tmp_path / "1", "credentials", "--answers", str(ans))
    assert rep["type"]["source"] == "answer" and deck["meta"]["profile"]["id"] == "credentials" and "territory" not in _types(deck)
    ans.write_text(json.dumps({"q_deck_type": {"skipped": True}}))
    rep, deck, _ = _cli(monkeypatch, tmp_path / "2", "agency_pitch", "--answers", str(ans))
    assert deck["meta"]["kind"] == "agency" and deck["meta"]["profile"]["id"] == "agency_pitch" and deck["meta"]["profile"]["source"] == "skipped"
    assert "skipped" in deck["meta"]["built_from"]["profile"]["note"]
    rep, deck, _ = _cli(monkeypatch, tmp_path / "3", "agency_pitch")
    assert rep["type"]["source"] == "default" and "profile" not in deck["meta"] and deck["meta"]["built_from"]["type"] == "agency_pitch"
    assert rep["type_question"]["id"] == "q_deck_type" and rep["type_question"]["options"][0]["id"] == "agency_pitch"


def test_flag_beats_the_answer_and_investor_still_builds(monkeypatch, tmp_path):
    """--kind investor keeps the investor assembler and stage set even when an answer says otherwise."""
    ans = tmp_path / "a.json"
    ans.write_text(json.dumps({"q_deck_type": {"option_id": "tender_response"}}))
    rep, deck, _ = _cli(monkeypatch, tmp_path / "i", "investor_seed", "--kind", "investor", "--answers", str(ans))
    assert deck["meta"]["kind"] == "investor" and deck["meta"]["built_from"]["type"] == "investor_seed" and rep["stages"]["i"]["source"] == "recorded"
    assert "profile" not in deck["meta"]   # a flagged legacy type leaves meta as it was; built_from records it


def test_a_recorded_a0_gets_the_type_question_first(monkeypatch, tmp_path):
    """A run with a recorded a0 puts q_deck_type first in the intake's questions (and its profile's own for gaps), reported."""
    rep, deck, _ = _cli(monkeypatch, tmp_path, "credentials", "--kind", "credentials")
    assert rep["intake"]["questions"] == 1 and rep["intake"]["questions_total"] >= 2 <= intake.MAX_QUESTIONS


# ---------------------------------------------------------------- docstrings

def test_every_function_has_a_docstring():
    """The rule for this lane: every function in the new and extended modules and in this file has a docstring."""
    for path in (profiles.__file__, intake.__file__, assemble.__file__, stages.__file__, validate.__file__, run_deck.__file__, __file__):
        tree = ast.parse(Path(path).read_text())
        missing = [n.name for n in ast.walk(tree) if isinstance(n, (ast.FunctionDef, ast.AsyncFunctionDef)) and not ast.get_docstring(n)
                   and not n.name.startswith("<")]
        # nested helpers named in the original modules (closures such as ``add``) are exempt only where they already lacked one
        assert not [m for m in missing if m in ("infer_type", "type_question", "add_type_question", "chosen_type", "type_card_for", "load", "ids",
                                                "validate_profile", "weights", "guidance", "stage_names", "runs", "for_kind", "default_for_kind",
                                                "all_profiles", "_arrange_spine", "_length_for", "_criteria_rank", "_shown_executions", "_shown_charts",
                                                "_sysmsg", "_stamp_type", "profile_of", "_recognise", "_texts_of")], (path, missing)
        if path in (profiles.__file__, __file__):
            assert not missing, (path, missing)


# ---------------------------------------------------------------- fixer round: type findings

def test_every_profile_question_on_one_field_is_asked():
    """Several profile questions on one brief field are all asked while there is room (tender: criteria, limits, scope)."""
    p = profiles.load("tender_response")
    a0 = {"questions": [], "gaps": {"brief_fields": [{"field": "mandatories"}, {"field": "budget_scope"}]}}
    ids = [q["id"] for q in intake.add_type_question(a0, intake.type_question(), p)["questions"]]
    assert {"q_criteria", "q_limits", "q_scope"} <= set(ids) and len(ids) <= intake.MAX_QUESTIONS


def test_validate_survives_an_unknown_recorded_type():
    """A deck recording a type this engine lacks falls back to no profile instead of raising."""
    deck, inp = _build("tender_response")
    deck["meta"]["profile"]["id"] = "foo"
    assert validate.profile_of(deck) is None
    validate.run(deck, inp)
    deck["meta"].pop("profile")
    deck["meta"].setdefault("built_from", {})["type"] = "foo"
    assert validate.profile_of(deck) is None


def test_full_format_puts_appendix_only_types_after_the_spine():
    """In the full format the appendix-only types follow the whole spine, not sit mid-deck."""
    full, _ = _build("tender_response", fmt="full")
    t = _presented(full)
    appx = [i for i, x in enumerate(t) if x in ("territory", "territory_choice", "questions")]
    assert appx and min(appx) > t.index("next_step")


def test_malformed_profiles_give_errors_not_exceptions():
    """Non-dict questions, non-numeric weights, unhashable spine entries and bool lengths are errors."""
    base = profiles.load("tender_response")
    def bad(f):
        """Apply a change to a copy of the profile and assert it is reported."""
        p = copy.deepcopy(base)
        f(p)
        errs = profiles.validate_profile(p)
        assert errs
    bad(lambda p: p["questions"].__setitem__(0, ["x"]))
    bad(lambda p: p["rubric_weights"]["weights"].__setitem__("insight", "14"))
    bad(lambda p: p["spine"].append([1]))
    bad(lambda p: p["length"].__setitem__("max_slides", True))
    bad(lambda p: p["length"].__setitem__("min_slides", True))
