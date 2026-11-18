"""The deck visual checklist (engine/deck/bench/checklist.py, checklist.json): every check has a passing and a failing
fixture, n/a is never a pass, the renderer sidecar leaves the pptx byte-identical, and the baseline holds."""
from __future__ import annotations

import copy
import json
import socket
import sys
import zipfile
from pathlib import Path

import pytest

pytest.importorskip("pptx")
from pptx import Presentation
from pptx.util import Inches, Pt

from deck import issues, qa_render, render_pptx, spec
from deck.bench import checklist as cl
from deck.bench import compare as cmp
from deck.bench import fixtures as fx
from deck.bench.__main__ import main as bench_main

DECK_DIR = Path(__file__).resolve().parents[1]
ITEMS = cl.load_items()
IDS = [i["id"] for i in ITEMS["items"]]
LAYOUT_SEQ = ["cover", "cards", "cards", "kpi_row", "timeline_strip", "emphasis_bar"]
TYPES = ["title", "objective", "insight", "audience", "proposition", "close"]


def _slide(i, t):
    return {"type": t, "title": f"Slide {i} says one clear thing.", "status": "drafted", "section": "S",
            "blocks": [{"kind": "text", "text": "A short line of words."}]}


def make(tmp, deck_edit=None, validation=(), qa="default", layouts="default", report="default", pptx="default",
         title_at=None, body_w=4.5, body_pt=18, font="Arial", files=()):
    """An invented run folder that passes every judgeable check; each test breaks one thing."""
    d = Path(tmp) / "run"
    d.mkdir(parents=True, exist_ok=True)
    ids = [f"s{i}" for i in range(1, 7)]
    deck = {"meta": {}, "order": ids, "slides": {sid: _slide(n, t) for n, (sid, t) in enumerate(zip(ids, TYPES), 1)}}
    if deck_edit:
        deck_edit(deck)
    (d / "deck.json").write_text(json.dumps(deck))
    (d / "validation.json").write_text(json.dumps(list(validation))) if validation is not None else None
    if qa == "default":
        qa = {"slides": {}, "pixels": {"1": {"ink": 0.2}}, "summary": {}}
    if qa is not None:
        (d / "qa.json").write_text(json.dumps(qa))
    if layouts == "default":
        layouts = {"version": 1, "theme": "napkin", "slides": {sid: {"id": lid, "chosen": lid, "fallback": False, "relaxed": False}
                                                                 for sid, lid in zip(ids, LAYOUT_SEQ)}}
    if layouts is not None:
        (d / "layouts.json").write_text(json.dumps(layouts))
    if report == "default":
        report = {"usd_total": 0.25, "wall_secs": 1.5, "stages": {"validate": {"secs": 0.1}}}
    if report is not None:
        (d / "report.json").write_text(json.dumps(report))
    for f in files:
        (d / f).parent.mkdir(parents=True, exist_ok=True)
        (d / f).write_bytes(b"x")
    if pptx == "default":
        prs = Presentation()
        prs.slide_width, prs.slide_height = Inches(13.333), Inches(7.5)
        for sid in ids:
            sl = prs.slides.add_slide(prs.slide_layouts[6])
            left, top, size = (title_at or {}).get(sid, (0.6, 0.6, 64 if sid == "s1" else 36))
            for name, x, y, w, sz, text in (("Title", left, top, 11, size, "A title"), ("Body", 0.6, 3, body_w, body_pt,
                                                                                    "Words that wrap to more than a single line of text here " * 3)):
                tb = sl.shapes.add_textbox(Inches(x), Inches(y), Inches(w), Inches(1))
                tb.name = name
                r = tb.text_frame.paragraphs[0].add_run()
                r.text, r.font.size, r.font.name = text, Pt(sz), font
        prs.save(d / "deck.pptx")
    return d


def answer(run, item):
    return cl.run_checklist(run)["results"][item]


def qa_with(check, level="warn", slide="2", pixels=True):
    return {"slides": {slide: [{"check": check, "level": level, "message": "m"}]}, "pixels": {"1": {}} if pixels else {}, "summary": {}}


def img(status="made", asset="img_aaaaaaaaaaaa", **kw):
    return {"kind": "image", "image": {"kind": "photo", "status": status, "aspect": "16:9", "asset": asset, "alt": "A kettle.", **kw}}


def with_image(slide="s4", assets=None, **kw):
    def edit(deck):
        deck["slides"][slide]["slots"] = {"picture": img(**kw)}
        deck["assets"] = assets if assets is not None else {"img_aaaaaaaaaaaa": {"file": "assets/a.png", "rights": "generated"}}
    return edit


# ---------------------------------------------------------------- the list and the functions agree

def test_items_and_functions_agree():
    assert len(set(IDS)) == len(IDS) == 53 and set(cl.CHECKS) == set(IDS)
    assert all(fn.__name__ == i for i, fn in cl.CHECKS.items())
    assert sum(i["kind"] == "metric" for i in ITEMS["items"]) == 8
    assert {i["id"] for i in ITEMS["items"] if i["tier"] == "advisory"} == {"l_variety", "l_repeat_max2", "w_line_length", "t_cover_title", "m_seconds"}
    assert all(i["tier"] in ("gate", "advisory") for i in ITEMS["items"])
    for it in ITEMS["items"]:
        assert it["question"] and it["source"] and it["inputs"] and it["na_when"] and it["kind"] in ("yes_no", "metric"), it["id"]


# ---------------------------------------------------------------- each check: one passing and one failing fixture

def _seven(layout_ids):
    """Title, five content slides, close: seven presented slides with these layouts (pptx left out)."""
    def edit(deck):
        deck["order"] = [f"s{i}" for i in range(1, 8)]
        deck["slides"] = {f"s{i}": _slide(i, t) for i, t in enumerate(["title", "objective", "insight", "audience", "proposition", "objective", "close"], 1)}
    lay = {"version": 1, "theme": "napkin", "slides": {f"s{i}": {"id": l, "chosen": l, "fallback": False, "relaxed": False}
                                                      for i, l in enumerate(layout_ids, 1)}}
    return dict(deck_edit=edit, layouts=lay, pptx=None)


