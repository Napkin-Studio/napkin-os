"""The model port, every wire (contract 5, §1 and §5.3).

  POST /v1/messages                    Anthropic Messages shape; `stream: true` answers SSE
  POST /anthropic/v1/messages          the same, at the path Bedrock's mantle endpoint uses
  POST /model/{modelId}/invoke         Bedrock InvokeModel with an Anthropic body (bedrock-2023-05-31)
  POST /v1/chat/completions            OpenAI-compatible shape (the NIM wire), response_format json_schema
  GET  /v1/models                      the id map, in the shape the request's headers ask for

Each call is one fresh `claude -p`. Transport only: no prompt engineering,
no schema logic, no retries, no cache (two identical requests may differ, as
the real APIs' do). Pure translation lives in the functions below the
handler so it is unit-testable without spawning anything.
"""

from __future__ import annotations

import base64
import binascii
import json
import os
import re
import secrets
import string
import time
from dataclasses import dataclass, field
from urllib.parse import unquote

from common import ClaudeCall, ClaudeFailure, Config, Request, Response, Slots, run_claude

# ------------------------------------------------------------------ model ids

BASE_MODELS: dict[str, str] = {
    "claude-opus-5": "opus",
    "claude-sonnet-5": "sonnet",
    # exact ids, passed to the CLI as they are, so a call names the model that answered it
    "claude-opus-5-5": "claude-opus-5-5",
    "claude-sonnet-5-5": "claude-sonnet-5-5",
    "claude-opus-4-6": "claude-opus-4-6",
    "claude-haiku-4-5": "haiku",
    "claude-haiku-4-5-20251001": "haiku",
    "claude-fable-5-1": "fable",
}
DEFAULT_ALIASES: dict[str, str] = {
    "nvidia/llama-3.3-nemotron-super-49b-v1": "sonnet",
    "nvidia/llama-3.1-nemotron-70b-instruct": "sonnet",
    "nvidia/llama-3.1-nemotron-nano-vl-8b-v1": "haiku",
}


def model_map() -> dict[str, str]:
    """Claude ids plus MOCK_MODEL_ALIASES (JSON {"<id>": "<alias>"}; default the
    NIM ids the engine uses). Any other id is a 404, never a default."""
    raw = os.environ.get("MOCK_MODEL_ALIASES", "").strip()
    aliases = DEFAULT_ALIASES
    if raw:
        try:
            aliases = json.loads(raw)
        except json.JSONDecodeError as e:
            raise SystemExit(f"MOCK_MODEL_ALIASES is not JSON: {e}") from None
        if not isinstance(aliases, dict) or not all(isinstance(k, str) and isinstance(v, str) and v
                                                    for k, v in aliases.items()):
            raise SystemExit('MOCK_MODEL_ALIASES must be a JSON object {"<id>": "<claude alias>"}')
    return {**BASE_MODELS, **aliases}


MODELS = model_map()

# A Bedrock id: an optional inference-profile prefix (eu., us., global., apac., …), `anthropic.`, the
# Anthropic id, and an optional `-v1` / `-v1:0` version. `eu.anthropic.claude-sonnet-5-5` and
# `global.anthropic.claude-haiku-4-5-20251001-v1:0` resolve as `claude-sonnet-5-5` and `claude-haiku-4-5`.
_BEDROCK_ID = re.compile(r"^(?:(?:eu|us|us-gov|global|apac|jp|au|ca)\.)?anthropic\.(?P<id>claude-[a-z0-9-]+?)"
                         r"(?:-v\d+(?::\d+)?)?$")


def resolve_model(model: str) -> str | None:
    """The CLI alias for a model id: an id in MODELS, or a Bedrock id whose Anthropic id (with or
    without its date) is in MODELS. None otherwise: an unknown id is a 404, never a default."""
    if model in MODELS:
        return MODELS[model]
    m = _BEDROCK_ID.match(model or "")
    if m:
        for cand in (m.group("id"), re.sub(r"-\d{8}$", "", m.group("id"))):
            if cand in MODELS:
                return MODELS[cand]
    return None

EFFORT_LEVELS = {"low", "medium", "high", "xhigh", "max"}
IMAGE_TYPES = {"image/png", "image/jpeg", "image/gif", "image/webp"}
DOC_TYPES = {"application/pdf"}   # a `document` block: the CLI reads a PDF's pages as pictures and text
MAX_DOC_BYTES = 32 * 1024 * 1024
MAX_IMAGE_BYTES = 5 * 1024 * 1024
MAX_IMAGES = 20


