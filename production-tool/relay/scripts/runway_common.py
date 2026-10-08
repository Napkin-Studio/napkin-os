"""Shared by runway_smoke.py and runway_testpack.py: the key, the spend cap, polling.

Both scripts are dry runs unless given --live. The key comes from the environment
variable RUNWAYML_API_SECRET and is only ever printed as "set (N chars)".
A moderated job is never retried: nothing here resubmits anything.
"""

from __future__ import annotations

import base64
import dataclasses
import hashlib
import io
import math
import os
import random
import re
import sys
import threading
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Callable, Optional
from urllib.parse import urlsplit

import httpx
from PIL import Image

RELAY = Path(__file__).resolve().parents[1]
if str(RELAY) not in sys.path:
    sys.path.insert(0, str(RELAY))

from providers import (  # noqa: E402
    AssetRef, CapabilityMissing, ProviderError, ProviderJob, Status, load_sheet, video_audio,
)
from providers.types import effective_sheet  # noqa: E402
from providers.runway import RunwayProvider, min_poll_s  # noqa: E402

KEY_ENV = "RUNWAYML_API_SECRET"
KEY_HELP = "Put the key in the environment first:  set -a; source .env; set +a   (this script never opens .env)"
DEFAULT_MAX_USD = 15.0
TERMINAL = ("done", "failed", "cancelled")
JITTER_S = 2.0

# The sheet has no per-op timeout, so these apply unless an op carries `timeoutS`.
TIMEOUT_S = {"image": 240, "clip": 600, "clip_edit": 900}

# gemini_image3_pro's 1K ratios (openapi): the region edit's original is cropped to one of them.
PRO_RATIOS = ("1344:768", "768:1344", "1024:1024", "1184:864", "864:1184", "1536:672",
              "832:1248", "1248:832", "896:1152", "1152:896")
IMAGE_RATIO = "1024:1024"
CLIP_RATIO = "1280:720"
DATA_URI_MAX = 5 * 1024 * 1024  # Runway's limit for an encoded image data URI
GATE_NOTE = "thresholds untuned, judged on the raw model output"
EXT = {"image/png": "png", "image/jpeg": "jpg", "image/webp": "webp", "video/mp4": "mp4"}
UPLOAD_NOTE = "will upload the first frame to Runway (free, ephemeral)"
UPLOADS_URL = "https://api.dev.runwayml.com/v1/uploads"
UPLOADS_VERSION = "2024-11-06"


def is_https(url: Optional[str]) -> bool:
    return bool(url) and urlsplit(url).scheme == "https"


def key_status(env: dict) -> str:
    key = env.get(KEY_ENV)
    return f"set ({len(key)} chars)" if key else "missing"


def redact_url(url: str) -> str:
    """Scheme, host and path only: a signed URL's query is a credential."""
    parts = urlsplit(url)
    return f"{parts.scheme}://{parts.netloc}{parts.path}"


def scrub(text: str) -> str:
    """Text with the query dropped from any URL in it: an error message can carry a signed URL."""
    return re.sub(r"(https?://[^\s?'\"]+)\?\S*", r"\1", text)


def open_rgb(data: bytes) -> Image.Image:
    """The image as RGB. A transparent one is laid on white first, so its hidden pixels do not turn black."""
    img = Image.open(io.BytesIO(data))
    if img.mode in ("RGBA", "LA", "PA") or "transparency" in img.info:
        img = img.convert("RGBA")
        flat = Image.new("RGBA", img.size, (255, 255, 255, 255))
        flat.alpha_composite(img)
        return flat.convert("RGB")
    return img.convert("RGB")


def timeout_for(sheet: dict, op: str) -> int:
    kind = op if op in ("clip", "clip_edit") else "image"
    return sheet["ops"][op].get("timeoutS") or TIMEOUT_S[kind]


def estimate_usd(sheet: dict, op: str) -> float:
    return sheet["ops"][op]["estimateUsd"]


def sheet_with_model(sheet: dict, op: str, model: str) -> dict:
    """A copy of the sheet that sends `model` for `op`. A model the sheet lists as an alternate
    brings its own price and settings (effective_sheet); any other only replaces the name."""
    if any(a["model"] == model for a in sheet["ops"][op].get("alternates", [])):
        return effective_sheet(sheet, op, model)
    ops = {**sheet["ops"], op: {**sheet["ops"][op], "model": model}}
    return {**sheet, "ops": ops}


def make_job(sheet: dict, op: str, prompt: str, **kw) -> ProviderJob:
    job = ProviderJob(op=op, provider="runway", model=sheet["ops"][op]["model"], prompt=prompt, **kw)
    if op in ("clip", "clip_edit"):
        job.audio = video_audio(job)
    return job