def _pass_fail():
    """id -> (passing run kwargs, failing run kwargs)."""
    bad_layouts = lambda **ch: {"version": 1, "theme": "napkin", "slides": {
        f"s{i}": {"id": l, "chosen": l, "fallback": False, "relaxed": False} for i, l in enumerate(LAYOUT_SEQ, 1)} | ch}
    err = lambda c, s="s2": [{"check": c, "level": "error", "slide": s, "message": "m"}]
    same = lambda ids: {"version": 1, "theme": "napkin", "slides": {
        f"s{i}": {"id": ids[i - 1], "chosen": ids[i - 1], "fallback": False, "relaxed": False} for i in range(1, 7)}}
    return {
        "g_no_blocker": ({}, dict(validation=err("numbers_trace"))),
        "g_no_validator_error": ({}, dict(validation=err("numbers_trace"))),
        "g_no_qa_error": ({}, dict(qa=qa_with("text_overflow", "error"))),
        "q_no_overflow": ({}, dict(qa=qa_with("text_overflow"))),
        "q_no_overlap": ({}, dict(qa=qa_with("text_overlap"))),
        "q_no_off_slide": ({}, dict(qa=qa_with("off_slide", "error"))),
        "q_margins_kept": ({}, dict(qa=qa_with("margin"))),
        "q_body_floor": ({}, dict(qa=qa_with("min_font"))),
        "q_contrast": ({}, dict(qa=qa_with("contrast"))),
        "q_no_filler": ({}, dict(qa=qa_with("placeholder", "error"))),
        "q_not_empty": ({}, dict(qa=qa_with("mostly_empty"))),
        "q_not_cornered": ({}, dict(qa=qa_with("one_corner"))),
        "l_no_fallback_flow": ({}, dict(layouts=bad_layouts(s3={"id": "flow", "chosen": "cards", "fallback": True, "relaxed": False}))),
        "l_no_rule_flow": ({}, dict(layouts=bad_layouts(s3={"id": "flow", "chosen": "flow", "fallback": False, "relaxed": False}))),
        "l_not_relaxed": ({}, dict(layouts=bad_layouts(s3={"id": "cards", "chosen": "cards", "fallback": False, "relaxed": True}))),
        "l_repeat_max2": (dict(layouts=same(["cover", "cards", "cards", "kpi_row", "kpi_row", "emphasis_bar"])),
                          dict(layouts=same(["cover", "cards", "cards", "cards", "kpi_row", "emphasis_bar"]))),
        "l_variety": (_seven(["cover", "cards", "kpi_row", "big_number", "timeline_strip", "chart", "emphasis_bar"]),
                      _seven(["cover", "cards", "cards", "cards", "kpi_row", "cards", "emphasis_bar"])),
        "l_in_library": ({}, dict(layouts=bad_layouts(s3={"id": "invented", "chosen": "invented", "fallback": False, "relaxed": False}))),
        "w_type_budget": ({}, dict(validation=[{"check": "word_budget", "level": "warn", "slide": "s2", "message": "m"}])),
        "w_pitch_length": ({}, dict(validation=[{"check": "pitch_length", "level": "error", "message": "m"}])),
        "w_takeaway_titles": ({}, dict(validation=[{"check": "action_title", "level": "warn", "slide": "s2", "message": "m"}])),
        "w_line_length": ({}, dict(body_w=11, body_pt=12)),
        "t_title_one_place": (dict(layouts=same(["cover", "cards", "cards", "kpi_row", "timeline_strip", "emphasis_bar"])),
                              dict(layouts=same(["cover", "cards", "cards", "kpi_row", "timeline_strip", "emphasis_bar"]),
                                   title_at={"s3": (0.7, 0.6, 36)})),
        "t_title_range": ({}, dict(title_at={"s2": (0.6, 0.6, 20)})),
        "t_cover_title": ({}, dict(title_at={"s1": (0.6, 0.6, 44)})),
        "t_two_families": ({}, None),   # failing fixture built below (needs two fonts on different slides)
        "p_only_creative": (dict(deck_edit=with_image("s4")), dict(deck_edit=with_image("s2"))),
        "p_one_style": (dict(deck_edit=lambda d: [with_image("s4", style={"hash": "aaaaaaaa"})(d), d["slides"]["s5"].update(slots={"p": img(style={"hash": "aaaaaaaa"})})]),
                        dict(deck_edit=lambda d: [with_image("s4", style={"hash": "aaaaaaaa"})(d), d["slides"]["s5"].update(slots={"p": img(style={"hash": "bbbbbbbb"})})])),
        "p_assets_resolve": (dict(deck_edit=with_image(), files=["assets/a.png"]), dict(deck_edit=with_image(), files=[])),
        "p_rights_ok": (dict(deck_edit=with_image()), dict(deck_edit=with_image(assets={"img_aaaaaaaaaaaa": {"file": "a", "rights": "reference_only"}}))),
        "p_alt_text": (dict(deck_edit=with_image()), dict(deck_edit=with_image(alt=""))),
        "p_where_asked": (dict(deck_edit=lambda d: [with_image("s4")(d), d["meta"].update(preferences={"pictures": {"on": "creative"}}),
                                                    d["slides"]["s3"].update(type="proposition")]),
                          dict(deck_edit=lambda d: d["meta"].update(preferences={"pictures": {"on": "creative"}}))),
        "w_density_met": (dict(deck_edit=lambda d: d["meta"].update(preferences={"density": {"level": "lean"}})),
                          dict(deck_edit=lambda d: [d["meta"].update(preferences={"density": {"level": "lean"}}),
                                                    d["slides"]["s2"].update(blocks=[{"kind": "text", "text": "word " * 31}])])),
    }


PF = _pass_fail()


@pytest.mark.parametrize("item", sorted(i for i in PF if i != "t_two_families"))
def test_check_passes_and_fails(tmp_path, item):
    good, bad = PF[item]
    assert answer(make(tmp_path / "g", **good), item)["answer"] == "yes", item
    res = answer(make(tmp_path / "b", **bad), item)
    assert res["answer"] == "no" and res["slides"], (item, res)


def test_two_families(tmp_path):
    assert answer(make(tmp_path / "g"), "t_two_families")["answer"] == "yes"
    run = make(tmp_path / "b")
    prs = Presentation(run / "deck.pptx")
    for sl, f in zip(prs.slides, ["Arial", "Georgia", "Calibri"] + ["Arial"] * 3):
        for sh in sl.shapes:
            sh.text_frame.paragraphs[0].runs[0].font.name = f
    prs.save(run / "deck.pptx")
    r = answer(run, "t_two_families")
    assert r["answer"] == "no" and r["measured"] == ["Arial", "Calibri", "Georgia"]


def test_slots_check_stays_na_while_reserved_and_the_picture_checks_are_live(tmp_path):
    run = make(tmp_path, deck_edit=with_image())
    assert answer(run, "l_slots_clean")["answer"] == "n/a" and "RESERVED" in answer(run, "l_slots_clean")["reason"]
    for item in ("p_no_stretch", "p_text_on_image"):   # picture_stretch and text_on_image_contrast are raised by qa_render now
        assert "RESERVED" not in (answer(run, item).get("reason") or "")


def test_not_yet_built_checks_are_na(tmp_path):
    r = cl.run_checklist(make(tmp_path))["results"]
    for item in ("g_no_major", "g_checks_current", "l_alternatives", "w_density_met", "p_where_asked"):
        assert r[item]["answer"] == "n/a" and r[item]["reason"], item


