"""deck-look steps 3-4 (spec.LOOK_V3) and the contrast fix of steps 1-2: the statement layouts (statement_points, reframe, shift_line), the
picture column, the reworked cover and close, the planner's role map, the hole gate (q_no_hole) and the web twin. Offline: no model, no
LibreOffice. With the flag off nothing here changes a golden (test_render_parity and the goldens hold that)."""
from __future__ import annotations

import copy
import json
import re
from collections import Counter
from pathlib import Path

import pytest
from PIL import Image
from pptx import Presentation

from deck import assemble, inputs, layouts, qa_render, render_pptx as R, render_web, run_deck, spec, validate
from deck import theme as T
from deck.inputs import Inputs

HERE = Path(__file__).parent
FIX = HERE / "fixtures" / "lumen_water"
FONTS = Path(R.__file__).resolve().parent / "fonts"
FILES = {"a": "a_requirements.json", "b": "b_storyline.json", "c": "c_territories.json", "d": "d_idea.json"}
EMU = 914400


@pytest.fixture
def v3(monkeypatch):
    monkeypatch.setattr(spec, "LOOK_V3", True)


def _st() -> dict:
    return {k: json.loads((FIX / f).read_text()) for k, f in FILES.items() if (FIX / f).exists()}


def _inp():
    return inputs.load(FIX / "brief_object.json")


def _deck() -> dict:
    """The Lumen Water pitch as assemble builds it (under whatever spec.LOOK_V3 is now), planned at the pitch's lean density."""
    d = assemble.build(_inp(), _st(), client="Lumen Water", project="National awareness campaign", fmt="pitch")
    planned, _, _ = layouts.plan(d, prefs={"density": "lean"})
    return planned


def _by_type(d: dict) -> dict:
    return {d["slides"][sid]["type"]: sid for sid in reversed(d["order"])}


def _render(d: dict, tmp_path, name="d.pptx", pictures=None, drawn=None):
    r = R.Renderer(d, Inputs(brief={}), theme="napkin")
    if pictures:
        r.pictures, r.drawn = pictures, drawn
    out = tmp_path / name
    r.render(out)
    return r, Presentation(str(out))


def _slide_of(r, prs, sid):
    return prs.slides[r.deck["order"].index(sid)]


def _runs(sl):
    return [run for sh in sl.shapes if sh.has_text_frame for p in sh.text_frame.paragraphs for run in p.runs if run.text.strip()]


def _jpeg(tmp_path, name="p.jpg", size=(800, 600), colour=(90, 120, 140)):
    p = tmp_path / name
    Image.new("RGB", size, colour).save(p, "JPEG")
    return p


# ================================================================================================ the contrast fix (steps 1-2)
def test_every_text_run_passes_aa_under_v3(v3, tmp_path):
    """Every text colour on its ground in a LOOK_V3 render passes WCAG AA (4.5:1, 3:1 for large text): the new layouts and the old."""
    r, prs = _render(_deck(), tmp_path)
    runs = [x for sl in prs.slides for x in qa_render.text_contrasts(sl)]
    assert len(runs) > 150
    bad = [x for x in runs if x["ratio"] < x["need"]]
    assert not bad, bad[:5]
    # the secondary text the phase-12 render showed faint is in the set, on the paper, at AA
    mute = [x for x in runs if x["fg"] == r.th.mute]
    assert mute and all(x["bg"] == r.th.paper and x["ratio"] >= 4.5 for x in mute if x["bg"] == r.th.paper)


def test_the_contrast_check_is_not_vacuous(tmp_path):
    """A faint run (the dark slide's muted text on paper) is caught."""
    from pptx.util import Inches, Pt
    from pptx.dml.color import RGBColor
    prs = Presentation()
    sl = prs.slides.add_slide(prs.slide_layouts[6])
    sl.background.fill.solid()
    sl.background.fill.fore_color.rgb = RGBColor.from_string("FAF7F1")
    tb = sl.shapes.add_textbox(Inches(1), Inches(1), Inches(4), Inches(1))
    run = tb.text_frame.paragraphs[0].add_run()
    run.text, run.font.size = "in 12 months", Pt(18 - 4)
    run.font.color.rgb = RGBColor.from_string("C9C2B2")
    got = qa_render.text_contrasts(sl)
    assert got and got[0]["ratio"] < got[0]["need"] == 4.5


