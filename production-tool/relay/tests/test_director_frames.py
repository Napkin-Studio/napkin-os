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


def test_the_newest_prompt_is_the_default_and_the_configs_name_none():
    # Contract 3 runs director.v6 or later (features/contract-v3.clan), per click on Sonnet. Since
    # features/config-defaults.clan the bundle's default is the newest prompt (director.v17) and the
    # example configs name no director block: config.json pins a prompt only to roll back.
    assert PROMPT_VERSION == "director.v17"
    for name in ("config.testing.json", "config.live.json", "config.pathway.runway.json"):
        assert "director" not in json.loads((EXAMPLES / name).read_text()), name


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


def test_a_frames_prompt_says_no_clock_time_unless_its_shot_asks_for_words_on_screen():
    # UAT round 4, R4-F10: frame 1's prompt carried "1 a.m." (the clip rule did not reach frames).
    def reply(r):
        r["providerJob"]["prompt"] = "1 a.m. A dark shared kitchen. " + r["providerJob"]["prompt"]
    res, _, _ = direct("frame_runway_first", edit_reply=reply)
    assert "a.m" not in res.output["providerJob"]["prompt"]
    assert res.output["providerJob"]["prompt"].startswith("in the small hours. A dark shared kitchen.")
    shown, _, _ = direct("frame_runway_first", edit_reply=lambda r: r["providerJob"].update(prompt="The oven clock reads 1:04 a.m., " + r["providerJob"]["prompt"]),
                         edit_input=lambda i: i["shot"].update(action="The oven clock reads 1:04 a.m."))
    assert "1:04 a.m." in shown.output["providerJob"]["prompt"]


def test_r5_a_frame_of_a_shot_with_no_one_says_no_people_in_its_prompt():
    """UAT round 5 (R5-F3): the kettle insert, which shows no one, was drawn with Maya beside it. The web's direction says
    no one is seen (web jobs/cast.ts NO_ONE_LINE); the relay puts its own line in the frame's prompt."""
    from director.director import NO_PEOPLE, _no_people

    sheet = load_sheet("runway")
    shot = {"action": "The kettle glows soft blue.", "direction": "Cast: no one is seen in this shot; draw no people."}
    job = {"model": "gemini_image3_pro", "prompt": "An insert of a kettle glowing soft blue. Full-bleed cinematic image; no text, captions, borders or panels.",
           "refs": [{"name": "anchor", "role": "object"}]}
    _no_people(job, "frame", {"shot": shot}, sheet)
    assert NO_PEOPLE in job["prompt"]
    assert job["prompt"].endswith("Full-bleed cinematic image; no text, captions, borders or panels.")
    # Said once; not on a frame with a character picture, not without the web's line, not on a clip.
    again = dict(job)
    _no_people(again, "frame", {"shot": shot}, sheet)
    assert again["prompt"].count(NO_PEOPLE) == 1
    for j, op, payload in ((
        {"prompt": "A kettle.", "refs": [{"name": "maya_front", "role": "character"}]}, "frame", {"shot": shot}),
        ({"prompt": "A kettle.", "refs": []}, "frame", {"shot": {"action": "Maya whispers."}}),
        ({"prompt": "A kettle.", "refs": []}, "clip", {"shot": shot}),
        ({"prompt": "A kettle, no person in sight.", "refs": []}, "frame", {"shot": shot})):
        _no_people(j, op, payload, sheet)
        assert NO_PEOPLE not in j["prompt"]


FERNCLIFF_FACES = "No real people's faces on posters, in the film or on social."
CROWDED_TRAM = "A crowded tram at rush hour. Hands grip the rails; commuters pack the aisle."


def _brief(*mandatories):
    return {"title": "Ferncliff brief", "spine": {"proposition": "Flat out good.", "mandatories": list(mandatories), "donts": []}}


