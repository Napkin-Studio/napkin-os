"""A job comes back at its true shape (features/frame-aspect.clan): the relay asks Runway for the
model's nearest size (provider_ratio, by shape, whatever the terms), then centre-crops the picture
to input.aspect, else input.ratio, measures it, and keeps the original. One case table,
contracts/examples/aspect-cases.json, is shared with the web (canvas/core/sketch.ts)."""

import hashlib
import io
import json

import pytest
from PIL import Image

import aspect
from aspect import TOLERANCE, centre_crop_box, crop_png, measure, target_aspect
from conftest import asset, ref
from contracts_dir import contracts_dir
from director import new_id
from director.director import (
    FLASH_RATIOS, PRO_RATIOS, RUNWAY_CLIP_RATIOS, Director, _nearest_ratio, provider_ratio, provider_sizes,
)
from providers import AssetRef, MockProvider, ProviderJob, Ref
from providers.mock import runway_size

CASES = json.loads((contracts_dir() / "examples" / "aspect-cases.json").read_text())
PRO, FLASH = "gemini_image3_pro", "gemini_image3.1_flash"


def picture(w: int, h: int, fmt: str = "PNG", mode: str = "RGB") -> bytes:
    img = Image.new(mode, (w, h), (40, 90, 160) if mode == "RGB" else (40, 90, 160, 255))
    # A mark in each corner, so a crop that is off by one shows.
    for x, y in ((0, 0), (w - 1, 0), (0, h - 1), (w - 1, h - 1)):
        img.putpixel((x, y), (255, 0, 0) if mode == "RGB" else (255, 0, 0, 255))
    out = io.BytesIO()
    img.save(out, format=fmt)
    return out.getvalue()


# ── the shared case table ────────────────────────────────────────────────────

def test_the_tolerance_is_the_case_tables():
    assert TOLERANCE == CASES["tolerance"]


@pytest.mark.parametrize("case", CASES["cases"], ids=lambda c: c["name"])
def test_every_case_snaps_and_crops_as_the_table_says(case):
    t = case["target"]
    for model, want in case["models"].items():
        aspect_arg = None if case.get("ratio") else t
        size = provider_ratio("runway", "generate", case.get("ratio"), model, aspect=aspect_arg)
        assert size == f"{want['size']['w']}:{want['size']['h']}", (case["name"], model)
        sw, sh = want["size"]["w"], want["size"]["h"]
        if want["crop"] is None:
            assert aspect.same_shape((sw, sh), (t["w"], t["h"]))
            continue
        box = centre_crop_box(sw, sh, t["w"], t["h"])
        assert list(box) == want["crop"]
        assert (box[2] - box[0], box[3] - box[1]) == (want["out"]["w"], want["out"]["h"])
        assert round(1 - (want["out"]["w"] * want["out"]["h"]) / (sw * sh), 4) == want["loss"]


def test_gemini_3_pro_gives_the_four_ratios_at_their_true_shape():
    got = {}
    for ratio in ("16:9", "9:16", "4:5", "1:1"):
        w, h = (int(x) for x in provider_ratio("runway", "generate", ratio, PRO).split(":"))
        out = crop_png(picture(w, h), aspect.parse_ratio(ratio))
        got[ratio] = out[1] if out else (w, h)
    assert got == {"16:9": (1344, 756), "9:16": (756, 1344), "4:5": (896, 1120), "1:1": (1024, 1024)}


# ── the crop ─────────────────────────────────────────────────────────────────

@pytest.mark.parametrize("fmt,mode", [("PNG", "RGB"), ("PNG", "RGBA"), ("JPEG", "RGB"), ("WEBP", "RGB")])
def test_crop_png_reads_png_jpeg_and_webp_and_always_writes_png(fmt, mode):
    png, size, original = crop_png(picture(1344, 768, fmt, mode), (16, 9))
    assert (size, original) == ((1344, 756), (1344, 768))
    img = Image.open(io.BytesIO(png))
    assert img.format == "PNG" and img.size == (1344, 756)
    assert img.mode == ("RGBA" if mode == "RGBA" else "RGB")


def test_the_crop_is_centred_and_the_same_bytes_every_time():
    data = picture(1344, 768)
    a, b = crop_png(data, (16, 9))[0], crop_png(data, (16, 9))[0]
    assert a == b  # one sha256 wherever it runs
    img = Image.open(io.BytesIO(a)).convert("RGB")
    # 12 rows go, 6 from the top and 6 from the bottom: the corner marks are gone.
    assert img.getpixel((0, 0)) == (40, 90, 160) and img.getpixel((1343, 755)) == (40, 90, 160)


def test_no_crop_within_the_tolerance_or_for_what_cannot_be_read():
    assert crop_png(picture(1024, 1024), (1, 1)) is None
    assert crop_png(picture(1920, 1081), (16, 9)) is None  # 0.1% off: within 0.005
    assert crop_png(b"not a picture", (16, 9)) is None
    assert measure(b"not a picture") is None
    assert measure(picture(30, 20)) == (30, 20)


