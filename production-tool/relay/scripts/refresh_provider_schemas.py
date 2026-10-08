#!/usr/bin/env python3
"""Snapshot each provider's published request schema, so the pathway tests hold our request
bodies to what the provider says it accepts (features/harness-pathways.clan).

    uv run --frozen --python 3.12 python scripts/refresh_provider_schemas.py          write the snapshots
    uv run --frozen --python 3.12 python scripts/refresh_provider_schemas.py --check  diff, write nothing

- fal: every endpoint named in contracts/capabilities/fal.json (ops, alternates, regionEndpoint)
  plus SAM2, from fal's per-endpoint OpenAPI, bundled into one self-contained JSON Schema each.
- Runway: the POST bodies we send, from docs.dev.runwayml.com/openapi.json (one oneOf branch
  per model).
- HeyGen: publishes no OpenAPI file, so its schema is written here from
  developers.heygen.com/reference/create-heygen-video (read 2026-10-08). Update it by hand.

Files land in tests/fixtures/schemas/<provider>/ with their source URL and fetch date. Nothing
here needs a key: these are public documentation.
"""

from __future__ import annotations

import argparse
import datetime as dt
import json
import sys
import urllib.request
from pathlib import Path

HERE = Path(__file__).resolve().parent
RELAY = HERE.parent
sys.path.insert(0, str(RELAY))
from contracts_dir import contracts_dir  # noqa: E402
from providers.fal import SAM2  # noqa: E402

OUT = RELAY / "tests" / "fixtures" / "schemas"
FAL_OPENAPI = "https://fal.ai/api/openapi/queue/openapi.json?endpoint_id={}"
RUNWAY_OPENAPI = "https://docs.dev.runwayml.com/openapi.json"
RUNWAY_PATHS = ("/v1/text_to_image", "/v1/image_to_video", "/v1/video_to_video")
HEYGEN_SOURCE = "https://developers.heygen.com/reference/create-heygen-video"

_ASSET = {"oneOf": [
    {"type": "object", "properties": {"type": {"const": "url"}, "url": {"type": "string", "pattern": "^https://"}},
     "required": ["type", "url"], "additionalProperties": False},
    {"type": "object", "properties": {"type": {"const": "asset_id"}, "asset_id": {"type": "string", "minLength": 1}},
     "required": ["type", "asset_id"], "additionalProperties": False},
    {"type": "object", "properties": {"type": {"const": "base64"}, "media_type": {"type": "string"},
                                      "data": {"type": "string"}},
     "required": ["type", "media_type", "data"], "additionalProperties": False},
]}
_RATIOS = ["21:9", "16:9", "4:3", "1:1", "3:4", "9:16"]
_COMMON = {
    "model": {"const": "heygen-video-1"},
    "prompt": {"type": "string", "minLength": 1, "maxLength": 16000},
    "prompt_enhancement": {"enum": ["turbo", "quality", "default", "disabled"]},
    "duration": {"type": "integer", "minimum": 5, "maximum": 15},
    "resolution": {"enum": ["480p", "768p", "1080p", "2k"]},
    "seed": {"type": ["integer", "null"], "minimum": 0, "maximum": 4294967295},
    "callback_url": {"type": ["string", "null"]},
    "callback_id": {"type": ["string", "null"], "maxLength": 256},
}
HEYGEN_CREATE = {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "title": "POST /v3/models/videos (heygen-video-1)",
    "oneOf": [
        {"type": "object", "additionalProperties": False, "required": ["model", "mode", "prompt"],
         "properties": {**_COMMON, "mode": {"const": "text_to_video"}, "aspect_ratio": {"enum": _RATIOS}}},
        {"type": "object", "additionalProperties": False, "required": ["model", "mode", "prompt", "image"],
         "properties": {**_COMMON, "mode": {"const": "image_to_video"}, "image": _ASSET,
                        "aspect_ratio": {"enum": [*_RATIOS, "adaptive", None]}}},
        {"type": "object", "additionalProperties": False, "required": ["model", "mode", "prompt"],
         "properties": {**_COMMON, "mode": {"const": "reference_to_video"},
                        "reference_images": {"type": "array", "items": _ASSET, "maxItems": 9},
                        "reference_videos": {"type": "array", "items": _ASSET, "maxItems": 3},
                        "reference_audio": {"type": "array", "items": _ASSET, "maxItems": 3},
                        "aspect_ratio": {"enum": [*_RATIOS, "adaptive"]}}},
    ],
}


