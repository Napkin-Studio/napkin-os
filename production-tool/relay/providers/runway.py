"""Runway adapter, over raw httpx (docs/production-tool/providers.md, capabilities/runway.json).

Images go to text_to_image (gemini_image3.1_flash, gemini_image3_pro for region edits),
clips to image_to_video (veo3.1_fast) and clip edits to video_to_video (aleph2).
Runway has no mask: a region edit sends the clean image and a copy with the box drawn
on it, and the region package pastes the original back outside the box.

submit() never waits and status() makes one call. The key is a constructor argument;
this module never reads the environment.
"""

from __future__ import annotations

import dataclasses
from typing import Optional

import httpx

from .types import (
    VIDEO_OPS, AssetResolver, CapabilityMissing, ProviderError, ProviderJob,
    ProviderOutput, Status, check_capabilities, load_sheet, video_audio,
)
from .tags import UnknownTag, rewrite_tags

BASE_URL = "https://api.dev.runwayml.com"
VERSION = "2024-11-06"
MIN_POLL_S = 5  # sheet results.minPollS
USD_PER_CREDIT = 0.01

MAX_PROMPT = {"image": 5500, "clip": 1000, "clip_edit": 1000}
MAX_HUMAN, MAX_OBJECT = 5, 9
MAX_SEED = 4294967295

STATES = {"PENDING": "queued", "THROTTLED": "queued", "RUNNING": "running", "SUCCEEDED": "done",
          "FAILED": "failed", "CANCELLED": "cancelled", "CANCELED": "cancelled"}
MIME = {".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp",
        ".mp4": "video/mp4"}

REGION_PROMPT = ("@{current} is the clean image. @{marked} is the same image with a box drawn on it. "
                 "Change only what is inside the box, keep everything outside it identical, "
                 "and draw no box in the result. ")


def min_poll_s() -> int:
    return MIN_POLL_S


def failure(code: Optional[str], message: str) -> tuple[ProviderError, bool]:
    """Map a task failureCode onto our error. The flag says the task was moderated."""
    code = code or ""
    if code.startswith("SAFETY.") or code == "INPUT_PREPROCESSING.SAFETY.TEXT":
        return ProviderError("moderated", message, False, provider_code=code), True
    if code == "ASSET.INVALID":
        return ProviderError("invalid_input", message, False, provider_code=code), False
    if code == "THIRD_PARTY.UNAVAILABLE":
        return ProviderError("provider_unavailable", message, True, provider_code=code), False
    if code.startswith("INTERNAL.BAD_OUTPUT."):  # retrying the same prompt and inputs fails the same way
        return ProviderError("provider_failed", message, False, provider_code=code), False
    if code == "INTERNAL" or code.startswith(("INTERNAL.", "INPUT_PREPROCESSING.INTERNAL")) or not code:
        return ProviderError("provider_failed", message, True, provider_code=code or None), False
    return ProviderError("provider_failed", message, False, provider_code=code), False


def _http_error(resp: httpx.Response) -> ProviderError:
    try:
        body = resp.json()
    except ValueError:
        body = {}
    detail = body.get("error") if isinstance(body, dict) else None
    issues = body.get("issues") if isinstance(body, dict) else None
    if issues:
        detail = f"{detail}: " + "; ".join(f"{'.'.join(map(str, i.get('path', [])))} {i.get('message', '')}".strip()
                                           for i in issues)
    message = f"Runway answered {resp.status_code}" + (f": {detail}" if detail else "")
    if resp.status_code == 429:
        try:
            after = int(resp.headers["Retry-After"])
        except (KeyError, ValueError):
            after = None
        return ProviderError("provider_unavailable", message, True, retry_after_s=after)
    if resp.status_code >= 500:
        return ProviderError("provider_unavailable", message, True)
    if resp.status_code in (401, 403):  # the account's key: the relay decides what to do about it
        return ProviderError("provider_failed", message, False, provider_code=str(resp.status_code))
    if resp.status_code in (404, 405):  # our route or task id: a Napkin bug, not the participant's input
        return ProviderError("provider_failed", message, False, provider_code=str(resp.status_code), source="napkin")
    return ProviderError("invalid_input", message, False)


# No alternates: this provider runs only its sheet's own model per op (features/model-choice.clan).
ALTERNATES: dict[str, set[str]] = {}


