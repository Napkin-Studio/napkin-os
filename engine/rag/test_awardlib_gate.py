"""The award case library gate: RAG_AWARDLIB off | thin | on, in brief_context._bucket_hits.
The fake store matches filters with the repo's own filter language (filters.matches), so
nin / eq / in mean here what they mean in the real stores.
Run: cd engine/rag && python3 -m pytest test_awardlib_gate.py -q
"""
from __future__ import annotations

import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import pytest  # noqa: E402

import brief_context as bc  # noqa: E402
import chunking  # noqa: E402
import filters  # noqa: E402


def row(doc_id, source, category, score, **extra):
    md = {"doc_id": doc_id, "source": source, "category": category, "bucket": "exemplars", "level": "parent",
          "scope": "global", "tenant": "house", "status": "active", "effectiveness_type": None, **extra}
    return {"id": doc_id, "text": "t", "header": "h", "metadata": md, "_score": score}


class FakeStore:
    """Rows in memory; count_where and the patched search_vec both use filters.matches."""
    def __init__(self, rows, can_count=True):
        self.rows = rows
        if not can_count:
            self.count_where = None            # shadows nothing: getattr(store, "count_where", None) -> None

    def count_where(self, where):
        return sum(1 for r in self.rows if filters.matches(r["metadata"], where))


def install(monkeypatch, store):
    """Route rag.search_vec to the fake store; return the list of every where clause used."""
    import rag
    calls = []

    def search_vec(s, qvec, q, k=5, where=None, mode=None):
        calls.append(dict(where or {}))
        hits = [r for r in s.rows if filters.matches(r["metadata"], where)]
        return [(r["_score"], r) for r in sorted(hits, key=lambda r: -r["_score"])][:k]

    monkeypatch.setattr(rag, "search_vec", search_vec)
    monkeypatch.setattr(bc, "_collapse", lambda rows, store: rows)
    return calls


@pytest.fixture(autouse=True)
def clean(monkeypatch):
    bc._counts_cache.clear()
    for v in ("RAG_AWARDLIB", "RAG_AWARDLIB_THIN_MAX"):
        monkeypatch.delenv(v, raising=False)


def corpus(tech_cases=17, food_cases=127):
    """An index shaped like the real one: technology thin, food_drink rich, plus library rows in both."""
    rows = [row(f"ipa_t{i}", "ipa", "technology", 0.50 - i * 0.001) for i in range(tech_cases)]
    rows += [row(f"ipa_f{i}", "ipa", "food_drink", 0.50 - i * 0.001) for i in range(food_cases)]
    rows += [row(f"lib_t{i}", "awardlib", "technology", 0.90 - i * 0.01) for i in range(5)]
    rows += [row(f"lib_f{i}", "awardlib", "food_drink", 0.90 - i * 0.01) for i in range(5)]
    return FakeStore(rows)


def hits(store, category, notes=None, bucket="exemplars", **filters_extra):
    return bc._bucket_hits(store, [1.0], "q", bucket, {"category": category, **filters_extra}, ["global"], ["house"],
                           40, (), notes if notes is not None else [])


def ids(result):
    return [h.doc_id for h in result[0]]


# ---- the switch ---------------------------------------------------------------------------
def test_default_is_off_and_the_library_never_reaches_the_main_search(monkeypatch):
    calls = install(monkeypatch, corpus())
    got = ids(hits(corpus(), "technology"))
    assert not [d for d in got if d.startswith("lib_")] and got                        # baseline rows only
    assert all(c.get("source") == {"nin": ["awardlib"]} for c in calls)


def test_off_hides_library_rows_even_when_they_are_the_only_rows(monkeypatch):
    store = FakeStore([row("lib_only", "awardlib", "b2b", 0.9)])
    install(monkeypatch, store)
    assert ids(hits(store, "b2b")) == []


def test_unknown_mode_and_bad_threshold_raise(monkeypatch):
    monkeypatch.setenv("RAG_AWARDLIB", "maybe")
    with pytest.raises(ValueError, match="RAG_AWARDLIB"):
        bc.awardlib_mode()
    monkeypatch.setenv("RAG_AWARDLIB", "THIN")
    assert bc.awardlib_mode() == "thin"                                                   # case-insensitive
    for bad in ("0", "-3", "many"):
        monkeypatch.setenv("RAG_AWARDLIB_THIN_MAX", bad)
        with pytest.raises(ValueError, match="RAG_AWARDLIB_THIN_MAX"):
            bc.awardlib_thin_max()
    monkeypatch.setenv("RAG_AWARDLIB_THIN_MAX", "45")
    assert bc.awardlib_thin_max() == 45