def test_checks_that_read_other_files_go_live_when_their_input_exists(tmp_path):
    ok = make(tmp_path / "a", qa={"slides": {}, "pixels": {"1": {}}, "deck_sha": "x" * 12, "summary": {}})
    assert answer(ok, "g_checks_current")["answer"] == "no"   # a sha that is not the deck's
    import hashlib
    run = make(tmp_path / "b")
    sha = hashlib.sha256((run / "deck.json").read_bytes()).hexdigest()
    (run / "qa.json").write_text(json.dumps({"slides": {}, "pixels": {"1": {}}, "deck_sha": sha[:12]}))
    assert answer(run, "g_checks_current")["answer"] == "yes"
    alt = make(tmp_path / "c", deck_edit=lambda d: d["slides"]["s2"].update(layout={"id": "cards", "chosen_by": "rule", "alternatives": ["kpi_row"]}))
    assert answer(alt, "l_alternatives")["answer"] == "no"   # only one slide records them: the others offer none


# ---------------------------------------------------------------- metrics

def test_metrics(tmp_path):
    def edit(deck):
        deck["slides"]["s2"]["blocks"] = [{"kind": "text", "text": "word " * 31}]
    r = cl.run_checklist(make(tmp_path, deck_edit=edit))["results"]
    assert r["m_share_le_30"]["value"] == 0.75 and r["m_share_le_60"]["value"] == 1.0
    assert r["m_median_words"]["value"] == 5 and r["m_usd"]["value"] == 0.25 and r["m_seconds"]["value"] == 1.5
    assert r["m_creative_pictured"]["value"] == 0.0   # audience, proposition? only picture types count; none is pictured
    run = make(tmp_path / "p", deck_edit=with_image("s4"))
    assert answer(run, "m_creative_pictured")["value"] > 0
    assert all(cl.run_checklist(make(tmp_path / "q"))["results"][i]["answer"] != "yes" for i in IDS if i.startswith("m_"))


# ---------------------------------------------------------------- the n/a rule

NEEDS = {
    "qa": {"g_no_blocker", "g_no_qa_error", "q_no_overflow", "q_no_overlap", "q_no_off_slide", "q_margins_kept", "q_body_floor",
           "q_contrast", "q_no_filler", "q_not_empty", "q_not_cornered"},
    "layouts": {"l_no_fallback_flow", "l_no_rule_flow", "l_not_relaxed", "l_repeat_max2", "l_in_library", "l_one_dominant", "t_title_one_place"},
    "report": {"m_usd", "m_seconds"},
    "pptx": {"w_line_length", "t_title_range", "t_cover_title", "t_two_families", "t_title_one_place"},
    "validation": {"g_no_blocker", "g_no_validator_error", "w_type_budget", "w_pitch_length", "w_takeaway_titles"},
}


@pytest.mark.parametrize("missing", sorted(NEEDS))
def test_a_missing_input_makes_exactly_its_checks_na(tmp_path, missing):
    kw = {"qa": dict(qa=None), "layouts": dict(layouts=None), "report": dict(report=None), "pptx": dict(pptx=None),
          "validation": dict(validation=None)}[missing]
    base = cl.run_checklist(make(tmp_path / "base"))["results"]
    res = cl.run_checklist(make(tmp_path / "x", **kw))["results"]
    went_na = {i for i in IDS if res[i]["answer"] == "n/a" and base[i]["answer"] != "n/a"}
    assert went_na == NEEDS[missing], (went_na ^ NEEDS[missing])
    assert all(res[i]["reason"] for i in went_na)


def test_a_qa_that_only_says_unreadable_is_na(tmp_path):
    qa = {"slides": {"deck": [{"check": "unreadable", "level": "error", "message": "m"}]}, "pixels": {}}
    assert answer(make(tmp_path, qa=qa), "g_no_qa_error")["answer"] == "n/a"


def test_no_pixels_makes_the_pixel_checks_na_and_a_run_with_no_picture_makes_the_picture_checks_na(tmp_path):
    r = cl.run_checklist(make(tmp_path, qa={"slides": {}, "pixels": {}}))["results"]
    assert r["q_not_empty"]["answer"] == r["q_not_cornered"]["answer"] == "n/a" and r["q_no_overflow"]["answer"] == "yes"
    for i in ("p_only_creative", "p_all_approved", "p_assets_resolve", "p_rights_ok", "p_alt_text", "p_one_style"):
        assert r[i]["answer"] == "n/a", i


def test_summary_never_counts_na_as_yes(tmp_path):
    res = cl.run_checklist(make(tmp_path, qa=None, layouts=None, report=None, pptx=None, validation=None))
    s = res["summary"]
    assert s["yes"] == sum(1 for v in res["results"].values() if v["answer"] == "yes") and s["na"] >= 30
    assert s["yes"] + s["no"] + s["na"] + len(s["metrics"]) == len(IDS)


def test_content_and_gate_edges(tmp_path):
    # hidden appendix slides are not presented: an error there is not a QA error; the 'deck' key is
    def edit(deck):
        deck["order"].append("s7")
        deck["slides"]["s7"] = _slide(7, "appendix")
    run = make(tmp_path / "a", deck_edit=edit, qa=qa_with("text_overflow", "error", slide="7"))
    assert answer(run, "g_no_qa_error")["answer"] == "yes" and answer(run, "q_no_overflow")["answer"] == "yes"
    deck_err = {"slides": {"deck": [{"check": "unreadable", "level": "error", "message": "m"}, {"check": "x", "level": "error", "message": "m"}]}, "pixels": {}}
    assert answer(make(tmp_path / "b", qa=deck_err), "g_no_qa_error")["answer"] == "no"


def test_variety_and_repeat_thresholds(tmp_path):
    def seq(ids):
        return {"version": 1, "theme": "napkin", "slides": {f"s{i}": {"id": l, "chosen": l, "fallback": False, "relaxed": False} for i, l in enumerate(ids, 1)}}
    def ten(layouts):
        def edit(deck):
            deck["order"] = [f"s{i}" for i in range(1, 11)]
            deck["slides"] = {f"s{i}": _slide(i, "objective") for i in range(1, 11)}
        return edit, seq(layouts)
    e, lay = ten(["cards", "kpi_row", "big_number", "timeline_strip", "cards", "kpi_row", "cards", "kpi_row", "cards", "kpi_row"])
    assert answer(make(tmp_path / "a", deck_edit=e, layouts=lay, pptx=None), "l_variety")["answer"] == "no"   # 4 distinct in 10
    e, lay = ten(["cards", "kpi_row", "big_number", "timeline_strip", "emphasis_bar", "chart", "cards", "kpi_row", "cards", "kpi_row"])
    assert answer(make(tmp_path / "b", deck_edit=e, layouts=lay, pptx=None), "l_variety")["answer"] == "yes"   # 6 distinct
    short = lambda d: [d.update(order=["s1", "s2", "s3", "s4"]), d.update(slides={k: v for k, v in d["slides"].items() if k in ("s1", "s2", "s3", "s4")})]
    assert answer(make(tmp_path / "c", deck_edit=short, layouts=seq(LAYOUT_SEQ), pptx=None), "l_variety")["reason"] == "fewer than 5 presented content slides"