class RunwayProvider:
    name = "runway"

    def __init__(self, api_key: str, assets: AssetResolver, client: Optional[httpx.Client] = None,
                 sheet: Optional[dict] = None):
        self._key, self._assets = api_key, assets
        self._client = client or httpx.Client(timeout=30)
        self._sheet = sheet or load_sheet("runway")

    def capabilities(self) -> dict:
        return self._sheet

    def _call(self, method: str, path: str, **kw) -> httpx.Response:
        headers = {"Authorization": f"Bearer {self._key}", "X-Runway-Version": VERSION}
        try:
            return self._client.request(method, BASE_URL + path, headers=headers, **kw)
        except httpx.TransportError as exc:
            raise ProviderError("provider_unavailable", f"Runway could not be reached: {exc}", True,
                                source="network") from exc

    def _ok(self, resp: httpx.Response) -> dict:
        if resp.status_code >= 300:
            raise _http_error(resp)
        try:
            body = resp.json()
        except ValueError as exc:
            raise ProviderError("provider_unavailable", "Runway sent a reply that is not JSON", True) from exc
        if not isinstance(body, dict):
            raise ProviderError("provider_failed", "Runway sent a reply that is not a JSON object", True)
        return body

    # Building the request

    def _tagged(self, names: list[str], prompt: str) -> str:
        try:
            return rewrite_tags(prompt, names, self._sheet["tagSyntax"])
        except UnknownTag as exc:
            raise ProviderError("invalid_input", str(exc), False) from exc

    def _check(self, job: ProviderJob, kind: str, prompt: str) -> None:
        # The sheet's seed flag is false for the image models; both video models take one.
        check_capabilities(self._sheet, dataclasses.replace(job, seed=None) if job.op in VIDEO_OPS else job)
        if len(prompt) > MAX_PROMPT[kind]:
            raise CapabilityMissing(f"{job.op} prompt is at most {MAX_PROMPT[kind]} characters")
        if job.op in VIDEO_OPS and job.seed is not None and not 0 <= job.seed <= MAX_SEED:
            raise CapabilityMissing(f"seed must be 0-{MAX_SEED}")

    def _image(self, job: ProviderJob) -> tuple[str, dict]:
        refs = list(job.refs)
        prompt = job.prompt
        if job.op == "region_edit":
            by_role = {r.role: r for r in refs}
            if "current" not in by_role or "marked" not in by_role:
                raise CapabilityMissing("region_edit needs a 'current' and a 'marked' ref")
            current, marked = by_role["current"], by_role["marked"]
            refs = [current, marked] + [r for r in refs if r is not current and r is not marked]
            prompt = REGION_PROMPT.format(current=current.name, marked=marked.name) + prompt
        self._check(job, "image", prompt)
        if sum(r.role != "character" for r in refs) > MAX_OBJECT:
            raise CapabilityMissing(f"{self.name} takes at most {MAX_OBJECT} object refs")
        if job.outputs not in (None, 1, 4):
            raise CapabilityMissing("Runway returns exactly 1 or 4 images")
        if not job.ratio:
            raise ProviderError("invalid_input", f"{job.op} needs a ratio", False)
        body = {
            "model": self._sheet["ops"][job.op]["model"],
            "promptText": self._tagged([r.name for r in refs], prompt),
            "ratio": job.ratio,
            "outputCount": job.outputs or 1,
        }
        if refs:
            body["referenceImages"] = [
                {"uri": self._assets(r.sha256).url, "tag": r.name,
                 "subject": "human" if r.role == "character" else "object"} for r in refs]
        return "/v1/text_to_image", body

    def _clip(self, job: ProviderJob) -> tuple[str, dict]:
        self._check(job, "clip", job.prompt)
        if not job.first_frame:
            raise CapabilityMissing("clip needs a first frame")
        if not job.ratio:
            raise ProviderError("invalid_input", "clip needs a ratio", False)
        frames = [{"uri": self._assets(job.first_frame).url, "position": "first"}]
        if job.last_frame:
            frames.append({"uri": self._assets(job.last_frame).url, "position": "last"})
        body = {
            "model": self._sheet["ops"]["clip"]["model"],
            "promptImage": frames,
            "promptText": self._tagged([r.name for r in job.refs], job.prompt),
            "ratio": job.ratio,
            "audio": video_audio(job),  # Veo defaults to sound on
        }
        if job.duration_s is not None:
            body["duration"] = int(job.duration_s)
        if job.negative:
            body["negativePrompt"] = job.negative
        if job.seed is not None:
            body["seed"] = job.seed
        return "/v1/image_to_video", body

    def _clip_edit(self, job: ProviderJob) -> tuple[str, dict]:
        self._check(job, "clip_edit", job.prompt)
        videos = [a for a in (self._assets(r.sha256) for r in job.refs) if a.mime == "video/mp4"]
        if not videos:
            raise CapabilityMissing("clip_edit needs the source video (video/mp4) among its refs")
        body = {
            "model": self._sheet["ops"]["clip_edit"]["model"],
            "videoUri": videos[0].url,
            "promptText": self._tagged([r.name for r in job.refs], job.prompt),
        }  # aleph2 has no audio parameter, so unlike clip this body cannot set it
        if job.keyframe:
            kf = job.keyframe
            frame = {"uri": self._assets(kf["sha256"]).url, "seconds": kf["atS"]}
            if kf.get("startS") is not None and kf.get("endS") is not None:
                frame["range"] = {"start_seconds": kf["startS"], "end_seconds": kf["endS"]}
            elif kf.get("startS") is not None or kf.get("endS") is not None:
                raise ProviderError("invalid_input", "a keyframe range needs both startS and endS", False)
            body["keyframes"] = [frame]
        if job.seed is not None:
            body["seed"] = job.seed
        return "/v1/video_to_video", body

    # The Provider interface

    def submit(self, job: ProviderJob) -> str:
        build = {"clip": self._clip, "clip_edit": self._clip_edit}.get(job.op, self._image)
        path, body = build(job)
        resp = self._call("POST", path, json=body)
        if resp.status_code >= 300:
            raise _http_error(resp)
        try:  # a 2xx: Runway has the task, so whatever we cannot read must never be sent elsewhere
            task = self._ok(resp)
        except ProviderError as exc:
            raise ProviderError("provider_failed", exc.message, False, accepted=True) from exc
        if not task.get("id"):
            raise ProviderError("provider_failed", "Runway accepted the job but sent no task id", False, accepted=True)
        return task["id"]

    def status(self, request_id: str) -> Status:
        try:
            task = self._ok(self._call("GET", f"/v1/tasks/{request_id}"))
        except ProviderError as exc:
            if exc.retryable:  # 429, 5xx, the network: the relay asks again
                raise
            return Status("failed", error=exc)  # 401/403/404 on our task: asking again cannot help
        if task.get("status") is None:  # an empty or partial reply (a proxy's): ask again
            raise ProviderError("provider_unavailable", "Runway's task reply has no status", True)
        state = STATES.get(task.get("status"))
        if state is None:
            return Status("failed", error=ProviderError(
                "provider_failed", f"unknown Runway task status {task.get('status')!r}", False))
        credits = (task.get("cost") or {}).get("credits")
        cost = None if credits is None else round(credits * USD_PER_CREDIT, 4)
        if state == "failed":
            error, _ = failure(task.get("failureCode"), task.get("failure") or "Runway failed the task")
            return Status("failed", error=error, cost_usd=cost)  # a moderated task is billed too
        if state == "done":
            outputs = [ProviderOutput(url=u, mime=_mime(u)) for u in task.get("output") or []]
            return Status("done", outputs=outputs, cost_usd=cost)
        return Status(state)

    def cancel(self, request_id: str) -> None:
        resp = self._call("DELETE", f"/v1/tasks/{request_id}")
        if resp.status_code >= 300 and resp.status_code != 404:  # already gone is fine
            raise _http_error(resp)

    def organization(self) -> dict:
        """Tier and per-model concurrency, for the smoke script (GET /v1/organization)."""
        org = self._ok(self._call("GET", "/v1/organization"))
        tier = org.get("tier") or {}
        return {
            "tier": tier,
            "concurrency": {m: v.get("maxConcurrentGenerations") for m, v in (tier.get("models") or {}).items()},
            "creditBalance": org.get("creditBalance"),
        }


def _mime(url: str) -> str:
    path = url.split("?", 1)[0].lower()
    return next((m for ext, m in MIME.items() if path.endswith(ext)), "application/octet-stream")


def make():
    """The relay's registry entry (providers/__init__.py): this adapter behind the relay's Protocol."""
    from ._seam import Adapted, Resolver, key
    return Adapted(RunwayProvider(key("RUNWAY_API_KEY"), Resolver()))
