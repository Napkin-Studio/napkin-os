"""mock-agent: the reply is filtered to real fields, locked fields are enforced by code, the
API key is stripped and the CLI runs with the engine's isolation flags (audit F14/G9).
Offline: subprocess.run is faked.
Run: cd mock-agent && python3 -m pytest -q test_mock_agent.py
"""
from __future__ import annotations
import importlib.util
import json
import subprocess
import sys
from pathlib import Path
import pytest

HERE = Path(__file__).resolve().parent
_spec = importlib.util.spec_from_file_location("mock_agent_server", HERE / "server.py")
mock = importlib.util.module_from_spec(_spec)
sys.modules["mock_agent_server"] = mock
_spec.loader.exec_module(mock)

CLAN = {"schema": {"properties": {"insight": {"type": "string"}, "audience": {"type": "string"},
                                  "reasons_to_believe": {"type": "array"}, "objectives": {"type": "object"}}},
        "data": {"locked_fields": ["audience"]}}


def test_mock_filters_unknown_and_locked_keys():
    """Unknown keys, wrong-typed values and locked fields never reach the app."""
    out = mock.filter_reply({"insight": "x", "error": "y", "audience": "z", "reasons_to_believe": "not a list",
                             "objectives": {"commercial": "c"}, "rationale": "r", "context": "ctx"}, CLAN)
    assert out == {"insight": "x", "objectives": {"commercial": "c"}, "rationale": "r", "context": "ctx"}


def test_mock_draft_with_no_field_is_a_bad_reply():
    """A draft reply with only meta keys (or none) is an error, not an empty patch."""
    with pytest.raises(mock.BadReply):
        mock.filter_reply({"rationale": "r"}, CLAN)
    with pytest.raises(mock.BadReply):
        mock.filter_reply(["not", "an", "object"], CLAN)


def test_mock_regeneration_requires_the_field():
    """A regeneration reply must carry the requested field; only it and rationale go back."""
    assert mock.filter_reply({"insight": "new", "rationale": "r", "audience": "sneaky"}, CLAN, field="insight") == \
        {"insight": "new", "rationale": "r"}
    with pytest.raises(mock.BadReply):
        mock.filter_reply({"rationale": "r"}, CLAN, field="insight")
    with pytest.raises(mock.BadReply):
        mock.filter_reply({"audience": "z"}, CLAN, field="audience")       # locked


def test_retrieval_cli_runs_isolated_without_the_key_or_the_local_backend(monkeypatch):
    """The retrieval run's `claude -p` gets the isolation flags and an environment without
    ANTHROPIC_API_KEY or ANTHROPIC_BASE_URL (the local model backend refuses tools)."""
    monkeypatch.setenv("ANTHROPIC_API_KEY", "sk-should-not-reach-the-cli")
    monkeypatch.setenv("ANTHROPIC_BASE_URL", "http://127.0.0.1:8797")
    seen = {}
    def fake_run(cmd, **kw):
        """Test stub: stands in for `subprocess.run`, capturing the cmd/env it was called with."""
        seen["cmd"], seen["env"] = cmd, kw.get("env")
        class P:
            """Test stub: a fake completed-process result with a canned zero-usage JSON reply."""
            returncode, stdout, stderr = 0, json.dumps({"result": "{}", "usage": {}}), ""
        return P()
    monkeypatch.setattr(subprocess, "run", fake_run)
    mock.call_claude("prompt", tools="Read,Grep,Glob", max_turns=6)
    assert "ANTHROPIC_API_KEY" not in seen["env"] and "ANTHROPIC_BASE_URL" not in seen["env"]
    for flag in ("--no-session-persistence", "--strict-mcp-config", "--setting-sources"):
        assert flag in seen["cmd"], flag
    assert seen["cmd"][seen["cmd"].index("--tools") + 1] == "Read,Grep,Glob"


def test_drafting_never_runs_the_cli(monkeypatch):
    """A draft is a Messages call; with no credentials it is a clear error, never a `claude -p` run."""
    monkeypatch.setattr(mock, "USE_API", False)
    monkeypatch.setattr(subprocess, "run", lambda *a, **k: pytest.fail("the draft ran the CLI"))
    with pytest.raises(RuntimeError, match="scripts/model-local"):
        mock.synthesize("prefix", "suffix")
    monkeypatch.setattr(mock, "USE_API", True)
    monkeypatch.setattr(mock, "call_claude_api", lambda p, s, t: {"result": "{}", "drafted": t})
    assert mock.synthesize("prefix", "suffix")["drafted"] == "draft_brief"
