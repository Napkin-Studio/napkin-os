"""UAT round 3 deck polish (features/uat-flow-fixes.clan): a client export carries no internal status mark, the picture labels never
overlap text or clip, a title never runs into the text under it, the words never cover the product, and the storyboard copy counts the
frames drawn. Offline: no model, no network, no LibreOffice."""
from __future__ import annotations

import copy
import json
import shutil
import sys
from pathlib import Path

import pytest
from PIL import Image, ImageDraw
from pptx import Presentation
from pptx.util import Emu

from deck import from_production as fp, images, spec

HERE = Path(__file__).parent
sys.path.insert(0, str(HERE / "fixtures" / "production_demo"))
import make_bundle as mb   # noqa: E402

sys.path.remove(str(HERE / "fixtures" / "production_demo"))

LABELS = ("Caption", "MockupLabel", "PictureLabel", "MockupPill")


@pytest.fixture
def gr(monkeypatch):
    monkeypatch.setattr(spec, "LOOK_V3", True)
    monkeypatch.setattr(spec, "GRAPHICS", True)


@pytest.fixture(scope="module")
def bundle(tmp_path_factory):
    p = tmp_path_factory.mktemp("prod") / "napkin-lumen-water-production.zip"
    mb.build(p)
    return p


@pytest.fixture(scope="module")
def prod(bundle):
    return fp.build(bundle, at="2026-11-18T10:00:00+00:00")[0]


def _flagged_stages(tmp_path, demo_stages, bundle):
    """The demo's stages with a Production project whose every picture Production itself flagged ('needs a look')."""
    st = tmp_path / "stages"
    shutil.copytree(demo_stages, st)
    assert fp.main([str(bundle), "--stages", str(st)]) == 0
    pf = st / "production.json"
    data = json.loads(pf.read_text())
    for it in data["items"].values():
        it["status"], it["reason"] = "look", "Flagged by review in Production: needs a look"
    pf.write_text(json.dumps(data))
    return st


def _texts(prs):
    return [sh.text_frame.text for sl in prs.slides for sh in sl.shapes if sh.has_text_frame]


def _rect(sh):
    return (sh.left, sh.top, sh.left + sh.width, sh.top + sh.height)


def _hit(a, b):
    return a[0] < b[2] and b[0] < a[2] and a[1] < b[3] and b[1] < a[3]


@pytest.fixture(scope="module")
def runs(tmp_path_factory, demo_stages, bundle, build_demo):
    import deck.spec as sp
    old = (sp.LOOK_V3, sp.GRAPHICS)
    sp.LOOK_V3 = sp.GRAPHICS = True
    try:
        st = _flagged_stages(tmp_path_factory.mktemp("fl"), demo_stages, bundle)
        review = build_demo(st, tmp_path_factory.mktemp("r") / "o", "--pictures", "creative_cover", "--production")
        clean = build_demo(st, tmp_path_factory.mktemp("c") / "o", "--pictures", "creative_cover", "--production", "--clean-export")
    finally:
        sp.LOOK_V3, sp.GRAPHICS = old
    return review, clean


def test_the_review_deck_still_shows_flagged_and_the_clean_export_shows_none(runs):
    review, clean = runs
    assert any("Flagged" in t for t in _texts(Presentation(str(review / "deck.pptx")))), "the review render keeps the status"
    prs = Presentation(str(clean / "deck.pptx"))
    assert not any("Flagged" in t for t in _texts(prs))
    for sl in prs.slides:
        for sh in sl.shapes:
            if sh.shape_type == 13:   # no red outline on any picture
                assert sh.line.fill.type is None or str(sh.line.color.rgb) != "C0392B"
            if sh.name == "PictureLabel":
                assert str(sh.fill.fore_color.rgb) != "B03225"
    html = (clean / "deck.html").read_text()
    assert "Flagged" not in html and 'class="pic flagged"' not in html and "plabel flagged" not in html
    assert "Flagged" in (review / "deck.html").read_text()
    deck = json.loads((clean / "deck.json").read_text())   # the status itself is the document's, kept for the app's review
    assert any(im.get("status") == "flagged" for _, _, im in images.image_slots(deck))


def test_a_picture_label_never_overlaps_text_or_clips(runs):
    prs = Presentation(str(runs[1] / "deck.pptx"))
    seen = 0
    for sl in prs.slides:
        labels = [sh for sh in sl.shapes if sh.name in ("PictureLabel", "MockupPill")]
        words = [sh for sh in sl.shapes if sh.has_text_frame and sh.name not in LABELS and sh.text_frame.text.strip()]
        for lab in labels:
            seen += 1
            assert not any(_hit(_rect(lab), _rect(w)) for w in words), (lab.name, [w.text_frame.text[:30] for w in words if _hit(_rect(lab), _rect(w))])
            assert lab.top + lab.height <= prs.slide_height and lab.left + lab.width <= prs.slide_width
        for sh in sl.shapes:
            if sh.name in ("Caption", "MockupLabel") and sh.has_text_frame and sh.text_frame.text in (spec.MOCKUP_LABEL, spec.PRODUCTION_LABEL):
                for r in sh.text_frame.paragraphs[0].runs:
                    assert r.font.size.pt == 10, "the label is set at the size its pill is measured at"
    assert seen


