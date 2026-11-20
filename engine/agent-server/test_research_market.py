"""The market a research query names: always a country or region, never a category, never scrubbed away by a bracketed client field
("Pet Foods (Ireland)"), and the client-name guarantee unchanged. Invented names only. Run: cd engine/agent-server && python3 -m pytest -q test_research_market.py
"""
from __future__ import annotations

import sys
from pathlib import Path

import pytest

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
sys.path.insert(0, str(HERE.parent))
import research  # noqa: E402


def test_a_bracketed_market_in_the_client_field_is_not_a_name():
    gist = {"client": "Pet Foods (Ireland)", "market": "Ireland", "category": "pet food", "problem": "Shoppers in Ireland trade down"}
    nm = research._names(gist)
    assert not any(research._fold(n) == "ireland" for n in nm)
    assert research.sanitise_gist(gist)["market"] == "Ireland"
    assert "Ireland" in research.sanitise_gist(gist)["problem"]


@pytest.mark.parametrize("part", ["Republic of Ireland", "Northern Ireland", "the UK", "Europe", "EU", "Central and Eastern Europe", "Irish"])
def test_a_country_or_region_part_is_never_a_name(part):
    assert research._names({"client": f"Tabbel ({part})"}) == ["Tabbel"]


def test_a_country_word_inside_a_brand_is_exempt_but_the_brand_words_stay_blocked():
    nm = research._names({"client": "Lumen Ireland Ltd", "market": "Pet food"})
    assert "Lumen" in nm and "Lumen Ireland" in nm
    assert not any(research._fold(n) == "ireland" for n in nm)
    assert research.scrub("Lumen Ireland water in Ireland", nm) == "water in Ireland"


def test_a_category_in_the_market_field_yields_the_country():
    assert research.sanitise_gist({"market": "Pet food (Romania)"})["market"] == "Romania"
    assert research.market_of({"market": "Pet food (Romania, Bulgaria)"}) == "Romania, Bulgaria"
    assert research.market_of({"market": "Ireland (a coastal county)"}) == "Ireland"


def test_a_category_only_market_falls_back_to_the_brief_objects_market_or_country():
    brief = {"loop1": {"fields": {"country": {"value": "Ireland"}}}}
    assert research.market_of({"market": "Pet food"}, brief) == "Ireland"
    assert research.sanitise_gist({"market": "Pet food"}, brief_object=brief)["market"] == "Ireland"
    assert research.market_of({"market": ""}, {"meta": {"market": "Germany and Austria"}}) == "Germany, Austria"


def test_nothing_valid_gives_an_empty_market():
    assert research.market_of({"market": "Pet food"}) == ""
    assert research.market_of({"market": "a coastal county"}, {"meta": {"market": "Premium pet food"}}) == ""
    assert research.sanitise_gist({"market": "Pet food"})["market"] == ""


def test_a_client_name_in_the_market_and_problem_fields_is_still_scrubbed():
    gist = {"client": "Tabbel Foods (Ireland)", "market": "Ireland (Tabbel stores)", "problem": "Tabbel loses Irish shoppers"}
    sg = research.sanitise_gist(gist)
    assert sg["market"] == "Ireland"
    assert "tabbel" not in sg["problem"].lower() and "Irish" in sg["problem"]


def test_assert_clean_still_raises_on_a_leaked_brand_name():
    nm = research._names({"client": "Tabbel Foods (Ireland)", "market": "Ireland"})
    research.assert_clean(["Ireland", "cat food"], nm)
    with pytest.raises(research.NameLeak):
        research.assert_clean(["Ireland Tabbel cat food"], nm)
