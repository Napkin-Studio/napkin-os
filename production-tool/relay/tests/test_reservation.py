"""What the relay reserves for a job: the sheet's price through contracts/pricing.py at the job's
own settings (four options, the clip's length, an edit's input length), at the dearest provider
it may run on (features/runway-sheet-sync.clan). The UI shows none of it (owner, 2026-10-13):
the cost is recorded on the job, and History shows it."""

import pytest

from conftest import CDN, Harness, asset, base_config, ref
from director import new_id

SHOT = {"id": new_id("shot", "reserve"), "kind": "shot", "camera": {"size": "medium", "movement": "static"},
        "action": "she waves", "refs": []}


def runway_only(**over) -> Harness:
    cfg = base_config()
    cfg["flags"] = {**cfg["flags"], "feelEdit": True}
    cfg["routing"]["generate"] = ["runway"]
    for k, v in over.items():
        cfg["routing"][k] = v
    return Harness(cfg)


def reserved(h: Harness, op: str, **inp) -> dict:
    _, job = h.post_job(h.as_person(), op, expect=200, **inp)
    return job["cost"]


def test_a_four_up_generate_reserves_four_images():
    h = runway_only()
    one = reserved(h, "generate", text="a hero", refs=[ref(1, kind="drawing")])
    four = reserved(h, "generate", text="a hero", refs=[ref(1, kind="drawing")], chips=["more_options"])
    assert (one["reserved"], four["reserved"]) == (0.2, 0.8)
    assert not four["unknown"]


@pytest.mark.parametrize("seconds,usd", [(4, 0.8), (5, 1.2), (6, 1.2), (8, 1.6)])
def test_a_clip_reserves_its_fitted_length_with_audio_off(seconds, usd):
    h = runway_only()
    cost = reserved(h, "clip", image=asset(3), refs=[ref(2, "hero_front")], shot={**SHOT, "duration_s": seconds})
    assert cost["reserved"] == usd


def test_a_clip_with_no_shot_reserves_the_default_length():
    assert reserved(runway_only(), "clip", image=asset(3), refs=[ref(2, "hero_front")])["reserved"] == 1.2


def test_a_long_aleph2_edit_reserves_its_input_length():
    h = runway_only()
    video = {**asset(8, "video/mp4"), "url": f"{CDN}/in/clip.mp4"}
    long = reserved(h, "clip_edit", video=video, feel={"strength": "flex"}, text="warmer", shot={**SHOT, "duration_s": 30})
    short = reserved(h, "clip_edit", video=video, feel={"strength": "flex"}, text="warmer")
    assert (long["reserved"], short["reserved"]) == (8.4, 1.4)


def test_admission_still_reserves_at_the_dearest_candidate():
    # generate routes mock (the front sheet, 0.15 a job) then runway (0.20): the dearer is reserved first,
    # so the spend stop is checked against it; the job then settles at the provider that takes it.
    h = Harness(base_config(spend={"capUsd": 0.19, "warnUsd": 0.1}))
    _, out = h.post_job(h.as_person(), "generate", expect=503)
    assert out["error"]["code"] == "spend_stop"


def test_an_unpriced_model_reserves_the_unknown_price_and_says_so():
    h = runway_only()
    # Its maker stays (an unknown maker is off: features/tenant-limits.clan); only its price goes.
    h.relay.registry.sheet("runway")["models"]["veo3.1"].pop("pricing")
    cost = reserved(h, "clip", image=asset(3), refs=[ref(2, "hero_front")])
    assert cost["unknown"] is True and cost["reserved"] == 1.0
