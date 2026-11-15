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

from director.base import PassthroughDirector, require_prompt
from director.director import Director, load_prompt
from director.model import ModelPort, build_wire
from providers import load_sheets

log = logging.getLogger(__name__)

PROMPTS = Path(__file__).resolve().parent.parent / "prompts"
# config.testing.json's director block; config.json overrides it per call.
PER_CLICK = "eu.anthropic.claude-sonnet-5-5"  # Sonnet per click (features/director-v5.clan)
SHOT_LIST = "eu.anthropic.claude-sonnet-5-5"
PROMPT_VERSION = "director.v6"  # contract 3 (features/contract-v3.clan)
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
    # The model looks at a frame_edit's current frame (features/frame-change-edit.clan): the relay
    # fetches it only for a director that does.
    sees_images = True

    def __init__(self, director: Director):
        self.director = director
        self.model = director.per_click_model
        self.prompt_version = director.prompt_version

    def use_config(self, cfg: dict) -> None:
        d = self.director
        for field, attr in (("perClickModel", "per_click_model"), ("shotListModel", "shot_list_model")):
            want = cfg.get(field)
            refused = want and d.port.routes.vouch(want) if hasattr(d, "port") else None
            if refused:   # a config edit cannot move client text off the EU pin: the model in force stays
                log.error("config %s %s refused: %s; keeping %s", field, want, refused, getattr(d, attr))
            elif want:
                setattr(d, attr, want)
        version = cfg.get("promptVersion")
        if version:
            require_prompt(version)  # an older prompt under contract 3 is refused, loudly
        if version and version != d.prompt_version:
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
        log.info("director %s %s: %s in %s ms, %s", job_request.get("jobId"), op, out["_model"],
                 result.agent_block["latencyMs"], result.usage)
        return out


    @staticmethod
    def _fall_back(job_request: dict, sheet: dict | None, error: Exception) -> dict:
        """The director's answer failed a check, or the model did not answer: the job is made from
        the input as written (the passthrough), so a director fault never fails it. The rationale says
        so, for the History."""
        log.warning("director %s %s failed (%s: %s); the passthrough makes the job",
                    job_request.get("jobId"), job_request["op"], type(error).__name__, error)
        out = dict(PassthroughDirector().direct(job_request, sheet))
        why = str(error).splitlines()[0][:160] if str(error) else type(error).__name__
        out["rationale"] = f"The director's answer could not be used ({why}), so your words went to the model as written."
        out["_model"] = PassthroughDirector.model
        out["_promptVersion"] = PassthroughDirector.prompt_version
        return out


def pinned_routes(api: str, env=None):
    """The routes every model call of the relay resolves through (director, Skye, the cutter, cards): the routes
    file (NAPKIN_MODEL_ROUTES) under the EU pin (NAPKIN_MODEL_PIN=eu). Start-up stops (RoutesError) on a route,
    or on a model the relay names itself, that the pin cannot vouch for (features/production-platform-rules.clan,
    ADR-004). Unset is NAPKIN_MODEL_PIN=eu."""
    from writer import WRITE_MODEL

    from director.model_routes import Routes, RoutesError
    env = os.environ if env is None else env
    # Pinned unless a developer says otherwise: unset is eu (fails closed). Only an explicit `off` unpins, for a
    # developer's own model login with no client material; a deployed relay never sets it.
    pin = (env.get("NAPKIN_MODEL_PIN") or "eu").strip().lower()
    if pin == "off":
        log.error("model routes: NAPKIN_MODEL_PIN=off: the EU pin is OFF, client text may leave the EU")
    routes = Routes(api, PER_CLICK, source=env.get("NAPKIN_MODEL_ROUTES") or None, pin=None if pin == "off" else pin)
    bad = [f"{who}: {why}" for who, m in (("the director", PER_CLICK), ("the shot list", SHOT_LIST), ("Skye", WRITE_MODEL))
           if (why := routes.vouch(m))]
    if bad:
        raise RoutesError("; ".join(bad))
    log.warning("model routes: pin %s on the %s wire", routes.pin or "none", api)
    return routes


def make(wire=None):
    api = os.environ.get("NAPKIN_MODEL_API", "").strip()
    if wire is None and not api and not os.environ.get("ANTHROPIC_API_KEY"):
        log.warning("no model configured (NAPKIN_MODEL_API, ANTHROPIC_API_KEY): the passthrough director runs")
        return PassthroughDirector()
    wire = wire or build_wire(settings_from_env())
    port = ModelPort(wire, PER_CLICK, timeout=TIMEOUT_S, routes=pinned_routes(wire.api))
    return ClaudeDirector(Director(port, PROMPTS, load_sheets(), per_click_model=PER_CLICK,
                                   shot_list_model=SHOT_LIST, prompt_version=PROMPT_VERSION))
