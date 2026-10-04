"""The model port — `napkin.model/1` (docs/contracts/peripherals.md §1).

Structured output on every call (W2-C3): the object the model returns is
validated against the declared schema before it reaches any writer; on a
failure the call is retried once with the validation error fed back (the last
turn is always `user`, never a prefill), then fails loudly. There is no prose
salvage. Where an endpoint cannot enforce the schema, the route's schema mode
decides whether the schema goes in the prompt instead (§1.9, model_routes.py);
the validation here is the same either way.

Which model and effort a call uses comes from its purpose, through the routes
(NAPKIN_MODEL_ROUTES, model_routes.py).

Three wires carry it, chosen by configuration (`NAPKIN_MODEL_API`):

  anthropic  the Anthropic Messages API through the official SDK
             (`output_config.format = json_schema`)
  bedrock    the same Messages request to Claude in Amazon Bedrock, IAM-signed
             (or a Bedrock bearer token): on `bedrock-runtime` InvokeModel
             through the SDK's `AnthropicBedrock` (default), or on
             `bedrock-mantle` through `AnthropicBedrockMantle`
             (`NAPKIN_MODEL_BEDROCK_ENDPOINT`)
  openai     an OpenAI-compatible `/chat/completions` (self-hosted NIM)
             (`response_format = json_schema, strict: true`)

No handler knows which wire is in use. Every wire's failures map to one
`ModelError(kind)` (§1.7).
"""

from __future__ import annotations

import base64
import hashlib
import json
import logging
import re
import threading
import time

import httpx
import jsonschema

from .metrics import emit, record

log = logging.getLogger("napkin.model")

IMAGE_TYPES = ("image/png", "image/jpeg", "image/gif", "image/webp")
# A PDF goes to the model whole, as a document: Claude reads each page as a picture and as text,
# so a deck's charts, layout and image-only slides are read too (the owner, 2026-10-01).
DOC_TYPES = ("application/pdf",)
MAX_DOC_BYTES = 32 * 1024 * 1024
MAX_IMAGE_BYTES = 5 * 1024 * 1024
MAX_IMAGES = 20
PURPOSE_RE = re.compile(r"^[a-z][a-z0-9_]{0,63}$")

KINDS = ("auth", "not_found", "invalid_request", "rate_limited", "overloaded", "server", "timeout",
         "truncated", "refusal", "invalid_output", "unsupported")


class ModelError(Exception):
    """A model failure, by kind (peripherals.md §1.7). Handlers see only the kind."""

    def __init__(self, message: str, kind: str = "invalid_output"):
        super().__init__(message)
        self.kind = kind if kind in KINDS else "server"


def strip_unsupported(schema):
    """The providers refuse or ignore string-length and numeric constraints; the
    full schema is still enforced here after the call."""
    if isinstance(schema, dict):
        return {k: strip_unsupported(v) for k, v in schema.items()
                if k not in ("minLength", "maxLength", "minimum", "maximum", "minItems", "maxItems",
                             "uniqueItems", "pattern", "format")}
    if isinstance(schema, list):
        return [strip_unsupported(x) for x in schema]
    return schema


_strip_unsupported = strip_unsupported  # older name


def schema_in_prompt(system: str, schema: dict) -> str:
    """The system prompt for an endpoint that cannot enforce the schema (§1.9): the
    schema goes in the prompt and the answer is validated here, as always."""
    return (system + "\n\nReturn ONLY one JSON object - no prose, no code fences - that validates against "
            "this JSON Schema:\n" + json.dumps(schema, ensure_ascii=False))


_FENCE = re.compile(r"^\s*```(?:json)?\s*\n(.*)\n\s*```\s*$", re.S)


class Usage:
    def __init__(self):
        self.input_tokens = 0
        self.output_tokens = 0
        self.calls = 0
        self.by_model = {}          # model id -> {calls, input_tokens, output_tokens}
        self._lock = threading.Lock()

    def add(self, input_tokens: int, output_tokens: int, model: str | None = None):
        with self._lock:
            self.calls += 1
            self.input_tokens += int(input_tokens or 0)
            self.output_tokens += int(output_tokens or 0)
            if model:
                m = self.by_model.setdefault(model, {"calls": 0, "input_tokens": 0, "output_tokens": 0})
                m["calls"] += 1
                m["input_tokens"] += int(input_tokens or 0)
                m["output_tokens"] += int(output_tokens or 0)

    def as_dict(self):
        return {"input_tokens": self.input_tokens, "output_tokens": self.output_tokens}


