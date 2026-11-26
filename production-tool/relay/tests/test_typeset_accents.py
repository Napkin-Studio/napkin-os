"""Words with accents render as letters, not boxes: Pillow's default font has no ú, so an Irish
client's "Lúnasa" came out of the render as "L□nasa" (five-tool run, 2026-11-26)."""

from PIL import Image, ImageDraw

import timeline_layers
import typeset


def _ink(text: str, bold: bool = False) -> bytes:
    font = typeset._font(60, bold)
    img = Image.new("L", (400, 120), 0)
    ImageDraw.Draw(img).text((10, 10), text, font=font, fill=255)
    return img.tobytes()


def test_the_font_is_archivo_regular_and_bold():
    assert typeset._font(40).path.endswith("Archivo-Regular.ttf")
    assert typeset._font(40, True).path.endswith("Archivo-Bold.ttf")


def test_accented_letters_are_not_the_missing_glyph_box():
    box = _ink("￿")  # a code point no font draws: the missing-glyph shape
    for ch in "úéáíóÚÉÁÍÓ€":
        assert _ink(ch) != box, ch
        assert _ink(ch, True) != _ink("￿", True), ch
    assert _ink("ú") != _ink("u")


def test_bold_is_the_bold_face_with_no_fake_stroke():
    img = Image.new("RGB", (1280, 720))
    font, _, _, stroke = typeset.fit("Lúnasa 0.0", (0, 0, 1280, 200), 80, ImageDraw.Draw(img), True)
    assert font.path.endswith("Archivo-Bold.ttf") and stroke == 0


def test_an_end_card_with_a_fada_renders():
    png = timeline_layers.end_card_png(
        {"bg": "#1C2630", "headline": "Still cider.", "line": "Lúnasa 0.0. Alcohol free.", "cta": "", "legal": "Seán's 0.0%"},
        (1280, 720))
    assert png[:8] == b"\x89PNG\r\n\x1a\n"
