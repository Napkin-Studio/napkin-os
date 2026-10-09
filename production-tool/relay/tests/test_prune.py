"""scripts/prune_workspaces.py (features/personal-workspaces.clan): a dry run deletes nothing; --yes
removes a name's projects, library, jobs and counters, and every picture only it used; a picture
another workspace still uses is kept; --before keeps workspaces with anything newer; a report is
written. On the dev server's files (LocalBlobs) and on S3 + DynamoDB (moto)."""

import io
import json
import os
import sys
import zipfile
from pathlib import Path

import boto3
import pytest
from moto import mock_aws

from blobs import LocalBlobs, S3Blobs
from service import participant_id
from store import DynamoStore, MemoryStore

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
import prune_workspaces as prune  # noqa: E402

MAYA, SAM = participant_id("blue", "maya"), participant_id("blue", "sam")
P1, P2 = "prj_01J9Z8Y7X6W5V4T3S2R1Q0P9N8", "prj_01J9Z8Y7X6W5V4T3S2R1Q0P9N9"


def sha(n: int) -> str:
    return f"{n:064x}"


def clan(*hexes: str) -> bytes:
    """A .clan as the web makes it: a zip whose data.yaml names its assets by hash."""
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as z:
        z.writestr("manifest.yaml", "format: clan\n")
        z.writestr("shared/data.yaml", "assets:\n" + "".join(f"  - sha256: sha256:{h}\n" for h in hexes))
    return buf.getvalue()


def job(jid, pid, *, state="completed", inputs=(), outputs=(), created="2026-10-10T10:00:00Z"):
    return {"jobId": jid, "participantId": pid, "op": "generate", "state": state, "createdAt": created, "updatedAt": created,
            "inputHashes": [f"sha256:{h}" for h in inputs],
            "outputs": [{"sha256": f"sha256:{h}", "url": f"https://cdn.test/out/sha256:{h}", "mime": "image/png"} for h in outputs]}


def fill(blobs, store):
    """Maya: two projects (one with timed copies), a library, three jobs (one stitched an ad).
    Sam: one project that shares picture 2 with Maya. An old team library from before."""
    for n in range(1, 8):
        blobs.put(f"in/sha256:{sha(n)}", b"img", "image/png")
    blobs.put(f"out/sha256:{sha(8)}", b"out", "image/png")
    blobs.put(f"cards/{sha(1)}.json", b"{}", "application/json")
    blobs.put(f"cards/{sha(2)}.json", b"{}", "application/json")
    for key, data in {
        f"clan/{MAYA}/{P1}/20261010T100000Z-aaaaaaaa-manual.clan": clan(sha(1)),
        f"clan/{MAYA}/{P1}/20261010T110000Z-bbbbbbbb-manual.clan": clan(sha(1), sha(2)),
        f"clan/{MAYA}/{P1}/latest.clan": clan(sha(1), sha(2)),
        f"clan/{MAYA}/{P2}/latest.clan": clan(sha(3)),
        f"clan/{SAM}/{P1}/latest.clan": clan(sha(2), sha(5)),
    }.items():
        blobs.put(key, data, "application/vnd.clan+zip")
    blobs.put(f"clan/{MAYA}/projects.json", json.dumps({"projects": []}).encode(), "application/json")
    blobs.put(f"clan/{MAYA}/{P1}/canvas.json", b'{"elements": []}', "application/json")
    blobs.put(f"library/{MAYA}/index.json", json.dumps({"keys": [{"cover": {"sha256": f"sha256:{sha(4)}"}}]}).encode(), "application/json")
    blobs.put(f"library/{MAYA}/hero/1.json", json.dumps({"refs": [{"asset": {"sha256": f"sha256:{sha(4)}"}}]}).encode(), "application/json")
    blobs.put(f"library/event/index.json", json.dumps({"keys": [{"cover": {"sha256": f"sha256:{sha(6)}"}}]}).encode(), "application/json")
    blobs.put(f"ads/job_ad.mp4", b"mp4", "video/mp4")
    blobs.put(f"ads/job_ad.json", json.dumps({"ok": True, "sha256": f"sha256:{sha(9)}"}).encode(), "application/json")
    if store is not None:
        for j in (job("job_a", MAYA, inputs=[sha(1)], outputs=[sha(8)]), job("job_ad", MAYA), job("job_s", SAM, inputs=[sha(5)])):
            store.create_job(j)
        for key in (f"{MAYA}#2026-10-10", f"inflight#{MAYA}", f"slots#fal#own#{MAYA}#image", f"{SAM}#2026-10-10", "spend", "slots#runway#image"):
            store.incr(key, "n", 1)


