"""deck-frames-in: the three picture checks of qa_render (picture_stretch, picture_lowres, text_on_image_contrast), and the contrast check's
skip over a picture. Run from engine/: ``PYTHONPATH=. python3 -m pytest deck/tests/test_qa_pictures.py``."""
from __future__ import annotations

import shutil
import subprocess
from pathlib import Path

import pytest
from PIL import Image
from pptx import Presentation
from pptx.dml.color import RGBColor
from pptx.util import Inches, Pt

from deck import qa_render, spec

SOFFICE = shutil.which("soffice") or next((p for p in ("/Applications/LibreOffice.app/Contents/MacOS/soffice",) if Path(p).exists()), None)


def checks(res) -> list:
    return [(n, f["check"], f["level"]) for n, fs in res["slides"].items() for f in fs]


def deck_with(tmp_path, pic_px=(1600, 900), box=(1.0, 1.0, 4.0, 2.25), crop=None, colour=(240, 240, 240), text=None, text_rgb=(255, 255, 255)):
    """A one-slide pptx: a picture of ``pic_px`` pixels in ``box`` (inches), optionally cropped (l, t, r, b fractions) and with text over it."""
    jpg = tmp_path / "p.jpg"
    Image.new("RGB", pic_px, colour).save(jpg)
    prs = Presentation()
    prs.slide_width, prs.slide_height = Inches(13.333), Inches(7.5)
    sl = prs.slides.add_slide(prs.slide_layouts[6])
    sl.background.fill.solid()
    sl.background.fill.fore_color.rgb = RGBColor(255, 255, 255)
    pic = sl.shapes.add_picture(str(jpg), *(Inches(v) for v in box))
    pic.name = "Picture"
    if crop:
        pic.crop_left, pic.crop_top, pic.crop_right, pic.crop_bottom = crop
    if text:
        tb = sl.shapes.add_textbox(Inches(box[0] + 0.3), Inches(box[1] + 0.3), Inches(3), Inches(0.8))
        tb.name = "Body"
        r = tb.text_frame.paragraphs[0].add_run()
        r.text = text
        r.font.size, r.font.color.rgb = Pt(24), RGBColor(*text_rgb)
    p = tmp_path / "d.pptx"
    prs.save(p)
    return p


# ---------------------------------------------------------------- picture_stretch

def test_a_stretched_picture_gives_picture_stretch(tmp_path):
    # 1600 by 900 shown whole in a 4:3 box: drawn 1.333, crop 1.778
    assert ("1", "picture_stretch", "error") in checks(qa_render.check_pptx(deck_with(tmp_path, box=(1, 1, 4.0, 3.0))))


def test_a_cropped_picture_that_fits_its_box_is_not_stretched(tmp_path):
    # the 4:3 centre of a 16:9 picture: left and right 0.125 trimmed
    res = qa_render.check_pptx(deck_with(tmp_path, box=(1, 1, 4.0, 3.0), crop=(0.125, 0, 0.125, 0)))
    assert not [c for c in checks(res) if c[1] == "picture_stretch"]


def test_a_picture_within_the_tolerance_is_not_stretched(tmp_path):
    h = 2.25 * (1 + spec.PICTURE_STRETCH_TOL * 0.5)
    assert not [c for c in checks(qa_render.check_pptx(deck_with(tmp_path, box=(1, 1, 4.0, h)))) if c[1] == "picture_stretch"]
    h = 2.25 * (1 + spec.PICTURE_STRETCH_TOL * 3)
    assert [c for c in checks(qa_render.check_pptx(deck_with(tmp_path, box=(1, 1, 4.0, h)))) if c[1] == "picture_stretch"]


# ---------------------------------------------------------------- picture_lowres

def test_a_picture_at_40_ppi_gives_picture_lowres(tmp_path):
    res = qa_render.check_pptx(deck_with(tmp_path, pic_px=(160, 90), box=(1, 1, 4.0, 2.25)))
    low = [f for fs in res["slides"].values() for f in fs if f["check"] == "picture_lowres"]
    assert len(low) == 1 and "40 ppi" in low[0]["message"] and low[0]["level"] == "warn"


def test_the_ppi_is_measured_on_the_crop_that_is_shown(tmp_path):
    # 400 px wide: 100 ppi over 4 in when whole; the middle half of it is 200 px over 4 in = 50 ppi
    whole = qa_render.check_pptx(deck_with(tmp_path, pic_px=(400, 225), box=(1, 1, 4.0, 2.25)))
    assert not [c for c in checks(whole) if c[1] == "picture_lowres"]
    cropped = qa_render.check_pptx(deck_with(tmp_path, pic_px=(400, 225), box=(1, 1, 4.0, 2.25 / 2), crop=(0.25, 0.25, 0.25, 0.25)))
    assert [c for c in checks(cropped) if c[1] == "picture_lowres"]


def test_a_sharp_picture_gives_none_of_the_two(tmp_path):
    res = qa_render.check_pptx(deck_with(tmp_path))
    assert not [c for c in checks(res) if c[1] in ("picture_stretch", "picture_lowres")]


# ---------------------------------------------------------------- text over a picture

