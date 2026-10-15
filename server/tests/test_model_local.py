"""Contract: the real client code against the one local model backend (features/model-mock.clan).

mock-backend/server.py runs in a subprocess with its `claude` replaced by
mock-backend/tests/fake_claude.py, so nothing is spent. What is exercised is the code that
runs in production: napkin.model's AnthropicWire and Bedrock wires (runtime InvokeModel with a
bearer token and with SigV4, and mantle) built by build_wire, the anthropic SDK's streaming
client, and mock-agent's own streamed draft call. A drift between the backend's shapes and the
SDK's would fail here before it fails on a developer's machine.
"""

from __future__ import annotations

import importlib.util
import json
import os
import socket
import subprocess
import sys
import tempfile
import time
import urllib.request
from pathlib import Path

import pytest

from napkin.config import Settings
from napkin.model import ModelPort, Usage, build_wire

REPO = Path(__file__).resolve().parents[2]
MOCK = REPO / "mock-backend"


class Backend:
    """mock-backend/server.py on a free port, its claude replaced by tests/fake_claude.py."""

    def __init__(self):
        with socket.socket() as s:
            s.bind(("127.0.0.1", 0))
            self.port = s.getsockname()[1]
        self.tmp = tempfile.TemporaryDirectory(prefix="model-local-contract-")
        self.log = Path(self.tmp.name) / "log"
        self.log.mkdir()
        fake = MOCK / "tests" / "fake_claude.py"
        os.chmod(fake, 0o755)
        env = {k: v for k, v in os.environ.items() if not k.startswith(("MOCK_", "FAKE_"))}
        env.update(MOCK_FAKES="model", MOCK_BACKEND_PORT=str(self.port), MOCK_CLAUDE_BIN=str(fake),
                   MOCK_DATA=str(Path(self.tmp.name) / "data"), FAKE_CLAUDE_LOG=str(self.log))
        self.proc = subprocess.Popen([sys.executable, str(MOCK / "server.py")], env=env, cwd=self.tmp.name,
                                     stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        self.base = f"http://127.0.0.1:{self.port}"
        for _ in range(200):
            try:
                urllib.request.urlopen(self.base + "/healthz", timeout=1).read()
                return
            except OSError:
                time.sleep(0.05)
        self.close()
        raise RuntimeError("the mock backend did not start")

    def runs(self):
        return [json.loads(p.read_text()) for p in self.log.glob("*.json")]

    def close(self):
        self.proc.kill()
        self.proc.wait()
        self.tmp.cleanup()

SCHEMA = {"$schema": "https://json-schema.org/draft/2020-12/schema", "type": "object", "additionalProperties": False,
          "required": ["verdict"], "properties": {"verdict": {"type": "string"}}}
AWS = ("AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY", "AWS_SESSION_TOKEN", "AWS_PROFILE", "AWS_BEARER_TOKEN_BEDROCK",
       "AWS_LAMBDA_FUNCTION_NAME", "ECS_CONTAINER_METADATA_URI", "ECS_CONTAINER_METADATA_URI_V4",
       "ANTHROPIC_BEDROCK_BASE_URL", "ANTHROPIC_BEDROCK_MANTLE_BASE_URL")


@pytest.fixture(scope="module")
def backend():
    s = Backend()
    yield s
    s.close()


@pytest.fixture(autouse=True)
def clean_env(monkeypatch):
    for k in AWS:
        monkeypatch.delenv(k, raising=False)


def run_port(wire, model):
    usage = Usage()
    out = ModelPort(wire, model, 30).call("judge_claim", "the system prompt", {"claim": "x"}, SCHEMA, usage=usage,
                                          attribution="test")
    return out, usage


def last_model(backend):
    runs = sorted(backend.runs(), key=lambda r: r["start"])
    argv = runs[-1]["argv"]
    return argv[argv.index("--model") + 1]


def test_anthropic_wire(backend):
    wire = build_wire(Settings(model_api="anthropic", model_base_url=backend.base, model_api_key="local"))
    out, usage = run_port(wire, "claude-sonnet-5-5")
    assert out == {"verdict": "x"}
    assert usage.as_dict() == {"input_tokens": 23, "output_tokens": 3}
    assert last_model(backend) == "claude-sonnet-5-5"


def test_anthropic_wire_takes_the_relays_bedrock_ids(backend):
    wire = build_wire(Settings(model_api="anthropic", model_base_url=backend.base, model_api_key="local"))
    assert run_port(wire, "eu.anthropic.claude-sonnet-5-5")[0] == {"verdict": "x"}


def test_bedrock_runtime_with_a_bearer_token(backend):
    wire = build_wire(Settings(model_api="bedrock", model_base_url=backend.base, model_api_key="local",
                               model_region="eu-west-1"))
    out, usage = run_port(wire, "global.anthropic.claude-haiku-4-5-20251001-v1:0")
    assert out == {"verdict": "x"} and usage.as_dict()["output_tokens"] == 3
    assert last_model(backend) == "haiku"


def test_bedrock_runtime_signed_with_dummy_aws_credentials(backend, monkeypatch):
    """No bearer token: the SDK signs with SigV4, which needs credentials (any will do here)."""
    monkeypatch.setenv("AWS_ACCESS_KEY_ID", "local")
    monkeypatch.setenv("AWS_SECRET_ACCESS_KEY", "local")
    wire = build_wire(Settings(model_api="bedrock", model_base_url=backend.base, model_region="eu-west-1"))
    assert run_port(wire, "eu.anthropic.claude-sonnet-5-5")[0] == {"verdict": "x"}


def test_bedrock_mantle(backend):
    wire = build_wire(Settings(model_api="bedrock", model_bedrock_endpoint="mantle",
                               model_base_url=backend.base + "/anthropic", model_api_key="local",
                               model_region="eu-west-1"))
    assert run_port(wire, "anthropic.claude-opus-5")[0] == {"verdict": "x"}


def test_bedrock_errors_reach_the_port_as_kinds(backend):
    from napkin.model import ModelError
    wire = build_wire(Settings(model_api="bedrock", model_base_url=backend.base, model_api_key="local",
                               model_region="eu-west-1"))
    with pytest.raises(ModelError) as e:
        run_port(wire, "eu.anthropic.claude-opus-4-8")
    assert e.value.kind == "not_found"


def test_the_sdks_streaming_client(backend):
    import anthropic
    client = anthropic.Anthropic(base_url=backend.base, api_key="local")
    with client.messages.stream(model="claude-haiku-4-5", max_tokens=64, system="S",
                                messages=[{"role": "user", "content": "hi"}]) as stream:
        deltas = list(stream.text_stream)
        msg = stream.get_final_message()
    assert len(deltas) == 1 and json.loads("".join(deltas))["model"] == "haiku"
    assert msg.stop_reason == "end_turn" and msg.usage.output_tokens == 3 and msg.usage.input_tokens == 23
    assert msg.content[0].text == "".join(deltas)


def test_the_sdks_beta_stream_as_mock_agent_sends_it(backend):
    """betas (the server-side fallback beta), fallbacks, adaptive thinking, effort and a
    cache_control breakpoint on the system prompt: all tolerated, on /v1/messages?beta=true."""
    import anthropic
    client = anthropic.Anthropic(base_url=backend.base, api_key="local")
    with client.beta.messages.stream(
            betas=["server-side-fallback-2026-07-01"], fallbacks="default", model="claude-opus-5", max_tokens=16000,
            system=[{"type": "text", "text": "prefix", "cache_control": {"type": "ephemeral"}}],
            messages=[{"role": "user", "content": "suffix"}], thinking={"type": "adaptive"},
            output_config={"effort": "high"}) as stream:
        msg = stream.get_final_message()
    assert json.loads(msg.content[0].text) == {"system": "prefix", "prompt": "suffix", "model": "opus", "images": 0}


def test_mock_agents_own_draft_call(backend, monkeypatch):
    """mock-agent/server.py's call_claude_api, unchanged, drafting through the local backend."""
    monkeypatch.setenv("ANTHROPIC_BASE_URL", backend.base)
    monkeypatch.setenv("ANTHROPIC_API_KEY", "local")
    monkeypatch.setenv("NAPKIN_MOCK_MODEL", "sonnet")
    spec = importlib.util.spec_from_file_location("mock_agent_contract", REPO / "mock-agent" / "server.py")
    agent = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(agent)
    assert agent.USE_API and agent.BACKEND_LABEL == "local claude-sonnet-5"
    env = agent.call_claude_api("the prefix", "the suffix")
    assert json.loads(env["result"]) == {"system": "the prefix", "prompt": "the suffix", "model": "sonnet",
                                         "images": 0}
    assert env["usage"]["output_tokens"] == 3
