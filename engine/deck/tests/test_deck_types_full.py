"""deck-types slices 4-9 (features/deck-types.clan): density, pictures, brand and titles per type; the creative_work profile; precedence and
the type change; the picker's generated card data; the read format ('Sent to be read'); and the goldens with the recipes on.
Offline: no model, no money, invented fixtures only. Run from ``engine/``: ``PYTHONPATH=. python3 -m pytest -q deck/tests``.
Regenerate the recipes-on goldens only for an intended change: ``DECK_WRITE_GOLDEN=1`` on this file, then read the diff.
"""
from __future__ import annotations

import copy
import json
import os
import re
from collections import Counter
from pathlib import Path
from types import SimpleNamespace

import pytest

from deck import assemble, images, imagegen, inputs, intake, layouts, profiles, run_deck, server, spec, stages, validate

HERE = Path(__file__).parent
FIX = HERE / "fixtures"
TYPES = FIX / "types"
LUMEN = FIX / "lumen_water"
GOLD = json.loads((LUMEN / "golden_deck.json").read_text())
FILES = {"a0": "a0_intake.json", "a": "a_requirements.json", "b": "b_storyline.json", "c": "c_territories.json",
         "d": "d_idea.json", "i": "i_investor.json"}
RECIPES_GOLD = FIX / "recipes_on"
TEMPLATE_SCHEMA = HERE.parents[2] / "app" / "templates" / "deck-maker" / "schema.json"


def _on(monkeypatch, recipes=True, look=True):
    monkeypatch.setattr(spec, "LOOK_V3", look)
    monkeypatch.setattr(spec, "RECIPES", recipes)


def _stages(folder: Path) -> dict:
    return {k: json.loads((folder / f).read_text()) for k, f in FILES.items() if (folder / f).exists()}


def _inp(folder: Path):
    if (folder / "brief_object.json").exists():
        return inputs.load(folder / "brief_object.json")
    return inputs.load(None, prompt_text=(folder / "prompt.txt").read_text().strip())


def _build(folder: Path, pid: str, fmt: str = "pitch") -> tuple:
    inp = _inp(folder)
    p = profiles.load(pid)
    builder = assemble.build_investor if p["kind"] == "investor" else assemble.build
    return builder(inp, _stages(folder), client="Fixture Client", project="Fixture Project", fmt=fmt, profile=p), inp, p


def _presented_types(deck: dict) -> list:
    return [deck["slides"][s]["type"] for s in validate.presented(deck)]


#: Keys whose values are ids and records, not words a slide says.
_NOT_WORDS = ("id", "chosen", "chosen_by", "ref", "refs", "stage", "produced_by", "ranking", "basis", "kind", "visual")


def _words(x) -> Counter:
    """The words of every string in a JSON value (keys and id-like fields excluded), lower case."""
    out = Counter()
    if isinstance(x, str):
        out.update(re.findall(r"[a-z0-9%€]+", x.lower()))
    elif isinstance(x, dict):
        for k, v in x.items():
            if k not in _NOT_WORDS:
                out += _words(v)
    elif isinstance(x, list):
        for v in x:
            out += _words(v)
    return out


# ---------------------------------------------------------------- slice 4: density, pictures, brand and titles per type

def test_each_type_has_its_density_level_roles_and_windows():
    want = {"agency_pitch": "lean", "credentials": "standard", "investor_seed": "lean", "tender_response": "detailed", "creative_work": "lean"}
    for pid, lvl in want.items():
        d = profiles.recipe(profiles.load(pid))["density"]
        assert d["level"] == lvl, pid
        assert set(spec.ROLE_OF_TYPE.items()) <= set(d["roles"].items()) or pid in ("credentials", "investor_seed", "creative_work"), pid
    cr = profiles.recipe(profiles.load("credentials"))["density"]
    assert cr["roles"]["team"] == cr["roles"]["credentials"] == cr["roles"]["process"] == "argument" and cr["roles"]["questions"] == "statement"
    inv = profiles.recipe(profiles.load("investor_seed"))["density"]
    assert inv["windows"]["argument"] == [25, 60] and inv["windows"]["statement"] == [10, 35]
    assert inv["roles"]["traction"] == "argument" and inv["roles"]["why_now"] == "statement"
    cw = profiles.recipe(profiles.load("creative_work"))["density"]
    assert cw["roles"]["territory"] == "statement" and cw["roles"]["territory_choice"] == "argument"


def test_the_agency_recipe_keeps_todays_density_exactly():
    """agency_pitch's density is today's constants (lean, spec.ROLE_OF_TYPE, spec.ROLE_WINDOWS): its decks keep their density with the flag on."""
    d = profiles.recipe(profiles.load("agency_pitch"))["density"]
    assert d == {"level": "lean", "roles": dict(spec.ROLE_OF_TYPE), "windows": {k: list(v) for k, v in spec.ROLE_WINDOWS.items()}}


