"""The design quick wins (Fable 5.2's final review, 2026-11-18): a clean cover, numbers as people write them, sparse slides centred, the execution picture at half width.

Words are fixed throughout: every test that moves or reshapes something also checks that nothing was dropped (the line is in the notes, the words_sha is equal)."""
from __future__ import annotations

import contextlib
import io
import json
from pathlib import Path

import pytest
from pptx import Presentation
from pptx.util import Emu

from deck import imagegen, render_pptx, run_deck

FX = Path(__file__).with_name("fixtures") / "lumen_water"
BASE = ["--stages", str(FX), "--brief", str(FX / "brief_object.json"), "--client", "Lumen Water", "--project", "National awareness campaign", "--no-qa"]


@pytest.fixture(autouse=True)
def _withhold_failing_clients(monkeypatch):
    """This module tests the withholding itself: it is on here, off for the rest of the suite (conftest)."""
    monkeypatch.setattr(run_deck, "WITHHOLD_FAILING_CLIENT", True, raising=False)


def build(out: Path, *extra) -> Path:
    saved = (run_deck.subprocess.run, run_deck._soffice)
    run_deck.subprocess.run, run_deck._soffice = (lambda *a, **k: None), (lambda: "soffice")
    try:
        with contextlib.redirect_stdout(io.StringIO()):
            run_deck.main([*BASE, "--out", str(out), *extra])
    finally:
        run_deck.subprocess.run, run_deck._soffice = saved
    return out


def slide_words(prs, n: int) -> str:
    return "\n".join(sh.text_frame.text for sh in prs.slides[n].shapes if sh.has_text_frame).replace("\xa0", " ")


def notes_of(prs, n: int) -> str:
    return prs.slides[n].notes_slide.notes_text_frame.text


def jdeck(out: Path) -> dict:
    return json.loads((out / "deck.json").read_text())


# ---------------------------------------------------------------- 1a: a clean cover

def test_the_cover_moves_unresolved_placeholder_lines_to_the_notes_and_drops_nothing(tmp_path):
    out = build(tmp_path / "o")
    prs = Presentation(str(out / "deck.pptx"))
    face, notes = slide_words(prs, 0), notes_of(prs, 0)
    for gone in ("Proposed (not given", "[presenter and date]", "[Agency]", "A response from"):
        assert gone not in face, f"{gone!r} is still on the cover"
    assert "Moved from the slide" in notes and "[presenter and date]" in notes and "A response from [Agency]" in notes   # labelled, verbatim, not dropped
    s = jdeck(out)["slides"]["s01"]
    assert [b["text"] for b in s["blocks"]][0] == "A response from [Agency]" and "Proposed (not given" in s["blocks"][1]["text"]   # deck.json is unchanged


def test_a_known_agency_keeps_its_line_on_the_cover(tmp_path):
    out = build(tmp_path / "o", "--agency", "Fernley & Co")
    prs = Presentation(str(out / "deck.pptx"))
    assert "A response from Fernley & Co" in slide_words(prs, 0)
    assert "Proposed (not given" not in slide_words(prs, 0) and "Proposed (not given" in notes_of(prs, 0)


def test_with_no_notes_nothing_leaves_the_cover(tmp_path):
    out = build(tmp_path / "o", "--no-notes")
    assert "Proposed (not given" in slide_words(Presentation(str(out / "deck.pptx")), 0)


def test_the_words_sha_does_not_move_with_the_cover_fix(tmp_path):
    a, b = jdeck(build(tmp_path / "a")), jdeck(build(tmp_path / "b", "--no-layout-plan"))
    assert imagegen.words_sha(a) == imagegen.words_sha(b)


# ---------------------------------------------------------------- 1b: no check ids on a client slide; a failing client build is withheld

def test_a_client_render_never_prints_check_ids_but_a_review_render_keeps_them(tmp_path):
    import test_render_layouts as TL
    findings = [{"check": "internal_leak", "level": "error", "slide": "s05", "message": "x"}]
    for aud, shown in (("client", False), ("review", True)):
        deck = TL._deck()
        deck["meta"]["audience"] = aud
        out = render_pptx.render(deck, TL._inp(), tmp_path / f"{aud}.pptx", findings=findings)
        text = "\n".join(slide_words(Presentation(str(out)), i) for i in range(len(deck["order"])))
        assert ("CHECK FAILED" in text) is shown, aud
        assert "internal_leak" not in text or shown


def test_a_failing_client_build_is_withheld_and_the_reason_is_in_report_json(tmp_path):
    out = tmp_path / "o"
    build(out, "--audience", "client")
    assert not (out / "deck.pptx").exists() and not (out / "deck.html").exists(), "a failing client build must write no deliverable"
    rep = json.loads((out / "report.json").read_text())
    w = rep["withheld"]
    assert "internal_leak" in w["checks"] and w["errors"] >= 1 and "withheld" in w["reason"]


