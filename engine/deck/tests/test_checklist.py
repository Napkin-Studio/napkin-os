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
         title_at=None, body_w=4.5, font="Arial", files=()):
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
            for name, x, y, w, sz, text in (("Title", left, top, 11, size, "A title"), ("Body", 0.6, 3, body_w, 18,
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
    assert len(set(IDS)) == len(IDS) == 47 and set(cl.CHECKS) == set(IDS)
    assert all(fn.__name__ == i for i, fn in cl.CHECKS.items())
    assert sum(i["kind"] == "metric" for i in ITEMS["items"]) == 6
    for it in ITEMS["items"]:
        assert it["question"] and it["source"] and it["inputs"] and it["na_when"] and it["kind"] in ("yes_no", "metric"), it["id"]


# ---------------------------------------------------------------- each check: one passing and one failing fixture

def _pass_fail():
    """id -> (passing run kwargs, failing run kwargs)."""
    bad_layouts = lambda **ch: {"version": 1, "theme": "napkin", "slides": {
        f"s{i}": {"id": l, "chosen": l, "fallback": False, "relaxed": False} for i, l in enumerate(LAYOUT_SEQ, 1)} | ch}
    err = lambda c, s="s2": [{"check": c, "level": "error", "slide": s, "message": "m"}]
    same = lambda ids: {"version": 1, "theme": "napkin", "slides": {
        f"s{i}": {"id": ids[i - 1], "chosen": ids[i - 1], "fallback": False, "relaxed": False} for i in range(1, 7)}}
    approved = dict(status="approved", approval={"asset": "img_aaaaaaaaaaaa", "decision": "approve", "by": "human:x", "at": "t"})
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
        "l_variety": ({}, dict(layouts=same(["cover", "cards", "cards", "cards", "cards", "emphasis_bar"]))),
        "l_in_library": ({}, dict(layouts=bad_layouts(s3={"id": "invented", "chosen": "invented", "fallback": False, "relaxed": False}))),
        "w_type_budget": ({}, dict(validation=[{"check": "word_budget", "level": "warn", "slide": "s2", "message": "m"}])),
        "w_pitch_length": ({}, dict(validation=[{"check": "pitch_length", "level": "error", "message": "m"}])),
        "w_takeaway_titles": ({}, dict(validation=[{"check": "action_title", "level": "warn", "slide": "s2", "message": "m"}])),
        "w_line_length": ({}, dict(body_w=6.5)),
        "t_title_one_place": (dict(layouts=same(["cover", "cards", "cards", "kpi_row", "timeline_strip", "emphasis_bar"])),
                              dict(layouts=same(["cover", "cards", "cards", "kpi_row", "timeline_strip", "emphasis_bar"]),
                                   title_at={"s3": (0.7, 0.6, 36)})),
        "t_title_range": ({}, dict(title_at={"s2": (0.6, 0.6, 20)})),
        "t_cover_title": ({}, dict(title_at={"s1": (0.6, 0.6, 44)})),
        "t_two_families": ({}, None),   # failing fixture built below (needs two fonts on different slides)
        "p_only_creative": (dict(deck_edit=with_image("s4")), dict(deck_edit=with_image("s2"))),
        "p_all_approved": (dict(deck_edit=with_image(**approved)), dict(deck_edit=with_image(status="made"))),
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


def test_slots_and_reserved_checks_stay_na_while_reserved(tmp_path):
    run = make(tmp_path, deck_edit=with_image())
    for item in ("l_slots_clean", "p_no_stretch", "p_text_on_image"):
        assert answer(run, item)["answer"] == "n/a" and "RESERVED" in answer(run, item)["reason"]


def test_not_yet_built_checks_are_na(tmp_path):
    r = cl.run_checklist(make(tmp_path))["results"]
    for item in ("g_no_major", "g_checks_current", "l_one_dominant", "l_alternatives", "w_density_met", "p_where_asked"):
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
    "layouts": {"l_no_fallback_flow", "l_no_rule_flow", "l_not_relaxed", "l_repeat_max2", "l_variety", "l_in_library", "t_title_one_place"},
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
    assert s["yes"] + s["no"] + s["na"] + len(s["metrics"]) + sum(1 for v in res["results"].values() if v["answer"] == "n/a" and v["reason"] and False) <= 47


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
    assert answer(make(tmp_path / "c", deck_edit=short, layouts=seq(LAYOUT_SEQ), pptx=None), "l_variety")["reason"] == "fewer than 5 presented slides"


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
    assert all(set(v) == {"id", "chosen", "fallback", "relaxed"} for v in rec["slides"].values())
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
    assert rec == {"id": name, "chosen": name, "fallback": False, "relaxed": True}


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
    assert diff["decks"]["d"]["metrics"] == [{"item": "m", "before": 0.5, "after": 0.75, "delta": 0.25, "direction": None, "worse": False, "lost": False}]
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


def test_baseline_matches_a_geometry_only_rebuild(rebuilt):
    base = json.loads((DECK_DIR / "bench" / "baseline" / "checklist.json").read_text())
    assert base["items_version"] == ITEMS["version"] and set(base["decks"]) == set(rebuilt["decks"]) == set(fx.FIXTURES)
    skip = {i["id"] for i in ITEMS["items"] if i.get("depends_on")}
    for d, b in base["decks"].items():
        assert set(b["results"]) == set(IDS) and b["inputs"]["qa_pixels"], d
        for i in IDS:
            if i not in skip:
                assert b["results"][i] == rebuilt["decks"][d]["results"][i], (d, i)


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


def test_variety_with_a_slide_missing_from_the_sidecar_is_na(tmp_path):
    lay = {"version": 1, "theme": "napkin", "slides": {f"s{i}": {"id": l, "chosen": l, "fallback": False, "relaxed": False}
                                                      for i, l in enumerate(LAYOUT_SEQ, 1) if i != 3}}
    assert answer(make(tmp_path, layouts=lay), "l_variety")["answer"] == "n/a"


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
                    "m_median_words": "lower", "m_creative_pictured": "higher"}
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
