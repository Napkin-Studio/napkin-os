"""Fix this moment's two stitch modes (features/clip-moment-edit.clan): cut a note's window out of a
take, and splice the model's new window back into it.

The relay invokes stitch.py's handler with `mode` set (an event with no mode is the ad, as before):

  cut    {jobId, mode: "cut", key, clip?: {fromS, toS, outKey}, stills: [{atS, key}], resultKey}
         -> {ok, takeS, w, h, fps, clip?: {sha256, bytes, durationS}, stills: [{sha256, bytes}]}
         Reads the take (its length decides what is sent). With clip: the take's [fromS, toS)
         re-encoded with an accurate seek (never a stream copy, which starts at a keyframe), no audio.
         Each still: a lossless PNG of the frame at atS (the keyframe; a and b for a first/last model).
         A take that is a picture (the mock's, with no ffmpeg at hand) is read too: every still is the
         picture, the clip is it held for toS - fromS, takeS is 0 and still is true.

  splice {jobId, mode: "splice", parentKey, patchKey, cutFromS, windowFromS, windowToS, crossfadeS,
          seamMin?, outKey, resultKey}
         -> {ok, sha256, bytes, w, h, fps, durationS, exact, seams: [{at_s, score, ok}]}
         The patch is conformed to the parent (size, fps, length: scale, pad, fps, tpad, trim). Every
         parent GOP that does not touch [a, b) is copied packet for packet; only [kA, kB), from the
         keyframe at or before a to the one at or after b, is encoded again (CRF 12, the parent's
         profile and pixel format, keyframes forced at a and b): the parent's frames before a, the new
         frames inside [a, b) with a crossfade at each end (inside the window), and the parent's frames
         after b. The parent's audio is copied untouched. The result is decoded whole (-xerror) and its
         copied frames compared with the parent's; when either check fails (a parent we cannot join, an
         open GOP), the whole take is encoded once instead (CRF 14) and exact is false.
         The span carries its own parameter sets in band (x264 sps-id 31), so the take's header stays the
         file's and copied packets are byte for byte the take's. Only when the window touches the first
         GOP (nothing copied before it) do the copied keyframes also carry the take's parameter sets in
         band: those packets grow by them, and their pictures are still the take's.
         The crossfades are frame-by-frame blends in the take's pixel format (xfade converts the format
         and cost the margin its 50 dB).
         Both seams are scored for Jude: the lowest SSIM between neighbouring frames across the seam
         and its crossfade, relative to the parent's over the same frames (1.0 is as smooth as the
         parent), ok at or above seamMin.

  take_cuts {jobId, mode: "take_cuts", key, cuts: [planned_s, ...], searchS, threshold?, resultKey}
         -> {ok, takeS, fps, cuts: [{planned_s, found_s}]}
         Where a take of several shots really cut (features/connected-video.clan): ffmpeg's scene score of
         every frame (against the frame before), and for each planned cut the frame with the highest score
         at or above threshold (0.10) within searchS either side of it; found_s is that frame's time (the
         first frame of the new shot), or null when no frame qualifies (the relay then uses planned_s).

  land   {jobId, mode: "land", key, targetKey, searchS?, resultKey}
         -> {ok, takeS, fps, landS, landScore}
         Where a clip made to end on a given frame (targetKey, a picture) really reached it
         (features/connected-video.clan): models hit the frame a few frames early and carry on past it
         (veo3.1_fast, live 2026-10-19: 0.954 at frame 89 of 97, 0.78 at the last). Each frame of the clip's
         last searchS seconds (LAND_SEARCH_S, at most) is scored against the target by SSIM in grey at
         LAND_SIDE on the long side; landS is the best frame's time from the clip's start, landScore its
         SSIM. Both are returned whatever the score: the web decides what a low one means.

Stitch never builds a key: the relay names every input and output. ffmpeg and ffprobe come from the
layer (build-layer.sh); everything here is subprocess calls, so the tests run on real ffmpeg.
"""

from __future__ import annotations

