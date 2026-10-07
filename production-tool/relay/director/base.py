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
_VIEWS = ["three_quarter", "front", "side", "front", "three_quarter", "front", "back", "front"]


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

        add(inp.get("sketch"), "sketch", "character")
        for view, asset in (inp.get("character") or {}).items():
            add(asset, view, "character")
        for ref in inp.get("refs") or []:
            add(ref["asset"], ref["tag"], "character" if ref["role"] == "character" else "object")
        if op in ("frame", "region_edit"):
            add(inp.get("image"), "current", "current")
            # The storyboard's continuity anchors (director.v2.1): the frame before, then shot 1's
            # frame for setting and style (the same picture is sent once, as previous).
            add(inp.get("previousFrame"), "previous", "object")
            add(inp.get("anchorFrame"), "anchor", "object")
        prompt = inp.get("text") or ""
        shot = inp.get("shot")
        if shot:
            prompt = f"{shot.get('action', '')} {prompt}".strip()
        if inp.get("view"):
            prompt = f"{inp['view'].replace('_', ' ')} view of the character. {prompt}".strip()
        job = {"provider": provider, "model": model, "prompt": prompt or "the character", "refs": refs}
        if op == "clip" and inp.get("image"):
            job["firstFrame"] = inp["image"]["sha256"]
        if inp.get("mask"):
            job["mask"] = inp["mask"]["sha256"]
        if inp.get("region"):
            job["region"] = inp["region"]
        if inp.get("feel"):
            job["strength"] = inp["feel"].get("strength", "flex")
        if op in _VIDEO_OPS:
            job["audio"] = False
            if shot:
                job["durationS"] = shot["duration_s"]
        job["outputs"] = 1
        return {"op": op, "providerJob": job, "needsUser": None,
                "rationale": "passthrough: no director model", "confidence": 0.1}

    def _shot_list(self, job_request: dict) -> dict:
        inp = job_request.get("input", {})
        script = (inp.get("script") or inp.get("text") or "").strip()
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
                "lead_view": _VIEWS[i],
                "status": "planned",
            })
        return {"op": "shot_list", "shots": shots, "needsUser": None,
                "rationale": f"passthrough: {n} even shots for {target} s", "confidence": 0.1}
