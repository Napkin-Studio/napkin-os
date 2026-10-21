"""rank.py and time_rules.py against the shared fixtures clan-store's vitest also asserts
(contracts/examples/ranks.json, windows.json): the two languages never disagree."""

import json

import pytest

import rank
import time_rules
from contracts_dir import contracts_dir

RANKS = json.loads((contracts_dir() / "examples" / "ranks.json").read_text())
WINDOWS = json.loads((contracts_dir() / "examples" / "windows.json").read_text())


@pytest.mark.parametrize("case", RANKS["between"], ids=lambda c: f"{c['a']}..{c['b']}")
def test_between(case):
    if case.get("error"):
        with pytest.raises(rank.RankError):
            rank.between(case["a"], case["b"])
        return
    got = rank.between(case["a"], case["b"])
    assert got == case["between"]
    assert (case["a"] is None or case["a"] < got) and (case["b"] is None or got < case["b"])


@pytest.mark.parametrize("run", RANKS["runs"], ids=lambda r: f"{r['a']}..{r['b']}x{r['n']}")
def test_n_between(run):
    keys = rank.n_between(run["a"], run["b"], run["n"])
    assert keys == run["keys"]
    assert keys == sorted(keys) and len(set(keys)) == len(keys)


@pytest.mark.parametrize("key", RANKS["invalid"])
def test_invalid_keys(key):
    assert not rank.is_valid(key)


@pytest.mark.parametrize("case", WINDOWS["cases"], ids=lambda c: f"{c['t']}@{c['shot_s']}")
def test_note_window(case):
    got = time_rules.note_window(case["t"], case["shot_s"])
    assert got == case["window"]
    if got:
        assert time_rules.window_problem(got, case["shot_s"]) is None


def test_window_problems():
    assert "at least 2 s" in time_rules.window_problem({"from_s": 2, "to_s": 3}, 6)
    assert "crosses a cut" in time_rules.window_problem({"from_s": 4, "to_s": 7}, 6)


# Fix this moment (features/clip-moment-edit.clan): the twins of clan-store/src/patch.ts.
PATCHES = json.loads((contracts_dir() / "examples" / "patches.json").read_text())


@pytest.mark.parametrize("case", PATCHES["noteToTakeWindow"], ids=lambda c: c["why"])
def test_note_to_take_window(case):
    assert time_rules.note_to_take_window(case["note"], case["take_s"], case["item"]) == case["want"]


@pytest.mark.parametrize("case", PATCHES["patchPlan"], ids=lambda c: c["why"])
def test_patch_plan(case):
    i = case["in"]
    got = time_rules.patch_plan(i["window"], i["atS"], i["takeS"], i.get("contextS", 0), i.get("edited", False),
                                i.get("send", "range"), i.get("maxInputS", time_rules.MAX_INPUT_S))
    assert got == case["want"]


# Make and Edit (features/make-and-edit.clan): the twins of clan-store/src/timeline.ts and patch.ts.
TIMELINE = json.loads((contracts_dir() / "examples" / "timeline.json").read_text())


@pytest.mark.parametrize("case", TIMELINE["adTimeToSource"]["cases"], ids=lambda c: c["why"])
def test_ad_time_to_source(case):
    assert time_rules.ad_time_to_source(TIMELINE["adTimeToSource"]["timeline"], case["adS"]) == case["want"]


@pytest.mark.parametrize("case", TIMELINE["momentWindow"], ids=lambda c: c["why"])
def test_moment_window(case):
    assert time_rules.moment_window(case["inS"], case["outS"], case["takeS"]) == case["want"]
