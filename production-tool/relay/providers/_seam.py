"""The seam between the relay and the harness adapters.

The relay speaks providers/base.py: `submit(providerJob dict) -> request id`,
`status(id) -> base.Status`, base.ProviderError. The harness adapters (runway,
fal, heygen, mock) speak providers/types.py: `submit(ProviderJob)`, a
types.Status of ProviderOutputs, types.ProviderError. `Adapted` wraps one
adapter so the relay can use it; it changes nothing about the request the
adapter builds.

  in    providerJob dict + the op the relay set (base.job_op) -> types.ProviderJob
  urls  the adapter's AssetResolver reads the relay's per-job asset map
        (base.asset_url / asset_mime), and remembers it for status() calls
  out   types.Status -> base.Status (done -> succeeded, a failed status whose
        error is "moderated" -> moderated, ProviderOutput -> {url, mime, w, h,
        durationS}; inline bytes become a data: URL the relay's fetch reads)
  err   types.CapabilityMissing -> base.CapabilityMissing; a types.ProviderError
        "moderated" -> base.Moderated, else base.ProviderError with the same
        code. accepted=True only when the request may have reached the
        provider (a timeout or a dropped connection after sending), so the
        relay does not route a job twice.
"""

from __future__ import annotations

import base64
import io
import os

import httpx

from providers import base, types

_SENT_MAYBE = (httpx.ReadTimeout, httpx.WriteTimeout, httpx.ReadError, httpx.WriteError,
               httpx.RemoteProtocolError)


# Set by relay/local.py: url -> bytes for assets on the local dev server. Never set on Lambda.
LOCAL_READER = None


class Resolver:
    """types.AssetResolver over the relay's per-job asset map. A status() call
    runs outside the job's context (the mock reads its input then), so every
    asset seen at submit is remembered for the life of the process."""

    def __init__(self):
        self._seen: dict[str, types.AssetRef] = {}

    def __call__(self, sha256: str) -> types.AssetRef:
        try:
            url = base.asset_url(sha256)
        except base.ProviderError:
            if sha256 in self._seen:
                return self._seen[sha256]
            # The relay names every asset a job uses: a missing one is our bug, not the participant's.
            raise types.ProviderError("internal", f"no URL for asset {sha256}", False, source="napkin") from None
        mime = base.asset_mime(sha256) or _guess_mime(url)
        if LOCAL_READER is not None and url.startswith("http://"):
            # Local dev only (relay/local.py): providers can't reach http://localhost,
            # so send the bytes inline. Runway takes images up to 5 MB as data URIs.
            data, mime = inline_bytes(LOCAL_READER(url), mime)
            url = f"data:{mime};base64," + base64.b64encode(data).decode()
        ref = types.AssetRef(sha256=sha256, url=url, mime=mime)
        self._seen[sha256] = ref
        return ref


# A picture inline above this goes as a JPEG: nine 1.5 MB PNGs made a 19 MB request that
# did not reach fal within its timeout (2026-10-09). Masks are small and stay exact PNGs.
INLINE_MAX = 400_000


def inline_bytes(data: bytes, mime: str) -> tuple[bytes, str]:
    """The bytes to send inline: a large PNG or WebP as a JPEG (quality 90, on white where it is
    transparent), anything else as it is."""
    if len(data) <= INLINE_MAX or mime not in ("image/png", "image/webp"):
        return data, mime
    try:
        from PIL import Image
        img = Image.open(io.BytesIO(data))
        if img.mode in ("RGBA", "LA", "P"):
            img = img.convert("RGBA")
            flat = Image.new("RGB", img.size, (255, 255, 255))
            flat.paste(img, mask=img.split()[-1])
            img = flat
        out = io.BytesIO()
        img.convert("RGB").save(out, format="JPEG", quality=90)
        return (out.getvalue(), "image/jpeg") if out.tell() < len(data) else (data, mime)
    except Exception:  # not a picture PIL reads: send it as it is
        return data, mime


def _guess_mime(url: str) -> str:
    path = url.split("?", 1)[0].lower()
    for ext, mime in ((".mp4", "video/mp4"), (".jpg", "image/jpeg"), (".jpeg", "image/jpeg"),
                      (".webp", "image/webp"), (".png", "image/png")):
        if path.endswith(ext):
            return mime
    return "image/png"


def _error(e: types.ProviderError, *, accepted: bool = False) -> base.ProviderError:
    code = e.code if e.code in base.ERROR_CODES else "provider_failed"
    if code == "moderated":
        out = base.Moderated(e.message, provider_code=e.provider_code)
        out.source = e.source
        return out
    return base.ProviderError(code, e.message, provider_code=e.provider_code, retryable=e.retryable,
                              accepted=accepted or e.accepted, source=e.source)


def _output(o: types.ProviderOutput) -> dict:
    url = o.url
    if o.data is not None and not url.startswith(("https://", "http://")):
        url = f"data:{o.mime};base64," + base64.b64encode(o.data).decode()
    out = {"url": url, "mime": o.mime}
    if o.w is not None:
        out["w"] = o.w
    if o.h is not None:
        out["h"] = o.h
    if o.duration_s is not None:
        out["durationS"] = o.duration_s
    return out


def to_status(st: types.Status) -> base.Status:
    if st.state == "done":
        return base.Status("succeeded", queue_position=st.queue_position,
                           outputs=[_output(o) for o in st.outputs], cost_usd=st.cost_usd)
    if st.state == "failed":
        err = st.error or types.ProviderError("provider_failed", "the provider failed the job", False)
        moderated = err.code == "moderated"
        return base.Status("moderated" if moderated else "failed",
                           error_code=err.code if err.code in base.ERROR_CODES else "provider_failed",
                           error_message=err.message, provider_code=err.provider_code, cost_usd=st.cost_usd,
                           retryable=err.retryable, source=err.source)
    return base.Status(st.state, queue_position=st.queue_position, cost_usd=st.cost_usd)


class Adapted:
    """A harness adapter seen through the relay's Protocol (providers/base.py)."""

    def __init__(self, inner):
        self.inner = inner
        self.name = inner.name

    def capabilities(self) -> dict:
        return self.inner.capabilities()

    def submit(self, job: dict) -> str:
        op = base.job_op()
        if not op:
            raise base.ProviderError("internal", "the relay set no op for this provider job")
        try:
            return self.inner.submit(types.ProviderJob.from_director(op, job))
        except types.CapabilityMissing as e:
            raise base.CapabilityMissing(str(e)) from e
        except types.ProviderError as e:
            # A read or write that broke mid-call to the provider may have reached it; the same
            # error while reading our own asset (source napkin) did not.
            sent = e.source == "network" and isinstance(e.__cause__, _SENT_MAYBE)
            raise _error(e, accepted=sent) from e

    def status(self, request_id: str) -> base.Status:
        try:
            return to_status(self.inner.status(request_id))
        except types.ProviderError as e:
            raise _error(e) from e

    def cancel(self, request_id: str) -> None:
        try:
            self.inner.cancel(request_id)
        except types.ProviderError as e:
            raise _error(e) from e


def key(var: str) -> str:
    """A provider key from the environment (on Lambda, loaded from Secrets
    Manager at cold start). Missing: the adapter is not registered."""
    value = os.environ.get(var, "").strip()
    if not value:
        raise RuntimeError(f"{var} is not set")
    return value


def fetch(url: str) -> bytes:
    """What the mock reads its input with."""
    from blobs import http_fetch
    return http_fetch(url)