# ------------------------------------------------------------------ errors


class WireError(Exception):
    """One error, rendered in whichever wire the request came in on."""

    _OPENAI = {
        400: ("invalid_request_error", None),
        401: ("invalid_request_error", "invalid_api_key"),
        403: ("invalid_request_error", "permission_denied"),
        404: ("invalid_request_error", "not_found"),
        411: ("invalid_request_error", "length_required"),
        413: ("invalid_request_error", "request_too_large"),
        429: ("rate_limit_error", "rate_limit_exceeded"),
        500: ("server_error", None),
        503: ("server_error", "overloaded"),
        504: ("server_error", "timeout"),
    }

    def __init__(self, status: int, type_: str, message: str, code: str | None = None,
                 param: str | None = None):
        super().__init__(message)
        self.status, self.type, self.message, self.code, self.param = status, type_, message, code, param

    def anthropic(self) -> Response:
        return Response(self.status, {"type": "error", "error": {"type": self.type, "message": self.message}},
                        close=self.status in (404, 411, 413))

    def openai(self) -> Response:
        status = 503 if self.status == 529 else self.status
        otype, ocode = self._OPENAI.get(status, ("server_error", None))
        return Response(status, {"error": {"message": self.message, "type": otype, "param": self.param,
                                           "code": self.code or ocode}},
                        close=status in (404, 411, 413))


def invalid(message: str, param: str | None = None) -> WireError:
    return WireError(400, "invalid_request_error", message, param=param)


def unknown_model(model: str) -> WireError:
    return WireError(404, "not_found_error", f"model: {model}", code="model_not_found", param="model")


# ------------------------------------------------------------------ the call


@dataclass
class ModelCall:
    model: str
    alias: str
    turns: list                      # [(role, text)]
    system: str | None = None
    schema: dict | None = None
    effort: str | None = None
    max_tokens: int | None = None    # the reply budget the caller asked for (hidden thinking counts)
    images: list = field(default_factory=list)   # [(media_type, b64)]
    ignored: list = field(default_factory=list)
    stream: bool = False             # answer as Anthropic SSE events

    def claude(self, cfg: Config) -> ClaudeCall:
        return ClaudeCall(alias=self.alias, prompt=flatten(self.turns), system=self.system,
                          json_schema=cli_schema(self.schema)[0] if self.schema is not None else None,
                          effort=self.effort, images=list(self.images), max_turns=cfg.max_turns)


_COMBINATORS = ("oneOf", "anyOf", "allOf", "not", "if", "$ref")


def _strip_ids(schema):
    if isinstance(schema, dict):
        return {k: _strip_ids(v) for k, v in schema.items() if k not in ("$schema", "$id")}
    if isinstance(schema, list):
        return [_strip_ids(v) for v in schema]
    return schema


def cli_schema(schema: dict) -> tuple[dict, bool]:
    """The schema as the CLI's --json-schema takes it, and whether it was wrapped. The CLI makes the
    schema a tool's input, which must be a plain object at the top: a draft marker or `$id` it tries
    to resolve and refuses, and a top-level oneOf/anyOf/$ref (or a non-object) it cannot take. Such a
    schema goes in as `{"answer": <schema>}` (its `$defs` kept at the top so its refs still resolve)
    and the answer is unwrapped before it is returned. The caller still validates the full schema."""
    s = _strip_ids(schema)
    if s.get("type") == "object" and not any(k in s for k in _COMBINATORS):
        return s, False
    defs = {k: s.pop(k) for k in ("$defs", "definitions") if k in s}
    return {"type": "object", "properties": {"answer": s}, "required": ["answer"], "additionalProperties": False,
            **defs}, True


def flatten(turns: list) -> str:
    """One user turn goes through verbatim. A multi-turn history (the port's
    retry turn) is a transcript: `claude -p` takes one prompt, never --resume."""
    if len(turns) == 1:
        return turns[0][1]
    lines = ["The conversation so far is below, oldest first. Write only the assistant's "
             "next reply to the final user turn.", ""]
    for role, text in turns:
        lines += [f"<{role}>", text, f"</{role}>", ""]
    return "\n".join(lines).rstrip() + "\n"


