import copy
import json
from pathlib import Path

import pytest
from jsonschema import Draft202012Validator, FormatChecker
from referencing import Registry, Resource

from director import Director, DirectorError, bundle, load_schemas
from director.model import ModelError, ModelPort, Reply
from providers import load_sheet
from providers.types import CONTRACTS

HERE = Path(__file__).parent
FIXTURES = HERE / "fixtures" / "director"
PROMPTS = HERE.parent / "prompts"
SERVER = HERE.parents[2] / "server" / "napkin"
BASE = "https://napkin.ie/production-tool/contracts/"


def fixture(name):
    return json.loads((FIXTURES / f"{name}.json").read_text())


class FakeWire:
    """Stands in for the provider's endpoint under the real ModelPort: replays recorded replies."""
    api = "anthropic"

    def __init__(self, *replies):
        self.replies = list(replies)
        self.calls = []

    def send(self, **kw):
        self.calls.append(kw)
        r = self.replies.pop(0)
        return Reply(r if isinstance(r, str) else json.dumps(r), "ok", (120, 60))


def make(*replies, **kw):
    wire = FakeWire(*replies)
    port = ModelPort(wire, "claude-haiku-4-5", timeout=5)
    sheets = {n: load_sheet(n) for n in ("mock", "runway", "fal", "heygen")}
    return Director(port, PROMPTS, sheets, **kw), wire


def run(name, director, **kw):
    f = fixture(name)
    return director.run(f["op"], f["input"], f["provider"], **kw)


# --- the copied model port ---------------------------------------------------

@pytest.mark.parametrize("name", ["model.py", "model_routes.py", "metrics.py"])
def test_copy_has_not_drifted_from_the_original(name):
    header, _, body = (HERE.parent / "director" / name).read_text().partition("\n")
    assert header == f"# Copied from server/napkin/{name}; keep in step until the shared package (D8)"
    assert body == (SERVER / name).read_text(), f"{name} differs from server/napkin/{name}"


# --- fixtures and the schema -------------------------------------------------

def test_recorded_inputs_are_valid_job_inputs():
    schemas = load_schemas()
    registry = Registry().with_resources((BASE + n, Resource.from_contents(s)) for n, s in schemas.items())
    v = Draft202012Validator({"$ref": BASE + "relay-api.schema.json#/$defs/JobInput"}, registry=registry,
                             format_checker=FormatChecker())
    for f in FIXTURES.glob("*.json"):
        assert not list(v.iter_errors(json.loads(f.read_text())["input"])), f.name


def test_bundled_schema_is_self_contained():
    schema = bundle(load_schemas())
    assert '"$ref"' not in json.dumps(schema)
    Draft202012Validator.check_schema(schema)
    Draft202012Validator(schema)  # resolves with no registry, as the model port needs


# --- the recorded cases ------------------------------------------------------

def test_generate_on_runway():
    d, wire = make(fixture("generate_runway")["reply"])
    res = run("generate_runway", d, job_id="job_x")
    job = res.output["providerJob"]
    assert job["provider"] == "runway" and job["ratio"] == "896:1152"
    assert [r["name"] for r in job["refs"]] == ["sketch", "eyes", "palette"]
    assert res.usage == {"input_tokens": 120, "output_tokens": 60}
    sent = wire.calls[0]
    assert sent["model"] == "claude-haiku-4-5" and sent["system"] == (PROMPTS / "director.v2.md").read_text()
    asked = json.loads(sent["turns"][0]["text"].split("<input>\n")[1].split("\n</input>")[0])
    assert asked["provider"] == "runway" and asked["sheet"]["tagSyntax"] == "at_tag" and asked["op"] == "generate"


