"""fal adapter: the queue API over raw httpx (capabilities/fal.json, docs/production-tool/providers.md).

Request ids are "<endpoint>:<fal request id>", because the status, result and cancel
URLs all hang off the endpoint and the relay only keeps the id.

Masks and the region chain:
- Our masks are white = change. MASK_POLARITY says what each endpoint wants, and the
  adapter converts before upload. fal has no upload call in the docs we read, so the
  converted mask goes out as a small PNG data URI.
- clip_edit with a mask is two requests: fal-ai/sam2/video, then wan-vace-14b/inpainting
  on its mask video. One request id covers both: the id is the sam2 request, and status()
  starts the wan request once sam2 is done. That hand-over lives in memory (`_chains`).
  Each status() makes one fal call, so the hand-over takes three polls after sam2 is
  COMPLETED: result fetch, wan submit, then wan's own polls.
- UNVERIFIED, live check needed before the event: fal does not say that sam2/video's
  output `video` is a black and white mask video (apply_mask is left unset), nor which
  polarity wan-vace expects. The chain feeds sam2's `video` to wan as `mask_video_url`
  on that assumption. Expect to change the sam2 request (apply_mask, prompts) or
  MASK_POLARITY after the first live run.
- A restart loses `_chains`: the job then fails non-retryable, because a retry would pay
  for sam2 again and wan may already be running. Persisting the cursor is for the owner.
"""

from __future__ import annotations

import base64
import io
import re
from typing import Optional
from urllib.parse import urlparse

import httpx
from PIL import Image, ImageOps

from .types import (
    AssetResolver, CapabilityMissing, ProviderError, ProviderJob, ProviderOutput,
    Status, check_capabilities, load_sheet, video_audio,
)
from .tags import TAG, UnknownTag, rewrite_tags

QUEUE = "https://queue.fal.run"
SAM2 = "fal-ai/sam2/video"
WAN = "fal-ai/wan-vace-14b/inpainting"

# What each endpoint takes as "edit this" in a mask. Ours is white. Only Ideogram documents it.
# "unverified" endpoints are assumed white = edit (not inverted) until a live check says
# otherwise: that check is still to do before the event.
MASK_POLARITY = {
    "ideogram/v4.5/edit": "black_edit",
    SAM2: "unverified",
    WAN: "unverified",  # takes the mask video that sam2 makes, so it is never converted here
}

IMAGE_OPS = {"generate", "frame"}
MAX_VIEW_OUTPUTS, MAX_REGION_OUTPUTS = 4, 8  # per endpoint; the sheet has one outputsPerCall
# pydantic-style 422 types: the request itself is wrong. Any other 422 type is fal's failure.
INVALID_TYPES = ("missing", "value_error", "type_error", "string_", "int_", "float_", "bool_", "enum",
                 "literal", "greater", "less", "too_", "url_", "json_", "list_", "dict_", "extra_forbidden")
SHOT_SPLIT = re.compile(r"^---\s*$", re.M)


def _message(detail) -> tuple[list[str], str]:
    """The error types and the first message in a fal error body's `detail`."""
    if isinstance(detail, list):
        items = [d for d in detail if isinstance(d, dict)]
        return [d.get("type", "") for d in items], (items[0].get("msg") if items else "") or "fal rejected the request"
    return [], str(detail) if detail else "fal rejected the request"


def _error(resp: httpx.Response) -> ProviderError:
    """Map a failed HTTP response onto our error codes."""
    try:
        body = resp.json()
    except ValueError:
        body = {}
    types, message = _message(body.get("detail") if isinstance(body, dict) else None)
    error_type = resp.headers.get("x-fal-error-type") or (body.get("error_type") if isinstance(body, dict) else None)
    if "content_policy_violation" in " ".join([*types, error_type or "", message]):
        return ProviderError("moderated", message, False, provider_code="content_policy_violation")
    code = types[0] if types else error_type
    if resp.status_code == 429:
        try:
            wait = max(0, int(resp.headers.get("retry-after", "")))
        except ValueError:
            wait = 5
        return ProviderError("provider_unavailable", "fal is at its concurrency limit", True, wait, code)
    if resp.status_code >= 500:
        return ProviderError("provider_unavailable", message, True, 5, code)
    if resp.status_code in (401, 403):
        return ProviderError("provider_failed", "fal rejected the API key", False, provider_code=code)
    if resp.status_code == 422 and types and not types[0].startswith(INVALID_TYPES):
        return ProviderError("provider_failed", message, False, provider_code=code)  # e.g. no_media_generated
    return ProviderError("invalid_input", message, False, provider_code=code)


