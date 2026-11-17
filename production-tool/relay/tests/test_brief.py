"""The brief (features/brief-node.clan, owner 2026-11-17): JobInput.brief is validated; with no brief the
director's input is byte for byte what it was (the golden of director.v12's input); the brief block each op
reads holds its budget with the longest brief the contract allows, and a provider prompt still holds the
op's budget; the Review flags keep only lines the job was given and never block; and the three brief eval
cases tell the plans apart as named. No model or provider is called."""

from __future__ import annotations

import hashlib
import json
from pathlib import Path

import pytest

import brief as briefs
import cutdowns
from conftest import Harness, base_config
from director import Director, DirectorError
from director import new_id
from eval.director_eval import load, score
from test_director import FIXTURES, PROMPTS, fixture, make, run

HERE = Path(__file__).parent
GOLDEN = json.loads((HERE / "fixtures" / "director_golden_inputs.v12.json").read_text())
CONTRACTS = HERE.parents[1] / "contracts"
SPINE = json.loads((CONTRACTS / "common.schema.json").read_text())["$defs"]["briefSpine"]["properties"]


def longest() -> dict:
    """The longest spine the contract allows: every text at its maxLength, every list full of its longest lines."""
    out = {}
    for part, rule in SPINE.items():
        if rule.get("type") == "array":
            out[part] = [(f"{part} line {i} " + "x" * 200)[:rule["items"]["maxLength"]] for i in range(rule["maxItems"])]
        else:
            out[part] = ("word " * 200)[:rule["maxLength"]]
    return out


LONGEST = {"title": "T" * 200, "spine": longest()}
SHORT = {"title": "First Light brief", "spine": {
    "proposition": "Lumen is what the day starts with.", "audience": "Adults 25 to 40 who start the day at home.",
    "tone": "Quiet, warm, unhurried", "feel": "Calm and ready",
    "mandatories": ["Lumen name first", "Morning moment"], "donts": ["Don't show a gym"], "format": "Film: 30 s hero"}}


# ── the contract ─────────────────────────────────────────────────────────────

def test_a_brief_is_validated_with_the_job():
    h = Harness(base_config())
    token = h.as_person()
    h.post_job(token, op="generate", expect=200, text="a red coat", refs=[], brief=SHORT)
    bad = {**SHORT, "spine": {**SHORT["spine"], "budget": "£200k"}}  # not a spine part: the brief's budget never goes
    _, out = h.post_job(token, op="generate", expect=400, text="a red coat", refs=[], brief=bad)
    assert out["error"]["code"] == "invalid_input"
    long = {**SHORT, "spine": {**SHORT["spine"], "proposition": "x" * 201}}
    assert h.post_job(token, op="generate", expect=400, text="a red coat", refs=[], brief=long)[1]["error"]["code"] == "invalid_input"
    assert h.post_job(token, op="generate", expect=400, text="a red coat", refs=[], brief={"spine": {}})[1]["error"]["code"] == "invalid_input"


# ── no brief: the director's input as before ─────────────────────────────────

@pytest.mark.parametrize("name", sorted(GOLDEN))
def test_with_no_brief_the_director_input_is_byte_for_byte_the_golden(name):
    f = fixture(name)
    for version in ("director.v12", "director.v13"):
        d, wire = make(f["reply"], prompt_version=version)
        try:
            run(name, d)
        except DirectorError:
            pass  # a check after the call; the input was sent
        sent = wire.calls[0]
        assert sent["turns"][0]["text"] == GOLDEN[name]["user"], (version, name)
        if version == "director.v12":
            assert hashlib.sha256(sent["system"].encode()).hexdigest() == GOLDEN[name]["system_sha256"], name


def test_for_op_leaves_an_input_without_a_brief_untouched():
    inp = {"text": "wide", "refs": []}
    assert briefs.for_op("frame", inp) is inp
    assert "brief" not in briefs.for_op("generate", {**inp, "brief": SHORT})  # an op that reads none: left out


# ── the budget ───────────────────────────────────────────────────────────────

@pytest.mark.parametrize("op", sorted(briefs.BUDGET))
def test_every_op_reads_the_longest_brief_within_its_budget(op):
    budget, order = briefs.BUDGET[op]
    cut = briefs.for_op(op, {"brief": LONGEST})["brief"]
    assert briefs.size(cut["spine"]) <= budget
    assert set(cut["spine"]) <= set(order)
    assert list(cut["spine"])[0] == next(p for p in order if p in LONGEST["spine"])  # its first part is kept first


