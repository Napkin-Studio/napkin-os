"""Shared helpers for the continuous-take tests. Key read from ~/.config/napkin/runway.key (never printed);
every paid call logged to <OUT>/paid.log; a call that would pass STOP_USD is refused."""
import base64, io, json, os, sys, time, urllib.request, urllib.error
from PIL import Image

OUT = sys.argv[1]
BASE, VER = "https://api.dev.runwayml.com", "2024-11-06"
KEY = open(os.path.expanduser("~/.config/napkin/runway.key")).read().strip()
LOG = os.path.join(OUT, "paid.log")
STOP_USD = float(os.environ.get("CONT_STOP_USD", "9.0"))


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
    return "data:image/jpeg;base64," + base64.b64encode(b.getvalue()).decode()


def fetch(url, dest):
    with urllib.request.urlopen(url, timeout=300) as r, open(dest, "wb") as f:
        f.write(r.read())
