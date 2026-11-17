"""The director comparison (features/director-v5.clan): the same real requests through the
passthrough and each director prompt, scored by checks in code.

  uv run python -m eval.director_eval record director.v5 --model sonnet   # live, on the configured wire
  uv run python -m eval.director_eval score                               # replays every recording

`record` calls the model on the configured wire (locally: scripts/model-local run, on the developer's own login)
and keeps each raw reply under eval/recorded/<version>/<case>.json. `score` and the test
(tests/test_director_eval.py) only replay them, so CI makes no model call.

Contract 3 (features/contract-v3.clan) runs director.v6 only: the v4 and v5 recordings, converted
to contract 3's shapes (needsUser became question), are replayed through today's checks and prompt,
so the comparison still says what each recorded answer was worth. Record v6 with a live model to
add it.

Change this frame (features/frame-change-edit.clan): the frame_edit cases (`since` director.v7) send
Dex their still from eval/fixtures/frames/ as one picture, as the relay does, and score the whole
output: reading, camera, ask, no_continuity, words_first and length. v7 replies replay under v7.

Fix this moment (features/clip-moment-edit.clan): the clip_patch cases (`since` director.v7) send Dex
the still at the note's moment (`frame`), as the relay does, and score route (a job, or the fix/remake
ask exactly when the case expects one), ask, words_first, relay_keyframe (no keyframe, mask, region or
ratio of Dex's own), take (the take as the one `current` ref) and length.

A shot's references (features/canvas-nodes.clan, owner 2026-10-15): a case with `required` (`since`
director.v8) scores keeps_refs (every ref the shot's words name is sent, by its own tag) and no_swap
(any other picture goes only as an addition listed in `added` with why).

Clips that carry characters (features/runway-video-models.clan): a case with `expect_refs` and `frame`
(`since` director.v9, often on a `model` pick) scores exact_refs (exactly those pictures besides the clip
go) and frame (a firstFrame exactly when expected). No v9 reply is recorded yet: record with a model login.

Each shot follows its own frame (features/join-or-cut-shots.clan): a take_refs case with `ties` (`since`
director.v11) scores ties: shot k's timed line ends "follows image k (@tag)" exactly when the take carries
shot k's frame (a ref with role composition labelled "Shot k frame"). Not recorded yet: no live or paid eval.

Free prose to shots (features/script-freeform.clan, owner 2026-11-16): a shot_list case (`since` director.v9)
plans a script written as prose and bullets, with no scene heading or screenplay element. It scores plans (shots,
no question), count (within `expect.shots`), length (the shots add up to the target within half a second), words
(each `must` group in some shot's words), order (those words in the script's order) and no_headings (no
scene_heading and none of `forbid` invented). Not recorded yet: record live on the owner's say.

The brief (features/brief-node.clan, owner 2026-11-17): three shot_list cases (`since` director.v13) plan the same
one-line script under three linked briefs (quiet for 55 to 70, brisk for 18 to 24, premium and minimal). Besides the
shot_list checks, each scores brief_pace (shot count and average length as its `expect_brief` names), brief_camera
(no movement speed the brief rules out; one it names where any is set), brief_words (its tone in the shots' words),
brief_forbid (no line a don't rules out), brief_insert (a close detail where a mandatory asks for one), no_quote (the
proposition is never put on screen) and no_flags (nothing flagged that the plan does not break). Together the three
must differ as named. Recorded 2026-11-18 on the owner's say (director.v13, Sonnet 5.5, three calls): 40/40.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent))

import names  # noqa: E402
from director.base import PassthroughDirector  # noqa: E402
from director.director import (CONTINUITY_WORDS, Director, DirectorError, _given_words,  # noqa: E402
                               _starts_with)
from director.model import ModelError, ModelPort, Reply  # noqa: E402
from providers import load_sheets  # noqa: E402
from providers.types import effective_sheet  # noqa: E402

CASES = HERE / "director_cases.json"
RECORDED = HERE / "recorded"
FRAMES = HERE / "fixtures" / "frames"  # frame_edit stills, drawn by make_frames.py (SOURCES.md)
PROMPTS = HERE.parent / "prompts"
CURRENT = "director.v6"  # the prompt a replay runs under: the recordings are only replies
MODELS = {"haiku": "eu.anthropic.claude-haiku-4-5-20251001-v1:0", "sonnet": "eu.anthropic.claude-sonnet-5-5"}
CDN = "https://cdn.test/in"


def load() -> dict:
    return json.loads(CASES.read_text())


def frame_bytes(data: dict, key: str) -> bytes | None:
    """A frame_edit case's still (eval/fixtures/frames/), when `key` names one."""
    name = (data.get("frames") or {}).get(key)
    return (FRAMES / name).read_bytes() if name else None