def test_the_pdf_fonts_are_static_faces_at_regular_and_bold():
    """The cause of the faint text: LibreOffice (and PowerPoint) draw a variable font at its default instance, and Source Sans 3's is
    ExtraLight (wght 200). The faces the renders use are the upstream static files: regular 400, bold 700, italic, never a variable font."""
    tt = pytest.importorskip("fontTools.ttLib")
    seen = {}
    for f in sorted(FONTS.glob("*/static/*.ttf")):
        font = tt.TTFont(str(f))
        assert "fvar" not in font, f.name
        fam, sub, w = font["name"].getDebugName(1), font["name"].getDebugName(2), font["OS/2"].usWeightClass
        assert w in (400, 700), (f.name, w)
        seen.setdefault(fam, set()).add(sub)
    assert seen == {T.LOOK_HEAD: {"Regular", "Bold", "Italic", "Bold Italic"}, T.LOOK_BODY: {"Regular", "Bold", "Italic", "Bold Italic"}}
    vf = tt.TTFont(str(FONTS / "SourceSans3" / "SourceSans3[wght].ttf"))
    assert next(a for a in vf["fvar"].axes if a.axisTag == "wght").defaultValue == 200   # why the variable file must never reach LibreOffice


def test_libreoffice_is_given_only_the_static_faces(tmp_path):
    run_deck._load_vendored_fonts(str(tmp_path))
    got = sorted(p.name for p in (tmp_path / "user" / "fonts").iterdir())
    assert "SourceSans3-Regular.ttf" in got and "Archivo-Bold.ttf" in got
    assert not any("[" in n for n in got), got


def test_the_illustrative_tag_stays_legible(v3, tmp_path):
    """The picture label: white bold text on an ink pill (well over AA), at the caption floor or above, inside its picture and clear of the
    slide edge on a bleeding picture column."""
    d = _deck()
    sid = _by_type(d)["audience"]
    s = d["slides"][sid]
    s["layout"] = {"id": "picture_column", "blocks_sha": spec.blocks_sha(s), "fit": {"moved": []}}
    pic = _jpeg(tmp_path)
    r, prs = _render(d, tmp_path, pictures={"a1": pic}, drawn={(sid, "picture"): {"asset": "a1", "aspect": "4:3", "status": "drafted", "alt": "x"}})
    sl = _slide_of(r, prs, sid)
    pill = next(sh for sh in sl.shapes if sh.name == "PictureLabel")
    cap = next(sh for sh in sl.shapes if sh.name == "Caption" and sh.text_frame.text == spec.PICTURE_LABEL)
    run = cap.text_frame.paragraphs[0].runs[0]
    assert str(pill.fill.fore_color.rgb) == "1B2430" and str(run.font.color.rgb) == "FFFFFF" and run.font.bold and run.font.size.pt >= 10
    assert T.contrast("FFFFFF", "1B2430") >= 4.5
    p = next(sh for sh in sl.shapes if sh.name == "Picture")
    assert p.left <= pill.left and pill.left + pill.width <= p.left + p.width and pill.top + pill.height <= p.top + p.height
    W, H = prs.slide_width, prs.slide_height
    assert min(pill.left, W - pill.left - pill.width, H - pill.top - pill.height) >= 0.5 * EMU - 1


# ================================================================================================ the library under the flag
def test_the_new_layouts_exist_only_under_the_flag(monkeypatch):
    off = layouts.load()
    assert len(off) == 36 and not set(spec.LAYOUT_IDS_V3) & set(off) and not off["close"].get("human_rows")
    monkeypatch.setattr(spec, "LOOK_V3", True)
    on = layouts.load()
    assert len(on) == 40 <= spec.LAYOUT_MAX and set(spec.LAYOUT_IDS_V3) <= set(on)
    assert on["close"]["human_rows"] and on["close"]["version"] == 2 and "investment" in on["close"]["for_types"]
    for lid in spec.LAYOUT_IDS_V3:
        lay = on[lid]
        assert lid in R.Renderer.LAYOUT_FN and hasattr(R.Renderer, R.Renderer.LAYOUT_FN[lid])
        assert all(a in on for a in lay.get("alternatives", []))
        assert sum(1 for x in lay["slots"].values() if x.get("dominant")) <= 1 and "title" in lay["slots"]
        if any(x["kind"] == "image" and x.get("required") for x in lay["slots"].values()):
            assert lay.get("without_image") in on