def _get(url: str) -> dict:
    req = urllib.request.Request(url, headers={"User-Agent": "napkin-schema-snapshot/1"})
    with urllib.request.urlopen(req, timeout=60) as r:  # noqa: S310 (public documentation)
        return json.loads(r.read())


def fal_endpoints() -> list[str]:
    sheet = json.loads((contracts_dir() / "capabilities" / "fal.json").read_text())
    out = {SAM2}
    for spec in sheet["ops"].values():
        out.add(spec["endpoint"])
        if spec.get("regionEndpoint"):
            out.add(spec["regionEndpoint"])
        out.update(a["endpoint"] for a in spec.get("alternates", []))
    return sorted(out)


def _rewrite(node, old: str, new: str):
    if isinstance(node, dict):
        return {k: (v.replace(old, new) if k == "$ref" and isinstance(v, str) else _rewrite(v, old, new))
                for k, v in node.items()}
    if isinstance(node, list):
        return [_rewrite(v, old, new) for v in node]
    return node


def fal_schema(endpoint: str) -> dict:
    """The endpoint's POST body as one self-contained JSON Schema (components become $defs)."""
    api = _get(FAL_OPENAPI.format(endpoint))
    post = api["paths"][f"/{endpoint}"]["post"]
    body = post["requestBody"]["content"]["application/json"]["schema"]
    defs = api.get("components", {}).get("schemas", {})
    bundle = {"$schema": "https://json-schema.org/draft/2020-12/schema", **body, "$defs": defs}
    out = _rewrite(bundle, "#/components/schemas/", "#/$defs/")
    assert isinstance(out, dict)
    return out


def runway_schemas() -> dict[str, dict]:
    api = _get(RUNWAY_OPENAPI)
    return {path: api["paths"][path]["post"]["requestBody"]["content"]["application/json"]["schema"]
            for path in RUNWAY_PATHS}


def snapshots() -> dict[Path, dict]:
    today = dt.date.today().isoformat()
    files: dict[Path, dict] = {}
    for endpoint in fal_endpoints():
        files[OUT / "fal" / (endpoint.replace("/", "__") + ".json")] = {
            "source": FAL_OPENAPI.format(endpoint), "fetched": today, "endpoint": endpoint,
            "schema": fal_schema(endpoint)}
    for path, schema in runway_schemas().items():
        files[OUT / "runway" / (path.strip("/").replace("/", "__") + ".json")] = {
            "source": RUNWAY_OPENAPI, "fetched": today, "endpoint": f"POST {path}", "schema": schema}
    files[OUT / "heygen" / "v3__models__videos.json"] = {
        "source": HEYGEN_SOURCE, "fetched": "2026-10-08 (written by hand: HeyGen publishes no OpenAPI)",
        "endpoint": "POST /v3/models/videos", "schema": HEYGEN_CREATE}
    return files


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--check", action="store_true", help="print which snapshots changed; write nothing")
    args = ap.parse_args()
    changed = 0
    for path, data in snapshots().items():
        old = json.loads(path.read_text()) if path.exists() else None
        if old is not None and old["schema"] == data["schema"]:
            continue
        changed += 1
        print(("changed " if old else "new     ") + str(path.relative_to(RELAY)))
        if not args.check:
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(json.dumps(data, indent=1, sort_keys=True) + "\n")
    print(f"{changed} snapshot(s) {'differ' if args.check else 'written'}")
    return 1 if args.check and changed else 0


if __name__ == "__main__":
    sys.exit(main())
