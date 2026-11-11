"""The Brief Maker and the award case library (features/award-in-brief-maker, slice 3):
the planner's layers leaf -> a client category, and the drafters' request for a gated pack.

No network and no model: the retrieval capability is a stub that records every request.
"""
from __future__ import annotations

import json
from pathlib import Path

import pytest

from napkin.brief import clientcat
from napkin.brief.drafters import DraftContext
from napkin.retrieval import passage_id, passage_uri

import hashlib

REPO = Path(__file__).resolve().parents[2]


# ---- the mapping --------------------------------------------------------------------------------
def taxonomy_leaves() -> set[str]:
    tax = json.loads((REPO / "docs/contracts/peripherals/taxonomy.json").read_text())
    return {f"{v['code']}.{leaf['code']}" for v in tax["verticals"] for leaf in v["leaves"]}


def engine_categories() -> list[str]:
    schema = json.loads((REPO / "engine/schema/rag_metadata.v1.json").read_text())

    def find(o):
        if isinstance(o, dict):
            if o.get("type") == "enum" and "gambling_betting" in (o.get("values") or []):
                return o["values"]
            for v in o.values():
                got = find(v)
                if got:
                    return got
        if isinstance(o, list):
            for v in o:
                got = find(v)
                if got:
                    return got
    return find(schema)


def test_every_leaf_of_the_category_tree_is_in_exactly_one_place():
    leaves = taxonomy_leaves()
    clear, review, none = set(clientcat.CLEAR), set(clientcat.REVIEW), set(clientcat.NONE)
    assert leaves == clear | review | none                      # nothing missing, nothing misspelt
    assert not (clear & review or clear & none or review & none)


def test_the_mapping_only_uses_the_engines_closed_category_list():
    cats = engine_categories()
    assert tuple(cats) == clientcat.CLIENT_CATEGORIES            # the copy here cannot drift from the contract
    assert set(clientcat.CLEAR.values()) <= set(cats)
    assert {p for p, _ in clientcat.REVIEW.values()} <= set(cats)
    assert "other" not in clientcat.CLEAR.values()               # `other` must stay near-empty


def test_a_review_leaf_offers_nothing_until_a_person_decides():
    for leaf in clientcat.REVIEW:
        assert clientcat.client_category(leaf) is None
    for leaf in clientcat.NONE:
        assert clientcat.client_category(leaf) is None


def test_clear_leaves_map_and_anything_else_is_none():
    assert clientcat.client_category("alcohol.irish_whiskey") == "alcohol"
    assert clientcat.client_category("qsr.delivery_platforms") == "food_drink"      # the Uber Eats ruling
    assert clientcat.client_category("food.pet_food") == "fmcg"                      # the Pedigree ruling
    assert clientcat.client_category("beauty_fashion.luxury_designer") == "luxury"
    for bad in (None, "", "no.such_leaf", 7, ["alcohol.wine"], {"a": 1}):
        assert clientcat.client_category(bad) is None


def test_the_planners_output_is_read_safely():
    assert clientcat.plan_category({"category": "software.consumer_apps"}) == "technology"
    for plan in (None, {}, {"category": None}, {"category": "software.b2b_saas"}, "not a dict", []):
        assert clientcat.plan_category(plan) is None


def test_the_review_list_is_what_it_says_it_is():
    """A reviewer needs the question, not only the answer: every row says why."""
    assert all(len(why) > 20 for _, why in clientcat.REVIEW.values())
    assert len(clientcat.CLEAR) + len(clientcat.REVIEW) + len(clientcat.NONE) == 109


# ---- the drafters' requests ---------------------------------------------------------------------
def _passage(pack, source, text):
    sha = hashlib.sha256(text.encode()).hexdigest()
    return {"id": passage_id(pack, source, "s", text), "uri": passage_uri(pack, source, "s", sha), "pack": pack,
            "scope": "house", "licence": "licensed-internal", "source": source, "section": "s",
            "citation": f"{source} › s", "text": text, "text_sha256": sha}


PACKS = [
    {"tag": "playbook", "id": "playbooks", "kind": "playbook", "k": 2, "loops": []},
    {"tag": "ipa", "id": "ipa", "kind": "case", "k": 2, "loops": ["loop4_insight", "loop6_substantiation"]},
    {"tag": "cannes", "id": "cannes", "kind": "case", "k": 2, "loops": ["loop4_insight", "loop6_substantiation"]},
    {"tag": "awardlib", "id": "awardlib", "kind": "case", "k": 2, "loops": ["loop4_insight"], "gated": True,
     "filterable": ["category"]},
]