def queue_app(endpoint: str, status_url: Optional[str] = None) -> str:
    """The app id fal's queue serves status, result and cancel under. It is not the endpoint:
    for an endpoint with a sub-path (fal-ai/kling-image/o3/image-to-image) the queue answers
    only under the base app (fal-ai/kling-image) and gives 405 on the full path (2026-10-07:
    every own-key job failed on its first status poll). The submit reply's status_url names it;
    without one, the app is the endpoint's first two segments (owner/app)."""
    if status_url:
        path = urlparse(status_url).path.strip("/")
        if "/requests/" in path:
            return path.split("/requests/", 1)[0]
    return "/".join(endpoint.split("/")[:2])


def _json(resp: httpx.Response) -> dict:
    """A 2xx body that is a JSON object, else a retryable provider error (a proxy's HTML page)."""
    try:
        body = resp.json()
    except ValueError:
        body = None
    if not isinstance(body, dict):
        raise ProviderError("provider_unavailable", "fal answered with a body that is not JSON", True, 5)
    return body


def _status_error(body: dict) -> ProviderError:
    """A COMPLETED status that carries `error`: fal has no FAILED state."""
    error_type = body.get("error_type") or ""
    message = str(body.get("error") or "fal failed the request")
    if "content_policy_violation" in (error_type + message):
        return ProviderError("moderated", message, False, provider_code="content_policy_violation")
    return ProviderError("provider_failed", message, False, provider_code=error_type or None)


def _outputs(result: dict) -> list[ProviderOutput]:
    try:
        out = [ProviderOutput(url=i["url"], mime=i.get("content_type", "image/png"), w=i.get("width"), h=i.get("height"))
               for i in result.get("images", [])]
        if result.get("video"):
            out.append(ProviderOutput(url=result["video"]["url"], mime=result["video"].get("content_type", "video/mp4")))
    except (KeyError, TypeError, AttributeError) as exc:
        raise ProviderError("provider_failed", f"fal's result is not shaped as expected: {exc!r}", False) from exc
    return out


def _seconds(value: float) -> int:
    if value != int(value):
        raise ProviderError("invalid_input", f"duration must be whole seconds, got {value}", False)
    return int(value)