def test_every_title_shrinks_inside_its_box_rather_than_over_the_text_below(runs):
    prs = Presentation(str(runs[1] / "deck.pptx"))
    titles = [sh for sl in prs.slides for sh in sl.shapes if sh.name == "Title"]
    assert titles
    for sh in titles:
        body = sh._element.txBody.bodyPr
        assert body.find("{http://schemas.openxmlformats.org/drawingml/2006/main}normAutofit") is not None, sh.text_frame.text[:40]


# -- the words never cover the product ------------------------------------------------------------------------------------------
def _can_picture(tmp_path, cx=0.5):
    p = tmp_path / "kv.jpg"
    im = Image.new("RGB", (1365, 768), (90, 100, 120))
    d = ImageDraw.Draw(im)
    x = int(cx * 1365)
    d.rectangle([x - 110, 120, x + 110, 700], fill=(220, 200, 170))
    im.save(p)
    return p


def _kv(focal_x):
    return {"kind": "illustration", "status": "made", "asset": "img_a", "aspect": "16:9", "focal": {"x": focal_x, "y": 0.5},
            "from": {"kind": "production", "key": "k"}}


def test_a_zone_that_reaches_the_subject_is_refused():
    band = images.subject_band(_kv(0.5), {"img_a": {"width": 1365, "height": 768}})
    assert band and band[0] < 6.67 < band[1]
    for z in ("bottom_left", "middle_left", "top_left", "bottom_right", "middle_right", "top_right"):
        assert not images.zone_clear_of(z, band)   # the 6.6 in block reaches the can from either side
    left = images.subject_band(_kv(0.12), {"img_a": {"width": 1365, "height": 768}})
    assert images.zone_clear_of("middle_right", left) and not images.zone_clear_of("middle_left", left)
    assert images.subject_band({**_kv(0.5), "from": {"kind": "upload"}}, None) is None   # no known subject: nothing held clear


def test_the_finder_gives_no_zone_when_the_can_is_in_the_middle(tmp_path):
    p = _can_picture(tmp_path)
    assert images.text_zone(p, focal={"x": 0.5, "y": 0.5}).get("zone")   # by pixels alone a zone reads
    band = images.subject_band(_kv(0.5), {"img_a": {"width": 1365, "height": 768}})
    got = images.text_zone(p, focal={"x": 0.5, "y": 0.5}, subject=band)
    assert got["none"] and "product" in got["reason"]


def test_solve_text_zones_holds_a_production_key_visual_clear(tmp_path):
    p = _can_picture(tmp_path)
    deck = {"order": ["s1"], "assets": {"img_a": {"width": 1365, "height": 768}},
            "slides": {"s1": {"type": "title", "slots": {"picture": {"kind": "image", "image": _kv(0.5)}}}}}
    got = images.solve_text_zones(deck, {"img_a": p})
    assert got[0][1].get("none")


# -- the storyboard copy counts the frames drawn ----------------------------------------------------------------------------------
def test_the_storyboard_copy_counts_the_frames_drawn(gr, prod):
    d = {"meta": {"client": "Lumen Water"}, "order": ["s3"], "slides": {"s3": {
        "type": "execution", "title": "TV film", "notes": "",
        "blocks": [{"kind": "text", "text": "Role: Six stills that tell the swap in sequence."},
                   {"kind": "copy", "lines": ["Frame 1: A.", "Frame 2: B.", "Frame 3: C.", "Frame 4: D.", "Frame 5: E.", "Frame 6: F.", "Contains caffeine."]}]}}}
    images.bind_production(d, prod)
    s = d["slides"]["s3"]
    n = len(s["strip"]["shots"])
    assert n == 3
    assert s["blocks"][0]["text"] == "Role: Three stills that tell the swap in sequence."
    left = [ln for b in s["blocks"] if b["kind"] == "copy" for ln in b["lines"]]
    assert not any(ln.startswith(("Frame 4", "Frame 5", "Frame 6")) for ln in left) and "Contains caffeine." in left
    assert "Frame 5: E." in s["notes"] and "Frame 6: F." in s["notes"]   # the words are moved, never lost
    assert s["strip"]["captions"] == ["A.", "B.", "C."]


def test_fit_storyboard_copy_leaves_a_matching_count_alone():
    s = {"blocks": [{"kind": "text", "text": "Four stills run as a carousel."}], "notes": ""}
    assert images.fit_storyboard_copy(s, [1, 2, 3, 4]) == [] and s["blocks"][0]["text"] == "Four stills run as a carousel."


# -- Built from names Production ------------------------------------------------------------------------------------------------
def test_built_from_names_production_when_the_deck_came_from_a_production_project(tmp_path):
    from deck import run_state as rs
    rows = rs.checks_list({"tier": "brief+research", "production": True}, tmp_path)
    assert rows[0]["text"] == "Built from: brief+research+production"
    assert rs.checks_list({"tier": "brief+research"}, tmp_path)[0]["text"] == "Built from: brief+research"
