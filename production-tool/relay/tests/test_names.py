"""People's names (key_variant, free variants) become wire tags before the director sees a job."""

import pytest

from conftest import asset, ref
from director.base import PassthroughDirector
from names import TAG, UnknownName, to_wire, wire_tags
from providers import load_sheet


def test_a_name_that_is_a_valid_tag_is_kept_and_unnamed_inputs_are_numbered():
    refs = [ref(1, kind="drawing"), ref(2, "maya_front"), ref(3)]
    tags = wire_tags(refs)
    assert [tags[r["id"]] for r in refs] == ["in_1", "maya_front", "in_2"]


def test_long_and_hyphenated_names_get_short_unique_tags():
    refs = [ref(1, "maya_three-quarter"), ref(2, "maya_three-quarter-left"), ref(3, "lampshade_red-velvet-on")]
    tags = [wire_tags(refs)[r["id"]] for r in refs]
    assert all(TAG.match(t) for t in tags) and len(set(tags)) == 3
    assert tags[0] == "maya_three_quart"  # a hyphen is not a tag character; 16 at most


def test_words_shot_and_shot_refs_are_rewritten_to_the_tags():
    refs = [ref(1, "maya_three-quarter"), ref(2, "brolly_red")]
    shot = {"id": "shot_x", "order": 1, "duration_s": 5, "composition": "wide", "camera_move": "pan",
            "action": "@maya_three-quarter opens @brolly_red.", "dialogue": "Hi @brolly_red-ish",
            "refs": ["maya_three-quarter", "brolly_red"]}
    out = to_wire("frame", {"text": "Keep @maya_three-quarter's coat", "refs": refs, "shot": shot})
    assert out["text"] == "Keep @maya_three_quart's coat"
    assert out["shot"]["action"] == "@maya_three_quart opens @brolly_red."
    assert out["shot"]["dialogue"] == "Hi @brolly_red-ish"  # the longest known name, then the rest as written
    assert out["shot"]["refs"] == ["maya_three_quart", "brolly_red"]
    assert "tag" not in refs[0]  # the caller's input is not changed


def test_an_unknown_name_is_the_participants_to_fix():
    with pytest.raises(UnknownName, match="@maya_sad"):
        to_wire("generate", {"text": "make @maya_sad", "refs": [ref(1, "maya_front")]})
    shot = {"action": "x", "refs": ["maya_sad"]}
    with pytest.raises(UnknownName, match="no image has that name"):
        to_wire("frame", {"refs": [ref(1, "maya_front")], "shot": shot})


def test_an_email_or_a_tag_inside_a_word_is_left_alone():
    out = to_wire("generate", {"text": "mail me@maya_front.ie", "refs": [ref(1, "maya_front")]})
    assert out["text"] == "mail me@maya_front.ie"


def test_shot_list_keeps_the_participants_names():
    payload = {"script": "@maya_front walks", "targetS": 10, "refs": [ref(1, "maya_front")]}
    assert to_wire("shot_list", payload) is payload


def test_an_unknown_name_is_refused_when_the_job_is_posted(h):
    token = h.sign_in()
    _, out = h.post_job(token, "generate", expect=400, text="like @maya_sad", refs=[ref(1, "maya_front")])
    assert out["error"]["code"] == "invalid_input" and "@maya_sad" in out["error"]["message"]


# --- a character key on fal is one Kling element ---------------------------------

def _passthrough(op, inp, provider):
    req = {"jobId": "job_x", "op": op, "input": to_wire(op, inp)}
    return PassthroughDirector().direct(req, load_sheet(provider))["providerJob"]["refs"]


def test_on_fal_a_key_with_a_front_and_other_variants_is_one_element():
    refs = [ref(1, "lamp_on", role="prop"), ref(2, "maya_side"), ref(3, "maya_front"), ref(4, "maya_laughing")]
    sent = _passthrough("generate", {"text": "x", "refs": refs}, "fal")
    assert [(r["name"], r["role"]) for r in sent] == [
        ("maya_front", "element_front"), ("maya_side", "element_angle"), ("maya_laughing", "element_angle"),
        ("lamp_on", "object")]


def test_on_runway_the_same_refs_are_character_and_object():
    refs = [ref(1, "lamp_on", role="prop"), ref(2, "maya_front"), ref(3, "maya_side")]
    sent = _passthrough("generate", {"text": "x", "refs": refs}, "runway")
    assert [(r["name"], r["role"]) for r in sent] == [
        ("lamp_on", "object"), ("maya_front", "character"), ("maya_side", "character")]


def test_a_key_without_a_front_or_without_other_variants_is_no_element():
    for refs in ([ref(1, "maya_front")], [ref(1, "maya_side"), ref(2, "maya_back")]):
        sent = _passthrough("generate", {"text": "x", "refs": refs}, "fal")
        assert {r["role"] for r in sent} == {"character"}


def test_a_view_sends_its_source_as_current():
    sent = _passthrough("view", {"view": "three-quarter", "image": asset(9)}, "fal")
    assert sent == [{"sha256": asset(9)["sha256"], "name": "current", "role": "current"}]
