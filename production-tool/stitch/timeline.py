"""The ad from a timeline (features/make-and-edit.clan): the stitch Lambda's "timeline" mode, beside
stitch.py, which hands it the event. The relay compiled the plan (clan-store compileTimeline, the one the
Edit room's preview plays) and drew the words (relay/typeset.py) into transparent PNGs:

  {"jobId", "mode": "timeline",
   "clips": [{"key", "startS", "inS", "outS", "speed"?, "holdS"?, "fadeInS"?, "fadeOutS"?,
              "transitionIn"?: {"kind": "cut"|"dissolve"|"dip_black"|"dip_white", "s"?}}, …],
   "texts"?: [{"key", "fromS", "toS", "fadeInS"?, "fadeOutS"?}],
   "endCard"?: {"key", "s", "transitionIn"?},
   "lengthS", "outKey", "resultKey"}

V1's clips are placed at startS in ad time, in start order. Each shows inS..outS of its footage at speed,
then holds its last frame holdS: it lasts (outS - inS) / speed + holdS. A gap before a clip is black. A
clip's fades go from and to black over its own length. A dissolve or dip into a clip that starts where the
one before it ends overlaps them by s seconds taken from the outgoing clip's footage after its outS (its
last frame held when it has none), so every clip keeps its place: stitch.py's rule. The person's end card
(a PNG the relay drew) follows the last clip for s seconds with its own transition. The texts lie over the
whole film at their times, fading in and out with their alpha. The film is exactly lengthS long; then the
studio's roll-up card (stitch.card_graph) as always. Every input is scaled and padded to one size (the
first clip's, even, at most 1280 on the long side), 24 fps, silent (no sound until audio-mix). The result
is written like stitch's: {"ok", "sha256", "bytes", "w", "h", "durationS", "endCard", "lengthS"}.
"""

from __future__ import annotations

import hashlib
import json
import os
import subprocess
import tempfile
from pathlib import Path

import stitch as st

EPS = 1e-3
XFADE = {"dissolve": "fade", "dip_black": "fadeblack", "dip_white": "fadewhite"}  # ffmpeg xfade's names


class BadPlan(ValueError):
    """The plan cannot be rendered as given (clips that overlap on V1, a length that does not add up)."""


def clip_length(c: dict) -> float:
    """How long a clip lasts in the film: (outS - inS) / speed + holdS (clan-store itemLength)."""
    return max(0.0, float(c["outS"]) - float(c.get("inS") or 0)) / float(c.get("speed") or 1) + float(c.get("holdS") or 0)


def pieces(clips: list[dict], end_card: dict | None, fps: int = st.FPS) -> list[dict]:
    """The film as pieces in order: {"kind": "gap"|"clip"|"card", "index"?, "at", "len", "join": (kind, s),
    "handle"}. join is the transition into the piece (only into a clip or the card that starts exactly where
    a clip ends; whole frames, at most the incoming piece's length and 2 s); handle is how far a clip runs on
    into the next piece's transition. Refuses clips that overlap."""
    out: list[dict] = []
    at = 0.0
    order = sorted(range(len(clips)), key=lambda i: (float(clips[i]["startS"]), i))
    items = [("clip", i, clips[i]) for i in order]
    if end_card:
        last_end = max((float(c["startS"]) + clip_length(c) for c in clips), default=0.0)
        items.append(("card", None, {"startS": last_end, "len": float(end_card["s"]), "transitionIn": end_card.get("transitionIn")}))
    for kind, i, c in items:
        start = float(c["startS"])
        length = c["len"] if kind == "card" else clip_length(c)
        if start < at - EPS:
            raise BadPlan(f"clip {i} starts at {start:g} s, inside the clip before it (V1 never overlaps)")
        if start > at + EPS:
            out.append({"kind": "gap", "at": at, "len": start - at, "join": ("cut", 0.0), "handle": 0.0})
        join = ("cut", 0.0)
        t = c.get("transitionIn") or {}
        if t.get("kind") in XFADE and out and out[-1]["kind"] == "clip" and abs(start - at) <= EPS:
            frames = round(min(float(t.get("s") or st.TRANSITION_S), length, st.MAX_TRANSITION_S) * fps)
            if frames > 0:
                join = (t["kind"], frames / fps)
                out[-1]["handle"] = frames / fps
        out.append({"kind": kind, "index": i, "at": start, "len": length, "join": join, "handle": 0.0})
        at = start + length
    return out


def film_length(clips: list[dict], end_card: dict | None) -> float:
    ends = [float(c["startS"]) + clip_length(c) for c in clips]
    return max(ends, default=0.0) + (float(end_card["s"]) if end_card else 0.0)


