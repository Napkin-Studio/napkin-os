"""The Image editor's ops on the relay (features/image-editor.clan, ui-behaviour 3.12): Upscale on a
provider (Magnific on Runway, the mock here), Remove background as Rhea's cut-out run inside the relay
(cutout.py) when the browser cannot, and Change whole frame as a region_edit with no region or mask.
Nothing here calls Runway."""

import io
import os
import time

import pytest
from PIL import Image, ImageDraw

import cutout
from conftest import CDN, Harness, asset, base_config
from providers import load_sheet
from providers.mock import MockProvider
from providers.types import ProviderJob, Ref, AssetRef


def png(w=60, h=40, subject=True) -> bytes:
    img = Image.new("RGB", (w, h), (236, 228, 214))
    if subject:
        ImageDraw.Draw(img).rectangle((24, 8, 36, 34), fill=(70, 140, 90))
    out = io.BytesIO()
    img.save(out, format="PNG")
    return out.getvalue()


def editor_harness(segmenter=None) -> Harness:
    cfg = base_config()
    cfg["routing"].update(upscale=["runway"], cutout=[])
    h = Harness(cfg)
    h.relay.segmenter = segmenter
    # Ideogram and Magnific are off unless the agency asks (subprocessors.json): this agency asked.
    h.limits("blue", allow={"claude": True, "makers": ["runway", "google", "ideogram", "magnific"]})
    return h


def stored(h, n=6, data=None):
    a = asset(n)
    h.blobs.put(f"in/{a['sha256']}", data or png(), "image/png")
    return a


# ── Upscale ────────────────────────────────────────────────────────────────

def test_upscale_runs_on_runway_with_the_scale_and_no_director_words():
    h = editor_harness()
    token = h.as_person()
    _, job = h.post_job(token, op="upscale", expect=200, image=stored(h), scale=4, aspect={"w": 1344, "h": 768})
    runway = h.providers["runway"]
    assert job["provider"] == "runway" and job["model"] == "magnific_precision_upscaler_v2" and job["crew"] == "rhea"
    (sent,) = runway.submits
    assert sent["scale"] == 4 and sent["refs"][0]["role"] == "current"
    # 1344 x 4 passes 4096 px: Magnific's dearer price is reserved (providers.md fact 7).
    assert job["cost"]["reserved"] == 1.5
    _, two = h.post_job(token, op="upscale", expect=200, image=stored(h, 7), scale=2, aspect={"w": 1344, "h": 768})
    assert two["cost"]["reserved"] == 0.25


def test_upscale_without_the_picture_is_refused_before_quota():
    h = editor_harness()
    token = h.as_person()
    _, out = h.post_job(token, op="upscale", expect=400, scale=2)
    assert out["error"]["code"] == "invalid_input"


def test_the_mock_provider_grows_each_side_by_the_scale():
    data = png(30, 20)
    p = MockProvider(lambda sha: AssetRef(sha, "mock://in", "image/png"), lambda url: data, delay_s=0,
                     clock=lambda: 10.0)
    rid = p.submit(ProviderJob(op="upscale", provider="mock", model="mock", prompt="upscale",
                               refs=[Ref("sha256:" + "a" * 64, "current", "current")], scale=4))
    (out,) = p.status(rid).outputs
    assert (out.w, out.h) == (120, 80)


# ── Change whole frame ─────────────────────────────────────────────────────

def test_a_region_edit_with_no_region_and_no_mask_is_a_whole_frame_edit_priced_as_precise():
    h = editor_harness()
    token = h.as_person()
    _, job = h.post_job(token, op="region_edit", expect=200, image=stored(h), text="warmer light, keep the bottle")
    (sent,) = h.providers["runway"].submits
    assert job["model"] == "ideogram_4_5" and "region" not in sent and "mask" not in sent and "ratio" not in sent
    assert job["cost"]["reserved"] == 0.25  # preciseEdit is high quality (25 credits)


