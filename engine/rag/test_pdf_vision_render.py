"""The image-PDF path renders pages with pypdfium2 (which replaced PyMuPDF, AGPL) and hands
each page to the vision transcriber as a PNG. The vision call is faked: no network.
Run: cd engine/rag && python3 -m pytest -q test_pdf_vision_render.py
"""
from __future__ import annotations

import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent))
import pytest  # noqa: E402
import brief_ingest  # noqa: E402

pdfium = pytest.importorskip("pypdfium2")
pytest.importorskip("PIL")


def _blank_pdf(path: Path, pages: int) -> Path:
    """A PDF of blank A4 pages, written with pypdfium2 itself."""
    doc = pdfium.PdfDocument.new()
    for _ in range(pages):
        doc.new_page(595, 842)
    doc.save(str(path))
    doc.close()
    return path


def test_each_page_is_rendered_to_png_and_transcribed_in_order(monkeypatch, tmp_path):
    seen = []

    def fake(data, mime, label=""):
        seen.append((data[:8], mime, label))
        return f"text of {label}"

    monkeypatch.setattr(brief_ingest, "_vision_transcribe", fake)
    out = brief_ingest._pdf_vision_transcribe(_blank_pdf(tmp_path / "deck.pdf", 3))
    assert [s[2] for s in seen] == ["deck.pdf p1", "deck.pdf p2", "deck.pdf p3"]
    assert all(s[0] == b"\x89PNG\r\n\x1a\n" and s[1] == "image/png" for s in seen)
    assert out.startswith("--- page 1 ---\ntext of deck.pdf p1") and "--- page 3 ---" in out


def test_max_pages_caps_the_transcription(monkeypatch, tmp_path):
    monkeypatch.setattr(brief_ingest, "_vision_transcribe", lambda d, m, label="": "x")
    out = brief_ingest._pdf_vision_transcribe(_blank_pdf(tmp_path / "long.pdf", 4), max_pages=2)
    assert out.count("--- page") == 2