def frame_images(case: dict, data: dict) -> list | None:
    """What Dex sees with a frame_edit: its current frame as the relay sends it (one 768 px JPEG)."""
    key = {"frame_edit": case["input"].get("image"), "clip_patch": case.get("frame")}.get(case["op"])
    raw = frame_bytes(data, key) if key else None
    if raw is None:
        return None
    from cards import downscale
    media_type, b64 = downscale(raw)
    return [{"media_type": media_type, "data": b64}]


def job_input(case: dict, data: dict) -> dict:
    """The case's input as the relay hands it to the director: asset refs, cards on refs, wire tags."""
    def asset(key: str) -> dict:
        raw = frame_bytes(data, key)
        sha = "sha256:" + hashlib.sha256(raw).hexdigest() if raw is not None else data["assets"][key]
        return {"sha256": sha, "url": f"{CDN}/{sha}", "mime": "image/png"}
    inp = json.loads(json.dumps(case["input"]))
    for field in ("image", "mask", "anchorFrame", "previousFrame", "video"):
        if isinstance(inp.get(field), str):
            inp[field] = asset(inp[field])
    if case["op"] in ("clip_patch", "clip_edit") and isinstance(inp.get("video"), dict):
        inp["video"]["mime"] = "video/mp4"
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
    """The director's whole output for one case (providerJob, question, frameEdit), or {"error": ...}
    when the director refused its own answer."""
    sheet = load_sheets()[case["provider"]] if case.get("provider") else None  # a shot_list has no provider
    if case.get("model"):  # a pick: the director sees the sheet as that model runs it, as in the relay
        sheet = effective_sheet(sheet, case["op"], case["model"])
    inp = job_input(case, data)
    if version == "passthrough":  # never shown a picture
        try:
            return PassthroughDirector().direct({"op": case["op"], "input": inp, "jobId": case["id"]}, sheet)
        except (DirectorError, ModelError) as e:  # the passthrough refuses too (a character with no frame)
            return {"error": str(e)[:300]}
    try:
        d = director(wire, version, model)
        if sheet is not None:
            d.sheets = {**d.sheets, case["provider"]: sheet}
        return d.run(case["op"], inp, case.get("provider"), job_id=case["id"], images=frame_images(case, data)).output
    except (DirectorError, ModelError) as e:
        return {"error": str(e)[:300]}


def _words(text: str) -> str:
    return re.sub(r"\s+", " ", (text or "").lower())