def percentile(values: list[float], p: float) -> Optional[float]:
    """Nearest-rank percentile."""
    if not values:
        return None
    ordered = sorted(values)
    return round(ordered[max(0, math.ceil(p / 100 * len(ordered)) - 1)], 2)


# Inputs: the adapter reads an asset by hash, so each input gets a hash and is registered here.

class Assets:
    """An AssetResolver for the scripts. A public URL is registered under the hash of the URL
    (the relay would hash the bytes); uploaded bytes go out as a data URI."""

    def __init__(self):
        self._refs: dict[str, AssetRef] = {}

    def add_url(self, url: str, mime: str) -> str:
        sha = "sha256:" + hashlib.sha256(url.encode()).hexdigest()
        self._refs[sha] = AssetRef(sha, url, mime)
        return sha

    def upload(self, data: bytes, mime: str) -> AssetRef:
        sha = "sha256:" + hashlib.sha256(data).hexdigest()
        uri = f"data:{mime};base64," + base64.b64encode(data).decode()
        if len(uri) > DATA_URI_MAX:
            raise ProviderError("invalid_input", "the image is over Runway's 5 MB data-URI limit", False)
        self._refs[sha] = AssetRef(sha, uri, mime)
        return self._refs[sha]

    def add_uploaded(self, data: bytes, mime: str, runway_uri: str) -> str:
        """Register bytes already uploaded to Runway: the adapter sends the runway:// uri as is."""
        sha = "sha256:" + hashlib.sha256(data).hexdigest()
        self._refs[sha] = AssetRef(sha, runway_uri, mime)
        return sha

    def __call__(self, sha: str) -> AssetRef:
        return self._refs[sha]


def _upload_failed(step: str, resp: httpx.Response) -> ProviderError:
    return ProviderError("provider_failed", f"Runway upload {step} failed: HTTP {resp.status_code} "
                         f"{scrub(resp.text[:200])}", False)


def ephemeral_upload(client: httpx.Client, api_key: str, data: bytes, mime: str, filename: str) -> str:
    """Upload bytes to Runway's ephemeral store (free, valid 24 h) and return the runway:// uri.
    Step 1 asks POST /v1/uploads for a presigned form; step 2 posts the form fields and then the file."""
    headers = {"Authorization": f"Bearer {api_key}", "X-Runway-Version": UPLOADS_VERSION}
    try:
        resp = client.post(UPLOADS_URL, headers=headers, json={"filename": filename, "type": "ephemeral"})
        if not resp.is_success:
            raise _upload_failed("request", resp)
        info = resp.json()
        upload_url, fields, runway_uri = info["uploadUrl"], info["fields"], info["runwayUri"]
        # No Authorization here: the presigned form is the credential, and the host is not Runway's API.
        resp = client.post(upload_url, data=fields, files={"file": (filename, data, mime)})
        if not resp.is_success:
            raise _upload_failed("transfer", resp)
    except (ValueError, KeyError, TypeError) as exc:  # a reply that is not the documented shape
        raise ProviderError("provider_failed", f"Runway upload reply was not understood ({type(exc).__name__})",
                            False) from exc
    except httpx.TransportError as exc:
        raise ProviderError("provider_failed", f"Runway upload could not be reached: {type(exc).__name__}",
                            False) from exc
    return runway_uri


def first_frame_ref(assets: Assets, client: httpx.Client, api_key: str, fetch: Callable[[str], bytes],
                    url: str) -> str:
    """A clip's first frame. An https URL is used as is. Anything else (Runway rejects a data URI here)
    is fetched once, shrunk, uploaded ephemerally, and registered under its runway:// uri."""
    if is_https(url):
        return assets.add_url(url, "image/png")
    data, mime = fit_image(fetch(url))
    uri = ephemeral_upload(client, api_key, data, mime, f"first_frame.{EXT[mime]}")
    return assets.add_uploaded(data, mime, uri)


def _data_uri_len(n_bytes: int, mime: str) -> int:
    return len(f"data:{mime};base64,") + 4 * math.ceil(n_bytes / 3)


