"""Sequential storyboard frames (director.v3, decided 2026-10-07; director.v4 since contract v2): every
frame carries the shot's named refs (identity), and every frame after the first shot 1's frame as @anchor (setting, light, style) and the
frame before as @previous (continuity), and a frame always shows its setting."""

import copy
import json
from pathlib import Path

import pytest

from director import Director, DirectorError
from director.base import PassthroughDirector
from director.claude import PROMPT_VERSION
from director.model import ModelPort, Reply
from names import to_wire
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
                 prompt_version="director.v4")
    res = d.run(f["op"], to_wire(f["op"], payload), f["provider"])
    asked = json.loads(wire.calls[0]["turns"][0]["text"].split("<input>\n")[1].split("\n</input>")[0])
    return res, asked, wire


def test_v4_is_the_default_and_the_configs_name_it():
    assert PROMPT_VERSION == "director.v4"
    for name in ("config.testing.json", "config.event.json"):
        assert json.loads((EXAMPLES / name).read_text())["director"]["promptVersion"] == "director.v4"


def test_v4_carries_the_frame_rules():
    v4 = (PROMPTS / "director.v4.md").read_text()
    for rule in (
        "`anchor` (input.anchorFrame)",
        "keep the setting, lighting, palette and style of @anchor",
        "continue from @previous: positions, props and action carry over",
        "The frame MUST show the shot's setting",
        "never a character on a plain or empty background",
        "apply ONLY to generate and view, never to frame",
        "the ones `shot.refs` lists",
        "A character must be identical to its refs",
        "`anchor` and `previous` are `object`",
        "neutral standing pose", "plain light background", "Never add a background scene",
        "Keep the seed", "0.25", "role `current`", "`audio` to false", "input.answer",
    ):
        assert rule in v4, rule


def test_first_frame_is_drawn_from_the_views_and_shows_the_setting():
    res, asked, wire = direct("frame_runway_first")
    assert "anchorFrame" not in asked["input"] and "previousFrame" not in asked["input"]
    assert asked["input"]["script"].startswith("It starts to rain")  # the script reaches the director for the setting
    job = res.output["providerJob"]
    assert [(r["name"], r["role"]) for r in job["refs"]] == [("hero_front", "character")]
    assert "street" in job["prompt"] and "plain" not in job["prompt"]
    assert job["ratio"] == "768:1344"  # the plain 9:16 mapped to Runway's size
    assert res.agent_block["promptVersion"] == "director.v4"
    assert wire.calls[0]["system"] == (PROMPTS / "director.v4.md").read_text()


def test_a_later_frame_names_the_anchor_and_the_previous_frame():
    res, asked, _ = direct("frame_runway_anchor")
    f = fixture("frame_runway_anchor")["input"]
    assert asked["input"]["anchorFrame"] == f["anchorFrame"] and asked["input"]["previousFrame"] == f["previousFrame"]
    job = res.output["providerJob"]
    by_name = {r["name"]: r for r in job["refs"]}
    assert by_name["anchor"] == {"sha256": f["anchorFrame"]["sha256"], "name": "anchor", "role": "object"}
    assert by_name["previous"] == {"sha256": f["previousFrame"]["sha256"], "name": "previous", "role": "object"}
    assert by_name["hero_front"]["role"] == by_name["hero_side"]["role"] == "character"
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
    f["input"] = to_wire("frame", f["input"])
    out = PassthroughDirector().direct({"jobId": "job_x", "op": "frame", "input": f["input"]}, load_sheet("runway"))
    names = [(r["name"], r["role"]) for r in out["providerJob"]["refs"]]
    assert names[-2:] == [("previous", "object"), ("anchor", "object")]
    same = {**f["input"], "anchorFrame": f["input"]["previousFrame"]}  # shot 2: frame 1 is both
    out = PassthroughDirector().direct({"jobId": "job_x", "op": "frame", "input": same}, load_sheet("runway"))
    assert [r["name"] for r in out["providerJob"]["refs"]].count("previous") == 1
    assert "anchor" not in [r["name"] for r in out["providerJob"]["refs"]]


# ── No text in frames (decided 2026-10-07, the FACET ad) ────────────────────────────────────
# Shot 4's frame came back as a storyboard-sheet panel with a "Dialogue - Smooth where it shines."
# caption box, and every clip made from it kept the card. Dialogue is voice-over: it never reaches
# the model for a frame or a clip, and the prompt asks for a full-bleed image with no text.

