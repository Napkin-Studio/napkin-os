"""The per-agency data allowlist (features/tenant-limits.clan): allow {claude, makers}, from the tenant
item or contracts/spend-policy.json. Keyed by the catalogue's maker; an unknown maker is off; Napkin's
own (the mock) is always on. Refused up front, before any quota or spend, with not_allowed (403)."""

import pytest

from cards import Attached
from conftest import CDN, Harness, asset, base_config, job_request, ref
from director import new_id
from service import CLAUDE_OFF_PLAN

RUNWAY_ONLY = {"claude": True, "makers": ["runway"]}
SHOT = {"id": new_id("shot", "allow"), "kind": "shot", "duration_s": 3, "camera": {"size": "wide"}, "action": "rain", "refs": []}


def runway_routed(**cfg_over) -> Harness:
    cfg = base_config(**cfg_over)
    cfg["flags"] = {**cfg["flags"], "feelEdit": True}
    cfg["routing"]["generate"] = ["runway"]
    return Harness(cfg)


INPUTS = {
    "generate": {"text": "a hero", "refs": [ref(1, kind="drawing")]},
    "view": {"view": "side", "image": asset(2)},
    "frame": {"shot": SHOT, "image": asset(3), "ratio": "16:9"},
    "region_edit": {"image": asset(3), "region": {"x": 0.1, "y": 0.1, "w": 0.2, "h": 0.2}, "text": "a hat"},
    "clip": {"image": asset(3), "refs": [ref(2, "hero_front")]},
}


def test_the_defaults_are_claude_runway_google_and_the_editors_makers():
    """Ideogram (Fill area, Change whole frame) and Magnific (Upscale) since the Image editor
    (features/image-editor.clan, ui-behaviour 3.12)."""
    h = runway_routed()
    _, me = h.call("GET", "/me", None, h.as_person(), expect=200)
    assert me["allow"] == {"claude": True, "makers": ["runway", "google", "ideogram", "magnific"]}


@pytest.mark.parametrize("op", sorted(INPUTS))
def test_google_off_refuses_every_image_and_clip_step_up_front(op):
    h = runway_routed()
    token = h.as_person()
    h.limits("blue", allow=RUNWAY_ONLY)
    _, out = h.call("POST", "/jobs", job_request(op, new_id("job"), **INPUTS[op]), token, expect=403)
    assert out["error"]["code"] == "not_allowed" and out["error"]["retryable"] is False
    # Before any quota or spend.
    pid = h.people[token]["pid"]
    assert h.relay.remaining(pid) == {"image": 40, "video": 6, "render": 3}
    assert h.relay.ledger.total() == 0 and not h.providers["runway"].submits


def test_google_off_still_runs_a_runway_made_edit():
    h = runway_routed()
    token = h.as_person()
    h.limits("blue", allow=RUNWAY_ONLY)
    video = {**asset(8, "video/mp4"), "url": f"{CDN}/in/clip.mp4"}
    _, job = h.post_job(token, "clip_edit", expect=200, video=video, feel={"strength": "flex"}, text="warmer")
    assert (job["provider"], job["model"]) == ("runway", "aleph2")


def test_a_pick_whose_maker_is_off_is_refused_by_name():
    h = runway_routed()
    token = h.as_person()
    h.limits("blue", allow=RUNWAY_ONLY)
    req = job_request("clip", new_id("job"), **INPUTS["clip"])
    req["modelChoice"] = {"provider": "runway", "model": "veo3.1_fast"}
    _, out = h.call("POST", "/jobs", req, token, expect=403)
    assert out["error"]["message"] == "Veo 3.1 Fast is made by Google, which your agency has turned off. Pick another model."


def test_an_allowed_alternate_runs_when_the_default_makers_is_off():
    h = runway_routed()
    h.providers["runway"].sheet["models"]["veo3.1_fast"]["maker"] = "runway"  # as if Runway made it
    token = h.as_person()
    h.limits("blue", allow=RUNWAY_ONLY)
    _, job = h.post_job(token, "clip", expect=200, **INPUTS["clip"])
    assert (job["provider"], job["model"]) == ("runway", "veo3.1_fast")
    assert job["cost"]["reserved"] == 0.6  # the alternate's own price, not the default's


def test_an_unknown_maker_is_off_and_an_opt_in_maker_is_on():
    h = runway_routed()
    h.providers["runway"].sheet["models"]["gemini_image3_pro"]["maker"] = "newco"
    h.providers["runway"].sheet["models"]["gemini_image3.1_flash"]["maker"] = "newco"
    token = h.as_person()
    h.call("POST", "/jobs", job_request("generate", new_id("job"), **INPUTS["generate"]), token, expect=403)
    h.limits("blue", allow={"claude": True, "makers": ["runway", "google", "newco"]})  # on the agency's request
    h.post_job(token, expect=200, **INPUTS["generate"])


def test_the_floor_leaves_the_chain_when_its_models_are_off():
    """With a provider in front that Napkin runs (the mock), Google off leaves Runway out of the chain:
    a failure in front cannot fall back to a model the agency turned off."""
    cfg = base_config()
    h = Harness(cfg)  # generate routes mock, then runway
    token = h.as_person()
    h.limits("blue", allow=RUNWAY_ONLY)
    _, job = h.post_job(token, expect=200)
    assert job["provider"] == "mock"
    assert h.relay._job_candidates(h.cfg, h.store.get_job(job["jobId"])) == ["mock"]


def test_claude_off_plans_no_shots_and_directs_without_claude_or_cards():
    h = runway_routed()
    token = h.as_person()
    h.limits("blue", allow={"claude": False, "makers": ["runway", "google"]})
    _, out = h.post_job(token, "shot_list", expect=403)
    assert out["error"] == {"code": "not_allowed", "message": CLAUDE_OFF_PLAN, "retryable": False}

    class Cards:
        calls = 0

        def attach(self, refs, job_id=""):
            Cards.calls += 1
            return Attached(refs=refs)

    class NotClaude:
        model, prompt_version = "claude-test", "director.v6"

        def direct(self, job_request, sheet):
            raise AssertionError("Claude is off for this agency")

    h.relay.cards, h.relay.director = Cards(), NotClaude()
    _, job = h.post_job(token, expect=200, **INPUTS["generate"])
    assert job["state"] == "submitted" and job["director"]["model"] == "passthrough"
    assert Cards.calls == 0
    # Another agency still gets Claude.
    _, other = h.post_job(h.as_person("sai", team="green"), expect=200, **INPUTS["generate"])
    assert other["state"] == "failed"  # the stand-in director refused: it was called


def test_a_tenant_item_without_allow_takes_the_policy():
    h = runway_routed()
    tid = h.limits("blue", capUsdMonthly=None)
    assert h.relay._policy(tid) == {"cap": None, "dailyQuotas": False,
                                   "allow": {"claude": True, "makers": ["runway", "google", "ideogram", "magnific"]}}
