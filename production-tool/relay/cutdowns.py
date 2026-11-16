"""Cutdowns and re-aspects of a film (features/campaign-formats.clan, phases 5 and 6): the relay's
`cutdown` op, in three steps (relay-api cutdown.step).

plan     Dex's beat plan for each length, and a crop of each shot for each shape, shown before
         anything renders. `ModelCutter` asks Claude (through the director's model port, as Skye
         does), who looks at three stills of each shot (in, middle, out) and answers which shots
         each length keeps, with a reason, and where the subject is in each still. The relay settles
         the rest, so the plan is the same shape whoever made it:
           windows  fit_windows: the kept shots' windows of their takes, trimmed from their tails
                    (the action's start stays) or grown into their handles, to the length less the
                    end card (stitch adds CARD_S itself), no window under MIN_WINDOW_S;
           crops    crop_keys: the largest box of the shape inside the take, centred on the subject;
                    a slow pan (keys at in, middle and out) only when the subject moves more than
                    PAN_MOVE of the take's width, else one box on all of it; `cuts` when the subject
                    is wider (or taller) than the box, so Aleph 2 should make the shot's new edges.
         `PassthroughCutter` answers with no model (the local relay, the tests, an agency with
         Claude off): the opening and the payoff first, then evenly through the middle, about
         2.5 s a shot; the subject is the middle 30% of the frame, so a 9:16 crop keeps it and
         nothing is outpainted unless a person asks for it.
render   stitch (mode "cutdown") renders one length at one shape; free. The type layers are drawn
         here into transparent PNGs at the film's size (typeset.py), one per timing, so stitch
         needs no font.
outpaint one take given new edges at targetRatio on Aleph 2: an ordinary paid provider job.

Pure functions; nothing here calls a provider.
"""

from __future__ import annotations

import io
import math
import time
from pathlib import Path

CARD_S = 2.5          # stitch.py CARD_S: the end card stitch adds after the clips
MIN_WINDOW_S = 1.0    # no shot shorter than this in a cutdown
SHOT_S = 2.5          # the passthrough keeps about one shot for each 2.5 s
PAN_MOVE = 0.10       # a subject that moves more than this share of the take's width gets a pan
FRAME_S = 1 / 24      # stitch's fps
MAX_CUT_SIDE = 1920   # a cutdown is rendered at its delivery size, at most this long
# Aleph 2's targetAspectRatio values (Runway OpenAPI, video_to_video aleph2); 4:5 is made at 3:4 and cropped.
ALEPH_RATIOS = ("16:9", "4:3", "3:2", "1:1", "2:3", "3:4", "9:16", "21:9")
OUTPAINT_PROMPT = ("Continue the scene beyond its edges; keep everything inside exactly as it is. "
                   "Match its light, colour, grain and motion. No text, no letters, no logos.")
PROMPT_VERSION = "cutter.v1"
PURPOSE = "cutdown"
PROMPTS = Path(__file__).parent / "prompts"
MAX_STILLS = 36       # pictures Claude sees for one plan
CENTRE = {"x": 0.35, "y": 0.15, "w": 0.30, "h": 0.70}  # the passthrough's subject, in 0-1 of the frame


def _r(x: float) -> float:
    return round(x + 0.0, 3)


def aleph_ratio(w: float, h: float) -> str:
    """The Aleph 2 ratio a shape is made at: its own, else the nearest (4:5 -> 3:4)."""
    want = math.log(w / h)

    def dist(r: str) -> float:
        a, b = (int(x) for x in r.split(":"))
        return abs(math.log(a / b) - want)
    return min(ALEPH_RATIOS, key=dist)


def same_shape(a: dict, b: dict, tol: float = 0.01) -> bool:
    return abs(math.log(a["w"] / a["h"]) - math.log(b["w"] / b["h"])) <= tol