def test_region_edit_on_fal_is_a_masked_inpaint():
    d, wire = make(fixture("region_edit_fal_mask")["reply"])
    res = run("region_edit_fal_mask", d)
    job = res.output["providerJob"]
    assert job["mask"] == fixture("region_edit_fal_mask")["input"]["mask"]["sha256"]
    assert job["refs"][0]["role"] == "current"
    asked = json.loads(wire.calls[0]["turns"][0]["text"].split("<input>\n")[1].split("\n</input>")[0])
    assert asked["regionAreaFraction"] == 0.03  # computed here, not by the model


def test_region_edit_on_runway_regenerates_from_the_parent():
    d, _ = make(fixture("region_edit_runway")["reply"])
    job = run("region_edit_runway", d).output["providerJob"]
    assert "mask" not in job and [r["role"] for r in job["refs"]] == ["current"]


def test_clip_is_sent_with_audio_false():
    reply = fixture("clip_runway")["reply"]
    d, _ = make(reply)
    assert run("clip_runway", d).output["providerJob"]["audio"] is False
    del reply["providerJob"]["audio"]  # a model that leaves it out still gets an explicit false
    d, _ = make(reply)
    assert run("clip_runway", d).output["providerJob"]["audio"] is False


def test_shot_list_sums_to_the_target_and_uses_the_shot_list_model():
    d, wire = make(fixture("shot_list")["reply"], shot_list_model="claude-sonnet-5-5")
    res = run("shot_list", d)
    shots = res.output["shots"]
    assert 2 <= len(shots) <= 8 and sum(s["duration_s"] for s in shots) == 12
    assert "providerJob" not in res.output and res.agent_block["model"] == "claude-sonnet-5-5"
    assert wire.calls[0]["model"] == "claude-sonnet-5-5" and "sheet" not in wire.calls[0]["turns"][0]["text"]


def test_needs_user_carries_one_question_and_no_job():
    d, _ = make(fixture("needs_user")["reply"])
    out = run("needs_user", d).output
    assert len(out["needsUser"]["options"]) == 2 and "providerJob" not in out


def test_agent_block_logs_the_prompt_version():
    d, _ = make(fixture("generate_runway")["reply"])
    res = run("generate_runway", d)
    block = res.agent_block
    assert block["promptVersion"] == "director.v2" and block["model"] == "claude-haiku-4-5"
    assert block["output"] == res.output and block["rationale"] == res.output["rationale"]
    assert isinstance(block["latencyMs"], int)


def test_prompt_version_comes_from_the_prompt_file(tmp_path):
    (tmp_path / "director.v2.md").write_text("You are the director.")
    wire = FakeWire(fixture("generate_runway")["reply"])
    sheets = {"runway": load_sheet("runway")}
    d = Director(ModelPort(wire, "claude-haiku-4-5", timeout=5), tmp_path, sheets, prompt_version="director.v2")
    assert run("generate_runway", d).agent_block["promptVersion"] == "director.v2"
    assert wire.calls[0]["system"] == "You are the director."


@pytest.mark.parametrize("version", ["director.v1", "director.v2"])
def test_prompt_carries_the_rules(version):
    text = (PROMPTS / f"{version}.md").read_text()
    for rule in ("canonical @tags", "Keep the seed", "0.25", "role `current`", "`audio` to false", "input.answer"):
        assert rule in text


def test_v2_keeps_the_sketch_and_limits_each_ref_to_its_tag():
    text = (PROMPTS / "director.v2.md").read_text()
    for rule in (
        "never \"the sketch provided\"",           # every ref, the sketch too, by its @tag
        "It sets the design",                        # the sketch is the character
        "It is the user's instruction",              # input.text, the frame's words
        "it wins over the defaults",
        "only what its tag names",                   # a ref adds what its tag says, nothing else
        "never the picture's subject, species",      # @texture is material, not the subject
        "read the purpose from the tag name",        # role other
        "neutral standing pose",                     # defaults
        "plain light background",
        "not photoreal",                             # the sketch's level of simplicity
        "show it once, in the neutral pose",         # several poses, one character
        "Never add a background scene",
        "do not ask",                                # the UI cannot show needsUser yet
    ):
        assert rule in text, rule


