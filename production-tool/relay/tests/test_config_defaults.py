"""config.json names only what differs from the defaults (features/config-defaults.clan): routing, the
director block and the flags are optional, and the relay reads them through runtime.with_defaults."""

from __future__ import annotations

import copy
import json
import re

from conftest import Harness, asset
from contracts import Contracts
from contracts_dir import contracts_dir
from director.claude import PER_CLICK, PROMPT_VERSION, PROMPTS, SHOT_LIST, make as make_director
from runtime import DEFAULT_FLAGS, OPS, with_defaults

EXAMPLES = contracts_dir() / "examples"
LIVE = json.loads((EXAMPLES / "config.live.json").read_text())
# The live routing every config.json carried before this feature: the defaults must keep it op for op.
BEFORE = {"generate": ["runway"], "view": ["runway"], "shot_list": [], "frame": ["runway"], "region_edit": ["runway"],
          "frame_edit": ["runway"], "clip": ["runway"], "clip_edit": ["runway"], "clip_patch": ["runway"], "stitch": [],
          "upscale": ["runway"], "resize": ["runway"], "cutdown": ["runway"], "cutout": []}


def minimal(**over) -> dict:
    return {**copy.deepcopy(LIVE), "inFlightPerParticipant": 6, **over}


def test_the_live_example_is_the_minimal_form_and_valid():
    assert set(LIVE) == {"contractVersion", "quotas", "inFlightPerParticipant", "jobTimeoutS", "spend", "banner"}
    assert Contracts().errors("config.schema.json", LIVE) == []


def test_the_default_routing_is_the_live_routing_and_anything_else_goes_to_runway():
    routing = with_defaults(LIVE)["routing"]
    assert set(routing) == set(OPS)
    for op in OPS:
        assert routing[op] == BEFORE.get(op, ["runway"]), op


def test_a_routing_entry_overrides_its_op_only():
    routing = with_defaults(minimal(routing={"clip": [], "generate": ["mock", "runway"]}))["routing"]
    assert routing["clip"] == [] and routing["generate"] == ["mock", "runway"]
    assert routing["frame"] == ["runway"] and routing["stitch"] == []


def test_the_flag_defaults():
    assert DEFAULT_FLAGS == {"video": True, "videoRegionEdit": False, "feelEdit": False, "moreOptions": False,
                             "dogfood": False, "clipPatch": False, "connectedVideo": True, "ownCanvas": True}
    assert with_defaults(minimal(flags={"video": False}))["flags"] == {**DEFAULT_FLAGS, "video": False}


def test_removed_flags_are_refused_by_the_schema():
    """No shim (owner): a file that still sets a removed flag fails validation, and the relay keeps its last
    good config. The rollout uploads the minimal file (contracts/README.md, changelog 25)."""
    for gone in ("briefNode", "storyboard", "stitch", "regionEditFrames", "regionEditCanvas", "clickSelect"):
        assert Contracts().errors("config.schema.json", minimal(flags={gone: True})), gone


def test_a_minimal_config_runs_a_job_on_runway():
    h = Harness(minimal())
    token = h.as_person()
    _, job = h.post_job(token, "generate", expect=200)
    assert h.providers["runway"].submits and not h.providers["mock"].submits
    assert job["provider"] == "runway"


def test_video_off_is_the_kill_switch_and_absent_is_on():
    h = Harness(minimal())
    token = h.as_person()
    h.post_job(token, "clip", expect=200)
    h.cfg["flags"] = {"video": False}
    _, out = h.post_job(token, "clip", expect=403)
    assert out["error"]["code"] == "flag_off"


def test_connected_video_absent_is_on():
    h = Harness(minimal())
    token = h.as_person()
    shot = {"id": "shot_01K7B00000000000000000SH01", "kind": "shot", "duration_s": 3,
            "camera": {"size": "wide", "movement": "static"}, "action": "He looks out over the sea.", "refs": []}
    status, out = h.post_job(token, "clip", image=asset(3), lastFrame=asset(4), ratio="16:9", shot=shot)
    assert (status, out.get("error", {}).get("code")) != (403, "flag_off"), out
    h.cfg["flags"] = {"connectedVideo": False}
    status, out = h.post_job(token, "clip", image=asset(3), lastFrame=asset(4), ratio="16:9", shot=shot)
    assert (status, out["error"]["code"]) == (403, "flag_off")


def test_get_config_answers_with_the_defaults_filled():
    h = Harness(minimal())
    status, cfg = h.call("GET", "/config")
    assert status == 200 and cfg["routing"]["clip"] == ["runway"] and cfg["flags"]["connectedVideo"] is True
    assert Contracts().errors("config.schema.json", cfg) == []


class Wire:
    api = "anthropic"


def test_the_director_runs_its_newest_prompt_unless_pinned_and_comes_back_when_unpinned():
    d = make_director(wire=Wire())
    d.use_config({})
    assert (d.director.prompt_version, d.director.per_click_model, d.director.shot_list_model) == (
        PROMPT_VERSION, PER_CLICK, SHOT_LIST)
    d.use_config({"promptVersion": "director.v13", "perClickModel": "eu.anthropic.claude-test"})
    assert (d.director.prompt_version, d.director.per_click_model) == ("director.v13", "eu.anthropic.claude-test")
    d.use_config({})
    assert (d.director.prompt_version, d.director.per_click_model) == (PROMPT_VERSION, PER_CLICK)


def test_the_default_prompt_is_the_newest_bundled():
    def number(path):
        major, minor = re.fullmatch(r"director\.v(\d+)(?:\.(\d+))?", path.stem).groups()
        return int(major), int(minor or 0)
    newest = max(PROMPTS.glob("director.v*.md"), key=number)
    assert PROMPT_VERSION == newest.stem
