"""deck-look step 7 (spec.LOOK_V3): words on pictures (the calm-zone finder, the solved scrim, the p10 contrast gate on a text-free render,
cover_bleed and the reworked full_bleed_statement, the label in the opposite corner, the text-zone hint in the prompt), a sentence said once
(the campaign line), and rea-full's quick wins (one accent phrase in a title, the stat row on hairlines, a swap menu that offers only what
fits without a hole) with the measurement slide's empty middle. Offline: no model, no money; one test renders with LibreOffice when present."""
from __future__ import annotations

import copy
import json
import random
import re
import shutil
from pathlib import Path

import pytest
from PIL import Image
from pptx import Presentation

from deck import assemble, imagegen, images, inputs, layouts, qa_render, render_pptx as R, spec, validate
from deck.inputs import Inputs

HERE = Path(__file__).parent
FIX = HERE / "fixtures" / "lumen_water"
FILES = {"a": "a_requirements.json", "b": "b_storyline.json", "c": "c_territories.json", "d": "d_idea.json"}
EMU = 914400
INK, PAPER = (0x1B, 0x24, 0x30), (0xFA, 0xF7, 0xF1)


@pytest.fixture
def v3(monkeypatch):
    monkeypatch.setattr(spec, "LOOK_V3", True)


def _st() -> dict:
    return {k: json.loads((FIX / f).read_text()) for k, f in FILES.items()}


def _build() -> dict:
    return assemble.build(inputs.load(FIX / "brief_object.json"), _st(), client="Lumen Water", project="National awareness campaign", fmt="pitch")


def _of(d: dict, typ: str) -> str:
    return next(x for x in d["order"] if d["slides"][x]["type"] == typ)


# ------------------------------------------------------------------------------------------------ synthetic pictures
def _pic(tmp_path, name, fill, size=(1946, 1000)):
    """A picture at the bleed box's aspect: ``fill(x, y) -> (r, g, b)`` per pixel (u, v in 0..1)."""
    im = Image.new("RGB", size)
    px = im.load()
    for y in range(size[1]):
        for x in range(size[0]):
            px[x, y] = fill(x / size[0], y / size[1])
    p = tmp_path / name
    im.save(p, "PNG")
    return p


def _noise(seed=7):
    """Black and white blocks about 0.5 in square: coarse enough to survive the finder's 160 px thumbnail (per-pixel noise averages to grey)."""
    rnd = random.Random(seed)
    cells = {(i, j): rnd.choice((0, 255)) for i in range(25) for j in range(13)}
    return lambda u, v: (cells[(int(u * 24), int(v * 12))],) * 3


def _calm_bottom_left(seed=3):
    """Flat light paper-like ground under the bottom-left zone; hard black-and-white noise everywhere else."""
    rnd = random.Random(seed)
    return lambda u, v: (235, 230, 220) if (u < 0.6 and v > 0.4) else tuple(rnd.choice((0, 255)) for _ in range(3))


# ================================================================================================ A. the finder and the scrim solver
def test_the_finder_takes_the_calm_zone_with_the_floor_scrim(tmp_path):
    rec = images.text_zone(_pic(tmp_path, "a.png", _calm_bottom_left()))
    assert rec["zone"] == "bottom_left" and rec["by"] == "finder"
    assert rec["text"] == "1B2430" and rec["colour"] == "FAF7F1"   # a light zone: ink words under a paper scrim (the wash deepens, never flips)
    assert rec["alpha"] == images.SCRIM_FLOOR == 0.40             # the floor on every text-over slot, even a calm one (a visual default: no guarantee for a swapped picture)
    assert rec["p10"] >= images.TEXT_ON_PICTURE_TARGET and rec["busy_sd"] < images.BUSY_SD


def test_a_dark_picture_takes_paper_words_on_an_ink_scrim(tmp_path):
    rec = images.text_zone(_pic(tmp_path, "d.png", lambda u, v: (40, 46, 52)))
    assert rec["text"] == "FAF7F1" and rec["colour"] == "1B2430" and rec["alpha"] == 0.40 and rec["p10"] >= 4.8


