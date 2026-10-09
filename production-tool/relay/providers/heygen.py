"""HeyGen adapter: heygen-video-1 clips over raw httpx (docs/production-tool/providers.md).

Two modes on POST /v3/models/videos: image_to_video (the first frame) and
reference_to_video (up to 9 refs named <Picture n> in the prompt). Resolution is
pinned to 768p, because 2k bills three times as much.

HeyGen has no audio switch (clips always carry generated sound) and no cancel
endpoint was found in its docs, so both are recorded here rather than faked.
"""

from __future__ import annotations

import hashlib
from typing import Optional

import httpx

from .types import (
    AssetResolver, CapabilityMissing, ProviderError, ProviderJob, ProviderOutput,
    Status, check_capabilities, load_sheet, nearest_ratio, video_audio,
)
from .tags import UnknownTag, rewrite_tags, unsent_in_words

BASE = "https://api.heygen.com"
MODEL = "heygen-video-1"
RESOLUTION = "768p"  # never 2k: it bills 3x
MAX_PROMPT = 5000
# reference_to_video aspect_ratio enum (developers.heygen.com/reference/create-heygen-video, 2026-10-07).
REFERENCE_RATIOS = ("9:16", "16:9", "1:1", "3:4", "4:3", "21:9")
BASE64_MAX = 5 * 1024 * 1024

STATES = {"pending": "queued", "processing": "running", "completed": "done",
          "failed": "failed", "cancelled": "cancelled"}


def idempotency_key(job: ProviderJob) -> str:
    """Same job content, same key (1-255 chars of [A-Za-z0-9_:.-], valid for 24 h)."""
    parts = [job.op, job.model, job.prompt, *[r.sha256 for r in job.refs],
             job.first_frame or "", str(job.duration_s), str(job.seed), str(job.ratio), RESOLUTION]
    return "napkin:" + hashlib.sha256("\n".join(parts).encode()).hexdigest()


def _body(response: httpx.Response) -> dict:
    try:
        body = response.json()
    except ValueError:
        return {}
    return body if isinstance(body, dict) else {}


def _video_id(response: httpx.Response) -> str:
    video_id = (_body(response).get("data") or {}).get("video_id")
    if not video_id:  # a 2xx: HeyGen has the clip, so it must never be sent anywhere else
        raise ProviderError("provider_failed", "HeyGen accepted the job but sent no video_id", False,
                            provider_code=str(response.status_code), accepted=True)
    return video_id


def _moderated(code: object, message: str) -> bool:
    """HeyGen documents only generation_failed and generation_cancelled as failure codes, so
    its moderation signal is unknown: match likely spellings. A miss stays provider_failed,
    which is never retried either."""
    text = f"{code or ''} {message}".lower()
    return any(word in text for word in ("content_policy", "moderat", "safety"))


def _message(body: dict, default: str) -> str:
    error = body.get("error")
    if isinstance(error, dict) and error.get("message"):
        return str(error["message"])
    return default


def _retry_after(response: httpx.Response) -> Optional[int]:
    try:
        return max(0, int(float(response.headers["Retry-After"])))
    except (KeyError, ValueError):
        return None


# No alternates: this provider runs only its sheet's own model per op (features/model-choice.clan).
ALTERNATES: dict[str, set[str]] = {}


