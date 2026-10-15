"""Skye's prompt review (features/script-editor.clan): our 20 fixture shots × 6 intents through the
writer, scored by checks in code. A person runs `record` with the eval key before PR 3 merges and
logs the result in the record; CI only replays (`score`), so it makes no model call.

  uv run python -m eval.skye_eval record              # live: Bedrock (or locally under scripts/model-local run)
  uv run python -m eval.skye_eval score               # replays eval/recorded/skye.v1/*.json
  uv run python -m eval.skye_eval score --passthrough # the checks over the no-model writer

The checks: a draft comes back (or a question, never both); every @name is kept (a draft too), none
invented and none swapped for another (a bare @samurai never becomes @samurai_front);
the blocks keep their types and order; Make it N s sets that length; a beat lands inside the shot;
the note is one short first-person line with no price; the words are shorter for Tighten.
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent))

from writer import PROMPT_VERSION, WRITE_MODEL, ModelWriter, PassthroughWriter, settle  # noqa: E402

CASES = HERE / "skye_cases.json"
RECORDED = HERE / "recorded" / PROMPT_VERSION
BASE = "sha256:" + "e" * 64
MENTION = re.compile(r"(?<![\w@])@([a-z][a-z0-9]{1,23}(?:_[a-z0-9][a-z0-9-]{0,31})?)")
PRICE = re.compile(r"\$|\bcosts?\b|\bprice\b|\bfree\b", re.I)


def load() -> dict:
    return json.loads(CASES.read_text())


def request(case: dict, intent: str) -> dict:
    lines = case["lines"] if intent != "draft" else [{"type": "action", "text": case["lines"][0]["text"].split(". ")[0]}]
    write = {
        "intent": intent, "target": {"kind": "shot" if intent != "draft" else "scene", "id": "shot_00000000000000000000000001"},
        "base_hash": BASE, "lines": lines,
        "context": {"script_title": case["title"], "target_s": case["target_s"], "neighbours": "", "refs": case["refs"]},
    }
    if intent == "fit_seconds":
        write["seconds"] = case["seconds"]
    return {"op": "write", "jobId": f"job_{case['id']}_{intent}", "input": {"write": write}}


def score(case: dict, intent: str, out: dict) -> dict[str, bool]:
    req = request(case, intent)["input"]["write"]
    writes = out.get("writes") or []
    checks: dict[str, bool] = {"answers": bool(writes) != bool(out.get("question"))}
    if not writes:
        return checks
    d = writes[0]
    words = " ".join(x["text"] for x in d["lines"])
    before = " ".join(x["text"] for x in req["lines"])
    names_before = set(MENTION.findall(before))
    known = {r["name"] for r in req["context"]["refs"]}
    checks["keeps @names"] = names_before <= set(MENTION.findall(words))
    # Never a view in place of the whole character the words name (owner 2026-10-15: @samurai became
    # @samurai_front, @samurai_side… line by line).
    bare = {n for n in names_before if "_" not in n}
    checks["no swapped @name"] = not any("_" in n and n.split("_", 1)[0] in bare and n not in names_before
                                         for n in MENTION.findall(words))
    checks["invents no @name"] = set(MENTION.findall(words)) <= (names_before | known)
    checks["hash and target"] = d["base_hash"] == BASE and d["target"] == req["target"]
    if intent != "draft":
        checks["blocks in order"] = [x["type"] for x in d["lines"]] == [x["type"] for x in req["lines"]]
    checks["note"] = 0 < len(d["note"]) <= 200 and not PRICE.search(d["note"])
    if intent == "tighten":
        checks["shorter"] = len(words) < len(before)
    if intent == "fit_seconds":
        checks["length"] = d.get("duration_s") == req["seconds"]
    if intent in ("add_beat", "write_vo"):
        beats = d.get("new_beats") or []
        checks["a beat"] = len(beats) >= 1 and all(b["at_s"] <= 30 for b in beats)
        if intent == "write_vo":
            checks["vo"] = any(b["kind"] == "vo" for b in beats)
    return checks


class Replay:
    """A model port that answers with a recorded reply."""

    def __init__(self, reply: dict):
        self.reply = reply

    def call(self, *a, **kw):
        return json.loads(json.dumps(self.reply))


def run(writer, data: dict, cases=None) -> dict:
    table: dict[str, dict] = {}
    for case in data["cases"]:
        if cases and case["id"] not in cases:
            continue
        for intent in data["intents"]:
            out = writer(case, intent)
            if out is None:
                continue
            table[f"{case['id']}/{intent}"] = score(case, intent, out)
    return table


def report(table: dict) -> str:
    checks = [ok for row in table.values() for ok in row.values()]
    lines = [f"{sum(checks)}/{len(checks)} checks over {len(table)} drafts"]
    for key, row in table.items():
        bad = [k for k, ok in row.items() if not ok]
        if bad:
            lines.append(f"  ✗ {key}: {', '.join(bad)}")
    return "\n".join(lines)


def main(argv=None) -> int:
    ap = argparse.ArgumentParser()
    sub = ap.add_subparsers(dest="cmd", required=True)
    rec = sub.add_parser("record")
    rec.add_argument("--case", action="append")
    sc = sub.add_parser("score")
    sc.add_argument("--passthrough", action="store_true")
    args = ap.parse_args(argv)
    data = load()
    if args.cmd == "record":
        from director.claude import build_wire, settings_from_env
        from director.model import ModelPort
        from contracts_dir import contracts_dir
        wire = build_wire(settings_from_env())
        port = ModelPort(wire, model=WRITE_MODEL, timeout=120)

        class Keep:
            def call(self, *a, **kw):
                self.reply = port.call(*a, **kw)
                return self.reply

        keep = Keep()
        writer = ModelWriter(keep, contracts_dir())
        RECORDED.mkdir(parents=True, exist_ok=True)

        def live(case, intent):
            out = writer.write(request(case, intent))
            (RECORDED / f"{case['id']}.{intent}.json").write_text(json.dumps({"model": WRITE_MODEL, "reply": keep.reply}, indent=1) + "\n")
            return out
        print(report(run(live, data, args.case)))
        return 0
    if args.passthrough:
        print(report(run(lambda c, i: PassthroughWriter().write(request(c, i)), data)))
        return 0

    def replay(case, intent):
        p = RECORDED / f"{case['id']}.{intent}.json"
        if not p.exists():
            return None
        req = request(case, intent)
        return settle(req["input"], json.loads(p.read_text())["reply"])
    table = run(replay, data)
    print(report(table) if table else f"No recordings in {RECORDED}: run `record` with the eval key first.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
