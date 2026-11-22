"""Step 3 of Territories (feature territories-engine-develop): every route the person keeps is developed into a campaign world, tested against
the brief, and ranked by a judge who does not know whose it is.

    from territory import world
    doc, info = world.develop_ex(doc, llm, facts=facts, findings=findings)     # the stage: gates.drive({"develop": world.stage(llm, ...)})
    doc, refusals = world.more(doc, llm, "t_1a2b3c4d", "Shrey")                # "write more like this": more lines for ONE route
    doc, refusals, info = world.push(doc, llm, "t_1a2b3c4d", "Shrey")          # push ONE route's world further (its checks, and the rank, again)

``llm`` is ``llm(stage, system, user) -> (obj, usage)``; give it ``Spend.wrap(...)`` so every call is capped and never paid twice. The stages are
``world`` (one call per batch of routes, never per touchpoint), ``world_checks`` (one call for all routes), ``judge`` (one call, blind, on a
second model), ``world_more``. A resume re-pays nothing that finished: each message holds nothing that changes between a run and its resume.

What the model writes: a world's words and its look, three verdicts per route, and the judge's scores and order. What the CODE does:

* keeps every word inside its limit (words and characters per field, lines per world, touchpoints per journey: LESSONS 16) and throws out
  text with markdown marks, internal keys or ids, ``(to confirm)``, placeholders or a part marked Confidential (LESSONS 15), saying why;
* makes the ink readable: the palette's ink on its background is at least 4.5 to 1 (``contract.contrast``), by moving the ink when it is not;
* holds a font to the cleared list (``newsreader``, ``geist_extra_bold``), a scene to the drawn list, a voice to its pattern;
* writes the checks that are facts, not opinions: the evidence (derived or verified, and any price or percentage the words state that the brief
  and research do not), the contrast, the judge's order; and fails closed on the ones a model judges (no verdict means ``unchecked``, never ``ok``);
* refuses a world that says a phrase a category's safety pack bans (``engine/deck/packs``), asks the sensitive-topic review to be done (the
  gates hold the greenlight until a named person has) and notes the pack's watch words on the route;
* keeps the blind: the judge is sent letters, the brief and the words, and never a name, tier, band, distance, heading or id. The /35 scores are
  stored in ``blind`` beside the judged ``tier``; the person sees only ``rank`` (the judge's order);
* draws the pictures' slots from the palette (``pictures``, kind ``sketch``), sets ``marks`` from the scores and checks, validates every shape and
  the whole result against the contract before it writes, and turns every failure into ``run.error`` in plain words.

Dials move lines without a model: ``world.headlines`` holds the four corners, ``world.lines`` the rest, ``world.dial`` the natural position.
Dev harness: ``python -m territory.world --doc data.json --facts f.json --findings fi.json [--live]``.
"""
from __future__ import annotations

import copy
import json
import os
import random
import re
import threading
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass
from pathlib import Path

from . import carried, compare, contract, gates, insights, ladder, routes
from .llm import prompt
from .routes import NotReady, _Calls, _fit, _leaks, _scrub

# ---------------------------------------------------------------- tunables, in one place


@dataclass(frozen=True)
class Config:
    batch: int = 4              # routes written in one call (one call per batch, never one per touchpoint)
    workers: int = 4            # batches written at once
    max_lines: int = 12         # lines kept per world (the schema holds 16)
    min_lines: int = 4          # fewer and the dials have nothing to move
    tv_min: int = 3
    radio_min: int = 3
    retry: int = 1              # a route whose world was refused is written again ONCE, in one call for all refused, naming why
    more: int = 6               # lines a "write more like this" asks for
    # words per field (LESSONS 16: hard limits, enforced here, not hoped for in the prompt)
    w_headline: int = 14
    w_headline_sq: int = 20
    w_line: int = 12
    w_frame: int = 30
    w_radio: int = 30
    w_social: int = 25
    w_seat: int = 20
    w_crm: int = 22
    w_sound: int = 25
    w_ref: int = 10
    w_not: int = 12
    w_mood: int = 26


CONFIG = Config()

#: the weekend journey (the demo's): shown as ``journey[]`` and fed later from a media plan
JOURNEY = [{"key": "tv", "day": "Thursday 21:00", "where": "TV, after the news"},
           {"key": "story", "day": "Thursday 22:40", "where": "Instagram, scrolling in bed"},
           {"key": "poster", "day": "Friday 08:15", "where": "48-sheet outside the station"},
           {"key": "radio", "day": "Friday 17:30", "where": "Drive-time radio, stuck in traffic"},
           {"key": "seat", "day": "Saturday 09:20", "where": "On board, the table seat"},
           {"key": "email", "day": "Sunday 16:00", "where": "Inbox, before the trip home"}]

#: the brief fields the writer reads (a world is written from the proposition and tone, not the whole background)
BRIEF_FIELDS = ("background", "objectives", "audience", "insight", "smp", "reasons_to_believe", "desired_response", "tone_world_assets",
                "mandatories", "competitor_context")

PACKS_ENV = "NAPKIN_TERRITORY_PACKS"
#: words that are not copy: a frame, line or subject that is only this is a placeholder
_PLACEHOLDER = re.compile(r"^\W*(super|tbc|tbd|todo|lorem ipsum|placeholder|n/?a|\.\.\.|…)\W*$", re.I)
_LEAKY = re.compile(r"\(to confirm\)|\bto confirm\b|\bTBC\b|\bTBD\b|\blorem ipsum\b|\bplaceholder\b|\bderived\b|\b[a-z]+_[a-z_]+\b|\[[^\]]*\]|[{}<>]|\\n")
_FIGURE = re.compile(r"(?:€|\$|£)\s?(\d[\d,.]*)|(\d[\d,.]*)\s?(?:euros?|eur\b|usd\b|dollars?|pounds?|%|percent|per cent)", re.I)
_NUM = re.compile(r"\d+(?:[.,]\d+)?")
_HEX = re.compile(r"^#?([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$")
_VOICE = re.compile(r"^[A-Z]{2,8}$")
SCENES = ("platform", "window", "table", "arrival", "car", "sleep", "road", "night", "home", "town")


class Refused(ValueError):
    """One world could not be accepted. The message says why, in words a model can act on in its second try and a person can read."""


# ---------------------------------------------------------------- category safety packs (engine/deck/packs)


def packs_dir() -> Path:
    return Path(os.environ.get(PACKS_ENV) or Path(__file__).resolve().parents[1] / "deck" / "packs")


def _block(text: str, key: str) -> str:
    m = re.search(rf"^{key}:[^\n]*\n((?:[ \t]+[^\n]*\n|[ \t]*#[^\n]*\n|[ \t]*\n)*)", text + "\n", re.M)
    return m.group(1) if m else ""