def test_plan_with_todays_roles_is_todays_plan_and_a_tighter_window_moves_no_fewer(monkeypatch):
    monkeypatch.setattr(spec, "LOOK_V3", True)
    base = copy.deepcopy(GOLD)
    a, _, _ = layouts.plan(copy.deepcopy(base), prefs={"density": "lean"})
    b, _, _ = layouts.plan(copy.deepcopy(base), prefs={"density": "lean", "roles": dict(spec.ROLE_OF_TYPE), "windows": dict(spec.ROLE_WINDOWS)})
    assert json.dumps(a, sort_keys=True) == json.dumps(b, sort_keys=True)
    tight, _, _ = layouts.plan(copy.deepcopy(base), prefs={"density": "lean", "roles": dict(spec.ROLE_OF_TYPE), "windows": {"statement": [1, 2], "argument": [1, 2]}})
    for sid in base["order"]:
        assert len(tight["slides"][sid]["layout"]["fit"]["moved"]) >= len(a["slides"][sid]["layout"]["fit"]["moved"]), sid
        assert tight["slides"][sid]["blocks"] == base["slides"][sid]["blocks"]   # the plan never edits a word


def _role_findings(deck, inp, profile) -> list:
    return [f for f in validate.run(deck, inp, profile=profile) if f["check"] == "role_words"]


def test_role_words_reads_the_types_windows(monkeypatch):
    _on(monkeypatch)
    deck, inp = copy.deepcopy(GOLD), inputs.load(LUMEN / "brief_object.json")
    agency = _role_findings(deck, inp, profiles.load("agency_pitch"))
    assert all(("10-35" in f["message"]) or ("35-70" in f["message"]) for f in agency)
    inv = _role_findings(deck, inp, profiles.load("investor_seed"))
    assert any("25-60" in f["message"] for f in inv) or not [f for f in agency if "35-70" in f["message"]]
    assert not _role_findings(deck, inp, profiles.load("tender_response"))   # detailed: no windows
    _on(monkeypatch, recipes=False)
    assert [f["message"] for f in _role_findings(deck, inp, profiles.load("investor_seed"))] == [f["message"] for f in agency]   # flag off: today's


def test_label_titles_are_not_held_to_claims_and_no_title_is_rewritten(monkeypatch):
    deck, inp = copy.deepcopy(GOLD), inputs.load(LUMEN / "brief_object.json")
    for sid in deck["order"][1:4]:
        deck["slides"][sid]["title"] = "Short label"
    _on(monkeypatch)
    claims = [f for f in validate.run(deck, inp, profile=profiles.load("agency_pitch")) if f["check"] == "action_title"]
    labels = [f for f in validate.run(copy.deepcopy(deck), inp, profile=profiles.load("creative_work")) if f["check"] == "action_title"]
    assert claims and not labels
    assert [deck["slides"][s]["title"] for s in deck["order"][1:4]] == ["Short label"] * 3
    _on(monkeypatch, recipes=False)
    assert [f for f in validate.run(deck, inp, profile=profiles.load("creative_work")) if f["check"] == "action_title"] == claims


def test_title_forms_select_stage_e_lines_only_for_label(monkeypatch):
    _on(monkeypatch)
    plain = stages._sysmsg("e_copy.md", "e", None)
    for pid in ("agency_pitch", "investor_seed"):   # claim: no new line, so recorded runs replay
        assert profiles.title_guidance(profiles.load(pid)) == []
        assert stages._sysmsg("e_copy.md", "e", profiles.load(pid)) == plain
    assert profiles.title_guidance(profiles.load("tender_response")) == []   # criterion: the tender's own stage e line already says it
    cw = stages._sysmsg("e_copy.md", "e", profiles.load("creative_work"))
    assert spec.TITLE_FORM_GUIDANCE["label"][0] in cw and cw.index("<type_guidance>") < cw.index("Inputs are the only source:")
    assert spec.TITLE_FORM_GUIDANCE["label"][0] not in stages._sysmsg("d_idea.md", "d", profiles.load("creative_work"))
    _on(monkeypatch, recipes=False)
    assert spec.TITLE_FORM_GUIDANCE["label"][0] not in stages._sysmsg("e_copy.md", "e", profiles.load("creative_work"))


def test_picture_policy_per_type():
    pol = {pid: profiles.recipe(profiles.load(pid))["pictures"] for pid in profiles.ids()}
    assert pol["agency_pitch"]["generate"] == "all" and set(pol["agency_pitch"]["types"]) == set(spec.PICTURE_SLIDE_TYPES)
    assert pol["credentials"]["generate"] == "cover"   # Q9: never a generated person or case
    assert pol["tender_response"]["generate"] == "none" and pol["tender_response"]["types"] == ["title"]
    assert pol["investor_seed"]["types"] == ["title", "product"]
    assert pol["creative_work"]["on"] == "creative_cover" and pol["creative_work"]["generate"] == "all"
    for p in pol.values():
        assert set(p["types"]) <= set(spec.PICTURE_SLIDE_TYPES)   # a recipe never opens an evidence slide