def test_a_busy_zone_takes_the_cap_and_a_noisy_picture_has_no_zone(tmp_path):
    stripes = lambda u, v: (40, 40, 40) if int(u * 20) % 2 else (170, 170, 170)   # texture under the words: s.d. over BUSY_SD
    rec = images.text_zone(_pic(tmp_path, "s.png", stripes))
    assert rec.get("zone") and rec["busy_sd"] > images.BUSY_SD and rec["alpha"] == images.SCRIM_CAP
    none = images.text_zone(_pic(tmp_path, "n.png", _noise()))
    assert none["none"] is True and none["by"] == "finder" and "busy" in none["reason"] and "zone" not in none


def test_the_scrim_never_leaves_its_floor_and_cap(tmp_path):
    for i, f in enumerate((_calm_bottom_left(), lambda u, v: (128, 128, 128), lambda u, v: (200, int(255 * v), 90))):
        rec = images.text_zone(_pic(tmp_path, f"x{i}.png", f))
        if rec.get("zone"):
            assert images.SCRIM_FLOOR <= rec["alpha"] <= images.SCRIM_CAP


def test_the_finder_is_deterministic(tmp_path):
    p = _pic(tmp_path, "a.png", _calm_bottom_left())
    assert images.text_zone(p) == images.text_zone(p)


