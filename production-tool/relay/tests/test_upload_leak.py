"""The upload leak between agencies, closed (features/tenant-limits.clan): POST /uploads says that bytes
exist only to an agency that holds them (has#: it uploaded them first, or the relay made them for it);
anyone else gets a PUT bound to the hash, so knowing a hash neither reveals a file nor overwrites it."""

import hashlib

from blobs import LocalBlobs, checksum_header
from conftest import CDN, Harness, base_config
from identity import tenant_id


def sha_of(data: bytes) -> str:
    return "sha256:" + hashlib.sha256(data).hexdigest()


def upload(h: Harness, token: str, sha: str) -> dict:
    return h.call("POST", "/uploads", {"sha256": sha, "mime": "image/png", "bytes": 3}, token, expect=200)[1]


class RecordingBlobs:
    """Wraps the fake blob store to record the hash each presigned PUT is bound to."""

    def __init__(self, inner):
        self.inner, self.bound = inner, []

    def presign_put(self, key, mime, sha256):
        self.bound.append((key, sha256))
        return self.inner.presign_put(key, mime, sha256)

    def __getattr__(self, name):
        return getattr(self.inner, name)


def test_another_agency_is_never_told_of_a_file():
    h = Harness(base_config())
    a, b = h.as_person("ann", team="blue"), h.as_person("bob", team="green")
    sha = sha_of(b"png")
    first = upload(h, a, sha)
    assert first["exists"] is False and "putUrl" in first
    h.blobs.put(f"in/{sha}", b"png", "image/png")  # ann's browser PUT it
    assert upload(h, a, sha) == {"exists": True, "url": f"{CDN}/in/{sha}"}  # ann holds it
    theirs = upload(h, b, sha)
    assert theirs["exists"] is False and theirs["putUrl"]  # bob must send the bytes himself
    assert not h.store.holds(tenant_id("green"), sha)
    assert upload(h, b, sha)["exists"] is False  # and is never told, however often he asks


def test_a_relay_output_is_held_by_the_agency_it_was_made_for():
    h = Harness(base_config())
    a, b = h.as_person("ann", team="blue"), h.as_person("bob", team="green")
    _, job = h.post_job(a, expect=200)
    h.providers[job["provider"]].succeed(job["requestId"], data=b"made")
    h.clock.tick(5)
    done = h.poll(a, job["jobId"])
    sha = done["outputs"][0]["sha256"]
    assert upload(h, a, sha) == {"exists": True, "url": f"{CDN}/out/{sha}"}
    assert upload(h, b, sha)["exists"] is False


def test_every_presigned_put_is_bound_to_its_hash():
    h = Harness(base_config())
    rec = RecordingBlobs(h.blobs)
    h.relay.blobs = rec
    sha = sha_of(b"x")
    upload(h, h.as_person(), sha)
    assert rec.bound == [(f"in/{sha}", sha)]
    assert checksum_header(sha) == "LXEWQrcmsEQBYnyp+6wy9chTD7GQPMTbAiWHF5IaSIE="


def test_the_local_relay_refuses_other_bytes_as_s3_does(tmp_path):
    blobs = LocalBlobs(tmp_path, "http://localhost:8787")
    sha = sha_of(b"real")
    assert not blobs.accept_upload(f"in/{sha}", b"fake", "image/png", checksum_header(sha))
    assert not blobs.accept_upload(f"in/{sha}", b"real", "image/png", None)  # no checksum header
    assert not blobs.exists(f"in/{sha}")
    assert blobs.accept_upload(f"in/{sha}", b"real", "image/png", checksum_header(sha))
    assert blobs.get(f"in/{sha}") == b"real"