def _empty_picture_deck() -> dict:
    d = copy.deepcopy(GOLD)
    images.add_empty_slots(d, "creative_cover")
    return d


def test_generation_plans_only_where_the_type_allows():
    full = {(c["sid"], c["slot"]) for c in imagegen.candidate_slots(_empty_picture_deck(), [], "all")}
    cover = imagegen.candidate_slots(_empty_picture_deck(), [], "cover")
    assert full and cover and len(cover) < len(full)
    d = _empty_picture_deck()
    assert all(d["slides"][c["sid"]]["type"] == "title" for c in cover)
    assert imagegen.candidate_slots(_empty_picture_deck(), [], "none") == []
    assert {(c["sid"], c["slot"]) for c in imagegen.candidate_slots(_empty_picture_deck(), [])} == full   # the default is today


def test_a_made_or_approved_picture_is_never_a_generation_candidate():
    d = _empty_picture_deck()
    for sid, slot, im in list(images.image_slots(d)):
        im.update(status="approved", approval={"by": "human:x", "at": "2026-11-18"})
    for g in ("all", "cover", "none"):
        assert imagegen.candidate_slots(copy.deepcopy(d), [], g) == []


def test_empty_slots_narrow_to_the_types_when_asked():
    a, b = copy.deepcopy(GOLD), copy.deepcopy(GOLD)
    n_all = images.add_empty_slots(a, "creative_cover")
    n_title = images.add_empty_slots(b, "creative_cover", ["title"])
    assert 0 < n_title < n_all
    assert all(b["slides"][sid]["type"] == "title" for sid, _, _ in images.image_slots(b))
    assert images.add_empty_slots(copy.deepcopy(GOLD), "creative_cover", None) == n_all


def test_brand_strictness_applies_only_with_an_agency_pack(monkeypatch):
    _on(monkeypatch)
    pack = SimpleNamespace(source="pack.clan", deck={})
    for pid, want in (("agency_pitch", True), ("credentials", True), ("tender_response", True), ("investor_seed", False), ("creative_work", False)):
        assert run_deck._strict_default(profiles.load(pid), "pitch", pack, None) is want, pid
        assert run_deck._strict_default(profiles.load(pid), "pitch", None, None) is False, pid   # no pack, no kit: the agency look stays
    assert run_deck._strict_default(profiles.load("agency_pitch"), "pitch", SimpleNamespace(source="built-in default"), None) is False


# ---------------------------------------------------------------- slice 5: creative_work

def test_creative_work_profile_presents_routes_and_no_price_or_team():
    p = profiles.load("creative_work")
    assert p["kind"] == "agency" and p["arrange"] == "spine" and p["stages"] == ["a0", "a", "b", "c", "d", "fit", "e"]
    pres = [t for t in p["spine"] if t not in p["appendix"]]
    assert {"territory", "territory_choice", "idea", "execution", "questions", "next_step"} <= set(pres)
    assert not {"investment", "team", "credentials", "measurement"} & set(p["spine"])
    assert not {"investment", "team", "credentials"} & set(p["appendix"])
    assert p["questions"][0]["text"] == "How many routes do you want to show?"
    assert sum(p["rubric_weights"]["weights"].values()) == 100
    assert profiles.for_kind("creative")["id"] == "creative_work"


def test_creative_work_builds_every_route_at_most_three_executions(monkeypatch):
    _on(monkeypatch)
    monkeypatch.setattr(assemble, "_sketch", lambda inp: False)
    deck, inp, p = _build(TYPES / "creative_work", "creative_work")
    pres = _presented_types(deck)
    terr = [t["name"] for t in _stages(TYPES / "creative_work")["c"]["territories"]]
    assert pres.count("territory") == len(terr) == 2
    assert 1 <= pres.count("execution") <= spec.PITCH_EXECUTIONS
    assert not {"investment", "team", "credentials"} & set(pres)
    assert pres.index("territory_choice") < pres.index("idea")
    found = validate.run(deck, inp, profile=p)
    assert not [f for f in found if f["check"] == "repeated_line"]   # said once


def test_creative_work_keeps_every_word_the_stages_wrote(monkeypatch):
    """Per-word survival: every word of stages c and d is on a slide, in the appendix or in the notes (the slides a work session does not
    present sit behind the divider; nothing a stage wrote is dropped)."""
    _on(monkeypatch)
    monkeypatch.setattr(assemble, "_sketch", lambda inp: False)
    deck, _, _ = _build(TYPES / "creative_work", "creative_work")
    st = _stages(TYPES / "creative_work")
    on_deck = _words([deck["slides"][s] for s in deck["order"]])
    for k in ("c", "d"):
        want = _words({kk: vv for kk, vv in st[k].items() if kk not in ("stage", "produced_by", "ranking", "chosen_by", "refs")})
        missing = {w for w in want if w not in on_deck}
        assert not missing - {"recorded", "image_prompt", "kind", "prompt", "visual", "basis", "proposal", "invented", "stand", "in"}, (k, missing)