# ---- thin mode ----------------------------------------------------------------------------
def test_thin_admits_the_library_only_where_the_category_is_thin(monkeypatch):
    monkeypatch.setenv("RAG_AWARDLIB", "thin")
    store = corpus()
    install(monkeypatch, store)
    notes = []
    tech = ids(hits(store, "technology", notes))
    assert any(d.startswith("lib_t") for d in tech) and not any(d.startswith("lib_f") for d in tech)
    assert any("admitted for technology (17 cases < 30)" in n for n in notes)
    notes = []
    food = ids(hits(store, "food_drink", notes))
    assert not any(d.startswith("lib_") for d in food)                                    # 127 cases: not needed
    assert any("not needed, food_drink has 127 cases" in n for n in notes)


def test_thin_library_pass_is_pinned_to_the_category_and_drops_effectiveness_type(monkeypatch):
    monkeypatch.setenv("RAG_AWARDLIB", "thin")
    store = corpus()
    calls = install(monkeypatch, store)
    hits(store, "technology", effectiveness_type="launch")
    lib_calls = [c for c in calls if c.get("source") == "awardlib"]
    assert len(lib_calls) == 1
    assert lib_calls[0]["category"] == "technology" and "effectiveness_type" not in lib_calls[0]
    assert lib_calls[0]["scope"] == {"in": ["global"]} and lib_calls[0]["tenant"] == {"in": ["house"]}   # confidentiality kept
    main = [c for c in calls if c.get("source") != "awardlib"]
    assert main and all(c["source"] == {"nin": ["awardlib"]} for c in main)


def test_thin_merges_by_score_so_the_validator_sees_one_list(monkeypatch):
    monkeypatch.setenv("RAG_AWARDLIB", "thin")
    store = corpus()
    install(monkeypatch, store)
    got = ids(hits(store, "technology"))
    assert got[0].startswith("lib_t")                                                      # library rows score higher in the fake
    assert len(got) <= 40 and len(set(got)) == len(got)                                    # pool size kept, no duplicates


def test_thin_withholds_without_a_category_and_says_so(monkeypatch):
    monkeypatch.setenv("RAG_AWARDLIB", "thin")
    store = corpus()
    install(monkeypatch, store)
    notes = []
    result = bc._bucket_hits(store, [1.0], "q", "exemplars", {}, ["global"], ["house"], 40, (), notes)
    assert not [h for h in result[0] if h.doc_id.startswith("lib_")]
    assert "awardlib: withheld, the brief has no category" in notes


def test_thin_fails_closed_when_the_store_cannot_count_or_errors(monkeypatch):
    monkeypatch.setenv("RAG_AWARDLIB", "thin")
    store = corpus()
    store.count_where = None                                                              # a store without the method
    install(monkeypatch, store)
    notes = []
    assert not [d for d in ids(hits(store, "technology", notes)) if d.startswith("lib_")]
    assert "awardlib: withheld, the store cannot count cases" in notes

    boom = corpus()
    boom.count_where = lambda where: (_ for _ in ()).throw(RuntimeError("qdrant unreachable"))
    install(monkeypatch, boom)
    bc._counts_cache.clear()
    notes = []
    assert not [d for d in ids(hits(boom, "technology", notes)) if d.startswith("lib_")]
    assert "awardlib: withheld, the store cannot count cases" in notes


def test_the_thin_set_comes_from_the_index_and_follows_the_threshold(monkeypatch):
    monkeypatch.setenv("RAG_AWARDLIB", "thin")
    store = corpus(tech_cases=17, food_cases=40)
    install(monkeypatch, store)
    counts = bc.category_case_counts(store)
    assert counts["technology"] == 17 and counts["food_drink"] == 40 and counts["b2b"] == 0
    assert not any(d.startswith("lib_f") for d in ids(hits(store, "food_drink")))         # 40 >= 30
    monkeypatch.setenv("RAG_AWARDLIB_THIN_MAX", "50")
    assert any(d.startswith("lib_f") for d in ids(hits(store, "food_drink")))             # 40 < 50: now thin


def test_baseline_counts_ignore_the_library_itself_and_superseded_rows(monkeypatch):
    store = FakeStore([row("a", "ipa", "retail", 1), row("b", "cannes", "retail", 1),
                       row("c", "awardlib", "retail", 1), row("d", "ipa", "retail", 1, status="superseded"),
                       row("e", "dandad", "retail", 1)])
    assert bc.category_case_counts(store)["retail"] == 2


