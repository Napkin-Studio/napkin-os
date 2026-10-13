"""The spend ledger (features/tenant-limits.clan): one module owns every read and write of spend; the
agency's month moves exactly with the global total; admission under the agency's cap (when it has one)
and the global stop is atomic; caps are off by default and no line names an amount (owner, 2026-10-13)."""

import random
import re
import threading
from datetime import datetime, timezone
from pathlib import Path

import pytest

from conftest import Harness, base_config, job_request, ref
from director import new_id
from identity import tenant_id
from ledger import Ledger, LimitReached, SpendStop, month_key, month_of
from providers.base import ProviderError, Status
from service import LIMIT_REACHED
from store import MemoryStore

HERE = Path(__file__).resolve().parent.parent
OCT31_2359 = datetime(2026, 10, 31, 23, 59, tzinfo=timezone.utc).timestamp()


def runway_only(**cfg_over) -> Harness:
    cfg = base_config(**cfg_over)
    cfg["routing"]["generate"] = ["runway"]
    return Harness(cfg)


def month_used(h: Harness, agency: str, month: str | None = None) -> float:
    return h.relay.ledger.month_used(tenant_id(agency), month)


def total(h: Harness) -> float:
    return h.relay.ledger.total()


# ── the module itself ───────────────────────────────────────────────────────
def test_reserve_admits_up_to_the_cap_and_refuses_past_it_leaving_nothing():
    store, t = MemoryStore(), [OCT31_2359]
    led = Ledger(store, lambda: t[0])
    assert led.reserve("t1", 0.6, cap_month=1.0, cap_global=100) == "2026-10"
    assert led.reserve("t1", 0.4, cap_month=1.0, cap_global=100) == "2026-10"  # exactly at the cap fits
    with pytest.raises(LimitReached):
        led.reserve("t1", 0.01, cap_month=1.0, cap_global=100)
    assert led.month_used("t1") == pytest.approx(1.0) and led.total() == pytest.approx(1.0)


def test_the_global_stop_refuses_when_the_agency_has_headroom_and_undoes_the_month():
    store = MemoryStore()
    led = Ledger(store, lambda: OCT31_2359)
    led.reserve("t1", 0.9, cap_month=None, cap_global=1.0)
    with pytest.raises(SpendStop):
        led.reserve("t2", 0.2, cap_month=50, cap_global=1.0)
    assert led.month_used("t2") == 0 and led.total() == pytest.approx(0.9)


def test_no_cap_is_no_limit_but_the_month_still_counts():
    led = Ledger(MemoryStore(), lambda: OCT31_2359)
    for _ in range(50):
        led.reserve("t1", 10, cap_month=None, cap_global=10_000)
    assert led.month_used("t1") == pytest.approx(500)


def test_adjust_moves_a_held_reservation_in_its_own_month():
    t = [OCT31_2359]
    led = Ledger(MemoryStore(), lambda: t[0])
    month = led.reserve("t1", 1.2, cap_month=None, cap_global=100)
    t[0] += 3600  # November now
    led.adjust("t1", month, 0.8)  # settled above its reservation, in October
    assert led.month_used("t1", "2026-10") == pytest.approx(2.0) and led.month_used("t1", "2026-11") == 0
    led.adjust(None, None, -0.5)  # a job from before the ledger moves the global total only
    assert led.total() == pytest.approx(1.5)


def test_month_keys_are_the_utc_calendar():
    assert month_of(OCT31_2359) == "2026-10" and month_of(OCT31_2359 + 61) == "2026-11"
    assert month_key("t", "2026-10") == "spend#t#2026-10"


def test_concurrent_reservations_never_pass_the_cap():
    store = MemoryStore()
    led = Ledger(store, lambda: OCT31_2359)
    admitted = []

    def go():
        try:
            led.reserve("t1", 0.2, cap_month=1.0, cap_global=100)
            admitted.append(1)
        except LimitReached:
            pass
    threads = [threading.Thread(target=go) for _ in range(40)]
    for th in threads:
        th.start()
    for th in threads:
        th.join()
    assert len(admitted) == 5 and led.month_used("t1") == pytest.approx(1.0)


# ── only ledger.py touches spend ────────────────────────────────────────────
def test_only_the_ledger_names_the_spend_counters():
    """A new spend site that forgot the agency's month would fail here (the design's grep test)."""
    for path in HERE.glob("*.py"):
        if path.name == "ledger.py":
            continue
        text = path.read_text()
        assert not re.search(r"""(incr|counters)\(\s*f?["']spend""", text), f"{path.name} writes or reads spend directly"