import hashlib
import json
import os
import re
import subprocess
import tempfile
from fractions import Fraction
from pathlib import Path

SEAM_MIN = 0.85
CUT_CRF = 12        # what the model gets: as close to the take as an encode allows
MARGIN_CRF = 12     # the re-encoded frames between a keyframe and the window
WHOLE_CRF = 14      # the fallback: the whole take, once
PROFILES = {"High": "high", "Main": "main", "Constrained Baseline": "baseline", "Baseline": "baseline",
            "High 10": "high10", "High 4:2:2": "high422", "High 4:4:4 Predictive": "high444"}
SEAM_PAD_FRAMES = 2  # frames each side of a seam's crossfade that its score also looks at


class SpliceError(RuntimeError):
    """A step that cannot work as asked; its words are for the job's message."""


def _run(cmd: list[str], timeout: int = 300) -> subprocess.CompletedProcess:
    r = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout)
    if r.returncode != 0:
        raise SpliceError(f"{Path(cmd[0]).name} failed: {r.stderr.strip()[-600:]}")
    return r


def probe(ffprobe: str, path: str) -> dict:
    """The video stream's shape and codec, the audio's presence, the frame count and the keyframes
    (as frame indices from the first frame)."""
    r = _run([ffprobe, "-v", "error", "-show_entries",
              "stream=index,codec_type,codec_name,profile,level,pix_fmt,width,height,r_frame_rate,avg_frame_rate,"
              "start_time,time_base:format=duration", "-of", "json", path], timeout=60)
    data = json.loads(r.stdout)
    video = next((s for s in data.get("streams", []) if s.get("codec_type") == "video"), None)
    if video is None:
        raise SpliceError("the file has no video")
    rate = Fraction(video.get("avg_frame_rate") if video.get("avg_frame_rate") not in (None, "0/0") else video["r_frame_rate"])
    pk = _run([ffprobe, "-v", "error", "-select_streams", "v:0", "-show_entries", "packet=pts_time,flags",
               "-of", "csv=p=0", path], timeout=60).stdout.split()
    times = []
    for line in pk:
        t, _, flags = line.partition(",")
        if t in ("", "N/A"):
            continue
        times.append((float(t), "K" in flags))
    times.sort()
    start = times[0][0] if times else 0.0
    keys = sorted({round((t - start) * rate) for t, k in times if k})
    try:
        duration = float((data.get("format") or {}).get("duration") or 0)
    except ValueError:
        duration = 0.0
    return {"w": int(video["width"]), "h": int(video["height"]), "rate": rate, "fps": float(rate),
            "frames": len(times), "durationS": duration, "codec": video.get("codec_name"),
            "profile": video.get("profile"), "level": video.get("level"), "pix_fmt": video.get("pix_fmt") or "yuv420p",
            "audio": any(s.get("codec_type") == "audio" for s in data.get("streams", [])), "keys": keys}


def _sha(path: str) -> tuple[str, int]:
    data = Path(path).read_bytes()
    return "sha256:" + hashlib.sha256(data).hexdigest(), len(data)


def _rate(rate: Fraction) -> str:
    return f"{rate.numerator}/{rate.denominator}"


# ── cut ─────────────────────────────────────────────────────────────────────

