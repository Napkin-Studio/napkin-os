"""Continuous-take A/B/C test. Key read from ~/.config/napkin/runway.key (never printed). Every paid call is
logged to cont-test/paid.log with its estimated cost; the run stops before a call that would pass $5."""
import base64, io, json, os, sys, time, urllib.request, urllib.error
from PIL import Image

OUT = sys.argv[1]  # cont-test folder
CAND = os.path.join(OUT, "cand")
BASE, VER = "https://api.dev.runwayml.com", "2024-11-06"
KEY = open(os.path.expanduser("~/.config/napkin/runway.key")).read().strip()
LOG = os.path.join(OUT, "paid.log")
STOP_USD = 5.0


def spent():
    if not os.path.exists(LOG):
        return 0.0
    return sum(float(l.split("\t")[2]) for l in open(LOG) if l.strip())


def call(method, path, body=None):
    req = urllib.request.Request(BASE + path, method=method, data=json.dumps(body).encode() if body else None,
                                 headers={"Authorization": f"Bearer {KEY}", "X-Runway-Version": VER,
                                          "Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=120) as r:
            return json.loads(r.read() or b"{}")
    except urllib.error.HTTPError as e:
        raise SystemExit(f"HTTP {e.code} on {path}: {e.read()[:400]!r}")


def run_task(name, path, body, usd):
    if spent() + usd > STOP_USD:
        raise SystemExit(f"STOP: {name} would pass ${STOP_USD} (spent {spent():.2f})")
    t = call("POST", path, body)
    tid = t["id"]
    with open(LOG, "a") as f:
        f.write(f"{time.strftime('%Y-%m-%dT%H:%M:%S')}\t{name}\t{usd:.2f}\t{body.get('model')}\t{tid}\n")
    t0 = time.time()
    while True:
        time.sleep(6)
        s = call("GET", f"/v1/tasks/{tid}")
        if s.get("status") == "SUCCEEDED":
            print(f"{name} done in {time.time() - t0:.0f}s", flush=True)
            return s["output"][0]
        if s.get("status") in ("FAILED", "CANCELLED"):
            raise SystemExit(f"{name} failed: {s.get('failure')} {s.get('failureCode')}")


def data_uri(path, w=1280, h=720):
    im = Image.open(path).convert("RGB").resize((w, h), Image.LANCZOS)
    b = io.BytesIO(); im.save(b, "JPEG", quality=90)
    im.save(path.rsplit(".", 1)[0] + "_1280.jpg", quality=90)
    return "data:image/jpeg;base64," + base64.b64encode(b.getvalue()).decode()


def fetch(url, dest):
    with urllib.request.urlopen(url, timeout=300) as r, open(dest, "wb") as f:
        f.write(r.read())


os.makedirs(os.path.join(OUT, "frames"), exist_ok=True)
for k, src in {"F1": "11", "F2": "3", "F3": "7"}.items():
    Image.open(os.path.join(CAND, f"{src}.png")).convert("RGB").save(os.path.join(OUT, "frames", f"{k}.png"))
F = {k: data_uri(os.path.join(OUT, "frames", f"{k}.png")) for k in ("F1", "F2", "F3")}
LOOK = ("Warm natural light, a rough stone counter, the amber ribbed COPPERELL spray bottle with its copper "
        "trigger, a lit candle beside it. Hands only, no faces. Photoreal, gentle camera.")
SHOTS = ["Wide: the bottle stands still on the stone counter beside the lit candle.",
         "A hand reaches in from the right and takes the bottle's copper trigger.",
         "The bottle sprays a fine golden mist that drifts through the warm light."]
which = sys.argv[2] if len(sys.argv) > 2 else "ABC"

# FX: the same bottle on a shop shelf (for C), one cheap image
fx = os.path.join(OUT, "frames", "FX.png")
if "C" in which and not os.path.exists(fx):
    u = run_task("FX image (shop shelf)", "/v1/text_to_image", {
        "model": "gemini_image3.1_flash", "ratio": "1344:768",
        "promptText": ("The exact amber ribbed spray bottle with the copper trigger from the reference image, now "
                       "standing on a shop shelf among other cleaning products, eye level, soft store light, same "
                       "framing as a wide product shot, no people."),
        "referenceImages": [{"uri": F["F1"]}]}, 0.07)
    fetch(u, fx)

if "A" in which:  # today's Make together: one take pinned on shot 1's frame, timed cuts
    prompt = (LOOK + " " + " ".join([f"Shot 1 [0-3 s] {SHOTS[0]}", f"Shot 2 [3-6 s] {SHOTS[1]}",
                                    f"Shot 3 [6-10 s] {SHOTS[2]}"]))
    u = run_task("A one take 10s", "/v1/image_to_video", {
        "model": "wan3", "promptImage": [{"uri": F["F1"], "position": "first"}], "promptText": prompt,
        "ratio": "auto_720p", "duration": 10, "audio": False}, 1.00)
    fetch(u, os.path.join(OUT, "A.mp4"))

LAND = "One continuous shot, no cuts. The last moment is exactly the given last frame; keep moving into it."
if "B" in which:
    for n, (a, b, line) in enumerate([("F1", "F2", SHOTS[1]), ("F2", "F3", SHOTS[2])], 1):
        u = run_task(f"B segment {n} 5s", "/v1/image_to_video", {
            "model": "wan3", "promptImage": [{"uri": F[a], "position": "first"}, {"uri": F[b], "position": "last"}],
            "promptText": f"{LOOK} {line} {LAND}", "ratio": "auto_720p", "duration": 5, "audio": False}, 0.50)
        fetch(u, os.path.join(OUT, f"B{n}.mp4"))

if "C" in which:
    FXu = data_uri(fx)
    u = run_task("C scene change 5s", "/v1/image_to_video", {
        "model": "wan3", "promptImage": [{"uri": F["F1"], "position": "first"}, {"uri": FXu, "position": "last"}],
        "promptText": (f"{LOOK} The bottle on the kitchen counter, then it is on a shop shelf among other cleaning "
                       f"products. {LAND}"), "ratio": "auto_720p", "duration": 5, "audio": False}, 0.50)
    fetch(u, os.path.join(OUT, "C.mp4"))

print(f"spent ${spent():.2f}")