# ── the relay: caps off by default, chosen per agency ───────────────────────
def test_no_agency_has_a_cap_by_default():
    h = runway_only()
    token = h.as_person()
    for _ in range(6):
        h.post_job(token, expect=200)
    assert month_used(h, "blue") == pytest.approx(1.2) and total(h) == pytest.approx(1.2)


def test_an_agencys_cap_refuses_new_paid_work_in_plain_words():
    h = runway_only()
    token = h.as_person()
    h.limits("blue", capUsdMonthly=0.5)
    h.post_job(token, expect=200)
    h.post_job(token, expect=200)
    _, out = h.post_job(token, expect=429)
    assert out["error"] == {"code": "limit_reached", "message": LIMIT_REACHED, "retryable": False}
    assert "$" not in out["error"]["message"]  # no amount, ever (owner, 2026-10-13)
    assert month_used(h, "blue") == pytest.approx(0.4)
    # The refusal left nothing behind: no in-flight place and no quota.
    pid = h.people[token]["pid"]
    assert h.store.counters(f"inflight#{pid}")["n"] == 2 and h.relay.remaining(pid)["image"] == 38
    # Another agency is untouched.
    h.post_job(h.as_person("sai", team="green"), expect=200)


def test_a_settlement_past_the_cap_is_recorded_and_new_work_is_refused():
    h = runway_only()
    token = h.as_person()
    h.limits("blue", capUsdMonthly=0.3)
    _, job = h.post_job(token, expect=200)  # reserves 0.20
    h.providers["runway"].succeed(job["requestId"], cost=0.45)  # Runway charged more than the sheet said
    h.clock.tick(5)
    done = h.poll(token, job["jobId"])
    assert done["state"] == "completed" and done["cost"]["confirmed"] == 0.45
    assert month_used(h, "blue") == pytest.approx(0.45)  # past the cap: what Runway charged
    _, out = h.post_job(token, expect=429)
    assert out["error"]["code"] == "limit_reached"


def test_a_billed_failure_is_the_agencys_with_no_wording():
    """Owner, 2026-10-13: failed and refused attempts that Runway bills are charged silently."""
    h = runway_only()
    token = h.as_person()
    _, job = h.post_job(token, expect=200)
    h.providers["runway"].states[job["requestId"]] = Status(state="moderated", error_message="Runway refused this picture.")
    h.clock.tick(5)
    out = h.poll(token, job["jobId"])
    assert out["error"]["code"] == "moderated" and "charge" not in out["error"]["message"].lower()
    assert month_used(h, "blue") == pytest.approx(0.2) == total(h)


def test_a_job_that_never_reached_runway_gives_everything_back():
    h = runway_only()
    token = h.as_person()
    h.cfg["inFlightPerParticipant"] = 6
    _, job = h.post_job(token, expect=200)
    h.call("DELETE", f"/jobs/{job['jobId']}", None, token, expect=200)  # submitted: Runway may bill it
    assert month_used(h, "blue") == pytest.approx(0.2)
    # A queued job (no slot yet) that is stopped costs nothing.
    h.providers["runway"].sheet["concurrency"] = {"image": 0, "video": 0}
    _, queued = h.post_job(token, expect=200)
    assert queued["state"] == "queued"
    h.call("DELETE", f"/jobs/{queued['jobId']}", None, token, expect=200)
    assert month_used(h, "blue") == pytest.approx(0.2) == total(h)


def test_the_global_stop_still_backs_every_agency():
    h = runway_only(spend={"capUsd": 0.3, "warnUsd": 0.2})
    token = h.as_person()
    h.post_job(token, expect=200)
    _, out = h.post_job(h.as_person("sai", team="green"), expect=503)
    assert out["error"]["code"] == "spend_stop" and month_used(h, "green") == 0


# ── the month boundary (UTC) ────────────────────────────────────────────────
def test_a_reservation_settles_in_its_own_month_across_midnight():
    h = runway_only()
    h.clock.t = OCT31_2359
    token = h.as_person()
    _, job = h.post_job(token, expect=200)
    h.clock.t = OCT31_2359 + 120  # 1 Nov 00:01
    h.providers["runway"].succeed(job["requestId"], cost=0.25)
    h.poll(token, job["jobId"])
    assert month_used(h, "blue", "2026-10") == pytest.approx(0.25) and month_used(h, "blue", "2026-11") == 0
    # A refund across midnight also lands in October.
    h.clock.t = OCT31_2359
    _, other = h.post_job(token, expect=200)
    h.providers["runway"].sheet["results"]["minPollS"] = 1
    h.clock.t = OCT31_2359 + 120
    h.providers["runway"].states[other["requestId"]] = Status(state="failed", error_code="provider_failed",
                                                              error_message="Runway is busy.", source="provider")
    h.poll(token, other["jobId"])
    assert month_used(h, "blue", "2026-11") == 0


