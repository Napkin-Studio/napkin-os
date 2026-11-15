"""Where artifacts live: S3 behind CloudFront (Lambda) or a local directory
served by the dev server. Keys: in/sha256:<hex> (uploads), out/sha256:<hex>
(provider outputs), ads/<jobId>.mp4 and ads/<jobId>.json (stitch), ads/cuts/<jobId>.* (a cutdown),
library/<participantId>/… (the person's library, library.py), clan/<participantId>/… (saved
projects, projects.py) and cards/<hex>.json (cards.py).

get, list_keys and delete are for reading a saved project back and for scripts/prune_workspaces.py."""

from __future__ import annotations

import base64
import hashlib
import http.client
import ipaddress
import json
import re
import socket
import ssl
import threading
import urllib.parse
from datetime import datetime, timezone
from pathlib import Path

FETCH_TIMEOUT_S = 60
MAX_FETCH_BYTES = 200 * 1024 * 1024
_LOCAL_LOCK = threading.Lock()
_loopback_ok = False   # local.py serves its own blobs on localhost: only it turns this on


class UnsafeUrl(ValueError):
    """A URL the relay will not fetch: not one of its own blobs, not https, a private address, or a redirect."""


def allow_loopback(on: bool) -> None:
    """local.py only: its blobs and the mock's inputs are served on http://localhost."""
    global _loopback_ok
    _loopback_ok = bool(on)


# IPv6 ranges that carry or translate to an IPv4 address, or are deprecated site-local: is_global passes some of them
# (64:ff9b::/96 NAT64, ::a.b.c.d IPv4-compatible, fec0::/10), so they are refused whatever they embed.
_V6_REFUSED = [ipaddress.ip_network(n) for n in ("::/96", "::ffff:0:0/96", "64:ff9b::/96", "64:ff9b:1::/48",
                                                 "2002::/16", "2001::/32", "fec0::/10", "100::/64")]


def _public(ip) -> bool:
    if ip.version == 6 and any(ip in n for n in _V6_REFUSED):
        return False
    return ip.is_global and not ip.is_multicast


def _vetted_address(host: str, port: int) -> str:
    """The address to connect to: every address the host resolves to must be a public one (no private,
    loopback, link-local, metadata or reserved address, even behind a public-looking name)."""
    try:
        infos = socket.getaddrinfo(host, port, type=socket.SOCK_STREAM)
    except socket.gaierror as e:
        raise UnsafeUrl(f"{host} does not resolve") from e
    addrs = [info[4][0] for info in infos]
    if not addrs:
        raise UnsafeUrl(f"{host} does not resolve")
    for a in addrs:
        ip = ipaddress.ip_address(a.split("%", 1)[0])
        if not (_public(ip) or (_loopback_ok and ip.is_loopback)):
            raise UnsafeUrl(f"{host} resolves to an address the relay does not fetch from")
    return addrs[0]


class _PinnedHTTPS(http.client.HTTPSConnection):
    """HTTPS to the vetted address, the certificate checked against the host name (no second lookup)."""

    def __init__(self, host: str, port: int, address: str, timeout: float):
        super().__init__(host, port, timeout=timeout, context=ssl.create_default_context())
        self._address = address

    def connect(self):
        sock = socket.create_connection((self._address, self.port), self.timeout)
        self.sock = self._context.wrap_socket(sock, server_hostname=self.host)


class _PinnedHTTP(http.client.HTTPConnection):
    def __init__(self, host: str, port: int, address: str, timeout: float):
        super().__init__(host, port, timeout=timeout)
        self._address = address

    def connect(self):
        self.sock = socket.create_connection((self._address, self.port), self.timeout)


def checksum_header(sha256: str) -> str:
    """The x-amz-checksum-sha256 value for a 'sha256:<hex>' hash: the digest in base64."""
    return base64.b64encode(bytes.fromhex(sha256.removeprefix("sha256:"))).decode()


