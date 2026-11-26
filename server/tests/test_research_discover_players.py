"""#303 failed on UAT (2026-11-25, develop cc786b51, doc-ie-napkin-campaign-research-53b2ebb1): a category
question with no comparators named came back with no "found by research" competitors and a gap for
Brands and comparators. The run log showed why:

1. the players' search asked only about the client's roster category ("Leading brands in Laundry and
   cleaning in GB"), never the person's question about refill surface sprays: it found one fabric-care page,
   and on it one fabric softener (Comfort);
2. the brands lens's own search then came back with no source, so nothing was pinned about Comfort, and the
   proposal rule (a player needs a pinned fact) dropped it without a word.

These tests replay that ask with the UAT page as a fixture web result."""

import hashlib
import threading

from napkin.capabilities import Capabilities
from napkin.doc import Material
from napkin.model import ModelPort
from napkin.pipeline.research import Researcher

from fakes import READ, FakeModel, FakeResearch

SCOPE = {"org": "org/test-agency", "brand": "brand/test"}
DOC = "11111111-2222-4333-8444-555555555555"
CAT = "household.laundry_cleaning"
ASK = ("How is the UK household surface-cleaning spray category structured, and where is there room for a new "
       "premium refill brand?")
# the page UAT's players' search found (persistencemarketresearch.com, 2026-11-25), word for word
FABRIC = ("Companies including Unilever plc have responded with dedicated product launches, such as its Comfort "
          "Botanicals and Elixir ranges developed at its Port Sunlight research facility in the U.K., specifically "
          "targeting consumers seeking nature-inspired, premium fragrance profiles beyond traditional laundry scents.")
# what a search led by the person's question finds (a fixture page)
SPRAYS = ("In surface sprays, refill brands Smol and Method compete with Flash and Dettol on shelf.")
SMOL_CLAIM = "Smol says its refill tablets cut single-use plastic from kitchen sprays."


def stated(v, gate):
    return {"value": v, "origin": "stated", "gate": gate, "by": "human:u", "decision": "d_TESTSTATED1"}


def clan():
    camp = {"brand": stated({"ref": "brand/copperell-home", "name": "Copperell Home"}, "created"),
            "categories": stated([CAT], "research"), "markets": stated(["GB"], "research")}
    return {"id": DOC, "version": "3", "facts": [], "findings": [], "decision_chain": {"decisions": []},
            "data": {"campaign": camp}}


def prompt(text):
    sha = "sha256:" + hashlib.sha256(text.encode()).hexdigest()
    return Material("mat_p" + sha[7:17], text, "prompt", "prompt", sha, False)


def page(pid, url, publisher, excerpts):
    return {"id": pid, "url": url, "publisher": publisher, "title": publisher, "retrieved_at": READ,
            "published_at": "2026-03-01", "excerpts": excerpts}


class UatWeb(FakeResearch):
    """The web as UAT saw it: the category search finds the fabric-care page, a search led by the person's
    question finds the sprays page, and the brands lens's own search finds nothing."""

    def __init__(self, sprays=True):
        super().__init__()
        self.queries, self.sprays = [], sprays

    def search(self, query, lens, market, entity=None, category=None, max_sources=6, attribution=None):
        self.queries.append(query)
        if query.startswith(ASK):
            srcs = [page("q1", "https://www.thegrocer.co.uk/surface-sprays", "The Grocer", [SPRAYS, SMOL_CLAIM])] \
                if self.sprays else []
        elif query.startswith("Leading brands in"):
            srcs = [page("c1", "https://www.persistencemarketresearch.com/market-research/uk-fabric-care-market.asp",
                         "Persistence Market Research", [FABRIC])]
        else:
            srcs = []  # UAT: "What each brand claims ... Comparators: Comfort." came back with no source
        return {"sources": srcs, "trace": {"backend": "fake", "queries": [query]}}


def discovery(p):
    """Names the players each page states, quoting it, as the model did on UAT."""
    out = []
    for s in p["sources"]:
        for name in ("Smol", "Method", "Comfort"):
            q = next((x for x in s["excerpts"] if name in x), None)
            if q:
                out.append({"name": name, "evidence": [{"source_id": s["source_id"], "quote": q}]})
    return {"players": out}


