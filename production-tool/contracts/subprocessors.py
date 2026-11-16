"""subprocessors.md from subprocessors.json (features/tenant-limits.clan). Standard library only.

    python production-tool/contracts/subprocessors.py           # print it
    python production-tool/contracts/subprocessors.py --write   # write subprocessors.md

check.py fails when the committed subprocessors.md is not what this renders.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent

CONTROL = {
    "always": "Always: every agency",
    "claude": "On unless the agency turns Claude off",
    "maker": "On while the agency allows this maker",
}


def render(data: dict, policy: dict) -> str:
    names = {e["id"]: e["name"] for e in data["entries"]}
    default_makers = set(policy["allow"]["makers"])
    lines = [
        "# Who receives an agency's material",
        "",
        f"Generated from `subprocessors.json` (updated {data['updated']}) by `subprocessors.py`; do not edit by hand.",
        "The Production Tool's Data sharing sheet shows the same entries with the agency's own allowlist.",
        "",
        "| Company | What it does | What it receives | Through | Where | Turned on |",
        "|---|---|---|---|---|---|",
    ]
    for e in data["entries"]:
        region = e["region"]
        where = f"{region['where']}; source: {region['source']}" if region else "Not yet confirmed"
        on = CONTROL[e["control"]]
        if e["control"] == "maker":
            on += " (on by default)" if e["id"] in default_makers else " (off unless the agency asks)"
        elif e["control"] == "claude":
            on += " (on by default)" if policy["allow"]["claude"] else " (off by default)"
        via = names.get(e.get("via", ""), "")
        lines.append(f"| {e['name']} | {e['does']} | {e['receives']} | {via} | {where} | {on} |")
    lines.append("")
    return "\n".join(lines)


def rendered() -> str:
    data = json.loads((HERE / "subprocessors.json").read_text())
    policy = json.loads((HERE / "spend-policy.json").read_text())
    return render(data, policy)


if __name__ == "__main__":
    text = rendered()
    if "--write" in sys.argv[1:]:
        (HERE / "subprocessors.md").write_text(text)
    else:
        sys.stdout.write(text)
