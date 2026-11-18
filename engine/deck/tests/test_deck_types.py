"""deck-types slices 1-3 (features/deck-types.clan): the recipe schema and resolver, the length from the recipe, and the layout
preferences. Offline: no model, no money, invented fixtures only. Run from ``engine/``: ``PYTHONPATH=. python3 -m pytest -q deck/tests``.
"""
from __future__ import annotations

import copy
import json
import re
from pathlib import Path

import pytest

from deck import assemble, inputs, layouts, profiles, run_deck, spec, validate

HERE = Path(__file__).parent
FIX = HERE / "fixtures"
TYPES = FIX / "types"
GOLD = json.loads((FIX / "lumen_water" / "golden_deck.json").read_text())
FILES = {"a0": "a0_intake.json", "a": "a_requirements.json", "b": "b_storyline.json", "c": "c_territories.json",
         "d": "d_idea.json", "i": "i_investor.json"}
#: The design's numbers (Q3; design.recipe_table): target / cap per type, None for none.
LENGTHS = {"agency_pitch": (10, 12), "credentials": (10, 14), "investor_seed": (12, 15), "tender_response": (None, None)}
#: Preferences the catalogue cannot draw yet (a layout not built, or one that does not take that slide type): the general rules stand in.
#: When deck-look builds one, or a layout learns a slide type, this table changes on purpose.
NOT_BUILT = {"agency_pitch": {"territory": ["picture_column"]},
             "credentials": {"credentials": ["picture_column"], "questions": ["statement_points"]},
             "investor_seed": {"why_now": ["reframe"], "financials": ["chart_full"], "ask": ["close"]},
             "tender_response": {"criterion_answer": ["rows_aside"]}}


def _bare(pid: str) -> dict:
    """A profile with no recipe block and no length target or cap: what every type was before deck-types."""
    p = profiles.load(pid)
    p.pop("recipe", None)
    p["length"].pop("target", None)
    p["length"].pop("cap", None)
    return p


def _on(monkeypatch, recipes=True, look=True):
    monkeypatch.setattr(spec, "LOOK_V3", look)
    monkeypatch.setattr(spec, "RECIPES", recipes)


# ---------------------------------------------------------------- slice 1: schema, validation, resolver

def test_every_type_loads_with_its_recipe_under_both_flag_states(monkeypatch):
    for look in (False, True):
        for rec in (False, True):
            _on(monkeypatch, rec, look)
            profiles._CACHE.clear()
            for p in profiles.all_profiles():
                assert profiles.validate_profile(p) == [], p["id"]
                assert "recipe" in p and p["recipe"]["layouts"], p["id"]


def test_a_type_with_no_recipe_resolves_to_todays_constants_exactly():
    for pid in profiles.ids():
        for fmt in spec.FORMATS:
            r = profiles.recipe(_bare(pid), fmt)
            assert r["length"] == {"target": spec.PITCH_TARGET, "cap": spec.PITCH_CAP}
            assert r["layouts"] == {} and r["not_built"] == {}
            assert r["density"] == {"level": spec.DENSITY_DEFAULTS[fmt], "roles": spec.ROLE_OF_TYPE,
                                    "windows": {k: list(v) for k, v in spec.ROLE_WINDOWS.items()}}
            assert r["pictures"] == {"on": spec.PICTURES_ON[0], "generate": "all", "types": list(spec.PICTURE_SLIDE_TYPES)}
            assert r["brand"] == {"strict": False} and r["titles"] == {"form": "claim"} and r["size"] == "16:9"
    assert profiles.recipe(None) == profiles.recipe_defaults()


def test_recipe_returns_a_fresh_dict_every_time():
    a = profiles.recipe(profiles.load("investor_seed"))
    a["layouts"]["traction"].append("cards")
    a["length"]["target"] = 99
    b = profiles.recipe(profiles.load("investor_seed"))
    assert "cards" not in b["layouts"]["traction"] and b["length"]["target"] == 12
    assert profiles.recipe(None)["density"]["roles"] is not spec.ROLE_OF_TYPE   # a copy: a reader cannot change the constant