# ---------------------------------------------------------------- the severity adapter and the slide mapper

def test_issues_severity_and_slide_ids():
    assert issues.severity("margin", "warn") == "minor" and issues.severity("off_slide", "error") == "blocker"
    assert issues.severity("margin", "warn", {"severity": {"margin": "major"}}) == "major"
    assert issues.severity("margin", "warn", {"severity": {"margin": "bogus"}}) == "minor"
    deck = {"order": ["a", "b"]}
    assert issues.slide_id_of("2", deck) == "b" and issues.slide_id_of("deck", deck) == "deck"
    assert issues.slide_id_of("9", deck) == "deck" and issues.slide_id_of("x", deck) == "deck"


# ---------------------------------------------------------------- pure pptx measures

def test_pptx_measures(tmp_path):
    prs = Presentation(make(tmp_path) / "deck.pptx")
    sl = prs.slides[1]
    assert qa_render.title_box(sl) == {"left_in": pytest.approx(0.6), "top_in": pytest.approx(0.6), "size_pt": 36.0}
    cols = qa_render.body_columns(sl)
    assert len(cols) == 1 and cols[0]["lines"] > 1 and cols[0]["width_in"] == pytest.approx(4.5)
    assert qa_render.font_families(prs)[2] == ["Arial"]
    assert qa_render.title_box(Presentation().slides.add_slide(Presentation().slide_layouts[6])) is None


# ---------------------------------------------------------------- the sidecar

def _render_pair(tmp_path, name):
    out = fx.build_one(name, tmp_path / name, geometry_only=True)   # run_deck passes layouts_out
    deck = json.loads((out / "deck.json").read_text())
    return out, deck


@pytest.mark.parametrize("name", ["lumen_water", "investor_seed"])
def test_sidecar_leaves_the_pptx_parts_byte_identical(tmp_path, name):
    out, deck = _render_pair(tmp_path, name)
    # render the same deck.json twice in memory: with and without layouts_out
    a, b = tmp_path / "with.pptx", tmp_path / "without.pptx"
    inp = _inputs_for(name)
    render_pptx.render(deck, inp, a, layouts_out=tmp_path / "layouts.json")
    render_pptx.render(deck, inp, b)
    with zipfile.ZipFile(a) as za, zipfile.ZipFile(b) as zb:
        assert za.namelist() == zb.namelist()
        for n in za.namelist():
            if n != "docProps/core.xml":
                assert za.read(n) == zb.read(n), n
    rec = json.loads((tmp_path / "layouts.json").read_text())
    assert rec["version"] == 1 and rec["theme"] == "napkin" and set(rec["slides"]) == set(deck["order"])
    assert all(set(v) == {"id", "chosen", "fallback", "relaxed", "fit", "shapes"} for v in rec["slides"].values())   # fit and shapes: deck-layout-library
    assert rec == json.loads((out / "layouts.json").read_text())


def _inputs_for(name):
    """The same Inputs run_deck built for the fixture (offline)."""
    from deck import inputs
    stages, args = fx.FIXTURES[name]
    get = lambda k: args[args.index(k) + 1].replace("{fx}", str(fx.FIXTURE_ROOT)) if k in args else None
    if get("--brief"):
        return inputs.load(Path(get("--brief")))
    return inputs.load(None, prompt_text=Path(get("--prompt-file")).read_text())


def _golden_deck():
    return json.loads((fx.FIXTURE_ROOT / "lumen_water" / "golden_deck.json").read_text())


def test_sidecar_records_fallback_and_relaxed(tmp_path, monkeypatch):
    from deck.inputs import Inputs
    deck = _golden_deck()
    deck["slides"]["s11"]["blocks"] = [{"kind": "bullets", "items": [{"text": "word " * 120} for _ in range(14)]}]   # too dense for any layout
    render_pptx.render(deck, Inputs(brief={}), tmp_path / "a.pptx", layouts_out=tmp_path / "a.json")
    rec = json.loads((tmp_path / "a.json").read_text())["slides"]["s11"]
    assert rec["id"] == "flow" and rec["fallback"] is True and rec["chosen"] != "flow"
    # a slide whose layout fits only once body text may go to the caption floor
    deck = _golden_deck()
    name = render_pptx.choose_layout(deck["slides"]["s05"])
    fn = render_pptx.Renderer.LAYOUT_FN.get(name, "_lay_stack")
    real = getattr(render_pptx.Renderer, fn)

    def picky(self, sl, s, *a, **k):
        if s["title"] == deck["slides"]["s05"]["title"] and not self._relaxed:
            raise render_pptx.NoFit("forced")
        return real(self, sl, s, *a, **k)
    monkeypatch.setattr(render_pptx.Renderer, fn, picky)
    render_pptx.render(deck, Inputs(brief={}), tmp_path / "b.pptx", layouts_out=tmp_path / "b.json")
    rec = json.loads((tmp_path / "b.json").read_text())["slides"]["s05"]
    assert {k: rec[k] for k in ("id", "chosen", "fallback", "relaxed")} == {"id": name, "chosen": name, "fallback": False, "relaxed": True}   # no plan here: fit is None
    assert rec["fit"] is None


# ---------------------------------------------------------------- compare

def _file(answers, version=1, deck="d"):
    res = {i: ({"answer": "value", "value": a} if isinstance(a, (int, float)) else {"answer": a}) for i, a in answers.items()}
    c = {k: sum(1 for v in res.values() if v["answer"] == k) for k in ("yes", "no")}
    return {"version": 1, "items_version": version, "decks": {deck: {"results": res, "summary": {**c, "na": sum(1 for v in res.values() if v["answer"] == "n/a"), "metrics": {}}}}}


def test_compare_transitions_and_formats():
    b = _file({"a": "yes", "b": "no", "c": "n/a", "d": "yes", "m": 0.5, "only_b": "yes"})
    a = _file({"a": "no", "b": "yes", "c": "yes", "d": "n/a", "m": 0.75, "only_a": "yes"})
    a["decks"]["new"] = a["decks"]["d"]
    diff = cmp.compare(b, a, direction={})
    ch = {c["item"]: (c["from"], c["to"]) for c in diff["decks"]["d"]["changes"]}
    assert ch == {"a": ("yes", "no"), "b": ("no", "yes"), "c": ("n/a", "yes"), "d": ("yes", "n/a")}
    assert diff["decks"]["d"]["metrics"] == [{"item": "m", "before": 0.5, "after": 0.75, "delta": 0.25, "direction": None, "worse": False, "lost": False, "tier": "gate"}]
    assert diff["decks"]["d"]["only_before"] == ["only_b"] and diff["decks"]["d"]["only_after"] == ["only_a"]
    assert diff["only_after"] == ["new"] and diff["regressions"] == 1
    assert "| d |" in cmp.render(diff, "md") and "yes -> no" in cmp.render(diff, "text")
    assert json.loads(cmp.render(diff, "json"))["regressions"] == 1
    assert "unchanged" not in cmp.render(cmp.compare(_file({"a": "yes"}), _file({"a": "n/a"})), "text")
    assert cmp.compare(_file({"a": "yes"}, 1), _file({"a": "yes"}, 2))["items_changed"]