class FalProvider:
    name = "fal"

    def __init__(self, api_key: str, assets: AssetResolver, client: Optional[httpx.Client] = None,
                 sheet: Optional[dict] = None):
        self._key, self._assets = api_key, assets
        self._client = client or httpx.Client(timeout=30)
        self._sheet = sheet or load_sheet("fal")
        self._chains: dict[str, dict] = {}
        self._completed: set[str] = set()  # requests whose status said COMPLETED: the next poll fetches the result

    def capabilities(self) -> dict:
        return self._sheet

    # --- HTTP ---

    def _call(self, method: str, path: str, **kw) -> httpx.Response:
        # The key goes on fal calls only, never on fetches of our own assets.
        headers = {"Authorization": f"Key {self._key}", "x-app-fal-disable-fallback": "true"}
        try:
            return self._client.request(method, f"{QUEUE}/{path}", headers=headers, **kw)
        except httpx.TransportError as exc:
            raise ProviderError("provider_unavailable", f"fal is unreachable: {exc}", True, 5, "transport_error") from exc

    def _fetch(self, sha: str) -> bytes:
        url = self._assets(sha).url
        try:
            resp = self._client.get(url)
        except httpx.TransportError as exc:
            raise ProviderError("internal", f"could not read {url}: {exc}", True) from exc
        if resp.status_code >= 400:
            raise ProviderError("internal", f"could not read {url}: HTTP {resp.status_code}", True)
        return resp.content

    def _enqueue(self, endpoint: str, body: dict) -> str:
        resp = self._call("POST", endpoint, json=body)
        if resp.status_code >= 400:
            raise _error(resp)
        body = _json(resp)
        rid = body.get("request_id")
        if not rid:
            raise ProviderError("provider_failed", "fal's reply carries no request_id", False)
        # The id keeps the endpoint (for the sheet's price) and the queue app (for the URLs).
        return f"{endpoint}>{queue_app(endpoint, body.get('status_url'))}:{rid}"

    @staticmethod
    def _split(request_id: str) -> tuple[str, str, str]:
        """endpoint, queue app, fal request id."""
        head, _, rid = request_id.rpartition(":")
        endpoint, _, app = head.partition(">")
        return endpoint, app or queue_app(endpoint), rid

    # --- building requests ---

    def _url(self, sha: str) -> str:
        return self._assets(sha).url

    def _prompt(self, prompt: str, image_names: list[str], element_tags: dict[str, str], syntax: Optional[str] = None) -> str:
        """@hero becomes @Element1 for an element ref, else @ImageN by its place in image_urls.
        Only the Kling endpoints name refs that way: the others pass syntax="none" (the bare name)."""
        prompt = TAG.sub(lambda m: element_tags.get(m.group(1), m.group(0)), prompt)
        try:
            return rewrite_tags(prompt, image_names, syntax or self._sheet["tagSyntax"])
        except UnknownTag as exc:
            raise ProviderError("invalid_input", str(exc), False) from exc

    def _split_refs(self, job: ProviderJob) -> tuple[list[str], list[str], list[dict], dict[str, str]]:
        """Image refs in order, and elements: each element_front starts one and the
        element_angle refs after it join it (the contract's refs carry only a role)."""
        urls, names, elements, tags = [], [], [], {}
        for r in job.refs:
            if r.role == "element_front":
                elements.append({"frontal_image_url": self._url(r.sha256), "reference_image_urls": []})
            elif r.role == "element_angle":
                if not elements:
                    raise CapabilityMissing(f"element_angle ref {r.name} comes before any element_front")
                if len(elements[-1]["reference_image_urls"]) == 3:
                    raise CapabilityMissing("an element takes at most 3 angle refs")
                elements[-1]["reference_image_urls"].append(self._url(r.sha256))
            else:
                urls.append(self._url(r.sha256))
                names.append(r.name)
                continue
            tags[r.name] = f"@Element{len(elements)}"
        return urls, names, elements, tags

    def _source(self, job: ProviderJob):
        """The image an edit applies to: the current ref, else the marked one, else the first."""
        by_role = {r.role: r for r in reversed(job.refs)}
        ref = by_role.get("current") or by_role.get("marked") or (job.refs[0] if job.refs else None)
        if ref is None:
            raise CapabilityMissing(f"{job.op} needs a source image ref")
        return ref

    def _video(self, job: ProviderJob) -> str:
        for r in job.refs:
            if r.role == "current":
                return self._url(r.sha256)
        raise CapabilityMissing("clip_edit needs the source video as a ref with role 'current'")

    def _mask(self, sha: str, endpoint: str, size: Optional[tuple[int, int]] = None) -> str:
        """Our mask (white = change) as the endpoint reads it, as a PNG data URI."""
        try:
            img = Image.open(io.BytesIO(self._fetch(sha))).convert("L")
        except OSError as exc:
            raise ProviderError("invalid_input", f"the mask is not an image: {exc}", False) from exc
        if size and img.size != size:
            raise ProviderError("invalid_input", f"mask is {img.size[0]}x{img.size[1]}, source is {size[0]}x{size[1]}", False)
        img = img.point(lambda v: 255 if v >= 128 else 0)
        if MASK_POLARITY[endpoint] == "black_edit":
            img = ImageOps.invert(img)
        out = io.BytesIO()
        img.save(out, format="PNG")
        return "data:image/png;base64," + base64.b64encode(out.getvalue()).decode()

    def _kling_image(self, job: ProviderJob) -> dict:
        urls, names, elements, tags = self._split_refs(job)
        if not urls:
            raise CapabilityMissing("kling image o3 needs at least one image ref")
        body = {"prompt": self._prompt(job.prompt, names, tags), "image_urls": urls, "output_format": "png"}
        if elements:
            body["elements"] = elements
        if job.ratio:
            body["aspect_ratio"] = job.ratio
        n = job.outputs or 1
        if job.op == "frame" and n >= 2:
            body.update(result_type="series", series_amount=n)  # a consistent set of frames
        else:
            body.update(result_type="single", num_images=n)
        return body

    def _view(self, job: ProviderJob) -> dict:
        if not job.angle:
            raise ProviderError("invalid_input", "view needs an angle", False)
        if (job.outputs or 1) > MAX_VIEW_OUTPUTS:
            raise CapabilityMissing(f"view returns at most {MAX_VIEW_OUTPUTS} outputs per call")
        ref = self._source(job)
        body = {
            "image_urls": [self._url(ref.sha256)],
            "horizontal_angle": float(job.angle["horizontal"]),
            "vertical_angle": float(job.angle.get("vertical", 0)),
            "num_images": job.outputs or 1,
            "output_format": "png",
        }
        if job.prompt:
            body["additional_prompt"] = self._prompt(job.prompt, [ref.name], {}, "none")
        return body

    def _region_edit(self, job: ProviderJob) -> dict:
        if not job.mask:
            raise CapabilityMissing("region_edit needs a mask")
        if (job.outputs or 1) > MAX_REGION_OUTPUTS:
            raise CapabilityMissing(f"region_edit returns at most {MAX_REGION_OUTPUTS} outputs per call")
        endpoint = self._sheet["ops"]["region_edit"]["endpoint"]
        source = self._source(job)
        others = [r for r in job.refs if r is not source]
        if len(others) > 3:
            raise CapabilityMissing("ideogram takes at most 3 reference images with a mask")
        size = Image.open(io.BytesIO(self._fetch(source.sha256))).size
        body = {
            "prompt": self._prompt(job.prompt, [r.name for r in others], {}, "none"),
            "image_url": self._url(source.sha256),
            "mask_url": self._mask(job.mask, endpoint, size),
            "edit_precision": "regular",
            "quality": "medium",
            "num_images": job.outputs or 1,
        }
        if others:
            body["reference_image_urls"] = [self._url(r.sha256) for r in others]
        return body

    def _clip(self, job: ProviderJob) -> dict:
        if not job.first_frame:
            raise CapabilityMissing("clip needs a first frame")
        urls, _, elements, tags = self._split_refs(job)
        if urls:
            raise CapabilityMissing("clip refs must be element_front / element_angle")
        if any(not e["reference_image_urls"] for e in elements):
            raise CapabilityMissing("kling video needs at least one angle ref per element")
        body = {"start_image_url": self._url(job.first_frame), "generate_audio": video_audio(job)}
        if job.last_frame:
            body["end_image_url"] = self._url(job.last_frame)
        if elements:
            body["elements"] = elements
        if job.negative:
            body["negative_prompt"] = job.negative
        shots = [self._prompt(s.strip(), [], tags) for s in SHOT_SPLIT.split(job.prompt) if s.strip()]
        if len(shots) < 2:
            body["prompt"] = shots[0] if shots else ""
            if job.duration_s is not None:
                body["duration"] = str(_seconds(job.duration_s))  # a string, "3".."15"
            return body
        if job.duration_s is None:
            raise ProviderError("invalid_input", "a multi-shot clip needs a duration", False)
        total = _seconds(job.duration_s)
        if total < len(shots):
            raise ProviderError("invalid_input", f"{len(shots)} shots do not fit in {total} s", False)
        each, extra = divmod(total, len(shots))
        body["multi_prompt"] = [{"prompt": s, "duration": str(each + (i < extra))} for i, s in enumerate(shots)]
        body["shot_type"] = "customize"
        return body

    def _clip_edit(self, job: ProviderJob) -> tuple[str, dict]:
        video = self._video(job)
        if not job.mask:  # the feel edit
            body = {"video_url": video, "prompt": job.prompt,
                    "duration": f"{_seconds(job.duration_s or 5)}s", "resolution": "540p"}
            if job.strength:
                body["edit_strength"] = f"{job.strength}_2"  # the middle of 1-3
            return self._sheet["ops"]["clip_edit"]["endpoint"], body
        wan = {"prompt": job.prompt, "video_url": video, "resolution": "auto",
               "match_input_num_frames": True, "match_input_frames_per_second": True,
               "enable_safety_checker": True}
        if job.negative:
            wan["negative_prompt"] = job.negative
        sam = {"video_url": video, "mask_url": self._mask(job.mask, SAM2)}
        return SAM2, {"sam": sam, "wan": wan}

    # --- the Provider interface ---

    def submit(self, job: ProviderJob) -> str:
        check_capabilities(self._sheet, job)
        endpoint = self._sheet["ops"][job.op]["endpoint"]
        if job.op in IMAGE_OPS:
            body = self._kling_image(job)
        elif job.op == "view":
            body = self._view(job)
        elif job.op == "region_edit":
            body = self._region_edit(job)
        elif job.op == "clip":
            body = self._clip(job)
        else:
            endpoint, body = self._clip_edit(job)
            if endpoint == SAM2:
                request_id = self._enqueue(SAM2, body["sam"])
                self._chains[request_id] = {"wan": body["wan"], "wan_req": None, "cancelled": False, "failed": None}
                return request_id
        return self._enqueue(endpoint, body)

    def _poll(self, request_id: str) -> Status:
        """One fal call: the status, or, once that said COMPLETED, the result."""
        endpoint, app, rid = self._split(request_id)
        if request_id in self._completed:
            return self._result(endpoint, app, rid)
        resp = self._call("GET", f"{app}/requests/{rid}/status")
        if resp.status_code >= 400:
            return self._failed(resp)
        body = _json(resp)
        state = body.get("status")
        if state == "IN_QUEUE":
            return Status("queued", queue_position=body.get("queue_position"))
        if state == "IN_PROGRESS":
            return Status("running", queue_position=0)
        if state != "COMPLETED":
            raise ProviderError("provider_failed", f"unknown fal status {state!r}", False)
        if body.get("error"):
            return Status("failed", error=_status_error(body))
        self._completed.add(request_id)
        return Status("running", queue_position=0)

    def _failed(self, resp: httpx.Response) -> Status:
        """A retryable HTTP failure raises (the relay polls again); any other ends the job."""
        error = _error(resp)
        if error.retryable:
            raise error
        return Status("failed", error=error)

    def _result(self, endpoint: str, app: str, rid: str) -> Status:
        resp = self._call("GET", f"{app}/requests/{rid}")
        if resp.status_code >= 400:
            return self._failed(resp)
        try:
            outputs = _outputs(_json(resp))
        except ProviderError as error:
            if error.retryable:
                raise
            return Status("failed", error=error)
        if not outputs:
            return Status("failed", error=ProviderError("provider_failed", "fal returned no media", False))
        images = [o for o in outputs if o.mime.startswith("image/")]
        estimates = [op["estimateUsd"] for op in self._sheet["ops"].values() if op["endpoint"] == endpoint]
        cost = estimates[0] * len(images) if images and estimates else None
        return Status("done", queue_position=0, outputs=outputs, cost_usd=cost)

    def status(self, request_id: str) -> Status:
        endpoint, _, _ = self._split(request_id)
        if endpoint != SAM2:
            return self._poll(request_id)
        chain = self._chains.get(request_id)
        if chain is None:
            return Status("failed", error=ProviderError(
                "provider_failed", "the region edit lost its place (relay restarted between steps)", False))
        if chain["cancelled"]:
            return Status("cancelled")
        if chain["failed"]:
            return Status("failed", error=chain["failed"])
        if chain["wan_req"]:
            return self._poll(chain["wan_req"])
        if "mask_video_url" not in chain["wan"]:
            st = self._poll(request_id)
            if st.state == "failed":
                chain["failed"] = st.error
            elif st.state == "done":
                masks = [o for o in st.outputs if o.mime.startswith("video/")]
                if not masks:
                    chain["failed"] = ProviderError("provider_failed", "sam2 made no mask video", False)
                    return Status("failed", error=chain["failed"])
                chain["wan"]["mask_video_url"] = masks[0].url
                return Status("running", queue_position=0)
            return st
        try:
            chain["wan_req"] = self._enqueue(WAN, chain["wan"])
        except ProviderError as error:
            if error.retryable and error.provider_code != "transport_error":
                raise  # fal answered 429 or 5xx: it did not take the request, so the next poll may send it again
            if error.retryable:  # no answer: wan may have started, and sending again would pay twice
                error = ProviderError("provider_failed", "could not confirm that the wan request started", False)
            chain["failed"] = error
            return Status("failed", error=error)
        return Status("running", queue_position=0)

    def cancel(self, request_id: str) -> None:
        chain = self._chains.get(request_id)
        if chain:
            chain["cancelled"] = True
        _, app, rid = self._split(chain["wan_req"] if chain and chain["wan_req"] else request_id)
        resp = self._call("PUT", f"{app}/requests/{rid}/cancel")
        if resp.status_code == 400:  # ALREADY_COMPLETED
            return
        if resp.status_code >= 400:
            raise _error(resp)


def make():
    """The relay's registry entry (providers/__init__.py): this adapter behind the relay's Protocol."""
    from ._seam import Adapted, Resolver, key
    return Adapted(FalProvider(key("FAL_KEY"), Resolver()))
