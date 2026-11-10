"""The award library as a gated pack: pack.yaml / packs.lock plumbing, the engine path that must
not ask it blindly, and the Brief Maker's retrieval service (mock-backend/qdrant_retrieval.py).
features/award-in-brief-maker, slice 2.
Run: cd engine/rag && python3 -m pytest test_awardlib_pack.py -q
"""
from __future__ import annotations

import importlib.util
import json
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
ENGINE = HERE.parent
REPO = ENGINE.parent
sys.path.insert(0, str(HERE))
sys.path.insert(0, str(ENGINE))
import pytest  # noqa: E402

import awardlib_gate as gate  # noqa: E402
import packs as P  # noqa: E402
from test_awardlib_gate import corpus  # noqa: E402

LOCK = json.loads((HERE / "packs.lock").read_text())
ORIGINAL_FIVE = ["briefing-template", "cannes", "dandad", "ipa", "playbooks"]


@pytest.fixture(autouse=True)
def clean(monkeypatch):
    gate._counts_cache.clear()
    for v in ("RAG_AWARDLIB", "RAG_AWARDLIB_THIN_MAX"):
        monkeypatch.delenv(v, raising=False)


# ---- packs.lock and the Pack marker ------------------------------------------------------------
def test_the_lock_lists_the_library_as_a_gated_insight_pack_and_leaves_the_rest_alone():
    by_id = {e["id"]: e for e in LOCK["packs"]}
    lib = by_id["awardlib"]
    assert lib["gated"] is True and lib["kind"] == "case" and lib["loops"] == ["loop4_insight"] and lib["k"] == 2
    for pid in ORIGINAL_FIVE:
        assert "gated" not in by_id[pid]                                  # only gated packs carry the key
    assert [e["id"] for e in LOCK["packs"]] == ORIGINAL_FIVE + ["awardlib"]


def test_pack_yaml_booleans_read_the_same_with_and_without_pyyaml():
    for yes in (True, "true", "True", "yes", "1"):
        assert P._truthy(yes)
    for no in (None, False, "false", "", "no", 0):
        assert not P._truthy(no)


def test_a_pack_directory_with_gated_true_is_gated(tmp_path):
    d = tmp_path / "awardlib"
    d.mkdir()
    (d / "pack.yaml").write_text("tag: awardlib\nkind: case\nk: 2\nloops: [loop4_insight]\ngated: true\n")
    p = P._pack_from_dir(d)
    assert p.gated and p.tag == "awardlib" and p.loops == ("loop4_insight",)
    (tmp_path / "ipa").mkdir()
    assert not P._pack_from_dir(tmp_path / "ipa").gated                   # the default is ungated


def test_the_ingest_declares_exactly_that_pack():
    import ingest_awardlib as ing
    cfg = P._parse_flat_yaml(ing.PACK_YAML)
    assert cfg["tag"] == "awardlib" and cfg["kind"] == "case" and P._truthy(cfg["gated"])
    assert list(cfg["loops"]) == ["loop4_insight"]


def test_the_lock_round_trips_the_marker(tmp_path):
    packs = [P.Pack(id="ipa", tag="ipa", chunks=5), P.Pack(id="awardlib", tag="awardlib", loops=("loop4_insight",),
                                                          chunks=7, gated=True)]
    path = P.write_lock(packs, embed_model="m", dim=3, path=tmp_path / "packs.lock")
    entries = {e["id"]: e for e in json.loads(path.read_text())["packs"]}
    assert "gated" not in entries["ipa"] and entries["awardlib"]["gated"] is True


def test_discovered_from_the_lock_the_library_is_gated(monkeypatch):
    monkeypatch.setattr(P, "corpus_root", lambda: None)
    monkeypatch.setattr(P, "lock_path", lambda: HERE / "packs.lock")
    found = {p.id: p for p in P.discover_packs()}
    assert found["awardlib"].gated and not found["ipa"].gated


# ---- the engine path must not ask a gated pack blindly ----------------------------------------
def test_the_engine_path_skips_gated_case_packs(monkeypatch):
    import parse_brief
    monkeypatch.setattr(P, "discover_packs", lambda root=None: [
        P.Pack(id="ipa", tag="ipa"), P.Pack(id="awardlib", tag="awardlib", gated=True),
        P.Pack(id="playbooks", tag="playbook", kind="playbook")])
    parse_brief._case_packs.cache_clear()
    try:
        assert [p.id for p in parse_brief._case_packs()] == ["ipa"]
    finally:
        parse_brief._case_packs.cache_clear()


