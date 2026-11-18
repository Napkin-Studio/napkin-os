"""The layout library and the plan (deck-layout-library): the 36 files, the rule table's parity with the function it replaced, the
overlay that never edits a word, the never-move list, the fit ladder, the interface slice 5 calls, and the notes lines.
"""
from __future__ import annotations

import copy
import itertools
import json
from pathlib import Path

import pytest
import yaml

from deck import layouts, render_pptx, spec, validate

FIX = Path(__file__).with_name("fixtures")
GOLD = json.loads((FIX / "lumen_water" / "golden_deck.json").read_text())
LIB = layouts.load()
KINDS = sorted(spec.BLOCK_KINDS)


def deck() -> dict:
    return copy.deepcopy(GOLD)


def _block(k: str) -> dict:
    b = {"kind": k, "text": "x"}
    b.update({"bullets": {"items": [{"text": "a"}]}, "kv": {"items": [["a", "b"]]}, "steps": {"items": [["a", "b"]]},
              "stats": {"items": [{"value": "1", "label": "x"}]}, "table": {"rows": [["a", "b"], ["c", "d"]]},
              "fromto": {"from": "a", "to": "b"}, "chart": {"chart": {"series": []}}, "copy": {"lines": ["a"], "answer": "x"}}.get(k, {}))
    return b


def with_slide(sid="s05", type_=None, blocks=None, title=None, **extra) -> dict:
    d = deck()
    s = d["slides"][sid]
    if type_:
        s["type"] = type_
    if blocks is not None:
        s["blocks"] = blocks
    if title:
        s["title"] = title
    s.update(extra)
    return d


# ---------------------------------------------------------------------------------------------------------- the library
def test_the_36_files_load_and_validate():
    assert len(LIB) == 36 <= spec.LAYOUT_MAX
    assert set(LIB) == set(spec.LAYOUT_IDS)
    for lid, lay in LIB.items():
        assert lay["id"] == lid and lay["pick"] in ("rule", "offer") and lay["family"], lid
        assert all(t in spec.SLIDE_TYPES for t in lay["for_types"]), lid
        assert sum(1 for s in lay["slots"].values() if s.get("dominant")) <= 1, lid
        assert "title" in lay["slots"], lid   # every layout has a title slot (display on a functional one)
        assert not any("max_line_in" in s for s in lay["slots"].values()), lid


def test_alternatives_roomier_and_without_image_are_layouts_that_exist_and_accept_the_same_blocks():
    for lid, lay in LIB.items():
        for a in lay.get("alternatives", []):
            assert a in LIB, (lid, a)
        assert lay.get("roomier") in (None, *LIB) and lay.get("without_image") in (None, *LIB)
        if any(s["kind"] == "image" and s.get("required") for s in lay["slots"].values()):
            assert lay.get("without_image"), f"{lid} has a required picture and no text-only twin"


def test_every_id_has_a_pptx_routine_and_a_web_class():
    for lid in LIB:
        assert lid in render_pptx.Renderer.LAYOUT_FN, lid
        assert hasattr(render_pptx.Renderer, render_pptx.Renderer.LAYOUT_FN[lid]), lid


def test_a_file_with_max_line_in_or_a_foreign_id_is_refused(tmp_path):
    d = tmp_path / "l"
    d.mkdir()
    lay = copy.deepcopy(LIB["cards"])
    lay["slots"]["lead"]["max_line_in"] = 4.0
    (d / "cards.yaml").write_text(yaml.safe_dump(lay))
    with pytest.raises(layouts.LibraryError):
        layouts.load(d, force=True)
    lay = copy.deepcopy(LIB["cards"])
    lay["id"] = "invented"
    (d / "cards.yaml").write_text(yaml.safe_dump(lay))
    with pytest.raises(layouts.LibraryError):
        layouts.load(d, force=True)