@pytest.mark.parametrize("blocks,ok", [
    ([{"kind": "bullets", "items": [{"text": "a"}]}], False),                                     # one point: never padded
    ([{"kind": "bullets", "items": [{"text": "a"}, {"text": "b"}]}], True),
    ([{"kind": "bullets", "items": [{"text": "a"}]}, {"kind": "kv", "items": [["K", "b"]]}, {"kind": "text", "text": "c"}], True),
    ([{"kind": "bullets", "items": [{"text": x} for x in "abcd"]}], False),                      # four: another layout
    ([{"kind": "bullets", "items": [{"text": "a"}, {"text": "b"}]}, {"kind": "table", "rows": [["a"]]}], False),
    ([{"kind": "quote", "text": "q"}, {"kind": "small", "text": spec.ILLUSTRATIVE_QUOTE, "basis": "meta"}, {"kind": "text", "text": "t"}], True),
    ([{"kind": "text", "text": "a"}, {"kind": "text", "text": ""}, {"kind": "small", "text": ""}], False),   # empty blocks are not points
])
def test_points_2_3(blocks, ok):
    assert layouts.points_2_3({"type": "objective"}, blocks) is ok


def test_the_quote_label_is_the_quotes_caption_not_a_point():
    pts = layouts.statement_points([{"kind": "quote", "text": "q"}, {"kind": "small", "text": spec.ILLUSTRATIVE_QUOTE, "basis": "meta"},
                                    {"kind": "kv", "items": [["Head", "body"]]}])
    assert [(p["heading"], p["text"], p["italic"], p["caption"]) for p in pts] == [("", "q", True, spec.ILLUSTRATIVE_QUOTE), ("Head", "body", False, "")]


def test_the_planner_maps_the_lumen_roles(v3):
    d = _deck()
    ids = {d["slides"][sid]["type"]: d["slides"][sid]["layout"]["id"] for sid in d["order"]}
    assert ids["objective"] == "statement_points" and ids["real_question"] == "reframe" and ids["insight"] == "statement_points"
    assert ids["audience"] == "statement_points"   # no picture in this fixture: its points; with a picture, the picture column
    assert ids["proposition"] == "shift_line" and ids["investment"] == "close"


def test_flag_off_keeps_the_old_map():
    d = _deck()
    ids = {d["slides"][sid]["type"]: d["slides"][sid]["layout"]["id"] for sid in d["order"]}
    assert ids["objective"] == "objective_panel" and ids["real_question"] == "emphasis_bar" and ids["proposition"] == "comparison"
    assert not set(spec.LAYOUT_IDS_V3) & set(ids.values())


def test_an_objective_with_one_point_takes_another_layout(v3):
    d = assemble.build(_inp(), _st(), client="Lumen Water", project="National awareness campaign", fmt="pitch")
    s = d["slides"][_by_type(d)["objective"]]
    bl = next(b for b in s["blocks"] if b["kind"] == "bullets")
    bl["items"] = bl["items"][:1]
    assert layouts.pick(s) == "objective_panel"


# ================================================================================================ the brief fields, said once
def _all_text(d: dict) -> str:
    return " ".join(spec.norm_text(x) for sid in d["order"] for x in [d["slides"][sid]["title"]] + layouts.slide_words(d["slides"][sid]).split("\n"))


