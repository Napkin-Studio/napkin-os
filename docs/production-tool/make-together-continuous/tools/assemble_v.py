"""Join Y-group-1 and V1/V2/V3, measure snaps, write results_v.json and the last-0.5 s strips."""
import json, os, subprocess, sys
import numpy as np
from PIL import Image, ImageDraw
sys.path.insert(0, os.path.dirname(__file__))
from analyse_lib import frames_of, motion, ssim, info  # noqa: E402

OUT = sys.argv[1]; V = os.path.join(OUT, "v"); SB = os.path.join(OUT, "sb")
FPS = 30
ends = dict((l.split()[0], int(l.split()[1])) for l in open(os.path.join(V, "ends.txt")))


def cut(src, dest, start_frame=0, end_frame=None):
    sel = f"trim=start_frame={start_frame}" + (f":end_frame={end_frame + 1}" if end_frame is not None else "")
    subprocess.run(["ffmpeg", "-y", "-v", "error", "-i", src, "-vf",
                    f"{sel},setpts=PTS-STARTPTS,scale=1280:720,fps={FPS},setsar=1", "-an", "-c:v", "libx264",
                    "-pix_fmt", "yuv420p", "-crf", "18", dest], check=True)


def join(a, b, dest):
    lst = dest + ".txt"; open(lst, "w").write(f"file '{a}'\nfile '{b}'\n")
    subprocess.run(["ffmpeg", "-y", "-v", "error", "-f", "concat", "-safe", "0", "-i", lst, "-c", "copy", dest],
                   check=True)


T = os.path.join(V, "tmp"); os.makedirs(T, exist_ok=True)
plans = {  # name: (seg1, seg1 end frame or None, seg2, seg1 target png, seg2 target png)
    "Ygroup1": (os.path.join(OUT, "Y_g1a.mp4"), None, os.path.join(OUT, "Y_g1b.mp4"), "sb/S2.png", "sb/S3.png"),
    "V1": (os.path.join(V, "V1a.mp4"), None, os.path.join(V, "V1b.mp4"), "v/S2p.png", "v/S3p.png"),
    "V2": (os.path.join(OUT, "Y_g1a.mp4"), ends["V2"], os.path.join(V, "V2b.mp4"), "v/L1_v2.png", "sb/S3.png"),
    "V3": (os.path.join(V, "V1a.mp4"), ends["V3"], os.path.join(V, "V3b.mp4"), "v/L1_v3.png", "v/S3pp.png"),
    "Bv": (os.path.join(OUT, "B1.mp4"), None, os.path.join(OUT, "B2.mp4"), "frames/F2.png", "frames/F3.png"),
    "V4": (os.path.join(OUT, "B1.mp4"), ends["V4"], os.path.join(V, "V4b.mp4"), "v/L1_v4.png", "v/F3p.png"),
}
ORIG = {"Bv": "frames/F3.png", "V4": "frames/F3.png"}
ORIG2 = {"Bv": "frames/F2.png", "V4": "frames/F2.png"}


def snap(fr):  # max frame change in the last 3 steps vs the clip's median
    m = motion(fr); med = float(np.median(m))
    tail = max(m[-3:])
    return {"last3_max": round(tail, 2), "median": round(med, 2), "ratio": round(tail / max(med, 0.05), 1),
            "snap": bool(tail > max(6.0, 4 * med))}


def still(rel):
    return np.asarray(Image.open(os.path.join(OUT, rel)).convert("RGB").resize((320, 180)))


res = {}
for name, (s1, e1, s2, t1, t2) in plans.items():
    a, b = os.path.join(T, f"{name}_a.mp4"), os.path.join(T, f"{name}_b.mp4")
    cut(s1, a, 0, e1); cut(s2, b, 1)  # seg2's first frame is the shared frame: drop it
    out = os.path.join(OUT, f"{name}.mp4"); join(a, b, out)
    fa, fb = frames_of(a), frames_of(os.path.join(T, f"{name}_b.mp4"))
    raw2 = frames_of(s2)
    fo = frames_of(out); mo = motion(fo); k = len(fa) - 1
    res[name] = {
        "length_s": round(info(out)["dur"], 2),
        "segment1_end": snap(fa), "segment2_end": snap(raw2),
        "join": {"frame_change_around": [round(x, 2) for x in mo[max(0, k - 3):k + 4]],
                 "median": round(float(np.median(mo)), 2),
                 "seam_ssim": round(ssim(fa[-1], raw2[0]), 3)},
        "hits": {"segment1_end_vs_target": round(ssim(fa[-1], still(t1)), 3),
                 "segment2_end_vs_target": round(ssim(raw2[-1], still(t2)), 3),
                 "segment2_end_vs_original_S3": round(ssim(raw2[-1], still(ORIG.get(name, "sb/S3.png"))), 3),
                 "segment1_end_vs_original_S2": round(ssim(fa[-1], still(ORIG2.get(name, "sb/S2.png"))), 3)},
    }
    # strips: the last 0.5 s before the join and before the end, 6 frames each
    full = frames_of(out, 320, 180); n = len(full); jn = k
    pick = [max(0, jn - 15 + 3 * i) for i in range(6)] + [jn + 1] + [n - 16 + 3 * i for i in range(5)] + [n - 1]
    im = Image.new("RGB", (7 * 320, 2 * 196), "white"); d = ImageDraw.Draw(im)
    for i, f in enumerate(pick):
        x, y = (i % 7) * 320, (i // 7) * 196
        im.paste(Image.fromarray(full[f]), (x, y))
        lab = f"{f / FPS:.2f}s" + (" (after join)" if f == jn + 1 else "") + (" END" if f == n - 1 else "")
        d.text((x + 4, y + 182), lab, fill="black")
    im.save(os.path.join(OUT, f"{name}-strips.jpg"), quality=82)
json.dump(res, open(os.path.join(OUT, "results_v.json"), "w"), indent=1)
print(json.dumps(res, indent=1))
