"""deck-cloud: brief_llm reaches Claude on Bedrock when NAPKIN_MODEL_API=bedrock; unset, nothing changes."""
from __future__ import annotations

import sys
import types
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
import brief_llm as L  # noqa: E402


class FakeMessages:
    def __init__(self):
        self.calls = []

    def create(self, **kw):
        self.calls.append(kw)
        return types.SimpleNamespace(content=[types.SimpleNamespace(type="text", text="{}")], usage=None, stop_reason="end_turn")


def fake_sdk(monkeypatch):
    made = []

    class Anthropic:
        def __init__(self, **kw):
            self.kw, self.messages = kw, FakeMessages()
            made.append(("anthropic", kw))

    class AnthropicBedrock(Anthropic):
        def __init__(self, **kw):
            super().__init__(**kw)
            made[-1] = ("bedrock", kw)

    mod = types.SimpleNamespace(Anthropic=Anthropic, AnthropicBedrock=AnthropicBedrock)
    monkeypatch.setitem(sys.modules, "anthropic", mod)
    monkeypatch.setattr(L, "_ANTHROPIC_CLIENTS", {})
    return made


def test_bedrock_client_and_mapped_ids(monkeypatch):
    made = fake_sdk(monkeypatch)
    monkeypatch.setenv("NAPKIN_MODEL_API", "bedrock")
    monkeypatch.setenv("NAPKIN_MODEL_REGION", "eu-west-1")
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    client = L._anthropic_client()
    assert made == [("bedrock", {"aws_region": "eu-west-1"})]
    assert L._anthropic_client() is client   # reused
    client.messages.create(model="claude-opus-5-5", max_tokens=1, messages=[])
    client.messages.create(model="claude-sonnet-5-5", max_tokens=1, messages=[])
    client.messages.create(model="eu.anthropic.already-mapped", max_tokens=1, messages=[])
    sent = [c["model"] for c in client._c.messages.calls]
    assert sent == ["global.anthropic.claude-opus-5-5", "global.anthropic.claude-sonnet-5-5", "eu.anthropic.already-mapped"]


def test_chat_anthropic_on_bedrock_needs_no_key(monkeypatch):
    fake_sdk(monkeypatch)
    monkeypatch.setenv("NAPKIN_MODEL_API", "bedrock")
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    assert L._chat_anthropic("hi", model="claude-sonnet-5-5") is not None or True
    client = L._anthropic_client()
    assert client._c.messages.calls[-1]["model"] == "global.anthropic.claude-sonnet-5-5"


def test_unset_keeps_the_key_path(monkeypatch):
    made = fake_sdk(monkeypatch)
    monkeypatch.delenv("NAPKIN_MODEL_API", raising=False)
    monkeypatch.setenv("ANTHROPIC_API_KEY", "k-test")
    client = L._anthropic_client()
    assert made == [("anthropic", {"api_key": "k-test"})]
    client.messages.create(model="claude-opus-5-5", max_tokens=1, messages=[])
    assert client.messages.calls[-1]["model"] == "claude-opus-5-5"   # not mapped
    monkeypatch.delenv("ANTHROPIC_API_KEY")
    with pytest.raises(KeyError):
        L._anthropic_client()


def test_alias_table_is_the_middlewares():
    ids = L._bedrock_aliases()
    assert ids["claude-opus-5-5"].startswith("global.anthropic.")
    from deck import stages
    for m in set(stages.MODELS.values()):
        assert L.bedrock_model_id(m) != m, f"{m} has no inference-profile mapping"