def test_v2_generate_follows_the_frame_text_and_names_every_ref():
    """The owner's case (2026-10-06): a diamond-headed stick figure, the words written in
    the frame, and a feather photo tagged @texture with role other."""
    f = fixture("generate_runway_texture")
    d, wire = make(f["reply"])
    res = d.run(f["op"], f["input"], f["provider"])
    asked = json.loads(wire.calls[0]["turns"][0]["text"].split("<input>\n")[1].split("\n</input>")[0])
    assert asked["input"]["text"] == f["input"]["text"]  # the frame's words reach the director
    job = res.output["providerJob"]
    assert [r["name"] for r in job["refs"]] == ["sketch", "texture"]
    assert [r["role"] for r in job["refs"]] == ["character", "object"]
    prompt = job["prompt"]
    assert "@sketch" in prompt and "@texture" in prompt and "sketch provided" not in prompt
    assert "AI agent" in prompt and "material" in prompt and "not photoreal" in prompt
    assert res.output["needsUser"] is None and res.agent_block["promptVersion"] == "director.v2"


# --- failures are loud -------------------------------------------------------

def test_schema_violation_retries_once_then_fails_loudly():
    bad = {"op": "generate", "rationale": "x"}  # no needsUser, no confidence
    d, wire = make(bad, bad)
    with pytest.raises(ModelError) as e:
        run("generate_runway", d)
    assert e.value.kind == "invalid_output" and len(wire.calls) == 2
    assert "does not validate" in wire.calls[1]["turns"][-1]["text"]  # the error is fed back


def test_one_bad_answer_then_a_good_one_succeeds():
    d, wire = make("not json", fixture("generate_runway")["reply"])
    assert run("generate_runway", d).output["op"] == "generate" and len(wire.calls) == 2


def variant(name, edit):
    f = fixture(name)
    reply = copy.deepcopy(f["reply"])
    edit(reply)
    d, _ = make(reply)
    return d, f


@pytest.mark.parametrize("name, edit, why", [
    ("region_edit_runway", lambda r: r["providerJob"].update(mask="sha256:" + "d" * 64), "takes no mask"),
    ("generate_runway", lambda r: r["providerJob"].update(seed=7), "takes no seed"),
    ("generate_runway", lambda r: r["providerJob"].update(outputs=5), "at most 4 outputs"),
    ("clip_runway", lambda r: r["providerJob"].update(durationS=5), "duration must be one of"),
    ("clip_runway", lambda r: r["providerJob"]["refs"].append(
        {"sha256": "sha256:" + "9" * 64, "name": "x", "role": "object"}), "not in the input"),
    ("generate_runway", lambda r: r["providerJob"].update(provider="fal"), "routed provider"),
    ("generate_runway", lambda r: r["providerJob"].update(model="kling-image-o3"), "sheet's model"),
    ("generate_runway", lambda r: r["providerJob"].update(prompt="Draw @ghost"), "not one of the refs"),
    ("generate_runway", lambda r: r.update(op="combine"), "answered op"),
])
def test_what_the_sheet_or_the_input_rules_out_raises(name, edit, why):
    d, f = variant(name, edit)
    with pytest.raises(DirectorError, match=why):
        d.run(f["op"], f["input"], f["provider"])


def test_clip_with_first_frame_and_refs_is_refused_on_runway():
    d, f = variant("clip_runway", lambda r: r["providerJob"]["refs"].append(
        {"sha256": fixture("clip_runway")["input"]["character"]["front"]["sha256"], "name": "front", "role": "character"}))
    with pytest.raises(DirectorError, match="first frame together with refs"):
        d.run(f["op"], f["input"], f["provider"])


def test_shots_that_miss_the_target_raise():
    d, f = variant("shot_list", lambda r: r["shots"][0].update(duration_s=3))
    with pytest.raises(DirectorError, match="not the 12 s asked for"):
        d.run(f["op"], f["input"], None)


