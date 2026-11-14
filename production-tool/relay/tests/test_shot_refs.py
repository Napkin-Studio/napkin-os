"""The references a shot sends (owner 2026-10-15, features/canvas-nodes.clan): "The script — instead of
just using '@samurai' — used different references for the frames, unless it offers a definite advantage
(then it's fine)." A frame or clip sends the refs its shot's words mention and those linked into it
(required); any other ref comes `optional`, and goes only with a reason in `added`. A plan and Skye keep
the script's @names. Director contract tests on a fake model, no network."""

import copy
import json
from pathlib import Path

import pytest

from director import Director, DirectorError
from director.base import PassthroughDirector
from director.claude import ClaudeDirector
from director.model import ModelPort, Reply
from names import fit_refs, to_wire
from providers import load_sheet

HERE = Path(__file__).parent
PROMPTS = HERE.parent / "prompts"
FIXTURE = json.loads((HERE / "fixtures" / "director" / "frame_runway_anchor.json").read_text())
SIDE, FRONT = "sha256:" + "2" * 64, "sha256:" + "1" * 64
EXTRA = "sha256:" + "3" * 64


class FakeWire:
    api = "anthropic"

    def __init__(self, *replies):
        self.replies, self.calls = list(replies), []

    def send(self, **kw):
        self.calls.append(kw)
        return Reply(json.dumps(self.replies.pop(0)), "ok", (120, 60))


def offered(payload):
    """The fixture's frame input with one more picture in scope, offered (not named by the shot)."""
    payload["refs"].append({"id": "ref_01K6XA6Z0000000000000013VW", "name": "hero_back", "role": "character",
                            "kind": "generated", "optional": True,
                            "asset": {"sha256": EXTRA, "url": f"https://hack.napkin.ie/in/{EXTRA}", "mime": "image/png"}})


def run(edit_reply=lambda r: None, edit_input=lambda i: None, op="frame", version="director.v8"):
    reply, payload = copy.deepcopy(FIXTURE["reply"]), copy.deepcopy(FIXTURE["input"])
    edit_input(payload), edit_reply(reply)
    reply["op"] = op
    d = Director(ModelPort(FakeWire(reply), "claude-haiku-4-5", timeout=5), PROMPTS,
                 {"runway": load_sheet("runway")}, prompt_version=version)
    return d.run(op, to_wire(op, payload), "runway").output


def refs_of(out):
    return [r["name"] for r in out["providerJob"]["refs"]]


def test_a_frame_that_sends_every_required_ref_passes_unchanged():
    out = run()
    assert refs_of(out) == ["hero_side", "hero_front", "anchor", "previous"] and "added" not in out


def test_leaving_out_a_required_ref_is_refused():
    def drop_front(r):
        r["providerJob"]["refs"] = [x for x in r["providerJob"]["refs"] if x["name"] != "hero_front"]
        r["providerJob"]["prompt"] = r["providerJob"]["prompt"].replace("@hero_side and @hero_front", "@hero_side")
    with pytest.raises(DirectorError, match="left out @hero_front"):
        run(drop_front)


def test_swapping_a_named_view_for_an_offered_one_is_refused_even_with_a_reason():
    """The owner's case at the frame: the shot names @hero_front; Dex sends @hero_back instead."""
    def swap(r):
        for x in r["providerJob"]["refs"]:
            if x["name"] == "hero_front":
                x.update(sha256=EXTRA, name="hero_back")
        r["providerJob"]["prompt"] = r["providerJob"]["prompt"].replace("@hero_front", "@hero_back")
        r["added"] = [{"name": "hero_back", "why": "the back reads better"}]
    with pytest.raises(DirectorError, match="left out @hero_front"):
        run(swap, offered)


def test_an_offered_ref_sent_with_a_reason_goes_and_is_listed_as_added():
    def add_back(r):
        r["providerJob"]["refs"].insert(2, {"sha256": EXTRA, "name": "hero_back", "role": "character"})
        r["added"] = [{"name": "hero_back", "why": "she turns away mid-splash; only the back shows it"}]
    out = run(add_back, offered)
    assert "hero_back" in refs_of(out)
    assert out["added"] == [{"name": "hero_back", "why": "she turns away mid-splash; only the back shows it"}]


def test_an_offered_ref_sent_without_a_reason_is_taken_out_and_said_in_words():
    def add_back(r):
        r["providerJob"]["refs"].insert(2, {"sha256": EXTRA, "name": "hero_back", "role": "character"})
        r["providerJob"]["prompt"] += " Her back as in @hero_back."
    out = run(add_back, offered)
    assert "hero_back" not in refs_of(out) and "added" not in out
    assert "@hero_back" not in out["providerJob"]["prompt"] and "hero back" in out["providerJob"]["prompt"]


def test_added_never_lists_a_required_ref_or_one_not_sent():
    def claim(r):
        r["added"] = [{"name": "hero_front", "why": "identity"}, {"name": "hero_back", "why": "not sent at all"}]
    out = run(claim, offered)
    assert "added" not in out


