import json
import os
import time

import pytest

from napkin.model import ModelPort, Usage
from napkin.model_routes import Routes, RoutesError, parse
from tests.test_model import GOOD, SCHEMA, U, FakeSDK

ROUTES = {
    "default": {"model": "opus-4.6", "schema": "auto"},
    "vision": {"model": "sonnet-5.5"},
    "purposes": {
        "extract_category_facts": {"model": "opus-5.5", "effort": "low"},
        "write_dossier_cell": {"effort": "high", "max_tokens": 8000},
        "transcribe": {"effort": "medium"},
        "triage": {"model": "haiku-4.5", "effort": "low"},
        "custom": {"model": "global.anthropic.claude-opus-5"},
    },
}


def test_a_purpose_takes_its_route_then_the_default_then_the_environment():
    r = Routes("bedrock", "env-model", "env-vision", json.dumps(ROUTES))
    x = r.resolve("extract_category_facts")
    assert (x.model, x.effort, x.schema, x.alias) == ("global.anthropic.claude-opus-5-5", "low", "auto", "opus-5.5")
    cell = r.resolve("write_dossier_cell")      # its own effort and cap, the default's model
    assert (cell.model, cell.effort, cell.max_tokens) == ("eu.anthropic.claude-opus-4-6-v1", "high", 8000)
    other = r.resolve("synthesise")              # no route of its own
    assert (other.model, other.effort, other.max_tokens) == ("eu.anthropic.claude-opus-4-6-v1", None, None)
    assert r.resolve("custom").model == "global.anthropic.claude-opus-5"     # an id is sent verbatim


def test_aliases_resolve_for_the_configured_wire():
    doc = json.dumps({"default": {"model": "opus-5.5"}})
    assert Routes("anthropic", "x", source=doc).resolve("p").model == "claude-opus-5-5"
    assert Routes("bedrock", "x", source=doc).resolve("p").model == "global.anthropic.claude-opus-5-5"


def test_vision_calls_take_the_vision_route_and_their_purpose_route_first():
    r = Routes("bedrock", "env-model", "env-vision", json.dumps(ROUTES))
    t = r.resolve("transcribe", vision=True)
    assert (t.model, t.effort) == ("global.anthropic.claude-sonnet-5-5", "medium")
    assert Routes("anthropic", "env-model", "env-vision").resolve("transcribe", vision=True).model == "env-vision"
    assert Routes("anthropic", "env-model").resolve("transcribe", vision=True).model == "env-model"


def test_no_routes_is_the_environment_for_every_call():
    r = Routes("anthropic", "claude-opus-5")
    x = r.resolve("anything")
    assert (x.model, x.effort, x.schema, x.max_tokens) == ("claude-opus-5", None, "auto", None)


def test_the_caller_effort_and_cap_apply_only_where_no_route_sets_one():
    sdk = FakeSDK([(json.dumps(GOOD), "end_turn", U())] * 3)
    p = ModelPort(sdk, "claude-opus-5", 30, routes=Routes("anthropic", "claude-opus-5", source=json.dumps(ROUTES)))
    p.call("write_dossier_cell", "s", {}, SCHEMA, usage=Usage(), attribution="t", effort="low", max_tokens=2000)
    p.call("synthesise", "s", {}, SCHEMA, usage=Usage(), attribution="t", effort="low", max_tokens=2000)
    p.call("triage", "s", {}, SCHEMA, usage=Usage(), attribution="t", effort="high")
    cell, synth, triage = sdk.calls
    assert cell["output_config"]["effort"] == "high" and cell["max_tokens"] == 8000     # the route wins
    assert synth["output_config"]["effort"] == "low" and synth["max_tokens"] == 2000    # the caller's
    assert triage["model"] == "claude-haiku-4-5" and "effort" not in triage["output_config"]  # haiku refuses it


def test_usage_is_counted_per_model_when_one_job_uses_several():
    sdk = FakeSDK([(json.dumps(GOOD), "end_turn", U(10, 5))] * 3)
    p = ModelPort(sdk, "claude-opus-5", 30, routes=Routes("anthropic", "claude-opus-5", source=json.dumps(ROUTES)))
    u = Usage()
    for purpose in ("extract_category_facts", "synthesise", "synthesise"):
        p.call(purpose, "s", {}, SCHEMA, usage=u, attribution="t")
    assert u.by_model == {"claude-opus-5-5": {"calls": 1, "input_tokens": 10, "output_tokens": 5},
                          "claude-opus-4-6": {"calls": 2, "input_tokens": 20, "output_tokens": 10}}
    assert u.as_dict() == {"input_tokens": 30, "output_tokens": 15}


def _write(path, doc):
    path.write_text(json.dumps(doc))
    st = path.stat()   # filesystems with coarse mtimes: make every write visible as a change
    os.utime(path, (st.st_atime, st.st_mtime + (time.monotonic_ns() % 1000 + 1)))


def test_an_edited_routes_file_applies_to_the_next_call_without_a_restart(tmp_path):
    f = tmp_path / "routes.json"
    _write(f, {"default": {"model": "opus-4.6"}})
    r = Routes("bedrock", "env", source=str(f))
    assert r.resolve("extract").model == "eu.anthropic.claude-opus-4-6-v1"
    _write(f, {"default": {"model": "opus-5.5", "effort": "low"}})
    x = r.resolve("extract")
    assert (x.model, x.effort) == ("global.anthropic.claude-opus-5-5", "low")


@pytest.mark.parametrize("bad", ["{not json", json.dumps({"default": {"model": "opus-5.5", "effort": "huge"}}),
                                 json.dumps({"purposes": {"x": {"modle": "opus-5.5"}}}),
                                 json.dumps({"defaults": {}})])
def test_a_bad_edit_is_refused_and_the_last_good_routes_stay_in_force(tmp_path, bad):
    f = tmp_path / "routes.json"
    _write(f, {"default": {"model": "opus-4.6"}})
    r = Routes("bedrock", "env", source=str(f))
    f.write_text(bad)
    st = f.stat()
    os.utime(f, (st.st_atime, st.st_mtime + 5))
    assert r.resolve("extract").model == "eu.anthropic.claude-opus-4-6-v1"
    assert r.error and r.table()["error"]
    _write(f, {"default": {"model": "opus-5.5"}})      # a good edit clears it
    assert r.resolve("extract").model == "global.anthropic.claude-opus-5-5" and r.error is None


def test_a_bad_routes_file_at_startup_is_refused_loudly(tmp_path):
    f = tmp_path / "routes.json"
    f.write_text(json.dumps({"default": {"schema": "maybe"}}))
    with pytest.raises(RoutesError):
        Routes("anthropic", "m", source=str(f))
    with pytest.raises(FileNotFoundError):
        Routes("anthropic", "m", source=str(tmp_path / "missing.json"))
    with pytest.raises(RoutesError):
        parse({"default": {"max_tokens": 0}})


def test_the_table_shows_what_is_in_force(tmp_path):
    r = Routes("bedrock", "env-model", None, json.dumps(ROUTES))
    t = r.table()
    assert t["source"] == "inline" and t["error"] is None
    assert t["default"]["model"] == "eu.anthropic.claude-opus-4-6-v1"
    assert t["purposes"]["extract_category_facts"] == {"model": "global.anthropic.claude-opus-5-5", "effort": "low",
                                                       "schema": "auto", "alias": "opus-5.5"}
