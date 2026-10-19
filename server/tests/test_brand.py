"""brand_identify and brand_seed (brand-clan.md section 5, middleware-api.md section 12)."""

import copy
import json
from pathlib import Path

import jsonschema
import pytest

from napkin import registry
from napkin.capabilities import Capabilities
from napkin.util import TaskError

REPO = Path(__file__).resolve().parents[2]
BRAND_SCHEMA = json.loads((REPO / "app" / "templates" / "brand" / "schema.json").read_text())
FACTS_SCHEMA = json.loads((REPO / "app" / "templates" / "campaign-research" / "facts.schema.json").read_text())
ORG, OTHER_ORG = "org/dev-agency", "org/other-agency"  # the dev tenant's org (config.py)
DOC = "5b0c7e1a-2d4f-4c8b-9e61-7a3f0d2c9b18"
DEC = {"id": "d_TESTROSTER1", "kind": "edit", "handler": "t@1.0", "action": "t", "rationale": "r", "cites": []}


@pytest.fixture
def mw(server):
    return server.app.state.mw


def layers_of(server, org=ORG):
    return server.layers.service.store.open({"org": org, "brand": "brand/dev-brand"})


def add_brand(server, ref, name, cats=(), org=ORG, client_org=None, quote=None):
    L = layers_of(server, org)
    src = L.add_source({"uri": f"https://example.invalid/{ref}", "tier": "primary", "domain": "example.invalid",
                        "licence": "client-confidential", "title": "roster"})
    L.set_roster(ref, name, list(cats), DEC, [src], client_org)
    if quote:
        L.append({"layer": "brand", "entity": ref, "key": "awareness.prompted", "value": 0.42, "unit": "proportion",
                  "as_of": "2026-01-01", "retrieved_at": "2026-02-01", "sources": [src],
                  "quotes": {src: quote}, "licence": "client-confidential", "method": "report"}, DEC)
    return L


def body(task, inp, app="ie.napkin.brand", data=None, version="1", pipeline=None):
    clan = {"id": DOC, "version": version, "app": {"app_id": app, "version": "1"}, "data": data or {},
            "facts": [], "findings": [], "decision_chain": {"decisions": []}}
    if pipeline is not None:
        clan["pipeline"] = pipeline
    return {"request_kind": "middleware", "payload": {"task": task, "input": inp}, "clan": clan}


def err(mw, b, status, etype):
    with pytest.raises(TaskError) as e:
        mw.handle(b)
    assert (e.value.status, e.value.etype) == (status, etype)
    return e.value


def merged(patch, data=None):
    out = copy.deepcopy(data or {})

    def merge(a, p):
        for k, v in p.items():
            if v is None:
                a.pop(k, None)
            elif isinstance(v, dict):
                a[k] = merge(a.get(k) if isinstance(a.get(k), dict) else {}, v)
            else:
                a[k] = v
        return a
    return merge(out, patch)


def assert_pure(out):
    assert out["trace"]["model"] is None
    assert out["trace"]["usage"] == {"input_tokens": 0, "output_tokens": 0}
    assert out["trace"]["models"] == {}
    assert out["job"]["state"] == "done"


# -- identify ------------------------------------------------------------------------------------
def test_identify_none(server, mw):
    out = mw.handle(body("brand_identify", {"text": "Lumen"}, app="ie.napkin.brief"))
    assert out["change"] is None and out["result"]["candidates"] == []
    assert out["handler"] == "brand_identify@1.0"
    assert_pure(out)


def test_identify_one_then_several_best_first(server, mw):
    add_brand(server, "brand/lumen-water", "Lumen Water", ["soft_drinks.water"], client_org="org/lumen-beverages")
    out = mw.handle(body("brand_identify", {"text": "lumen water"}))
    assert out["result"]["candidates"] == [{"ref": "brand/lumen-water", "name": "Lumen Water",
                                            "categories": ["soft_drinks.water"], "client_org": "org/lumen-beverages"}]
    add_brand(server, "brand/lumen-spirits", "Lumen Spirits", ["alcohol.white_spirits"])
    add_brand(server, "brand/lumen", "Lumen", [])
    out = mw.handle(body("brand_identify", {"text": "Lumen"}))
    names = [c["name"] for c in out["result"]["candidates"]]
    assert names == ["Lumen", "Lumen Water", "Lumen Spirits"]  # exact first, then the shorter name
    assert out["result"]["candidates"][0]["client_org"] is None
    assert_pure(out)


def test_identify_is_capped_at_eight(server, mw):
    for i in range(10):
        add_brand(server, f"brand/lumen-{i}", f"Lumen {i}", [])
    assert len(mw.handle(body("brand_identify", {"text": "Lumen"}))["result"]["candidates"]) == 8


def test_identify_is_scoped_to_the_agency(server, mw):
    add_brand(server, "brand/lumen-water", "Lumen Water", ["soft_drinks.water"], org=OTHER_ORG)
    assert mw.handle(body("brand_identify", {"text": "Lumen"}))["result"]["candidates"] == []
    err(mw, body("brand_seed", {"ref": "brand/lumen-water"}), 404, "unknown_brand")


