"""The client category of a brief, from the planner's category leaf (features/award-in-brief-maker).

The planner picks a leaf of the layers category tree (`<vertical>.<leaf>`, 109 leaves,
docs/contracts/peripherals/taxonomy.json). The award case library is filtered and gated by the
engine's closed *client* category (18 values, engine/schema/rag_metadata.v1.json, signed off by a
creative director on 2026-09-17). The two are different taxonomies, so this file maps one to the
other, once, in the open.

A leaf is in exactly one of three places:

  CLEAR    the engine's creative-director rulings (engine/schema/REVIEW-cannes-categories.md) or
           plain common sense settle it. It maps, and a brief in it may be offered library cases.
  REVIEW   a real judgement call. It maps to NOTHING until a person decides, so the library stays
           out (the gate fails closed). The proposed category and the argument are kept here for
           the reviewer; moving a leaf to CLEAR is the whole review.
  NONE     the engine has no client category for it. Nothing is offered.

Rules the CLEAR rows follow (the rulings, so they are not re-argued here):
  - fmcg is household, personal care and pet; food_drink is what people eat and drink, including
    QSR and food delivery; alcohol stays apart; technology means the product IS the technology.
  - Travel includes the operators (Indian Railways); media_entertainment includes sport and events.
  - `other` is never a target: it must stay near-empty.
"""
from __future__ import annotations

CLIENT_CATEGORIES = (
    "fmcg", "food_drink", "alcohol", "financial_services", "retail", "luxury", "automotive", "technology",
    "b2b", "telecoms", "travel", "public_sector", "charity", "healthcare", "media_entertainment",
    "gambling_betting", "fashion_beauty", "other",
)


def _all(vertical: str, leaves: str, category: str) -> dict:
    return {f"{vertical}.{leaf}": category for leaf in leaves.split()}


CLEAR: dict[str, str] = {
    **_all("automotive", "mass_market ev_charging hybrid used_dealer aftermarket commercial", "automotive"),
    **_all("alcohol", "beer_stout cider irish_whiskey white_spirits wine rtd_seltzer", "alcohol"),
    **_all("soft_drinks", "carbonates energy_drinks water juice_smoothies tea_coffee milks", "food_drink"),
    **_all("food", "snacks_confectionery dairy meat_plant_based ready_meals_frozen bakery_cereals", "food_drink"),
    "food.pet_food": "fmcg",                                    # Pedigree ruling: pet food has FMCG economics
    **_all("household", "laundry_cleaning paper_tissue oral_care deodorant_shaving feminine_incontinence", "fmcg"),
    **_all("beauty_fashion", "cosmetics_fragrance high_street_fashion sportswear", "fashion_beauty"),
    "beauty_fashion.luxury_designer": "luxury",
    **_all("retail", "grocery_multiples discounters convenience_forecourt department_stores diy_home ecommerce", "retail"),
    **_all("qsr", "fast_food coffee_chains casual_dining delivery_platforms", "food_drink"),   # Uber Eats ruling
    **_all("finance", "banking cards_payments mortgages motor_home_insurance life_health_protection "
                      "pensions_investments fintech_crypto", "financial_services"),
    **_all("telco", "mobile_networks broadband_home tv_bundles mvnos", "telecoms"),
    **_all("technology", "smartphones_wearables home_electronics computing smart_home", "technology"),
    **_all("software", "consumer_apps ai_products", "technology"),
    **_all("media", "streaming_broadcast publishing_news music_audio cinema_film live_events sport_sponsorship",
           "media_entertainment"),                              # Paris 2024 ruling: a spectacle is media_entertainment
    **_all("travel", "airlines tourism_destinations hotels_otas ferries_rail_coach cruise_packages", "travel"),
    **_all("health", "otc_medicines hospitals_clinics medical_devices_hearing prescription", "healthcare"),
    "public.government_agencies": "public_sector",
    "public.political_referenda": "public_sector",
    "public.charities_ngos": "charity",
    "public.betting_gaming": "gambling_betting",
}

# leaf -> (proposed category, why it is a judgement call). Maps to nothing until moved to CLEAR.
REVIEW: dict[str, tuple[str, str]] = {
    "automotive.premium_luxury": ("automotive", "a premium car is a car, but luxury behaves as its own category (scarcity, no price)"),
    "automotive.finance_leasing": ("financial_services", "the product is finance, the buyer is a car buyer"),
    "alcohol.low_no": ("alcohol", "0.0% brands carry the regulator's rules in some markets and not in others"),
    "food.baby_infant": ("food_drink", "infant food is eaten, but baby brands sit in fmcg elsewhere (Johnson's Baby, Pampers)"),
    "household.skincare_body": ("fmcg", "the hair and skin pattern: Dove and Pantene are fmcg in the corpus, Garnier and Olay fashion_beauty"),
    "household.haircare": ("fashion_beauty", "Laurence ruled Sunsilk Pakistan and Vatika Hair Oils fashion_beauty (2 Nov); Pantene and Head & Shoulders are still fmcg"),
    "beauty_fashion.jewellery_watches": ("luxury", "luxury only when the brand is; a high street jeweller is retail or fashion"),
    "beauty_fashion.aesthetic_procedures": ("healthcare", "a clinic's work, sold as beauty"),
    "retail.retail_media": ("retail", "an advertising product sold by a retailer: could read as b2b"),
    "telco.handsets_devices": ("technology", "the product is a device; the seller is often a network"),
    "telco.b2b_connectivity": ("b2b", "agencies brief b2b as if it were a sector, but the contract calls it not a sector"),
    "technology.gaming": ("technology", "consoles are technology, titles are media_entertainment"),
    "software.b2b_saas": ("b2b", "b2b is not a sector in the contract; confirm the creative director wants it used this way"),
    "software.developer_infra": ("b2b", "b2b is not a sector in the contract; the same question as software.b2b_saas"),
    "software.cybersecurity": ("b2b", "as software.b2b_saas; consumer cyber brands exist"),
    "travel.travel_insurance_fx": ("financial_services", "insurance and money, sold to travellers"),
    "health.vitamins_supplements": ("healthcare", "could be fmcg or food_drink by the pack-and-penetration logic"),
    "health.private_health_insurance": ("financial_services", "insurance, about health"),
    "health.public_health": ("public_sector", "or charity, depending on who pays"),
    "home_property.furniture_homeware": ("retail", "a shop, but also a household product"),
    "home_property.building_materials": ("b2b", "trade buyers; as the other b2b leaves"),
    "home_property.agri_rural": ("b2b", "trade buyers; as the other b2b leaves"),
    "public.universities_colleges": ("public_sector", "there is no Education value yet (a pending creative-director item)"),
    "public.recruitment_employer": ("b2b", "an employer brand is a business selling to people, not products"),
}

# The engine has no client category for these, so nothing is offered.
NONE: dict[str, str] = {
    "energy.electricity_gas": "utilities have no client category",
    "energy.solar_retrofit": "utilities have no client category",
    "energy.ev_charging_networks": "utilities have no client category",
    "energy.green_claims": "utilities have no client category",
    "home_property.developers_agents": "property has no client category",
    "home_property.property_portals": "property has no client category",
}


def client_category(leaf: str | None) -> str | None:
    """The client category for a planner leaf, or None when the library must stay out: no leaf, an
    unknown leaf, a leaf under review, or one the engine has no category for."""
    return CLEAR.get(leaf) if isinstance(leaf, str) else None


def plan_category(plan: dict | None) -> str | None:
    """The client category for a planner's output (its `category` is a layers leaf code)."""
    return client_category((plan or {}).get("category") if isinstance(plan, dict) else None)
