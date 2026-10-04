"""Configuration, from the environment only (peripherals.md §7). Handlers never
see any of it.

  NAPKIN_MODEL_API             anthropic (default) | bedrock | openai — the model port's wire
  NAPKIN_MODEL_BASE_URL        anthropic: the API root (unset = the SDK's own resolution,
                               ANTHROPIC_BASE_URL); bedrock: unset = the region's
                               bedrock-mantle endpoint; openai: the root /chat/completions
                               is appended to, including /v1 (required)
  NAPKIN_MODEL_API_KEY         anthropic: unset = the SDK's resolution; bedrock: a Bedrock
                               bearer token, unset = SigV4 with the AWS credential chain;
                               openai: the bearer key
  NAPKIN_MODEL_REGION          bedrock: the AWS region (unset = AWS_REGION / the profile)
  NAPKIN_MODEL_BEDROCK_ENDPOINT  bedrock: runtime (default; InvokeModel, inference-profile
                               ids such as global.anthropic.claude-opus-5-5) | mantle
                               (the native Messages endpoint; ids such as
                               anthropic.claude-opus-5-5)
  NAPKIN_MODEL                 model id, sent verbatim (claude-opus-5; on bedrock
                               global.anthropic.claude-opus-5-5)
  NAPKIN_VISION_MODEL          model id for image transcription (= NAPKIN_MODEL)
  NAPKIN_MODEL_ROUTES          a JSON file (or the JSON itself) choosing model, effort and
                               schema mode per call purpose; re-read when the file changes
                               (napkin/model_routes.py). Unset = NAPKIN_MODEL for every call
  NAPKIN_MODEL_EXTRA_BODY      openai only: a JSON object merged into every request body
  NAPKIN_MODEL_TIMEOUT         seconds per HTTP attempt (600)
  NAPKIN_MODEL_CONCURRENCY     model calls in flight at once, across jobs (8)
  NAPKIN_RESEARCH_URL          research service root; unset = research units fail as gaps
  NAPKIN_RESEARCH_TOKEN        its bearer token
  NAPKIN_RESEARCH_TIMEOUT      seconds per research call (900)
  NAPKIN_RESEARCH_CONCURRENCY  research units in flight at once (8)
  NAPKIN_RESEARCH_WEB          research in process, with no research service (napkin/websearch.py):
                               tavily (Tavily, Nova grounding when it fails) | tavily-only | nova;
                               unset = tavily when NAPKIN_TAVILY_API_KEY is set. NAPKIN_RESEARCH_URL wins
  NAPKIN_TAVILY_API_KEY        Tavily's API key
  NAPKIN_NOVA_REGION           where Nova web grounding runs (us-east-1; US regions only)
  NAPKIN_NOVA_MODEL            the grounding model (us.amazon.nova-2-lite-v1:0)
  NAPKIN_RETRIEVAL_URL         retrieval service root; unset = drafters get no passages
  NAPKIN_RETRIEVAL_TOKEN       its bearer token
  NAPKIN_RETRIEVAL_TIMEOUT     seconds per retrieval call (120)
  NAPKIN_BRIEF_ENGINE_URL      the brief engine's agent server (engine/agent-server); set, draft_brief
                               is drafted by it (middleware-api.md §10.14); unset = the middleware's drafters
  NAPKIN_LAYERS_URL            the layers service root; set, the layers are that service (HttpLayers)
  NAPKIN_LAYERS_TOKEN          its bearer token
  NAPKIN_LAYERS_TIMEOUT        seconds per layers call, or per database connect and statement (30)
  NAPKIN_LAYERS_DSN            no layers service: the layers in process on Postgres (napkin/layers/pg.py);
                               the shared category database (napkin_category) as a libpq DSN/URI, or the
                               database's Secrets Manager JSON {host, port, dbname, username, password,
                               sslmode}. One of NAPKIN_LAYERS_URL or this is required to serve; the URL wins
  NAPKIN_LAYERS_AGENCY_DSN     the agencies' own databases (napkin_agency_<slug>: the brand layer, brand names,
                               client-confidential sources), a DSN with {agency} for the scope org's slug
                               ('-' as '_'), e.g. postgresql://napkin_agency_{agency}_app@host/napkin_agency_{agency}
  NAPKIN_LAYERS_AGENCY_DSN_<SLUG>  one agency's database, DSN or secret JSON (wins over the template);
                               <SLUG> upper case, '-' as '_': NAPKIN_LAYERS_AGENCY_DSN_DEV_AGENCY for org/dev-agency
  NAPKIN_REUSE_DAYS            a layer fact younger than this is reused, not re-researched (30)
  NAPKIN_DEV_ORG / NAPKIN_DEV_BRAND  the fixed development tenant (org/dev-agency, brand/dev-brand)
  NAPKIN_TOKEN                 when set, requests must carry it (Bearer or x-api-key)
  NAPKIN_PIPELINES             ':'-separated pipeline.yaml files resolved at startup
                               (default: every app/templates/*/app/pipeline.yaml in the repo)
  NAPKIN_HOST / NAPKIN_PORT    bind address (127.0.0.1:8795)
"""

