import io

import pytest
from PIL import Image

from providers import AssetRef, MockProvider, ProviderError, ProviderJob, Status, load_sheet
from providers.base import CapabilityMissing, ProviderOutput
from region import (
    draw_box, evaluate_gate, inside_box_ok, mask_png, paste_back, pixel_diff, run_region_edit, to_endpoint_mask,
)

SIZE = (200, 160)
BOX = {"x": 0.0, "y": 0.0, "w": 0.5, "h": 0.5}  # top-left, where the Mock stamps its banner
FAR_BOX = {"x": 0.5, "y": 0.5, "w": 0.4, "h": 0.4}


def _png(img: Image.Image) -> bytes:
    out = io.BytesIO()
    img.save(out, format="PNG")
    return out.getvalue()


def _gradient(size=SIZE) -> Image.Image:
    img = Image.new("RGB", size)
    img.putdata([((x * 7) % 256, (y * 5) % 256, (x + y) % 256) for y in range(size[1]) for x in range(size[0])])
    return img


def _px(png: bytes) -> Image.Image:
    return Image.open(io.BytesIO(png)).convert("RGB")


def _outside_equal(a: Image.Image, b: Image.Image, box) -> bool:
    l, t, r, btm = box
    return all(a.getpixel((x, y)) == b.getpixel((x, y))
               for y in range(a.height) for x in range(a.width) if not (l <= x < r and t <= y < btm))


# --- image ops

def test_paste_back_leaves_outside_bit_identical():
    original = _gradient()
    edited = Image.new("RGB", SIZE, (255, 255, 255))
    out = _px(paste_back(_png(original), _png(edited), FAR_BOX))
    box = (100, 80, 180, 144)
    assert _outside_equal(out, original, box)
    assert out.getpixel((120, 100)) == (255, 255, 255)


def test_paste_back_margin_widens_the_editable_area():
    original = _gradient()
    edited = Image.new("RGB", SIZE, (255, 255, 255))
    out = _px(paste_back(_png(original), _png(edited), FAR_BOX, margin_px=5))
    assert out.getpixel((96, 100)) == (255, 255, 255)
    assert _outside_equal(out, original, (95, 75, 185, 149))


def test_paste_back_resizes_and_centre_crops_a_different_ratio():
    original = _gradient()
    edited = Image.new("RGB", (400, 400), (0, 255, 0))
    out = _px(paste_back(_png(original), _png(edited), FAR_BOX))
    assert out.size == SIZE
    assert out.getpixel((120, 100)) == (0, 255, 0)
    assert out.getpixel((5, 5)) == original.getpixel((5, 5))


def test_draw_box_outlines_just_outside_the_box_and_leaves_it_clean():
    original = Image.new("RGB", SIZE, (30, 30, 30))
    out = _px(draw_box(_png(original), FAR_BOX, (255, 0, 0), 3))
    l, t, r, b = 100, 80, 180, 144
    changed = {(x, y) for y in range(SIZE[1]) for x in range(SIZE[0]) if out.getpixel((x, y)) != (30, 30, 30)}
    assert changed
    for x, y in changed:
        assert not (l <= x < r and t <= y < b)  # never inside the box
        assert l - 3 <= x < r + 3 and t - 3 <= y < b + 3
    assert out.getpixel((l - 1, 100)) == (255, 0, 0)


def test_mask_is_white_where_the_change_is():
    m = Image.open(io.BytesIO(mask_png(SIZE, FAR_BOX)))
    assert m.size == SIZE
    assert m.getpixel((140, 110)) == 255 and m.getpixel((10, 10)) == 0


def test_endpoint_mask_polarity_both_ways():
    ours = mask_png(SIZE, FAR_BOX)
    white = Image.open(io.BytesIO(to_endpoint_mask(ours, "white_edit")))
    black = Image.open(io.BytesIO(to_endpoint_mask(ours, "black_edit")))
    assert (white.getpixel((140, 110)), white.getpixel((10, 10))) == (255, 0)
    assert (black.getpixel((140, 110)), black.getpixel((10, 10))) == (0, 255)
    with pytest.raises(ValueError):
        to_endpoint_mask(ours, "grey_edit")


