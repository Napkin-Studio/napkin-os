"""Provider request bodies checked against the providers' own published schemas
(tests/fixtures/schemas, made by scripts/refresh_provider_schemas.py)."""

from __future__ import annotations

import json
from functools import lru_cache
from pathlib import Path

from jsonschema import Draft202012Validator

SCHEMAS = Path(__file__).parent / "fixtures" / "schemas"


def _closed(schema: dict) -> dict:
    """fal's input schemas allow unknown fields, and fal ignores them silently, so a misspelt
    field would pass unnoticed. Our bodies may only use fields the provider documents."""
    schema = json.loads(json.dumps(schema))
    target = schema
    ref = schema.get("$ref", "")
    if ref.startswith("#/$defs/"):
        target = schema["$defs"][ref.split("/")[-1]]
    if "properties" in target:
        target.setdefault("additionalProperties", False)
    return schema


@lru_cache(maxsize=None)
def _validator(provider: str, name: str) -> Draft202012Validator:
    snap = json.loads((SCHEMAS / provider / f"{name}.json").read_text())
    return Draft202012Validator(_closed(snap["schema"]) if provider == "fal" else snap["schema"])


def schema_name(provider: str, endpoint: str) -> str:
    """'fal-ai/kling-image/o3/image-to-image' or 'POST /v1/text_to_image' -> its snapshot's file stem."""
    path = endpoint.split(" ", 1)[-1].strip("/")
    return path.replace("/", "__")


def errors(provider: str, endpoint: str, body: dict) -> list[str]:
    v = _validator(provider, schema_name(provider, endpoint))
    return [f"{'/'.join(map(str, e.absolute_path)) or '(body)'}: {e.message[:200]}"
            for e in sorted(v.iter_errors(body), key=str)]
