#!/usr/bin/env python3
"""Has Runway changed anything our capability sheet relies on? (features/runway-sheet-sync.clan)

    uv run --frozen --python 3.12 python scripts/runway_sheet_sync.py --dry-run     print the drift, open nothing
    GITHUB_TOKEN=... GITHUB_REPOSITORY=owner/repo \\
    uv run --frozen --python 3.12 python scripts/runway_sheet_sync.py               open or update the issue

Re-fetches Runway's two public documents (openapi.json and guides/pricing.md; no key, no credits)
and compares, for every model in contracts/capabilities/runway.json's catalogue, its request schema
and its price rows with the committed snapshots (tests/fixtures/schemas/runway, tests/fixtures/
pricing/runway.json) that tests/test_runway_sheet.py holds the sheet to. When anything moved it
opens one GitHub issue labelled `runway-sheet`, or comments on the one already open. It never
commits: a person reads the diff, refreshes the snapshots (scripts/refresh_provider_schemas.py) and
edits the sheet, because prices reach paying agencies. A fetch that fails fails the run and opens
nothing. .github/workflows/runway-sheet-sync.yml runs it weekly and on demand.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import urllib.error
import urllib.request
from pathlib import Path
from typing import Callable, Optional, Protocol

HERE = Path(__file__).resolve().parent
RELAY = HERE.parent
sys.path.insert(0, str(HERE))
sys.path.insert(0, str(RELAY))
import refresh_provider_schemas as snap  # noqa: E402
from contracts_dir import contracts_dir  # noqa: E402

LABEL = "runway-sheet"
TITLE = "Runway changed what the capability sheet relies on"


class Issues(Protocol):
    def open_issue(self, label: str) -> Optional[int]: ...
    def create(self, title: str, body: str, label: str) -> int: ...
    def comment(self, number: int, body: str) -> None: ...


class GitHubIssues:
    """GitHub's REST API with the workflow's token (permissions: issues: write)."""

    def __init__(self, repo: str, token: str, api: str = "https://api.github.com"):
        self.repo, self.token, self.api = repo, token, api

    def _call(self, method: str, path: str, body: Optional[dict] = None):
        req = urllib.request.Request(f"{self.api}/repos/{self.repo}{path}", method=method,
                                     data=json.dumps(body).encode() if body is not None else None,
                                     headers={"Authorization": f"Bearer {self.token}", "Accept": "application/vnd.github+json",
                                              "User-Agent": "napkin-runway-sheet-sync/1", "Content-Type": "application/json"})
        with urllib.request.urlopen(req, timeout=30) as r:  # noqa: S310 (api.github.com)
            return json.loads(r.read() or b"null")

    def open_issue(self, label: str) -> Optional[int]:
        found = self._call("GET", f"/issues?state=open&labels={label}&per_page=1")
        return found[0]["number"] if found else None

    def create(self, title: str, body: str, label: str) -> int:
        return self._call("POST", "/issues", {"title": title, "body": body, "labels": [label]})["number"]

    def comment(self, number: int, body: str) -> None:
        self._call("POST", f"/issues/{number}/comments", {"body": body})


def _branches(schema: dict) -> dict[str, dict]:
    out = {}
    for b in schema.get("oneOf") or schema.get("anyOf") or [schema]:
        model = (b.get("properties", {}).get("model") or {}).get("const")
        if model:
            out[model] = b
    return out


def _changed_keys(old: dict, new: dict) -> list[str]:
    po, pn = old.get("properties", {}), new.get("properties", {})
    keys = [f"+{k}" for k in pn if k not in po] + [f"-{k}" for k in po if k not in pn]
    keys += [k for k in po if k in pn and po[k] != pn[k]]
    if old.get("required") != new.get("required"):
        keys.append("required")
    return keys


def drift(sheet: dict, committed: dict, fresh: dict) -> list[str]:
    """What moved for the catalogue's models, in lines a person reads. committed and fresh are
    {"schemas": {endpoint path: schema}, "pricing": snapshot}."""
    lines: list[str] = []
    if committed["pricing"].get("credit") != fresh["pricing"].get("credit"):
        lines.append(f"- The credit price sentence changed: {fresh['pricing'].get('credit')!r} "
                     f"(was {committed['pricing'].get('credit')!r}).")
    for name, model in sheet["models"].items():
        endpoint = model.get("endpoint")
        if endpoint:
            path = endpoint.split(" ", 1)[-1]
            old = _branches(committed["schemas"].get(path, {})).get(name)
            new = _branches(fresh["schemas"].get(path, {})).get(name)
            if new is None:
                lines.append(f"- `{name}`: gone from `{endpoint}` in openapi.json.")
            elif old is None:
                lines.append(f"- `{name}`: not in our snapshot of `{endpoint}` (refresh the snapshots).")
            elif old != new:
                lines.append(f"- `{name}`: its `{endpoint}` request schema changed: {', '.join(_changed_keys(old, new)) or 'details'}.")
        old_rows = committed["pricing"]["rows"].get(name, [])
        new_rows = fresh["pricing"]["rows"].get(name, [])
        if not new_rows:
            lines.append(f"- `{name}`: pricing.md has no row for it any more (it is never treated as free).")
        elif old_rows != new_rows:
            lines.append(f"- `{name}`: its pricing.md rows changed.")
            lines += [f"  - now: {r}" for r in new_rows if r not in old_rows]
            lines += [f"  - was: {r}" for r in old_rows if r not in new_rows]
    return lines


def committed_snapshots() -> dict:
    schemas = {}
    for path in snap.RUNWAY_PATHS:
        f = snap.schema_file(path)
        if f.exists():
            schemas[path] = json.loads(f.read_text())["schema"]
    return {"schemas": schemas, "pricing": json.loads(snap.PRICING_OUT.read_text())}


def fresh_snapshots(fetch_api: Callable[[], dict], fetch_pricing: Callable[[], str], today: str) -> dict:
    api = fetch_api()
    return {"schemas": snap.runway_schemas(api),
            "pricing": snap.pricing_snapshot(fetch_pricing(), snap.model_ids(api), today)}


def report(lines: list[str], today: str) -> str:
    return "\n".join([
        f"The weekly check of {today} found that Runway's published documents moved for models in "
        "`production-tool/contracts/capabilities/runway.json` (features/runway-sheet-sync.clan).", "",
        *lines, "",
        "To act on it: run `scripts/refresh_provider_schemas.py` in `production-tool/relay`, read the diff, "
        "update the catalogue (`models`, and `pricing` with its verbatim `source` rows), run "
        "`scripts/check.sh`, and open a PR. Nothing here changed the sheet: prices reach paying agencies, "
        "so a person enters them.",
        f"\nSources: {snap.RUNWAY_OPENAPI}, {snap.RUNWAY_PRICING}",
    ])


def run(issues: Optional[Issues], fetch_fresh: Callable[[], dict], today: str, out: Callable[[str], None] = print,
        sheet: Optional[dict] = None, committed: Optional[dict] = None) -> int:
    """0: nothing moved, or the issue was opened or commented on. 1: a fetch failed (nothing opened).
    With issues=None (a dry run) drift prints and returns 1. fetch_fresh gives {schemas, pricing}."""
    sheet = sheet or json.loads((contracts_dir() / "capabilities" / "runway.json").read_text())
    try:
        fresh = fetch_fresh()
    except (urllib.error.URLError, OSError, ValueError, KeyError) as exc:
        out(f"could not fetch Runway's documents: {type(exc).__name__}: {exc}")
        return 1
    lines = drift(sheet, committed or committed_snapshots(), fresh)
    if not lines:
        out("no drift: the catalogue's models, schemas and prices match the snapshots")
        return 0
    body = report(lines, today)
    out(body)
    if issues is None:
        out("dry run: no issue opened")
        return 1
    number = issues.open_issue(LABEL)
    if number is None:
        number = issues.create(TITLE, body, LABEL)
        out(f"opened issue #{number}")
    else:
        issues.comment(number, body)
        out(f"commented on issue #{number}")
    return 0


def main(argv=None, env=None) -> int:
    import datetime as dt
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--dry-run", action="store_true", help="print the drift; open no issue")
    ap.add_argument("--openapi", type=Path, help="read openapi.json from this file instead of fetching it")
    ap.add_argument("--pricing", type=Path, help="read pricing.md from this file instead of fetching it")
    args = ap.parse_args(argv)
    env = os.environ if env is None else env
    fetch_api = (lambda: json.loads(args.openapi.read_text())) if args.openapi else (lambda: snap._get(snap.RUNWAY_OPENAPI))
    fetch_pricing = (lambda: args.pricing.read_text()) if args.pricing else (lambda: snap._fetch(snap.RUNWAY_PRICING).decode())
    issues = None
    if not args.dry_run:
        repo, token = env.get("GITHUB_REPOSITORY"), env.get("GITHUB_TOKEN")
        if not repo or not token:
            print("needs GITHUB_REPOSITORY and GITHUB_TOKEN (or --dry-run)", file=sys.stderr)
            return 2
        issues = GitHubIssues(repo, token)
    today = dt.date.today().isoformat()
    return run(issues, lambda: fresh_snapshots(fetch_api, fetch_pricing, today), today)


if __name__ == "__main__":
    sys.exit(main())