def cut(event: dict, *, get, put, ffmpeg: str, ffprobe: str, tmp: str) -> dict:
    """Read the take: its length and shape always, the sub-clip [clip.fromS, clip.toS) when asked (the
    cut send), and a lossless PNG of the frame at each still's atS (the keyframe at t; a and b for a
    first/last-frame model)."""
    src = os.path.join(tmp, "take.mp4")
    get(event["key"], src)
    from stitch import still_ext  # beside this file

    ext = still_ext(src)
    if ext:  # the mock's take when no ffmpeg was at hand: a picture
        named = os.path.join(tmp, f"take{ext}")
        os.rename(src, named)
        return _cut_picture(event, named, put=put, ffmpeg=ffmpeg, ffprobe=ffprobe, tmp=tmp)
    p = probe(ffprobe, src)
    result: dict = {"ok": True, "takeS": round(p["frames"] / p["fps"], 3), "w": p["w"], "h": p["h"],
                    "fps": round(p["fps"], 3), "stills": []}
    clip = event.get("clip")
    if clip:
        frm, to = float(clip["fromS"]), float(clip["toS"])
        if not 0 <= frm < to:
            raise SpliceError(f"the cut {frm}-{to} s is empty")
        n = round((to - frm) * p["rate"])
        out = os.path.join(tmp, "cut.mp4")
        # -ss after -i: decoded from the keyframe before and dropped up to frm, so the cut starts on the frame.
        _run([ffmpeg, "-hide_banner", "-loglevel", "error", "-y", "-i", src, "-ss", f"{frm:.6f}",
              "-map", "0:v:0", "-frames:v", str(n), "-an", "-c:v", "libx264", "-preset", "veryfast", "-crf", str(CUT_CRF),
              "-pix_fmt", "yuv420p", "-r", _rate(p["rate"]), "-movflags", "+faststart", out])
        sha, size = _sha(out)
        q = probe(ffprobe, out)
        put(clip["outKey"], out, "video/mp4")
        result["clip"] = {"sha256": sha, "bytes": size, "durationS": round(q["frames"] / q["fps"], 3)}
    for i, s in enumerate(event.get("stills") or []):
        at = min(max(float(s["atS"]), 0.0), (p["frames"] - 1) / p["fps"])
        still = os.path.join(tmp, f"still{i}.png")
        _run([ffmpeg, "-hide_banner", "-loglevel", "error", "-y", "-i", src, "-ss", f"{at:.6f}",
              "-map", "0:v:0", "-frames:v", "1", still])
        sha, size = _sha(still)
        put(s["key"], still, "image/png")
        result["stills"].append({"sha256": sha, "bytes": size})
    return result


def _cut_picture(event: dict, src: str, *, put, ffmpeg: str, ffprobe: str, tmp: str) -> dict:
    """cut on a take that is a picture (the mock's PNG, features/connected-video.clan): every still is the
    picture itself, as a PNG, whatever its atS; a clip is the picture held for toS - fromS. takeS is 0 and
    `still` says why."""
    from stitch import FPS, probe as probe_size  # beside this file

    size = probe_size(ffprobe, src)
    result: dict = {"ok": True, "takeS": 0.0, "still": True, "w": size["w"], "h": size["h"], "fps": float(FPS),
                    "stills": []}
    clip = event.get("clip")
    if clip:
        frm, to = float(clip["fromS"]), float(clip["toS"])
        if not 0 <= frm < to:
            raise SpliceError(f"the cut {frm}-{to} s is empty")
        out = os.path.join(tmp, "cut.mp4")
        _run([ffmpeg, "-hide_banner", "-loglevel", "error", "-y", "-loop", "1", "-framerate", str(FPS), "-i", src,
              "-frames:v", str(max(1, round((to - frm) * FPS))), "-vf", "pad=ceil(iw/2)*2:ceil(ih/2)*2",
              "-c:v", "libx264", "-preset", "veryfast", "-crf", str(CUT_CRF), "-pix_fmt", "yuv420p",
              "-movflags", "+faststart", out])
        sha, n = _sha(out)
        put(clip["outKey"], out, "video/mp4")
        result["clip"] = {"sha256": sha, "bytes": n, "durationS": round(max(1, round((to - frm) * FPS)) / FPS, 3)}
    for i, s in enumerate(event.get("stills") or []):
        still = os.path.join(tmp, f"still{i}.png")
        _run([ffmpeg, "-hide_banner", "-loglevel", "error", "-y", "-i", src, "-frames:v", "1", still])
        sha, n = _sha(still)
        put(s["key"], still, "image/png")
        result["stills"].append({"sha256": sha, "bytes": n})
    return result


# ── take_cuts ───────────────────────────────────────────────────────────────

CUT_THRESHOLD = 0.10


