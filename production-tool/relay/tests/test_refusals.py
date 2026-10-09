"""Refusals that say what to change (features/harness-refusals.clan): extra views left out to fit a
provider's ref limits, and a step every provider rules out on its sheet failing for good."""

import pytest

from conftest import Harness, asset, base_config, job_request, ref
from director import new_id
from names import fit_refs
from providers.base import CapabilityMissing, ProviderError
from service import sheet_refusal

SHEET = {"refs": {"max": 14, "maxCharacter": 5}}
SHOT = {"id": new_id("shot"), "order": 1, "duration_s": 3, "composition": "wide", "camera_move": "static",
        "action": "We see @uberto between the two buildings", "refs": ["uberto", "watchy"]}


def whole(key: str, start: int) -> list[dict]:
    """A whole character as refsFor sends it: the front, then up to 3 more views."""
    return [ref(start + i, f"{key}_{v}") for i, v in enumerate(("front", "side", "back", "three-quarter"))]


def names(payload: dict) -> list[str]:
    return [r["name"] for r in payload["refs"]]


# ── fit_refs ────────────────────────────────────────────────────────────────
def test_two_whole_characters_are_cut_to_the_limit_last_views_first():
    refs = whole("uberto", 1) + whole("watchy", 5)
    out, dropped = fit_refs("frame", {"shot": SHOT, "refs": refs}, SHEET)
    assert names(out) == ["uberto_front", "uberto_side", "uberto_back", "uberto_three-quarter", "watchy_front"]
    assert dropped == ["watchy_three-quarter", "watchy_back", "watchy_side"]


def test_fronts_and_named_views_stay_even_when_that_is_still_over():
    refs = whole("uberto", 1) + whole("watchy", 5) + whole("maya", 9)
    shot = {**SHOT, "refs": ["uberto", "watchy", "maya"], "action": "@watchy_back turns away"}
    out, _ = fit_refs("frame", {"shot": shot, "text": "keep @maya_side's hat", "refs": refs}, SHEET)
    assert {"uberto_front", "watchy_front", "maya_front", "watchy_back", "maya_side"} <= set(names(out))
    assert len(out["refs"]) == 5


def test_nothing_droppable_goes_as_it_is_for_the_sheet_check_to_refuse():
    refs = [ref(i, f"c{i}x_front") for i in range(1, 8)]  # seven fronts: none may go
    payload = {"shot": {**SHOT, "refs": [f"c{i}x" for i in range(1, 8)]}, "refs": refs}
    out, dropped = fit_refs("frame", payload, SHEET)
    assert out is payload and dropped == []


def test_within_the_limits_the_input_is_untouched():
    payload = {"shot": SHOT, "refs": whole("uberto", 1)}
    assert fit_refs("frame", payload, SHEET) == (payload, [])
    assert fit_refs("shot_list", {"script": "x", "refs": whole("a", 1) * 3}, SHEET)[1] == []


def test_anchor_and_previous_frames_count_against_the_total():
    refs = [ref(i, f"p{i}x_on", role="prop") for i in range(1, 6)]
    payload = {"shot": {**SHOT, "refs": []}, "refs": refs, "anchorFrame": asset(20), "previousFrame": asset(21)}
    out, dropped = fit_refs("frame", payload, {"refs": {"max": 5, "maxCharacter": 5}})
    assert len(out["refs"]) == 3 and dropped == ["p5x_on", "p4x_on"]


def test_on_a_sheet_with_elements_views_are_not_cut_for_the_character_limit():
    # 2026-10-08: fal's 4 character refs were applied to Kling clip elements, which the check does
    # not count; the cut left @watchy with only a front, and a front alone is not an element.
    refs = whole("uberto", 1) + whole("watchy", 5)
    out, dropped = fit_refs("clip", {"shot": SHOT, "refs": refs}, {"refs": {"max": 10, "maxCharacter": 4, "element": True}})
    assert dropped == [] and len(out["refs"]) == 8


def test_the_relay_sends_the_cut_refs_to_the_provider():
    h = Harness()
    token = h.sign_in()
    refs = whole("uberto", 1) + whole("watchy", 5)
    req = job_request("frame", new_id("job"), shot=SHOT, refs=refs, ratio="9:16")
    job = h.call("POST", "/jobs", req, token, expect=200)[1]
    assert job["state"] == "submitted", job
    sent = h.providers["runway"].submits[0]
    assert len(sent["refs"]) == 5 and sent["refs"][-1]["name"] == "watchy_front"  # Runway takes 5


