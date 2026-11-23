#!/usr/bin/env python3
"""Render the walkthrough from edl.py: one MP4 segment per EDL row, then concat. Writes chapters.json."""
import json, os, subprocess, sys, textwrap
from concurrent.futures import ThreadPoolExecutor
sys.path.insert(0, os.path.dirname(__file__))
from edl_v2 import EDL, R

BUILD = "/tmp/claude-1000/-home-batunii-Documents-Code-napkin-studio-production-tool/5f9369b1-b1e6-4fd3-b44c-d946c8ad0c67/scratchpad/build_v2"
os.makedirs(BUILD, exist_ok=True)
NOTO = "/usr/share/fonts/noto/NotoSans-Regular.ttf"
NOTOB = "/usr/share/fonts/noto/NotoSans-Bold.ttf"
NOTOM = "/usr/share/fonts/noto/NotoSans-Medium.ttf"
DJB = "/usr/share/fonts/TTF/DejaVuSans-Bold.ttf"
W, H, BAR = 1440, 900, 118
CAP_ACTION, CAP_FAST, CAP_FOLLOW = 6.0, 2.5, 4.0

def fmt_real(s):
    s = round(s)
    return f"{s // 60} min {s % 60:02d} s" if s >= 60 else f"{s} s"

def tf(name, text):
    p = f"{BUILD}/{name}.txt"
    open(p, "w").write(text)
    return p

def caption_filters(i, chapter, caption, top_offset=0):
    if not caption:
        return []
    lines = textwrap.wrap(caption, 96)
    size = 26 if len(lines) <= 2 else 23
    if len(lines) > 2:
        lines = textwrap.wrap(caption, 108)
    f = [f"drawbox=x=0:y=ih-{BAR}:w=iw:h={BAR}:color=0x10131A@0.82:t=fill",
         f"drawbox=x=0:y=ih-{BAR}:w=6:h={BAR}:color=0xE8B04B@1:t=fill"]
    if chapter:
        f.append(f"drawtext=fontfile={NOTOB}:textfile={tf(f'ch{i}', chapter)}:expansion=none:fontsize=17:fontcolor=0xE8B04B:x=36:y=h-{BAR}+12")
    y0 = BAR - 40 if len(lines) == 1 else BAR - 40
    f.append(f"drawtext=fontfile={NOTOM}:textfile={tf(f'cap{i}', chr(10).join(lines))}:expansion=none:fontsize={size}:fontcolor=white:line_spacing=7:x=36:y=h-{BAR}+40")
    return f

def badge_filters(i, speed, real):
    if speed < 3.5:
        return []
    label = f"▶▶  {speed:.0f}×   ·   {fmt_real(real)} real time"
    return [f"drawtext=fontfile={DJB}:textfile={tf(f'bd{i}', label)}:expansion=none:fontsize=24:fontcolor=white:box=1:boxcolor=0xD9541E@0.92:boxborderw=12:x=w-tw-40:y=96"]

def plan():
    """Effective speeds: keep each segment short enough for a ~10 min film."""
    out = []
    for i, (clip, s, e, sp, ch, cap) in enumerate(EDL):
        d = e - s
        if clip.startswith("file:") or clip.startswith("card:"):
            eff = 1
        else:
            fast = cap is None and sp >= 4
            limit = CAP_FAST if fast else (CAP_ACTION if cap else CAP_FOLLOW)
            eff = max(sp, d / limit, 1)
            eff = round(eff, 2)
        out.append((i, clip, s, e, eff))
    return out