def test_the_target_is_the_aspect_then_the_ratio_and_never_for_video():
    assert target_aspect("generate", {"ratio": "16:9", "aspect": {"w": 191, "h": 100}}) == (191, 100)
    assert target_aspect("frame", {"ratio": "9:16"}) == (9, 16)
    assert target_aspect("region_edit", {"aspect": {"w": 1344, "h": 756}}) == (1344, 756)
    assert target_aspect("view", {}) is None
    assert target_aspect("clip", {"ratio": "16:9"}) is None
    assert target_aspect("clip_edit", {"aspect": {"w": 16, "h": 9}}) is None
    assert target_aspect("generate", {"ratio": "wide"}) is None


def test_region_edit_crop_maths_match_image_ops():
    """image_ops._fit centre-crops through the same box (one rule for both)."""
    from region.image_ops import _fit
    img = Image.new("RGB", (1344, 768))
    assert _fit(img, (1344, 756)).size == (1344, 756)
    assert centre_crop_box(1344, 768, 1344, 756) == (0, 6, 1344, 762)


# ── the size asked for ───────────────────────────────────────────────────────

def test_an_allowed_size_is_returned_as_it_is():
    for table, model in ((PRO_RATIOS, PRO), (FLASH_RATIOS, FLASH)):
        for size in table:
            assert provider_ratio("runway", "generate", size, model) == size
    for size in RUNWAY_CLIP_RATIOS:
        assert provider_ratio("runway", "clip", size) == size


@pytest.mark.parametrize("model", [PRO, FLASH])
def test_any_shape_snaps_by_shape_with_no_cap_on_its_terms(model):
    assert provider_ratio("runway", "generate", None, model, aspect={"w": 1080, "h": 1920}) == "768:1344"
    assert provider_ratio("runway", "generate", None, model, aspect={"w": 191, "h": 100}) == "1344:768"
    assert provider_ratio("runway", "generate", "1080:1350", model) == "896:1152"
    # The aspect wins over the ratio.
    assert provider_ratio("runway", "frame", "16:9", model, aspect={"w": 9, "h": 16}) == "768:1344"


def test_sizes_are_read_in_one_place():
    assert provider_sizes("runway", "generate", PRO) is PRO_RATIOS
    assert provider_sizes("runway", "generate", FLASH) is FLASH_RATIOS
    assert provider_sizes("runway", "region_edit", None) is PRO_RATIOS
    assert provider_sizes("runway", "clip", None) is RUNWAY_CLIP_RATIOS
    assert provider_sizes("runway", "clip_edit", None) is None
    assert provider_sizes("mock", "generate", None) is None
    assert provider_ratio("mock", "generate", None, aspect={"w": 191, "h": 100}) == "191:100"
    assert _nearest_ratio("2:1", PRO_RATIOS) == "1344:768"  # a tie with 1536:672 breaks the same way every run


def test_the_directors_size_keeps_the_inputs_aspect_over_the_models_ratio():
    sheet = json.loads((contracts_dir() / "capabilities" / "runway.json").read_text())
    job = {"provider": "runway", "model": PRO, "prompt": "a story frame", "refs": [], "ratio": "16:9"}
    Director._check_provider_limits("generate", sheet, job, {"ratio": "9:16", "aspect": {"w": 1080, "h": 1920}})
    assert job["ratio"] == "768:1344"
    job = {"provider": "runway", "model": PRO, "prompt": "x", "refs": [], "ratio": "16:9"}
    Director._check_provider_limits("generate", sheet, job, {"ratio": "16:9"})
    assert job["ratio"] == "1344:768"


# ── the relay mock renders at Runway's size ──────────────────────────────────

def test_the_mock_renders_image_jobs_at_runways_snapped_size():
    def job(op, ratio):
        return ProviderJob(op=op, provider="mock", model="mock", prompt="x", refs=(), ratio=ratio)
    assert runway_size(job("generate", "16:9")) == (1344, 768)
    assert runway_size(job("frame", "9:16")) == (768, 1344)
    assert runway_size(job("view", "4:5")) == (896, 1152)
    assert runway_size(job("region_edit", "1344:756")) is None  # an edit keeps its source's pixels
    assert runway_size(job("generate", None)) is None
    assert runway_size(job("clip", "16:9")) is None


def test_a_mock_job_comes_back_at_that_size():
    class Clock:
        t = 0.0

        def __call__(self):
            return self.t

    clock = Clock()
    src = picture(64, 48)
    mock = MockProvider(lambda sha: AssetRef(sha, f"https://cdn.test/{sha[-8:]}.png", "image/png"),
                        lambda url: src, clock=clock)
    rid = mock.submit(ProviderJob(op="generate", provider="mock", model="mock", prompt="x",
                                  refs=(Ref("sha256:" + "a" * 64, "in_1", "character"),), ratio="16:9"))
    clock.t = 10
    st = mock.status(rid)
    assert (st.outputs[0].w, st.outputs[0].h) == (1344, 768)
    assert Image.open(io.BytesIO(st.outputs[0].data)).size == (1344, 768)


