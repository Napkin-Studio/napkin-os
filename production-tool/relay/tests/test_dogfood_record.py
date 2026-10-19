"""scripts/dogfood_record.py: export in time order, prune by person, name or date, dry run first,
and every version gone with --yes (the bucket is versioned)."""

import json
import sys
from pathlib import Path

import boto3
import pytest
from moto import mock_aws

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))

import dogfood_record as rec  # noqa: E402
from service import participant_id  # noqa: E402

MAYA = participant_id("Blue Herons", "Maya")
SAM = participant_id("Pixels", "sam")


def line(pid, ts, kind="click", name="button: Go", source="web", data=None):
    return {"ts": ts, "participant": pid, "source": source, "kind": kind, "name": name, "data": data or {}}


def put(write, key, lines):
    write(key, "".join(json.dumps(e) + "\n" for e in lines).encode())


def fill(write):
    write(f"dogfood/consent/{MAYA}.json", json.dumps({"participantId": MAYA, "handle": "Maya", "team": "Blue Herons"}).encode())
    write(f"dogfood/consent/{SAM}.json", json.dumps({"participantId": SAM, "handle": "sam"}).encode())
    put(write, f"dogfood/events/2026-10-19/{MAYA}/100000.000-web-aa.jsonl",
        [line(MAYA, "2026-10-19T10:00:00.000Z"), line(MAYA, "2026-10-19T10:00:01.000Z")])
    put(write, f"dogfood/events/2026-10-20/{MAYA}/090000.000-relay-bb.jsonl",
        [line(MAYA, "2026-10-20T09:00:00.000Z", "job", "queued", "relay", {"jobId": "job_1"})])
    put(write, f"dogfood/events/2026-10-20/{SAM}/085959.000-web-cc.jsonl", [line(SAM, "2026-10-20T08:59:59.000Z")])


@pytest.fixture
def s3(monkeypatch):
    monkeypatch.setenv("AWS_ACCESS_KEY_ID", "testing")
    monkeypatch.setenv("AWS_SECRET_ACCESS_KEY", "testing")
    monkeypatch.setenv("AWS_DEFAULT_REGION", "eu-west-1")
    with mock_aws():
        c = boto3.client("s3", region_name="eu-west-1")
        c.create_bucket(Bucket="dogfood-test", CreateBucketConfiguration={"LocationConstraint": "eu-west-1"})
        c.put_bucket_versioning(Bucket="dogfood-test", VersioningConfiguration={"Status": "Enabled"})
        fill(lambda k, data: c.put_object(Bucket="dogfood-test", Key=k, Body=data))
        yield rec.S3Source("dogfood-test", client=c), c


@pytest.fixture
def local(tmp_path):
    def write(k, data):
        p = tmp_path / k
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_bytes(data)
    fill(write)
    return rec.LocalSource(tmp_path)


def test_export_is_folded_in_time_order_with_names(local):
    out = rec.export(local)
    assert [e["ts"] for e in out] == sorted(e["ts"] for e in out)
    assert [(e["participant"], e["kind"]) for e in out][:2] == [(MAYA, "click"), (MAYA, "repeat")]
    assert out[0]["handle"] == "Maya" and out[0]["team"] == "Blue Herons"
    assert len(rec.export(local, raw=True)) == 4


def test_names_are_the_relays_participant_ids():
    assert rec.resolve(None, ["blue  HERONS/maya"]) == {MAYA}
    assert rec.resolve(None, ["Pixels/SAM"]) == {SAM}
    assert rec.resolve(None, ["Other team/sam"]) != {SAM}
    with pytest.raises(SystemExit):
        rec.resolve(None, ["sam"])


def test_export_filters_by_day_and_person(local):
    assert {e["participant"] for e in rec.export(local, date="2026-10-20")} == {MAYA, SAM}
    assert {e["participant"] for e in rec.export(local, participants={SAM})} == {SAM}


def test_prune_is_a_dry_run_unless_yes(s3):
    src, c = s3
    report = rec.prune(src, participants={MAYA})
    assert report["dryRun"] and report["count"] == 3  # two days and the consent record
    assert len(src.keys("dogfood/")) == 5


def test_prune_a_person_removes_every_version_and_keeps_others(s3):
    src, c = s3
    # an older version of the same object, as a re-sent batch would leave
    c.put_object(Bucket="dogfood-test", Key=f"dogfood/events/2026-10-19/{MAYA}/100000.000-web-aa.jsonl", Body=b"{}\n")
    report = rec.prune(src, participants={MAYA}, yes=True)
    assert report["versionsDeleted"] == 4
    left = c.list_object_versions(Bucket="dogfood-test", Prefix="dogfood/")
    keys = {v["Key"] for v in left.get("Versions", []) + left.get("DeleteMarkers", [])}
    assert keys == {f"dogfood/consent/{SAM}.json", f"dogfood/events/2026-10-20/{SAM}/085959.000-web-cc.jsonl"}


def test_prune_before_a_day_keeps_later_days_and_consent(local):
    report = rec.prune(local, before="2026-10-20", yes=True)
    assert report["keys"] == [f"dogfood/events/2026-10-19/{MAYA}/100000.000-web-aa.jsonl"]
    assert len(local.keys("dogfood/consent/")) == 2 and len(local.keys("dogfood/events/")) == 2


def test_prune_all_from_the_command_line_writes_a_report(local, tmp_path, capsys):
    report = tmp_path / "r.json"
    assert rec.main(["--local", str(local.root), "prune", "--all", "--report", str(report)]) == 0
    assert json.loads(report.read_text())["count"] == 5 and len(local.keys("dogfood/")) == 5  # dry run
    assert rec.main(["--local", str(local.root), "prune", "--all", "--yes", "--report", str(report)]) == 0
    assert local.keys("dogfood/") == []
    assert rec.main(["--local", str(local.root), "prune", "--name", "Blue Herons/Maya", "--report", str(report)]) == 0
