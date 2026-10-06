"""Run one region edit end to end, with the provider and I/O injected.

The caller owns pacing: `wait` polls however it likes (no sleeping here), and
`upload` / `fetch` are the relay's artifact store and downloader.

Providers whose sheet has mask == "none" (Runway) get a copy of the image with the
box drawn on it, beside the clean one. Others get a real mask. Either way the
raw result is checked against the original, then pasted back, since inpainting
leaks too. The check runs on the raw result: after paste-back nothing can leak.
"""

from __future__ import annotations

import io
from dataclasses import dataclass, replace
from typing import Callable, Optional

from PIL import Image

from providers.types import AssetRef, Provider, ProviderError, ProviderJob, Ref, Status

from .image_ops import DEFAULT_THRESHOLDS, draw_box, inside_box_ok, mask_png, paste_back, pixel_diff

BOX_COLOUR = (255, 0, 0)
BOX_WIDTH_PX = 4
MARGIN_PX = 0

# The sheet's mask kinds. The pipeline always uploads our convention (white = change); the adapter
# converts it to its endpoint's polarity, so converting here as well would flip it twice.
MASK_KINDS = ("png_white_edit", "png_black_edit")

Upload = Callable[[bytes, str], AssetRef]
Fetch = Callable[[str], bytes]
Wait = Callable[[Provider, str], Status]


@dataclass
class RegionResult:
    ok: bool
    png: Optional[bytes]
    metrics: Optional[dict]
    attempts: int
    reason: Optional[str] = None
    kind: Optional[str] = None  # the last status's kind: 'mock' never counts as a real edit


def _reason(metrics: dict) -> str:
    t = DEFAULT_THRESHOLDS
    if (metrics["outside_changed_fraction"] > t["max_outside_changed_fraction"]
            or metrics["mean_abs_diff"] > t["max_outside_mean_abs_diff"]):
        return "the edit changed pixels outside the box"
    return "the edit changed nothing inside the box"


def _same_ratio(a: tuple[int, int], b: tuple[int, int]) -> bool:
    """Equal aspect ratio to within 1%: a different one is cropped by paste-back, so nothing lines up."""
    return abs(a[0] * b[1] - a[1] * b[0]) <= 0.01 * a[1] * b[0]


def run_region_edit(provider: Provider, base_job: ProviderJob, original_png: bytes, region: dict,
                    upload: Upload, fetch: Fetch, wait: Wait, retries: int = 1) -> RegionResult:
    current = upload(original_png, "image/png")
    mask_kind = provider.capabilities()["mask"]
    if mask_kind != "none" and mask_kind not in MASK_KINDS:
        raise ValueError(f"unknown mask kind {mask_kind!r} in the sheet")
    size = Image.open(io.BytesIO(original_png)).size
    if mask_kind == "none":
        marked = upload(draw_box(original_png, region, BOX_COLOUR, BOX_WIDTH_PX), "image/png")
        refs = [Ref(current.sha256, "current", "current"), Ref(marked.sha256, "marked", "marked")]
        mask_sha = None
    else:
        mask = mask_png(size, region)
        refs = [Ref(current.sha256, "current", "current")]
        mask_sha = upload(mask, "image/png").sha256
    # snapping to the provider's ratio list is the caller's job; this is only the original's own
    ratio = base_job.ratio or f"{size[0]}:{size[1]}"
    job = replace(base_job, op="region_edit", ratio=ratio, region=region, mask=mask_sha, refs=refs + list(base_job.refs))

    metrics, reason, kind = None, None, None
    for attempt in range(1, retries + 2):
        try:
            status = wait(provider, provider.submit(job))
        except ProviderError as exc:
            status = Status("failed", error=exc)
        kind = status.kind
        if status.state != "done" or not status.outputs:
            error = status.error or ProviderError("provider_failed", f"the job ended {status.state}")
            reason = f"{error.code}: {error.message}"
            if not error.retryable:  # a moderated or invalid job never goes again
                return RegionResult(False, None, metrics, attempt, reason, kind)
            continue
        out = status.outputs[0]
        edited = out.data if out.data is not None else fetch(out.url)
        got = Image.open(io.BytesIO(edited)).size
        if not _same_ratio(got, size):  # the same inputs would give the same shape, so no retry
            reason = f"the result is {got[0]}x{got[1]}, not the original's shape {size[0]}x{size[1]}"
            return RegionResult(False, None, metrics, attempt, reason, kind)
        metrics = pixel_diff(original_png, edited, region, MARGIN_PX)
        if inside_box_ok(metrics):
            return RegionResult(True, paste_back(original_png, edited, region, MARGIN_PX), metrics, attempt, None, kind)
        reason = _reason(metrics)
    return RegionResult(False, None, metrics, retries + 1, reason, kind)