def test_p10_catches_what_the_mean_passes():
    """The regression the mean hid: light words over a picture that is mostly dark with bright patches pass on the mean, fail at p10."""
    pix = [(30, 30, 30)] * 80 + [(250, 250, 250)] * 20
    mean = tuple(sum(p[i] for p in pix) // len(pix) for i in range(3))
    assert qa_render.contrast_ratio((255, 255, 255), mean) >= 4.5
    assert images.p10_contrast(pix, (255, 255, 255)) < 1.2


def test_scrim_geometry_and_the_label_corner():
    box = images.zone_box("bottom_left")
    g = images.scrim_geometry("bottom_left", box)
    sx, sy, sw, sh = g["solid"]
    assert g["toward"] == "up" and sy <= box[1] - images.SCRIM_PAD + 1e-9 and abs(sy + sh - images.BLEED_H) < 1e-9 and sw == images.BLEED_W
    assert images.label_corner("bottom_left") == "top_right" and images.label_corner("top_right") == "bottom_left"
    assert images.label_corner("middle_left") == "top_right"


# ================================================================================================ A. the layouts that set words on a picture
def _with_zone(d, typ, rec, asset="a1"):
    sid = _of(d, typ)
    d["slides"][sid]["slots"] = {"picture": {"kind": "image", "image": {"kind": "photo", "status": "made", "aspect": "16:9", "asset": asset,
                                                                         "basis": "creative", "alt": "A photo", "text_zone": rec}}}
    d.setdefault("assets", {})[asset] = {"sha256": "0" * 64, "file": "x.png", "mime": "image/png", "width": 10, "height": 10, "rights": "generated"}
    return sid


ZONE = {"zone": "bottom_left", "text": "FAF7F1", "colour": "1B2430", "alpha": 0.47, "p10": 6.2, "busy_sd": 0.08, "by": "finder"}


def test_a_measured_zone_picks_cover_bleed_and_full_bleed_statement(v3):
    d = _build()
    c, i = _with_zone(d, "title", ZONE, "img_000000000001"), _with_zone(d, "idea", ZONE, "img_000000000002")
    planned, issues, _ = layouts.plan(d, prefs={"density": "lean"})
    assert planned["slides"][c]["layout"]["id"] == "cover_bleed"
    assert planned["slides"][i]["layout"]["id"] == "full_bleed_statement"
    assert not [x for x in issues if x["check"] == "text_on_image_fallback"]


def test_no_zone_keeps_the_words_beside_the_picture_and_says_so(v3):
    d = _build()
    none = {"none": True, "reason": "every zone is too busy under the words", "best": {"zone": "top_left", "text": "1B2430", "p10": 3.1, "busy_sd": 0.34}, "by": "finder"}
    i = _with_zone(d, "idea", none, "img_000000000002")
    planned, issues, _ = layouts.plan(d, prefs={"density": "lean"})
    assert planned["slides"][i]["layout"]["id"] == "picture_column"   # the words beside the picture, never silently
    fb = [x for x in issues if x["check"] == "text_on_image_fallback"]
    assert len(fb) == 1 and fb[0]["slide"] == i and "beside the picture" in fb[0]["message"] and "too busy" in fb[0]["message"]


def test_the_bleed_layouts_need_the_flag():
    lib = layouts.load()
    assert "cover_bleed" not in lib and lib["full_bleed_statement"]["pick"] == "offer"


def _render_bleed(tmp_path, typ, zone):
    d = _build()
    sid = _with_zone(d, typ, zone, "img_000000000003")
    planned, _, _ = layouts.plan(d, prefs={"density": "lean"})
    pic = _pic(tmp_path, "p.png", lambda u, v: (40, 46, 52), size=(800, 411))
    r = R.Renderer(planned, Inputs(brief={}), theme="napkin")
    r.pictures = {"img_000000000003": pic}
    r.drawn = {(sid, "picture"): planned["slides"][sid]["slots"]["picture"]["image"]}
    r.render(tmp_path / "d.pptx")
    prs = Presentation(str(tmp_path / "d.pptx"))
    return planned, sid, r, prs.slides[planned["order"].index(sid)]


def _box(sh):
    return (sh.left / EMU, sh.top / EMU, sh.width / EMU, sh.height / EMU)


def _gap(a, b) -> float:
    dx = max(b[0] - (a[0] + a[2]), a[0] - (b[0] + b[2]), 0)
    dy = max(b[1] - (a[1] + a[3]), a[1] - (b[1] + b[3]), 0)
    return max(dx, dy)


@pytest.mark.parametrize("typ", ["idea", "title"])
def test_a_bleed_draws_the_measured_scrim_and_the_label_in_the_opposite_corner(v3, tmp_path, typ):
    planned, sid, r, sl = _render_bleed(tmp_path, typ, ZONE)
    assert r.layouts[sid] == ("full_bleed_statement" if typ == "idea" else "cover_bleed")
    names = {sh.name: sh for sh in sl.shapes}
    pic = names["Picture"]
    assert abs(pic.width / EMU - images.BLEED_W) < 0.01 and pic.left == 0 and pic.top == 0
    scrim = names["Scrim"]
    a = int(scrim._element.spPr.find(".//{http://schemas.openxmlformats.org/drawingml/2006/main}alpha").get("val")) / 100000
    assert a == 0.47 and images.SCRIM_FLOOR <= a <= images.SCRIM_CAP
    assert "gradFill" in str(names["ScrimFade"]._element.xml)
    title = names["Title"]
    runs = [rn for p in title.text_frame.paragraphs for rn in p.runs]
    assert runs and all(str(rn.font.color.rgb) == "FAF7F1" for rn in runs)
    if typ == "idea":   # the idea leads with its own stage text (said once): the campaign line is the proposition's
        assert title.text_frame.text.replace("\xa0", " ") == "Each household sees its own water story."
    pill = names["PictureLabel"]
    assert pill.top / EMU < 1.2 and pill.left / EMU > images.BLEED_W / 2   # top right: diagonal to a bottom-left block
    texts = [_box(sh) for sh in sl.shapes if sh.has_text_frame and sh.text_frame.text.strip() and sh.name not in ("Caption",)]
    assert all(_gap(_box(pill), t) >= 0.3 - 1e-6 for t in texts)
    wm = names.get("Watermark")
    if wm is not None:   # the DRAFT mark sits on its own ground, never on the picture
        g = names["MarkGround"]
        assert g.left <= wm.left and wm.left + wm.width <= g.left + g.width + 1


def test_the_prompt_asks_for_the_calm_zone_only_under_the_flag(monkeypatch):
    assert imagegen.composition("idea") == imagegen.COMPOSITION["idea"]
    monkeypatch.setattr(spec, "LOOK_V3", True)
    assert "lower left calm" in imagegen.composition("idea") and "lower left calm" in imagegen.composition("title")
    assert imagegen.composition("audience") == imagegen.COMPOSITION["audience"]


def test_the_subjects_request_is_unchanged_by_the_hint(monkeypatch):
    """The hint is prompt text only: the stage g request (its role line) still reads COMPOSITION, so its request_sha does not move."""
    src = Path(imagegen.__file__).read_text()
    assert '"role": COMPOSITION.get(s["type"]' in src and "comp = composition(s[\"type\"])" in src


def test_qa_measures_p10_on_a_text_free_render():
    W_in, H_in, w, h = 13.333, 7.5, 40, 22
    px = bytearray()
    for y in range(h):
        for x in range(w):
            px += bytes((250, 250, 250) if (x % 5 == 0) else (30, 30, 30))   # dark with bright streaks: the mean passes light words
    frames = [("Title", 0.0, 0.0, 13.333, 7.5, (255, 255, 255), 40.0, True)]
    rec = qa_render.text_on_image_p10(frames, W_in, H_in, w, h, bytes(px))
    assert rec[0]["need"] == 3.0 and rec[0]["p10"] < 1.2 and rec[0]["pass"] is False
    f = qa_render._p10_findings(rec)
    assert f[0]["check"] == "text_on_image_contrast" and f[0]["level"] == "error" and "10th percentile" in f[0]["message"]
    assert not qa_render._check_text_on_image(frames, W_in, H_in, w, h, bytes(px))   # the old mean measure passes it


def test_under_the_look_any_p10_under_aa_is_an_error(monkeypatch):
    """The scrim floor guarantees nothing (2.26:1 is possible at 40%), so the render-time measure must stop the deck, not warn."""
    rec = [{"name": "Title", "text": "FFFFFF", "size": 40.0, "p10": 2.6, "need": 3.0, "pass": False}]
    monkeypatch.setattr(spec, "LOOK_V3", True)
    f = qa_render._p10_findings(rec)
    assert f[0]["level"] == "error" and "(FFFFFF)" in f[0]["message"]
    monkeypatch.setattr(spec, "LOOK_V3", False)
    assert qa_render._p10_findings(rec)[0]["level"] == "warn"


def test_text_contrasts_composites_a_part_transparent_scrim(tmp_path):
    """A 40% scrim is not a solid ground: over a solid background it is composited; over a picture the run is left to the render."""
    from pptx.dml.color import RGBColor
    from pptx.util import Inches, Pt
    prs = Presentation()
    sl = prs.slides.add_slide(prs.slide_layouts[6])
    sl.background.fill.solid()
    sl.background.fill.fore_color.rgb = RGBColor(0xFF, 0xFF, 0xFF)
    from lxml import etree
    from pptx.enum.shapes import MSO_SHAPE
    from pptx.oxml.ns import qn
    sc = sl.shapes.add_shape(MSO_SHAPE.RECTANGLE, 0, 0, Inches(13), Inches(7))
    sc.fill.solid()
    sc.fill.fore_color.rgb = RGBColor(0, 0, 0)
    etree.SubElement(sc.fill._xPr.find(qn("a:solidFill"))[0], qn("a:alpha")).set("val", "40000")
    tb = sl.shapes.add_textbox(Inches(1), Inches(1), Inches(5), Inches(1))
    r = tb.text_frame.paragraphs[0].add_run()
    r.text, r.font.size = "White words on a 40% black scrim over white", Pt(16)
    r.font.color.rgb = RGBColor(0xFF, 0xFF, 0xFF)
    got = qa_render.text_contrasts(sl)
    assert got and got[0]["bg"] == "999999" and got[0]["ratio"] < 4.5   # 0.4 black over white is #999999, about 2.8:1: not a pass


@pytest.mark.skipif(not (shutil.which("soffice") or Path("/Applications/LibreOffice.app/Contents/MacOS/soffice").exists()), reason="LibreOffice")
def test_the_render_clears_aa_at_p10_on_a_bleed(v3, tmp_path):
    planned, sid, r, _ = _render_bleed(tmp_path, "idea", ZONE)
    prs = Presentation(str(tmp_path / "d.pptx"))
    n = planned["order"].index(sid) + 1
    over = qa_render._over_pictures(prs.slides[n - 1])
    presented = [i for i, s_ in enumerate(prs.slides, 1) if not qa_render._hidden(s_)]
    got = qa_render._text_free_p10(tmp_path / "d.pptx", {n: over}, presented, 13.333, 7.5)[n]
    words = [x for x in got if x["name"] in ("Title", "slot:statement")]
    assert words and all(x["pass"] and x["p10"] >= 4.5 for x in words), got


# ================================================================================================ B. a sentence is said once
def _presented_sentences(d):
    out = []
    for sid in validate.presented(d):
        sl = d["slides"][sid]
        for t, _ in validate._texts(sl, internal=False, human=False):
            out += [re.sub(r"\W+", " ", x.lower()).strip() for x in re.split(r"(?<=[.!?])\s+", str(t))]
    return out


def test_the_campaign_line_is_said_once(v3):
    d = _build()
    said = _presented_sentences(d)
    assert said.count("every drop has a story") == 1
    idea = d["slides"][_of(d, "idea")]
    assert idea["title"] == "Each household sees its own water story."   # the idea's own stage text (d.idea), not the line
    assert not any(b["kind"] == "statement" and b.get("text") == idea["title"] for b in idea["blocks"])
    n = d["order"].index(_of(d, "proposition")) + 1
    assert f"{spec.SAID_ONCE_NOTE.format(n=n)} Every drop has a story." in idea["notes"]
    assert d["slides"][_of(d, "proposition")]["title"] == "Every drop has a story."   # the brief's single thought keeps it, once


def test_said_once_moves_only_the_repeated_sentence():
    """The review's proof: a copy line with a repeated sentence and a new one keeps the new one (the call to action) on the slide."""
    S = [assemble._slide("proposition", "Every drop has a story.", [{"kind": "text", "text": "One line", "basis": "opinion"}]),
         assemble._slide("execution", "The poster", [{"kind": "copy", "lines": ["Every drop has a story. Book your free leak check at lumen.ie today."],
                                                      "answer": "Poster"}])]
    assemble._say_once(S)
    b = S[1]["blocks"][0]
    assert b["kind"] == "copy" and b["lines"] == ["Book your free leak check at lumen.ie today."] and b["answer"] == "Poster"
    assert S[1]["notes"].endswith(f"{spec.SAID_ONCE_NOTE.format(n=1)} Every drop has a story.")
    assert "Book your free" not in S[1]["notes"]


def test_said_once_keeps_an_idea_titles_new_sentence():
    S = [assemble._slide("proposition", "Every drop has a story.", [{"kind": "text", "text": "One line", "basis": "opinion"}]),
         assemble._slide("idea", "Every drop has a story. Each household sees its own water use.",
                         [{"kind": "statement", "text": "A stage text that stays", "basis": "opinion"}])]
    assemble._say_once(S)
    assert S[1]["title"] == "Each household sees its own water use."
    assert [b["text"] for b in S[1]["blocks"]] == ["A stage text that stays"]
    assert f"{spec.SAID_ONCE_NOTE.format(n=1)} Every drop has a story." in S[1]["notes"]


def test_said_once_drops_a_block_only_when_every_line_was_said():
    S = [assemble._slide("proposition", "Every drop has a story.", [{"kind": "text", "text": "One line", "basis": "opinion"}]),
         assemble._slide("execution", "The poster", [{"kind": "copy", "lines": ["Every drop has a story."], "answer": "Poster"}])]
    assemble._say_once(S)
    assert S[1]["blocks"] == [] and "Every drop has a story. (Poster)" in S[1]["notes"]


def test_said_once_needs_the_flag():
    d = _build()
    assert d["slides"][_of(d, "idea")]["title"] == "Every drop has a story."


def test_validate_counts_titles_and_short_lines_under_the_flag(v3):
    d = _build()
    idea = d["slides"][_of(d, "idea")]
    idea["title"] = "Every drop has a story."   # undo the fix: the line twice
    F = validate.run(d, inputs.load(FIX / "brief_object.json"))
    rep = [x for x in F if x["check"] == "repeated_line"]
    assert rep and "Every drop has a story" in rep[0]["message"]
    assert not [x for x in validate.run(_build(), inputs.load(FIX / "brief_object.json")) if x["check"] == "repeated_line"]


# ================================================================================================ C. quick wins
def test_one_accent_phrase_only_from_a_bound_field():
    s = {"title": "Move people to see water as something I look after", "blocks": [
        {"kind": "fromto", "from": "Water is a bill", "to": "Something I look after"}, {"kind": "text", "text": "Cut use by 5% in a year."}]}
    assert layouts.accent_phrase(s, s["blocks"]) == "something I look after"
    s2 = {"title": "Cut household use by 5% this year", "blocks": [{"kind": "bullets", "items": [{"text": "Cut household use by 5% in 12 months"}]}]}
    assert layouts.accent_phrase(s2, s2["blocks"]) == "5%"
    s3 = {"title": "How we will know it worked", "blocks": [{"kind": "text", "text": "Utility meter data"}]}
    assert layouts.accent_phrase(s3, s3["blocks"]) is None
    s4 = {"title": "Every drop has a story.", "blocks": [{"kind": "copy", "lines": ["Every drop has a story."]}]}
    assert layouts.accent_phrase(s4, s4["blocks"]) is None   # never the whole title


def test_the_accent_phrase_is_never_a_generic_word_or_a_placeholder():
    s = {"title": "Book your free leak check today", "blocks": [{"kind": "copy", "lines": ["Today"]}, {"kind": "bullets", "items": ["now"]}]}
    assert layouts.accent_phrase(s, s["blocks"]) is None                      # 'today' is a stop word
    s2 = {"title": "We meet the water team", "blocks": [{"kind": "bullets", "items": [{"text": "team"}]}]}
    assert layouts.accent_phrase(s2, s2["blocks"]) is None                    # under ACCENT_MIN_CHARS letters
    s3 = {"title": "The leak check pays for itself", "blocks": [{"kind": "text", "text": "leak check", "internal": True},
                                                                   {"kind": "text", "text": "pays for itself", "basis": "placeholder"},
                                                                   {"kind": "text", "text": "leak check", "human": True}]}
    assert layouts.accent_phrase(s3, s3["blocks"]) is None                    # internal, placeholder and human blocks are never bound
    s4 = {"title": "Cut use by 5% in a year", "blocks": [{"kind": "text", "text": "Cut use by 5%"}]}
    assert layouts.accent_phrase(s4, s4["blocks"]) == "Cut use by 5%"         # a real phrase still wins; a short figure is allowed


def test_the_accent_phrase_is_one_run_in_accent_ink(v3, tmp_path):
    d = _build()
    sid = _of(d, "proposition")
    sl_ = d["slides"][sid]
    sl_["title"] = "From a bill to something I look after"   # a test title holding the slide's own 'to'
    sl_["blocks"][0]["to"] = "Something I look after"
    planned, _, _ = layouts.plan(d, prefs={"density": "lean"})
    r = R.Renderer(planned, Inputs(brief={}), theme="napkin")
    r.render(tmp_path / "d.pptx")
    sl = Presentation(str(tmp_path / "d.pptx")).slides[planned["order"].index(sid)]
    title = next(sh for sh in sl.shapes if sh.name == "Title")
    runs = [rn for p in title.text_frame.paragraphs for rn in p.runs]
    acc = [rn for rn in runs if str(rn.font.color.rgb) == r.th.accent_ink]
    assert len(acc) == 1 and acc[0].text.replace("\xa0", " ").lower() == "something i look after"
    assert "".join(rn.text for rn in runs).replace("\xa0", " ") == "From a bill to something I look after"


def test_the_stat_row_sits_on_hairlines_in_ink(v3, tmp_path):
    d = _build()
    sid = _of(d, "objective")
    d["slides"][sid]["blocks"] = [{"kind": "stats", "items": [{"value": "5%", "label": "Household use", "refs": ["brief:objectives"]},
                                                               {"value": "12 months", "label": "By when", "refs": ["brief:objectives"]},
                                                               {"value": "EUR 120,000", "label": "Budget given", "refs": ["brief:budget_scope"]}]}]
    planned, _, _ = layouts.plan(d, prefs={"density": "lean"}, swaps={sid: "kpi_row"})
    assert planned["slides"][sid]["layout"]["id"] == "kpi_row"
    r = R.Renderer(planned, inputs.load(FIX / "brief_object.json"), theme="napkin")
    r.render(tmp_path / "d.pptx")
    sl = Presentation(str(tmp_path / "d.pptx")).slides[planned["order"].index(sid)]
    figs = [sh for sh in sl.shapes if sh.name == "slot:figures"]
    assert len(figs) == 3
    for sh in figs:
        paras = sh.text_frame.paragraphs
        assert paras[0].runs[0].text in ("Household use", "By when", "Budget given")       # the label above
        val = paras[1].runs[0]
        assert str(val.font.color.rgb) == r.th.ink and val.font.size.pt >= 40                # the figure in ink, at display size
        assert paras[2].runs[0].text.startswith("Source [")                                 # the source below
    assert sum(1 for sh in sl.shapes if sh.name == "Hairline") >= 2 + 2                      # the frame and a rule between each figure
    assert not any(sh.name == "Card" or (sh.shape_type == 1 and sh.fill.type == 1 and str(sh.fill.fore_color.rgb) == r.th.panel) for sh in sl.shapes)


def test_the_swap_menu_offers_no_layout_that_opens_a_hole(v3):
    d = _build()
    planned, _, _ = layouts.plan(d, prefs={"density": "lean"})
    rr = R.Renderer(planned, None)
    for sid in validate.presented(planned):
        s = planned["slides"][sid]
        sh = {**s, "blocks": spec.shown_blocks(s)}
        for a in s["layout"]["alternatives"]:
            if layouts.load()[a]["group"] == "content":
                h = rr.hole_estimate(sh, a)
                assert h is not None and h <= spec.HOLE_GATE, (sid, a, h)


def test_the_hole_estimate_sees_an_empty_slide():
    assert qa_render.hole_of_boxes([], 13.333, 7.5) > 0.8
    assert qa_render.hole_of_boxes([(0, 0, 13.333, 7.5)], 13.333, 7.5) == 0.0


def test_one_measure_sits_as_a_stat_row_with_no_empty_middle(v3, tmp_path):
    d = _build()
    planned, _, _ = layouts.plan(d, prefs={"density": "lean"})
    sid = _of(planned, "measurement")
    assert planned["slides"][sid]["layout"]["id"] == "rows_aside"
    r = R.Renderer(planned, Inputs(brief={}), theme="napkin")
    r.render(tmp_path / "d.pptx")
    sl = Presentation(str(tmp_path / "d.pptx")).slides[planned["order"].index(sid)]
    rows = sorted((sh for sh in sl.shapes if sh.name == "slot:rows"), key=lambda x: x.left)
    assert [sh.text_frame.paragraphs[0].runs[0].text for sh in rows] == ["What we measure", "Baseline", "How"]
    title = next(sh for sh in sl.shapes if sh.name == "Title")
    aside = next(sh for sh in sl.shapes if sh.name == "slot:aside")
    top_gap = rows[0].top / EMU - (title.top + title.height) / EMU
    bottom_gap = aside.top / EMU - (max(sh.top + sh.height for sh in rows)) / EMU
    assert abs(top_gap - bottom_gap) < 0.6 and max(top_gap, bottom_gap) < 1.6   # the free height split around the row: no hole in the middle
    est = R.Renderer(planned, None).hole_estimate({**planned["slides"][sid], "blocks": spec.shown_blocks(planned["slides"][sid])}, "rows_aside")
    assert est is not None and est < 0.12
