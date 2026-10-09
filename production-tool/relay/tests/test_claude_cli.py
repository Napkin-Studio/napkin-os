"""The claude-cli wire: the director and character cards on `claude -p` for local development
(owner, 2026-10-09). No real CLI runs here: `run` is a fake that records the command."""

import base64
import json
import subprocess

import pytest

from director.cli_wire import ClaudeCliWire
from director.model import ModelError, ModelPort, Usage
from types import SimpleNamespace

SCHEMA = {"type": "object", "properties": {"prompt": {"type": "string"}}, "required": ["prompt"], "additionalProperties": False}


class FakeRun:
    def __init__(self, out=None, raise_=None):
        self.calls = []
        self.out = out if out is not None else {"is_error": False, "result": "{}", "structured_output": {"answer": {"prompt": "a guinea pig"}},
                                                "usage": {"input_tokens": 120, "output_tokens": 30, "cache_read_input_tokens": 10}}
        self.raise_ = raise_
        self.seen_files = []

    def __call__(self, cmd, input, capture_output, text, timeout):
        self.calls.append({"cmd": cmd, "input": input, "timeout": timeout})
        if "--add-dir" in cmd:
            folder = cmd[cmd.index("--add-dir") + 1]
            import os
            self.seen_files = sorted(os.listdir(folder))
        if self.raise_:
            raise self.raise_
        return SimpleNamespace(stdout=json.dumps(self.out), stderr="", returncode=0)


def send(wire, turns, model="eu.anthropic.claude-haiku-4-5-20251001-v1:0"):
    return wire.send(model=model, system="You write prompts.", turns=turns, schema=SCHEMA, purpose="director",
                     max_tokens=500, effort=None, timeout=20)


def test_a_call_is_one_claude_p_run_with_the_schema_and_no_tools():
    run = FakeRun()
    reply = send(ClaudeCliWire(run=run), [{"role": "user", "text": "shot 1"}])
    cmd = run.calls[0]["cmd"]
    assert cmd[:2] == ["claude", "-p"] and "--no-session-persistence" in cmd
    assert cmd[cmd.index("--model") + 1] == "haiku"
    assert json.loads(cmd[cmd.index("--json-schema") + 1])["properties"]["answer"] == SCHEMA  # wrapped: no oneOf at the top
    assert cmd[cmd.index("--system-prompt") + 1] == "You write prompts."
    assert cmd[cmd.index("--tools") + 1] == "" and run.calls[0]["input"] == "shot 1"
    assert reply.stop == "ok" and json.loads(reply.text) == {"prompt": "a guinea pig"} and reply.usage == (130, 30)


def test_pictures_go_as_files_the_cli_may_read_and_nothing_else():
    run = FakeRun()
    png = base64.b64encode(b"\x89PNG fake").decode()
    send(ClaudeCliWire(run=run), [{"role": "user", "text": "what is this?", "images": [{"media_type": "image/png", "data": png}]}])
    cmd = run.calls[0]["cmd"]
    assert cmd[cmd.index("--tools") + 1] == "Read" and cmd[cmd.index("--allowedTools") + 1] == "Read"
    assert run.seen_files == ["picture-1.png"]
    assert run.calls[0]["input"].startswith("Look at these pictures with the Read tool first: ")


def test_sizes_map_to_the_cli_aliases():
    assert ClaudeCliWire.model_alias("eu.anthropic.claude-sonnet-5-5") == "sonnet"
    assert ClaudeCliWire.model_alias("claude-opus-5-5") == "opus"


@pytest.mark.parametrize("fake,kind", [
    (FakeRun(raise_=subprocess.TimeoutExpired("claude", 20)), "timeout"),
    (FakeRun(out={"is_error": True, "result": "Not logged in · Please run /login"}), "auth"),
    (FakeRun(out={"is_error": True, "result": "API Error: 529 overloaded"}), "server"),
])
def test_failures_are_model_errors_by_kind(fake, kind):
    with pytest.raises(ModelError) as e:
        send(ClaudeCliWire(run=fake), [{"role": "user", "text": "x"}])
    assert e.value.kind == kind


def test_the_port_validates_and_returns_the_answer():
    run = FakeRun()
    port = ModelPort(ClaudeCliWire(run=run), "eu.anthropic.claude-haiku-4-5-20251001-v1:0", timeout=20)
    out = port.call("director", "You write prompts.", {"shot": 1}, SCHEMA, usage=Usage(), attribution="test")
    assert out == {"prompt": "a guinea pig"}


def test_chosen_by_the_environment_and_never_on_lambda(monkeypatch):
    from director import claude
    monkeypatch.setenv("NAPKIN_MODEL_API", "claude-cli")
    monkeypatch.delenv("AWS_LAMBDA_FUNCTION_NAME", raising=False)
    assert isinstance(claude.make().director.port.wire, ClaudeCliWire)
    monkeypatch.setenv("NAPKIN_MODEL_API", "claude-cli")
    monkeypatch.setenv("AWS_LAMBDA_FUNCTION_NAME", "relay")
    with pytest.raises(RuntimeError):
        claude.make()


def test_the_schema_goes_without_its_draft_marker():
    run = FakeRun()
    wire = ClaudeCliWire(run=run)
    wire.send(model="haiku", system="s", turns=[{"role": "user", "text": "x"}], purpose="director", max_tokens=10, effort=None, timeout=5,
              schema={"$schema": "https://json-schema.org/draft/2020-12/schema", "$id": "x", **SCHEMA})
    cmd = run.calls[0]["cmd"]
    assert json.loads(cmd[cmd.index("--json-schema") + 1])["properties"]["answer"] == SCHEMA