def test_unrouted_provider_or_op_raises():
    d, _ = make()
    f = fixture("clip_runway")
    with pytest.raises(DirectorError, match="no capability sheet"):
        d.run("clip", f["input"], "nope")
    with pytest.raises(DirectorError, match="does not support generate"):
        d.run("generate", f["input"], "heygen")


# --- director-specific guards ------------------------------------------------

def attempt(name, edit_reply=lambda r: None, edit_input=lambda i: None, **kw):
    """Run a recorded case with the reply and the input edited; raise whatever the director raises."""
    f = fixture(name)
    reply, payload = copy.deepcopy(f["reply"]), copy.deepcopy(f["input"])
    edit_reply(reply), edit_input(payload)
    d, _ = make(reply)
    return d.run(f["op"], payload, f["provider"], **kw)


def job_edit(**fields):
    return lambda r: r["providerJob"].update(fields)


def refuses(why, *args, **kw):
    with pytest.raises(DirectorError, match=why):
        attempt(*args, **kw)


def test_view_on_fal_sends_the_angle_the_prompt_maps():
    res = attempt("view_fal")
    assert res.output["providerJob"]["angle"] == {"horizontal": 90, "vertical": 0}
    for v in ("director.v1", "director.v2"):
        assert "front 0, three_quarter 45, side 90, back 180" in (PROMPTS / f"{v}.md").read_text()


def test_clip_edit_on_runway_needs_the_keyframe_the_relay_made():
    keyframe = fixture("clip_edit_runway")["extraHashes"]
    assert attempt("clip_edit_runway", extra_hashes=tuple(keyframe)).output["providerJob"]["keyframe"]["atS"] == 2.5
    refuses("not in the input", "clip_edit_runway")  # providerJob has no keyframe source of its own


def test_clip_edit_on_fal_is_a_masked_region_job_without_duration_or_ratio():
    job = attempt("clip_edit_fal_mask").output["providerJob"]
    assert job["model"] == "wan-vace-14b-inpainting" and job["mask"] == fixture("clip_edit_fal_mask")["input"]["mask"]["sha256"]
    refuses("takes no duration", "clip_edit_fal_mask", job_edit(durationS=5))
    refuses("takes no ratio", "clip_edit_fal_mask", job_edit(ratio="9:16"))


KEYFRAME = fixture("clip_edit_runway")["extraHashes"][0]


@pytest.mark.parametrize("keyframe, why", [
    ({"atS": 2.5, "startS": 2}, "go together"),
    ({"atS": 2.5, "endS": 4}, "go together"),
    ({"atS": 3, "startS": 3, "endS": 3}, "outside the range"),
    ({"atS": 4, "startS": 2, "endS": 4}, "outside the range"),  # end is exclusive
    ({"atS": 1, "startS": 2, "endS": 4}, "outside the range"),
    ({"atS": 31}, "past 30 s"),
])
def test_keyframe_range_is_all_or_none_and_holds_the_time(keyframe, why):
    def edit(r):
        r["providerJob"]["keyframe"] = {"sha256": KEYFRAME, **keyframe}
    refuses(why, "clip_edit_runway", edit, extra_hashes=(KEYFRAME,))


def test_clip_edit_on_runway_takes_no_duration_or_ratio():
    refuses("takes no duration", "clip_edit_runway", job_edit(durationS=5), extra_hashes=(KEYFRAME,))
    refuses("takes no ratio", "clip_edit_runway", job_edit(ratio="1280:720"), extra_hashes=(KEYFRAME,))


def area(w, h):
    def edit(payload):
        payload["region"].update(w=w, h=h)
    return edit