def test_three_brief_fields_each_get_one_home(v3):
    d = assemble.build(_inp(), _st(), client="Lumen Water", project="National awareness campaign", fmt="pitch")
    b = json.loads((FIX / "brief_object.json").read_text())["loop2_golden"]["fields"]
    homes = {"objective": (b["objectives"]["value"]["attitudinal"], "brief:objectives.attitudinal"),
             "real_question": (b["background"]["value"], "brief:background"), "audience": (b["desired_response"]["value"], "brief:desired_response")}
    for typ, (text, ref) in homes.items():
        hits = [sid for sid in d["order"] if any(text in json.dumps(bl) for bl in d["slides"][sid]["blocks"])]
        assert hits == [_by_type(d)[typ]], (typ, hits)
        bl = next(bl for bl in d["slides"][hits[0]]["blocks"] if text in json.dumps(bl))
        assert ref in json.dumps(bl)


def test_a_field_already_said_is_not_added_again(v3):
    inp = _inp()
    st = _st()
    st["b"] = copy.deepcopy(st["b"])
    st["b"]["reframe"]["line"] = inp.brief["background"]["value"]   # the reframe's own line already says the background
    d = assemble.build(inp, st, client="Lumen Water", project="National awareness campaign", fmt="pitch")
    rq = d["slides"][_by_type(d)["real_question"]]
    assert not any(bl["kind"] == "kv" for bl in rq["blocks"])


def test_no_sentence_is_said_twice_under_v3(monkeypatch):
    count = lambda fs: sum(1 for f in fs if f["check"] == "repeated_line")
    base = count(validate.run(_deck(), _inp()))
    monkeypatch.setattr(spec, "LOOK_V3", True)
    assert count(validate.run(_deck(), _inp())) == base


def test_no_word_of_the_old_look_is_lost(tmp_path, monkeypatch):
    """Every word the deck showed before (slides and notes) is still in the v3 deck's slides or notes: the new layouts only add the three
    brief fields, the kickers and the band."""
    _, before = _render(_deck(), tmp_path, "a.pptx")
    monkeypatch.setattr(spec, "LOOK_V3", True)
    _, after = _render(_deck(), tmp_path, "b.pptx")
    words = lambda prs: Counter(w for sl in prs.slides for w in re.findall(r"[a-z0-9%€]+", (" ".join(
        sh.text_frame.text for sh in sl.shapes if sh.has_text_frame) + " " + sl.notes_slide.notes_text_frame.text).lower()))
    lost = words(before) - words(after)
    lost -= Counter({k: v for k, v in lost.items() if k in ("proposed",)})   # the placeholder card's PROPOSED tag (an engine mark): the close's dashed rows say To supply, and the words themselves begin 'Proposed (not given by the client)'

    section = Counter(w for sl in before.slides for sh in sl.shapes if sh.name == "Section" for w in re.findall(r"[a-z0-9%€]+", sh.text_frame.text.lower()))
    assert not (lost - section), dict(lost - section)


# ================================================================================================ drawing the layouts
@pytest.fixture
def lumen_v3(v3, tmp_path):
    d = _deck()
    r, prs = _render(d, tmp_path)
    return d, r, prs


def _texts(sl):
    return {sh.name: sh for sh in sl.shapes}


def test_statement_points_draws_the_figure_in_ink_and_two_points(lumen_v3):
    d, r, prs = lumen_v3
    sl = _slide_of(r, prs, _by_type(d)["objective"])
    assert r.layouts[_by_type(d)["objective"]] == "statement_points"
    fig = [run for sh in sl.shapes if sh.name == "slot:figure" for p in sh.text_frame.paragraphs for run in p.runs]
    assert any(run.text == "5%" and str(run.font.color.rgb) == r.th.ink and run.font.size.pt >= 60 for run in fig)   # big numbers in ink
    pts = [sh for sh in sl.shapes if sh.name == "slot:points"]
    assert len(pts) == 2 and "People see water as worth looking after" in pts[1].text_frame.text.replace("\xa0", " ")
    title = next(sh for sh in sl.shapes if sh.name == "Title")
    assert title.left + title.width < pts[0].left   # the title in the left column, the points to its right
    rules = [sh for sh in sl.shapes if sh.name == "Hairline"]
    assert len(rules) >= 4   # the frame, its column rule and the hairline between the points