# ── a step every provider rules out ─────────────────────────────────────────
def two_providers() -> Harness:
    cfg = base_config()
    cfg["routing"]["clip"] = ["fal", "runway"]
    return Harness(cfg)


def post_clip(h: Harness) -> dict:
    token = h.sign_in()
    return h.call("POST", "/jobs", job_request("clip", new_id("job")), token, expect=200)[1]


def test_a_sheet_refusal_everywhere_fails_for_good_and_says_what_to_change():
    h = two_providers()
    h.providers["fal"].submit_effect = CapabilityMissing("fal takes at most 4 character refs")
    h.providers["runway"].submit_effect = CapabilityMissing("runway takes at most 5 character refs")
    job = post_clip(h)
    err = job["error"]
    assert job["state"] == "failed" and err["code"] == "capability_missing" and err["retryable"] is False
    # Since 2026-10-09 (features/runway-fallback.clan) it names the first provider's reason, then Runway's.
    assert err["message"] == ("fal could not make it: fal takes at most 4 character refs. Runway cannot do this "
                              "step either: it takes at most 5 character refs. Name fewer characters in this shot, "
                              "or a single view (@maya_front) instead of a whole character (@maya).")
    assert "account" not in err["message"] and "Try again" not in err["message"]


def test_an_outage_on_any_hop_keeps_the_retryable_message():
    h = two_providers()
    h.providers["fal"].submit_effect = CapabilityMissing("fal takes at most 4 character refs")
    h.providers["runway"].submit_effect = ProviderError("provider_unavailable", "busy", retryable=True)
    job = post_clip(h)
    assert job["error"]["code"] == "provider_unavailable" and job["error"]["retryable"] is True


@pytest.mark.parametrize("op,last,want", [
    ("region_edit", "fal: region_edit needs a mask",
     "fal cannot do this region edit: it needs a mask. Paint over the area with the brush, or remove the box."),
    ("view", "runway: takes no mask", "Runway cannot do this view: takes no mask. Remove the painted area and use a box."),
    ("clip", "heygen: something new", "HeyGen cannot do this clip: something new. Change the step and send it again."),
    ("clip", "fal: clip needs a first frame", "fal cannot do this clip: it needs a first frame. Change the step and send it again."),
    ("clip", "fal: clip refs must be named", "fal cannot do this clip: clip refs must be named. Name fewer pictures in this shot."),
])
def test_the_message_names_the_limit_and_the_fix(op, last, want):
    assert sheet_refusal(op, last) == want


# ── a masked edit sends only its image (2026-10-08) ─────────────────────────
def test_a_masked_edit_carries_no_anchor_or_previous_frame():
    # Ideogram copied the reference pictures into the box: a second guinea pig from shot 1's frame,
    # then the whole frame turned into shot 2's. Only the image, the mask and the words go.
    from director.base import PassthroughDirector
    from providers import load_sheet
    image, mask, anchor, previous = asset(1), asset(2), asset(3), asset(4)
    inp = {"image": image, "mask": mask, "region": {"x": 0, "y": 0.5, "w": 1, "h": 0.4}, "text": "remove the fire",
           "anchorFrame": anchor, "previousFrame": previous}
    job = PassthroughDirector().direct({"op": "region_edit", "input": inp}, load_sheet("fal"))["providerJob"]
    assert [r["sha256"] for r in job["refs"]] == [image["sha256"]] and job["mask"] == mask["sha256"]
    # Runway has no masks: a reference-based redraw, which keeps the continuity frames.
    job = PassthroughDirector().direct({"op": "region_edit", "input": inp}, load_sheet("runway"))["providerJob"]
    assert {anchor["sha256"], previous["sha256"]} <= {r["sha256"] for r in job["refs"]} and "mask" not in job


def test_an_uncertain_job_can_be_stopped():
    # 2026-10-09: a 30 s upload timed out, the job was "uncertain" (fal may have it), and Cancel
    # did nothing. Stopping it ends it as cancelled; it is never sent again. Uncertain on fal now
    # falls back to Runway (features/runway-fallback.clan), so this is Runway, the floor, uncertain.
    h = Harness(base_config())
    h.providers["runway"].submit_effect = ProviderError("provider_unavailable", "timed out", retryable=True, accepted=True)
    token = h.sign_in()
    job = h.call("POST", "/jobs", job_request("clip", new_id("job")), token, expect=200)[1]
    assert job["state"] == "uncertain"
    out = h.call("DELETE", f"/jobs/{job['jobId']}", None, token, expect=200)[1]
    assert out["state"] == "cancelled"
    assert len(h.providers["runway"].submits) == 1 and not h.providers["fal"].submits