# ── windows ─────────────────────────────────────────────────────────────────
def fit_windows(shots: list[dict], keep: set[str], length_s: float, card_s: float = CARD_S) -> tuple[list[dict], float]:
    """The kept shots' windows, in cut order, fitted to length_s less the end card; and how far over
    (a positive number) or short (negative) the windows still are when they cannot fit.

    shots: [{shotId, inS, outS, takeS?, endCard?}] (the master's windows). An end card shot is never a
    window (stitch draws the card). Too long: every window is trimmed from its tail by the same share,
    none under MIN_WINDOW_S (or its own length, when shorter). Too short: windows grow into their
    handles (the take after outS) by the same share."""
    target = max(MIN_WINDOW_S, length_s - card_s)
    kept = [s for s in shots if s["shotId"] in keep and not s.get("endCard")]
    if not kept:
        return [], -target
    slots = [max(FRAME_S, float(s["outS"]) - float(s.get("inS") or 0)) for s in kept]
    total = sum(slots)
    lengths = list(slots)
    if total > target + 1e-6:
        floor = [min(MIN_WINDOW_S, sl) for sl in slots]
        fixed: set[int] = set()
        for _ in range(len(kept)):
            free = [i for i in range(len(kept)) if i not in fixed]
            room = target - sum(floor[i] for i in fixed)
            k = room / sum(slots[i] for i in free) if free else 0
            low = [i for i in free if slots[i] * k < floor[i]]
            if not low:
                for i in free:
                    lengths[i] = slots[i] * k
                break
            for i in low:
                fixed.add(i)
                lengths[i] = floor[i]
        else:
            lengths = floor
    elif total < target - 1e-6:
        handles = [max(0.0, float(s.get("takeS") or s["outS"]) - float(s["outS"])) for s in kept]
        spare = sum(handles)
        grow = min(spare, target - total)
        if spare > 0:
            lengths = [sl + grow * hd / spare for sl, hd in zip(slots, handles)]
    out = []
    for s, ln in zip(kept, lengths):
        ins = float(s.get("inS") or 0)
        out.append({"shotId": s["shotId"], "inS": _r(ins), "outS": _r(ins + max(FRAME_S, ln))})
    over = sum(w["outS"] - w["inS"] for w in out) - target
    return out, _r(over)


def passthrough_keep(shots: list[dict], length_s: float, card_s: float = CARD_S) -> dict[str, str]:
    """Which shots a length keeps with no model, and why: about one shot each SHOT_S. One shot: the
    payoff (the last before the end card). More: the opening and the payoff, then evenly between."""
    body = [s for s in shots if not s.get("endCard")]
    if not body:
        return {}
    n = max(1, min(len(body), round((length_s - card_s) / SHOT_S)))
    if n >= len(body):
        return {s["shotId"]: "Kept: the whole film fits this length." for s in body}
    if n == 1:
        return {body[-1]["shotId"]: "The payoff: one idea, then the end card."}
    picks = {0: "The opening: it sets up the idea and shows the brand early.",
             len(body) - 1: "The payoff before the end card."}
    for j in range(1, n - 1):
        i = round(j * (len(body) - 1) / (n - 1))
        picks.setdefault(i, "Kept for the story's middle.")
    return {body[i]["shotId"]: why for i, why in picks.items()}


