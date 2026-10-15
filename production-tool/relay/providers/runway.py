"""Runway adapter, over raw httpx (docs/production-tool/providers.md, capabilities/runway.json).

Images go to text_to_image (gemini_image3_pro, gemini_image3.1_flash), clips to image_to_video
(veo3.1 and the alternates: Kling, Hailuo, Omni Flash, WAN, Seedance) or text_to_video, and clip edits to
video_to_video (aleph2, Kling O3, Omni Flash 1.1, Seedance 2.5), upscales to image_upscale (magnific).
Each clip model's request is built from its catalogue facts (models[m]: audioParam, negativePrompt,
imagesMax, keyframeRatio, resolutions, v2v) and its effective sheet (refs, video.firstFrameWithRefs,
video.refsWithoutFrame), checked against Runway's OpenAPI in tests (features/runway-video-models.clan).
A region edit runs on ideogram_4_5 (features/image-editor.clan): the image as the first reference
and a black-and-white mask the same size (black = edit, providers.md fact 2), made from our
white = change mask or from the box; with no region and no mask it is a preciseEdit, which
changes the whole image keeping its composition (fact 3). On the Gemini 3 Pro alternate, which
takes no mask, it sends the clean image and a copy with the box drawn on it.

submit() never waits and status() makes one call. The key is a constructor argument;
this module never reads the environment.
"""

from __future__ import annotations

import dataclasses
from typing import Optional

import httpx

from .types import (
    VIDEO_OPS, AssetResolver, CapabilityMissing, ProviderError, ProviderJob,
    ProviderOutput, Ref, Status, check_capabilities, effective_sheet, load_sheet, nearest_ratio, utf16_units,
    video_audio,
)
from .tags import UnknownTag, rewrite_tags, unsent_in_words

BASE_URL = "https://api.dev.runwayml.com"
VERSION = "2024-11-06"
MIN_POLL_S = 5  # sheet results.minPollS
# A credit's price and each model's prompt limit come from the sheet (usdPerCredit, models[m].promptMax).
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
    # Every safety family: SAFETY.*, and INPUT_PREPROCESSING.SAFETY.* (the text filter, and the upstream
    # model's own, e.g. Seedance refusing a photoreal face): a clear moderated failure, never retried.
    if code.startswith(("SAFETY.", "INPUT_PREPROCESSING.SAFETY")):
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


