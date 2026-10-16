"""features/connected-video.clan, phase 1 (assembly): the stitch request's in and out points and
transitions reach stitch as they came, a request without them is sent exactly as before, a bad
transition is refused by the contract, and Jude's seam scores are logged, not put on the job."""

from __future__ import annotations

import json
import logging

from conftest import CDN, asset


def clip(n, **kw):
    return {"asset": {**asset(n, "video/mp4"), "url": f"{CDN}/out/{asset(n)['sha256']}"}, **kw}


def stage(h, *ns):
    for n in ns:
        h.blobs.put(f"out/{asset(n)['sha256']}", b"mp4", "video/mp4")


def test_in_out_points_and_transitions_go_to_stitch_as_they_came(h):
    token = h.as_person()
    stage(h, 4, 5, 6)
    clips = [clip(4, trimS=2.5, inS=0.5, outS=3.5),
             clip(5, trimS=3, transition={"kind": "dissolve", "s": 0.5}),
             clip(6, trimS=2, inS=1, transition={"kind": "dip"})]
    _, job = h.post_job(token, op="stitch", expect=200, clips=clips)
    assert job["state"] == "submitted", job
    (payload,) = h.stitched
    assert payload["clips"] == [
        {"key": f"out/{asset(4)['sha256']}", "trimS": 2.5, "inS": 0.5, "outS": 3.5},
        {"key": f"out/{asset(5)['sha256']}", "trimS": 3, "transition": {"kind": "dissolve", "s": 0.5}},
        {"key": f"out/{asset(6)['sha256']}", "trimS": 2, "inS": 1, "transition": {"kind": "dip"}},
    ]


def test_a_request_without_them_is_sent_as_before(h):
    token = h.as_person()
    stage(h, 4, 5)
    h.post_job(token, op="stitch", expect=200, clips=[clip(4, trimS=3), clip(5)])
    (payload,) = h.stitched
    assert payload["clips"] == [{"key": f"out/{asset(4)['sha256']}", "trimS": 3}, {"key": f"out/{asset(5)['sha256']}"}]


def test_an_unknown_transition_is_refused_by_the_contract(h):
    token = h.as_person()
    stage(h, 4, 5)
    for bad in ({"kind": "wipe"}, {"kind": "dissolve", "s": 0}, {"kind": "dip", "s": 3}, {"s": 1}):
        status, _ = h.post_job(token, op="stitch", clips=[clip(4, trimS=2), clip(5, trimS=2, transition=bad)])
        assert status == 400, bad
    status, _ = h.post_job(token, op="stitch", clips=[clip(4, trimS=2, inS=-1)])
    assert status == 400
    assert h.stitched == []


def test_seam_scores_are_logged_and_the_job_is_unchanged(h, caplog):
    token = h.as_person()
    stage(h, 4, 5)
    _, job = h.post_job(token, op="stitch", expect=200, clips=[clip(4, trimS=2), clip(5, trimS=2)])
    (payload,) = h.stitched
    seams = [{"at_s": 2.0, "kind": "cut", "score": 0.41, "colour": 0.2}]
    result = {"ok": True, "sha256": "sha256:" + "b" * 64, "bytes": 100, "w": 720, "h": 1280, "durationS": 6.5,
              "endCard": "roll-up", "seams": seams}
    h.blobs.put(payload["resultKey"], json.dumps(result).encode(), "application/json")
    h.clock.tick(3)
    with caplog.at_level(logging.INFO):
        out = h.poll(token, job["jobId"])
    assert out["state"] == "completed", out
    assert "seams" not in json.dumps(out)  # scores only, in the log, until they are tuned
    logged = [json.loads(r.getMessage()) for r in caplog.records if '"stitch_seams"' in r.getMessage()]
    assert logged == [{"kind": "stitch_seams", "jobId": job["jobId"], "seams": seams}]