def score(case: dict, out: dict) -> dict:
    """Each check: True passes. A refused answer fails every check (the relay falls back to the passthrough).
    `length` is what the director added beyond what the person gave (director._given_words: their words,
    and the shot's own text quoted as it is)."""
    if "error" in out:
        return {"valid": False}
    if case["op"] == "frame_edit":
        return _score_frame_edit(case, out)
    if case["op"] == "clip_patch":
        return _score_clip_patch(case, out)
    if case["op"] == "shot_list":
        return _score_shot_list(case, out)
    job = out.get("providerJob") or {}
    prompt = _words(job.get("prompt"))
    roles = {r["name"]: r["role"] for r in job.get("refs") or []}
    added = len(job.get("prompt") or "") - _given_words(job.get("prompt") or "", case["input"])
    res = {"valid": True}
    res["words"] = all(any(p in prompt for p in group) for group in case.get("must", []))
    res["no_leaks"] = not any(w in prompt for w in case.get("forbid", []))
    res["roles"] = all(roles.get(n) == r for n, r in (case.get("roles") or {}).items())
    res["refs"] = set(roles) <= set(case["only_refs"]) if case.get("only_refs") else True
    res["length"] = added <= case.get("budget", 500)
    if case.get("required"):
        # A shot's refs (owner 2026-10-15, features/canvas-nodes.clan): every ref its words name goes, by
        # its own tag, and any other picture goes only as an addition with a reason.
        why = {a.get("name") for a in out.get("added") or [] if (a.get("why") or "").strip()}
        res["keeps_refs"] = set(case["required"]) <= set(roles)
        res["no_swap"] = all(n in case["required"] or n in why or n in ("anchor", "previous") for n in roles)
    if "expect_refs" in case:
        # Which pictures the model carries (since director.v9, features/runway-video-models.clan).
        res["exact_refs"] = sorted(n for n, r in roles.items() if r != "current") == sorted(case["expect_refs"])
    if "frame" in case:
        res["frame"] = bool(job.get("firstFrame")) == case["frame"]
    if "ties" in case:
        # Each shot follows its own frame (since director.v11, features/join-or-cut-shots.clan): shot k's line
        # says "follows image k" and the frame's tag exactly when the take carries that shot's frame.
        import connected
        refs = case["input"].get("refs") or []
        tags = names.wire_tags(refs)
        res["ties"] = connected.ties_problem(job.get("prompt") or "", {"refs": [{**r, "tag": tags[r["id"]]} for r in refs]}) is None
    return res


def _score_frame_edit(case: dict, out: dict) -> dict:
    """Change this frame (features/frame-change-edit.clan): reading (the case's camera / local / both,
    or an ask), camera (each expected leaf has one of its listed values), ask (an ambiguity with
    camera/local/both and no recommendation exactly when one is expected), no_continuity (no anchor or
    previous frame, in refs or words), words_first, and length."""
    want = case["expect"]
    edit = out.get("frameEdit") or {}
    question = out.get("question")
    job = out.get("providerJob") or {}
    prompt = job.get("prompt") or ""
    text = case["input"].get("text") or ""
    patch = edit.get("camera") or {}
    res = {"valid": True}
    if want["reading"] == "ask":
        res["reading"] = question is not None
    else:
        res["reading"] = (edit.get("reading") == want["reading"]
                          and ("runAs" not in want or edit.get("runAs") == want["runAs"])
                          and ("maskUnused" not in want or bool(edit.get("maskUnused")) == want["maskUnused"]))
    res["camera"] = all(patch.get(k) in allowed for k, allowed in (want.get("camera") or {}).items())
    values = [o.get("value") for o in (question or {}).get("options") or []]
    res["ask"] = (question is not None and question["kind"] == "ambiguity" and "recommended_option_id" not in question
                  and {"camera", "local"} <= set(values) <= {"camera", "local", "both"}) \
        if want["reading"] == "ask" else question is None
    res["no_continuity"] = not CONTINUITY_WORDS.search(prompt) and not any(
        r["name"] in ("anchor", "previous") for r in job.get("refs") or [])
    res["words_first"] = not job or _starts_with(prompt, text)
    res["length"] = len(prompt) - _given_words(prompt, case["input"]) <= case.get("budget", 500)
    return res


def _score_clip_patch(case: dict, out: dict) -> dict:
    """Fix this moment: route (a job, or an ask exactly when expected), ask (a nudge whose options are fix and
    remake), words_first, relay_keyframe (the keyframe, its range and the shape are the relay's), take (the
    take is the one ref, as current) and length."""
    want = case["expect"]["route"]
    question = out.get("question")
    job = out.get("providerJob") or {}
    prompt = job.get("prompt") or ""
    routes = {(o.get("value") or {}).get("route") for o in (question or {}).get("options") or []}
    res = {"valid": True}
    res["route"] = question is not None if want == "ask" else bool(job) and question is None
    res["ask"] = (question is not None and question["kind"] == "nudge" and routes == {"fix", "remake"}) \
        if want == "ask" else question is None
    res["words_first"] = not job or _starts_with(prompt, case["input"].get("text") or "")
    res["relay_keyframe"] = not any(k in job for k in ("keyframe", "keyframes", "mask", "region", "ratio"))
    res["take"] = not job or [r.get("role") for r in job.get("refs") or []] == ["current"]
    res["length"] = len(prompt) - _given_words(prompt, case["input"]) <= case.get("budget", 250)
    return res


