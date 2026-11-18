"""deck-graphics slice 1 (features/deck-graphics.clan): icons. The vendored Lucide allow-list and its licence, the fixed keyword map
(all-or-none per group, no fallback, no brand), the native custGeom freeform, the placement on channel-role rows and statement points
at the layout's own type size, the web twin, tenders off, the checklist items, and the flag: off (the default) changes nothing.
Offline: no model, no network, no LibreOffice."""
from __future__ import annotations

import copy
import importlib
import json
import re
from pathlib import Path

import pytest
import yaml
from lxml import etree
from pptx import Presentation

from deck import assemble, graphics, inputs, layouts, profiles, render_pptx as R, render_web, spec
from deck import theme as T
from deck.bench import checklist as cl
from deck.inputs import Inputs

HERE = Path(__file__).parent
FIX = HERE / "fixtures" / "lumen_water"
VENDOR = Path(graphics.__file__).resolve().parent / "vendor" / "icons"
FILES = {"a": "a_requirements.json", "b": "b_storyline.json", "c": "c_territories.json", "d": "d_idea.json"}
A = "{http://schemas.openxmlformats.org/drawingml/2006/main}"
P = "{http://schemas.openxmlformats.org/presentationml/2006/main}"


@pytest.fixture
def v3(monkeypatch):
    monkeypatch.setattr(spec, "LOOK_V3", True)


@pytest.fixture
def gr(v3, monkeypatch):
    monkeypatch.setattr(spec, "GRAPHICS", True)


def _deck() -> dict:
    st = {k: json.loads((FIX / f).read_text()) for k, f in FILES.items() if (FIX / f).exists()}
    d = assemble.build(inputs.load(FIX / "brief_object.json"), st, client="Lumen Water", project="National awareness campaign", fmt="pitch")
    planned, _, _ = layouts.plan(d, prefs={"density": "lean"})
    return planned


def _by_type(d: dict) -> dict:
    return {d["slides"][sid]["type"]: sid for sid in reversed(d["order"])}


def _render(d: dict, tmp_path, name="d.pptx"):
    r = R.Renderer(d, Inputs(brief={}), theme="napkin")
    out = tmp_path / name
    r.render(out)
    return r, Presentation(str(out))


def _icons_on(sl) -> list:
    return [sh.name[len("Icon: "):] for sh in sl.shapes if sh.name.startswith("Icon: ")]


# ================================================================================================ the flag
def test_the_flag_needs_look_v3_and_is_off_by_default(monkeypatch, capsys):
    try:
        monkeypatch.delenv("DECK_GRAPHICS", raising=False)
        monkeypatch.delenv("DECK_LOOK_V3", raising=False)
        assert importlib.reload(spec).GRAPHICS is False
        monkeypatch.setenv("DECK_GRAPHICS", "1")
        assert importlib.reload(spec).GRAPHICS is False   # without LOOK_V3: off, with a warning
        assert "needs DECK_LOOK_V3=1" in capsys.readouterr().err
        monkeypatch.setenv("DECK_LOOK_V3", "1")
        assert importlib.reload(spec).GRAPHICS is True
    finally:
        monkeypatch.delenv("DECK_GRAPHICS", raising=False)
        monkeypatch.delenv("DECK_LOOK_V3", raising=False)
        importlib.reload(spec)


def test_flag_off_draws_no_icon_and_reads_no_vendor_file(v3, tmp_path):
    assert not spec.GRAPHICS
    graphics.icons.cache_clear()
    r, prs = _render(_deck(), tmp_path)
    assert graphics.icons.cache_info().currsize == 0   # icons.json never read
    assert not any(_icons_on(sl) for sl in prs.slides) and r.icons_drawn == {}