def test_widening_never_lets_the_library_in_through_the_ladder(monkeypatch):
    """A thin category with only 2 baseline docs widens (drops category). In off mode every
    one of those searches still carries the library exclusion."""
    store = FakeStore([row("ipa_1", "ipa", "luxury", .5), row("ipa_2", "ipa", "luxury", .5)]
                      + [row(f"ipa_r{i}", "ipa", "retail", .4) for i in range(6)]
                      + [row(f"lib_{i}", "awardlib", "retail", .9) for i in range(4)])
    calls = install(monkeypatch, store)
    notes = []
    got = ids(hits(store, "luxury", notes))
    assert len(calls) >= 2 and any("dropped category" in n for n in notes)                 # it did widen
    assert all(c["source"] == {"nin": ["awardlib"]} for c in calls)
    assert not [d for d in got if d.startswith("lib_")]


# ---- on mode, other buckets, rendering ------------------------------------------------------
def test_on_adds_no_clause_and_the_library_competes_everywhere(monkeypatch):
    monkeypatch.setenv("RAG_AWARDLIB", "on")
    store = corpus()
    calls = install(monkeypatch, store)
    got = ids(hits(store, "food_drink"))
    assert any(d.startswith("lib_f") for d in got)
    assert all("source" not in c for c in calls)


def test_only_the_exemplars_bucket_is_touched(monkeypatch):
    monkeypatch.setenv("RAG_AWARDLIB", "thin")
    store = FakeStore([row("pb_1", "playbook", None, .5, bucket="craft")])
    calls = install(monkeypatch, store)
    hits(store, "technology", bucket="craft")
    assert calls and all("source" not in c for c in calls)                                 # craft/rules/instructions untouched


def test_a_rendered_library_hit_always_carries_its_provenance_header(tmp_path):
    md = ('---\nsource: "awardlib"\nframework_id: "lib_abc"\nframework_name: "Acme — Case (2024)"\ncategory: "award_library_case"\n'
          'client_category: "technology"\naward_show: "One Show"\nyear: "2024"\naward_outcome: "gold"\ncountry: "France"\n---\n'
          "# Acme — Case (2024)\n\n**Provenance:** the strategy fields below are Napkin reconstructions from public sources, "
          "not the entrant's own words. Results are entrant-reported and not independently audited. Public facts only; no asset "
          "reuse rights.\n\n## Problem\nSales had stalled in a crowded category for years.\n")
    p = tmp_path / "lib_abc.md"
    p.write_text(md)
    chunk = chunking.chunk_file(p)[0]
    hit = bc._to_hit(0.9, chunk, "exemplars")
    assert hit.cite == "lib_abc"                                                           # short, stable, prefix kept
    assert "reconstructed strategy" in hit.render()                                        # the label is on every rendered hit


# ---- count_where on the stores ----------------------------------------------------------------
def test_local_count_where_equals_the_rows_the_filter_matches(tmp_path):
    from store_local import LocalStore
    rows = [{"id": f"c{i}", "text": "t", "vector": [1.0, 0.0],
             "metadata": {"source": s, "category": c, "level": "parent", "status": "active"}}
            for i, (s, c) in enumerate([("ipa", "technology")] * 3 + [("awardlib", "technology")] * 2 + [("cannes", "retail")] * 4)]
    st = LocalStore(tmp_path)
    st.replace_all(rows)
    assert st.count_where({"source": {"in": ["ipa", "cannes"]}, "category": "technology"}) == 3
    assert st.count_where({"source": {"nin": ["awardlib"]}}) == 7
    assert st.count_where(None) == 9 and st.count_where({"category": "nothing"}) == 0
    assert bc.category_case_counts(st)["technology"] == 3                  # the library's own rows are not counted


def test_qdrant_count_where_sends_one_exact_count_request_and_raises_on_failure(monkeypatch):
    import store_qdrant as q
    sent = []

    def fake(method, path, body=None, timeout=60):
        sent.append((method, path, body))
        return {"result": {"count": 41}}

    monkeypatch.setattr(q, "_req", fake)
    monkeypatch.setattr(q, "collection_name", lambda: "c")
    assert q.count_where({"source": {"in": ["ipa"]}, "category": "technology"}) == 41
    (method, path, body), = sent
    assert (method, path) == ("POST", "/collections/c/points/count") and body["exact"] is True
    assert body["filter"] == filters.to_qdrant({"source": {"in": ["ipa"]}, "category": "technology"})

    def boom(*a, **k):
        raise RuntimeError("unreachable")

    monkeypatch.setattr(q, "_req", boom)
    with pytest.raises(RuntimeError):                                       # not a silent 0: the gate must fail closed
        q.count_where({"category": "technology"})
