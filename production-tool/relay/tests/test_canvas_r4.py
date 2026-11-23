"""UAT round 4, images and canvas (features/pt-canvas-r4.clan): the extend seed and its step rule (S1-1), the
director's usage on the job record, a frame's own framing and a layout-only sketch as a photograph (S3-8)."""

from __future__ import annotations

import io

import pytest
from PIL import Image, ImageDraw, ImageFilter, ImageOps, ImageStat

import formats
from director.director import LAYOUT_ONLY_PHOTO, _layout_is_a_photo, _shot_framing
from providers.types import load_sheet
from service import _usage_block

RUNWAY = load_sheet("runway")


def png(img) -> bytes:
    b = io.BytesIO()
    img.save(b, format="PNG")
    return b.getvalue()


def beach(w=1536, h=864) -> Image.Image:
    """The live repro's shape: a sunset sky, a sun near the top, a horizon, a dark figure standing on the sand."""
    img = Image.new("RGB", (w, h))
    d = ImageDraw.Draw(img)
    for y in range(h):
        c = (240 - y * 100 // h, 150 - y * 60 // h, 120 + y * 40 // h) if y < h * 0.55 else (190, 160, 120)
        d.line([(0, y), (w, y)], fill=c)
    d.ellipse((int(w * 0.65), int(h * 0.04), int(w * 0.65) + h // 5, int(h * 0.04) + h // 5), fill=(255, 250, 210))
    d.rectangle((int(w * 0.22), int(h * 0.3), int(w * 0.22) + w // 30, h - 4), fill=(40, 30, 30))  # legs to the bottom edge
    d.line([(0, int(h * 0.55)), (w, int(h * 0.55))], fill=(90, 70, 110), width=6)
    return img


def detail(img: Image.Image) -> Image.Image:
    """The picture's shapes without its broad light: grey minus a heavy blur of itself."""
    grey = img.convert("L")
    r = max(4, min(img.size) // 12)
    from PIL import ImageChops
    return ImageChops.subtract(grey, grey.filter(ImageFilter.GaussianBlur(r)), scale=1.0, offset=128)


def correlation(a: Image.Image, b: Image.Image) -> float:
    xs, ys = list(a.get_flattened_data()), list(b.get_flattened_data())
    n = len(xs)
    mx, my = sum(xs) / n, sum(ys) / n
    sxy = sum((x - mx) * (y - my) for x, y in zip(xs, ys))
    sx = sum((x - mx) ** 2 for x in xs) ** 0.5
    sy = sum((y - my) ** 2 for y in ys) ** 0.5
    return 0.0 if sx < 1e-6 or sy < 1e-6 else sxy / (sx * sy)


# ── S1-1: the seed carries no shape of the picture, and a step is never a mirror of the one before ──────────────

def test_the_seed_has_no_mirrored_structure_of_the_picture():
    """The live repro (round 4): a 16:9 sunset beach grown to 4:5 (three steps). The step's bands are compared with
    the picture mirrored into them, as round 3 seeded them: their shapes must not correlate, and the band holds
    almost no fine detail (no sun, no legs, no shoreline)."""
    master = beach(384, 216)
    plan = formats.step_plans(formats.pad_plan(384, 216, 4, 5))[0]
    canvas, _ = formats.padded_step(png(master), plan)
    seed = Image.open(io.BytesIO(canvas)).convert("RGB")
    at = plan["at"]
    base = master.resize((at["w"], at["h"]))
    assert at["y"] > 0  # padded above and below
    top = seed.crop((0, 0, seed.width, at["y"]))
    bottom = seed.crop((0, at["y"] + at["h"], seed.width, seed.height))
    mirror_top = ImageOps.flip(base.crop((0, 0, at["w"], at["y"])))
    mirror_bottom = ImageOps.flip(base.crop((0, at["h"] - bottom.height, at["w"], at["h"])))
    # Round 3's seed (a mirror) correlates fully: the check can see one.
    assert correlation(detail(mirror_top), detail(mirror_top)) > 0.99
    for band, mirror in ((top, mirror_top), (bottom, mirror_bottom)):
        assert band.size == mirror.size
        assert abs(correlation(detail(band), detail(mirror))) < 0.2
        assert ImageStat.Stat(detail(band)).stddev[0] < 3  # flat: no shape the model could keep


def test_a_later_step_reads_only_the_edge_of_the_step_before():
    """Step 2 grows step 1's canvas: whatever step 1 painted in its band (here a bright sun near the edge) never comes
    back as a mirrored copy in step 2's band."""
    plan = formats.pad_plan(384, 216, 4, 5)
    s1, s2 = formats.step_plans(plan)[:2]
    grown = Image.new("RGB", (s1["canvas"]["w"], s1["canvas"]["h"]), (120, 100, 140))
    ImageDraw.Draw(grown).ellipse((150, 20, 230, 100), fill=(255, 250, 210))  # a painted sun, 20 px under the top
    canvas, _ = formats.padded_step(png(grown), s2)
    seed = Image.open(io.BytesIO(canvas)).convert("RGB")
    band = seed.crop((0, 0, seed.width, s2["at"]["y"]))
    assert ImageStat.Stat(detail(band)).stddev[0] < 3
    # The band's brightest spot is far below the sun's: no disc was copied up.
    assert max(band.convert("L").get_flattened_data()) < 200


def test_the_seed_meets_the_pictures_edge_colour():
    """No hard step where the band starts: the row beside the master's top edge is that edge's colour, blurred."""
    master = beach(384, 216)
    plan = formats.step_plans(formats.pad_plan(384, 216, 4, 5))[0]
    seed = Image.open(io.BytesIO(formats.padded_step(png(master), plan)[0])).convert("RGB")
    at = plan["at"]
    base = master.resize((at["w"], at["h"]))
    edge = ImageStat.Stat(base.crop((0, 0, at["w"], 4))).mean
    beside = ImageStat.Stat(seed.crop((0, at["y"] - 3, seed.width, at["y"] - 1))).mean
    assert all(abs(a - b) < 20 for a, b in zip(edge, beside)), (edge, beside)


@pytest.mark.parametrize("master, aspect, steps, fits", [
    ((1536, 864), (21, 9), 1, True),
    ((1536, 864), (1, 1), 2, True),
    ((1536, 864), (4, 5), 3, True),
    ((1536, 864), (32, 9), 3, True),
    ((1536, 864), (9, 16), 4, False),   # the live repro: 3.16x is past three steps of 35 %
    ((1024, 1024), (9, 16), 2, True),
])
def test_an_extend_fits_three_steps_of_35_percent_or_is_not_an_extend(master, aspect, steps, fits):
    assert formats.steps_needed(*master, *aspect) == steps
    assert formats.extend_fits(*master, *aspect) is fits
    if fits:
        plans = formats.step_plans(formats.pad_plan(*master, *aspect))
        assert len(plans) == steps
        for p in plans:  # every step grows its side by at most 35 % (round 4: x1.47 a step)
            c, at = p["canvas"], p["at"]
            assert max(c["w"] / at["w"], c["h"] / at["h"]) <= 1 + formats.STEP_GROWTH + 0.01


def test_an_extend_past_three_steps_is_refused_before_any_spend_and_says_redraw():
    from test_campaign import paid_harness, size_input
    h = paid_harness()
    token = h.as_person()
    _, out = h.post_job(token, op="resize", expect=400, **size_input(h, "extend"))  # 16:9 master to 9:16
    assert out["error"]["code"] == "invalid_input"
    assert "Redraw it at 9:16" in out["error"]["message"] and "too far" in out["error"]["message"]
    assert not h.providers["runway"].submits and h.store.counters("spend").get("usd", 0) == 0
    _, job = h.post_job(token, op="resize", expect=200, **size_input(h, "regenerate"))  # Redraw at 9:16 runs
    assert job["state"] in ("queued", "submitted") and "progress" not in job


# ── observability: the director's tokens on the job record ─────────────────────────────────────────────────────

def test_usage_is_kept_in_the_record_shape():
    assert _usage_block({"input_tokens": 9009, "output_tokens": 203, "cache_read_input_tokens": 0}) == \
        {"inputTokens": 9009, "outputTokens": 203, "cacheReadTokens": 0}
    assert _usage_block(None) is None and _usage_block({}) is None


def test_a_director_jobs_record_carries_its_usage():
    from conftest import Harness, base_config
    h = Harness(base_config())
    inner = h.relay.director

    class Counted:
        model = getattr(inner, "model", "m")
        prompt_version = getattr(inner, "prompt_version", "director.v17")

        def __getattr__(self, k):
            return getattr(inner, k)

        def direct(self, req, sheet, **kw):
            out = dict(inner.direct(req, sheet, **kw))
            out["_usage"] = {"input_tokens": 9009, "output_tokens": 203}
            return out

    h.relay.director = Counted()
    token = h.as_person()
    _, job = h.post_job(token, op="generate", expect=200, text="a cottage at midday", ratio="16:9")
    assert job["director"]["usage"] == {"inputTokens": 9009, "outputTokens": 203}


# ── a frame's own framing; a layout with no words is a photograph ──────────────────────────────────────────────

def test_a_frame_says_its_shots_size_and_angle_when_dex_did_not():
    job = {"prompt": "Mia carries the bundled puppy into a warm corner cafe.", "model": "gemini_image3_pro"}
    _shot_framing(job, "frame", {"shot": {"camera": {"size": "medium_wide", "angle": "eye_level"}}}, RUNWAY)
    assert job["prompt"].endswith("Frame it as a medium wide shot, at eye level, as the shot list says.")
    said = {"prompt": "A medium wide shot at eye level: Mia carries the puppy.", "model": "gemini_image3_pro"}
    before = said["prompt"]
    _shot_framing(said, "frame", {"shot": {"camera": {"size": "medium_wide", "angle": "eye_level"}}}, RUNWAY)
    assert said["prompt"] == before
    gen = {"prompt": "a cottage", "model": "gemini_image3_pro"}
    _shot_framing(gen, "generate", {"shot": {"camera": {"size": "wide"}}}, RUNWAY)
    assert gen["prompt"] == "a cottage"


def test_a_layout_only_sketch_with_no_words_asks_for_a_photograph():
    layout = {"refs": [{"tag": "sk", "role": "layout", "kind": "drawing"}]}
    job = {"prompt": "A house with a roof and a tree, the sun above, following @sk's layout.", "model": "gemini_image3_pro"}
    _layout_is_a_photo(job, "generate", layout, RUNWAY)
    assert LAYOUT_ONLY_PHOTO in job["prompt"] and "not a drawing or clip art" in job["prompt"]
    worded = {"prompt": "a poster", "model": "gemini_image3_pro"}
    _layout_is_a_photo(worded, "generate", {**layout, "text": "a poster for the fair"}, RUNWAY)
    assert worded["prompt"] == "a poster"