def keys(blobs) -> set[str]:
    return {r["key"] for p in ("clan/", "library/", "in/", "out/", "ads/", "cards/") for r in blobs.list_keys(p)}


@pytest.fixture
def local(tmp_path):
    blobs, store = LocalBlobs(tmp_path / "data", "http://localhost:1"), MemoryStore()
    fill(blobs, store)
    return blobs, store


def test_a_dry_run_lists_everything_and_deletes_nothing(local, tmp_path, capsys):
    blobs, _ = local
    before = keys(blobs)
    report = tmp_path / "r.json"
    assert prune.main(["--name", "blue/Maya", "--local", str(tmp_path / "data"), "--report", str(report)]) == 0
    assert keys(blobs) == before
    out = capsys.readouterr().out
    assert "DRY RUN" in out and f"object  clan/{MAYA}/{P1}/latest.clan" in out and "pass --yes" in out
    r = json.loads(report.read_text())
    assert r["dryRun"] is True and [c["workspace"] for c in r["chosen"]] == [MAYA] and r["chosen"][0]["name"] == "blue/Maya"


def test_a_name_is_removed_and_a_shared_picture_is_kept(local):
    blobs, store = local
    p = prune.plan(blobs, store, workspaces={MAYA}, before=None)
    prune.apply(blobs, store, p)
    left = keys(blobs)
    assert not [k for k in left if k.startswith((f"clan/{MAYA}/", f"library/{MAYA}/"))]
    # Only Maya used 1, 3, 4 and the output 8 (and its card): gone. Sam's 2 and 5 stay, and 2's card.
    for n in (1, 3, 4):
        assert f"in/sha256:{sha(n)}" not in left
    assert f"out/sha256:{sha(8)}" not in left and f"cards/{sha(1)}.json" not in left
    assert {f"in/sha256:{sha(2)}", f"in/sha256:{sha(5)}", f"cards/{sha(2)}.json", f"clan/{SAM}/{P1}/latest.clan"} <= left
    assert p["keptShared"] == [{"sha256": f"sha256:{sha(2)}", "usedBy": [f"clan/{SAM}/{P1}/latest.clan"]}]
    # Pictures nobody's saved work names (7) and the old team library stay: --name never guesses.
    assert {f"in/sha256:{sha(7)}", "library/event/index.json"} <= left
    # Her jobs, her stitched ad and her counters; never Sam's, the spend or the event's slots.
    assert "ads/job_ad.mp4" not in left and "ads/job_ad.json" not in left
    assert {j["jobId"] for j in store.all_jobs()} == {"job_s"}
    assert store.counter_keys() == sorted([f"{SAM}#2026-10-10", "spend", "slots#runway#image"])


def test_all_removes_everything(local):
    blobs, store = local
    prune.apply(blobs, store, prune.plan(blobs, store, workspaces=None, before=None))
    assert keys(blobs) == set()
    assert store.all_jobs() == [] and store.counter_keys() == ["slots#runway#image", "spend"]


def test_before_keeps_a_workspace_with_anything_newer(local, tmp_path):
    blobs, store = local
    old = datetime_ts("2026-10-01T00:00:00Z")
    for f in (tmp_path / "data").rglob("*"):
        os.utime(f, (old, old))
    store.create_job(job("job_new", SAM, created="2026-10-21T09:00:00Z"))  # Sam made something after the day
    p = prune.plan(blobs, store, workspaces=None, before="2026-10-20")
    assert SAM in p["remaining"] and any(s["workspace"] == SAM for s in p["skipped"])
    assert MAYA in [c["workspace"] for c in p["chosen"]]
    prune.apply(blobs, store, p)
    assert f"clan/{SAM}/{P1}/latest.clan" in keys(blobs) and f"in/sha256:{sha(5)}" in keys(blobs)