def test_reframe_draws_a_hero_line_and_a_notes_row(lumen_v3):
    d, r, prs = lumen_v3
    sid = _by_type(d)["real_question"]
    sl = _slide_of(r, prs, sid)
    title = next(sh for sh in sl.shapes if sh.name == "Title")
    run = title.text_frame.paragraphs[0].runs[0]
    assert run.font.size.pt >= 36 and run._r.get_or_add_rPr().get("cap") is None   # 55 characters: sentence case (caps only up to ~40)
    assert run._r.get_or_add_rPr().get("spc") is None   # normal letter spacing
    row = next(sh for sh in sl.shapes if sh.name == "slot:notes_row")
    assert row.text_frame.paragraphs[0].runs[0].text == "Background" and row.top > title.top + title.height


def test_shift_line_draws_two_stops_and_caps_only_short_lines(lumen_v3):
    d, r, prs = lumen_v3
    sl = _slide_of(r, prs, _by_type(d)["proposition"])
    s = _texts(sl)
    assert str(s["StopTo"].fill.fore_color.rgb) == r.th.accent and str(s["StopFrom"].line.color.rgb) == r.th.ink
    assert s["StopFrom"].left < s["StopTo"].left and abs(s["StopFrom"].top - s["StopTo"].top) < 100
    hero = s["Title"].text_frame.paragraphs[0].runs[0]
    assert hero.text == "Every drop has a story." and hero._r.get_or_add_rPr().get("cap") == "all" and hero._r.get_or_add_rPr().get("spc") is None
    pair = [run for sh in sl.shapes if sh.name == "slot:pair" for p in sh.text_frame.paragraphs for run in p.runs]
    frm = next(run for run in pair if run.text == "Water is a bill")
    assert str(frm.font.color.rgb) == r.th.mute and frm._r.get_or_add_rPr().get("cap") == "all"
    to = next(run for run in pair if run.text.startswith("Water is something"))
    assert to._r.get_or_add_rPr().get("cap") is None   # two lines in capitals would not fit: sentence case
    assert "Why they will believe it" in next(sh for sh in sl.shapes if sh.name == "slot:rtb").text_frame.text


def test_close_reworked_keeps_every_heading_and_dashes_what_a_person_supplies(lumen_v3):
    d, r, prs = lumen_v3
    sid = _by_type(d)["investment"]
    assert r.layouts[sid] == "close"
    sl = _slide_of(r, prs, sid)
    nxt = [sh for sh in sl.shapes if sh.name == "slot:next"]
    dashed = [sh for sh in nxt if not sh.has_text_frame or not sh.text_frame.text.strip()]
    texts = " ".join(sh.text_frame.text for sh in nxt if sh.has_text_frame)
    assert "What we would like to agree today" in texts and texts.count("To supply") == len(dashed) == 3
    stat = [run for sh in sl.shapes if sh.name == "slot:statement" for p in sh.text_frame.paragraphs for run in p.runs]
    assert any("120,000" in run.text and str(run.font.color.rgb) == r.th.ink for run in stat)


def test_v3_slides_never_grow_and_never_overlap(lumen_v3, tmp_path):
    d, r, prs = lumen_v3
    W, H = prs.slide_width, prs.slide_height
    new = {i + 1 for i, sid in enumerate(d["order"]) if r.layouts[sid] in spec.LAYOUT_IDS_V3 + ("close", "cover")}
    assert len(new) >= 6
    for n in new:
        for sh in prs.slides[n - 1].shapes:
            assert sh.left >= -9144 and sh.top >= -9144 and sh.left + sh.width <= W + 9144 and sh.top + sh.height <= H + 9144, (n, sh.name)
    out = tmp_path / "d.pptx"
    prs.save(out)
    qa = qa_render.check_pptx(out)
    bad = [(n, f) for n, fs in qa["slides"].items() if n.isdigit() and int(n) in new for f in fs
           if f["check"] in ("off_slide", "text_overlap", "text_overflow", "min_font", "margin")]
    assert not bad, bad


def test_the_band_never_repeats_the_title_on_the_new_layouts(lumen_v3):
    d, r, prs = lumen_v3
    norm = lambda t: re.sub(r"\W+", " ", t).strip().lower()
    for sid in d["order"]:
        if r.layouts[sid] in spec.LAYOUT_IDS_V3:
            sl = _slide_of(r, prs, sid)
            band = next(sh for sh in sl.shapes if sh.name == "Band").text_frame.text
            assert band and norm(band) != norm(d["slides"][sid]["title"])