def extraction(seen):
    def respond(p):
        seen.append(p)
        facts = []
        for s in p["sources"]:
            if SMOL_CLAIM in s["excerpts"] and "Smol" in p["comparators"]:
                facts.append({"about": "competitor", "category": None, "competitor": "Smol",
                              "key_suffix": "claim.smol", "value_number": None,
                              "value_text": "refill tablets cut single-use plastic", "value_boolean": None,
                              "unit": "text", "as_of": None, "market_specific": True,
                              "evidence": [{"source_id": s["source_id"], "quote": SMOL_CLAIM}]})
        return {"facts": facts, "not_found": []}
    return respond


def run(store, ask=ASK, sprays=True):
    seen = []
    web = UatWeb(sprays=sprays)
    model = FakeModel({"discover_players": discovery, "extract_facts": extraction(seen)})
    caps = Capabilities(handler="t@1.0", scope=SCOPE, model_port=ModelPort(model, "claude-opus-5", 30),
                        research_port=web, layer_store=store, research_semaphore=threading.Semaphore(4))
    result, change, _ = Researcher(DOC, "3", clan(), "t@1.0", caps, ["brands_positioning"], ["GB"], [CAT],
                                   materials=[prompt(ask)] if ask else [], discover=True).run()
    return result, change, web, seen


def test_the_players_search_asks_the_persons_question_first(store):
    _, change, web, _ = run(store)
    assert web.queries[0].startswith(ASK) and len(web.queries[0]) <= 480
    # two players found from the question: the category's own search is not needed
    assert not any(q.startswith("Leading brands in") for q in web.queries)
    assert "Comparators: Smol, Method." in web.queries[1]


def test_the_brands_lens_reads_the_page_the_players_were_found_on_when_its_own_search_is_empty(store):
    _, change, web, seen = run(store)
    brands = [p for p in seen if p["lens"] == "brands_positioning"]
    assert brands and any(s["url"] == "https://www.thegrocer.co.uk/surface-sprays" for s in brands[0]["sources"])
    cs = change["data_patch"]["campaign"]["competitor_set"]
    assert cs["value"] == [{"ref": "brand/smol", "name": "Smol"}] and cs["origin"] == "proposed" and cs["fact_ids"]


def test_a_player_with_nothing_pinned_is_a_named_gap_not_dropped(store):
    _, change, *_ = run(store)
    gaps = change["data_patch"]["selection"]["gaps"]
    method = [g for g in gaps if g["key"] == "brand/method:positioning.claim"]
    assert len(method) == 1 and method[0]["note"].startswith("Found by research as a player in the category")
    assert method[0]["sources_tried"] == ["https://www.thegrocer.co.uk/surface-sprays"]
    d = next(x for x in change["decisions"] if x["action"] == "discover_players")
    assert f"{DOC}#selection.gaps[{method[0]['id']}]" in d["targets"]


def test_uat_exactly_category_only_finds_comfort_and_says_so_instead_of_nothing(store):
    """No sprays page (the web UAT saw): the question's search finds nothing, the category's finds Comfort, the
    brands lens pins nothing. Before the fix the run ended silent; now Comfort is a named gap and a decision."""
    _, change, web, seen = run(store, sprays=False)
    assert web.queries[0].startswith(ASK) and web.queries[1].startswith("Leading brands in")
    assert "campaign" not in change["data_patch"]  # nothing pinned about Comfort: nothing proposed
    gaps = change["data_patch"]["selection"]["gaps"]
    comfort = [g for g in gaps if g["key"] == "brand/comfort:positioning.claim"]
    assert len(comfort) == 1 and "Comfort Botanicals" in comfort[0]["note"]
    d = next(x for x in change["decisions"] if x["action"] == "discover_players")
    assert d["rationale"].startswith("Found by research: Comfort, named in the category")


def test_without_the_persons_words_the_category_is_searched_as_before(store):
    _, _, web, _ = run(store, ask=None, sprays=False)
    assert web.queries[0].startswith("Leading brands in")