def scene_scores(ffmpeg: str, path: str) -> list[tuple[float, float]]:
    """(time, scene score) of every frame after the first, from ffmpeg's select filter (the score is the
    frame's change from the one before, 0-1)."""
    r = _run([ffmpeg, "-hide_banner", "-loglevel", "error", "-i", path, "-map", "0:v:0",
              "-vf", "select='gte(scene,0)',metadata=print:file=-", "-f", "null", "-"])
    out, t = [], None
    for line in r.stdout.splitlines():
        m = re.search(r"pts_time:([0-9.]+)", line)
        if m:
            t = float(m.group(1))
            continue
        m = re.search(r"lavfi\.scene_score=([0-9.]+)", line)
        if m and t is not None:
            out.append((t, float(m.group(1))))
            t = None
    return out


def find_cuts(scores: list[tuple[float, float]], planned: list[float], search_s: float,
              threshold: float = CUT_THRESHOLD) -> list[float | None]:
    """For each planned cut, the time of the strongest scene change within search_s of it at or above
    threshold, else None. A change is used once: the nearer planned cut keeps it."""
    found: list[float | None] = []
    used: set[float] = set()
    for p in planned:
        near = [(score, -abs(t - p), t) for t, score in scores
                if abs(t - p) <= search_s + 1e-6 and score >= threshold and t not in used]
        if not near:
            found.append(None)
            continue
        t = max(near)[2]
        used.add(t)
        found.append(round(t, 3))
    return found


def take_cuts(event: dict, *, get, put, ffmpeg: str, ffprobe: str, tmp: str) -> dict:
    src = os.path.join(tmp, "take.mp4")
    get(event["key"], src)
    p = probe(ffprobe, src)
    planned = [float(x) for x in event.get("cuts") or []]
    scores = scene_scores(ffmpeg, src)
    found = find_cuts(scores, planned, float(event.get("searchS", 1.0)), float(event.get("threshold", CUT_THRESHOLD)))
    return {"ok": True, "takeS": round(p["frames"] / p["fps"], 3), "fps": round(p["fps"], 3),
            "cuts": [{"planned_s": pl, "found_s": f} for pl, f in zip(planned, found)]}


# ── land ────────────────────────────────────────────────────────────────────

LAND_SEARCH_S = 1.0  # the most of a clip's end searched for its landing frame
LAND_SIDE = 640      # frames are compared in grey at this long side (640x360 for 16:9)


def land_scores(ffmpeg: str, path: str, target: str, first: int, p: dict, tmp: str) -> list[float]:
    """SSIM against the target picture of each frame from `first` to the clip's end, in grey at LAND_SIDE."""
    w, h = p["w"], p["h"]
    k = LAND_SIDE / max(w, h)
    sw, sh = max(2, round(w * k / 2) * 2), max(2, round(h * k / 2) * 2)
    stats = os.path.join(tmp, "land.log")
    graph = (f"[0:v]trim=start_frame={first},setpts=PTS-STARTPTS,scale={sw}:{sh},format=gray[a];"
             f"[1:v]scale={sw}:{sh},format=gray[b];[a][b]ssim=stats_file={stats}:shortest=1")
    _run([ffmpeg, "-hide_banner", "-loglevel", "error", "-y", "-i", path, "-loop", "1", "-framerate", _rate(p["rate"]),
          "-i", target, "-filter_complex", graph, "-f", "null", "-"])
    vals = []
    for line in Path(stats).read_text().splitlines():
        m = re.search(r"All:([0-9.]+)", line)
        if m:
            vals.append(float(m.group(1)))
    return vals[:p["frames"] - first]


