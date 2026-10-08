"""The director: one job input plus the routed provider's capability sheet in, strict JSON out.

The output is director.schema.json: one providerJob for an image or video op, shots for
shot_list, plus needsUser, rationale and confidence. The model port (model.py) enforces the
schema with one retry and then fails loudly; this module adds what a schema cannot say: the job
must pass the routed sheet (base.check_capabilities), name only refs it was given, and write
only @tags the adapter can rewrite.
"""

from __future__ import annotations

import json
import re
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Optional

from jsonschema import Draft202012Validator, FormatChecker
from referencing import Registry, Resource

from providers import CapabilityMissing, ProviderJob, check_capabilities
from providers.types import CONTRACTS, IMAGE_OPS
from providers.tags import UnknownTag, rewrite_tags

from .base import fit_duration, view_angle
from .model import ModelPort, Usage

BASE = "https://napkin.ie/production-tool/contracts/"
PURPOSE = "director"
TAG = re.compile(r"^[a-z][a-z0-9_]{2,15}$")
SHA = re.compile(r"sha256:[0-9a-f]{64}")
VIDEO_OPS = ("clip", "clip_edit")

# What the provider's endpoint accepts that a schema or sheet cannot say (provider docs, checked 2026-10-06).
# Runway's image ratios are pixel pairs, a different list per model (openapi: text_to_image).
FLASH_RATIOS = frozenset("""
512:512 416:624 624:416 432:592 592:432 448:576 576:448 384:672 672:384 768:336 256:1024 1024:256
176:1408 1408:176 1024:1024 832:1248 1248:832 864:1184 1184:864 896:1152 1152:896 768:1344 1344:768
1536:672 512:2048 2048:512 352:2816 2816:352 2048:2048 1696:2528 2528:1696 1792:2400 2400:1792
1856:2304 2304:1856 1536:2752 2752:1536 3168:1344 1024:4096 4096:1024 704:5632 5632:704 4096:4096
3392:5056 5056:3392 3584:4800 4800:3584 3712:4608 4608:3712 3072:5504 5504:3072 6336:2688 2048:8192
8192:2048 1408:11264 11264:1408
""".split())
PRO_RATIOS = frozenset("""
1344:768 768:1344 1024:1024 1184:864 864:1184 1536:672 832:1248 1248:832 896:1152 1152:896 2048:2048
1696:2528 2528:1696 1792:2400 2400:1792 1856:2304 2304:1856 1536:2752 2752:1536 3168:1344 4096:4096
3392:5056 5056:3392 3584:4800 4800:3584 3712:4608 4608:3712 3072:5504 5504:3072 6336:2688
""".split())
RUNWAY_CLIP_RATIOS = frozenset(("1280:720", "720:1280", "1080:1920", "1920:1080"))
# Endpoints that take no usable ratio: the output keeps the input's shape (or the endpoint has no such field).
NO_RATIO = {("runway", "clip_edit"), ("fal", "clip_edit"), ("fal", "clip"), ("heygen", "clip")}
# Longest prompt per provider and op kind; a longer one is a 400 from the provider.
PROMPT_MAX = {("runway", "clip"): 1000, ("runway", "clip_edit"): 1000, ("runway", "image"): 5500,
              ("fal", "clip"): 2500, ("fal", "clip_edit"): 2500, ("fal", "image"): 2500}
KEYFRAME_MAX_S = 30  # Runway aleph2 keyframe seconds run 0 to 30



_VIEW_WORDS = {0: "front", 45: "three-quarter", 90: "side", 180: "back", 270: "side", 315: "three-quarter"}


def _drop_unusable(job: dict, op: str, sheet: dict) -> None:
    """Remove a camera angle the routed provider cannot take, instead of failing the job.

    The prompt tells the model not to send them, but it sometimes does (2026-10-07: Haiku sent a
    camera `angle` for a Runway view, which has no angle control, and the whole job failed).
    Dropping it is safe: a view is said in words instead. Other stray fields still fail, by design."""
    spec = sheet["ops"].get(op, {})
    if op == "clip" and "durationS" in job:
        job["durationS"] = fit_duration(job["durationS"], spec)
    if "angle" in job and not sheet.get("angles"):
        angle = job.pop("angle")
        if op == "view":
            word = _VIEW_WORDS.get(int(round(angle.get("horizontal", 0))) % 360)
            if word and word.split("-")[0] not in job["prompt"].lower():
                job["prompt"] = f"{job['prompt'].rstrip()} Show the {word} view."