def test_an_ask_answered_in_a_new_month_is_admitted_in_that_month():
    h = runway_only()
    h.clock.t = OCT31_2359
    token = h.as_person()
    h.limits("blue", capUsdMonthly=0.2)
    _, job = h.post_job(token, expect=200, text="a hero [ask]", refs=[ref(1, kind="drawing")])
    assert job["state"] == "needs_input" and month_used(h, "blue", "2026-10") == 0  # an ask holds nothing
    h.post_job(token, expect=200)  # October's 0.20 is used by another job
    h.clock.t = OCT31_2359 + 120
    _, again = h.post_job(token, expect=200, text="a hero [ask]", refs=[ref(1, kind="drawing")])  # holds nothing
    body = {"contractVersion": "3", "questionId": job["question"]["id"], "optionId": job["question"]["options"][0]["id"]}
    _, resumed = h.call("POST", f"/jobs/{job['jobId']}/answer", body, token, expect=200)
    assert resumed["state"] == "submitted"
    assert month_used(h, "blue", "2026-11") == pytest.approx(0.2) and month_used(h, "blue", "2026-10") == pytest.approx(0.2)
    # November is now at the cap: an answer that needs new spend is refused in its own words.
    body = {"contractVersion": "3", "questionId": again["question"]["id"], "optionId": again["question"]["options"][0]["id"]}
    _, refused = h.call("POST", f"/jobs/{again['jobId']}/answer", body, token, expect=200)
    assert refused["state"] == "failed" and refused["error"]["code"] == "limit_reached"
    assert refused["error"]["message"] == LIMIT_REACHED


# ── Δglobal == Δmonth on every step ─────────────────────────────────────────
def month_sum(h: Harness) -> float:
    return sum(h.store.counters(k).get("usd", 0) for k in h.store.counter_keys() if k.startswith("spend#"))


@pytest.mark.parametrize("seed", range(12))
def test_every_ledger_move_is_the_same_on_the_global_total_and_the_months(seed):
    rnd = random.Random(seed)
    cfg = base_config()
    cfg["routing"] = {op: ([] if op in ("shot_list", "stitch") else ["mock", "runway"]) for op in cfg["routing"]}
    h = Harness(cfg)
    tokens = [h.as_person(f"p{i}", team=rnd.choice(["blue", "green"])) for i in range(3)]
    h.limits("green", capUsdMonthly=1.0)
    live: list[tuple[str, dict]] = []
    for _ in range(40):
        action = rnd.choice(["post", "post", "ask", "succeed", "fail", "moderate", "cancel", "midnight", "front_down"])
        if action in ("post", "ask"):
            token = rnd.choice(tokens)
            inp = {"text": "a hero [ask]" if action == "ask" else "a hero", "refs": [ref(1, kind="drawing")]}
            status, job = h.call("POST", "/jobs", job_request("generate", new_id("job"), **inp), token)
            if status == 200:
                live.append((token, job))
        elif action == "front_down":
            down = h.providers["mock"].submit_effect
            h.providers["mock"].submit_effect = None if down else ProviderError("provider_failed", "down")
        elif action == "midnight":
            h.clock.tick(rnd.choice([3600 * 24 * 12, 61]))
        elif live:
            token, job = live.pop(rnd.randrange(len(live)))
            job = h.poll(token, job["jobId"])
            if job["state"] == "needs_input" and rnd.random() < 0.7:
                body = {"contractVersion": "3", "questionId": job["question"]["id"],
                        "optionId": job["question"]["options"][0]["id"]}
                h.call("POST", f"/jobs/{job['jobId']}/answer", body, token)
            elif job.get("requestId") and job["state"] == "submitted":
                prov = h.providers[job["provider"]]
                if action == "succeed":
                    prov.succeed(job["requestId"], cost=rnd.choice([None, 0.05, 0.2, 0.9]))
                elif action == "fail":
                    prov.states[job["requestId"]] = Status(state="failed", error_code="provider_failed",
                                                           error_message="x", source=rnd.choice(["provider", "input"]))
                elif action == "moderate":
                    prov.states[job["requestId"]] = Status(state="moderated", error_message="refused")
                else:
                    h.call("DELETE", f"/jobs/{job['jobId']}", None, token)
                h.clock.tick(3)
                h.poll(token, job["jobId"])
        assert total(h) == pytest.approx(month_sum(h)), action
    assert total(h) >= -1e-9