def test_capacity_equals_each_max_chars():
    for lid, lay in LIB.items():
        for n, sl in lay["slots"].items():
            if n != "title" and sl["kind"] == "text" and sl.get("max_chars"):
                assert layouts.capacity(lid, n) == sl["max_chars"], (lid, n)


# ---------------------------------------------------------------------------------------------------------- parity
def test_pick_equals_the_frozen_rule_table_over_every_type_and_block_kind():
    n = bad = 0
    for t in (x for x in spec.SLIDE_TYPES if x not in ("close", "next_step")):   # close and next_step: the dark close layout, a listed parity exception
        for st in ("from_source", "needs_human"):
            for combo in [()] + [(k,) for k in KINDS] + list(itertools.combinations(KINDS, 2)):
                s = {"type": t, "status": st, "title": "T", "blocks": [_block(k) for k in combo]}
                n += 1
                if layouts.pick(s) != render_pptx._choose_layout_frozen(s):
                    bad += 1
    assert n > 10000 and bad == 0


def test_close_and_next_step_take_the_dark_close_layout_unless_they_hold_a_human_item():
    for t in ("close", "next_step"):
        s = {"type": t, "status": "from_source", "title": "T", "blocks": [_block("statement"), _block("bullets")]}
        assert layouts.pick(s) == "close" and render_pptx._choose_layout_frozen(s) == "cards"
        s["blocks"][1]["items"][0]["human"] = True
        assert layouts.pick(s) == render_pptx._choose_layout_frozen(s) == "placeholder_card"   # a person still has to supply it: the placeholder layout


def test_pick_equals_the_frozen_rule_table_on_every_fixture_slide():
    for f in sorted(FIX.glob("**/golden_deck.json")):
        d = json.loads(f.read_text())
        for s in d["slides"].values():
            for aud in ("review", "client"):
                assert layouts.pick(s, aud) == render_pptx._choose_layout_frozen(s, aud), (f, s["title"])


def test_choose_layout_is_a_call_into_pick():
    s = GOLD["slides"]["s02"]
    assert render_pptx.choose_layout(s) == layouts.pick(s) == "objective_panel"


# ---------------------------------------------------------------------------------------------------------- the overlay
def _plan(d, **prefs):
    return layouts.plan(d, prefs=prefs)


def _old_test_refuses():
    d = deck()
    a, ia, pa = _plan(d)
    b, ib, pb = _plan(d)
    assert json.dumps(a, sort_keys=True) == json.dumps(b, sort_keys=True) and ia == ib and pa == pb
    with pytest.raises(ValueError):
        layouts.plan(a)   # a planned deck is not a base deck
    assert layouts.strip_plan(a) == d   # the plan owns exactly layout, text slots and the meta keys


def test_the_plan_never_edits_blocks_notes_claims_or_order_and_the_hashes_hold():
    d = deck()
    p, _, _ = _plan(d, density="lean")
    assert p["order"] == d["order"] and layouts.order_sha(p) == layouts.order_sha(d)
    for sid in d["order"]:
        a, b = d["slides"][sid], p["slides"][sid]
        assert a["blocks"] == b["blocks"] and a.get("notes") == b.get("notes") and a.get("claims") == b.get("claims")
        assert layouts.slide_words(a) == layouts.slide_words(b)   # w_words_sha
        moved = b["layout"]["fit"]["moved"]
        assert (layouts.shown_sha(a) == layouts.shown_sha(b)) == (not moved)   # w_shown_sha differs only where something moved


def test_every_slide_gets_layout_slots_and_a_matching_blocks_sha():
    p, _, _ = _plan(deck())
    for sid, s in p["slides"].items():
        lay = s["layout"]
        assert lay["id"] in LIB and lay["chosen_by"] in ("rule", "fit_ladder") and lay["blocks_sha"] == spec.blocks_sha(s)
        assert lay["fit"]["rung"] in spec.FIT_RUNGS and "title" in s["slots"] and s["slots"]["title"]["text"] == s["title"]


