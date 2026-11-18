"""deck-graphics slices 4-9 (features/deck-graphics.clan): charts drawn only from ledger values (one measure, one unit, a source line, never
a computed value, a hero / stat row / table otherwise), the diagrams (process chevrons, the equally spaced timeline, the 2x2 with both axes
sourced, the journey row) and the grid of points, their web twin, the checklist items, the report's reasons, and the recorded Lumen
graphics plan. Offline: no model, no network, no LibreOffice."""
from __future__ import annotations

import copy
import json
import re
from pathlib import Path

import pytest
from lxml import etree
from pptx import Presentation

from deck import assemble, graphics, inputs, layouts, render_pptx as R, render_web, spec
from deck.bench import checklist as cl
from deck.inputs import Inputs
from deck.refs import Resolver

HERE = Path(__file__).parent
FIX = HERE / "fixtures" / "lumen_water"
GOLDEN = HERE / "fixtures" / "graphics" / "golden_lumen_graphics.json"
FILES = {"a": "a_requirements.json", "b": "b_storyline.json", "c": "c_territories.json", "d": "d_idea.json"}


@pytest.fixture
def gr(monkeypatch):
    monkeypatch.setattr(spec, "LOOK_V3", True)
    monkeypatch.setattr(spec, "GRAPHICS", True)


def _facts(rows, key="share_aware", unit="proportion", title="Household survey"):
    return {f"f_{i}": {"id": f"f_{i}", "key": key, "value": v, "unit": unit, "entity": e, "sources": [{"title": title}]} for i, (e, v) in enumerate(rows)}


def _inp(facts=None, doc_facts=None, docs=None):
    i = Inputs(brief={})
    i.facts, i.doc_facts, i.docs = facts or {}, doc_facts or {}, docs or {}
    return i


def _chart(labels, refs=None, **kw):
    return {"type": "bar", "series": [{"label": lab, "ref": r} for lab, r in zip(labels, refs or [f"f_{i}" for i in range(len(labels))])], **kw}


# ================================================================================================ the ledger and the chart rule
def test_the_ledger_has_unit_and_no_measure_field_so_key_is_the_measure():
    """Slice 4's first task: a research fact is {id, version, status, entity, key, value, unit, as_of, sources}; a document figure is
    {value, unit, label, as_of, page}. Neither carries 'measure' or 'period': the measure is a fact's key, or the document a figure is from."""
    assert graphics._measure("f_1", {"key": "share_aware"}) == "share_aware"
    assert graphics._measure("doc:annual#p3", {"label": "x"}) == "doc:annual"
    assert graphics._measure("f_2", {}) is None


@pytest.mark.parametrize("rows,labels,form", [
    ([("North", 0.58), ("South", 0.47), ("East", 0.62)], ["North", "South", "East"], "bar"),
    ([("a", 1), ("b", 2), ("c", 3)], ["2023", "2024", "2025"], "column"),
    ([(str(i), i) for i in range(7)], [f"Q{q} 20{y}" for y in (24, 25) for q in (1, 2, 3, 4)][:7], "line"),
    ([("North", 0.58)], ["North"], "hero"),
    ([(str(i), i / 10) for i in range(9)], [f"Region {c}" for c in "ABCDEFGHI"], "table"),
])
def test_the_form_follows_the_data(rows, labels, form):
    inp = _inp(_facts(rows))
    got = graphics.chart_form(_chart(labels), inp, Resolver(inp))
    assert got["form"] == form, got


def test_mixed_units_or_measures_are_never_one_chart():
    f = _facts([("A", 0.5), ("B", 0.4)])
    f["f_1"]["unit"] = "count"
    inp = _inp(f)
    got = graphics.chart_form(_chart(["A", "B"]), inp, Resolver(inp))
    assert got["form"] == "stat_row" and "unlike" in got["why"]
    g = _facts([("A", 0.5), ("B", 0.4)])
    g["f_1"]["key"] = "share_trust"
    assert graphics.chart_form(_chart(["A", "B"]), _inp(g), Resolver(_inp(g)))["form"] == "stat_row"


