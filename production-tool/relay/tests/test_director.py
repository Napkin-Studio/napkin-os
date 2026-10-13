import copy
import json
from pathlib import Path

import pytest
from jsonschema import Draft202012Validator, FormatChecker
from referencing import Registry, Resource

from director import Director, DirectorError, bundle, load_schemas
from names import to_wire
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
    sheets = {n: load_sheet(n) for n in ("mock", "runway")}
    return Director(port, PROMPTS, sheets, **kw), wire


def run(name, director, **kw):
    """As the relay does: names become wire tags (names.py) before the director sees the input."""
    f = fixture(name)
    return director.run(f["op"], to_wire(f["op"], f["input"]), f["provider"], **kw)


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
    assert [r["name"] for r in job["refs"]] == ["in_1", "maya_eyes", "maya_palette"]
    assert res.usage == {"input_tokens": 120, "output_tokens": 60}
    sent = wire.calls[0]
    assert sent["model"] == "claude-haiku-4-5" and sent["system"] == d.system_for("generate")
    asked = json.loads(sent["turns"][0]["text"].split("<input>\n")[1].split("\n</input>")[0])
    assert asked["provider"] == "runway" and asked["sheet"]["tagSyntax"] == "at_tag" and asked["op"] == "generate"


def test_region_edit_on_a_mask_sheet_is_a_masked_inpaint():
    d, wire = make(fixture("region_edit_mock_mask")["reply"])
    res = run("region_edit_mock_mask", d)
    job = res.output["providerJob"]
    assert job["mask"] == fixture("region_edit_mock_mask")["input"]["mask"]["sha256"]
    assert job["refs"][0]["role"] == "current"


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


def test_a_question_comes_alone_with_no_job():
    d, _ = make(fixture("needs_user")["reply"])
    out = run("needs_user", d).output
    assert len(out["question"]["options"]) == 2 and "providerJob" not in out
    assert out["question"]["kind"] == "ambiguity" and "recommended_option_id" not in out["question"]


def test_agent_block_logs_the_prompt_version():
    d, _ = make(fixture("generate_runway")["reply"])
    res = run("generate_runway", d)
    block = res.agent_block
    assert block["promptVersion"] == "director.v6" and block["model"] == "claude-haiku-4-5"
    assert block["output"] == res.output and block["rationale"] == res.output["rationale"]
    assert isinstance(block["latencyMs"], int)


def test_prompt_version_comes_from_the_prompt_file(tmp_path):
    (tmp_path / "director.v7.md").write_text("You are the director.\n<!-- role-lines -->")
    wire = FakeWire(fixture("generate_runway")["reply"])
    sheets = {"runway": load_sheet("runway")}
    d = Director(ModelPort(wire, "claude-haiku-4-5", timeout=5), tmp_path, sheets, prompt_version="director.v7")
    assert run("generate_runway", d).agent_block["promptVersion"] == "director.v7"
    assert wire.calls[0]["system"].startswith("You are the director.\n- `character`: character reference")


def test_contract_3_refuses_a_prompt_older_than_v6(tmp_path):
    from director.base import PromptTooOld
    (tmp_path / "director.v5.md").write_text("You are the director.")
    with pytest.raises(PromptTooOld, match="director.v5; contract 3 needs director.v6"):
        Director(ModelPort(FakeWire(), "m", timeout=5), tmp_path, {}, prompt_version="director.v5")


def test_prompt_carries_the_rules():
    text = (PROMPTS / "director.v6.md").read_text()
    for rule in ("Never invent a seed", "are `current`", "`audio` is false", "input.answer", "recommended_option_id",
                 "Never on an ambiguity", "`block` only when no option can go ahead", "background only", "brand_rule",
                 "`end_card`", "half-second steps", "`direction_condensed`", "camera.movement", "input.aspect"):
        assert rule in text, rule


def test_the_role_lines_are_the_contracts_verbatim():
    """One table (common refRoleTable) feeds the role picker and the prompt: every prompt_line is in the system prompt."""
    table = json.loads((CONTRACTS / "common.schema.json").read_text())["$defs"]["refRoleTable"]["const"]
    d, _ = make()
    for role, row in table.items():
        assert f"- `{role}`: {row['prompt_line']}" in d.system, role
    assert "<!-- role-lines -->" not in d.system
    for op in ("generate", "frame", "shot_list", "clip"):
        assert table["lighting"]["prompt_line"] in d.system_for(op), op


