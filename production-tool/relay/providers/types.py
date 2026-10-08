"""The harness lane's adapter types (production-tool/contracts/README.md, "The adapter interface").

The adapters (runway, fal, heygen, mock) are written against these. The relay
sees them through providers/_seam.py, which wraps each one in the relay's own
Protocol (providers/base.py): providerJob dict in, base.Status out.

The relay owns the ledger, quotas, queue, S3 copies and routing. An adapter owns
the exact provider request: field names, mask polarity, explicit audio, and the
provider's error codes mapped onto ours (common.schema.json#/$defs/error).
"""

from __future__ import annotations

import copy
import json
import math
from dataclasses import dataclass, field
from pathlib import Path
from typing import Callable, Literal, Optional, Protocol

from contracts_dir import contracts_dir

# The bundled copy in the Lambda zip, else production-tool/contracts (contracts_dir.py).
CONTRACTS = contracts_dir()

IMAGE_OPS = ("generate", "view", "frame", "region_edit")
VIDEO_OPS = ("clip", "clip_edit")

StatusState = Literal["queued", "running", "done", "failed", "cancelled"]
Kind = Literal["generated", "mock"]


class CapabilityMissing(Exception):
    """The sheet rules the job out. Raised by submit, never a provider call."""


class ProviderError(Exception):
    """A provider failure, already mapped onto our error codes."""

    def __init__(self, code: str, message: str, retryable: bool = False,
                 retry_after_s: Optional[int] = None, provider_code: Optional[str] = None):
        super().__init__(message)
        self.code, self.message, self.retryable = code, message, retryable
        self.retry_after_s, self.provider_code = retry_after_s, provider_code

    def to_dict(self) -> dict:
        out = {"code": self.code, "message": self.message, "retryable": self.retryable}
        if self.retry_after_s is not None:
            out["retryAfterS"] = self.retry_after_s
        if self.provider_code:
            out["providerCode"] = self.provider_code
        return out


@dataclass(frozen=True)
class AssetRef:
    """common.schema.json#/$defs/assetRef: an artifact with our CloudFront URL."""
    sha256: str
    url: str
    mime: str


@dataclass(frozen=True)
class Ref:
    sha256: str
    name: str
    role: str


@dataclass
class ProviderJob:
    """director.schema.json#/$defs/providerJob plus its `op`.

    The contract's providerJob carries no `op`, yet an adapter needs it to pick an
    endpoint, so it travels beside the job. Raised with the owner (contract gap).
    """
    op: str
    provider: str
    model: str
    prompt: str
    refs: list[Ref] = field(default_factory=list)
    negative: Optional[str] = None
    first_frame: Optional[str] = None
    last_frame: Optional[str] = None
    mask: Optional[str] = None
    region: Optional[dict] = None
    keyframe: Optional[dict] = None
    angle: Optional[dict] = None
    ratio: Optional[str] = None
    duration_s: Optional[float] = None
    seed: Optional[int] = None
    audio: Optional[bool] = None
    outputs: Optional[int] = None
    strength: Optional[str] = None

    @classmethod
    def from_director(cls, op: str, job: dict) -> "ProviderJob":
        """Build from the director's camelCase providerJob. A clip_edit's source clip may come as
        `video` (director.schema.json) rather than a ref; adapters find it as the `current` ref."""
        refs = [Ref(r["sha256"], r["name"], r["role"]) for r in job.get("refs", [])]
        if job.get("video") and not any(r.sha256 == job["video"] for r in refs):
            refs.insert(0, Ref(job["video"], "current", "current"))
        return cls(
            op=op, provider=job["provider"], model=job["model"], prompt=job["prompt"],
            refs=refs,
            negative=job.get("negative"), first_frame=job.get("firstFrame"),
            last_frame=job.get("lastFrame"), mask=job.get("mask"), region=job.get("region"),
            keyframe=job.get("keyframe"), angle=job.get("angle"), ratio=job.get("ratio"),
            duration_s=job.get("durationS"), seed=job.get("seed"), audio=job.get("audio"),
            outputs=job.get("outputs"), strength=job.get("strength"),
        )


@dataclass
class ProviderOutput:
    """One result. `url` is the provider's (expires); the relay copies it to S3.
    `data` carries the bytes when there is no URL to fetch (the Mock)."""
    url: str
    mime: str
    w: Optional[int] = None
    h: Optional[int] = None
    duration_s: Optional[float] = None
    data: Optional[bytes] = None


@dataclass
class Status:
    state: StatusState
    queue_position: Optional[int] = None
    outputs: list[ProviderOutput] = field(default_factory=list)
    error: Optional[ProviderError] = None
    kind: Kind = "generated"
    cost_usd: Optional[float] = None


# The relay resolves a content hash to the CloudFront URL providers read.
AssetResolver = Callable[[str], AssetRef]


class Provider(Protocol):
    name: str

    def capabilities(self) -> dict: ...

    def submit(self, job: ProviderJob) -> str:
        """Send the job and return the provider's request id. Raise CapabilityMissing
        if the sheet rules it out. Never wait for the result here."""
        ...

    def status(self, request_id: str) -> Status: ...

    def cancel(self, request_id: str) -> None: ...