class Reply:
    """What a wire returns: the text (or None), how it stopped, and the usage
    the provider reported (None when it reported none: never estimated)."""

    def __init__(self, text, stop: str, usage: tuple[int, int] | None, detail: str = "", breakdown: dict | None = None):
        self.text, self.stop, self.usage, self.detail = text, stop, usage, detail
        self.breakdown = breakdown  # {"fresh", "cache_write", "cache_read"} input tokens, when the wire reports them


def check_images(images) -> list[dict]:
    """[{media_type, data(base64)}] -> the same, validated (§1.6). Raises ModelError."""
    out = []
    for im in images or []:
        mt, data = (im or {}).get("media_type"), (im or {}).get("data")
        if mt not in IMAGE_TYPES + DOC_TYPES or not isinstance(data, str):
            raise ModelError("an image part is not png, jpeg, gif or webp base64, nor a PDF", "invalid_request")
        try:
            raw = base64.b64decode(data, validate=True)
        except (ValueError, TypeError) as e:
            raise ModelError("an image part is not valid base64", "invalid_request") from e
        if mt in DOC_TYPES and len(raw) > MAX_DOC_BYTES:
            raise ModelError("a PDF part is over 32 MB decoded", "invalid_request")
        if mt in IMAGE_TYPES and len(raw) > MAX_IMAGE_BYTES:
            raise ModelError("an image part is over 5 MB decoded", "invalid_request")
        out.append({"media_type": mt, "data": data})
    if len(out) > MAX_IMAGES:
        raise ModelError("more than 20 images in one call", "invalid_request")
    return out


# ---------------------------------------------------------------------------
# Wire A — Anthropic Messages (the official SDK), direct or on Bedrock
# ---------------------------------------------------------------------------

# A 400 naming these means the endpoint refused structured output itself.
_REFUSED_FORMAT = re.compile(r"output_config|json_schema|structured output|output format", re.I)
# The endpoint enforces schemas for this model but will not compile this one
# (Bedrock: "The compiled grammar is too large ..."): only this schema goes in
# the prompt; smaller ones stay enforced.
# Seen on Bedrock 2026-10-04: "The compiled grammar is too large ...", "Schemas contains too many
# parameters with union types (18 ...) ... (limit: 16 parameters with unions)".
_SCHEMA_TOO_LARGE = re.compile(r"grammar is too large|schemas? (contains|is) too|too many (strict tools|parameters|"
                               r"properties)|union types|compilation cost|simplify your (tool )?schemas?", re.I)