def _clip_edit_source(job: dict, op: str, payload: dict) -> None:
    """A clip edit always carries the clip it changes, first, as `current`: the adapters find it
    there (fal by role, Runway by its video type). The model sometimes leaves it out (recorded
    reply for a masked fal edit: refs []), and every such job failed (pathway matrix, 2026-10-08)."""
    video = payload.get("video")
    if op != "clip_edit" or not video:
        return
    refs = [r for r in job.get("refs") or [] if r.get("sha256") != video["sha256"]]
    job["refs"] = [{"sha256": video["sha256"], "name": "current", "role": "current"}, *refs]


def _clip_frame_only(job: dict, op: str, sheet: dict) -> None:
    """Called after the artifact checks, so a ref that is not in the input still fails."""
    if op == "clip" and job.get("firstFrame") and job.get("refs") and not sheet["video"]["firstFrameWithRefs"]:
        # 2026-10-07: every Runway clip failed ("cannot take a first frame together with refs").
        # The first frame is the storyboard frame, which already shows the character: keep it,
        # drop the refs, and say their names in words so the prompt names no missing ref.
        for ref in job["refs"]:
            words = "the character" if ref["role"] == "character" else ref["name"].replace("_", " ")
            job["prompt"] = re.sub(rf"@{re.escape(ref['name'])}\b", words, job["prompt"])
        job["refs"] = []


def provider_ratio(provider: str, op: str, ratio: Optional[str], model: Optional[str] = None) -> Optional[str]:
    """Our ratio ('9:16') in the provider's form: None where the endpoint takes none; Runway's
    nearest allowed pixel pair for the model (Gemini 3 Pro and 3.1 Flash take different sizes);
    W:H as it is for the others."""
    if not ratio or (provider, op) in NO_RATIO:
        return None
    if provider != "runway":
        return ratio
    pro = model == "gemini_image3_pro" or (model is None and op == "region_edit")
    allowed = RUNWAY_CLIP_RATIOS if op == "clip" else PRO_RATIOS if pro else FLASH_RATIOS
    return ratio if ratio in allowed else _nearest_ratio(ratio, allowed)


def _nearest_ratio(ratio: str, allowed) -> Optional[str]:
    """For a plain ratio ('9:16', '4:5', '16:9'; both terms 32 or less), the allowed 'W:H' of nearly the
    same shape and closest to 1 MP. Pixel sizes ('1080:1350') are left alone: those must match exactly."""
    import math
    try:
        w, h = (int(x) for x in ratio.split(":"))
    except ValueError:
        return None
    if not allowed or not (0 < w <= 32 and 0 < h <= 32):
        return None
    target = math.log(w / h)

    def shape(r: str) -> float:
        a, b = (int(x) for x in r.split(":"))
        return abs(math.log(a / b) - target)

    def area(r: str) -> float:
        a, b = (int(x) for x in r.split(":"))
        return abs(math.log(a * b / 1_048_576))

    best = min(shape(r) for r in allowed)
    return min((r for r in allowed if shape(r) <= best + 0.04), key=area)


class DirectorError(Exception):
    """The director's answer cannot be used: it breaks the routed sheet or the job's own facts."""


@dataclass
class DirectorResult:
    output: dict       # validated against director.schema.json
    agent_block: dict  # director.schema.json#/$defs/agentBlock, logged with the job
    usage: dict        # {"input_tokens", "output_tokens"} the model reported


def load_schemas(root: Path = CONTRACTS) -> dict:
    return {p.name: json.loads(p.read_text()) for p in root.glob("*.schema.json")}