@pytest.mark.parametrize("pid", list(LENGTHS))
def test_each_type_resolves_its_own_target_and_cap(pid):
    r = profiles.recipe(profiles.load(pid))
    assert (r["length"]["target"], r["length"]["cap"]) == LENGTHS[pid]
    assert r["type"] == pid


def test_an_env_target_or_cap_for_the_run_beats_the_recipe(monkeypatch):
    monkeypatch.setattr(spec, "PITCH_LENGTH_FROM_ENV", {"target": True, "cap": False})
    monkeypatch.setattr(spec, "PITCH_TARGET", 7)
    r = profiles.recipe(profiles.load("investor_seed"))
    assert r["length"] == {"target": 7, "cap": 15}


@pytest.mark.parametrize("pid", list(NOT_BUILT))
def test_preferences_split_into_drawable_and_not_built(pid):
    p = profiles.load(pid)
    r = profiles.recipe(p)
    assert r["not_built"] == NOT_BUILT[pid]
    cat = layouts.catalogue()
    for t, ids in r["layouts"].items():
        assert ids, t
        for x in ids:
            assert t in cat[x], (pid, t, x)   # every usable preference exists and takes the slide type
        assert [x for x in p["recipe"]["layouts"][t] if x in ids] == ids   # the profile's order is kept
    for t, ids in r["not_built"].items():
        for x in ids:
            assert x not in cat or t not in cat[x], (pid, t, x)


def test_the_design_table_maps_are_in_the_recipes():
    want = {"agency_pitch": {"idea": "full_bleed_statement", "real_question": "reframe", "proposition": "shift_line", "audience": "picture_column"},
            "investor_seed": {"traction": "kpi_row", "market": "big_number", "competition": "comparison_grid", "ask": "close"},
            "credentials": {"team": "people_cards", "credentials": "picture_column"},
            "tender_response": {"scoring": "native_table"}}
    for pid, m in want.items():
        lay = profiles.load(pid)["recipe"]["layouts"]
        for t, lid in m.items():
            assert lay[t][0] == lid, (pid, t)


def test_catalogue_lays_v3_over_the_base_whatever_the_flag(monkeypatch):
    for look in (False, True):
        monkeypatch.setattr(spec, "LOOK_V3", look)
        cat = layouts.catalogue()
        assert set(spec.LAYOUT_IDS_V3) <= set(cat) and set(spec.LAYOUT_IDS) <= set(cat)
        assert "investment" in cat["close"]   # the v3 close replaces the base one


def _bad(mut) -> list:
    p = profiles.load("agency_pitch")
    mut(p)
    return profiles.validate_profile(p)


