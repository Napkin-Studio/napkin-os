"""Model access. The pipeline takes any ``llm(stage, system, user) -> (obj, usage)``. Tests pass ``FakeLLM``.
``LiveLLM`` wraps the engine's own call path (brief_llm: transport, retries, Claude-only rule, token
ledger; Bedrock with NAPKIN_MODEL_API=bedrock) and refuses to run unless the caller has been shown the cost and said yes."""
from __future__ import annotations

import json
from pathlib import Path

PROMPTS = Path(__file__).parent / "prompts"
STAGE_MODEL = {"assumed_brief": "claude-sonnet-5-5", "tensions": "claude-sonnet-5-5",
               "seeds": "claude-opus-5-5", "kill": "claude-sonnet-5-5", "sort": "claude-sonnet-5-5", "score": "claude-sonnet-5-5", "propositions": "claude-opus-5-5", "baseline": "claude-opus-5-5",
               "frames_plan": "claude-sonnet-5-5", "insights": "claude-sonnet-5-5",
               # the crew (territories-engine-routes): one stage per heading so each is cached, timed and re-run alone
               **{f"route_{d}": "claude-opus-5-5" for d in ("core", "feel", "opposite", "adjacent", "outside", "yours", "custom")},
               "distance": "claude-sonnet-5-5", "spread_repair": "claude-sonnet-5-5",
               # develop (territories-engine-develop): the writer and the blind judge are different models, on purpose
               "world": "claude-opus-5-5", "world_more": "claude-opus-5-5", "world_checks": "claude-sonnet-5-5", "judge": "claude-sonnet-5-5"}


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


#: A reply that is not usable JSON gets one repair call (the bad text goes back, valid JSON only is asked for).
REPAIR_SYSTEM = ("You repair a reply that was meant to be one JSON object but cannot be parsed. Return the same content as one "
                 "valid JSON object and nothing else: no prose, no code fence. Keep every field and every value as it was; "
                 "fix only the syntax (quotes, commas, brackets, truncation). Add nothing and drop nothing.")
REPAIR_CHARS = 60_000
EFFORT = "medium"
MAX_TOKENS = 16000


def _repair_user(bad: str) -> str:
    bad = bad if len(bad) <= REPAIR_CHARS else bad[:REPAIR_CHARS // 2] + "\n...\n" + bad[-REPAIR_CHARS // 2:]
    return f"<unusable_reply>\n{bad}\n</unusable_reply>\nReturn that reply as one valid JSON object only."


class LiveLLM:
    """Paid. Construct only after the cost card has been shown and approved (``approved=True``).

    It calls ``engine/brief_llm.py`` directly (the one transport module: the Anthropic API or the local model backend, and Claude in Amazon
    Bedrock with the task role when ``NAPKIN_MODEL_API=bedrock``, model ids mapped through server/napkin/model_routes.py ALIASES). It does NOT
    import the deck package: the middleware image carries this package and brief_llm.py only (a test holds that)."""

    def __init__(self, approved: bool = False, max_usd: float | None = None):
        if not approved:
            raise PermissionError("live model calls need the cost card shown and an explicit yes (approved=True)")
        self.usage, self.max_usd = [], max_usd

    def spent(self) -> float:
        return sum(u.get("usd", 0) or 0 for u in self.usage)

    def __call__(self, stage: str, system: str, user: str):
        if self.max_usd is not None and self.spent() >= self.max_usd:
            raise RuntimeError(f"model cost cap reached (${self.spent():.2f} of ${self.max_usd:.2f}): no further call made")
        import time

        import brief_llm as L
        import price_table
        model = STAGE_MODEL[stage]
        t, bad = time.time(), []

        def reader(raw):
            bad.append(raw)
            return L._loads_lenient(raw, whole=True)

        def ask(text, sysmsg, retries):
            del bad[:]
            return L._json_call(text, system=sysmsg, model=model, only_model=True, parse=reader, max_tokens=MAX_TOKENS, retries=retries)

        repaired = False
        with L.pinned_effort(EFFORT), L._stats_scope() as led:
            obj = ask(user, system, 2)
            if obj is None and bad and str(bad[-1]).strip():
                repaired = True
                obj = ask(_repair_user(str(bad[-1])), REPAIR_SYSTEM, 0)
        if obj is None:
            raise L.NoClaudeAvailable(f"territory stage {stage}: no usable reply from {model}" + (" (and the repair call failed)" if repaired else ""))
        usage = {k: int(led.get(k, 0) or 0) for k in ("prompt_tokens", "completion_tokens", "cache_read_tokens", "cache_creation_tokens")}
        usage.update(model=model, secs=round(time.time() - t, 1), calls=int(led.get("calls", 0) or 0))
        real = led.get("usd") or led.get("cost_usd")
        if real:
            usage["usd"] = round(float(real), 4)
        else:
            usage.update(usd=price_table.usd(model, usage["prompt_tokens"], usage["completion_tokens"], usage["cache_read_tokens"],
                                             usage["cache_creation_tokens"]), usd_estimated=True)
        self.usage.append(usage)
        return obj, usage