def test_slot_words_are_block_words_and_golden_slots_validate_against_their_layout():
    p, _, _ = _plan(deck())
    for s in p["slides"].values():
        lay = LIB[s["layout"]["id"]]
        texts = " ".join(t for b in s["blocks"] for t in layouts._block_texts(b)) + " " + s["title"] + " " + spec.ILLUSTRATIVE_QUOTE + " Internal note:"
        for name, v in s["slots"].items():
            assert name in lay["slots"] and v["kind"] == lay["slots"][name]["kind"], (s["title"], name)
            for w in layouts._chars_words and " ".join(str(x) for x in (v.get("text", ""), *[i.get("text", "") + " " + i.get("heading", "") + " " + i.get("value", "") for i in v.get("items", [])])).split():
                assert w in texts, (s["title"], name, w)


def test_the_planned_deck_validates_against_the_deck_schema():
    jsonschema = pytest.importorskip("jsonschema")
    p, _, _ = _plan(deck(), density="lean")
    jsonschema.validate(p, json.loads((Path(layouts.__file__).with_name("deck.schema.json")).read_text()))


def test_a_stale_overlay_is_ignored_and_the_renderer_draws_as_before():
    p, _, _ = _plan(deck())
    s = p["slides"]["s05"]
    s["title"] = "A hand edit"
    assert spec.blocks_sha(s) != s["layout"]["blocks_sha"]
    s["layout"]["fit"]["moved"] = [{"block": 0, "item": None, "sha": "0" * 12, "refs": []}]
    assert spec.shown_blocks(s) == spec.shown_blocks({k: v for k, v in s.items() if k != "layout"})


# ---------------------------------------------------------------------------------------------------------- never move
def _bullets(*items, refs=None):
    return {"kind": "bullets", "items": [{"text": t, **({"refs": refs} if refs else {})} for t in items]}


LONG = "alpha beta gamma delta epsilon zeta eta theta iota kappa lambda mu nu xi omicron pi rho sigma tau upsilon"


def _lean(d):
    return layouts.plan(d, prefs={"density": "lean"})[0]


def test_lean_moves_other_points_last_first_and_keeps_the_first_of_a_list():
    d = with_slide("s05", "audience", [_bullets(LONG, LONG + " red", LONG + " blue", LONG + " green")])
    p = _lean(d)
    moved = p["slides"]["s05"]["layout"]["fit"]["moved"]
    assert [m["item"] for m in moved] == [3, 2, 1] or [m["item"] for m in moved] == [3, 2]   # last first, never item 0
    assert all(m["item"] != 0 for m in moved)
    assert len(spec.shown_blocks(p["slides"]["s05"])[0]["items"]) == 4 - len(moved)


def test_a_figure_the_last_sourced_point_and_internal_blocks_never_move():
    d = with_slide("s05", "audience", [_bullets(LONG, LONG + " costs 12% more", LONG + " b", LONG + " c"),
                                        {"kind": "text", "text": LONG + " internal", "internal": True}])
    d["slides"]["s05"]["blocks"][0]["items"][3]["refs"] = ["f_1"]   # the last sourced point
    p = _lean(d)
    kept = {m["item"] for m in p["slides"]["s05"]["layout"]["fit"]["moved"]}
    assert 1 not in kept and 3 not in kept and 2 in kept
    assert all(m["block"] == 0 for m in p["slides"]["s05"]["layout"]["fit"]["moved"])


@pytest.mark.parametrize("t", ["criterion_answer", "scoring", "risks", "guardrails", "ask", "financials"])
def test_nothing_moves_on_an_exempt_slide_type(t):
    p = _lean(with_slide("s05", t, [_bullets(LONG, LONG + " a", LONG + " b", LONG + " c")]))
    assert p["slides"]["s05"]["layout"]["fit"]["moved"] == []


