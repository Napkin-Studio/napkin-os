"""UAT round 4 F11: with no comparators named, research finds the category's main players itself and
proposes them in campaign.competitor_set (owner, 2026-11-24: "Research can discover players in the same
category right?"). Only names a source states are kept, never the client's own brand, and the proposal
rests on facts pinned this run."""

import threading

from napkin.capabilities import Capabilities
from napkin.model import ModelPort
from napkin.pipeline.research import Researcher, brand_ref_of, checked_players

from fakes import READ, FakeModel, FakeResearch

SCOPE = {"org": "org/test-agency", "brand": "brand/test"}
DOC = "11111111-2222-4333-8444-555555555555"
CAT = "automotive.ev_charging"  # any leaf the fake layers know; the names below are what matters
PLAYERS = "The leading refill brands are Smol and Method, with challenger Blueland growing fast."
CLAIM = "Smol says its refill tablets cut plastic waste."


def stated(v, gate):
    return {"value": v, "origin": "stated", "gate": gate, "by": "human:u", "decision": "d_TESTSTATED1"}


def clan(competitors=None):
    camp = {"brand": stated({"ref": "brand/copperell", "name": "Copperell"}, "created"),
            "categories": stated([CAT], "research"), "markets": stated(["GB"], "research")}
    if competitors:
        camp["competitor_set"] = stated(competitors, "research")
    return {"id": DOC, "version": "3", "facts": [], "findings": [], "decision_chain": {"decisions": []},
            "data": {"campaign": camp}}


class PlayersResearch(FakeResearch):
    """The discovery search returns a page naming the players; every other search a page with one claim."""

    def __init__(self, fail_discovery=False):
        super().__init__()
        self.queries, self.fail_discovery = [], fail_discovery

    def search(self, query, lens, market, entity=None, category=None, max_sources=6, attribution=None):
        self.queries.append(query)
        if query.startswith("Leading brands"):
            if self.fail_discovery:
                from napkin.research import ResearchError
                raise ResearchError("research returned 502")
            return {"sources": [{"id": "p1", "url": "https://www.thegrocer.co.uk/refill-brands", "publisher": "The Grocer",
                                 "title": "Refill brands", "retrieved_at": READ, "published_at": "2026-03-01",
                                 "excerpts": [PLAYERS]}], "trace": {"backend": "fake", "queries": [query]}}
        return {"sources": [{"id": "c1", "url": "https://www.which.co.uk/refill-claims", "publisher": "Which?",
                             "title": "Refill claims", "retrieved_at": READ, "published_at": "2026-03-01",
                             "excerpts": [CLAIM]}], "trace": {"backend": "fake", "queries": [query]}}


def discovery_answer(p):
    sid = p["sources"][0]["source_id"]
    return {"players": [
        {"name": "Smol", "evidence": [{"source_id": sid, "quote": "The leading refill brands are Smol and Method"}]},
        {"name": "Method", "evidence": [{"source_id": sid, "quote": "Smol and Method"}]},
        {"name": "Copperell", "evidence": [{"source_id": sid, "quote": PLAYERS}]},       # the client: never listed
        {"name": "Ecover", "evidence": [{"source_id": sid, "quote": "Ecover leads the market"}]},  # not in the source
    ]}


def extraction(seen):
    def respond(p):
        seen.append(p)
        s = p["sources"][0]
        facts = []
        if p["lens"] == "brands_positioning" and "Smol" in p["comparators"]:
            facts.append({"about": "competitor", "category": None, "competitor": "Smol", "key_suffix": "claim.smol",
                          "value_number": None, "value_text": "refill tablets cut plastic waste",
                          "value_boolean": None, "unit": "text", "as_of": None, "market_specific": True,
                          "evidence": [{"source_id": s["source_id"], "quote": CLAIM}]})
        return {"facts": facts, "not_found": []}
    return respond


