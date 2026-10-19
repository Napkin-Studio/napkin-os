"""The mock middleware's Brand Clan tasks (brand_identify, brand_seed) from its fixed mock roster:
Lumen Water (drinks.water) and a second brand with "Lumen" in its name, so a typed "Lumen" is
ambiguous. In process: the mock's `handle()` is called directly, no port."""

from __future__ import annotations

import importlib.util
import json
import unittest
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]


def load(name: str, path: Path):
    spec = importlib.util.spec_from_file_location(name, path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


MOCK = load("mock_middleware_server", REPO / "mock-middleware" / "server.py")
SUITE = load("mock_middleware_contract", REPO / "mock-middleware" / "contract_test.py")
BRAND_SCHEMA = json.loads((REPO / "app" / "templates" / "brand" / "schema.json").read_text())
FACTS_SCHEMA = json.loads((REPO / "app" / "templates" / "campaign-research" / "facts.schema.json").read_text())
DOC = "5b0c7e1a-2d4f-4c8b-9e61-7a3f0d2c9b18"


def req(task, inp, app="ie.napkin.brand", data=None, version="1"):
    return {"request_kind": "middleware", "payload": {"task": task, "input": inp},
            "clan": {"id": DOC, "version": version, "app": {"app_id": app, "version": "1"}, "data": data or {},
                     "facts": [], "findings": [], "decision_chain": {"decisions": []}}}


class MockBrandTasks(unittest.TestCase):
    def refused(self, body, status, etype):
        with self.assertRaises(MOCK.TaskError) as e:
            MOCK.handle(body)
        self.assertEqual((e.exception.status, e.exception.etype), (status, etype))
        return e.exception

    def test_identify_ambiguous_then_one_then_none(self):
        out = MOCK.handle(req("brand_identify", {"text": "Lumen"}, app="ie.napkin.brief"))
        names = [c["name"] for c in out["result"]["candidates"]]
        self.assertEqual(sorted(names), ["Lumen Spirits", "Lumen Water"])
        self.assertIsNone(out["change"])
        self.assertIsNone(out["trace"]["model"])
        self.assertEqual(out["trace"]["usage"], {"input_tokens": 0, "output_tokens": 0})
        one = MOCK.handle(req("brand_identify", {"text": "lumen water"}))["result"]["candidates"]
        self.assertEqual(one, [{"ref": "brand/lumen-water", "name": "Lumen Water", "categories": ["drinks.water"],
                                "client_org": "org/lumen-beverages"}])
        self.assertEqual(MOCK.handle(req("brand_identify", {"text": "Nothing Like It"}))["result"]["candidates"], [])

    def test_seed_by_ref_pins_and_proposes(self):
        out = MOCK.handle(req("brand_seed", {"ref": "brand/lumen-water"}))
        ch = out["change"]
        pins = ch["facts_append"]
        self.assertEqual({p["key"] for p in pins}, {"roster.categories.primary", "roster.client_org"})
        self.assertEqual(SUITE.validate({"facts": pins}, FACTS_SCHEMA), [])
        self.assertEqual({s["id"] for s in ch["sources_append"]}, {s for p in pins for s in p["sources"]})
        data = SUITE.merge_patch({}, ch["data_patch"])
        self.assertEqual(SUITE.validate(data, BRAND_SCHEMA), [])
        b = data["brand"]
        self.assertEqual((b["ref"], b["name"]["value"], b["name"]["origin"]), ("brand/lumen-water", "Lumen Water",
                                                                               "proposed"))
        self.assertEqual(b["categories"]["value"], ["drinks.water"])
        self.assertEqual(b["client_org"]["value"], "org/lumen-beverages")
        self.assertEqual(data["kit"], {"version": 1})
        ids = {p["id"] for p in pins}
        for k in ("name", "client_org", "categories"):
            self.assertTrue(set(b[k]["fact_ids"]) <= ids)
        self.assertEqual(out["handler"], "brand_seed@1.0")
        self.assertIsNone(out["trace"]["model"])

    def test_seed_by_name_stated_then_duplicate_and_second_seed_refused(self):
        out = MOCK.handle(req("brand_seed", {"name": "Harbour Tonic Mock", "by": "human:u_aoife"}))
        data = SUITE.merge_patch({}, out["change"]["data_patch"])
        self.assertEqual(SUITE.validate(data, BRAND_SCHEMA), [])
        n = data["brand"]["name"]
        self.assertEqual((n["origin"], n["by"]), ("stated", "human:u_aoife"))
        self.assertEqual(out["change"]["facts_append"], [])
        self.refused(req("brand_seed", {"name": "harbour tonic mock"}), 400, "invalid_input")
        self.refused(req("brand_seed", {"name": "Lumen Water"}), 400, "invalid_input")
        self.refused(req("brand_seed", {"name": "Else"}, data=data, version="2"), 409, "already_seeded")

    def test_seed_by_name_with_categories_teaches_the_roster(self):
        MOCK.handle(req("brand_seed", {"name": "Brook Cider Mock", "categories": ["drinks.cider"]}))
        c = MOCK.handle(req("brand_identify", {"text": "Brook Cider Mock"}))["result"]["candidates"]
        self.assertEqual(c[0]["categories"], ["drinks.cider"])

    def test_refusals(self):
        self.refused(req("brand_seed", {"ref": "brand/lumen-water"}, app="ie.napkin.brief"), 400, "invalid_input")
        self.refused(req("brand_seed", {"ref": "brand/nobody"}), 404, "unknown_brand")
        self.refused(req("brand_identify", {"text": ""}), 400, "invalid_input")


if __name__ == "__main__":
    unittest.main()