def fit_image(data: bytes) -> tuple[bytes, str]:
    """The image as a PNG, or a JPEG when the PNG is too big, shrunk until its data URI fits Runway's limit."""
    img = open_rgb(data)
    while True:
        for fmt, mime, opts in (("PNG", "image/png", {}), ("JPEG", "image/jpeg", {"quality": 90})):
            out = io.BytesIO()
            img.save(out, format=fmt, **opts)
            if _data_uri_len(out.tell(), mime) <= DATA_URI_MAX:
                return out.getvalue(), mime
        img = img.resize((max(1, img.width * 3 // 4), max(1, img.height * 3 // 4)), Image.LANCZOS)


def image_ref(assets: "Assets", fetch: Callable[[str], bytes], url: str) -> str:
    """Fetch the source once and register it as a data URI: Runway fetches no http(s) URL of ours
    for an image op, only https, so the bytes go inline."""
    data, mime = fit_image(fetch(url))
    return assets.upload(data, mime).sha256


def prepare_image(data: bytes) -> tuple[bytes, str]:
    """Centre-crop and resize to the nearest ratio gemini_image3_pro accepts, so the region
    edit's result has the original's shape. Returns the PNG and its ratio string."""
    img = open_rgb(data)
    aspect = math.log(img.width / img.height)

    def distance(r: str) -> float:
        w, h = map(int, r.split(":"))
        return abs(math.log(w / h) - aspect)

    ratio = min(PRO_RATIOS, key=distance)
    w, h = map(int, ratio.split(":"))
    scale = max(w / img.width, h / img.height)
    cw, ch = min(img.width, round(w / scale)), min(img.height, round(h / scale))
    left, top = (img.width - cw) // 2, (img.height - ch) // 2
    img = img.crop((left, top, left + cw, top + ch)).resize((w, h), Image.LANCZOS)
    out = io.BytesIO()
    img.save(out, format="PNG")
    return out.getvalue(), ratio


# The client and the raw task status

class Tap:
    """Records the raw task status of every poll. The adapter folds THROTTLED into
    "queued", and the test pack wants the time spent throttled on its own."""

    def __init__(self, clock: Callable[[], float] = time.monotonic):
        self._clock = clock
        self._seen: dict[str, list[tuple[float, str]]] = {}

    def hook(self, resp: httpx.Response) -> None:
        path = resp.request.url.path
        if resp.request.method != "GET" or not path.startswith("/v1/tasks/"):
            return
        resp.read()
        try:
            raw = resp.json().get("status")
        except (ValueError, AttributeError):
            return
        self._seen.setdefault(path.rsplit("/", 1)[1], []).append((self._clock(), raw))

    def throttled_s(self, request_id: str) -> float:
        seen = self._seen.get(request_id, [])
        return round(sum(b[0] - a[0] for a, b in zip(seen, seen[1:]) if a[1] == "THROTTLED"), 2)


def make_client(tap: Optional[Tap] = None, transport: Optional[httpx.BaseTransport] = None) -> httpx.Client:
    hooks = {"response": [tap.hook]} if tap else {}
    return httpx.Client(timeout=30, transport=transport, event_hooks=hooks)


def default_factory(key: str, assets: Assets, tap: Tap, sheet: Optional[dict] = None) -> RunwayProvider:
    return RunwayProvider(key, assets, make_client(tap), sheet)


# Spend cap and polling

class BudgetExceeded(Exception):
    """The next job would take the run past --max-usd."""


class Budget:
    """--max-usd, enforced before each submit. Counts the estimate of a job in flight,
    then its real cost once the task ends."""

    def __init__(self, cap_usd: float):
        self.cap, self.spent = cap_usd, 0.0
        self._lock = threading.Lock()

    def reserve(self, est: float) -> None:
        with self._lock:
            if self.spent + est > self.cap + 1e-9:
                raise BudgetExceeded(f"a ${est:.2f} job would pass --max-usd ${self.cap:.2f} (${self.spent:.2f} used)")
            self.spent += est

    def release(self, est: float) -> None:
        with self._lock:
            self.spent -= est

    def settle(self, est: float, actual: Optional[float]) -> None:
        if actual is not None:
            with self._lock:
                self.spent += actual - est


@dataclass
class Runner:
    provider: object
    budget: Budget
    sleep: Callable[[float], None] = time.sleep
    clock: Callable[[], float] = time.monotonic
    rng: Callable[[], float] = random.random
    tap: Optional[Tap] = None
    _est: dict = field(default_factory=dict, init=False)

    def with_provider(self, provider) -> "Runner":
        return dataclasses.replace(self, provider=provider)

    @property
    def sheet(self) -> dict:
        return self.provider.capabilities()

    def submit(self, job: ProviderJob, est: Optional[float] = None) -> str:
        est = estimate_usd(self.sheet, job.op) if est is None else est
        self.budget.reserve(est)
        try:
            rid = self.provider.submit(job)
        except Exception:
            self.budget.release(est)
            raise
        self._est[rid] = est
        return rid

    def wait(self, rid: str, timeout_s: float) -> Status:
        """Poll no faster than the sheet's minimum, with jitter; back off when a poll fails."""
        start, gap = self.clock(), min_poll_s()
        while True:
            self.sleep(gap + self.rng() * JITTER_S)
            try:
                status = self.provider.status(rid)
                gap = min_poll_s()
            except ProviderError as exc:
                if not exc.retryable:
                    status = Status("failed", error=exc)
                else:
                    status, gap = None, min(gap * 2, 60)
            if status and status.state in TERMINAL:
                self.budget.settle(self._est[rid], status.cost_usd)
                return status
            if self.clock() - start >= timeout_s:
                try:
                    self.provider.cancel(rid)
                except ProviderError:
                    pass
                error = ProviderError("provider_failed", f"gave up after {timeout_s} s", False)
                return Status("failed", error=error)  # the reserved estimate stays counted

    def run(self, label: str, job: ProviderJob, timeout_s: Optional[float] = None,
            est: Optional[float] = None) -> dict:
        """Submit one job and wait for it. Always returns a record, never raises."""
        t0 = self.clock()
        rec = {"label": label, "op": job.op, "model": self.sheet["ops"][job.op]["model"]}
        try:
            rid = self.submit(job, est)
            rec["request_id"] = rid
            status = self.wait(rid, timeout_s or timeout_for(self.sheet, job.op))
        except BudgetExceeded as exc:
            return {**rec, "state": "skipped", "reason": str(exc)}
        except ProviderError as exc:
            return {**rec, "state": "failed", "latency_s": round(self.clock() - t0, 2), "error": exc.to_dict()}
        except CapabilityMissing as exc:
            error = {"code": "capability_missing", "message": str(exc), "retryable": False}
            return {**rec, "state": "failed", "latency_s": 0.0, "error": error}
        rec.update(state=status.state, latency_s=round(self.clock() - t0, 2), cost_usd=status.cost_usd,
                   throttled_s=self.tap.throttled_s(rid) if self.tap else 0.0,
                   outputs=[o.url for o in status.outputs], output_mimes=[o.mime for o in status.outputs])
        if status.error:
            rec["error"] = status.error.to_dict()  # a moderated job lands here, and is not retried
        return rec


class Metered:
    """The provider as the region pipeline sees it, with each submit counted against the cap."""

    name = "runway"

    def __init__(self, runner: Runner):
        self._runner = runner

    def capabilities(self) -> dict:
        return self._runner.sheet

    def submit(self, job: ProviderJob) -> str:
        return self._runner.submit(job)

    def status(self, request_id: str) -> Status:
        return self._runner.provider.status(request_id)

    def cancel(self, request_id: str) -> None:
        self._runner.provider.cancel(request_id)


def region_edit(runner: Runner, png: bytes, ratio: str, region: dict, prompt: str,
                assets: Assets, fetch: Callable[[str], bytes], capture: Optional[dict] = None):
    """One region edit through region.pipeline, no retry. May raise BudgetExceeded.
    `capture`, if given, gets the model's raw output under "raw" (the pipeline keeps only the pasted-back one)."""
    from region import run_region_edit

    job = make_job(runner.sheet, "region_edit", prompt, ratio=ratio)
    timeout = timeout_for(runner.sheet, "region_edit")

    def wait(_p, rid):
        status = runner.wait(rid, timeout)
        if capture is not None and status.outputs and status.outputs[0].data is not None:
            capture["raw"] = status.outputs[0].data
        return status

    def grab(url):
        data = fetch(url)
        if capture is not None:
            capture["raw"] = data
        return data

    return run_region_edit(Metered(runner), job, png, region, assets.upload, grab, wait, retries=0)


def write_file(path: Path, data: bytes) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(data)


def save_outputs(rec: dict, item: str, save_dir: Path, base: Path, fetch: Callable[[str], bytes],
                 default_ext: str = "png") -> None:
    """Download each output of a finished job to <save_dir>/<item>/<label>[_<n>].<ext> and put the paths,
    relative to `base`, in rec["files"]. A download that fails is noted in rec["download_errors"]."""
    urls, mimes = rec.get("outputs") or [], rec.get("output_mimes") or []
    files, errors = [], []
    for n, url in enumerate(urls):
        ext = EXT.get(mimes[n] if n < len(mimes) else None, default_ext)
        path = save_dir / item / f"{rec['label']}{f'_{n + 1}' if len(urls) > 1 else ''}.{ext}"
        try:
            write_file(path, fetch(url))
            files.append(os.path.relpath(path, base))
        except Exception as exc:  # the run is not lost for want of a picture
            errors.append(f"{type(exc).__name__}: {str(exc).replace(url, redact_url(url))}")
    if urls:
        rec["files"] = files
        rec["outputs"] = [redact_url(u) for u in urls]  # the signed URL is a credential; the files are saved
    if errors:
        rec["download_errors"] = errors


def fetch_bytes(url: str) -> bytes:
    resp = httpx.get(url, follow_redirects=True, timeout=60)
    resp.raise_for_status()
    return resp.content


def head_url(url: str) -> dict:
    """What Runway's input check will see: a HEAD, no redirects, with the type and length."""
    resp = httpx.head(url, follow_redirects=False, timeout=10)
    return {"status": resp.status_code, "content_type": resp.headers.get("content-type"),
            "content_length": resp.headers.get("content-length")}
