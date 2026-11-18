"""deck-look steps 1-2 (spec.LOOK_V3): the sans pair with measured, fallback-safe widths; the section band and 0.75 pt hairlines
on the existing layouts, in pptx and on the web. Offline. With the flag off (the default) nothing changes."""
from __future__ import annotations

import json
import re
from collections import Counter
from pathlib import Path

import pytest
from pptx import Presentation
from pptx.util import Pt

from deck import qa_render, render_pptx as R, render_web, spec
from deck import theme as T
from deck.inputs import Inputs

FIX = Path(__file__).parent / "fixtures" / "lumen_water"
FONTS = Path(R.__file__).resolve().parent / "fonts"


def _deck():
    return json.loads((FIX / "golden_deck.json").read_text())


def _render(tmp_path, name="d.pptx"):
    out = tmp_path / name
    r = R.Renderer(_deck(), Inputs(brief={}), theme="napkin")
    r.render(out)
    return r, Presentation(str(out))


@pytest.fixture
def v3(monkeypatch):
    monkeypatch.setattr(spec, "LOOK_V3", True)


def _words(sl):
    txt = " ".join(" ".join(p.text for p in sh.text_frame.paragraphs) for sh in sl.shapes if sh.has_text_frame)
    return Counter(re.findall(r"[A-Za-z0-9%€]+", txt.lower()))


# ---- the flag ------------------------------------------------------------------------------------
def test_flag_default_is_off(monkeypatch):
    monkeypatch.delenv("DECK_LOOK_V3", raising=False)
    import importlib
    try:
        assert importlib.reload(spec).LOOK_V3 is False
    finally:
        importlib.reload(spec)


def test_flag_off_keeps_the_old_look(tmp_path):
    assert not spec.LOOK_V3
    r, prs = _render(tmp_path)
    names = {sh.name for sl in prs.slides for sh in sl.shapes}
    assert "Band" not in names and "BandRule" not in names
    faces = {run.font.name for sl in prs.slides for sh in sl.shapes if sh.has_text_frame for p in sh.text_frame.paragraphs for run in p.runs}
    assert faces <= {"Cambria", "Calibri"}
    assert r.th.head == "Cambria" and not r.th.v3


# ---- step 1: fonts and tokens --------------------------------------------------------------------
def test_theme_fonts_resolved_under_flag(v3):
    t = T.get_theme("napkin")
    assert (t.head, t.body, t.v3) == ("Archivo", "Source Sans 3", True)
    assert T.get_theme("classic").head == "Cambria"   # classic never changes
    assert T.get_theme("napkin", {"head": "Georgia"}).head == "Georgia"   # a brand's own font still wins
    assert T.check_palette(t) == []


def test_vendored_fonts_and_licences():
    for d, ttf in (("Archivo", "Archivo[wdth,wght].ttf"), ("SourceSans3", "SourceSans3[wght].ttf")):
        assert (FONTS / d / ttf).stat().st_size > 100_000
        assert "SIL OPEN FONT LICENSE Version 1.1" in (FONTS / d / "OFL.txt").read_text()


def test_font_names_inside_the_files():
    tt = pytest.importorskip("fontTools.ttLib")
    for d, ttf, fam in (("Archivo", "Archivo[wdth,wght].ttf", "Archivo"), ("SourceSans3", "SourceSans3[wght].ttf", "Source Sans 3")):
        assert tt.TTFont(str(FONTS / d / ttf))["name"].getDebugName(16) in (fam, None) and (tt.TTFont(str(FONTS / d / ttf))["name"].getDebugName(16) or tt.TTFont(str(FONTS / d / ttf))["name"].getDebugName(1)).startswith(fam)


def test_widths_json_matches_the_font_files():
    pytest.importorskip("fontTools")
    if not Path("/System/Library/Fonts/Supplemental/Arial.ttf").exists():
        pytest.skip("Arial (the fallback) is not on this machine")
    import importlib.util
    spec_ = importlib.util.spec_from_file_location("measure_widths", FONTS / "measure_widths.py")
    m = importlib.util.module_from_spec(spec_)
    spec_.loader.exec_module(m)
    assert m.measure() == json.loads((FONTS / "widths.json").read_text())