def test_the_existing_contrast_check_skips_text_over_a_picture(tmp_path):
    """Light text on a light picture: the slide background is white, white text on it would be a contrast error the picture hides. The
    check must not judge against the background (nor pass by it): it skips, and text_on_image_contrast looks at the render."""
    p = deck_with(tmp_path, text="Light words", text_rgb=(250, 250, 250))
    assert not [c for c in checks(qa_render.check_pptx(p)) if c[1] == "contrast"]
    plain = Presentation(str(p))   # the same text with no picture under it IS a contrast finding
    pic = next(sh for sh in plain.slides[0].shapes if sh.name == "Picture")
    pic._element.getparent().remove(pic._element)
    plain.save(tmp_path / "plain.pptx")
    assert [c for c in checks(qa_render.check_pptx(tmp_path / "plain.pptx")) if c[1] == "contrast"]


def ppm(path: Path, w: int, h: int, rgb) -> Path:
    path.write_bytes(f"P6\n{w} {h}\n255\n".encode() + bytes(rgb) * (w * h))
    return path


def test_light_text_over_a_light_picture_with_no_scrim_gives_text_on_image_contrast(tmp_path, monkeypatch):
    p = deck_with(tmp_path, text="Light words", text_rgb=(250, 250, 250), colour=(235, 235, 235))
    pdf = tmp_path / "d.pdf"
    pdf.write_bytes(b"%PDF")
    w, h = 400, 225
    monkeypatch.setattr(qa_render, "render_ppm", lambda pdf_, work, dpi=30: [ppm(work / "p-1.ppm", w, h, (235, 235, 235))])
    res = qa_render.check_pptx(p, pdf)
    hits = [f for f in res["slides"].get("1", []) if f["check"] == "text_on_image_contrast"]
    assert hits and "needs 3:1" in hits[0]["message"] and "'Body'" in hits[0]["message"] and hits[0]["level"] == "error"


def test_dark_text_over_the_same_picture_is_fine(tmp_path, monkeypatch):
    p = deck_with(tmp_path, text="Dark words", text_rgb=(20, 20, 20), colour=(235, 235, 235))
    pdf = tmp_path / "d.pdf"
    pdf.write_bytes(b"%PDF")
    monkeypatch.setattr(qa_render, "render_ppm", lambda pdf_, work, dpi=30: [ppm(work / "p-1.ppm", 400, 225, (235, 235, 235))])
    res = qa_render.check_pptx(p, pdf)
    assert not [f for f in res["slides"].get("1", []) if f["check"] == "text_on_image_contrast"]


@pytest.mark.skipif(SOFFICE is None, reason="LibreOffice is not installed")
def test_text_on_image_contrast_on_a_real_soffice_render(tmp_path):
    """The check measured on pixels LibreOffice really drew, not on a PPM the test wrote."""
    p = deck_with(tmp_path, text="Light words", text_rgb=(250, 250, 250), colour=(235, 235, 235))
    subprocess.run([SOFFICE, "--headless", "--convert-to", "pdf", "--outdir", str(tmp_path), str(p)], check=True, capture_output=True, timeout=180)
    res = qa_render.check_pptx(p, tmp_path / "d.pdf")
    assert [f for f in res["slides"].get("1", []) if f["check"] == "text_on_image_contrast"], res
    (tmp_path / "x").mkdir()
    dark = deck_with(tmp_path / "x", text="Dark words", text_rgb=(20, 20, 20), colour=(235, 235, 235))
    subprocess.run([SOFFICE, "--headless", "--convert-to", "pdf", "--outdir", str(tmp_path / "x"), str(dark)], check=True, capture_output=True, timeout=180)
    assert not [f for f in qa_render.check_pptx(dark, tmp_path / "x" / "d.pdf")["slides"].get("1", []) if f["check"] == "text_on_image_contrast"]


# ---------------------------------------------------------------- the demo deck

def test_the_demo_deck_gives_none_of_the_three_except_the_deliberate_low_resolution_picture(demo_stages, build_demo, tmp_path):
    demo = Path(__file__).resolve().parent / "fixtures" / "frames_demo"
    run = build_demo(demo_stages, tmp_path / "o", "--pictures", "creative_cover", "--image", f"s01.picture={demo / 'cover.png'}", "--image-rights", "s01.picture=own",
                     "--image", f"s05.picture={demo / 'small.png'}", "--image-rights", "s05.picture=own")
    res = qa_render.check_pptx(run / "deck.pptx")
    got = [c for c in checks(res) if c[1] in ("picture_stretch", "picture_lowres", "text_on_image_contrast", "contrast")]
    assert got == [("5", "picture_lowres", "warn")], got


def test_the_picture_label_text_is_a_caption_frame_with_a_solid_pill(demo_stages, build_demo, tmp_path):
    run = build_demo(demo_stages, tmp_path / "o", "--pictures", "creative_cover")
    prs = Presentation(str(run / "deck.pptx"))
    cap = [sh for sh in prs.slides[7].shapes if sh.name == "Caption" and sh.text_frame.text == "Illustrative"]
    assert len(cap) == 4 and all(sh.text_frame.paragraphs[0].runs[0].font.size.pt >= qa_render.FLOORS["caption"] for sh in cap)
