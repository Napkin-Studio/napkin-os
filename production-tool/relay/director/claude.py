"""The relay's director: the harness lane's Director (director/director.py) on
the model port (director/model.py), behind the relay's hook (director/base.py).

  direct(job_request, sheet) -> director.schema.json output, plus "_model" and
  "_promptVersion" for the agent block the relay logs.

The wire comes from the environment (NAPKIN_MODEL_API: bedrock on Lambda, with
the relay role; anthropic with ANTHROPIC_API_KEY; openai for a self-hosted
endpoint). The model ids and prompt version come from config.json's
`director` block, which the relay hands over with use_config() before every
call. With no model configured at all, make() returns the passthrough, so the
local dev server and the relay tests still run offline.
"""

from __future__ import annotations

import logging
import os
from pathlib import Path
from types import SimpleNamespace

from director.base import PassthroughDirector
from director.director import Director
from director.model import ModelPort, build_wire
from providers import load_sheets

log = logging.getLogger(__name__)

PROMPTS = Path(__file__).resolve().parent.parent / "prompts"
# config.testing.json's director block; config.json overrides it per call.
PER_CLICK = "eu.anthropic.claude-haiku-4-5-20251001-v1:0"
SHOT_LIST = "eu.anthropic.claude-sonnet-5-5"
PROMPT_VERSION = "director.v2"
# Lambda runs 60 s and the HTTP API answers within 30 s: one model call (and its
# one retry) must leave room for the provider submit.
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
    def __init__(self, director: Director):
        self.director = director
        self.model = director.per_click_model
        self.prompt_version = director.prompt_version

    def use_config(self, cfg: dict) -> None:
        d = self.director
        d.per_click_model = cfg.get("perClickModel") or d.per_click_model
        d.shot_list_model = cfg.get("shotListModel") or d.shot_list_model
        version = cfg.get("promptVersion")
        if version and version != d.prompt_version:
            path = PROMPTS / f"{version}.md"
            if path.exists():
                d.system, d.prompt_version = path.read_text(), version
            else:
                log.warning("config names prompt %s, which is not bundled; keeping %s", version, d.prompt_version)

    def direct(self, job_request: dict, sheet: dict | None) -> dict:
        op = job_request["op"]
        provider = sheet["provider"] if sheet else None
        if sheet:
            self.director.sheets[provider] = sheet  # the relay's copy is the one routing used
        result = self.director.run(op, job_request.get("input") or {}, provider_name=provider,
                                   job_id=job_request.get("jobId", ""))
        out = dict(result.output)
        out["_model"] = result.agent_block["model"]
        out["_promptVersion"] = result.agent_block["promptVersion"]
        log.info("director %s %s: %s in %s ms, %s", job_request.get("jobId"), op, out["_model"],
                 result.agent_block["latencyMs"], result.usage)
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
