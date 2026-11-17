"""Draws the invented demo frames for deck-frames-in, and writes the Territory run files that go with them.

    python3 make_frames.py            # rewrites everything in this folder next to this script

Everything here is invented. The pictures are abstract: horizon bands, a drop, ripples, a pipe line and a window of
light, drawn with Pillow from fixed shapes and colours. No text, no letters, no logo, no person, no photograph, so
nothing in them can name a brand or a real place. The client is Lumen Water, the invented water utility the other
fixtures use. The drawing is deterministic (no random numbers), so the files can be regenerated and compared by pixels
(tests do that: Pillow versions may encode the same pixels to different bytes).

Written next to this script:
    lumen_run.json                      a hand-written Territory run, in the tool's own format
    lumen_run.frames-plan.json          its four shots per territory
    lumen_run.frames/v1-<hash>/         manifest.json (fixture: true) and the PNGs
    cover.png                           a supplied picture (rights: own), for --image s01.picture
    small.png                           a supplied picture too small for its box (picture_lowres)
After a change here, make the approval file again: see README at the end of this docstring.

review.json (the demo approver's decisions) names slide ids and asset ids, so it is made from a build, not drawn here:
    python3 -m deck.from_territory lumen_run.json --frames <manifest> --stages S --chosen t1 --brief brief_object.json
    python3 -m deck.run_deck ... --stages S --pictures creative_cover --out O
    python3 -m deck.images approve --review review.json --deck O/deck.json --territory t1 --by human:demo-approver
(the gallery script and tests/test_images.py do the same in memory).
"""
from __future__ import annotations

import hashlib
import json
from pathlib import Path

from PIL import Image, ImageDraw

HERE = Path(__file__).resolve().parent
W, H = 1344, 768
STYLE_HASH = "5d1c3a90"
FOLDER = f"v1-{STYLE_HASH}"

#: per territory: (sky top, sky bottom, water, accent, deep)
PALETTES = {
    "t1": ((196, 226, 238), (236, 244, 246), (38, 122, 150), (250, 196, 92), (20, 62, 86)),
    "t2": ((250, 226, 178), (252, 244, 226), (196, 112, 52), (42, 72, 110), (92, 48, 24)),
    "t3": ((92, 84, 140), (176, 150, 176), (36, 40, 84), (246, 214, 150), (18, 18, 48)),
}

#: (territory, shot, tier) frames made. tier: pro (the best model) or flash (the quick one).
FRAMES = [("t1", "f1", "pro"), ("t1", "f1", "flash"), ("t1", "f2", "pro"), ("t1", "f2", "flash"), ("t1", "f3", "flash"), ("t1", "f4", "flash"),
          ("t2", "f1", "flash"), ("t2", "f2", "pro"), ("t2", "f2", "flash"), ("t2", "f3", "flash"), ("t2", "f4", "flash"),
          ("t3", "f1", "flash"), ("t3", "f2", "flash"), ("t3", "f3", "flash")]
#: t2's pro frame of f2 and its f3 are flagged by the guard (a test reason); t3's f3 was never checked; t3's f4 was refused.
FLAGGED = {("t2", "f2", "pro"), ("t2", "f3", "flash")}
UNCHECKED = {("t3", "f3", "flash")}
REFUSED = [("t3", "f4", "flash")]


def _lerp(a, b, t):
    return tuple(int(a[i] + (b[i] - a[i]) * t) for i in range(3))