def test_a_workspace_with_a_running_job_is_skipped(local):
    blobs, store = local
    store.create_job(job("job_run", MAYA, state="submitted"))
    p = prune.plan(blobs, store, workspaces={MAYA}, before=None)
    assert p["chosen"] == [] and p["skipped"][0]["why"] == "a job is still running"
    assert p["delete"] == {"objects": [], "jobs": [], "counters": []}


def test_the_old_team_library_by_its_id(local):
    blobs, store = local
    prune.apply(blobs, store, prune.plan(blobs, store, workspaces={"event"}, before=None))
    left = keys(blobs)
    assert "library/event/index.json" not in left and f"in/sha256:{sha(6)}" not in left
    assert f"clan/{MAYA}/{P1}/latest.clan" in left


def test_yes_deletes_on_the_local_files_and_writes_the_report(local, tmp_path):
    blobs, _ = local
    report = tmp_path / "r.json"
    prune.main(["--name", "blue/maya", "--local", str(tmp_path / "data"), "--yes", "--report", str(report)])
    assert f"clan/{MAYA}/{P1}/latest.clan" not in keys(blobs)
    assert not list((tmp_path / "data").rglob(f"sha256:{sha(1)}.mime"))  # the dev server's notes go too
    r = json.loads(report.read_text())
    assert r["dryRun"] is False and f"clan/{MAYA}/{P1}/latest.clan" in r["delete"]["objects"]


def test_before_on_the_files_keeps_newer_ones(local, tmp_path):
    blobs, store = local
    old = datetime_ts("2026-10-01T00:00:00Z")
    for p in (tmp_path / "data" / "clan" / MAYA).rglob("*"):
        os.utime(p, (old, old))
    for p in (tmp_path / "data" / "library" / MAYA).rglob("*"):
        os.utime(p, (old, old))
    for j in store.all_jobs():
        store.delete_job(j["jobId"])
    p = prune.plan(blobs, None, workspaces=None, before="2026-10-05")
    assert [c["workspace"] for c in p["chosen"]] == [MAYA]
    assert SAM in p["remaining"]


def datetime_ts(s: str) -> float:
    from datetime import datetime, timezone

    return datetime.strptime(s, "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=timezone.utc).timestamp()


def test_on_s3_and_dynamodb(monkeypatch, tmp_path):
    for k, v in {"AWS_ACCESS_KEY_ID": "testing", "AWS_SECRET_ACCESS_KEY": "testing", "AWS_DEFAULT_REGION": "eu-west-1",
                 "BUCKET": "napkin-test", "JOBS_TABLE": "jobs", "QUOTAS_TABLE": "quotas", "BLOCKED_TABLE": "blocked"}.items():
        monkeypatch.setenv(k, v)
    with mock_aws():
        from test_aws import make_tables

        ddb = boto3.client("dynamodb", region_name="eu-west-1")
        make_tables(ddb)
        from blobs import s3_client

        s3 = s3_client("eu-west-1")
        s3.create_bucket(Bucket="napkin-test", CreateBucketConfiguration={"LocationConstraint": "eu-west-1"})
        blobs, store = S3Blobs("napkin-test", "", client=s3), DynamoStore("jobs", "quotas", "blocked", client=ddb)
        fill(blobs, store)
        report = tmp_path / "r.json"
        prune.main(["--name", "blue/Maya", "--report", str(report)])  # dry run
        assert f"clan/{MAYA}/{P1}/latest.clan" in keys(blobs) and len(store.all_jobs()) == 3
        prune.main(["--name", "blue/Maya", "--yes", "--report", str(report)])
        left = keys(blobs)
        assert not [k for k in left if MAYA in k] and f"in/sha256:{sha(2)}" in left and f"in/sha256:{sha(1)}" not in left
        assert {j["jobId"] for j in store.all_jobs()} == {"job_s"}
        assert f"inflight#{MAYA}" not in store.counter_keys() and "spend" in store.counter_keys()
        assert json.loads(report.read_text())["store"].startswith("s3://napkin-test")
