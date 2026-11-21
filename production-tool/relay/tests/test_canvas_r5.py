"""UAT round 5, images and canvas (features/pt-canvas-r5.clan): the extend seam at the picture's edge (S2-C), the
extend words (S3-2) and shop signs in frames (S3-6)."""

from __future__ import annotations

import io

from PIL import Image, ImageDraw

import formats
from director.director import NO_OTHER_BRANDS, NO_REAL_SIGNS, _no_other_brands
from providers.types import load_sheet

RUNWAY = load_sheet("runway")


def png(img) -> bytes:
    b = io.BytesIO()
    img.save(b, format="PNG")
    return b.getvalue()


def streaky_sky(w=1536, h=864) -> Image.Image:
    """The live repro's sky: a dusk gradient with soft cloud streaks about 36 px apart (far finer than round 4's 8 %
    blur, about 70 px here, which is what left the step), a horizon and sea below."""
    import math
    img = Image.new("RGB", (w, h))
    d = ImageDraw.Draw(img)
    for y in range(h):
        if y < h * 0.55:
            streak = int(round(12 * math.sin(y * 2 * math.pi / 36)))
            c = (150 + y * 60 // h + streak, 130 - y * 20 // h + streak // 2, 155 - y * 50 // h)
        else:
            c = (120, 100, 110)
        d.line([(0, y), (w, y)], fill=c)
    return img


def boundary_step(img: Image.Image, x0: int, rows: int) -> tuple[int, float]:
    """Per row, the grey just outside x0 (x0-3..x0-1) minus just inside (x0..x0+2): (max, mean) of its size."""
    g = img.convert("L")
    h = g.height
    a = g.crop((x0 - 3, 0, x0 - 1, h)).resize((1, h), Image.BOX)
    b = g.crop((x0, 0, x0 + 2, h)).resize((1, h), Image.BOX)
    d = [abs(a.getpixel((0, y)) - b.getpixel((0, y))) for y in range(rows)]
    return max(d), sum(d) / rows


def row_step(img: Image.Image, y0: int, x0: int, x1: int) -> tuple[int, float]:
    g = img.convert("L")
    a = g.crop((x0, y0 - 3, x1, y0 - 1)).resize((x1 - x0, 1), Image.BOX)
    b = g.crop((x0, y0, x1, y0 + 2)).resize((x1 - x0, 1), Image.BOX)
    d = [abs(a.getpixel((x, 0)) - b.getpixel((x, 0))) for x in range(x1 - x0)]
    return max(d), sum(d) / len(d)


LIVE_219 = formats.step_plans(formats.pad_plan(1536, 864, 2048, 878))[0]  # the live job: 1536x864 to 2048x878, 1 step


def test_the_21_9_seed_meets_each_row_of_the_edge():
    """S2-C, the live shape: the seed beside the picture is the picture's own tone, row by row (round 4's seed was up to
    8 levels off in the sky, mean 2.7, and Ideogram kept that step)."""
    plan = LIVE_219
    at = plan["at"]
    assert plan["steps"] == 1 and at["x"] > 0
    seed = Image.open(io.BytesIO(formats.padded_step(png(streaky_sky()), plan)[0])).convert("RGB")
    sky = int(864 * 0.5)
    for x0 in (at["x"], at["x"] + at["w"] + 2):
        worst, mean = boundary_step(seed, x0, sky)
        assert worst <= 3 and mean <= 1.0, (x0, worst, mean)


def test_a_kept_step_is_matched_away_on_landing():
    """If the model keeps a step at the boundary anyway (round 5: it returned the seed nearly as it was), the landing
    matches the band's tone to the picture's edge row by row: no step is left, and the band's far side is untouched."""
    plan = LIVE_219
    at = plan["at"]
    sky = streaky_sky()
    canvas = Image.open(io.BytesIO(formats.padded_step(png(sky), plan)[0])).convert("RGB")
    # The model's result: the band up to 8 levels off the picture, greyer here and brighter there (a kept step).
    import math
    result = canvas.copy()
    px = result.load()
    for y in range(result.height):
        off = int(round(8 * math.sin(y * 2 * math.pi / 120))) - 2
        for x in list(range(0, at["x"])) + list(range(at["x"] + at["w"], result.width)):
            r, g, b = px[x, y]
            px[x, y] = (max(0, r + off), max(0, g + off), max(0, b + off))
    before = boundary_step(result, at["x"], 400)
    assert before[0] >= 6
    landed = Image.open(io.BytesIO(formats.feathered(png(result), png(sky), plan))).convert("RGB")
    for x0 in (at["x"], at["x"] + at["w"] + 2):
        worst, mean = boundary_step(landed, x0, 400)
        assert worst <= 3 and mean <= 1.0, (x0, worst, mean)
    # Far out in the band the model's own pixels stand.
    assert landed.getpixel((2, 100)) == result.getpixel((2, 100))


def test_the_4_5_steps_keep_no_seam_top_and_bottom():
    """4:5 had no seam in round 5; it keeps none: each step's seed and its landing meet the picture's rows."""
    plans = formats.step_plans(formats.pad_plan(1536, 864, 4, 5))
    sky = streaky_sky()
    base = png(sky)
    for plan in plans:
        at = plan["at"]
        seed = Image.open(io.BytesIO(formats.padded_step(base, plan)[0])).convert("RGB")
        for y0 in (at["y"], at["y"] + at["h"] + 2):
            worst, mean = row_step(seed, y0, at["x"] + 4, at["x"] + at["w"] - 4)
            assert worst <= 4 and mean <= 1.5, (plan["step"], y0, worst, mean)
        landed = formats.feathered(png(seed), base, plan)
        for y0 in (at["y"], at["y"] + at["h"] + 2):
            worst, mean = row_step(Image.open(io.BytesIO(landed)), y0, at["x"] + 4, at["x"] + at["w"] - 4)
            assert worst <= 4 and mean <= 1.5, (plan["step"], y0, worst, mean)
        base = landed


def test_extend_words_say_flat_colour_not_a_mirror():
    """S3-2: the seed has been flat colour since round 4; the words no longer say the bands mirror the edge."""
    words = formats.EXTEND_PROMPT
    assert "mirror" not in words and "flat colour bands" in words
    assert "empty space" in words and "seam" in words and "No text" in words


def test_a_frame_and_a_generate_say_no_real_shop_names_once():
    """S3-6: frame 1 drew 'PAIN QUOTIDIEN' on the bakery though Dex wrote 'No brands, logos or readable trademarks'."""
    for op in ("frame", "generate"):
        job = {"model": "gemini_image3_pro", "refs": [],
               "prompt": "Medium wide shot. Leo unlocks his bike outside a bakery at dawn. No brands, logos or readable "
                         "trademarks. Full-bleed cinematic image; no text, captions, borders or panels."}
        _no_other_brands(job, op, RUNWAY)
        _no_other_brands(job, op, RUNWAY)
        assert job["prompt"].count(NO_REAL_SIGNS) == 1 and NO_OTHER_BRANDS not in job["prompt"]
        assert job["prompt"].endswith("Full-bleed cinematic image; no text, captions, borders or panels.")
    edit = {"model": "ideogram_4_5", "prompt": "make the door red", "refs": []}
    _no_other_brands(edit, "region_edit", RUNWAY)
    assert NO_REAL_SIGNS not in edit["prompt"]