def test_fit_width_is_the_wider_of_font_and_fallback():
    for font in (T.LOOK_HEAD, T.LOOK_BODY):
        for bold in (False, True):
            own, fb = T.measured_wf(font, bold), T.measured_wf("Arial", bold)
            assert T.fit_wf(font, bold) == round(max(own, fb) * T.WIDTH_MARGIN, 4)
            assert T.fit_wf(font, bold) >= fb * T.WIDTH_MARGIN - 1e-3   # never narrower than the fallback
    assert T.measured_wf(T.LOOK_BODY) < T.measured_wf("Arial")   # so the fallback is the binding one, and the test is not vacuous
    assert T.fit_wf("Cambria") is None   # a font never measured keeps the renderer's old estimate


def test_wrap_fits_under_the_fallback_width(v3, tmp_path):
    r = R.Renderer(_deck(), Inputs(brief={}), theme="napkin")
    text, size = "w" * 60, 36
    arial_w = 60 * size * T.measured_wf("Arial", True) / 72     # exactly as wide as Arial Bold would set it
    assert r.nlines(text, arial_w - 0.01, size, True, r.th.head) == 2   # Archivo alone would fit; Arial would not: so it wraps
    assert r._wf(True, r.th.head) == T.fit_wf("Archivo", True)
    assert qa_render.glyph_k("Source Sans 3", False) == T.fit_wf("Source Sans 3")
    assert qa_render.glyph_k("Cambria", True) == pytest.approx(0.58)   # other fonts: the old QA estimate


def test_every_run_is_in_the_sans_pair(v3, tmp_path):
    _, prs = _render(tmp_path)
    faces = {run.font.name for sl in prs.slides for sh in sl.shapes if sh.has_text_frame for p in sh.text_frame.paragraphs for run in p.runs}
    assert faces <= {"Archivo", "Source Sans 3"}, faces


# ---- step 2: band and hairlines ------------------------------------------------------------------
def test_band_present_and_never_the_title(v3, tmp_path):
    r, prs = _render(tmp_path)
    deck = r.deck
    banded = 0
    for sid, sl in zip(deck["order"], prs.slides):
        s = deck["slides"][sid]
        names = [sh.name for sh in sl.shapes]
        if s["type"] in ("title", "close"):
            continue
        if "Band" not in names:
            continue
        banded += 1
        label = next(sh for sh in sl.shapes if sh.name == "Band").text_frame.text
        norm = lambda t: re.sub(r"\W+", " ", t).strip().lower()
        assert label and norm(label) != norm(s["title"])
        assert label[0].isupper() and not label.isupper()   # sentence case
        assert names.count("BandRule") == 2
    assert banded >= 10


def test_band_label_rules():
    meta = {"project": "National awareness campaign"}
    assert R.band_label({"title": "Objective", "section": "Objective"}, meta) == "National awareness campaign"
    assert R.band_label({"title": "x", "section": "Insight"}, meta) == "Insight"
    assert R.band_label({"title": "National awareness campaign", "section": "national  awareness campaign!"}, meta) == ""


def test_no_edge_stripes_or_ticks(v3, tmp_path):
    r, prs = _render(tmp_path)
    accents = r._accent_fills()
    hair = 0
    for sl in prs.slides:
        for sh in sl.shapes:
            if sh.shape_type == 9 or sh.name in ("Hairline", "BandRule"):   # a line (the shift line's two-stop line is the one heavier rule)
                assert sh.line.width == (Pt(3.8) if sh.name == "StopLine" else Pt(0.75)), sh.name
                hair += 1
                continue
            if sh.shape_type == 1 and sh.fill.type == 1:   # an autoshape with a solid fill
                fill = str(sh.fill.fore_color.rgb)
                thin = min(sh.width, sh.height) / 914400 <= 0.12
                assert not (thin and fill in accents), (sh.name, fill)
                assert not (abs(sh.width / 914400 - 0.5) < 1e-3 and sh.height / 914400 <= 0.06)   # the accent tick
    assert hair > 20