# ---- the shared helpers the service uses -------------------------------------------------------
def test_a_gated_pack_is_hidden_while_the_flag_is_off(monkeypatch):
    assert gate.pack_visible(False) and not gate.pack_visible(True)
    for mode in ("thin", "on"):
        monkeypatch.setenv("RAG_AWARDLIB", mode)
        assert gate.pack_visible(True)


def test_library_where_needs_a_category_whatever_the_mode(monkeypatch):
    store = corpus()
    for mode in ("off", "thin", "on"):
        monkeypatch.setenv("RAG_AWARDLIB", mode)
        where, note = gate.library_where(store, None)
        assert where is None and "no category" in note
        assert gate.library_where(store, "")[0] is None


def test_library_where_follows_the_gate(monkeypatch):
    store = corpus(tech_cases=17, food_cases=127)
    assert gate.library_where(store, "technology")[0] is None             # flag off
    monkeypatch.setenv("RAG_AWARDLIB", "thin")
    assert gate.library_where(store, "technology")[0] == {"source": "awardlib", "category": "technology"}
    assert gate.library_where(store, "food_drink")[0] is None             # 127 cases: not thin
    monkeypatch.setenv("RAG_AWARDLIB", "on")
    assert gate.library_where(store, "food_drink")[0] == {"source": "awardlib", "category": "food_drink"}


# ---- the retrieval service, request in and response out ---------------------------------------
@pytest.fixture
def service(monkeypatch):
    """mock-backend/qdrant_retrieval.py with the index and the search faked; records every search."""
    import rag
    import retrieve
    monkeypatch.setattr(retrieve, "index_label", lambda *a, **k: "test-index")
    spec = importlib.util.spec_from_file_location("qdrant_retrieval_under_test", REPO / "mock-backend" / "qdrant_retrieval.py")
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    calls = []

    def fake_retrieve(q, k=5, where=None, **kw):
        calls.append(dict(where or {}))
        src = (where or {}).get("source", "x")
        # what the real search returns: the chunk's file name as `source`, the case title as `section`
        fname = "lib_00e4bcae27.md" if src == "awardlib" else f"{src}_0001.md"
        title = "Spotify — Daylist (2024)" if src == "awardlib" else "s"
        return [{"text": f"passage from {src}\n\n## Sources\n- Official award page: https://example.org/case",
                 "source": fname, "section": title, "citation": f"{fname} › {title}", "score": 0.9}]

    monkeypatch.setattr(mod.retrieve, "retrieve", fake_retrieve)
    store = {"s": corpus(tech_cases=17, food_cases=127)}
    monkeypatch.setattr(rag, "open_store", lambda *a, **k: store["s"])
    mod.calls, mod.store = calls, store
    return mod


def ask(service, **body):
    return service.answer({"query": "q", "k": 5, **body})


def test_flag_off_the_pack_is_not_listed_and_nothing_changes(service):
    assert [p["id"] for p in service.visible_packs()] == ORIGINAL_FIVE
    status, out = ask(service)                                            # no packs named: every visible pack
    assert status == 200
    assert sorted(c["source"] for c in service.calls) == sorted(["template", "cannes", "dandad", "ipa", "playbook"])
    assert all(p["pack"] != "awardlib" for p in out["passages"])


def test_flag_off_naming_the_pack_returns_nothing_and_never_searches_it(service):
    status, out = ask(service, packs=["awardlib"], where={"category": "technology"})
    assert status == 200 and out["passages"] == [] and service.calls == []


def test_thin_lists_the_pack_as_gated_and_filterable_by_category(service, monkeypatch):
    monkeypatch.setenv("RAG_AWARDLIB", "thin")
    lib = {p["id"]: p for p in service.visible_packs()}["awardlib"]
    assert lib["gated"] is True and lib["filterable"] == ["category"] and lib["loops"] == ["loop4_insight"]
    assert lib["licence"] == "licensed-internal" and lib["scope"] == "house"