def land(event: dict, *, get, put, ffmpeg: str, ffprobe: str, tmp: str) -> dict:
    src, target = os.path.join(tmp, "clip.mp4"), os.path.join(tmp, "target")
    get(event["key"], src)
    get(event["targetKey"], target)
    from stitch import still_ext  # beside this file

    named = target + (still_ext(target) or ".png")  # ffmpeg reads a picture by its extension
    os.rename(target, named)
    target = named
    p = probe(ffprobe, src)
    search = min(float(event.get("searchS", LAND_SEARCH_S)), LAND_SEARCH_S)
    first = max(0, p["frames"] - max(1, round(search * p["fps"])))
    scores = land_scores(ffmpeg, src, target, first, p, tmp)
    if not scores:
        raise SpliceError("no frame of the clip could be compared with its last frame")
    best = max(range(len(scores)), key=lambda i: (scores[i], i))  # a tie goes to the later frame
    return {"ok": True, "takeS": round(p["frames"] / p["fps"], 3), "fps": round(p["fps"], 3),
            "landS": round((first + best) / p["fps"], 3), "landScore": round(scores[best], 3)}


# ── splice ──────────────────────────────────────────────────────────────────

def _patch_graph(p: dict, cut_frames: int, w_from: int, w_to: int) -> str:
    """The patch conformed to the parent (size, fps, the cut's length) and trimmed to the window."""
    w, h, rate = p["w"], p["h"], _rate(p["rate"])
    secs = float(Fraction(cut_frames) / p["rate"])
    return (f"[1:v]scale={w}:{h}:force_original_aspect_ratio=decrease,pad={w}:{h}:(ow-iw)/2:(oh-ih)/2,setsar=1,"
            f"fps={rate},format={p['pix_fmt']},tpad=stop_mode=clone:stop_duration={secs + 1:.3f},"
            f"trim=end_frame={cut_frames},setpts=PTS-STARTPTS,trim=start_frame={w_from}:end_frame={w_to},"
            f"setpts=PTS-STARTPTS[w]")


def _span_graph(p: dict, lo: int, a: int, b: int, hi: int, cf: int, cut_frames: int, cut_from: int) -> str:
    """Frames [lo, hi) of the parent with frames [a, b) taken from the patch, crossfaded cf frames
    inside each end of the window. Ends in [span].

    The fades are `blend`s in the parent's own pixel format, frame by frame: the patch's weight is
    i/cf on the way in (the window's first frame is the parent's) and 1 - (i+1)/cf on the way out (its
    last frame is the parent's). xfade is not used: it converts the picture's format and back, and the
    margin then fell to 41 dB."""
    rate, fmt, n = _rate(p["rate"]), p["pix_fmt"], b - a
    fr = f"{float(p['rate']):.6f}"  # frames per second: T * fr is the frame index (blend's N starts at 1 on some builds)
    parts = [_patch_graph(p, cut_frames, a - cut_from, b - cut_from)]
    # (label, source, first frame, end frame) in play order; source 0 is the parent, w the patch's window
    order = [("pa", "0:v", lo, a)]
    if cf:
        order += [("fa", "0:v", a, a + cf), ("wa", "w", 0, cf), ("wm", "w", cf, n - cf), ("wb", "w", n - cf, n),
                  ("fb", "0:v", b - cf, b)]
    else:
        order += [("wm", "w", 0, n)]
    order += [("pb", "0:v", b, hi)]
    order = [o for o in order if o[3] > o[2]]
    for src in ("0:v", "w"):
        mine = [o for o in order if o[1] == src]
        parts.append(f"[{src}]split={len(mine)}" + "".join(f"[s{o[0]}]" for o in mine))
        for lab, _, s, e in mine:
            parts.append(f"[s{lab}]trim=start_frame={s}:end_frame={e},setpts=PTS-STARTPTS,fps={rate},format={fmt}[{lab}]")
    have = {o[0] for o in order}
    if cf:
        parts.append(f"[fa][wa]blend=all_expr='A+(B-A)*{fr}*T/{cf}',format={fmt}[xa]")
        parts.append(f"[wb][fb]blend=all_expr='A+(B-A)*({fr}*T+1)/{cf}',format={fmt}[xb]")
        middle = ["xa", *(["wm"] if "wm" in have else []), "xb"]
    else:
        middle = ["wm"]
    play = [*(["pa"] if "pa" in have else []), *middle, *(["pb"] if "pb" in have else [])]
    parts.append("".join(f"[{lab}]" for lab in play) + f"concat=n={len(play)}:v=1:a=0,format={fmt}[span]")
    return ";".join(parts)