def test_flag_off_still_draws_the_stripes(tmp_path):
    r, prs = _render(tmp_path)
    accents = r._accent_fills()
    assert any(sh.shape_type == 1 and sh.fill.type == 1 and str(sh.fill.fore_color.rgb) in accents and min(sh.width, sh.height) / 914400 <= 0.12
               for sl in prs.slides for sh in sl.shapes)


def test_figures_are_ink_not_accent(v3, tmp_path):
    r, prs = _render(tmp_path)
    t = r.th
    for sid, sl in zip(r.deck["order"], prs.slides):
        if r.deck["slides"][sid]["type"] != "objective":
            continue
        runs = [run for sh in sl.shapes if sh.has_text_frame for p in sh.text_frame.paragraphs for run in p.runs if re.fullmatch(r"\d+%", run.text.strip())]
        assert runs
        for run in runs:
            assert str(run.font.color.rgb) == t.ink


def test_title_sits_under_the_band(v3, tmp_path):
    r, prs = _render(tmp_path)
    for sid, sl in zip(r.deck["order"], prs.slides):
        names = {sh.name for sh in sl.shapes}
        if "Band" in names and "Title" in names:
            title = next(sh for sh in sl.shapes if sh.name == "Title")
            rule = max(sh.top for sh in sl.shapes if sh.name == "BandRule")
            assert title.top >= rule


def test_no_word_is_lost_by_the_reskin(tmp_path, monkeypatch):
    """Every word a slide showed before is still on the slide (or in its notes) after: the band only adds."""
    _, before = _render(tmp_path, "a.pptx")
    monkeypatch.setattr(spec, "LOOK_V3", True)
    r2, after = _render(tmp_path, "b.pptx")
    after_deck = r2.deck
    for i, (a, b) in enumerate(zip(before.slides, after.slides), 1):
        label = Counter(re.findall(r"[A-Za-z0-9%€]+", after_deck["slides"][after_deck["order"][i - 1]]["section"].lower()))   # the engine's own section label moves to the band
        lost = _words(a) - (_words(b) + Counter(re.findall(r"[A-Za-z0-9%€]+", b.notes_slide.notes_text_frame.text.lower())) + label)
        lost -= Counter({"proposed": lost.get("proposed", 0)})   # the placeholder card's PROPOSED tag is an engine mark: the reworked close (step 4) tags a dashed row 'To supply', and the words still begin 'Proposed (not given by the client)'
        assert not lost, (i, dict(lost))


# ---- the web --------------------------------------------------------------------------------------
def test_web_band_and_fonts(v3, tmp_path):
    deck = _deck()
    out = tmp_path / "deck.html"
    render_web.render(deck, Inputs(brief={}), out)
    html = out.read_text()
    pairs = re.findall(r'aria-label="Slide \d+: ([^"]*)">.*?<div class="band">([^<]*)</div>', html, flags=re.S)
    assert len(pairs) >= 10
    norm = lambda t: re.sub(r"\W+", " ", t).lower().strip()
    assert all(norm(b) != norm(t) for t, b in pairs)
    assert "'Archivo'" in html and "Source Sans 3" in html and "Cambria" not in html.split("</style>")[0].split(":root")[1].split("--ease")[0]
    assert "border-left:0" in html and ".kicker{display:none}" in html
    assert (tmp_path / "fonts" / "Archivo" / "OFL.txt").exists()


def test_web_flag_off_is_unchanged(tmp_path):
    out = tmp_path / "deck.html"
    render_web.render(_deck(), Inputs(brief={}), out)
    html = out.read_text()
    assert 'class="band"' not in html and "Archivo" not in html and not (tmp_path / "fonts").exists()
