"""Calibration of ``Renderer.wrap`` against LibreOffice (local only: skipped without soffice and pdftotext).

The renderer estimates glyph width as a fraction of the size (``Renderer._wf``). This renders paragraphs at several sizes and widths, reads the
line counts back with pdftotext and requires the estimate never to be under what LibreOffice set (an estimate that is too small overflows) and
never more than three lines over (an estimate that is too generous wastes the slide). The 2026-11-18 run: the estimate ran 2 to 3 lines over on
frames of 8 to 12 lines (real lines hold about 15 to 25 % more characters than the estimate), which is the margin the 48-character cap and the fit ladder were built on.
"""
from __future__ import annotations

import copy
import json
import shutil
import subprocess
from pathlib import Path

import pytest
from pptx import Presentation
from pptx.util import Inches, Pt

from deck import render_pptx

SOFFICE = shutil.which("soffice") or "/Applications/LibreOffice.app/Contents/MacOS/soffice"
pytestmark = pytest.mark.skipif(not Path(SOFFICE).exists() or not shutil.which("pdftotext"), reason="needs LibreOffice and pdftotext (local calibration)")
GOLD = json.loads((Path(__file__).with_name("fixtures") / "lumen_water" / "golden_deck.json").read_text())
TEXT = ("People care about water in the abstract but never connect it to the tap they use. The brief names the gap between caring and acting, "
        "and the idea is to close it with one small daily habit that every household can keep without thinking about it twice. ") * 2
CASES = ((16, 5.0), (14, 5.0), (22, 7.0), (12, 4.0))


def test_wrap_line_counts_against_pdftotext(tmp_path):
    R = render_pptx.Renderer(copy.deepcopy(GOLD), None)
    prs = Presentation()
    prs.slide_width, prs.slide_height = Inches(13.333), Inches(7.5)
    for size, w in CASES:
        sl = prs.slides.add_slide(prs.slide_layouts[6])
        tf = sl.shapes.add_textbox(Inches(1), Inches(1), Inches(w), Inches(5)).text_frame
        tf.word_wrap = True
        tf.margin_left = tf.margin_right = tf.margin_top = tf.margin_bottom = 0
        run = tf.paragraphs[0].add_run()
        run.text, run.font.size, run.font.name = TEXT, Pt(size), "Calibri"
    prs.save(str(tmp_path / "cal.pptx"))
    subprocess.run([SOFFICE, "--headless", "--convert-to", "pdf", "--outdir", str(tmp_path), str(tmp_path / "cal.pptx")], check=True, capture_output=True, timeout=180)
    for n, (size, w) in enumerate(CASES, 1):
        txt = subprocess.run(["pdftotext", "-f", str(n), "-l", str(n), "-layout", str(tmp_path / "cal.pdf"), "-"], capture_output=True, text=True, check=True).stdout
        real = len([l for l in txt.splitlines() if l.strip()])
        est = len(R.wrap(TEXT, w, size))
        assert real <= est <= real + 3, (size, w, est, real)