def settle_lengths(shots: list[dict], answers: list[dict], lengths: list[float]) -> list[dict]:
    """Each length's beats: every shot of the master, kept or dropped with a reason, the kept ones with
    their fitted windows. `answers`: [{lengthS, why?, beats: [{shotId, keep, why}]}] from the model or the
    passthrough; a shot the answer leaves out is dropped; a length it leaves out keeps the passthrough's."""
    out = []
    ids = {s["shotId"] for s in shots}
    for length in lengths:
        ans = next((a for a in answers if abs(float(a.get("lengthS", -1)) - length) < 0.5), None)
        if ans is None:
            reasons = passthrough_keep(shots, length)
            ans = {"lengthS": length, "beats": [{"shotId": k, "keep": True, "why": v} for k, v in reasons.items()]}
        said = {b["shotId"]: b for b in ans.get("beats") or [] if b.get("shotId") in ids}
        keep = {k for k, b in said.items() if b.get("keep")}
        windows, over = fit_windows(shots, keep, length)
        win = {w["shotId"]: w for w in windows}
        beats = []
        for s in shots:
            if s.get("endCard"):
                continue
            b = said.get(s["shotId"])
            w = win.get(s["shotId"])
            why = (b or {}).get("why") or ("Dropped to fit the length." if not w else "Kept.")
            beats.append({"shotId": s["shotId"], "keep": bool(w), "why": why[:300],
                          "inS": w["inS"] if w else _r(float(s.get("inS") or 0)),
                          "outS": w["outS"] if w else _r(float(s["outS"]))})
        why = (ans.get("why") or "")[:300]
        if over > FRAME_S:
            why = f"{why} Over by {over:.1f} s: drop a beat.".strip()
        entry = {"lengthS": length, "beats": beats}
        if why:
            entry["why"] = why[:400]
        out.append(entry)
    return out


# ── crops ───────────────────────────────────────────────────────────────────
def crop_box(tw: float, th: float, aw: float, ah: float, cx: float, cy: float) -> dict:
    """The largest box of shape aw:ah inside a tw x th take, centred on (cx, cy) as far as it can be."""
    r = aw / ah
    if tw / th > r:
        h, w = th, th * r
    else:
        w, h = tw, tw / r
    x = min(max(cx - w / 2, 0.0), tw - w)
    y = min(max(cy - h / 2, 0.0), th - h)
    return {"x": _r(x), "y": _r(y), "w": _r(w), "h": _r(h)}


def _union(boxes: list[dict]) -> dict:
    x0 = min(b["x"] for b in boxes)
    y0 = min(b["y"] for b in boxes)
    x1 = max(b["x"] + b["w"] for b in boxes)
    y1 = max(b["y"] + b["h"] for b in boxes)
    return {"x": x0, "y": y0, "w": x1 - x0, "h": y1 - y0}


def crop_keys(take: dict, aspect: dict, subjects: list[dict]) -> tuple[list[dict], dict, bool]:
    """(keys, subject union, cuts) for one shot at one shape. subjects: the subject box at in, middle and
    out (take pixels; one or more). A shape the take already has needs no crop."""
    tw, th = float(take["w"]), float(take["h"])
    if same_shape(take, aspect):
        whole = {"x": 0.0, "y": 0.0, "w": tw, "h": th}
        return [{"at": 0.0, "box": whole}], _union(subjects) if subjects else whole, False
    subjects = subjects or [{"x": CENTRE["x"] * tw, "y": CENTRE["y"] * th, "w": CENTRE["w"] * tw, "h": CENTRE["h"] * th}]
    union = _union(subjects)
    boxes = [crop_box(tw, th, aspect["w"], aspect["h"], b["x"] + b["w"] / 2, b["y"] + b["h"] / 2) for b in subjects]
    w, h = boxes[0]["w"], boxes[0]["h"]
    cuts = any(b["w"] > w * 1.02 or b["h"] > h * 1.02 for b in subjects)
    moves = max(b["x"] for b in boxes) - min(b["x"] for b in boxes) + max(b["y"] for b in boxes) - min(b["y"] for b in boxes)
    if len(boxes) > 1 and moves > PAN_MOVE * tw:
        ats = [0.0, 0.5, 1.0] if len(boxes) == 3 else [0.0, 1.0]
        keys = [{"at": a, "box": b} for a, b in zip(ats, boxes)]
    else:
        keys = [{"at": 0.0, "box": crop_box(tw, th, aspect["w"], aspect["h"], union["x"] + union["w"] / 2, union["y"] + union["h"] / 2)}]
    return keys, {k: _r(v) for k, v in union.items()}, cuts


