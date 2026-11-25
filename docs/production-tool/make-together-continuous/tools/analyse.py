"""Join B on its shared frame, measure seams and storyboard hits, make contact sheets. Writes results.json."""
import json, os, subprocess, sys
import numpy as np
from PIL import Image, ImageDraw

OUT = sys.argv[1]
FR = os.path.join(OUT, "frames")


def sh(*a):
    return subprocess.run(a, check=True, capture_output=True, text=True).stdout


def info(p):
    j = json.loads(sh("ffprobe", "-v", "error", "-select_streams", "v:0", "-count_frames", "-show_entries",
                      "stream=nb_read_frames,r_frame_rate,width,height:format=duration", "-of", "json", p))
    s = j["streams"][0]; num, den = s["r_frame_rate"].split("/")
    return {"frames": int(s["nb_read_frames"]), "fps": float(num) / float(den), "w": s["width"], "h": s["height"],
            "dur": float(j["format"]["duration"])}


def frames_of(p, w=320, h=180):
    raw = subprocess.run(["ffmpeg", "-v", "error", "-i", p, "-vf", f"scale={w}:{h}", "-f", "rawvideo", "-pix_fmt",
                          "rgb24", "-"], check=True, capture_output=True).stdout
    return np.frombuffer(raw, np.uint8).reshape(-1, h, w, 3)


def gray(a):
    return (a[..., 0] * .299 + a[..., 1] * .587 + a[..., 2] * .114).astype(np.float64)


def ssim(a, b):  # global SSIM on grayscale (as a seam score; 1.0 = identical)
    x, y = gray(a), gray(b); c1, c2 = (0.01 * 255) ** 2, (0.03 * 255) ** 2
    mx, my = x.mean(), y.mean(); vx, vy = x.var(), y.var(); cov = ((x - mx) * (y - my)).mean()
    return float(((2 * mx * my + c1) * (2 * cov + c2)) / ((mx ** 2 + my ** 2 + c1) * (vx + vy + c2)))


def still(name, w=320, h=180):
    return np.asarray(Image.open(os.path.join(FR, name)).convert("RGB").resize((w, h)))


def motion(fr):  # mean absolute frame-to-frame change
    return [float(np.abs(fr[i + 1].astype(int) - fr[i].astype(int)).mean()) for i in range(len(fr) - 1)]


def best_hit(fr, ref, fps, around_s, win_s=1.0):
    lo, hi = max(0, int((around_s - win_s) * fps)), min(len(fr) - 1, int((around_s + win_s) * fps))
    scores = [(ssim(fr[i], ref), i) for i in range(lo, hi + 1)]
    s, i = max(scores)
    return {"ssim": round(s, 3), "at_s": round(i / fps, 2), "intended_s": around_s}


def sheet(fr, fps, dest, every=0.5, cols=6):
    idx = list(range(0, len(fr), max(1, int(round(fps * every)))))
    rows = (len(idx) + cols - 1) // cols
    im = Image.new("RGB", (cols * 320, rows * 196), "white"); d = ImageDraw.Draw(im)
    for k, i in enumerate(idx):
        x, y = (k % cols) * 320, (k // cols) * 196
        im.paste(Image.fromarray(fr[i]), (x, y)); d.text((x + 4, y + 182), f"{i / fps:.1f}s", fill="black")
    im.save(dest, quality=82)


res = {}
# B: join on the shared frame (drop B2's first frame, which is the same storyboard frame as B1's last)
b1, b2 = os.path.join(OUT, "B1.mp4"), os.path.join(OUT, "B2.mp4")
if os.path.exists(b1) and os.path.exists(b2):
    i1 = info(b1)
    sh("ffmpeg", "-y", "-v", "error", "-i", b1, "-i", b2, "-filter_complex",
       "[1:v]trim=start_frame=1,setpts=PTS-STARTPTS[v2];[0:v][v2]concat=n=2:v=1:a=0[v]", "-map", "[v]",
       "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "18", os.path.join(OUT, "B.mp4"))
    f1, f2 = frames_of(b1), frames_of(b2)
    res["B_seam"] = {"ssim_last_B1_vs_first_B2": round(ssim(f1[-1], f2[0]), 3),
                     "ssim_last_B1_vs_F2": round(ssim(f1[-1], still("F2.png")), 3),
                     "ssim_first_B2_vs_F2": round(ssim(f2[0], still("F2.png")), 3)}
    fb = frames_of(os.path.join(OUT, "B.mp4")); m = motion(fb); k = len(f1) - 1
    res["B_seam"]["motion_at_seam"] = round(m[k], 2) if k < len(m) else None
    res["B_seam"]["motion_median"] = round(float(np.median(m)), 2)
    res["B_seam"]["motion_around_seam"] = [round(x, 2) for x in m[max(0, k - 4):k + 5]]
for name, marks in {"A": [(0, "F1.png"), (4.5, "F2.png"), (9.5, "F3.png")],
                    "B": [(0, "F1.png"), (5.0, "F2.png"), (9.9, "F3.png")],
                    "C": [(0, "F1.png"), (4.9, "FX.png")]}.items():
    p = os.path.join(OUT, f"{name}.mp4")
    if not os.path.exists(p):
        continue
    inf = info(p); fr = frames_of(p)
    marks = [(min(t, inf["dur"] - 0.05), r) for t, r in marks]
    res[name] = {"info": inf, "hits": {r.split(".")[0]: best_hit(fr, still(r), inf["fps"], t) for t, r in marks}}
    m = motion(fr); med = float(np.median(m))
    res[name]["motion_median"] = round(med, 2)
    res[name]["hard_cuts"] = [round((i + 1) / inf["fps"], 2) for i, x in enumerate(m) if x > max(25, 6 * med)]
    sheet(fr, inf["fps"], os.path.join(OUT, f"{name}-sheet.jpg"))
json.dump(res, open(os.path.join(OUT, "results.json"), "w"), indent=1)
print(json.dumps(res, indent=1))