@pytest.mark.parametrize("inp", [{}, {"text": ""}, {"text": "   "}, {"text": "x" * 201}, {"text": 5}])
def test_identify_input(mw, inp):
    err(mw, body("brand_identify", inp), 400, "invalid_input")


def test_tasks_resolve_whatever_the_pipeline_declares():
    clan = {"pipeline": {"tasks": {}}}  # a Brand Clan declares no task
    for t in ("brand_identify", "brand_seed"):
        assert registry.resolve(t, clan)[0].TASK == t


# -- seed by ref ---------------------------------------------------------------------------------
def test_seed_by_ref_writes_pins_sources_and_proposals(server, mw):
    add_brand(server, "brand/lumen-water", "Lumen Water", ["soft_drinks.water"], client_org="org/lumen-beverages",
              quote="Prompted awareness of Lumen Water is 42%.")
    out = mw.handle(body("brand_seed", {"ref": "brand/lumen-water"}))
    assert_pure(out)
    assert out["handler"] == "brand_seed@1.0"
    ch = out["change"]
    assert ch["doc"] == DOC and ch["base_version"] == "1"
    pins = ch["facts_append"]
    assert {p["key"] for p in pins} == {"roster.categories.primary", "roster.client_org", "awareness.prompted"}
    aw = next(p for p in pins if p["key"] == "awareness.prompted")
    assert list(aw["quotes"].values()) == ["Prompted awareness of Lumen Water is 42%."]  # frozen verbatim
    assert {s["id"] for s in ch["sources_append"]} == {s for p in pins for s in p["sources"]}
    jsonschema.validate({"facts": pins}, FACTS_SCHEMA)
    patch = ch["data_patch"]
    data = merged(patch)
    jsonschema.validate(data, BRAND_SCHEMA)
    b = data["brand"]
    assert b["ref"] == "brand/lumen-water" and data["kit"] == {"version": 1}
    assert b["name"]["value"] == "Lumen Water" and b["name"]["origin"] == "proposed"
    assert b["client_org"]["value"] == "org/lumen-beverages"
    assert b["categories"]["value"] == ["soft_drinks.water"]
    ids = {p["id"] for p in pins}
    for k in ("name", "client_org", "categories"):
        assert set(b[k]["fact_ids"]) <= ids
    cat_pin = next(p for p in pins if p["key"] == "roster.categories.primary")
    assert b["categories"]["fact_ids"] == [cat_pin["id"]]
    decs = {d["id"]: d for d in ch["decisions"]}
    assert all(d["handler"] == "brand_seed@1.0" and d["reasoning"] for d in decs.values())
    assert {p["decision"] for p in pins} <= set(decs) and {b[k]["decision"] for k in ("name", "client_org")} <= set(decs)
    seed = next(d for d in decs.values() if d["action"] == "seed")
    assert ids <= set(seed["cites"])
    cited = {c for p in seed["reasoning"]["because"] for c in p.get("cites", [])}
    assert cited and cited <= ids
    assert set(ch["read"]) == {"brand", "kit"} and all(v is None for v in ch["read"].values())
    assert {h["id"] for h in out["trace"]["hits"]} == ids
    # a repeat of the same request is recognisable: the same decision ids
    again = mw.handle(body("brand_seed", {"ref": "brand/lumen-water"}))
    assert [d["id"] for d in again["change"]["decisions"]] == [d["id"] for d in ch["decisions"]]


def test_seed_by_ref_unknown_and_bad_ref(mw):
    err(mw, body("brand_seed", {"ref": "brand/nobody"}), 404, "unknown_brand")
    err(mw, body("brand_seed", {"ref": "Brand/Nobody"}), 400, "invalid_input")
    err(mw, body("brand_seed", {}), 400, "invalid_input")
    err(mw, body("brand_seed", {"ref": "brand/a", "name": "A"}), 400, "invalid_input")


# -- seed by name --------------------------------------------------------------------------------
def test_seed_by_name_is_stated(server, mw):
    out = mw.handle(body("brand_seed", {"name": "Harbour Tonic", "by": "human:u_aoife"}))
    assert_pure(out)
    ch = out["change"]
    assert ch["facts_append"] == [] and ch["sources_append"] == []
    data = merged(ch["data_patch"])
    jsonschema.validate(data, BRAND_SCHEMA)
    assert data["brand"]["ref"] == "brand/harbour-tonic"
    name = data["brand"]["name"]
    assert name["value"] == "Harbour Tonic" and name["origin"] == "stated" and name["by"] == "human:u_aoife"
    assert name["decision"] == ch["decisions"][0]["id"] and data["kit"] == {"version": 1}
    # the layer learned the name, and no roster row
    L = layers_of(server)
    assert ("brand/harbour-tonic", "Harbour Tonic") in L.find_brands("Harbour")
    assert L.roster("brand/harbour-tonic") is None


