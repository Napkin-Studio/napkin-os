"""A replay build through a running deck server in web render mode (the deck-image CI job, deck-cloud).

    python -m deck.web_smoke [http://127.0.0.1:8793]

Run inside the image, which holds the Fernley recording: the server was started with NAPKIN_DECK_REPLAY on its stages and
NAPKIN_DECK_RENDER=web. It walks the three gates and checks that deck.pptx and deck.html were written, deck.pdf was not,
and that no soffice or pdftoppm is on this machine. Exits 1 with the reason otherwise.
"""
from __future__ import annotations

import json
import shutil
import sys
import time
import urllib.request
from pathlib import Path

FERN = Path(__file__).parent / "tests" / "fixtures" / "fernley"


def call(base: str, path: str, body: dict | None = None) -> dict:
    req = urllib.request.Request(base + path, data=None if body is None else json.dumps(body).encode(), headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.loads(r.read())


def main() -> int:
    base = (sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:8793").rstrip("/")
    for tool in ("soffice", "pdftoppm"):
        if shutil.which(tool):
            print(f"{tool} is present: the web render mode is meant for an image without it")
            return 1
    inputs = {"prompt": {"text": (FERN / "prompt.txt").read_text().strip(), "client": "Fernley Drinks Ltd (FICTIONAL)", "project": "Fernley Tea 2027", "agency": ""},
              "kind": "agency", "format": "pitch"}
    ok = {"decision": "approve"}
    steps = [{}, {"storyline": ok}, {"storyline": ok, "territories": ok}, {"storyline": ok, "territories": ok, "idea": ok}]
    view = {}
    for approvals in steps:
        call(base, "/run", {"doc": "smoke", "inputs": inputs, "approvals": approvals, "mode": "replay"})
        end = time.time() + 120
        while time.time() < end:
            view = call(base, "/run/smoke")
            if view["state"] in ("gate", "done", "failed"):
                break
            time.sleep(0.2)
        if view.get("state") == "failed":
            print("the run failed:", json.dumps(view)[:600])
            return 1
    if view.get("state") != "done":
        print("the run did not finish:", view.get("state"))
        return 1
    exports = set((view.get("payload") or {}).get("exports") or {})
    qa = ((view.get("payload") or {}).get("report") or {}).get("qa") or ""
    for name in ("deck.pptx", "deck.html"):
        with urllib.request.urlopen(f"{base}/file/smoke/{name}", timeout=30) as r:
            if r.status != 200 or not r.read(16):
                print(name, "is empty")
                return 1
    if exports != {"web", "pptx"}:
        print("exports should be web and pptx only, got", sorted(exports))
        return 1
    if "not visually checked" not in qa:
        print("the report does not say the PowerPoint was not checked:", qa)
        return 1
    print("ok: deck.pptx and deck.html written, no deck.pdf, no soffice;", qa)
    return 0


if __name__ == "__main__":
    sys.exit(main())
