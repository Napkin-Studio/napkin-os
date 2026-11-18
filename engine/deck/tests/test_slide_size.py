"""deck-slide-size (features/deck-slide-size.clan): the slide size, 16:9 (default), 4:3 or A4 landscape.

Offline: no model, no network, no LibreOffice. The reflow rule (theme.Canvas), the 16:9 identity, the plan at a size (Fable's four
blocking fixes: the detailed notes rung, size-aware limits that never ask for a paid shorten, per-layout minimums and not_at, plan and
draw at one width), pictures (slot aspect, re-crop), the web stage, the asking side (CLI, document, master, recipe, intake card, server)
and the bench's one-size-per-checklist rule.
"""
from __future__ import annotations

import copy
import json
from pathlib import Path
from types import SimpleNamespace

import pytest
from pptx import Presentation
from pptx.util import Emu

from deck import images, imagegen, intake, layouts, profiles, render_hyperframes, render_pptx as R, render_web, repair, run_deck, server, spec
from deck import theme as T
from deck.bench import compare as bench_compare
from deck.inputs import Inputs

FIX = Path(__file__).parent / "fixtures" / "lumen_water"
SIZES = ("16:9", "4:3", "a4")


def _golden(size: str | None = None) -> dict:
    d = json.loads((FIX / "golden_deck.json").read_text())
    if size:
        d["meta"].setdefault("preferences", {})["size"] = {"canvas": size, "source": "person"}
    return d


def _plan(size: str | None, density: str = "detailed", **prefs) -> tuple:
    return layouts.plan(_golden(size), prefs={"density": density, **prefs})


def _render(deck: dict, tmp_path: Path, name: str = "d.pptx") -> tuple:
    out = tmp_path / name
    r = R.Renderer(deck, Inputs(brief={}))
    r.render(out, tmp_path / (name + ".layouts.json"))
    return r, Presentation(str(out))


@pytest.fixture(scope="module")
def planned(tmp_path_factory):
    """The Lumen golden planned (detailed) and rendered at each size, once for the module."""
    td = tmp_path_factory.mktemp("sizes")
    out = {}
    for s in SIZES:
        d, issues, pending = _plan(None if s == "16:9" else s)
        r, prs = _render(d, td, f"{s.replace(':', 'x')}.pptx")
        lay = json.loads((td / f"{s.replace(':', 'x')}.pptx.layouts.json").read_text())
        out[s] = SimpleNamespace(deck=d, issues=issues, pending=pending, r=r, prs=prs, layouts=lay)
    return out


# ------------------------------------------------------------------------------------------------- the canvas table and the identity

def test_canvas_table_is_exact():
    c = T.CANVASES
    assert c["16:9"].emu == (12191695, 6858000) and c["16:9"].px == (1920, 1080)
    assert c["4:3"].emu == (9144000, 6858000) and c["4:3"].px == (1440, 1080)
    assert c["a4"].emu == (10692000, 7560000) and c["a4"].px == (1684, 1191)   # 297 x 210 mm, 2 px per pt
    assert round(c["a4"].w_in * 72, 1) == 841.9 and round(c["a4"].h_in * 72, 1) == 595.3
    assert T.size_of(None) == "16:9" and T.size_of({"meta": {"preferences": {"size": {"canvas": "a5"}}}}) == "16:9"
    assert T.size_by_emu(9144000, 6858000) == "4:3" and T.size_by_emu(9000000, 6858000) is None


def test_the_map_is_the_identity_at_16x9_and_keeps_margins_physical_elsewhere():
    g = T.Grid()
    for x in (0, 0.65, 3.1, 7.3, 12.683, 13.333):
        assert T.CANVASES["16:9"].x(x) == x and T.CANVASES["16:9"].y(x / 2) == x / 2
    for name in ("4:3", "a4"):
        cv = T.CANVASES[name]
        assert cv.x(0) == 0 and cv.x(g.M) == g.M                                   # left margin unchanged
        assert abs(cv.x(g.W - g.M) - (cv.w_in - g.M)) < 1e-9                         # right margin unchanged
        assert abs(cv.x(g.W) - cv.w_in) < 1e-9 and abs(cv.y(g.H) - cv.h_in) < 1e-9  # a full bleed fills the canvas
        assert cv.y(g.title_y) == g.title_y                                           # the title sits where it sits on 16:9
        for x in (0.3, 2.0, 7.3, 12.9):
            assert abs(cv.unx(cv.x(x)) - x) < 1e-9
    assert T.CANVASES["4:3"].y(6.9) == 6.9 and abs(T.CANVASES["a4"].y(6.9) - (6.9 + 8.268 - 7.5)) < 0.01   # the footer keeps its distance from the bottom


