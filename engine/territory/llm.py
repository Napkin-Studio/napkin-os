"""Model access. The pipeline takes any ``llm(stage, system, user) -> (obj, usage)``. Tests pass ``FakeLLM``.
``LiveLLM`` wraps the engine's own call path (deck.stages._call: transport, retries, Claude-only rule, token
ledger) and refuses to run unless the caller has been shown the cost and said yes."""
from __future__ import annotations

import json
from pathlib import Path

PROMPTS = Path(__file__).parent / "prompts"
STAGE_MODEL = {"assumed_brief": "claude-sonnet-5-5", "tensions": "claude-sonnet-5-5",
               "seeds": "claude-opus-5-5", "kill": "claude-sonnet-5-5", "sort": "claude-sonnet-5-5", "score": "claude-sonnet-5-5", "propositions": "claude-opus-5-5", "baseline": "claude-opus-5-5",
               "frames_plan": "claude-sonnet-5-5"}


def prompt(name: str) -> str:
    return (PROMPTS / f"{name}.md").read_text()


class FakeLLM:
    """Replays recorded outputs by stage and counts calls. ``outputs`` maps stage -> dict or a callable(user) -> dict."""

    def __init__(self, outputs: dict):
        self.outputs, self.calls = outputs, []

    def __call__(self, stage: str, system: str, user: str):
        self.calls.append(stage)
        out = self.outputs[stage]
        obj = out(user) if callable(out) else out
        return json.loads(json.dumps(obj)), {"model": "fake", "calls": 1, "usd": 0.0}


class LiveLLM:
    """Paid. Construct only after the cost card has been shown and approved (``approved=True``)."""

    def __init__(self, approved: bool = False):
        if not approved:
            raise PermissionError("live model calls need the cost card shown and an explicit yes (approved=True)")
        self.usage = []

    def __call__(self, stage: str, system: str, user: str):
        from deck import stages
        stages.MODELS.setdefault(f"t_{stage}", STAGE_MODEL[stage])
        stages.EFFORT.setdefault(f"t_{stage}", "medium")
        obj, usage = stages._call(f"t_{stage}", user, system)
        self.usage.append(usage)
        return obj, usage
