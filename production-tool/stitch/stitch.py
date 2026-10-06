"""Stitch Lambda: the selected clips → one MP4 with the Napkin end card.

Invoked asynchronously by the relay with
  {"jobId", "clips": [{"key": "out/sha256:…", "trimS": 4.5?}, …], "eventName",
   "outKey": "ads/<jobId>.mp4", "resultKey": "ads/<jobId>.json"}
It writes outKey, then resultKey = {"ok": true, "sha256", "bytes", "w", "h",
"durationS"} or {"ok": false, "error"}; the relay polls for resultKey.

Every clip is scaled and padded to one size (the first clip's, even, at most
1280 on the long side), one fps (24), trimmed to trimS seconds when given,
audio dropped (no audio on Wednesday), then a 1 s card: "Made with Napkin
Studio OS" and the event name. ffmpeg and ffprobe come from the layer
(/opt/bin, see build-layer.sh), the font from /opt/fonts.
"""

from __future__ import annotations

import hashlib
import json
import os
import subprocess
import tempfile
from pathlib import Path

FPS = 24
MAX_SIDE = 1280
CARD_S = 1
CARD_LINE = "Made with Napkin Studio OS"
DEFAULT_FONT = "/opt/fonts/DejaVuSans-Bold.ttf"


def even(n: float) -> int:
    return max(2, int(n) // 2 * 2)


def target_size(w: int, h: int, max_side: int = MAX_SIDE) -> tuple[int, int]:
    scale = min(1.0, max_side / max(w, h))
    return even(w * scale), even(h * scale)


def build_command(ffmpeg: str, clips: list[dict], size: tuple[int, int], card_text: str,
                  event_text: str, font: str, out: str, fps: int = FPS) -> list[str]:
    """clips: [{"path", "trimS"?}]. card_text / event_text are paths to text
    files (drawtext textfile=, so no escaping of what participants typed)."""
    w, h = size
    cmd = [ffmpeg, "-hide_banner", "-loglevel", "error", "-y"]
    for c in clips:
        if c.get("trimS"):
            cmd += ["-t", f"{float(c['trimS']):g}"]
        cmd += ["-i", c["path"]]
    cmd += ["-f", "lavfi", "-t", str(CARD_S), "-i", f"color=c=black:s={w}x{h}:r={fps}"]
    parts, labels = [], []
    for i in range(len(clips)):
        parts.append(f"[{i}:v]scale={w}:{h}:force_original_aspect_ratio=decrease,"
                     f"pad={w}:{h}:(ow-iw)/2:(oh-ih)/2:color=black,setsar=1,fps={fps},format=yuv420p[v{i}]")
        labels.append(f"[v{i}]")
    n = len(clips)
    big, small = max(12, h // 16), max(10, h // 26)
    parts.append(
        f"[{n}:v]drawtext=fontfile={font}:textfile={card_text}:expansion=none:fontcolor=white:fontsize={big}:"
        f"x=(w-text_w)/2:y=(h/2)-text_h-{h // 60},"
        f"drawtext=fontfile={font}:textfile={event_text}:expansion=none:fontcolor=0xBBBBBB:fontsize={small}:"
        f"x=(w-text_w)/2:y=(h/2)+{h // 40},setsar=1,format=yuv420p[card]")
    labels.append("[card]")
    parts.append(f"{''.join(labels)}concat=n={n + 1}:v=1:a=0[out]")
    cmd += ["-filter_complex", ";".join(parts), "-map", "[out]", "-an",
            "-c:v", "libx264", "-preset", "veryfast", "-crf", "23", "-pix_fmt", "yuv420p",
            "-movflags", "+faststart", out]
    return cmd


def probe(ffprobe: str, path: str) -> dict:
    r = subprocess.run([ffprobe, "-v", "error", "-select_streams", "v:0", "-show_entries",
                        "stream=width,height:format=duration", "-of", "json", path],
                       capture_output=True, text=True, check=True, timeout=30)
    data = json.loads(r.stdout)
    s = data["streams"][0]
    return {"w": int(s["width"]), "h": int(s["height"]), "durationS": float(data.get("format", {}).get("duration", 0) or 0)}


def run(event: dict, *, get, put, put_json, ffmpeg: str, ffprobe: str, font: str | None = None) -> dict:
    """get(key, dest_path); put(key, src_path, mime); put_json(key, dict)."""
    try:
        with tempfile.TemporaryDirectory() as tmp:
            clips = []
            for i, c in enumerate(event["clips"]):
                dest = os.path.join(tmp, f"clip{i}.mp4")
                get(c["key"], dest)
                clips.append({"path": dest, **({"trimS": c["trimS"]} if c.get("trimS") else {})})
            first = probe(ffprobe, clips[0]["path"])
            size = target_size(first["w"], first["h"])
            card, ev = os.path.join(tmp, "card.txt"), os.path.join(tmp, "event.txt")
            Path(card).write_text(CARD_LINE)
            Path(ev).write_text((event.get("eventName") or "").strip() or " ")
            out = os.path.join(tmp, "ad.mp4")
            cmd = build_command(ffmpeg, clips, size, card, ev, font or DEFAULT_FONT, out)
            r = subprocess.run(cmd, capture_output=True, text=True, timeout=600)
            if r.returncode != 0:
                raise RuntimeError(f"ffmpeg failed: {r.stderr.strip()[:400]}")
            data = Path(out).read_bytes()
            meta = probe(ffprobe, out)
            put(event["outKey"], out, "video/mp4")
            result = {"ok": True, "sha256": "sha256:" + hashlib.sha256(data).hexdigest(), "bytes": len(data),
                      "w": meta["w"], "h": meta["h"], "durationS": round(meta["durationS"], 2)}
    except Exception as e:  # the relay shows this as provider_failed
        result = {"ok": False, "error": f"{type(e).__name__}: {e}"[:500]}
    put_json(event["resultKey"], result)
    print(json.dumps({"kind": "stitch", "jobId": event.get("jobId"), **result}))
    return result


def handler(event, context):
    import boto3

    s3 = boto3.client("s3")
    bucket = os.environ["BUCKET"]
    bin_dir = os.environ.get("FFMPEG_DIR", "/opt/bin")
    return run(
        event,
        get=lambda key, dest: s3.download_file(bucket, key, dest),
        put=lambda key, src, mime: s3.upload_file(src, bucket, key, ExtraArgs={"ContentType": mime}),
        put_json=lambda key, data: s3.put_object(Bucket=bucket, Key=key, Body=json.dumps(data).encode(),
                                                 ContentType="application/json"),
        ffmpeg=os.path.join(bin_dir, "ffmpeg"), ffprobe=os.path.join(bin_dir, "ffprobe"),
        font=os.environ.get("FONT_FILE", DEFAULT_FONT),
    )