class AnthropicWire:
    """`api` is `anthropic` or `bedrock`: one request shape, two endpoints."""

    def __init__(self, client, api: str = "anthropic"):
        self.client = client
        self.api = api

    @staticmethod
    def _content(turn):
        if not turn.get("images"):
            return turn["text"]
        parts = [{"type": "document" if im["media_type"] in DOC_TYPES else "image",
                  "source": {"type": "base64", "media_type": im["media_type"], "data": im["data"]}}
                 for im in turn["images"]]
        return parts + [{"type": "text", "text": turn["text"]}]

    def send(self, *, model, system, turns, schema, purpose, max_tokens, effort, timeout, headers=None,
             schema_mode="enforced") -> Reply:
        """`schema_mode`: enforced (output_config.format) or prompt (the schema in the system prompt)."""
        prompt = schema_mode == "prompt"
        config = {} if prompt else {"format": {"type": "json_schema", "schema": schema}}
        if effort:
            config["effort"] = effort
        kwargs = dict(model=model, max_tokens=max_tokens, system=schema_in_prompt(system, schema) if prompt else system,
                      messages=[{"role": t["role"], "content": self._content(t)} for t in turns])
        if config:
            kwargs["output_config"] = config
        if headers:
            kwargs["extra_headers"] = dict(headers)
        try:
            if self.api == "bedrock":
                # The Bedrock clients' with_options() drops their http client (a new pool
                # per call); they are built with max_retries=1 and take the timeout per call.
                resp = self.client.messages.create(timeout=timeout, **kwargs)
            else:
                resp = self.client.with_options(timeout=timeout, max_retries=1).messages.create(**kwargs)
        except Exception as e:  # transport / API failure: mapped to a kind, attributable
            kind = _anthropic_kind(e)
            said = str(getattr(e, "message", "") or e)
            if not prompt and kind == "invalid_request" and getattr(e, "status_code", None) == 400 \
                    and _SCHEMA_TOO_LARGE.search(said):
                err = ModelError(f"{purpose}: the {self.api} endpoint will not compile this schema (too large)",
                                 "unsupported")
                err.scope = "schema"
                raise err from e
            if not prompt and kind == "invalid_request" and getattr(e, "status_code", None) == 400 \
                    and _REFUSED_FORMAT.search(said):
                # Not resent here: the port decides, by the route's schema mode (§1.9).
                raise ModelError(f"{purpose}: the {self.api} endpoint refused output_config.format json_schema",
                                 "unsupported") from e
            # The provider's own reason (a request it refused says why), cut short; never the request.
            raise ModelError(f"{purpose}: the model call failed ({type(e).__name__}: {said[:300]})", kind) from e
        u = getattr(resp, "usage", None)
        usage, breakdown = None, None
        if u is not None:
            fresh = int(getattr(u, "input_tokens", 0) or 0)
            cw = int(getattr(u, "cache_creation_input_tokens", 0) or 0)
            cr = int(getattr(u, "cache_read_input_tokens", 0) or 0)
            usage = (fresh + cw + cr, int(getattr(u, "output_tokens", 0) or 0))
            breakdown = {"fresh": fresh, "cache_write": cw, "cache_read": cr}
        text = next((b.text for b in getattr(resp, "content", None) or [] if getattr(b, "type", None) == "text"),
                    None)
        stop = getattr(resp, "stop_reason", None)
        if stop == "end_turn":
            return Reply(text, "ok", usage, breakdown=breakdown)
        if stop == "max_tokens":
            return Reply(text, "truncated", usage, breakdown=breakdown)
        if stop == "refusal":
            cat = getattr(getattr(resp, "stop_details", None), "category", None)
            return Reply(text, "refusal", usage, detail=str(cat or ""), breakdown=breakdown)
        return Reply(text, "invalid", usage, detail=f"stop_reason {stop}", breakdown=breakdown)


def _anthropic_kind(e) -> str:
    try:
        import anthropic
    except ImportError:  # pragma: no cover
        anthropic = None
    if anthropic is not None:
        if isinstance(e, anthropic.APITimeoutError):
            return "timeout"
        if isinstance(e, anthropic.APIStatusError):
            return _status_kind(e.status_code, anthropic_wire=True)
        if isinstance(e, anthropic.APIConnectionError):
            return "server"
    if isinstance(e, RuntimeError) and re.search(r"resolve (aws )?credentials", str(e), re.I):
        return "auth"  # the Bedrock client found no AWS credentials: never transient
    return "server"


def _status_kind(status: int, anthropic_wire: bool = False) -> str:
    if status in (401, 403):
        return "auth"
    if status == 404:
        return "not_found"
    if status in (400, 413) or (status == 422 and not anthropic_wire):
        return "invalid_request"
    if status == 429:
        return "rate_limited"
    if status == 504:
        return "timeout"
    if status == 503 or (status == 529 and anthropic_wire):
        return "overloaded"
    if status >= 500:
        return "server"
    return "invalid_request"


# ---------------------------------------------------------------------------
# Wire B — OpenAI-compatible chat completions (NIM)
# ---------------------------------------------------------------------------

_THINK = re.compile(r"^\s*<think>.*?</think>\s*", re.S)
_UNSUPPORTED = re.compile(r"response_format|json_schema|structured output|guided", re.I)
PORT_KEYS = {"model", "max_tokens", "messages", "response_format"}