def _inline(node, schemas: dict, file: str, stack: tuple = ()):
    """Copy of `node` with every $ref replaced by what it points at (the port's validator
    and the provider's strict mode take one self-contained schema, not a file set)."""
    if isinstance(node, list):
        return [_inline(x, schemas, file, stack) for x in node]
    if not isinstance(node, dict):
        return node
    if "$ref" not in node:
        return {k: _inline(v, schemas, file, stack) for k, v in node.items()}
    target_file, _, pointer = node["$ref"].partition("#")
    target_file = target_file or file
    if (target_file, pointer) in stack:
        raise ValueError(f"recursive $ref {node['$ref']}")
    target = schemas[target_file]
    for part in filter(None, pointer.split("/")):
        target = target[part]
    resolved = _inline(target, schemas, target_file, stack + ((target_file, pointer),))
    # Keywords beside a $ref (a description) override the target's.
    return {**resolved, **{k: _inline(v, schemas, file, stack) for k, v in node.items() if k != "$ref"}}


def bundle(schemas: dict, name: str = "director.schema.json") -> dict:
    out = _inline(schemas[name], schemas, name)
    for key in ("$id", "$defs"):
        out.pop(key, None)
    return out


def _hashes(node) -> set:
    return set(SHA.findall(json.dumps(node)))


def _without_dialogue(op: str, payload: dict) -> dict:
    """A shot's dialogue is voice-over: a model told the words draws them (a "Dialogue - ..."
    caption box in a frame, then in every clip made from it; decided 2026-10-07). The web app no
    longer sends it for frames and clips; this keeps it from an older page or another client too."""
    shot = payload.get("shot")
    if op == "shot_list" or not isinstance(shot, dict) or "dialogue" not in shot:
        return payload
    return {**payload, "shot": {k: v for k, v in shot.items() if k != "dialogue"}}


