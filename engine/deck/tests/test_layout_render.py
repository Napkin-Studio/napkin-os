"""Every layout draws: a full slide, an empty one and a worst-glyph one, with nothing past the slide, no type under its floor, no fallback to the
flow and no pictureless gap (deck-layout-library). Offline: the pptx is read back, no LibreOffice.
"""
from __future__ import annotations

import copy
import json
from pathlib import Path

import pytest
from pptx import Presentation

from deck import layouts, render_pptx, spec
from deck.inputs import Inputs

GOLD = json.loads((Path(__file__).with_name("fixtures") / "lumen_water" / "golden_deck.json").read_text())
LIB = layouts.load()
WORST = "WWMMWMWM mmwwMMW WWWWMMMM "
#: A block a layout needs beside the slot under test (its other required content).
COMPANION = {"cards_split": [{"kind": "bullets", "items": [{"text": "a first point"}, {"text": "a second point"}]}],
             "execution": [{"kind": "copy", "lines": ["A line of copy."], "answer": "Poster"}],
             "execution_stack": [{"kind": "copy", "lines": ["A line of copy."], "answer": "Poster"}],
             "quote_full": [{"kind": "quote", "text": "A short quote."}],
             "text_columns": [{"kind": "text", "text": "A second column."}],
             "placeholder_split": [{"kind": "bullets", "items": [{"text": "to supply", "human": True}, {"text": "also to supply", "human": True}]}],
             }
#: The chart layouts need a chart block whose series cite facts: their drawing is covered by test_render_layouts (the Fernley chart slide).
NO_PICTURE = [lid for lid, lay in LIB.items() if not any(s.get("required") for _, s in layouts.image_slots(lay)) and lid not in ("chart", "chart_full")]


def _one_slide_deck(lay: dict, blocks: list, title="A short title") -> tuple:
    d = copy.deepcopy(GOLD)
    sid = d["order"][4]
    s = d["slides"][sid]
    s["type"], s["status"], s["title"], s["blocks"], s["claims"] = lay["for_types"][0], "drafted", title, blocks, []
    s.pop("layout", None), s.pop("slots", None)
    d["order"] = [d["order"][0], sid]
    d["slides"] = {k: d["slides"][k] for k in d["order"]}
    return d, sid


def _drawn(d: dict, sid: str, lid: str, tmp_path, notes=True) -> tuple:
    p, issues, _ = layouts.plan(d, swaps={sid: lid})
    out = tmp_path / "d.pptx"
    r = render_pptx.Renderer(p, Inputs(brief={}))
    r.render(out)
    return r, Presentation(str(out)), p


def _inside_and_legible(prs):
    W, H = prs.slide_width, prs.slide_height
    for i, sl in enumerate(prs.slides, 1):
        for sh in sl.shapes:
            assert sh.left >= 0 and sh.top >= 0 and sh.left + sh.width <= W + 10 and sh.top + sh.height <= H + 10, (i, sh.name)
            if sh.has_text_frame:
                for p in sh.text_frame.paragraphs:
                    for run in p.runs:
                        if run.text.strip():
                            assert run.font.size is not None and run.font.size.pt >= 10, (i, sh.name, run.font.size)


@pytest.mark.parametrize("lid", NO_PICTURE)
def test_each_layout_draws_a_worst_glyph_slot_at_its_max_chars_without_falling_back(lid, tmp_path):
    lay = LIB[lid]
    kinds_seen = 0
    for name, sl in lay["slots"].items():
        if name == "title" or sl["kind"] != "text" or not sl.get("max_chars"):
            continue
        kinds_seen += 1
        kind = (sl.get("from_blocks") or ["text"])[0]
        text = (WORST * 60)[: sl["max_chars"]].strip()
        d, sid = _one_slide_deck(lay, [{"kind": kind, "text": text}, *COMPANION.get(lid, [])])
        r, prs, p = _drawn(d, sid, lid, tmp_path)
        _inside_and_legible(prs)
        assert r.layouts[sid] == lid or p["slides"][sid]["layout"]["id"] != lid, (lid, name, "fell back to the flow")


@pytest.mark.parametrize("lid", NO_PICTURE)
def test_each_layout_draws_a_slide_with_only_a_title(lid, tmp_path):
    lay = LIB[lid]
    d, sid = _one_slide_deck(lay, list(COMPANION.get(lid, [])), "A title and nothing else")
    r, prs, p = _drawn(d, sid, lid, tmp_path)
    _inside_and_legible(prs)
    texts = " ".join(sh.text_frame.text for sh in prs.slides[1].shapes if sh.has_text_frame)
    assert "A title and nothing else" in texts.replace("\xa0", " ")


def test_the_dark_close_has_a_title_a_statement_and_up_to_three_steps_and_no_contact(tmp_path):
    lay = LIB["close"]
    d, sid = _one_slide_deck(lay, [{"kind": "statement", "text": "Let us begin with the pilot."},
                                   {"kind": "bullets", "items": [{"text": "Agree the scope"}, {"text": "Book the kickoff"}, {"text": "Share the plan"}]}], "Next steps")
    d["slides"][sid]["type"] = "close"
    p, _, _ = layouts.plan(d)
    assert p["slides"][sid]["layout"]["id"] == "close"
    out = tmp_path / "d.pptx"
    r = render_pptx.Renderer(p, Inputs(brief={}))
    r.render(out)
    assert r.layouts[sid] == "close" and r.p.dark
    text = " ".join(sh.text_frame.text for sh in Presentation(str(out)).slides[1].shapes if sh.has_text_frame).lower()
    assert "@" not in text and "phone" not in text and "contact" not in text
    assert sum(1 for sh in Presentation(str(out)).slides[1].shapes if sh.name == "slot:next") >= 3


