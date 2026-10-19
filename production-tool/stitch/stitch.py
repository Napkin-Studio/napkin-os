"""Stitch Lambda: the selected clips → one MP4 with the Napkin end card.

Invoked asynchronously by the relay with
  {"jobId", "clips": [{"key": "out/sha256:…", "trimS": 4.5?, "inS": 0.5?, "outS": 4?, "fit": "trim"|"speed"?,
                       "transition": {"kind": "cut"|"continue"|"dissolve"|"dip", "s": 0.5?}?}, …],
   "outKey": "ads/<jobId>.mp4", "resultKey": "ads/<jobId>.json"}
It writes outKey, then resultKey = {"ok": true, "sha256", "bytes", "w", "h",
"durationS", "endCard", "seams"?} or {"ok": false, "error", "endCard"}, with "code":
"bad_clip" and "clip" (its index) when one clip cannot be read; the relay polls
for resultKey. The card draws no text of the job's own.

Every clip is scaled and padded to one size (the first clip's, even, at most
1280 on the long side), one fps (24), trimmed to trimS seconds when given and
held on its last frame up to trimS when shorter, audio dropped (no audio on
Wednesday), then the 2.5 s end card.

In and out points and transitions (features/connected-video.clan, phase 1): a clip
starts at inS in its source (absent: 0) and never shows a frame past outS; its slot
in the ad is trimS (the shot's length; absent: outS - inS). A clip's `transition` is
the join into it from the clip before: a cut (absent), a dissolve, or a dip through
black, over s seconds (TRANSITION_S when absent). The overlap comes from the
outgoing clip's out-handle (its frames after its slot: clips are billed longer than
shots), held on its last frame when it has none, so the ad is still the sum of the
slots plus the card. A request of videos with no inS, outS, fit or transition builds
exactly the command it always did.

Joined shots (features/connected-video.clan, phases A and B): `fit` "speed" retimes the
clip's whole window (inS to outS, else to its end) into its slot with setpts, so a clip
made to land on the next shot's frame keeps that frame instead of losing its tail to
trimS; at most MAX_SPEED faster or slower, else it is trimmed as before and the log says
why. A "continue" transition is a cut where the clip before landed on this clip's first
frame: the outgoing window ends one frame early, so the shared frame shows once. Several
clips may be windows of one take (the same key, other inS/outS): it is fetched once. With two clips or more, "seams" scores each join
for Jude (seam_scores): scores only, relative to the clips' own neighbouring frames.

The end card (features/ad-end-card.clan): "Roll Up Reveals Crew". The studio mark
rolls in from the right along the wordmark's line, two turns, uncovering "Napkin
Studio" and resting beside it; below, a hairline draws in its wake and six
agents pop up as the disc passes above each. Two versions, white and ink,
picked per job from the jobId (card_version). The pieces are PNGs in
endcard/<version>/ (drawn by endcard/render_assets.py), composited here by
ffmpeg, so the Lambda needs no browser and no font. ffmpeg and ffprobe come
from the layer (/opt/bin, see build-layer.sh).
"""

from __future__ import annotations

import hashlib
import json
import os
import struct
import subprocess
import tempfile
from pathlib import Path

FPS = 24
MAX_SIDE = 1280
CARD_S = 2.5  # web: production-tool/web/src/jobs/clips.ts END_CARD_S
STILL_S = 5.0  # a still with no trimS (the mock's PNG clips) is held this long
TRANSITION_S = 0.5  # a dissolve's or dip's length when the request names none
MAX_TRANSITION_S = 2.0
MAX_SPEED = 1.33  # fit "speed": the most a window is sped up (or slowed down) to fill its slot
XFADE = {"dissolve": "fade", "dip": "fadeblack"}  # ffmpeg xfade's name for each transition
SEAM_PAD = 4  # neighbouring frame pairs each side of a seam: each clip's own baseline

# Pictures among the clips: the mock makes a still for a clip (2026-10-09).
STILL_MAGIC = ((b"\x89PNG\r\n\x1a\n", ".png"), (b"\xff\xd8\xff", ".jpg"))


