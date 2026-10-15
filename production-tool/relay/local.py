"""The relay on http://localhost:8787 with no AWS: in-memory ledger, quotas and
queue; uploads and outputs in .local-data/ (served at /in/, /out/, /ads/).

    cd production-tool/relay && uv run python -m local [--port 8787]

Who is asking (identity.py, features/os-sign-in.clan):
- Standalone (no TOKEN_SECRET): every request is the local person, NAPKIN_LOCAL_USER="handle@agency",
  else local@napkin. `npm run dev:relay` in production-tool/web uses this.
- Behind napkin-web (TOKEN_SECRET set to the same dev value as NAPKIN_PRODUCTION_RELAY_SECRET):
  every request must carry napkin-web's X-Napkin-Identity assertion, as on AWS.
Tenants on (in memory): NAPKIN_LOCAL_TENANTS="napkin,acme" (agencies), else napkin and the local
person's agency. Any other agency gets "not on for your agency".

Routes are served both bare (/jobs) and under /api (/api/jobs), as CloudFront does.

Config: LOCAL_CONFIG=<file> (re-read every 30 s), otherwise
contracts/examples/config.testing.json with every step routed to mock.
If providers/mock.py (harness lane) is missing, a stub stands in for it: it
returns an input asset after 2 s, labelled kind "mock".
"""

from __future__ import annotations

import argparse
import json
import logging
import os
import shutil
import sys
import threading
import time
import uuid
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

import cards
import cutout
import identity
from blobs import LocalBlobs
from contracts import Contracts
from contracts_dir import contracts_dir
from director import load_director
from providers import load_registry
from providers.base import Status, asset_url
from runtime import CachedConfig
from service import Raw, Relay
from store import MemoryStore

HERE = Path(__file__).resolve().parent
# Every header the web app sends. The browser preflights each one; a header missing here drops
# the request before it leaves the browser.
CORS_ALLOW_HEADERS = "Content-Type, If-Match, X-Clan-Reason, X-Project-Id, X-Project-Name, x-amz-checksum-sha256"
# Response headers the web app reads: GET /clan/{project} carries the project's ETag and when it was saved.
CORS_EXPOSE_HEADERS = "ETag, X-Saved-At"
log = logging.getLogger("relay.local")


def default_config() -> dict:
    cfg = json.loads((contracts_dir() / "examples" / "config.testing.json").read_text())
    cfg["routing"] = {op: ([] if op in ("shot_list", "stitch") else ["mock"]) for op in cfg["routing"]}
    # Fix this moment runs here end to end on the mock (an MP4 back as it went) and the real stitch:
    # on, and on the mock's own model (features/clip-moment-edit.clan).
    cfg["flags"]["clipPatch"] = True
    cfg.setdefault("clipPatch", {}).pop("model", None)
    return cfg


class StubMock:
    """Dev-only stand-in for the harness lane's Mock adapter."""

    name = "mock"

    def __init__(self, sheet: dict):
        self.sheet = sheet
        self.jobs: dict[str, dict] = {}

    def capabilities(self) -> dict:
        return self.sheet

    def submit(self, job: dict) -> str:
        rid = uuid.uuid4().hex
        shas = [job.get("firstFrame"), job.get("mask")] + [r["sha256"] for r in job.get("refs", [])]
        urls = []
        for sha in shas:
            if sha:
                try:
                    urls.append(asset_url(sha))
                except Exception:
                    pass
        self.jobs[rid] = {"at": time.time(), "url": urls[0] if urls else None}
        return rid

    def status(self, request_id: str) -> Status:
        j = self.jobs.get(request_id)
        if j is None:
            return Status(state="failed", error_code="provider_failed", error_message="unknown request")
        if time.time() - j["at"] < 2:
            return Status(state="running", queue_position=0)
        if not j["url"]:
            return Status(state="failed", error_code="provider_failed", error_message="mock stub had no input")
        ext = j["url"].rsplit(".", 1)[-1] if "." in j["url"].rsplit("/", 1)[-1] else ""
        return Status(state="succeeded", outputs=[{"url": j["url"], "mime": {"mp4": "video/mp4"}.get(ext, "image/png")}],
                      cost_usd=0)

    def cancel(self, request_id: str) -> None:
        self.jobs.pop(request_id, None)


def local_stitch(blobs: LocalBlobs):
    sys.path.insert(0, str(HERE.parent / "stitch"))
    try:
        import stitch  # production-tool/stitch/stitch.py
    except ImportError:
        return None
    if not shutil.which("ffmpeg"):
        return None

    def run(payload: dict) -> None:
        def work():
            stitch.run(payload, get=lambda key, dest: shutil.copy(blobs.path(key), dest),
                       put=lambda key, src, mime: blobs.put(key, Path(src).read_bytes(), mime),
                       put_json=lambda key, data: blobs.put(key, json.dumps(data).encode(), "application/json"),
                       ffmpeg="ffmpeg", ffprobe="ffprobe")
        threading.Thread(target=work, daemon=True).start()

    return run


def local_tenants(store: MemoryStore, agencies: list[str], limits: dict | None = None) -> None:
    """Turn these agencies on in the in-memory tenants table, each with `limits` (NAPKIN_LOCAL_LIMITS: a
    JSON object of tenant-item fields, e.g. {"capUsdMonthly": 1, "allow": {"claude": true, "makers": ["runway"]}},
    features/tenant-limits.clan), as scripts/tenants.py would set them."""
    now = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    for agency in agencies:
        store.put_tenant({**(limits or {}), "tenantId": identity.tenant_id(agency), "agency": agency, "enabled": True,
                          "updatedAt": now, "by": "local.py"})


