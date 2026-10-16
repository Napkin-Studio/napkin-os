"""Make all sizes on the relay (features/campaign-formats.clan): the subject-aware crop, the free
resize op and the type layers drawn over a size. Nothing here calls a provider."""

import io
import json

import pytest
from PIL import Image, ImageDraw

import formats
import typeset
from conftest import CDN, Harness, asset, base_config
from contracts_dir import contracts_dir

CASES = json.loads((contracts_dir() / "examples" / "crop-cases.json").read_text())["cases"]


@pytest.mark.parametrize("case", CASES, ids=[c["name"] for c in CASES])
def test_the_crop_case_table(case):
    fr = formats.safe_fracs(case.get("safeArea"), case.get("delivery"))
    box, fits = formats.crop_box(case["master"]["w"], case["master"]["h"], case["aspect"]["w"], case["aspect"]["h"], case["protect"], fr)
    assert box == case["crop"] and fits == case["fits"]


def test_every_crop_has_the_format_shape_and_stays_in_the_master():
    packs = json.loads((contracts_dir() / "format-packs.json").read_text())
    for pack in packs["packs"]:
        for f in pack["formats"]:
            d = f["delivery_px"]
            for mw, mh in ((1536, 864), (864, 1536), (1024, 1024)):
                box, _ = formats.crop_box(mw, mh, d["width"], d["height"], [{"role": "subject", "x": mw * 0.6, "y": mh * 0.2, "w": mw * 0.2, "h": mh * 0.5}])
                assert 0 <= box["x"] and box["x"] + box["w"] <= mw and 0 <= box["y"] and box["y"] + box["h"] <= mh, f["id"]
                assert abs((box["w"] / box["h"]) / (d["width"] / d["height"]) - 1) <= 1.001 / min(box["w"], box["h"]), f["id"]


def test_the_preview_keeps_the_delivery_shape_at_most_2048_and_never_grows():
    assert formats.preview_size({"width": 7200, "height": 3600}) == (2048, 1024)
    assert formats.preview_size({"width": 300, "height": 250}) == (300, 250)
    assert formats.preview_size({"width": 1440, "height": 2560}, 1024) == (576, 1024)


def png(w=320, h=180) -> bytes:
    img = Image.new("RGB", (w, h), (30, 60, 120))
    ImageDraw.Draw(img).rectangle((40, 30, 80, 150), fill=(240, 200, 60))
    out = io.BytesIO()
    img.save(out, format="PNG")
    return out.getvalue()


def stored(h, n=7, data=None):
    a = asset(n)
    h.blobs.put(f"in/{a['sha256']}", data or png(), "image/png")
    return a


def size_input(h, method="crop", **rz):
    return {"image": stored(h), "aspect": {"w": 9, "h": 16}, "delivery": {"width": 1440, "height": 2560},
            "safeArea": {"type": "insets", "top": 14, "right": 6, "bottom": 35, "left": 6, "unit": "%"},
            "resize": {"method": method, "masterSize": {"w": 320, "h": 180},
                       "protect": [{"role": "subject", "x": 40, "y": 30, "w": 40, "h": 120}], **rz}}


def test_a_crop_is_made_on_the_relay_free_uncounted_and_off_the_in_flight_limit():
    h = Harness(base_config())
    token = h.as_person()
    before = h.relay.remaining(h.people[token]["pid"])
    jobs = [h.post_job(token, op="resize", expect=200, **size_input(h))[1] for _ in range(6)]  # over inFlightPerParticipant
    for job in jobs:
        assert job["state"] == "completed" and job["crew"] == "wren" and job["cost"]["reserved"] == 0
        assert job["resize"]["method"] == "crop" and job["resize"]["previewPx"] == {"width": 1152, "height": 2048}
        assert job["outputs"][0]["w"] == 1152 and job["outputs"][0]["h"] == 2048
    # The crop moved left to keep the subject (x 40..80) in the middle of the safe area.
    assert jobs[0]["resize"]["crop"] == {"x": 10, "y": 0, "w": 101, "h": 180}
    assert h.relay.remaining(h.people[token]["pid"]) == before
    assert h.store.counters(f"inflight#{h.people[token]['pid']}").get("n", 0) == 0
    assert h.store.counters("spend").get("usd", 0) == 0
    assert not h.providers["mock"].submits and not h.providers["runway"].submits
    out = Image.open(io.BytesIO(h.blobs.fetch(jobs[0]["outputs"][0]["url"])))
    assert out.size == (1152, 2048)


def test_the_web_crop_is_used_as_sent():
    h = Harness(base_config())
    token = h.as_person()
    _, job = h.post_job(token, op="resize", expect=200, **size_input(h, crop={"x": 200, "y": 0, "w": 101, "h": 180}))
    assert job["resize"]["crop"] == {"x": 200, "y": 0, "w": 101, "h": 180}


