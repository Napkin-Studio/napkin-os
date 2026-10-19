"""docs/production-tool/provider-reference.md is generated from the capability sheets and the
providers' schema snapshots (features/provider-reference.clan): it must match what they say now."""

import importlib.util
from pathlib import Path

SCRIPT = Path(__file__).parents[1] / "scripts" / "provider_reference.py"


def _module():
    spec = importlib.util.spec_from_file_location("provider_reference", SCRIPT)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_the_provider_reference_is_up_to_date():
    ref = _module()
    assert ref.OUT.read_text() == ref.render(), (
        "docs/production-tool/provider-reference.md is out of date: run "
        "`uv run --frozen --python 3.12 python scripts/provider_reference.py` in production-tool/relay")


def test_every_model_on_a_sheet_has_a_schema_snapshot():
    ref = _module()
    for provider, sheet in ref._sheets().items():
        for spec in sheet["ops"].values():
            for m in [spec, *spec.get("alternates", [])]:
                assert ref._snapshot(provider, m["endpoint"]) is not None, (provider, m["endpoint"])
