"""A cutdown or a re-aspect of the ad (features/campaign-formats.clan, phases 5 and 6): the stitch
Lambda's "cutdown" mode, beside stitch.py, which hands it the event.

  {"jobId", "mode": "cutdown", "size": [w, h],
   "clips": [{"key", "inS", "outS", "takeSize"?: [w, h], "crop"?: {x, y, w, h},
              "cropKeys"?: [{"at", "box"}]}, …],
   "layers"?: [{"key", "fromS"?, "toS"?}], "endCard": true, "fadeOutS"?: 0.5,
   "outKey", "resultKey"}

Each clip is the window inS..outS of its take (a still is held that long), cropped (a box in the
take's pixels, scaled to the pixels it really has; cropKeys: a slow pan, the box moved linearly
through the window) or, with no crop, filled to the size from its middle (a remade or an outpainted
clip, already near the shape), then scaled to the size with lanczos: Aleph 2's 612x1088 grows to the
delivery size here. The clips are joined by cuts, the type layers (transparent PNGs the relay drew at
the size) laid over them in their times, then the end card at the size (stitch.card_graph). Sound:
each window's own (silence where a take has none), faded out over fadeOutS before the card; the
card is silent. The result is written like stitch's: {"ok", "sha256", "bytes", "w", "h", "durationS",
"endCard"}.
"""

from __future__ import annotations

import hashlib
import json
import os
import subprocess
import tempfile
from pathlib import Path

import stitch as st

AUDIO_RATE = 48000


def has_audio(ffprobe: str, path: str) -> bool:
    r = subprocess.run([ffprobe, "-v", "error", "-select_streams", "a", "-show_entries", "stream=index",
                        "-of", "csv=p=0", path], capture_output=True, text=True, timeout=30)
    return bool(r.stdout.strip())


def _f(x: float) -> str:
    return f"{float(x):.3f}".rstrip("0").rstrip(".") or "0"