def test_only_the_v6_prompt_is_bundled():
    """Contract 3 runs director.v6: the older prompts write fields contract 3 refuses."""
    assert sorted(p.name for p in PROMPTS.glob("director.v*.md")) == ["director.v6.md"]


def test_v6_names_refs_and_limits_each_ref_to_what_it_names():
    text = (PROMPTS / "director.v6.md").read_text()
    for rule in (
        "carries a `tag` (its wire tag, already in the words)",
        "`key_variant`",
        "Take from each picture only what its role says",
        "A donor is not a character",
        "Never describe what a picture you are sending already shows",
        "plain light background",
        "as given in `input.refs`, never invented",
        "a bare key for a whole character",
    ):
        assert rule in text, rule


def test_v2_generate_follows_the_frame_text_and_names_every_ref():
    """The owner's case (2026-10-06): a diamond-headed stick figure, the words written in
    the frame, and a feather photo tagged @texture with role other."""
    f = fixture("generate_runway_texture")
    d, wire = make(f["reply"])
    res = d.run(f["op"], to_wire(f["op"], f["input"]), f["provider"])
    asked = json.loads(wire.calls[0]["turns"][0]["text"].split("<input>\n")[1].split("\n</input>")[0])
    assert asked["input"]["text"] == f["input"]["text"]  # the participant's words reach the director
    job = res.output["providerJob"]
    assert [r["name"] for r in job["refs"]] == ["in_1", "maya_texture"]
    assert [r["role"] for r in job["refs"]] == ["character", "object"]
    prompt = job["prompt"]
    assert "@in_1" in prompt and "@maya_texture" in prompt and "sketch provided" not in prompt
    assert "AI agent" in prompt and "material" in prompt and "2D illustration" in prompt
    assert res.output["question"] is None and res.agent_block["promptVersion"] == "director.v6"


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
    f["input"] = to_wire(f["op"], f["input"])
    reply = copy.deepcopy(f["reply"])
    edit(reply)
    d, _ = make(reply)
    return d, f


@pytest.mark.parametrize("name, edit, why", [
    ("region_edit_runway", lambda r: r["providerJob"].update(mask="sha256:" + "d" * 64), "takes no mask"),
    ("generate_runway", lambda r: r["providerJob"].update(seed=7), "takes no seed"),
    ("generate_runway", lambda r: r["providerJob"].update(outputs=5), "at most 4 outputs"),
    ("clip_runway", lambda r: r["providerJob"]["refs"].append(
        {"sha256": "sha256:" + "9" * 64, "name": "x", "role": "object"}), "not in the input"),
    ("generate_runway", lambda r: r["providerJob"].update(provider="mock"), "routed provider"),
    ("generate_runway", lambda r: r["providerJob"].update(prompt="Draw @ghost"), "not one of the refs"),
    ("generate_runway", lambda r: r.update(op="view"), "answered op"),
])
def test_what_the_sheet_or_the_input_rules_out_raises(name, edit, why):
    d, f = variant(name, edit)
    with pytest.raises(DirectorError, match=why):
        d.run(f["op"], f["input"], f["provider"])


def test_clip_with_first_frame_and_refs_keeps_the_frame_on_runway():
    # Changed 2026-10-07 (was: refused). Haiku kept sending the character refs with the first frame,
    # so every Runway clip failed. The storyboard frame already shows the character: keep the frame,
    # drop the refs, and name them in words.
    d, f = variant("clip_runway", lambda r: (r["providerJob"]["refs"].append(
        {"sha256": fixture("clip_runway")["input"]["refs"][0]["asset"]["sha256"], "name": "hero_front", "role": "character"}),
        r["providerJob"].update(prompt=r["providerJob"]["prompt"] + " Keep @hero_front on model.")))
    job = d.run(f["op"], f["input"], f["provider"]).output["providerJob"]
    assert job["refs"] == [] and job["firstFrame"]
    assert "@hero_front" not in job["prompt"] and "the character" in job["prompt"]


