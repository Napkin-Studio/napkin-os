import json, subprocess
import numpy as np
from PIL import Image, ImageDraw

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


def motion(fr):  # mean absolute frame-to-frame change
    return [float(np.abs(fr[i + 1].astype(int) - fr[i].astype(int)).mean()) for i in range(len(fr) - 1)]


def sheet(fr, fps, dest, every=0.5, cols=6):
    idx = list(range(0, len(fr), max(1, int(round(fps * every)))))
    rows = (len(idx) + cols - 1) // cols
    im = Image.new("RGB", (cols * 320, rows * 196), "white"); d = ImageDraw.Draw(im)
    for k, i in enumerate(idx):
        x, y = (k % cols) * 320, (k // cols) * 196
        im.paste(Image.fromarray(fr[i]), (x, y)); d.text((x + 4, y + 182), f"{i / fps:.1f}s", fill="black")
    im.save(dest, quality=82)


