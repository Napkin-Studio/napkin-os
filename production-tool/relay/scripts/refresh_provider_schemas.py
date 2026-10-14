#!/usr/bin/env python3
"""Snapshot each provider's published request schema and price list, so the pathway tests hold our
request bodies, and tests/test_runway_sheet.py holds the capability sheet, to what the provider
says (features/harness-pathways.clan, features/runway-sheet-sync.clan).

    uv run --frozen --python 3.12 python scripts/refresh_provider_schemas.py          write the snapshots
    uv run --frozen --python 3.12 python scripts/refresh_provider_schemas.py --check  diff, write nothing

- Runway request schemas: the POST bodies we send or plan to send, from
  docs.dev.runwayml.com/openapi.json (one oneOf branch per model), into
  tests/fixtures/schemas/runway/.
- Runway prices: docs.dev.runwayml.com/guides/pricing.md, as verbatim rows keyed by model id,
  into tests/fixtures/pricing/runway.json.

Each file carries its source URL and fetch date. Nothing here needs a key: these are public
documentation. A person reads the diff and edits the sheet; nothing here edits it.
"""

from __future__ import annotations

import argparse
import datetime as dt
import json
import re
import sys
import urllib.request
from pathlib import Path

HERE = Path(__file__).resolve().parent
RELAY = HERE.parent
OUT = RELAY / "tests" / "fixtures" / "schemas"
PRICING_OUT = RELAY / "tests" / "fixtures" / "pricing" / "runway.json"
RUNWAY_OPENAPI = "https://docs.dev.runwayml.com/openapi.json"
RUNWAY_PRICING = "https://docs.dev.runwayml.com/guides/pricing.md"
RUNWAY_PATHS = ("/v1/text_to_image", "/v1/image_to_video", "/v1/video_to_video",
                "/v1/image_upscale", "/v1/video_upscale")


def _fetch(url: str) -> bytes:
    req = urllib.request.Request(url, headers={"User-Agent": "napkin-schema-snapshot/1"})
    with urllib.request.urlopen(req, timeout=60) as r:  # noqa: S310 (public documentation)
        return r.read()


def _get(url: str) -> dict:
    return json.loads(_fetch(url))


def runway_schemas(api: dict | None = None) -> dict[str, dict]:
    api = api if api is not None else _get(RUNWAY_OPENAPI)
    return {path: api["paths"][path]["post"]["requestBody"]["content"]["application/json"]["schema"]
            for path in RUNWAY_PATHS}


def schema_file(path: str) -> Path:
    return OUT / "runway" / (path.strip("/").replace("/", "__") + ".json")


# ── pricing.md as rows by model id ──────────────────────────────────────────
_TICKED = re.compile(r"`([^`]+)`")
_MODEL_ID = re.compile(r"^[a-z][a-z0-9_.\-]*[a-z0-9]$")


def _cells(line: str) -> list[str]:
    return [" ".join(c.split()) for c in line.strip().strip("|").split("|")]


def _ids(text: str) -> list[str]:
    """The model ids a cell names: the first word of each `ticked` token ('veo3.1 (audio)' → veo3.1)."""
    out = []
    for t in _TICKED.findall(text):
        word = t.split()[0] if t.split() else ""
        if _MODEL_ID.match(word) and word not in out:
            out.append(word)
    return out


