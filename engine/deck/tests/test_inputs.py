"""Offline tests for how a Deck document's attached kits are read (deck-look-kits).

Two problems the design found, each with a test that failed before the fix:

1. ``inputs.from_upstream`` took any non-brief upstream entry as the research, so an attached Style Pack
   or Brand Clan was read as research.
2. A Brand Clan attach merges its pins into the document's facts (os-layer 5.7, Contract 6 section 4.2).
   Those pins must never reach a slide as evidence (ADR 0023 as amended by ADR 0027).

Every fixture is invented (Lumen Water). Run from ``engine/``: ``PYTHONPATH=. python3 -m pytest -q deck/tests``.
"""
from __future__ import annotations

from deck import inputs, stages

BRIEF_APP, RESEARCH_APP = "ie.napkin.brief-maker", "ie.napkin.campaign-research"
BRAND_APP, PACK_APP = "ie.napkin.brand", "ie.napkin.style-pack"

#: An invented Brand Clan (the shape of Contract 6 section 3, trimmed): it has a kit block and brand figures.
BRAND = {"kit": {"version": 5}, "brand": {"name": "Lumen"}, "visual": {"colours": [{"id": "c1", "role": "accent", "hex": "0B7A75"}]},
         "voice": {"tone": ["warm"]}, "claims": [{"text": "Lumen is the number one water brand"}]}
PACK = {"pack": {"name": "Demo pack"}, "kit": {"version": 3, "stewards": ["human:demo"]}, "look": ["natural light"]}
RESEARCH = {"campaign": {"name": "Lumen"}}
BRIEF = {"background": "Lumen Water serves a region.", "objectives": {"behavioural": "Cut use by 5%"}}

FACTS = [{"id": "f_1", "entity": "Lumen Water", "key": "customers", "value": 1200, "unit": "count", "confidence": "high"}]
#: A brand figure: it arrives in the deck's facts through the attach, with the brand layer's reference.
BRAND_PIN = {"id": "f_brand1", "entity": "Lumen", "key": "brand.market_share", "value": 0.61, "unit": "proportion",
             "confidence": "high", "ref": "fact://brand/lumen/market_share@1"}
PLAIN_KIT_PIN = {"id": "f_brand2", "entity": "Lumen", "key": "brand.founded", "value": 1984, "unit": "year", "confidence": "high"}
APPS = {"brief-1": BRIEF_APP, "res-1": RESEARCH_APP, "brand-1": BRAND_APP, "pack-1": PACK_APP}


def _data(order: tuple) -> dict:
    full = {"brief-1": BRIEF, "res-1": RESEARCH, "brand-1": BRAND, "pack-1": PACK}
    return {"upstream": {k: full[k] for k in order}}


def test_an_attached_kit_is_never_the_research():
    """Brand Clan and Style Pack attached before the research (and with it): the research id, title and facts stay the research's."""
    for order in (("brief-1", "brand-1", "pack-1", "res-1"), ("pack-1", "brand-1", "res-1"), ("brand-1", "res-1", "pack-1")):
        inp = inputs.from_upstream(_data(order), {"facts": FACTS}, apps=APPS)
        assert inp.research_doc_id == "res-1" and inp.research_title == "Lumen", order
        assert list(inp.facts) == ["f_1"], order
        assert inp.has_brief() is (("brief-1" in order))


def test_a_kit_alone_is_no_research_and_no_brief():
    """Only kits upstream: the deck has neither a brief nor research, so intake asks for them."""
    inp = inputs.from_upstream(_data(("brand-1", "pack-1")), {}, apps=APPS)
    assert not inp.has_brief() and not inp.has_research() and inp.research_doc_id is None
    assert inp.coverage["kits_ignored"] == ["brand-1", "pack-1"]


def test_a_kit_is_recognised_without_the_app_map():
    """Defence in depth: a runner that passes no ``apps`` still does not read a kit (its kit.version block) as research."""
    inp = inputs.from_upstream(_data(("pack-1", "brand-1", "res-1")), {"facts": FACTS})
    assert inp.research_doc_id == "res-1" and not (set(inp.facts) - {"f_1"})
    assert not inputs.from_upstream(_data(("brand-1",)), {}).has_research()


def test_the_app_map_wins_over_the_shape():
    """The app map says what an entry is: a research document that happens to hold a kit block is still the research."""
    odd = {"upstream": {"res-1": {**RESEARCH, "kit": {"version": 1}}}}
    assert inputs.from_upstream(odd, {"facts": FACTS}, apps={"res-1": RESEARCH_APP}).research_doc_id == "res-1"


def test_brand_pins_never_reach_the_deck_as_evidence():
    """A Brand Clan's pins merged into the deck's facts are dropped: the brand layer's reference marks them, a runner-given id list names more."""
    members = {"facts": [*FACTS, BRAND_PIN, PLAIN_KIT_PIN],
               "sources": [{"id": "src_1", "title": "Annual report"}, {"id": "src_brand", "title": "Brand book"}]}
    members["facts"][1] = {**BRAND_PIN, "source": "src_brand"}
    inp = inputs.from_upstream(_data(("res-1", "brand-1")), members, apps=APPS, kit_pins={"f_brand2"})
    assert set(inp.facts) == {"f_1"}
    assert inp.coverage["kit_pins_dropped"] == ["f_brand1", "f_brand2"]
    assert set(inp.sources) == {"src_1"}                       # the brand book backs only a dropped pin
    block = stages._facts_block(inp)
    assert "f_1" in block and "0.61" not in block and "1984" not in block and "f_brand" not in block


def test_brand_pins_are_dropped_with_no_research_at_all():
    """A deck with only a brief and a Brand Clan holds no facts: the brand's figures are not research."""
    inp = inputs.from_upstream(_data(("brief-1", "brand-1")), {"facts": [BRAND_PIN]}, apps=APPS)
    assert inp.facts == {} and not inp.has_research() and inp.coverage["kit_pins_dropped"] == ["f_brand1"]


def test_without_a_kit_nothing_is_dropped_or_stamped():
    """Research and a brief only: the same Inputs as before, and no new coverage keys (golden parity)."""
    inp = inputs.from_upstream(_data(("brief-1", "res-1")), {"facts": FACTS}, apps=APPS)
    assert list(inp.facts) == ["f_1"] and "kits_ignored" not in inp.coverage and "kit_pins_dropped" not in inp.coverage


def test_a_pin_of_the_research_that_only_looks_like_a_brand_one_is_kept_when_no_brand_is_attached():
    """The brand-layer filter acts only when a kit is attached: a deck with no kit keeps every pin it holds."""
    inp = inputs.from_upstream(_data(("res-1",)), {"facts": [BRAND_PIN]}, apps={"res-1": RESEARCH_APP})
    assert list(inp.facts) == ["f_brand1"]
