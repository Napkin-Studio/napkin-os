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


def test_extend_and_regenerate_answer_422_until_they_are_built():
    h = Harness(base_config())
    token = h.as_person()
    for method in ("extend", "regenerate", "layout"):
        _, out = h.post_job(token, op="resize", expect=422, **size_input(h, method))
        assert out["error"]["code"] == "capability_missing" and "Crop works now" in out["error"]["message"]
    assert not h.providers["mock"].submits and not h.providers["runway"].submits


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