def test_flag_on_changes_only_the_icon_slides(v3, tmp_path, monkeypatch):
    d = _deck()
    r0, p0 = _render(copy.deepcopy(d), tmp_path, "off.pptx")
    monkeypatch.setattr(spec, "GRAPHICS", True)
    r1, p1 = _render(copy.deepcopy(d), tmp_path, "on.pptx")
    assert r0.layouts == r1.layouts and r0.relaxed == r1.relaxed   # the plan and the fit ladder are untouched
    assert set(r1.icons_drawn) and r0.icons_drawn == {}
    for sid, a, b in zip(d["order"], p0.slides, p1.slides):
        if sid in r1.icons_drawn:
            plain = lambda shs: [re.sub(r" \d+$", "", sh.name) for sh in shs if not sh.name.startswith("Icon: ")]   # auto names carry the shape id
            assert plain(b.shapes) == plain(a.shapes)
            texts = lambda shs: sorted(sh.text_frame.text for sh in shs if sh.has_text_frame and not sh.name.startswith("Icon: "))
            assert texts(b.shapes) == texts(a.shapes)
            sizes_a = sorted(run.font.size.pt for sh in a.shapes if sh.has_text_frame for p in sh.text_frame.paragraphs for run in p.runs if run.font.size)
            sizes_b = sorted(run.font.size.pt for sh in b.shapes if sh.has_text_frame for p in sh.text_frame.paragraphs for run in p.runs if run.font.size)
            assert sizes_a == sizes_b   # an icon never shrinks a word
        else:
            assert etree.tostring(a._element) == etree.tostring(b._element), sid


# ================================================================================================ the vendored allow-list
def test_vendored_ids_equal_the_policy_and_no_brand():
    ids = set(graphics.icons())
    assert ids == set(graphics.keyword_map()) and len(ids) == 72
    assert not [i for i in ids if any(i == d or i.startswith(d + "-") for d in graphics.ICON_DENY)]
    assert not ids & {"award", "trophy", "medal", "crown", "facebook", "instagram", "youtube", "linkedin", "twitter"}


def test_no_icon_makes_a_claim_of_its_own():
    """No icon in the map shows a direction (an arrow, a rising line), a verdict (a tick, a cross, a badge) or an approval (a thumb, a star):
    the words beside an icon carry the claim; the icon never adds one (review fix)."""
    ids = set(graphics.keyword_map())
    assert not ids & set(graphics.ICON_CLAIMS)
    parts = {"trending", "arrow", "check", "checks", "thumbs", "star", "badge", "award", "trophy", "medal", "ban", "x", "up", "down"}
    assert not [i for i in ids if set(i.split("-")) & parts]   # whole parts of the id: 'bank' is not 'ban


def test_licence_and_source_are_recorded():
    lic = (VENDOR / "LICENSE").read_text()
    assert "ISC License" in lic and "The MIT License (MIT)" in lic and "Cole Bemis" in lic and "Lucide Icons and Contributors" in lic
    src = json.loads((VENDOR / "icons.source.json").read_text())
    assert src["package"] == "lucide-static" and src["version"] == "1.75.0" and src["license"] == "ISC"
    assert src["integrity"].startswith("sha512-vtAnJzxoH8jp0++Ydf22CPAAL3Wf") and src["tarball"].endswith("lucide-static-1.75.0.tgz")
    import hashlib
    assert hashlib.sha256((VENDOR / "icons.json").read_bytes()).hexdigest() == src["icons_json_sha256"]   # never edited by hand
    feather = {i for i, v in graphics.icons().items() if v["feather"]}
    assert feather == set(src["feather_derived"]) and {"radio", "tv", "calendar", "target", "search"} <= feather
    named = re.search(r"derived from the Feather project:\s*(.+?)\n\s*\n", lic, re.S).group(1)
    assert all(i in named for i in feather)


def test_every_path_is_absolute_and_inside_the_grid():
    for iid, v in graphics.icons().items():
        assert v["paths"], iid
        for sub in v["paths"]:
            assert sub[0][0] == "M", iid
            for c in sub:
                assert c[0] in ("M", "L", "C", "Z") and len(c) == {"M": 3, "L": 3, "C": 7, "Z": 1}[c[0]], (iid, c)
                assert all(-0.5 <= x <= 24.5 for x in c[1:]), (iid, c)