def check_image(media_type, data, where: str) -> tuple[str, str]:
    if media_type not in IMAGE_TYPES | DOC_TYPES:
        raise invalid(f"{where}: image media type must be one of {sorted(IMAGE_TYPES)}, or a PDF document")
    if not isinstance(data, str) or not data:
        raise invalid(f"{where}: image data must be a non-empty base64 string")
    try:
        raw = base64.b64decode(data, validate=True)
    except (binascii.Error, ValueError):
        raise invalid(f"{where}: image data is not valid base64") from None
    limit = MAX_DOC_BYTES if media_type in DOC_TYPES else MAX_IMAGE_BYTES
    if len(raw) > limit:
        raise invalid(f"{where}: {'document' if media_type in DOC_TYPES else 'image'} is {len(raw)} bytes decoded; "
                      f"the limit is {limit}")
    return media_type, data


def parse_body(raw: bytes) -> dict:
    try:
        text = raw.decode("utf-8")
    except UnicodeDecodeError as e:
        raise invalid(f"request body is not valid UTF-8 (byte {e.start})") from None
    try:
        body = json.loads(text)
    except json.JSONDecodeError as e:
        raise invalid(f"request body is not valid JSON: {e.msg} at line {e.lineno} column {e.colno}") from None
    if not isinstance(body, dict):
        raise invalid("request body must be a JSON object")
    return body


def _check_schema_obj(schema, where: str) -> dict:
    if not isinstance(schema, dict):
        raise invalid(f"{where}: Field required")
    return schema


# ------------------------------------------------------------------ Wire A — Anthropic

A_IGNORED = {"temperature", "top_p", "top_k", "stop_sequences", "metadata", "thinking", "service_tier",
             "cache_control", "betas", "fallbacks"}
A_REFUSED = {
    "tools": "the mock does not support `tools`: `claude -p` cannot emulate tool_use content blocks, and "
             "silently dropping them would pass in development and fail against the real API",
    "tool_choice": "the mock does not support `tool_choice` (it does not support tools)",
    "mcp_servers": "the mock does not support `mcp_servers`",
    "container": "the mock does not support `container`",
    "context_management": "the mock does not support `context_management`",
}
A_KNOWN = {"model", "max_tokens", "messages", "system", "stream", "output_config"} | A_IGNORED | set(A_REFUSED)


def _anthropic_blocks(blocks, where: str, images: list | None) -> str:
    """Text of a content value; image blocks appended to `images` (None = not allowed here)."""
    if isinstance(blocks, str):
        return blocks
    if not isinstance(blocks, list):
        raise invalid(f"{where}: content must be a string or a list of content blocks")
    parts = []
    for i, b in enumerate(blocks):
        w = f"{where}.{i}"
        if not isinstance(b, dict) or "type" not in b:
            raise invalid(f"{w}: content block must be an object with a `type`")
        t = b["type"]
        if t == "text":
            if not isinstance(b.get("text"), str):
                raise invalid(f"{w}.text: Field required")
            parts.append(b["text"])     # cache_control, citations: accepted and dropped
        elif t in ("image", "document"):
            if images is None:
                raise invalid(f"{w}: {t} blocks are accepted only in user turns")
            src = b.get("source")
            if not isinstance(src, dict):
                raise invalid(f"{w}.source: Field required")
            if src.get("type") != "base64":
                raise invalid(f"{w}.source.type: the mock accepts only `base64` image sources (never a URL: "
                              "the bytes are client-confidential and must not be fetched from a link)")
            if (t == "document") != (src.get("media_type") in DOC_TYPES):
                raise invalid(f"{w}: a document block carries a PDF, an image block a picture")
            images.append(check_image(src.get("media_type"), src.get("data"), w))
        elif t in ("tool_use", "tool_result", "server_tool_use", "mcp_tool_use", "mcp_tool_result"):
            raise invalid(f"{w}: the mock does not support `{t}` blocks (it does not support tools)")
        else:
            raise invalid(f"{w}: the mock does not support `{t}` content blocks; only `text`, `image` and "
                          "`document` (a PDF); audio needs the real API")
    return "\n\n".join(parts)