def settle_crops(shots: list[dict], aspects: list[dict], subjects: dict[str, list[dict]]) -> list[dict]:
    """A crop for every shot (but the end card) at every shape. subjects: shotId -> boxes in 0-1 of the
    frame (in, middle, out), as the model saw them; a shot it did not answer gets the middle."""
    out = []
    for s in shots:
        if s.get("endCard"):
            continue
        take = s.get("takeSize") or {"w": 1920, "h": 1080}
        seen = [{"x": b["x"] * take["w"], "y": b["y"] * take["h"], "w": b["w"] * take["w"], "h": b["h"] * take["h"]}
                for b in subjects.get(s["shotId"]) or [] if b.get("w", 0) > 0 and b.get("h", 0) > 0]
        for a in aspects:
            keys, union, cuts = crop_keys(take, a, seen)
            why = ("Aleph 2 makes its new edges: the crop would cut the subject." if cuts
                   else "A slow pan follows the subject." if len(keys) > 1
                   else "Cropped round the subject." if seen else "Cropped round the middle.")
            out.append({"shotId": s["shotId"], "aspect": {"w": a["w"], "h": a["h"]}, "keys": keys, "subject": union,
                        "cuts": cuts, "why": why})
    return out


# ── the cutter ──────────────────────────────────────────────────────────────
def output_schema() -> dict:
    """What the model answers: beats per length, and the subject in each still (0-1 of the frame)."""
    box = {"type": "object", "properties": {k: {"type": "number", "minimum": 0, "maximum": 1} for k in "xywh"},
           "required": list("xywh"), "additionalProperties": False}
    return {
        "type": "object",
        "properties": {
            "lengths": {"type": "array", "maxItems": 8, "items": {
                "type": "object",
                "properties": {"lengthS": {"type": "number"}, "why": {"type": "string", "maxLength": 400},
                               "beats": {"type": "array", "maxItems": 100, "items": {
                                   "type": "object",
                                   "properties": {"shotId": {"type": "string"}, "keep": {"type": "boolean"},
                                                  "why": {"type": "string", "maxLength": 300}},
                                   "required": ["shotId", "keep", "why"], "additionalProperties": False}}},
                "required": ["lengthS", "beats"], "additionalProperties": False}},
            "subjects": {"type": "array", "maxItems": 100, "items": {
                "type": "object",
                "properties": {"shotId": {"type": "string"}, "boxes": {"type": "array", "maxItems": 3, "items": box}},
                "required": ["shotId", "boxes"], "additionalProperties": False}},
            "rationale": {"type": "string", "maxLength": 2000},
        },
        "required": ["lengths", "subjects"],
        "additionalProperties": False,
    }


def _shots_of(cut: dict) -> list[dict]:
    return [{k: v for k, v in s.items() if k != "stills"} for s in cut["shots"]]


def _settle(cut: dict, answer: dict) -> dict:
    shots = _shots_of(cut)
    lengths = [float(x) for x in cut["lengths"]]
    aspects = [a for a in cut.get("aspects") or []]
    subjects = {s["shotId"]: s.get("boxes") or [] for s in answer.get("subjects") or []}
    return {"lengths": settle_lengths(shots, answer.get("lengths") or [], lengths),
            "crops": settle_crops(shots, aspects, subjects)}


class PassthroughCutter:
    """No model: the passthrough's beats and the middle of every frame (the local relay; the tests)."""

    model = "passthrough"
    prompt_version = PROMPT_VERSION
    sees_images = False

    def plan(self, req: dict, fetch=None) -> dict:
        cut = req["input"]["cutdown"]
        shots = _shots_of(cut)
        answers = []
        for length in cut["lengths"]:
            reasons = passthrough_keep(shots, float(length))
            answers.append({"lengthS": float(length), "beats": [
                {"shotId": s["shotId"], "keep": s["shotId"] in reasons,
                 "why": reasons.get(s["shotId"], f"Dropped to fit {float(length):g} s.")} for s in shots if not s.get("endCard")]})
        out = _settle(cut, {"lengths": answers, "subjects": []})
        out["rationale"] = "passthrough: no model; the opening and the payoff first, the middle of each frame kept."
        return out