def _fades(c: dict, length: float) -> str:
    out = ""
    if c.get("fadeInS"):
        out += f",fade=t=in:st=0:d={st._secs(min(float(c['fadeInS']), length))}"
    if c.get("fadeOutS"):
        d = min(float(c["fadeOutS"]), length)
        out += f",fade=t=out:st={st._secs(length - d)}:d={st._secs(d)}"
    return out


def build_command(ffmpeg: str, clips: list[dict], texts: list[dict], end_card: dict | None, size: tuple[int, int],
                  version: str, assets: dict, out: str, fps: int = st.FPS) -> list[str]:
    """clips: the event's clips with "path" (and "still" for a picture); texts: [{"path", "fromS", "toS",
    "fadeInS"?, "fadeOutS"?}]; end_card: {"path", "s", "transitionIn"?} or None."""
    w, h = size
    plan = pieces(clips, end_card, fps)
    length = film_length(clips, end_card)
    cmd = [ffmpeg, "-hide_banner", "-loglevel", "error", "-y"]
    labels_in: dict[int, int] = {}  # piece → its input index
    n_in = 0
    for k, p in enumerate(plan):
        if p["kind"] == "gap":
            continue
        span = p["len"] + p["handle"]
        if p["kind"] == "card":
            cmd += ["-loop", "1", "-framerate", str(fps), "-t", st._secs(span), "-i", end_card["path"]]
        else:
            c = clips[p["index"]]
            if c.get("still"):
                cmd += ["-loop", "1", "-framerate", str(fps), "-t", st._secs(span), "-i", c["path"]]
            else:
                ins = float(c.get("inS") or 0)
                speed = float(c.get("speed") or 1)
                # The window, and past it the handle the next transition needs (footage after outS, at speed);
                # a held clip's handle is its held frame, so it reads no further.
                read = float(c["outS"]) - ins + (p["handle"] * speed if not c.get("holdS") else 0.0)
                if ins > 0:
                    cmd += ["-ss", st._secs(ins)]
                cmd += ["-t", st._secs(read), "-i", c["path"]]
        labels_in[k] = n_in
        n_in += 1
    text_at = n_in
    for t in texts:
        cmd += ["-loop", "1", "-framerate", str(fps), "-t", st._secs(length), "-i", t["path"]]
    layout = st.card_layout(w, h, assets)
    layout["paths"] = {name: a["path"] for name, a in assets.items()}
    card_inputs, card_parts = st.card_graph(text_at + len(texts), version, layout, fps)
    cmd += card_inputs

    parts = []
    norm = f"scale={w}:{h}:force_original_aspect_ratio=decrease,pad={w}:{h}:(ow-iw)/2:(oh-ih)/2:color=black,setsar=1"
    for k, p in enumerate(plan):
        span = p["len"] + p["handle"]
        hold = f"tpad=stop_mode=clone:stop_duration={st._secs(span)},trim=duration={st._secs(span)},setpts=PTS-STARTPTS"
        if p["kind"] == "gap":
            parts.append(f"color=c=black:s={w}x{h}:r={fps}:d={st._secs(span)},format=yuv420p,setsar=1[p{k}]")
            continue
        src = f"[{labels_in[k]}:v]"
        if p["kind"] == "card":
            parts.append(f"{src}{norm},fps={fps},format=yuv420p,{hold}[p{k}]")
            continue
        c = clips[p["index"]]
        retime = f"setpts=(PTS-STARTPTS)/{float(c['speed']):.6f}," if c.get("speed") and not c.get("still") else ""
        parts.append(f"{src}{norm},{retime}fps={fps},format=yuv420p,{hold},fps={fps}{_fades(c, p['len'])}[p{k}]")
    # Pieces joined by transitions form one run (xfade offsets from the run's start); runs are concatenated.
    runs: list[str] = []
    acc = 0.0
    for k, p in enumerate(plan):
        kind, s = p["join"]
        span = p["len"] + p["handle"]
        if kind == "cut":
            runs.append(f"p{k}")
            acc = span
            continue
        offset = acc - s
        parts.append(f"[{runs[-1]}][p{k}]xfade=transition={XFADE[kind]}:duration={st._secs(s)}:offset={st._secs(offset)}[x{k}]")
        runs[-1] = f"x{k}"
        acc = offset + span
    if len(runs) > 1:
        parts.append(f"{''.join(f'[{r}]' for r in runs)}concat=n={len(runs)}:v=1:a=0[body0]")
    else:
        parts.append(f"[{runs[0]}]null[body0]")
    label = "body0"
    for j, t in enumerate(texts):
        a, b = float(t["fromS"]), float(t["toS"])
        fade = ""
        if t.get("fadeInS"):
            fade += f",fade=t=in:st={st._secs(a)}:d={st._secs(min(float(t['fadeInS']), b - a))}:alpha=1"
        if t.get("fadeOutS"):
            d = min(float(t["fadeOutS"]), b - a)
            fade += f",fade=t=out:st={st._secs(b - d)}:d={st._secs(d)}:alpha=1"
        parts.append(f"[{text_at + j}:v]scale={w}:{h},format=rgba{fade}[t{j}]")
        parts.append(f"[{label}][t{j}]overlay=0:0:format=auto:enable='between(t,{st._secs(a)},{st._secs(b)})',format=yuv420p[body{j + 1}]")
        label = f"body{j + 1}"
    parts.append(f"[{label}]trim=duration={st._secs(length)},setpts=PTS-STARTPTS[film]")
    parts += card_parts
    parts.append("[film][card]concat=n=2:v=1:a=0[out]")
    cmd += ["-filter_complex", ";".join(parts), "-map", "[out]", "-an",
            "-c:v", "libx264", "-preset", "veryfast", "-crf", "23", "-pix_fmt", "yuv420p",
            "-movflags", "+faststart", out]
    return cmd