def draw_frame(tid: str, shot: str, tier: str, w: int = W, h: int = H) -> Image.Image:
    """One abstract picture. The motif follows the shot; the tier nudges the horizon so a pro and a flash frame differ."""
    sky_t, sky_b, water, accent, deep = PALETTES[tid]
    n = int(shot[1])
    img = Image.new("RGB", (w, h))
    d = ImageDraw.Draw(img)
    horizon = int(h * (0.50 + 0.04 * n + (0.03 if tier == "pro" else 0.0)))
    for y in range(horizon):                                  # sky: a vertical gradient
        d.line([(0, y), (w, y)], fill=_lerp(sky_t, sky_b, y / max(1, horizon - 1)))
    for y in range(horizon, h):                               # water: a gradient to the deep colour
        d.line([(0, y), (w, y)], fill=_lerp(water, deep, (y - horizon) / max(1, h - horizon - 1)))
    for i in range(1, 5):                                     # horizon bands
        y = horizon - int(h * 0.035 * i)
        d.rectangle([0, y, w, y + max(2, h // 90)], fill=_lerp(sky_b, accent, 0.12 * i))
    cx, cy = int(w * (0.30 + 0.13 * n)), int(horizon * 0.72)
    if n == 1:                                                # f1: a drop and its ripples
        r = h // 11
        d.ellipse([cx - r, cy - r, cx + r, cy + r], fill=accent)
        d.polygon([(cx - r + 4, cy - r // 2), (cx + r - 4, cy - r // 2), (cx, cy - 2 * r - 10)], fill=accent)
        for k in range(1, 5):
            rr = int(h * 0.05 * k)
            d.ellipse([cx - rr * 3, horizon + 40 * k - rr // 2, cx + rr * 3, horizon + 40 * k + rr // 2], outline=_lerp(accent, sky_b, 0.35), width=3)
    elif n == 2:                                              # f2: a pipe line across the water
        y = horizon + int(h * 0.16)
        d.rectangle([0, y, w, y + h // 22], fill=_lerp(sky_b, deep, 0.25))
        d.rectangle([0, y, w, y + h // 70], fill=accent)
        for k in range(0, w, w // 6):
            d.rectangle([k, y - h // 60, k + h // 40, y + h // 22 + h // 60], fill=deep)
    elif n == 3:                                              # f3: a window of light on the water
        x0, y0 = int(w * 0.18), int(h * 0.12)
        d.rectangle([x0, y0, x0 + int(w * 0.30), y0 + int(h * 0.42)], fill=_lerp(sky_t, accent, 0.55))
        d.line([(x0 + int(w * 0.15), y0), (x0 + int(w * 0.15), y0 + int(h * 0.42))], fill=deep, width=5)
        d.line([(x0, y0 + int(h * 0.21)), (x0 + int(w * 0.30), y0 + int(h * 0.21))], fill=deep, width=5)
        d.polygon([(x0, y0 + int(h * 0.42)), (x0 + int(w * 0.30), y0 + int(h * 0.42)), (int(w * 0.62), h), (int(w * 0.02), h)], fill=_lerp(water, accent, 0.18))
    else:                                                     # f4: the payoff, a wide sun over a calm surface
        r = int(h * 0.22)
        d.ellipse([w // 2 - r, horizon - r, w // 2 + r, horizon + r], fill=accent)
        d.rectangle([0, horizon, w, h], fill=None)
        for k in range(1, 7):
            y = horizon + int(h * 0.05 * k)
            ww = int(r * (1.7 - 0.22 * k))
            if ww > 8:
                d.rectangle([w // 2 - ww, y, w // 2 + ww, y + max(3, h // 100)], fill=_lerp(accent, water, 0.25 * k / 2))
    return img


def draw_supplied(w: int, h: int, hue: int) -> Image.Image:
    """The supplied pictures: a diagonal wash with two soft shapes."""
    img = Image.new("RGB", (w, h))
    d = ImageDraw.Draw(img)
    a, b = ((30, 70, 96), (186, 214, 220)) if hue == 0 else ((84, 54, 38), (232, 204, 160))
    for y in range(h):
        d.line([(0, y), (w, y)], fill=_lerp(a, b, y / (h - 1)))
    d.ellipse([int(w * 0.55), int(h * 0.15), int(w * 0.85), int(h * 0.15) + int(w * 0.30)], fill=_lerp(b, (255, 255, 255), 0.4))
    d.rectangle([0, int(h * 0.72), w, h], fill=_lerp(a, (0, 0, 0), 0.25))
    return img


def _write_json(path: Path, obj) -> None:
    path.write_text(json.dumps(obj, indent=1, ensure_ascii=False) + "\n")


def run_obj() -> dict:
    ab = {"fields": [
        {"key": "background", "value": "Lumen Water is a regional water utility. Customers rarely think about water until a bill arrives.", "tag": "given"},
        {"key": "audience", "value": "Households of adults aged 25 to 54", "tag": "assumed"}]}
    terr = [
        {"id": "t1", "line": "The Tap Tells", "tier": "safe", "tier_reason": "Close to what the category already says, so it is easy to explain.",
         "proposition": "Let the tap speak for the household.", "tension_text": "People value water but never link it to their own tap.",
         "mechanism": "A tap that tells each household a small story about its own day.", "score": {"total": 27, "of": 35}, "ready": True,
         "proposition_ok": True, "assumption_dependent": False},
        {"id": "t2", "line": "Every Drop Counted", "tier": "stretch", "tier_reason": "Asks the audience to look at a number it has never seen.",
         "proposition": "Make the invisible measure visible.", "tension_text": "Use is easy to ignore because nobody sees it.",
         "mechanism": "A household counter that turns daily use into something you can see.", "score": {"total": 24, "of": 35}, "ready": True,
         "proposition_ok": True, "assumption_dependent": False},
        {"id": "t3", "line": "The Quiet Mains", "tier": "brave", "tier_reason": "Gives the water network a voice, which the category has not done.",
         "proposition": "Hear the network that never stops working.", "tension_text": "The network is trusted because it is never noticed.",
         "mechanism": "Sound from the pipes under the street, played back above ground.", "score": {"total": 21, "of": 35}, "ready": False,
         "proposition_ok": True, "assumption_dependent": True}]
    return {"status": "proceed", "gate": {"action": "proceed", "category": "water utilities", "market": "IE", "why": "invented fixture run"},
            "assumed_brief": ab, "territories": terr}


SHOTS = {
    "t1": [("A kitchen tap at first light", "wide, soft", "water starts to run into a glass"),
           ("A hand under a running tap", "close, warm", "the hand turns the tap off a little early"),
           ("A window over a sink", "medium, still", "light falls across the empty sink"),
           ("A glass of water on a table", "wide, calm", "the glass catches the evening sun")],
    "t2": [("A meter on a wall", "close, flat", "a dial moves by one small step"),
           ("A bath filling slowly", "high angle", "the level rises towards the line"),
           ("A garden hose coiled up", "medium, bright", "a single drop falls from the nozzle"),
           ("A row of full glasses", "wide, level", "the glasses stand in a line of light")],
    "t3": [("A street at night", "wide, dark", "a manhole cover glows faintly"),
           ("A long pipe underground", "low, cool", "ripples travel along the pipe"),
           ("An empty reservoir", "wide, hushed", "light enters through a high window"),
           ("A calm surface at dawn", "wide, quiet", "the surface holds the first light")],
}


def plan_obj(run_hash: str) -> dict:
    return {"run_sha256_12": run_hash, "territories": {
        tid: [{"shot": f"f{i + 1}", "framing": s[0], "camera": s[1], "action": s[2], "on_screen_line": ""} for i, s in enumerate(shots)]
        for tid, shots in SHOTS.items()}}


def main() -> None:
    HERE.mkdir(exist_ok=True)
    run = HERE / "lumen_run.json"
    _write_json(run, run_obj())
    run_hash = hashlib.sha256(run.read_bytes()).hexdigest()[:12]
    plan = HERE / "lumen_run.frames-plan.json"
    _write_json(plan, plan_obj(run_hash))
    plan_hash = hashlib.sha256(plan.read_bytes()).hexdigest()[:12]
    vdir = HERE / "lumen_run.frames" / FOLDER
    vdir.mkdir(parents=True, exist_ok=True)
    frames = {}
    for tid, shot, tier in FRAMES:
        key = f"{tid}-{shot}-{tier}"
        png = vdir / f"{key}.png"
        draw_frame(tid, shot, tier).save(png, optimize=True)
        s = SHOTS[tid][int(shot[1]) - 1]
        flagged = (tid, shot, tier) in FLAGGED
        checked = (tid, shot, tier) not in UNCHECKED
        prompt = f"{s[0]}, {s[1]}: {s[2]}. Abstract, rough finish. No logos, no brand names, no readable signage or text anywhere in the frame."
        frames[key] = {"territory": tid, "shot": shot, "tier": "best" if tier == "pro" else "quick",
                       "model": "gemini_image3_pro" if tier == "pro" else "gemini_image3.1_flash", "credits": 20 if tier == "pro" else 7,
                       "prompt": prompt, "prompt_sha256": hashlib.sha256(prompt.encode()).hexdigest(), "task": f"fixture-{key}",
                       "status": "SUCCEEDED", "file": png.name, "sha256": hashlib.sha256(png.read_bytes()).hexdigest(),
                       "guard": {"checked": checked, "flagged": flagged, "found": {"readable_text": ["EXIT"]} if flagged else {},
                                 "reason": "test: readable sign" if flagged else ("clean" if checked else "skipped: Ollama not reachable (URLError)")},
                       "approved_by_person": flagged and (tid, shot) == ("t2", "f3")}
    for tid, shot, tier in REFUSED:
        key = f"{tid}-{shot}-{tier}"
        frames[key] = {"territory": tid, "shot": shot, "tier": "quick", "model": "gemini_image3.1_flash", "status": "REFUSED",
                       "error": "the shot description names banned imagery: test"}
    _write_json(vdir / "manifest.json", {
        "frames": frames, "fixture": True,
        "style": {"source": "invented fixture style", "hash": STYLE_HASH, "finish": "rough", "look": ["abstract", "flat colour"], "palette": [],
                  "this_not_that": [], "banned_imagery": [], "notes": "", "references": [], "ignored_references": []},
        "inputs": {"run_sha256_12": run_hash, "plan_sha256_12": plan_hash, "safety_banned_sha256_12": "000000000000"},
        "safe_messaging": {"applies": False, "packs": [], "reviewed": None}})
    draw_supplied(1600, 900, 0).save(HERE / "cover.png", optimize=True)
    draw_supplied(320, 180, 1).save(HERE / "small.png", optimize=True)


if __name__ == "__main__":
    main()