def read_pack(text: str) -> dict:
    """The few members of a pack file this tool needs (``id``, ``when_any``, ``banned_phrases``, ``banned_imagery``, ``watch_words``,
    ``required_on_deck``) without a YAML parser: the middleware image is kept light. A test holds it equal to the YAML reading."""
    m = re.search(r"^when_any:\s*\[(.*?)\]", text, re.M)
    out = {"id": (re.search(r"^id:\s*(\S+)", text, re.M) or [None, ""])[1],
           "when_any": re.findall(r"\"([^\"]+)\"|'([^']+)'", m.group(1)) if m else []}
    out["when_any"] = [a or b for a, b in out["when_any"]]
    for key in ("banned_phrases", "banned_imagery"):
        out[key] = [{"text": t} for t in re.findall(r"text:\s*\"([^\"]+)\"", _block(text, key))]
    out["watch_words"] = [{"text": t, "why": w} for t, w in re.findall(r"text:\s*\"([^\"]+)\"\s*,\s*why:\s*\"([^\"]+)\"", _block(text, "watch_words"))]
    out["required_on_deck"] = re.findall(r"^\s*-\s*\"([^\"]+)\"", _block(text, "required_on_deck"), re.M)
    return out


def packs_for(corpus: str) -> list[dict]:
    """The packs whose trigger words appear in what was carried. A packs folder that cannot be read raises ``OSError``: a sensitive category must
    never be developed with its rules silently missing."""
    d = packs_dir()
    files = sorted(d.glob("*.yaml"))
    if not files:
        raise OSError(f"no category safety packs in {d}")
    hay = corpus.lower()
    out = []
    for f in files:
        pk = read_pack(f.read_text())
        if any(w.lower() in hay for w in pk["when_any"]):
            out.append(pk)
    return out


def rules_of(packs: list[dict]) -> dict:
    """What the writer is told and the code enforces: ``never`` (banned phrases and imagery), ``watch``, ``must_hold``."""
    return {"ids": [p["id"] for p in packs],
            "phrases": [b["text"] for p in packs for b in p["banned_phrases"]],
            "imagery": [b["text"] for p in packs for b in p["banned_imagery"]],
            "watch": [(w["text"], w["why"]) for p in packs for w in p["watch_words"]],
            "must_hold": [t for p in packs for t in p["required_on_deck"]]}


# ---------------------------------------------------------------- colour


def _hex(v) -> str:
    m = _HEX.match(str(v or "").strip())
    if not m:
        raise Refused(f"the colour {str(v)[:20]!r} is not a #RRGGBB hex")
    h = m.group(1)
    h = "".join(c * 2 for c in h) if len(h) == 3 else h
    return "#" + h.upper()


def _mix(a: str, b: str, t: float) -> str:
    ca, cb = [int(a[i:i + 2], 16) for i in (1, 3, 5)], [int(b[i:i + 2], 16) for i in (1, 3, 5)]
    return "#" + "".join(f"{round(x + (y - x) * t):02X}" for x, y in zip(ca, cb))


def readable_ink(ink: str, bg: str, bar: float = 4.5) -> tuple[str, bool]:
    """``(ink, moved)``: the ink as given when it reads on ``bg`` at ``bar`` to 1, else the same hue moved toward black or white (whichever
    reads better on this background) just far enough. Always reachable: the better of black and white is at least 4.58 on any background."""
    if contract.contrast(ink, bg) >= bar:
        return ink, False
    end = "#000000" if contract.contrast("#000000", bg) >= contract.contrast("#FFFFFF", bg) else "#FFFFFF"
    for step in range(1, 21):
        c = _mix(ink, end, step / 20)
        if contract.contrast(c, bg) >= bar:
            return c, True
    return end, True


# ---------------------------------------------------------------- words


def _plain(s) -> str:
    return insights._plain(s)


def _text(v, words: int, chars: int, ctx, *, trim: bool = False, what: str = "text") -> str:
    """One piece of copy: plain, within ``words`` and ``chars`` (``trim`` cuts at a sentence or word end; otherwise too long is refused), with
    nothing that is not meant for people. Raises ``Refused`` in words."""
    t = _plain(v)
    if not t or _PLACEHOLDER.match(t):
        raise Refused(f"the {what} is empty or a placeholder")
    if trim and (len(t.split()) > words or len(t) > chars):
        cut = _fit(t, chars)
        t = " ".join(cut.split()[:words]).rstrip(",;:- ")
    if len(t.split()) > words:
        raise Refused(f"the {what} is {len(t.split())} words, over the limit of {words}")
    if len(t) > chars:
        raise Refused(f"the {what} is {len(t)} characters, over the limit of {chars}")
    if insights._ID_IN_TEXT.search(t):
        raise Refused(f"the {what} names an internal id")
    if _LEAKY.search(t) or any(m in t for m in contract.TEXT_LEAKS) or contract.LEAK_WORDS.search(t):
        raise Refused(f"the {what} has text that is not meant for people")
    if _leaks(t, ctx.marks):
        raise Refused(f"the {what} repeats a part marked Confidential")
    return t


def _items(vs, words: int, chars: int, ctx, top: int, *, lower: int = 0, what: str, repairs: list, trim: bool = False) -> list[str]:
    """A list of copy: an item that does not pass is dropped (and counted), the rest kept in order without repeats, at most ``top``;
    fewer than ``lower`` left is a refusal."""
    out, seen = [], set()
    for v in vs if isinstance(vs, list) else []:
        try:
            t = _text(v, words, chars, ctx, trim=trim, what=what)
        except Refused as e:
            repairs.append(f"dropped a {what}: {e}")
            continue
        if t.lower() not in seen and len(out) < top:
            seen.add(t.lower())
            out.append(t)
    if len(out) < lower:
        raise Refused(f"only {len(out)} usable {what}s came back, at least {lower} are needed")
    return out


def _clamp(v, lo: int, hi: int, default: int) -> int:
    try:
        return max(lo, min(hi, int(round(float(v)))))
    except (TypeError, ValueError):
        return default


# ---------------------------------------------------------------- one world


