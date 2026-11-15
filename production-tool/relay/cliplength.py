"""How long a stored clip is, measured by a decoder on the relay's own copy (features/production-platform-rules.clan;
the re-review of 1d637751). An edit is billed by the clip the provider reads, so its price never comes from a length
the request declares, nor from one header field a caller can rewrite: ffprobe reads the container's duration, each
track's duration and the video's packets over its frame rate, the LONGEST is the length, and when they disagree by
more than a small tolerance (a header that lies) or none can be read, the answer is None and the job is refused.

What stays unproven: how the provider itself bills a crafted clip (which of these lengths Runway charges by).
"""

from __future__ import annotations

import json
import os
import shutil
import subprocess
import tempfile

PROBE_TIMEOUT_S = 20
TOLERANCE_S = 0.5          # lengths that differ by more than this, and by more than TOLERANCE_FRACTION, disagree
TOLERANCE_FRACTION = 0.05
# Where ffprobe is: FFPROBE, else on PATH, else the ffmpeg layer's path on Lambda (production-tool/stitch/build-layer.sh).
LAYER_FFPROBE = "/opt/bin/ffprobe"


def ffprobe() -> str | None:
    found = os.environ.get("FFPROBE") or shutil.which("ffprobe")
    if found:
        return found
    return LAYER_FFPROBE if os.path.exists(LAYER_FFPROBE) else None


def _rate(s: str | None) -> float | None:
    try:
        n, _, d = (s or "").partition("/")
        r = float(n) / float(d or 1)
        return r if r > 0 else None
    except (ValueError, ZeroDivisionError):
        return None


def lengths(data: bytes) -> list[float] | None:
    """Every length ffprobe reads from the clip, in seconds; None when it cannot read the clip at all."""
    probe = ffprobe()
    if probe is None or not data:
        return None
    with tempfile.NamedTemporaryFile(suffix=".mp4") as f:
        f.write(data)
        f.flush()
        try:
            out = subprocess.run([probe, "-v", "error", "-count_packets", "-show_entries",
                                  "format=duration:stream=codec_type,duration,nb_read_packets,avg_frame_rate,r_frame_rate",
                                  "-of", "json", f.name], capture_output=True, text=True, timeout=PROBE_TIMEOUT_S)
        except (OSError, subprocess.TimeoutExpired):
            return None
    if out.returncode != 0:
        return None
    try:
        doc = json.loads(out.stdout or "{}")
    except ValueError:
        return None
    found: list[float] = []

    def add(v) -> None:
        try:
            x = float(v)
        except (TypeError, ValueError):
            return
        if x > 0:
            found.append(x)

    add((doc.get("format") or {}).get("duration"))
    for st in doc.get("streams") or []:
        add(st.get("duration"))
        if st.get("codec_type") == "video":
            rate = _rate(st.get("avg_frame_rate")) or _rate(st.get("r_frame_rate"))
            packets = st.get("nb_read_packets")
            if rate and packets:
                add(int(packets) / rate)
    return found or None


def measure(data: bytes) -> float | None:
    """The clip's length: the longest reading, or None when the readings disagree or none exists."""
    got = lengths(data)
    if not got:
        return None
    longest, shortest = max(got), min(got)
    if longest - shortest > max(TOLERANCE_S, TOLERANCE_FRACTION * longest):
        return None
    return longest