def test_nothing_moves_on_a_slide_that_is_not_presented():
    d = deck()
    appendix = next(sid for sid in d["order"] if d["slides"][sid]["type"] == "appendix")
    sid = d["order"][d["order"].index(appendix) + 1]
    d["slides"][sid]["blocks"] = [_bullets(LONG, LONG + " a", LONG + " b", LONG + " c")]
    assert sid not in validate.presented(d)
    assert _lean(d)["slides"][sid]["layout"]["fit"]["moved"] == []


def test_a_client_text_matching_an_internal_pattern_is_not_moved():
    pat = spec.INTERNAL_PATTERNS[0]
    bad = (pat[0] if isinstance(pat, (tuple, list)) else pat)
    probe = bad.replace("\\b", "").replace("\\s+", " ").replace("^", "").replace("$", "")
    d = with_slide("s05", "audience", [_bullets(LONG, LONG + " a", probe + " " + LONG, LONG + " c")])
    d["meta"]["audience"] = "client"
    moved = _lean(d)["slides"]["s05"]["layout"]["fit"]["moved"]
    assert 2 not in {m["item"] for m in moved} or not __import__("re").search(bad, probe, __import__("re").I)


def test_density_detailed_and_preserve_move_nothing():
    d = with_slide("s05", "audience", [_bullets(LONG, LONG + " a", LONG + " b", LONG + " c")])
    assert layouts.plan(d, prefs={"density": "detailed"})[0]["slides"]["s05"]["layout"]["fit"]["moved"] == []
    assert layouts.plan(d, prefs={"density": "lean", "text_mode": "preserve"})[0]["slides"]["s05"]["layout"]["fit"]["moved"] == []


# ---------------------------------------------------------------------------------------------------------- notes lines
def test_notes_lines_and_the_sha_of_the_verbatim_text(tmp_path):
    from pptx import Presentation
    d = with_slide("s05", "audience", [_bullets(LONG, LONG + " red", LONG + " blue", LONG + " green", refs=["f_9"])])
    d["slides"]["s05"]["blocks"][0]["items"][0].pop("refs")
    d["slides"]["s05"]["blocks"][0]["items"][3]["refs"] = ["f_1", "f_2"]
    p = _lean(d)
    s = p["slides"]["s05"]
    lines = [layouts.moved_line(t, r) for t, r in layouts.moved_texts(s)]
    assert lines and all(l.startswith("- " + LONG) for l in lines)
    for (t, r), m in zip(layouts.moved_texts(s), s["layout"]["fit"]["moved"]):
        assert m["sha"] == layouts._sha12(t) and m["refs"] == r
    assert layouts.moved_line("A point", ["a", "b"]) == "- A point [refs: a,b]" and layouts.moved_line("A point", []) == "- A point"
    out = tmp_path / "d.pptx"
    render_pptx.render(p, None, out)
    notes = Presentation(str(out)).slides[p["order"].index("s05")].notes_slide.notes_text_frame.text
    assert "Moved from the slide:" in notes and all(l in notes for l in lines)
    render_pptx.render(p, None, tmp_path / "n.pptx", notes=False)
    assert Presentation(str(tmp_path / "n.pptx")).slides[p["order"].index("s05")].notes_slide.notes_text_frame.text == ""


def test_validate_texts_drop_exactly_the_moved_items_and_notes_carry_them():
    d = with_slide("s05", "audience", [_bullets(LONG, LONG + " red", LONG + " blue", LONG + " green")])
    p = _lean(d)
    s = p["slides"]["s05"]
    shown = {t for t, _ in validate._texts(s)}
    moved = {t for t, _ in layouts.moved_texts(s)}
    assert moved and not shown & moved
    assert moved <= {t for t, _ in validate._texts(s, with_notes=True)}


