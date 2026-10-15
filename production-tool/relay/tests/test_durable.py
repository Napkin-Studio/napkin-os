"""The local relay keeps its jobs across restarts (features/relay-durable-jobs.clan): store.FileStore
under the --data dir, the mock's tasks beside it, and a restart that polls what it left at a provider."""

import hashlib
import io
import json
import time

from PIL import Image

import identity
import local
from conftest import Harness, envelope
from director import new_id
from ledger import Ledger
from store import FileStore


def test_jobs_counters_holds_and_claims_survive_a_new_store(tmp_path):
    a = FileStore(tmp_path)
    job = {"jobId": "job_1", "createdAt": "2026-10-15T00:00:00Z", "state": "submitted", "_queue": "r"}
    assert a.create_job(job)
    job["state"] = "fetching"
    assert a.save_job(job)
    a.incr("inflight#p", "n", 1, 6)
    a.hold("t1", "sha256:ab")
    assert a.claim("take#1", "job_1", until=2e9, now=1e9)

    b = FileStore(tmp_path)
    got = b.get_job("job_1")
    assert got["state"] == "fetching" and got["_ver"] == 2
    assert [j["jobId"] for j in b.list_active("r")] == ["job_1"]
    assert b.counters("inflight#p") == {"n": 1}
    assert b.holds("t1", "sha256:ab")
    assert b.claimed_by("take#1", now=1e9) == "job_1"
    assert not b.save_job({**got, "_ver": 1})  # the optimistic check holds on reloaded versions

    b.delete_job("job_1")
    b.release("take#1", "job_1")
    c = FileStore(tmp_path)
    assert c.get_job("job_1") is None and c.claimed_by("take#1", now=1e9) is None


def test_an_unreadable_job_file_is_set_aside_and_the_rest_load(tmp_path):
    a = FileStore(tmp_path)
    a.create_job({"jobId": "job_ok", "createdAt": "2026-10-15T00:00:00Z", "state": "queued"})
    (a.jobs_dir / "job_bad.json").write_text("{half a jo")
    b = FileStore(tmp_path)
    assert b.get_job("job_ok") and b.get_job("job_bad") is None
    assert (a.jobs_dir / "job_bad.json.bad").exists()
    assert not list(a.jobs_dir.glob(".*.tmp"))  # every write renamed its temp file into place


def test_spend_and_the_agencys_month_survive_a_restart(tmp_path):
    now = lambda: 1_791_360_000.0  # 2026-10-07  # noqa: E731
    ledger = Ledger(FileStore(tmp_path), now)
    month = ledger.reserve("tenant_a", 1.5, cap_month=10, cap_global=40)
    ledger.adjust("tenant_a", month, -0.25)  # settled at the provider's charge

    again = Ledger(FileStore(tmp_path), now)
    assert again.total() == 1.25 and again.month_used("tenant_a") == 1.25
    # the caps still count what was spent before the restart
    again.reserve("tenant_a", 8.75, cap_month=10, cap_global=40)
    try:
        again.reserve("tenant_a", 0.01, cap_month=10, cap_global=40)
        raise AssertionError("the month's cap should have refused")
    except Exception as e:
        assert type(e).__name__ == "LimitReached"


def _png() -> bytes:
    buf = io.BytesIO()
    Image.new("RGB", (64, 48), (10, 120, 200)).save(buf, "PNG")
    return buf.getvalue()


def _local(tmp_path, monkeypatch, port):
    monkeypatch.setenv("NAPKIN_LOCAL_USER", "shrey@acme")
    monkeypatch.delenv("TOKEN_SECRET", raising=False)
    monkeypatch.delenv("NAPKIN_LOCAL_TENANTS", raising=False)
    monkeypatch.delenv("LOCAL_CONFIG", raising=False)
    return local.build(port, tmp_path)


def test_a_restart_mid_job_polls_the_provider_again_and_the_job_lands(tmp_path, monkeypatch):
    try:
        relay, blobs = _local(tmp_path, monkeypatch, 8796)
        data = _png()
        sha = "sha256:" + hashlib.sha256(data).hexdigest()
        status, up, _ = relay.http("POST", "/uploads", {}, json.dumps({"sha256": sha, "mime": "image/png",
                                                                        "bytes": len(data)}).encode())
        assert status == 200, up
        blobs.put(f"in/{sha}", data, "image/png")
        job_id = new_id("job")
        req = {**envelope("generate", job_id), "input": {"text": "a hero", "refs": [
            {"id": new_id("node"), "role": "character", "kind": "drawing",
             "asset": {"sha256": sha, "url": up["url"], "mime": "image/png"}}]}}
        status, job, _ = relay.http("POST", "/jobs", {}, json.dumps(req).encode())
        assert status in (200, 201, 202), job
        assert job["state"] in ("submitted", "submitting"), job
        pid = relay.store.get_job(job_id)["participantId"]
        assert relay.store.counters(f"inflight#{pid}") == {"n": 1}

        del relay  # the relay stops, with the job at the (mock) provider
        relay, blobs = _local(tmp_path, monkeypatch, 8796)
        assert [j["jobId"] for j in relay.store.list_active("r")] == [job_id]
        deadline = time.time() + 15
        while time.time() < deadline:
            relay.sweep()  # what local.serve runs at start, then every 15 s
            done = relay.store.get_job(job_id)
            if done["state"] in ("completed", "failed", "cancelled"):
                break
            time.sleep(0.25)
    finally:
        identity.use_local(None)
    assert done["state"] == "completed", done
    out = done["outputs"][0]
    assert out["sha256"].startswith("sha256:") and blobs.exists(f"out/{out['sha256']}")
    assert relay.store.counters(f"inflight#{pid}") == {"n": 0}  # its in-flight slot came back
    # and a third start finds nothing left to resume
    relay, _ = _local(tmp_path, monkeypatch, 8796)
    identity.use_local(None)
    assert relay.store.list_active("r") == [] and relay.store.get_job(job_id)["state"] == "completed"


def test_a_job_past_its_time_still_lands_when_the_provider_finished_it():
    h = Harness()
    token = h.as_person()
    _, job = h.post_job(token)
    rid = h.store.get_job(job["jobId"])["requestId"]
    provider = h.providers[h.store.get_job(job["jobId"])["provider"]]
    provider.succeed(rid)
    h.clock.tick(h.cfg["jobTimeoutS"]["image"] + 60)  # nobody polled while it finished
    done = h.poll(token, job["jobId"])
    assert done["state"] == "completed" and provider.cancels == []


def test_a_job_past_its_time_still_running_is_cancelled_as_before():
    h = Harness()
    token = h.as_person()
    _, job = h.post_job(token)
    first = h.store.get_job(job["jobId"])
    h.clock.tick(h.cfg["jobTimeoutS"]["image"] + 60)
    out = h.poll(token, job["jobId"])
    assert out["state"] != "completed" and h.providers[first["provider"]].cancels == [first["requestId"]]


def test_every_memorystore_method_is_kept_on_disk_or_known_not_to_write():
    """A new MemoryStore write must be kept by FileStore too, or a restart loses it silently."""
    from store import MemoryStore
    reads = {"get_job", "list_active", "counters", "is_blocked", "holds", "claimed_by", "tenant", "all_tenants",
             "all_jobs", "counter_keys"}
    not_kept = {"put_tenant"}  # local.py sets the tenants at every start
    public = {n for n in vars(MemoryStore) if not n.startswith("_")}
    kept = {n for n in vars(FileStore) if not n.startswith("_")}
    assert public - reads - not_kept == kept
