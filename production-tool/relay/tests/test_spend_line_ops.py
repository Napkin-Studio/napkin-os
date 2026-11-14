"""The spend guard on the Production line's new paid ops (features/production-line-merge.clan, done_when 3).

After the merge two guards stand in front of a paid Runway call: the relay's ledger admission (service.py,
ledger.py, the line's) and this build's spend guard (director/spend.py), which providers/runway.py asks before
it builds a request. Each of the line's new paid ops (frame_edit, upscale, resize, cutdown) is submitted here
with NAPKIN_SPEND_CAP_EUR=0: the answer is spend_stop and the mock transport records no request. No network
and no key. test_spend.py, this build's own, is unchanged beside it.
"""

import httpx
import pytest

from director import spend
from providers import AssetRef, ProviderError, ProviderJob, Ref
from providers.runway import UNPRICED_EUR, RunwayProvider

SHA = "sha256:" + "b" * 64
VARS = ("NAPKIN_ENV", "NAPKIN_PAID_CALLS", "NAPKIN_SPEND_CAP_EUR", "NAPKIN_SPEND_RUN_CAP_EUR")
NEW_PAID_OPS = ("frame_edit", "upscale", "resize", "cutdown")


@pytest.fixture(autouse=True)
def clean(monkeypatch):
    for v in VARS:
        monkeypatch.delenv(v, raising=False)
    spend.reset()
    spend.set_run("-")
    yield
    spend.reset()


def runway(seen):
    def record(request):
        seen.append(request)
        return httpx.Response(200, json={"id": "task_1"})
    return RunwayProvider("key_test", lambda sha: AssetRef(sha, "https://cdn.test/a.png", "image/png"),
                          client=httpx.Client(transport=httpx.MockTransport(record)))


def job(op):
    return ProviderJob(op=op, provider="runway", model="x", prompt="@hero by the window, morning light",
                       refs=[Ref(SHA, "hero", "character")], ratio="1280:720", duration_s=5.0, scale=2)


@pytest.mark.parametrize("op", NEW_PAID_OPS)
def test_each_new_paid_op_is_refused_at_cap_zero_and_nothing_is_sent(monkeypatch, op):
    monkeypatch.setenv("NAPKIN_SPEND_CAP_EUR", "0")
    seen = []
    with pytest.raises(ProviderError) as e:
        runway(seen).submit(job(op))
    assert e.value.code == "spend_stop", e.value
    assert "0 euro" in e.value.message and e.value.message.startswith("Not sent")
    assert not e.value.accepted and not e.value.retryable
    assert seen == [], f"{op}: a request reached the transport"


@pytest.mark.parametrize("op", NEW_PAID_OPS)
def test_each_new_paid_op_is_refused_deployed_with_paid_calls_on_and_cap_zero(monkeypatch, op):
    monkeypatch.setenv("NAPKIN_ENV", "napkin-staging")
    monkeypatch.setenv("NAPKIN_PAID_CALLS", "on")
    monkeypatch.setenv("NAPKIN_SPEND_CAP_EUR", "0")
    seen = []
    with pytest.raises(ProviderError, match="0 euro") as e:
        runway(seen).submit(job(op))
    assert e.value.code == "spend_stop" and seen == []


@pytest.mark.parametrize("op", NEW_PAID_OPS)
def test_the_guard_asks_a_price_never_zero_for_each_new_op(op):
    price = runway([])._guard_estimate(job(op))
    assert price > 0 and (price == UNPRICED_EUR or isinstance(price, float))


def test_the_guard_counts_the_run_for_the_new_ops(monkeypatch):
    monkeypatch.setenv("NAPKIN_SPEND_RUN_CAP_EUR", "0.0001")
    spend.set_run("job-new-ops")
    for op in NEW_PAID_OPS:
        seen = []
        with pytest.raises(ProviderError, match="this run"):
            runway(seen).submit(job(op))
        assert seen == []


def test_through_the_relay_the_ledger_admits_the_guard_refuses_and_nothing_is_sent(monkeypatch):
    """Both guards in turn on a frame_edit: the line's ledger admission (service.py) lets the job in, this
    build's guard refuses it at the adapter, and Runway (a mock transport) is never posted to. The job fails
    as spend_stop and its reservation is not kept as spent."""
    from providers._seam import Adapted, Resolver
    from test_frame_edit import CAMERA, FakeRunwayHttp, dex, edit_input, harness, post, spent

    monkeypatch.setenv("NAPKIN_SPEND_CAP_EUR", "0")
    h = harness(providers=("runway",))
    http = FakeRunwayHttp()
    h.relay.registry.register(Adapted(RunwayProvider("rw-key", Resolver(), client=httpx.Client(transport=httpx.MockTransport(http)))),
                              h.providers["runway"].sheet)
    dex(h, CAMERA)
    job = post(h, h.as_person(), edit_input())
    assert job["state"] == "failed", job
    assert job["error"]["code"] == "spend_stop", job["error"]
    assert [r for r in http.requests if r.method == "POST"] == []
    assert spent(h) == 0