class OpenAIWire:
    api = "openai"

    def __init__(self, base_url: str, api_key: str | None = None, extra_body: dict | None = None, transport=None,
                 sleep=time.sleep):
        if not base_url:
            raise ValueError("NAPKIN_MODEL_BASE_URL is required for NAPKIN_MODEL_API=openai (the root including /v1)")
        self.url = base_url.rstrip("/") + "/chat/completions"
        self.key = api_key
        self.extra = {k: v for k, v in (extra_body or {}).items() if k not in PORT_KEYS}
        self._client = httpx.Client(transport=transport)
        self._sleep = sleep

    @staticmethod
    def _content(turn):
        if not turn.get("images"):
            return turn["text"]
        if any(im["media_type"] in DOC_TYPES for im in turn["images"]):
            raise ModelError("the OpenAI-compatible wire takes no PDF documents", "unsupported")
        parts = [{"type": "image_url", "image_url": {"url": f"data:{im['media_type']};base64,{im['data']}"}}
                 for im in turn["images"]]
        return parts + [{"type": "text", "text": turn["text"]}]

    def send(self, *, model, system, turns, schema, purpose, max_tokens, effort, timeout, headers=None,
             schema_mode="enforced") -> Reply:
        prompt = schema_mode == "prompt"
        body = dict(self.extra)
        body.update(model=model, max_tokens=max_tokens,
                    messages=[{"role": "system", "content": schema_in_prompt(system, schema) if prompt else system}]
                    + [{"role": t["role"], "content": self._content(t)} for t in turns])
        if not prompt:
            body["response_format"] = {"type": "json_schema",
                                       "json_schema": {"name": purpose, "schema": schema, "strict": True}}
        headers = {**(headers or {}), "Content-Type": "application/json"}
        if self.key:
            headers["Authorization"] = f"Bearer {self.key}"
        for attempt in (1, 2):
            try:
                r = self._client.post(self.url, json=body, headers=headers, timeout=timeout)
            except httpx.TimeoutException as e:
                raise ModelError(f"{purpose}: the model call timed out", "timeout") from e
            except httpx.HTTPError as e:
                if attempt == 1:
                    continue
                raise ModelError(f"{purpose}: the model endpoint is unreachable ({type(e).__name__})", "server") from e
            if r.status_code == 200:
                break
            kind = _status_kind(r.status_code)
            msg = _openai_error_message(r)
            if not prompt and kind == "invalid_request" and r.status_code == 400 and _UNSUPPORTED.search(msg):
                # Not resent here: the port decides, by the route's schema mode (§1.9).
                raise ModelError(f"{purpose}: the endpoint does not support response_format json_schema",
                                 "unsupported")
            if attempt == 1 and kind in ("rate_limited", "overloaded", "server"):
                if kind == "rate_limited":
                    self._sleep(_retry_after(r))
                continue
            raise ModelError(f"{purpose}: the model endpoint returned {r.status_code}", kind)
        try:
            out = r.json()
        except ValueError as e:
            raise ModelError(f"{purpose}: the model endpoint returned a body that is not JSON", "invalid_output") from e
        u = out.get("usage") if isinstance(out, dict) else None
        usage = (int(u.get("prompt_tokens") or 0), int(u.get("completion_tokens") or 0)) if isinstance(u, dict) \
            else None
        choices = out.get("choices") if isinstance(out, dict) else None
        if not choices or not isinstance(choices[0], dict):
            return Reply(None, "invalid", usage, detail="no choices")
        msg = choices[0].get("message") or {}
        text = msg.get("content")
        if isinstance(text, str):
            text = _THINK.sub("", text, count=1)
        finish = choices[0].get("finish_reason")
        if (msg.get("refusal") or "") or finish == "content_filter":
            return Reply(text, "refusal", usage)
        if finish == "length":
            return Reply(text, "truncated", usage)
        if text is None:
            return Reply(None, "invalid", usage, detail="content is null")
        if finish == "stop":
            return Reply(text, "ok", usage)
        return Reply(text, "invalid", usage, detail=f"finish_reason {finish}")


def _openai_error_message(r) -> str:
    try:
        e = r.json().get("error")
        return str(e.get("message") if isinstance(e, dict) else e or "")
    except (ValueError, AttributeError):
        return r.text[:500]


def _retry_after(r) -> float:
    try:
        return max(0.0, min(30.0, float(r.headers.get("retry-after", "1"))))
    except ValueError:
        return 1.0


# ---------------------------------------------------------------------------
# The port
# ---------------------------------------------------------------------------