def test_the_vendor_script_converts_arcs_and_shapes():
    import sys
    sys.path.insert(0, str(HERE.parents[2] / "scripts"))
    try:
        vi = importlib.import_module("vendor_icons")
    finally:
        sys.path.pop(0)
    circle = vi.svg_paths('<svg xmlns="http://www.w3.org/2000/svg"><circle cx="12" cy="12" r="2"/></svg>')
    assert circle[0][0] == ["M", 14.0, 12.0] and [c[0] for c in circle[0]] == ["M", "C", "C", "C", "C", "Z"]
    arc = vi.parse_path("M10 22V4a2 2 0 1 1 4 0v18")[0]   # signpost-big's post: a half circle on top, flags run together
    assert arc[1] == ["L", 10.0, 4.0] and arc[-1] == ["L", 14.0, 22.0] and [c[0] for c in arc].count("C") == 2
    rect = vi.svg_paths('<svg xmlns="http://www.w3.org/2000/svg"><rect x="2" y="4" width="20" height="16" rx="2"/></svg>')[0]
    assert [c[0] for c in rect].count("C") == 4 and rect[-1] == ["Z"]
    line = vi.svg_paths('<svg xmlns="http://www.w3.org/2000/svg"><line x1="8" x2="16" y1="22" y2="22"/></svg>')
    assert line == [[["M", 8.0, 22.0], ["L", 16.0, 22.0]]]
    assert vi.feather_ids("are derived from the Feather project:\n\nradio, tv\n\nMIT") == {"radio", "tv"}


# ================================================================================================ the keyword map
def test_no_keyword_names_two_icons_and_each_keyword_finds_its_own():
    seen = {}
    for iid, kws in graphics.keyword_map().items():
        for k in kws:
            key = tuple(graphics.words(k))
            assert key not in seen or seen[key] == iid, (k, iid, seen.get(key))
            seen[key] = iid
            assert graphics.icon_for(k) == iid, (k, iid, graphics.icon_for(k))


#: Real headings (channel tables, kv keys, card titles, bullets' first four words) and the icon each must get, or None.
FIXTURE = [
    ("Outdoor", "signpost-big"), ("Radio", "radio"), ("TV", "tv"), ("Television", "tv"), ("Cinema", "clapperboard"),
    ("Film", "film"), ("Press", "newspaper"), ("National press", "newspaper"), ("Paid search", "search"), ("Search", "search"),
    ("Email", "mail"), ("Newsletters", "mail"), ("Podcasts", "podcast"), ("In-store", "store"), ("Retail", "store"),
    ("PR", "megaphone"), ("Events", "calendar-days"), ("Experiential", "calendar-days"), ("Mobile", "smartphone"),
    ("Digital display", "monitor"), ("Social", "share-2"), ("Social media", "share-2"), ("Word of mouth", "message-circle"),
    ("Online video", "video"), ("BVOD", "video"), ("Magazines", "book-open"), ("Out of home", "signpost-big"),
    ("OOH", "signpost-big"), ("48-sheet", "signpost-big"), ("Streaming", "headphones"), ("Website", "globe"),
    ("Audience", "users"), ("Customers", "users"), ("Households", "house"), ("Budget", "wallet"), ("Timing", "calendar"),
    ("Measurement", "ruler"), ("Target", "target"), ("Partners", "handshake"), ("Risks", "triangle-alert"),
    ("Insight", "lightbulb"), ("Awareness", "eye"), ("Growth", "sprout"), ("Launch", "rocket"),
    ("Sustainability", "leaf"), ("Water", "droplet"), ("Journey", "map"), ("Strategy", "compass"),
    ("Data protection", "lock"), ("Recycling", "recycle"), ("Process", "workflow"), ("How we work", "workflow"),
    ("Cut household use by", "house"),
    # nothing fits: no icon, never a guess
    ("Fame", None), ("Reach", None), ("The tap tells", None), ("Make the line famous", None), ("Lumen", None),
    ("Story", None), ("Tone", None), ("Kick off", "flag"),
    # a keyword anywhere in the heading counts (whole words only)
    ("Every drop has a story", "droplet"), ("Lumen Water", "droplet"),
    # two different icons in one heading: ambiguous, none
    ("Social and search", None), ("Radio and TV", None), ("Budget and timing", None),
    # a brand is never an icon
    ("Facebook", None), ("YouTube", None), ("Instagram", None), ("TikTok", None),
    # a heading that names a result gets no icon that says which way it went, a verdict or an approval
    ("Sales falling 12%", None), ("Compliance", None), ("Quality", None), ("Approval", None), ("Waste", None),
]


@pytest.mark.parametrize("heading,want", FIXTURE)
def test_fixture_headings(heading, want):
    assert graphics.icon_for(heading) == want


def test_all_or_none_per_group():
    assert graphics.choose(["Outdoor", "Radio"]) == ["signpost-big", "radio"]
    assert graphics.choose(["Outdoor", "Radio", "Fame"]) is None             # one miss: the whole group goes without
    assert graphics.choose(["Outdoor", "Billboards"]) is None                # two items, one icon: none
    assert graphics.choose(["Outdoor"]) is None                              # a single item is not a group
    assert graphics.choose(["Social and search", "Radio"]) is None           # an ambiguous item counts as a miss
    assert graphics.choose([]) is None


