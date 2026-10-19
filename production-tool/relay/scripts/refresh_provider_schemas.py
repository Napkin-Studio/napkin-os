#!/usr/bin/env python3
"""Snapshot each provider's published request schema, so the pathway tests hold our request
bodies to what the provider says it accepts (features/harness-pathways.clan).

    uv run --frozen --python 3.12 python scripts/refresh_provider_schemas.py          write the snapshots
    uv run --frozen --python 3.12 python scripts/refresh_provider_schemas.py --check  diff, write nothing

- Runway: the POST bodies we send, from docs.dev.runwayml.com/openapi.json (one oneOf branch
  per model).

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
OUT = RELAY / "tests" / "fixtures" / "schemas"
RUNWAY_OPENAPI = "https://docs.dev.runwayml.com/openapi.json"
RUNWAY_PATHS = ("/v1/text_to_image", "/v1/image_to_video", "/v1/video_to_video")


def _get(url: str) -> dict:
    req = urllib.request.Request(url, headers={"User-Agent": "napkin-schema-snapshot/1"})
    with urllib.request.urlopen(req, timeout=60) as r:  # noqa: S310 (public documentation)
        return json.loads(r.read())


def runway_schemas() -> dict[str, dict]:
    api = _get(RUNWAY_OPENAPI)
    return {path: api["paths"][path]["post"]["requestBody"]["content"]["application/json"]["schema"]
            for path in RUNWAY_PATHS}


def snapshots() -> dict[Path, dict]:
    today = dt.date.today().isoformat()
    files: dict[Path, dict] = {}
    for path, schema in runway_schemas().items():
        files[OUT / "runway" / (path.strip("/").replace("/", "__") + ".json")] = {
            "source": RUNWAY_OPENAPI, "fetched": today, "endpoint": f"POST {path}", "schema": schema}
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