def test_v4_draws_only_the_scripts_on_screen_text_and_never_a_storyboard_sheet():
    # Owner decision 2026-10-07: text only when the script asks for it on screen (carried in the
    # shot's action as On screen: "..."), drawn exactly; spoken lines never; storyboard layout never.
    v4 = (PROMPTS / "director.v4.md").read_text()
    for rule in (
        "one full-bleed cinematic image",
        "Never, in any case, a storyboard sheet or a panel on a page",
        "no caption boxes, no \"Dialogue:\"",
        "no panel borders or frames-within-frames",
        "On-screen text only when asked",
        "Draw exactly that text, spelled and cased exactly as quoted",
        "When neither asks for text, there is none",
        "Full-bleed cinematic image; no text, captions, subtitles, speech bubbles, borders or panels.",
        "Dialogue is never drawn",
        "Lines in `input.script` that are spoken are not on-screen text either",
        "No text, captions, subtitles or speech bubbles.",  # clips
        "the region is filled with the scene continuing behind it",  # "remove this card"
        "write it into that shot's `action` in quotes, exactly as the script spells it: `On screen: \"FACET\"`",
        "never invent on-screen text",
    ):
        assert rule in v4, rule


def test_on_screen_text_in_the_action_is_asked_for_exactly():
    f = fixture("frame_runway_on_screen")
    assert f["input"]["shot"]["action"].endswith('On screen: "FACET"')
    res, asked, _ = direct("frame_runway_on_screen")
    assert asked["input"]["shot"]["action"] == f["input"]["shot"]["action"]  # the action reaches the model whole
    prompt = res.output["providerJob"]["prompt"]
    assert 'The text "FACET" appears exactly as written' in prompt
    assert prompt.endswith("no other text, no captions, speech bubbles, borders or panels.")


def test_the_shot_list_moves_script_supers_into_the_action_and_keeps_spoken_lines_as_dialogue():
    f = fixture("shot_list_on_screen")
    wire = FakeWire(f["reply"])
    d = Director(ModelPort(wire, "claude-haiku-4-5", timeout=5), PROMPTS, {"runway": load_sheet("runway")},
                 prompt_version="director.v4")
    res = d.run("shot_list", copy.deepcopy(f["input"]))
    shots = res.output["shots"]
    assert shots[-1]["action"].endswith('On screen: "FACET"')
    assert shots[0]["dialogue"] == "Every diamond starts as pressure."
    assert not any("On screen" in s["action"] for s in shots[:-1])  # nothing invented, spoken lines not on screen


def test_a_shot_with_dialogue_never_shows_the_model_its_words():
    f = fixture("frame_runway_dialogue")
    assert f["input"]["shot"]["dialogue"] == "Smooth where it shines."  # an older page still sends it
    res, asked, wire = direct("frame_runway_dialogue")
    assert "dialogue" not in asked["input"]["shot"]
    assert '"dialogue"' not in wire.calls[0]["turns"][0]["text"]  # (the script may still hold the words; the prompt rules cover it)
    assert asked["input"]["shot"]["action"] == f["input"]["shot"]["action"]  # the rest of the shot goes
    job = res.output["providerJob"]
    # Only dialogue, no On screen text: the prompt forbids all text.
    assert job["prompt"].endswith("Full-bleed cinematic image; no text, captions, subtitles, speech bubbles, borders or panels.")
    assert "Smooth where it shines" not in job["prompt"]


def test_clip_requests_lose_the_dialogue_too_but_shot_lists_keep_it():
    f = fixture("clip_runway")
    payload = copy.deepcopy(f["input"])
    payload["shot"]["dialogue"] = "Every diamond starts as pressure."
    wire = FakeWire(f["reply"])
    d = Director(ModelPort(wire, "claude-haiku-4-5", timeout=5), PROMPTS, {"runway": load_sheet("runway")},
                 prompt_version="director.v4")
    d.run("clip", payload, "runway")
    assert "Every diamond" not in wire.calls[0]["turns"][0]["text"]
    assert payload["shot"]["dialogue"] == "Every diamond starts as pressure."  # the caller's copy is untouched
    from director.director import _without_dialogue
    shot_list = {"script": "x", "targetS": 10, "shot": {"dialogue": "kept"}}
    assert _without_dialogue("shot_list", shot_list) is shot_list