def test_a_clip_length_the_model_cannot_make_is_rounded_up():
    # Changed 2026-10-07 (was: refused). A 5 s shot on veo3.1_fast (4/6/8 s) becomes 6 s;
    # the stitch trims it back to 5 s.
    d, f = variant("clip_runway", lambda r: r["providerJob"].update(durationS=5))
    assert d.run(f["op"], f["input"], f["provider"]).output["providerJob"]["durationS"] == 6


def test_shots_that_miss_the_target_raise():
    d, f = variant("shot_list", lambda r: r["shots"][0].update(duration_s=3))
    with pytest.raises(DirectorError, match="not the 12 s asked for"):
        d.run(f["op"], f["input"], None)


def test_unrouted_provider_or_op_raises():
    d, _ = make()
    f = fixture("clip_runway")
    with pytest.raises(DirectorError, match="no capability sheet"):
        d.run("clip", f["input"], "nope")
    d.sheets = {**d.sheets, "clips_only": {**d.sheets["runway"], "ops": {"clip": d.sheets["runway"]["ops"]["clip"]}}}
    with pytest.raises(DirectorError, match="does not support generate"):
        d.run("generate", f["input"], "clips_only")


# --- director-specific guards ------------------------------------------------

def attempt(name, edit_reply=lambda r: None, edit_input=lambda i: None, **kw):
    """Run a recorded case with the reply and the input edited; raise whatever the director raises."""
    f = fixture(name)
    reply, payload = copy.deepcopy(f["reply"]), copy.deepcopy(f["input"])
    edit_reply(reply), edit_input(payload)
    d, _ = make(reply)
    return d.run(f["op"], to_wire(f["op"], payload), f["provider"], **kw)


def job_edit(**fields):
    return lambda r: r["providerJob"].update(fields)


def refuses(why, *args, **kw):
    with pytest.raises(DirectorError, match=why):
        attempt(*args, **kw)


def test_a_view_on_a_sheet_with_angles_sends_the_angle_the_prompt_maps():
    res = attempt("view_mock")
    assert res.output["providerJob"]["angle"] == {"horizontal": 90, "vertical": 0}
    assert "front 0, three-quarter 45, side 90, back 180" in (PROMPTS / "director.v6.md").read_text()


def test_clip_edit_on_runway_needs_the_keyframe_the_relay_made():
    keyframe = fixture("clip_edit_runway")["extraHashes"]
    assert attempt("clip_edit_runway", extra_hashes=tuple(keyframe)).output["providerJob"]["keyframe"]["atS"] == 2.5
    refuses("not in the input", "clip_edit_runway")  # providerJob has no keyframe source of its own


def test_clip_edit_on_a_mask_sheet_is_a_masked_region_job():
    job = attempt("clip_edit_mock_mask").output["providerJob"]
    assert job["model"] == "mock" and job["mask"] == fixture("clip_edit_mock_mask")["input"]["mask"]["sha256"]
    assert "ratio" not in attempt("clip_edit_runway", job_edit(ratio="9:16"), extra_hashes=(KEYFRAME,)).output["providerJob"]


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


def test_clip_edit_on_runway_takes_no_duration_and_drops_a_ratio():
    refuses("takes no duration", "clip_edit_runway", job_edit(durationS=5), extra_hashes=(KEYFRAME,))
    edited = attempt("clip_edit_runway", job_edit(ratio="1280:720"), extra_hashes=(KEYFRAME,))
    assert "ratio" not in edited.output["providerJob"]


def area(w, h):
    def edit(payload):
        payload["region"].update(w=w, h=h)
    return edit


@pytest.mark.parametrize("w, h", [(0.2, 0.2), (0.5, 0.5), (0.8, 0.33), (1.0, 1.0)])
def test_a_mask_on_a_mask_sheet_is_always_a_masked_inpaint(w, h):
    # The 25% rule is gone (features/harness-refusals.clan): wherever the sheet takes masks, a box
    # with its mask is a masked inpaint, whatever its size.
    attempt("region_edit_mock_mask", lambda r: None, area(w, h))
    refuses("send the mask", "region_edit_mock_mask", lambda r: r["providerJob"].pop("mask"), area(w, h))


def test_a_small_region_without_a_drawn_mask_regenerates_instead():
    attempt("region_edit_mock_mask", lambda r: r["providerJob"].pop("mask"), lambda p: p.pop("mask"))


