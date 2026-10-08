"""Mock provider: every capability on, no keys, no cost.

Returns the input stamped "MOCK" after a delay, with a fake queue position, so the
whole UI can be built and load-tested before any real key exists. Its outputs are
labelled kind "mock" and can never count as final.

Video ops have no encoder here, so they return the stamped first frame as a still
(image/png) with the requested duration attached.
"""

from __future__ import annotations

import io
import time
import uuid
from typing import Callable, Optional

from PIL import Image, ImageDraw, ImageFont

from .types import (
    VIDEO_OPS, AssetResolver, ProviderError, ProviderJob,
    ProviderOutput, Status, check_capabilities, effective_sheet, load_sheet, video_audio,
)

# The alternates in capabilities/mock.json, so local dev can exercise the regenerate menu.
ALTERNATES = {"frame": {"mock-hq"}, "clip": {"mock-hq"}}

Fetch = Callable[[str], bytes]


def _blank(size: int = 1024) -> Image.Image:
    return Image.new("RGB", (size, size), (200, 200, 205))


def stamp(png_or_jpeg: Optional[bytes], label: str) -> tuple[bytes, int, int]:
    """Draw a MOCK banner on the image (or a blank canvas) and return PNG bytes."""
    img = Image.open(io.BytesIO(png_or_jpeg)).convert("RGB") if png_or_jpeg else _blank()
    w, h = img.size
    draw = ImageDraw.Draw(img)
    size = max(24, h // 10)
    font = ImageFont.load_default(size=size)
    box = draw.textbbox((0, 0), label, font=font)
    tw, th = box[2] - box[0], box[3] - box[1]
    pad = size // 3
    draw.rectangle((0, 0, tw + 2 * pad, th + 2 * pad), fill=(220, 30, 30))
    draw.text((pad - box[0], pad - box[1]), label, fill="white", font=font)
    out = io.BytesIO()
    img.save(out, format="PNG")
    return out.getvalue(), w, h


class MockProvider:
    name = "mock"

    def __init__(self, assets: AssetResolver, fetch: Fetch, delay_s: float = 2.0,
                 clock: Callable[[], float] = time.monotonic, sheet: Optional[dict] = None):
        self._assets, self._fetch, self._delay = assets, fetch, delay_s
        self._clock, self._sheet = clock, sheet or load_sheet("mock")
        self._jobs: dict[str, dict] = {}
        self.requests: list[dict] = []  # the request each submit would have sent

    def capabilities(self) -> dict:
        return self._sheet

    def submit(self, job: ProviderJob) -> str:
        check_capabilities(effective_sheet(self._sheet, job.op, job.model), job)
        request = {"op": job.op, "model": job.model, "prompt": job.prompt,
                   "refs": [r.name for r in job.refs]}
        if job.op in VIDEO_OPS:
            request["audio"] = video_audio(job)  # explicit on every video request
        self.requests.append(request)
        request_id = f"mock_{uuid.uuid4().hex[:12]}"
        # The input is resolved now: status() runs outside the job's context, where the
        # relay's asset URLs are gone, so a lookup then fails ("no URL for asset").
        sha = self._source_sha(job)
        self._jobs[request_id] = {"job": job, "at": self._clock(), "cancelled": False,
                                  "source": self._assets(sha).url if sha else None}
        return request_id

    @staticmethod
    def _source_sha(job: ProviderJob) -> Optional[str]:
        """The image to stamp: the first frame, else the marked/current ref, else any ref."""
        sha = job.first_frame
        if not sha and job.keyframe:
            sha = job.keyframe["sha256"]
        if not sha:
            by_role = {r.role: r.sha256 for r in reversed(job.refs)}
            sha = by_role.get("current") or by_role.get("marked") or (job.refs[0].sha256 if job.refs else None)
        return sha

    def status(self, request_id: str) -> Status:
        entry = self._jobs.get(request_id)
        if entry is None:
            return Status("failed", error=ProviderError("provider_failed", "unknown mock request", False), kind="mock")
        if entry["cancelled"]:
            return Status("cancelled", kind="mock")
        elapsed = self._clock() - entry["at"]
        if elapsed < self._delay / 2:
            return Status("queued", queue_position=2 if elapsed < self._delay / 4 else 1, kind="mock")
        if elapsed < self._delay:
            return Status("running", queue_position=0, kind="mock")
        job = entry["job"]
        try:
            source = self._fetch(entry["source"]) if entry["source"] else None
        except Exception as exc:  # an unfetchable input is a provider failure, not a crash
            return Status("failed", kind="mock",
                          error=ProviderError("provider_failed", f"mock could not read its input: {exc}", True))
        n = max(1, job.outputs or 1)
        outputs = []
        for i in range(n):
            data, w, h = stamp(source, "MOCK" if n == 1 else f"MOCK {i + 1}/{n}")
            outputs.append(ProviderOutput(url=f"mock://{request_id}/{i}", mime="image/png", w=w, h=h,
                                          duration_s=job.duration_s if job.op in VIDEO_OPS else None,
                                          data=data))
        return Status("done", queue_position=0, outputs=outputs, kind="mock", cost_usd=0.0)

    def cancel(self, request_id: str) -> None:
        if request_id in self._jobs:
            self._jobs[request_id]["cancelled"] = True


def make():
    """The relay's registry entry (providers/__init__.py): this adapter behind the relay's Protocol."""
    from ._seam import Adapted, Resolver, fetch
    return Adapted(MockProvider(Resolver(), fetch))