def test_a_frame_of_a_crowded_tram_says_people_may_appear_but_no_one_is_recognisable_when_the_linked_brief_says_no_real_faces():
    """UAT 2026-11-24: the brief said 'No real people's faces'; the frames of the crowded tram showed clear, real
    faces. 'No real faces' means unrecognisable only (owner 2026-11-23): its own line, even when the shot shows people."""
    from director.director import UNRECOGNISABLE

    def with_brief(i):
        i["shot"]["action"] = CROWDED_TRAM
        i["brief"] = _brief(FERNCLIFF_FACES)

    res, _, _ = direct("frame_runway_first", edit_input=with_brief)
    prompt = res.output["providerJob"]["prompt"]
    assert UNRECOGNISABLE in prompt and prompt.count(UNRECOGNISABLE) == 1

    def no_brief(i):
        i["shot"]["action"] = CROWDED_TRAM

    res, _, _ = direct("frame_runway_first", edit_input=no_brief)
    assert UNRECOGNISABLE not in res.output["providerJob"]["prompt"]  # a brief reaches a job only when linked

    def other_brief(i):
        i["shot"]["action"] = CROWDED_TRAM
        i["brief"] = _brief("Include the can on every poster.")

    res, _, _ = direct("frame_runway_first", edit_input=other_brief)
    assert UNRECOGNISABLE not in res.output["providerJob"]["prompt"]


def test_a_clip_gets_the_line_too_even_though_its_brief_budget_has_no_mandatories():
    from director.director import UNRECOGNISABLE

    def with_brief(i):
        i["brief"] = _brief(FERNCLIFF_FACES)

    res, asked, _ = direct("clip_runway", edit_input=with_brief)
    assert UNRECOGNISABLE in res.output["providerJob"]["prompt"]
    assert "No real people" not in json.dumps(asked.get("brief", {}))  # the cut brief a clip reads has no mandatory
    res, _, _ = direct("clip_runway")
    assert UNRECOGNISABLE not in res.output["providerJob"]["prompt"]


@pytest.mark.parametrize("line,yes", [
    ("No real people's faces on posters", True), ("No real faces.", True), ("no identifiable people", True),
    ("No recognisable people or celebrities", True), ("Never show recognizable faces", True), ("No faces at all", True),
    ("Include the can on every poster", False), ("Real people tested the flavour", False), ("No real sugar", False),
])
def test_the_brief_phrasings_of_no_real_faces(line, yes):
    import brief as briefs

    assert briefs.no_real_faces(_brief(line)) is yes
    assert briefs.no_real_faces({"title": "t", "spine": {"mandatories": [], "donts": [line]}}) is yes
    assert briefs.no_real_faces(None) is False


def test_a_clip_the_passthrough_made_says_it_too_the_tidewell_uat_take_had_no_such_line():
    """UAT 2026-11-23: the one-video take went out as the passthrough (director.v0) with the brief linked, so the film's
    last shot showed laughing faces. The relay says the line on any frame or clip answer, whoever wrote it."""
    from director.director import UNRECOGNISABLE, say_unrecognisable

    sheet = load_sheet("runway")
    brief = _brief("No real, recognisable faces (we had an issue with a lookalike last year).")
    out = {"providerJob": {"provider": "runway", "model": "wan3", "prompt": "Shot 5 [10.38-13 s] Silhouettes laugh."}}
    say_unrecognisable(out, "clip", brief, sheet)
    assert UNRECOGNISABLE in out["providerJob"]["prompt"]
    say_unrecognisable(out, "clip", brief, sheet)
    assert out["providerJob"]["prompt"].count(UNRECOGNISABLE) == 1
    plain = {"providerJob": {"provider": "runway", "model": "wan3", "prompt": "A can."}}
    say_unrecognisable(plain, "clip", _brief("Include the can."), sheet)
    say_unrecognisable(plain, "resize", brief, sheet)
    assert UNRECOGNISABLE not in plain["providerJob"]["prompt"]
