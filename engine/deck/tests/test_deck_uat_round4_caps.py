"""UAT round 4 F25 (Copperell, a fictional brand): the deck never writes a slot the host refuses at Check. One bullets block with nine items
(the brief's objectives and desired response plus requirements r1..r16) became a nine-item list slot, past the host schema's eight."""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from deck import layouts

jsonschema = pytest.importorskip("jsonschema")

HOST = Path(__file__).resolve().parents[3] / "app" / "templates" / "deck-maker" / "schema.json"


def _slot_schema() -> dict:
    s = json.loads(HOST.read_text())
    return s["properties"]["deck"]["properties"]["slides"]["additionalProperties"]["properties"]["slots"]["additionalProperties"]


def _kinds() -> dict:
    return {o["properties"]["kind"]["const"]: o for o in _slot_schema()["oneOf"]}


def test_the_writers_caps_are_the_hosts():
    k = _kinds()
    for kind, cap in layouts.SLOT_ITEMS.items():
        assert k[kind]["properties"]["items"]["maxItems"] == cap, kind
    assert k["table"]["properties"]["rows"]["maxItems"] == layouts.TABLE_ROWS
    assert k["table"]["properties"]["rows"]["items"]["maxItems"] == layouts.TABLE_CELLS


def _lay(kind, blocks):
    return {"slots": {"title": {"kind": "text", "from_blocks": []}, "body": {"kind": kind, "from_blocks": blocks}}}


def _valid(v):
    jsonschema.validate(v, _slot_schema())


def test_one_nine_item_bullets_block_is_a_list_the_host_accepts_and_no_words_are_lost():
    refs = ["brief:objectives.0", "brief:desired_response.0", *[f"req:r{n}" for n in range(1, 17)]]
    items = [{"text": f"Point {n}: refill tablets cut plastic", "refs": [refs[n]]} for n in range(9)]
    slots, unbound = layouts.bind(_lay("list", ["bullets"]), {"title": "How we answer the brief"}, [{"kind": "bullets", "items": items}])
    body = slots["body"]
    assert not unbound and len(body["items"]) == 8
    _valid(body)   # round 4: "is not valid under any of the schemas listed in the 'oneOf' keyword"
    text = " ".join(i["text"] for i in body["items"])
    assert all(f"Point {n}:" in text for n in range(9))
    assert set(refs[:9]) <= set(r for i in body["items"] for r in i.get("refs", []))


def test_merged_blocks_group_stat_and_table_stay_inside_their_caps():
    two = [{"kind": "bullets", "items": [f"a{n}" for n in range(6)]}, {"kind": "bullets", "items": [f"b{n}" for n in range(6)]}]
    g = layouts.bind(_lay("group", ["bullets"]), {"title": "T"}, two)[0]["body"]
    assert len(g["items"]) == 8 and "b5" in g["items"][-1]["text"]
    _valid(g)
    st = layouts.bind(_lay("stat", ["stats"]), {"title": "T"},
                      [{"kind": "stats", "items": [{"value": f"{n}%", "label": f"label {n}"} for n in range(6)]}])[0]["body"]
    assert len(st["items"]) == 4 and "5% label 5" in st["items"][-1]["text"]
    _valid(st)
    tb = layouts.bind(_lay("table", ["table"]), {"title": "T"},
                      [{"kind": "table", "rows": [[f"r{r}c{c}" for c in range(7)] for r in range(10)]}])[0]["body"]
    assert len(tb["rows"]) == 8 and all(len(r) == 5 for r in tb["rows"])
    assert "r9c0" in tb["rows"][-1][0] and "r0c6" in tb["rows"][0][-1]
    _valid(tb)


def test_values_inside_the_caps_are_unchanged():
    v = {"kind": "list", "items": [{"text": "one"}, {"text": "two"}]}
    assert layouts.fit_caps(json.loads(json.dumps(v))) == v
