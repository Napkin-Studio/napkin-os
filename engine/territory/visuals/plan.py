"""The frame plan: four shot descriptions per territory, from ONE model call per run, saved next to the run as
``<run>.frames-plan.json`` and reused for ever after, so a style change never touches it (and never pays for it again)."""
from __future__ import annotations

import hashlib
import json
from pathlib import Path

from .. import cost
from ..llm import prompt

SHOTS = ("f1", "f2", "f3", "f4")
CALLS = 1


class PlanError(ValueError):
    pass


def plan_path(run_path: Path) -> Path:
    return run_path.with_name(run_path.stem + ".frames-plan.json")


def run_hash(run_path: Path) -> str:
    return hashlib.sha256(run_path.read_bytes()).hexdigest()[:12]


def estimate() -> dict:
    """The plan call's own cost card line: one Sonnet call, scaled like the pipeline's card (an estimate)."""
    usd = round(cost._price("claude-sonnet-5-5", 6000, 3500) * cost.CALIBRATION, 4)
    return {"stage": "frames_plan", "calls": CALLS, "model": "claude-sonnet-5-5", "est_usd": usd}


def _payload(run: dict, banned: list[str]) -> dict:
    gate = run.get("gate") or {}
    terr = [{"id": t["id"], "line": t.get("line"), "proposition": t.get("proposition") or t.get("line"), "tension": t.get("tension_text"),
             "idea": t.get("mechanism"), "tier": t.get("tier")} for t in run.get("territories", [])]
    brief = [{f.get("key"): f.get("value")} for f in (run.get("assumed_brief") or {}).get("fields", [])]
    out = {"category": gate.get("category"), "market": gate.get("market"), "assumed_brief": brief, "territories": terr}
    if banned:
        out["never_show"] = banned
    return out


def _clean(obj: dict, ids: list[str]) -> dict:
    by = {t.get("id"): t for t in (obj or {}).get("territories") or [] if isinstance(t, dict)}
    out = {}
    for tid in ids:
        shots = (by.get(tid) or {}).get("shots") or []
        if len(shots) < len(SHOTS):
            raise PlanError(f"the plan gave {len(shots)} shots for territory {tid}, need {len(SHOTS)}: nothing saved, try again")
        out[tid] = [{"shot": SHOTS[i], **{k: str(s.get(k) or "").strip() for k in ("framing", "camera", "action", "on_screen_line")}}
                    for i, s in enumerate(shots[:len(SHOTS)])]
        for s in out[tid]:
            if not (s["framing"] or s["action"]):
                raise PlanError(f"shot {tid}-{s['shot']} has no framing or action: nothing saved, try again")
    return out


def load(run_path: Path) -> dict | None:
    p = plan_path(run_path)
    return json.loads(p.read_text()) if p.exists() else None


def make(run: dict, run_path: Path, llm, banned: list[str] | None = None) -> dict:
    """One call through ``llm`` (LiveLLM in a live run, FakeLLM in tests). Saved only when every territory has four shots."""
    ids = [t["id"] for t in run.get("territories", [])]
    obj, usage = llm("frames_plan", prompt("frames_plan"), json.dumps(_payload(run, banned or []), ensure_ascii=False))
    plan = {"run": run_path.name, "run_sha256_12": run_hash(run_path), "model": (usage or {}).get("model"), "usd": (usage or {}).get("usd"),
            "territories": _clean(obj, ids)}
    plan_path(run_path).write_text(json.dumps(plan, indent=1, ensure_ascii=False))
    return plan