def test_a_non_ledger_ref_or_a_missing_unit_is_not_charted():
    f = _facts([("A", 0.5), ("B", 0.4)])
    inp = _inp(f)
    got = graphics.chart_form(_chart(["A", "B"], ["f_0", "prompt:1"]), inp, Resolver(inp))
    assert got["form"] == "hero" and len(got["points"]) == 1   # only the ledger point survives, as a figure
    f["f_0"]["unit"] = ""
    got = graphics.chart_form(_chart(["A", "B"]), _inp(f), Resolver(_inp(f)))
    assert got["form"] == "stat_row" and "no unit" in got["why"]


def test_segmented_only_with_a_stated_whole():
    inp = _inp(_facts([("A", 0.5), ("B", 0.3), ("C", 0.2)]))
    assert graphics.chart_form({**_chart(["A", "B", "C"]), "type": "stack"}, inp, Resolver(inp))["form"] == "bar"
    assert graphics.chart_form({**_chart(["A", "B", "C"]), "type": "stack", "whole": "f_9"}, inp, Resolver(inp))["form"] == "segmented"


def test_the_source_line_is_built_from_the_ledger_or_there_is_no_chart():
    inp = _inp(_facts([("A", 0.5), ("B", 0.4)]))
    pts = graphics.chart_form(_chart(["A", "B"]), inp, Resolver(inp))["points"]
    assert graphics.source_line(pts, inp) == "Source: Household survey"
    for f in inp.facts.values():
        f["sources"] = []
    assert graphics.source_line(pts, inp) is None
    doc = _inp(doc_facts={"doc:annual#p3": {"value": 0.4, "unit": "proportion", "label": "a", "page": 3},
                          "doc:annual#p4": {"value": 0.5, "unit": "proportion", "label": "b", "page": 4}},
               docs={"annual": {"name": "Annual report", "text": "", "chars": 0}})
    dp = graphics.chart_form(_chart(["a", "b"], ["doc:annual#p3", "doc:annual#p4"]), doc, Resolver(doc))["points"]
    assert graphics.source_line(dp, doc) == "Source: Annual report, p. 3; Annual report, p. 4"
    many = [{"ref": f"f_{i}"} for i in range(4)]
    m = _inp({f"f_{i}": {"value": 1, "unit": "count", "key": "k", "sources": [{"title": f"S{i}"}]} for i in range(4)})
    assert graphics.source_line(many, m) == "Source: S0; S1 (+ 2 more in the appendix)"


def test_the_chart_pass_converts_and_adds_no_word():
    inp = _inp(_facts([("North", 0.58)]))
    slides = [{"title": "T", "blocks": [{"kind": "chart", "chart": _chart(["North"])}, {"kind": "text", "text": "x"}]}]
    recs = graphics.charts_pass(slides, inp, Resolver(inp))
    assert slides[0]["blocks"][0] == {"kind": "stats", "items": [{"value": "58%", "label": "North", "refs": ["f_0"]}], "refs": ["f_0"], "basis": "sourced"}
    assert recs[0]["form"] == "hero" and recs[0]["points"][0]["value"] == 58.0
    big = _inp(_facts([(c, i / 10) for i, c in enumerate("ABCDEFGHI")]))
    slides = [{"title": "T", "blocks": [{"kind": "chart", "chart": _chart(list("ABCDEFGHI"), title="Share aware")}]}]
    graphics.charts_pass(slides, big, Resolver(big))
    tb = slides[0]["blocks"][0]
    assert tb["kind"] == "table" and len(tb["rows"]) == 10 and [r[0] for r in tb["rows"][1:]] == list("ABCDEFGHI")   # every row, no 'Other'
    none = _inp()
    slides = [{"title": "T", "blocks": [{"kind": "chart", "chart": _chart(["A"], ["prompt:1"])}]}]
    assert graphics.charts_pass(slides, none, Resolver(none))[0]["form"] == "none" and slides[0]["blocks"] == []