def paid_harness(**over):
    cfg = base_config(**over)
    cfg["routing"].update(resize=["runway"], upscale=["runway"])
    h = Harness(cfg)
    # Ideogram and Magnific are off unless the agency asks (subprocessors.json): this agency asked.
    h.limits("blue", allow={"claude": True, "makers": ["runway", "google", "ideogram", "magnific"]})
    return h


def test_with_ideogram_off_extend_is_refused_and_regenerate_runs_on_gemini():
    h = paid_harness()
    h.limits("blue", allow={"claude": True, "makers": ["runway", "google"]})
    token = h.as_person()
    _, out = h.post_job(token, op="resize", expect=403, **size_input(h, "extend"))
    assert out["error"]["code"] == "not_allowed"
    _, job = h.post_job(token, op="resize", expect=200, **size_input(h, "regenerate"))
    assert job["model"] == "gemini_image3_pro"


LINE = "First light. First sip."
LAYERS = [{"kind": "line", "box": {"x": 0.08, "y": 0.15, "w": 0.84, "h": 0.1}, "text": LINE, "sizeFrac": 0.03,
           "colour": "#FFFFFF", "weight": "bold"}]


def finish_job(h, token, job, data):
    """The provider's picture lands: the job's rid succeeds with `data`, then the relay polls it."""
    p = h.providers[job["provider"]]
    rid = job["requestId"] if "requestId" in job else f"{job['provider']}-{len(p.submits)}"
    p.succeed(rid, data=data, cost=0.25)
    h.clock.tick(10)
    return h.poll(token, job["jobId"])


def test_extend_sends_the_padded_canvas_and_a_mask_to_ideogram_at_high_never_the_words():
    h = paid_harness()
    token = h.as_person()
    _, job = h.post_job(token, op="resize", expect=200, **size_input(h, "extend", layers=LAYERS))
    runway = h.providers["runway"]
    (sent,) = runway.submits
    assert job["provider"] == "runway" and job["model"] == "ideogram_4_5" and job["crew"] == "wren"
    assert job["cost"]["reserved"] == 0.25  # Ideogram 4.5 at high: 25 credits (the paid tests: medium failed)
    assert sent["prompt"] == formats.EXTEND_PROMPT and LINE not in json.dumps(sent)
    assert [r["role"] for r in sent["refs"]] == ["current"] and sent["mask"] and "ratio" not in sent
    # The canvas is the size's shape (9:16 round a 320 x 180 master: 320 x 569), the master at its own pixels.
    canvas = Image.open(io.BytesIO(h.blobs.fetch(f"{CDN}/ads/scratch/{job['jobId']}/canvas.jpg")))
    mask = Image.open(io.BytesIO(h.blobs.fetch(f"{CDN}/ads/scratch/{job['jobId']}/mask.png")))
    assert canvas.size == mask.size == (320, 569)
    # Ours is white where Ideogram fills (the padding) and black on the master, less 16 px at its seams.
    at = formats.pad_plan(320, 180, 9, 16, [{"x": 40, "y": 30, "w": 40, "h": 120}], formats.safe_fracs(size_input(h)["safeArea"]))["at"]
    assert mask.getpixel((160, 5)) == 255 and mask.getpixel((160, at["y"] + 90)) == 0
    assert mask.getpixel((160, at["y"] + 8)) == 255  # the overlap is redrawn
    # It lands cropped to 9:16, at the preview, the plate clean and the words drawn on the size.
    done = finish_job(h, token, job, png(320, 569))
    assert done["state"] == "completed" and done["cost"]["confirmed"] == 0.25
    assert done["resize"]["method"] == "extend" and done["resize"]["layers"] == 1
    assert done["resize"]["previewPx"] == {"width": 1152, "height": 2048}
    assert done["resize"]["crop"] == {"x": 0, "y": 0, "w": 320, "h": 180}
    assert done["outputs"][0]["w"] == 1152 and done["resize"]["plate"]["sha256"] != done["outputs"][0]["sha256"]
    plate = Image.open(io.BytesIO(h.blobs.fetch(done["resize"]["plate"]["url"])))
    assert plate.size == (1152, 2048)