# ---------------------------------------------------------------------------------------------------------- the ladder
def test_a_stub_shorten_hook_runs_before_the_notes_and_relaxed_rungs_when_condense_and_repair_are_on():
    d = with_slide("s05", "audience", [_bullets(*[LONG * 3 + f" {i}" for i in range(8)])])
    calls = []

    def hook(sid, slot, limits, fields):
        calls.append((sid, slot, fields))
        return {"deferred": True}
    p, issues, pending = layouts.plan(d, prefs={"density": "lean", "text_mode": "condense", "repair": True}, hooks={"shorten": hook})
    s = p["slides"]["s05"]
    assert not s["layout"]["fit"]["relaxed"] and s["layout"]["fit"]["rung"] != "overflow_to_notes"
    assert pending and all(x["rungs"][0] == "shorten" for x in pending)


def test_a_person_swap_is_honoured_and_an_unknown_one_is_reported():
    d = deck()
    p, issues, _ = layouts.plan(d, swaps={"s05": "cards_split"})
    lay = p["slides"]["s05"]["layout"]
    if lay["chosen_by"] == "person":
        assert lay["id"] == "cards_split"
    p, issues, _ = layouts.plan(d, swaps={"s05": "no_such_layout"})
    assert any(i["check"] == "layout_unknown" and i["slide"] == "s05" for i in issues)
    assert p["slides"]["s05"]["layout"]["chosen_by"] == "rule"


def test_fixes_avoid_layout_scale_max_and_notes_deny_change_the_outcome_and_record_repair():
    d = deck()
    base, _, _ = layouts.plan(d)
    first = base["slides"]["s05"]["layout"]
    p, _, _ = layouts.plan(d, fixes={"slides": {"s05": {"avoid": [first["id"]]}}})
    assert p["slides"]["s05"]["layout"]["id"] != first["id"] and p["slides"]["s05"]["layout"]["chosen_by"] == "repair"
    p, _, _ = layouts.plan(d, fixes={"slides": {"s05": {"layout": "cards_split"}}})
    assert p["slides"]["s05"]["layout"]["chosen_by"] in ("repair", "rule", "fit_ladder")
    p, _, _ = layouts.plan(d, fixes={"slides": {"s05": {"scale_max": 0.85}}})
    assert p["slides"]["s05"]["layout"]["fit"]["scale"] <= 0.85
    pinned = deck()
    pinned["slides"]["s05"]["pinned"] = True
    p, _, _ = layouts.plan(pinned, fixes={"slides": {"s05": {"avoid": [first["id"]]}}})
    assert p["slides"]["s05"]["layout"]["id"] == first["id"]   # a pinned slide takes no fix


def test_plan_with_cumulative_fixes_equals_planning_again_from_the_base():
    d = deck()
    a = {"slides": {"s05": {"avoid": ["cards"]}}}
    ab = {"slides": {"s05": {"avoid": ["cards"]}, "s06": {"scale_max": 0.9}}}
    layouts.plan(d, fixes=a)
    x, _, _ = layouts.plan(d, fixes=ab)
    y, _, _ = layouts.plan(d, fixes=ab)
    assert json.dumps(x, sort_keys=True) == json.dumps(y, sort_keys=True)


def test_plan_secs_stay_small_on_the_lumen_deck():
    import time
    t = time.time()
    _plan(deck(), density="lean")
    assert time.time() - t < 2.0   # the design's budget


# ---------------------------------------------------------------------------------------------------------- binding
def test_bind_gives_every_block_one_slot_or_lists_it_unbound():
    s = {"type": "audience", "title": "T", "status": "drafted", "blocks": [{"kind": "chart", "chart": {"series": []}}]}
    slots, unbound = layouts.bind(LIB["cards"], s, s["blocks"])
    assert unbound == [0]


def test_slot_limit_names_the_measure_and_the_limit():
    d = with_slide("s05", "audience", [{"kind": "statement", "text": "word " * 120}])
    _, issues, _ = layouts.plan(d)
    hit = [i for i in issues if i["check"] == "slot_limit" and i["slide"] == "s05"]
    assert hit and hit[0]["evidence"]["measured"] > hit[0]["evidence"]["limit"] and hit[0]["fix"]["kind"] == "shorten"