class BadClip(Exception):
    """One clip ffprobe cannot read: the result names it (code bad_clip) so the participant knows
    which shot to make again, instead of ffmpeg's text with temp paths."""

    def __init__(self, index: int):
        super().__init__(f"Shot {index + 1}'s clip could not be read. Make it again, then render.")
        self.index = index


def still_ext(path: str) -> str | None:
    """'.png' or '.jpg' when the file is a picture, not a video."""
    with open(path, "rb") as f:
        head = f.read(16)
    if head[:4] == b"RIFF" and head[8:12] == b"WEBP":
        return ".webp"
    return next((ext for magic, ext in STILL_MAGIC if head.startswith(magic)), None)

ENDCARD_DIR = Path(__file__).resolve().parent / "endcard"
VERSIONS = ("roll-up", "roll-up-ink")
GROUND = {"roll-up": (0xFF, 0xFF, 0xFF), "roll-up-ink": (0x0F, 0x11, 0x14)}
INK = {"roll-up": (0x14, 0x16, 0x1B), "roll-up-ink": (0xF2, 0xF3, 0xF5)}
LINE_ALPHA = 0.16
CREW = ("extract", "market_structure", "culture", "positioning", "codes", "judge")  # Ellis … Jude

# The layout, as fractions of the frame's short side (the examples' vmin / 100).
REF_SHORT = 1440   # the PNGs are drawn for this short side; ffmpeg scales them down
MARK = 0.096       # the disc
GAP = 0.026        # disc to word
WORD_FS = 0.076    # the wordmark's font size = its line box (line-height 1)
MADE_GAP = 0.011   # "Made with" sits this far above the word's line box
MADE_RISE = 0.010  # and rises this far as it fades in
ROW_TOP = 0.064    # lockup to the crew row
ROW_H = 0.086      # the crew row; the hairline is its bottom edge
FIG_H = 0.082      # an agent's height
LINE_OUT = 0.015   # the hairline runs past the lockup by this on each side
CENTRE_Y = 0.47    # the block's centre, as a share of the height

# The timeline, in seconds.
ROLL_AT, ROLL_S = 0.08, 1.5
TURNS = 2
FADE_S = 0.22
POP_S = 0.44
MADE_AT, MADE_S = 1.33, 0.52

# The examples' CSS curves as polynomials E(p) = c1·p + … + c9·p⁹ (E(0)=0, E(1)=1),
# because ffmpeg expressions can't invert a cubic-bezier. Fitted by least squares;
# test_stitch.py holds each within 0.5 % of its bezier.
ROLL_EASE = (0.504575, -12.240498, 156.019425, -598.808403, 1131.804461, -1167.847152, 637.687455, -150.478947, 4.359084)  # cubic-bezier(.33,0,.2,1), fitted with E'(1)=0 so the disc never overshoots
POP_EASE = (4.671018, -5.109387, -0.796997, -14.014476, 70.405428, -120.991089, 105.697527, -47.791837, 8.929811)  # cubic-bezier(.3,1.4,.5,1)
STUDIO_EASE = (3.723516, 11.836316, -130.507593, 457.400174, -880.641207, 1016.806320, -699.377116, 263.276241, -41.516650)  # --ease (.2,.8,.2,1)