def _encode_args(p: dict, crf: int, keys: list[float]) -> list[str]:
    args = ["-c:v", "libx264", "-preset", "veryfast", "-crf", str(crf), "-pix_fmt", p["pix_fmt"],
            "-r", _rate(p["rate"])]
    if p.get("codec") != "h264":  # another codec's profile and level mean nothing to x264
        return args + (["-force_key_frames", ",".join(f"{k:.6f}" for k in keys)] if keys else [])
    profile = PROFILES.get(p.get("profile") or "")
    if profile:
        args += ["-profile:v", profile]
    if p.get("level") and p["level"] > 0:
        args += ["-level:v", f"{p['level'] / 10:g}"]
    if keys:
        args += ["-force_key_frames", ",".join(f"{k:.6f}" for k in keys)]
    return args


def _framemd5(ffmpeg: str, path: str) -> list[str]:
    """Each decoded video frame's hash, in order."""
    r = _run([ffmpeg, "-hide_banner", "-loglevel", "error", "-i", path, "-map", "0:v:0", "-f", "framemd5", "-"])
    return [line.rsplit(",", 1)[1].strip() for line in r.stdout.splitlines() if line and not line.startswith("#")]


def _decodes(ffmpeg: str, path: str) -> bool:
    r = subprocess.run([ffmpeg, "-hide_banner", "-loglevel", "error", "-xerror", "-i", path, "-f", "null", "-"],
                       capture_output=True, text=True, timeout=300)
    return r.returncode == 0 and not r.stderr.strip()


def _exact(ffmpeg: str, ffprobe: str, parent: str, p: dict, a: int, b: int, cf: int, cut_frames: int,
           cut_from: int, patch: str, tmp: str) -> str:
    """The GOP-aware splice; the output path. Raises SpliceError when the parent cannot be joined."""
    if p["codec"] != "h264" or p["pix_fmt"] not in ("yuv420p", "yuvj420p"):
        raise SpliceError(f"a {p['codec']} {p['pix_fmt']} take is encoded whole")
    keys = p["keys"] or [0]
    lo = max([k for k in keys if k <= a] or [0])
    after = [k for k in keys if k >= b]
    hi = after[0] if after else p["frames"]
    # The span carries its own parameter sets in band under id 31 (x264 sps-id), so its slices never
    # meet the take's (id 0, in the file's header): the copied packets stay byte for byte the take's.
    span = os.path.join(tmp, "span.mp4")
    rate = float(p["rate"])
    force = sorted({0.0, (a - lo) / rate, (b - lo) / rate} - {(hi - lo) / rate})
    _run([ffmpeg, "-hide_banner", "-loglevel", "error", "-y", "-i", parent, "-i", patch,
          "-filter_complex", _span_graph(p, lo, a, b, hi, cf, cut_frames, cut_from), "-map", "[span]", "-an",
          *_encode_args(p, MARGIN_CRF, force), "-x264-params", "sps-id=31:repeat-headers=1", span])
    pieces = []
    bounds = [k for k in (lo, hi) if 0 < k < p["frames"]]
    if bounds:
        _run([ffmpeg, "-hide_banner", "-loglevel", "error", "-y", "-i", parent, "-map", "0:v:0", "-c", "copy",
              "-f", "segment", "-segment_format", "mp4", "-reset_timestamps", "1",
              "-segment_frames", ",".join(str(k) for k in bounds), os.path.join(tmp, "seg%03d.mp4")])
    # The segments are [0, lo), [lo, hi), [hi, end) with the empty ends left out; [lo, hi) is the span's.
    segs = sorted(Path(tmp).glob("seg*.mp4"))
    if len(segs) != len(bounds) + 1:
        raise SpliceError(f"the take split into {len(segs)} parts, not {len(bounds) + 1}")
    if lo > 0:
        pieces.append(str(segs[0]))
    pieces.append(span)
    if hi < p["frames"]:
        pieces.append(str(segs[-1]))
    listing = os.path.join(tmp, "parts.txt")
    Path(listing).write_text("".join(f"file '{x}'\n" for x in pieces))
    out = os.path.join(tmp, "patched.mp4")
    # The file's header is the first piece's. When the span comes first (the window touches the first
    # GOP), the take's parameter sets go in band at the first copied keyframe instead (auto_convert):
    # that one packet grows by them; its picture and every other packet are the take's.
    _run([ffmpeg, "-hide_banner", "-loglevel", "error", "-y", "-f", "concat", "-safe", "0",
          "-auto_convert", "0" if lo > 0 else "1", "-i", listing,
          "-i", parent, "-map", "0:v:0", "-map", "1:a?", "-c", "copy", "-movflags", "+faststart", out])
    if not _decodes(ffmpeg, out):
        raise SpliceError("the joined take does not decode cleanly")
    got, want = _framemd5(ffmpeg, out), _framemd5(ffmpeg, parent)
    if len(got) != len(want):
        raise SpliceError(f"the joined take has {len(got)} frames, not {len(want)}")
    if got[:lo] != want[:lo] or got[hi:] != want[hi:]:
        raise SpliceError("the copied frames do not match the take")
    return out