def test_diff_metrics_on_crafted_images():
    original = Image.new("RGB", SIZE, (50, 50, 50))
    inside_only = original.copy()
    inside_only.paste((250, 250, 250), (100, 80, 180, 144))
    m = pixel_diff(_png(original), _png(inside_only), FAR_BOX, 0)
    assert m["outside_changed_fraction"] == 0 and m["mean_abs_diff"] == 0
    assert m["inside_changed_fraction"] == 1.0
    assert inside_box_ok(m)

    leaky = inside_only.copy()
    leaky.paste((250, 250, 250), (0, 0, 100, 80))  # a quarter of the image, all outside the box
    m = pixel_diff(_png(original), _png(leaky), FAR_BOX, 0)
    assert 0.2 < m["outside_changed_fraction"] < 0.3 and m["mean_abs_diff"] > 10
    assert not inside_box_ok(m)


def test_diff_ignores_noise_below_tolerance_and_margin_counts_as_inside():
    original = Image.new("RGB", SIZE, (50, 50, 50))
    noisy = Image.new("RGB", SIZE, (53, 50, 50))
    m = pixel_diff(_png(original), _png(noisy), FAR_BOX, 0)
    assert m["outside_changed_fraction"] == 0 and m["inside_changed_fraction"] == 0
    assert not inside_box_ok(m)  # nothing changed inside: the edit did nothing

    edge = original.copy()
    edge.paste((250, 250, 250), (95, 80, 100, 144))  # 5 px left of the box
    assert pixel_diff(_png(original), _png(edge), FAR_BOX, 0)["outside_changed_fraction"] > 0
    assert pixel_diff(_png(original), _png(edge), FAR_BOX, 5)["outside_changed_fraction"] == 0


def test_inside_box_ok_takes_thresholds():
    m = {"outside_changed_fraction": 0.01, "mean_abs_diff": 0.1, "inside_changed_fraction": 0.5}
    assert not inside_box_ok(m)
    assert inside_box_ok(m, {"max_outside_changed_fraction": 0.02})


# --- gate

def test_gate_six_of_ten_fails_seven_passes():
    assert evaluate_gate([True] * 6 + [False] * 4) == {"passed": False, "count": 6, "need": 7, "of": 10}
    assert evaluate_gate([True] * 7 + [False] * 3) == {"passed": True, "count": 7, "need": 7, "of": 10}


def test_gate_takes_metrics_and_needs_all_ten_runs():
    good = {"outside_changed_fraction": 0, "mean_abs_diff": 0, "inside_changed_fraction": 0.5}
    bad = {"outside_changed_fraction": 0.3, "mean_abs_diff": 20, "inside_changed_fraction": 0.5}
    assert evaluate_gate([good] * 7 + [bad] * 3)["passed"]
    assert not evaluate_gate([good] * 7 + [bad] * 2)["passed"]  # only 9 run


# --- pipeline

class Harness:
    """Stores uploads by hash, fetches them back, and settles jobs at once."""

    def __init__(self):
        self.blobs, self.uploads, self.waits = {}, [], 0

    def upload(self, data, mime):
        sha = f"sha256:{len(self.blobs):064x}"
        self.blobs[sha] = data
        self.uploads.append((sha, mime))
        return AssetRef(sha, f"https://cdn.test/{sha[-4:]}", mime)

    def fetch(self, url):
        return next(d for s, d in self.blobs.items() if url.endswith(s[-4:]))

    def assets(self, sha):
        return AssetRef(sha, f"https://cdn.test/{sha[-4:]}", "image/png")

    def wait(self, provider, request_id):
        self.waits += 1
        provider._jobs[request_id]["at"] = -10  # the Mock's delay has long passed
        return provider.status(request_id)