def test_compare_cli_exit_codes(tmp_path):
    b, a = tmp_path / "b.json", tmp_path / "a.json"
    b.write_text(json.dumps(_file({"a": "yes"})))
    a.write_text(json.dumps(_file({"a": "no"})))
    assert bench_main(["compare", str(b), str(a)]) == 0
    assert bench_main(["compare", str(b), str(a), "--fail-on-regress"]) == 1
    assert bench_main(["compare", str(a), str(b), "--fail-on-regress"]) == 0


# ---------------------------------------------------------------- baseline, no network

@pytest.fixture(scope="module")
def rebuilt(tmp_path_factory):
    root = tmp_path_factory.mktemp("fx")
    runs = fx.build_all(root, geometry_only=True)
    return cl.run_all(list(runs.values()))


#: Items that were n/a in slice 2's baseline and that deck-layout-library now answers (the plan writes layouts, alternatives and slots).
NEWLY_JUDGED = {"l_alternatives", "l_slots_clean", "w_density_met", "w_notes_kept"}


def test_baseline_against_a_geometry_only_rebuild_no_item_turns_from_yes_to_no(rebuilt):
    """The baseline is slice 2's "before" (the six invented fixtures, built before the layout library). The rebuild is the detailed pass (the tests'
    setting). Items the library does not touch must answer as they did; an item may improve; none may turn from yes to no (bench/compare.py shows
    the movement; the checklist numbers are in the feature record)."""
    base = json.loads((DECK_DIR / "bench" / "baseline" / "checklist.json").read_text())
    assert base["items_version"] == ITEMS["version"] and set(base["decks"]) == set(rebuilt["decks"]) == set(fx.FIXTURES)
    skip = {i["id"] for i in ITEMS["items"] if i.get("depends_on")}
    for d, b in base["decks"].items():
        assert set(b["results"]) == set(IDS) and b["inputs"]["qa_pixels"], d
        for i in IDS:
            if i in skip or i in NEWLY_JUDGED:
                continue
            was, now = b["results"][i], rebuilt["decks"][d]["results"][i]
            if was["answer"] in ("yes", "no", "n/a") and was["answer"] != "value":
                assert not (was["answer"] == "yes" and now["answer"] == "no"), (d, i, now)


def test_no_network_and_no_model_imports(tmp_path, monkeypatch):
    def boom(*a, **k):
        raise AssertionError("network used")
    monkeypatch.setattr(socket, "socket", boom)
    run = make(tmp_path)
    assert bench_main(["checklist", str(run), "--out", str(tmp_path / "o.json")]) == 0
    import subprocess
    code = "import sys, deck.bench.checklist, deck.bench.compare, deck.bench.fixtures; assert 'deck.stages' not in sys.modules"
    assert subprocess.run([sys.executable, "-c", code], cwd=DECK_DIR.parent, capture_output=True).returncode == 0
    assert json.loads((tmp_path / "o.json").read_text())["decks"]["run"]["summary"]["yes"] > 10


# ---------------------------------------------------------------- review fixes

PER_SLIDE = [i for i in IDS if i.startswith(cl.PER_SLIDE_PREFIXES)]


def _only_appendix(deck):
    deck["order"] = ["s1"]
    deck["slides"] = {"s1": _slide(1, "appendix")}


def _empty(deck):
    deck["order"], deck["slides"] = [], {}


@pytest.mark.parametrize("edit", [_only_appendix, _empty], ids=["appendix_only", "empty"])
def test_a_deck_with_nothing_presented_passes_nothing(tmp_path, edit):
    res = cl.run_checklist(make(tmp_path, deck_edit=edit, pptx=None))["results"]
    assert [i for i in PER_SLIDE if res[i]["answer"] == "yes"] == []
    assert all(res[i]["answer"] == "n/a" and res[i]["reason"] == "no presented slide" for i in PER_SLIDE)
    assert not any(v["answer"] == "value" for k, v in res.items() if k.startswith("m_share") or k == "m_median_words")


def test_nothing_measured_is_na(tmp_path):
    def two(deck):   # presented: a title and a close only, so no content slide
        deck["order"] = ["s1", "s6"]
        deck["slides"] = {"s1": _slide(1, "title"), "s6": _slide(6, "close")}
        deck["meta"]["preferences"] = {"density": {"level": "lean"}, "pictures": {"on": "creative"}}
    r = cl.run_checklist(make(tmp_path / "a", deck_edit=two))["results"]
    assert r["w_density_met"]["answer"] == "n/a" and r["p_where_asked"]["answer"] == "n/a"
    assert r["t_title_range"]["answer"] == "n/a"          # no content slide to measure
    run = make(tmp_path / "b")
    prs = Presentation(run / "deck.pptx")
    for sl in prs.slides:
        for sh in list(sl.shapes):
            sh._element.getparent().remove(sh._element)   # slides with no text at all
    prs.save(run / "deck.pptx")
    r = cl.run_checklist(run)["results"]
    for i in ("t_two_families", "w_line_length", "t_title_range"):
        assert r[i]["answer"] == "n/a", i


def test_variety_with_a_content_slide_missing_from_the_sidecar_is_na(tmp_path):
    kw = _seven(["cover", "cards", "kpi_row", "big_number", "timeline_strip", "chart", "emphasis_bar"])
    del kw["layouts"]["slides"]["s3"]
    assert answer(make(tmp_path, **kw), "l_variety")["answer"] == "n/a"


def test_a_failed_render_leaves_no_old_layout_record(tmp_path, monkeypatch):
    from deck.inputs import Inputs
    old = tmp_path / "layouts.json"
    old.write_text('{"stale": true}')
    monkeypatch.setattr(render_pptx.Renderer, "slide", lambda *a, **k: (_ for _ in ()).throw(RuntimeError("boom")))
    with pytest.raises(RuntimeError):
        render_pptx.render(_golden_deck(), Inputs(brief={}), tmp_path / "d.pptx", layouts_out=old)
    assert not old.exists()