def run(event: dict, *, get, put, put_json, ffmpeg: str, ffprobe: str) -> dict:
    version = st.card_version(event.get("jobId", ""))
    try:
        with tempfile.TemporaryDirectory() as tmp:
            clips, first = [], None
            fetched: dict[str, tuple[str, str | None]] = {}  # windows of one generation: fetched once
            for i, c in enumerate(event["clips"]):
                if c["key"] in fetched:
                    dest, ext = fetched[c["key"]]
                else:
                    dest = os.path.join(tmp, f"clip{i}.mp4")
                    get(c["key"], dest)
                    ext = st.still_ext(dest)
                    if ext:
                        named = os.path.join(tmp, f"clip{i}{ext}")
                        os.rename(dest, named)
                        dest = named
                    try:
                        meta = st.probe(ffprobe, dest)
                    except (subprocess.CalledProcessError, subprocess.TimeoutExpired, ValueError, KeyError, IndexError) as e:
                        print(json.dumps({"kind": "timeline_probe", "jobId": event.get("jobId"), "clip": i, "error": str(e)[:500]}))
                        raise st.BadClip(i) from e
                    first = first or meta
                    fetched[c["key"]] = (dest, ext)
                clips.append({"path": dest, **({"still": True} if ext else {}),
                              **{k: c[k] for k in ("startS", "inS", "outS", "speed", "holdS", "fadeInS", "fadeOutS", "transitionIn")
                                 if c.get(k) is not None}})
            texts = []
            for j, t in enumerate(event.get("texts") or []):
                dest = os.path.join(tmp, f"text{j}.png")
                get(t["key"], dest)
                texts.append({"path": dest, **{k: t[k] for k in ("fromS", "toS", "fadeInS", "fadeOutS") if t.get(k) is not None}})
            card = None
            if event.get("endCard"):
                dest = os.path.join(tmp, "endcard.png")
                get(event["endCard"]["key"], dest)
                card = {"path": dest, "s": event["endCard"]["s"], **({"transitionIn": event["endCard"]["transitionIn"]}
                                                                    if event["endCard"].get("transitionIn") else {})}
            pieces(clips, card)  # refuses clips that overlap, before anything is fetched further or rendered
            want = film_length(clips, card)
            if abs(want - float(event["lengthS"])) > 0.05:
                raise BadPlan(f"the plan says {event['lengthS']} s, its clips and card make {want:g} s")
            size = st.target_size(first["w"], first["h"])
            out = os.path.join(tmp, "ad.mp4")
            cmd = build_command(ffmpeg, clips, texts, card, size, version, st.load_assets(version), out)
            r = subprocess.run(cmd, capture_output=True, text=True, timeout=600)
            if r.returncode != 0:
                print(json.dumps({"kind": "timeline_ffmpeg", "jobId": event.get("jobId"), "stderr": r.stderr.strip()[-2000:]}))
                raise RuntimeError("The ad could not be rendered. Try again.")
            data = Path(out).read_bytes()
            meta = st.probe(ffprobe, out)
            put(event["outKey"], out, "video/mp4")
            result = {"ok": True, "sha256": "sha256:" + hashlib.sha256(data).hexdigest(), "bytes": len(data),
                      "w": meta["w"], "h": meta["h"], "durationS": round(meta["durationS"], 2), "endCard": version,
                      "lengthS": round(want, 3)}
    except st.BadClip as e:
        result = {"ok": False, "code": "bad_clip", "clip": e.index, "error": str(e), "endCard": version}
    except BadPlan as e:
        result = {"ok": False, "code": "bad_clip", "error": f"This cut cannot be rendered: {e}.", "endCard": version}
    except Exception as e:
        message = str(e) if isinstance(e, RuntimeError) else f"{type(e).__name__}: {e}"
        result = {"ok": False, "error": message[:500], "endCard": version}
    put_json(event["resultKey"], result)
    print(json.dumps({"kind": "timeline", "jobId": event.get("jobId"), **result}))
    return result