def test_the_master_sits_so_the_subject_is_in_the_middle_of_the_safe_area():
    # Reels: top 14 %, bottom 35 %. The subject's middle is the master's: it goes to the safe area's middle.
    plan = formats.pad_plan(1200, 675, 9, 16, [{"x": 500, "y": 225, "w": 200, "h": 225}], (0.06, 0.14, 0.06, 0.35))
    c, at = plan["canvas"], plan["at"]
    assert (c["w"], c["h"]) == (1200, 2133) and (at["w"], at["h"]) == (1200, 675)
    middle = (at["y"] + 337.5) / c["h"]
    assert abs(middle - (0.14 + 0.51 / 2)) < 0.01
    # No protected box: centred. A big master is scaled to stay under the limits.
    big = formats.pad_plan(2752, 1536, 9, 16)
    assert max(big["canvas"]["w"], big["canvas"]["h"]) <= formats.EXTEND_MAX_SIDE
    assert big["canvas"]["w"] * big["canvas"]["h"] <= formats.EXTEND_MAX_PX
    assert big["at"]["y"] == (big["canvas"]["h"] - big["at"]["h"]) // 2
    # 4:1 strip: padded at the sides.
    strip = formats.pad_plan(1365, 768, 4, 1)
    assert strip["canvas"] == {"w": 3072, "h": 768} and strip["at"]["x"] == (3072 - 1365) // 2


def test_regenerate_sends_the_master_as_at_master_to_gemini_3_pro_at_the_nearest_ratio():
    h = paid_harness()
    token = h.as_person()
    _, job = h.post_job(token, op="resize", expect=200, **size_input(h, "regenerate", layers=LAYERS))
    (sent,) = h.providers["runway"].submits
    assert job["model"] == "gemini_image3_pro" and job["cost"]["reserved"] == 0.2
    assert sent["ratio"] == "1536:2752"  # 9:16's nearest at 2K (20 credits, as 1K)
    assert sent["refs"] == [{"sha256": size_input(h)["image"]["sha256"], "name": "master", "role": "object"}]
    assert "@master" in sent["prompt"] and "tall 9:16" in sent["prompt"] and LINE not in json.dumps(sent)
    # Gemini returns a size a little off its ratio (768 x 1376 for 768:1344): cropped to exactly 9:16.
    done = finish_job(h, token, job, png(1536, 2780))
    assert done["state"] == "completed" and done["outputs"][0]["croppedFrom"] == {"w": 1536, "h": 2780}
    out = Image.open(io.BytesIO(h.blobs.fetch(done["outputs"][0]["url"])))
    assert out.size == (1152, 2048)


def test_each_paid_size_reserves_its_own_price_and_the_spend_stop_refuses_the_one_over():
    h = paid_harness(spend={"capUsd": 0.6, "warnUsd": 0.5})
    token = h.as_person()
    _, a = h.post_job(token, op="resize", expect=200, **size_input(h, "extend"))
    _, b = h.post_job(token, op="resize", expect=200, **size_input(h, "regenerate"))
    assert a["cost"]["reserved"] + b["cost"]["reserved"] == pytest.approx(0.45)
    _, c = h.post_job(token, op="resize", expect=503, **size_input(h, "extend"))
    assert c["error"]["code"] == "spend_stop"
    # A free crop still runs past the stop: it spends nothing.
    _, d = h.post_job(token, op="resize", expect=200, **size_input(h))
    assert d["state"] == "completed"


def test_reedit_and_reframe_are_not_a_still_method():
    h = paid_harness()
    token = h.as_person()
    for method in ("reedit", "reframe", "nearest"):
        _, out = h.post_job(token, op="resize", expect=422, **size_input(h, method))
        assert out["error"]["code"] == "capability_missing"
    assert not h.providers["runway"].submits


def test_layout_puts_the_picture_in_its_panel_on_the_brand_colour_free():
    h = Harness(base_config())
    token = h.as_person()
    inp = size_input(h, "layout", panel={"x": 0, "y": 0, "w": 0.25, "h": 1}, background="#102030", layers=LAYERS)
    inp.update(aspect={"w": 728, "h": 90}, delivery={"width": 728, "height": 90})
    inp.pop("safeArea")
    _, job = h.post_job(token, op="resize", expect=200, **inp)
    assert job["state"] == "completed" and job["cost"]["reserved"] == 0 and job["resize"]["method"] == "layout"
    assert not h.providers["runway"].submits and not h.providers["mock"].submits
    plate = Image.open(io.BytesIO(h.blobs.fetch(job["resize"]["plate"]["url"]))).convert("RGB")
    assert plate.size == (728, 90) and plate.getpixel((700, 5)) == (16, 32, 48)
    # The panel holds the master's subject (the yellow bar of png()).
    c = job["resize"]["crop"]
    assert abs(c["w"] / c["h"] - 182 / 90) < 0.02 and c["x"] <= 40 and c["x"] + c["w"] >= 80