def _setup(sheet=None):
    h = Harness()
    provider = MockProvider(h.assets, h.fetch, clock=lambda: 0.0, sheet=sheet)
    job = ProviderJob(op="region_edit", provider="mock", model="mock", prompt="make it red")
    return h, provider, job


def _run(h, provider, job, region, **kw):
    original = _png(_gradient((200, 200)))
    return original, run_region_edit(provider, job, original, region, h.upload, h.fetch, h.wait, **kw)


def test_pipeline_succeeds_with_the_mock_on_the_box_path():
    h, provider, job = _setup(load_sheet("runway"))  # mask: none
    original, res = _run(h, provider, job, BOX)
    assert res.ok and res.attempts == 1 and res.reason is None
    assert res.metrics["outside_changed_fraction"] == 0
    assert _outside_equal(_px(res.png), _px(original), (0, 0, 100, 100))
    assert _px(res.png).getpixel((2, 2)) == (220, 30, 30)  # the banner landed inside the box
    assert len(h.uploads) == 2 and provider.requests[0]["op"] == "region_edit"
    assert provider.requests[0]["refs"] == ["current", "marked"]
    marked = Image.open(io.BytesIO(h.blobs[h.uploads[1][0]])).convert("RGB")
    assert marked.getpixel((100, 10)) == (255, 0, 0)  # the outline hugs the box from outside
    assert marked.getpixel((10, 10)) == _px(original).getpixel((10, 10))  # the box itself is clean


def test_pipeline_retries_once_on_a_leak_then_fails_with_a_reason():
    h, provider, job = _setup(load_sheet("runway"))
    _, res = _run(h, provider, job, FAR_BOX)  # the Mock's banner is far outside this box
    assert not res.ok and res.png is None and res.attempts == 2
    assert "outside the box" in res.reason
    assert len(provider.requests) == 2 and h.waits == 2 and len(h.uploads) == 2  # same inputs, not re-uploaded


def test_pipeline_retries_zero_means_one_attempt():
    h, provider, job = _setup(load_sheet("runway"))
    _, res = _run(h, provider, job, FAR_BOX, retries=0)
    assert not res.ok and res.attempts == 1


def test_pipeline_uses_the_mask_path_when_the_sheet_has_masks():
    h, provider, job = _setup()  # the mock sheet: png_white_edit
    seen = []
    submit = provider.submit
    provider.submit = lambda j: (seen.append(j), submit(j))[1]
    _, res = _run(h, provider, job, BOX)
    assert res.ok
    assert seen[0].mask and [r.role for r in seen[0].refs] == ["current"]
    mask = Image.open(io.BytesIO(h.blobs[seen[0].mask]))
    assert mask.getpixel((10, 10)) == 255 and mask.getpixel((150, 150)) == 0  # white = change


def test_pipeline_always_uploads_white_is_change_and_leaves_conversion_to_the_adapter():
    h, provider, job = _setup({**load_sheet("mock"), "mask": "png_black_edit"})
    seen = []
    submit = provider.submit
    provider.submit = lambda j: (seen.append(j), submit(j))[1]
    _run(h, provider, job, BOX)
    mask = Image.open(io.BytesIO(h.blobs[seen[0].mask]))
    assert mask.getpixel((10, 10)) == 255 and mask.getpixel((150, 150)) == 0


def test_a_black_edit_endpoint_gets_exactly_one_flip_through_the_real_fal_adapter():
    import base64
    import httpx
    from providers.fal import FalProvider

    h, provider, job = _setup({**load_sheet("mock"), "mask": "png_black_edit"})
    seen = []
    submit = provider.submit
    provider.submit = lambda j: (seen.append(j), submit(j))[1]
    _run(h, provider, job, BOX)
    by_url = {h.assets(sha).url: data for sha, data in h.blobs.items()}
    client = httpx.Client(transport=httpx.MockTransport(lambda req: httpx.Response(200, content=by_url[str(req.url)])))
    fal = FalProvider("key", h.assets, client=client)
    uri = fal._mask(seen[0].mask, "ideogram/v4.5/edit")
    mask = Image.open(io.BytesIO(base64.b64decode(uri.split(",", 1)[1])))
    assert mask.getpixel((10, 10)) == 0 and mask.getpixel((150, 150)) == 255  # black = edit, as ideogram reads it


