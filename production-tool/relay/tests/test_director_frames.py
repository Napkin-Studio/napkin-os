"""Sequential storyboard frames (director.v2.1, decided 2026-10-07): every frame after the first
carries the character views (identity), shot 1's frame as @anchor (setting, light, style) and the
frame before as @previous (continuity), and a frame always shows its setting."""

import copy
import json
from pathlib import Path

import pytest

from director import Director, DirectorError
from director.base import PassthroughDirector
from director.claude import PROMPT_VERSION
from director.model import ModelPort, Reply
from providers import load_sheet

HERE = Path(__file__).parent
FIXTURES = HERE / "fixtures" / "director"
PROMPTS = HERE.parent / "prompts"
EXAMPLES = HERE.parents[1] / "contracts" / "examples"


def fixture(name):
    return json.loads((FIXTURES / f"{name}.json").read_text())


class FakeWire:
    api = "anthropic"

    def __init__(self, *replies):
        self.replies = list(replies)
        self.calls = []

    def send(self, **kw):
        self.calls.append(kw)
        return Reply(json.dumps(self.replies.pop(0)), "ok", (120, 60))


def direct(name, edit_reply=lambda r: None, edit_input=lambda i: None):
    f = fixture(name)
    reply, payload = copy.deepcopy(f["reply"]), copy.deepcopy(f["input"])
    edit_reply(reply), edit_input(payload)
    wire = FakeWire(reply)
    d = Director(ModelPort(wire, "claude-haiku-4-5", timeout=5), PROMPTS, {"runway": load_sheet("runway")},
                 prompt_version="director.v2.1")
    res = d.run(f["op"], payload, f["provider"])
    asked = json.loads(wire.calls[0]["turns"][0]["text"].split("<input>\n")[1].split("\n</input>")[0])
    return res, asked, wire


def test_v2_1_is_the_default_and_the_configs_name_it():
    assert PROMPT_VERSION == "director.v2.1"
    for name in ("config.testing.json", "config.event.json"):
        assert json.loads((EXAMPLES / name).read_text())["director"]["promptVersion"] == "director.v2.1"


def test_v2_1_carries_the_frame_rules_and_keeps_v2s():
    v2, v21 = (PROMPTS / "director.v2.md").read_text(), (PROMPTS / "director.v2.1.md").read_text()
    for rule in (
        "`anchor` (input.anchorFrame)",
        "keep the setting, lighting, palette and style of @anchor",
        "continue from @previous: positions, props and action carry over",
        "The frame MUST show the shot's setting",
        "never a character on a plain or empty background",
        "apply ONLY to generate and view, never to frame",
        "The character must be identical to the views",
        "`anchor` and `previous` are `object`",
    ):
        assert rule in v21, rule
    # Everything v2 asked of generate and view is still there.
    for rule in ("It sets the design", "neutral standing pose", "plain light background", "Never add a background scene",
                 "canonical @tags", "Keep the seed", "0.25", "role `current`", "`audio` to false", "input.answer"):
        assert rule in v21, rule
    assert "anchorFrame" not in v2


def test_first_frame_is_drawn_from_the_views_and_shows_the_setting():
    res, asked, wire = direct("frame_runway_first")
    assert "anchorFrame" not in asked["input"] and "previousFrame" not in asked["input"]
    assert asked["input"]["script"].startswith("It starts to rain")  # the script reaches the director for the setting
    job = res.output["providerJob"]
    assert [(r["name"], r["role"]) for r in job["refs"]] == [("front", "character")]
    assert "street" in job["prompt"] and "plain" not in job["prompt"]
    assert job["ratio"] == "768:1344"  # the plain 9:16 mapped to Runway's size
    assert res.agent_block["promptVersion"] == "director.v2.1"
    assert wire.calls[0]["system"] == (PROMPTS / "director.v2.1.md").read_text()


def test_a_later_frame_names_the_anchor_and_the_previous_frame():
    res, asked, _ = direct("frame_runway_anchor")
    f = fixture("frame_runway_anchor")["input"]
    assert asked["input"]["anchorFrame"] == f["anchorFrame"] and asked["input"]["previousFrame"] == f["previousFrame"]
    job = res.output["providerJob"]
    by_name = {r["name"]: r for r in job["refs"]}
    assert by_name["anchor"] == {"sha256": f["anchorFrame"]["sha256"], "name": "anchor", "role": "object"}
    assert by_name["previous"] == {"sha256": f["previousFrame"]["sha256"], "name": "previous", "role": "object"}
    assert by_name["front"]["role"] == by_name["side"]["role"] == "character"
    assert "@anchor" in job["prompt"] and "@previous" in job["prompt"]


def test_the_anchor_hash_is_an_input_hash_and_a_stray_one_is_refused():
    # The director's own check walks every hash in the input, anchorFrame included.
    direct("frame_runway_anchor")
    with pytest.raises(DirectorError, match="not in the input"):
        direct("frame_runway_anchor", edit_input=lambda i: i.pop("anchorFrame"))


def test_an_unused_anchor_tag_is_refused():
    def drop_anchor_ref(r):
        r["providerJob"]["refs"] = [x for x in r["providerJob"]["refs"] if x["name"] != "anchor"]
    with pytest.raises(DirectorError):
        direct("frame_runway_anchor", edit_reply=drop_anchor_ref)  # @anchor in the prompt with no ref


def test_passthrough_sends_previous_then_anchor_and_one_picture_once():
    f = fixture("frame_runway_anchor")
    out = PassthroughDirector().direct({"jobId": "job_x", "op": "frame", "input": f["input"]}, load_sheet("runway"))
    names = [(r["name"], r["role"]) for r in out["providerJob"]["refs"]]
    assert names[-2:] == [("previous", "object"), ("anchor", "object")]
    same = {**f["input"], "anchorFrame": f["input"]["previousFrame"]}  # shot 2: frame 1 is both
    out = PassthroughDirector().direct({"jobId": "job_x", "op": "frame", "input": same}, load_sheet("runway"))
    assert [r["name"] for r in out["providerJob"]["refs"]].count("previous") == 1
    assert "anchor" not in [r["name"] for r in out["providerJob"]["refs"]]
