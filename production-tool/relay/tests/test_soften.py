"""A clip whose words Runway's text check refused is sent once more, plainer (features/connected-video.clan,
2026-10-19: one take of a samurai ad was refused as a whole, "Text prompt did not pass moderation",
INPUT_PREPROCESSING.SAFETY.TEXT, though its shots had passed one by one)."""

from __future__ import annotations

import copy

import soften
from conftest import envelope
from director import new_id
from providers.base import Moderated, Status
from test_connected_takes import FRAME, SHOTS, harness, land, shot, stitch_result

TEXT = "INPUT_PREPROCESSING.SAFETY.TEXT"
SAMURAI = [shot(1, 3, "A samurai in a work apron stands in a messy living room.", "wide"),
           shot(2, 2.5, "His blade flashes. Vegetables dice themselves into a pot."),
           shot(3, 3, "He sweeps the floor in one clean arc.")]


def refusing(h, *codes):
    """The runway fake refuses each submit with these provider codes in turn (None: a picture refusal with no
    code), then takes the job."""
    fake = h.providers["runway"]
    queue = list(codes)
    plain = fake.submit

    def submit(job):
        if queue:
            fake.submits.append(job)
            code = queue.pop(0)
            raise Moderated("Text prompt did not pass moderation" if code and "TEXT" in code else "Image did not pass moderation",
                            provider_code=code)
        return plain(job)

    fake.submit = submit
    return fake


def post_take(h, expect=200):
    inp = {"text": "A samurai cleans his flat.", "image": FRAME, "ratio": "16:9", "mode": "take", "shots": copy.deepcopy(SAMURAI)}
    req = {**envelope("clip", new_id("job")), "input": inp, "modelChoice": {"provider": "runway", "model": "wan3"}}
    return h.call("POST", "/jobs", req, h.token, expect=expect)[1]


def test_a_text_refusal_is_sent_once_more_plainer_and_lands_softened():
    h = harness()
    fake = refusing(h, TEXT)
    job = post_take(h)
    assert job["state"] == "submitted" and job["softened"] is True
    first, second = fake.submits
    assert "blade flashes" in first["prompt"] and "blade" not in second["prompt"].lower()
    assert "kitchen knife moves quickly" in second["prompt"]
    # Every beat and the take's timing are kept; only the words changed.
    assert [ln.split("]")[0] for ln in first["prompt"].splitlines() if ln.startswith("Shot")] == \
           [ln.split("]")[0] for ln in second["prompt"].splitlines() if ln.startswith("Shot")]
    assert {k: v for k, v in first.items() if k != "prompt"} == {k: v for k, v in second.items() if k != "prompt"}
    assert job["director"]["rationale"].startswith(soften.NOTE)
    assert job["director"]["output"]["providerJob"]["prompt"] == second["prompt"]
    assert "_softenedFrom" not in job and h.store.get_job(job["jobId"])["_softenedFrom"] == first["prompt"]
    job = stitch_result(h, land(h, job), "cuts.json", {"ok": True, "takeS": 9, "fps": 24, "cuts": []})
    assert job["state"] == "completed" and len(fake.submits) == 2
    assert job["softened"] is True and job["cost"]["confirmed"] == 0.9  # one billed submit: the refused one never ran


def test_refused_twice_fails_moderated_with_both_words_refused():
    h = harness()
    fake = refusing(h, TEXT, TEXT)
    job = post_take(h)
    assert len(fake.submits) == 2 and job["state"] == "failed" and job["softened"] is True
    assert job["error"]["code"] == "moderated" and job["error"]["providerCode"] == TEXT
    assert job["error"]["message"] == f"Runway refused the words twice ({TEXT})."
    assert job["cost"]["reserved"] == 0  # nothing was made, nothing kept


def test_a_picture_refusal_is_not_retried():
    for code in ("INPUT_PREPROCESSING.SAFETY.IMAGE", None):
        h = harness()
        fake = refusing(h, code)
        job = post_take(h)
        assert len(fake.submits) == 1 and job["state"] == "failed" and "softened" not in job
        assert job["error"]["code"] == "moderated"


def test_a_frames_clip_is_softened_too():
    h = harness()
    fake = refusing(h, TEXT)
    inp = {"image": FRAME, "ratio": "16:9", "shot": {**SHOTS[1], "action": "He draws his katana and strikes."}}
    req = {**envelope("clip", new_id("job")), "input": inp}
    job = h.call("POST", "/jobs", req, h.token, expect=200)[1]
    assert job["softened"] is True and fake.submits[-1]["prompt"].startswith("He draws his kitchen knife and taps.")


def test_the_word_map_keeps_everything_but_the_weapon_and_violence_words():
    assert soften.plain_words("His blade flashes. Vegetables dice themselves.") == \
        "His kitchen knife moves quickly. Vegetables dice themselves."
    assert soften.plain_words("Shot 2 [3-5.75 s] Swords clash; he slashes, strikes and kills. Blood on the floor.") == \
        "Shot 2 [3-5.75 s] Kitchen knives clash; he chops, taps and finishes. Tomato sauce on the floor."
    assert soften.plain_words("A samurai sweeps the floor.") == "A samurai sweeps the floor."  # nothing to change
    assert soften.plain_words("the bladesmith") == "the bladesmith"  # whole words only


def test_what_counts_as_a_text_refusal():
    assert soften.text_refusal(TEXT, "x") and soften.text_refusal("SAFETY.TEXT", None)
    assert not soften.text_refusal("INPUT_PREPROCESSING.SAFETY.IMAGE", "Text and image")
    assert soften.text_refusal(None, "Text prompt did not pass moderation")
    assert not soften.text_refusal(None, "Image did not pass moderation")


def refuse_on_status(h, rid):
    """Runway took the task, then its text check refused it on the next status (2026-10-19, live)."""
    h.providers["runway"].states[rid] = Status(state="moderated", error_message="Text prompt did not pass moderation",
                                               provider_code=TEXT)
    h.clock.tick(6)


def test_a_text_refusal_on_status_is_sent_once_more_plainer():
    h = harness()
    fake = h.providers["runway"]
    job = post_take(h)
    assert job["state"] == "submitted" and not job.get("softened")
    refuse_on_status(h, "runway-1")
    job = h.poll(h.token, job["jobId"])
    assert job["state"] == "submitted" and job["softened"] is True and len(fake.submits) == 2
    first, second = fake.submits
    assert "blade flashes" in first["prompt"] and "kitchen knife moves quickly" in second["prompt"]
    assert {k: v for k, v in first.items() if k != "prompt"} == {k: v for k, v in second.items() if k != "prompt"}
    assert job["director"]["rationale"].startswith(soften.NOTE)


def test_a_second_text_refusal_on_status_fails_as_twice_refused():
    h = harness()
    job = post_take(h)
    refuse_on_status(h, "runway-1")
    job = h.poll(h.token, job["jobId"])
    refuse_on_status(h, "runway-2")
    job = h.poll(h.token, job["jobId"])
    assert job["state"] == "failed" and job["error"]["code"] == "moderated"
    assert job["error"]["message"] == f"Runway refused the words twice ({TEXT})."
    assert len(h.providers["runway"].submits) == 2