def test_compare_flags_lost_coverage_and_n_a_to_no():
    b = _file({"a": "yes", "b": "n/a", "c": "yes", "gone": "yes"})
    b["decks"]["old"] = b["decks"]["d"]
    a = _file({"a": "n/a", "b": "no", "c": "yes"})
    diff = cmp.compare(b, a, direction={})
    assert diff["lost_coverage"] == 3          # yes to n/a, the item missing after, the deck missing after
    assert diff["regressions"] == 1            # n/a to no
    assert cmp.failed(diff)
    assert not cmp.failed(cmp.compare(_file({"a": "yes"}), _file({"a": "yes"}), direction={}))
    assert cmp.compare(_file({"a": "yes"}, 1), _file({"a": "yes"}, 2), direction={})["lost_coverage"] == 1
    assert cmp.compare(_file({"m": 0.5}), _file({"m": "n/a"}), direction={"m": "lower"})["lost_coverage"] == 1


def test_every_metric_has_a_direction_and_compare_flags_the_worse_way(tmp_path):
    dirs = {i["id"]: i.get("direction") for i in ITEMS["items"] if i["kind"] == "metric"}
    assert dirs == {"m_usd": "lower", "m_seconds": "lower", "m_share_le_30": "higher", "m_share_le_60": "higher",
                    "m_median_words": "lower", "m_creative_pictured": "higher", "w_words_sha": "same", "p_all_approved": "higher"}
    base = _file({"m_usd": 1.0, "m_share_le_30": 0.5})
    worse = cmp.compare(base, _file({"m_usd": 1.5, "m_share_le_30": 0.4}), direction=dirs)
    assert worse["metric_regressions"] == 2 and cmp.failed(worse)
    better = cmp.compare(base, _file({"m_usd": 0.5, "m_share_le_30": 0.9}), direction=dirs)
    assert better["metric_regressions"] == 0 and not cmp.failed(better)
    assert cmp.compare(base, _file({"m_usd": 1.05, "m_share_le_30": 0.5}), tolerance=0.1, direction=dirs)["metric_regressions"] == 0
    b, a = tmp_path / "b.json", tmp_path / "a.json"
    b.write_text(json.dumps(base))
    a.write_text(json.dumps(_file({"m_usd": 1.5, "m_share_le_30": 0.5})))
    assert bench_main(["compare", str(b), str(a)]) == 0
    assert bench_main(["compare", str(b), str(a), "--fail-on-regress"]) == 1
    assert bench_main(["compare", str(b), str(a), "--fail-on-regress", "--tolerance", "1"]) == 0


# ---------------------------------------------------------------- follow-ups after the design review

def _lumen_run(tmp_path, edit=None):
    deck = json.loads((fx.FIXTURE_ROOT / "lumen_water" / "golden_deck.json").read_text())
    if edit:
        edit(deck)
    d = tmp_path / "lumen"
    d.mkdir(parents=True, exist_ok=True)
    (d / "deck.json").write_text(json.dumps(deck))
    return d


def test_words_sha_ignores_every_look_and_changes_with_one_word(tmp_path):
    base = answer(_lumen_run(tmp_path / "a"), "w_words_sha")["value"]

    def look(deck):
        deck["meta"]["theme"] = {"name": "x", "colors": {"ink": "000000"}, "logo": {"asset": "img_aaaaaaaaaaaa"}}
        deck["meta"]["preferences"] = {"density": {"level": "lean"}, "pictures": {"on": "creative"}}
        deck["assets"] = {"img_aaaaaaaaaaaa": {"file": "assets/a.png", "rights": "own"}}
        deck["review"] = {"pinned": {"s02": {"by": "human:x", "at": "t"}}}
        for sl in deck["slides"].values():
            sl["layout"] = {"id": "cards", "chosen_by": "rule"}
            sl["slots"] = {"picture": img()}
    assert answer(_lumen_run(tmp_path / "b", look), "w_words_sha")["value"] == base

    def word(deck):
        deck["slides"]["s03"]["title"] += " today"
    assert answer(_lumen_run(tmp_path / "c", word), "w_words_sha")["value"] != base

    def note(deck):
        deck["slides"]["s03"]["notes"] = "a spoken line"
    assert answer(_lumen_run(tmp_path / "d", note), "w_words_sha")["value"] != base


def test_compare_fails_when_words_change_but_not_when_they_do_not(tmp_path):
    sha = lambda v: {"version": 1, "items_version": 2, "decks": {"d": {"results": {"w_words_sha": {"answer": "value", "value": v}}, "summary": {"yes": 0, "no": 0, "na": 0, "metrics": {}}}}}
    same = cmp.compare(sha("aaa"), sha("aaa"))
    assert not cmp.failed(same)
    diff = cmp.compare(sha("aaa"), sha("bbb"))
    assert diff["metric_regressions"] == 1 and cmp.failed(diff) and "WORDS CHANGED" in cmp.render(diff, "text")
    b, a = tmp_path / "b.json", tmp_path / "a.json"
    b.write_text(json.dumps(sha("aaa")))
    a.write_text(json.dumps(sha("bbb")))
    assert bench_main(["compare", str(b), str(a), "--fail-on-regress"]) == 1


def test_line_length_is_in_characters_so_size_counts(tmp_path):
    # a 14 pt column of 4.5 in is about 44 characters a line: fine; the same column at 28 pt is about 22: fine
    assert answer(make(tmp_path / "a", body_w=4.5, body_pt=14), "w_line_length")["answer"] == "yes"
    # a full-width 28 pt statement (a 12 in frame) is about 56 characters a line: fine, though 12 in is far over 4.9 in
    assert answer(make(tmp_path / "b", body_w=12, body_pt=28), "w_line_length")["answer"] == "yes"
    # the same width at 12 pt is about 135 characters a line: too long
    bad = answer(make(tmp_path / "c", body_w=12, body_pt=12), "w_line_length")
    assert bad["answer"] == "no" and bad["measured"] > 75 and bad["limit"] == 75


def test_line_length_limit_can_be_set_per_role(tmp_path, monkeypatch):
    run = make(tmp_path, body_w=12, body_pt=28)
    items = cl.load_items()
    for it in items["items"]:
        if it["id"] == "w_line_length":
            it["threshold"] = {"max_chars": 75, "by_role": {"body": 30}}
    assert cl.run_checklist(run, items)["results"]["w_line_length"]["answer"] == "no"