def test_creative_signals_and_tissue_session_moved(monkeypatch):
    _on(monkeypatch)
    got = intake.infer_type("A tissue session: show the creative routes as work in progress.")
    assert got["type"] == "creative_work" and got["confidence"] == "high" and "tissue session" in got["evidence"]
    assert not any("tissue" in pat for pat, _, _ in intake.SIGNALS["agency_pitch"])
    assert "creative_work" in [o["id"] for o in intake.type_question(got)["options"]]
    _on(monkeypatch, recipes=False)   # flag off: the table from before deck-types, and creative_work not offered
    off = intake.infer_type("A tissue session: show the creative routes as work in progress.")
    assert off["type"] == "agency_pitch"
    assert "creative_work" not in [o["id"] for o in intake.type_question(off)["options"]]


def test_no_award_word_in_any_signal_or_profile():
    award = re.compile(r"(?i)\b(award|cannes|lions|effies?|d&ad|entry|entries)\b")
    for tid, pats in intake.SIGNALS.items():
        for pat, _, _ in pats:
            assert not award.search(pat.replace("(?:award|evaluation|selection) criteria", "")), (tid, pat)
    for p in profiles.all_profiles():
        for k in ("label", "one_line"):
            assert not award.search(p[k]), p["id"]


# ---------------------------------------------------------------- slice 6: precedence and the type change

def _prompt(text: str, answers=None):
    return inputs.load(None, prompt_text=text, answers=answers or {})


def test_precedence_flag_and_pick_then_answer_then_inference_then_default(monkeypatch):
    _on(monkeypatch)
    tender = "An invitation to tender with scoring criteria."
    inp = _prompt(tender, {"q_deck_type": {"option_id": "credentials"}})
    assert intake.chosen_type(inp, "investor", "creative_work")["source"] == "flag"
    got = intake.chosen_type(inp, None, "creative_work")
    assert got == {"type": "creative_work", "source": "pick", "note": "the person picked creative_work on the type picker"}
    assert intake.chosen_type(inp)["source"] == "answer" and intake.chosen_type(inp)["type"] == "credentials"
    inf = intake.chosen_type(_prompt(tender))
    assert inf["type"] == "tender_response" and inf["source"] == "inferred" and "invitation to tender" in inf["evidence"]
    assert '"invitation to tender"' in inf["note"] and "Change" in inf["note"]
    skipped = intake.chosen_type(_prompt(tender, {"q_deck_type": {"skipped": True}}))
    assert skipped["source"] == "inferred"   # a skipped question still reads the brief (Q5)
    assert intake.infer_type("Our investors ask about the valuation.")["confidence"] == "medium"
    assert intake.chosen_type(_prompt("Our investors ask about the valuation."))["source"] == "default"   # medium confidence never decides
    with pytest.raises(profiles.ProfileError):
        intake.chosen_type(inp, None, "award_entry")


def test_with_the_recipes_off_a_skipped_question_stays_the_default(monkeypatch):
    _on(monkeypatch, recipes=False)
    tender = "An invitation to tender with scoring criteria."
    assert intake.chosen_type(_prompt(tender))["source"] == "default"
    assert intake.chosen_type(_prompt(tender, {"q_deck_type": {"skipped": True}}))["source"] == "skipped"
    assert intake.chosen_type(_prompt(tender), None, "credentials")["source"] == "pick"   # a document's pick works with the flag off
    for flag, pick in ((None, "creative_work"), ("creative", None)):   # a type that joined with the recipes is refused while they are off
        with pytest.raises(profiles.ProfileError, match="needs the deck recipes"):
            intake.chosen_type(_prompt(tender), flag, pick)


def test_a_pick_frees_the_type_questions_place():
    a0 = {"questions": [{"id": f"q_{i}", "text": f"Q{i}", "options": [], "allow_text": True, "address": "brief.background"} for i in range(6)]}
    card = intake.type_question()
    asked = intake.add_type_question(copy.deepcopy(a0), card)
    picked = intake.add_type_question(copy.deepcopy(a0), None)
    assert asked["questions"][0]["id"] == "q_deck_type" and len(asked["questions"]) == intake.MAX_QUESTIONS
    assert all(q["id"] != "q_deck_type" for q in picked["questions"]) and len(picked["questions"]) == intake.MAX_QUESTIONS


def test_which_type_changes_are_free():
    rec = {"a", "b", "c", "d"}
    for pid, need in (("agency_pitch", []), ("creative_work", []), ("tender_response", []), ("credentials", []), ("investor_seed", ["i"])):
        tc = profiles.type_change(profiles.load(pid), rec)
        assert tc == {"free": not need, "needs": need}, pid
    assert profiles.type_change(profiles.load("creative_work"), {"a", "b"})["needs"] == ["c", "d"]   # credentials -> work session
    assert profiles.type_change(profiles.load("agency_pitch"), {"i"})["needs"] == ["a", "b", "c", "d"]
    free = profiles.change_sheet(profiles.load("agency_pitch"), profiles.load("creative_work"), rec, 12)
    assert free["line"] == "Re-arranges 12 slides as a creative work session. No new writing. Pictures kept."
    ask = profiles.change_sheet(profiles.load("credentials"), profiles.load("creative_work"), {"a", "b"})
    assert ask["line"] == "Needs new writing: the routes, the idea and executions. Pictures kept." and not ask["free"]


