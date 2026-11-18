"""The Style Pack template's example is valid against its schema and reads through the shared reader."""
from __future__ import annotations

import json
from pathlib import Path

import pytest
import yaml

from visuals import style

TPL = Path(__file__).parents[3] / "app" / "templates" / "style-pack"


def _example():
    data = yaml.safe_load((TPL / "example" / "data.yaml").read_text())
    assets = {}
    for f in (TPL / "example" / "assets").iterdir():
        b = f.read_bytes()
        assets[f"human/assets/style/{__import__('hashlib').sha256(b).hexdigest()}.png"] = b
    return data, assets


def test_the_example_pack_reads_and_sends_only_what_it_may():
    data, assets = _example()
    st = style.load(data, assets)
    assert [r.name for r in style.sendable(st)] == ["demo-cool.png", "demo-warm.png"]
    assert st.withheld[0]["name"] == "demo-client.png" and st.withheld[0]["rights"] == "client_supplied"
    assert st.deck == {} and st.models == style.DEFAULT_MODELS and st.warnings == []


def test_the_example_validates_against_the_schema():
    jsonschema = pytest.importorskip("jsonschema")
    data, _ = _example()
    schema = json.loads((TPL / "schema.json").read_text())
    jsonschema.validate(data, schema)
    bad = {**data, "models": {"hero": "some_other_model"}}
    with pytest.raises(jsonschema.ValidationError):
        jsonschema.validate(bad, schema)
    with pytest.raises(jsonschema.ValidationError):
        jsonschema.validate({**data, "guard_rails": "off"}, schema)


def test_the_schema_vocabulary_equals_the_reader():
    schema = json.loads((TPL / "schema.json").read_text())["properties"]
    assert tuple(schema["references"]["additionalProperties"]["properties"]["rights"]["enum"]) == style.RIGHTS
    assert tuple(schema["models"]["properties"]["draft"]["enum"]) == style.MODEL_IDS
    assert tuple(schema["models"]["properties"]) == tuple(style.DEFAULT_MODELS)
    assert tuple(schema["finish"]["enum"]) == tuple(sorted(style.FINISHES, reverse=True)) or set(schema["finish"]["enum"]) == set(style.FINISHES)
    assert set(schema) - {"pack", "kit"} == set(style.KNOWN_KEYS) | set(style.EXTRA_KEYS)