def load_sheet(name: str, root: Path = CONTRACTS) -> dict:
    return json.loads((root / "capabilities" / f"{name}.json").read_text())


# What an alternate may replace at the sheet level (capabilities.schema.json ops[op].alternates).
SHEET_OVERRIDES = ("tagSyntax", "refs", "series", "outputsPerCall", "video")
DURATION_FIELDS = ("durationsS", "minS", "maxS")


def op_models(sheet: dict, op: str) -> list[str]:
    """The models a participant may pick for `op` on this sheet: its own first, then its alternates."""
    spec = sheet["ops"].get(op)
    if spec is None:
        return []
    return [spec["model"]] + [a["model"] for a in spec.get("alternates", [])]


def effective_sheet(sheet: dict, op: str, model: Optional[str]) -> dict:
    """The sheet as `model` running `op` sees it (features/model-choice.clan).

    For the op's own model (or its regionModel, or None) that is the sheet itself. For one of
    the op's alternates it is a copy whose ops[op] holds the alternate's fields (its durations
    replace the op's when it gives any), and whose sheet-level tagSyntax, refs, series,
    outputsPerCall, video and seed are the alternate's where it sets them. The director, the
    capability check, the estimate and the adapter all read this one view. Any other model gets
    the sheet itself."""
    spec = sheet["ops"].get(op)
    if spec is None or model is None or model in (spec["model"], spec.get("regionModel")):
        return sheet
    alt = next((a for a in spec.get("alternates", []) if a["model"] == model), None)
    if alt is None:  # not a pick: the relay refuses unknown picks before this, the director checks models
        return sheet
    out = copy.deepcopy(sheet)
    merged = {k: copy.deepcopy(v) for k, v in alt.items() if k not in SHEET_OVERRIDES}
    if not any(k in alt for k in DURATION_FIELDS):
        merged.update({k: copy.deepcopy(spec[k]) for k in DURATION_FIELDS if k in spec})
    out["ops"][op] = merged
    for key in SHEET_OVERRIDES:
        if key in alt:
            out[key] = copy.deepcopy(alt[key])
    if "seed" in alt:
        out["seed"] = alt["seed"]
    return out


def nearest_ratio(ratio: str, allowed: tuple[str, ...]) -> str:
    """The allowed W:H closest in shape to `ratio` (plain 4:5 or pixels 896:1152), for endpoints
    that take a fixed list (fal Kling image has no 4:5; HeyGen reference_to_video)."""
    if ratio in allowed:
        return ratio
    try:
        w, h = (float(x) for x in ratio.split(":"))
        target = math.log(w / h)
    except (ValueError, ZeroDivisionError):
        return allowed[0]

    def shape(r: str) -> float:
        a, b = (float(x) for x in r.split(":"))
        return abs(math.log(a / b) - target)
    return min(allowed, key=shape)


def check_capabilities(sheet: dict, job: ProviderJob) -> None:
    """Refuse early what the sheet rules out (the director should never ask)."""
    op = sheet["ops"].get(job.op)
    if op is None:
        raise CapabilityMissing(f"{sheet['provider']} does not support {job.op}")
    if job.mask and sheet["mask"] == "none":
        raise CapabilityMissing(f"{sheet['provider']} takes no mask")
    if job.seed is not None and not sheet["seed"]:
        raise CapabilityMissing(f"{sheet['provider']} takes no seed")
    if job.angle and not sheet["angles"]:
        raise CapabilityMissing(f"{sheet['provider']} cannot set a camera angle")
    if job.last_frame and not sheet["video"]["lastFrame"]:
        raise CapabilityMissing(f"{sheet['provider']} takes no last frame")
    if job.first_frame and job.refs and not sheet["video"]["firstFrameWithRefs"] and job.op == "clip":
        raise CapabilityMissing(f"{sheet['provider']} cannot take a first frame together with refs")
    if len(job.refs) > sheet["refs"]["max"]:
        raise CapabilityMissing(f"{sheet['provider']} takes at most {sheet['refs']['max']} refs")
    if sum(r.role == "character" for r in job.refs) > sheet["refs"]["maxCharacter"]:
        raise CapabilityMissing(f"{sheet['provider']} takes at most {sheet['refs']['maxCharacter']} character refs")
    if job.outputs and job.outputs > sheet["outputsPerCall"]:
        raise CapabilityMissing(f"{sheet['provider']} returns at most {sheet['outputsPerCall']} outputs per call")
    if job.duration_s is not None:
        if "durationsS" in op and job.duration_s not in op["durationsS"]:
            raise CapabilityMissing(f"{job.op} duration must be one of {op['durationsS']}")
        if "minS" in op and job.duration_s < op["minS"] or "maxS" in op and job.duration_s > op["maxS"]:
            raise CapabilityMissing(f"{job.op} duration must be {op.get('minS')}-{op.get('maxS')} s")


def video_audio(_job: ProviderJob) -> bool:
    """Audio is always sent explicitly; Wednesday has none (director.schema: const false)."""
    return False
