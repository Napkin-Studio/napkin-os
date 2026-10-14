"""The weekly check that Runway has not moved what the sheet relies on (scripts/runway_sheet_sync.py,
features/runway-sheet-sync.clan). Offline: the issue client is a fake and the "fresh" documents
are the committed snapshots, changed on purpose."""

from __future__ import annotations

import copy
import importlib.util
import urllib.error
from pathlib import Path

import pytest

SCRIPTS = Path(__file__).resolve().parents[1] / "scripts"


def _load(name: str):
    spec = importlib.util.spec_from_file_location(name, SCRIPTS / f"{name}.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


sync = _load("runway_sheet_sync")


class FakeIssues:
    def __init__(self, open_number=None):
        self.open_number, self.calls = open_number, []

    def open_issue(self, label):
        self.calls.append(("find", label))
        return self.open_number

    def create(self, title, body, label):
        self.calls.append(("create", title, body, label))
        return 42

    def comment(self, number, body):
        self.calls.append(("comment", number, body))


def committed():
    return sync.committed_snapshots()


def with_change(change):
    fresh = copy.deepcopy(committed())
    change(fresh)
    return lambda: fresh


def veo_price_up(fresh):
    fresh["pricing"]["rows"]["veo3.1"] = ["`veo3.1 (audio)` | 45 credits per second", "`veo3.1 (no audio)` | 20 credits per second"]


def run(issues, fetch_fresh):
    lines = []
    code = sync.run(issues, fetch_fresh, "2026-10-20", out=lines.append)
    return code, "\n".join(lines)


def test_no_change_makes_no_call():
    issues = FakeIssues()
    code, text = run(issues, with_change(lambda f: None))
    assert code == 0 and "no drift" in text and issues.calls == []


def test_first_drift_opens_one_issue():
    issues = FakeIssues()
    code, text = run(issues, with_change(veo_price_up))
    assert code == 0 and "opened issue #42" in text
    (find, create) = issues.calls
    assert find == ("find", "runway-sheet") and create[0] == "create" and create[3] == "runway-sheet"
    assert "`veo3.1`: its pricing.md rows changed" in create[2] and "45 credits per second" in create[2]
    assert "40 credits per second" in create[2]  # what it was


def test_drift_with_an_issue_open_adds_one_comment():
    issues = FakeIssues(open_number=7)
    code, text = run(issues, with_change(veo_price_up))
    assert code == 0 and [c[0] for c in issues.calls] == ["find", "comment"] and issues.calls[1][1] == 7


@pytest.mark.parametrize("error", [urllib.error.URLError("timed out"), ValueError("not JSON"), KeyError("paths")])
def test_a_fetch_error_fails_the_run_and_opens_nothing(error):
    issues = FakeIssues()

    def broken():
        raise error
    code, text = run(issues, broken)
    assert code == 1 and "could not fetch" in text and issues.calls == []


def test_schema_changes_and_removals_are_named():
    def change(fresh):
        schema = fresh["schemas"]["/v1/video_to_video"]
        for b in schema.get("oneOf") or schema.get("anyOf"):
            if b["properties"]["model"].get("const") == "aleph2":
                b["properties"]["targetAspectRatio"]["enum"].append("4:5")
        fresh["schemas"]["/v1/image_upscale"] = {"oneOf": []}
        del fresh["pricing"]["rows"]["ideogram_4_5"]
    code, text = run(None, with_change(change))
    assert code == 1 and "dry run: no issue opened" in text
    assert "`aleph2`: its `POST /v1/video_to_video` request schema changed: targetAspectRatio" in text
    assert "`magnific_precision_upscaler_v2`: gone from `POST /v1/image_upscale`" in text
    assert "`ideogram_4_5`: pricing.md has no row for it any more" in text


def test_a_model_runway_added_elsewhere_is_not_drift():
    def change(fresh):
        fresh["pricing"]["rows"]["brand_new_model"] = ["`brand_new_model` | 1 credit per image"]
    assert run(FakeIssues(), with_change(change))[0] == 0


def test_dry_run_on_a_stale_snapshot_prints_the_diff(capsys):
    """The committed snapshot made stale on purpose; the fresh side is what Runway publishes now
    (as of the committed snapshot), parsed by the real code path."""
    stale = copy.deepcopy(committed())
    stale["pricing"]["rows"]["aleph2"] = ["`aleph2` | 25 credits per second (50 credit minimum per generation)"]
    stale["pricing"]["credit"] = "Credits can be purchased for $0.02 per credit."
    lines = []
    code = sync.run(None, lambda: committed(), "2026-10-20", out=lines.append, committed=stale)
    text = "\n".join(lines)
    assert code == 1
    assert "now: `aleph2` | 28 credits per second (56 credit minimum per generation)" in text
    assert "was: `aleph2` | 25 credits per second" in text and "credit price sentence changed" in text


def test_the_pricing_parser_reads_runway_tables_and_paragraphs():
    md = "\n".join([
        "Credits can be purchased for $0.01 per credit in the portal.", "",
        "| Model | Pricing |", "| --- | --- |", "| `veo3.1 (audio)` | 40 credits per second |",
        "| `aleph2` | 28 credits per second (56 credit minimum per generation) |", "",
        "`ideogram_4_5` is billed per image × `outputCount`.", "",
        "| Quality | `ideogram_4_5` |", "| --- | --- |", "| `high` | 25 |", "",
        "`magnific_video_upscaler_creative` is billed per output frame.", "",
        "| Resolution | USD per frame |", "| --- | --- |", "| `4k` | $0.012 |", "",
        "<script>", "const x = 1;", "</script>",
    ])
    known = {"veo3.1", "aleph2", "ideogram_4_5", "magnific_video_upscaler_creative"}
    rows = sync.snap.pricing_rows(md, known)
    assert rows == {
        "veo3.1": ["`veo3.1 (audio)` | 40 credits per second"],
        "aleph2": ["`aleph2` | 28 credits per second (56 credit minimum per generation)"],
        "ideogram_4_5": ["`ideogram_4_5` is billed per image × `outputCount`.", "Quality `high`: 25"],
        "magnific_video_upscaler_creative": ["`magnific_video_upscaler_creative` is billed per output frame.", "`4k` | $0.012"],
    }
    assert sync.snap.credit_line(md) == "Credits can be purchased for $0.01 per credit in the portal."


def test_main_needs_a_token_unless_dry_run(capsys):
    assert sync.main([], env={}) == 2


def test_the_workflow_is_weekly_keyless_and_never_commits():
    wf = (Path(__file__).resolve().parents[3] / ".github" / "workflows" / "runway-sheet-sync.yml").read_text()
    assert "schedule:" in wf and "workflow_dispatch:" in wf
    assert "contents: read" in wf and "issues: write" in wf
    assert "secrets." not in wf.replace("secrets.GITHUB_TOKEN", "")  # no Runway key, no other secret
    assert "git push" not in wf and "git commit" not in wf
    assert "scripts/runway_sheet_sync.py" in wf
