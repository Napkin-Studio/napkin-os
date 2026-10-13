"""Provider request bodies checked against the providers' own published schemas
(tests/fixtures/schemas, made by scripts/refresh_provider_schemas.py)."""

from __future__ import annotations

import json
from functools import lru_cache
from pathlib import Path

from jsonschema import Draft202012Validator

SCHEMAS = Path(__file__).parent / "fixtures" / "schemas"


@lru_cache(maxsize=None)
def _validator(provider: str, name: str) -> Draft202012Validator:
    snap = json.loads((SCHEMAS / provider / f"{name}.json").read_text())
    return Draft202012Validator(snap["schema"])


def schema_name(provider: str, endpoint: str) -> str:
    """'POST /v1/text_to_image' -> its snapshot's file stem."""
    path = endpoint.split(" ", 1)[-1].strip("/")
    return path.replace("/", "__")


def errors(provider: str, endpoint: str, body: dict) -> list[str]:
    v = _validator(provider, schema_name(provider, endpoint))
    return [f"{'/'.join(map(str, e.absolute_path)) or '(body)'}: {e.message[:200]}"
            for e in sorted(v.iter_errors(body), key=str)]