@pytest.mark.parametrize("mut,needle", [
    (lambda p: p["recipe"]["layouts"].__setitem__("no_such_type", ["cards"]), "unknown slide type"),
    (lambda p: p["recipe"]["layouts"].__setitem__("founders", ["people_cards"]), "not in the spine"),
    (lambda p: p["recipe"]["layouts"].__setitem__("idea", ["no_such_layout"]), "unknown layout"),
    (lambda p: p["recipe"]["layouts"].__setitem__("idea", ["big_statement", "cards", "comparison", "native_table"]), "at most 3"),
    (lambda p: p["recipe"]["layouts"].__setitem__("idea", ["cards", "cards"]), "listed twice"),
    (lambda p: p["recipe"]["layouts"].__setitem__("idea", "cards"), "list of layout ids"),
    (lambda p: p["recipe"].__setitem__("density", {"windows": {"statement": [40, 20]}}), "lo < hi"),
    (lambda p: p["recipe"].__setitem__("density", {"windows": {"statement": [10, 900]}}), "lo < hi"),
    (lambda p: p["recipe"].__setitem__("density", {"level": "airy"}), "density.level"),
    (lambda p: p["recipe"].__setitem__("density", {"roles": {"idea": "shout"}}), "density.roles"),
    (lambda p: p["recipe"].__setitem__("pictures", {"types": ["competition"]}), "evidence slide"),
    (lambda p: p["recipe"].__setitem__("pictures", {"types": []}), "at least one slide type"),
    (lambda p: p["recipe"].__setitem__("density", {"roles": {"founders": "statement"}}), "density.roles: founders is not in the spine"),
    (lambda p: p["recipe"].__setitem__("pictures", {"on": "custom"}), "pictures.on"),
    (lambda p: p["recipe"].__setitem__("pictures", {"generate": "lots"}), "pictures.generate"),
    (lambda p: p["recipe"].__setitem__("size", "a3"), "recipe.size"),
    (lambda p: p["recipe"].__setitem__("format", "deck"), "recipe.format"),
    (lambda p: p["recipe"].__setitem__("titles", {"form": "shouty"}), "recipe.titles"),
    (lambda p: p["recipe"].__setitem__("brand", {"strict": "yes"}), "recipe.brand"),
    (lambda p: p["recipe"].__setitem__("colour", "red"), "unknown key"),
    (lambda p: p["recipe"].__setitem__("full", {"full": {}}), "recipe.full: unknown key"),
    (lambda p: p["recipe"].__setitem__("full", {"size": "a3"}), "recipe.full.size"),
    (lambda p: p.__setitem__("recipe", ["layouts"]), "recipe must be"),
    (lambda p: p["length"].update(target=13, cap=12), "length.target (13) must not be over length.cap (12)"),
    (lambda p: p["length"].update(cap=19), "length.cap (19) must not be over length.max_slides (18)"),
    (lambda p: p["length"].update(target=0), "length.target must be a whole number"),
    (lambda p: p["length"].update(cap=True), "length.cap must be a whole number"),
])
def test_the_recipe_check_refuses(mut, needle):
    errs = _bad(mut)
    assert any(needle in e for e in errs), errs


def test_a_layout_named_but_not_built_is_accepted_and_never_used():
    p = profiles.load("agency_pitch")
    p["recipe"]["layouts"]["idea"] = ["grid_points", "big_statement"]
    assert profiles.validate_profile(p) == []
    r = profiles.recipe(p)
    assert r["layouts"]["idea"] == ["big_statement"] and r["not_built"]["idea"] == ["grid_points"]


def test_full_overrides_apply_only_to_format_full():
    p = profiles.load("agency_pitch")
    p["recipe"]["size"] = "16:9"
    p["recipe"]["full"] = {"size": "a4", "density": {"level": "detailed"}, "layouts": {"idea": ["big_statement"]}}
    assert profiles.validate_profile(p) == []
    pitch, full = profiles.recipe(p, "pitch"), profiles.recipe(p, "full")
    assert pitch["size"] == "16:9" and pitch["layouts"]["idea"] == ["full_bleed_statement", "big_statement"]
    assert full["size"] == "a4" and full["density"]["level"] == "detailed" and full["layouts"]["idea"] == ["big_statement"]


def test_recipes_are_read_only_with_both_flags(monkeypatch):
    for rec, look, want in ((False, False, False), (True, False, False), (False, True, False), (True, True, True)):
        _on(monkeypatch, rec, look)
        assert profiles.recipes_on() is want
        prefs = run_deck._recipe_prefs(profiles.load("investor_seed"), "pitch")
        assert (prefs != {}) is want
    _on(monkeypatch)
    assert run_deck._recipe_prefs(profiles.load("investor_seed"), "pitch") == {
        "prefer": profiles.recipe(profiles.load("investor_seed"))["layouts"], "prefer_type": "investor_seed"}


def test_no_reader_branches_on_a_profile_id():
    """design.done_when: no renderer, assembler or planner names a type; they read the resolved recipe."""
    ids = [i for i in profiles.ids()]
    pat = re.compile(r"[\"'](" + "|".join(i for i in ids if i != "credentials") + r")[\"']")
    for f in (HERE.parent).glob("*.py"):
        if f.name in ("profiles.py", "spec.py", "intake.py"):
            continue
        assert not pat.search(f.read_text()), f.name


# ---------------------------------------------------------------- slice 2: length from the recipe