def test_a_plan_reads_most_of_a_short_brief_and_a_clip_only_its_tone_feel_and_donts():
    plan = briefs.spine_for("shot_list", SHORT["spine"])
    assert plan == {k: SHORT["spine"][k] for k in ("proposition", "audience", "tone", "feel", "mandatories", "donts", "format")}
    assert briefs.spine_for("clip", SHORT["spine"]) == {k: SHORT["spine"][k] for k in ("tone", "feel", "donts", "audience")}
    assert briefs.spine_for("cutdown", SHORT["spine"])["mandatories"] == SHORT["spine"]["mandatories"]


def _frame_reply(prompt: str, flags=None) -> dict:
    f = fixture("frame_runway_first")
    reply = json.loads(json.dumps(f["reply"]))
    reply["providerJob"]["prompt"] = prompt
    if flags is not None:
        reply["briefFlags"] = flags
    return reply


def test_a_frame_with_the_longest_brief_holds_the_frame_budget_and_the_brief_reaches_dex_cut():
    f = fixture("frame_runway_first")
    base = f["reply"]["providerJob"]["prompt"]
    # A few words of tone, inside the frame's budget: made.
    d, wire = make(_frame_reply(base + " Soft morning light, calm faces."), prompt_version="director.v13")
    d.run("frame", {**_wired(f), "brief": LONGEST}, "runway")
    sent = json.loads(wire.calls[0]["turns"][0]["text"].split("<input>\n", 1)[1].rsplit("\n</input>", 1)[0])
    assert briefs.size(sent["input"]["brief"]["spine"]) <= briefs.BUDGET["frame"][0]
    # The whole brief pasted into the prompt: over the budget, refused (the relay then sends the words as written).
    pasted = base + " " + " ".join(v if isinstance(v, str) else " ".join(v) for v in LONGEST["spine"].values())
    d2, _ = make(_frame_reply(pasted), prompt_version="director.v13")
    with pytest.raises(DirectorError, match="added"):
        d2.run("frame", {**_wired(f), "brief": LONGEST}, "runway")


def _wired(f: dict) -> dict:
    from names import to_wire
    return to_wire(f["op"], f["input"])


# ── the Review flags ─────────────────────────────────────────────────────────

def test_flags_keep_only_lines_the_job_was_given_and_need_a_brief():
    out = {"briefFlags": [
        {"kind": "mandatory", "line": "lumen name first", "note": "The 6 s cut has no shot with the name."},
        {"kind": "mandatory", "line": "Lumen name first.", "note": "twice"},
        {"kind": "dont", "line": "Lumen name first", "note": "wrong kind"},
        {"kind": "dont", "line": "Never show a cat", "note": "not a line of this brief"},
        {"kind": "dont", "line": "Don't show a gym", "note": "A treadmill is in shot 3."}]}
    briefs.settle_flags(out, {"brief": SHORT})
    assert out["briefFlags"] == [
        {"kind": "mandatory", "line": "Lumen name first", "note": "The 6 s cut has no shot with the name."},
        {"kind": "dont", "line": "Don't show a gym", "note": "A treadmill is in shot 3."}]
    none = {"briefFlags": [{"kind": "dont", "line": "Don't show a gym", "note": "x"}]}
    briefs.settle_flags(none, {})
    assert "briefFlags" not in none


def test_dex_flags_a_frame_and_still_makes_it_never_asks():
    f = fixture("frame_runway_first")
    flags = [{"kind": "dont", "line": "Don't show a gym", "note": "The words ask for a gym."}, {"kind": "dont", "line": "invented", "note": "x"}]
    d, _ = make(_frame_reply(f["reply"]["providerJob"]["prompt"], flags), prompt_version="director.v13")
    res = d.run("frame", {**_wired(f), "brief": SHORT}, "runway")
    assert res.output["providerJob"] and res.output["question"] is None
    assert res.output["briefFlags"] == [flags[0]]
    assert res.agent_block["output"]["briefFlags"] == [flags[0]]