def test_an_upscale_for_delivery_lands_at_the_exact_size_with_the_type_drawn_again():
    h = paid_harness()
    token = h.as_person()
    plate = stored(h, 11, png(2048, 1024))
    _, job = h.post_job(token, op="upscale", expect=200, image=plate, scale=4, aspect={"w": 2048, "h": 1024},
                        delivery={"width": 6096, "height": 3048}, layers=LAYERS)
    (sent,) = h.providers["runway"].submits
    assert sent["scale"] == 4 and LINE not in json.dumps(sent) and job["cost"]["reserved"] == 1.5
    # x4 of 2048 x 1024 is over 25.3 MP: the plate goes at 1524 x 762, which x4 just covers 6096 x 3048.
    went = Image.open(io.BytesIO(h.blobs.fetch(f"{CDN}/ads/scratch/{job['jobId']}/plate.png")))
    assert went.size == (1524, 762) and sent["refs"][0]["sha256"] != plate["sha256"]
    done = finish_job(h, token, job, png(6096, 3048))
    assert done["state"] == "completed" and (done["outputs"][0]["w"], done["outputs"][0]["h"]) == (6096, 3048)
    full = Image.open(io.BytesIO(h.blobs.fetch(done["outputs"][0]["url"])))
    assert full.size == (6096, 3048)
    # A side under Magnific's 300 px: refused before any spend.
    _, small = h.post_job(token, op="upscale", expect=400, image=plate, scale=4, aspect={"w": 728, "h": 90},
                          delivery={"width": 2912, "height": 360})
    assert small["error"]["code"] == "invalid_input" and len(h.providers["runway"].submits) == 1


def test_the_delivery_scale_is_x4_else_x8_under_magnifics_limits():
    assert formats.delivery_scale((2048, 1024), (6096, 3048)) == 4
    assert formats.delivery_input((2048, 1024), (6096, 3048), 4) == (1524, 762)
    assert formats.delivery_scale((1024, 1024), (5000, 5000)) == 8   # x4 gives 4096: short of it
    assert formats.delivery_scale((2048, 512), (14400, 3600)) == 8   # over 25.3 MP: x8 gives the most
    assert formats.delivery_input((2048, 512), (14400, 3600), 8) == (1257, 314)
    assert formats.delivery_scale((300, 250), (300, 250)) is None   # already the delivery size
    assert formats.delivery_scale((728, 90), (1456, 180)) is None    # a side under 300 px
    packs = json.loads((contracts_dir() / "format-packs.json").read_text())
    for pack in packs["packs"]:
        for f in pack["formats"]:
            d = f["delivery_px"]
            w, h = formats.preview_size(d)
            k = formats.delivery_scale((w, h), (d["width"], d["height"]))
            if k:
                iw, ih = formats.delivery_input((w, h), (d["width"], d["height"]), k)
                assert iw * k * ih * k <= formats.UPSCALE_MAX_OUT_PX and min(iw, ih) >= 300, f["id"]


def test_type_layers_are_drawn_by_the_relay_and_no_words_reach_a_provider():
    h = Harness(base_config())
    token = h.as_person()
    logo = stored(h, 9, png(60, 20))
    layers = [{"kind": "line", "box": {"x": 0.08, "y": 0.15, "w": 0.84, "h": 0.1}, "text": "First light. First sip.", "sizeFrac": 0.03, "colour": "#FFFFFF", "weight": "bold"},
              {"kind": "logo", "box": {"x": 0.35, "y": 0.5, "w": 0.3, "h": 0.06}, "image": logo},
              {"kind": "legal", "box": {"x": 0.1, "y": 0.6, "w": 0.8, "h": 0.03}, "text": "Enjoy responsibly.", "sizeFrac": 0.008}]
    _, plain = h.post_job(token, op="resize", expect=200, **size_input(h))
    _, typed = h.post_job(token, op="resize", expect=200, **size_input(h, layers=layers))
    assert typed["resize"]["layers"] == 3 and plain["outputs"][0]["sha256"] != typed["outputs"][0]["sha256"]
    for p in h.providers.values():
        assert not p.submits
        assert "First light" not in json.dumps(p.submits)


def test_long_words_shrink_to_their_box():
    img = Image.new("RGB", (300, 600), (0, 0, 0))
    layer = {"kind": "line", "box": {"x": 0.1, "y": 0.1, "w": 0.8, "h": 0.1}, "text": "A very long line that will never fit at the size it asked for", "sizeFrac": 0.2}
    d = ImageDraw.Draw(img)
    font, px, lines, _ = typeset.fit(layer["text"], (30, 60, 270, 120), round(0.2 * 600 / typeset.CAP), d, False)
    assert px < round(0.2 * 600 / typeset.CAP)
    assert max(d.textlength(ln, font=font) for ln in lines) <= 240 and len(lines) * px * typeset.LEADING <= 60 + px  # MIN_PX floor aside
    assert typeset.draw(img, [layer]) == 1
    # Nothing was drawn outside the box.
    outside = img.crop((0, 0, 300, 55)).getbbox()
    assert outside is None