def test_marks_take_the_accent_only_on_the_hero_and_pass_contrast():
    from deck import theme as T
    th = T.get_theme(T.DEFAULT, {})
    pts = [{"label": x} for x in ("A", "B", "C")]
    cols = graphics.chart_marks("bar", pts, ["B"], th)
    assert cols[1] != cols[0] == cols[2] and all(T.contrast(c, th.paper) >= 3 for c in cols)
    assert graphics.chart_marks("bar", pts, ["A", "B", "C"], th).count(cols[1]) == 2   # at most two picked out
    assert set(graphics.chart_marks("bar", pts, None, th)) == {th.ink}


# ================================================================================================ the deck
def _deck(inp=None, edit=None, fmt="pitch"):
    st = {k: json.loads((FIX / f).read_text()) for k, f in FILES.items() if (FIX / f).exists()}
    inp = inp or inputs.load(FIX / "brief_object.json")
    d = assemble.build(inp, st, client="Lumen Water", project="National awareness campaign", fmt=fmt)
    if edit:
        edit(d)
    planned, _, _ = layouts.plan(d, prefs={"density": "lean"})
    return planned, inp


def _by_type(d):
    return {d["slides"][s]["type"]: s for s in reversed(d["order"])}


def _render(d, inp, tmp_path, name="d.pptx"):
    r = R.Renderer(d, inp, theme="napkin")
    r.render(tmp_path / name)
    return r, Presentation(str(tmp_path / name))


def _chart_deck():
    inp = inputs.load(FIX / "brief_object.json")
    inp.facts = _facts([("North", 0.58), ("South", 0.47), ("East", 0.62), ("West", 0.4)])

    def edit(d):
        sid = _by_type(d)["measurement"]
        d["slides"][sid]["type"] = "chart"
        d["slides"][sid]["blocks"] = [{"kind": "chart", "chart": _chart(["North", "South", "East", "West"], hero=["East"])},
                                      {"kind": "text", "text": "East leads"}]
        d["meta"]["graphics"] = {"charts": graphics.charts_pass([d["slides"][sid]], inp, Resolver(inp))}
    return _deck(inp, edit, fmt="full")


def test_a_rendered_chart_holds_only_ledger_numbers_and_its_source(gr, tmp_path):
    d, inp = _chart_deck()
    sid = next(s for s in d["order"] if d["slides"][s]["type"] == "chart")
    assert d["slides"][sid]["layout"]["id"] in ("chart", "chart_full")
    r, prs = _render(d, inp, tmp_path)
    sl = prs.slides[d["order"].index(sid)]
    gf = next(sh for sh in sl.shapes if getattr(sh, "has_chart", False) and sh.has_chart)
    vals = sorted(float(v) for v in gf.chart.plots[0].series[0].values)
    assert vals == sorted([58.0, 47.0, 62.0, 40.0])   # the ledger's proportions in percent, nothing computed
    assert list(gf.chart.plots[0].categories) == ["West", "East", "South", "North"]   # a horizontal bar lists the first at the top
    assert gf.chart.value_axis.minimum_scale == 0 and not gf.chart.has_legend and not gf.chart.value_axis.has_major_gridlines
    src = next(sh for sh in sl.shapes if sh.name == "ChartSource")
    assert src.text_frame.text.replace("\xa0", " ") == "Source: Household survey"
    assert "North 58%" in gf._element.nvGraphicFramePr.cNvPr.get("descr")
    run = tmp_path / "run"
    run.mkdir()
    (run / "deck.json").write_text(json.dumps(d))
    (run / "deck.pptx").write_bytes((tmp_path / "d.pptx").read_bytes())
    res = cl.run_checklist(run)["results"]
    for i in ("c_chart_sourced", "c_chart_numbers", "c_chart_form", "c_chart_contrast"):
        assert res[i]["answer"] == "yes", (i, res[i])
    assert res["c_chart_emphasis"]["answer"] in ("yes", "n/a")   # n/a: no meta.theme outside a run
    bad = copy.deepcopy(d)
    bad["meta"]["graphics"]["charts"][0]["points"][0]["value"] = 99.0
    (run / "deck.json").write_text(json.dumps(bad))
    assert cl.run_checklist(run)["results"]["c_chart_numbers"]["answer"] == "no"


