"""The director comparison (features/director-v5.clan): the same real requests through the
passthrough and each director prompt, scored by checks in code.

  uv run python -m eval.director_eval record director.v5 --model sonnet   # live, on the configured wire
  uv run python -m eval.director_eval score                               # replays every recording

`record` calls the model (NAPKIN_MODEL_API: claude-cli locally, on the developer's own login)
and keeps each raw reply under eval/recorded/<version>/<case>.json. `score` and the test
(tests/test_director_eval.py) only replay them, so CI makes no model call.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent))

import names  # noqa: E402
from director.base import PassthroughDirector  # noqa: E402
from director.director import Director, DirectorError  # noqa: E402
from director.model import ModelError, ModelPort, Reply  # noqa: E402
from providers import load_sheets  # noqa: E402
from providers.types import effective_sheet  # noqa: E402

CASES = HERE / "director_cases.json"
RECORDED = HERE / "recorded"
PROMPTS = HERE.parent / "prompts"
MODELS = {"haiku": "eu.anthropic.claude-haiku-4-5-20251001-v1:0", "sonnet": "eu.anthropic.claude-sonnet-5-5"}
CDN = "https://cdn.test/in"


def load() -> dict:
    return json.loads(CASES.read_text())


def job_input(case: dict, data: dict) -> dict:
    """The case's input as the relay hands it to the director: asset refs, cards on refs, wire tags."""
    def asset(key: str) -> dict:
        sha = data["assets"][key]
        return {"sha256": sha, "url": f"{CDN}/{sha}", "mime": "image/png"}
    inp = json.loads(json.dumps(case["input"]))
    for field in ("image", "mask", "anchorFrame", "previousFrame", "video"):
        if isinstance(inp.get(field), str):
            inp[field] = asset(inp[field])
    for r in inp.get("refs") or []:
        r["asset"] = asset(r["asset"])
        if r.get("card"):
            r["card"] = data["cards"][r["card"]]
    return names.to_wire(case["op"], inp)


class Recording:
    """A wire that keeps each reply's text for replay."""

    def __init__(self, wire):
        self.wire, self.api, self.last = wire, wire.api, None

    def send(self, **kw):
        reply = self.wire.send(**kw)
        self.last = reply.text
        return reply


class Replay:
    api = "anthropic"

    def __init__(self, text: str):
        self.text = text

    def send(self, **kw):
        return Reply(self.text, "ok", (0, 0))


def director(wire, version: str, model: str) -> Director:
    port = ModelPort(wire, model, timeout=float(os.environ.get("DIRECTOR_EVAL_TIMEOUT_S", "120")))
    return Director(port, PROMPTS, load_sheets(), per_click_model=model, prompt_version=version)


def answer(case: dict, data: dict, version: str, wire=None, model: str = MODELS["sonnet"]) -> dict:
    """The providerJob for one case, or {"error": ...} when the director refused its own answer."""
    sheet = load_sheets()[case["provider"]]
    if case.get("model"):  # a pick: the director sees the sheet as that model runs it, as in the relay
        sheet = effective_sheet(sheet, case["op"], case["model"])
    inp = job_input(case, data)
    if version == "passthrough":
        return PassthroughDirector().direct({"op": case["op"], "input": inp, "jobId": case["id"]}, sheet)["providerJob"]
    try:
        d = director(wire, version, model)
        d.sheets = {**d.sheets, case["provider"]: sheet}
        return d.run(case["op"], inp, case["provider"], job_id=case["id"]).output["providerJob"]
    except (DirectorError, ModelError) as e:
        return {"error": str(e)[:300]}


def _words(text: str) -> str:
    return re.sub(r"\s+", " ", (text or "").lower())


def score(case: dict, job: dict) -> dict:
    """Each check: True passes. A refused answer fails every check (the relay falls back to the passthrough)."""
    if "error" in job:
        return {"valid": False}
    prompt = _words(job.get("prompt"))
    roles = {r["name"]: r["role"] for r in job.get("refs") or []}
    added = len(job.get("prompt") or "") - len((case["input"].get("text") or ""))
    out = {"valid": True}
    out["words"] = all(any(p in prompt for p in group) for group in case.get("must", []))
    out["no_leaks"] = not any(w in prompt for w in case.get("forbid", []))
    out["roles"] = all(roles.get(n) == r for n, r in (case.get("roles") or {}).items())
    out["refs"] = set(roles) <= set(case["only_refs"]) if case.get("only_refs") else True
    out["length"] = added <= case.get("budget", 500)
    return out


def recorded(label: str, case_id: str) -> dict | None:
    """A recording: {"version", "model", "reply"}. The folder is its label (director.v5-haiku)."""
    p = RECORDED / label / f"{case_id}.json"
    if not p.exists():
        return None
    rec = json.loads(p.read_text())
    rec.setdefault("version", label)
    return rec


def table(data: dict, versions: list[str]) -> dict[str, dict]:
    """version -> {case id -> checks}, from recordings (the passthrough needs none)."""
    out: dict[str, dict] = {}
    for v in versions:
        rows = {}
        for case in data["cases"]:
            if v == "passthrough":
                job = answer(case, data, v)
            else:
                rec = recorded(v, case["id"])
                if rec is None:
                    continue
                job = answer(case, data, rec["version"], Replay(rec["reply"]))
            rows[case["id"]] = score(case, job)
        out[v] = rows
    return out


def totals(rows: dict) -> tuple[int, int]:
    checks = [ok for r in rows.values() for ok in r.values()]
    return sum(checks), len(checks)


def main(argv=None) -> None:
    ap = argparse.ArgumentParser()
    sub = ap.add_subparsers(dest="cmd", required=True)
    rec = sub.add_parser("record")
    rec.add_argument("version")
    rec.add_argument("--model", default="sonnet", choices=sorted(MODELS))
    rec.add_argument("--case", action="append")
    rec.add_argument("--as", dest="label", help="the folder to record under (default: the version)")
    sub.add_parser("score")
    args = ap.parse_args(argv)
    data = load()
    if args.cmd == "record":
        from director.claude import build_wire, settings_from_env
        if os.environ.get("NAPKIN_MODEL_API") == "claude-cli":
            from director.cli_wire import ClaudeCliWire
            base = ClaudeCliWire(os.environ.get("NAPKIN_CLAUDE_CLI", "claude"))
        else:
            base = build_wire(settings_from_env())
        for case in data["cases"]:
            if args.case and case["id"] not in args.case:
                continue
            wire = Recording(base)
            job = answer(case, data, args.version, wire, MODELS[args.model])
            if wire.last is not None:
                p = RECORDED / (args.label or args.version) / f"{case['id']}.json"
                p.parent.mkdir(parents=True, exist_ok=True)
                p.write_text(json.dumps({"version": args.version, "model": MODELS[args.model], "reply": wire.last}, indent=1) + "\n")
            print(case["id"], json.dumps(score(case, job)), job.get("error", ""), flush=True)
        return
    versions = ["passthrough"] + sorted(p.name for p in RECORDED.glob("*") if p.is_dir())
    t = table(data, versions)
    for v, rows in t.items():
        ok, n = totals(rows)
        print(f"{v:14} {ok:3}/{n:<3}", "  ".join(f"{cid}:{sum(r.values())}/{len(r)}" for cid, r in rows.items()))


if __name__ == "__main__":
    main()
