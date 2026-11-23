"""Reading the uploaded file: PDF, picture, zip, Word, text."""

import pytest

from brand_fixtures import BIBLE_PAGES, fake_jpeg, fake_png, make_pdf, make_zip
from napkin.brand import material
from napkin.util import TaskError


def test_pdf_text_per_page_and_embedded_pictures():
    rgb = __import__("random").Random(5).randbytes(4800)
    m = material.load("book.pdf", make_pdf(BIBLE_PAGES, fake_jpeg(), rgb))
    assert m.kind == "pdf" and m.page_count == len(BIBLE_PAGES) and m.pdf_pages == len(BIBLE_PAGES)
    assert "Colour palette" in m.pages[2] and "#0A6BA0" in m.pages[2]
    assert [(i.page, i.media_type) for i in m.images] == [(2, "image/jpeg"), (3, "image/png")]
    assert material.media_of(m.images[1].data) == "image/png" and m.images[0].id == "p2-1"


def test_a_picture_is_its_own_material():
    m = material.load("logo.png", fake_png())
    assert m.kind == "image" and m.page_count == 1 and m.images[0].media_type == "image/png" and m.source_kind() == "image"


def test_a_zip_gives_its_pictures_text_and_book():
    z = make_zip({"logos/light.png": fake_png(seed=1), "logos/dark.png": fake_png(seed=2), "fonts/Serif.otf": b"x" * 10,
                  "readme.txt": "Tidewell", "book.pdf": make_pdf(BIBLE_PAGES), "__MACOSX/._x": b"x", ".DS_Store": b"x"})
    m = material.load("kit.zip", z)
    assert m.kind == "zip" and m.source_kind() == "other"
    assert [i.name for i in m.images] == ["light.png", "dark.png"]
    assert m.pages[: len(BIBLE_PAGES)] == [p.strip() for p in m.pages[: len(BIBLE_PAGES)]] and m.pdf_pages == len(BIBLE_PAGES)
    assert m.pages[-1] == "Tidewell"            # loose text comes after the book's pages: page n is place n in the pdf
    assert "fonts/Serif.otf" in m.members and not any("MACOSX" in x for x in m.members)


def test_docx_text(tmp_path):
    d = make_zip({"word/document.xml": "<w:document><w:p><w:t>Colour palette</w:t></w:p><w:p><w:t>#0A6BA0</w:t></w:p></w:document>"})
    m = material.load("book.docx", d)
    assert m.kind == "docx" and "Colour palette" in m.pages[0] and "#0A6BA0" in m.pages[0]


def test_pptx_pages_are_slides_in_order():
    d = make_zip({"ppt/slides/slide10.xml": "<p><a:p><a:t>ten</a:t></a:p></p>", "ppt/slides/slide2.xml": "<p><a:p><a:t>two</a:t></a:p></p>"})
    assert [p for p in material.load("b.pptx", d).pages] == ["two", "ten"]


@pytest.mark.parametrize("name,data,status,etype", [
    ("x.pdf", b"", 422, "unreadable_file"),
    ("x.pdf", b"%PDF-1.4 not really", 422, "unreadable_file"),
    ("x.zip", b"PK\x03\x04garbage", 422, "unreadable_file"),
    ("x.exe", b"MZ....", 415, "unsupported_file"),
])
def test_unreadable_files_are_refused_without_echoing_the_parser(name, data, status, etype):
    with pytest.raises(TaskError) as e:
        material.load(name, data)
    assert (e.value.status, e.value.etype) == (status, etype)


def test_a_zip_bomb_is_refused_before_it_is_expanded(monkeypatch):
    monkeypatch.setattr(material, "ZIP_BYTES", 1000)
    with pytest.raises(TaskError) as e:
        material.load("k.zip", make_zip({"a.txt": "x" * 5000}))
    assert e.value.etype == "unreadable_file" and "too much" in e.value.message


def test_a_zip_with_nothing_readable_is_refused():
    with pytest.raises(TaskError):
        material.load("k.zip", make_zip({"fonts/a.otf": "x"}))