def test_a_change_that_needs_a_model_stage_is_refused_live_without_a_yes(tmp_path):
    for fn in ("a_requirements.json", "b_storyline.json"):
        (tmp_path / fn).write_text("{}")
    a = SimpleNamespace(stages=tmp_path, live=True, confirm_stages=False)
    with pytest.raises(SystemExit, match=r"refused: changing to creative_work needs new writing: stages c, d .*--confirm-stages.*pictures are kept"):
        run_deck._type_change(a, profiles.load("creative_work"))
    ok = run_deck._type_change(SimpleNamespace(stages=tmp_path, live=True, confirm_stages=True), profiles.load("creative_work"))
    assert ok["needs"] == ["c", "d"] and "Needs new writing" in ok["line"]
    offline = run_deck._type_change(SimpleNamespace(stages=tmp_path, live=False, confirm_stages=False), profiles.load("creative_work"))
    assert offline["free"] is False   # a replay reports the missing stages as today; nothing runs
    first = run_deck._type_change(SimpleNamespace(stages=tmp_path / "none", live=True, confirm_stages=False), profiles.load("investor_seed"))
    assert first["needs"] == ["i"] and "line" not in first   # a first build is not a change


def test_a_free_change_keeps_the_words_of_every_slide_and_switching_back_restores_the_deck(monkeypatch):
    _on(monkeypatch)
    strip = lambda d: json.dumps({**d, "meta": {k: v for k, v in d["meta"].items() if k != "built_at"}}, sort_keys=True)   # noqa: E731
    agency, _, _ = _build(LUMEN, "agency_pitch")
    work, _, _ = _build(LUMEN, "creative_work")
    again, _, _ = _build(LUMEN, "agency_pitch")
    assert strip(agency) == strip(again)
    by = {(s["type"], s["title"]): s["blocks"] for s in agency["slides"].values() if not s.get("merged")}
    same = [(s["type"], s["title"]) for s in work["slides"].values() if (s["type"], s["title"]) in by and s["type"] not in ("appendix",)]
    assert len(same) >= 5
    for key in same:
        w = next(s for s in work["slides"].values() if (s["type"], s["title"]) == key)
        assert w["blocks"] == by[key] or w["type"] in ("requirement_trace", "appendix_sources"), key


def test_the_document_pick_is_read_from_inputs_deck_type():
    assert inputs._deck_type_pick({"id": "investor_seed", "by": "person", "at": "2026-11-18T10:00:00Z"}) == "investor_seed"
    assert inputs._deck_type_pick(None) is None and inputs._deck_type_pick({}) is None and inputs._deck_type_pick("credentials") is None


def test_the_server_passes_the_pick_as_type_and_keeps_old_cache_keys(monkeypatch):
    base = {"prompt": {"text": "x", "client": "c", "project": "p", "agency": ""}, "kind": "agency", "format": "pitch"}
    assert server.picked_type(base) is None and server.picked_type({**base, "deck_type": None}) is None
    assert server.inputs_key(base) == server.inputs_key({**base, "deck_type": None})   # no pick: today's key
    assert server.inputs_key(base) == server.inputs_key({**base, "deck_type": {"id": "creative_work"}})   # the type shares the recorded stages
    s = server.Settings({"NAPKIN_DECK_REPLAY": str(HERE)})
    req = server.validate_request({"doc": "d", "inputs": {**base, "deck_type": {"id": "investor_seed", "by": "person", "at": "t"}}}, s)
    assert req["kind"] == "investor"   # the pick names the assembler and its gates
    with pytest.raises(server.Refused):
        server.validate_request({"doc": "d", "inputs": {**base, "deck_type": {"id": "award_entry"}}}, s)


def test_the_deck_records_how_the_type_was_chosen(monkeypatch):
    _on(monkeypatch)
    deck, _, p = _build(LUMEN, "tender_response")
    run_deck._stamp_type(deck, p, {"type": "tender_response", "source": "inferred", "note": "n", "evidence": ["invitation to tender"]}, "full")
    rec = deck["meta"]["built_from"]["profile"]
    assert rec["source"] == "inferred" and rec["evidence"] == ["invitation to tender"] and rec["format"] == "full"
    assert deck["meta"]["profile"] == rec
    _on(monkeypatch, recipes=False)
    d2, _, p2 = _build(LUMEN, "agency_pitch")
    run_deck._stamp_type(d2, p2, {"type": "agency_pitch", "source": "default", "note": "n"}, "pitch")
    assert "format" not in d2["meta"]["built_from"]["profile"] and "profile" not in d2["meta"]   # flag off, default: as before


