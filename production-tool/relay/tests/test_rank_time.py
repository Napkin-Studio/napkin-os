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
