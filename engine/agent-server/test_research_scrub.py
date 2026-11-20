"""The name scrub before any web search: a brand in brackets, in quotes, possessive, in another case or with diacritics never reaches a
query, and a final gate refuses to send anything that still carries one. Round 3 found 4 of 13 queries carrying a brand that sat in
parentheses in the gist's client field. Invented names only. Run: cd engine/agent-server && python3 -m pytest -q test_research_scrub.py
"""
from __future__ import annotations

import json
import sys
import types
from pathlib import Path

import pytest

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
sys.path.insert(0, str(HERE.parent))
import research  # noqa: E402

GIST = {"client": "Harrow Pet Foods Ltd (Tabbel)", "market": "Ireland", "category": "pet_food",
        "problem": "Tabbel's share is slipping as shoppers trade down", "audience": "Cat owners who buy Tabbel in big supermarkets",
        "objective": "Win back lapsed TABBEL buyers", "competitors": "“Whiskit”, Purrfekt's own label and Félinne"}
BRIEF = {"meta": {"client": "Harrow Pet Foods", "project": "Project Bluebell", "brand": "tabbel"},
         "loop2_golden": {"fields": {
             "insight": {"value": "Owners feel guilty switching away from [Tabbel] when money is tight"},
             "competitors_market": {"value": "The shelf is led by Crunchio and Meowmix, with heavy discounting across most of the large stores."},
             "smp": {"value": "Tabbel: the bowl they come running to"}}}}
STORY = {"insight": {"title": "Owners trade down on price, then feel they let the cat down", "evidence": [{"text": "Felinne grew 12%"}]},
         "audience": {"primary": "Cat owners loyal to 'Tabbel' until the price gap widens"},
         "from_to": {"to": "Switching back to tabbel is a treat for both of you"},
         "proposition": {"rtbs": [{"text": "Crunchio's recipe has less meat"}]}}
BRANDS = ("tabbel", "whiskit", "purrfekt", "felinne", "félinne", "crunchio", "meowmix", "bluebell", "harrow")


def _stub(seen):
    def fake_run(cmd, **kw):
        seen.append(cmd[2])
        return types.SimpleNamespace(returncode=0, stdout=json.dumps({"result": "[]"}))
    return fake_run


def test_a_brand_in_brackets_is_a_name_of_its_own():
    nm = research._names({"client": "Harrow Pet Foods Ltd (Tabbel)"})
    assert "Tabbel" in nm and "Harrow Pet Foods Ltd" in nm and "Pet Foods" not in nm
    assert research.scrub("Harrow Pet Foods Ltd (Tabbel) cat food", nm) == "cat food"
    assert research.scrub("why owners pick (tabbel) over others", nm) == "why owners pick over others"


@pytest.mark.parametrize("text", [
    "Tabbel's owners", "TABBEL owners", "tabbel owners", "owners of [Tabbel]", "owners of {Tabbel}", "owners of “Tabbel”",
    "owners of 'Tabbel'", "owners of \"Tabbel\"", "Tabbels' owners", "Tabbel-branded bowls", "Tabbel’s owners",
])
def test_wrappers_possessives_and_case(text):
    nm = research._names(GIST)
    out = research.scrub(text, nm)
    assert "tabbel" not in out.lower(), out
    assert research.leaks(out, nm) == []


def test_diacritics_match_either_way():
    nm = research._names({"competitors": "Félinne"})
    assert research.scrub("Felinne cat food", nm) == "cat food"
    assert research.scrub("FÉLINNE cat food", nm) == "cat food"
    nm2 = research._names({"competitors": "Felinne"})
    assert research.scrub("Félinne cat food", nm2) == "cat food"


def test_names_come_from_brief_object_fields_too():
    nm = research._names({}, brief_object=BRIEF)
    low = {research._fold(n) for n in nm}
    assert {"tabbel", "harrow pet foods", "crunchio", "meowmix", "project bluebell"} <= low
    assert "most" not in low and "large" not in low and "shelf" not in low   # a paragraph gives only its name-like words


def test_a_market_word_is_never_scrubbed():
    nm = research._names({"client": "Ireland Pet Co (Tabbel)", "market": "Ireland"})
    assert "Ireland" not in nm
    assert research.scrub("Ireland cat owners", nm) == "Ireland cat owners"