class ModelPort:
    """Shared by every request; `Capabilities` gives each job a view that
    records usage and attributes each call to a handler.

    `client` may be an Anthropic SDK client (wrapped in the Anthropic wire) or a
    wire object (`AnthropicWire`, `OpenAIWire`)."""

    def __init__(self, client, model: str, timeout: float, max_tokens: int = 16000, vision_model: str | None = None,
                 routes=None):
        from .model_routes import Routes
        self.wire = client if hasattr(client, "send") and hasattr(client, "api") else AnthropicWire(client)
        self.timeout, self.max_tokens = timeout, max_tokens
        self.routes = routes or Routes(self.wire.api, model, vision_model)
        self._unenforced = set()      # models whose endpoint refused output_config.format (schema: auto)
        self._too_large = set()       # (model, schema digest) the endpoint would not compile (schema: auto)
        self._unenforced_lock = threading.Lock()

    @property
    def model(self) -> str:
        """The default route's model (what a purpose with no route of its own uses)."""
        return self.routes.resolve("-").model

    @property
    def vision_model(self) -> str:
        return self.routes.resolve("-", vision=True).model

    @property
    def api(self) -> str:
        return self.wire.api

    def call(self, purpose: str, system: str, payload: dict, schema: dict, *, usage: Usage, attribution: str,
             max_tokens: int | None = None, effort: str | None = None, images=None, model: str | None = None,
             headers: dict | None = None, vision: bool = False) -> dict:
        """`headers`: the attribution headers (`X-Napkin-Handler`, `X-Napkin-Job`,
        peripherals.md §0.2) — metadata only, never auth, never content.
        `vision`: an image transcription (the `vision` route). `model`: an id that
        overrides the route's (tests, one-off tools)."""
        from .model_routes import with_caller
        if not PURPOSE_RE.match(purpose or ""):
            raise ModelError(f"purpose {purpose!r} is not a slug", "invalid_request")
        images = check_images(images)
        route = with_caller(self.routes.resolve(purpose, vision=vision), effort, max_tokens)
        model = model or route.model
        effort, max_tokens = route.effort, route.max_tokens
        api_schema = strip_unsupported(schema)
        digest = hashlib.sha256(json.dumps(api_schema, sort_keys=True).encode()).hexdigest()[:16]
        mode = "prompt" if route.schema == "prompt" or (route.schema == "auto" and (
            model in self._unenforced or (model, digest) in self._too_large)) else "enforced"
        # Compact JSON: indentation was 5-21% of every payload's characters (21% of the report's), paid as input.
        user = f"Task: {purpose}\n\n<input>\n{json.dumps(payload, ensure_ascii=False, separators=(',', ':'))}\n</input>"
        first = {"role": "user", "text": user, "images": images}
        turns = [first]
        validator = jsonschema.Draft202012Validator(schema)
        last_err = None
        for attempt in (1, 2):
            t0 = time.monotonic()
            send = dict(model=model, system=system, turns=turns, purpose=purpose,
                        max_tokens=max_tokens or self.max_tokens, effort=effort, timeout=self.timeout, headers=headers)
            try:
                try:
                    reply = self.wire.send(schema=schema if mode == "prompt" else api_schema, schema_mode=mode, **send)
                except ModelError as e:
                    if e.kind != "unsupported" or mode != "enforced" or route.schema != "auto":
                        raise
                    # schema: auto, and this endpoint does not enforce a schema for this model
                    # (or will not compile this one): the schema goes in the prompt from now
                    # on, for this model or this schema (§1.9).
                    with self._unenforced_lock:
                        if getattr(e, "scope", None) == "schema":
                            if (model, digest) not in self._too_large:
                                log.warning("model %s: the endpoint will not compile this schema for %s (too "
                                            "large); it goes in the prompt (validated here) [%s]", purpose, model,
                                            attribution)
                            self._too_large.add((model, digest))
                        else:
                            if model not in self._unenforced:
                                log.warning("model %s: the endpoint does not enforce a JSON schema for %s; "
                                            "the schema goes in the prompt (validated here) [%s]", purpose, model,
                                            attribution)
                            self._unenforced.add(model)
                    mode = "prompt"
                    reply = self.wire.send(schema=schema, schema_mode=mode, **send)
            except ModelError as e:
                emit("model", purpose=purpose, model=model, wire=self.wire.api, attempt=attempt, stop="error",
                     error=getattr(e, "kind", type(e).__name__), secs=round(time.monotonic() - t0, 2),
                     job=(headers or {}).get("X-Napkin-Job"), handler=(headers or {}).get("X-Napkin-Handler"))
                raise
            if reply.usage is None:
                log.warning("model %s: the response carried no usage; counted as zero [%s]", purpose, attribution)
                usage.add(0, 0, model)
            else:
                usage.add(*reply.usage, model)
            log.info("model %s wire=%s model=%s effort=%s schema=%s attempt=%d stop=%s %.1fs [%s]", purpose,
                     self.wire.api, model, effort or "-", mode, attempt, reply.stop, time.monotonic() - t0,
                     attribution)
            emit("model", purpose=purpose, model=model, wire=self.wire.api, attempt=attempt, stop=reply.stop,
                 secs=round(time.monotonic() - t0, 2), input_tokens=(reply.usage or (None, None))[0],
                 output_tokens=(reply.usage or (None, None))[1], max_tokens=max_tokens or self.max_tokens,
                 effort=effort, schema_mode=mode, breakdown=reply.breakdown, job=(headers or {}).get("X-Napkin-Job"),
                 handler=(headers or {}).get("X-Napkin-Handler"))
            record("model_calls", purpose=purpose, model=model, attempt=attempt, stop=reply.stop, system=system,
                   user=turns[-1]["text"] if len(turns) == 1 else turns[0]["text"], turns=len(turns), schema=schema,
                   reply=reply.text, usage=reply.usage, breakdown=reply.breakdown, max_tokens=max_tokens or self.max_tokens,
                   effort=effort, schema_mode=mode, job=(headers or {}).get("X-Napkin-Job"))
            if reply.stop == "truncated":
                raise ModelError(f"{purpose}: the response was cut off at max_tokens", "truncated")
            if reply.stop == "refusal":
                if reply.detail:
                    log.info("model %s refusal category=%s [%s]", purpose, reply.detail, attribution)
                raise ModelError(f"{purpose}: the model refused", "refusal")
            text = reply.text
            if mode == "prompt" and text is not None:
                fenced = _FENCE.match(text)   # a fence around the whole answer, nothing else, is removed
                text = fenced.group(1) if fenced else text
            if reply.stop != "ok" or text is None:
                problem = reply.detail or "no text in the response"
            else:
                try:
                    obj = json.loads(text)
                except json.JSONDecodeError as e:
                    problem = f"the response is not JSON ({e.msg})"
                else:
                    errs = sorted(validator.iter_errors(obj), key=lambda e: list(e.path))
                    if not errs:
                        if attempt == 2:
                            log.warning("model %s needed a second attempt [%s]", purpose, attribution)
                        return obj
                    problem = "; ".join(f"{'/'.join(map(str, e.path)) or '$'}: {e.message}" for e in errs[:5])
            last_err = problem
            if attempt == 1 and text is not None:
                # Retry once with the validation error fed back (no prefill: a new user turn).
                turns = [first, {"role": "assistant", "text": text[:20000], "images": []},
                         {"role": "user", "text": f"That output does not validate against the schema: {problem}. "
                                                  f"Return the corrected JSON only.", "images": []}]
                continue
            break
        raise ModelError(f"{purpose}: no valid structured output ({last_err})", "invalid_output")