def test_plurals_fold_and_short_words_stay():
    assert graphics.words("Stories, boxes; channels BUS press") == ["story", "box", "channel", "bus", "press"]


def test_point_headings_follow_statement_points():
    bl = [{"kind": "kv", "items": [["Audience", "Adults"], ["Budget", ""], ["Timing", "Spring"]]},
          {"kind": "bullets", "items": [{"text": "Cut household use by 5% in 12 months"}, ""]},
          {"kind": "quote", "text": "I care about water"},
          {"kind": "small", "basis": "meta", "text": spec.ILLUSTRATIVE_QUOTE},
          {"kind": "card", "title": "Partners", "text": "Who helps"}]
    heads = graphics.point_headings(bl)
    assert heads == ["Audience", "Timing", "Cut household use by", "", "Partners"]
    assert len(heads) == len(layouts.statement_points(bl))


# ================================================================================================ the freeform
def test_icon_xml_is_one_stroke_only_custgeom_freeform():
    el = etree.fromstring(graphics.icon_xml(7, "radio", 914400, 914400, 384048, "#1b2430", 0.42))
    assert el.tag == f"{P}sp"
    nv = el.find(f"{P}nvSpPr/{P}cNvPr")
    assert nv.get("id") == "7" and nv.get("name") == "Icon: radio"
    assert nv.find(f".//{{{graphics.DECORATIVE_NS}}}decorative").get("val") == "1"
    sp = el.find(f"{P}spPr")
    assert [c.tag for c in sp] == [f"{A}xfrm", f"{A}custGeom", f"{A}noFill", f"{A}ln"]   # CT_ShapeProperties order
    geom = sp.find(f"{A}custGeom")
    assert [c.tag for c in geom] == [f"{A}{t}" for t in ("avLst", "gdLst", "ahLst", "cxnLst", "rect", "pathLst")]
    paths = geom.findall(f"{A}pathLst/{A}path")
    assert len(paths) == len(graphics.icons()["radio"]["paths"]) == 5
    assert all(p.get("w") == p.get("h") == "24000" and p.get("fill") == "none" for p in paths)
    ops = {c.tag.split("}")[1] for p in paths for c in p}
    assert ops <= {"moveTo", "lnTo", "cubicBezTo", "close"} and "cubicBezTo" in ops
    ln = sp.find(f"{A}ln")
    assert ln.get("cap") == "rnd" and ln.find(f"{A}round") is not None
    assert ln.find(f"{A}solidFill/{A}srgbClr").get("val") == "1B2430"
    assert int(ln.get("w")) == round(graphics.line_pt(0.42) * 12700)
    assert el.find(f"{P}style") is None   # no theme style: no shadow, no effect, no fill from the master


def test_line_weight_floor_and_cap():
    assert graphics.line_pt(0.3) >= 1.0 and graphics.line_pt(0.36) < 2.0 and graphics.line_pt(0.5) == graphics.line_pt(2.0) == 2.0


def test_python_pptx_reads_the_icon_back_as_a_freeform(tmp_path):
    prs = Presentation()
    sl = prs.slides.add_slide(prs.slide_layouts[6])
    sl.shapes._spTree.append(etree.fromstring(graphics.icon_xml(sl.shapes._next_shape_id, "users", 0, 0, 457200, "1B2430", 0.5)))
    prs.save(tmp_path / "i.pptx")
    sh = next(s for s in Presentation(str(tmp_path / "i.pptx")).slides[0].shapes if s.name == "Icon: users")
    assert sh.shape_type == 5 and sh.width == sh.height == 457200   # MSO_SHAPE_TYPE.FREEFORM


def test_contrast_gate():
    assert graphics.stroke_ok("1B2430", "FAF7F1") and not graphics.stroke_ok("D9D3C7", "FAF7F1")
    assert T.contrast("1B2430", "FAF7F1") >= graphics.ICON_CONTRAST