def pricing_rows(markdown: str, known: set[str] | None = None) -> dict[str, list[str]]:
    """Every price fact in pricing.md, verbatim (whitespace collapsed), keyed by model id.

    - A table whose first column names a model: the row 'cell 1 | cell 2 | ...' for that model.
    - A table whose header names models (the ideogram quality table): '<header 0> <row label>: <cell>'
      for each model column.
    - A table naming no model (the video upscaler's resolutions): its rows for the models the
      paragraph before it starts with.
    - A paragraph that starts with a `model id`: the paragraph, for every model id in its first
      sentence.
    `known` (the OpenAPI's model ids) keeps field names such as `outputCount` out of the keys.
    Rows keep their order; a model with no row is simply absent (never free).
    """
    rows: dict[str, list[str]] = {}

    def add(model: str, text: str) -> None:
        if known is not None and model not in known:
            return
        bucket = rows.setdefault(model, [])
        if text not in bucket:
            bucket.append(text)

    lines = markdown.splitlines()
    para_models: list[str] = []
    i = 0
    in_html = False
    while i < len(lines):
        line = lines[i].strip()
        if line.startswith(("<script", "<style")):
            in_html = True
        if in_html or line.startswith("<"):  # the page's calculator: markup and code, no prices of record
            if line.startswith(("</script>", "</style>")):
                in_html = False
            i += 1
            continue
        if line.startswith("|"):
            header = _cells(line)
            body = []
            i += 1
            while i < len(lines) and lines[i].strip().startswith("|"):
                cells = _cells(lines[i])
                if not all(re.fullmatch(r":?-+:?", c) for c in cells if c):
                    body.append(cells)
                i += 1
            header_models = [(j, _ids(h)) for j, h in enumerate(header) if j > 0 and _ids(h)]
            if header_models:
                for cells in body:
                    for j, ms in header_models:
                        if j < len(cells):
                            for m in ms:
                                add(m, f"{header[0]} {cells[0]}: {cells[j]}")
                continue
            for cells in body:
                ms = _ids(cells[0])[:1]
                for m in ms or para_models:
                    add(m, " | ".join(cells))
            continue
        if line and not line.startswith("#"):
            # One paragraph: the lines up to a blank line.
            para = [line]
            i += 1
            while i < len(lines) and lines[i].strip() and not lines[i].strip().startswith(("|", "#", "<")):
                para.append(lines[i].strip())
                i += 1
            text = " ".join(" ".join(para).split())
            if text.startswith("`"):
                first = re.split(r"(?<=[.)])\s", text, maxsplit=1)[0]
                para_models = [m for m in _ids(first) if known is None or m in known]
                for m in para_models:
                    add(m, text)
            else:
                para_models = []
            continue
        if line.startswith("#"):
            para_models = []
        i += 1
    return rows


def model_ids(api: dict) -> set[str]:
    out = set()
    for item in api.get("paths", {}).values():
        body = (item.get("post") or {}).get("requestBody", {}).get("content", {}).get("application/json", {})
        schema = body.get("schema") or {}
        for branch in schema.get("oneOf") or schema.get("anyOf") or [schema]:
            const = (branch.get("properties", {}).get("model") or {}).get("const")
            if const:
                out.add(const)
    return out


def credit_line(markdown: str) -> str | None:
    """The sentence that gives a credit's price ('... for $0.01 per credit ...')."""
    text = " ".join(markdown.split())
    m = re.search(r"[^.]*\$[0-9.]+ per credit[^.]*\.", text)
    return m.group(0).strip() if m else None


def pricing_snapshot(markdown: str, known: set[str], today: str) -> dict:
    return {"source": RUNWAY_PRICING, "fetched": today, "credit": credit_line(markdown),
            "rows": pricing_rows(markdown, known)}


def snapshots(api: dict | None = None, pricing_md: str | None = None) -> dict[Path, dict]:
    today = dt.date.today().isoformat()
    api = api if api is not None else _get(RUNWAY_OPENAPI)
    pricing_md = pricing_md if pricing_md is not None else _fetch(RUNWAY_PRICING).decode()
    files: dict[Path, dict] = {}
    for path, schema in runway_schemas(api).items():
        files[schema_file(path)] = {"source": RUNWAY_OPENAPI, "fetched": today, "endpoint": f"POST {path}",
                                    "schema": schema}
    files[PRICING_OUT] = pricing_snapshot(pricing_md, model_ids(api), today)
    return files


def _same(old: dict, new: dict) -> bool:
    keys = ("schema",) if "schema" in new else ("rows", "credit")
    return all(old.get(k) == new[k] for k in keys)


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--check", action="store_true", help="print which snapshots changed; write nothing")
    args = ap.parse_args()
    changed = 0
    for path, data in snapshots().items():
        old = json.loads(path.read_text()) if path.exists() else None
        if old is not None and _same(old, data):
            continue
        changed += 1
        print(("changed " if old else "new     ") + str(path.relative_to(RELAY)))
        if not args.check:
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(json.dumps(data, indent=1, sort_keys=True, ensure_ascii=False) + "\n")
    print(f"{changed} snapshot(s) {'differ' if args.check else 'written'}")
    return 1 if args.check and changed else 0


if __name__ == "__main__":
    sys.exit(main())