from __future__ import annotations

import glob
import json
import os
from dataclasses import dataclass, field
from pathlib import Path

SERVER_DIR = Path(__file__).resolve().parent.parent


def _default_pipelines() -> list[str]:
    return sorted(glob.glob(str(SERVER_DIR.parent / "app" / "templates" / "*" / "app" / "pipeline.yaml")))


@dataclass
class Settings:
    model_api: str = "anthropic"
    model_base_url: str | None = None
    model_api_key: str | None = None
    model_region: str | None = None
    model_bedrock_endpoint: str = "runtime"
    model: str = "claude-opus-5"
    vision_model: str | None = None
    model_routes: str | None = None
    model_extra_body: dict = field(default_factory=dict)
    model_timeout: float = 600.0
    model_concurrency: int = 8
    research_url: str | None = None
    research_token: str | None = None
    research_timeout: float = 900.0
    research_concurrency: int = 8
    research_web: str = ""
    tavily_api_key: str | None = None
    nova_region: str = "us-east-1"
    nova_model: str = "us.amazon.nova-2-lite-v1:0"
    retrieval_url: str | None = None
    retrieval_token: str | None = None
    retrieval_timeout: float = 120.0
    brief_engine_url: str | None = None
    runlog_dir: str | None = None
    jev_api_key: str | None = None
    jev_model: str = "jev-latest"
    jev_base_url: str | None = None
    brief_flow: str = "planned"
    brief_research_max: int = 3
    brief_judge: str = "review"
    runlog_bodies: bool = False
    brief_engine_loops37: bool = True
    layers_url: str | None = None
    layers_token: str | None = None
    layers_timeout: float = 30.0
    layers_dsn: str | None = None
    layers_agency_dsn: str | None = None
    layers_agency_dsns: dict = field(default_factory=dict)
    reuse_days: int = 30
    org: str = "org/dev-agency"
    brand: str = "brand/dev-brand"
    token: str | None = None
    pipelines: list[str] = field(default_factory=list)
    host: str = "127.0.0.1"
    port: int = 8795

    @classmethod
    def from_env(cls) -> "Settings":
        e = os.environ.get
        pipes = e("NAPKIN_PIPELINES")
        extra = e("NAPKIN_MODEL_EXTRA_BODY")
        try:
            extra_body = json.loads(extra) if extra else {}
        except json.JSONDecodeError as err:
            raise SystemExit(f"NAPKIN_MODEL_EXTRA_BODY is not JSON: {err.msg}") from None
        if not isinstance(extra_body, dict):
            raise SystemExit("NAPKIN_MODEL_EXTRA_BODY must be a JSON object")
        api = (e("NAPKIN_MODEL_API") or "anthropic").strip().lower()
        return cls(model_api=api,
                   model_base_url=e("NAPKIN_MODEL_BASE_URL") or None,
                   model_api_key=e("NAPKIN_MODEL_API_KEY") or None,
                   model_region=e("NAPKIN_MODEL_REGION") or None,
                   model_bedrock_endpoint=(e("NAPKIN_MODEL_BEDROCK_ENDPOINT") or "runtime").strip().lower(),
                   # Bedrock ids carry the provider prefix; a bare claude-* id is a 400 there.
                   model=e("NAPKIN_MODEL") or ("global.anthropic.claude-opus-5-5" if api == "bedrock"
                                               else "claude-opus-5"),
                   vision_model=e("NAPKIN_VISION_MODEL") or None,
                   model_routes=e("NAPKIN_MODEL_ROUTES") or None,
                   model_extra_body=extra_body,
                   model_timeout=float(e("NAPKIN_MODEL_TIMEOUT") or 600),
                   model_concurrency=int(e("NAPKIN_MODEL_CONCURRENCY") or 8),
                   research_url=e("NAPKIN_RESEARCH_URL") or None,
                   research_token=e("NAPKIN_RESEARCH_TOKEN") or None,
                   research_timeout=float(e("NAPKIN_RESEARCH_TIMEOUT") or 900),
                   research_concurrency=int(e("NAPKIN_RESEARCH_CONCURRENCY") or 8),
                   research_web=(e("NAPKIN_RESEARCH_WEB") or ("tavily" if e("NAPKIN_TAVILY_API_KEY") else ""))
                   .strip().lower(),
                   tavily_api_key=e("NAPKIN_TAVILY_API_KEY") or None,
                   nova_region=e("NAPKIN_NOVA_REGION") or "us-east-1",
                   nova_model=e("NAPKIN_NOVA_MODEL") or "us.amazon.nova-2-lite-v1:0",
                   retrieval_url=e("NAPKIN_RETRIEVAL_URL") or None,
                   retrieval_token=e("NAPKIN_RETRIEVAL_TOKEN") or None,
                   retrieval_timeout=float(e("NAPKIN_RETRIEVAL_TIMEOUT") or 120),
                   brief_engine_url=e("NAPKIN_BRIEF_ENGINE_URL") or None,
                   runlog_dir=e("NAPKIN_RUNLOG_DIR") or None,
                   jev_api_key=e("NAPKIN_JEV_API_KEY") or e("TYPESAFE_API_KEY") or None,
                   jev_model=e("NAPKIN_JEV_MODEL") or "jev-latest",
                   jev_base_url=e("NAPKIN_JEV_BASE_URL") or None,
                   brief_flow=(e("NAPKIN_BRIEF_FLOW") or "planned").strip().lower(),
                   brief_research_max=int(e("NAPKIN_BRIEF_RESEARCH_MAX") or 3),
                   brief_judge=(e("NAPKIN_BRIEF_JUDGE") or "review").strip().lower(),
                   runlog_bodies=(e("NAPKIN_RUNLOG_BODIES") or "0").strip().lower() in ("1", "true", "yes", "on"),
                   brief_engine_loops37=(e("NAPKIN_BRIEF_ENGINE_LOOPS37") or "1").strip().lower()
                   not in ("0", "false", "off", "no"),
                   layers_url=e("NAPKIN_LAYERS_URL") or None,
                   layers_token=e("NAPKIN_LAYERS_TOKEN") or None,
                   layers_timeout=float(e("NAPKIN_LAYERS_TIMEOUT") or 30),
                   layers_dsn=e("NAPKIN_LAYERS_DSN") or None,
                   layers_agency_dsn=e("NAPKIN_LAYERS_AGENCY_DSN") or None,
                   layers_agency_dsns={k[len("NAPKIN_LAYERS_AGENCY_DSN_"):].lower(): v for k, v in os.environ.items()
                                       if k.startswith("NAPKIN_LAYERS_AGENCY_DSN_") and v},
                   reuse_days=int(e("NAPKIN_REUSE_DAYS") or 30),
                   org=e("NAPKIN_DEV_ORG") or "org/dev-agency",
                   brand=e("NAPKIN_DEV_BRAND") or "brand/dev-brand", token=e("NAPKIN_TOKEN") or None,
                   pipelines=[p for p in pipes.split(":") if p] if pipes is not None else _default_pipelines(),
                   host=e("NAPKIN_HOST") or "127.0.0.1", port=int(e("NAPKIN_PORT") or 8795))

    @property
    def scope(self) -> dict:
        return {"org": self.org, "brand": self.brand}