def test_a_runway_clip_from_its_frame_carries_no_refs_and_that_is_not_a_missing_ref():
    """Runway takes no refs beside a first frame (video.firstFrameWithRefs false): the relay drops them,
    the frame carries the character, and the rule does not refuse the answer."""
    def clip(r):
        pj = r["providerJob"]
        pj.update(model="veo3.1", firstFrame="sha256:" + "c" * 64, durationS=6, ratio="720:1280", prompt="She splashes through. The camera pans.")
        pj["refs"] = []
        pj.pop("outputs", None)
    def image(i):
        i["image"] = {"sha256": "sha256:" + "c" * 64, "url": "https://hack.napkin.ie/in/c", "mime": "image/png"}
        i.pop("anchorFrame"), i.pop("previousFrame")
    out = run(clip, image, op="clip")
    assert out["providerJob"]["refs"] == []


def test_the_fallback_after_a_refusal_sends_exactly_the_required_refs():
    """A refused answer is made as written by the passthrough: the shot's refs, never an offered one."""
    reply = copy.deepcopy(FIXTURE["reply"])
    reply["providerJob"]["refs"] = [x for x in reply["providerJob"]["refs"] if x["name"] != "hero_front"]
    payload = copy.deepcopy(FIXTURE["input"])
    offered(payload)
    d = ClaudeDirector(Director(ModelPort(FakeWire(reply, reply), "claude-haiku-4-5", timeout=5), PROMPTS,
                                {"runway": load_sheet("runway")}, prompt_version="director.v8"))
    out = d.direct({"jobId": "job_x", "op": "frame", "input": to_wire("frame", payload)}, load_sheet("runway"))
    assert "left out @hero_front" in out["rationale"]
    sent = {r["sha256"] for r in out["providerJob"]["refs"]}
    assert {SIDE, FRONT} <= sent and EXTRA not in sent


def test_the_passthrough_never_adds_an_offered_ref():
    payload = copy.deepcopy(FIXTURE["input"])
    offered(payload)
    out = PassthroughDirector().direct({"op": "frame", "input": to_wire("frame", payload)}, load_sheet("runway"))
    assert EXTRA not in {r["sha256"] for r in out["providerJob"]["refs"]}


def test_over_the_character_limit_an_offered_ref_goes_first():
    payload = copy.deepcopy(FIXTURE["input"])
    offered(payload)
    fitted, dropped = fit_refs("frame", payload, {"refs": {"max": 14, "maxCharacter": 2}})
    assert dropped == ["hero_back"] and [r["name"] for r in fitted["refs"]] == ["hero_front", "hero_side"]


# ── a plan keeps the script's names ────────────────────────────────────────────

def plan_reply(shots):
    return {"op": "shot_list", "question": None, "rationale": "r", "confidence": 0.8, "shots": shots}


def shot(action, refs, at=1):
    return {"kind": "shot", "duration_s": 5, "camera": {"size": "medium"}, "action": action, "refs": refs,
            "beats": [{"kind": "moment", "at_s": at, "text": action}]}


def samurai_refs():
    return [{"id": f"ref_01K6XA6Z00000000000000{n}VW", "name": f"samurai_{v}", "role": "character", "kind": "generated",
             "asset": {"sha256": "sha256:" + str(n)[0] * 64, "url": "https://x/in", "mime": "image/png"}}
            for n, v in ((10, "front"), (20, "three-quarter"), (30, "side"), (40, "back"))]


def test_a_plan_puts_a_swapped_view_back_to_the_bare_key_the_script_names():
    """The owner's case: the script says @samurai; the plan wrote one view per shot."""
    payload = {"script": "@samurai sweeps the hall. @samurai folds the laundry. @samurai_back looks out.", "targetS": 15,
               "refs": samurai_refs()}
    reply = plan_reply([shot("@samurai_side sweeps the hall.", ["samurai_side"]),
                        shot("@samurai_three-quarter folds the laundry.", ["samurai_three-quarter"]),
                        shot("@samurai_back looks out.", ["samurai_back"])])
    d = Director(ModelPort(FakeWire(reply), "claude-haiku-4-5", timeout=5), PROMPTS, {}, prompt_version="director.v8")
    shots = d.run("shot_list", payload).output["shots"]
    assert [s["action"] for s in shots] == ["@samurai sweeps the hall.", "@samurai folds the laundry.", "@samurai_back looks out."]
    assert [s["refs"] for s in shots] == [["samurai"], ["samurai"], ["samurai_back"]]
    assert shots[0]["beats"][0]["text"] == "@samurai sweeps the hall."


def test_v8_says_required_refs_stay_and_additions_carry_why_and_v7_still_loads():
    d = Director(None, PROMPTS, {}, prompt_version="director.v8")
    frame, plan = d.system_for("frame"), d.system_for("shot_list")
    assert "Never leave one out, and never swap it for another picture" in frame and "`added`" in frame
    assert "A bare `@samurai` stays `@samurai`" in plan
    assert Director(None, PROMPTS, {}, prompt_version="director.v7").prompt_version == "director.v7"
