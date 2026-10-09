"""Where artifacts live: S3 behind CloudFront (Lambda) or a local directory
served by the dev server. Keys: in/sha256:<hex> (uploads), out/sha256:<hex>
(provider outputs), ads/<jobId>.mp4 and ads/<jobId>.json (stitch),
library/<workspace>/… (the workspace library, library.py)."""

from __future__ import annotations

import hashlib
import json
import threading
import urllib.request
from pathlib import Path

FETCH_TIMEOUT_S = 60
MAX_FETCH_BYTES = 200 * 1024 * 1024
_LOCAL_LOCK = threading.Lock()


def http_fetch(url: str) -> bytes:
    req = urllib.request.Request(url, headers={"User-Agent": "napkin-relay/1"})
    with urllib.request.urlopen(req, timeout=FETCH_TIMEOUT_S) as r:  # noqa: S310 (provider output URLs)
        data = r.read(MAX_FETCH_BYTES + 1)
    if len(data) > MAX_FETCH_BYTES:
        raise ValueError("output larger than 200 MB")
    return data


def s3_client(region: str | None = None):
    """SigV4 on the regional endpoint: a presigned PUT from the browser must not
    hit a redirect (the global endpoint redirects new eu-west-1 buckets)."""
    import os

    import boto3
    from botocore.config import Config

    region = region or os.environ.get("AWS_REGION") or os.environ.get("AWS_DEFAULT_REGION") or "eu-west-1"
    return boto3.client("s3", region_name=region, endpoint_url=f"https://s3.{region}.amazonaws.com",
                        config=Config(signature_version="s3v4", s3={"addressing_style": "virtual"}))


class S3Blobs:
    def __init__(self, bucket: str, public_base: str, client=None):
        self.s3 = client or s3_client()
        self.bucket = bucket
        self.public_base = public_base.rstrip("/")

    def public_url(self, key: str) -> str:
        return f"{self.public_base}/{key}"

    def key_for_url(self, url: str) -> str | None:
        prefix = self.public_base + "/"
        return url[len(prefix):] if url.startswith(prefix) else None

    def exists(self, key: str) -> bool:
        try:
            self.s3.head_object(Bucket=self.bucket, Key=key)
            return True
        except self.s3.exceptions.ClientError as e:
            if e.response.get("Error", {}).get("Code") in ("404", "NoSuchKey", "NotFound"):
                return False
            raise

    def presign_put(self, key: str, mime: str) -> str:
        return self.s3.generate_presigned_url(
            "put_object", Params={"Bucket": self.bucket, "Key": key, "ContentType": mime}, ExpiresIn=900)

    def put(self, key: str, data: bytes, mime: str) -> None:
        self.s3.put_object(Bucket=self.bucket, Key=key, Body=data, ContentType=mime)

    def get_json(self, key: str) -> dict | None:
        try:
            r = self.s3.get_object(Bucket=self.bucket, Key=key)
        except self.s3.exceptions.NoSuchKey:
            return None
        return json.loads(r["Body"].read())

    def get_json_tagged(self, key: str) -> tuple[dict | None, str | None]:
        """The object and its ETag, for a conditional write back (put_json_if)."""
        try:
            r = self.s3.get_object(Bucket=self.bucket, Key=key)
        except self.s3.exceptions.NoSuchKey:
            return None, None
        return json.loads(r["Body"].read()), r["ETag"]

    def put_json_if(self, key: str, data: dict, etag: str | None) -> bool:
        """Write only if the object is still the one read (etag), or still absent (None).
        False when someone else wrote first: read again and retry."""
        cond = {"IfMatch": etag} if etag else {"IfNoneMatch": "*"}
        try:
            self.s3.put_object(Bucket=self.bucket, Key=key, Body=json.dumps(data).encode(),
                               ContentType="application/json", **cond)
            return True
        except self.s3.exceptions.ClientError as e:
            if e.response.get("Error", {}).get("Code") in ("PreconditionFailed", "ConditionalRequestConflict", "412", "409"):
                return False
            raise

    def fetch(self, url: str) -> bytes:
        key = self.key_for_url(url)
        if key:
            return self.s3.get_object(Bucket=self.bucket, Key=key)["Body"].read()
        return http_fetch(url)


class LocalBlobs:
    """Files under a directory, served by local.py at public_base."""

    def __init__(self, root: Path, public_base: str):
        self.root = Path(root)
        self.root.mkdir(parents=True, exist_ok=True)
        self.public_base = public_base.rstrip("/")

    def path(self, key: str) -> Path:
        p = (self.root / key).resolve()
        if not str(p).startswith(str(self.root.resolve())):
            raise ValueError("bad key")
        return p

    def public_url(self, key: str) -> str:
        return f"{self.public_base}/{key}"

    def key_for_url(self, url: str) -> str | None:
        prefix = self.public_base + "/"
        return url[len(prefix):] if url.startswith(prefix) else None

    def exists(self, key: str) -> bool:
        return self.path(key).exists()

    def presign_put(self, key: str, mime: str) -> str:
        return f"{self.public_base}/_upload/{key}"

    def put(self, key: str, data: bytes, mime: str) -> None:
        p = self.path(key)
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_bytes(data)
        p.with_name(p.name + ".mime").write_text(mime)

    def mime(self, key: str) -> str:
        m = self.path(key).with_name(self.path(key).name + ".mime")
        return m.read_text() if m.exists() else "application/octet-stream"

    def get_json(self, key: str) -> dict | None:
        p = self.path(key)
        return json.loads(p.read_text()) if p.exists() else None

    def get_json_tagged(self, key: str) -> tuple[dict | None, str | None]:
        p = self.path(key)
        if not p.exists():
            return None, None
        raw = p.read_bytes()
        return json.loads(raw), hashlib.sha256(raw).hexdigest()

    def put_json_if(self, key: str, data: dict, etag: str | None) -> bool:
        with _LOCAL_LOCK:
            _, now = self.get_json_tagged(key)
            if now != etag:
                return False
            self.put(key, json.dumps(data).encode(), "application/json")
            return True

    def fetch(self, url: str) -> bytes:
        key = self.key_for_url(url)
        if key:
            return self.path(key).read_bytes()
        return http_fetch(url)