def _stages(pid: str) -> dict:
    return {k: json.loads((TYPES / pid / f).read_text()) for k, f in FILES.items() if (TYPES / pid / f).exists()}


def _build(pid: str) -> tuple:
    inp = inputs.load(None, prompt_text=(TYPES / pid / "prompt.txt").read_text().strip())
    p = profiles.load(pid)
    builder = assemble.build_investor if p["kind"] == "investor" else assemble.build
    return builder(inp, _stages(pid), client="Fixture Client", project="Fixture Project", profile=p), inp


def _targets(monkeypatch, pid: str) -> list:
    seen = []
    real = assemble._to_target

    def spy(S, story, backup, target, keep):
        seen.append(target)
        return real(S, story, backup, target, keep)
    monkeypatch.setattr(assemble, "_to_target", spy)
    monkeypatch.setattr(assemble, "_sketch", lambda inp: False)   # the type fixtures are prompts alone (sketches hold their own limit)
    _build(pid)
    return seen


@pytest.mark.parametrize("pid,want", [("agency_pitch", 10), ("investor_seed", 12)])
def test_the_pitch_target_comes_from_the_recipe_when_on(monkeypatch, pid, want):
    _on(monkeypatch)
    assert _targets(monkeypatch, pid) == [want]


def test_with_recipes_off_the_target_is_spec_pitch_target(monkeypatch):
    _on(monkeypatch, recipes=False)
    monkeypatch.setattr(spec, "PITCH_TARGET", 9)
    assert _targets(monkeypatch, "investor_seed") == [9]


def test_an_env_target_still_wins_over_the_recipe(monkeypatch):
    _on(monkeypatch)
    monkeypatch.setattr(spec, "PITCH_LENGTH_FROM_ENV", {"target": True, "cap": False})
    monkeypatch.setattr(spec, "PITCH_TARGET", 8)
    assert _targets(monkeypatch, "investor_seed") == [8]


def test_no_target_runs_no_cheap_moves(monkeypatch):
    monkeypatch.setattr(spec, "LOOK_V3", True)
    monkeypatch.setattr(assemble, "_to_target", lambda *a: pytest.fail("no target: no cheap moves"))
    S = [assemble._slide("objective", "x", [{"kind": "text", "text": "y"}], status="from_source")]
    assert assemble._arrange_pitch(list(S), target=None) == S


def _cap_findings(deck, inp) -> list:
    return [f for f in validate.run(deck, inp) if f["check"] == "pitch_cap"]


def test_the_cap_is_the_types_own_and_advisory_on_spine_types_too(monkeypatch):
    monkeypatch.setattr(assemble, "_sketch", lambda inp: False)   # the fixture is a prompt alone: a sketch's own limit would silence the cap
    deck, inp = _build("credentials")
    _on(monkeypatch, recipes=False)
    assert _cap_findings(deck, inp) == []   # today: a spine type records its length, so no cap is read
    _on(monkeypatch)
    real = profiles.recipe
    monkeypatch.setattr(profiles, "recipe", lambda p, fmt="pitch": {**real(p, fmt), "length": {"target": 2, "cap": 3}})
    got = _cap_findings(deck, inp)
    assert len(got) == 1 and got[0]["level"] == "warn" and "at most 3" in got[0]["message"] and "aims at 2" in got[0]["message"]


def test_a_stated_limit_or_no_cap_silences_the_advisory_cap(monkeypatch):
    monkeypatch.setattr(assemble, "_sketch", lambda inp: False)   # the fixture is a prompt alone: a sketch's own limit would silence the cap
    deck, inp = _build("credentials")
    _on(monkeypatch)
    real = profiles.recipe
    monkeypatch.setattr(profiles, "recipe", lambda p, fmt="pitch": {**real(p, fmt), "length": {"target": None, "cap": None}})
    assert _cap_findings(deck, inp) == []
    monkeypatch.setattr(profiles, "recipe", lambda p, fmt="pitch": {**real(p, fmt), "length": {"target": 2, "cap": 3}})
    stated = copy.deepcopy(deck)
    stated["meta"]["length"] = {**stated["meta"]["length"], "max_slides": 30, "source": "the brief's stated limit"}
    assert _cap_findings(stated, inp) == []