def http_fetch(url: str) -> bytes:
    """A provider's output (or the mock's input) over the network: https only (http on localhost when local.py
    allows it), to a public address only, and a redirect is refused, never followed
    (features/production-platform-rules.clan, review C)."""
    if url.startswith("data:"):   # bytes in the URL itself (the mock's, local.py's inlined assets): no request
        head, _, body = url.partition(",")
        data = base64.b64decode(body) if head.endswith(";base64") else urllib.parse.unquote_to_bytes(body)
        if len(data) > MAX_FETCH_BYTES:
            raise ValueError("output larger than 200 MB")
        return data
    u = urllib.parse.urlsplit(url)
    if u.scheme not in ("https", "http") or not u.hostname or u.username or u.password:
        raise UnsafeUrl("only an https URL is fetched")
    if u.scheme == "http" and not _loopback_ok:
        raise UnsafeUrl("only an https URL is fetched")
    port = u.port or (443 if u.scheme == "https" else 80)
    address = _vetted_address(u.hostname, port)
    conn = (_PinnedHTTPS if u.scheme == "https" else _PinnedHTTP)(u.hostname, port, address, FETCH_TIMEOUT_S)
    try:
        conn.request("GET", (u.path or "/") + (f"?{u.query}" if u.query else ""),
                     headers={"User-Agent": "napkin-relay/1"})
        r = conn.getresponse()
        if 300 <= r.status < 400:
            raise UnsafeUrl(f"the server answered with a redirect ({r.status}); it is not followed")
        if r.status >= 400:
            raise OSError(f"HTTP {r.status} from {u.hostname}")
        data = r.read(MAX_FETCH_BYTES + 1)
    finally:
        conn.close()
    if len(data) > MAX_FETCH_BYTES:
        raise ValueError("output larger than 200 MB")
    return data


# Keys a request's URL may name. in/ and out/ are content-addressed (in/sha256:<hex>, out/sha256:<hex>) and ads/ holds
# stitched and cut films: CloudFront serves all three publicly by design (infra/envs/hackathon/storage.tf), so reading
# one here tells the caller nothing the CDN would not. Everything else is private: tenants/<id>/ (saved projects, the
# library, canvases) is read only by its own agency; clan/, library/, dogfood/ and cards/ never on a URL's word.
SHA_KEY = re.compile(r"^(in|out)/sha256:[0-9a-f]{64}$")
ADS_KEY = re.compile(r"^ads/[A-Za-z0-9_-]+(/[A-Za-z0-9_@-]+)*\.[a-z0-9]{2,5}$")
TENANT_KEY = re.compile(r"^tenants/([0-9a-f-]{36})/[A-Za-z0-9_./@-]+$")
NOT_OURS = "That file is not one of ours, so it was not read."