class ModelCutter:
    """Dex on the director's model port: beats and the subject in each still."""

    prompt_version = PROMPT_VERSION
    sees_images = True

    def __init__(self, port, prompt_dir: Path = PROMPTS, prompt_version: str = PROMPT_VERSION):
        self.port = port
        self.prompt_version = prompt_version
        self.system = (prompt_dir / f"{prompt_version}.md").read_text()
        self.schema = output_schema()

    @property
    def model(self) -> str:
        return getattr(self.port, "vision_model", None) or getattr(self.port, "model", "unknown")

    def plan(self, req: dict, fetch=None) -> dict:
        from cards import downscale
        from director.model import Usage

        cut = req["input"]["cutdown"]
        images, payload_shots = [], []
        for s in cut["shots"]:
            seen = []
            for i, still in enumerate(s.get("stills") or []):
                if fetch is None or len(images) >= MAX_STILLS:
                    break
                try:
                    media_type, data = downscale(fetch(still["url"]))
                except Exception:
                    continue
                images.append({"media_type": media_type, "data": data})
                seen.append({"picture": len(images), "at": ("in", "middle", "out")[min(i, 2)]})
            payload_shots.append({**{k: v for k, v in s.items() if k != "stills"}, "pictures": seen})
        payload = {"shots": payload_shots, "lengths": cut["lengths"], "cardS": CARD_S,
                   "aspects": [f"{a['w']}:{a['h']}" for a in cut.get("aspects") or []]}
        t0 = time.monotonic()
        answer = self.port.call(PURPOSE, self.system, payload, self.schema, usage=Usage(),
                                attribution=req.get("jobId", PURPOSE), images=images or None, vision=bool(images),
                                max_tokens=4000)
        out = _settle(cut, answer)
        out["rationale"] = (answer.get("rationale") or "")[:2000]
        out["_latencyMs"] = round((time.monotonic() - t0) * 1000)
        return out


def make(director) -> PassthroughCutter | ModelCutter:
    """Dex's cutter on the director's model port, or the passthrough when the relay has no model."""
    inner = getattr(director, "director", director)
    port = getattr(inner, "port", None)
    return PassthroughCutter() if port is None else ModelCutter(port)


# ── type layers for a film ──────────────────────────────────────────────────
def layer_pngs(layers: list[dict], size: tuple[int, int], fetch=None) -> list[tuple[bytes, float | None, float | None]]:
    """The film's type layers as transparent PNGs at its size, one per timing: (png, fromS, toS). Layers
    with no timing are drawn together on one."""
    from PIL import Image

    import typeset

    groups: dict[tuple, list[dict]] = {}
    for layer in layers:
        key = (layer.get("fromS"), layer.get("toS"))
        groups.setdefault(key, []).append(layer)
    out = []
    for (a, b), group in groups.items():
        img = Image.new("RGBA", size, (0, 0, 0, 0))
        if not typeset.draw(img, group, fetch):
            continue
        buf = io.BytesIO()
        img.save(buf, format="PNG")
        out.append((buf.getvalue(), a, b))
    return out


def cut_size(delivery: dict, aspect: dict | None = None) -> tuple[int, int]:
    """The size a cutdown renders at: its delivery size, at most MAX_CUT_SIDE long, even sides."""
    w, h = int(delivery["width"]), int(delivery["height"])
    k = min(1.0, MAX_CUT_SIDE / max(w, h))
    return max(2, int(w * k) // 2 * 2), max(2, int(h * k) // 2 * 2)