def build_anthropic(body: dict) -> ModelCall:
    unknown = sorted(set(body) - A_KNOWN)
    if unknown:
        raise invalid(f"{unknown[0]}: Extra inputs are not permitted")
    for key, why in A_REFUSED.items():
        if key in body:
            raise invalid(why)
    if "stream" in body and not isinstance(body["stream"], bool):
        raise invalid("stream: Input should be a valid boolean")
    model = body.get("model")
    if not isinstance(model, str) or not model:
        raise invalid("model: Field required")
    mt = body.get("max_tokens")
    if mt is None:
        raise invalid("max_tokens: Field required")
    if isinstance(mt, bool) or not isinstance(mt, int) or mt < 1:
        raise invalid("max_tokens: Input should be an integer greater than or equal to 1")
    msgs = body.get("messages")
    if msgs is None:
        raise invalid("messages: Field required")
    if not isinstance(msgs, list):
        raise invalid("messages: Input should be a valid list")
    if not msgs:
        raise invalid("messages: at least one message is required")
    # Shape first, so a malformed body is a 400 whatever the model; then the model,
    # before anything is spawned.
    alias = resolve_model(model)
    if alias is None:
        raise unknown_model(model)

    system = body.get("system")
    if system is not None:
        system = _anthropic_blocks(system, "system", None)

    images: list = []
    turns = []
    for i, m in enumerate(msgs):
        if not isinstance(m, dict):
            raise invalid(f"messages.{i}: Input should be an object")
        role = m.get("role")
        if role not in ("user", "assistant"):
            raise invalid(f"messages.{i}.role: Input should be 'user' or 'assistant'")
        if "content" not in m:
            raise invalid(f"messages.{i}.content: Field required")
        before = len(images)
        text = _anthropic_blocks(m["content"], f"messages.{i}.content", images if role == "user" else None)
        if not text.strip() and len(images) == before:
            raise invalid(f"messages.{i}: text content blocks must be non-empty")
        turns.append((role, text))
    if turns[-1][0] != "user":
        raise invalid("the final message must have role `user`: the mock cannot continue an assistant "
                      "prefill (and current models refuse prefill on the real API)")
    if len(images) > MAX_IMAGES:
        raise invalid(f"at most {MAX_IMAGES} images per request")

    schema = effort = None
    oc = body.get("output_config")
    if oc is not None:
        if not isinstance(oc, dict):
            raise invalid("output_config: Input should be an object")
        extra = sorted(set(oc) - {"format", "effort"})
        if extra:
            raise invalid(f"output_config.{extra[0]}: Extra inputs are not permitted")
        fmt = oc.get("format")
        if fmt is not None:
            if not isinstance(fmt, dict) or fmt.get("type") != "json_schema":
                raise invalid("output_config.format.type: the mock supports only `json_schema`")
            schema = _check_schema_obj(fmt.get("schema"), "output_config.format.schema")
        effort = oc.get("effort")
        if effort is not None and effort not in EFFORT_LEVELS:
            raise invalid(f"output_config.effort: Input should be one of {sorted(EFFORT_LEVELS)}")

    return ModelCall(model=model, alias=alias, turns=turns, system=system, schema=schema,
                     effort=effort, max_tokens=mt, images=images, stream=body.get("stream") is True,
                     ignored=sorted(k for k in body if k in A_IGNORED))


_B62 = string.ascii_letters + string.digits


def _rand(n: int = 24) -> str:
    return "".join(secrets.choice(_B62) for _ in range(n))


def message_id() -> str:
    return "msg_" + _rand()


def usage_of(envelope: dict) -> tuple[int, int]:
    """(input, output) from the CLI envelope, or zeros. Never an estimate: a
    plausible number would be believed by the cost accounting downstream.
    Input counts every prompt token the CLI says the model read (fresh + the
    CLI's own cache writes and reads)."""
    u = envelope.get("usage") if isinstance(envelope.get("usage"), dict) else {}

    def n(k):
        v = u.get(k)
        return v if isinstance(v, int) and not isinstance(v, bool) and v >= 0 else 0

    return (n("input_tokens") + n("cache_creation_input_tokens") + n("cache_read_input_tokens"),
            n("output_tokens"))


_STATUS_TYPES = {400: "invalid_request_error", 401: "authentication_error", 403: "permission_error",
                 404: "not_found_error", 413: "request_too_large", 429: "rate_limit_error",
                 529: "overloaded_error"}


