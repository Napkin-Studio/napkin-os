"""A topic the ask covers is not the brand's category (acceptance A44, 2026-11-24).

Copperell, a cleaning refill, came out as household.laundry_cleaning plus
energy.green_claims ("Green claims and sustainability", an energy leaf), and the
Confirm step and identify's narration showed the raw codes. A topic leaf is kept
only when the ask's other categories are in its own vertical; what the person
reads names categories in words."""

from __future__ import annotations

from napkin.rules import identify as id_rules

from test_from_brief import Host, run_until_settled
from test_no_halt import SCOPE, start

DEC = {"id": "d_TEST0A4401", "kind": "edit", "handler": "t@1.0", "action": "roster_confirmed", "rationale": "r",
       "cites": []}
COPPERELL = "Brand: Copperell Refill\nRefill cleaning sprays in Ireland: what green claims can we make?"


def test_a_topic_leaf_stays_only_with_its_own_vertical():
    pc = id_rules.product_categories
    assert pc(["household.laundry_cleaning", "energy.green_claims"]) == ["household.laundry_cleaning"]
    assert pc(["energy.green_claims", "household.laundry_cleaning"]) == ["household.laundry_cleaning"]
    assert pc(["energy.electricity_gas", "energy.green_claims"]) == ["energy.electricity_gas", "energy.green_claims"]
    assert pc(["energy.green_claims"]) == ["energy.green_claims"], "alone, it is all the ask names"
    assert pc(["automotive.ev_charging", "automotive.hybrid"]) == ["automotive.ev_charging", "automotive.hybrid"]


def test_the_material_offers_the_cleaning_category_not_an_energy_one(store):
    host = Host(COPPERELL)
    job = start(store, host)
    v = run_until_settled(job, host)
    assert v["state"] == "needs_input"
    q = job.question
    assert q["text"].startswith("Which category is it?")
    leaves = [l for o in q["options"] if "value" in o for l in o["value"]]
    assert leaves == ["household.laundry_cleaning"], q["options"]
    assert not any(o["id"] == "both" for o in q["options"])


def test_a_roster_row_with_the_energy_topic_gives_the_cleaning_category_in_words(store):
    layers = store.open(SCOPE)
    s = layers.add_source({"uri": "human:tia@agency", "tier": "reviewer-verified", "domain": "human:tia@agency",
                           "licence": "client-confidential", "title": "confirmed in the chat"})
    layers.set_roster("brand/copperell-refill", "Copperell Refill", ["household.laundry_cleaning",
                                                                     "energy.green_claims"], DEC, [s])
    host = Host(COPPERELL)
    job = start(store, host)
    run_until_settled(job, host)
    cats = host.data["campaign"]["categories"]
    assert cats["value"] == ["household.laundry_cleaning"] and cats["origin"] == "proposed"
    said = [m.get("text") or "" for m in host.data["intake"]["messages"].values() if m.get("role") == "agent"]
    line = next(t for t in said if "Categories from the roster row" in t)
    assert "Laundry and cleaning" in line and "household.laundry_cleaning" not in line and "green" not in line.lower()
    d = next(d for d in host.chain if "campaign.categories" in (d.get("fields_changed") or []))
    assert any("Green claims and sustainability" in r["option"] for r in d["reasoning"]["rejected"])
    pinned = [f for f in host.facts if str(f.get("key", "")).startswith("roster.categories")]
    assert [f["value"] for f in pinned] == ["household.laundry_cleaning"], "the energy topic is not pinned"