# ---------------------------------------------------------------- slice 3: layout preferences

def _deck() -> dict:
    return copy.deepcopy(GOLD)


def test_pick_tries_the_preference_first_and_only_when_it_accepts():
    s = _deck()["slides"]["s08"]   # idea: a statement and a text
    rule = layouts.pick(s)
    assert layouts.pick(s, prefer={"idea": ["cards"]}) == "cards" != rule   # a rule layout that takes the slide is preferred
    assert layouts.pick(s, prefer={"idea": ["big_statement"]}) == rule   # an offer layout is never preferred (pick: offer)
    assert layouts.pick(s, prefer={"idea": ["kpi_row"]}) == rule   # no stats block: kpi_row does not accept it
    assert layouts.pick(s, prefer={"idea": ["full_bleed_statement"]}) == rule   # no picture ready: its 'when' fails
    assert layouts.pick(s, prefer={"idea": ["cover_bleed", "no_such", "big_statement", "cards"]}) == "cards"   # missing and offered ids are skipped
    assert layouts.pick(s, prefer={"insight": ["cards"]}) == rule   # another type's preference
    assert layouts.pick(s, prefer=None) == layouts.pick(s, prefer={}) == rule


def test_plan_without_prefer_is_todays_plan_byte_for_byte():
    a = layouts.plan(_deck(), prefs={"density": "lean"})
    b = layouts.plan(_deck(), prefs={"density": "lean", "prefer": None})
    c = layouts.plan(_deck(), prefs={"density": "lean", "prefer": {}, "prefer_type": "agency_pitch"})
    assert json.dumps(a, sort_keys=True) == json.dumps(b, sort_keys=True) == json.dumps(c, sort_keys=True)


def test_plan_keeps_a_preference_that_fits_with_chosen_by_rule_and_a_recipe_why():
    p, _, _ = layouts.plan(_deck(), prefs={"prefer": {"idea": ["cards"]}, "prefer_type": "agency_pitch"})
    lay = p["slides"]["s08"]["layout"]
    assert lay["id"] == "cards" and lay["chosen_by"] == "rule"
    assert lay["why"] == "recipe agency_pitch: prefers cards for idea"
    assert lay["fit"]["rung"] in ("as_is", "shrunk") and not lay["fit"]["relaxed"]


def test_a_preference_that_would_not_fit_gives_the_slide_back_to_the_rules():
    d = _deck()
    long = " ".join(["Every household sees its own water story and the tap becomes personal"] * 14)
    d["slides"]["s08"]["blocks"] = [{"kind": "statement", "text": long}]
    without, _, _ = layouts.plan(copy.deepcopy(d), prefs={"density": "detailed"})
    got, _, _ = layouts.plan(copy.deepcopy(d), prefs={"density": "detailed", "prefer": {"idea": ["cards"]}, "prefer_type": "t"})
    lay = got["slides"]["s08"]["layout"]
    if lay["id"] == "cards":   # it fitted after all: then only as is or shrunk
        assert lay["fit"]["rung"] in ("as_is", "shrunk") and not lay["fit"]["relaxed"]
    else:
        assert lay == without["slides"]["s08"]["layout"]


def test_a_persons_swap_beats_a_preference():
    p, _, _ = layouts.plan(_deck(), prefs={"prefer": {"idea": ["cards"]}}, swaps={"s08": "emphasis_bar"})
    assert p["slides"]["s08"]["layout"]["chosen_by"] == "person"


