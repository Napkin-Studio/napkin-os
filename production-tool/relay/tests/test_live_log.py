"""scripts/live_log.py: the hackathon deploy's lines for one person, failures marked, nothing else."""

from __future__ import annotations

import importlib.util
import json
from pathlib import Path
from types import SimpleNamespace

from service import participant_id

SPEC = importlib.util.spec_from_file_location("live_log", Path(__file__).resolve().parent.parent / "scripts" / "live_log.py")
live = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(live)

MAYA = participant_id("Blue Herons", "Maya")


class FakeLogs:
    """filter_log_events over fixed events, honouring the JSON participant filter like CloudWatch."""

    def __init__(self, events):
        self.events, self.calls = events, []

    def get_paginator(self, name):
        assert name == "filter_log_events"
        return self

    def paginate(self, **kw):
        self.calls.append(kw)
        evs = [e for e in self.events if e["group"] == kw["logGroupName"] and e["timestamp"] >= kw["startTime"]]
        if "filterPattern" in kw:
            pid = kw["filterPattern"].split('"')[1]
            evs = [e for e in evs if (live.parse(e["message"]) or {}).get("participant") == pid]
        return [{"events": evs}]


def ev(i, line, group=live.GROUPS[0], ts=1_000_000):
    return {"eventId": str(i), "group": group, "timestamp": ts + i, "message": line if isinstance(line, str) else json.dumps(line)}


def args(**kw):
    base = dict(name=None, participant=None, all=False, since="10m", errors=False, follow=False, every=0, bucket=None, no_beta=True, plain=True)
    return SimpleNamespace(**{**base, **kw})


def run(a, events):
    out = []
    live.run(a, logs=FakeLogs(events), now=lambda: 1_000.0 + 600, sleep=lambda s: None, out=out.append)
    return out[1:]  # the first line says what is followed


EVENTS = [
    ev(1, {"method": "POST", "route": "/jobs", "participant": MAYA, "op": "clip", "state": "submitted", "provider": "runway", "model": "veo3.1", "status": 200, "jobId": "job_A"}),
    ev(2, {"method": "POST", "route": "/jobs", "participant": "p_someone", "op": "frame", "status": 200}),
    ev(3, {"method": "GET", "route": "/jobs/job_A", "participant": MAYA, "state": "failed", "error": "provider_failed", "status": 200, "jobId": "job_A"}),
    ev(4, "Traceback (most recent call last):\n  File service.py ..."),
    ev(5, {"method": "POST", "route": "/jobs", "participant": MAYA, "error": "queue_full", "status": 429}),
]


def test_one_person_by_team_and_name_sees_only_their_lines():
    out = run(args(name="blue herons/MAYA"), EVENTS)
    assert len(out) == 3 and all(MAYA in o for o in out)  # theirs only, any spelling of team and name
    assert "veo3.1" in out[0] and "error provider_failed" in out[1] and "job_A" in out[1]


def test_failures_only_keeps_errors_and_tracebacks_but_not_a_queue_full_retry():
    out = run(args(all=True, errors=True), EVENTS)
    assert any("provider_failed" in o for o in out) and any("Traceback" in o for o in out)
    assert not any("queue_full" in o for o in out) and not any("p_someone" in o for o in out)


def test_failures_are_red_and_a_queue_full_retry_is_yellow():
    failed = live.parse(EVENTS[2]["message"])
    assert live.fmt(1, live.GROUPS[0], failed, "").startswith(live.RED)
    assert live.fmt(1, live.GROUPS[0], live.parse(EVENTS[4]["message"]), "").startswith(live.YELLOW)


def test_only_the_hackathon_deploys_log_groups_are_read():
    logs = FakeLogs(EVENTS)
    live.run(args(all=True), logs=logs, now=lambda: 1_600.0, sleep=lambda s: None, out=lambda s: None)
    assert {c["logGroupName"] for c in logs.calls} == {"/aws/lambda/napkin-hackathon-relay", "/aws/lambda/napkin-hackathon-stitch"}


def test_since_and_name_are_checked():
    assert live.since_ms("30m", 10_000.0) == (10_000 - 1800) * 1000
    for bad in ("30", "ten minutes"):
        try:
            live.since_ms(bad, 0)
            raise AssertionError("accepted " + bad)
        except SystemExit:
            pass
    try:
        live.who(args(name="Maya"))
        raise AssertionError("a name without a team was accepted")
    except SystemExit as e:
        assert "Team/Name" in str(e)