class StubRetrieval:
    configured = True

    def __init__(self, packs=PACKS):
        self._packs, self.calls = packs, []

    def packs(self):
        return [dict(p) for p in self._packs]

    def retrieve(self, query, k, packs=None, where=None, purpose=None):
        self.calls.append({"q": query, "k": k, "packs": list(packs or []), "where": where, "purpose": purpose})
        out = [_passage(t, f"{t}-src", f"{t} passage about {query[:12]}") for t in (packs or [])]
        return {"passages": out, "trace": {"backend": "stub", "packs": {t: "sha256:" + t for t in (packs or [])}}}


class Caps:
    scope = {"org": "org/test", "brand": "b"}

    def __init__(self, retrieval):
        self.retrieval = retrieval


def ctx(category, retrieval=None):
    r = retrieval or StubRetrieval()
    return DraftContext(Caps(r), {}, {}, {}, category=category), r


def ask(c, loop):
    return c.retrieve(loop, "find the human insight", "award-winning precedent insight")


def test_a_brief_with_no_category_never_asks_the_gated_pack():
    c, r = ctx(None)
    out, notes = ask(c, "loop4_insight")
    assert not [x for x in r.calls if "awardlib" in x["packs"]]
    assert {p["pack"] for p in out.values()} == {"ipa", "cannes", "playbook"}
    assert all(x["where"] is None for x in r.calls)


def test_insight_asks_the_library_once_with_the_category_as_its_own_request():
    c, r = ctx("technology")
    out, _ = ask(c, "loop4_insight")
    lib = [x for x in r.calls if "awardlib" in x["packs"]]
    assert len(lib) == 1 and lib[0]["packs"] == ["awardlib"] and lib[0]["where"] == {"category": "technology"}
    assert lib[0]["k"] == 2 and lib[0]["purpose"] == "loop4_insight"
    assert "awardlib" in {p["pack"] for p in out.values()}


def test_no_other_packs_request_changes_when_a_category_is_present():
    with_cat, r1 = ctx("technology")
    without, r2 = ctx(None)
    ask(with_cat, "loop4_insight")
    ask(without, "loop4_insight")
    others = lambda r: [x for x in r.calls if "awardlib" not in x["packs"]]
    assert others(r1) == others(r2)                              # same queries, k, packs, where=None


@pytest.mark.parametrize("loop", ["loop5_proposition", "loop6_substantiation", "loop7_qa", "loop3_research"])
def test_the_library_is_not_asked_outside_the_insight_loop(loop):
    c, r = ctx("technology")
    ask(c, loop)
    assert not [x for x in r.calls if "awardlib" in x["packs"]]


def test_a_service_that_does_not_list_the_pack_gets_no_library_request():
    """Flag off: the service hides the pack, so the Brief Maker never learns of it."""
    c, r = ctx("technology", StubRetrieval([p for p in PACKS if p["tag"] != "awardlib"]))
    out, _ = ask(c, "loop4_insight")
    assert not [x for x in r.calls if "awardlib" in x["packs"]]
    assert "awardlib" not in {p["pack"] for p in out.values()}


def test_an_old_pack_list_without_the_gated_flag_is_asked_as_before():
    """A service that predates the marker lists awardlib like any case pack: no category is sent, as today."""
    old = [{k: v for k, v in p.items() if k not in ("gated", "filterable")} for p in PACKS]
    c, r = ctx("technology", StubRetrieval(old))
    ask(c, "loop4_insight")
    lib = [x for x in r.calls if "awardlib" in x["packs"]]
    assert len(lib) == 1 and lib[0]["where"] is None


# ---- the planned flow: the default draft_brief -----------------------------------------------------
# The planned flow fetches the library's passages once at the start of the context stage, before the
# planner has named a category, so the category cannot reach that lookup. These tests drive the real job
# and check the lookup that runs after the plan.
import json as _json  # noqa: E402
from types import SimpleNamespace  # noqa: E402

import httpx  # noqa: E402

from conftest import Server  # noqa: E402
from fakes import FakeRetrievalService, _passage as fake_passage  # noqa: E402
from napkin.brief.planned import PlannedBriefJob  # noqa: E402
from test_brief import Host, retrieval as retrieval_port, run as run_job  # noqa: E402
from test_planned_brief import THIN, planned_model  # noqa: E402