def test_a_preference_that_moves_more_points_to_the_notes_gives_way():
    """A preferred layout is kept only if it keeps at least as many points on the slide as the rule's choice: at lean density, a slide
    with many points preferred onto a content layout (density moves points) while the rule picks one that keeps them."""
    d = _deck()
    for sid in d["order"]:
        ref, _, _ = layouts.plan(copy.deepcopy(d), prefs={"density": "lean"})
        w = ref["slides"][sid]["layout"]
        typ = d["slides"][sid]["type"]
        for lid in [x for x, lay in layouts.load().items() if lay["pick"] == "rule" and x != w["id"]]:
            got, _, _ = layouts.plan(copy.deepcopy(d), prefs={"density": "lean", "prefer": {typ: [lid]}, "prefer_type": "t"})
            g = got["slides"][sid]["layout"]
            if g["why"].startswith("recipe "):
                assert len(g["fit"]["moved"]) <= len(w["fit"]["moved"]), (sid, lid)
        break


def test_a_preference_that_opens_a_hole_gives_way_under_the_look(monkeypatch):
    monkeypatch.setattr(spec, "LOOK_V3", True)
    from deck import render_pptx
    monkeypatch.setattr(render_pptx.Renderer, "hole_estimate", lambda self, s, name, title_pt=None, cpl=48: 0.99)
    rule, _, _ = layouts.plan(_deck(), prefs={"density": "lean"})
    got, _, _ = layouts.plan(_deck(), prefs={"density": "lean", "prefer": {"idea": ["cards"]}, "prefer_type": "t"})
    assert not got["slides"]["s08"]["layout"]["why"].startswith("recipe ")   # every hole is over the gate: the rule's pick stands
    assert got["slides"]["s08"]["layout"]["id"] == rule["slides"]["s08"]["layout"]["id"]


def test_catalogue_is_read_again_after_a_forced_load():
    first = layouts.catalogue()
    layouts._CACHE["catalogue"] = {"stale": []}
    assert "stale" in layouts.catalogue()
    layouts.load(force=True)
    assert layouts.catalogue() == first


@pytest.mark.parametrize("look", [False, True])
def test_preferences_never_move_more_points_to_the_notes_nor_edit_a_word(monkeypatch, look):
    """Every type's preferences over the Lumen deck at lean density: no slide moves more to the notes than the rule pick would, a
    preferred slide is at as_is or shrunk, the blocks are untouched, and planning again gives the same bytes (pure)."""
    monkeypatch.setattr(spec, "LOOK_V3", look)
    base = _deck()
    ref, _, _ = layouts.plan(copy.deepcopy(base), prefs={"density": "lean"})
    for pid in profiles.ids():
        r = profiles.recipe(profiles.load(pid))
        prefs = {"density": "lean", "prefer": r["layouts"], "prefer_type": pid}
        got, _, _ = layouts.plan(copy.deepcopy(base), prefs=prefs)
        again, _, _ = layouts.plan(copy.deepcopy(base), prefs=prefs)
        assert json.dumps(got, sort_keys=True) == json.dumps(again, sort_keys=True)
        for sid in base["order"]:
            g, w = got["slides"][sid], ref["slides"][sid]
            assert g["blocks"] == base["slides"][sid]["blocks"]
            assert len(g["layout"]["fit"]["moved"]) <= len(w["layout"]["fit"]["moved"]) or g["layout"]["id"] == w["layout"]["id"], (pid, sid)
            if g["layout"]["why"].startswith("recipe "):
                assert g["layout"]["fit"]["rung"] in ("as_is", "shrunk") and not g["layout"]["fit"]["relaxed"], (pid, sid)
                assert g["layout"]["id"] in r["layouts"][g["type"]]


def test_repair_replans_with_the_same_preferences(monkeypatch):
    from deck import repair
    seen = {}
    monkeypatch.setattr(layouts, "plan", lambda d, lib, prefs, swaps, hooks, fixes: seen.update(prefs) or (d, [], []))
    ctx = {"prefs": {"density": "lean", "text_mode": None, "prefer": {"idea": ["big_statement"]}, "prefer_type": "agency_pitch"},
           "library": None, "swaps": {}}
    repair._replan(ctx, _deck(), {})
    assert seen["prefer"] == {"idea": ["big_statement"]} and seen["prefer_type"] == "agency_pitch"
    seen.clear()
    repair._replan({**ctx, "prefs": {"density": "lean", "text_mode": None}}, _deck(), {})
    assert "prefer" not in seen and "prefer_type" not in seen