def envelope_error(envelope: dict) -> WireError | None:
    """If the CLI reported a failure, the matching error; else None."""
    if not envelope.get("is_error") and str(envelope.get("subtype", "success")) == "success":
        return None
    msg = str(envelope.get("result") or envelope.get("subtype") or "claude reported an error")[:500]
    status = envelope.get("api_error_status")
    low = msg.lower()
    if status == 401 or "not logged in" in low or "/login" in low or "invalid api key" in low:
        return WireError(401, "authentication_error", f"claude CLI: {msg}")
    if isinstance(status, int) and status in _STATUS_TYPES:
        return WireError(status, _STATUS_TYPES[status], f"claude CLI: {msg}")
    return WireError(500, "api_error", f"claude CLI: {msg}")


def reply_text(envelope: dict, call: ModelCall) -> str:
    err = envelope_error(envelope)
    if err:
        raise err
    if call.schema is not None:
        if "structured_output" not in envelope:
            raise WireError(500, "api_error", "claude CLI returned no structured_output for a json_schema request")
        out = envelope["structured_output"]
        if cli_schema(call.schema)[1] and isinstance(out, dict) and "answer" in out:
            out = out["answer"]
        return json.dumps(out, ensure_ascii=False)
    text = envelope.get("result")
    if not isinstance(text, str):
        raise WireError(500, "api_error", "claude CLI envelope has no `result` text")
    return text


def answer_tokens(envelope: dict) -> int | None:
    """Output tokens of the answer turn, the number a real call's max_tokens caps (hidden thinking
    included): the whole output when the run was one answer turn plus the CLI's short closing turn (a
    slight overcount, so it errs towards cut-off). None when the run had extra dev-only turns (the CLI's
    broken-JSON retry writes the reply again): the total spans requests production would not make. The
    stream trace's per-turn counts are partial, never final, so they are not used."""
    turns = envelope.get("num_turns")
    if isinstance(turns, int) and turns > 2:
        return None
    return usage_of(envelope)[1] or None