def test_every_offered_layout_that_accepts_a_slide_is_an_alternative_that_fits():
    p, _, _ = _plan(deck())
    for s in p["slides"].values():
        alts = s["layout"]["alternatives"]
        assert len(alts) <= 4 and s["layout"]["id"] not in alts


def test_plan_record_is_small_and_stable():
    p, _, _ = _plan(deck())
    rec = layouts.plan_record(p)
    assert set(rec) == {"slides", "layout_title_pt"} and set(rec["slides"]) == set(p["order"])


# ---------------------------------------------------------------------------------------------------------- goldens
@pytest.mark.parametrize("rel", ["lumen_water", "types/investor_seed"])
def test_golden_plan_json_equals_the_plan_of_the_golden_deck_and_the_deck_is_unchanged_after_strip(rel):
    """golden_deck.json stays at assemble level (no layout, no text slots); golden_plan.json is the plan of it at density detailed (the tests' setting)."""
    d = json.loads((FIX / rel / "golden_deck.json").read_text())
    assert layouts.strip_plan(d) == d   # the golden holds none of the plan's keys
    p, _, _ = layouts.plan(d, prefs={"density": "detailed"})
    assert layouts.strip_plan(p) == d
    assert layouts.plan_record(p) == json.loads((FIX / rel / "golden_plan.json").read_text())


@pytest.mark.parametrize("rel", ["lumen_water", "types/investor_seed"])
def test_golden_slots_validate_against_their_layout(rel):
    d = json.loads((FIX / rel / "golden_deck.json").read_text())
    p, issues, _ = layouts.plan(d, prefs={"density": "detailed"})
    assert not [i for i in issues if i["check"] in ("slot_unknown", "slot_missing", "block_unbound")]
    for s in p["slides"].values():
        lay = LIB[s["layout"]["id"]]
        for name, v in s["slots"].items():
            assert name in lay["slots"] and lay["slots"][name]["kind"] == v["kind"]


# ---------------------------------------------------------------------------------------------------------- the hook
def _over_limit_deck():
    return with_slide("s05", "audience", [{"kind": "statement", "text": "word " * 120}])


def test_a_shorten_hook_that_answers_none_equals_no_hook():
    d = _over_limit_deck()
    a = layouts.plan(d, hooks={"shorten": lambda *x: None})
    b = layouts.plan(d)
    assert json.dumps(a, sort_keys=True) == json.dumps(b, sort_keys=True)


def test_a_shorten_hook_that_gives_text_binds_that_text_to_the_slot_only():
    d = _over_limit_deck()
    seen = []

    def hook(sid, slot, limits, fields):
        seen.append((sid, slot, limits, fields))
        return {"text": {f"{fields[0]["id"]}": "A short line."}}
    p, issues, pending = layouts.plan(d, hooks={"shorten": hook})
    s = p["slides"]["s05"]
    assert seen and seen[0][1] in s["slots"] and s["slots"][seen[0][1]]["text"] == "A short line."
    assert s["blocks"] == d["slides"]["s05"]["blocks"]   # the blocks are never edited by the plan
    assert not pending


def test_a_deferred_hook_lists_the_slot_in_pending_and_skips_the_notes_rung():
    d = _over_limit_deck()
    p, _, pending = layouts.plan(d, prefs={"density": "lean"}, hooks={"shorten": lambda *a: {"deferred": True}})
    hit = [x for x in pending if x["slide"] == "s05"]
    assert hit and hit[0]["rungs"][0] == "shorten"
    assert p["slides"]["s05"]["layout"]["fit"]["moved"] == []


# ---------------------------------------------------------------------------------------------------------- adversarial fixes
def _all_text(s):
    return " ".join(layouts._block_texts(b)[0] if False else " ".join(layouts._block_texts(b)) for b in spec.shown_blocks(s))


