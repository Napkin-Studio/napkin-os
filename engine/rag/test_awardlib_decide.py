"""The shared award-library gate decision (awardlib_gate.decide) and its parity with
brief_context._bucket_hits. features/award-in-brief-maker, slice 1: one rule, two callers.
Run: cd engine/rag && python3 -m pytest test_awardlib_decide.py -q
"""
from __future__ import annotations

import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import pytest  # noqa: E402

import awardlib_gate as gate  # noqa: E402
import brief_context as bc  # noqa: E402
from test_awardlib_gate import FakeStore, corpus, hits, ids, install  # noqa: E402


@pytest.fixture(autouse=True)
def clean(monkeypatch):
    gate._counts_cache.clear()
    for v in ("RAG_AWARDLIB", "RAG_AWARDLIB_THIN_MAX"):
        monkeypatch.delenv(v, raising=False)


# ---- the decision -------------------------------------------------------------------------
def test_off_is_the_default_and_admits_nothing():
    d = gate.decide(corpus(), "technology")
    assert d == gate.Decision(False, "awardlib: off")


def test_on_admits_everywhere_without_counting_or_a_category(monkeypatch):
    monkeypatch.setenv("RAG_AWARDLIB", "on")
    assert gate.decide(corpus(), "food_drink").admit
    assert gate.decide(corpus(), None).admit
    no_count = corpus()
    no_count.count_where = None
    assert gate.decide(no_count, "technology").admit               # `on` has no gate to fail


def test_thin_admits_only_below_the_threshold(monkeypatch):
    monkeypatch.setenv("RAG_AWARDLIB", "thin")
    store = corpus(tech_cases=17, food_cases=127)
    assert gate.decide(store, "technology") == gate.Decision(True, "awardlib: admitted for technology (17 cases < 30)")
    assert gate.decide(store, "food_drink") == gate.Decision(
        False, "awardlib: not needed, food_drink has 127 cases (limit 30)")
    assert gate.decide(store, "b2b").admit                          # an empty category is the thinnest


def test_thin_boundary_is_strict(monkeypatch):
    monkeypatch.setenv("RAG_AWARDLIB", "thin")
    assert not gate.decide(corpus(tech_cases=30), "technology").admit      # 30 is not below 30
    gate._counts_cache.clear()
    assert gate.decide(corpus(tech_cases=29), "technology").admit
    gate._counts_cache.clear()
    monkeypatch.setenv("RAG_AWARDLIB_THIN_MAX", "20")
    assert not gate.decide(corpus(tech_cases=29), "technology").admit      # the threshold follows the env


def test_thin_fails_closed(monkeypatch):
    monkeypatch.setenv("RAG_AWARDLIB", "thin")
    assert gate.decide(corpus(), None) == gate.Decision(False, "awardlib: withheld, the brief has no category")
    assert gate.decide(corpus(), "") .admit is False
    blind = corpus()
    blind.count_where = None
    assert gate.decide(blind, "technology") == gate.Decision(
        False, "awardlib: withheld, the store cannot count cases")
    boom = corpus()
    boom.count_where = lambda where: (_ for _ in ()).throw(RuntimeError("unreachable"))
    gate._counts_cache.clear()
    assert gate.decide(boom, "technology").admit is False


def test_an_unknown_category_value_is_treated_as_empty_not_as_an_error(monkeypatch):
    monkeypatch.setenv("RAG_AWARDLIB", "thin")
    assert gate.decide(corpus(), "not_a_category").admit is True    # zero own cases: thin by definition


def test_bad_mode_and_bad_threshold_raise(monkeypatch):
    monkeypatch.setenv("RAG_AWARDLIB", "maybe")
    with pytest.raises(ValueError, match="RAG_AWARDLIB"):
        gate.decide(corpus(), "technology")
    monkeypatch.delenv("RAG_AWARDLIB")
    with pytest.raises(ValueError, match="awardlib mode"):
        gate.decide(corpus(), "technology", mode="sometimes")
    monkeypatch.setenv("RAG_AWARDLIB", "thin")
    monkeypatch.setenv("RAG_AWARDLIB_THIN_MAX", "0")
    with pytest.raises(ValueError, match="RAG_AWARDLIB_THIN_MAX"):
        gate.decide(corpus(), "technology")


def test_brief_context_still_exposes_the_old_names_and_the_same_cache():
    for name in ("awardlib_mode", "awardlib_thin_max", "category_case_counts", "AWARDLIB_SOURCE",
                 "AWARDLIB_MODES", "AWARDLIB_THIN_MAX_DEFAULT", "AWARDLIB_BASELINE_SOURCES"):
        assert getattr(bc, name) is getattr(gate, name)
    assert bc._counts_cache is gate._counts_cache                  # tests clear it through brief_context


# ---- parity: the library reaches brief_context exactly when decide() says so -------------
@pytest.mark.parametrize("mode", ["off", "thin", "on"])
@pytest.mark.parametrize("category", ["technology", "food_drink", None])
@pytest.mark.parametrize("can_count", [True, False])
def test_brief_context_and_decide_agree(monkeypatch, mode, category, can_count):
    if mode != "off":
        monkeypatch.setenv("RAG_AWARDLIB", mode)
    store = corpus()
    if not can_count:
        store.count_where = None
    install(monkeypatch, store)
    gate._counts_cache.clear()
    in_results = any(d.startswith("lib_") for d in ids(hits(store, category)))
    gate._counts_cache.clear()
    assert in_results == gate.decide(store, category).admit