def run(store, competitors=None, discover=True, fail_discovery=False):
    seen = []
    model = FakeModel({"discover_players": discovery_answer, "extract_facts": extraction(seen)})
    research = PlayersResearch(fail_discovery=fail_discovery)
    caps = Capabilities(handler="t@1.0", scope=SCOPE, model_port=ModelPort(model, "claude-opus-5", 30),
                        research_port=research, layer_store=store, research_semaphore=threading.Semaphore(4))
    r = Researcher(DOC, "3", clan(competitors), "t@1.0", caps, ["brands_positioning"], ["GB"], [CAT],
                   discover=discover)
    result, change, _ = r.run()
    return result, change, research, model, seen


def test_with_no_comparators_research_finds_the_players_and_proposes_them_on_facts(store):
    result, change, research, model, seen = run(store)
    # the discovery search runs first, without the client's brand, and the lens then searches with the players
    assert research.queries[0].startswith("Leading brands") and "Copperell" not in research.queries[0]
    assert "Comparators: Smol, Method." in research.queries[1]
    assert seen[0]["comparators"] == ["Smol", "Method"]
    # Smol has a fact pinned this run, so it is proposed; Method has none, so it is left out and said
    cs = change["data_patch"]["campaign"]["competitor_set"]
    assert cs["value"] == [{"ref": "brand/smol", "name": "Smol"}]
    assert cs["origin"] == "proposed" and cs["gate"] == "none" and cs["fact_ids"]
    pinned = {f["id"] for f in change["facts_append"]}
    assert set(cs["fact_ids"]) <= pinned
    d = next(x for x in change["decisions"] if x["action"] == "discover_players")
    assert cs["decision"] == d["id"] and d["targets"] == [f"{DOC}#campaign.competitor_set"]
    assert d["rationale"].startswith("Found by research: proposed Smol")
    assert any(p["point"] == "Left out, with no fact found about them: Method" for p in d["reasoning"]["because"])
    assert "comparators found by research: Smol" in result["summary"]
    assert change["read"]["campaign.competitor_set"] is None


def test_the_clients_own_brand_and_an_unquoted_name_are_never_proposed(store):
    _, change, *_ = run(store)
    names = [c["name"] for c in change["data_patch"]["campaign"]["competitor_set"]["value"]]
    assert "Copperell" not in names and "Ecover" not in names


def test_a_named_competitor_set_wins_and_nothing_is_discovered(store):
    _, change, research, model, _ = run(store, competitors=[{"ref": "brand/method", "name": "Method"}])
    assert not any(q.startswith("Leading brands") for q in research.queries)
    assert not any(c[0] == "discover_players" for c in model.calls)
    assert "campaign" not in change["data_patch"]


def test_a_failed_discovery_leaves_the_research_running_as_before(store):
    _, change, research, model, seen = run(store, fail_discovery=True)
    assert research.queries[0].startswith("Leading brands") and len(research.queries) == 2
    assert seen and seen[0]["comparators"] == []
    assert "campaign" not in change["data_patch"]


def test_a_caller_that_does_not_ask_never_discovers(store):
    _, change, research, *_ = run(store, discover=False)
    assert not any(q.startswith("Leading brands") for q in research.queries)
    assert "campaign" not in change["data_patch"]


def test_checked_players_keeps_only_quoted_distinct_names_up_to_the_limit():
    src = {"s": {"sid": "s", "excerpts": ["Brands: Alpha, Beta, Gamma, Delta, Epsilon, Zeta and Alpha again."]}}
    raw = {"players": [{"name": n, "evidence": [{"source_id": "s", "quote": "Alpha, Beta, Gamma, Delta, Epsilon, Zeta"}]}
                       for n in ["Alpha", "alpha", "Beta", "Gamma", "Delta", "Epsilon", "Zeta"]]
           + [{"name": "", "evidence": []}, {"name": "Omega", "evidence": [{"source_id": "x", "quote": "Omega"}]}]}
    out = checked_players(raw, src, "Copperell")
    assert [p["name"] for p in out] == ["Alpha", "Beta", "Gamma", "Delta", "Epsilon"]  # one per brand, at most 5
    assert all(p["ref"].startswith("brand/") and p["quotes"]["s"] for p in out)


def test_a_discovered_brand_ref_matches_the_documents_ref_shape():
    assert brand_ref_of("Smol") == "brand/smol"
    assert brand_ref_of("Method Home & Co.") == "brand/method-home-co"
    assert brand_ref_of("???") is None