# ── end to end: the job's output ─────────────────────────────────────────────

def finish(h, token, op, size, **inp):
    """Post a job, let its provider return a w x h picture, and poll it to the end."""
    _, job = h.post_job(token, op=op, expect=200, **inp)
    provider = h.providers[job["provider"]]
    data = picture(*size)
    provider.succeed(job["requestId"], data)
    h.clock.tick(5)
    done = h.poll(token, job["jobId"])
    assert done["state"] == "completed", done
    return done, data, provider


SHOT = {"kind": "shot", "duration_s": 3, "camera": {"size": "wide"}, "action": "a jogger", "refs": []}


@pytest.mark.parametrize("ratio,size,out", [
    ("16:9", (1344, 768), (1344, 756)),
    ("9:16", (768, 1344), (756, 1344)),
    ("4:5", (896, 1152), (896, 1120)),
])
def test_a_frame_comes_back_cropped_to_its_ratio_with_the_original_kept(h, ratio, size, out):
    token = h.as_person()
    done, data, runway = finish(h, token, "frame", size, shot={**SHOT, "id": new_id("shot")}, image=asset(3), ratio=ratio)
    assert runway.submits[0]["ratio"] == f"{size[0]}:{size[1]}"
    (o,) = done["outputs"]
    assert (o["w"], o["h"]) == out and o["croppedFrom"] == {"w": size[0], "h": size[1]} and o["mime"] == "image/png"
    assert Image.open(io.BytesIO(h.blobs.objects[f"out/{o['sha256']}"][0])).size == out
    original = "sha256:" + hashlib.sha256(data).hexdigest()
    assert h.blobs.objects[f"out/{original}"][0] == data  # the uncropped picture stays, under its own sha
    assert o["sha256"] == "sha256:" + hashlib.sha256(h.blobs.objects[f"out/{o['sha256']}"][0]).hexdigest()


def test_a_square_frame_is_measured_and_not_cropped(h):
    done, data, _ = finish(h, h.as_person(), "frame", (1024, 1024), shot={**SHOT, "id": new_id("shot")}, image=asset(3), ratio="1:1")
    (o,) = done["outputs"]
    assert (o["w"], o["h"]) == (1024, 1024) and "croppedFrom" not in o
    assert o["sha256"] == "sha256:" + hashlib.sha256(data).hexdigest()


def test_a_sketch_with_an_exact_shape_comes_back_at_that_shape(h):
    done, _, _ = finish(h, h.as_person(), "generate", (1344, 768), text="a banner",
                        refs=[ref(1, role="layout", kind="drawing")], aspect={"w": 191, "h": 100})
    (o,) = done["outputs"]
    assert (o["w"], o["h"]) == (1344, 704) and o["croppedFrom"] == {"w": 1344, "h": 768}


def test_a_region_edit_keeps_the_pictures_own_shape(h):
    token = h.as_person()
    done, _, runway = finish(h, token, "region_edit", (1344, 768), image=asset(3), text="a red hat",
                             region={"x": 0.1, "y": 0.1, "w": 0.2, "h": 0.2}, aspect={"w": 1344, "h": 756})
    # ideogram_4_5 keeps the picture's own size and takes no ratio (features/image-editor.clan)
    assert "ratio" not in runway.submits[0]
    (o,) = done["outputs"]
    assert (o["w"], o["h"]) == (1344, 756)


def test_a_job_with_no_shape_is_measured_only(h):
    """An edit of an old asset without w/h sends no aspect: nothing is cropped, as before."""
    done, data, _ = finish(h, h.as_person(), "region_edit", (1344, 768), image=asset(3), text="a red hat",
                           region={"x": 0.1, "y": 0.1, "w": 0.2, "h": 0.2})
    (o,) = done["outputs"]
    assert (o["w"], o["h"]) == (1344, 768) and "croppedFrom" not in o


def test_a_video_output_is_never_touched(h):
    token = h.as_person()
    _, job = h.post_job(token, op="clip", expect=200, image=asset(3), refs=[ref(2, "hero_front")], ratio="16:9",
                        shot={**SHOT, "id": new_id("shot")})
    runway = h.providers[job["provider"]]
    url = f"https://provider.test/{job['requestId']}.mp4"
    h.blobs.remote[url] = b"mp4-bytes"
    from providers.types import Status
    runway.states[job["requestId"]] = Status(state="succeeded", outputs=[{"url": url, "mime": "video/mp4", "durationS": 3}])
    h.clock.tick(30)
    done = h.poll(token, job["jobId"])
    (o,) = done["outputs"]
    assert o["mime"] == "video/mp4" and "w" not in o and "croppedFrom" not in o
