"""The research web track asks for local, metric sources and a market label on any figure from elsewhere (the blind deck review of
19 Nov 2026: a regional client's case rested on another market's figures in gallons). Offline: the `claude -p` call is stubbed.
Run: cd engine/agent-server && python3 -m pytest -q test_research_sourcing.py
"""
from __future__ import annotations

import json
import sys
import types
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
sys.path.insert(0, str(HERE.parent))
import research  # noqa: E402


def test_the_web_track_asks_for_local_metric_sources_and_keeps_the_market(monkeypatch):
    seen = {}

    def fake_run(cmd, **kw):
        """Stands in for the headless claude call: records the prompt, returns one finding from another market."""
        seen["prompt"] = cmd[2]
        return types.SimpleNamespace(returncode=0, stdout=json.dumps({"result": '[{"claim": "Leaks waste water", "url": "https://example.org", "market": "US"}]'}))

    monkeypatch.setenv("RESEARCH_WEB", "claude")
    monkeypatch.setattr(research.subprocess, "run", fake_run)
    got = research._web_track({"client": "Brightwell", "market": "a coastal county"})
    assert got == [{"claim": "Leaks waste water", "url": "https://example.org", "market": "US"}]
    assert research.SOURCING_RULES in seen["prompt"]
    for word in ("brief's own market", "metric", "which market it is", "litres"):
        assert word in seen["prompt"]
