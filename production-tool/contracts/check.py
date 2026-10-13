"""Check the Production Tool contracts: every schema is valid, the capability
sheets and examples match their schemas, and the $refs between files resolve.

    uv run --no-project --with jsonschema python production-tool/contracts/check.py
"""

import json
import re
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
    ("examples/me.response.json", "relay-api.schema.json", "#/$defs/Me"),
    ("examples/projects.response.json", "relay-api.schema.json", "#/$defs/ProjectList"),
    ("examples/director.*.json", "director.schema.json", ""),
    ("examples/customdata.*.json", "customdata.schema.json", ""),
    ("examples/document*.json", "document.schema.json", "")  # document.hackathon.json: fal and HeyGen outputs still open,
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
    if "fallbackOnly" in json.loads(f.read_text()):  # no longer read (features/runway-fallback.clan)
        failures += 1
        print(f"✗ {f.relative_to(HERE)}: fallbackOnly is no longer read; drop it")

# Runway is the only paid provider (features/drop-hackathon-extras.clan): the live config routes
# every op to ['runway'] (or nothing), and no sheet or example names a provider that is gone.
live = json.loads((HERE / "examples" / "config.live.json").read_text())
for op, providers in live["routing"].items():
    if providers not in ([], ["runway"]):
        failures += 1
        print(f"✗ examples/config.live.json: routes {op} to {providers}; the live config routes every op to ['runway']")
GONE = re.compile(r"\b(fal|heygen)\b|fal-ai/", re.I)
for f in sorted([*HERE.glob("capabilities/*.json"), *HERE.glob("examples/config.*.json"), *HERE.glob("examples/director.*.json")]):
    if GONE.search(f.read_text()):
        failures += 1
        print(f"✗ {f.relative_to(HERE)}: names fal or HeyGen, which were removed after the hackathon")

# A pick names a model by provider and model id, so an op's models must be distinct.
for provider, sheet in sheets.items():
    for op, spec in sheet["ops"].items():
        models = [spec["model"]] + [a["model"] for a in spec.get("alternates", [])]
        if len(set(models)) != len(models):
            failures += 1
            print(f"✗ capabilities/{provider}.json: {op} names a model twice in {models}")

sys.exit(1 if failures else 0)