def _whole(ffmpeg: str, parent: str, p: dict, a: int, b: int, cf: int, cut_frames: int, cut_from: int,
           patch: str, tmp: str) -> str:
    """The fallback: the whole take encoded once, with the window spliced in."""
    out = os.path.join(tmp, "whole.mp4")
    rate = float(p["rate"])
    _run([ffmpeg, "-hide_banner", "-loglevel", "error", "-y", "-i", parent, "-i", patch,
          "-filter_complex", _span_graph(p, 0, a, b, p["frames"], cf, cut_frames, cut_from),
          "-map", "[span]", "-map", "0:a?", "-c:a", "copy",
          *_encode_args(p, WHOLE_CRF, [a / rate, b / rate]), "-movflags", "+faststart", out])
    return out


def _ssim_run(ffmpeg: str, path: str, s: int, e: int, tmp: str, tag: str, gap: int = 1) -> list[float]:
    """SSIM between each frame in [s, e) and the one `gap` frames later."""
    stats = os.path.join(tmp, f"ssim-{tag}.log")
    graph = (f"[0:v]split=2[x][y];[x]trim=start_frame={s}:end_frame={e},setpts=PTS-STARTPTS[x1];"
             f"[y]trim=start_frame={s + gap}:end_frame={e + gap},setpts=PTS-STARTPTS[y1];"
             f"[x1][y1]ssim=stats_file={stats}")
    _run([ffmpeg, "-hide_banner", "-loglevel", "error", "-y", "-i", path, "-filter_complex", graph, "-f", "null", "-"])
    vals = []
    for line in Path(stats).read_text().splitlines():
        m = re.search(r"All:([0-9.]+)", line)
        if m:
            vals.append(float(m.group(1)))
    return vals


def seam_scores(ffmpeg: str, out: str, parent: str, frames: int, rate: Fraction, a: int, b: int, cf: int,
                tmp: str, seam_min: float = SEAM_MIN) -> list[dict]:
    """Jude's check of both seams, relative to the parent over the same frames (1.0: as smooth as the
    parent; at most 1). The lower of: the lowest SSIM between neighbouring frames across the seam's
    crossfade and a few frames each side (a jump), and the SSIM from the last frame before the fade to
    the first one after it (a crossfade hiding a jump: a shifted or recoloured window ghosts through it)."""
    seams = []
    for at, s, e in ((a, a - SEAM_PAD_FRAMES, a + cf + SEAM_PAD_FRAMES), (b, b - cf - SEAM_PAD_FRAMES, b + SEAM_PAD_FRAMES)):
        s, e = max(0, s), min(frames - 1, e)
        if e <= s or at <= 0 or at >= frames:
            continue
        got, base = _ssim_run(ffmpeg, out, s, e, tmp, f"o{at}"), _ssim_run(ffmpeg, parent, s, e, tmp, f"p{at}")
        if not got or not base:
            continue
        ratios = [min(got) / max(min(base), 1e-6)]
        x = at - 1 if at == a else at - cf - 1  # the last frame before the fade
        if cf and x >= 0 and x + cf + 1 < frames:
            across = _ssim_run(ffmpeg, out, x, x + 1, tmp, f"oa{at}", cf + 1)
            was = _ssim_run(ffmpeg, parent, x, x + 1, tmp, f"pa{at}", cf + 1)
            if across and was:
                ratios.append(across[0] / max(was[0], 1e-6))
        score = round(min(1.0, *ratios), 3)
        seams.append({"at_s": round(at / float(rate), 3), "score": score, "ok": score >= seam_min})
    return seams


