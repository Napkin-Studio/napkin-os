"""V4: B's frames with every learning: segment 1 = F1 -> F2 (B1, reused), L1 = its real last frame, F3' drawn
from L1 toward F3's intent, segment 2 = L1 -> F3' (5 s)."""
import os, sys
sys.path.insert(0, os.path.dirname(__file__))
from lib import run_task, data_uri, fetch, spent, OUT  # noqa: E402
import subprocess  # noqa: E402
import numpy as np  # noqa: E402
from analyse_lib import frames_of, motion  # noqa: E402


def natural_last(mp4, dest_png):
    """The clip's last frame before any end snap: drop final frames whose change spikes vs the median."""
    fr = frames_of(mp4, 320, 180); m = motion(fr); med = float(np.median(m)) or 0.1
    end = len(fr) - 1
    while end > len(fr) - 6 and m[end - 1] > max(6.0, 4 * med):
        end -= 1
    subprocess.run(["ffmpeg", "-y", "-v", "error", "-i", mp4, "-vf", f"select=eq(n\\,{end})", "-vframes", "1",
                    dest_png], check=True)
    return end, len(fr)

V = os.path.join(OUT, "v")
LOOK = ("Warm natural light, a rough stone counter, the amber ribbed COPPERELL spray bottle with its copper "
        "trigger, a lit candle beside it. Hands only, no faces. Photoreal, gentle camera.")
LAND = "One continuous shot, no cuts. The last moment is exactly the given last frame; keep moving into it."
l1 = os.path.join(V, "L1_v4.png")
e, n = natural_last(os.path.join(OUT, "B1.mp4"), l1)
open(os.path.join(V, "ends.txt"), "a").write(f"V4 {e} {n}\n")
print(f"V4 L1 = frame {e} of {n}", flush=True)
f3p = os.path.join(V, "F3p.png")
if not os.path.exists(f3p):
    u = run_task("draw F3p", "/v1/text_to_image", {
        "model": "gemini_image3.1_flash", "ratio": "1344:768",
        "promptText": ("The exact same photograph, same camera position and framing, a moment later: the same hand "
                       "presses the copper trigger and the amber ribbed COPPERELL bottle sprays a fine golden mist "
                       "that drifts to the left through the warm light. Same candle, same counter, same background. "
                       "No face."),
        "referenceImages": [{"uri": data_uri(l1)}]}, 0.07)
    fetch(u, f3p)
seg = os.path.join(V, "V4b.mp4")
if not os.path.exists(seg):
    u = run_task("segment V4b 5s", "/v1/image_to_video", {
        "model": "wan3", "promptImage": [{"uri": data_uri(l1), "position": "first"},
                                         {"uri": data_uri(f3p), "position": "last"}],
        "promptText": (f"{LOOK} The hand presses the copper trigger and the bottle sprays a fine golden mist that "
                       f"drifts through the warm light. {LAND}"), "ratio": "auto_720p", "duration": 5, "audio": False},
        0.50)
    fetch(u, seg)
print(f"spent ${spent():.2f}")
