"""The relay's director: the harness lane's Director (director/director.py) on
the model port (director/model.py), behind the relay's hook (director/base.py).

  direct(job_request, sheet) -> director.schema.json output, plus "_model" and
  "_promptVersion" for the agent block the relay logs.

The wire comes from the environment (NAPKIN_MODEL_API: bedrock on Lambda, with
the relay role; anthropic with ANTHROPIC_API_KEY; openai for a self-hosted
endpoint). Locally, the anthropic wire with NAPKIN_MODEL_BASE_URL pointed at the one
local model backend runs on the developer's own Claude Code login (scripts/model-local;
model.py refuses that loopback URL on Lambda). The model ids and prompt version come from config.json's
`director` block, which the relay hands over with use_config() before every
call. With no model configured at all, make() returns the passthrough, so the
local dev server and the relay tests still run offline.
"""

from __future__ import annotations

import logging
import os
from pathlib import Path
from types import SimpleNamespace

import jobtrace
from director import record
from director.base import PassthroughDirector, require_prompt
from director.director import Director, load_prompt
from director.model import ModelPort, build_wire
from providers import load_sheets

log = logging.getLogger(__name__)

PROMPTS = Path(__file__).resolve().parent.parent / "prompts"
# What runs when config.json's director block does not say (features/config-defaults.clan); a value
# there overrides it per job, and removing the value comes back here.
PER_CLICK = "eu.anthropic.claude-sonnet-5-5"  # Sonnet per click (features/director-v5.clan)
SHOT_LIST = "eu.anthropic.claude-sonnet-5-5"
# The newest director prompt bundled (tests/test_config_defaults.py keeps it so); older ones stay for a pin.
PROMPT_VERSION = "director.v17"
# Lambda runs 60 s: one model call (and its one retry) must leave room for the provider submit. A job with
# many pictures gets longer, in one try (director.call_timeout, Director._port_for; features/pt-canvas-r2.clan).
TIMEOUT_S = float(os.environ.get("DIRECTOR_TIMEOUT_S", "20"))


def settings_from_env() -> SimpleNamespace:
    env = os.environ.get
    return SimpleNamespace(
        model_api=env("NAPKIN_MODEL_API", "anthropic").strip(),
        model_bedrock_endpoint=env("NAPKIN_MODEL_BEDROCK_ENDPOINT", "runtime").strip(),
        model_region=env("NAPKIN_MODEL_REGION") or env("AWS_REGION") or None,
        model_base_url=env("NAPKIN_MODEL_BASE_URL") or None,
        # On Bedrock an API key here would be a bearer token; the relay signs with its role instead.
        model_api_key=(env("NAPKIN_MODEL_API_KEY") or None) if env("NAPKIN_MODEL_API") == "bedrock"
        else (env("NAPKIN_MODEL_API_KEY") or env("ANTHROPIC_API_KEY") or None),
        model_extra_body=None,
    )


class ClaudeDirector:
    # The model looks at a frame_edit's current frame (features/frame-change-edit.clan): the relay
    # fetches it only for a director that does.
    sees_images = True

    def __init__(self, director: Director):
        self.director = director
        self.model = director.per_click_model
        self.prompt_version = director.prompt_version
        # What it was built with: what runs when config.json names nothing, and again once a pin goes.
        self.defaults = (director.per_click_model, director.shot_list_model, director.prompt_version)

    def use_config(self, cfg: dict) -> None:
        d = self.director
        per_click, shot_list, default_version = self.defaults
        d.per_click_model = cfg.get("perClickModel") or per_click
        d.shot_list_model = cfg.get("shotListModel") or shot_list
        version = cfg.get("promptVersion") or default_version
        require_prompt(version)  # an older prompt under contract 3 is refused, loudly
        if version != d.prompt_version:
            path = PROMPTS / f"{version}.md"
            if path.exists():
                d.system, d.prompt_version = load_prompt(path), version
            else:
                log.warning("config names prompt %s, which is not bundled; keeping %s", version, d.prompt_version)

    def direct(self, job_request: dict, sheet: dict | None, images: list | None = None) -> dict:
        op = job_request["op"]
        provider = sheet["provider"] if sheet else None
        if sheet:
            self.director.sheets[provider] = sheet  # the relay's copy is the one routing used
        try:
            result = self.director.run(op, job_request.get("input") or {}, provider_name=provider,
                                       job_id=job_request.get("jobId", ""), images=images)
        except Exception as e:
            if op == "shot_list":  # a plan split by sentences would stand in for a real one unseen
                raise
            return self._fall_back(job_request, sheet, e)
        out = dict(result.output)
        out["_model"] = result.agent_block["model"]
        out["_promptVersion"] = result.agent_block["promptVersion"]
        out["_input"] = result.agent_block["input"]
        out["_usage"] = result.usage  # the relay prices it (agent_cost.py; UAT 2026-11-21, F21)
        jobtrace.trace("director", job_request.get("jobId"), op=op, provider=provider, model=out["_model"],
                       promptVersion=out["_promptVersion"], latencyMs=result.agent_block["latencyMs"], usage=result.usage,
                       asked=True if out.get("question") else None)
        return out


    @staticmethod
    def _fall_back(job_request: dict, sheet: dict | None, error: Exception) -> dict:
        """The director's answer failed a check, or the model did not answer: the job is made from
        the input as written (the passthrough), so a director fault never fails it. The rationale says
        so, for the History."""
        # The whole reason and Dex's whole answer (up to 8 KB each), so a rejection can be read from the log alone.
        jobtrace.trace("director_rejected", job_request.get("jobId"), op=job_request["op"],
                       provider=(sheet or {}).get("provider"), error=type(error).__name__,
                       kind=getattr(error, "kind", None), reason=jobtrace.clip(str(error)),
                       answer=jobtrace.clip(getattr(error, "answer", None)), fallback="passthrough")
        out = dict(PassthroughDirector().direct(job_request, sheet))
        why = str(error).splitlines()[0][:160] if str(error) else type(error).__name__
        out["rationale"] = f"The director's answer could not be used ({why}), so your words went to the model as written."
        out["_model"] = PassthroughDirector.model
        out["_promptVersion"] = PassthroughDirector.prompt_version
        # What Dex was given, kept though it failed (R2-3: a timeout left the job with no director.input).
        given = getattr(error, "given", None)
        out["_input"] = given if isinstance(given, dict) else record.for_record(job_request.get("input") or {})
        return out


def make(wire=None):
    api = os.environ.get("NAPKIN_MODEL_API", "").strip()
    if wire is None and not api and not os.environ.get("ANTHROPIC_API_KEY"):
        log.warning("no model configured (NAPKIN_MODEL_API, ANTHROPIC_API_KEY): the passthrough director runs")
        return PassthroughDirector()
    wire = wire or build_wire(settings_from_env())
    port = ModelPort(wire, PER_CLICK, timeout=TIMEOUT_S)
    return ClaudeDirector(Director(port, PROMPTS, load_sheets(), per_click_model=PER_CLICK,
                                   shot_list_model=SHOT_LIST, prompt_version=PROMPT_VERSION))
