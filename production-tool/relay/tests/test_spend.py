"""The relay's spend guard (director/spend.py) and the paid adapters that call it: the Runway
provider and the model wires. No network and no key; a refused call must not be sent."""

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


def test_local_allows_and_deployed_defaults_to_off(monkeypatch):
    assert spend.allow(5, "local", "j1")
    monkeypatch.setenv("NAPKIN_ENV", DEPLOYED)
    assert not spend.allow(0.01, spend.environment(), "j1")


def test_runway_refuses_when_paused(monkeypatch):
    monkeypatch.setenv("NAPKIN_ENV", DEPLOYED)
    with pytest.raises(ProviderError, match="switched off") as e:
        runway().submit(job())
    assert e.value.code == "spend_stop" and not e.value.accepted


def test_runway_refuses_at_cap_zero(monkeypatch):
    monkeypatch.setenv("NAPKIN_ENV", DEPLOYED)
    monkeypatch.setenv("NAPKIN_PAID_CALLS", "on")
    with pytest.raises(ProviderError, match="0 euro"):
        runway().submit(job())


def test_runway_counts_the_sheets_estimate_against_the_run(monkeypatch):
    monkeypatch.setenv("NAPKIN_SPEND_RUN_CAP_EUR", "0.0001")
    spend.set_run("job-1")
    with pytest.raises(ProviderError, match="this run"):
        runway().submit(job())


def test_runway_is_reached_when_the_guard_allows():
    with pytest.raises(Reached):        # local: no cap, paid calls on; the mock transport is then reached
        runway().submit(job())


SEND = dict(model="claude-opus-5", system="s", turns=[{"role": "user", "text": "hi", "images": []}], schema={},
            purpose="p", max_tokens=100, effort=None, timeout=5)


class Never:
    api = "anthropic"

    def __getattr__(self, name):
        raise AssertionError(f"the provider was reached ({name})")


def test_model_wires_refuse_when_paused(monkeypatch):
    monkeypatch.setenv("NAPKIN_ENV", DEPLOYED)
    with pytest.raises(ModelError, match="switched off"):
        AnthropicWire(Never()).send(**SEND)
    with pytest.raises(ModelError, match="switched off"):
        OpenAIWire("http://nim.test/v1", transport=httpx.MockTransport(never)).send(**SEND)


def test_model_wires_refuse_at_cap_zero(monkeypatch):
    monkeypatch.setenv("NAPKIN_ENV", DEPLOYED)
    monkeypatch.setenv("NAPKIN_PAID_CALLS", "on")
    with pytest.raises(ModelError, match="0 euro"):
        AnthropicWire(Never()).send(**SEND)