def test_the_plot_is_never_shrunk_under_its_floor(gr, tmp_path, monkeypatch):
    monkeypatch.setattr(graphics, "CHART_MIN_PLOT_IN", 20.0)
    d, inp = _chart_deck()
    sid = next(s for s in d["order"] if d["slides"][s]["type"] == "chart")
    assert d["slides"][sid]["layout"]["id"] not in ("chart", "chart_full")   # the ladder switched; the chart was never drawn small
    r, prs = _render(d, inp, tmp_path)
    assert not any(getattr(sh, "has_chart", False) and sh.has_chart for sh in prs.slides[d["order"].index(sid)].shapes)


def test_the_web_chart_is_svg_with_a_title_per_mark_and_a_data_table(gr, tmp_path):
    d, inp = _chart_deck()
    html = render_web.render(d, inp, tmp_path / "deck.html").read_text()
    fig = re.search(r'<figure class="g-chart".*?</figure>', html, re.S).group(0)
    assert fig.count("<title>") == 4 and "North: 58%" in fig and "<table>" in fig and "Source: Household survey" in fig


# ================================================================================================ diagrams
def _steps_deck(stype, items, extra=None):
    def edit(d):
        sid = _by_type(d)[stype]
        d["slides"][sid]["blocks"] = [{"kind": "steps", "items": items}] + (extra or [])
    return _deck(edit=edit, fmt="full")


@pytest.mark.parametrize("n,want", [(2, False), (3, True), (6, True), (7, False)])
def test_process_chevrons_take_three_to_six_steps(gr, n, want):
    d, _ = _steps_deck("process", [[f"Step {chr(65 + i)}", "Do the thing"] for i in range(n)])
    sid = _by_type(d)["process"]
    assert (d["slides"][sid]["layout"]["id"] == "process_chevrons") is want


def test_chevrons_draw_the_blocks_own_words_once(gr, tmp_path):
    d, inp = _steps_deck("process", [["Listen", "Read the meter data"], ["Shape", "Write the frame"], ["Make", "Produce the posters"]])
    sid = _by_type(d)["process"]
    r, prs = _render(d, inp, tmp_path)
    sl = prs.slides[d["order"].index(sid)]
    assert sum(1 for sh in sl.shapes if sh.name == "Diagram: process") == 3
    texts = [sh.text_frame.text.replace("\xa0", " ") for sh in sl.shapes if sh.name == "slot:steps"]
    assert sorted(texts) == sorted(["Listen", "Read the meter data", "Shape", "Write the frame", "Make", "Produce the posters"])   # each once
    run = tmp_path / "run"
    run.mkdir()
    (run / "deck.json").write_text(json.dumps(d))
    (run / "deck.pptx").write_bytes((tmp_path / "d.pptx").read_bytes())
    res = cl.run_checklist(run)["results"]
    assert res["d_own_words"]["answer"] == "yes" and res["d_min_items"]["answer"] == "yes"
    for shp in sl.shapes:
        if shp.name == "slot:steps" and shp.text_frame.text == "Listen":
            shp.text_frame.text = "Invented"
    prs.save(str(run / "deck.pptx"))
    assert cl.run_checklist(run)["results"]["d_own_words"]["answer"] == "no"


def test_the_timeline_is_equally_spaced(gr, tmp_path):
    d, inp = _steps_deck("timeline", [["Plan", "Month 1"], ["Make", "Before launch"], ["Run", "Launch"], ["Evaluate", "After launch"]])
    sid = _by_type(d)["timeline"]
    assert d["slides"][sid]["layout"]["id"] == "timeline_strip"
    r, prs = _render(d, inp, tmp_path)
    nodes = [sh for sh in prs.slides[d["order"].index(sid)].shapes if sh.name == "Diagram: timeline" and sh.shape_type == 1]
    xs = [n.left for n in nodes]
    gaps = {round((b - a) / 9144) for a, b in zip(xs, xs[1:])}
    assert len(nodes) == 4 and len(gaps) == 1   # the same gap between every node: dates are never plotted to scale