def test_a_withheld_build_removes_what_an_earlier_build_left(tmp_path):
    out = build(tmp_path / "o")            # a review build writes a pptx
    assert (out / "deck.pptx").exists()
    build(out, "--audience", "client")     # the client build into the same folder is withheld: the old file must not stay
    assert not (out / "deck.pptx").exists() and not (out / "deck.html").exists()


def test_a_review_build_still_renders_with_its_marks(tmp_path):
    out = build(tmp_path / "o")
    assert (out / "deck.pptx").exists() and "withheld" not in json.loads((out / "report.json").read_text())


# ---------------------------------------------------------------- 1c: numbers as people write them

def test_money_is_formatted_in_the_currency_of_the_source():
    from deck import numfmt
    f = numfmt.format_text
    assert f("a seed round of 1500000 euro") == "a seed round of €1.5m"
    assert f("1,500,000 euros") == "€1.5m"
    assert f("EUR 1500000") == "EUR 1,500,000" and f("1500000 EUR") == "EUR 1,500,000"
    assert f("250000 euro") == "€250,000" and f("2000000 dollars") == "$2m" and f("1250000 pounds") == "£1.25m"
    assert f("€1500000") == "€1.5m"
    for same in ("5 weeks", "12 farms", "€1.5m", "40%", "Q3 2027", "a euro coin"):
        assert f(same) == same
    assert f(f("1500000 euro")) == f("1500000 euro")   # idempotent


def test_formatting_never_changes_a_value():
    from deck import numfmt
    import re
    for n in (1000, 1500, 99999, 1000000, 1234567, 1500000, 2500000, 12000000, 1000000000, 2340000000):
        got = numfmt.format_text(f"{n} euro")
        m = re.fullmatch(r"€([\d,\.]+)(m|bn)?", got)
        v = float(m.group(1).replace(",", "")) * {"m": 1e6, "bn": 1e9, None: 1}[m.group(2)]
        assert v == n, (n, got)


def test_the_investor_deck_shows_a_formatted_figure_but_stores_the_source_words(tmp_path):
    from deck.bench import fixtures
    out = fixtures.build_one("investor_seed", tmp_path / "i", geometry_only=True)
    prs = Presentation(str(out / "deck.pptx"))
    shown = "\n".join(slide_words(prs, i) for i in range(len(prs.slides)))
    assert "1500000" not in shown and "€1.5m" in shown
    assert "1500000 euro" in (out / "deck.json").read_text()   # the stored words are untouched
    assert "1500000" not in (out / "deck.html").read_text() or "€1.5m" in (out / "deck.html").read_text()


# ---------------------------------------------------------------- 2: centre and grow sparse slides; thin tables and timelines fall back

def _content_span(prs, n: int):
    """Top and bottom (inches) of what a slide draws below its title and above its footer, and the title's bottom edge."""
    sl = prs.slides[n]
    title = next(sh for sh in sl.shapes if sh.name == "Title")
    tb = Emu(title.top + title.height).inches
    spans = [(Emu(sh.top).inches, Emu(sh.top + sh.height).inches) for sh in sl.shapes
             if sh.name not in ("Title", "Section", "SlideNumber", "Footnotes", "Watermark", "CheckFailed", "Caption") and Emu(sh.top).inches > tb - 0.01 and Emu(sh.top).inches < 6.8]   # the footer rule at 6.9 in is not content
    return tb, min(a for a, _ in spans), max(b for _, b in spans)


def test_a_sparse_slide_is_centred_in_the_body(tmp_path):
    out = build(tmp_path / "o")
    prs = Presentation(str(out / "deck.pptx"))
    d = jdeck(out)
    from deck import theme
    body_end = theme.Grid().body_end
    sparse = 0
    for n, sid in enumerate(d["order"]):
        lay = json.loads((out / "layouts.json").read_text())["slides"][sid]["id"]
        if lay != "cards":
            continue
        tb, lo, hi = _content_span(prs, n)
        if (hi - lo) / (body_end - tb) < 0.40:
            sparse += 1
            mid, want = (lo + hi) / 2, (tb + body_end) / 2
            assert abs(mid - want) <= 0.4, f"{sid}: content centre {mid:.2f} in, body centre {want:.2f} in"
    assert sparse >= 2, "the fixture must hold sparse slides for this test to mean anything"


def _thin(kind: str):
    if kind == "table":
        return {"type": "measurement", "title": "How we will know it worked", "blocks": [{"kind": "table", "rows": [["What we measure", "Baseline", "How"], ["Household use", "To set before launch", "Utility meter data"]]}]}
    return {"type": "timeline", "title": "How it unfolds", "blocks": [{"kind": "steps", "items": [["Plan", "Month 1"]]}]}