def test_16x9_draws_the_same_with_or_without_the_stamp(tmp_path):
    a = _golden()
    b = _golden("16:9")
    pa, _, _ = layouts.plan(a, prefs={"density": "detailed"})
    pb, _, _ = layouts.plan(b, prefs={"density": "detailed"})
    assert layouts.plan_record(pa) == layouts.plan_record(pb)
    ra, xa = _render(pa, tmp_path, "a.pptx")
    rb, xb = _render(pb, tmp_path, "b.pptx")
    from test_render_parity import pptx_signature   # noqa: PLC0415 (the parity test's own signature)
    assert pptx_signature(tmp_path / "a.pptx") == pptx_signature(tmp_path / "b.pptx")
    assert (tmp_path / "a.pptx.layouts.json").read_bytes() == (tmp_path / "b.pptx.layouts.json").read_bytes()
    assert ra._cv is None and "canvas" not in ra.layout_record()


def test_every_shape_goes_through_the_canvas_map():
    """A source guard (design.rework_risks): a shape added with bare inches would stay where it is on 16:9 and fall off a 4:3 slide."""
    body = (Path(R.__file__)).read_text().split("class Renderer:")[1]
    for call in ("add_textbox(Inches(", "add_chart(kind, Inches(", "add_chart(XL_CHART_TYPE.BAR_CLUSTERED, Inches(", "add_picture(str(path), Inches(",
                 "add_table(nr, nc, Inches(", "add_shape(shape, Inches(", "Inches(x), Inches(cy)", "OVAL, Inches(cx - ", "ROUNDED_RECTANGLE, Inches(cx - "):
        assert call not in body, call
    assert "themes.Grid().W, 6.85" in body   # the full bleed reads the 16:9 grid on purpose: the map takes it to the canvas


# ------------------------------------------------------------------------------------------------- the plan and the drawing at each size

@pytest.mark.parametrize("size", SIZES)
def test_every_shape_is_on_the_canvas_and_nothing_ends_at_no_fit(planned, size):
    p = planned[size]
    cv = T.CANVASES[size]
    assert (Emu(p.prs.slide_width), Emu(p.prs.slide_height)) == cv.emu if size != "16:9" else True
    for sid, sl in zip(p.deck["order"], p.prs.slides):
        for sh in sl.shapes:
            if sh.left is None:
                continue
            x0, y0 = Emu(sh.left).inches, Emu(sh.top).inches
            x1, y1 = x0 + Emu(sh.width).inches, y0 + Emu(sh.height).inches
            assert x0 >= -0.01 and y0 >= -0.01 and x1 <= cv.w_in + 0.01 and y1 <= cv.h_in + 0.01, (size, sid, sh.name, x0, y0, x1, y1)
    rungs = p.deck["meta"]["layout_plan"]["rungs"]
    assert rungs["no_fit"] == 0, rungs                                   # Fable fix 1: detailed never ends at no_fit at 4:3 or A4
    assert not [s for s, v in p.layouts["slides"].items() if v.get("fallback")]
    assert ("canvas" in p.layouts) == (size != "16:9")


def test_words_are_the_same_at_every_size(planned):
    from deck.bench.checklist import words_sha
    shas = {s: words_sha(planned[s].deck) for s in SIZES}
    assert len(set(shas.values())) == 1, shas
    for sid in planned["16:9"].deck["order"]:
        assert len({layouts.slide_words(planned[s].deck["slides"][sid]) for s in SIZES}) == 1


def test_points_moved_at_a_size_are_in_that_sizes_notes(planned):
    for size in ("4:3", "a4"):
        p = planned[size]
        for sid, sl in zip(p.deck["order"], p.prs.slides):
            moved = layouts.moved_texts(p.deck["slides"][sid])
            notes = sl.notes_slide.notes_text_frame.text if moved else ""
            for t_, r_ in moved:
                assert layouts.moved_line(t_, r_) in notes, (size, sid)


def test_detailed_at_4x3_gets_the_notes_rung_last_and_16x9_detailed_never_moves(monkeypatch):
    calls = []
    real = R.Renderer.probe

    def probe(self, s, name, relaxed=False, scale_cap=None, title_pt=None, cpl=48):
        calls.append((self.cv.name, relaxed, cpl, title_pt))
        return real(self, s, name, relaxed, scale_cap, title_pt, cpl)
    monkeypatch.setattr(R.Renderer, "probe", probe)
    d16, _, _ = _plan(None)
    assert all(not (d16["slides"][s].get("layout") or {}).get("fit", {}).get("moved") for s in d16["order"] if d16["slides"][s]["type"] != "title")
    # a 4:3 slide that only fits once points leave: the plan tries 60-character lines and the caption floor before it moves any
    src = (Path(layouts.__file__)).read_text()
    late = src.index("late = density == \"detailed\" and size != \"16:9\"")
    assert src.index("cpl=60)", late) < src.index("if not done and can and late:", late)
    assert src.index("relaxed=True, cap=sc_cap, stamped=pt.get(lid)) if lid != \"flow\"", late) < src.index("if not done and can and late:", late)


def test_no_notes_keeps_every_point_on_the_slide_at_4x3():
    d, _, _ = _plan("4:3", notes=False)
    for sid in d["order"]:
        if d["slides"][sid]["type"] != "title":
            assert not ((d["slides"][sid].get("layout") or {}).get("fit") or {}).get("moved"), sid


# ------------------------------------------------------------------------------------------------- Fable fix 2: limits by size, never a paid shorten