class HeyGenProvider:
    name = "heygen"

    def __init__(self, api_key: str, assets: AssetResolver, client: Optional[httpx.Client] = None,
                 sheet: Optional[dict] = None):
        self._assets, self._sheet = assets, sheet or load_sheet("heygen")
        self._client = client or httpx.Client(timeout=30)
        self._headers = {"X-Api-Key": api_key}
        self._cancelled: set[str] = set()
        self.requests: list[dict] = []  # the request each submit sent

    def capabilities(self) -> dict:
        return self._sheet

    def _request_body(self, job: ProviderJob) -> dict:
        if job.first_frame:
            mode = "image_to_video"
        elif job.refs:
            mode = "reference_to_video"
        else:
            raise CapabilityMissing("heygen clip needs a first frame or at least one ref")
        if job.duration_s is not None and job.duration_s != int(job.duration_s):
            raise CapabilityMissing("heygen clip duration must be a whole number of seconds")
        try:
            names = [r.name for r in job.refs]
            prompt = rewrite_tags(unsent_in_words(job.prompt, names), names, self._sheet["tagSyntax"])
        except UnknownTag as exc:
            raise ProviderError("invalid_input", str(exc)) from exc
        if len(prompt) > MAX_PROMPT:
            raise ProviderError("invalid_input", f"prompt is {len(prompt)} characters; HeyGen takes {MAX_PROMPT}")
        body: dict = {"model": MODEL, "mode": mode, "prompt": prompt, "resolution": RESOLUTION,
                      "prompt_enhancement": "disabled"}
        if mode == "image_to_video":
            body["image"] = self._image(job.first_frame)
            body["aspect_ratio"] = None  # the image sets it; HeyGen wants it null
        else:
            body["reference_images"] = [self._image(r.sha256) for r in job.refs]
            if job.ratio:
                body["aspect_ratio"] = nearest_ratio(job.ratio, REFERENCE_RATIOS)
        if job.duration_s is not None:
            body["duration"] = int(job.duration_s)
        if job.seed is not None:
            body["seed"] = job.seed
        return body

    def _image(self, sha: str) -> dict:
        """An image as HeyGen takes it: a public HTTPS URL, or inline base64. The local relay sends
        data URIs, and HeyGen's url field must be a public HTTPS URL; base64 is capped at 5 MB."""
        ref = self._assets(sha)
        if not ref.url.startswith("data:"):
            return {"type": "url", "url": ref.url}
        head, _, data = ref.url.partition(",")
        if len(data) * 3 // 4 > BASE64_MAX:
            raise ProviderError("invalid_input", "an image is over HeyGen's 5 MB inline limit", False)
        return {"type": "base64", "media_type": head[5:].split(";")[0] or ref.mime, "data": data}

    def _call(self, method: str, url: str, **kw) -> httpx.Response:
        try:
            return self._client.request(method, url, **kw)
        except httpx.TransportError as exc:
            raise ProviderError("provider_unavailable", f"HeyGen could not be reached: {exc}", True, 5,
                                "transport_error", source="network") from exc

    def submit(self, job: ProviderJob) -> str:
        check_capabilities(self._sheet, job)
        body = self._request_body(job)
        key = idempotency_key(job)
        self.requests.append({
            "op": job.op, "model": MODEL, "body": body, "idempotencyKey": key,
            "audio": video_audio(job),  # the contract value; HeyGen has no such field
            "audioSent": False,         # clips always carry sound, so nothing is sent
        })
        response = self._call("POST", f"{BASE}/v3/models/videos", json=body,
                              headers={**self._headers, "Idempotency-Key": key})
        if response.status_code == 409:
            # The same job is already running: carry on with its id when HeyGen names it.
            video_id = (_body(response).get("data") or {}).get("video_id")
            if video_id:
                return video_id
        self._raise_for_status(response)
        return _video_id(response)

    def status(self, request_id: str) -> Status:
        if request_id in self._cancelled:
            return Status("cancelled")
        response = self._call("GET", f"{BASE}/v3/models/videos/{request_id}", headers=self._headers)
        try:
            self._raise_for_status(response)
        except ProviderError as exc:
            if exc.retryable:  # 429, 5xx: the relay asks again
                raise
            if response.status_code in (400, 404, 422):  # our video id or route, not the participant's input
                exc = ProviderError("internal", exc.message, False, provider_code=exc.provider_code, source="napkin")
            return Status("failed", error=exc)  # asking again cannot help
        data = _body(response).get("data") or {}
        if data.get("status") is None:  # an empty or partial reply: ask again
            raise ProviderError("provider_unavailable", "HeyGen's reply has no status", True, 5)
        state = STATES.get(data.get("status"))
        if state is None:
            return Status("failed", error=ProviderError(
                "provider_failed", f"unknown HeyGen status {data.get('status')!r}"))
        if state == "done":
            if not data.get("video_url"):
                return Status("failed", error=ProviderError(
                    "provider_failed", "HeyGen finished the clip but sent no video_url", False))
            output = ProviderOutput(url=data["video_url"], mime="video/mp4", w=data.get("width"),
                                    h=data.get("height"), duration_s=data.get("duration"))
            return Status("done", outputs=[output])
        if state == "failed":
            code = data.get("failure_code")
            message = data.get("failure_message") or "HeyGen could not make the clip"
            if _moderated(code, message):  # never retried
                return Status("failed", error=ProviderError("moderated", message, False, provider_code=code))
            return Status("failed", error=ProviderError("provider_failed", message, False, provider_code=code))
        return Status(state)

    def cancel(self, request_id: str) -> None:
        """HeyGen documents no cancel endpoint, so the clip still runs and bills. We only
        stop reporting it: status() answers `cancelled` and the relay drops the result."""
        self._cancelled.add(request_id)

    def _raise_for_status(self, response: httpx.Response) -> None:
        code = response.status_code
        if code < 400:
            return
        message = _message(_body(response), f"HeyGen answered {code}")
        if code == 402:
            raise ProviderError("provider_failed", f"HeyGen credit is exhausted: {message}", False, provider_code="402")
        if code == 409:  # HeyGen is already making this clip: sending it elsewhere would pay twice
            raise ProviderError("provider_failed", f"the same clip is already in progress at HeyGen: {message}",
                                False, provider_code="409", accepted=True)
        if code == 429:
            raise ProviderError("provider_unavailable", message, True, _retry_after(response) or 5, "429")
        if code >= 500:
            raise ProviderError("provider_unavailable", message, True, _retry_after(response), str(code))
        if code in (401, 403):
            raise ProviderError("provider_failed", f"HeyGen refused the key: {message}", False, provider_code=str(code))
        raise ProviderError("invalid_input" if code in (400, 404, 422) else "provider_failed",
                            message, False, provider_code=str(code))


def make():
    """The relay's registry entry (providers/__init__.py): this adapter behind the relay's Protocol."""
    from ._seam import Adapted, Resolver, key
    return Adapted(HeyGenProvider(key("HEYGEN_API_KEY"), Resolver()))
