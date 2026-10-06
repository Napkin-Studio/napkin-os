"""Validation against the locked v1 contracts (production-tool/contracts)."""

from __future__ import annotations

import json
from functools import lru_cache

from jsonschema import Draft202012Validator
from referencing import Registry, Resource

from contracts_dir import contracts_dir

BASE = "https://napkin.ie/production-tool/contracts/"


def _relax(node):
    """Local dev only: accept http:// where the contract says https://."""
    if isinstance(node, dict):
        return {k: ("^https?://" if k == "pattern" and v == "^https://" else _relax(v)) for k, v in node.items()}
    if isinstance(node, list):
        return [_relax(v) for v in node]
    return node


@lru_cache(maxsize=2)
def _registry(relaxed: bool) -> Registry:
    resources = []
    for path in contracts_dir().glob("*.schema.json"):
        schema = json.loads(path.read_text())
        if relaxed:
            schema = _relax(schema)
        resources.append((BASE + path.name, Resource.from_contents(schema)))
    return Registry().with_resources(resources)


@lru_cache(maxsize=64)
def _validator(ref: str, relaxed: bool) -> Draft202012Validator:
    return Draft202012Validator({"$ref": BASE + ref}, registry=_registry(relaxed))


class Contracts:
    """ref examples: 'relay-api.schema.json#/$defs/JobRequest', 'config.schema.json'."""

    def __init__(self, relaxed: bool = False):
        self.relaxed = relaxed

    def errors(self, ref: str, instance) -> list[str]:
        out = []
        for e in sorted(_validator(ref, self.relaxed).iter_errors(instance), key=str)[:5]:
            where = "/".join(map(str, e.absolute_path)) or "(root)"
            out.append(f"{where}: {e.message[:200]}")
        return out


def api(name: str) -> str:
    return f"relay-api.schema.json#/$defs/{name}"