def test_a_2x2_needs_both_axes_sourced(gr):
    m = {"x": {"label": "Price", "low": "Low", "high": "High", "refs": ["brief:objectives"]}, "y": {"label": "Reach", "low": "Low", "high": "High", "refs": []},
         "cells": {"hh": ["Brand A"], "ll": ["Brand B"]}}
    assert not graphics.matrix_ok({"kind": "table", "matrix": m})
    m["y"]["refs"] = ["brief:objectives"]
    assert graphics.matrix_ok({"kind": "table", "matrix": m})
    m["cells"]["middle"] = ["x"]
    assert not graphics.matrix_ok({"kind": "table", "matrix": m})


def test_journey_row_and_grid_points_are_picked_and_carry_icons(gr, tmp_path):
    def edit(d):
        b = _by_type(d)
        d["slides"][b["audience"]]["blocks"] = [{"kind": "steps", "items": [["Notice", "A poster at the stop", "Outdoor"], ["Hear", "A spot on the way home", "Radio"],
                                                                             ["Act", "A note at the tap", "Social"]]}]
        d["slides"][b["audience"]]["slots"] = {}
        d["slides"][b["insight"]]["blocks"] = [{"kind": "kv", "items": [["Audience", "Adults"], ["Budget", "Held flat"], ["Timing", "Spring"], ["Partners", "Councils"]]}]
    d, inp = _deck(edit=edit, fmt="full")
    b = _by_type(d)
    assert d["slides"][b["audience"]]["layout"]["id"] == "journey_row" and d["slides"][b["insight"]]["layout"]["id"] == "grid_points"
    r, prs = _render(d, inp, tmp_path)
    assert r.icons_drawn[b["audience"]]["ids"] == ["signpost-big", "radio", "share-2"]
    assert r.icons_drawn[b["insight"]]["ids"] == ["users", "wallet", "calendar", "handshake"]
    html = render_web.render(d, inp, tmp_path / "deck.html", icons=r.icons_drawn).read_text()
    assert "g-jr" in html and "g-grid" in html and html.count('data-icon="') == 7


def test_flag_off_has_no_diagram_layout(monkeypatch):
    monkeypatch.setattr(spec, "LOOK_V3", True)
    lib = layouts.load()
    assert not set(spec.LAYOUT_IDS_GRAPHICS) & set(lib) and len(lib) == 42
    monkeypatch.setattr(spec, "GRAPHICS", True)
    on = layouts.load()
    assert set(spec.LAYOUT_IDS_GRAPHICS) <= set(on) and len(on) == 46 <= spec.LAYOUT_MAX


def test_a_three_cell_step_never_breaks_the_old_looks(tmp_path):
    def edit(d):
        d["slides"][_by_type(d)["process"]]["blocks"] = [{"kind": "steps", "items": [["Notice", "A poster", "Outdoor"]]}]
    d, inp = _deck(edit=edit, fmt="full")
    _render(d, inp, tmp_path)


# ================================================================================================ the report and the recorded plan
def test_lumen_says_why_it_has_no_chart_and_no_diagram(gr):
    d, _ = _deck(fmt="full")
    rep = graphics.report(d)
    assert rep["charts"][0]["chart"] is None and "no chart" in rep["charts"][0]["why"]
    assert rep["diagrams"] == [] and {m["why"] for m in rep["diagram_misses"]} == {"no diagram: 1 step, needs 3"}


def _graphics_plan(d, r) -> dict:
    return {sid: {"layout": r.layouts[sid], "icons": (r.icons_drawn.get(sid) or {}).get("ids", [])} for sid in d["order"]}


def test_the_lumen_graphics_plan_matches_its_recording(gr, tmp_path):
    """The golden re-record with DECK_GRAPHICS on (slice 9): Lumen's layouts and icons under LOOK_V3 + GRAPHICS, recorded once in
    fixtures/graphics/golden_lumen_graphics.json. With the flag off every existing golden is unchanged (their own tests)."""
    d, inp = _deck()
    r, _ = _render(d, inp, tmp_path)
    assert _graphics_plan(d, r) == json.loads(GOLDEN.read_text())["plan"]
