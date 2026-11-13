"""Every source a pin cites reaches the document as a record (shared/sources.yaml):
on every push of every stage, each `src_` id a new pin cites is in that push's
sources_append or already in the document's sources. A roster row the brand layer
holds is no exception: the person who confirmed it is its source, and the record
says so (feature research-new-ui, "Missing source")."""

import importlib.util
from pathlib import Path
from types import SimpleNamespace

from napkin.layers import layer_source_record, row_source_records
from napkin.pipeline.research import Researcher

from conftest import contract_suite

REPO = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location("contract_test", contract_suite())
ct = importlib.util.module_from_spec(spec)
spec.loader.exec_module(ct)

PROMPT = "BMW is trying to enter the Ev hybrid market in Ireland. Make a campaign clan on that"


def run(server, answer):
    """One campaign driven as the host drives it, with each push checked as it lands."""
    suite = ct.Suite(ct.Client(server.url, None), REPO / "app" / "templates" / "campaign-research", 60)
    doc, data, inp, facts, chain = ct.start_doc(PROMPT)
    host = ct.Host(suite, doc, data, facts, chain)
    host.sources, host.pushes = {}, []
    apply = host.apply

    def checked(ch):
        cited = {s for f in ch["facts_append"] for s in f.get("sources") or [] if str(s).startswith("src_")}
        new = {s["id"]: s for s in ch.get("sources_append") or []}
        missing = cited - set(new) - set(host.sources)
        assert not missing, f"pins cite {sorted(missing)} with no source record in the push or the document"
        host.pushes.append(ch)
        out = apply(ch)
        for sid, s in new.items():
            host.sources.setdefault(sid, s)
        return out

    host.apply = checked
    r = ct.Run(suite, host, inp)
    r.start(answer)
    assert r.states[-1] == "done"
    return host


def test_every_cited_source_arrives_with_its_pin_roster_rows_included(server):
    def pick_both(r, q):
        return (next(o for o in q["options"] if o["id"] == "both"), None)
    host = run(server, pick_both)
    assert host.facts and any(p["facts_append"] for p in host.pushes)

    # campaign two pins the roster row the person confirmed in campaign one; its
    # source is that confirmation, a record with no publisher or date
    host2 = run(server, lambda r, q: (_ for _ in ()).throw(AssertionError(f"asked {q['text']}")))
    roster = [f for f in host2.facts if f["key"].startswith("roster.categories")]
    assert roster
    for f in roster:
        for sid in f["sources"]:
            rec = host2.sources[sid]
            assert rec["title"] == "confirmed in the chat" and rec["tier"] == "reviewer-verified"
            assert rec["uri"].startswith("human:") and rec["origin_kind"] == "layer"
            assert rec["licence"] == "client-confidential"
    # the roster's records arrive in identify's push, with the pins
    first = next(p for p in host2.pushes if any(f in p["facts_append"] for f in roster))
    assert {s for f in roster for s in f["sources"]} <= {s["id"] for s in first["sources_append"]}


def test_a_layer_record_is_kept_with_whatever_it_has():
    person = {"id": "src_aaaa", "uri": "human:tia@tbwa", "publisher": None, "title": "confirmed in the chat",
              "tier": "reviewer-verified", "domain": "human:tia@tbwa", "licence": "client-confidential",
              "retrieved_at": None, "published_at": None, "quote": None}
    assert layer_source_record(person) == {
        "id": "src_aaaa", "uri": "human:tia@tbwa", "title": "confirmed in the chat", "tier": "reviewer-verified",
        "domain": "human:tia@tbwa", "licence": "client-confidential", "origin_kind": "layer"}
    # no address at all: still a record, under an address the host accepts
    bare = layer_source_record({"id": "src_bbbb", "uri": " ", "title": "A report", "tier": "secondary"})
    assert bare == {"id": "src_bbbb", "uri": "layer:src_bbbb", "title": "A report", "tier": "secondary",
                    "origin_kind": "layer"}
    assert layer_source_record({"id": "human:ana", "uri": "human:ana"}) is None
    rows = [{"source_records": [person]}, {"source_records": [person, {"id": "src_cccc", "uri": "https://x"}]}]
    assert [r["id"] for r in row_source_records(rows)] == ["src_aaaa", "src_cccc"]
    assert [r["id"] for r in row_source_records(rows, cited=["src_cccc"])] == ["src_cccc"]


def test_research_keeps_a_reused_rows_record_without_a_uri_and_one_only_the_written_row_knew():
    """A reused row's record with no uri was dropped before; and a corroborated row comes back citing
    sources the layer held before the run, which only the written row carries (kept by `_pin`)."""
    me = SimpleNamespace(_row_recs={"src_held": {"id": "src_held", "uri": "https://held.example",
                                                 "title": "Held before", "tier": "primary"}})
    facts = [{"id": "f_1", "sources": ["src_bare", "src_held", "src_none"]}]
    cands = [{"records": [{"id": "src_bare", "title": "Untitled register", "tier": "secondary",
                           "licence": "open"}]}]
    out = {r["id"]: r for r in Researcher._source_records(me, facts, [], {}, cands)}
    assert set(out) == {"src_bare", "src_held"}  # src_none: nothing at all is known of it
    assert out["src_bare"] == {"id": "src_bare", "uri": "layer:src_bare", "title": "Untitled register",
                               "tier": "secondary", "licence": "open", "origin_kind": "layer"}
    assert out["src_held"]["origin_kind"] == "layer" and out["src_held"]["title"] == "Held before"