@pytest.mark.parametrize("w, h, masked", [(0.5, 0.49, True), (0.5, 0.5, False), (0.6, 0.6, False)])
def test_the_quarter_rule_picks_mask_or_regenerate_at_the_boundary(w, h, masked):
    f = fixture("region_edit_fal_mask")
    mask = f["input"]["mask"]["sha256"]

    def reply(r):
        if not masked:
            del r["providerJob"]["mask"]
    attempt("region_edit_fal_mask", reply, area(w, h))  # the right answer for the area passes
    if masked:
        refuses("send the mask", "region_edit_fal_mask", lambda r: r["providerJob"].pop("mask"), area(w, h))
    else:
        refuses("send no mask", "region_edit_fal_mask", job_edit(mask=mask), area(w, h))


def test_a_small_region_without_a_drawn_mask_regenerates_instead():
    attempt("region_edit_fal_mask", lambda r: r["providerJob"].pop("mask"), lambda p: p.pop("mask"))


def test_region_edit_needs_the_current_ref():
    refuses("role current", "region_edit_runway", lambda r: r["providerJob"]["refs"][0].update(role="object"))


@pytest.mark.parametrize("name, edit, why", [
    ("generate_runway", job_edit(ratio="1080:1350"), "does not take ratio"),
    ("generate_runway", job_edit(ratio="1920:1080"), "does not take ratio"),
    ("region_edit_runway", job_edit(ratio="512:512"), "does not take ratio"),  # a flash size; pro has none
    ("clip_runway", job_edit(ratio="1080:1350"), "does not take ratio"),
    ("region_edit_fal_mask", job_edit(prompt="x" * 2501), "over its 2500"),
    ("clip_runway", job_edit(prompt="x" * 1001), "over its 1000"),
    ("clip_runway", lambda r: r["providerJob"].pop("durationS"), "needs a durationS"),
])
def test_provider_limits_the_sheet_cannot_say_raise(name, edit, why):
    refuses(why, name, edit)


def test_recorded_ratios_are_in_the_providers_lists():
    attempt("generate_runway", job_edit(ratio="1344:768"))
    attempt("region_edit_runway", job_edit(ratio="864:1184"))
    attempt("clip_runway", job_edit(ratio="1280:720"))


@pytest.mark.parametrize("name, edit, why", [
    ("generate_runway", lambda r: r["providerJob"]["refs"][1].update(role="element_front"), "has no elements"),
    ("clip_edit_fal_mask", job_edit(keyframe={"sha256": "sha256:" + "2" * 64, "atS": 1}), "takes no keyframe"),
    ("clip_edit_runway", job_edit(strength="flex"), "takes no edit strength"),
    ("generate_runway", lambda r: r["providerJob"]["refs"][1].update(name="Ab"), "canonical tags"),
    ("generate_runway", lambda r: r["providerJob"]["refs"][1].update(name="sketch"), "canonical tags"),
])
def test_ref_and_edit_guards(name, edit, why):
    refuses(why, name, edit, extra_hashes=(KEYFRAME,))


def test_one_answer_never_carries_a_job_and_a_question_or_stray_shots():
    question = {"question": "Which colours?", "options": ["Eyes", "Palette"]}
    refuses("a question and a job", "generate_runway", lambda r: r.update(needsUser=question))
    refuses("belong to shot_list", "generate_runway", lambda r: r.update(shots=fixture("shot_list")["reply"]["shots"]))


@pytest.mark.parametrize("edit, why", [
    (lambda r: (r["shots"][0].update(order=1), r["shots"][1].update(order=3)), "run 1..n"),
    (lambda r: r["shots"][1].update(id=r["shots"][0]["id"]), "must be unique"),
])
def test_shot_numbering_and_ids_are_checked(edit, why):
    refuses(why, "shot_list", edit)


def test_an_agent_block_that_breaks_the_schema_raises(tmp_path):
    (tmp_path / "director.vx.md").write_text("You are the director.")
    d = Director(ModelPort(FakeWire(fixture("generate_runway")["reply"]), "claude-haiku-4-5", timeout=5),
                 tmp_path, {"runway": load_sheet("runway")}, prompt_version="director.vx")
    f = fixture("generate_runway")
    with pytest.raises(DirectorError, match="agent block"):
        d.run(f["op"], f["input"], f["provider"])