class Director:
    def __init__(self, model_port: ModelPort, prompt_dir: Path, sheets: dict, *,
                 per_click_model: str = "claude-haiku-4-5", shot_list_model: str = "claude-sonnet-5-5",
                 prompt_version: str = "director.v4", contracts: Path = CONTRACTS):
        self.port = model_port
        self.sheets = sheets
        self.per_click_model, self.shot_list_model = per_click_model, shot_list_model
        self.prompt_version = prompt_version
        self.system = (Path(prompt_dir) / f"{prompt_version}.md").read_text()
        schemas = load_schemas(contracts)
        self.schema = bundle(schemas)
        registry = Registry().with_resources((BASE + n, Resource.from_contents(s)) for n, s in schemas.items())
        self._validate = lambda name, pointer="": Draft202012Validator(
            {"$ref": BASE + name + pointer}, registry=registry, format_checker=FormatChecker())

    def run(self, op: str, payload: dict, provider_name: Optional[str] = None, job_id: str = "",
            extra_hashes: tuple = ()) -> DirectorResult:
        """`payload` is the job's input (relay-api.schema.json#/$defs/JobInput). shot_list needs
        no provider, so `provider_name` may be None for it. `extra_hashes` are artifacts the relay
        made itself and the job may name though the input does not (a clip_edit keyframe)."""
        sheet = None
        if op != "shot_list":
            sheet = self.sheets.get(provider_name)
            if sheet is None:
                raise DirectorError(f"no capability sheet for provider {provider_name!r}")
            if op not in sheet["ops"]:
                raise DirectorError(f"{provider_name} does not support {op}")
        model = self.shot_list_model if op == "shot_list" else self.per_click_model
        payload = _without_dialogue(op, payload)
        ask = {"op": op, "input": payload}
        if sheet:
            ask["provider"] = provider_name
            ask["sheet"] = sheet

        usage = Usage()
        t0 = time.monotonic()
        output = self.port.call(PURPOSE, self.system, ask, self.schema, usage=usage,
                                attribution=job_id or op, model=model,
                                max_tokens=6000 if op == "shot_list" else 3000)
        latency_ms = round((time.monotonic() - t0) * 1000)

        if op in VIDEO_OPS and "providerJob" in output:
            output["providerJob"].setdefault("audio", False)  # explicit on every video request
        self._check(op, payload, provider_name, sheet, output, set(extra_hashes))
        agent_block = {"model": model, "promptVersion": self.prompt_version, "output": output,
                       "rationale": output["rationale"], "latencyMs": latency_ms}
        errs = list(self._validate("director.schema.json", "#/$defs/agentBlock").iter_errors(agent_block))
        if errs:
            raise DirectorError(f"agent block: {errs[0].message}")
        return DirectorResult(output, agent_block, usage.as_dict())

    def _check(self, op, payload, provider_name, sheet, output, extra=frozenset()) -> None:
        errs = sorted(self._validate("director.schema.json").iter_errors(output), key=lambda e: list(e.path))
        if errs:
            raise DirectorError("; ".join(f"{'/'.join(map(str, e.path)) or '$'}: {e.message}" for e in errs[:5]))
        if output["op"] != op:
            raise DirectorError(f"answered op {output['op']!r} for {op!r}")
        if op == "shot_list":
            self._check_shots(payload, output["shots"])
            return
        if "shots" in output:
            raise DirectorError(f"shots belong to shot_list, not {op}")
        if "providerJob" not in output:
            return  # a question for the user; there is nothing to submit yet
        if output["needsUser"] is not None:
            raise DirectorError("answered with a question and a job; send one or the other")
        job = output["providerJob"]
        if "ratio" not in job and payload.get("ratio") and (job.get("provider"), op) not in NO_RATIO:
            # 2026-10-07: Haiku sometimes leaves out the ratio it was given ("frame needs a ratio").
            # Take it from the request; the nearest-size mapping below makes it fit the model.
            job["ratio"] = payload["ratio"]
        if "angle" not in job:
            # A model that leaves out a view's angle would fail the job on an angle-taking provider.
            angle = view_angle(op, payload, sheet)
            if angle:
                job["angle"] = angle
        _drop_unusable(job, op, sheet)
        _clip_edit_source(job, op, payload)
        if job["provider"] != provider_name:
            raise DirectorError(f"wrote a {job['provider']} job for the routed provider {provider_name}")
        models = {sheet["ops"][op]["model"], sheet["ops"][op].get("regionModel")}
        if job["model"] not in models:
            # The routing chose the model, not the director: a reply naming another one (an older
            # default, a recorded answer) runs on the sheet's (features/default-models.clan).
            job["model"] = sheet["ops"][op]["model"]
        stray = _hashes(job) - _hashes(payload) - extra
        if stray:
            raise DirectorError(f"the job names artifacts that are not in the input: {sorted(stray)[0]}")
        _clip_frame_only(job, op, sheet)
        names = [r["name"] for r in job["refs"]]
        if len(set(names)) != len(names) or not all(TAG.match(n) for n in names):
            raise DirectorError(f"ref names must be unique canonical tags: {names}")
        if any(r["role"].startswith("element") for r in job["refs"]) and not sheet["refs"]["element"]:
            raise DirectorError(f"{provider_name} has no elements")
        if "keyframe" in job:
            if sheet["video"]["regionEdit"] != "temporal_keyframe":
                raise DirectorError(f"{provider_name} takes no keyframe edit")
            self._check_keyframe(job["keyframe"])
        if "strength" in job and sheet["video"]["feelEdit"] != "strength":
            raise DirectorError(f"{provider_name} takes no edit strength")
        self._check_provider_limits(op, sheet, job)
        try:
            rewrite_tags(job["prompt"], names, sheet["tagSyntax"])
            check_capabilities(sheet, ProviderJob.from_director(op, job))
        except (CapabilityMissing, UnknownTag) as e:
            raise DirectorError(str(e)) from e
        if op == "region_edit":
            self._check_region_edit(payload, sheet, job)

    @staticmethod
    def _check_keyframe(kf: dict) -> None:
        # aleph2 takes the range whole or not at all, end exclusive, and keyframe seconds 0..30.
        start, end, at = kf.get("startS"), kf.get("endS"), kf["atS"]
        if (start is None) != (end is None):
            raise DirectorError("keyframe startS and endS go together")
        if start is not None and not start <= at < end:
            raise DirectorError(f"keyframe atS {at} is outside the range {start}..{end} (end exclusive)")
        if at > KEYFRAME_MAX_S:
            raise DirectorError(f"keyframe atS {at} is past {KEYFRAME_MAX_S} s")

    @staticmethod
    def _check_region_edit(payload: dict, sheet: dict, job: dict) -> None:
        image = payload["image"]["sha256"]
        if not any(r["role"] == "current" and r["sha256"] == image for r in job["refs"]):
            raise DirectorError("a region edit needs the edited image as a ref with role current")
        region, mask = payload.get("region"), payload.get("mask")
        # Masked wherever the sheet takes masks, whatever the box's size: fal's edit model cannot
        # regenerate from a reference, so a large box sent without its mask could never run there
        # (features/harness-refusals.clan; the 25% rule is gone).
        masked = bool(region and mask and sheet["mask"] != "none")
        if masked and job.get("mask") != mask["sha256"]:
            raise DirectorError("a region with a mask on a sheet that takes masks is a masked inpaint: send the mask")
        if not masked and job.get("mask"):
            raise DirectorError("this region is a reference-based regenerate (no mask, or the sheet takes none): send no mask")
        if masked:
            # Only the image goes with a mask (director.v4): an edit model copies other pictures into
            # the mask, so the anchor and previous frames are dropped if the model sent them.
            anchors = {a["sha256"] for a in (payload.get("anchorFrame"), payload.get("previousFrame")) if a}
            dropped = {r["name"] for r in job["refs"] if r["role"] != "current" and r["sha256"] in anchors}
            job["refs"] = [r for r in job["refs"] if r["role"] == "current" or r["sha256"] not in anchors]
            for name in dropped:  # their @tags would name a picture the job no longer carries
                job["prompt"] = re.sub(rf"@{re.escape(name)}\b", f"the {name} frame", job["prompt"])

    @staticmethod
    def _check_provider_limits(op: str, sheet: dict, job: dict) -> None:
        provider, kind = job["provider"], "image" if op in IMAGE_OPS else op
        limit = PROMPT_MAX.get((provider, kind))
        if limit and len(job["prompt"]) > limit:
            raise DirectorError(f"{provider} {op} prompt is {len(job['prompt'])} characters, over its {limit}")
        ratio = job.get("ratio")
        if ratio and (provider, op) in NO_RATIO:
            raise DirectorError(f"{provider} {op} takes no ratio")
        if ratio and provider == "runway":
            # The model often writes the plain ratio it was given ('9:16'); map it to the nearest
            # size this model takes rather than failing the job (2026-10-07: storyboard frames).
            fitted = provider_ratio(provider, op, ratio, job.get("model"))
            if not fitted:
                raise DirectorError(f"runway {op} does not take ratio {ratio!r}")
            job["ratio"] = fitted
        spec = sheet["ops"][op]
        if op == "clip" and "durationS" not in job and ("durationsS" in spec or "minS" in spec):
            raise DirectorError("a clip needs a durationS the sheet allows")
        if op == "clip_edit" and "durationS" in job and (
                job["model"] == spec.get("regionModel") != spec["model"] or sheet["video"]["regionEdit"] == "temporal_keyframe"):
            raise DirectorError(f"{provider} takes no duration for this clip edit")

    @staticmethod
    def _check_shots(payload: dict, shots: list) -> None:
        if [s["order"] for s in shots] != list(range(1, len(shots) + 1)):
            raise DirectorError("shot orders must run 1..n")
        if len({s["id"] for s in shots}) != len(shots):
            raise DirectorError("shot ids must be unique")
        known = {r["name"] for r in payload.get("refs") or [] if r.get("name")}
        # A bare key names the whole character, and only a key with a front can be named bare.
        known |= {n.split("_", 1)[0] for n in known if n.endswith("_front")}
        for s in shots:
            unknown = [n for n in s.get("refs") or [] if n not in known]
            if unknown:
                raise DirectorError(f"shot {s['order']} names {unknown[0]!r}, which is not an input ref")
        target = payload.get("targetS")
        total = sum(s["duration_s"] for s in shots)
        if target is not None and total != target:
            raise DirectorError(f"shots add up to {total} s, not the {target} s asked for")