# The previous defaults, kept as alternates (features/default-models.clan). Runway is the floor of
# every job and its models are always offered (features/runway-fallback.clan).
ALTERNATES = {"generate": {"gemini_image3.1_flash"}, "view": {"gemini_image3.1_flash"},
              "frame": {"gemini_image3.1_flash"},
              # features/runway-video-models.clan: clips that carry characters, and edits with pictures
              "clip": {"veo3.1_fast", "klingO3_pro", "klingO3_standard", "kling3.0_pro", "kling3.0_standard",
                       "hailuo3", "gemini_omni_flash_1.1", "wan3", "seedance2_5", "seedance2_fast"},
              "clip_edit": {"klingO3_pro", "klingO3_standard", "gemini_omni_flash_1.1", "seedance2_5"},
              "region_edit": {"gemini_image3_pro"}}  # the box-drawn edit, before ideogram_4_5 took masks


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

    def _model(self, job: ProviderJob) -> str:
        """The model the job names when the sheet lists it for the op, else the op's own."""
        return effective_sheet(self._sheet, job.op, job.model)["ops"][job.op]["model"]

    def _tagged(self, names: list[str], prompt: str, syntax: Optional[str] = None) -> str:
        """The prompt in the model's own reference syntax (`syntax`: its effective sheet's tagSyntax)."""
        try:
            return rewrite_tags(unsent_in_words(prompt, names), names, syntax or self._sheet["tagSyntax"])
        except UnknownTag as exc:
            raise ProviderError("invalid_input", str(exc), False) from exc

    def _check(self, job: ProviderJob, prompt: str) -> None:
        # The sheet's seed flag is false for the image models; both video models take one. The sheet as
        # the job's model sees it: ideogram_4_5 takes a mask on region_edit, Gemini does not.
        sheet = effective_sheet(self._sheet, job.op, job.model)
        check_capabilities(sheet, dataclasses.replace(job, seed=None) if job.op in VIDEO_OPS else job)
        limit = (self._sheet.get("models", {}).get(self._model(job)) or {}).get("promptMax")
        if limit is not None and utf16_units(prompt) > limit:
            raise CapabilityMissing(f"{job.op} prompt is at most {limit} characters")
        if job.op in VIDEO_OPS and job.seed is not None and not 0 <= job.seed <= MAX_SEED:
            raise CapabilityMissing(f"seed must be 0-{MAX_SEED}")

    def _bytes(self, sha: str) -> bytes:
        """One of our own assets, read here (a mask to invert, the size of the image to edit)."""
        import base64

        url = self._assets(sha).url
        try:
            if url.startswith("data:"):
                return base64.b64decode(url.split(",", 1)[1])
            resp = self._client.get(url)
            resp.raise_for_status()
            return resp.content
        except (httpx.HTTPError, ValueError) as exc:  # our own asset: not a call to Runway
            raise ProviderError("internal", f"could not read an input: {exc}", True, source="napkin") from exc

    def _ideogram(self, job: ProviderJob) -> tuple[str, dict]:
        """A region edit on ideogram_4_5: the image first, then up to four references; maskUri black where
        it changes (from the job's mask, ours white = change, or from the box), else preciseEdit. Neither
        takes a ratio: the result keeps the image's size."""
        import base64
        import io

        from PIL import Image

        from region.image_ops import mask_png, to_endpoint_mask

        current = next((r for r in job.refs if r.role == "current"), None)
        if current is None:
            raise CapabilityMissing("region_edit needs a 'current' ref")
        job = dataclasses.replace(job, ratio=None)
        prompt = self._tagged([], job.prompt)  # ideogram names no reference by tag
        self._check(job, prompt)
        if job.outputs not in (None, 1, 4):
            raise CapabilityMissing("Runway returns exactly 1 or 4 images")
        others = [r for r in job.refs if r is not current][:4]
        body = {"model": self._model(job), "promptText": prompt,
                "referenceImages": [{"uri": self._assets(r.sha256).url} for r in [current, *others]],
                "outputCount": job.outputs or 1}
        if job.mask or job.region:
            try:
                if job.mask:
                    ours = self._bytes(job.mask)
                else:
                    size = Image.open(io.BytesIO(self._bytes(current.sha256))).size
                    ours = mask_png(size, job.region)
                black = to_endpoint_mask(ours, "black_edit")
            except ProviderError:
                raise
            except Exception as exc:  # PIL: not a picture we can read
                raise ProviderError("invalid_input", f"the mask is not one we can read: {exc}", False) from exc
            body["maskUri"] = "data:image/png;base64," + base64.b64encode(black).decode()
        else:
            body["preciseEdit"] = True
        return "/v1/text_to_image", body

    def _upscale(self, job: ProviderJob) -> tuple[str, dict]:
        """Magnific's precision upscaler (providers.md fact 7): the image, 2x or 4x."""
        self._check(job, job.prompt)
        source = next((r for r in job.refs if r.role == "current"), job.refs[0] if job.refs else None)
        if source is None:
            raise CapabilityMissing("upscale needs the image")
        factors = (self._sheet.get("models", {}).get(self._model(job)) or {}).get("scaleFactors") or [2, 4]
        scale = job.scale or 2
        if scale not in factors:
            raise CapabilityMissing(f"upscale scale must be one of {factors}")
        return "/v1/image_upscale", {"model": self._model(job), "imageUri": self._assets(source.sha256).url,
                                     "scaleFactor": scale}

    def _marked(self, current: Ref, region: dict) -> str:
        """The current image with the box drawn on it, as a PNG data URI (Runway has no masks).
        Nothing upstream makes this picture: the director sends the image and the box, so every
        Runway region edit failed until the adapter drew it (pathway matrix, 2026-10-08)."""
        import base64

        from region.image_ops import draw_box
        from region.pipeline import BOX_COLOUR, BOX_WIDTH_PX

        url = self._assets(current.sha256).url
        try:
            if url.startswith("data:"):
                data = base64.b64decode(url.split(",", 1)[1])
            else:
                resp = self._client.get(url)
                resp.raise_for_status()
                data = resp.content
        except (httpx.HTTPError, ValueError) as exc:  # our own asset: not a call to Runway
            raise ProviderError("internal", f"could not read the image to edit: {exc}", True, source="napkin") from exc
        try:
            png = draw_box(data, region, BOX_COLOUR, BOX_WIDTH_PX)
        except Exception as exc:  # PIL: not an image we can read
            raise ProviderError("invalid_input", f"the image to edit is not one we can read: {exc}", False) from exc
        return "data:image/png;base64," + base64.b64encode(png).decode()

    def _own_ratio(self, current: Ref) -> str:
        """The Gemini 3 Pro size nearest the edited picture's own shape (Runway needs a ratio)."""
        import base64
        import io

        from PIL import Image

        from director.director import PRO_RATIOS

        url = self._assets(current.sha256).url
        try:
            data = base64.b64decode(url.split(",", 1)[1]) if url.startswith("data:") else self._client.get(url).content
            w, h = Image.open(io.BytesIO(data)).size
        except Exception as exc:
            raise ProviderError("invalid_input", f"the image to edit is not one we can read: {exc}", False) from exc
        return nearest_ratio(f"{w}:{h}", tuple(sorted(PRO_RATIOS)))

    def _image(self, job: ProviderJob) -> tuple[str, dict]:
        refs = list(job.refs)
        prompt = job.prompt
        uris: dict[str, str] = {}  # pictures made here rather than uploaded (the marked copy)
        if job.op == "region_edit":
            by_role = {r.role: r for r in refs}
            if "current" not in by_role:
                raise CapabilityMissing("region_edit needs a 'current' ref")
            if "marked" not in by_role and not job.region:
                # Change whole frame on the Gemini alternate (an agency with Ideogram off): the image and the
                # words, keeping the composition (features/image-editor.clan).
                current = by_role["current"]
                if not job.ratio:
                    job = dataclasses.replace(job, ratio=self._own_ratio(current))
                refs = [current] + [r for r in refs if r is not current]
                prompt = (f"Change @{current.name} as follows, keeping its composition, framing and everything "
                          f"else as it is: ") + prompt
            elif "marked" not in by_role:
                by_role["marked"] = Ref("marked:box", "marked", "marked")
                uris["marked:box"] = self._marked(by_role["current"], job.region)
            if "marked" in by_role:
                current, marked = by_role["current"], by_role["marked"]
                if not job.ratio:  # the web sends none for an edit: keep the picture's own shape
                    job = dataclasses.replace(job, ratio=self._own_ratio(current))
                refs = [current, marked] + [r for r in refs if r is not current and r is not marked]
                prompt = REGION_PROMPT.format(current=current.name, marked=marked.name) + prompt
        self._check(job, prompt)
        if sum(r.role != "character" for r in refs) > MAX_OBJECT:
            raise CapabilityMissing(f"{self.name} takes at most {MAX_OBJECT} object refs")
        if job.outputs not in (None, 1, 4):
            raise CapabilityMissing("Runway returns exactly 1 or 4 images")
        if not job.ratio:
            raise ProviderError("invalid_input", f"{job.op} needs a ratio", False)
        body = {
            "model": self._model(job),
            "promptText": self._tagged([r.name for r in refs], prompt),
            "ratio": job.ratio,
            "outputCount": job.outputs or 1,
        }
        if refs:
            body["referenceImages"] = [
                {"uri": uris.get(r.sha256) or self._assets(r.sha256).url, "tag": r.name,
                 "subject": "human" if r.role == "character" else "object"} for r in refs]
        return "/v1/text_to_image", body

    def _catalogue(self, model: str) -> dict:
        return (self._sheet.get("models") or {}).get(model) or {}

    @staticmethod
    def _auto_ratio(ratio: str, m: dict) -> str:
        """WAN 3 with keyframes: auto_<tier>, the tier of the size the job asked for (720p when unknown)."""
        tier = next((r.get("tier") for r in m.get("ratios") or [] if r["ratio"] == ratio), None)
        return f"auto_{tier or '720p'}"

    @staticmethod
    def _in_tier(ratio: str, m: dict, tier: Optional[str]) -> str:
        """The model's size of `tier` nearest the shape of `ratio` (features/clip-quality.clan): Final makes
        1920:1080 where the director asked 1280:720. As it is when the model lists no pixel sizes in that
        tier (Hailuo 3's aspect ratios: its size is the resolution) or no tier is asked."""
        import re

        sizes = tuple(r["ratio"] for r in m.get("ratios") or []
                      if r.get("tier") == tier and re.fullmatch(r"[0-9]+:[0-9]+", r["ratio"]))
        if not tier or not sizes or ratio in sizes:
            return ratio
        return nearest_ratio(ratio, sizes)

    def _clip(self, job: ProviderJob) -> tuple[str, dict]:
        self._check(job, job.prompt)
        sheet = effective_sheet(self._sheet, job.op, job.model)
        spec, video = sheet["ops"][job.op], sheet["video"]
        model = spec["model"]
        m = self._catalogue(model)
        q = job.quality or {}
        if job.draft_task:
            # Remake as Final on a draft (features/clip-quality.clan): Runway makes the same draft at 1080p
            # from its task id, with its own prompt, pictures and settings; no other field may go.
            if not m.get("draftPromote"):
                raise CapabilityMissing(f"{m.get('label', model)} cannot make a draft final")
            return "/v1/text_to_video", {"model": model, "draftTaskId": job.draft_task}
        # A clip with no first frame goes to the model's text endpoint (a clip straight from the script,
        # ui-behaviour 3.5). It carries pictures only where the model takes references there
        # (video.refsWithoutFrame: Hailuo 3, Omni Flash 1.1, WAN 3, Seedance); Veo and Kling take none.
        text_only = not job.first_frame
        endpoint = spec.get("textEndpoint")
        if text_only and not endpoint:
            raise CapabilityMissing("clip needs a first frame")
        if text_only and job.last_frame:
            raise CapabilityMissing("a clip from words alone takes no last frame")
        if text_only and job.refs and not video.get("refsWithoutFrame"):
            raise CapabilityMissing(f"{m.get('label', model)} takes no pictures for a clip from words alone")
        images = len(job.refs) + bool(job.first_frame) + bool(job.last_frame)
        if m.get("imagesMax") and images > m["imagesMax"]:
            raise CapabilityMissing(f"{m.get('label', model)} takes at most {m['imagesMax']} pictures, frames included")
        if not job.ratio:
            raise ProviderError("invalid_input", "clip needs a ratio", False)
        body = {"model": model}
        if not text_only:
            frames = [{"uri": self._assets(job.first_frame).url, "position": "first"}]
            if job.last_frame:
                frames.append({"uri": self._assets(job.last_frame).url, "position": "last"})
            body["promptImage"] = frames
        if job.refs:  # objects, never bare strings (a string array is a 400: paid test 2026-10-15)
            body["references"] = [{"uri": self._assets(r.sha256).url} for r in job.refs]
        body["promptText"] = self._tagged([r.name for r in job.refs], job.prompt, sheet["tagSyntax"])
        keyframed = not text_only and m.get("keyframeRatio") == "auto_tier"
        ratio = self._in_tier(job.ratio, m, q.get("tier"))  # the quality's size, in the shot's shape
        body["ratio"] = self._auto_ratio(ratio, m) if keyframed else ratio
        if m.get("resolutions"):  # Hailuo 3: the size is a resolution beside an aspect ratio
            body["resolution"] = q.get("resolution") or (spec.get("defaults") or {}).get("resolution") or m["resolutions"][0]
        if q.get("draft"):  # Seedance 2.5's cheap 480p preview, which Remake as Final can promote
            body["draft"] = True
        if m.get("audioParam", True):
            body["audio"] = video_audio(job)  # explicit wherever the model has the switch; Veo defaults to sound on
        if job.duration_s is not None:
            body["duration"] = int(job.duration_s)
        if job.negative and m.get("negativePrompt"):
            body["negativePrompt"] = job.negative
        if job.seed is not None and spec.get("seed", sheet.get("seed")):  # Veo and Seedance take one
            body["seed"] = job.seed
        return (endpoint.split(" ", 1)[-1] if text_only else "/v1/image_to_video"), body

    def _clip_edit(self, job: ProviderJob) -> tuple[str, dict]:
        self._check(job, job.prompt)
        sheet = effective_sheet(self._sheet, job.op, job.model)
        model = sheet["ops"][job.op]["model"]
        m = self._catalogue(model)
        v2v = m.get("v2v") or {"videoField": "videoUri", "refsMax": 0}
        assets = [(r, self._assets(r.sha256)) for r in job.refs]
        videos = [a for _, a in assets if a.mime == "video/mp4"]
        if not videos:
            raise CapabilityMissing("clip_edit needs the source video (video/mp4) among its refs")
        # Pictures go only to a model that edits with them (Kling O3, Omni Flash 1.1, Seedance 2.5); on
        # aleph2 their @tags are said in words.
        pictures = [(r, a) for r, a in assets if a.mime != "video/mp4"] if v2v.get("refsMax") else []
        if len(pictures) > v2v.get("refsMax", 0):
            raise CapabilityMissing(f"{m.get('label', model)} edits with at most {v2v['refsMax']} pictures")
        if job.keyframe and sheet["video"]["regionEdit"] != "temporal_keyframe":
            raise CapabilityMissing(f"{m.get('label', model)} takes no keyframe")
        body = {
            "model": model,
            v2v["videoField"]: videos[0].url,
            "promptText": self._tagged([r.name for r, _ in pictures], job.prompt, sheet["tagSyntax"]),
        }  # aleph2 has no audio parameter, so unlike clip this body cannot set it
        if pictures:
            body["references"] = [{"uri": a.url} for _, a in pictures]
        if v2v.get("mode"):
            body["mode"] = v2v["mode"]
        q = job.quality or {}
        if v2v.get("ratio") and q.get("tier") and job.ratio:
            # Omni Flash 1.1 makes the edit at the quality's size, in the clip's own shape (features/clip-quality.clan).
            body["ratio"] = self._in_tier(job.ratio, m, q["tier"])
        if v2v.get("durationAuto"):
            body["duration"] = "auto"  # Seedance 2.5 edit keeps the clip's length
        if v2v.get("keepOriginalSound"):
            body["providerSettings"] = {"keepOriginalSound": True}  # Kling O3: the clip's own sound stays
        if v2v.get("audioParam"):  # Seedance 2.5's edit has the switch; Kling O3 keeps the clip's sound instead
            body["audio"] = video_audio(job)
        if job.keyframe:
            kf = job.keyframe
            frame = {"uri": self._assets(kf["sha256"]).url, "seconds": kf["atS"]}
            if kf.get("startS") is not None and kf.get("endS") is not None:
                frame["range"] = {"start_seconds": kf["startS"], "end_seconds": kf["endS"]}
            elif kf.get("startS") is not None or kf.get("endS") is not None:
                raise ProviderError("invalid_input", "a keyframe range needs both startS and endS", False)
            body["keyframes"] = [frame]
        if job.seed is not None and sheet["ops"][job.op].get("seed", sheet.get("seed")):
            body["seed"] = job.seed
        return "/v1/video_to_video", body

    # The Provider interface

    def submit(self, job: ProviderJob) -> str:
        build = {"clip": self._clip, "clip_edit": self._clip_edit, "upscale": self._upscale}.get(job.op, self._image)
        if job.op == "region_edit" and effective_sheet(self._sheet, job.op, job.model)["mask"] != "none":
            build = self._ideogram
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
        cost = None if credits is None else round(credits * self._sheet["usdPerCredit"], 4)
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
        """Tier, per-model concurrency and the tier's ceilings, for the smoke script and the cost model
        (GET /v1/organization; contracts/cost-model.json tier)."""
        org = self._ok(self._call("GET", "/v1/organization"))
        tier = org.get("tier") or {}
        models = tier.get("models") or {}
        return {
            "tier": tier,
            "concurrency": {m: v.get("maxConcurrentGenerations") for m, v in models.items()},
            "ceilings": {
                "maxMonthlyCreditSpend": tier.get("maxMonthlyCreditSpend"),
                "maxDailyGenerations": {m: v.get("maxDailyGenerations") for m, v in models.items()},
            },
            "creditBalance": org.get("creditBalance"),
        }


def _mime(url: str) -> str:
    path = url.split("?", 1)[0].lower()
    return next((m for ext, m in MIME.items() if path.endswith(ext)), "application/octet-stream")


def make():
    """The relay's registry entry (providers/__init__.py): this adapter behind the relay's Protocol."""
    from ._seam import Adapted, Resolver, key
    return Adapted(RunwayProvider(key("RUNWAY_API_KEY"), Resolver()))
