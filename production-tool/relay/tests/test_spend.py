"""The relay's spend guard (director/spend.py) and the paid adapters that call it: the Runway
provider and the model wires. No network and no key; a refused call must not be sent."""

from pathlib import Path

import httpx
import pytest

from director import spend
from director.model import AnthropicWire, ModelError, OpenAIWire
from providers import AssetRef, ProviderError, ProviderJob, Ref
from providers.runway import RunwayProvider

DEPLOYED = "napkin-staging"
SHA = "sha256:" + "a" * 64
VARS = ("NAPKIN_ENV", "NAPKIN_PAID_CALLS", "NAPKIN_SPEND_CAP_EUR", "NAPKIN_SPEND_RUN_CAP_EUR")


@pytest.fixture(autouse=True)
def clean(monkeypatch):
    for v in VARS:
        monkeypatch.delenv(v, raising=False)
    spend.reset()
    spend.set_run("-")
    yield
    spend.reset()


class Reached(Exception):
    pass


def never(request):
    raise Reached("a request left the relay")


def runway():
    return RunwayProvider("key_test", lambda sha: AssetRef(sha, "https://cdn.test/a.png", "image/png"),
                          client=httpx.Client(transport=httpx.MockTransport(never)))


def job():
    return ProviderJob(op="generate", provider="runway", model="x", prompt="@hero on a beach",
                       refs=[Ref(SHA, "hero", "character")], ratio="1024:1024")


def on(monkeypatch, cap="1000"):
    """A developer's machine turning paid calls on by hand: the switch AND a named cap."""
    monkeypatch.setenv("NAPKIN_PAID_CALLS", "on")
    monkeypatch.setenv("NAPKIN_SPEND_CAP_EUR", cap)


def test_nothing_set_is_off_everywhere_and_local_is_not_looser(monkeypatch):
    # fails closed (features/production-platform-rules.clan, review A): the hackathon Lambda sets none of these
    assert spend.environment() == "local"
    assert not spend.paid_calls_on(spend.environment()) and spend.day_cap(spend.environment()) == 0
    v = spend.allow(0.01, "local", "j1")
    assert not v and v.reason == spend.PAID_OFF
    monkeypatch.setenv("NAPKIN_ENV", DEPLOYED)
    assert not spend.allow(0.01, spend.environment(), "j1")
    monkeypatch.setenv("NAPKIN_ENV", "someplace-unknown")
    assert not spend.allow(0.01, spend.environment(), "j1")


@pytest.mark.parametrize("env", ["local", DEPLOYED, "unknown"])
def test_paid_calls_need_the_switch_and_a_named_cap(monkeypatch, env):
    monkeypatch.setenv("NAPKIN_PAID_CALLS", "on")
    assert not spend.allow(0.01, env, "j1"), "on with no cap named stays off"
    monkeypatch.delenv("NAPKIN_PAID_CALLS")
    monkeypatch.setenv("NAPKIN_SPEND_CAP_EUR", "5")
    assert not spend.allow(0.01, env, "j1"), "a cap with the switch unset stays off"
    monkeypatch.setenv("NAPKIN_PAID_CALLS", "yes-please")
    assert not spend.allow(0.01, env, "j1"), "an unreadable switch is off"
    monkeypatch.setenv("NAPKIN_PAID_CALLS", "on")
    assert spend.allow(0.01, env, "j1")
    monkeypatch.setenv("NAPKIN_SPEND_CAP_EUR", "not a number")
    assert not spend.allow(0.01, env, "j2")


def test_describe_says_which_mode_in_one_line(monkeypatch):
    line = spend.describe()
    assert "OFF" in line and "NAPKIN_ENV unset" in line and "\n" not in line
    on(monkeypatch, "20")
    monkeypatch.setenv("NAPKIN_ENV", DEPLOYED)
    line = spend.describe()
    assert "ON" in line and "day cap 20 euro" in line and "per process" in line


@pytest.mark.parametrize("reason", [spend.PAID_OFF, spend.DAY_LIMIT, spend.RUN_LIMIT, spend.NO_ESTIMATE])
def test_a_refusal_holds_no_figure_and_no_money_word(reason):
    import re
    assert not re.search(r"\d|euro|\beur\b|dollar|usd|credit|price|cost|\u20ac|\$", reason, re.I), reason


def test_runway_refuses_when_paused(monkeypatch):
    monkeypatch.setenv("NAPKIN_ENV", DEPLOYED)
    with pytest.raises(ProviderError, match="Paid runs are off") as e:
        runway().submit(job())
    assert e.value.code == "spend_stop" and not e.value.accepted and e.value.message == spend.PAID_OFF


def test_runway_refuses_at_cap_zero(monkeypatch):
    monkeypatch.setenv("NAPKIN_ENV", DEPLOYED)
    on(monkeypatch, "0")
    with pytest.raises(ProviderError, match="today's limit"):
        runway().submit(job())


def test_runway_counts_the_sheets_estimate_against_the_run(monkeypatch):
    on(monkeypatch)
    monkeypatch.setenv("NAPKIN_SPEND_RUN_CAP_EUR", "0.0001")
    spend.set_run("job-1")
    with pytest.raises(ProviderError, match="This run"):
        runway().submit(job())


def test_runway_is_reached_when_the_guard_allows(monkeypatch):
    on(monkeypatch)
    with pytest.raises(Reached):        # paid calls on by hand, with a cap; the mock transport is then reached
        runway().submit(job())


SEND = dict(model="claude-opus-5", system="s", turns=[{"role": "user", "text": "hi", "images": []}], schema={},
            purpose="p", max_tokens=100, effort=None, timeout=5)


class Never:
    api = "anthropic"

    def __getattr__(self, name):
        raise AssertionError(f"the provider was reached ({name})")


def test_model_wires_refuse_when_paused(monkeypatch):
    monkeypatch.setenv("NAPKIN_ENV", DEPLOYED)
    with pytest.raises(ModelError, match="Paid runs are off"):
        AnthropicWire(Never()).send(**SEND)
    with pytest.raises(ModelError, match="Paid runs are off"):
        OpenAIWire("http://nim.test/v1", transport=httpx.MockTransport(never)).send(**SEND)


def test_model_wires_refuse_at_cap_zero(monkeypatch):
    monkeypatch.setenv("NAPKIN_ENV", DEPLOYED)
    on(monkeypatch, "0")
    with pytest.raises(ModelError, match="today's limit"):
        AnthropicWire(Never()).send(**SEND)


def test_start_up_logs_one_line_saying_which_mode_the_guard_is_in(tmp_path, monkeypatch, caplog):
    import logging

    import identity
    import local
    for v in ("TOKEN_SECRET", "NAPKIN_LOCAL_TENANTS", "LOCAL_CONFIG"):
        monkeypatch.delenv(v, raising=False)
    caplog.set_level(logging.WARNING)
    try:
        local.build(8798, tmp_path)
    finally:
        identity.use_local(None)
    lines = [r.getMessage() for r in caplog.records if r.getMessage().startswith("spend guard:")]
    assert lines == [spend.describe()] and "OFF" in lines[0]
    src = (Path(__file__).resolve().parent.parent / "handler.py").read_text()
    assert "log.warning(spend.describe())" in src, "the Lambda logs the same line at start-up"
