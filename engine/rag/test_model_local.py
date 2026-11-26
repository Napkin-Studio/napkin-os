"""Every `anthropic:` link goes over the Messages API (_chat_anthropic): the key, or, locally, the
one local model backend that ANTHROPIC_BASE_URL points at (scripts/model-local, answered by
`claude -p` on the developer's login). The run records which. Offline.
Run: cd engine/rag && python3 -m pytest -q test_model_local.py
"""
from __future__ import annotations

import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent))
import parse_brief as pb  # noqa: E402


def test_an_anthropic_link_is_always_the_messages_api(monkeypatch):
    seen = []
    monkeypatch.setattr(pb, "_chat_anthropic", lambda user, **kw: seen.append((user, kw)) or "ok")
    assert pb._call_link("anthropic", "claude-sonnet-5", "u", system="s", max_tokens=9, json_mode=True,
                         schema={"type": "object"}) == "ok"
    assert seen == [("u", {"system": "s", "max_tokens": 9, "schema": {"type": "object"}, "model": "claude-sonnet-5"})]


def test_the_run_says_whether_it_went_to_the_local_backend(monkeypatch):
    monkeypatch.delenv("ANTHROPIC_BASE_URL", raising=False)
    assert pb.transport_used() == "api"
    for url in ("http://127.0.0.1:8797", "http://localhost:8797"):
        monkeypatch.setenv("ANTHROPIC_BASE_URL", url)
        assert pb.transport_used() == "local"
    monkeypatch.setenv("ANTHROPIC_BASE_URL", "https://api.anthropic.com")
    assert pb.transport_used() == "api"