def test_the_cover_title_steps_64_60_54_with_the_box_across_the_content_width(tmp_path):
    sizes = []
    for title in ("Short", "A cover title of a middling length that wraps in two lines of the box", "A very long cover title " * 4):
        d = copy.deepcopy(GOLD)
        d["slides"]["s01"]["title"] = title
        p, _, _ = layouts.plan(d)
        out = tmp_path / "c.pptx"
        render_pptx.Renderer(p, Inputs(brief={})).render(out)
        t = next(sh for sh in Presentation(str(out)).slides[0].shapes if sh.name == "Title")
        sizes.append((t.text_frame.paragraphs[0].runs[0].font.size.pt, t.width))
    assert sizes[0][0] == 64 and sizes[1][0] in (64, 60, 54)
    assert sizes[0][1] > 11 * 914400   # the full content width, not 10.4 in


def test_one_title_size_and_place_per_layout_and_a_swap_leaves_other_titles_alone(tmp_path):
    d = copy.deepcopy(GOLD)
    p, _, _ = layouts.plan(d)
    pt = p["meta"]["layout_title_pt"]
    assert pt and all(v in (36, 32, 30, 28) for v in pt.values())
    swapped, _, _ = layouts.plan(d, swaps={"s05": "text_columns"})
    assert swapped["meta"]["layout_title_pt"].get("cards") == pt.get("cards")   # a swap never restamps another layout's title size
    out = tmp_path / "t.pptx"
    render_pptx.Renderer(p, Inputs(brief={})).render(out)
    by_layout: dict = {}
    for sid, sl in zip(p["order"], Presentation(str(out)).slides):
        t = next((sh for sh in sl.shapes if sh.name == "Title"), None)
        if t is not None and p["slides"][sid]["layout"]["id"] in pt:
            by_layout.setdefault(p["slides"][sid]["layout"]["id"], set()).add((round(t.left / 914400, 2), round(t.top / 914400, 2), t.text_frame.paragraphs[0].runs[0].font.size.pt))
    assert all(len(v) == 1 for v in by_layout.values()), by_layout


def test_body_lines_stay_near_48_characters_at_every_scale():
    d = copy.deepcopy(GOLD)
    R = render_pptx.Renderer(d, None)
    for size in (12, 14, 16, 19.2, 22):
        para = R.para("word " * 60, size, None)
        assert para["cpl"] == 48
        w = R._clamp([para], 12.0)
        longest = max(len(" ".join(line)) for line in R.wrap(para["t"], w, size))
        assert longest <= 50, (size, longest)


def test_fill_upscaling_is_capped_at_1_2_and_cards_do_not_stretch_under_lean():
    d = copy.deepcopy(GOLD)
    d["meta"].setdefault("preferences", {})["density"] = {"level": "lean", "source": "person"}
    R = render_pptx.Renderer(d, None)
    assert max(R._upscales()) == 1.2 and not R._stretches()
    d["meta"]["preferences"]["density"]["level"] = "detailed"
    R = render_pptx.Renderer(d, None)
    assert max(R._upscales()) == 1.6 and R._stretches()


def test_the_idea_and_cover_pictures_take_a_proper_share_of_the_slide(demo_stages, build_demo, tmp_path):
    """The slice 3 gallery fix: the picture is a large panel (cover 16:9, idea 4:3), not a small box in a corner."""
    run = build_demo(demo_stages, tmp_path / "o", "--pictures", "creative_cover")
    lay = json.loads((run / "layouts.json").read_text())["slides"]
    deck = json.loads((run / "deck.json").read_text())
    prs = Presentation(str(run / "deck.pptx"))
    area = prs.slide_width * prs.slide_height
    checked = 0
    for sid, n in ((deck["order"][0], 0), (next(i for i, s in deck["slides"].items() if s["type"] == "idea"), None)):
        n = deck["order"].index(sid)
        pics = [sh for sh in prs.slides[n].shapes if sh.shape_type == 13]
        assert lay[sid]["id"] in ("cover_image", "image_text") and len(pics) == 1, (sid, lay[sid]["id"])
        assert pics[0].width * pics[0].height / area >= 0.27, sid   # was about 0.07
        assert pics[0].name == "Picture"
        checked += 1
    assert checked == 2


def test_a_client_render_with_unapproved_frames_uses_the_text_only_layouts(demo_stages, build_demo, tmp_path):
    run = build_demo(demo_stages, tmp_path / "c", "--pictures", "creative_cover", "--audience", "client")
    lay = json.loads((run / "layouts.json").read_text())["slides"]
    assert not any(v["id"] in ("cover_image", "image_text", "frames_strip", "execution_visual") for v in lay.values())