def test_the_deck_schema_takes_the_new_sources():
    s = json.loads((HERE.parent / "deck.schema.json").read_text())
    txt = json.dumps(s)
    assert '"pick"' in txt and '"inferred"' in txt


# ---------------------------------------------------------------- slice 7: the picker's card data (generated)

def test_the_template_block_equals_card_data():
    """design.breakage: the picker and the engine never disagree on types. Regenerate with ``python3 -m deck.profiles cards`` from engine/."""
    assert profiles.cards_in_template() == profiles.cards_json()
    assert json.loads(profiles.cards_in_template()) == profiles.card_data()


def test_card_data_shape_and_the_real_spine():
    cards = profiles.card_data()
    assert [c["id"] for c in cards] == profiles.ids() and cards[0]["id"] == spec.DEFAULT_TYPE
    for c in cards:
        p = profiles.load(c["id"])
        assert c["label"] == p["label"] and c["one_line"] == p["one_line"] and c["kind"] == p["kind"]
        assert 1 <= len(c["spine"]) <= profiles.CARD_SPINE_MAX and c["spine"][0]["type"] == "title"
        assert all(s["purpose"] in spec.LAYOUT_PURPOSES and s["section"] == spec.SLIDE_TYPES[s["type"]]["section"] for s in c["spine"])
        assert all(s["type"] in p["spine"] and s["type"] not in (p.get("appendix") or []) for s in c["spine"])
        assert c["pictures"] in ("many", "few", "cover only", "none generated", "none")
        assert set(c["stages"]) <= set(p["stages"])
    by = {c["id"]: c for c in cards}
    assert by["tender_response"]["target"] is None and by["tender_response"]["pictures"] == "none generated"
    assert by["credentials"]["pictures"] == "cover only" and by["investor_seed"]["stages"] == ["i"]
    assert "investment" not in [s["type"] for s in by["creative_work"]["spine"]]
    agency = [s["type"] for s in by["agency_pitch"]["spine"]]
    assert agency.index("team") < agency.index("investment") and "credentials" not in agency   # merged into the team slide


def test_the_template_schema_names_every_type():
    s = json.loads(TEMPLATE_SCHEMA.read_text())
    pick = s["properties"]["inputs"]["properties"]["deck_type"]["properties"]["id"]["enum"]
    built = s["properties"]["deck"]["properties"]["meta"]["properties"]["built_from"]["properties"]["type"]["enum"]
    assert set(pick) == set(built) == set(profiles.ids())


# ---------------------------------------------------------------- slice 8: the read format ('Sent to be read'), A4 by default

def test_the_read_format_is_detailed_with_pictures_on_the_cover():
    for pid in profiles.ids():
        full = profiles.recipe(profiles.load(pid), "full")
        assert full["density"]["level"] == "detailed", pid
        assert full["pictures"]["generate"] in ("cover", "none") and full["pictures"]["types"] == ["title"], pid
        assert full["size"] == "a4", pid   # deck-slide-size: a leave-behind prints on A4 landscape (the person can override)
    assert profiles.recipe(profiles.load("tender_response"), "pitch")["size"] == "a4"   # evaluators read and print a tender
    assert all(profiles.recipe(profiles.load(p_), "pitch")["size"] == "16:9" for p_ in profiles.ids() if p_ != "tender_response")


def _moved_deck(fmt: str) -> dict:
    d, _, _ = layouts.plan(copy.deepcopy(GOLD), prefs={"density": "lean"})
    d["meta"]["format"] = fmt
    return d


def test_notes_unread_warns_only_in_the_read_format(monkeypatch):
    _on(monkeypatch)
    inp = inputs.load(LUMEN / "brief_object.json")
    full = _moved_deck("full")
    moved = [s for s in full["order"] if ((full["slides"][s].get("layout") or {}).get("fit") or {}).get("moved")]
    assert moved, "the lean plan moves at least one point on the Lumen deck"
    got = [f for f in validate.run(full, inp, profile=profiles.load("agency_pitch")) if f["check"] == "notes_unread"]
    assert {f["slide"] for f in got} == set(moved) and all(f["level"] == "warn" for f in got)
    assert not [f for f in validate.run(_moved_deck("pitch"), inp, profile=profiles.load("agency_pitch")) if f["check"] == "notes_unread"]
    _on(monkeypatch, recipes=False)
    assert not [f for f in validate.run(_moved_deck("full"), inp, profile=profiles.load("agency_pitch")) if f["check"] == "notes_unread"]
    assert "notes_unread" in spec.CHECKS


# ---------------------------------------------------------------- slice 9: goldens with the recipes on

#: (golden name, fixture folder, type): the gallery's three decks, built and planned with LOOK_V3 and RECIPES on.
RECIPE_GOLDENS = (("lumen_agency_pitch", LUMEN, "agency_pitch"), ("investor_seed", TYPES / "investor_seed", "investor_seed"),
                  ("lumen_creative_work", LUMEN, "creative_work"))


