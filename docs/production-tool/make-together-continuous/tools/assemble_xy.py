"""Assemble X and Y with the same end card, measure them, write results_xy.json and contact sheets."""
import json, os, subprocess, sys
import numpy as np
from PIL import Image, ImageDraw

sys.path.insert(0, os.path.dirname(__file__))
from analyse_lib import info, frames_of, ssim, motion, sheet  # noqa: E402

OUT = sys.argv[1]
SB = os.path.join(OUT, "sb")
W, H, FPS = 1280, 720, 24


def run(*a):
    subprocess.run(a, check=True, capture_output=True)


def norm(src, dest, drop_first=False):
    vf = f"scale={W}:{H}:force_original_aspect_ratio=decrease,pad={W}:{H}:(ow-iw)/2:(oh-ih)/2,fps={FPS},setsar=1"
    if drop_first:
        vf = "trim=start_frame=1,setpts=PTS-STARTPTS," + vf
    run("ffmpeg", "-y", "-v", "error", "-i", src, "-vf", vf, "-an", "-c:v", "libx264", "-pix_fmt", "yuv420p",
        "-crf", "18", dest)


# end card: dark ground, the line, the wordmark (2 s)
card_png = os.path.join(OUT, "endcard.png")
im = Image.new("RGB", (W, H), (20, 22, 27)); d = ImageDraw.Draw(im)
try:
    from PIL import ImageFont
    big = ImageFont.truetype("DejaVuSans-Bold.ttf", 64); small = ImageFont.truetype("DejaVuSans.ttf", 30)
except Exception:
    big = small = None
d.text((W // 2, H // 2 - 30), "Refill. Not landfill.", fill=(245, 236, 220), font=big, anchor="mm")
d.text((W // 2, H // 2 + 50), "COPPERELL", fill=(200, 140, 70), font=small, anchor="mm")
im.save(card_png)
card = os.path.join(OUT, "endcard.mp4")
run("ffmpeg", "-y", "-v", "error", "-loop", "1", "-i", card_png, "-t", "2", "-vf", f"fps={FPS},format=yuv420p",
    "-c:v", "libx264", "-crf", "18", card)

tmp = os.path.join(OUT, "tmp"); os.makedirs(tmp, exist_ok=True)


def concat(parts, dest):
    lst = os.path.join(tmp, os.path.basename(dest) + ".txt")
    with open(lst, "w") as f:
        f.writelines(f"file '{p}'\n" for p in parts)
    run("ffmpeg", "-y", "-v", "error", "-f", "concat", "-safe", "0", "-i", lst, "-c", "copy", dest)


res = {}
# X: each frame its own clip, cut at every frame
xs = []
for k in ["S1", "S2", "S3", "S4", "S5"]:
    n = os.path.join(tmp, f"X_{k}.mp4"); norm(os.path.join(OUT, f"X_{k}.mp4"), n); xs.append(n)
concat(xs + [card], os.path.join(OUT, "X.mp4"))
# Y: group 1 chain joined on S2 (drop the second segment's first frame), cut, group 2, cut, end card
y1a, y1b, y2 = (os.path.join(tmp, n) for n in ("Y_g1a.mp4", "Y_g1b.mp4", "Y_g2.mp4"))
norm(os.path.join(OUT, "Y_g1a.mp4"), y1a); norm(os.path.join(OUT, "Y_g1b.mp4"), y1b, drop_first=True)
norm(os.path.join(OUT, "Y_g2.mp4"), y2)
concat([y1a, y1b, y2, card], os.path.join(OUT, "Y.mp4"))


def still(k):
    return np.asarray(Image.open(os.path.join(SB, f"{k}.png")).convert("RGB").resize((320, 180)))


def hit(fr, k, at_s, fps=FPS, win=0.6):
    lo, hi = max(0, int((at_s - win) * fps)), min(len(fr) - 1, int((at_s + win) * fps))
    s, i = max((ssim(fr[j], still(k)), j) for j in range(lo, hi + 1))
    return {"ssim": round(s, 3), "at_s": round(i / fps, 2), "intended_s": at_s}


for name, starts in {"X": None, "Y": None}.items():
    p = os.path.join(OUT, f"{name}.mp4"); fr = frames_of(p); inf = info(p)
    m = motion(fr); med = float(np.median(m))
    cuts = [round((i + 1) / FPS, 2) for i, x in enumerate(m) if x > max(20, 5 * med)]
    res[name] = {"info": inf, "motion_median": round(med, 2), "hard_cuts_at_s": cuts}
    sheet(fr, FPS, os.path.join(OUT, f"{name}-sheet.jpg"))
# storyboard hits at their intended moments
fx = frames_of(os.path.join(OUT, "X.mp4")); fy = frames_of(os.path.join(OUT, "Y.mp4"))
xlen = [info(p)["dur"] for p in xs]
xstart = np.cumsum([0] + xlen[:-1])
res["X"]["hits"] = {k: hit(fx, k, round(float(t), 2)) for k, t in zip(["S1", "S2", "S3", "S4", "S5"], xstart)}
la, lb, l2 = info(y1a)["dur"], info(y1b)["dur"], info(y2)["dur"]
res["Y"]["hits"] = {"S1": hit(fy, "S1", 0.0), "S2": hit(fy, "S2", round(la, 2)),
                    "S3": hit(fy, "S3", round(la + lb - 0.05, 2)), "S4": hit(fy, "S4", round(la + lb, 2)),
                    "S5": hit(fy, "S5", round(la + lb + l2 - 0.05, 2))}
# Y's join inside group 1: seam similarity and speed bump
ga, gb = frames_of(os.path.join(OUT, "Y_g1a.mp4")), frames_of(os.path.join(OUT, "Y_g1b.mp4"))
k = int(round(la * FPS)) - 1
my = motion(fy)
res["Y"]["join_S2"] = {"ssim_last_g1a_vs_first_g1b": round(ssim(ga[-1], gb[0]), 3),
                       "ssim_last_g1a_vs_S2": round(ssim(ga[-1], still("S2")), 3),
                       "ssim_first_g1b_vs_S2": round(ssim(gb[0], still("S2")), 3),
                       "motion_around_join": [round(x, 2) for x in my[max(0, k - 4):k + 5]],
                       "motion_median": res["Y"]["motion_median"]}
json.dump(res, open(os.path.join(OUT, "results_xy.json"), "w"), indent=1)
print(json.dumps(res, indent=1))