def test_text_limits_shrink_with_the_box_and_16x9_keeps_the_files_limits():
    lib = layouts.load()
    for lid, lay in lib.items():
        for n, sl in lay["slots"].items():
            if sl["kind"] == "text" and sl.get("max_chars"):
                assert layouts.size_limit(lay, n, sl["max_chars"], None) == sl["max_chars"]
                assert layouts.size_limit(lay, n, sl["max_chars"], "16:9") == sl["max_chars"]
                assert layouts.size_limit(lay, n, sl["max_chars"], "4:3") <= sl["max_chars"]
                assert layouts.size_limit(lay, n, sl["max_chars"], "4:3") <= layouts.size_limit(lay, n, sl["max_chars"], "a4") or lid in ("close",)
    lay = lib["cards_split"]
    assert layouts.size_limit(lay, "lead", lay["slots"]["lead"]["max_chars"], "4:3") < lay["slots"]["lead"]["max_chars"]


def test_a_limit_only_the_size_raises_is_marked_and_never_shortened():
    lay = layouts.load()["cards_split"]
    lim16 = lay["slots"]["lead"]["max_chars"]
    lim43 = layouts.size_limit(lay, "lead", lim16, "4:3")
    text = "word " * ((lim43 + lim16) // 10)
    text = text[: (lim43 + lim16) // 2]
    slots = {"lead": {"kind": "text", "text": text}}
    assert layouts.slot_limit_issues(lay, "s05", slots) == []                       # fits at 16:9
    got = layouts.slot_limit_issues(lay, "s05", slots, "4:3")
    assert len(got) == 1 and got[0]["evidence"]["unit"] == "chars at 4:3" and got[0]["fix"] == {"kind": "ladder"}
    env = {"deck": {"slides": {"s05": {"layout": {"id": "cards_split"}, "type": "insight", "blocks": []}}}, "fixes": {}, "policy": {},
           "state": {"tried": set()}, "shorten_ok": True, "shorten_why": "", "library": {}, "text_mode": "condense", "density": "lean"}
    ok, why = repair.available("shorten", {**got[0], "slot": "lead"}, env)
    assert not ok and "16:9" in why
    over = layouts.slot_limit_issues(lay, "s05", {"lead": {"kind": "text", "text": "x" * (lim16 + 5)}}, "4:3")
    assert over[0]["fix"] == {"kind": "shorten"} and over[0]["evidence"]["unit"] == "chars"


def test_a_size_change_calls_no_paid_shorten_hook():
    asked = []
    hook = lambda sid, slot, limits, fields: asked.append((sid, slot)) or None   # noqa: E731
    _, issues, pending = layouts.plan(_golden("4:3"), prefs={"density": "detailed"}, hooks={"shorten": hook})
    by_size = [i for i in issues if i["check"] == "slot_limit" and str(i.get("evidence", {}).get("unit", "")).endswith(" at 4:3")]
    assert not {(i["slide"], i.get("slot")) for i in by_size} & set(asked)
    _, issues16, _ = layouts.plan(_golden(), prefs={"density": "detailed"}, hooks={"shorten": lambda *a: None})
    assert not [i for i in issues16 if " at " in str((i.get("evidence") or {}).get("unit", ""))]


def test_the_max_lines_check_names_a_title_over_its_lines_at_a_size():
    d = _golden("4:3")
    sid = next(s for s in d["order"] if d["slides"][s]["type"] == "insight")
    d["slides"][sid]["title"] = " ".join(["Considerably"] * 22)
    _, issues, _ = layouts.plan(d, prefs={"density": "detailed"})
    lines = [i for i in issues if i["slide"] == sid and i.get("slot") == "title" and i["evidence"]["unit"] == "lines at 4:3"]
    if lines:   # a layout may still fit it at the title floor; when it does not, the check says so, by size
        assert lines[0]["fix"] == {"kind": "ladder"}


# ------------------------------------------------------------------------------------------------- Fable fix 3: minimums and not_at

def test_emphasis_bar_is_not_at_4x3_and_the_idea_falls_to_big_statement(planned):
    assert layouts.load()["emphasis_bar"]["not_at"] == ["4:3"]
    p16, p43 = planned["16:9"], planned["4:3"]
    eb = [s for s in p16.deck["order"] if p16.layouts["slides"][s]["id"] == "emphasis_bar"]
    assert eb
    for s in eb:
        assert p43.layouts["slides"][s]["id"] != "emphasis_bar"
        if p16.deck["slides"][s]["type"] == "idea":
            assert p43.layouts["slides"][s]["id"] in ("big_statement", "full_bleed_statement", "section"), p43.layouts["slides"][s]
    r = R.Renderer(_golden("4:3"), None)
    s = p16.deck["slides"][eb[0]]
    assert r.probe({**s, "blocks": spec.shown_blocks(s, "review")}, "emphasis_bar")["ok"] is False
    assert R.Renderer(_golden("a4"), None).not_here("emphasis_bar") is False


def test_two_columns_keep_their_own_minimum():
    assert spec.MIN_COLUMN_IN["cards_split"] <= (12.033 - 0.25) * 0.42 * T.CANVASES["4:3"].k   # cards_split still draws at 4:3
    r = R.Renderer(_golden("4:3"), None)
    with pytest.raises(R.NoFit):
        r.min_column(4.0, 3.6)          # 2.89 in at 4:3
    r.min_column(5.0, 3.6)              # 3.62 in
    R.Renderer(_golden(), None).min_column(1.0, 3.6)   # never at 16:9


def test_the_frames_strip_gives_way_at_4x3_only():
    r43, ra4 = R.Renderer(_golden("4:3"), None), R.Renderer(_golden("a4"), None)
    cell = (12.683 - 0.65 - 0.6) / 4
    assert r43._kx(cell) < spec.MIN_STRIP_FRAME_IN <= ra4._kx(cell)


# ------------------------------------------------------------------------------------------------- Fable fix 4: plan and draw at one width

@pytest.mark.parametrize("size", SIZES)
def test_capacity_never_exceeds_the_drawn_box(planned, size):
    """The characters per line the plan's capacity counts for a text slot never exceed what the box drawn at that size holds (5% for the
    48-character cap's own glyph estimate). At 16:9 the layout files' limits are frozen by the byte-identity guarantee: deck-look's close
    statement is the one known exception there, listed."""
    p = planned[size]
    lib = layouts.load()
    S = T.Scale()
    bad = []
    for sid, sl in zip(p.deck["order"], p.prs.slides):
        lid = p.r.layouts[sid]
        if lid not in lib:
            continue
        lay = lib[lid]
        boxes = R.Renderer.slot_boxes(lid, lay, size)
        for sh in sl.shapes:
            n = sh.name[5:] if sh.name.startswith("slot:") else None
            if not n or sh.shape_type != 17 or not sh.text_frame.text.strip() or (lay["slots"].get(n) or {}).get("kind") != "text" or n not in boxes:
                continue
            role = lay["slots"][n].get("role", "body")
            pt = max(S.body_floor if role != "caption" else S.caption_floor, getattr(S, role) * 0.88)
            wf = 0.5 + (0.03 if role in ("display", "title") else 0)
            per = lambda w: w * 72 / (pt * wf)   # noqa: E731
            plan_cpl = min(lay["slots"][n].get("max_cpl") or 48, per(boxes[n][0])) if role in ("body", "small", "lead", "caption") else per(boxes[n][0])
            if plan_cpl > per(Emu(sh.width).inches) * 1.05 and not (size == "16:9" and (lid, n) == ("close", "statement")):
                bad.append((sid, lid, n, round(boxes[n][0], 2), round(Emu(sh.width).inches, 2)))
    assert not bad, bad


def test_slot_boxes_at_16x9_are_the_files_boxes():
    for lid, lay in layouts.load().items():
        assert R.Renderer.slot_boxes(lid, lay) == R.Renderer.slot_boxes(lid, lay, "16:9")
    lay = layouts.load()["cards_split"]
    assert R.Renderer.slot_boxes("cards_split", lay, "4:3")["lead"][0] == pytest.approx(4.949 * T.CANVASES["4:3"].k)


# ------------------------------------------------------------------------------------------------- the cover never drops its picture silently

def test_a_cover_drawn_without_its_picture_at_a_size_is_an_issue(monkeypatch):
    d = _golden("4:3")
    cover = d["order"][0]
    monkeypatch.setattr(layouts, "image_slots", lambda lay: [])   # as if no picture layout held the cover at this size
    monkeypatch.setattr(images, "drawn", lambda deck, aud: {(cover, "picture"): {"asset": "img_x", "aspect": "16:9"}})
    _, issues, _ = layouts.plan(d, prefs={"density": "detailed"})
    assert [i for i in issues if i["slide"] == cover and i["check"] == "image_missing" and "4:3" in i["message"]]


# ------------------------------------------------------------------------------------------------- pictures

def test_slot_aspect_keeps_16x9_and_snaps_the_bleed_to_3x2():
    for name in ("16:9", None):
        cv = T.canvas(name)
        for a in spec.IMAGE_ASPECTS:
            assert images.slot_aspect(a, "title", "picture", cv) == a
    assert images.slot_aspect("16:9", "title", "picture", None) == "16:9"
    for name in ("4:3", "a4"):
        cv = T.CANVASES[name]
        assert images.slot_aspect("16:9", "title", "picture", cv) == "3:2"
        assert images.slot_aspect("16:9", "idea", "picture", cv) == "3:2"
        assert images.slot_aspect("4:3", "audience", "picture", cv) == "4:3"   # a panel keeps its declared aspect
        assert images.slot_aspect("16:9", "territory", "frame_1", cv) == "16:9"


def test_generation_candidates_keep_their_aspect_at_16x9_and_take_3x2_at_a4():
    d = _golden()
    sid = d["order"][0]
    d["slides"][sid].setdefault("slots", {})["picture"] = {"kind": "image", "image": {"kind": "photo", "status": "empty", "aspect": "16:9", "basis": "creative"}}
    c16 = [c for c in imagegen.candidate_slots(copy.deepcopy(d)) if c["sid"] == sid]
    d["meta"].setdefault("preferences", {})["size"] = {"canvas": "a4", "source": "person"}
    ca4 = [c for c in imagegen.candidate_slots(copy.deepcopy(d)) if c["sid"] == sid]
    assert c16 and ca4 and c16[0]["aspect"] == "16:9" and ca4[0]["aspect"] == "3:2"
    assert c16[0]["key"] == ca4[0]["key"]   # the slot's anchor key does not move; only the requested ratio does


def test_a_made_picture_is_recropped_never_planned_again():
    d = _golden("4:3")
    sid = d["order"][0]
    d["slides"][sid].setdefault("slots", {})["picture"] = {"kind": "image", "image": {"kind": "photo", "status": "made", "aspect": "16:9",
                                                                                     "asset": "img_aaaaaaaaaaaa", "basis": "creative"}}
    assert not [c for c in imagegen.candidate_slots(d) if c["sid"] == sid]


def test_the_picture_is_cropped_to_the_box_drawn_at_the_size(tmp_path):
    from PIL import Image
    src = tmp_path / "p.jpg"
    Image.new("RGB", (1600, 900), (120, 140, 160)).save(src)
    for name, want in (("16:9", 6.05 / 5.4), ("4:3", None)):
        d = _golden(None if name == "16:9" else name)
        r = R.Renderer(d, Inputs(brief={}), pictures={"img_x": src})
        r._sid = d["order"][0]
        sl = r.prs.slides.add_slide(r.blank)
        pic = r.picture(sl, 7.3, 0.62, 5.4, 6.05, {"asset": "img_x", "aspect": "4:3", "status": "approved", "focal": {"x": 0.7, "y": 0.5}}, label=False)
        drawn = Emu(pic.width).inches / Emu(pic.height).inches
        shown = (1600 * (1 - pic.crop_left - pic.crop_right)) / (900 * (1 - pic.crop_top - pic.crop_bottom))
        assert abs(shown / drawn - 1) < 0.01, name   # never stretched: the crop has the drawn box's aspect


def test_a_recrop_that_cuts_protect_boxes_is_a_finding(tmp_path):
    from PIL import Image
    src = tmp_path / "p.jpg"
    Image.new("RGB", (1600, 900), (120, 140, 160)).save(src)
    d = _golden("4:3")
    r = R.Renderer(d, Inputs(brief={}), pictures={"img_x": src})
    r.protect = {"img_x": {"x0": 0.02, "y0": 0.1, "x1": 0.98, "y1": 0.9}}
    r._sid = d["order"][0]
    sl = r.prs.slides.add_slide(r.blank)
    r.picture(sl, 7.3, 0.62, 5.4, 6.05, {"asset": "img_x", "aspect": "4:3", "status": "approved"}, label=False)
    assert [f for f in r.picture_findings if f["check"] == "image_crop" and "4:3" in f["message"]]


def test_a_mockup_frame_keeps_its_aspect_at_4x3():
    r = R.Renderer(_golden("4:3"), None)
    rv = r._aspect_v(9 / 16, 7.0, 1.74, 5.5, 4.5)
    w = 4.5 * rv   # a frame of that grid aspect, 4.5 in tall, drawn at 4:3
    X, Y, W_, H_ = r.cv.box(7.0, 1.74, w, 4.5)
    assert rv > 9 / 16 and abs(W_ / H_ - 9 / 16) < 1e-6   # the map's narrowing gives back the format's own aspect
    assert R.Renderer(_golden(), None)._aspect_v(9 / 16, 7.0, 1.74, 5.5, 4.5) == 9 / 16


# ------------------------------------------------------------------------------------------------- the web stage

def test_web_and_hyperframes_size_their_stage(tmp_path):
    assert render_web.size_css(T.CANVASES["16:9"]) == "" and render_web.size_js("x/1920", T.CANVASES["16:9"]) == "x/1920"
    css43 = render_web.size_css(T.CANVASES["4:3"])
    assert "#stage{width:1440px;height:1080px}" in css43 and "@page{size:1440px 1080px" in css43
    cssa4 = render_web.size_css(T.CANVASES["a4"])
    assert "#stage{width:1684px;height:1191px}" in cssa4 and "@page{size:297mm 210mm" in cssa4
    js = render_web.size_js(render_web.JS, T.CANVASES["4:3"])
    assert "r.width/1440,r.height/1080" in js and "r.width/1920" not in js
    d16, _, _ = _plan(None)
    da4, _, _ = _plan("a4")
    render_web.render(d16, Inputs(brief={}), tmp_path / "a.html")
    render_web.render(da4, Inputs(brief={}), tmp_path / "b.html")
    assert "1684px" not in (tmp_path / "a.html").read_text() and "#stage{width:1684px;height:1191px}" in (tmp_path / "b.html").read_text()
    render_hyperframes.render(da4, Inputs(brief={}), tmp_path / "hf")
    hf = (tmp_path / "hf" / "index.html").read_text()
    assert 'content="width=1684, height=1191"' in hf and 'data-width="1684" data-height="1191"' in hf and "width:1920px;height:1080px" not in hf


# ------------------------------------------------------------------------------------------------- asking: CLI, document, master, recipe, intake, server

def _a(**kw):
    return SimpleNamespace(**{"size": None, "master": None, **kw})


def test_size_precedence_and_the_stamp():
    d = {"meta": {}}
    assert run_deck._resolve_size(_a(), d, None, None) == "16:9" and "preferences" not in d["meta"]   # absence means 16:9: nothing stamped
    d = {"meta": {}}
    assert run_deck._resolve_size(_a(), d, None, {"size": "a4"}) == "a4" and d["meta"]["preferences"]["size"] == {"canvas": "a4", "source": "recipe"}
    d = {"meta": {}}
    assert run_deck._resolve_size(_a(), d, {"look": {"size": {"canvas": "4:3", "by": "person"}}}, {"size": "a4"}) == "4:3"
    d = {"meta": {}}
    assert run_deck._resolve_size(_a(size="a4"), d, {"look": {"size": {"canvas": "4:3"}}}, None) == "a4"
    assert d["meta"]["preferences"]["size"] == {"canvas": "a4", "source": "person"}
    d = {"meta": {}}
    assert run_deck._resolve_size(_a(), d, None, None, {"q_pref_size": {"option_id": "4:3"}}) == "4:3"
    d = {"meta": {}}
    assert run_deck._resolve_size(_a(), d, None, None, {"q_pref_size": {"option_id": "4:3", "skipped": True}}) == "16:9"


def test_a_master_lends_its_size_and_an_explicit_conflict_is_refused(tmp_path):
    from pptx import Presentation as P
    m = tmp_path / "m.pptx"
    P().save(str(m))   # python-pptx's default: 10 x 7.5 in, a 4:3 master
    d = {"meta": {}}
    assert run_deck._resolve_size(_a(master=m), d, None, {"size": "a4"}) == "4:3" and d["meta"]["preferences"]["size"]["source"] == "master"
    with pytest.raises(SystemExit, match="never converted"):
        run_deck._resolve_size(_a(master=m, size="a4"), {"meta": {}}, None, None)
    assert run_deck._resolve_size(_a(master=m, size="4:3"), {"meta": {}}, None, None) == "4:3"


def test_the_classic_theme_is_refused_at_another_size():
    with pytest.raises(ValueError, match="16:9 only"):
        R.Renderer(_golden("4:3"), None, theme="classic")


def test_a4_defaults_to_detailed_and_the_recipes_say_a4_for_a_tender_and_a_read_deck():
    assert spec.SIZE_DENSITY_DEFAULTS == {"a4": "detailed"} and "4:3" not in spec.SIZE_DENSITY_DEFAULTS
    assert profiles.recipe(profiles.load("tender_response"), "pitch")["size"] == "a4"
    for pid in profiles.ids():
        assert profiles.recipe(profiles.load(pid), "full")["size"] == "a4"
    cards = {c["id"]: c for c in profiles.card_data()}
    assert cards["tender_response"]["size"] == "a4" and cards["agency_pitch"]["size"] == "16:9" and cards["agency_pitch"]["size_read"] == "a4"


def test_the_size_card_joins_only_for_print_or_a_leave_behind():
    assert intake.size_question("pitch", "A launch campaign for a water utility") is None
    c = intake.size_question("pitch", "We will print a handout for the board")
    assert c and c["id"] == "q_pref_size" and c["address"] == "look.size" and c["kind"] == "preference" and c["skippable"]
    assert c["options"][0]["value"] == "a4" and c["options"][0]["origin"] == "default"
    assert intake.size_question("full", "anything")["options"][0]["value"] == "a4"
    assert intake.size_question("pitch", "the client room has a 4:3 projector")["options"][0]["value"] == "4:3"
    assert intake.size_question("pitch", "an imprint of the brand") is None   # whole words only
    a0 = {"questions": [{"id": f"q_{i}"} for i in range(5)]}
    assert len(intake.add_size_question(a0, c)["questions"]) == 5 and c not in a0["questions"]   # never displaces a content question
    a0 = {"questions": [{"id": "q_1"}]}
    assert intake.add_size_question(a0, c)["questions"][-1]["id"] == "q_pref_size"


def test_the_server_forwards_look_size_and_refuses_a_bad_one():
    assert server.picked_size({"look": {"size": {"canvas": "a4"}}}) == "a4"
    assert server.picked_size({"inputs": {"look": {"size": {"canvas": "4:3"}}}}) == "4:3"
    assert server.picked_size({}) is None
    with pytest.raises(server.Refused):
        server.picked_size({"look": {"size": {"canvas": "a5"}}})


def test_the_schemas_take_the_size():
    ds = json.loads((Path(R.__file__).with_name("deck.schema.json")).read_text())
    sz = ds["properties"]["meta"]["properties"]["preferences"]["properties"]["size"]
    assert sz["properties"]["canvas"]["enum"] == ["16:9", "4:3", "a4"] and sz["additionalProperties"] is False
    fit = ds["definitions"]["slide"]["properties"]["layout"]["properties"]["fit"]["properties"]
    assert "title_pt" in fit
    ls = json.loads((Path(R.__file__).with_name("schemas") / "layout.schema.json").read_text())
    assert ls["properties"]["not_at"]["items"]["enum"] == ["4:3", "a4"]


# ------------------------------------------------------------------------------------------------- the bench: one size per checklist

def test_the_bench_never_compares_two_sizes():
    base = {"items_version": 1, "decks": {}}
    with pytest.raises(ValueError, match="different slide sizes"):
        bench_compare.compare(base, {**base, "size": "4:3"})
    assert bench_compare.compare(base, base)["regressions"] == 0
    assert spec.BENCH_DENSITY == {"16:9": "detailed", "4:3": "standard", "a4": "detailed"}


# ================================================================================================ the adversarial review's fixes

def _master(tmp_path, w, h, name="m.pptx"):
    from pptx import Presentation as P
    prs = P()
    prs.slide_width, prs.slide_height = Emu(w), Emu(h)
    prs.save(str(tmp_path / name))
    return tmp_path / name


def test_a_16x9_master_wins_over_an_a4_recipe_and_an_odd_master_is_refused(tmp_path):
    m169 = _master(tmp_path, 12191695, 6858000)
    d = {"meta": {}}
    assert run_deck._resolve_size(_a(master=m169), d, None, {"size": "a4"}) == "16:9" and "preferences" not in d["meta"]
    odd = _master(tmp_path, 9906000, 6858000, "odd.pptx")   # PowerPoint's 'A4 Paper' preset, 10.83 x 7.5 in: none of the three
    with pytest.raises(SystemExit, match="none of the slide sizes"):
        run_deck._resolve_size(_a(master=odd), {"meta": {}}, None, None)


def test_a_master_conflict_is_refused_before_any_paid_stage(tmp_path, monkeypatch):
    m43 = _master(tmp_path, 9144000, 6858000)
    monkeypatch.setattr(intake, "chosen_type", lambda *a, **k: (_ for _ in ()).throw(AssertionError("refused too late")))
    with pytest.raises(SystemExit, match="never converted"):
        run_deck.main(["--prompt-text", "a launch", "--stages", str(tmp_path / "st"), "--client", "c", "--project", "p", "--out", str(tmp_path / "o"),
                       "--master", str(m43), "--size", "a4"])
    assert not (tmp_path / "st").exists() or not list((tmp_path / "st").iterdir())
    src = Path(run_deck.__file__).read_text()
    assert "profiles.recipes_on() and not a.master and not _explicit_size(a, deck_ctx, answers)" in src   # no size card when a master fixes it


def test_a_slide_only_the_size_overflows_is_never_shortened(monkeypatch):
    real = R.Renderer.probe

    def probe(self, s, name, relaxed=False, scale_cap=None, title_pt=None, cpl=48):   # nothing fits at 4:3; 16:9 as it is
        if self.cv.name != "16:9" and name != "flow":
            return {"ok": False, "scale": 1.0, "relaxed": relaxed}
        return real(self, s, name, relaxed, scale_cap, title_pt, cpl)
    monkeypatch.setattr(R.Renderer, "probe", probe)
    d, issues, pending = layouts.plan(_golden("4:3"), prefs={"density": "detailed", "text_mode": "condense", "repair": True})
    tagged = [sid for sid in d["order"] if ((d["slides"][sid].get("layout") or {}).get("fit") or {}).get("by_size")]
    assert tagged and not {x["slide"] for x in pending} & set(tagged)   # a no_fit only the size made gets no pending shorten
    asked = []
    d2, _, _ = layouts.plan(_golden("4:3"), prefs={"density": "detailed"}, hooks={"shorten": lambda sid, *a: asked.append(sid)})
    tagged2 = {sid for sid in d2["order"] if ((d2["slides"][sid].get("layout") or {}).get("fit") or {}).get("by_size")}
    assert tagged2 and not set(asked) & tagged2
    assert all(((x.get("fix") or {}).get("kind") != "shorten") for x in issues if x["slide"] in tagged and x["check"] == "slot_limit")
    sid = tagged[0]
    env = {"deck": d, "fixes": {}, "policy": {}, "state": {"tried": set()}, "shorten_ok": True, "shorten_why": "", "library": layouts.load(),
           "text_mode": "condense", "density": "detailed"}
    for check in ("text_overflow", "min_font", "slot_limit"):
        ok, why = repair.available("shorten", {"slide": sid, "slot": "lead", "check": check, "evidence": {"measured": 1, "limit": 1, "unit": "chars"}}, env)
        assert not ok and "16:9" in why, check
    d16, _, _ = layouts.plan(_golden(), prefs={"density": "detailed"})
    assert not [s for s in d16["order"] if ((d16["slides"][s].get("layout") or {}).get("fit") or {}).get("by_size")]


def _shapes_pic(tmp_path, name, fill, size=(1946, 1000)):
    from PIL import Image
    im = Image.new("RGB", size)
    px = im.load()
    for y in range(size[1]):
        for x in range(size[0]):
            px[x, y] = fill(x / size[0], y / size[1])
    im.save(tmp_path / name)
    return tmp_path / name


def test_the_finder_refuses_a_shape_under_the_words_and_remeasures_at_a_size(tmp_path):
    sky, mark = (200, 220, 234), (58, 64, 72)
    p = _shapes_pic(tmp_path, "mark.png", lambda u, v: mark if (0.2 < u < 0.35 and 0.15 < v < 0.5) else sky)   # a dark mark in the top-left zone
    rec = images.text_zone(p, shapes=True)
    assert rec.get("zone") and rec["zone"] != "top_left" and rec["zone"] != "middle_left"
    horizon = _shapes_pic(tmp_path, "hz.png", lambda u, v: mark if (v > 0.6 or 0.4 < u < 0.6) else sky)
    none = images.text_zone(horizon, shapes=True)
    assert none.get("none") and "shape" in none["reason"]
    d = {"order": ["s01"], "slides": {"s01": {"type": "title", "slots": {"picture": {"kind": "image", "image": {
        "asset": "img_x", "status": "made", "aspect": "16:9", "text_zone": {"zone": "top_left", "text": "1B2430", "colour": "FAF7F1", "alpha": 0.4,
                                                                             "p10": 9.0, "busy_sd": 0.02, "by": "finder"}}}}}}}
    images.solve_text_zones(copy.deepcopy(d), {"img_x": p})   # 16:9 keeps a recorded zone
    d43 = copy.deepcopy(d)
    images.solve_text_zones(d43, {"img_x": p}, canvas=T.CANVASES["4:3"])
    assert d43["slides"]["s01"]["slots"]["picture"]["image"]["text_zone"] != d["slides"]["s01"]["slots"]["picture"]["image"]["text_zone"]


def test_web_side_pictures_narrow_with_a_floor():
    css = render_web.size_css(T.CANVASES["4:3"])
    assert ".pw560 .pics.side{zoom:0.7230}" in css and ".pw560 header,.pw560 .body{margin-right:475px}" in css
    assert ".pw360 .pics.side{zoom:1.0000}" in css   # never under 360 px


def test_kpi_cards_and_comparison_cells_keep_their_minimums():
    stats4 = {"blocks": [{"kind": "stats", "items": [{"value": "1", "label": "a"}] * 4}]}
    table = lambda n: {"blocks": [{"kind": "table", "rows": [["h"] * n, ["c"] * n]}]}   # noqa: E731
    r16, r43 = R.Renderer(_golden(), None), R.Renderer(_golden("4:3"), None)
    assert r16.cells_fit(table(6), "comparison") and r43.cells_fit(stats4, "kpi_row")    # 4 cards at 4:3: 2.0 in
    assert r43.cells_fit(table(3), "comparison_grid") and not r43.cells_fit(table(4), "comparison_grid")   # 2.78 / 2.04 in
    assert not r43.probe({"type": "competition", "title": "x", "blocks": table(4)["blocks"]}, "comparison_grid")["ok"]
    assert spec.MIN_KPI_CARD_IN == 1.8 and spec.MIN_COMPARE_CELL_IN == 2.2


def test_the_dropped_cover_picture_names_a_persons_swap(monkeypatch):
    d = _golden("4:3")
    cover = d["order"][0]
    monkeypatch.setattr(images, "drawn", lambda deck, aud: {(cover, "picture"): {"asset": "img_x", "aspect": "16:9"}})
    _, issues, _ = layouts.plan(d, prefs={"density": "detailed"}, swaps={cover: "cover"})
    msg = [i["message"] for i in issues if i["slide"] == cover and i["check"] == "image_missing"]
    assert msg and "a person chose cover" in msg[0] and "does not fit beside" not in msg[0]



def test_the_cover_title_never_breaks_inside_a_word_at_a_size(tmp_path):
    """At 4:3 the cover's title is measured as drawn (the last two words glued) with 10% slack for a glued pair: 'awareness campaign' at
    64 pt filled 97% of the 8.7 in line by the estimate and broke inside the word, so the cover steps down a size."""
    d = _golden("4:3")
    cover = d["order"][0]
    d["slides"][cover]["title"] = "Lumen Water: National awareness campaign"
    d["slides"][cover].pop("layout", None)
    r = R.Renderer(d, Inputs(brief={}))
    sl = r.prs.slides.add_slide(r.blank)
    r._sid, r._lid, r._cur = cover, "cover", sl
    r._lay_cover(sl, {**d["slides"][cover], "blocks": spec.shown_blocks(d["slides"][cover], "review")})
    size = next(sh for sh in sl.shapes if sh.name == "Title").text_frame.paragraphs[0].runs[0].font.size.pt
    assert size < 64
    r16 = R.Renderer({**_golden(), "slides": {**_golden()["slides"], cover: d["slides"][cover]}}, Inputs(brief={}))
    sl16 = r16.prs.slides.add_slide(r16.blank)
    r16._sid, r16._lid, r16._cur = cover, "cover", sl16
    r16._lay_cover(sl16, {**d["slides"][cover], "blocks": spec.shown_blocks(d["slides"][cover], "review")})
    assert next(sh for sh in sl16.shapes if sh.name == "Title").text_frame.paragraphs[0].runs[0].font.size.pt == 64   # 16:9 as before