def recipe_golden(folder: Path, pid: str) -> dict:
    """What the recipes-on golden holds for one deck: the presented and appendix types in order, and the plan record (layouts, chosen_by,
    rung, moved) at the type's own density with its preferences and roles. Call with spec.LOOK_V3 and spec.RECIPES on."""
    deck, _, p = _build(folder, pid)
    rec = profiles.recipe(p)
    planned, _, _ = layouts.plan(deck, prefs={"density": rec["density"]["level"], **run_deck._recipe_prefs(p, "pitch")})
    return {"type": pid, "order": [planned["slides"][s]["type"] for s in planned["order"]], "presented": len(validate.presented(planned)),
            "plan": layouts.plan_record(planned)}


@pytest.mark.parametrize("name,folder,pid", RECIPE_GOLDENS)
def test_recipes_on_golden(monkeypatch, name, folder, pid):
    _on(monkeypatch)
    layouts._CACHE.clear()
    got = recipe_golden(folder, pid)
    path = RECIPES_GOLD / f"{name}.json"
    if os.environ.get("DECK_WRITE_GOLDEN"):
        path.parent.mkdir(exist_ok=True)
        path.write_text(json.dumps(got, indent=1, ensure_ascii=False) + "\n")
    assert got == json.loads(path.read_text())


# ---------------------------------------------------------------- review fixes: the pick end to end through the engine server (server.py)

FERN = FIX / "fernley"
SRV_INPUTS = {"prompt": {"text": (FERN / "prompt.txt").read_text().strip(), "client": "Fernley Drinks Ltd (FICTIONAL)", "project": "Fernley Tea 2027",
                         "agency": ""}, "kind": "agency", "format": "pitch"}


def _server(tmp_path, monkeypatch):
    """An engine server replaying the Fernley recording; each segment is recorded, not run (no thread, no engine)."""
    cfg = server.Settings({"NAPKIN_DECK_DATA": str(tmp_path / "runs"), "NAPKIN_DECK_REPLAY": str(FERN / "stages"), "NAPKIN_DECK_PORT": "0"})
    s = server.Server(cfg)
    ran = []

    def segment(self, d, req, until):
        self.seed(d, req, until)   # what a replay segment writes into the shared stages folder
        ran.append({"type": req["type"], "until": until, "confirm": req.get("confirm"), "folder": d.folder})
    monkeypatch.setattr(server.Server, "segment", segment)
    import threading as _th
    monkeypatch.setattr(server, "threading", SimpleNamespace(Thread=lambda target, args, **kw: SimpleNamespace(start=lambda: target(*args), is_alive=lambda: False),
                                                             RLock=_th.RLock, BoundedSemaphore=_th.BoundedSemaphore))
    return s, ran


#: Every gate approved: a segment then runs on as far as the recorded stages allow (a type change is checked first either way).
ALL_GATES = {g: {"by": "human:sai", "at": "t", "decision": "approve"} for g in ("storyline", "territories", "idea")}


def _req(deck_type=None, approvals=None, **inp):
    i = {**SRV_INPUTS, **inp}
    if deck_type is not None:
        i["deck_type"] = deck_type
    return {"doc": "doc1", "inputs": i, "approvals": approvals or {}, "mode": "replay", "render": False}


def test_a_type_change_is_free_from_the_shared_stages_and_needs_a_yes_for_new_writing(tmp_path, monkeypatch):
    s, ran = _server(tmp_path, monkeypatch)
    s.run(_req({"id": "credentials", "by": "person", "at": "t"}))   # first run: credentials (a0, a, b) up to its one gate
    assert ran[-1]["type"] == "credentials" and ran[-1]["until"] == "b"   # credentials has no territories or idea gate
    s.run(_req({"id": "credentials", "by": "person", "at": "t"}))   # the same type again: held at its gate, nothing to check
    assert server.inputs_key(_req({"id": "credentials"})["inputs"]) == server.inputs_key(_req()["inputs"]) == server.inputs_key(_req({"id": "agency_pitch"})["inputs"])
    with pytest.raises(server.Refused) as e:   # credentials -> agency pitch needs the routes and the idea: refused before anything runs
        s.run(_req({"id": "agency_pitch", "by": "person", "at": "t2"}))
    assert e.value.status == 409 and e.value.kind == "needs_stages" and e.value.extra == {"stages": ["c", "d"], "to": "agency_pitch"}
    assert "the routes, the idea and executions" in e.value.message and "pictures are kept" in e.value.message
    n = len(ran)
    s.run(_req({"id": "agency_pitch", "by": "person", "at": "t2", "confirmed_stages": ["c", "d"]}, ALL_GATES))   # the person's yes on the Change sheet
    assert len(ran) == n + 1 and ran[-1]["confirm"] is True and ran[-1]["folder"] == ran[0]["folder"]   # the same stages folder
    for fn in ("c_territories.json", "d_idea.json"):   # the replay wrote the new stages into it
        (ran[0]["folder"] / "stages" / fn).write_bytes((FERN / "stages" / fn).read_bytes())
    s.run(_req({"id": "credentials", "by": "person", "at": "t3"}, ALL_GATES))   # back to credentials: everything it runs is recorded, so it is free
    assert ran[-1]["confirm"] is False and ran[-1]["type"] == "credentials"
    s.run(_req({"id": "tender_response", "by": "person", "at": "t4"}, ALL_GATES))   # tender runs a b c d, all recorded: free, no yes needed
    assert ran[-1]["type"] == "tender_response" and ran[-1]["confirm"] is False