def test_region_edit_needs_the_current_ref():
    refuses("role current", "region_edit_runway", lambda r: r["providerJob"]["refs"][0].update(role="object"))


@pytest.mark.parametrize("name, edit, why", [
    ("generate_runway", job_edit(ratio="1080:1350"), "does not take ratio"),
    ("generate_runway", job_edit(ratio="1920:1080"), "does not take ratio"),
    ("region_edit_runway", job_edit(ratio="512:512"), "does not take ratio"),  # a flash size; pro has none
    ("clip_runway", job_edit(ratio="1080:1350"), "does not take ratio"),
    ("clip_runway", lambda r: r["providerJob"].pop("durationS"), "needs a durationS"),
])
def test_provider_limits_the_sheet_cannot_say_raise(name, edit, why):
    refuses(why, name, edit)


def test_a_clip_prompt_past_runways_1000_characters_is_refused():
    # The person's own words do not count against the budget, so the provider's limit is what stops it.
    refuses("over its 1000", "clip_runway", job_edit(prompt="x" * 1001), lambda p: p.update(text="x" * 950))


def test_recorded_ratios_are_in_the_providers_lists():
    attempt("generate_runway", job_edit(ratio="1344:768"))
    attempt("region_edit_runway", job_edit(ratio="864:1184"))
    attempt("clip_runway", job_edit(ratio="1280:720"))


@pytest.mark.parametrize("name, edit, why", [
    # No sheet takes element roles since features/drop-hackathon-extras.clan: never sent.
    ("generate_runway", lambda r: (r["providerJob"]["refs"][1].update(role="element_front"),
                                   r["providerJob"]["refs"][2].update(role="element_angle")), "has no elements"),
    ("clip_edit_mock_mask", job_edit(keyframe={"sha256": "sha256:" + "2" * 64, "atS": 1}), "takes no keyframe"),
    ("clip_edit_runway", job_edit(strength="flex"), "takes no edit strength"),
    ("generate_runway", lambda r: r["providerJob"]["refs"][1].update(name="Ab"), "canonical tags"),
    ("generate_runway", lambda r: r["providerJob"]["refs"][1].update(name="in_1"), "canonical tags"),
])
def test_ref_and_edit_guards(name, edit, why):
    refuses(why, name, edit, extra_hashes=(KEYFRAME,))


def test_one_answer_never_carries_a_job_and_a_question_or_stray_shots():
    question = {"kind": "ambiguity", "text": "Which colours?", "allow_text": False,
                "options": [{"id": "eyes", "label": "Eyes", "value": "eyes"}, {"id": "palette", "label": "Palette", "value": "palette"}]}
    refuses("a question and a job", "generate_runway", lambda r: r.update(question=question))
    refuses("belong to shot_list", "generate_runway", lambda r: r.update(shots=fixture("shot_list")["reply"]["shots"]))


@pytest.mark.parametrize("edit, why", [
    (lambda r: r["shots"][1].update(id=r["shots"][0]["id"]), "must be unique"),
    (lambda r: r["shots"][0].update(duration_s=9), "add up to"),
    (lambda r: r["shots"][0].update(refs=["nobody_front"]), "not an input ref"),
    (lambda r: r["shots"][0].update(beats=[{"kind": "moment", "at_s": 9, "text": "late"}]), "past its"),
])
def test_shot_numbering_and_ids_are_checked(edit, why):
    refuses(why, "shot_list", edit)


def test_an_agent_block_that_breaks_the_schema_raises(tmp_path):
    (tmp_path / "director.v6.md").write_text("You are the director.")
    d = Director(ModelPort(FakeWire(fixture("generate_runway")["reply"]), "claude-haiku-4-5", timeout=5),
                 tmp_path, {"runway": load_sheet("runway")}, prompt_version="director.v6")
    d.prompt_version = "director.vx"  # a version the agent block's pattern refuses
    f = fixture("generate_runway")
    with pytest.raises(DirectorError, match="agent block"):
        d.run(f["op"], f["input"], f["provider"])