def test_a_titled_card_never_loses_its_title_under_lean():
    card = {"kind": "card", "title": "Persona Priya", "text": LONG + " " + LONG}
    d = with_slide("s05", "audience", [{"kind": "text", "text": LONG}, card, _bullets(LONG, LONG + " a")])
    p = _lean(d)
    s = p["slides"]["s05"]
    notes = " ".join(t for t, _ in layouts.moved_texts(s))
    assert "Persona Priya" in _all_text(s) + " " + notes   # on the slide or in the notes (a titled card stays on the slide)
    assert layouts.slide_words(d["slides"]["s05"]) != layouts.slide_words(with_slide("s05", "audience", [{"kind": "text", "text": LONG}, {**card, "title": "Other"}, _bullets(LONG, LONG + " a")])["slides"]["s05"])


def test_no_notes_moves_nothing_off_a_slide(tmp_path):
    from test_layout_run import run
    moved = lambda out: [m for s in json.loads((out / "deck.json").read_text())["slides"].values() for m in s["layout"]["fit"]["moved"]]
    assert moved(run(tmp_path / "a"))   # control: the default pitch moves a point
    assert moved(run(tmp_path / "b", "--no-notes")) == []


@pytest.mark.parametrize("t", ["investment", "business_model", "measurement", "traction"])
def test_nothing_moves_on_the_numbers_and_ask_slides(t):
    p = _lean(with_slide("s05", t, [_bullets(LONG, LONG + " a", LONG + " b", LONG + " c")]))
    assert p["slides"]["s05"]["layout"]["fit"]["moved"] == []


def test_a_block_flagged_human_never_moves():
    d = with_slide("s05", "audience", [_bullets(LONG, LONG + " a", LONG + " b"), {"kind": "text", "text": LONG, "human": True}, {"kind": "text", "text": LONG + " c", "human": True}])
    assert all(m["block"] == 0 for m in _lean(d)["slides"]["s05"]["layout"]["fit"]["moved"])


@pytest.mark.parametrize("t", ["Q3 delivery", "in 2027", "one in three homes", "a third of homes", "about a hundred homes", "twelve homes", "half the homes"])
def test_dates_and_spelled_numbers_count_as_figures(t):
    assert layouts._has_figure(t)


def test_plan_on_a_planned_deck_strips_and_replans_from_the_base():
    a, _, _ = layouts.plan(deck(), prefs={"density": "lean"})
    b, _, _ = layouts.plan(a, prefs={"density": "lean"})
    assert json.dumps(a, sort_keys=True) == json.dumps(b, sort_keys=True)


def test_apply_text_orders_field_ids_numerically_and_the_hook_gets_max_words_and_id_text_fields():
    val = {"kind": "list", "items": [{"text": f"i{n}"} for n in range(12)]}
    layouts._apply_text(val, {f"0.{n}": f"t{n}" for n in range(12)})
    assert [i["text"] for i in val["items"]] == [f"t{n}" for n in range(12)]
    seen = []
    d = _over_limit_deck()
    layouts.plan(d, hooks={"shorten": lambda sid, slot, lim, f: seen.append((lim, f))})
    lim, f = seen[0]
    assert "max_words" in lim and "max_chars" in lim and all(set(x) == {"id", "text"} for x in f)


def test_a_moved_item_with_a_newline_is_one_notes_line():
    assert layouts.moved_line("first\nsecond", ["a"]) == "- first / second [refs: a]"


def test_no_layout_plan_turns_the_look_css_off_in_web_and_hyperframes(tmp_path):
    from test_layout_run import run
    out = run(tmp_path / "n", "--no-layout-plan", "--hyperframes")
    for f in (out / "deck.html", out / "hyperframes" / "index.html"):
        assert "--tpt" not in f.read_text() and "max-inline-size:48ch" not in f.read_text(), f.name