def test_the_confirmation_reaches_run_deck_and_the_pick_replaces_the_kind(tmp_path, monkeypatch):
    s, _ = _server(tmp_path, monkeypatch)
    seen = []
    monkeypatch.setattr(server.run_deck, "main", lambda argv: seen.append(list(argv)) or {})
    d = server.Doc(tmp_path / "doc", "doc")
    d.folder = tmp_path / "doc" / "k"
    req = server.validate_request(_req({"id": "tender_response", "by": "person", "at": "t"}), s.s)
    req["confirm"] = True
    s.call_engine(d, req, None)
    argv = seen[-1]
    assert argv[argv.index("--type") + 1] == "tender_response" and "--kind" not in argv and "--confirm-stages" in argv
    plain = server.validate_request(_req(), s.s)
    s.call_engine(d, plain, None)
    assert seen[-1][seen[-1].index("--kind") + 1] == "agency" and "--type" not in seen[-1] and "--confirm-stages" not in seen[-1] and "--same-type" in seen[-1]


def test_a_tender_pick_builds_with_the_tender_profile_end_to_end(tmp_path, monkeypatch):
    """App -> middleware -> engine: the body the middleware sends for a document whose inputs.deck_type is a tender (server/tests/test_deck.py
    checks that the middleware forwards it) reaches run_deck as --type, and the deck is built and stamped as a tender response."""
    s, _ = _server(tmp_path, monkeypatch)
    seen = []
    monkeypatch.setattr(server.run_deck, "main", lambda argv: seen.append(list(argv)) or {})
    body = _req({"id": "tender_response"})   # the middleware's forward: {id} (and confirmed_stages when there are any)
    req = server.validate_request(body, s.s)
    assert req["kind"] == "agency" and req["type"] == "tender_response" and req["type_stages"] == profiles.load("tender_response")["stages"]
    d = server.Doc(tmp_path / "doc", "doc")
    d.folder = tmp_path / "doc" / "k"
    s.call_engine(d, req, None)
    argv = seen[-1]
    monkeypatch.undo()   # the real run_deck from here
    stages_dir = tmp_path / "stages"
    import shutil
    shutil.copytree(FERN / "stages", stages_dir)
    argv[argv.index("--stages") + 1] = str(stages_dir)
    argv[argv.index("--out") + 1] = str(tmp_path / "out")
    argv = [a for a in argv if a != "--live"] + (["--until", "deck"] if "--until" not in argv else [])
    rep = run_deck.main(argv)
    deck = json.loads((tmp_path / "out" / "deck.json").read_text())
    assert rep["type"]["id"] == "tender_response" and rep["type"]["source"] == "pick"
    assert deck["meta"]["built_from"]["type"] == "tender_response" and deck["meta"]["profile"]["source"] == "pick"
    assert deck["meta"]["profile"]["id"] == "tender_response" and rep["type_question"]   # built and judged as a tender (its strict checks, its spine)


def test_a_type_that_needs_the_recipes_is_hidden_and_refused_while_they_are_off(tmp_path, monkeypatch):
    s, _ = _server(tmp_path, monkeypatch)
    _on(monkeypatch, recipes=False)
    assert "creative_work" not in s.status()["types"]["offered"] and s.status()["types"]["recipes"] is False
    with pytest.raises(server.Refused) as e:
        server.validate_request(_req({"id": "creative_work"}), s.s)
    assert e.value.status == 400 and e.value.kind == "type_off"
    with pytest.raises(SystemExit, match="needs the deck recipes"):
        run_deck.main(["--prompt-text", "x", "--stages", str(tmp_path / "st"), "--client", "c", "--project", "p", "--out", str(tmp_path / "o"),
                       "--type", "creative_work", "--until", "deck"])
    _on(monkeypatch)
    assert "creative_work" in s.status()["types"]["offered"] and s.status()["types"]["recipes"] is True
    assert server.validate_request(_req({"id": "creative_work"}), s.s)["type"] == "creative_work"


def test_the_engines_view_tells_the_app_which_types_it_offers(tmp_path, monkeypatch):
    s, _ = _server(tmp_path, monkeypatch)
    s.run(_req())
    v = s.get("doc1")
    assert v["run"]["types"] == server.type_offers()


def test_without_a_pick_the_server_plans_as_before(tmp_path):
    assert server.plan_for("agency") == server.PLAN["agency"] and server.plan_for("investor") == server.PLAN["investor"]
    assert server.plan_for("agency", profiles.load("credentials")["stages"]) == [("b", "storyline")]
    assert server.plan_for("agency", profiles.load("agency_pitch")["stages"]) == server.PLAN["agency"]