# ================================================================================================ placement
def test_lumen_channel_rows_get_their_icons(gr, tmp_path):
    d = _deck()
    sid = _by_type(d)["channel_roles"]
    r, prs = _render(d, tmp_path)
    assert r.layouts[sid] in ("rows_aside", "picture_column")
    sl = prs.slides[d["order"].index(sid)]
    assert _icons_on(sl) == ["signpost-big", "radio"] and r.icons_drawn[sid]["ids"] == ["signpost-big", "radio"]
    icons = [sh for sh in sl.shapes if sh.name.startswith("Icon: ")]
    assert all(abs(sh.width - 0.42 * 914400) < 2 for sh in icons)
    cells = [sh for sh in sl.shapes if sh.name == "slot:rows" and sh.text_frame.text.strip() in ("Outdoor", "Radio")]
    for ic, cell in zip(icons, cells):   # the icon sits in front of its row's first cell, never on it
        assert ic.left + ic.width <= cell.left and ic.top >= cell.top - 10 and ic.top < cell.top + cell.height
    # the measurement rows (a table of measures) take none, and only channel roles carry row icons
    assert not _icons_on(prs.slides[d["order"].index(_by_type(d)["measurement"])])


def test_statement_points_take_icons_only_when_every_point_matches(gr, tmp_path):
    d = _deck()
    sid = _by_type(d)["insight"]
    s = d["slides"][sid]
    s["blocks"] = [{"kind": "kv", "items": [["Audience", "Adults 25 to 54 in the region"], ["Budget", "Held at last year's level"],
                                            ["Timing", "Spring, before the summer peak"]]}]
    planned, _, _ = layouts.plan(d, prefs={"density": "lean"})
    assert planned["slides"][sid]["layout"]["id"] == "statement_points"
    r, prs = _render(planned, tmp_path)
    sl = prs.slides[planned["order"].index(sid)]
    assert _icons_on(sl) == ["users", "wallet", "calendar"]
    pts = [sh for sh in sl.shapes if sh.name == "slot:points"]
    for ic in [sh for sh in sl.shapes if sh.name.startswith("Icon: ")][-2:]:   # each icon above its point's words, in the points column
        assert any(ic.left == p.left and ic.top + ic.height <= p.top for p in pts)
    # one point no keyword names: the group goes without
    planned["slides"][sid]["blocks"][0]["items"][2][0] = "Tone"
    planned2, _, _ = layouts.plan(planned, prefs={"density": "lean"})
    r2, prs2 = _render(planned2, tmp_path, "b.pptx")
    assert not _icons_on(prs2.slides[planned2["order"].index(sid)])


def test_tenders_and_a_deck_preference_turn_icons_off(gr, tmp_path):
    assert profiles.load("tender_response")["recipe"]["graphics"] == {"icons": False}
    assert profiles.recipe_errors({"graphics": {"icons": False, "mockups": True}}, []) == []
    assert profiles.recipe_errors({"graphics": {"charts": True}}, [])   # charts and diagrams have no switch: they follow the deck's data
    assert profiles.recipe_errors({"graphics": {"icons": "no"}}, []) and profiles.recipe_errors({"graphics": {"logos": True}}, [])
    d = _deck()
    d["meta"]["built_from"] = {**(d["meta"].get("built_from") or {}), "type": "tender_response"}
    assert not graphics.icons_on(d)
    r, prs = _render(d, tmp_path)
    assert not any(_icons_on(sl) for sl in prs.slides)
    d2 = _deck()
    d2["meta"]["preferences"] = {**(d2["meta"].get("preferences") or {}), "look": {"graphics": {"icons": False}}}
    assert not graphics.icons_on(d2)
    d3 = _deck()
    assert graphics.icons_on(d3)


def test_no_icon_on_ink_without_contrast(gr, tmp_path, monkeypatch):
    d = _deck()
    r = R.Renderer(d, Inputs(brief={}), theme="napkin")
    r.p = r._palette(False)
    monkeypatch.setattr(graphics, "stroke_ok", lambda a, b: False)
    assert r._icon_ids(["Outdoor", "Radio"]) is None