@pytest.mark.parametrize("kind", ["table", "steps"])
def test_a_one_row_table_and_a_one_step_timeline_fall_back_to_a_big_statement(kind):
    from deck import layouts
    s = _thin(kind)
    assert layouts.pick_planned(s) == "big_statement" and layouts.pick(s) != "big_statement"   # --no-layout-plan keeps today's choice
    fat = {**s, "blocks": [{"kind": "table", "rows": [["a", "b"], ["c", "d"], ["e", "f"]]}]} if kind == "table" else {**s, "blocks": [{"kind": "steps", "items": [["a", "b"], ["c", "d"]]}]}
    assert layouts.pick_planned(fat) != "big_statement"


@pytest.mark.parametrize("sid,words", [("s12", ["What we measure", "Household use", "Baseline", "None in the brief: set before launch", "How", "Utility meter data"]),
                                       ("s13", ["Plan", "Month 1"])])
def test_the_thin_slides_of_the_fixture_are_drawn_big_with_every_word_and_the_same_words_sha(tmp_path, sid, words):
    out = build(tmp_path / "o")
    d = jdeck(out)
    assert json.loads((out / "layouts.json").read_text())["slides"][sid]["id"] == "big_statement"
    shown = slide_words(Presentation(str(out / "deck.pptx")), d["order"].index(sid))
    for w in words:
        assert w in shown, f"{w!r} was dropped from {sid}"
    assert imagegen.words_sha(d) == imagegen.words_sha(jdeck(build(tmp_path / "b", "--no-layout-plan")))


# ---------------------------------------------------------------- 3: the execution picture at half width

DEMO = Path(__file__).with_name("fixtures") / "frames_demo"


def _picture_of(prs, n: int):
    from pptx.enum.shapes import MSO_SHAPE_TYPE
    return [sh for sh in prs.slides[n].shapes if sh.shape_type == MSO_SHAPE_TYPE.PICTURE]


def test_the_execution_picture_takes_half_the_slide_at_full_content_height(demo_stages, build_demo, tmp_path):
    from deck import theme
    run = build_demo(demo_stages, tmp_path / "o", "--pictures", "creative", "--image", f"s12.picture={DEMO / 'cover.png'}", "--image-rights", "s12.picture=own")
    prs = Presentation(str(run / "deck.pptx"))
    n = jdeck(run)["order"].index("s12")
    lay = json.loads((run / "layouts.json").read_text())["slides"]["s12"]
    assert lay["id"] == "execution_visual" and not lay["fallback"], lay
    pic, = _picture_of(prs, n)
    g = theme.Grid()
    content_w, w, h, left = g.W - 2 * g.M, Emu(pic.width).inches, Emu(pic.height).inches, Emu(pic.left).inches
    assert h >= (g.body_end - 1.74) - 0.1, f"the picture is {h:.2f} in tall, the content area {g.body_end - 1.74:.2f} in"
    assert w >= 0.42 * content_w or h * 0.8 <= w + 0.05, f"the picture is {w:.2f} in wide: about half the slide is {content_w / 2:.2f} in (a tall picture keeps its shape)"
    assert left + w <= g.W - g.M + 0.01 and left >= g.W / 2 - 0.2, "the picture sits in the right half"
    text = slide_words(prs, n)
    assert "Illustrative" in text   # still labelled
    shown = "\n".join(sh.text_frame.text for sh in prs.slides[n].shapes if sh.has_text_frame)
    assert "Image prompt" not in shown


# ---------------------------------------------------------------- the plan does not depend on the hash seed

def test_the_layout_plan_is_the_same_under_any_hash_seed(tmp_path):
    """A tie in the variety pass once went to whichever string a set held first (PYTHONHASHSEED): the same deck planned two ways."""
    import os
    import subprocess
    import sys
    code = ("import sys, hashlib, json; from pathlib import Path; from deck.bench import fixtures; "
            "o = fixtures.build_one('agency_pitch', Path(sys.argv[1]), geometry_only=True); "
            "print(hashlib.sha256((o / 'layouts.json').read_bytes()).hexdigest())")
    got = set()
    for seed in ("1", "2", "3"):
        r = subprocess.run([sys.executable, "-c", code, str(tmp_path / f"s{seed}")], cwd=Path(__file__).parents[2], capture_output=True, text=True,
                           env={**os.environ, "PYTHONHASHSEED": seed, "PYTHONPATH": str(Path(__file__).parents[2]), "BRIEF_TESTS_OFFLINE": "1"})
        assert r.returncode == 0, r.stderr[-400:]
        got.add(r.stdout.strip().splitlines()[-1])
    assert len(got) == 1, got
