"""Sequential storyboard frames (director.v3, decided 2026-10-07; director.v6 since contract 3): every
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
                 prompt_version="director.v6")
    res = d.run(f["op"], to_wire(f["op"], payload), f["provider"])
    asked = json.loads(wire.calls[0]["turns"][0]["text"].split("<input>\n")[1].split("\n</input>")[0])
    return res, asked, wire


def test_v6_is_the_default_and_the_configs_name_v9():
    # Contract 3 runs director.v6 (features/contract-v3.clan), per click on Sonnet. The configs name
    # director.v8 (features/canvas-nodes.clan: a shot's required refs, Dex's additions with why; after v7
    # of frame-change-edit and v6.1 of frame-aspect), and v9 (features/runway-video-models.clan: which pictures
    # each clip model carries); the bundle's default stays v6.
    assert PROMPT_VERSION == "director.v6"
    for name in ("config.testing.json", "config.live.json", "config.pathway.runway.json"):
        director = json.loads((EXAMPLES / name).read_text())["director"]
        assert director["promptVersion"] == "director.v9"
        assert director["perClickModel"] == "eu.anthropic.claude-sonnet-5-5"


def test_v6_carries_the_frame_rules():
    v6 = (PROMPTS / "director.v6.md").read_text()
    for rule in (
        "`anchor` (`input.anchorFrame`)",
        "keep the setting, light and style of @anchor",
        "continue from @previous",
        "the shot's moment and setting from its `action`",
        "its `camera` in plain words",
        "Send every one of the shot's refs, @anchor and @previous",
        "`anchor` and `previous` are `object`",
        "Never invent a seed", "are `current`", "`audio` is false", "input.answer",
    ):
        assert rule in v6, rule


def test_first_frame_is_drawn_from_the_views_and_shows_the_setting():
    res, asked, wire = direct("frame_runway_first")
    assert "anchorFrame" not in asked["input"] and "previousFrame" not in asked["input"]
    assert asked["input"]["script"].startswith("It starts to rain")  # the script reaches the director for the setting
    job = res.output["providerJob"]
    assert [(r["name"], r["role"]) for r in job["refs"]] == [("hero_front", "character"), ("hero_side", "character")]
    assert "street" in job["prompt"] and "plain" not in job["prompt"]
    assert job["ratio"] == "768:1344"  # the plain 9:16 mapped to Runway's size
    assert res.agent_block["promptVersion"] == "director.v6"
    assert "## frame" in wire.calls[0]["system"] and "## clip" not in wire.calls[0]["system"]


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

def test_v6_draws_only_the_scripts_on_screen_text_and_never_a_storyboard_sheet():
    # Owner decision 2026-10-07: text only when the script asks for it on screen (carried in the
    # shot's action as On screen: "..."), drawn exactly; spoken lines never; storyboard layout never.
    v6 = (PROMPTS / "director.v6.md").read_text()
    for rule in (
        "a full-bleed cinematic still of the shot's moment, never a sheet, panel or caption",
        "On-screen text only when the action quotes it after `On screen:`",
        "draw it exactly as quoted",
        "Full-bleed cinematic image; no text, captions, borders or panels.",
        "Spoken words are never drawn",
        "No text, captions, subtitles or speech bubbles.",  # clips
        "the box is filled with the scene continuing behind it",  # "remove this card"
        "Put spoken words in beats, never in the action",
    ):
        assert rule in v6, rule


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
                 prompt_version="director.v6")
    res = d.run("shot_list", copy.deepcopy(f["input"]))
    shots = res.output["shots"]
    assert shots[-1]["action"].endswith('On screen: "FACET"')
    assert shots[0]["beats"][0] == {"kind": "line", "at_s": 0, "text": "Every diamond starts as pressure."}
    assert not any("On screen" in s["action"] for s in shots[:-1])  # nothing invented, spoken lines not on screen


def test_a_shot_with_spoken_beats_never_shows_the_model_its_words():
    f = fixture("frame_runway_dialogue")
    assert f["input"]["shot"]["beats"][0]["text"] == "Smooth where it shines."
    res, asked, wire = direct("frame_runway_dialogue")
    assert not [b for b in asked["input"]["shot"].get("beats") or [] if b["kind"] in ("line", "vo")]
    assert "Smooth where it shines" not in wire.calls[0]["turns"][0]["text"].split("<input>")[1].split('"script"')[0]
    assert asked["input"]["shot"]["action"] == f["input"]["shot"]["action"]  # the rest of the shot goes
    job = res.output["providerJob"]
    assert "Smooth where it shines" not in job["prompt"]


def test_clip_requests_lose_spoken_beats_too_but_keep_moments_and_shot_lists_keep_them():
    f = fixture("clip_runway")
    payload = copy.deepcopy(f["input"])
    payload["shot"]["beats"] = [{"kind": "line", "at_s": 1, "text": "Every diamond starts as pressure."},
                                {"kind": "moment", "at_s": 2, "text": "she turns"}]
    wire = FakeWire(f["reply"])
    d = Director(ModelPort(wire, "claude-haiku-4-5", timeout=5), PROMPTS, {"runway": load_sheet("runway")},
                 prompt_version="director.v6")
    d.run("clip", payload, "runway")
    sent = wire.calls[0]["turns"][0]["text"]
    assert "Every diamond" not in sent and "she turns" in sent
    assert payload["shot"]["beats"][0]["kind"] == "line"  # the caller's copy is untouched
    from director.director import _without_dialogue
    shot_list = {"script": "x", "targetS": 10, "shot": {"beats": [{"kind": "line", "at_s": 0, "text": "kept"}]}}
    assert _without_dialogue("shot_list", shot_list) is shot_list


def test_a_frame_that_leaves_out_a_view_its_shot_names_is_refused():
    # Owner 2026-10-15 (features/canvas-nodes.clan): the shot names hero_front and hero_side; both go.
    def drop_side(r):
        r["providerJob"]["refs"] = [x for x in r["providerJob"]["refs"] if x["name"] != "hero_side"]
    with pytest.raises(DirectorError, match="left out @hero_side"):
        direct("frame_runway_first", drop_side)