def own_key(blobs, url: str, tenant: str | None = None) -> str:
    """The key of one of the relay's own blobs a request's URL names, or UnsafeUrl before any read: a public
    artifact (in/, out/ by hash, ads/), or the calling agency's own tenants/<tenant>/ space. The answer turns on the
    key alone, never on whether the object exists, so it is no oracle (features/production-platform-rules.clan,
    review C and the review of 25e7c870)."""
    key = blobs.key_for_url(url or "") if isinstance(url, str) else None
    if not key or any(p in ("", ".", "..") for p in key.split("/")) or any(c in key for c in "\\%?#"):
        raise UnsafeUrl(NOT_OURS)
    if SHA_KEY.match(key) or ADS_KEY.match(key):
        return key
    m = TENANT_KEY.match(key)
    if m and tenant and m.group(1) == tenant:
        return key
    raise UnsafeUrl(NOT_OURS)


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

    def presign_put(self, key: str, mime: str, sha256: str) -> str:
        """A 15-minute PUT bound to the bytes' hash (features/tenant-limits.clan): the URL signs
        x-amz-checksum-sha256, the browser sends it, and S3 refuses any other bytes."""
        return self.s3.generate_presigned_url(
            "put_object", Params={"Bucket": self.bucket, "Key": key, "ContentType": mime,
                                  "ChecksumSHA256": checksum_header(sha256)}, ExpiresIn=900)

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
        """A provider's output: our own blob by key, else http_fetch (public https, no redirect). Never for a
        URL a request names: that is fetch_own."""
        key = self.key_for_url(url)
        if key:
            return self.s3.get_object(Bucket=self.bucket, Key=key)["Body"].read()
        return http_fetch(url)

    def fetch_own(self, url: str, tenant: str | None = None) -> bytes:
        """A URL a request names: one of our own blobs the calling agency may read (own_key), or UnsafeUrl
        before any read. A missing object answers the same as a refused one."""
        key = own_key(self, url, tenant)
        try:
            return self.s3.get_object(Bucket=self.bucket, Key=key)["Body"].read()
        except self.s3.exceptions.NoSuchKey:
            raise UnsafeUrl(NOT_OURS) from None

    def clip_seconds(self, url: str, tenant: str | None = None) -> float | None:
        """A stored clip's real length (cliplength.py), from our own bytes: never from the request."""
        from cliplength import mp4_seconds
        return mp4_seconds(self.fetch_own(url, tenant))

    def get(self, key: str) -> bytes | None:
        try:
            return self.s3.get_object(Bucket=self.bucket, Key=key)["Body"].read()
        except self.s3.exceptions.NoSuchKey:
            return None

    def list_keys(self, prefix: str) -> list[dict]:
        """Every object under prefix: {key, bytes, modified (UTC ISO)}."""
        out = []
        for page in self.s3.get_paginator("list_objects_v2").paginate(Bucket=self.bucket, Prefix=prefix):
            for o in page.get("Contents", []):
                out.append({"key": o["Key"], "bytes": o["Size"],
                            "modified": o["LastModified"].astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")})
        return out

    def delete(self, keys: list[str]) -> None:
        for i in range(0, len(keys), 1000):
            self.s3.delete_objects(Bucket=self.bucket, Delete={"Objects": [{"Key": k} for k in keys[i:i + 1000]], "Quiet": True})


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

    def presign_put(self, key: str, mime: str, sha256: str) -> str:
        return f"{self.public_base}/_upload/{key}"

    def accept_upload(self, key: str, data: bytes, mime: str, checksum: str | None) -> bool:
        """local.py's stand-in for S3's checksum check: the bytes must hash to the key's sha256 and
        to the x-amz-checksum-sha256 header the web sends. False: refused, nothing written."""
        name = key.rsplit("/", 1)[-1]
        if not name.startswith("sha256:"):
            return False
        if checksum != checksum_header(name) or "sha256:" + hashlib.sha256(data).hexdigest() != name:
            return False
        self.put(key, data, mime)
        return True

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

    def fetch_own(self, url: str, tenant: str | None = None) -> bytes:
        """A URL a request names: one of our own blobs the calling agency may read (own_key), or UnsafeUrl."""
        p = self.path(own_key(self, url, tenant))
        if not p.exists():
            raise UnsafeUrl(NOT_OURS)
        return p.read_bytes()

    def clip_seconds(self, url: str, tenant: str | None = None) -> float | None:
        """A stored clip's real length (cliplength.py), from our own bytes: never from the request."""
        from cliplength import mp4_seconds
        return mp4_seconds(self.fetch_own(url, tenant))

    def get(self, key: str) -> bytes | None:
        p = self.path(key)
        return p.read_bytes() if p.exists() else None

    def list_keys(self, prefix: str) -> list[dict]:
        """Every file under prefix (not the .mime notes beside them): {key, bytes, modified}."""
        root = self.root.resolve()
        out = []
        for p in sorted(root.rglob("*")):
            if not p.is_file() or p.name.endswith(".mime"):
                continue
            key = p.relative_to(root).as_posix()
            if key.startswith(prefix):
                st = p.stat()
                out.append({"key": key, "bytes": st.st_size,
                            "modified": datetime.fromtimestamp(st.st_mtime, timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")})
        return out

    def delete(self, keys: list[str]) -> None:
        for k in keys:
            p = self.path(k)
            for f in (p, p.with_name(p.name + ".mime")):
                f.unlink(missing_ok=True)