def test_thin_serves_a_thin_category_pinned_to_it(service, monkeypatch):
    monkeypatch.setenv("RAG_AWARDLIB", "thin")
    status, out = ask(service, packs=["awardlib"], where={"category": "technology"})
    assert status == 200
    assert service.calls == [{"source": "awardlib", "category": "technology"}]
    assert [p["pack"] for p in out["passages"]] == ["awardlib"]
    assert set(out["trace"]["packs"]) == {"awardlib"}


def test_thin_serves_nothing_for_a_covered_category(service, monkeypatch):
    monkeypatch.setenv("RAG_AWARDLIB", "thin")
    status, out = ask(service, packs=["awardlib"], where={"category": "food_drink"})
    assert status == 200 and out["passages"] == [] and service.calls == []


def test_a_request_without_a_category_gets_nothing_and_no_error(service, monkeypatch):
    monkeypatch.setenv("RAG_AWARDLIB", "thin")
    for body in ({"packs": ["awardlib"]}, {"packs": ["awardlib"], "where": {}}, {"packs": ["awardlib"], "where": {"category": 3}}):
        status, out = ask(service, **body)
        assert status == 200 and out["passages"] == []
    assert service.calls == []


def test_an_older_client_asking_every_pack_still_works_and_gets_no_library(service, monkeypatch):
    """The Brief Maker today asks each pack it is told about, with no `where`."""
    monkeypatch.setenv("RAG_AWARDLIB", "thin")
    status, out = ask(service)
    assert status == 200
    assert "awardlib" not in [c["source"] for c in service.calls]
    assert all(p["pack"] != "awardlib" for p in out["passages"])


def test_the_other_packs_are_searched_exactly_as_before_whatever_the_flag(service, monkeypatch):
    for mode in (None, "thin", "on"):
        if mode:
            monkeypatch.setenv("RAG_AWARDLIB", mode)
        service.calls.clear()
        ask(service, packs=["ipa", "cannes"], where={"category": "technology"})
        assert service.calls == [{"source": "ipa"}, {"source": "cannes"}]


def test_a_store_that_cannot_count_withholds_the_library(service, monkeypatch):
    monkeypatch.setenv("RAG_AWARDLIB", "thin")
    service.store["s"].count_where = None
    status, out = ask(service, packs=["awardlib"], where={"category": "technology"})
    assert status == 200 and out["passages"] == [] and service.calls == []


def test_an_empty_query_is_still_a_400(service):
    assert ask(service, query="  ")[0] == 400


def test_library_passages_name_themselves_not_their_file(service, monkeypatch):
    """The export prints a source's name, so the library says what it is, and every other pack is untouched."""
    monkeypatch.setenv("RAG_AWARDLIB", "thin")
    _, out = ask(service, packs=["awardlib"], where={"category": "technology"})
    p = out["passages"][0]
    assert p["source"] == "Award case library" and p["section"] == "Spotify — Daylist (2024)"
    assert p["citation"] == "Award case library › Spotify — Daylist (2024)" and ".md" not in p["citation"]
    assert "## Sources" in p["text"] and "https://example.org/case" in p["text"]      # the source link rides in the text
    assert p["licence"] == "licensed-internal" and p["scope"] == "house"
    _, other = ask(service, packs=["ipa"])
    assert other["passages"][0]["source"] == "ipa_0001.md"                            # unchanged
    assert other["passages"][0]["citation"] == "ipa_0001.md › s"


def test_the_passage_still_passes_the_clients_own_checks(service, monkeypatch):
    """server/napkin/retrieval.py drops any passage whose id, uri or hash it cannot recompute."""
    import hashlib
    monkeypatch.setenv("RAG_AWARDLIB", "thin")
    _, out = ask(service, packs=["awardlib"], where={"category": "technology"})
    p = out["passages"][0]
    assert p["text_sha256"] == hashlib.sha256(p["text"].encode()).hexdigest()
    assert p["id"] == "psg_" + hashlib.sha256(f"{p['pack']}\n{p['source']}\n{p['section']}\n{p['text']}".encode()).hexdigest()[:20]
    assert p["uri"] == f"passage://{p['pack']}/{p['source']}#spotify-daylist-2024@{p['text_sha256'][:16]}"