def shape_world(raw, ctx, rules: dict | None = None) -> tuple[dict, str, list[str]]:
    """One raw world -> ``(world, mood, repairs)`` of the contract's ``world``, or ``Refused``. The words and the look are the model's;
    the limits, the readable ink, the cleared font and the safety rules are the code's."""
    if not isinstance(raw, dict):
        raise Refused("no world came back for this route")
    C, repairs = CONFIG, []
    pal = raw.get("palette") if isinstance(raw.get("palette"), dict) else {}
    p = {k: _hex(pal.get(k)) for k in ("bg", "ink", "acc", "soft")}
    p["ink"], moved = readable_ink(p["ink"], p["bg"])
    if moved:
        repairs.append("moved the text colour until it read on the background")
    ty = raw.get("type") if isinstance(raw.get("type"), dict) else {}
    font = str(ty.get("font") or "").lower().replace(" ", "_")
    weight = _clamp(ty.get("weight"), 400, 800, 400)
    if font not in contract.enum("font"):
        font = "geist_extra_bold" if weight >= 700 else "newsreader"
        repairs.append("held the typeface to the cleared list")
    face = ({"font": font, "weight": 800, "italic": False} if font == "geist_extra_bold"
            else {"font": font, "weight": 600 if weight >= 500 else 400, "italic": bool(ty.get("italic"))})
    hl = raw.get("headlines") if isinstance(raw.get("headlines"), dict) else {}
    heads = {k: _text(hl.get(k), C.w_headline_sq if k == "sq" else C.w_headline, contract.limit("headlines", k, what="maxLength"), ctx, what=f"headline ({k})")
             for k in ("wq", "wl", "sq", "sl")}
    lines = [t for t in _items(raw.get("lines"), C.w_line, 160, ctx, C.max_lines, lower=C.min_lines, what="line", repairs=repairs) if t not in heads.values()]
    if len(lines) < C.min_lines:
        raise Refused(f"only {len(lines)} lines say something other than a headline, at least {C.min_lines} are needed")
    tv, frames = [], raw.get("tv") if isinstance(raw.get("tv"), list) else []
    for f in frames[:contract.limit("world", "tv")]:
        f = f if isinstance(f, dict) else {}
        if f.get("scene") not in SCENES:
            repairs.append("dropped a TV frame with no drawable scene")
            continue
        try:
            tv.append({"scene": f["scene"], "text": _text(f.get("text"), C.w_frame, 240, ctx, what="TV frame")})
        except Refused as e:
            repairs.append(f"dropped a TV frame: {e}")
    if len(tv) < C.tv_min:
        raise Refused(f"only {len(tv)} usable TV frames came back, at least {C.tv_min} are needed")
    radio = []
    for r in (raw.get("radio") if isinstance(raw.get("radio"), list) else [])[:contract.limit("world", "radio")]:
        r = r if isinstance(r, dict) else {}
        v = str(r.get("voice") or "").strip().upper()
        if not _VOICE.match(v):
            repairs.append("dropped a radio line with no usable voice label")
            continue
        try:
            radio.append({"voice": v, "text": _text(r.get("text"), C.w_radio, 240, ctx, what="radio line")})
        except Refused as e:
            repairs.append(f"dropped a radio line: {e}")
    if len(radio) < C.radio_min:
        raise Refused(f"only {len(radio)} usable radio lines came back, at least {C.radio_min} are needed")
    sc = raw.get("scenes") if isinstance(raw.get("scenes"), dict) else {}
    scenes = {}
    for k in ("story", "poster", "seat", "email"):
        if sc.get(k) not in SCENES:
            raise Refused(f"the {k} has no scene from the list ({', '.join(SCENES)})")
        scenes[k] = sc[k]
    dl = raw.get("dial") if isinstance(raw.get("dial"), dict) else {}
    w = {"palette": p, "type": face, "headlines": heads, "lines": lines, "tv": tv, "radio": radio,
         "social": _text(raw.get("social"), C.w_social, 240, ctx, trim=True, what="story line"),
         "seat": _text(raw.get("seat"), C.w_seat, 160, ctx, trim=True, what="table card line"),
         "crm": _items(raw.get("crm"), C.w_crm, 200, ctx, 4, lower=1, what="email line", repairs=repairs),
         "music": _text(raw.get("music"), C.w_sound, 240, ctx, trim=True, what="music brief"),
         "sonic": _text(raw.get("sonic"), C.w_sound, 240, ctx, trim=True, what="sound brief"),
         "refs": _items(raw.get("refs"), C.w_ref, 120, ctx, 6, what="reference", repairs=repairs),
         "not": _items(raw.get("not"), C.w_not, 120, ctx, 6, what="not-this", repairs=repairs),
         "scenes": scenes, "dial": {k: _clamp(dl.get(k), 0, 100, 50) for k in ("tone", "energy", "register", "brand")}}
    mood = _text(raw.get("mood"), C.w_mood, 200, ctx, trim=True, what="mood") if raw.get("mood") else ""
    if rules:
        hit = banned_in(w, rules)
        if hit:
            raise Refused(f"it uses {', '.join(repr(h) for h in hit)}, which this category's safety rules ban")
    return w, mood, repairs


def spoken(w: dict, *, with_not: bool = False) -> list[str]:
    """Every piece of copy a world holds, for the scans (safety rules, figures) and for what the judge and the checker read."""
    out = [*w["headlines"].values(), *w["lines"], *(f["text"] for f in w["tv"]), *(r["text"] for r in w["radio"]), w["social"], w["seat"],
           *w["crm"], w["music"], w["sonic"], *w["refs"]]
    return out + (list(w["not"]) if with_not else [])


def banned_in(w: dict, rules: dict) -> list[str]:
    """Banned phrases (anywhere in the words) and banned imagery (as a whole word, in what is seen) the world says. ``not`` is exempt: it
    lists what the route must never become."""
    text = " ".join(spoken(w)).lower()
    hits = [p for p in rules["phrases"] if p.lower() in text]
    hits += [i for i in rules["imagery"] if re.search(rf"\b{re.escape(i.lower())}\b", text)]
    return list(dict.fromkeys(hits))


def watched_in(w: dict, rules: dict) -> list[tuple[str, str]]:
    text = " ".join(spoken(w)).lower()
    return [(t, why) for t, why in rules["watch"] if re.search(rf"\b{re.escape(t.lower())}\b", text)]


def figures_in(w: dict, corpus: str) -> list[str]:
    """Prices and percentages the world's words state that appear in neither the brief nor the research (a figure in an ad comes from the
    inputs). Returns them as written."""
    have = {n.replace(",", "") for n in _NUM.findall(corpus)}
    out = []
    for t in spoken(w):
        for m in _FIGURE.finditer(t):
            n = (m.group(1) or m.group(2)).rstrip(".,").replace(",", "")
            if n and n not in have and m.group(0).strip().rstrip(".,") not in out:
                out.append(m.group(0).strip().rstrip(".,"))
    return out


# ---------------------------------------------------------------- what the model is sent


def _brief_of(ctx) -> dict:
    return {f"brief:{k}": ctx.inp["brief"][k] for k in BRIEF_FIELDS if ctx.inp["brief"].get(k)}


def _corpus(ctx, routes_: list[dict]) -> str:
    """Everything a figure may come from: the brief, the pins, the findings, the routes' own words."""
    inp = ctx.inp
    parts = [str(v) for v in inp["brief"].values()] + [insights._pin_text(p) for p in inp["facts"]] + [f.get("statement", "") for f in inp["findings"]]
    return " ".join(parts + [f"{t['name']} {t['thought']} {t['why']} {t['sketch']}" for t in routes_])


def _handle(i: int) -> str:
    return f"r{i + 1}"


_HUES = ((0, "red"), (30, "orange"), (55, "yellow"), (120, "green"), (170, "teal"), (220, "blue"), (270, "violet"), (320, "pink"))


def lean_of(i: int) -> str:
    """A starting point for route ``i``'s background, spread round the colour wheel by the golden angle and cycled light, dark, mid, so routes written
    in parallel (different batches) still get clearly different palettes. A suggestion the writer may leave only for its idea's sake."""
    hue = round((i * 137.5) % 360)
    name = min(_HUES, key=lambda h: min(abs(h[0] - hue), 360 - abs(h[0] - hue)))[1]
    return f"{name} (about {hue} degrees), {('light', 'dark', 'mid')[i % 3]}"


def _hsl(hexc: str) -> tuple[float, float, float]:
    import colorsys
    r, g, b = (int(hexc[k:k + 2], 16) / 255 for k in (1, 3, 5))
    h, l, s = colorsys.rgb_to_hls(r, g, b)
    return h * 360, s, l