def crop_filter(c: dict, src: tuple[int, int], dur: float) -> str:
    """The crop for a clip as an ffmpeg filter, in the pixels the clip really has (`src`), or '' when it
    has none. cropKeys: the box's x and y move linearly between keys over the window (t from 0)."""
    sw, sh = src
    tw, th = c.get("takeSize") or (sw, sh)
    kx, ky = sw / tw, sh / th
    keys = c.get("cropKeys") or ([{"at": 0, "box": c["crop"]}] if c.get("crop") else [])
    if not keys:
        return ""
    b0 = keys[0]["box"]
    w = max(2, min(sw, int(round(b0["w"] * kx)) // 2 * 2))
    h = max(2, min(sh, int(round(b0["h"] * ky)) // 2 * 2))

    def pos(axis: str, k: float, limit: int) -> str:
        pts = [(float(key["at"]) * dur, min(max(0.0, key["box"][axis] * k), limit)) for key in keys]
        if len(pts) == 1 or all(abs(p[1] - pts[0][1]) < 0.5 for p in pts):
            return _f(pts[0][1])
        # Piecewise linear in t: before the first key its value, after the last its value.
        expr = _f(pts[-1][1])
        for (t0, v0), (t1, v1) in reversed(list(zip(pts, pts[1:]))):
            span = max(1e-3, t1 - t0)
            expr = f"if(lt(t,{_f(t1)}),{_f(v0)}+({_f(v1 - v0)})*(t-{_f(t0)})/{_f(span)},{expr})"
        return f"'clip({expr},0,{limit})'"
    return f"crop={w}:{h}:{pos('x', kx, sw - w)}:{pos('y', ky, sh - h)},"


def build_command(ffmpeg: str, clips: list[dict], size: tuple[int, int], version: str, assets: dict,
                  layers: list[dict], fade_s: float, out: str, fps: int = st.FPS) -> list[str]:
    """clips: [{"path", "inS", "outS", "still"?, "src": (w, h), "audio": bool, "crop"?, "cropKeys"?,
    "takeSize"?}]; layers: [{"path", "fromS"?, "toS"?}]."""
    w, h = size
    cmd = [ffmpeg, "-hide_banner", "-loglevel", "error", "-y"]
    durs = []
    for c in clips:
        ins = float(c.get("inS") or 0)
        dur = max(1 / fps, float(c["outS"]) - ins)
        durs.append(dur)
        if c.get("still"):
            cmd += ["-loop", "1", "-framerate", str(fps), "-t", st._secs(dur), "-i", c["path"]]
        else:
            if ins > 0:
                cmd += ["-ss", st._secs(ins)]
            cmd += ["-t", st._secs(dur), "-i", c["path"]]
    n = len(clips)
    for layer in layers:
        cmd += ["-loop", "1", "-framerate", str(fps), "-t", st._secs(sum(durs)), "-i", layer["path"]]
    card_at = n + len(layers)
    layout = st.card_layout(w, h, assets)
    layout["paths"] = {name: a["path"] for name, a in assets.items()}
    card_inputs, card_parts = st.card_graph(card_at, version, layout, fps)
    cmd += card_inputs
    parts = []
    for i, (c, dur) in enumerate(zip(clips, durs)):
        crop = crop_filter(c, c["src"], dur)
        fit = (f"{crop}scale={w}:{h}:flags=lanczos" if crop
               else f"scale={w}:{h}:force_original_aspect_ratio=increase:flags=lanczos,crop={w}:{h}")
        parts.append(f"[{i}:v]{fit},setsar=1,fps={fps},format=yuv420p,"
                     f"tpad=stop_mode=clone:stop_duration={st._secs(dur)},trim=duration={st._secs(dur)},setpts=PTS-STARTPTS[v{i}]")
        if c.get("audio"):
            parts.append(f"[{i}:a]aresample={AUDIO_RATE},aformat=sample_fmts=fltp:channel_layouts=stereo,"
                         f"apad,atrim=duration={st._secs(dur)},asetpts=PTS-STARTPTS[a{i}]")
        else:
            parts.append(f"anullsrc=r={AUDIO_RATE}:cl=stereo,atrim=duration={st._secs(dur)},aformat=sample_fmts=fltp[a{i}]")
    body = sum(durs)
    parts.append(f"{''.join(f'[v{i}]' for i in range(n))}concat=n={n}:v=1:a=0[body0]")
    label = "body0"
    for j, layer in enumerate(layers):
        a, b = layer.get("fromS"), layer.get("toS")
        when = f":enable='between(t,{_f(a or 0)},{_f(b if b is not None else body)})'" if a is not None or b is not None else ""
        parts.append(f"[{n + j}:v]format=rgba[l{j}]")
        parts.append(f"[{label}][l{j}]overlay=0:0:format=auto{when},format=yuv420p[body{j + 1}]")
        label = f"body{j + 1}"
    parts += card_parts
    parts.append(f"[{label}][card]concat=n=2:v=1:a=0[out]")
    fade = min(max(0.0, fade_s), body)
    parts.append(f"{''.join(f'[a{i}]' for i in range(n))}concat=n={n}:v=0:a=1[ab]")
    afade = f",afade=t=out:st={st._secs(body - fade)}:d={st._secs(fade)}" if fade > 0 else ""
    parts.append(f"[ab]atrim=duration={st._secs(body)}{afade}[abf]")
    parts.append(f"anullsrc=r={AUDIO_RATE}:cl=stereo,atrim=duration={st._secs(st.CARD_S)},aformat=sample_fmts=fltp[acard]")
    parts.append("[abf][acard]concat=n=2:v=0:a=1[aout]")
    cmd += ["-filter_complex", ";".join(parts), "-map", "[out]", "-map", "[aout]",
            "-c:v", "libx264", "-preset", "veryfast", "-crf", "23", "-pix_fmt", "yuv420p",
            "-c:a", "aac", "-b:a", "128k", "-movflags", "+faststart", out]
    return cmd


def run(event: dict, *, get, put, put_json, ffmpeg: str, ffprobe: str) -> dict:
    version = st.card_version(event.get("jobId", ""))
    try:
        with tempfile.TemporaryDirectory() as tmp:
            clips = []
            for i, c in enumerate(event["clips"]):
                dest = os.path.join(tmp, f"clip{i}.mp4")
                get(c["key"], dest)
                ext = st.still_ext(dest)
                if ext:
                    named = os.path.join(tmp, f"clip{i}{ext}")
                    os.rename(dest, named)
                    dest = named
                try:
                    p = st.probe(ffprobe, dest)
                except (subprocess.CalledProcessError, subprocess.TimeoutExpired, ValueError, KeyError, IndexError) as e:
                    print(json.dumps({"kind": "cutdown_probe", "jobId": event.get("jobId"), "clip": i, "error": str(e)[:500]}))
                    raise st.BadClip(i) from e
                take = c.get("takeSize")
                clips.append({"path": dest, "inS": c.get("inS") or 0, "outS": c["outS"], "src": (p["w"], p["h"]),
                              "audio": not ext and has_audio(ffprobe, dest), **({"still": True} if ext else {}),
                              **({"takeSize": tuple(take)} if take else {}),
                              **{k: c[k] for k in ("crop", "cropKeys") if c.get(k)}})
            layers = []
            for j, layer in enumerate(event.get("layers") or []):
                dest = os.path.join(tmp, f"layer{j}.png")
                get(layer["key"], dest)
                layers.append({"path": dest, **{k: layer[k] for k in ("fromS", "toS") if layer.get(k) is not None}})
            w, h = event["size"]
            size = (st.even(w), st.even(h))
            out = os.path.join(tmp, "cut.mp4")
            cmd = build_command(ffmpeg, clips, size, version, st.load_assets(version), layers,
                                float(event.get("fadeOutS") or 0), out)
            r = subprocess.run(cmd, capture_output=True, text=True, timeout=600)
            if r.returncode != 0:
                print(json.dumps({"kind": "cutdown_ffmpeg", "jobId": event.get("jobId"), "stderr": r.stderr.strip()[-2000:]}))
                raise RuntimeError("The cutdown could not be rendered. Try again.")
            data = Path(out).read_bytes()
            meta = st.probe(ffprobe, out)
            put(event["outKey"], out, "video/mp4")
            result = {"ok": True, "sha256": "sha256:" + hashlib.sha256(data).hexdigest(), "bytes": len(data),
                      "w": meta["w"], "h": meta["h"], "durationS": round(meta["durationS"], 2), "endCard": version}
    except st.BadClip as e:
        result = {"ok": False, "code": "bad_clip", "clip": e.index, "error": str(e), "endCard": version}
    except Exception as e:
        message = str(e) if isinstance(e, RuntimeError) else f"{type(e).__name__}: {e}"
        result = {"ok": False, "error": message[:500], "endCard": version}
    put_json(event["resultKey"], result)
    print(json.dumps({"kind": "cutdown", "jobId": event.get("jobId"), **result}))
    return result
