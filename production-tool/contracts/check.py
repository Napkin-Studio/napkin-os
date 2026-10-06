"""Check the Production Tool contracts: every schema is valid, the capability
sheets and examples match their schemas, and the $refs between files resolve.

    uv run --no-project --with jsonschema python production-tool/contracts/check.py
"""

import json
import sys
from pathlib import Path

from jsonschema import Draft202012Validator, FormatChecker
from referencing import Registry, Resource

HERE = Path(__file__).parent
BASE = "https://napkin.ie/production-tool/contracts/"

schemas = {p.name: json.loads(p.read_text()) for p in HERE.glob("*.schema.json")}
registry = Registry().with_resources(
    (BASE + name, Resource.from_contents(s)) for name, s in schemas.items()
)


def validator(name, pointer=""):
    schema = {"$ref": BASE + name + pointer} if pointer else schemas[name]
    return Draft202012Validator(schema, registry=registry, format_checker=FormatChecker())


# What each instance file must match: (glob, schema file, $defs pointer).
CASES = [
    ("capabilities/*.json", "capabilities.schema.json", ""),
    ("examples/config.*.json", "config.schema.json", ""),
    ("examples/job-request.*.json", "relay-api.schema.json", "#/$defs/JobRequest"),
    ("examples/job.response.json", "relay-api.schema.json", "#/$defs/Job"),
    ("examples/director.*.json", "director.schema.json", ""),
    ("examples/customdata.*.json", "customdata.schema.json", ""),
    ("examples/document.json", "document.schema.json", ""),
]

failures = 0
for name, schema in schemas.items():
    Draft202012Validator.check_schema(schema)
for pattern, name, pointer in CASES:
    files = sorted(HERE.glob(pattern))
    if not files:
        print(f"✗ {pattern}: no files")
        failures += 1
    for f in files:
        errors = sorted(validator(name, pointer).iter_errors(json.loads(f.read_text())), key=str)
        rel = f.relative_to(HERE)
        if errors:
            failures += 1
            print(f"✗ {rel}")
            for e in errors[:5]:
                print(f"    {'/'.join(map(str, e.absolute_path)) or '(root)'}: {e.message[:200]}")
        else:
            print(f"✓ {rel}")

# Every op a sheet claims must be routable, and config must name only known providers.
sheets = {json.loads(p.read_text())["provider"]: json.loads(p.read_text()) for p in (HERE / "capabilities").glob("*.json")}
for f in sorted(HERE.glob("examples/config.*.json")):
    for op, providers in json.loads(f.read_text())["routing"].items():
        for p in providers:
            if op not in sheets.get(p, {}).get("ops", {}):
                failures += 1
                print(f"✗ {f.relative_to(HERE)}: routes {op} to {p}, whose sheet does not support it")

sys.exit(1 if failures else 0)