def test_mask_path_still_checks_for_leaks():
    h, provider, job = _setup()
    _, res = _run(h, provider, job, FAR_BOX)
    assert not res.ok and res.attempts == 2


def test_moderated_job_is_never_retried():
    h, provider, job = _setup(load_sheet("runway"))
    moderated = ProviderError("moderated", "blocked", retryable=False)
    h.wait = lambda p, rid: Status("failed", error=moderated)
    _, res = _run(h, provider, job, BOX)
    assert not res.ok and res.attempts == 1 and "moderated" in res.reason


def test_retryable_provider_failure_goes_again_once():
    h, provider, job = _setup(load_sheet("runway"))
    h.wait = lambda p, rid: Status("failed", error=ProviderError("provider_unavailable", "busy", True))
    _, res = _run(h, provider, job, BOX)
    assert not res.ok and res.attempts == 2 and "provider_unavailable" in res.reason


# --- review fixes

def _edit(original: bytes, region=BOX, colour=(250, 250, 250), size=None) -> bytes:
    """The original with the box painted over: a clean edit (resized if `size`)."""
    img = _px(original)
    w, h = img.size
    img.paste(colour, (round(region["x"] * w), round(region["y"] * h),
                       round((region["x"] + region["w"]) * w), round((region["y"] + region["h"]) * h)))
    return _png(img.resize(size) if size else img)


def _scripted(h, outputs, kind="generated"):
    """A wait that hands back each scripted result in turn: bytes become a done status."""
    queue = list(outputs)

    def wait(provider, rid):
        nxt = queue.pop(0)
        if isinstance(nxt, Status):
            return nxt
        return Status("done", outputs=[ProviderOutput("", "image/png", data=nxt)], kind=kind)
    h.wait = wait


def test_result_carries_the_kind_of_the_status():
    h, provider, job = _setup(load_sheet("runway"))
    _, res = _run(h, provider, job, BOX)
    assert res.ok and res.kind == "mock"
    h, provider, job = _setup(load_sheet("runway"))
    original = _png(_gradient((200, 200)))
    _scripted(h, [_edit(original)], kind="generated")
    res = run_region_edit(provider, job, original, BOX, h.upload, h.fetch, h.wait)
    assert res.ok and res.kind == "generated"


def test_a_kept_box_outline_is_a_leak_not_a_pass():
    h, provider, job = _setup(load_sheet("runway"))
    original = _png(_gradient((200, 200)))
    marked = {}
    upload = h.upload

    def spy(data, mime):
        ref = upload(data, mime)
        marked["png"] = data  # the last upload is the marked copy
        return ref
    # the model keeps the outline and also edits inside the box
    def wait(p, rid):
        img = _px(marked["png"])
        img.paste((250, 250, 250), (20, 20, 80, 80))
        return Status("done", outputs=[ProviderOutput("", "image/png", data=_png(img))])
    res = run_region_edit(provider, job, original, BOX, spy, h.fetch, wait)
    assert not res.ok and res.png is None and "outside the box" in res.reason


def test_a_result_of_another_shape_fails_without_retry():
    h, provider, job = _setup(load_sheet("runway"))
    original = _png(_gradient((200, 200)))
    _scripted(h, [_edit(original, size=(320, 180))])
    res = run_region_edit(provider, job, original, BOX, h.upload, h.fetch, h.wait)
    assert not res.ok and res.attempts == 1 and "320x180" in res.reason


