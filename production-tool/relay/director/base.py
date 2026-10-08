"""The director hook (harness lane fills it in).

`direct(job_request, sheet) -> dict` returns an object matching
contracts/director.schema.json: for shot_list, {"op", "shots", "needsUser",
"rationale", "confidence"}; for every other op a providerJob in the routed
provider's syntax. `sheet` is the routed provider's capability sheet (None for
shot_list, which has no provider).

The relay adds the agent block it logs: {"model", "promptVersion", "output",
"rationale", "latencyMs"}. A director may return "_model" and "_promptVersion"
keys to fill it; they are stripped before validation.
"""

from __future__ import annotations

import hashlib
import math
import os
import time
from typing import Protocol

_CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"


def new_id(prefix: str, seed: str = "") -> str:
    """A prefixed ULID: 48-bit ms time + 80 bits (random, or derived from seed)."""
    ms = int(time.time() * 1000)
    tail = hashlib.sha256(seed.encode()).digest()[:10] if seed else os.urandom(10)
    n = (ms << 80) | int.from_bytes(tail, "big")
    chars = []
    for _ in range(26):
        chars.append(_CROCKFORD[n & 31])
        n >>= 5
    return f"{prefix}_{''.join(reversed(chars))}"


class Director(Protocol):
    def direct(self, job_request: dict, sheet: dict | None) -> dict: ...


_VIDEO_OPS = {"clip", "clip_edit"}
_COMPOSITIONS = ["wide", "medium", "close", "medium", "close", "wide", "insert", "medium"]
_MOVES = ["static", "push_in", "pan", "static", "track", "pull_out", "static", "orbit"]
_ELEMENT_OPS = {"generate", "frame", "clip"}
# The camera angle of each turnaround view (director.v4: front 0, three-quarter 45, side 90, back 180).
VIEW_ANGLES = {"front": 0.0, "three-quarter": 45.0, "side": 90.0, "back": 180.0}


def fit_duration(seconds: float, spec: dict) -> float:
    """The clip length the op's model can make for a shot of `seconds` (capabilities ops[op]):
    the next longer allowed value (4/6/8 s models), else the nearest whole second within
    minS-maxS. Never fails the job over length: the stitch trims each clip to its shot (trimS)."""
    if spec.get("durationsS"):
        allowed = sorted(spec["durationsS"])
        if seconds in allowed:
            return seconds
        longer = [d for d in allowed if d >= seconds]
        return longer[0] if longer else allowed[-1]
    if "minS" in spec or "maxS" in spec:
        return min(max(math.ceil(seconds), spec.get("minS", 0)), spec.get("maxS", math.inf))
    return seconds


def view_angle(op: str, inp: dict, sheet: dict | None) -> dict | None:
    """The angle a view job needs where the provider takes angles (fal's multiple-angles endpoint
    refuses a view without one); None where it does not (the view is said in words instead)."""
    if op != "view" or not (sheet or {}).get("angles") or inp.get("view") not in VIEW_ANGLES:
        return None
    return {"horizontal": VIEW_ANGLES[inp["view"]], "vertical": 0.0}
_MAX_ANGLES = 3  # Kling: a front plus 1-3 reference images per element


def ref_roles(inp: dict, op: str, sheet: dict | None) -> list[tuple[dict, str]]:
    """The input refs in send order, each with its provider role.

    A character key with a front and other variants is one Kling element where the sheet has
    elements (front first, then up to 3 other variants as angles); otherwise a character ref is
    `character` and every other role is `object`. Refs carry wire tags (names.py) by now."""
    refs = list(inp.get("refs") or [])
    roles = {r["id"]: ("character" if r["role"] == "character" else "object") for r in refs}
    if sheet and (sheet.get("refs") or {}).get("element") and op in _ELEMENT_OPS:
        by_key: dict[str, list[dict]] = {}
        for r in refs:
            if r["role"] == "character" and r.get("name"):
                by_key.setdefault(r["name"].split("_", 1)[0], []).append(r)
        ordered: list[dict] = []
        for group in by_key.values():
            front = next((r for r in group if r["name"].split("_", 1)[1] == "front"), None)
            angles = [r for r in group if r is not front][:_MAX_ANGLES]
            if front and angles:
                roles[front["id"]] = "element_front"
                for r in angles:
                    roles[r["id"]] = "element_angle"
                ordered += [front, *angles]
        in_element = {r["id"] for r in ordered}
        refs = ordered + [r for r in refs if r["id"] not in in_element]
    return [(r, roles[r["id"]]) for r in refs]


