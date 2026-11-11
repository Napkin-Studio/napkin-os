"""The spend guard (napkin/spend.py) and every paid adapter that calls it. No network, no key:
a refused call must leave before anything is sent, so each fake here fails the test if it is reached."""

import httpx
import pytest

from napkin import spend
from napkin.jev import JevError, JevPort, noul
from napkin.model import AnthropicWire, ModelError, OpenAIWire
from napkin.research import ResearchError
from napkin.websearch import WebResearch

DEPLOYED = "napkin-staging"
VARS = ("NAPKIN_ENV", "NAPKIN_PAID_CALLS", "NAPKIN_SPEND_CAP_EUR", "NAPKIN_SPEND_RUN_CAP_EUR")


@pytest.fixture(autouse=True)
def clean(monkeypatch):
    for v in VARS:
        monkeypatch.delenv(v, raising=False)
    spend.reset()
    yield
    spend.reset()


def deployed(monkeypatch, **env):
    monkeypatch.setenv("NAPKIN_ENV", DEPLOYED)
    for k, v in env.items():
        monkeypatch.setenv(k, str(v))


# ---------------------------------------------------------------------------- the guard

def test_local_has_no_cap_and_paid_calls_on():
    assert spend.allow(1000, "local", "r1")
    assert spend.environment() == "local"


def test_deployed_defaults_to_cap_zero_with_paid_calls_off():
    v = spend.allow(0.01, DEPLOYED, "r1")
    assert not v and "switched off" in v.reason


def test_cap_zero_refuses_even_with_paid_calls_on(monkeypatch):
    monkeypatch.setenv("NAPKIN_PAID_CALLS", "on")
    v = spend.allow(0.01, DEPLOYED, "r1")
    assert not v and "0 euro" in v.reason
    assert not spend.allow(0.0, DEPLOYED, "r1")      # an estimate of zero does not slip past a zero cap


def test_the_switch_pauses_a_local_run_with_a_cap(monkeypatch):
    monkeypatch.setenv("NAPKIN_SPEND_CAP_EUR", "100")
    monkeypatch.setenv("NAPKIN_PAID_CALLS", "off")
    assert not spend.allow(0.01, "local", "r1")
    monkeypatch.setenv("NAPKIN_PAID_CALLS", "on")
    assert spend.allow(0.01, "local", "r1")


def test_the_day_cap_counts_what_was_allowed(monkeypatch):
    monkeypatch.setenv("NAPKIN_PAID_CALLS", "on")
    monkeypatch.setenv("NAPKIN_SPEND_CAP_EUR", "1.00")
    assert spend.allow(0.60, DEPLOYED, "r1")
    assert not spend.allow(0.50, DEPLOYED, "r2")      # 0.60 + 0.50 is over
    assert spend.allow(0.40, DEPLOYED, "r2")          # exactly at the cap is allowed
    assert not spend.allow(0.01, DEPLOYED, "r3")
    assert spend.allow(0.99, "napkin-uat", "r1")      # each environment keeps its own total


def test_the_run_cap_is_per_run(monkeypatch):
    monkeypatch.setenv("NAPKIN_PAID_CALLS", "on")
    monkeypatch.setenv("NAPKIN_SPEND_CAP_EUR", "10")
    monkeypatch.setenv("NAPKIN_SPEND_RUN_CAP_EUR", "0.50")
    assert spend.allow(0.40, DEPLOYED, "run-a")
    v = spend.allow(0.20, DEPLOYED, "run-a")
    assert not v and "run" in v.reason
    assert spend.allow(0.40, DEPLOYED, "run-b")


@pytest.mark.parametrize("bad", ["abc", "-1", "nan", "inf"])
def test_an_unreadable_cap_counts_as_zero(monkeypatch, bad):
    monkeypatch.setenv("NAPKIN_PAID_CALLS", "on")
    monkeypatch.setenv("NAPKIN_SPEND_CAP_EUR", bad)
    assert not spend.allow(0.01, "local", "r1")


@pytest.mark.parametrize("amount", [None, "x", -1, float("nan")])
def test_a_call_without_an_estimate_is_refused(amount):
    assert not spend.allow(amount, "local", "r1")


def test_check_raises_and_a_refusal_is_not_counted(monkeypatch):
    monkeypatch.setenv("NAPKIN_SPEND_CAP_EUR", "1")
    with pytest.raises(spend.SpendRefused):
        spend.check(2, "r1")
    spend.check(1, "r1")


# ---------------------------------------------------------------------------- every adapter, switch off

class Never:
    """A client that must not be reached."""
    api = "anthropic"

    def __getattr__(self, name):
        raise AssertionError(f"the provider was reached ({name})")


def never_transport(request):
    raise AssertionError("a request left the server")


SEND = dict(model="claude-opus-5", system="s", turns=[{"role": "user", "text": "hi", "images": []}], schema={},
            purpose="p", max_tokens=100, effort=None, timeout=5, headers={"X-Napkin-Job": "job-1"})


def test_anthropic_wire_refuses_when_paused(monkeypatch):
    deployed(monkeypatch)       # deployed: paid calls off by default
    with pytest.raises(ModelError, match="not sent: paid calls are switched off") as e:
        AnthropicWire(Never()).send(**SEND)
    assert e.value.kind == "server"


def test_anthropic_wire_refuses_at_cap_zero(monkeypatch):
    deployed(monkeypatch, NAPKIN_PAID_CALLS="on")
    with pytest.raises(ModelError, match="0 euro"):
        AnthropicWire(Never()).send(**SEND)


def test_openai_wire_refuses_when_paused(monkeypatch):
    deployed(monkeypatch)
    wire = OpenAIWire("http://nim.test/v1", transport=httpx.MockTransport(never_transport))
    with pytest.raises(ModelError, match="switched off"):
        wire.send(**SEND)


def test_tavily_and_nova_refuse_when_paused(monkeypatch):
    deployed(monkeypatch)
    r = WebResearch(None, "tvly-test", nova=True, transport=httpx.MockTransport(never_transport), nova_client=Never())
    with pytest.raises(ResearchError, match="switched off"):
        r.search("population of ireland", "facts", "IE")      # Tavily refused, then Nova refused, nothing sent


def test_jev_refuses_when_paused(monkeypatch):
    deployed(monkeypatch)
    jev = JevPort("key", client=Never())
    with pytest.raises(JevError, match="switched off"):
        jev.ask({"text": "x"}, {"q": noul("Is it?", "yes", "no")})


def test_a_model_call_is_counted_against_the_run(monkeypatch):
    # an allowed call spends from the run named in X-Napkin-Job
    monkeypatch.setenv("NAPKIN_SPEND_RUN_CAP_EUR", "0.0000001")
    with pytest.raises(ModelError, match="this run"):
        AnthropicWire(Never()).send(**SEND)