def test_a_layout_needing_more_points_than_exist_is_not_drawn(v3):
    r = R.Renderer(_deck(), Inputs(brief={}), theme="napkin")
    s = {"type": "objective", "title": "What has to change", "blocks": [{"kind": "bullets", "items": [{"text": "Cut use by 5% in 12 months"}]}]}
    assert not r.probe(s, "statement_points")["ok"]
    s["blocks"][0]["items"].append({"text": "People see water as worth looking after"})
    assert r.probe(s, "statement_points")["ok"]


def test_the_fit_ladder_shrinks_then_switches_never_grows(v3):
    d = assemble.build(_inp(), _st(), client="Lumen Water", project="National awareness campaign", fmt="pitch")
    s = d["slides"][_by_type(d)["objective"]]
    long = "Cut household water use by 5% in 12 months across every district the utility serves, " * 6
    s["blocks"] = [{"kind": "bullets", "items": [{"text": long.strip()}, {"text": long.strip()}, {"text": long.strip()}]}]
    planned, _, _ = layouts.plan(d, prefs={"density": "detailed"})
    lay = planned["slides"][_by_type(d)["objective"]]["layout"]
    assert lay["id"] != "statement_points" or lay["fit"]["rung"] in ("shrunk", "no_fit")


def test_picture_columns_alternate_sides_and_keep_the_footer_on_the_text_side(v3, tmp_path):
    d = _deck()
    t = _by_type(d)
    pic = _jpeg(tmp_path)
    drawn = {}
    for typ in ("audience", "idea"):
        sid = t[typ]
        s = d["slides"][sid]
        s["layout"] = {"id": "picture_column", "blocks_sha": spec.blocks_sha(s), "fit": {"moved": []}}
        drawn[(sid, "picture")] = {"asset": "a1", "aspect": "4:3", "status": "drafted", "alt": "x"}
    assert layouts.picture_sides(d) == {t["audience"]: "left", t["idea"]: "right"}
    r, prs = _render(d, tmp_path, pictures={"a1": pic}, drawn=drawn)
    W = prs.slide_width
    for typ, side in (("audience", "left"), ("idea", "right")):
        sl = _slide_of(r, prs, t[typ])
        p = next(sh for sh in sl.shapes if sh.name == "Picture")
        assert p.height == prs.slide_height and (p.left == 0 if side == "left" else abs(p.left + p.width - W) < 9144)
        num = next(sh for sh in sl.shapes if sh.name == "SlideNumber")
        band = next(sh for sh in sl.shapes if sh.name == "Band")
        for sh in (num, band, next(sh for sh in sl.shapes if sh.name == "Title")):
            assert sh.left >= p.left + p.width or sh.left + sh.width <= p.left, (typ, sh.name)


# ================================================================================================ the hole gate
def _canvas(cells):
    """A 400 x 225 paper page with ink rectangles (x0, y0, x1, y1 as shares of the page)."""
    w, h = 400, 225
    im = Image.new("RGB", (w, h), (250, 247, 241))
    for x0, y0, x1, y1 in cells:
        im.paste((27, 36, 48), (int(x0 * w), int(y0 * h), int(x1 * w), int(y1 * h)))
    return w, h, im.tobytes()


def test_largest_empty_rect_on_known_pages():
    full = qa_render.largest_empty_rect(*_canvas([]))
    assert full == pytest.approx(90 * 47 / (96 * 54), abs=1e-3)   # the measured band: 3-97% x, 3-90% y
    stripes = [(x / 96, 0, x / 96 + 0.004, 1) for x in range(0, 96, 2)] + [(0, y / 54, 1, y / 54 + 0.007) for y in range(0, 54, 2)]
    assert qa_render.largest_empty_rect(*_canvas(stripes)) < 0.002   # ink in every few cells: no hole
    half = qa_render.largest_empty_rect(*_canvas([(0, 0, 0.5, 1)]))
    assert half == pytest.approx(full / 2, abs=0.03)
    # a full-width line at mid height leaves the larger half above or below it
    split = qa_render.largest_empty_rect(*_canvas([(0, 0.48, 1, 0.5)]))
    assert split < full * 0.6


