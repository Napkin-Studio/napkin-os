"""Mock provider: every capability on, no keys, no cost.

Returns the input stamped "MOCK" after a delay, with a fake queue position, so the
whole UI can be built and load-tested before any real key exists. Its outputs are
labelled kind "mock" and can never count as final.

Video ops return the stamped first frame drifting sideways for 1 s as an MP4 when ffmpeg
is on PATH (features/connected-video.clan: a take with motion and a last frame, so joins can
be tried locally); without ffmpeg (the relay Lambda), the stamped still (image/png) with the
requested duration attached.

Connected video (features/connected-video.clan): a take (a prompt timed "Shot k [a-b s]") comes back as
an MP4 of its whole length with a visibly different picture per shot ("SHOT k", its colours turned),
cutting at the prompt's times, so the relay's take_cuts finds the cuts; a clip with a last frame dissolves
into that frame over its last 0.2 s and ends exactly on it.

A region_edit paints its area (the mask, ours: white = change; else the region box) with bold
stripes, magenta and yellow, fully opaque: a result lost on its way to the saved picture is plain
to see in a screenshot or a pixel test (fix/editor-apply-keeps-edits, 2026-10-16).
"""

from __future__ import annotations

import dataclasses
import io
import json
import os
import re
import shutil
import subprocess
import tempfile
import time
import uuid
from pathlib import Path
from typing import Callable, Optional

from PIL import Image, ImageDraw, ImageFont, ImageOps

from .types import (
    VIDEO_OPS, AssetResolver, ProviderError, ProviderJob,
    ProviderOutput, Ref, Status, check_capabilities, effective_sheet, load_sheet, video_audio,
)

DRIFT_S = 1.0  # the mock clip's length when it is encoded
DRIFT_FPS = 24
LAND_S = 0.2  # a clip with a last frame dissolves into it over this, ending on it
TIMED = re.compile(r"^Shot (\d+) \[(\d+(?:\.\d+)?)-(\d+(?:\.\d+)?) s\]", re.M)  # connected.TIMED
_WHICH = object()  # MockProvider's ffmpeg default: whatever is on PATH

# The alternates in capabilities/mock.json, so local dev can exercise the regenerate menu.
ALTERNATES = {"frame": {"mock-hq"}, "clip": {"mock-hq"}, "resize": {"mock-hq"}}

Fetch = Callable[[str], bytes]


def _blank(size: int = 1024) -> Image.Image:
    return Image.new("RGB", (size, size), (200, 200, 205))