class GatedService(FakeRetrievalService):
    """The fake retrieval service plus a gated `awardlib` pack that answers only a request that names a
    category. `listed=False` is the service with the flag off: the pack is not in /v1/packs."""

    def __init__(self, listed=True, **kw):
        super().__init__(**kw)
        self.listed, self.gated_asks = listed, []

    def packs_list(self):
        packs = super().packs_list()
        if self.listed:
            packs.append({"tag": "awardlib", "id": "awardlib", "kind": "case", "scope": "house",
                          "licence": "licensed-internal", "k": 2, "loops": ["loop4_insight"], "passages": 1,
                          "filterable": ["category"], "gated": True,
                          "version": "sha256:" + hashlib.sha256(b"awardlib").hexdigest()[:16]})
        return packs

    def __call__(self, request):
        if request.url.path == "/v1/retrieve":
            body = _json.loads(request.content)
            if body.get("packs") == ["awardlib"]:
                self.gated_asks.append(body)
                cat = (body.get("where") or {}).get("category")
                ps = [fake_passage("awardlib", "Award case library", "Spotify — Daylist (2024)",
                                   "Daylist: music changes with the time of day.", 1, body["k"])] if cat else []
                return httpx.Response(200, json={"passages": ps, "trace": {"backend": "fake", "embed_model": None,
                                                                          "packs": {"awardlib": self.packs_list()[-1]["version"]}}})
        return super().__call__(request)


def planned_run(tmp_path, svc, plan_leaf=None):
    seen = {}
    m = planned_model(seen)
    if plan_leaf:
        original = m.overrides["plan_brief"]
        m.overrides["plan_brief"] = lambda p: {**original(p), "category": plan_leaf}
    s = Server(tmp_path, model=m, retrieval=retrieval_port(svc),
               settings_kw={"brief_flow": "planned", "brief_research_max": 2})
    try:
        replies = run_job(s, Host(), inp={"prompt": THIN, "attachments": []})
    finally:
        s.stop()
    assert replies[-1]["job"]["state"] == "done"
    return seen


def lib_ids(payload):
    return [x["id"] for x in payload["library"]]


def test_the_planned_flow_asks_the_library_once_after_the_plan_names_a_category(tmp_path):
    svc = GatedService()
    seen = planned_run(tmp_path, svc)
    leaf = seen["plan"]["categories"][0]["code"]
    assert clientcat.client_category(leaf), f"the fake tree's first leaf, {leaf}, should map for this test"
    assert len(svc.gated_asks) == 1                                         # one request, not one per loop
    ask = svc.gated_asks[0]
    assert ask["where"] == {"category": clientcat.client_category(leaf)} and ask["k"] == 2
    assert ask["purpose"] == "loop4_insight"
    lib = [x for x in seen["draft"]["library"] if x["citation"].startswith("Award case library")]
    assert len(lib) == 1, "the Brief agent is given the library's precedent"
    assert not [x for x in seen["plan"]["library"] if x["citation"].startswith("Award case library")], \
        "the plan was made before the category was known, so it did not see it"
    assert lib[0]["id"] not in lib_ids(seen["plan"])


def test_the_planned_flow_without_the_gated_pack_is_unchanged(tmp_path):
    svc = GatedService(listed=False)
    seen = planned_run(tmp_path, svc)
    assert svc.gated_asks == []
    assert not [x for x in seen["draft"]["library"] if "Award case library" in x["citation"]]


def test_a_leaf_held_for_review_asks_for_nothing(tmp_path):
    svc = GatedService()
    leaf = "software.b2b_saas"
    seen = planned_run(tmp_path, svc, plan_leaf=leaf)
    if leaf not in [c["code"] for c in seen["plan"]["categories"]]:
        pytest.skip("the fake tree does not offer the leaf")
    assert clientcat.client_category(leaf) is None and svc.gated_asks == []


def test_the_library_keeps_its_places_when_dara_is_given_a_capped_list():
    ns = SimpleNamespace(lib={f"psg_{i:02d}": {"citation": f"c{i}", "text": "t"} for i in range(20)})
    ns.lib["psg_g1"], ns.lib["psg_g2"] = {"citation": "g1", "text": "t"}, {"citation": "g2", "text": "t"}
    ns.lib_gated = {"psg_g1", "psg_g2"}
    got = [x["id"] for x in PlannedBriefJob._library(ns, 12)]
    assert len(got) == 12 and got[-2:] == ["psg_g1", "psg_g2"]             # kept, though they arrived last
    assert got[:10] == [f"psg_{i:02d}" for i in range(10)]                  # the rest fill what is left, in order
    ns.lib_gated = set()
    assert [x["id"] for x in PlannedBriefJob._library(ns, 12)] == [f"psg_{i:02d}" for i in range(12)]   # no gated: as before