def build_wire(settings, client=None, transport=None):
    """The configured wire. `client`: an Anthropic-SDK-shaped client to use
    instead of constructing one (tests)."""
    if settings.model_api == "openai":
        return OpenAIWire(settings.model_base_url, settings.model_api_key, settings.model_extra_body,
                          transport=transport)
    if settings.model_api == "bedrock":
        if settings.model_bedrock_endpoint not in ("runtime", "mantle"):
            raise ValueError("NAPKIN_MODEL_BEDROCK_ENDPOINT must be runtime or mantle, "
                             f"not {settings.model_bedrock_endpoint!r}")
        if client is None:
            # runtime: bedrock-runtime InvokeModel, AWS's primary endpoint, with the eu./global.
            # inference profiles. mantle: bedrock-mantle's native Messages API. One request body.
            from anthropic import AnthropicBedrock, AnthropicBedrockMantle
            cls = AnthropicBedrock if settings.model_bedrock_endpoint == "runtime" else AnthropicBedrockMantle
            kw = {"max_retries": 1}
            if settings.model_region:
                kw["aws_region"] = settings.model_region
            if settings.model_base_url:
                kw["base_url"] = settings.model_base_url
            if settings.model_api_key:
                kw["api_key"] = settings.model_api_key   # a Bedrock bearer token; unset = SigV4 (IAM)
            # Unset values: the SDK's AWS resolution (AWS_REGION, the credential chain:
            # env, SSO profile, instance or task role).
            client = cls(**kw)
        return AnthropicWire(client, api="bedrock")
    if settings.model_api != "anthropic":
        raise ValueError(f"NAPKIN_MODEL_API must be anthropic, bedrock or openai, not {settings.model_api!r}")
    if client is None:
        import anthropic
        kw = {}
        if settings.model_base_url:
            kw["base_url"] = settings.model_base_url
        if settings.model_api_key:
            kw["api_key"] = settings.model_api_key
        client = anthropic.Anthropic(**kw)  # unset values: the SDK's own resolution
    return AnthropicWire(client)