def stamp(png_or_jpeg: Optional[bytes], label: str, size: Optional[tuple[int, int]] = None) -> tuple[bytes, int, int]:
    """Draw a MOCK banner on the image (or a blank canvas) and return PNG bytes. With `size`, the
    picture is first filled to that size (centre-cropped and scaled), as a provider renders it."""
    img = Image.open(io.BytesIO(png_or_jpeg)).convert("RGB") if png_or_jpeg else _blank()
    if size and img.size != size:
        img = ImageOps.fit(img, size, Image.LANCZOS)
    w, h = img.size
    draw = ImageDraw.Draw(img)
    size = max(24, h // 10)
    font = ImageFont.load_default(size=size)
    box = draw.textbbox((0, 0), label, font=font)
    tw, th = box[2] - box[0], box[3] - box[1]
    pad = size // 3
    draw.rectangle((0, 0, tw + 2 * pad, th + 2 * pad), fill=(220, 30, 30))
    draw.text((pad - box[0], pad - box[1]), label, fill="white", font=font)
    out = io.BytesIO()
    img.save(out, format="PNG")
    return out.getvalue(), w, h


def _drift(w: int, h: int, seconds: float) -> str:
    return (f"scale=trunc(iw*1.08/2)*2:trunc(ih*1.08/2)*2,"
            f"crop={w}:{h}:x='(in_w-out_w)*t/{seconds:g}':y='(in_h-out_h)/2',format=yuv420p")


def drift_mp4(png: bytes, ffmpeg: str, last: Optional[bytes] = None) -> tuple[bytes, int, int]:
    """A DRIFT_S MP4 of the picture drifting sideways (8 % across), so a mock take has motion and a last
    frame unlike its first. With `last` (a clip landing on a given frame), its last LAND_S dissolve into
    that picture (scaled to the clip) and its final frame is it. Even sides, as H.264 wants."""
    w0, h0 = Image.open(io.BytesIO(png)).size
    w, h = max(2, w0 // 2 * 2), max(2, h0 // 2 * 2)
    n = round(DRIFT_S * DRIFT_FPS)
    with tempfile.TemporaryDirectory() as tmp:
        src, end, out = os.path.join(tmp, "in.png"), os.path.join(tmp, "last.png"), os.path.join(tmp, "out.mp4")
        with open(src, "wb") as f:
            f.write(png)
        args = ["-loop", "1", "-framerate", str(DRIFT_FPS), "-t", f"{DRIFT_S:g}", "-i", src]
        graph = f"[0:v]{_drift(w, h, DRIFT_S)},setsar=1[v]"
        if last:
            with open(end, "wb") as f:
                f.write(last)
            args += ["-loop", "1", "-framerate", str(DRIFT_FPS), "-t", f"{LAND_S + 2 / DRIFT_FPS:g}", "-i", end]
            graph = (f"[0:v]{_drift(w, h, DRIFT_S)},setsar=1[a];"
                     f"[1:v]scale={w}:{h}:force_original_aspect_ratio=increase,crop={w}:{h},setsar=1,format=yuv420p[b];"
                     f"[a][b]xfade=transition=fade:duration={LAND_S:g}:offset={DRIFT_S - LAND_S - 2 / DRIFT_FPS:.6f}[v]")
        subprocess.run([ffmpeg, "-hide_banner", "-loglevel", "error", "-y", *args, "-filter_complex", graph, "-map", "[v]",
                        "-frames:v", str(n), "-c:v", "libx264", "-preset", "veryfast", "-crf", "23",
                        "-pix_fmt", "yuv420p", "-movflags", "+faststart", out],
                       check=True, capture_output=True, timeout=60)
        with open(out, "rb") as f:
            return f.read(), w, h


def take_mp4(png: bytes, starts: list[float], seconds: float, ffmpeg: str) -> tuple[bytes, int, int]:
    """A mock take (features/connected-video.clan): `seconds` long, cutting at `starts` (each shot's start),
    each shot the picture stamped "SHOT k", in negative or another light, its colours turned and drifting, so
    every cut is a plain scene change for take_cuts."""
    w0, h0 = Image.open(io.BytesIO(png)).size
    w, h = max(2, w0 // 2 * 2), max(2, h0 // 2 * 2)
    ends = [*starts[1:], seconds]
    frames = [round(b * DRIFT_FPS) - round(a * DRIFT_FPS) for a, b in zip(starts, ends)]
    with tempfile.TemporaryDirectory() as tmp:
        args, parts = [], []
        for k, n in enumerate(frames):
            shot, _, _ = stamp(png, f"MOCK SHOT {k + 1}")
            src = os.path.join(tmp, f"shot{k}.png")
            with open(src, "wb") as f:
                f.write(shot)
            length = max(1, n) / DRIFT_FPS
            args += ["-loop", "1", "-framerate", str(DRIFT_FPS), "-t", f"{length:.6f}", "-i", src]
            # Every other shot upside down in negative, the rest darker in turn: a cut changes the picture's light and
            # layout, which ffmpeg's scene score reads (turning the colours alone did not reach 0.10 on a plain frame).
            look = "negate,vflip," if k % 2 else ("eq=brightness=-0.25," if k % 4 == 2 else "")
            parts.append(f"[{k}:v]{look}hue=h={round(360 * k / len(frames))},{_drift(w, h, length)},"
                         f"setsar=1,trim=end_frame={max(1, n)}[s{k}]")
        graph = ";".join(parts) + ";" + "".join(f"[s{k}]" for k in range(len(frames))) + f"concat=n={len(frames)}:v=1:a=0[v]"
        out = os.path.join(tmp, "out.mp4")
        subprocess.run([ffmpeg, "-hide_banner", "-loglevel", "error", "-y", *args, "-filter_complex", graph, "-map", "[v]",
                        "-c:v", "libx264", "-preset", "veryfast", "-crf", "23", "-pix_fmt", "yuv420p",
                        "-movflags", "+faststart", out], check=True, capture_output=True, timeout=120)
        with open(out, "rb") as f:
            return f.read(), w, h


def striped(png: bytes, mask: Optional[bytes], region: Optional[dict]) -> bytes:
    """The picture with its edit area (the mask's white, else the region box) painted in bold diagonal
    stripes, what the mock "changed", impossible to miss; a whole-frame change is striped faintly all over."""
    img = Image.open(io.BytesIO(png)).convert("RGB")
    w, h = img.size
    band = max(6, min(w, h) // 40)
    tile = Image.new("RGB", (2 * band, 2 * band))
    pix = tile.load()
    for y in range(2 * band):
        for x in range(2 * band):
            pix[x, y] = (230, 0, 160) if ((x + y) // band) % 2 == 0 else (255, 230, 0)
    stripes = Image.new("RGB", (w, h))
    for y in range(0, h, 2 * band):
        for x in range(0, w, 2 * band):
            stripes.paste(tile, (x, y))
    if mask:
        area = Image.open(io.BytesIO(mask)).convert("L").resize((w, h)).point(lambda v: 255 if v > 127 else 0)
    else:
        area = Image.new("L", (w, h), 0 if region else 90)
        if region:
            from region.image_ops import _pixel_box  # the box the pipeline pastes back and checks for leaks
            left, top, right, bottom = _pixel_box((w, h), region)
            ImageDraw.Draw(area).rectangle((left, top, right - 1, bottom - 1), fill=255)
    img.paste(stripes, (0, 0), area)
    out = io.BytesIO()
    img.save(out, format="PNG")
    return out.getvalue()


def outpaint_mp4(mp4: bytes, ratio: Optional[str], ffmpeg: str) -> tuple[bytes, int, int]:
    """Aleph 2's outpaint, mocked (features/campaign-formats.clan, phase 6): the clip at its own pixels in
    the middle of a canvas of `ratio`, the new edges a blurred stretch of it, a red mark at the top left."""
    import json as _json
    with tempfile.TemporaryDirectory() as tmp:
        src, out = os.path.join(tmp, "in.mp4"), os.path.join(tmp, "out.mp4")
        with open(src, "wb") as f:
            f.write(mp4)
        probe = subprocess.run([ffmpeg.replace("ffmpeg", "ffprobe"), "-v", "error", "-select_streams", "v:0",
                                "-show_entries", "stream=width,height", "-of", "json", src],
                               capture_output=True, text=True, timeout=30, check=True)
        st = _json.loads(probe.stdout)["streams"][0]
        w0, h0 = int(st["width"]), int(st["height"])
        a, b = (int(x) for x in (ratio or "9:16").split(":"))
        if w0 / h0 > a / b:
            w, h = w0, round(w0 * b / a)
        else:
            w, h = round(h0 * a / b), h0
        w, h = max(2, w // 2 * 2), max(2, h // 2 * 2)
        graph = (f"[0:v]split[a][b];[a]scale={w}:{h}:force_original_aspect_ratio=increase,crop={w}:{h},boxblur=20[bg];"
                 f"[bg][b]overlay=(W-w)/2:(H-h)/2,drawbox=x=0:y=0:w={max(8, w // 8)}:h={max(8, h // 24)}:color=red@1:t=fill,"
                 f"format=yuv420p[v]")
        subprocess.run([ffmpeg, "-hide_banner", "-loglevel", "error", "-y", "-i", src, "-filter_complex", graph,
                        "-map", "[v]", "-map", "0:a?", "-c:v", "libx264", "-preset", "veryfast", "-crf", "23",
                        "-movflags", "+faststart", out], check=True, capture_output=True, timeout=120)
        with open(out, "rb") as f:
            return f.read(), w, h


def runway_size(job: ProviderJob) -> Optional[tuple[int, int]]:
    """The size Runway would render an image job at: its table's snap of the job's shape
    (frame-aspect), so the relay's crop after it runs locally and in tests as it does live.
    None for video ops, jobs with no shape, and region edits: an edit keeps its source's own pixels,
    which the region pipeline's paste-back and leak check compare (the relay's crop of a Runway edit
    is tested with a recorded size in test_aspect.py)."""
    from aspect import CROP_OPS, parse_ratio
    from director.director import _nearest_ratio, provider_sizes

    if job.op == "resize" and job.ratio:  # regenerate: at the ratio asked (an extend keeps its canvas)
        shape = parse_ratio(job.ratio)
        if shape and max(shape) < 512:  # a plain 9:16, as the mock's sheet lists no pixel sizes
            k = 1344 / max(shape)
            shape = (round(shape[0] * k), round(shape[1] * k))
        return shape
    if job.op not in CROP_OPS or job.op == "region_edit" or not job.ratio:
        return None
    snapped = _nearest_ratio(job.ratio, provider_sizes("runway", job.op, None) or ())
    return parse_ratio(snapped)


class MockProvider:
    name = "mock"

    def __init__(self, assets: AssetResolver, fetch: Fetch, delay_s: float = 2.0,
                 clock: Callable[[], float] = time.monotonic, sheet: Optional[dict] = None,
                 ffmpeg: Optional[str] | object = _WHICH):
        self._assets, self._fetch, self._delay = assets, fetch, delay_s
        # Video ops come back as a drifting MP4 with ffmpeg, else as a still (None: always the still).
        self._ffmpeg = shutil.which("ffmpeg") if ffmpeg is _WHICH else ffmpeg
        self._clock, self._sheet = clock, sheet or load_sheet("mock")
        self._jobs: dict[str, dict] = {}
        self._dir: Optional[Path] = None
        self.requests: list[dict] = []  # the request each submit would have sent

    def keep_in(self, root) -> None:
        """Keep each task under `root` and read it back there, as a real provider keeps its tasks
        while the relay restarts (features/relay-durable-jobs.clan). Times are then wall-clock, since
        a monotonic clock means nothing to the next process."""
        self._dir = Path(root)
        self._dir.mkdir(parents=True, exist_ok=True)
        self._clock = time.time

    def _task_file(self, request_id: str) -> Optional[Path]:
        if self._dir is None or not re.fullmatch(r"mock_[0-9a-f]{12}", request_id):
            return None
        return self._dir / f"{request_id}.json"

    def _keep(self, request_id: str) -> None:
        path = self._task_file(request_id)
        if path is None:
            return
        entry = self._jobs[request_id]
        tmp = path.with_name(f".{path.name}.tmp")
        tmp.write_text(json.dumps({**entry, "job": dataclasses.asdict(entry["job"])}))
        os.replace(tmp, path)

    def _recall(self, request_id: str) -> Optional[dict]:
        path = self._task_file(request_id)
        if path is None or not path.exists():
            return None
        try:
            entry = json.loads(path.read_text())
            raw = entry["job"]
            entry["job"] = ProviderJob(**{**raw, "refs": [Ref(**r) for r in raw.get("refs") or []]})
        except (OSError, ValueError, KeyError, TypeError):
            return None
        self._jobs[request_id] = entry
        return entry

    def capabilities(self) -> dict:
        return self._sheet

    def submit(self, job: ProviderJob) -> str:
        check_capabilities(effective_sheet(self._sheet, job.op, job.model), job)
        request = {"op": job.op, "model": job.model, "prompt": job.prompt,
                   "refs": [r.name for r in job.refs]}
        if job.op in VIDEO_OPS:
            request["audio"] = video_audio(job)  # explicit on every video request
        self.requests.append(request)
        request_id = f"mock_{uuid.uuid4().hex[:12]}"
        # The input is resolved now: status() runs outside the job's context, where the
        # relay's asset URLs are gone, so a lookup then fails ("no URL for asset").
        sha = self._source_sha(job)
        self._jobs[request_id] = {"job": job, "at": self._clock(), "cancelled": False,
                                  "source": self._assets(sha).url if sha else None,
                                  "last": self._assets(job.last_frame).url if job.last_frame else None,
                                  "mask": self._assets(job.mask).url if job.op == "region_edit" and job.mask else None}
        self._keep(request_id)
        return request_id

    @staticmethod
    def _source_sha(job: ProviderJob) -> Optional[str]:
        """The image to stamp: the first frame, else the marked/current ref, else any ref. A clip edit's
        source is its clip (the `current` ref), which it hands back unchanged."""
        if job.op == "clip_edit":
            current = next((r.sha256 for r in job.refs if r.role == "current"), None)
            if current:
                return current
        sha = job.first_frame
        if not sha and job.keyframe:
            sha = job.keyframe["sha256"]
        if not sha:
            by_role = {r.role: r.sha256 for r in reversed(job.refs)}
            sha = by_role.get("current") or by_role.get("marked") or (job.refs[0].sha256 if job.refs else None)
        return sha

    def status(self, request_id: str) -> Status:
        entry = self._jobs.get(request_id) or self._recall(request_id)
        if entry is None:
            return Status("failed", error=ProviderError("provider_failed", "unknown mock request", False), kind="mock")
        if entry["cancelled"]:
            return Status("cancelled", kind="mock")
        elapsed = self._clock() - entry["at"]
        if elapsed < self._delay / 2:
            return Status("queued", queue_position=2 if elapsed < self._delay / 4 else 1, kind="mock")
        if elapsed < self._delay:
            return Status("running", queue_position=0, kind="mock")
        job = entry["job"]
        try:
            source = self._fetch(entry["source"]) if entry["source"] else None
        except Exception as exc:  # an unfetchable input is a provider failure, not a crash
            return Status("failed", kind="mock",
                          error=ProviderError("provider_failed", f"mock could not read its input: {exc}", True))
        if job.op == "clip_edit" and source and source[4:8] == b"ftyp":
            # An MP4 to edit comes back as it went (Fix this moment runs end to end locally, through the
            # real stitch): labelled mock, like every mock output.
            return Status("done", queue_position=0, kind="mock", cost_usd=0.0,
                          outputs=[ProviderOutput(url=f"mock://{request_id}/0", mime="video/mp4", data=source)])
        if job.op == "cutdown" and source and source[4:8] == b"ftyp" and self._ffmpeg:
            # An outpaint: the clip on a canvas of the shape, its new edges a blurred stretch (outpaint_mp4).
            try:
                mp4, w, h = outpaint_mp4(source, job.ratio, self._ffmpeg)
                return Status("done", queue_position=0, kind="mock", cost_usd=0.0,
                              outputs=[ProviderOutput(url=f"mock://{request_id}/0", mime="video/mp4", w=w, h=h, data=mp4)])
            except (subprocess.SubprocessError, OSError, ValueError, KeyError) as exc:
                return Status("failed", kind="mock", error=ProviderError("provider_failed", f"mock outpaint failed: {exc}", True))
        n = max(1, job.outputs or 1)
        size = runway_size(job)
        if size is None and job.op in VIDEO_OPS and not source and job.ratio:
            # A clip from words alone, at the video's shape (a blank square made every mock film 1:1, so a
            # 16:9 cutdown of it needed new edges: features/campaign-formats.clan, 2026-10-16).
            from aspect import parse_ratio
            shape = parse_ratio(job.ratio)
            if shape:
                k = 1280 / max(shape)
                size = (max(2, round(shape[0] * k)), max(2, round(shape[1] * k)))
        if job.op == "upscale" and source:  # each side grows by the scale, as Magnific's does
            w0, h0 = Image.open(io.BytesIO(source)).size
            size = (w0 * (job.scale or 2), h0 * (job.scale or 2))
        outputs = []
        if job.op == "region_edit" and source:
            try:
                source = striped(source, self._fetch(entry["mask"]) if entry["mask"] else None, job.region)
            except Exception as exc:
                return Status("failed", kind="mock",
                              error=ProviderError("provider_failed", f"mock could not read its mask: {exc}", True))
        for i in range(n):
            data, w, h = stamp(source, "MOCK" if n == 1 else f"MOCK {i + 1}/{n}", size)
            if job.op in VIDEO_OPS and self._ffmpeg:
                try:
                    timed = [float(a) for _, a, _ in TIMED.findall(job.prompt or "")]
                    if len(timed) > 1 and job.duration_s:  # a take: its whole length, cut where the prompt says
                        mp4, w2, h2 = take_mp4(data, timed, float(job.duration_s), self._ffmpeg)
                        seconds = float(job.duration_s)
                    else:
                        mp4, w2, h2 = drift_mp4(data, self._ffmpeg, self._last(entry, (w, h)))
                        seconds = DRIFT_S
                    outputs.append(ProviderOutput(url=f"mock://{request_id}/{i}", mime="video/mp4", w=w2, h=h2,
                                                  duration_s=seconds, data=mp4))
                    continue
                except (subprocess.SubprocessError, OSError):  # an ffmpeg that cannot: the still, as before
                    pass
            outputs.append(ProviderOutput(url=f"mock://{request_id}/{i}", mime="image/png", w=w, h=h,
                                          duration_s=job.duration_s if job.op in VIDEO_OPS else None,
                                          data=data))
        return Status("done", queue_position=0, outputs=outputs, kind="mock", cost_usd=0.0)

    def _last(self, entry: dict, size: tuple[int, int]) -> Optional[bytes]:
        """The stamped last frame a clip lands on, or None (none given, or it cannot be read: no landing)."""
        try:
            return stamp(self._fetch(entry["last"]), "MOCK", size)[0] if entry.get("last") else None
        except Exception:  # noqa: BLE001  the clip is still made, from its first frame alone
            return None

    def cancel(self, request_id: str) -> None:
        if request_id in self._jobs or self._recall(request_id):
            self._jobs[request_id]["cancelled"] = True
            self._keep(request_id)


def make():
    """The relay's registry entry (providers/__init__.py): this adapter behind the relay's Protocol."""
    from ._seam import Adapted, Resolver, fetch
    return Adapted(MockProvider(Resolver(), fetch))