def card(i, kind, dur):
    p = f"{BUILD}/{i:03d}.mp4"
    if kind == "title":
        texts = [("Napkin Studio · Quietboil: brief → research → production", DJB, 44, "white", -70),
                 ("One campaign, end to end, on Napkin Studio OS (UAT) · 21 Nov 2026 · v2, re-shot after fixes", NOTO, 26, "0xD8DCE6", 10),
                 ("Quietboil is a fictional quiet kettle. Real brand names are blacked out.", NOTO, 22, "0xE8B04B", 60)]
    else:
        texts = [("What was made", NOTOB, 40, "white", -300),
                 ("A locked creative brief, rewritten on research (insight: 'Your 11pm is their 3am.')", NOTO, 24, "0xD8DCE6", -230),
                 ("A research report: 15 sources, 39 pinned facts, 3 findings", NOTO, 24, "0xD8DCE6", -192),
                 ("Maya (4 views), the kettle packshot, a Brand board (palette, type, rule)", NOTO, 24, "0xD8DCE6", -154),
                 ("Key visual v2 (fill, change, 2× upscale) + 4:5 crop, 21:9 extend, 9:16 redraw", NOTO, 24, "0xD8DCE6", -116),
                 ("A 20 s script and 8-frame storyboard; 6 takes (WAN 3, one Veo 3.1 with sound, one retake)", NOTO, 24, "0xD8DCE6", -78),
                 ("The 20 s film (22.5 s with the studio card), 6 s cutdowns in 16:9, 1:1 and 9:16, 37-file media zip", NOTO, 24, "0xD8DCE6", -40),
                 ("Wall time of the first recording 91 min (brief 07:15 to hand-off 08:45 UTC); fixes re-shot on 21 Nov", NOTO, 24, "white", 20),
                 ("Machine time about 30 min (agents + models, summed: brief/research 5.6 min, production 24.7 min)", NOTO, 24, "white", 58),
                 ("Spend: providers $7.54 (first run $7.14 + re-shoot $0.40) · Claude about $2.3 (Brief Maker + Research $1.44, production $0.9)", NOTO, 24, "white", 96),
                 ("Re-shot after the fixes: Draw the rest · film reopen · Make asks first · Dex plans the cuts · sound-off captions in every size", NOTO, 20, "0xE8B04B", 160)]
    vf = ",".join(f"drawtext=fontfile={f}:textfile={tf(f'card{i}_{k}', t)}:expansion=none:fontsize={sz}:fontcolor={c}:x=(w-tw)/2:y=(h-th)/2+{dy}"
                  for k, (t, f, sz, c, dy) in enumerate(texts))
    if kind == "title":
        vf += f",fade=t=in:st=0:d=0.4,fade=t=out:st={dur-0.4}:d=0.4"
    subprocess.run(["ffmpeg", "-loglevel", "error", "-y", "-f", "lavfi", "-i", f"color=c=0x1F2A44:s={W}x{H}:r=30:d={dur}",
                    "-f", "lavfi", "-i", "anullsrc=r=48000:cl=stereo", "-t", str(dur), "-vf", vf,
                    "-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "160k", p], check=True)
    return p

def seg(row, chapter, caption):
    i, clip, s, e, eff = row
    p = f"{BUILD}/{i:03d}.mp4"
    d = e - s
    out_d = d / eff
    if clip.startswith("card:"):
        return card(i, clip[5:], d)
    if clip.startswith("file:"):
        src = f"{R}/{clip[5:]}"
        vh = H - BAR
        vf = [f"scale={W}:{vh}:force_original_aspect_ratio=decrease", f"pad={W}:{H}:(ow-iw)/2:0:color=black", "fps=30"]
        vf += caption_filters(i, chapter, caption) + ["format=yuv420p"]
        subprocess.run(["ffmpeg", "-loglevel", "error", "-y", "-ss", str(s), "-t", str(d), "-i", src, "-vf", ",".join(vf),
                        "-af", "aresample=48000,aformat=channel_layouts=stereo", "-c:v", "libx264", "-preset", "veryfast", "-crf", "20",
                        "-c:a", "aac", "-b:a", "160k", p], check=True)
        return p
    src = f"{R}/raw/{clip}.webm" if "/" in clip else f"{R}/raw/{clip}/{clip}.webm"
    vf = [f"setpts=(PTS-STARTPTS)/{eff}", "fps=30", f"scale={W}:{H}"]
    vf += caption_filters(i, chapter, caption) + badge_filters(i, eff, d) + ["format=yuv420p"]
    subprocess.run(["ffmpeg", "-loglevel", "error", "-y", "-ss", str(s), "-t", str(d), "-i", src,
                    "-f", "lavfi", "-i", "anullsrc=r=48000:cl=stereo", "-map", "0:v", "-map", "1:a",
                    "-vf", ",".join(vf), "-t", f"{out_d:.3f}", "-c:v", "libx264", "-preset", "veryfast", "-crf", "20",
                    "-c:a", "aac", "-b:a", "160k", p], check=True)
    return p

def main():
    rows = plan()
    caps, cap, ch = [], "", ""
    for (i, clip, s, e, eff), (_, _, _, _, chap, c) in zip(rows, EDL):
        if c is not None:
            cap = c
        ch = chap or ch
        caps.append((ch if not clip.startswith("card:") else "", cap if not clip.startswith("card:") else ""))
    only = set(int(x) for x in sys.argv[1:]) if len(sys.argv) > 1 else None
    with ThreadPoolExecutor(8) as ex:
        futs = [ex.submit(seg, r, *caps[k]) for k, r in enumerate(rows) if only is None or r[0] in only]
        paths = [f.result() for f in futs]
    if only is not None:
        return
    # concat + chapters
    lst = f"{BUILD}/list.txt"
    t = 0.0
    marks = []
    with open(lst, "w") as fh:
        for k, r in enumerate(rows):
            p = f"{BUILD}/{r[0]:03d}.mp4"
            dur = float(subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", p], capture_output=True, text=True).stdout)
            marks.append({"i": r[0], "t": round(t, 1), "dur": round(dur, 2), "clip": r[1], "src": [r[2], r[3]], "speed": r[4], "chapter": caps[k][0], "caption": caps[k][1]})
            t += dur
            fh.write(f"file '{p}'\n")
    json.dump(marks, open(f"{R}/drv/chapters-v2.json", "w"), indent=1)
    subprocess.run(["ffmpeg", "-loglevel", "error", "-y", "-f", "concat", "-safe", "0", "-i", lst, "-c:v", "libx264", "-preset", "medium",
                    "-crf", "21", "-r", "30", "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "160k", "-movflags", "+faststart",
                    f"{R}/quietboil-walkthrough-v2.mp4"], check=True)
    print("total", round(t, 1))

main()