def cut_off(text: str, envelope: dict, call: ModelCall) -> str | None:
    """The reply as a real call would return it when the answer turn wrote more than max_tokens: the same
    share of its text as max_tokens is of what was written. None when it fits. The CLI itself has no
    output cap, so without this a reply that production would truncate passes in development."""
    n = answer_tokens(envelope)
    if not call.max_tokens or n is None or n <= call.max_tokens:
        return None
    return text[:len(text) * call.max_tokens // n]


def to_anthropic(envelope: dict, call: ModelCall) -> dict:
    text = reply_text(envelope, call)
    i, o = usage_of(envelope)
    cut = cut_off(text, envelope, call)
    return {"id": message_id(), "type": "message", "role": "assistant", "model": call.model,
            "content": [{"type": "text", "text": text if cut is None else cut}],
            "stop_reason": "end_turn" if cut is None else "max_tokens", "stop_sequence": None,
            "usage": {"input_tokens": i, "output_tokens": o,
                      "cache_creation_input_tokens": 0, "cache_read_input_tokens": 0}}


# ------------------------------------------------------------------ Wire B — OpenAI-compatible

O_IGNORED = {"temperature", "top_p", "seed", "user", "chat_template_kwargs", "nvext", "frequency_penalty",
             "presence_penalty", "stop", "max_completion_tokens", "stream_options", "parallel_tool_calls",
             "service_tier", "metadata", "store", "reasoning_effort"}
O_REFUSED = {
    "tools": "the mock does not support `tools`: `claude -p` cannot emulate tool calls, and silently "
             "dropping them would pass in development and fail in production",
    "tool_choice": "the mock does not support `tool_choice` (it does not support tools)",
    "functions": "the mock does not support `functions` (it does not support tools)",
    "function_call": "the mock does not support `function_call` (it does not support tools)",
    "audio": "the mock does not support `audio` output",
    "modalities": "the mock does not support `modalities`",
    "prediction": "the mock does not support `prediction`",
}


def _openai_content(content, where: str, images: list | None) -> str:
    if isinstance(content, str):
        return content
    if not isinstance(content, list):
        raise invalid(f"{where}: content must be a string or a list of content parts", param=where)
    parts = []
    for i, p in enumerate(content):
        w = f"{where}[{i}]"
        if not isinstance(p, dict) or "type" not in p:
            raise invalid(f"{w}: content part must be an object with a `type`", param=w)
        t = p["type"]
        if t == "text":
            if not isinstance(p.get("text"), str):
                raise invalid(f"{w}.text: required", param=w)
            parts.append(p["text"])
        elif t == "image_url":
            if images is None:
                raise invalid(f"{w}: image parts are accepted only in user messages", param=w)
            iu = p.get("image_url")
            url = iu.get("url") if isinstance(iu, dict) else None
            if not isinstance(url, str):
                raise invalid(f"{w}.image_url.url: required", param=w)
            if not url.startswith("data:"):
                raise invalid(f"{w}: the mock accepts only data: image URLs (never a remote URL: the bytes are "
                              "client-confidential and must not be fetched from a link)", param=w)
            head, sep, data = url[5:].partition(",")
            if not sep or not head.endswith(";base64"):
                raise invalid(f"{w}: an image URL must be data:<media type>;base64,<data>", param=w)
            try:
                images.append(check_image(head[:-len(";base64")], data, w))
            except WireError as e:
                e.param = w
                raise
        else:
            raise invalid(f"{w}: the mock does not support `{t}` content parts; only `text` and `image_url`",
                          param=w)
    return "\n\n".join(parts)


def build_openai(body: dict) -> ModelCall:
    for key, why in O_REFUSED.items():
        if key in body:
            raise invalid(why, param=key)
    if body.get("stream") is True:
        raise invalid("the mock does not support `stream: true`: it would have to fake the SSE chunk "
                      "sequence, which hides stream-handling bugs until production", param="stream")
    n = body.get("n")
    if n is not None and n != 1:
        raise invalid("the mock supports only `n: 1`", param="n")
    if body.get("logprobs") or body.get("top_logprobs"):
        raise invalid("the mock does not support `logprobs`", param="logprobs")
    model = body.get("model")
    if not isinstance(model, str) or not model:
        raise invalid("you must provide a model parameter", param="model")
    msgs = body.get("messages")
    if not isinstance(msgs, list) or not msgs:
        raise invalid("messages: a non-empty array is required", param="messages")
    for k in ("max_tokens", "max_completion_tokens"):
        v = body.get(k)
        if v is not None and (isinstance(v, bool) or not isinstance(v, int) or v < 1):
            raise invalid(f"{k}: must be an integer >= 1", param=k)
    alias = resolve_model(model)
    if alias is None:
        raise unknown_model(model)

    system_parts: list[str] = []
    images: list = []
    turns = []
    for i, m in enumerate(msgs):
        w = f"messages[{i}]"
        if not isinstance(m, dict):
            raise invalid(f"{w}: must be an object", param=w)
        role = m.get("role")
        if role in ("tool", "function") or m.get("tool_calls") or m.get("function_call"):
            raise invalid(f"{w}: the mock does not support tool messages or tool calls", param=w)
        if role in ("system", "developer"):
            if turns:
                raise invalid(f"{w}: the mock accepts system messages only before the first user message "
                              "(on NIM a later system message displaces the first)", param=w)
            system_parts.append(_openai_content(m.get("content"), f"{w}.content", None))
            continue
        if role not in ("user", "assistant"):
            raise invalid(f"{w}.role: must be one of system, developer, user, assistant", param=w)
        if m.get("content") is None:
            raise invalid(f"{w}.content: required", param=w)
        before = len(images)
        text = _openai_content(m["content"], f"{w}.content", images if role == "user" else None)
        if not text.strip() and len(images) == before:
            raise invalid(f"{w}: content must be non-empty", param=w)
        turns.append((role, text))
    if not turns:
        raise invalid("messages: at least one user message is required", param="messages")
    if turns[-1][0] != "user":
        raise invalid("the final message must have role `user`: the mock cannot continue an assistant "
                      "prefill", param="messages")
    if len(images) > MAX_IMAGES:
        raise invalid(f"at most {MAX_IMAGES} images per request", param="messages")

    schema = None
    rf = body.get("response_format")
    if rf is not None:
        if not isinstance(rf, dict) or rf.get("type") != "json_schema":
            raise invalid("response_format.type: the mock supports only `json_schema` (structured output is "
                          "enforced or the call fails)", param="response_format")
        js = rf.get("json_schema")
        if not isinstance(js, dict):
            raise invalid("response_format.json_schema: required", param="response_format")
        name = js.get("name")
        if not isinstance(name, str) or not name:
            raise invalid("response_format.json_schema.name: required", param="response_format")
        schema = js.get("schema")
        if not isinstance(schema, dict):
            raise invalid("response_format.json_schema.schema: required", param="response_format")

    system = "\n\n".join(system_parts) if system_parts else None
    return ModelCall(model=model, alias=alias, turns=turns, system=system, schema=schema,
                     max_tokens=body.get("max_completion_tokens") or body.get("max_tokens"), images=images,
                     ignored=sorted(k for k in body if k in O_IGNORED))


def to_openai(envelope: dict, call: ModelCall) -> dict:
    text = reply_text(envelope, call)
    i, o = usage_of(envelope)
    cut = cut_off(text, envelope, call)
    return {"id": "chatcmpl-" + _rand(), "object": "chat.completion", "created": int(time.time()),
            "model": call.model,
            "choices": [{"index": 0, "message": {"role": "assistant", "content": text if cut is None else cut,
                                                 "refusal": None},
                         "finish_reason": "stop" if cut is None else "length", "logprobs": None}],
            "usage": {"prompt_tokens": i, "completion_tokens": o, "total_tokens": i + o}}


# ------------------------------------------------------------------ Anthropic streaming (SSE)


def sse_events(msg: dict) -> list:
    """A finished Anthropic message as the Messages API's SSE sequence: message_start, one text
    content block (start, one text_delta, stop), message_delta with stop_reason and usage, then
    message_stop. The CLI answers whole, so the text arrives as one delta once the run is done; the
    framing, order and fields are the API's, so a streaming client's handling is exercised as it is
    against the API."""
    i, o = msg["usage"]["input_tokens"], msg["usage"]["output_tokens"]
    start = {**msg, "content": [], "stop_reason": None, "stop_sequence": None,
             "usage": {**msg["usage"], "output_tokens": 0}}
    text = msg["content"][0]["text"] if msg["content"] else ""
    return [
        ("message_start", {"type": "message_start", "message": start}),
        ("content_block_start", {"type": "content_block_start", "index": 0,
                                 "content_block": {"type": "text", "text": ""}}),
        ("ping", {"type": "ping"}),
        ("content_block_delta", {"type": "content_block_delta", "index": 0,
                                 "delta": {"type": "text_delta", "text": text}}),
        ("content_block_stop", {"type": "content_block_stop", "index": 0}),
        ("message_delta", {"type": "message_delta",
                           "delta": {"stop_reason": msg["stop_reason"], "stop_sequence": None},
                           "usage": {"input_tokens": i, "output_tokens": o,
                                     "cache_creation_input_tokens": 0, "cache_read_input_tokens": 0}}),
        ("message_stop", {"type": "message_stop"}),
    ]


# ------------------------------------------------------------------ Wire A on Bedrock — InvokeModel

BEDROCK_VERSION = "bedrock-2023-05-31"
BEDROCK_PATH = re.compile(r"^/model/(?P<id>[^/]+)/(?P<op>invoke|invoke-with-response-stream|converse|converse-stream)$")
# Bedrock's own error names (the x-amzn-ErrorType header) and statuses. Auth is 403 and a model
# timeout 408 there, as on AWS.
_BEDROCK_ERRORS = {400: (400, "ValidationException"), 401: (403, "AccessDeniedException"),
                   403: (403, "AccessDeniedException"), 404: (404, "ResourceNotFoundException"),
                   405: (405, "ValidationException"), 411: (411, "ValidationException"),
                   413: (413, "ValidationException"), 429: (429, "ThrottlingException"),
                   500: (500, "InternalServerException"), 503: (503, "ServiceUnavailableException"),
                   504: (408, "ModelTimeoutException"), 529: (503, "ServiceUnavailableException")}


def bedrock_error(e: WireError) -> Response:
    status, name = _BEDROCK_ERRORS.get(e.status, (500, "InternalServerException"))
    return Response(status, {"message": e.message}, {"x-amzn-ErrorType": f"{name}:http://internal.amazon.com/coral/"
                                                                         "com.amazon.bedrock/"},
                    close=status in (404, 411, 413))


def build_bedrock(model_id: str, op: str, body: dict) -> ModelCall:
    """InvokeModel with an Anthropic body: the model is in the path, `anthropic_version` must be
    bedrock-2023-05-31, `anthropic_beta` is accepted and ignored; the rest is the Messages body."""
    if op.startswith("converse"):
        raise WireError(404, "not_found_error", "the mock serves InvokeModel with an Anthropic body, not Converse "
                        "(Nova research locally goes to the research port, NAPKIN_RESEARCH_URL)")
    if op == "invoke-with-response-stream":
        raise invalid("the mock does not serve InvokeModelWithResponseStream (AWS event-stream framing); "
                      "use invoke, or `stream: true` on the Anthropic wire (/v1/messages)")
    if body.get("anthropic_version") != BEDROCK_VERSION:
        raise invalid(f"anthropic_version: must be {BEDROCK_VERSION!r} on Bedrock")
    for k in ("model", "stream"):
        if k in body:
            raise invalid(f"{k}: Extra inputs are not permitted (on Bedrock the model is in the path)")
    beta = body.get("anthropic_beta")
    if beta is not None and not (isinstance(beta, list) and all(isinstance(b, str) for b in beta)):
        raise invalid("anthropic_beta: Input should be a list of strings")
    rest = {k: v for k, v in body.items() if k not in ("anthropic_version", "anthropic_beta")}
    return build_anthropic({**rest, "model": model_id})


# ------------------------------------------------------------------ handler


def list_models(anthropic_shape: bool) -> dict:
    ids = list(MODELS)
    if anthropic_shape:
        data = [{"type": "model", "id": m, "display_name": m, "created_at": "2026-01-01T00:00:00Z"} for m in ids]
        return {"data": data, "has_more": False, "first_id": ids[0] if ids else None,
                "last_id": ids[-1] if ids else None}
    return {"object": "list", "data": [{"id": m, "object": "model", "created": 0,
                                        "owned_by": "napkin-mock-backend"} for m in ids]}


def authorised(cfg: Config, req: Request, wire: str) -> bool:
    """With MOCK_TOKEN unset, any credentials pass (a dummy key, a Bedrock bearer token or a SigV4
    signature: none is checked). With it set, the wire's own header must carry it."""
    if not cfg.token:
        return True
    auth = req.header("authorization") or ""
    if auth == f"Bearer {cfg.token}":
        return True
    return wire == "anthropic" and req.header("x-api-key") == cfg.token


def wire_of(req: Request) -> tuple[str, str]:
    """(wire, path) for a model-family request: `anthropic`, `bedrock` or `openai`, and the path with
    the mantle prefix (/anthropic) removed."""
    path = req.path.rstrip("/")
    if path.startswith("/anthropic/"):
        path = path[len("/anthropic"):]
    if path == "/v1/messages" or (path == "/v1/models" and req.header("anthropic-version")):
        return "anthropic", path
    if path.startswith("/model/"):
        return "bedrock", path
    return "openai", path


def handle(cfg: Config, slots: Slots, req: Request) -> Response:
    wire, path = wire_of(req)
    render = {"anthropic": WireError.anthropic, "openai": WireError.openai, "bedrock": bedrock_error}[wire]
    try:
        if not authorised(cfg, req, wire):
            raise WireError(401, "authentication_error", "invalid x-api-key" if wire != "openai"
                            else "Incorrect API key provided")
        if path == "/v1/models":
            if req.method != "GET":
                raise WireError(405, "invalid_request_error", f"use GET for {path}")
            return Response(200, list_models(wire == "anthropic"))
        if req.method != "POST":
            raise WireError(405, "invalid_request_error", f"use POST for {path}")
        if wire == "bedrock":
            m = BEDROCK_PATH.match(path)
            if not m:
                raise WireError(404, "not_found_error", f"no route {path}")
            call = build_bedrock(unquote(m.group("id")), m.group("op"), parse_body(req.body))
        else:
            body = parse_body(req.body)
            call = build_anthropic(body) if wire == "anthropic" else build_openai(body)
        if not slots.acquire(cfg.queue_timeout_for("model")):
            raise WireError(529, "overloaded_error",
                            f"all {slots.n} claude slots busy (MOCK_CONCURRENCY); try again")
        try:
            envelope = run_claude(cfg, call.claude(cfg), cfg.timeout["model"], cfg.data / "work")
        except ClaudeFailure as f:
            if f.kind == "timeout":
                raise WireError(504, "api_error", f"{f.message} (MOCK_TIMEOUT_MODEL)") from None
            raise WireError(500, "api_error", f.message) from None
        finally:
            slots.release()
        note = f"wire={wire} model={call.model} images={len(call.images)}" + (" stream" if call.stream else "")
        if wire == "openai":
            return Response(200, to_openai(envelope, call), note=note)
        msg = to_anthropic(envelope, call)
        if call.stream:
            return Response(200, {}, note=note, events=sse_events(msg))
        return Response(200, msg, note=note)
    except WireError as e:
        return render(e)