def palette_clashes(ts: list[dict]) -> list[list[str]]:
    """Pairs of live developed routes whose backgrounds are the same colour to a person: close in hue and in lightness (or both near grey and
    as light or dark as each other)."""
    live = [t for t in ts if t["status"] == "live" and t.get("world")]
    out = []
    for i, a in enumerate(live):
        for b in live[i + 1:]:
            (ha, sa, la), (hb, sb, lb) = _hsl(a["world"]["palette"]["bg"]), _hsl(b["world"]["palette"]["bg"])
            dh = min(abs(ha - hb), 360 - abs(ha - hb))
            if abs(la - lb) < 0.12 and (dh < 22 or (sa < 0.18 and sb < 0.18)):
                out.append([a["id"], b["id"]])
    return out


def _route_view(t: dict, handle: str, lean: str | None = None) -> dict:
    v = {"id": handle, "name": t["name"], "thought": t["thought"], "why": t.get("why", ""), "tension": t.get("tension", ""), "sketch": t["sketch"]}
    if lean:
        v["palette_lean"] = lean
    return v


def _json(ctx, o) -> str:
    return json.dumps(_scrub(o, ctx.marks), ensure_ascii=False, sort_keys=True)


def _rules_view(rules: dict | None) -> dict | None:
    if not rules or not rules["ids"]:
        return None
    return {"never_write": [*rules["phrases"], *rules["imagery"]], "take_care": [f"{t}: {why}" for t, why in rules["watch"]],
            "must_hold": rules["must_hold"]}


def _world_user(ctx, batch: list[dict], everyone: list[dict], rules, redo: str | None = None, previous: dict | None = None, instruction: str | None = None) -> str:
    handles = {t["id"]: _handle(i) for i, t in enumerate(batch)}
    obj = {"brief": _brief_of(ctx), "journey": [{"touchpoint": j["key"], "when": j["day"], "where": j["where"]} for j in (ctx.journey or JOURNEY)],
           "routes": [_route_view(t, handles[t["id"]], lean_of(sorted(x["id"] for x in everyone).index(t["id"])) if t["id"] in {x["id"] for x in everyone} else None)
                      for t in batch],
           "the_whole_set": [{"name": t["name"], "thought": t["thought"]} for t in everyone]}
    rv = _rules_view(rules)
    if rv:
        obj["category_rules"] = rv
    if previous:
        obj["its_current_world"] = {k: previous[k] for k in ("palette", "type", "headlines", "lines", "tv", "radio", "social", "seat", "crm", "music", "sonic", "refs", "not", "scenes", "dial")}
    if instruction:
        obj["push"] = instruction
    if redo:
        obj["redo"] = redo
    return _json(ctx, obj)


# ---------------------------------------------------------------- writing the worlds


def write_worlds(llm, ctx, todo: list[dict], everyone: list[dict], rules, *, cancel=None, previous: dict | None = None, instruction: str | None = None,
                 info: dict) -> dict[str, tuple[dict, str]]:
    """``{territory id: (world, mood)}`` for every route whose world was accepted. One call per batch (all batches at once), then ONE more call
    for every route refused, naming why; whatever is still refused goes in ``info["dropped"]`` and is left out. A failed call raises."""
    C = CONFIG
    got: dict[str, tuple[dict, str]] = {}
    refused: dict[str, str] = {}
    lock = threading.Lock()

    def call(batch: list[dict], redo: str | None):
        if cancel is not None and cancel.is_set():
            raise routes.NotReady("The run was stopped.")
        handles = {_handle(i): t for i, t in enumerate(batch)}
        obj, _ = llm("world", prompt("world"), _world_user(ctx, batch, everyone, rules, redo, (previous or {}).get(batch[0]["id"]) if len(batch) == 1 else None, instruction))
        by = {str(w.get("id")): w for w in (obj or {}).get("worlds") or [] if isinstance(w, dict)}
        for h, t in handles.items():
            try:
                w, mood, rep = shape_world(by.get(h), ctx, rules)
            except Refused as e:
                with lock:
                    refused[t["id"]] = str(e)
                continue
            with lock:
                got[t["id"]] = (w, mood)
                refused.pop(t["id"], None)
                info["repairs"] += [{"territory": t["id"], "what": r} for r in rep]

    def run(batches, redo):
        with ThreadPoolExecutor(max_workers=C.workers) as ex:
            for f in [ex.submit(call, b, redo) for b in batches]:
                f.result()

    run([todo[i:i + C.batch] for i in range(0, len(todo), C.batch)], None)
    for _ in range(C.retry):
        again = [t for t in todo if t["id"] in refused]
        if not again:
            break
        why = "; ".join(sorted({r for t in again for r in [refused[t["id"]]]}))
        redo = "Some worlds were thrown away: " + why[:600] + ". Write those worlds again inside every limit."
        for t in again:
            refused.pop(t["id"], None)
        run([again[i:i + C.batch] for i in range(0, len(again), C.batch)], redo)
    info["dropped"] += [{"territory": t["id"], "text": t["name"][:60], "reason": refused[t["id"]]} for t in todo if t["id"] in refused]
    return got


# ---------------------------------------------------------------- the checks


def _verdict(v, default_words: str) -> tuple[str, str]:
    """A model's verdict -> (status, text). A verdict that did not come back is ``unchecked``, never ``ok`` (fail closed)."""
    if not isinstance(v, dict) or v.get("status") not in ("ok", "warn", "fail"):
        return "unchecked", default_words
    return v["status"], v.get("text")


def _check_text(text, status: str, ctx, fallback: str) -> tuple[str, str]:
    try:
        return status, _text(text, 40, 300, ctx, trim=True, what="check")
    except Refused:
        return ("warn" if status == "ok" else status), fallback


def _words_of(t: dict) -> dict:
    w = t["world"]
    return {"headlines": w["headlines"], "lines": w["lines"][:8], "tv": [f["text"] for f in w["tv"]], "radio": [f"{r['voice']}: {r['text']}" for r in w["radio"]],
            "social": w["social"], "table_card": w["seat"], "email": w["crm"]}


def run_checks(llm, ctx, devs: list[dict]) -> dict[str, dict]:
    """The three checks a model judges, for all routes in ONE call: ``{territory id: {proposition, mandatory, rival}}`` of (status, text)."""
    if not devs:
        return {}
    handles = {t["id"]: _handle(i) for i, t in enumerate(devs)}
    obj = {"brief": {k: v for k, v in _brief_of(ctx).items() if k.split(":")[1] in ("smp", "objectives", "audience", "mandatories", "competitor_context", "tone_world_assets", "desired_response")},
           "routes": [{"id": handles[t["id"]], "thought": t["thought"], **_words_of(t)} for t in devs]}
    out, _ = llm("world_checks", prompt("world_checks"), _json(ctx, obj))
    by = {str(c.get("id")): c for c in (out or {}).get("checks") or [] if isinstance(c, dict)}
    return {t["id"]: by.get(handles[t["id"]]) or {} for t in devs}