def even(n: float) -> int:
    return max(2, int(n) // 2 * 2)


def target_size(w: int, h: int, max_side: int = MAX_SIDE) -> tuple[int, int]:
    scale = min(1.0, max_side / max(w, h))
    return even(w * scale), even(h * scale)


def card_version(job_id: str) -> str:
    """The end card for a job: the same jobId always gets the same one."""
    return VERSIONS[hashlib.sha256((job_id or "").encode()).digest()[0] % len(VERSIONS)]


def ease(coef: tuple[float, ...], p: float) -> float:
    p = min(1.0, max(0.0, p))
    acc = 0.0
    for c in reversed(coef):
        acc = (acc + c) * p
    return acc


def ease_expr(coef: tuple[float, ...], start: float, dur: float) -> str:
    """ffmpeg expression for ease(coef, (t - start) / dur); it uses register 0."""
    horner = f"{coef[-1]:.6f}"
    for c in reversed(coef[:-1]):
        horner = f"{c:.6f}+ld(0)*({horner})"
    return f"(st(0,clip((t-{start:g})/{dur:g},0,1));ld(0)*({horner}))"


def png_size(path: str | Path) -> tuple[int, int]:
    with open(path, "rb") as f:
        head = f.read(24)
    if head[:8] != b"\x89PNG\r\n\x1a\n":
        raise ValueError(f"not a PNG: {path}")
    return struct.unpack(">II", head[16:24])


def load_assets(version: str, root: Path = ENDCARD_DIR) -> dict:
    """{piece: {"path", "w", "h"}} for mark, made, word and fig-<agent>."""
    out = {}
    for name in ("mark", "made", "word", *(f"fig-{k}" for k in CREW)):
        p = root / version / f"{name}.png"
        w, h = png_size(p)
        out[name] = {"path": str(p), "w": w, "h": h}
    return out


def _hex(rgb: tuple[int, int, int]) -> str:
    return "0x" + "".join(f"{round(c):02X}" for c in rgb)


def card_layout(w: int, h: int, assets: dict) -> dict:
    """Where every piece goes on a w×h card, and when each agent appears."""
    s = min(w, h)
    k = s / REF_SHORT
    m = even(MARK * s)
    gap = GAP * s
    word_w, word_h = max(1, round(assets["word"]["w"] * k)), max(1, round(assets["word"]["h"] * k))
    made_w, made_h = max(1, round(assets["made"]["w"] * k)), max(1, round(assets["made"]["h"] * k))
    lock_w = m + gap + word_w
    xl = (w - lock_w) / 2
    block_h = m + (ROW_TOP + ROW_H) * s          # the lockup is as tall as the disc
    top = CENTRE_Y * h - block_h / 2
    word_x = xl + m + gap
    word_y = top + m / 2 - word_h / 2             # the PNG is centred on its line box
    made_y = top + m / 2 - WORD_FS * s / 2 - MADE_GAP * s - made_h
    line_y = top + m + (ROW_TOP + ROW_H) * s      # the row's bottom edge
    line_t = max(1, round(s / 720))
    line_x, line_w = xl - LINE_OUT * s, lock_w + 2 * LINE_OUT * s
    fig_h = max(2, round(FIG_H * s))
    figs = []
    sizes = [(max(2, round(assets[f"fig-{a}"]["w"] * fig_h / assets[f"fig-{a}"]["h"])), fig_h) for a in CREW]
    spare = (lock_w - sum(fw for fw, _ in sizes)) / (len(CREW) - 1)   # justify-content: space-between
    lead0, lead1 = xl + lock_w, xl              # the disc's leading edge, at the start and at rest
    x = xl
    for agent, (fw, fh) in zip(CREW, sizes):
        cx = x + fw / 2
        figs.append({"agent": agent, "x": x, "w": fw, "h": fh,
                     "at": ROLL_AT + ROLL_S * _time_for((lead0 - cx) / (lead0 - lead1))})
        x += fw + spare
    return {"w": w, "h": h, "s": s, "mark": m, "xl": xl, "lock_w": lock_w, "top": top,
            "mark_y": top, "word": (word_x, word_y, word_w, word_h), "made": (word_x, made_y, made_w, made_h),
            "line": (line_x, line_y - line_t, line_w, line_t), "line_y": line_y, "figs": figs,
            "lead0": lead0, "lead1": lead1}


def _time_for(share: float) -> float:
    """The roll's time fraction at which it has covered `share` of its travel."""
    share = min(1.0, max(0.0, share))
    lo, hi = 0.0, 1.0
    for _ in range(50):
        mid = (lo + hi) / 2
        if ease(ROLL_EASE, mid) < share:
            lo = mid
        else:
            hi = mid
    return (lo + hi) / 2


def card_graph(first: int, version: str, layout: dict, fps: int = FPS) -> tuple[list[str], list[str]]:
    """(extra ffmpeg inputs, filter chains ending in [card]). Input `first` is the
    ground; the PNGs and the two moving covers follow it in input order."""
    L = layout
    w, h, m = L["w"], L["h"], L["mark"]
    ground = _hex(GROUND[version])
    line_rgb = tuple(g * (1 - LINE_ALPHA) + i * LINE_ALPHA for g, i in zip(GROUND[version], INK[version]))
    roll = ease_expr(ROLL_EASE, ROLL_AT, ROLL_S)
    disc_x = f"{L['xl']:.2f}+{L['lock_w']:.2f}*(1-{roll})"
    wx, wy, ww, wh = L["word"]
    _, my, mw, mh = L["made"]
    lx, ly, lw, lt = L["line"]

    assets = ["mark", "word", "made", *(f"fig-{f['agent']}" for f in L["figs"])]
    inputs = ["-f", "lavfi", "-t", f"{CARD_S:g}", "-i", f"color=c={ground}:s={w}x{h}:r={fps}"]
    for name in assets:
        inputs += ["-loop", "1", "-framerate", str(fps), "-t", f"{CARD_S:g}", "-i", L["paths"][name]]
    cover_w = round(L["lock_w"] + m + 4)
    line_cover_w = round(lw + 4)
    # overlay snaps y to even rows on yuv420, so the cover is taller than the line and
    # starts 2 rows above it (the crew is drawn after it, so it hides nothing else).
    line_cover_h = lt + 4
    inputs += ["-f", "lavfi", "-t", f"{CARD_S:g}", "-i", f"color=c={ground}:s={cover_w}x{wh}:r={fps}"]
    inputs += ["-f", "lavfi", "-t", f"{CARD_S:g}", "-i", f"color=c={ground}:s={line_cover_w}x{line_cover_h}:r={fps}"]
    i_mark, i_word, i_made = first + 1, first + 2, first + 3
    i_figs = range(first + 4, first + 4 + len(L["figs"]))
    i_cover, i_line_cover = first + 4 + len(L["figs"]), first + 5 + len(L["figs"])

    angle = f"-{2 * TURNS}*PI*(1-{roll})"
    p = [f"[{i_mark}:v]scale={m}:{m}:flags=lanczos,format=rgba,rotate=a='{angle}':c=none:ow={m}:oh={m},"
         f"fade=t=in:st={ROLL_AT:g}:d={FADE_S:g}:alpha=1[mk]",
         f"[{i_word}:v]scale={ww}:{wh}:flags=lanczos,format=rgba[wd]",
         f"[{i_made}:v]scale={mw}:{mh}:flags=lanczos,format=rgba,fade=t=in:st={MADE_AT:g}:d={MADE_S:g}:alpha=1[md]"]
    for j, (i, f) in enumerate(zip(i_figs, L["figs"])):
        p.append(f"[{i}:v]scale={f['w']}:{f['h']}:flags=lanczos,format=rgba[f{j}]")
    # The hairline, hidden left of the disc's wake.
    vis = f"{lx:.2f}+{L['lead0'] - lx:.2f}*(1-{roll})"
    p.append(f"[{first}:v]drawbox=x={round(lx)}:y={round(ly)}:w={round(lw)}:h={lt}:color={_hex(line_rgb)}:t=fill[c0]")
    p.append(f"[c0][{i_line_cover}:v]overlay=x='{vis}-{line_cover_w}':y={round(ly) - 2}[c1]")
    # The crew pops up out of the row; anything below the hairline is covered.
    c = 1
    for j, f in enumerate(L["figs"]):
        pop = ease_expr(POP_EASE, f["at"], POP_S)
        y = f"{L['line_y'] - f['h']:.2f}+{1.05 * f['h']:.2f}*(1-{pop})"
        p.append(f"[c{c}][f{j}]overlay=x={round(f['x'])}:y='{y}'[c{c + 1}]")
        c += 1
    below = round(L["line_y"])
    p.append(f"[c{c}]drawbox=x={round(lx) - 2}:y={below}:w={round(lw) + 4}:h={round(1.2 * L['figs'][0]['h']) + 4}:"
             f"color={ground}:t=fill[c{c + 1}]")
    c += 1
    # The word, uncovered behind the disc's trailing edge; then "Made with"; then the disc.
    p.append(f"[c{c}][wd]overlay=x={round(wx)}:y={round(wy)}[c{c + 1}]")
    c += 1
    p.append(f"[c{c}][{i_cover}:v]overlay=x='{disc_x}+{m}-{cover_w}':y={round(wy)}[c{c + 1}]")
    c += 1
    made_y = f"{my:.2f}+{MADE_RISE * L['s']:.2f}*(1-{ease_expr(STUDIO_EASE, MADE_AT, MADE_S)})"
    p.append(f"[c{c}][md]overlay=x={round(wx)}:y='{made_y}'[c{c + 1}]")
    c += 1
    p.append(f"[c{c}][mk]overlay=x='{disc_x}':y={round(L['mark_y'])},setsar=1,format=yuv420p[card]")
    return inputs, p


def _secs(x: float) -> str:
    return f"{round(float(x), 6):g}"


def slot_s(c: dict) -> float | None:
    """How long a clip is in the ad: its trimS (the shot's length), else outS - inS, else (a video with
    neither) its whole length, unknown here (None). A still with neither is held STILL_S."""
    if c.get("trimS"):
        return float(c["trimS"])
    if c.get("still"):
        return STILL_S
    if c.get("outS") is not None and float(c["outS"]) > float(c.get("inS") or 0):
        return float(c["outS"]) - float(c.get("inS") or 0)
    return None


def joins(clips: list[dict], fps: int = FPS) -> list[tuple[str, float]]:
    """The join into each clip, as (kind, seconds): ("cut", 0) for the first clip, for a cut, and for a
    transition next to a clip of unknown length. A transition is whole frames long, at most the incoming
    clip's slot (its first frames carry it) and MAX_TRANSITION_S."""
    out = [("cut", 0.0)]
    for prev, cur in zip(clips, clips[1:]):
        t = cur.get("transition") or {}
        kind = t.get("kind", "cut")  # continue is a cut here: its shared frame is dropped in fit_windows
        a, b = slot_s(prev), slot_s(cur)
        if kind not in XFADE or a is None or b is None:
            out.append(("cut", 0.0))
            continue
        s = min(float(t.get("s") or TRANSITION_S), b, MAX_TRANSITION_S)
        frames = round(s * fps)
        out.append((kind, frames / fps) if frames > 0 else ("cut", 0.0))
    return out


def fit_windows(clips: list[dict], probes: list[dict], job_id: str | None = None, fps: int = FPS) -> None:
    """Joined shots' windows, in place (features/connected-video.clan): a clip before a "continue" join
    ends one frame early (its last frame is the next clip's first), and a fit "speed" clip gets the factor
    (window / slot) its whole window plays at, within MAX_SPEED either way; past it, or with no slot to
    fill, it is trimmed as before and stitch_fit_fallback is logged. A clip whose slot came from outS keeps
    that slot as its trimS. Clips with neither are left exactly as they came."""
    for i, (c, p) in enumerate(zip(clips, probes)):
        shared = i + 1 < len(clips) and (clips[i + 1].get("transition") or {}).get("kind") == "continue"
        speed = c.pop("fit", None) == "speed"
        if c.get("still") or not (shared or speed):
            continue
        slot = slot_s(c)
        ins = float(c.get("inS") or 0)
        end = float(c["outS"]) if c.get("outS") is not None else p["durationS"]
        if shared:
            end -= 1 / fps
        if slot is not None and not c.get("trimS"):
            c["trimS"] = slot
        c["outS"] = round(end, 6)
        window = end - ins
        if not speed:
            continue
        factor = window / slot if slot and window > 0 else None
        if factor is None or not 1 / MAX_SPEED - 1e-6 <= factor <= MAX_SPEED + 1e-6:
            print(json.dumps({"kind": "stitch_fit_fallback", "jobId": job_id, "clip": i, "windowS": round(window, 3),
                              "slotS": slot, "why": "no slot" if factor is None else f"speed {factor:.2f} past {MAX_SPEED}"}))
            continue
        c["speed"], c["window"] = factor, window


def build_command(ffmpeg: str, clips: list[dict], size: tuple[int, int], version: str, assets: dict,
                  out: str, fps: int = FPS) -> list[str]:
    """clips: [{"path", "trimS"?, "still"?, "inS"?, "outS"?, "transition"?}]; assets: load_assets(version).
    A still is looped for its trimS (or STILL_S): one frame made the mock's ads only the end card
    (2026-10-09). With no inS, outS or transition, the command is exactly what it was before them."""
    w, h = size
    js = joins(clips, fps)
    # The out-handle each clip lends the transition after it: it runs that much past its slot.
    handle = [s for _, s in js[1:]] + [0.0]
    cmd = [ffmpeg, "-hide_banner", "-loglevel", "error", "-y"]
    holds: list[float | None] = []  # the length each video is padded and trimmed to (None: as it comes)
    lengths: list[float] = []  # each clip's length in the graph: its slot plus its handle
    for c, hs in zip(clips, handle):
        slot = slot_s(c)
        lengths.append(slot + hs if slot is not None else 0.0)
        if c.get("still"):
            cmd += ["-loop", "1", "-framerate", str(fps), "-t", _secs(slot + hs)]
            # Held too: scaling a looped picture drops its last frame, which made each still (the mock's
            # clips) a frame short of its shot (features/connected-video.clan, 2026-10-15).
            holds.append(slot + hs)
        else:
            ins = float(c.get("inS") or 0)
            if ins > 0:
                cmd += ["-ss", _secs(ins)]
            if c.get("speed"):  # the whole window, retimed into the slot below
                cmd += ["-t", _secs(c["window"])]
                holds.append(slot + hs)
            elif slot is not None:
                avail = float(c["outS"]) - ins if c.get("outS") is not None else None
                # A clip that ends (outS) before its slot does is held from there, handle and all; otherwise
                # it reads on past its slot into its out-handle.
                read = avail if avail is not None and avail < slot else slot + hs
                cmd += ["-t", _secs(read)]
                holds.append(slot + hs)
            else:
                holds.append(None)
        cmd += ["-i", c["path"]]
    layout = card_layout(w, h, assets)
    layout["paths"] = {name: a["path"] for name, a in assets.items()}
    n = len(clips)
    card_inputs, card_parts = card_graph(n, version, layout, fps)
    cmd += card_inputs
    parts = []
    for i, c in enumerate(clips):
        # A clip shorter than its shot (Veo stops at 8 s, a feel edit at 5) holds its last frame up to
        # trimS, so the ad is as long as planned (2026-10-09).
        hold = "" if holds[i] is None else (
            f",tpad=stop_mode=clone:stop_duration={_secs(holds[i])},trim=duration={_secs(holds[i])},setpts=PTS-STARTPTS")
        if js[i][0] != "cut" or (i + 1 < n and js[i + 1][0] != "cut"):
            hold += f",fps={fps}"  # xfade needs a constant frame rate and one time base; tpad leaves neither
        retime = f"setpts=(PTS-STARTPTS)/{c['speed']:.6f}," if c.get("speed") else ""
        parts.append(f"[{i}:v]scale={w}:{h}:force_original_aspect_ratio=decrease,"
                     f"pad={w}:{h}:(ow-iw)/2:(oh-ih)/2:color=black,setsar=1,{retime}fps={fps},format=yuv420p{hold}[v{i}]")
    # Clips joined by transitions form one piece (xfade, the offset counted from the piece's start);
    # pieces and the card are concatenated, so with only cuts this is the one concat it always was.
    labels = []
    for i in range(n):
        kind, s = js[i]
        if kind == "cut":
            labels.append(f"v{i}")
            acc = lengths[i]
            continue
        offset = acc - s
        parts.append(f"[{labels[-1]}][v{i}]xfade=transition={XFADE[kind]}:duration={_secs(s)}:offset={_secs(offset)}[x{i}]")
        labels[-1] = f"x{i}"
        acc = offset + lengths[i]
    parts += card_parts
    labels.append("card")
    parts.append(f"{''.join(f'[{lab}]' for lab in labels)}concat=n={len(labels)}:v=1:a=0[out]")
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
    try:  # a still has no duration ("N/A")
        duration = float(data.get("format", {}).get("duration", 0) or 0)
    except ValueError:
        duration = 0.0
    return {"w": int(s["width"]), "h": int(s["height"]), "durationS": duration}


def _colour_means(ffmpeg: str, path: str, side: int = 16) -> list[tuple[float, float, float]]:
    """Each frame's mean red, green and blue (0-255), from a side x side thumbnail."""
    r = subprocess.run([ffmpeg, "-hide_banner", "-loglevel", "error", "-i", path, "-map", "0:v:0",
                        "-vf", f"scale={side}:{side}:flags=area,format=rgb24", "-f", "rawvideo", "-"],
                       capture_output=True, check=True, timeout=300)
    n, px = side * side * 3, side * side
    buf = r.stdout
    return [tuple(sum(buf[i + k:i + n:3]) / px for k in range(3)) for i in range(0, len(buf) - n + 1, n)]


def seam_scores(ffmpeg: str, ffprobe: str, path: str, seams: list[dict], tmp: str, fps: int = FPS,
                pad: int = SEAM_PAD) -> list[dict]:
    """Jude's score of each join in the ad at `path` (features/connected-video.clan). Scores only: no
    threshold, no flag, until they are tuned on real remakes.

    seams: [{at_s, kind, s}], the joins' times (the incoming clip's first frame) and transitions.
    Returns [{at_s, kind, score, colour}]:
      score   the lowest SSIM between neighbouring frames across the join (and, for a transition, from the
              last frame before it to the first after it: a dissolve between unlike shots is a jump),
              relative to the lowest SSIM among the `pad` neighbouring pairs inside each clip on either
              side, capped at 1 (1.0: as smooth as the clips themselves). splice._ssim_run measures it.
      colour  how much more the mean colour moves across the join than between any two neighbouring
              frames inside either clip, as a share of full scale (0: no more than the clips themselves)."""
    import splice  # beside this file

    if not seams:
        return []
    frames = splice.probe(ffprobe, path)["frames"]
    ssim = splice._ssim_run(ffmpeg, path, 0, frames - 1, tmp, "ad")  # ssim[j]: frame j against j + 1
    means = _colour_means(ffmpeg, path)

    def moved(a: int, b: int) -> float:
        if max(a, b) >= len(means):
            return 0.0
        return sum(abs(x - y) for x, y in zip(means[a], means[b])) / (3 * 255)

    out = []
    for seam in seams:
        k, tf = round(seam["at_s"] * fps), round(float(seam.get("s") or 0) * fps)
        if k < 1 or k + tf >= frames:
            continue
        across = ssim[k - 1:k + tf]
        base = ssim[max(0, k - 1 - pad):k - 1] + ssim[k + tf:k + tf + pad]
        if not across or not base:
            continue
        floor = max(min(base), 1e-6)
        ratios = [min(across) / floor]
        if tf:
            jump = splice._ssim_run(ffmpeg, path, k - 1, k, tmp, f"x{k}", gap=tf + 1)
            if jump:
                ratios.append(jump[0] / floor)
        inside = [moved(j, j + 1) for j in [*range(max(0, k - 1 - pad), k - 1), *range(k + tf, min(frames - 1, k + tf + pad))]]
        colour = max(0.0, moved(k - 1, k + tf) - max(inside, default=0.0))
        out.append({"at_s": seam["at_s"], "kind": seam.get("kind", "cut"), "score": round(min(1.0, *ratios), 3),
                    "colour": round(colour, 3)})
    return out


def run(event: dict, *, get, put, put_json, ffmpeg: str, ffprobe: str) -> dict:
    """get(key, dest_path); put(key, src_path, mime); put_json(key, dict).
    An event with `mode` "cut" or "splice" is Fix this moment's (splice.py, features/clip-moment-edit.clan);
    "cutdown" is a length or a shape of the ad (cutdown.py, features/campaign-formats.clan); one with no
    mode is the ad, as it always was."""
    if event.get("mode") == "cutdown":  # a length or a shape of the ad (cutdown.py, features/campaign-formats.clan)
        import cutdown  # beside this file, in the Lambda zip too

        return cutdown.run(event, get=get, put=put, put_json=put_json, ffmpeg=ffmpeg, ffprobe=ffprobe)
    if event.get("mode"):
        import splice  # beside this file, in the Lambda zip too

        return splice.run(event, get=get, put=put, put_json=put_json, ffmpeg=ffmpeg, ffprobe=ffprobe)
    version = card_version(event.get("jobId", ""))
    try:
        with tempfile.TemporaryDirectory() as tmp:
            clips, probes = [], []
            fetched: dict[str, tuple[str, str | None, dict]] = {}  # windows of one take: fetched once
            for i, c in enumerate(event["clips"]):
                if c["key"] in fetched:
                    dest, ext, meta = fetched[c["key"]]
                else:
                    dest = os.path.join(tmp, f"clip{i}.mp4")
                    get(c["key"], dest)
                    ext = still_ext(dest)
                    if ext:  # ffmpeg loops a picture only when it reads it as one
                        named = os.path.join(tmp, f"clip{i}{ext}")
                        os.rename(dest, named)
                        dest = named
                    try:  # every clip first, so a broken one is named, not ffmpeg's text
                        meta = probe(ffprobe, dest)
                    except (subprocess.CalledProcessError, subprocess.TimeoutExpired, ValueError, KeyError, IndexError) as e:
                        print(json.dumps({"kind": "stitch_probe", "jobId": event.get("jobId"), "clip": i, "error": str(e)[:500]}))
                        raise BadClip(i) from e
                    fetched[c["key"]] = (dest, ext, meta)
                probes.append(meta)
                clips.append({"path": dest, **({"trimS": c["trimS"]} if c.get("trimS") else {}), **({"still": True} if ext else {}),
                              **{k: c[k] for k in ("inS", "outS", "transition", "fit") if c.get(k) is not None}})
            fit_windows(clips, probes, event.get("jobId"))
            size = target_size(probes[0]["w"], probes[0]["h"])
            out = os.path.join(tmp, "ad.mp4")
            cmd = build_command(ffmpeg, clips, size, version, load_assets(version), out)
            r = subprocess.run(cmd, capture_output=True, text=True, timeout=600)
            if r.returncode != 0:  # ffmpeg's own words (temp paths) go to the log, not to the participant
                print(json.dumps({"kind": "stitch_ffmpeg", "jobId": event.get("jobId"), "stderr": r.stderr.strip()[-2000:]}))
                raise RuntimeError("The ad could not be rendered. Try again.")
            data = Path(out).read_bytes()
            meta = probe(ffprobe, out)
            put(event["outKey"], out, "video/mp4")
            result = {"ok": True, "sha256": "sha256:" + hashlib.sha256(data).hexdigest(), "bytes": len(data),
                      "w": meta["w"], "h": meta["h"], "durationS": round(meta["durationS"], 2), "endCard": version}
            if len(clips) > 1:  # Jude's scores; the ad stands whatever happens to them
                try:
                    lengths = [slot_s(c) if slot_s(c) is not None else max(0.0, p["durationS"] - float(c.get("inS") or 0))
                               for c, p in zip(clips, probes)]
                    at, seams = 0.0, []
                    for i, (kind, s) in enumerate(joins(clips)):
                        if i:
                            seams.append({"at_s": round(at, 3), "kind": kind, "s": s})
                        at += lengths[i]
                    result["seams"] = seam_scores(ffmpeg, ffprobe, out, seams, tmp)
                except Exception as e:  # noqa: BLE001
                    print(json.dumps({"kind": "stitch_seams_failed", "jobId": event.get("jobId"), "error": str(e)[:500]}))
    except BadClip as e:  # the relay shows this as invalid_input, not retried
        result = {"ok": False, "code": "bad_clip", "clip": e.index, "error": str(e), "endCard": version}
    except Exception as e:  # the relay shows this as provider_failed
        message = str(e) if isinstance(e, RuntimeError) else f"{type(e).__name__}: {e}"
        result = {"ok": False, "error": message[:500], "endCard": version}
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
    )
