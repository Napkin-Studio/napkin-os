"""Extend (UAT round 1 IMG-9, features/pt-canvas-r1.clan): the padding seeded from the master's edge, the mask
over the seam, and words that say the bands are empty space to paint."""

import io

from PIL import Image

import formats


def picture(w=320, h=180):
    img = Image.new("RGB", (w, h), (30, 60, 140))
    for x in range(w):  # a horizon: sky above, sea below
        for y in range(h // 2, h):
            img.putpixel((x, y), (20, 90, 110))
    b = io.BytesIO()
    img.save(b, format="PNG")
    return b.getvalue()


def test_extend_seeds_the_bands_from_the_edge_and_redraws_the_seam():
    plan = formats.pad_plan(320, 180, 21, 9)
    canvas, mask = formats.padded(picture(), plan)
    c = Image.open(io.BytesIO(canvas)).convert("RGB")
    m = Image.open(io.BytesIO(mask)).convert("L")
    at = plan["at"]
    assert at["x"] > 0 and c.size == (plan["canvas"]["w"], plan["canvas"]["h"])
    # The horizon runs on into the band: sky above, sea below, at the band's far edge too.
    top, bottom = c.getpixel((2, 20)), c.getpixel((2, 160))
    assert top[2] > bottom[2] + 10 and bottom[1] > top[1] + 10
    # The mask reaches over the master's edge by overlap_px, never less than EXTEND_OVERLAP.
    o = formats.overlap_px(plan)
    assert o >= formats.EXTEND_OVERLAP
    assert m.getpixel((at["x"] + o - 1, 90)) == 255 and m.getpixel((at["x"] + o + 1, 90)) == 0


def test_the_overlap_grows_with_the_picture():
    big = formats.pad_plan(2730, 1536, 21, 9)
    assert formats.overlap_px(big) > formats.EXTEND_OVERLAP


def test_extend_words_say_the_bands_are_empty_space_to_paint():
    words = formats.EXTEND_PROMPT
    assert "empty space" in words and "seam" in words and "keep everything inside exactly" not in words.lower()
    assert "No text" in words