# ================================================================================================ the web twin
def test_web_draws_exactly_the_pptx_icons(gr, tmp_path):
    d = _deck()
    icons = {}
    R.render(d, Inputs(brief={}), tmp_path / "d.pptx", icons=icons)
    assert icons
    out = render_web.render(d, Inputs(brief={}), tmp_path / "deck.html", icons=icons)
    html = out.read_text()
    for sid, v in icons.items():
        sec = re.search(rf'id="{sid}".*?</section>', html, flags=re.S).group(0)
        assert re.findall(r'data-icon="([a-z0-9-]+)"', sec) == v["ids"], sid
    assert html.count('data-icon="') == sum(len(v["ids"]) for v in icons.values())
    svg = re.search(r'<svg class="icon" data-icon="signpost-big"[^>]*>.*?</svg>', html).group(0)
    assert 'stroke="currentColor"' in svg and 'aria-hidden="true"' in svg and 'fill="none"' in svg
    assert graphics.svg_d("signpost-big") in svg   # the same path data the pptx draws


def test_web_without_icons_is_unchanged(v3, tmp_path):
    d = _deck()
    a = render_web.render(d, Inputs(brief={}), tmp_path / "a.html").read_text()
    b = render_web.render(d, Inputs(brief={}), tmp_path / "b.html", icons={}).read_text()
    assert a == b and "data-icon" not in a and "svg.icon" not in a


# ================================================================================================ the checklist
def _run_dir(tmp_path, d, prs_path):
    run = tmp_path / "run"
    run.mkdir(parents=True, exist_ok=True)
    (run / "deck.json").write_text(json.dumps(d))
    (run / "deck.pptx").write_bytes(Path(prs_path).read_bytes())
    return run


def _doctor(src, dst, fn):
    prs = Presentation(str(src))
    for sl in prs.slides:
        for sh in list(sl.shapes):
            if sh.name.startswith("Icon: "):
                fn(sh)
    prs.save(str(dst))


def test_icon_checks_pass_on_a_good_render_and_fail_on_a_doctored_one(gr, tmp_path):
    d = _deck()
    r, _ = _render(d, tmp_path)
    good = cl.run_checklist(_run_dir(tmp_path / "g", d, tmp_path / "d.pptx"))["results"]
    for i in ("i_icon_allowlist", "i_icon_contrast", "i_icon_groups", "i_icon_share"):
        assert good[i]["answer"] == "yes", (i, good[i])

    def brand(sh):
        sh.name = "Icon: facebook"
    _doctor(tmp_path / "d.pptx", tmp_path / "b.pptx", brand)
    assert cl.run_checklist(_run_dir(tmp_path / "b", d, tmp_path / "b.pptx"))["results"]["i_icon_allowlist"]["answer"] == "no"

    def faint(sh):
        sh._element.find(f".//{A}ln/{A}solidFill/{A}srgbClr").set("val", "F2EEE6")
    _doctor(tmp_path / "d.pptx", tmp_path / "c.pptx", faint)
    assert cl.run_checklist(_run_dir(tmp_path / "c", d, tmp_path / "c.pptx"))["results"]["i_icon_contrast"]["answer"] == "no"

    def same(sh):
        sh.name = "Icon: radio"
    _doctor(tmp_path / "d.pptx", tmp_path / "s.pptx", same)
    assert cl.run_checklist(_run_dir(tmp_path / "s", d, tmp_path / "s.pptx"))["results"]["i_icon_groups"]["answer"] == "no"


def test_icon_checks_are_na_without_icons(v3, tmp_path):
    d = _deck()
    _render(d, tmp_path)
    res = cl.run_checklist(_run_dir(tmp_path / "n", d, tmp_path / "d.pptx"))["results"]
    assert all(res[i]["answer"] == "n/a" for i in ("i_icon_allowlist", "i_icon_contrast", "i_icon_groups", "i_icon_share"))


def test_icon_share_counts_windows_of_ten():
    class FakeRun:
        presented = [f"s{i}" for i in range(1, 13)]
        ids = presented
        items = {"i_icon_share": {"threshold": {"max_slides": 3, "window": 10}}}
        _measures = {"icons": {f"s{i}": [("radio", None, None)] for i in (1, 2, 3, 4)}}
        prs = object()
    assert cl.i_icon_share(FakeRun())["answer"] == "no"
    FakeRun._measures = {"icons": {f"s{i}": [("radio", None, None)] for i in (1, 2, 12)}}
    assert cl.i_icon_share(FakeRun())["answer"] == "yes"


def test_policy_file_is_the_documented_shape():
    raw = yaml.safe_load((Path(graphics.__file__).parent / "policy" / "icons.yaml").read_text())
    assert set(raw) == {"icons"} and all(isinstance(v, list) and v for v in raw["icons"].values())
    assert sum(len(v) for v in raw["icons"].values()) >= 150