def test_hole_findings_follow_the_design_record():
    assert (spec.HOLE_GATE, spec.HOLE_ADVISORY) == (0.20, 0.12)
    assert qa_render.hole_findings(0.06) == []
    assert "advisory above 12%" in qa_render.hole_findings(0.15)[0]["message"]
    f = qa_render.hole_findings(0.25)[0]
    assert f["check"] == "q_no_hole" and f["level"] == "warn" and "gate 20%" in f["message"]


def test_the_qa_measures_holes_only_under_the_flag(tmp_path, monkeypatch):
    r, prs = _render(_deck(), tmp_path)
    pptx = tmp_path / "d.pptx"
    pdf = tmp_path / "d.pdf"
    pdf.write_bytes(b"%PDF")
    n = sum(1 for sl in prs.slides if sl._element.get("show") != "0")

    def fake(pdf_, work, dpi=30):
        out = []
        for i in range(n):
            w, h, px = _canvas([] if i == 0 else [(0.1, 0.1, 0.9, 0.85)])
            p = work / f"p-{i + 1:02d}.ppm"
            p.write_bytes(b"P6\n%d %d\n255\n" % (w, h) + px)
            out.append(p)
        return out
    monkeypatch.setattr(qa_render, "render_ppm", fake)
    off = qa_render.check_pptx(pptx, pdf)
    assert "holes" not in off["summary"] and not any("hole" in v for v in off["pixels"].values())
    monkeypatch.setattr(spec, "LOOK_V3", True)
    on = qa_render.check_pptx(pptx, pdf)
    assert on["summary"]["holes"]["max"] > 0.7 and on["summary"]["holes"]["over_gate"] == 1
    assert any(f["check"] == "q_no_hole" for f in on["slides"]["1"])


# ================================================================================================ the web twin
def test_the_web_deck_draws_the_same_layouts(v3, tmp_path):
    d = _deck()
    out = tmp_path / "deck.html"
    render_web.render(d, Inputs(brief={}), out)
    html = out.read_text()
    secs = dict(re.findall(r'<section class="slide[^"]*" id="(s\d+)"[^>]*?data-layout="(\w+)"', html))
    for sid in d["order"]:
        assert secs.get(sid) == d["slides"][sid]["layout"]["id"], sid
    cls = {"statement_points": "v3sp", "reframe": "v3rf", "shift_line": "v3sl", "close": "v3cl"}
    for sid, lid in secs.items():
        if lid in cls:
            sec = re.search(rf'id="{sid}".*?</section>', html, flags=re.S).group(0)
            assert f'class="body v3 {cls[lid]}' in sec and "<h1" in sec.split('class="body v3')[1], (sid, lid)
            if lid != "close":
                assert '<div class="band">' in sec
    prop = re.search(rf'id="{_by_type(d)["proposition"]}".*?</section>', html, flags=re.S).group(0)
    assert "title hero caps" in prop and 'stops"' in prop
    assert "From" in prop and "Why they will believe it" in prop
    assert ".v3sp{" in html and ".pics.col{" in html


def test_web_picture_column_side_and_markup(v3):
    s = {"type": "audience", "title": "Households who never think about the tap",
         "blocks": [{"kind": "text", "text": "Adults 25 to 54."}, {"kind": "kv", "items": [["What we want them to do", "Make a small change."]]}]}
    b = render_web._Slide(Inputs(brief={}))
    body = render_web._v3_body(s, b, s["blocks"], "picture_column", {"meta": {}})
    assert 'class="body v3 v3pc"' in body and "caps" not in body.split("</h1>")[0] and "What we want them to do" in body
    d = {"order": ["a", "b", "c"], "slides": {k: {"layout": {"id": lid}} for k, lid in (("a", "picture_column"), ("b", "cards"), ("c", "picture_column"))}}
    assert render_web._pic_sides(d) == {"a": "left", "c": "right"}