def test_seed_by_name_without_a_known_person_says_so(mw):
    out = mw.handle(body("brand_seed", {"name": "Harbour Tonic"}))
    assert merged(out["change"]["data_patch"])["brand"]["name"]["by"] == "human:unknown"


def test_seed_by_name_with_categories_writes_the_roster(server, mw):
    out = mw.handle(body("brand_seed", {"name": "Lumen Water", "categories": ["soft_drinks.water"],
                                        "by": "human:u_aoife"}))
    assert out["change"]["facts_append"] == []
    row = layers_of(server).roster("brand/lumen-water")
    assert row["categories"] == ["soft_drinks.water"] and row["name"] == "Lumen Water"
    # and now the brand is identified with its category
    cands = mw.handle(body("brand_identify", {"text": "Lumen Water"}))["result"]["candidates"]
    assert cands[0]["categories"] == ["soft_drinks.water"]


@pytest.mark.parametrize("cats", [["nope"], ["soft_drinks.water", "soft_drinks.juice_smoothies", "alcohol.cider"],
                                  ["soft_drinks.not_a_leaf"], "soft_drinks.water"])
def test_seed_by_name_bad_categories(mw, cats):
    err(mw, body("brand_seed", {"name": "Zed", "categories": cats}), 400, "invalid_input")


def test_duplicate_name_is_refused_whatever_its_case(server, mw):
    add_brand(server, "brand/lumen-water", "Lumen Water", ["soft_drinks.water"])
    for typed in ("lumen water", "LUMEN WATER", "Lumen  Water!"):
        e = err(mw, body("brand_seed", {"name": typed}), 400, "invalid_input")
        assert "brand/lumen-water" in e.message
    # a different brand that merely contains the name is not a duplicate
    assert mw.handle(body("brand_seed", {"name": "Lumen Water Zero"}))["change"]


def test_a_brand_of_another_agency_is_not_a_duplicate(server, mw):
    add_brand(server, "brand/lumen-water", "Lumen Water", ["soft_drinks.water"], org=OTHER_ORG)
    out = mw.handle(body("brand_seed", {"name": "Lumen Water"}))
    assert merged(out["change"]["data_patch"])["brand"]["ref"] == "brand/lumen-water"


# -- refusals ------------------------------------------------------------------------------------
def test_wrong_app_is_refused(server, mw):
    add_brand(server, "brand/lumen-water", "Lumen Water", ["soft_drinks.water"])
    for app in ("ie.napkin.brief", "campaign-research"):
        err(mw, body("brand_seed", {"ref": "brand/lumen-water"}, app=app), 400, "invalid_input")
    b = body("brand_seed", {"name": "X"})
    del b["clan"]["app"]
    err(mw, b, 400, "invalid_input")


def test_second_seed_is_refused_and_writes_nothing(server, mw):
    add_brand(server, "brand/lumen-water", "Lumen Water", ["soft_drinks.water"])
    first = mw.handle(body("brand_seed", {"ref": "brand/lumen-water"}))
    data = merged(first["change"]["data_patch"])
    before = layers_of(server).find_brands("")
    for inp in ({"ref": "brand/lumen-water"}, {"name": "Another Brand"}):
        err(mw, body("brand_seed", inp, data=data, version="2"), 409, "already_seeded")
    assert layers_of(server).find_brands("Another") == [] and before == layers_of(server).find_brands("")


def test_scope_in_the_request_is_refused(mw):
    err(mw, body("brand_identify", {"text": "x", "org": "org/other"}), 400, "invalid_input")


# -- no model, no research, structurally ---------------------------------------------------------
def test_the_handlers_get_a_view_with_no_model_research_or_retrieval(server, mw, monkeypatch):
    seen = []
    for t in ("brand_identify", "brand_seed"):
        mod = registry.REGISTRY[t][1]
        real = mod.run

        def spy(req, view, real=real):
            seen.append(view)
            return real(req, view)
        monkeypatch.setattr(mod, "run", spy)
    add_brand(server, "brand/lumen-water", "Lumen Water", ["soft_drinks.water"])
    mw.handle(body("brand_identify", {"text": "Lumen"}))
    mw.handle(body("brand_seed", {"ref": "brand/lumen-water"}))
    assert len(seen) == 2
    for view in seen:
        assert not isinstance(view, Capabilities)
        have = set(dir(view))
        assert not have & {"model", "research", "retrieval", "jev", "usage", "runlog"}
        assert hasattr(view, "layers")
        with pytest.raises(AttributeError):
            view.model
        with pytest.raises(AttributeError):
            view.research
        assert not hasattr(view, "__dict__")  # slots: nothing can be attached behind the type


def test_nothing_the_middleware_would_call_a_model_with_is_called(server, mw):
    add_brand(server, "brand/lumen-water", "Lumen Water", ["soft_drinks.water"])
    mw.handle(body("brand_identify", {"text": "Lumen"}))
    mw.handle(body("brand_seed", {"ref": "brand/lumen-water"}))
    mw.handle(body("brand_seed", {"name": "Zed"}))
    assert server.model.calls == []
    assert getattr(server.research, "calls", []) == []