def test_same_shape_at_another_scale_is_accepted_and_the_ratio_is_set_from_the_original():
    h, provider, job = _setup(load_sheet("runway"))
    original = _png(Image.new("RGB", (200, 200), (60, 60, 60)))
    seen = []
    submit = provider.submit
    provider.submit = lambda j: (seen.append(j), submit(j))[1]
    _scripted(h, [_edit(original, colour=(90, 90, 90), size=(400, 400))])
    res = run_region_edit(provider, job, original, BOX, h.upload, h.fetch, h.wait)
    assert res.ok and _px(res.png).size == (200, 200)
    assert seen[0].ratio == "200:200"
    seen.clear()
    h2, provider2, job2 = _setup(load_sheet("runway"))
    provider2.submit = lambda j: (seen.append(j), submit(j))[1]
    _scripted(h2, [_edit(original)])
    run_region_edit(provider2, replace_ratio(job2), original, BOX, h2.upload, h2.fetch, h2.wait)
    assert seen[0].ratio == "1344:768"  # the caller's ratio is kept


def replace_ratio(job):
    from dataclasses import replace
    return replace(job, ratio="1344:768")


def test_a_leak_then_a_clean_result_ships_the_second():
    h, provider, job = _setup(load_sheet("runway"))
    original = _png(_gradient((200, 200)))
    leaky = _px(_edit(original))
    leaky.paste((0, 0, 0), (150, 150, 200, 200))
    _scripted(h, [_png(leaky), _edit(original, colour=(10, 200, 10))])
    res = run_region_edit(provider, job, original, BOX, h.upload, h.fetch, h.wait)
    assert res.ok and res.attempts == 2
    assert res.metrics["outside_changed_fraction"] == 0
    out = _px(res.png)
    assert out.getpixel((10, 10)) == (10, 200, 10) and out.getpixel((170, 170)) == _px(original).getpixel((170, 170))


def test_a_retryable_failure_then_success_recovers():
    h, provider, job = _setup(load_sheet("runway"))
    original = _png(_gradient((200, 200)))
    _scripted(h, [Status("failed", error=ProviderError("provider_unavailable", "busy", True)), _edit(original)])
    res = run_region_edit(provider, job, original, BOX, h.upload, h.fetch, h.wait)
    assert res.ok and res.attempts == 2 and res.reason is None


def test_a_job_that_is_not_done_or_has_no_outputs_stops_at_once():
    for status in (Status("running"), Status("queued"), Status("done")):
        h, provider, job = _setup(load_sheet("runway"))
        _scripted(h, [status])
        _, res = _run(h, provider, job, BOX)
        assert not res.ok and res.attempts == 1 and "provider_failed" in res.reason


def test_capability_missing_propagates_from_submit():
    h, provider, job = _setup(load_sheet("runway"))

    def refuse(j):
        raise CapabilityMissing("no region_edit here")
    provider.submit = refuse
    with pytest.raises(CapabilityMissing):
        _run(h, provider, job, BOX)


def test_output_bytes_are_used_when_present_and_fetched_by_url_otherwise():
    h, provider, job = _setup(load_sheet("runway"))
    original = _png(_gradient((200, 200)))
    edited = _edit(original)
    stored = h.upload(edited, "image/png")
    h.wait = lambda p, rid: Status("done", outputs=[ProviderOutput(stored.url, "image/png")])
    res = run_region_edit(provider, job, original, BOX, h.upload, h.fetch, h.wait)
    assert res.ok  # no data: fetched from the url
    h.fetch = lambda url: pytest.fail("fetched although data was present")
    h.wait = lambda p, rid: Status("done", outputs=[ProviderOutput("", "image/png", data=edited)])
    res = run_region_edit(provider, job, original, BOX, h.upload, h.fetch, h.wait)
    assert res.ok


def test_an_unknown_mask_kind_is_a_clear_error():
    h, provider, job = _setup({**load_sheet("mock"), "mask": "svg_polygon"})
    with pytest.raises(ValueError, match="svg_polygon"):
        _run(h, provider, job, BOX)