def _score_shot_list(case: dict, out: dict) -> dict:
    """Plan shots from the words as they are: plans (shots and no question), count, length, words, order and
    no_headings (see the module's note)."""
    shots = out.get("shots") or []
    texts = [_words(" ".join([s.get("action") or "", s.get("direction") or ""] + [b.get("text") or "" for b in s.get("beats") or []]))
             for s in shots]
    low, high = case.get("expect", {}).get("shots", [1, 24])
    target = case["input"].get("targetS") or 15
    first = [next((i for i, t in enumerate(texts) if any(p in t for p in group)), None) for group in case.get("must", [])]
    res = {"valid": True}
    res["plans"] = bool(shots) and out.get("question") is None
    res["count"] = low <= len(shots) <= high
    res["length"] = abs(sum(s.get("duration_s") or 0 for s in shots) - target) <= 0.5
    res["words"] = all(i is not None for i in first)
    res["order"] = res["words"] and first == sorted(first)
    res["no_headings"] = not any(s.get("scene_heading") for s in shots) and not any(
        w in t for t in texts for w in case.get("forbid", []))
    if case.get("expect_brief"):
        res.update(_score_brief_plan(case, out, shots, texts))
    return res


def _score_brief_plan(case: dict, out: dict, shots: list, texts: list[str]) -> dict:
    """A plan under a linked brief (since director.v13): the differences its `expect_brief` names."""
    want = case["expect_brief"]
    spine = case["input"]["brief"]["spine"]
    avg = sum(s.get("duration_s") or 0 for s in shots) / len(shots) if shots else 0
    speeds = [(s.get("camera") or {}).get("movement_speed") for s in shots]
    speeds = [x for x in speeds if x]
    words = " ".join(texts)
    res = {}
    res["brief_pace"] = (len(shots) >= want.get("min_shots", 1) and len(shots) <= want.get("max_shots", 24)
                         and avg >= want.get("min_avg_s", 0) and avg <= want.get("max_avg_s", 30))
    res["brief_camera"] = all(x not in want.get("no_speed", []) for x in speeds) and (
        not speeds or not want.get("speed") or any(x in want["speed"] for x in speeds))
    res["brief_words"] = all(any(w in words for w in group) for group in want.get("words", []))
    res["brief_forbid"] = not any(w in words for w in want.get("forbid", []))
    if want.get("insert"):
        res["brief_insert"] = any((s.get("camera") or {}).get("size") in ("insert", "extreme_close", "close")
                                  or (s.get("camera") or {}).get("macro") for s in shots)
    res["no_quote"] = _words(spine.get("proposition", "")) not in words
    res["no_flags"] = not out.get("briefFlags")
    return res


def _number(version: str) -> int:
    m = re.search(r"\.v(\d+)", version)
    return int(m.group(1)) if m else 0


def applies(case: dict, version: str) -> bool:
    """A case from a later prompt (`since`) is not held against an earlier one's recordings."""
    return version == "passthrough" or not case.get("since") or _number(version) >= _number(case["since"])


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
            if not applies(case, v):
                continue
            if v == "passthrough":
                job = answer(case, data, v)
            else:
                rec = recorded(v, case["id"])
                if rec is None:
                    continue
                # v4 and v5 replies replay under contract 3's v6 checks; v7 and later under their own prompt.
                run = rec["version"] if _number(rec["version"]) >= 7 else CURRENT
                job = answer(case, data, run, Replay(rec["reply"]))
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