def splice(event: dict, *, get, put, ffmpeg: str, ffprobe: str, tmp: str) -> dict:
    parent, patch = os.path.join(tmp, "parent.mp4"), os.path.join(tmp, "patch.mp4")
    get(event["parentKey"], parent)
    get(event["patchKey"], patch)
    p = probe(ffprobe, parent)
    rate = p["rate"]
    frame = lambda s: round(Fraction(str(s)) * rate)  # noqa: E731  seconds -> a frame index of the parent
    a, b = frame(event["windowFromS"]), frame(event["windowToS"])
    cut_from = frame(event["cutFromS"])
    b = min(b, p["frames"])
    if not 0 <= cut_from <= a < b:
        raise SpliceError(f"the window {event['windowFromS']}-{event['windowToS']} s is not inside the take")
    cf = min(round(float(event.get("crossfadeS", 0.25)) * float(rate)), (b - a) // 2)
    # The cut the model was given ran from cut_from to at least the window's end: conform to that length.
    cut_frames = max(b - cut_from, round(probe(ffprobe, patch)["durationS"] * float(rate)))
    exact = True
    with tempfile.TemporaryDirectory(dir=tmp) as work:
        try:
            out = _exact(ffmpeg, ffprobe, parent, p, a, b, cf, cut_frames, cut_from, patch, work)
        except (SpliceError, subprocess.TimeoutExpired, IndexError) as e:
            print(json.dumps({"kind": "splice_whole", "jobId": event.get("jobId"), "why": str(e)[:300]}))
            exact = False
            out = _whole(ffmpeg, parent, p, a, b, cf, cut_frames, cut_from, patch, work)
        final = os.path.join(tmp, "out.mp4")
        os.replace(out, final)
        seams = seam_scores(ffmpeg, final, parent, p["frames"], rate, a, b, cf, work, float(event.get("seamMin", SEAM_MIN)))
    sha, size = _sha(final)
    q = probe(ffprobe, final)
    put(event["outKey"], final, "video/mp4")
    return {"ok": True, "sha256": sha, "bytes": size, "w": q["w"], "h": q["h"], "fps": round(q["fps"], 3),
            "durationS": round(q["frames"] / q["fps"], 3), "exact": exact, "seams": seams}


def run(event: dict, *, get, put, put_json, ffmpeg: str, ffprobe: str) -> dict:
    """One cut or splice; the result JSON is written to resultKey whatever happens."""
    mode = event["mode"]
    try:
        with tempfile.TemporaryDirectory() as tmp:
            step = {"cut": cut, "splice": splice, "take_cuts": take_cuts, "land": land}[mode]
            result = step(event, get=get, put=put, ffmpeg=ffmpeg, ffprobe=ffprobe, tmp=tmp)
    except Exception as e:  # the relay retries a failed splice once, and fails a cut with a refund
        print(json.dumps({"kind": f"stitch_{mode}_failed", "jobId": event.get("jobId"), "error": str(e)[:1500]}))
        word = {"cut": "get the take ready for the fix", "take_cuts": "find the take's cuts",
                "land": "find where the clip lands"}.get(
            mode, "splice the fix back into the take")
        result = {"ok": False, "error": f"Could not {word}."}
    put_json(event["resultKey"], result)
    print(json.dumps({"kind": f"stitch_{mode}", "jobId": event.get("jobId"), **result}))
    return result