def test_the_cutter_reads_the_brief_mandatories_first_and_flags_a_cut_that_drops_one():
    class Port:
        model = "fake"

        def __init__(self):
            self.asked = []

        def call(self, purpose, system, payload, schema, **kw):
            self.asked.append({"system": system, "payload": payload})
            return {"lengths": [], "subjects": [], "rationale": "r", "briefFlags": [
                {"kind": "mandatory", "line": "Lumen name first", "note": "The 6 s cut has no shot with the Lumen name."},
                {"kind": "mandatory", "line": "Made up", "note": "x"}]}
    port = Port()
    cut = {"shots": [{"shotId": new_id("shot"), "words": "She opens the fridge.", "inS": 0, "outS": 3, "takeS": 3}], "lengths": [6]}
    out = cutdowns.ModelCutter(port).plan({"jobId": new_id("job"), "input": {"cutdown": cut, "brief": SHORT}})
    assert "With brief" in port.asked[0]["system"]
    assert list(port.asked[0]["payload"]["brief"]["spine"])[:2] == ["mandatories", "donts"]
    assert out["briefFlags"] == [{"kind": "mandatory", "line": "Lumen name first", "note": "The 6 s cut has no shot with the Lumen name."}]
    port2 = Port()
    out2 = cutdowns.ModelCutter(port2).plan({"jobId": new_id("job"), "input": {"cutdown": cut}})
    assert "brief" not in port2.asked[0]["payload"] and "briefFlags" not in out2


# ── the prompts ──────────────────────────────────────────────────────────────

def test_v13_is_v12_plus_the_brief_lines_only():
    v12 = (PROMPTS / "director.v12.md").read_text().splitlines()
    v13 = (PROMPTS / "director.v13.md").read_text().splitlines()
    added = [line for line in v13 if line not in v12]
    assert [line for line in v12 if line not in v13] == []  # nothing of v12 is changed or lost
    assert all("brief" in line.lower() for line in added if line.strip() and not line.startswith("- Never put") and not line.startswith("- Never break"))
    assert "## The brief" in v13 and "briefFlags" in "\n".join(added)
    d, _ = make(prompt_version="director.v13")
    for op in ("shot_list", "frame", "clip"):
        assert "input.brief" in d.system_for(op).split("## The brief")[1]
    assert "cutter.v2" == cutdowns.PROMPT_VERSION and (PROMPTS / "cutter.v1.md").exists()


# ── the offline eval: one line, three briefs ─────────────────────────────────

BRIEF_CASES = ("brief_quiet_morning", "brief_brisk_gen_z", "brief_premium_ritual")


def test_the_three_brief_cases_share_one_line_and_are_valid_job_inputs():
    cases = {c["id"]: c for c in load()["cases"] if c["id"] in BRIEF_CASES}
    assert len({c["input"]["script"] for c in cases.values()}) == 1
    h = Harness(base_config())
    for c in cases.values():
        assert not h.contracts.errors("relay-api.schema.json#/$defs/JobInput", c["input"]), c["id"]
        assert briefs.size(briefs.for_op("shot_list", c["input"])["brief"]["spine"]) <= briefs.BUDGET["shot_list"][0]


def _plan(n: int, each: float, speed: str | None, words: str, size: str = "medium") -> dict:
    cam = {"size": size, "movement": "static" if speed is None else "push_in", **({"movement_speed": speed} if speed else {})}
    return {"op": "shot_list", "question": None, "rationale": "r", "confidence": 0.8,
            "shots": [{"kind": "shot", "duration_s": each, "camera": cam, "action": f"{words} She opens the fridge; Lumen water, shot {i + 1}."} for i in range(n)]}


def test_the_eval_scores_tell_the_three_plans_apart_as_named():
    """The scorer, not a recording: three plans written to each brief pass their own case and fail the others'
    (no reply is recorded yet: record live on the owner's say)."""
    cases = {c["id"]: c for c in load()["cases"] if c["id"] in BRIEF_CASES}
    plans = {
        "brief_quiet_morning": _plan(3, 5, "slow", "Soft, calm morning light."),
        "brief_brisk_gen_z": _plan(6, 2.5, "fast", "A quick dash, she grabs it."),
        "brief_premium_ritual": _plan(4, 3.75, "slow", "A close detail of the glass bottle.", size="insert"),
    }
    for cid, plan in plans.items():
        for other, case in cases.items():
            checks = score(case, plan)
            assert checks["plans"] and checks["no_quote"] and checks["no_flags"]
            brief_ok = all(v for k, v in checks.items() if k.startswith("brief_"))
            assert brief_ok == (cid == other), (cid, other, checks)