def build(port: int, data_dir: Path) -> tuple[Relay, LocalBlobs]:
    signed = bool(identity.keys())
    # Standalone, every request is the local person; behind napkin-web, its signed assertion says who.
    identity.use_local(None if signed else identity.local_person())
    agencies = [a.strip() for a in os.environ.get("NAPKIN_LOCAL_TENANTS", "").split(",") if a.strip()]
    if not agencies:
        agencies = sorted({"napkin", identity.local_person()["t"]})
    contracts = Contracts(relaxed=True)  # http://localhost URLs pass
    cfg_file = os.environ.get("LOCAL_CONFIG")
    load = (lambda: json.loads(Path(cfg_file).read_text())) if cfg_file else default_config
    blobs = LocalBlobs(data_dir, f"http://localhost:{port}")
    registry = load_registry()
    from providers import _seam
    _seam.LOCAL_READER = lambda url: blobs.path(blobs.key_for_url(url)).read_bytes()
    if registry.get("mock") is None:
        sheet = json.loads((contracts_dir() / "capabilities" / "mock.json").read_text())
        registry.register(StubMock(sheet), sheet)
        log.warning("providers/mock.py not found: using the local stub")
    director = load_director()
    # Holds beside the bytes they are about, so a restart keeps every saved picture openable.
    store = MemoryStore(held_file=data_dir / "held.txt")
    local_tenants(store, agencies, json.loads(os.environ.get("NAPKIN_LOCAL_LIMITS") or "{}"))
    relay = Relay(store=store, blobs=blobs, registry=registry, director=director,
                  config=CachedConfig(load, contracts), contracts=contracts,
                  stitch=local_stitch(blobs), cards=cards.make(director, blobs, background=True),
                  # Rhea's server cut-out: the real model when CUTOUT_WEIGHTS names it, else the stand-in.
                  segmenter=cutout.from_env() or cutout.MockSegmenter())
    return relay, blobs


def serve(port: int, data_dir: Path) -> None:
    relay, blobs = build(port, data_dir)

    class Handler(BaseHTTPRequestHandler):
        def _cors(self):
            self.send_header("Access-Control-Allow-Origin", "*")
            self.send_header("Access-Control-Allow-Methods", "GET, HEAD, POST, PUT, DELETE, OPTIONS")
            self.send_header("Access-Control-Allow-Headers", CORS_ALLOW_HEADERS)
            self.send_header("Access-Control-Expose-Headers", CORS_EXPOSE_HEADERS)

        def _send(self, status: int, body: bytes = b"", ctype: str = "application/json", head=False, headers=None):
            self.send_response(status)
            self._cors()
            for k, v in (headers or {}).items():
                self.send_header(k, v)
            if status != 204:
                self.send_header("Content-Type", ctype)
                self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            if body and not head:
                self.wfile.write(body)

        def do_OPTIONS(self):
            self._send(204)

        def _file(self, head=False):
            key = self.path.split("?", 1)[0].lstrip("/")
            try:
                p = blobs.path(key)
            except ValueError:
                return self._send(404)
            if not p.exists():
                return self._send(404, b"{}")
            self._send(200, p.read_bytes(), blobs.mime(key), head=head)

        def do_HEAD(self):
            self._file(head=True)

        def do_PUT(self):
            if not self.path.startswith("/_upload/"):
                return self._relay()  # PUT /clan/{project}/canvas
            key = self.path[len("/_upload/"):].split("?", 1)[0]
            data = self.rfile.read(int(self.headers.get("Content-Length", 0)))
            # As S3 does with the presigned PUT's checksum (features/tenant-limits.clan): other bytes are refused.
            if not blobs.accept_upload(key, data, self.headers.get("Content-Type", "application/octet-stream"),
                                       self.headers.get("x-amz-checksum-sha256")):
                return self._send(400, b'{"error":"BadDigest"}')
            self._send(200, b"{}")

        def _relay(self):
            path, _, query = self.path.partition("?")
            if self.command == "GET" and path.lstrip("/").split("/", 1)[0] in ("in", "out", "ads"):
                return self._file()
            if self.command == "GET" and path == "/config.json":
                path = "/config"
            n = int(self.headers.get("Content-Length", 0) or 0)
            body = self.rfile.read(n) if n else None
            status, out, ctx = relay.http(self.command, path, dict(self.headers), body, query)
            print(json.dumps({k: v for k, v in ctx.items() if v is not None}, default=str), flush=True)
            if isinstance(out, Raw):
                return self._send(status, out.data, out.mime, headers=out.headers)
            self._send(status, json.dumps(out).encode() if out is not None else b"")

        do_GET = do_POST = do_DELETE = _relay

        def log_message(self, *args):
            pass

    def sweeper():
        while True:
            time.sleep(15)
            try:
                relay.sweep()
            except Exception:
                log.exception("sweep failed")

    threading.Thread(target=sweeper, daemon=True).start()
    server = ThreadingHTTPServer(("127.0.0.1", port), Handler)
    me = identity.who("GET", "/me", {}, None)
    who = f"as {me['h']}@{me['t']} ({me['pid']})" if me else "verifying napkin-web's X-Napkin-Identity (TOKEN_SECRET)"
    print(f"relay (local) on http://localhost:{port}  {who}  data: {data_dir}", flush=True)
    server.serve_forever()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--port", type=int, default=8787)
    ap.add_argument("--data", default=str(HERE / ".local-data"))
    a = ap.parse_args()
    logging.basicConfig(level=logging.INFO)
    serve(a.port, Path(a.data))


if __name__ == "__main__":
    main()
