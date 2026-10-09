"""The adapter interface every provider implements (production-tool/contracts/README.md).

The relay owns the ledger, quotas, queue, spend stop and the S3 copy of outputs.
An adapter owns the exact request: field names, mask polarity, explicit audio,
and mapping the provider's errors onto ours.

Writing an adapter (harness lane): add `providers/<name>.py` with a function
`make() -> Provider`. The registry (providers/__init__.py) imports it and pairs
it with `contracts/capabilities/<name>.json`. Keys come from environment
variables (RUNWAY_API_KEY, FAL_KEY, HEYGEN_API_KEY); on Lambda the relay loads
them from Secrets Manager into the environment at cold start.

Asset URLs: a provider job names assets by sha256 only. Call `asset_url(sha)`
inside `submit` to get the HTTPS URL the provider should read (the relay sets
the mapping from the job's assetRefs before it calls `submit`).
"""

from __future__ import annotations

import contextvars
from dataclasses import dataclass, field
from typing import Literal, Protocol, runtime_checkable

ERROR_CODES = {
    "invalid_input", "unauthorised", "blocked", "flag_off", "quota_exhausted", "spend_stop",
    "queue_full", "capability_missing", "moderated", "provider_failed", "provider_unavailable",
    "timeout", "uncertain", "internal",
}


class ProviderError(Exception):
    """A failure the provider reported, mapped onto a contract error code.

    accepted=False means the provider certainly did not take the job (a 4xx on
    submit, a refused connection): the relay may route it to the next provider.
    retryable is what the participant sees.
    """

    def __init__(self, code: str, message: str, *, provider_code: str | None = None,
                 retryable: bool = False, accepted: bool = False, source: str | None = None,
                 retry_after_s: int | None = None):
        if code not in ERROR_CODES:
            raise ValueError(f"unknown error code {code!r}")
        super().__init__(message)
        self.code = code
        self.message = message
        self.provider_code = provider_code
        self.retryable = retryable
        self.accepted = accepted
        self.source = source  # provider | network | napkin | input (providers/types.py SOURCES)
        self.retry_after_s = retry_after_s  # the provider's Retry-After on a 429, when it sent one


class CapabilityMissing(ProviderError):
    """The capability sheet rules the job out. Raised before anything is sent."""

    def __init__(self, message: str, *, provider_code: str | None = None):
        super().__init__("capability_missing", message, provider_code=provider_code)


class Moderated(ProviderError):
    """The provider refused the content (Runway SAFETY.INPUT.*, fal
    content_policy_violation). Never retried, never routed elsewhere."""

    def __init__(self, message: str = "The provider refused this content.", *,
                 provider_code: str | None = None):
        super().__init__("moderated", message, provider_code=provider_code)


StatusState = Literal["queued", "running", "succeeded", "failed", "moderated", "cancelled"]


@dataclass
class Status:
    """What `status(request_id)` returns.

    outputs: one dict per result, {"url": provider URL, "mime": "image/png", and
    optionally "w", "h", "durationS"}. The relay downloads, hashes and copies
    each to S3 before the job is completed; the provider URL is never handed out.
    """

    state: StatusState
    queue_position: int | None = None
    outputs: list[dict] = field(default_factory=list)
    error_code: str | None = None          # a contract error code when failed
    error_message: str | None = None
    provider_code: str | None = None
    cost_usd: float | None = None           # confirmed cost, when the provider reports it
    retryable: bool | None = None           # failed only: whether trying again can help
    source: str | None = None               # failed only: provider | network | napkin | input


@runtime_checkable
class Provider(Protocol):
    name: str  # mock | runway | fal | heygen

    def capabilities(self) -> dict:
        """contracts/capabilities/<name>.json"""
        ...

    def submit(self, job: dict) -> str:
        """Send a providerJob (director.schema.json#/$defs/providerJob) and return
        the provider's request id. Raise CapabilityMissing if the sheet rules it
        out, Moderated on a content refusal, ProviderError otherwise. Never wait
        for the result here."""
        ...

    def status(self, request_id: str) -> Status: ...

    def cancel(self, request_id: str) -> None: ...


_asset_urls: contextvars.ContextVar[dict[str, str]] = contextvars.ContextVar("asset_urls", default={})
_asset_mimes: contextvars.ContextVar[dict[str, str]] = contextvars.ContextVar("asset_mimes", default={})
_job_op: contextvars.ContextVar[str | None] = contextvars.ContextVar("job_op", default=None)


def asset_url(sha256: str) -> str:
    """The HTTPS URL of an asset named in the current provider job."""
    try:
        return _asset_urls.get()[sha256]
    except KeyError:
        raise ProviderError("invalid_input", f"no URL for asset {sha256}") from None


def set_asset_urls(mapping: dict[str, str]) -> contextvars.Token:
    return _asset_urls.set(dict(mapping))


def asset_mime(sha256: str) -> str | None:
    """The MIME type of an asset named in the current provider job, when known."""
    return _asset_mimes.get().get(sha256)


def job_op() -> str | None:
    """The op of the job being submitted (a providerJob carries none, yet an
    adapter picks its endpoint by it). Set by the relay with set_job_context."""
    return _job_op.get()


def set_job_context(op: str, assets: list[dict]) -> None:
    """Before `submit`: the job's op and its assetRefs ({sha256, url, mime})."""
    _job_op.set(op)
    _asset_urls.set({a["sha256"]: a["url"] for a in assets})
    _asset_mimes.set({a["sha256"]: a["mime"] for a in assets if a.get("mime")})
