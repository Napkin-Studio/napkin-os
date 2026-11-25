"""Main comparison: X (cut at every storyboard frame) vs Y (continuous groups, cuts only between groups)."""
import os, subprocess, sys
sys.path.insert(0, os.path.dirname(__file__))
from lib import call, run_task, data_uri, fetch, spent, OUT  # noqa: E402

FR = os.path.join(OUT, "frames")
SB = os.path.join(OUT, "sb")
os.makedirs(SB, exist_ok=True)
LOOK = ("Warm natural light, a rough stone kitchen counter, the amber ribbed COPPERELL spray bottle with its copper "
        "trigger, a lit candle. Hands only, no faces. Photoreal, gentle camera.")
SHOT = {
    "S1": "Wide: the empty amber bottle stands on the stone counter beside the lit candle.",
    "S2": "The camera pushes in as a hand comes in and lifts the empty amber bottle.",
    "S3": "Close on the empty amber bottle held in the hand, the COPPERELL label facing us.",
    "S4": "Close: a hand drops a small white refill tablet into the bottle, now full of water.",
    "S5": "The tablet fizzes inside; the refilled amber bottle stands on the counter, full and gleaming.",
}
from PIL import Image  # noqa: E402

# storyboard frames: reuse Copperell frames where they fit, draw the rest (one image call each)
if not os.path.exists(os.path.join(SB, "S1.png")):
    Image.open(os.path.join(OUT, "cand", "11.png")).convert("RGB").save(os.path.join(SB, "S1.png"))
    Image.open(os.path.join(OUT, "cand", "9.png")).convert("RGB").save(os.path.join(SB, "S2.png"))
ref = data_uri(os.path.join(SB, "S1.png"))
DRAW = {
    "S3": "Close-up at counter height: a hand holds the exact empty amber ribbed COPPERELL spray bottle from the "
          "reference, label facing the camera, the same stone counter and warm light behind, shallow depth of field, "
          "no face.",
    "S4": "Close-up: a hand drops a small white tablet into the exact amber ribbed COPPERELL bottle from the "
          "reference, which is full of clear water and stands on the same stone counter, warm light, no face.",
    "S5": "The exact amber ribbed COPPERELL bottle from the reference, full of liquid with tiny fizzing bubbles "
          "rising inside, standing on the same stone counter beside the lit candle, warm light, no hands.",
}
for k, words in DRAW.items():
    p = os.path.join(SB, f"{k}.png")
    if not os.path.exists(p):
        refs = [{"uri": ref}] + ([{"uri": data_uri(os.path.join(SB, "S4.png"))}] if k == "S5" else [])
        u = run_task(f"storyboard {k} image", "/v1/text_to_image", {
            "model": "gemini_image3.1_flash", "ratio": "1344:768", "promptText": words,
            "referenceImages": refs}, 0.07)
        fetch(u, p)
F = {k: data_uri(os.path.join(SB, f"{k}.png")) for k in SHOT}

which = sys.argv[2] if len(sys.argv) > 2 else "XY"
LAND = "One continuous shot, no cuts. The last moment is exactly the given last frame; keep moving into it."
# X: cut at every frame — each frame its own clip from its own first frame (today's "each shot alone" / a cut
# between every shot), 3+3+2+3+3 = 14 s
DUR_X = {"S1": 3, "S2": 3, "S3": 2, "S4": 3, "S5": 3}
if "X" in which:
    for k, d in DUR_X.items():
        p = os.path.join(OUT, f"X_{k}.mp4")
        if not os.path.exists(p):
            u = run_task(f"X {k} {d}s", "/v1/image_to_video", {
                "model": "wan3", "promptImage": [{"uri": F[k], "position": "first"}],
                "promptText": f"{LOOK} {SHOT[k]}", "ratio": "auto_720p", "duration": d, "audio": False}, d * 0.10)
            fetch(u, p)
# Y: Group 1 continuous chain S1->S2 (4 s), S2->S3 (4 s); Group 2 continuous S4->S5 (6 s); 14 s
SEG_Y = [("Y_g1a", "S1", "S2", SHOT["S2"], 4), ("Y_g1b", "S2", "S3", SHOT["S3"], 4),
         ("Y_g2", "S4", "S5", f"{SHOT['S4']} {SHOT['S5']}", 6)]
if "Y" in which:
    for name, a, b, line, d in SEG_Y:
        p = os.path.join(OUT, f"{name}.mp4")
        if not os.path.exists(p):
            u = run_task(f"Y {name} {a}->{b} {d}s", "/v1/image_to_video", {
                "model": "wan3", "promptImage": [{"uri": F[a], "position": "first"}, {"uri": F[b], "position": "last"}],
                "promptText": f"{LOOK} {line} {LAND}", "ratio": "auto_720p", "duration": d, "audio": False}, d * 0.10)
            fetch(u, p)
print(f"spent ${spent():.2f}")