def test_compare_leaves_advisory_items_out_of_the_failure(tmp_path):
    tier = {"adv": "advisory", "gate": "gate"}
    b = _file({"adv": "yes", "gate": "yes"})
    a = _file({"adv": "no", "gate": "yes"})
    diff = cmp.compare(b, a, direction={}, tier=tier)
    assert diff["regressions"] == 0 and diff["advisory"] == 1 and not cmp.failed(diff) and "(advisory)" in cmp.render(diff, "text")
    assert cmp.failed(cmp.compare(_file({"gate": "yes"}), _file({"gate": "no"}), direction={}, tier=tier))
    # the real items: l_variety is advisory, g_no_qa_error a gate
    real = cmp.tiers()
    assert real["l_variety"] == "advisory" and real["g_no_qa_error"] == "gate"
    wb, wa = tmp_path / "b.json", tmp_path / "a.json"
    wb.write_text(json.dumps(_file({"l_variety": "yes"})))
    wa.write_text(json.dumps(_file({"l_variety": "no"})))
    assert bench_main(["compare", str(wb), str(wa), "--fail-on-regress"]) == 0


def test_variety_counts_content_layouts_only(tmp_path):
    # five content slides on five layouts pass; the cover and close being different does not rescue four alike ones
    kw = _seven(["cover", "cards", "cards", "cards", "cards", "kpi_row", "emphasis_bar"])
    assert answer(make(tmp_path, **kw), "l_variety")["answer"] == "no"


def test_repeat_exempts_parallel_slides_of_one_type(tmp_path):
    def three_territories(types):
        def edit(deck):
            for sid, t in zip(["s2", "s3", "s4"], types):
                deck["slides"][sid]["type"] = t
        lay = {"version": 1, "theme": "napkin", "slides": {f"s{i}": {"id": l, "chosen": l, "fallback": False, "relaxed": False}
                                                          for i, l in enumerate(["cover", "cards", "cards", "cards", "kpi_row", "emphasis_bar"], 1)}}
        return dict(deck_edit=edit, layouts=lay)
    assert answer(make(tmp_path / "a", **three_territories(["territory"] * 3)), "l_repeat_max2")["answer"] == "yes"
    assert answer(make(tmp_path / "b", **three_territories(["territory", "territory", "idea"])), "l_repeat_max2")["answer"] == "no"


def test_cover_title_is_relative_to_the_content_titles(tmp_path):
    big = {"s1": (0.6, 0.6, 60)}
    assert answer(make(tmp_path / "a", title_at=big), "t_cover_title")["answer"] == "yes"       # 60 / 36 = 1.67
    small_theme = {sid: (0.6, 0.6, 20 if sid != "s1" else 32) for sid in ("s1", "s2", "s3", "s4", "s5", "s6")}
    assert answer(make(tmp_path / "b", title_at=small_theme), "t_cover_title")["answer"] == "yes"   # 32 / 20 = 1.6, under 60 pt
    low = {"s1": (0.6, 0.6, 44)}
    r = answer(make(tmp_path / "c", title_at=low), "t_cover_title")
    assert r["answer"] == "no" and r["measured"] == pytest.approx(1.22, abs=0.01) and r["limit"] == 1.4


def test_notes_kept(tmp_path):
    """Where the plan moved points off a slide (layout.fit.moved), the pptx's speaker notes hold each one: a line, verbatim, with its refs."""
    from deck import layouts as lay

    def edit(deck):
        s = deck["slides"]["s2"]
        s["blocks"] = [{"kind": "bullets", "items": [{"text": "kept"}, {"text": "moved point", "refs": ["f_1"]}]}]
        s["layout"] = {"id": "cards", "chosen_by": "fit_ladder", "fit": {"rung": "overflow_to_notes", "moved": [{"block": 0, "item": 1, "sha": lay._sha12("moved point"), "refs": ["f_1"]}]}}

    def with_notes(run, text):
        prs = Presentation(str(run / "deck.pptx"))
        prs.slides[1].notes_slide.notes_text_frame.text = text
        prs.save(str(run / "deck.pptx"))
    assert answer(make(tmp_path / "n"), "w_notes_kept")["answer"] == "n/a"
    a = make(tmp_path / "a", deck_edit=edit)
    with_notes(a, "Moved from the slide:\n- moved point [refs: f_1]")
    assert answer(a, "w_notes_kept")["answer"] == "yes"
    b = make(tmp_path / "b", deck_edit=edit)
    with_notes(b, "Moved from the slide:\n- moved point")   # the refs were dropped
    assert answer(b, "w_notes_kept")["answer"] == "no"


def _theme(colors=None, **extra):
    base = {"ink": "111111", "paper": "FFFFFF", "panel": "EEEEEE", "rule": "CCCCCC", "mute": "777777", "accent": "E8A33D",
            "accent_ink": "111111", "on_dark": "FFFFFF", "on_dark_mute": "BBBBBB", "accent_on_dark": "F0B35D"}
    return {"name": "t", "colors": colors or base, **extra}


def _color_pptx(run, hex_):
    from pptx.dml.color import RGBColor
    prs = Presentation(run / "deck.pptx")
    r = prs.slides[1].shapes[0].text_frame.paragraphs[0].runs[0]
    r.font.color.rgb = RGBColor.from_string(hex_)
    prs.save(run / "deck.pptx")


def test_palette_only(tmp_path):
    with_theme = lambda d: d["meta"].update(theme=_theme())
    assert answer(make(tmp_path / "n"), "k_palette_only")["answer"] == "n/a"      # no meta.theme
    good = make(tmp_path / "a", deck_edit=with_theme)
    _color_pptx(good, "E8A33D")
    assert answer(good, "k_palette_only")["answer"] == "yes"
    bad = make(tmp_path / "b", deck_edit=with_theme)
    _color_pptx(bad, "FF00FF")
    r = answer(bad, "k_palette_only")
    assert r["answer"] == "no" and r["measured"] == ["FF00FF"] and r["slides"] == ["s2"]


def test_logo_on_the_cover(tmp_path):
    logo = lambda d: d["meta"].update(theme=_theme(logo={"asset": "img_aaaaaaaaaaaa", "placement": "cover_only"}))
    assert answer(make(tmp_path / "n"), "k_logo_cover")["answer"] == "n/a"
    none = lambda d: d["meta"].update(theme=_theme(logo={"asset": "img_aaaaaaaaaaaa", "placement": "none"}))
    assert answer(make(tmp_path / "m", deck_edit=none), "k_logo_cover")["answer"] == "n/a"
    missing = make(tmp_path / "a", deck_edit=logo)
    assert answer(missing, "k_logo_cover")["answer"] == "no"
    prs = Presentation(missing / "deck.pptx")
    from PIL import Image
    Image.new("RGB", (4, 4), "white").save(tmp_path / "l.png")
    pic = prs.slides[0].shapes.add_picture(str(tmp_path / "l.png"), Inches(1), Inches(1))
    pic.name = "Logo"
    prs.save(missing / "deck.pptx")
    assert answer(missing, "k_logo_cover")["answer"] == "yes"


