"""Hand fakes: a clock, a blob store, providers that do what a test tells them."""

from __future__ import annotations

import copy
import hashlib
import json
import os

import pytest

from contracts import Contracts, api
from contracts_dir import contracts_dir
from director import PassthroughDirector, new_id
from providers import Registry
from providers.base import Status
from service import Relay
from store import MemoryStore

os.environ.setdefault("AWS_DEFAULT_REGION", "eu-west-1")
CDN = "https://cdn.test"
SECRET = "test-secret-0123456789abcdef"


class Clock:
    def __init__(self, t: float = 1_791_360_000.0):  # 2026-10-07
        self.t = t

    def __call__(self) -> float:
        return self.t

    def tick(self, s: float) -> None:
        self.t += s


class FakeBlobs:
    def __init__(self):
        self.objects: dict[str, tuple[bytes, str]] = {}
        self.remote: dict[str, bytes] = {}  # provider output URLs

    def public_url(self, key):
        return f"{CDN}/{key}"

    def key_for_url(self, url):
        return url[len(CDN) + 1:] if url.startswith(CDN + "/") else None

    def exists(self, key):
        return key in self.objects

    def presign_put(self, key, mime):
        return f"https://bucket.s3.test/{key}?X-Amz-Signature=x"

    def put(self, key, data, mime):
        self.objects[key] = (data, mime)

    def get_json(self, key):
        return json.loads(self.objects[key][0]) if key in self.objects else None

    def fetch(self, url):
        return self.remote[url]


class FakeProvider:
    """Submit and status do whatever the test queued up; every call is recorded."""

    def __init__(self, name: str, sheet: dict, blobs: FakeBlobs):
        self.name, self.sheet, self.blobs = name, sheet, blobs
        self.submits: list[dict] = []
        self.status_calls: list[str] = []
        self.cancels: list[str] = []
        self.submit_effect = None       # an exception to raise
        self.states: dict[str, Status] = {}

    def capabilities(self):
        return self.sheet

    def submit(self, job):
        self.submits.append(job)
        if self.submit_effect is not None:
            raise self.submit_effect
        rid = f"{self.name}-{len(self.submits)}"
        self.states[rid] = Status(state="running", queue_position=0)
        return rid

    def status(self, rid):
        self.status_calls.append(rid)
        return self.states[rid]

    def cancel(self, rid):
        self.cancels.append(rid)

    def succeed(self, rid, data: bytes = b"png-bytes", cost: float | None = None):
        url = f"https://provider.test/{rid}.png"
        self.blobs.remote[url] = data
        self.states[rid] = Status(state="succeeded", outputs=[{"url": url, "mime": "image/png", "w": 64, "h": 64}],
                                  cost_usd=cost)


def sheets() -> dict:
    out = {}
    for p in (contracts_dir() / "capabilities").glob("*.json"):
        s = json.loads(p.read_text())
        out[s["provider"]] = s
    return out


def base_config(**over) -> dict:
    cfg = json.loads((contracts_dir() / "examples" / "config.testing.json").read_text())
    cfg["routing"] = {"generate": ["fal", "runway"], "combine": ["runway"], "view": ["runway"], "shot_list": [],
                      "frame": ["runway"], "region_edit": ["runway"], "clip": ["runway"], "clip_edit": ["runway"],
                      "stitch": []}
    cfg["inFlightPerParticipant"] = 6
    for k, v in over.items():
        cfg[k] = v
    return cfg


class Harness:
    def __init__(self, config: dict | None = None, providers=("fal", "runway")):
        self.clock = Clock()
        self.blobs = FakeBlobs()
        self.store = MemoryStore()
        self.cfg = config or base_config()
        all_sheets = sheets()
        self.providers = {n: FakeProvider(n, copy.deepcopy(all_sheets[n]), self.blobs) for n in providers}
        reg = Registry()
        for p in self.providers.values():
            reg.register(p, p.sheet)
        self.stitched: list[dict] = []
        self.contracts = Contracts()
        self.relay = Relay(store=self.store, blobs=self.blobs, registry=reg, director=PassthroughDirector(),
                           config=lambda: self.cfg,
                           secrets=lambda: {"event_codes": {"participant": ["HACK"], "organiser": ["ORGS"]},
                                            "token_secret": SECRET},
                           clock=self.clock, stitch=self.stitched.append, contracts=self.contracts)

    # every response is checked against relay-api.schema.json
    def call(self, method, path, body=None, token=None, expect=None, headers=None):
        headers = {**({"Authorization": f"Bearer {token}"} if token else {}), **(headers or {})}
        raw = json.dumps(body).encode() if body is not None else None
        status, out, ctx = self.relay.http(method, path, headers, raw)
        if status >= 400:
            assert not self.contracts.errors(api("ErrorResponse"), out), out
        elif status == 204:
            assert out is None
        else:
            name = {"/session": "SessionResponse", "/uploads": "UploadResponse"}.get(path, "Job")
            if path == "/config":
                name = None
            if name:
                assert not self.contracts.errors(api(name), out), (self.contracts.errors(api(name), out), out)
            if name == "Job" and "error" in out:
                assert out["state"] in ("failed", "uncertain"), out
            if name == "Job" and out["state"] == "completed":
                assert "error" not in out
        if expect is not None:
            assert status == expect, (status, out)
        return status, out

    def sign_in(self, handle="alice", code="HACK") -> str:
        _, out = self.call("POST", "/session", {"eventCode": code, "handle": handle}, expect=200)
        return out["token"]

    def post_job(self, token, op="generate", job_id=None, expect=None, **inp):
        job_id = job_id or new_id("job")
        return self.call("POST", "/jobs", job_request(op, job_id, **inp), token, expect=expect)

    def poll(self, token, job_id, expect=200):
        return self.call("GET", f"/jobs/{job_id}", None, token, expect=expect)[1]


def asset(n: int = 1, mime="image/png") -> dict:
    sha = "sha256:" + hashlib.sha256(str(n).encode()).hexdigest()
    return {"sha256": sha, "url": f"{CDN}/in/{sha}", "mime": mime}


def job_request(op: str, job_id: str, **inp) -> dict:
    if not inp:
        inp = {
            "generate": {"text": "a hero", "sketch": asset(1)},
            "view": {"view": "side", "character": {"front": asset(2)}},
            "clip": {"image": asset(3), "character": {"front": asset(2)}},
            "shot_list": {"script": "A hero walks in. She smiles. The logo shows.", "targetS": 15},
            "stitch": {"clips": [{"asset": {**asset(4, "video/mp4"), "url": f"{CDN}/out/{asset(4)['sha256']}"}, "trimS": 4}]},
        }[op]
    return {"contractVersion": "1", "jobId": job_id, "op": op, "parentIds": [], "input": inp}


@pytest.fixture
def h():
    return Harness()