def test_fill_area_sends_the_mask_and_is_priced_as_a_reference_edit():
    h = editor_harness()
    token = h.as_person()
    mask = stored(h, 9)
    _, job = h.post_job(token, op="region_edit", expect=200, image=stored(h), mask=mask, text="add condensation drops",
                        region={"x": 0.4, "y": 0.2, "w": 0.2, "h": 0.6})
    (sent,) = h.providers["runway"].submits
    assert sent["mask"] == mask["sha256"] and job["cost"]["reserved"] == 0.08


# ── Remove background on our server ────────────────────────────────────────

def test_cutout_runs_inside_the_relay_free_and_returns_a_transparent_png():
    h = editor_harness(cutout.MockSegmenter())
    token = h.as_person()
    _, job = h.post_job(token, op="cutout", expect=200, image=stored(h))
    assert job["state"] == "completed" and job["crew"] == "rhea" and job["kind"] == "mock"
    assert job["cost"]["reserved"] == 0 and not h.providers["runway"].submits
    (o,) = job["outputs"]
    assert o["url"].startswith(CDN) and (o["w"], o["h"]) == (60, 40)
    img = Image.open(io.BytesIO(h.blobs.fetch(o["url"])))
    assert img.mode == "RGBA"
    assert img.getpixel((2, 2))[3] == 0 and img.getpixel((30, 20))[3] == 255  # background gone, subject kept


def test_cutout_without_a_server_segmenter_says_so_and_costs_nothing():
    h = editor_harness(None)
    token = h.as_person()
    _, job = h.post_job(token, op="cutout", expect=200, image=stored(h))
    assert job["state"] == "failed" and job["error"]["code"] == "capability_missing"
    assert "WebGPU" in job["error"]["message"]
    assert h.relay.remaining(h.people[token]["pid"]) == h.cfg["quotas"]


def test_from_env_picks_the_real_segmenter_the_stand_in_or_none():
    assert isinstance(cutout.from_env({"CUTOUT_WEIGHTS": "/w/model.onnx"}), cutout.OnnxSegmenter)
    assert isinstance(cutout.from_env({"NAPKIN_CUTOUT": "mock"}), cutout.MockSegmenter)
    assert cutout.from_env({}) is None


def test_the_onnx_segmenter_refuses_weights_whose_hash_differs(tmp_path):
    bad = tmp_path / "model.onnx"
    bad.write_bytes(b"not the model")
    with pytest.raises(ValueError, match="hash differs"):
        cutout.OnnxSegmenter(bad).matte(Image.new("RGB", (8, 8)))


def test_the_server_names_the_same_weights_as_the_licence_list():
    import tomllib
    from pathlib import Path
    weights = tomllib.loads((Path(__file__).resolve().parents[3] / "licences" / "weights.toml").read_text())
    (entry,) = [m for m in weights["model"] if m["id"] == cutout.CUTOUT_MODEL_NAME]
    assert entry["revision"] == cutout.REVISION
    assert {"path": cutout.WEIGHTS_FILE, "sha256": cutout.WEIGHTS_SHA256} in entry["files"]
    assert entry["weight_licence"] == "MIT" and entry["code_licence"] == "MIT"


@pytest.mark.skipif(not os.environ.get("CUTOUT_WEIGHTS"), reason="CUTOUT_WEIGHTS names the real BiRefNet-lite weights")
def test_birefnet_lite_cuts_the_bottle_out_of_a_kitchen_frame():
    """Run by hand with the weights and onnxruntime: uv run --with onnxruntime --with numpy pytest -k birefnet."""
    from pathlib import Path
    frame = (Path(__file__).resolve().parents[1] / "eval" / "fixtures" / "frames" / "kitchen_bottle.png").read_bytes()
    t = time.monotonic()
    data, w, h = cutout.cut_out(frame, cutout.from_env())
    img = Image.open(io.BytesIO(data))
    assert (w, h) == (1344, 756) and img.getpixel((665, 340))[3] > 200 and img.getpixel((100, 100))[3] < 30
    assert time.monotonic() - t < 60
