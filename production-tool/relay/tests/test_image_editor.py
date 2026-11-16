"""The Image editor's ops on the relay (features/image-editor.clan, ui-behaviour 3.12): Upscale on a
provider (Magnific on Runway, the mock here) and Change whole frame as a region_edit with no region or mask.
Remove background is gone (owner, 2026-10-16): the cutout op is not built.
Nothing here calls Runway."""

import io

from PIL import Image, ImageDraw

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


def editor_harness() -> Harness:
    cfg = base_config()
    cfg["routing"].update(upscale=["runway"])
    h = Harness(cfg)
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


def test_the_mock_region_edit_stripes_the_masked_area_and_nothing_else():
    """A lost result is plain to see (fix/editor-apply-keeps-edits): the mask's white comes back striped."""
    data = png(400, 200, subject=False)
    m = Image.new("L", (400, 200), 0)
    ImageDraw.Draw(m).rectangle((200, 0, 399, 199), fill=255)  # ours: white = change
    buf = io.BytesIO()
    m.save(buf, format="PNG")
    blobs = {"mock://in": data, "mock://mask": buf.getvalue()}
    p = MockProvider(lambda sha: AssetRef(sha, "mock://mask" if sha.endswith("b" * 64) else "mock://in", "image/png"),
                     lambda url: blobs[url], delay_s=0, clock=lambda: 10.0)
    rid = p.submit(ProviderJob(op="region_edit", provider="mock", model="mock", prompt="drops",
                               refs=[Ref("sha256:" + "a" * 64, "current", "current")], mask="sha256:" + "b" * 64))
    (out,) = p.status(rid).outputs
    img = Image.open(io.BytesIO(out.data)).convert("RGB")
    assert img.getpixel((350, 150)) in ((230, 0, 160), (255, 230, 0))  # inside the mask: a stripe
    assert img.getpixel((100, 150)) == (236, 228, 214)  # outside: the picture as it was (the MOCK banner is top left)


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


def test_remove_sends_the_mask_with_the_relays_own_removal_words():
    """The Image editor's Remove (features/image-editor-masks-layers.clan, 2026-10-16): no words from the
    person; the relay writes the removal, and the job is a masked region edit like Fill area."""
    from service import REMOVE_WORDS
    h = editor_harness()
    token = h.as_person()
    mask = stored(h, 9)
    _, job = h.post_job(token, op="region_edit", expect=200, image=stored(h), mask=mask, remove=True,
                        region={"x": 0.4, "y": 0.2, "w": 0.2, "h": 0.6})
    (sent,) = h.providers["runway"].submits
    assert sent["mask"] == mask["sha256"] and job["model"] == "ideogram_4_5" and job["cost"]["reserved"] == 0.08
    assert REMOVE_WORDS in sent["prompt"]


def test_remove_with_words_or_without_a_mask_is_refused():
    h = editor_harness()
    token = h.as_person()
    region = {"x": 0.4, "y": 0.2, "w": 0.2, "h": 0.6}
    _, out = h.post_job(token, op="region_edit", expect=400, image=stored(h), mask=stored(h, 9), remove=True,
                        region=region, text="take the bottle out")
    assert out["error"]["code"] == "invalid_input"
    _, out = h.post_job(token, op="region_edit", expect=400, image=stored(h), remove=True, region=region)
    assert out["error"]["code"] == "invalid_input"
    assert not h.providers["runway"].submits


# ── Remove background is gone (owner, 2026-10-16) ───────────────────────────

def test_cutout_is_not_built_and_costs_nothing():
    h = editor_harness()
    token = h.as_person()
    _, out = h.post_job(token, op="cutout", expect=422, image=stored(h))
    assert out["error"]["code"] == "capability_missing"
    assert h.relay.remaining(h.people[token]["pid"]) == h.cfg["quotas"]
