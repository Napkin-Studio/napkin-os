"""Snap-free group 1: V1 redrawn as one move, V2 chain from the real last frame, V3 owner's idea."""
import os, subprocess, sys
import numpy as np
from PIL import Image
sys.path.insert(0, os.path.dirname(__file__))
from lib import run_task, data_uri, fetch, spent, OUT  # noqa: E402
from analyse_lib import frames_of, motion  # noqa: E402

SB, V = os.path.join(OUT, "sb"), os.path.join(OUT, "v")
os.makedirs(V, exist_ok=True)
LOOK = ("Warm natural light, a rough stone kitchen counter, the amber ribbed COPPERELL spray bottle with its copper "
        "trigger, a lit candle. Hands only, no faces. Photoreal, gentle camera.")
S2W = "The camera pushes in as a hand comes in and lifts the empty amber bottle."
S3W = "Close on the empty amber bottle held in the hand, the COPPERELL label facing us."
LAND = "One continuous shot, no cuts. The last moment is exactly the given last frame; keep moving into it."


def natural_last(mp4, dest_png):
    """The clip's last frame before any end snap: drop final frames whose change spikes vs the median."""
    fr = frames_of(mp4, 320, 180); m = motion(fr); med = float(np.median(m)) or 0.1
    end = len(fr) - 1
    while end > len(fr) - 6 and m[end - 1] > max(6.0, 4 * med):
        end -= 1
    subprocess.run(["ffmpeg", "-y", "-v", "error", "-i", mp4, "-vf", f"select=eq(n\\,{end})", "-vframes", "1",
                    dest_png], check=True)
    return end, len(fr)


def draw(name, ref_png, words):
    p = os.path.join(V, f"{name}.png")
    if not os.path.exists(p):
        u = run_task(f"draw {name}", "/v1/text_to_image", {
            "model": "gemini_image3.1_flash", "ratio": "1344:768", "promptText": words,
            "referenceImages": [{"uri": data_uri(ref_png)}]}, 0.07)
        fetch(u, p)
    return p


def seg(name, first_png, last_png, words):
    p = os.path.join(V, f"{name}.mp4")
    if not os.path.exists(p):
        u = run_task(f"segment {name} 4s", "/v1/image_to_video", {
            "model": "wan3", "promptImage": [{"uri": data_uri(first_png), "position": "first"},
                                             {"uri": data_uri(last_png), "position": "last"}],
            "promptText": f"{LOOK} {words} {LAND}", "ratio": "auto_720p", "duration": 4, "audio": False}, 0.40)
        fetch(u, p)
    return p


S1, S3 = os.path.join(SB, "S1.png"), os.path.join(SB, "S3.png")
# V1: redraw S2 from S1 and S3 from the new S2, then chain
s2p = draw("S2p", S1, "The exact same photograph, same camera position and framing, a moment later: a hand has come "
           "in from the right and lifted the empty amber ribbed COPPERELL bottle a few centimetres off the stone "
           "counter, holding it by its shoulder. Same light, same candle, same background. No face.")
s3p = draw("S3p", s2p, "The same scene a moment later and closer: the camera has pushed in so the empty amber ribbed "
           "bottle held in the same hand fills the middle of the frame, the COPPERELL label facing the camera, the "
           "same warm light and blurred counter and candle behind. No face.")
v1a = seg("V1a", S1, s2p, S2W)
v1b = seg("V1b", s2p, s3p, S3W)
# V2: original segment 1 (Y_g1a: S1 -> drawn S2), then from its natural last frame to S3
l1_v2 = os.path.join(V, "L1_v2.png"); e, n = natural_last(os.path.join(OUT, "Y_g1a.mp4"), l1_v2)
print(f"V2 L1 = frame {e} of {n}", flush=True)
v2b = seg("V2b", l1_v2, S3, S3W)
# V3: segment 1 as V1 (S1 -> S2p, reused), L1 = its natural last frame, S3'' drawn from L1, then L1 -> S3''
l1_v3 = os.path.join(V, "L1_v3.png"); e3, n3 = natural_last(v1a, l1_v3)
print(f"V3 L1 = frame {e3} of {n3}", flush=True)
s3pp = draw("S3pp", l1_v3, "The same scene a moment later and closer: the camera has pushed in so the empty amber "
            "ribbed bottle held in the same hand fills the middle of the frame, the COPPERELL label facing the "
            "camera, the same warm light and blurred counter and candle behind. No face.")
v3b = seg("V3b", l1_v3, s3pp, S3W)
open(os.path.join(V, "ends.txt"), "w").write(f"V2 {e} {n}\nV3 {e3} {n3}\n")
print(f"spent ${spent():.2f}")