def test_all_approved_is_a_share_not_a_permanent_no(tmp_path):
    ok = dict(status="approved", approval={"asset": "img_aaaaaaaaaaaa", "decision": "approve", "by": "human:x", "at": "t"})
    assert answer(make(tmp_path / "n"), "p_all_approved")["answer"] == "n/a"
    r = answer(make(tmp_path / "a", deck_edit=with_image(**ok)), "p_all_approved")
    assert r["answer"] == "value" and r["value"] == 1.0
    r = answer(make(tmp_path / "b", deck_edit=with_image(status="made")), "p_all_approved")
    assert r["answer"] == "value" and r["value"] == 0.0
    mismatch = dict(ok, approval={**ok["approval"], "asset": "img_bbbbbbbbbbbb"})
    assert answer(make(tmp_path / "c", deck_edit=with_image(**mismatch)), "p_all_approved")["value"] == 0.0


# ---------------------------------------------------------------- the frames demo (deck-frames-in)

DEMO_FX = Path(__file__).resolve().parent / "fixtures" / "frames_demo"


def _demo_run(demo_stages, build_demo, out, *args):
    """The Lumen Water frames demo built (geometry only) and its QA written, as a bench run folder."""
    from deck import qa_render
    run = build_demo(demo_stages, out, "--pictures", "creative_cover", *args)
    findings = json.loads((run / "validation.json").read_text())
    qa_render.run(run / "deck.pptx", None, run, findings)
    return run


def test_the_frames_demo_answers_every_picture_item_with_a_real_value(demo_stages, build_demo, tmp_path):
    run = _demo_run(demo_stages, build_demo, tmp_path / "o", "--image", f"s05.picture={DEMO_FX / 'small.png'}", "--image-rights", "s05.picture=own")
    r = cl.run_checklist(run)["results"]
    assert r["p_where_asked"]["answer"] == "no" and r["p_where_asked"]["slides"] == ["s12", "s13"]   # the two executions have no frame to show: still asked for, still empty
    assert r["p_only_creative"]["answer"] == "yes" and r["p_assets_resolve"]["answer"] == "yes"
    assert r["p_rights_ok"]["answer"] == "yes" and r["p_alt_text"]["answer"] == "yes"
    assert r["p_no_stretch"]["answer"] == "yes" and r["p_text_on_image"]["answer"] == "yes"
    assert r["p_no_lowres"]["answer"] == "no" and r["p_no_lowres"]["slides"] == ["s05"]    # the deliberate 320 pixel picture
    assert r["m_creative_pictured"]["answer"] == "value" and 0 < r["m_creative_pictured"]["value"] <= 1
    assert r["p_all_approved"]["value"] == 0.0 and r["p_all_approved"]["audience"] == "review" and r["p_all_approved"]["n"] == 14
    assert r["p_client_approved"]["answer"] == "n/a" and "not for the client" in r["p_client_approved"]["reason"]


def test_the_demo_assets_resolve_in_the_run_folder_for_the_drawn_pictures(demo_stages, build_demo, tmp_path):
    run = _demo_run(demo_stages, build_demo, tmp_path / "o")
    got = cl.run_checklist(run)["results"]["p_assets_resolve"]
    # review draws made, flagged and approved pictures: every filled slot's file is in the folder, except none is missing
    assert got["answer"] == "yes", got


def test_p_all_approved_is_a_number_in_review_and_the_client_item_is_yes_or_no(demo_stages, build_demo, tmp_path):
    rev = _demo_run(demo_stages, build_demo, tmp_path / "a")
    assert cl.run_checklist(rev)["results"]["p_all_approved"]["value"] == 0.0
    review = tmp_path / "r.json"
    from deck import images
    review_obj = {}
    images.approve_territory(review_obj, json.loads((rev / "deck.json").read_text()), "t1", "human:demo-approver")
    review.write_text(json.dumps(review_obj))
    part = _demo_run(demo_stages, build_demo, tmp_path / "b", "--review", str(review), "--approver", "human:demo-approver")
    v = cl.run_checklist(part)["results"]["p_all_approved"]
    assert 0 < v["value"] < 1
    client = _demo_run(demo_stages, build_demo, tmp_path / "c", "--review", str(review), "--approver", "human:demo-approver", "--audience", "client")
    res = cl.run_checklist(client)["results"]
    assert res["p_client_approved"]["answer"] == "no" and "s09" in res["p_client_approved"]["slides"]       # t2 and t3 wait for a person
    assert res["p_assets_resolve"]["answer"] == "yes"                                                       # a client folder holds the approved ones it draws
    # approve everything that can be: the one flagged and the one refused stay out, so the answer is still no; remove them to see a yes
    d = json.loads((client / "deck.json").read_text())
    for sid, name, im in list(images.image_slots(d)):
        if im["status"] != "approved":
            del d["slides"][sid]["slots"][name]
    (client / "deck.json").write_text(json.dumps(d))
    assert cl.run_checklist(client)["results"]["p_client_approved"]["answer"] == "yes"
    assert cl.run_checklist(client)["results"]["p_all_approved"]["value"] == 1.0


def test_words_are_equal_with_and_without_pictures_in_the_checklist(demo_stages, build_demo, tmp_path):
    with_p = _demo_run(demo_stages, build_demo, tmp_path / "a")
    plain = build_demo(demo_stages, tmp_path / "b")
    assert answer(with_p, "w_words_sha")["value"] == answer(plain, "w_words_sha")["value"]


def _styled(hashes, current=None):
    def edit(deck):
        deck["slides"]["s4"]["slots"] = {f"frame_{i}": img(style={"pack": "p", "version": 1, "hash": h}) for i, h in enumerate(hashes, 1)}
        deck["assets"] = {"img_aaaaaaaaaaaa": {"file": "assets/a.png", "rights": "generated"}}
        if current:
            deck["meta"]["preferences"] = {"style_pack": {"use": "territory", "hash": current, "source": "default"}}
    return edit


def test_p_one_style_counts_a_stale_hash_on_its_own_not_as_mixed(tmp_path):
    h1, h2 = "11111111", "22222222"
    assert answer(make(tmp_path / "a", deck_edit=_styled([h1, h1, h1, h1])), "p_one_style")["answer"] == "yes"
    assert answer(make(tmp_path / "b", deck_edit=_styled([h1, h2])), "p_one_style")["answer"] == "no"          # no pack named: two styles are mixed
    got = answer(make(tmp_path / "c", deck_edit=_styled([h1, h1, h1, h1], current=h2)), "p_one_style")
    assert got["answer"] == "yes" and got["stale"] == 4                                                         # v1 frames with a v2 pack
    got = answer(make(tmp_path / "d", deck_edit=_styled([h1, h1, h2, h2], current=h2)), "p_one_style")
    assert got["answer"] == "yes" and got["stale"] == 2
    got = answer(make(tmp_path / "e", deck_edit=_styled([h1, "33333333", h2], current=h2)), "p_one_style")
    assert got["answer"] == "yes" and got["stale"] == 2   # one fresh (h2) and two stale (h1, 3333...): stale is counted, never mixed