def test_a_camera_angle_is_dropped_for_a_provider_without_angles():
    # 2026-10-07: Haiku sent `angle` for a Runway side view and the job failed with DirectorError.
    from director.director import _drop_unusable
    sheet = {"angles": False, "seed": False, "ops": {"view": {"model": "m"}}, "video": {"feelEdit": "prompt"}}
    job = {"prompt": "@front as seen from the right.", "angle": {"horizontal": 90}, "seed": 3, "refs": []}
    _drop_unusable(job, "view", sheet)
    assert "angle" not in job and job["seed"] == 3  # only the angle is dropped
    assert job["prompt"].endswith("Show the side view.")


def test_a_camera_angle_is_kept_where_the_provider_has_angles():
    from director.director import _drop_unusable
    sheet = {"angles": True, "seed": True, "ops": {"view": {"model": "m"}}, "video": {"feelEdit": "strength"}}
    job = {"prompt": "@front, back view.", "angle": {"horizontal": 180}, "seed": 3, "refs": []}
    _drop_unusable(job, "view", sheet)
    assert job["angle"] == {"horizontal": 180}


def test_a_plain_ratio_is_mapped_to_the_nearest_runway_size():
    # 2026-10-07: storyboard frames failed with "runway frame does not take ratio '9:16'".
    from director.director import FLASH_RATIOS, RUNWAY_CLIP_RATIOS, _nearest_ratio
    assert _nearest_ratio("9:16", FLASH_RATIOS) == "768:1344"
    assert _nearest_ratio("4:5", FLASH_RATIOS) == "896:1152"
    assert _nearest_ratio("1:1", FLASH_RATIOS) == "1024:1024"
    assert _nearest_ratio("16:9", RUNWAY_CLIP_RATIOS) in {"1280:720", "1920:1080"}
    assert _nearest_ratio("nonsense", FLASH_RATIOS) is None


def test_a_ratio_the_model_left_out_is_taken_from_the_request():
    # 2026-10-07: frames failed with "frame needs a ratio" when Haiku omitted it.
    d, f = variant("generate_runway", lambda r: r["providerJob"].pop("ratio", None))
    f["input"]["ratio"] = "4:5"
    assert d.run(f["op"], f["input"], f["provider"]).output["providerJob"]["ratio"] == "896:1152"


def test_shot_list_names_only_refs_it_was_given():
    assert run("shot_list", make(fixture("shot_list")["reply"])[0]).output["shots"][0]["refs"] == ["hero_front"]
    refuses("not an input ref", "shot_list", lambda r: r["shots"][0].update(refs=["hero_sad"]))


def test_a_view_angle_the_model_left_out_is_filled_from_the_view():
    res = attempt("view_mock", lambda r: r["providerJob"].pop("angle"))
    assert res.output["providerJob"]["angle"] == {"horizontal": 90.0, "vertical": 0.0}


def test_a_reply_naming_another_model_runs_on_the_sheets():
    """The routing chooses the model (features/default-models.clan): a recorded reply that names an
    older default still runs, on the sheet's model, instead of failing the job."""
    reply = fixture("generate_runway")["reply"]
    reply["providerJob"]["model"] = "gemini_image3.1_flash"
    d, _ = make(reply)
    out = run("generate_runway", d)
    assert out.output["providerJob"]["model"] == load_sheet("runway")["ops"]["generate"]["model"]


# --- character cards (features/character-cards.clan) --------------------------

def test_v6_uses_cards_and_keeps_them_off_screen():
    text = (PROMPTS / "director.v6.md").read_text()
    for rule in (
        "A ref may carry `card`",                     # what its picture shows, from one look
        "A card is for choosing, never for copying",
        "Never copy a card's words into the prompt",  # a card is for the director only
    ):
        assert rule in text, rule


def test_the_ask_carries_each_refs_card():
    """The relay adds refs[].card before names.to_wire; the director's ask carries it to the model."""
    f = fixture("generate_runway")
    d, wire = make(f["reply"])
    wired = to_wire(f["op"], f["input"])
    card = "A stick figure with a diamond head\nBlack pencil lines on white\nFront view, arms out"
    wired["refs"][0]["card"] = card
    d.run(f["op"], wired, f["provider"])
    asked = json.loads(wire.calls[0]["turns"][0]["text"].split("<input>\n")[1].split("\n</input>")[0])
    assert asked["input"]["refs"][0]["card"] == card
    assert all("card" not in r for r in asked["input"]["refs"][1:])