class PassthroughDirector:
    """No model: turns the input into a provider job as literally as it can.

    Used until the harness lane's director exists, and by the local dev server.
    """

    model = "passthrough"
    prompt_version = "director.v0"

    def direct(self, job_request: dict, sheet: dict | None) -> dict:
        op = job_request["op"]
        inp = job_request.get("input", {})
        if op == "shot_list":
            return self._shot_list(job_request)
        provider = (sheet or {}).get("provider", "mock")
        model = ((sheet or {}).get("ops", {}).get(op) or {}).get("model", "unknown")
        refs = []
        seen = set()

        def add(asset: dict | None, name: str, role: str) -> None:
            if asset and asset["sha256"] not in seen:
                seen.add(asset["sha256"])
                refs.append({"sha256": asset["sha256"], "name": name, "role": role})

        if op == "view":
            add(inp.get("image"), "current", "current")
        for ref, role in ref_roles(inp, op, sheet):
            add(ref["asset"], ref["tag"], role)
        if op in ("frame", "region_edit"):
            add(inp.get("image"), "current", "current")
            # The storyboard's continuity anchors (director.v3 on): the frame before, then shot 1's
            # frame for setting and style (the same picture is sent once, as previous).
            add(inp.get("previousFrame"), "previous", "object")
            add(inp.get("anchorFrame"), "anchor", "object")
        if op == "clip_edit":
            add(inp.get("video"), "current", "current")  # the clip being changed
        prompt = inp.get("text") or ""
        shot = inp.get("shot")
        if shot:
            prompt = f"{shot.get('action', '')} {prompt}".strip()
        if inp.get("view"):
            prompt = f"{inp['view'].replace('-', ' ')} view of @current. {prompt}".strip()
        job = {"provider": provider, "model": model, "prompt": prompt or "the character", "refs": refs}
        angle = view_angle(op, inp, sheet)
        if angle:
            job["angle"] = angle
        if op == "clip" and inp.get("image"):
            job["firstFrame"] = inp["image"]["sha256"]
        if inp.get("mask") and (sheet or {}).get("mask", "none") != "none":
            job["mask"] = inp["mask"]["sha256"]  # a provider without masks goes by the box
        if inp.get("region"):
            job["region"] = inp["region"]
        if inp.get("feel") and ((sheet or {}).get("video") or {}).get("feelEdit") == "strength":
            job["strength"] = inp["feel"].get("strength", "flex")
        # As the director does (pathway matrix, 2026-10-08): the ratio in the provider's own form,
        # and no refs beside a first frame where the provider cannot take both.
        from .director import _clip_frame_only, provider_ratio
        ratio = provider_ratio(provider, op, inp.get("ratio"), model)
        if ratio:
            job["ratio"] = ratio
        if sheet:
            _clip_frame_only(job, op, sheet)
        if op in _VIDEO_OPS:
            job["audio"] = False
            if shot:
                spec = ((sheet or {}).get("ops") or {}).get(op) or {}
                job["durationS"] = fit_duration(shot["duration_s"], spec) if op == "clip" else shot["duration_s"]
        job["outputs"] = 1
        return {"op": op, "providerJob": job, "needsUser": None,
                "rationale": "passthrough: no director model", "confidence": 0.1}

    def _shot_list(self, job_request: dict) -> dict:
        inp = job_request.get("input", {})
        script = (inp.get("script") or inp.get("text") or "").strip()
        names = [r["name"] for r in inp.get("refs") or [] if r.get("name")]
        # Whole characters by their bare key (those with a front), then the other keys' pictures.
        keys = [n.split("_", 1)[0] for n in names if n.endswith("_front")]
        named = (keys + [n for n in names if n.split("_", 1)[0] not in keys])[:9]
        target = int(inp.get("targetS") or 15)
        n = max(2, min(8, -(-target // 5)))
        sentences = [s.strip() for s in script.replace("!", ".").replace("?", ".").split(".") if s.strip()]
        base, extra = divmod(target, n)
        shots = []
        for i in range(n):
            action = sentences[i] if i < len(sentences) else (sentences[-1] if sentences else "The character")
            shots.append({
                "id": new_id("shot", f"{job_request['jobId']}:{i}"),
                "order": i + 1,
                "duration_s": base + (1 if i < extra else 0),
                "composition": _COMPOSITIONS[i],
                "action": action[:300],
                "camera_move": _MOVES[i],
                "refs": named,
                "status": "planned",
            })
        return {"op": "shot_list", "shots": shots, "needsUser": None,
                "rationale": f"passthrough: {n} even shots for {target} s", "confidence": 0.1}