def test_the_gate_refuses_a_query_that_still_carries_a_name():
    nm = research._names(GIST)
    with pytest.raises(research.NameLeak) as e:
        research.assert_clean(["ireland cat food", "why (Tabbel) owners switch"], nm)
    assert "tabbel" not in str(e.value).lower()   # the refusal never repeats the name
    research.assert_clean(["ireland cat food statistics"], nm)


def test_the_evidence_track_refuses_to_send_when_a_name_slips_through(monkeypatch):
    seen = []
    monkeypatch.setenv("RESEARCH_WEB", "claude")
    monkeypatch.setattr(research.subprocess, "run", _stub(seen))
    sg = {"market": "Ireland", "category": "pet food"}
    found = research._evidence_track(sg, [{"role": "insight", "claim": "owners of (Tabbel) feel guilty"}],
                                     [{"query": "ireland cat food"}], research._names(GIST))
    assert found == [] and seen == []


def test_no_brand_reaches_any_search_end_to_end(monkeypatch):
    seen = []
    monkeypatch.setenv("RESEARCH_WEB", "claude")
    monkeypatch.setattr(research.subprocess, "run", _stub(seen))
    ev = research.gather_evidence(GIST, BRIEF, STORY)
    research._web_track(GIST)
    assert len(seen) == 2 and ev["queries"]
    sent = research._fold("\n".join(seen + ev["queries"] + [c["claim"] for c in ev["claims"]]))
    for b in BRANDS:
        assert research._fold(b) not in sent, b
    assert "12%" not in sent


# ------------------------------------------------------------------------------------------------ hardening (review of a322bfb5)

def test_a_product_named_only_in_a_claim_never_reaches_the_web(monkeypatch):
    """The blocklist knows the gist's and the brief's name fields; a sub-brand named only in the brief's prose, and from there in a stage b
    claim, is taken out by the allowlist guard (a proper noun that is not the market, a common word or a generic term)."""
    seen = []
    monkeypatch.setenv("RESEARCH_WEB", "claude")
    monkeypatch.setattr(research.subprocess, "run", _stub(seen))
    story = {**STORY, "insight": {"title": "Owners trust Purrline Crunchlets more than the shelf price suggests",
                                  "evidence": [{"text": "QuickNibs sales rose in winter"}]}}
    ev = research.gather_evidence(GIST, BRIEF, story)
    sent = "\n".join(seen + ev["queries"] + [c["claim"] for c in ev["claims"]])
    for w in ("Purrline", "Crunchlets", "QuickNibs"):
        assert w.lower() not in sent.lower(), w
    assert "Ireland" in sent and "Owners trust" in sent   # the market and a capitalised common word stay


def test_the_guard_keeps_the_market_common_words_and_generic_terms():
    g = research.proper_guard("Irish Households in Ireland buy more DIY kits than ZestCo said, per the CSO", "Ireland")
    assert "Ireland" in g and "Irish" in g and "Households" in g and "DIY" in g and "CSO" in g
    assert "ZestCo" not in g
    assert research.proper_guard("Sales of the Velvra range grew", "Ireland") == "Sales of the range grew"
    assert "S.N.A.X" not in research.proper_guard("the S.N.A.X. range", "") and "SNAX" not in research.proper_guard("the S.N.A.X. range", "")


def test_dotted_acronyms_match_either_way():
    nm = research._names({"client": "DIY Depot Ltd"})
    assert research.scrub("why D.I.Y. Depot shoppers return", nm) == "why shoppers return"
    nm2 = research._names({"client": "D.I.Y. Depot"})
    assert research.scrub("why DIY Depot shoppers return", nm2) == "why shoppers return"
    assert research.leaks("D.I.Y. Depot", nm) and research.leaks("diy depot", nm2)


def test_a_short_name_is_blocked_by_its_full_name():
    nm = research._names({"client": "XO Pet Foods"})
    assert "XO" not in nm and "XO Pet Foods" in nm   # under three letters: never a name on its own
    assert research.scrub("XO Pet Foods cat food", nm) == "cat food"
    assert research.scrub("x.o. pet foods cat food", nm) == "cat food"
    with pytest.raises(research.NameLeak):
        research.assert_clean(["why XO Pet Foods owners switch"], nm)
