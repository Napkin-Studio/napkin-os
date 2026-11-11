"""The default retrieval filter: `source nin [cannes]` on every search (features/harness.clan).
Rows here are synthetic stand-ins (no corpus text); the fake store matches filters with the repo's
own filter language, so nin means here what it means in the real stores.
Run: cd engine/rag && python3 -m pytest test_default_source_filter.py -q
"""
from __future__ import annotations

import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import pytest  # noqa: E402

import brief_context as bc  # noqa: E402
import filters  # noqa: E402
import judge  # noqa: E402
import retrieve  # noqa: E402


def row(doc_id, source, score=0.5, bucket="exemplars"):
    md = {"doc_id": doc_id, "source": source, "category": "fmcg", "bucket": bucket, "level": "parent",
          "scope": "global", "tenant": "house", "status": "active"}
    return {"id": doc_id, "source": source, "section": "s", "text": f"stand-in text for {doc_id}", "header": "h",
            "metadata": md, "_score": score}


# ---- the clause merge -------------------------------------------------------------------------
@pytest.mark.parametrize("given, want", [
    (None, {"source": {"nin": ["cannes"]}}),
    ({"category": "fmcg"}, {"category": "fmcg", "source": {"nin": ["cannes"]}}),
    ({"source": "ipa"}, {"source": "ipa"}),
    ({"source": {"in": ["ipa", "cannes"]}}, {"source": {"in": ["ipa"]}}),
    ({"source": {"nin": ["awardlib"]}}, {"source": {"nin": ["awardlib", "cannes"]}}),
    ({"source": {"ne": "awardlib"}}, {"source": {"nin": ["awardlib", "cannes"]}}),
])
def test_the_exclusion_is_merged_into_the_callers_where(given, want):
    assert retrieve.exclude_sources(given) == want


@pytest.mark.parametrize("given", [{"source": "cannes"}, {"source": {"eq": "cannes"}}, {"source": {"in": ["cannes"]}}])
def test_asking_for_cannes_alone_matches_nothing(given):
    assert retrieve.exclude_sources(given) is None


# ---- retrieve() ---------------------------------------------------------------------------------
def fake_search(monkeypatch, rows, honour_filters=True):
    import rag
    calls = []

    def search(d, query, k=5, where=None, mode=None):
        calls.append(dict(where or {}))
        got = [r for r in rows if not honour_filters or filters.matches(r["metadata"], where)]
        return [(r["_score"], r) for r in got][:k]

    monkeypatch.setattr(rag, "store_available", lambda d: True)
    monkeypatch.setattr(rag, "search", search)
    return calls


def test_retrieve_never_serves_cannes_and_says_how_many_it_kept_out(monkeypatch):
    rows = [row("ipa_1", "ipa", .9), row("cannes_1", "cannes", .8), row("cannes_2", "cannes", .7), row("effie_1", "effie", .6)]
    calls = fake_search(monkeypatch, rows)
    got = retrieve.retrieve("q", k=10)
    assert [h["doc_id"] for h in got] == ["ipa_1", "effie_1"]
    assert calls[0]["source"] == {"nin": ["cannes"]}
    held_back = sum(1 for r in rows if r["metadata"]["source"] == "cannes") - sum(
        1 for h in got if h["metadata"]["source"] == "cannes")
    assert held_back == 2                                         # both cannes rows were kept out


def test_retrieve_catches_a_store_that_ignores_the_filter(monkeypatch):
    fake_search(monkeypatch, [row("ipa_1", "ipa", .9), row("cannes_1", "cannes", .8)], honour_filters=False)
    assert [h["doc_id"] for h in retrieve.retrieve("q", k=10)] == ["ipa_1"]


def test_retrieve_with_a_cannes_source_filter_searches_nothing(monkeypatch):
    calls = fake_search(monkeypatch, [row("cannes_1", "cannes")])
    assert retrieve.retrieve("q", where={"source": "cannes"}) == [] and calls == []


# ---- brief_context ------------------------------------------------------------------------------
def test_every_bucket_filter_carries_the_default():
    for b in ("exemplars", "craft", "rules", "instructions"):
        assert bc.bucket_filters(b, {}, ["global"], ["house"])["source"] == {"nin": ["cannes"]}


def multi(monkeypatch, rows, honour_filters=True):
    import rag
    wheres = []

    def search_vec(s, qvec, q, k=5, where=None, mode=None):
        wheres.append(dict(where or {}))
        got = [r for r in rows if not honour_filters or filters.matches(r["metadata"], where)]
        return [(r["_score"], r) for r in sorted(got, key=lambda r: -r["_score"])][:k]

    monkeypatch.setattr(rag, "open_store", lambda *a, **k: None)
    monkeypatch.setattr(rag, "embed", lambda texts, t="passage": ([[1.0]] * len(texts), "nim:x"))
    monkeypatch.setattr(rag, "search_vec", search_vec)
    monkeypatch.setattr(bc, "_collapse", lambda rows, store: rows)
    bc._counts_cache.clear()
    mc = bc.build_multi({"category": "fmcg", "problem": "p"}, {"insight": "q1", "proof": "q2"}, chain=judge.Chain([]))
    return mc, wheres


def test_the_mix_path_has_no_cannes_hit_and_records_each_hits_source(monkeypatch):
    rows = [row(f"ipa_{i}", "ipa", .9 - i * .01) for i in range(3)] + [row(f"cannes_{i}", "cannes", .95) for i in range(4)]
    mc, wheres = multi(monkeypatch, rows)
    served = {c: s for f in mc.trace["source_of"].values() for c, s in f.items()}
    assert served and set(served.values()) == {"ipa"}
    assert "cannes" not in {h.source for hs in mc.fields.values() for h in hs}
    assert all(w["source"]["nin"][-1] == "cannes" for w in wheres)         # every search carried the clause
    assert mc.trace["egress"] == []                                         # the filter held; nothing for egress


def test_the_mix_path_catches_a_store_that_ignores_the_filter(monkeypatch):
    rows = [row("ipa_1", "ipa", .5)] + [row(f"cannes_{i}", "cannes", .99) for i in range(3)]
    mc, _ = multi(monkeypatch, rows, honour_filters=False)
    assert "cannes" not in {h.source for hs in mc.fields.values() for h in hs}
    assert mc.trace["egress"] and {e["on"] for e in mc.trace["egress"]} == {"source"}