def _letter(i: int) -> str:
    return chr(65 + i) if i < 26 else chr(65 + i // 26 - 1) + chr(65 + i % 26)


def _evidence_view(ctx, t: dict) -> list[str]:
    """What the route rests on, in the words of the research and the brief and without ids: the judge cannot weigh whether a tension is true from
    the route's own words alone."""
    return [_fit(ctx.ix[c]["text"], 240) for c in t["evidence"] if c in ctx.ix][:5]


def judge_view(ctx, devs: list[dict], redo: str | None = None) -> tuple[str, dict[str, str]]:
    """``(the message, {letter: territory id})``. The judge reads the brief and, for each route under a letter, its thought and the words of its
    world. No name, tier, band, distance, heading or id. The letters are shuffled by a seed from the ids, so order tells nothing."""
    order = sorted(devs, key=lambda t: t["id"])
    random.Random(compare.pack_seed([t["id"] for t in order])).shuffle(order)
    letters = {_letter(i): t["id"] for i, t in enumerate(order)}
    rows = [{"id": _letter(i), "thought": t["thought"], "tension": t.get("tension", ""), "evidence": _evidence_view(ctx, t), **_words_of(t)} for i, t in enumerate(order)]
    brief = {k: v for k, v in _brief_of(ctx).items() if k.split(":")[1] in ("smp", "objectives", "audience", "mandatories", "tone_world_assets", "insight")}
    return _json(ctx, {"brief": brief, "routes": rows, **({"redo": redo} if redo else {})}), letters


def _scored(obj: dict, letters: dict) -> dict[str, dict]:
    """Letter -> blind score, for each route the judge scored on all seven dimensions. A partial score is no score: it is not completed from guesses."""
    out = {}
    for s in obj.get("scores") or []:
        if isinstance(s, dict) and str(s.get("id")) in letters and all(isinstance(s.get(d), (int, float)) and not isinstance(s.get(d), bool) for d in ladder.SCORE_DIMS):
            by = {d: _clamp(s.get(d), 1, 5, 1) for d in ladder.SCORE_DIMS}
            out[str(s["id"])] = {"total": ladder.total(by), "of": ladder.MAX_SCORE, "by_dimension": by, "advisory": True}
    return out


def run_judge(llm, ctx, devs: list[dict]) -> dict[str, dict]:
    """The blind judge, on a second model (``llm.STAGE_MODEL['judge']`` is not the writer's): one call for all routes, and ONE more, naming the
    routes whose scores were incomplete, if any were. Returns ``{territory id: {blind?, rank?}}``: ``blind`` (the /35 score, stored), ``rank``
    (the judge's order, shown). A route the judge never scored fully has no ``blind`` (never made up)."""
    if not devs:
        return {}
    user, letters = judge_view(ctx, devs)
    obj, _ = llm("judge", prompt("judge"), user)
    obj = obj if isinstance(obj, dict) else {}
    blind = _scored(obj, letters)
    if len(blind) < len(letters):
        lacking = ", ".join(sorted(lt for lt in letters if lt not in blind))
        user2, _ = judge_view(ctx, devs, f"Your scores for {lacking} left a dimension empty. Score every route on all seven dimensions with a whole number from 1 to 5: when the page does not settle a dimension, give your best 3, never null.")
        obj2, _ = llm("judge", prompt("judge"), user2)
        obj2 = obj2 if isinstance(obj2, dict) else {}
        again = _scored(obj2, letters)
        if len(again) > len(blind):
            obj, blind = obj2, again
    order = [x for x in dict.fromkeys(str(x) for x in obj.get("ranking") or []) if x in letters]
    order += sorted([lt for lt in letters if lt not in order and lt in blind], key=lambda lt: (-blind[lt]["total"], lt))
    return {letters[lt]: {**({"blind": blind[lt]} if lt in blind else {}), "rank": order.index(lt) + 1} for lt in order}


# ---------------------------------------------------------------- the route, developed


def _cite_list(cites: list[str], ctx) -> list[str]:
    return [c for c in dict.fromkeys(cites) if c in ctx.ix][:contract.limit("check", "cite")]


def _check(tid: str, kind: str, status: str, text: str, cite: list[str] | None = None) -> dict:
    c = {"id": contract.mint("check", f"{tid}:{kind}"), "kind": kind, "status": status, "text": text}
    if cite:
        c["cite"] = cite
    return c


def make_checks(t: dict, w: dict, verdicts: dict, ctx, corpus: str, packs_hit: list[tuple[str, str]]) -> list[dict]:
    """The route's checks, in the order a person reads them. ``verdicts`` is the model's (proposition, mandatory, rival); the rest are facts."""
    tid, brief = t["id"], ctx.inp["brief"]
    out = []
    for kind, field, none_words in (("proposition", "smp", "The brief has no proposition in play, so there was nothing to test the route against."),
                                    ("mandatory", "mandatories", "The brief states no mandatories, so there was nothing to check the route against.")):
        if not brief.get(field):
            out.append(_check(tid, kind, "unchecked", none_words))
            continue
        st, tx = _verdict((verdicts or {}).get(kind), "The check did not come back for this route.")
        if st != "unchecked":
            st, tx = _check_text(tx, st, ctx, "This check's wording was not fit to show. Read the route against the brief yourself.")
        out.append(_check(tid, kind, st, tx, _cite_list([f"brief:{field}"], ctx)))
    derived = [c for c in t["evidence"] if c in ctx.ix and ctx.ix[c]["derived"]]
    figs = figures_in(w, corpus)
    if derived or figs:
        bits = []
        if derived:
            bits.append(f"Rests on {len(derived)} finding{'s' if len(derived) != 1 else ''} the agent derived and nobody has checked yet.")
        if figs:
            bits.append(f"The words state {', '.join(figs[:3])}, which is in neither the brief nor the research.")
        out.append(_check(tid, "evidence", "warn", " ".join(bits)[:300], _cite_list(derived + t["evidence"], ctx)))
    else:
        out.append(_check(tid, "evidence", "ok", "Rests on checked evidence, and every price or percentage in the words is in the brief or research.", _cite_list(t["evidence"], ctx)))
    has_rival = bool(brief.get("competitor_context"))
    st, tx = _verdict((verdicts or {}).get("rival"), "The check did not come back for this route.")
    if not has_rival and st != "unchecked":
        tx = "The brief names no rivals, so this is judged against the category's usual advertising. " + tx
    st, tx = _check_text(tx, st, ctx, "This check's wording was not fit to show. Compare the route with the rivals yourself.") if st != "unchecked" else (st, tx)
    out.append(_check(tid, "rival", st, tx, _cite_list(["brief:competitor_context"] if has_rival else [], ctx)))
    ratio = contract.contrast(w["palette"]["ink"], w["palette"]["bg"])
    out.append(_check(tid, "contrast", "ok" if ratio >= 4.5 else "fail", f"The text colour reads on the background at {ratio:.1f} to 1 (the bar is 4.5)."))
    if packs_hit:
        out.append(_check(tid, "landscape", "warn", ("Uses words this category's rules ask a person to read in context: " + "; ".join(f"{t_} ({why})" for t_, why in packs_hit))[:300]))
    return out


def risk_mark(t: dict) -> int:
    """1 to 5, from what is known and not from a model's mood: the route's judged tier, a finding nobody checked, a mandatory under strain."""
    base = {"safe": 1, "stretch": 2, "brave": 4}.get(t.get("tier"), 2)
    by = {c["kind"]: c["status"] for c in t["checks"]}
    return max(1, min(5, base + (1 if by.get("evidence") == "warn" else 0) + (1 if by.get("mandatory") in ("warn", "fail") else 0)))


def marks_of(t: dict) -> dict:
    """The three chips: ``fit`` and ``ownable`` are the judge's scores for them when it scored the route, else the checker's verdicts (ok 4, warn 3,
    fail 1, unchecked 3)."""
    by = {c["kind"]: c["status"] for c in t["checks"]}
    pick = {"ok": 4, "warn": 3, "fail": 1, "unchecked": 3}
    bd = (t.get("blind") or {}).get("by_dimension") or {}
    return {"fit": bd.get("fit") or pick[by.get("proposition", "unchecked")], "ownable": bd.get("ownability") or pick[by.get("rival", "unchecked")], "risk": risk_mark(t)}


def apply_rank(t: dict, judged: dict, n: int) -> dict:
    """Put the judge's answer on a developed route: ``blind``, ``rank``, the ``judge`` check and the ``marks`` that read from them."""
    t = copy.deepcopy(t)
    j = (judged or {}).get(t["id"]) or {}
    t.pop("blind", None)
    t.pop("rank", None)
    if "blind" in j:
        t["blind"] = j["blind"]
    if "rank" in j:
        t["rank"] = j["rank"]
    t["checks"] = [c for c in t["checks"] if c["kind"] != "judge"]
    if "rank" in j:
        t["checks"].append(_check(t["id"], "judge", "ok", f"The blind judge ranked it number {j['rank']} of {n}." + ("" if "blind" in j else " It gave no scores for it."), None))
    else:
        t["checks"].append(_check(t["id"], "judge", "unchecked", "The blind judge did not rank this route.", None))
    t["marks"] = marks_of(t)
    return t


def pictures_of(t: dict, w: dict) -> list[dict]:
    """One slot per pictured place, sketched from the palette (v1): each TV frame, the story, the poster, the table card and the email."""
    slots = [("tv", f["scene"], f"tv{i + 1}") for i, f in enumerate(w["tv"])] + [(k, w["scenes"][k], k) for k in ("story", "poster", "seat", "email")]
    return [{"id": contract.mint("picture", f"{t['id']}:{tag}"), "touchpoint": tp, "scene": sc, "kind": "sketch"} for tp, sc, tag in slots]


def developed(t: dict, w: dict, mood: str, verdicts: dict, ctx, corpus: str, packs_hit: list, extra_risks: list[str]) -> dict:
    d = copy.deepcopy(t)
    d.update(state="developed", world=w, mood=mood or d.get("mood", ""), references=[r[:200] for r in w["refs"]][:contract.limit("territory", "references")],
             pictures=pictures_of(t, w), checks=make_checks(t, w, verdicts, ctx, corpus, packs_hit))
    d["risks"] = [*[r for r in d["risks"] if r not in extra_risks], *extra_risks][:contract.limit("territory", "risks")]
    d["marks"] = marks_of(d)
    return d


# ---------------------------------------------------------------- the stage


def ready(doc: dict, *, findings=None) -> tuple[bool, str]:
    """Whether the gates let Develop run now (``gates.next_step``), and if not, why in words."""
    n = gates.next_step(doc, findings=findings)
    return (n["do"] == "run" and n["stage"] == "develop"), n["words"]


def _problems(doc: dict, ts: list[dict], facts, findings) -> list:
    """What the host would refuse in what this stage wrote: every route's shape, then ``contract.check`` on the whole document."""
    ps = contract.validate_all("territory", ts) + contract.validate_all("journey", doc.get("journey") or [])
    if ps:
        return ps
    base = contract.example()
    cand = {**base, "upstream": doc.get("upstream") or {}, "finds": doc.get("finds") or [], "focus": doc["focus"], "crew": doc.get("crew") or [],
            "expeditions": doc.get("expeditions") or [], "territories": ts, "spread": doc.get("spread") or base["spread"], "actions": doc.get("actions") or [],
            "journey": doc.get("journey") or base["journey"], "greenlit": [], "sends": [], "asks": [], "notes": doc.get("notes") or []}
    own = ("territories", "journey")
    return [p for p in contract.check(cand, facts=facts or [], findings=findings or []) if str(p.path).split("[")[0].split(".")[0] in own]


def _fail(doc: dict, message: str, refused: list | None = None, retryable: bool = True) -> dict:
    d = copy.deepcopy(doc)
    d.setdefault("run", {"state": "building"})
    d = gates._fail(d, "develop", message, retryable)
    if refused:
        d["run"]["error"]["refused"] = [r[:300] for r in refused][:contract.limit("run", "error", "refused")]
    return d


def _context(doc, facts, findings, sources, marks):
    ctx = routes.Ctx(doc, facts, findings, sources, marks)
    ctx.journey = doc.get("journey") or JOURNEY
    return ctx


def _sensitive(doc: dict, ctx, packs: list[dict]) -> dict:
    """A sensitive pack applies: the review is asked for (never marked done here: only a named person does that, see gates.record_review)."""
    if not packs:
        return doc
    rv = (doc.get("review") or {}).get("sensitive") or {}
    if not rv.get("required"):
        doc["review"] = {**(doc.get("review") or {}), "sensitive": {"required": True, "status": "missing"}}
    return doc


def _everyone(ts: list[dict]) -> list[dict]:
    return [t for t in ts if t["status"] == "live"]


def _rank_all(doc_ts: list[dict], judged: dict) -> list[dict]:
    live = [t for t in doc_ts if t["status"] == "live" and t["state"] == "developed"]
    ids = {t["id"] for t in live}
    n = len(judged) if judged else len(live)
    return [apply_rank(t, judged, n) if t["id"] in ids else t for t in doc_ts]


def develop_ex(doc: dict, llm, *, facts=None, findings=None, sources=None, marks=None, cancel=None, on_progress=None, force: bool = False) -> tuple[dict, dict]:
    """Develop every live route that is only a thought (``state: found``) into a world with checks, marks, a blind score and a rank. ``doc``
    must be at the point ``gates.next_step`` says Develop runs (``force`` for a dev harness). Returns ``(doc, info)``: the document with the
    routes developed and ``journey`` set, or the same document with ``run.error`` in words when it could not finish (what finished is kept in
    the spend record, so a retry re-pays nothing that finished). ``info``: ``dropped`` (a world refused, with why), ``repairs``, ``calls``,
    ``packs``, ``figures``."""
    ok, why = ready(doc, findings=findings)
    if not (ok or force):
        raise NotReady(why)
    info: dict = {"dropped": [], "repairs": [], "calls": 0, "packs": [], "figures": [], "undeveloped": []}
    ctx = _context(doc, facts, findings, sources, marks)
    counted = _Calls(llm)
    ts = copy.deepcopy(doc.get("territories") or [])
    todo = [t for t in ts if t["status"] == "live" and t["state"] == "found"]
    if not todo:
        return _fail(doc, "There are no routes left to develop. Keep a route (not parked or killed) and try again."), info
    try:
        packs = packs_for(" ".join([_corpus(ctx, []), " ".join(carried.text_of(v) for v in (doc.get("upstream") or {}).values())]))
    except OSError:
        return _fail(doc, "The category safety rules could not be read, so no route was developed. Nothing was run.", retryable=False), info
    rules = rules_of(packs)
    info["packs"] = rules["ids"]
    everyone = _everyone(ts)
    try:
        got = write_worlds(counted, ctx, sorted(todo, key=lambda t: t["id"]), everyone, rules, cancel=cancel, info=info)
    except Exception as e:   # noqa: BLE001
        msg = str(e) if e.__class__.__name__ in ("CapReached", "NotReady") else "The worlds stopped before they were written. What finished is kept; try again."
        return _fail(doc, msg), info
    if not got:
        return _fail(doc, "No route could be written into a world that passes the limits and the category's rules. " +
                     "; ".join(sorted({d['reason'] for d in info["dropped"]}))[:200] + ". Try again."), info
    corpus = _corpus(ctx, ts)
    stubs = {t["id"]: developed(t, *got[t["id"]], {}, ctx, corpus, [], []) for t in ts if t["id"] in got}      # in the document's order: a resume sends the same message
    live_dev = [t for t in ts if t["status"] == "live" and t["state"] == "developed"]
    try:
        with ThreadPoolExecutor(max_workers=2) as ex:
            fc = ex.submit(run_checks, counted, ctx, list(stubs.values()))
            fj = ex.submit(run_judge, counted, ctx, [*live_dev, *stubs.values()])
            verdicts, judged = fc.result(), fj.result()
    except Exception as e:   # noqa: BLE001
        msg = str(e) if e.__class__.__name__ == "CapReached" else "The checks on the worlds stopped before they finished. What was written is kept; try again."
        return _fail(doc, msg), info
    out_ts = []
    for t in ts:
        if t["id"] not in got:
            if t["id"] in {d["territory"] for d in info["dropped"]}:
                note = "No world could be written for this route inside the limits, so it is shown as a thought, not developed."
                t["risks"] = [*[r for r in t["risks"] if r != note], note][:contract.limit("territory", "risks")]
                info["undeveloped"].append(t["id"])
            out_ts.append(t)
            continue
        w, mood = got[t["id"]]
        hit = watched_in(w, rules)
        extra = [f"Uses a word that needs a person's read in this category: {x} ({why})."[:300] for x, why in hit][:3]
        d = developed(t, w, mood, verdicts.get(t["id"]) or {}, ctx, corpus, hit, extra)
        info["figures"] += [{"territory": t["id"], "figure": f} for f in figures_in(w, corpus)]
        out_ts.append(d)
    out_ts = _rank_all(out_ts, judged)
    info["palette_clash"] = palette_clashes(out_ts)
    d = copy.deepcopy(doc)
    d["territories"] = out_ts
    d.setdefault("journey", copy.deepcopy(JOURNEY))
    d = _sensitive(d, ctx, packs)
    ps = _problems(d, out_ts, facts, findings)
    if ps:
        return _fail(doc, contract.refusal_error(ps, "develop")["message"], [p.words for p in ps]), info
    d.setdefault("run", {"state": "building"})
    c = d["run"].setdefault("calls", {"model": 0, "lookups": 0})
    c["model"] = int(c.get("model") or 0) + counted.n
    d["run"].pop("error", None)
    info["calls"] = counted.n
    return d, info


def develop(doc: dict, llm, **kw) -> dict:
    """``develop_ex`` without the info: the stage function for ``gates.drive``."""
    return develop_ex(doc, llm, **kw)[0]


def stage(llm, **kw):
    """The ``develop`` entry for ``gates.drive``: ``drive(doc, {"explore": routes.stage(...), "develop": world.stage(llm, facts=.., findings=..)})``."""
    return lambda doc: develop(doc, llm, **kw)


# ---------------------------------------------------------------- the person's moves: write more, push


def _route(doc: dict, tid: str) -> dict | None:
    return next((t for t in doc.get("territories") or [] if t["id"] == tid), None)


def _refuse(doc, *words):
    return doc, [w for w in words if w]


def more(doc: dict, llm, territory_id: str, by: str, *, steer: str | None = None, n: int | None = None, facts=None, findings=None, sources=None, marks=None) -> tuple[dict, list[str]]:
    """"Write more like this": ``n`` (default ``CONFIG.more``) new lines for ONE developed route, in its voice, added to ``world.lines`` up to the
    schema's 16. One model call; nothing else changes (not the checks, not the rank: a line is not a new idea). ``(doc, refusals in words)``."""
    t = _route(doc, territory_id)
    if not t or t["state"] != "developed":
        return _refuse(doc, "That route has no world yet, so there is nothing to write more of.")
    if t["status"] != "live":
        return _refuse(doc, "That route is parked or killed. Bring it back first.")
    if not str(by or "").strip():
        return _refuse(doc, "Say who is asking, so the change is on record.")
    room = contract.limit("world", "lines") - len(t["world"]["lines"])
    if room <= 0:
        return _refuse(doc, f"This route already has {contract.limit('world', 'lines')} lines, the most a route can hold. Take one out first.")
    want = max(1, min(n or CONFIG.more, room))
    ctx = _context(doc, facts, findings, sources, marks)
    packs = packs_for(" ".join([_corpus(ctx, []), " ".join(carried.text_of(v) for v in (doc.get("upstream") or {}).values())]))
    rules = rules_of(packs)
    w = t["world"]
    obj = {"brief": _brief_of(ctx), "route": {"thought": t["thought"], "tension": t.get("tension", "")}, "headlines": w["headlines"],
           "existing_lines": w["lines"], "how_many": want, **({"steer": _fit(steer, 120)} if steer else {})}
    if _rules_view(rules):
        obj["category_rules"] = _rules_view(rules)
    got, _ = llm("world_more", prompt("world_more"), _json(ctx, obj))
    have = {x.lower() for x in [*w["lines"], *w["headlines"].values()]}
    new, rep = [], []
    for raw in (got or {}).get("lines") or []:
        try:
            line = _text(raw, CONFIG.w_line, 160, ctx, what="line")
        except Refused as e:
            rep.append(str(e))
            continue
        if line.lower() not in have and len(new) < want and not [h for h in banned_in({**w, "lines": [line], "headlines": {}, "tv": [], "radio": [], "social": "", "seat": "", "crm": [], "music": "", "sonic": "", "refs": []}, rules)]:
            have.add(line.lower())
            new.append(line)
    if not new:
        return _refuse(doc, "No new line came back that was different from the ones already there. Try again, or say what to aim for.")
    d = copy.deepcopy(doc)
    tt = _route(d, territory_id)
    tt["world"]["lines"] = [*tt["world"]["lines"], *new]
    ps = _problems(d, d["territories"], facts, findings)
    if ps:
        return _refuse(doc, *[p.words for p in ps][:3])
    return d, []


def push(doc: dict, llm, territory_id: str, by: str, *, instruction: str | None = None, facts=None, findings=None, sources=None, marks=None,
         cancel=None) -> tuple[dict, list[str], dict]:
    """Push ONE route's world further: its world is written again from its current one (the model is shown it and told to go further, or what
    ``instruction`` says), its three judged checks are run again, and the blind judge ranks the whole set again (a rank is relative). What a
    person set stays: ``starred``, ``lead``, ``dial_set``. The route's other checks, its marks and its pictures follow. At most 3 calls.
    ``(doc, refusals in words, info)``."""
    info: dict = {"dropped": [], "repairs": [], "calls": 0}
    t = _route(doc, territory_id)
    if not t or t["state"] != "developed":
        return doc, ["That route has no world yet, so there is nothing to push."], info
    if t["status"] != "live":
        return doc, ["That route is parked or killed. Bring it back first."], info
    if not str(by or "").strip():
        return doc, ["Say who is pushing it, so the change is on record."], info
    ctx = _context(doc, facts, findings, sources, marks)
    counted = _Calls(llm)
    try:
        packs = packs_for(" ".join([_corpus(ctx, []), " ".join(carried.text_of(v) for v in (doc.get("upstream") or {}).values())]))
    except OSError:
        return doc, ["The category safety rules could not be read, so nothing was pushed."], info
    rules = rules_of(packs)
    ask = _fit(instruction, 200) if instruction else "Push this world further: bolder, more specific, more surprising, same thought. Change the lines and the scenes freely; keep what already works."
    ts = copy.deepcopy(doc["territories"])
    base = next(x for x in ts if x["id"] == territory_id)
    try:
        got = write_worlds(counted, ctx, [base], _everyone(ts), rules, cancel=cancel, previous={territory_id: base["world"]}, instruction=ask, info=info)
    except Exception as e:   # noqa: BLE001
        return doc, [str(e) if e.__class__.__name__ in ("CapReached", "NotReady") else "The push stopped before it finished. Nothing was changed."], info
    if territory_id not in got:
        return doc, ["The pushed world could not be written inside the limits and the category's rules, so the route was left as it was: " +
                     "; ".join(d["reason"] for d in info["dropped"])[:200]], info
    w, mood = got[territory_id]
    keep = {k: base["world"][k] for k in ("starred", "lead", "dial_set") if k in base["world"]}
    w = {**w, **keep}
    corpus = _corpus(ctx, ts)
    hit = watched_in(w, rules)
    stub = developed(base, w, mood, {}, ctx, corpus, [], [])
    others = [t for t in ts if t["id"] != territory_id and t["status"] == "live" and t["state"] == "developed"]
    try:
        with ThreadPoolExecutor(max_workers=2) as ex:
            fc = ex.submit(run_checks, counted, ctx, [stub])
            fj = ex.submit(run_judge, counted, ctx, [*others, stub])
            verdicts, judged = fc.result(), fj.result()
    except Exception as e:   # noqa: BLE001
        return doc, [str(e) if e.__class__.__name__ == "CapReached" else "The checks on the pushed world stopped before they finished. Nothing was changed."], info
    extra = [f"Uses a word that needs a person's read in this category: {x} ({why})."[:300] for x, why in hit][:3]
    old_watch = lambda r: r.startswith("Uses a word that needs a person's read")   # noqa: E731
    new = developed({**base, "risks": [r for r in base["risks"] if not old_watch(r)]}, w, mood, verdicts.get(territory_id) or {}, ctx, corpus, hit, extra)
    out = [new if t["id"] == territory_id else t for t in ts]
    out = _rank_all(out, judged)
    d = copy.deepcopy(doc)
    d["territories"] = out
    ps = _problems(d, out, facts, findings)
    if ps:
        return doc, [p.words for p in ps][:3], info
    d.setdefault("run", {"state": "building"})
    c = d["run"].setdefault("calls", {"model": 0, "lookups": 0})
    c["model"] = int(c.get("model") or 0) + counted.n
    info["calls"] = counted.n
    return d, [], info


# ---------------------------------------------------------------- the person reads a world: what to show


def show(t: dict) -> dict:
    """What a person may see of a developed route's judging: the rank and nothing else (the /35 score and the dimensions stay stored)."""
    return {"rank": t.get("rank")}


# ---------------------------------------------------------------- dev harness


def main(argv=None) -> int:
    import argparse
    from .spend import Spend
    ap = argparse.ArgumentParser(prog="territory.world", description="Dev harness: develop the kept routes of a document that has been through Explore.")
    ap.add_argument("--doc", required=True, help="data.json (or a harness result with a 'doc' member) at the point Develop runs")
    ap.add_argument("--facts"), ap.add_argument("--findings")
    ap.add_argument("--keep", type=int, help="develop only the first N live routes (the rest are parked), for a cheaper check")
    ap.add_argument("--live", action="store_true", help="paid calls through the model backend the environment names")
    ap.add_argument("--max-usd", type=float, default=0.75)
    ap.add_argument("--out", help="where to write the result and the spend log")
    a = ap.parse_args(argv)
    load = lambda p: json.loads(Path(p).read_text()) if p else None   # noqa: E731
    doc, facts, findings = load(a.doc), load(a.facts), load(a.findings)
    doc = doc.get("doc", doc)
    if a.keep:
        n = 0
        for t in doc["territories"]:
            if t["status"] == "live" and t["state"] == "found":
                n += 1
                if n > a.keep:
                    t["status"] = "parked"
    todo = [t for t in doc["territories"] if t["status"] == "live" and t["state"] == "found"]
    if not a.live:
        import price_table

        from .llm import STAGE_MODEL
        from .spend import estimate_call
        b = -(-len(todo) // CONFIG.batch)
        est = b * estimate_call("world", STAGE_MODEL["world"]) + estimate_call("world_checks") + estimate_call("judge")
        print(f"Dry run: no model call made. {len(todo)} routes, {b + 2} calls, estimated ${est:.2f}.")
        return 0
    from .llm import LiveLLM
    sp = Spend(cap_usd=a.max_usd, store=Path(a.out).with_suffix(".spend.json") if a.out else None)
    llm = sp.wrap(LiveLLM(approved=True))
    out, info = develop_ex(doc, llm, facts=facts, findings=findings, force=True)
    err = out["run"].get("error")
    if err:
        print("ERROR:", err)
    for t in sorted(out["territories"], key=lambda t: t.get("rank") or 99):
        if t.get("state") == "developed" and t["status"] == "live":
            w = t["world"]
            print(f"#{t.get('rank')} {t['name']} [{t['tier']}] blind {t.get('blind', {}).get('total')}/35 marks {t['marks']} {w['palette']} {w['type']}")
            print("   ", w["headlines"]["wq"], "|", w["headlines"]["sl"])
            print("    checks:", " ".join(f"{c['kind']}={c['status']}" for c in t["checks"]))
    print("info:", json.dumps({k: v for k, v in info.items() if v}, ensure_ascii=False)[:1500])
    if a.out:
        Path(a.out).write_text(json.dumps({"doc": out, "info": info}, indent=1, ensure_ascii=False))
    print(f"calls {len(sp.lines)}, spent ${sp.total():.3f}")
    return 1 if err else 0


if __name__ == "__main__":
    raise SystemExit(main())
