"""deck-look fonts: a LOOK_V3 PDF must embed the vendored STATIC faces (pdffonts), never a substitute or a variable instance.

LibreOffice 7.4 on macOS ignores a private profile's fonts folder, so the render only matches when the static faces are installed;
run_deck.check_pdf_fonts turns a silent substitution into a failure that names scripts/install-deck-fonts.sh.
"""
from __future__ import annotations

from pathlib import Path

import pytest

pytest.importorskip("pptx")

from deck import run_deck, spec  # noqa: E402

ROOT = Path(__file__).resolve().parents[3]


def _pptx(tmp_path, fams=("Archivo", "Source Sans 3")) -> Path:
    from pptx import Presentation
    from pptx.util import Inches
    p = Presentation()
    s = p.slides.add_slide(p.slide_layouts[6])
    for i, fam in enumerate(fams):
        tb = s.shapes.add_textbox(Inches(1), Inches(1 + i), Inches(6), Inches(1))
        r = tb.text_frame.paragraphs[0].add_run()
        r.text, r.font.name = f"Words in {fam}", fam
    out = tmp_path / "a.pptx"
    p.save(str(out))
    return out


def _fake(monkeypatch, rows):
    monkeypatch.setattr(run_deck, "pdf_fonts", lambda pdf: rows)


def test_the_named_families_are_read_from_runs_with_words(tmp_path):
    assert run_deck.named_families(_pptx(tmp_path)) == {"Archivo", "Source Sans 3"}
    assert run_deck.named_families(_pptx(tmp_path, ("Arial",))) == set()


def test_the_static_faces_embedded_pass(tmp_path, monkeypatch):
    _fake(monkeypatch, [("Archivo-Bold", True), ("SourceSans3-Regular", True), ("SourceSans3-It", True)])
    got = run_deck.check_pdf_fonts(_pptx(tmp_path), tmp_path / "a.pdf")
    assert got["named"] == ["Archivo", "Source Sans 3"]


def test_a_substituted_font_fails_and_names_the_fix(tmp_path, monkeypatch):
    _fake(monkeypatch, [("Carlito-Bold", True), ("LiberationSans", True)])
    with pytest.raises(run_deck.FontsNotEmbedded) as e:
        run_deck.check_pdf_fonts(_pptx(tmp_path), tmp_path / "a.pdf")
    assert "scripts/install-deck-fonts.sh" in str(e.value) and "Archivo" in str(e.value)


@pytest.mark.parametrize("name", ["SourceSans3-Roman", "SourceSans3-ExtraLight", "ArchivoRoman-Regular", "Archivo-SemiBold"])
def test_a_variable_instance_fails(tmp_path, monkeypatch, name):
    _fake(monkeypatch, [("Archivo-Bold", True), ("SourceSans3-Regular", True), (name, True)])
    with pytest.raises(run_deck.FontsNotEmbedded, match="variable"):
        run_deck.check_pdf_fonts(_pptx(tmp_path), tmp_path / "a.pdf")


def test_a_face_used_but_not_embedded_fails(tmp_path, monkeypatch):
    _fake(monkeypatch, [("Archivo-Bold", True), ("SourceSans3-Regular", False)])
    with pytest.raises(run_deck.FontsNotEmbedded):
        run_deck.check_pdf_fonts(_pptx(tmp_path), tmp_path / "a.pdf")


def test_the_error_is_not_a_runtime_error():
    """The repair loop's pdf_fn turns a RuntimeError into 'no PDF this round'; a font failure must stop the build instead."""
    assert not issubclass(run_deck.FontsNotEmbedded, (RuntimeError, OSError))


def test_the_flag_off_neither_loads_fonts_nor_checks(tmp_path, monkeypatch):
    calls = []
    monkeypatch.setattr(spec, "LOOK_V3", False)
    monkeypatch.setattr(run_deck, "_load_vendored_fonts", lambda p: calls.append("load") or {})
    monkeypatch.setattr(run_deck, "check_pdf_fonts", lambda *a: calls.append("check"))
    monkeypatch.setattr(run_deck, "_soffice", lambda: "true")
    monkeypatch.setattr(run_deck.subprocess, "run", lambda *a, **k: None)
    (tmp_path / "a.pdf").write_bytes(b"%PDF")
    run_deck.to_pdf(tmp_path / "a.pptx", tmp_path)
    assert calls == []


def test_the_flag_on_loads_fonts_and_checks(tmp_path, monkeypatch):
    calls = []
    monkeypatch.setattr(spec, "LOOK_V3", True)
    monkeypatch.setattr(run_deck, "_load_vendored_fonts", lambda p: calls.append("load") or {})
    monkeypatch.setattr(run_deck, "check_pdf_fonts", lambda *a: calls.append("check"))
    monkeypatch.setattr(run_deck, "_soffice", lambda: "true")
    monkeypatch.setattr(run_deck.subprocess, "run", lambda *a, **k: None)
    (tmp_path / "a.pdf").write_bytes(b"%PDF")
    run_deck.to_pdf(tmp_path / "a.pptx", tmp_path)
    assert calls == ["load", "check"]


def test_the_install_script_copies_only_the_static_faces():
    s = (ROOT / "scripts" / "install-deck-fonts.sh").read_text()
    assert "static" in s and "Library/Fonts" in s and ".local/share/fonts" in s


def test_glyph_k_keeps_the_old_estimate_with_the_flag_off(monkeypatch):
    from deck import qa_render
    monkeypatch.setattr(spec, "LOOK_V3", False)
    assert qa_render.glyph_k("Source Sans 3", False) == 0.5 and qa_render.glyph_k("Archivo", True) == 0.56
    monkeypatch.setattr(spec, "LOOK_V3", True)
    from deck import theme
    assert qa_render.glyph_k("Source Sans 3", False) == theme.fit_wf("Source Sans 3", False)
