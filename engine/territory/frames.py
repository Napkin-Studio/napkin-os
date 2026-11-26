"""Frames for the greenlit routes of a Territories document (feature territories-pictures-frames).

``engine/territory/visuals`` makes frames from a saved run FILE (the CLI). In the middleware the document is the run, so this module drives the
SAME reviewed library (``engine/visuals``: the Runway client and its double-pay rules, the picture-prompt lint, the
client-material rule (``visuals.policy``), the style (the client's Brand Clan, else the built-in look), the safe-messaging gate, the guard) from a document, for the routes a person greenlit and no others.

    f = Frames(doc, store, blobs, doc_id=..., llm=..., transport=..., guard_post=...)
    f.ask(ids)                 the cost card: how many pictures, which places are not offered and why; the ask goes into the history
    f.make(ids, card_id)       the paid step: the frame plan (once), the pictures, the guard, the placing
    f.approve(keys, by)        a named person accepts frames the guard held back; they are placed
    f.declare(origin, by)      a named person says what the material is (invented, demo or client); asked before the first picture, recorded with the frames
    f.status()                 what exists, what is held and why

Every move returns ``(doc, refusals, note, info, decisions)`` or raises ``Refuse`` in words. Rules this module adds on top of the library:

* only a greenlit, live, developed route is ever illustrated; a route nobody greenlit is refused by name, never drawn;
* the provider's money is its own line: the pictures cap (``spend.caps()[1]``, never above ``runway.LIFETIME_CAP_USD``) and a ledger of every send
  (``visuals.jobs.Ledger``, outside the frames folder) that counts for the document's lifetime. The Claude plan call is under the Claude cap;
* a yes is the card's id and an ask recorded before it: a stale id, or a yes with no ask, is refused. A create that got no answer is UNKNOWN: never
  re-created without ``retry_unknown`` and a fresh card that shows it;
* a frame the guard flags (readable text, a logo or brand, banned imagery) or could not check is HELD, never placed, until a person approves it or
  asks for a retry. The words a picture shows are compared with the exact on-screen line the plan meant for it, and both are said;
* a place is offered only to a picture that can hold it: a wide frame is not offered to a tall Story, and the reason is on the card;
* frames land by hash on the workspace's blob store and as ``frame`` members by link, labelled Illustrative; their rights start as Generated (the picture tool made them), which a person may change.

The only prices in the output are the ``ask`` and ``spend`` entries of the decision history (``Spend.decisions``). It runs in the middleware
image. Every brand and run in the tests is invented.
"""
from __future__ import annotations

import copy
import dataclasses
import hashlib
import json
import os
import re
import time
from datetime import datetime, timezone
from pathlib import Path

from visuals import guard as guard_mod, jobs as vjobs, lint, runway, safety, style as style_mod

from . import gates, material, pictures, spend as sp
from .llm import prompt
from .visuals import plan as plan_mod

ENV_ENABLE = "NAPKIN_TERRITORY_IMAGES"
DIR = "frames"
#: The aspect each place is drawn at (app/templates/territories/index.html: .fr, .story, .poster, .seat, .ehero).
ASPECT = {"tv": (16, 9), "story": (9, 16), "poster": (2, 1), "seat": (3, 4), "email": (2, 1)}
TOUCH_NAME = {"tv": "TV", "story": "Story", "poster": "Poster", "seat": "Table card", "email": "Email"}
FRAME_RATIO = tuple(int(x) for x in runway.RATIO.split(":"))
#: A frame is offered to a place only if covering it loses at most this share of the picture (the renderer crops with cover).
MAX_CROP = 0.15
SHOTS = plan_mod.SHOTS
SOURCE = "Made for this route with the picture tool"


class Refuse(Exception):
    """A move the engine will not make, in words a person can read. Nothing was sent. ``need`` names what a person can answer to unblock it
    (``material``: say whether the material is invented, a demo or the client's), or is None."""

    def __init__(self, words: str, need: str | None = None):
        super().__init__(words)
        self.need = need


#: The material question (the approved frames mock, state 1a; its words changed with the owner's rule of 26 Nov 2026, ``visuals.policy``).
MATERIAL_WORDS = ("Say what this material is before the first picture: the pictures record it. Client material is used the same way as for "
                  "the words; anything marked Confidential stays out of Napkin's own knowledge, not out of the work.")


#: The picture-prompt check's rules (visuals.lint) in words, for the rewrite call: a refused shot goes back with its reason and these.
LINT_RULES = ("Plain printable English only. No number, in figures or in words (one, two, three, half, a dozen): write a, a pair of, a few, both. "
              "No quotation marks or apostrophes. No capital letter in mid-sentence (it reads as a name), no names, no brand names. No 'in the style of'. "
              "Only common everyday words a picture model knows: say slow, not unhurried; road, not tarmac.")


def refused_refusal(rows: list[dict]) -> Refuse:
    """Every frame left for these routes was refused by the check, and the planner already rewrote it once: said in words, with Try again
    (``need``: ``retry_refused``), never as made or waiting."""
    n = len(rows)
    why = "; ".join(f"{r['shot']}: " + re.sub(r"^the shot description (cannot go to a picture model|names banned imagery): ", "", r["why"]) for r in rows)
    return Refuse(f"{n} picture{'s' if n != 1 else ''} could not be made: the words planned for {'them' if n != 1 else 'it'} cannot go to a picture "
                  f"model ({why}). Try again asks the planner to rewrite {'them' if n != 1 else 'it'} in plain words.", need="retry_refused")


def material_refusal() -> Refuse:
    """The material gate's no, in plain words: nobody has said what the material is yet, so the question is asked (``need``)."""
    return Refuse("Pictures are not made for this document yet: nobody has said what its material is. " + MATERIAL_WORDS, need="material")


def enabled(environ=None) -> bool:
    return str((os.environ if environ is None else environ).get(ENV_ENABLE) or "").strip().lower() in ("1", "true", "yes", "on")


def now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def _norm(s) -> str:
    return " ".join(re.sub(r"[^a-z0-9 ]", " ", str(s or "").lower()).split())


# ---------------------------------------------------------------- which routes, which places


def greenlit_ids(doc: dict) -> list[str]:
    return [g["territory_id"] for g in doc.get("greenlit") or [] if isinstance(g, dict)]


def eligible(doc: dict, ids=None) -> tuple[list[dict], list[str]]:
    """``(routes, refusals)``: the greenlit, live, developed routes asked for (all of them when ``ids`` is empty). Anything else is refused by name."""
    green = set(greenlit_ids(doc))
    by = {t["id"]: t for t in doc.get("territories") or []}
    want = list(dict.fromkeys(ids)) if ids else [i for i in greenlit_ids(doc) if i in by]
    out, why = [], []
    for i in want:
        t = by.get(i)
        name = (t or {}).get("name") or "That route"
        if t is None:
            why.append("That route is not in this document.")
        elif i not in green:
            why.append(f"{name} is not greenlit. Pictures are made only for routes a person has greenlit.")
        elif t.get("status") != "live" or t.get("state") != "developed" or not t.get("pictures"):
            why.append(f"{name} is not a developed, live route with places for pictures.")
        else:
            out.append(t)
    if not want:
        why.append("Greenlight a route first. Pictures are made only for greenlit routes.")
    return out, why


def place_of(fits: list[dict], shot) -> str | None:
    """The place a shot was made for: shot ``f<n>`` is the n-th place of its route that a frame can fill. ``None`` when the route has fewer."""
    return fits[SHOTS.index(shot)]["id"] if shot in SHOTS and SHOTS.index(shot) < len(fits) else None


def route_hash(t: dict) -> str:
    """6 hex of the words a route's pictures illustrate: when they change, its old frames are another route's and new ones are asked for."""
    blob = json.dumps([t.get("name"), t.get("thought"), t.get("tension"), t.get("theme"), (t.get("world") or {}).get("tv")], sort_keys=True, ensure_ascii=False)
    return hashlib.sha256(blob.encode()).hexdigest()[:6]


def offered(t: dict) -> tuple[list[dict], list[dict]]:
    """``(slots a frame may fill, [{touchpoint, why}] for the places that are not offered)``. Format feasibility, before anything is offered (LESSONS 20)."""
    ok, no, seen = [], [], set()
    want = FRAME_RATIO[0] / FRAME_RATIO[1]
    for s in t.get("pictures") or []:
        tp = s.get("touchpoint")
        a = ASPECT.get(tp)
        if a is None:
            continue
        r = a[0] / a[1]
        if 1 - min(want / r, r / want) <= MAX_CROP:
            ok.append(s)
        elif tp not in seen:
            seen.add(tp)
            no.append({"touchpoint": tp, "why": f"A wide picture cannot hold a {'tall ' if r < want else ''}{TOUCH_NAME.get(tp, tp)} place: the subject would be cut off."})
    return ok, no


def _brand_of(doc: dict) -> str | None:
    title = str(doc.get("title") or "")
    return (title.split(":")[0].strip() or None) if ":" in title else None


#: The app id of a Brand Clan (docs/contracts/brand-clan.md): the client's Brand Bible a Territories document holds by attach or spin-off.
BRAND_APP = "ie.napkin.brand"
#: The order a Brand Clan's colours are said in (its deck token roles first, then chart, then the rest), and how many a prompt names.
COLOUR_ORDER = ("accent", "paper", "ink", "panel", "accent_ink", "chart", "other")
MAX_COLOURS = 6


def colour_words(hex_code) -> str | None:
    """A colour as plain words a picture prompt may carry ("deep red", "pale cream"), from its hex. A prompt holds no figure and no name, so
    neither the hex nor the Brand Clan's own colour name goes in (style.lint, visuals.lint). ``None`` for a value that is not a hex colour."""
    h = str(hex_code or "").strip().lstrip("#")
    if len(h) == 3:
        h = "".join(c * 2 for c in h)
    if not re.fullmatch(r"[0-9a-fA-F]{6}", h):
        return None
    r, g, b = (int(h[i:i + 2], 16) / 255 for i in (0, 2, 4))
    hi, lo = max(r, g, b), min(r, g, b)
    light, chroma = (hi + lo) / 2, hi - lo
    sat = 0.0 if chroma == 0 else chroma / (1 - abs(2 * light - 1))
    if light >= 0.94:
        return "white" if sat < 0.25 else "off white"
    if light <= 0.08:
        return "black"
    if sat < 0.12 or chroma < 0.06:
        return "charcoal" if light < 0.3 else "grey" if light < 0.65 else "off white" if light >= 0.9 else "light grey"
    if r == hi:
        hue = ((g - b) / chroma) % 6
    elif g == hi:
        hue = (b - r) / chroma + 2
    else:
        hue = (r - g) / chroma + 4
    hue *= 60
    name = ("red" if hue < 15 or hue >= 345 else "orange" if hue < 40 else "yellow" if hue < 65 else "lime" if hue < 85 else "green" if hue < 160
            else "blue green" if hue < 190 else "blue" if hue < 250 else "purple" if hue < 290 else "magenta" if hue < 330 else "pink")
    if name in ("orange", "yellow") and light >= 0.82:
        return "cream"
    if name in ("orange", "red") and light < 0.33:
        return "brown" if name == "orange" else "deep red"
    if name == "red" and 0.6 <= light <= 0.78 and sat > 0.5:
        return "coral"
    if name == "blue" and light < 0.3:
        return "navy"
    if light < 0.33:
        return "deep " + name
    if light > 0.78:
        return "pale " + name
    if sat > 0.7:
        return "bright " + name
    if sat < 0.35:
        return "muted " + name
    return name


def brand_clan_of(rec) -> dict | None:
    """The Brand Clan a Territories document holds, as the host tells it (``clan.brand_clan {document_id, version, title, data}``: the attached
    ``ie.napkin.brand`` record and its frozen copy). ``None`` when it holds none, or what it holds is not a Brand Clan."""
    if not isinstance(rec, dict) or not isinstance(rec.get("data"), dict):
        return None
    d = rec["data"]
    return rec if isinstance(d.get("visual"), dict) or isinstance(d.get("imagery"), dict) else None


def _phrases(raw) -> list[str]:
    if isinstance(raw, list):
        raw = ", ".join(str(x) for x in raw if x)
    return [p.strip(" .") for p in re.split(r"[,;\n]+|\.\s+", str(raw or "")) if p.strip(" .")]


def brand_style(rec, forbid=()) -> tuple:
    """``(Style, look)`` for the frames: the Brand Clan's palette, imagery style and bans (docs/contracts/brand-clan.md section 8), or the built-in
    default when the document holds none (owner 2026-11-23: style is per client, from its Brand Clan; the per-client folder stand-in is gone).
    Logos and type stay out: a frame carries no logo and no words (the guard rails). A part that cannot go to a picture model (a figure, a
    quotation, a name) is left out and said in ``look.left_out``, never sent and never a reason to refuse the rest."""
    base = style_mod.load(None)
    b = brand_clan_of(rec)
    if b is None:
        return base, {"from": "default"}
    d, left = b["data"], []
    names = [x for x in forbid if x]

    def ok(text: str, key: str, allow=()) -> bool:
        norm = {k: ([] if k != "notes" else "") for k in ("look", "palette", "this_not_that", "banned_imagery", "notes")}
        norm[key] = [text]
        try:
            style_mod.lint(norm, names)
        except style_mod.StyleError as e:
            left.append({"what": text, "why": str(e).split(": ", 1)[-1]})
            return False
        bad = lint.lint_text({"look": "Look: ", "palette": "Palette: "}.get(key, "") + text + ".", banned=[], allow=allow)
        if bad:
            left.append({"what": text, "why": bad})
            return False
        return True

    imagery = d.get("imagery") if isinstance(d.get("imagery"), dict) else {}
    look = [p.lower() for p in _phrases(imagery.get("style"))]
    look = [p for p in dict.fromkeys(look) if ok(p, "look")]
    bans = [p.lower() for p in _phrases(imagery.get("bans"))]
    bans = [p for p in dict.fromkeys(bans) if ok(p, "banned_imagery", allow=[p])]
    cols = [c for c in ((d.get("visual") or {}).get("colours") or []) if isinstance(c, dict)]
    rank = {r: i for i, r in enumerate(COLOUR_ORDER)}
    cols.sort(key=lambda c: rank.get(c.get("role"), len(COLOUR_ORDER)))
    palette = [w for w in dict.fromkeys(colour_words(c.get("hex")) for c in cols) if w and ok(w, "palette")][:MAX_COLOURS]
    name = str(d.get("name") or b.get("title") or "").strip()
    version = (d.get("kit") or {}).get("version") or b.get("version")
    try:
        version = int(version) if version is not None else None
    except (TypeError, ValueError):
        version = None
    st = dataclasses.replace(base, look=look or base.look, palette=palette, banned_imagery=bans, warnings=[],
                             source=f"Brand Clan {name}" + (f" v{version}" if version else ""), name=name, version=version,
                             document_id=str(b.get("document_id") or "") or None)
    st.hash = style_mod.hash_of(st)
    return st, {"from": "brand_clan", "name": name, "version": version, "document_id": st.document_id, "colours": len(palette),
                "imagery": bool(look), "bans": len(bans), "left_out": left}


#: Where a made frame is saved in the document (owner, 2026-11-26: the host stores the bytes as a linked asset when it applies the change).
ASSET_DIR = "frames"
_EXT = {b"\x89PNG": ".png", b"\xff\xd8\xff": ".jpg", b"RIFF": ".webp"}


def asset_name(sha: str, data: bytes | None = None, file: str | None = None) -> str:
    """``frames/<sha256>.<ext>``: the document's asset for a made frame (``human/assets/<name>``), its type from the file it was saved as or
    its bytes. The page draws it at ``/assets/<name>``; a spin-off carries it as a link."""
    ext = Path(file or "").suffix.lower()
    if ext not in (".png", ".jpg", ".jpeg", ".webp"):
        ext = next((e for m, e in _EXT.items() if (data or b"").startswith(m)), ".png")
    return f"{ASSET_DIR}/{sha}{'.jpg' if ext == '.jpeg' else ext}"


_INNER_APOSTROPHE = re.compile(r"(?<=\w)['\u2019](?=\w)")
#: Contractions said in full, so the words stay on the checker's list ("doesnt" is not a word it knows).
_CONTRACTIONS = [(re.compile(r"\b(can)['\u2019]t\b", re.I), r"\1not"), (re.compile(r"\bwon['\u2019]t\b", re.I), "will not"),
                 (re.compile(r"\b(\w+)n['\u2019]t\b", re.I), r"\1 not"), (re.compile(r"\b(\w+)['\u2019]re\b", re.I), r"\1 are"),
                 (re.compile(r"\b(\w+)['\u2019]ll\b", re.I), r"\1 will"), (re.compile(r"\b(\w+)['\u2019]ve\b", re.I), r"\1 have"),
                 (re.compile(r"\b(I)['\u2019]m\b"), r"\1 am")]


def unquoted(shot: dict) -> dict:
    """A planned shot's words with quotation marks taken out before the picture-prompt check (live click-through 2026-11-26: a plan that
    wrote 'the friend's car' or a quoted phrase lost three of four frames). A contraction is said in full (does not); an apostrophe left
    inside a word goes (friends); every other
    quotation mark goes. Only the marks: the checker's other rules (figures, names, brands, banned imagery) still judge
    what is left, and the on-screen line, which never reaches a picture, is untouched."""
    out = dict(shot)
    for k in ("framing", "camera", "action"):
        v = out.get(k)
        if isinstance(v, str):
            for pat, rep in _CONTRACTIONS:
                v = pat.sub(rep, v)
            v = _INNER_APOSTROPHE.sub("", v)
            out[k] = re.sub(r"\s{2,}", " ", "".join(ch for ch in v if ch not in lint.QUOTES)).strip()
    return out


def run_view(doc: dict, routes: list[dict], origin: str | None) -> dict:
    """The routes as the library's run shape (what the safety gate, the frame plan and the material gate read)."""
    brief = {}
    for u in (doc.get("upstream") or {}).values():
        if isinstance(u, dict) and any(k in u for k in ("background", "audience", "smp")):
            brief = u
            break
    fields = [{"key": k, "value": str(brief[k])[:600]} for k in ("background", "objectives", "audience", "insight", "smp", "desired_response", "tone_world_assets") if brief.get(k)]
    terr = [{"id": t["id"], "line": t.get("thought"), "proposition": t.get("thought"), "tension_text": t.get("tension"), "mechanism": t.get("theme") or t.get("sketch"),
             "tier": t.get("tier")} for t in routes]
    return {"status": "proceed", "gate": {"category": None, "market": None}, "assumed_brief": {"fields": fields}, "territories": terr,
            "material": {"origin": origin, "brand": _brand_of(doc)}}


# ---------------------------------------------------------------- the engine of one document


class Frames:
    def __init__(self, doc: dict, store, blobs, *, doc_id: str, llm=None, transport=None, guard_post=None, environ=None, spend=None,
                 sleep=time.sleep, poll_every: float = 4.0, on_line=None, brand=None):
        self.doc, self.store, self.blobs, self.doc_id = doc, store, blobs, str(doc_id)
        self.assets: list[dict] = []                         # the frames this move made or placed, bytes and all, for the host to save (assets_put)
        self.brand = brand                                  # the Brand Clan it holds (host: clan.brand_clan), or None: the built-in look
        self.llm, self.transport, self.guard_post, self.environ = llm, transport, guard_post, environ
        self.sleep, self.poll_every = sleep, poll_every
        self.cap = min(sp.caps()[1], runway.LIFETIME_CAP_USD)
        self.spend = spend or sp.Spend(doc=self.doc_id, store=store.spend_path, images_cap_usd=self.cap, on_line=on_line)
        self.dir = Path(store.dir) / DIR
        self.ledger = vjobs.Ledger(Path(store.dir) / "frames-ledger.jsonl", "territory:" + self.doc_id)

    # -------- files
    def _read(self, name: str, default):
        try:
            return json.loads((self.dir / name).read_text())
        except (OSError, ValueError):
            return default

    def _write(self, name: str, data) -> None:
        self.dir.mkdir(parents=True, exist_ok=True)
        tmp = self.dir / (name + ".tmp")
        tmp.write_text(json.dumps(data, indent=1, ensure_ascii=False))
        tmp.replace(self.dir / name)

    def origin(self) -> dict | None:
        d = self._read("material.json", None)
        return d if isinstance(d, dict) and str(d.get("by") or "").strip() and d.get("origin") in material.ORIGINS else None

    # -------- the person's declaration of what the material is
    def declare(self, origin: str, by: str):
        by = (by or "").strip()
        if origin not in material.ORIGINS:
            raise Refuse("Say whether the material is invented, a demo or the client's.")
        if not by:
            raise Refuse("Say who is declaring it. Only a named person can vouch for what the material is.")
        self._write("material.json", {"origin": origin, "by": by, "at": now()})
        return self.doc, [], "Noted: this material is " + {"invented": "invented", "demo": "a demo", "client": "the client's"}[origin] + ".", {}, []

    # -------- the shared preparation of an ask and a make
    def _prepare(self, ids, retry_flagged=(), retry_unknown=False, retry_refused=False):
        routes, why = eligible(self.doc, ids)
        if why:
            raise Refuse(" ".join(why))
        run = run_view(self.doc, routes, (self.origin() or {}).get("origin"))
        sens = gates.sensitive_state(self.doc)
        safe = safety.check(run, reviewed=sens["done"])
        if (safe["applies"] or sens["required"]) and not sens["done"]:
            raise Refuse("This is a sensitive category. A named person reviews the routes before any picture is made. " + (sens["words"] if sens["required"] else ""))
        mat = material.gate(run)
        if not mat["ok"]:
            raise material_refusal()
        try:
            sty, look = brand_style(self.brand, forbid=[x for x in [mat.get("brand")] if x])
            refs = style_mod.reference_images(sty)
        except style_mod.StyleError as e:
            raise Refuse(f"The look has a problem: {e}") from e
        if dict(sty.models) != dict(runway.TIER_MODEL):
            raise Refuse("The look changes the picture models, which it cannot do. Nothing was sent.")
        banned = list(safe["banned"])
        guard_banned = list(dict.fromkeys([*banned, *sty.banned_imagery]))
        bad = lint.lint_text(style_mod.style_block(sty, banned), banned=[], allow=guard_banned)
        if bad:
            raise Refuse(f"The look's words cannot go to a picture model: {bad}. Nothing was sent.")
        if not runway.cap_ok(self.cap):
            raise Refuse("The picture limit set for this workspace is not a usable number. Nothing was sent.")
        vdir = self.dir / f"v-{sty.hash}"
        manifest = runway.load_manifest(vdir)
        plan = self._read("plan.json", {"prompt_version": plan_mod.PROMPT_VERSION, "territories": {}})
        shots_of, need = {}, []
        for t in routes:
            have = plan["territories"].get(t["id"])
            if have and have.get("route") == route_hash(t) and len(have.get("shots") or []) >= len(SHOTS):
                shots_of[t["id"]] = have["shots"]
            else:
                need.append(t["id"])
        jobs, refused, repair = [], [], []
        for t in routes:
            th = route_hash(t)
            for s0 in shots_of.get(t["id"]) or [{"shot": x, "framing": "[frame plan not made yet: this shot is a placeholder]"} for x in SHOTS]:
                s = unquoted(s0)
                text = " ".join(str(x).rstrip(".") + "." for x in (s.get("framing"), s.get("camera"), s.get("action")) if x)
                row = {"key": runway.job_key(f"{t['id']}-{th}", s["shot"], "quick"), "tid": t["id"], "shot": s["shot"], "kind": "quick"}
                hit = safety.banned_in(text, banned)
                badl = lint.lint_text(text, banned) if t["id"] in shots_of and not hit else None
                why = ("the shot description names banned imagery: " + ", ".join(hit)) if hit else \
                      ("the shot description cannot go to a picture model: " + badl) if badl else None
                if why and (not s0.get("rewritten") or retry_refused):
                    # UAT 2026-11-26: the planner's own words ('one', 'unhurried') were refused and no frame was made. Such a shot is rewritten
                    # once, with the check's reason, before anything is sent; it is on the card as a frame to make (and the rewrite as a call).
                    repair.append({**row, "why": why, "words": {k: str(s0.get(k) or "") for k in ("framing", "camera", "action", "on_screen_line")}})
                    jobs.append({**row, "prompt": style_mod.frame_prompt({"shot": s["shot"], "framing": "[this shot is being rewritten in plain words]"}, sty, banned)})
                elif why:
                    refused.append({**row, "why": why})
                else:
                    jobs.append({**row, "prompt": style_mod.frame_prompt(s, sty, banned)})
        return {"routes": routes, "mat": mat, "sty": sty, "look": look, "refs": refs, "banned": banned, "guard_banned": guard_banned, "vdir": vdir, "manifest": manifest,
                "shots_of": shots_of, "need": need, "jobs": jobs, "refused": refused, "repair": repair, "ids": [t["id"] for t in routes],
                "retry_flagged": list(retry_flagged), "retry_unknown": bool(retry_unknown)}

    def _card(self, P) -> dict:
        m = copy.deepcopy(P["manifest"])
        for k, e in (m.get("frames") or {}).items():       # what a retry will make new, as the card must show it before it is accepted
            if k in P["retry_flagged"] and e.get("file") and (e.get("guard") or {}).get("flagged") and not e.get("approved_by_person"):
                e.update(file=None, task=None, status="RETRY")
            if P["retry_unknown"] and not e.get("task") and e.get("status") in ("CREATING", "UNKNOWN"):
                e.update(status="RETRY")
        spent, sends = vjobs.spent_usd({"jobs": {}}, self.ledger), vjobs.send_count({"jobs": {}}, self.ledger)
        card = runway.cost_card(P["jobs"], m, P["vdir"], None, len(P["refs"]), self.cap, spent, sends,
                                id_parts=["territory-frames-doc", self.doc_id, P["ids"], P["sty"].hash, sorted(P["retry_flagged"]), P["retry_unknown"], P["mat"]["origin"],
                                          bool(P["need"]), [r["key"] for r in P["refused"]], sorted(r["key"] for r in P["repair"])])
        off = {}
        for t in P["routes"]:
            for o in offered(t)[1]:
                off.setdefault(o["touchpoint"], o["why"])
        return {**card, "frames": sum(r["new"] for r in card["rows"]), "routes": len(P["routes"]), "plan_call": bool(P["need"] or P["repair"]),
                "not_offered": [{"touchpoint": k, "why": v} for k, v in off.items()], "refused": [{"key": r["key"], "why": r["why"]} for r in P["refused"]],
                "policy": P["mat"]["policy_label"], "unknown": sum(r.get("unknown", 0) for r in card["rows"]), "look": P["look"],
                "material": {k: (self.origin() or {}).get(k) for k in ("origin", "by")} if self.origin() else None}

    @staticmethod
    def public(card: dict) -> dict:
        """The card as the screen may show it: no price anywhere (the ask in the decision history carries it)."""
        keep = ("id", "frames", "routes", "plan_call", "not_offered", "refused", "policy", "unknown", "over_cap", "reference_images", "material", "look")
        out = {k: card[k] for k in keep if k in card}
        out["rows"] = [{k: r[k] for k in ("kind", "new", "saved", "polling", "gave_up", "unknown")} for r in card["rows"]]
        return out

    # -------- the ask
    def ask(self, ids=None, retry_flagged=(), retry_unknown=False, by: str = "a person", retry_refused=False):
        P = self._prepare(ids, retry_flagged, retry_unknown, retry_refused)
        card = self._card(P)
        if card["over_cap"]:
            raise Refuse("This would pass the limit set for pictures, so it will not run. The limit is set by the team, not in the app.")
        if not card["frames"] and not P["need"]:
            if P["refused"]:
                raise refused_refusal(P["refused"])
            raise Refuse("Nothing new to make: every picture for these routes is already made or is waiting for a person.")
        last = next((e for e in reversed(self.spend.events) if e.get("kind") == "ask" and e.get("what") == "frames"), None)
        if not (last and last.get("card_id") == card["id"]):
            est = card["usd"] + (plan_mod.estimate()["est_usd"] if (P["need"] or P["repair"]) else 0)
            if hasattr(self.guard_post, "estimate"):      # the cloud check: one Claude vision call per frame, under the Claude cap
                est += card["frames"] * self.guard_post.estimate()
            self.spend.ask({"est_usd": round(est, 2), "calls": card["frames"] * (2 if hasattr(self.guard_post, "estimate") else 1) + (1 if P["need"] else 0) + (1 if P["repair"] else 0),
                            "what": "frames", "card_id": card["id"],
                            "frames": card["frames"], "routes": card["routes"]}, by=by)
        return self.doc, [], "Costed: read the card, then say yes.", {"card": self.public(card)}, self.spend.decisions()

    # -------- the paid step
    def make(self, ids, card_id: str, retry_flagged=(), retry_unknown=False, by: str = "a person", retry_refused=False):
        P = self._prepare(ids, retry_flagged, retry_unknown, retry_refused)
        card = self._card(P)
        if not card_id or card_id != card["id"]:
            raise Refuse("That is not the card you were shown: the routes, the pictures made or the limit changed since. Look at the new card and say yes to it.")
        if not any(e.get("kind") == "ask" and e.get("what") == "frames" and e.get("card_id") == card_id for e in self.spend.events):
            raise Refuse("The cost was not put to a person first. Ask, read the card, then say yes.")
        if card["over_cap"]:
            raise Refuse("This would pass the limit set for pictures, so it will not run. The limit is set by the team, not in the app.")
        try:
            key = runway.api_key(self.environ)
        except runway.RunwayError as e:
            raise Refuse("The picture service is not connected in this workspace, so nothing was made.") from e
        try:
            self.spend.admit(sp.PICTURES, card["usd"])
            if P["need"]:
                P = self._make_plan(P, ids, retry_flagged, retry_unknown)
            if P["repair"]:
                P = self._repair_plan(P, ids, retry_flagged, retry_unknown)
        except sp.CapReached as e:
            raise Refuse(str(e)) from e
        manifest, vdir, jobs = P["manifest"], P["vdir"], P["jobs"]
        vdir.mkdir(parents=True, exist_ok=True)
        for k in P["retry_flagged"]:       # a flagged frame is moved aside only now that the card was accepted; its credits stay in its history
            e = (manifest.get("frames") or {}).get(k)
            if e and e.get("file") and (e.get("guard") or {}).get("flagged") and not e.get("approved_by_person"):
                aside = f"{k}.flagged-{e.get('attempts', 1)}.png"
                if (vdir / e["file"]).exists():
                    (vdir / e["file"]).rename(vdir / aside)
                runway.retire(e)
                e["history"][-1]["file"] = aside
                e.update(file=None, task=None, status="RETRY", guard=None)
        if P["retry_unknown"]:
            for k, e in (manifest.get("frames") or {}).items():
                if not e.get("task") and e.get("status") in ("CREATING", "UNKNOWN") and any(j["key"] == k for j in jobs):
                    runway.retire(e)
                    e.update(status="RETRY", retried_unknown=True)
        for r in P["refused"]:
            rows = manifest.setdefault("frames", {})
            old = rows.get(r["key"]) or {}
            if old.get("file") or old.get("task"):
                old["refused_now"] = r["why"]
                continue
            rows[r["key"]] = {"territory": r["tid"], "shot": r["shot"], "tier": r["kind"], "model": runway.MODELS[r["kind"]][0], "status": "REFUSED", "error": r["why"],
                              **({"history": old["history"]} if old.get("history") else {})}
        manifest["style"] = P["sty"].summary()
        manifest["material"] = {"origin": P["mat"]["origin"], "by": P["mat"]["by"], "policy": P["mat"]["policy_label"]}
        runway.save_manifest(vdir, manifest)
        client = runway.Client(key, self.transport)
        res = runway.generate(client, jobs, vdir, manifest, P["refs"], sleep=self.sleep, poll_every=self.poll_every, ledger=self.ledger, cap_usd=self.cap)
        self._guard(P)
        runway.save_manifest(vdir, manifest)
        self._book(P)
        doc, placed, held = self._place(self.doc, P)
        self.spend.outcome("frames", made=res["created"], placed=placed, held=held)
        info = {"assets": list(self.assets), "frames": {"made": res["created"], "placed": placed, "held": held, "still_running": len(res["still_running"]), "unknown": len(res["unknown"]),
                           "stopped": res["stopped"]}}
        return doc, [], self._words(res, placed, held), info, self.spend.decisions()

    @staticmethod
    def _words(res: dict, placed: int, held: int) -> str:
        bits = [f"{placed} picture{'s' if placed != 1 else ''} placed"]
        if held:
            bits.append(f"{held} held for a person to look at")
        if res["still_running"]:
            bits.append(f"{len(res['still_running'])} still being made: ask again to pick them up")
        if res["unknown"]:
            bits.append(f"{len(res['unknown'])} may already be billed and are not made again until a person says so")
        if res["stopped"]:
            bits.append(res["stopped"])
        return "; ".join(bits)[:1].upper() + "; ".join(bits)[1:] + "."

    def _make_plan(self, P, ids, retry_flagged, retry_unknown):
        """ONE model call for every greenlit route that has no current shots (under the Claude cap, recorded, never repeated for a route that has them)."""
        if self.llm is None:
            raise Refuse("No model is connected to plan the pictures, so nothing was made.")
        need = [t for t in P["routes"] if t["id"] in P["need"]]
        run = run_view(self.doc, need, P["mat"]["origin"])
        obj, _usage = self.spend.wrap(self.llm)("frames_plan", prompt("frames_plan"), json.dumps(plan_mod._payload(run, P["banned"]), ensure_ascii=False))
        try:
            shots = plan_mod._clean(obj, [t["id"] for t in need])
        except plan_mod.PlanError as e:
            raise Refuse(f"The picture plan came back incomplete ({e}). Nothing was made.") from e
        plan = self._read("plan.json", {"prompt_version": plan_mod.PROMPT_VERSION, "territories": {}})
        for t in need:
            plan["territories"][t["id"]] = {"route": route_hash(t), "shots": shots[t["id"]]}
        plan["prompt_version"] = plan_mod.PROMPT_VERSION
        self._write("plan.json", plan)
        return self._prepare(ids, retry_flagged, retry_unknown)

    def _repair_plan(self, P, ids, retry_flagged, retry_unknown):
        """ONE model call that rewrites the shots the check refused, each with the check's reason and its rules (under the Claude cap). A shot is
        rewritten once by itself; a person's Try again asks once more. What the check still refuses after it is refused in words, never sent."""
        if self.llm is None:
            raise Refuse("No model is connected to rewrite the refused shots, so nothing was made.")
        payload = {"rules": LINT_RULES, "shots": [{"territory": r["tid"], "shot": r["shot"], **r["words"], "refused_because": r["why"]} for r in P["repair"]]}
        if P["banned"]:
            payload["never_show"] = P["banned"]
        obj, _usage = self.spend.wrap(self.llm)("frames_repair", prompt("frames_repair"), json.dumps(payload, ensure_ascii=False))
        got = {(x.get("territory"), x.get("shot")): x for x in ((obj or {}).get("shots") or []) if isinstance(x, dict)}
        plan = self._read("plan.json", {"prompt_version": plan_mod.PROMPT_VERSION, "territories": {}})
        for r in P["repair"]:
            for s in (plan["territories"].get(r["tid"]) or {}).get("shots") or []:
                if s.get("shot") != r["shot"]:
                    continue
                new = got.get((r["tid"], r["shot"])) or {}
                if str(new.get("framing") or "").strip() or str(new.get("action") or "").strip():
                    s.update({k: str(new.get(k) or "").strip() for k in ("framing", "camera", "action")})
                s["rewritten"], s["refused_before"] = True, r["why"]
        self._write("plan.json", plan)
        return self._prepare(ids, retry_flagged, retry_unknown)

    # -------- the guard: readable text, brands, banned imagery; fail closed
    def _guard(self, P) -> None:
        gp = self.guard_post
        kw = {"post": gp.bind(self.spend) if hasattr(gp, "bind") else gp, "name": getattr(gp, "name", "Ollama")} if gp else {}
        down = None
        for e in (P["manifest"].get("frames") or {}).values():
            g = e.get("guard") or {}
            if not e.get("file") or g.get("checked"):
                continue
            if down:
                e["guard"] = {"checked": False, "flagged": False, "found": {}, "reason": down}
                continue
            g = e["guard"] = guard_mod.check_image((P["vdir"] / e["file"]).read_bytes(), P["guard_banned"], **kw)
            if not g["checked"]:
                down = g["reason"]
                continue
            seen = (g.get("found") or {}).get("readable_text") or []
            if seen:      # LESSONS 21: the exact words. The on-screen line is added later, never painted: any text in the picture is flagged, and both are said
                line = self._line_of(P, e)
                same = bool(line) and _norm(" ".join(seen)) == _norm(line)
                g["words"] = {"seen": seen, "planned": line, "match": same}
                g["reason"] += ("; the words in the picture are the planned line, but it is meant to be added later, not painted" if same else
                                f"; the line meant for the screen is {line!r}, which the picture does not show exactly" if line else "; no words were planned for this shot")

    @staticmethod
    def _line_of(P, e) -> str:
        shots = P["shots_of"].get(e.get("territory")) or []
        return next((s.get("on_screen_line") or "" for s in shots if s.get("shot") == e.get("shot")), "")

    @staticmethod
    def held(e: dict) -> str | None:
        """Why a made frame is not placed, or ``None`` when it may be. A frame nobody could check is held as well (fail closed)."""
        if not e.get("file") or e.get("status") == "REFUSED":
            return e.get("error") or "No picture was made."
        if e.get("approved_by_person"):
            return None
        g = e.get("guard") or {}
        if not g.get("checked"):
            return "Nobody could check this picture for text or brands, so a person looks first. " + str(g.get("reason") or "")
        return g["reason"] if g.get("flagged") else None

    # -------- the history: the provider's spend, a line per attempt, once each
    def _book(self, P) -> None:
        for k, e in (P["manifest"].get("frames") or {}).items():
            for i, att in enumerate([*(e.get("history") or []), e]):
                if not (att.get("task") or att.get("status") in ("UNKNOWN", "CREATING", "SUCCEEDED")):
                    continue
                credits = max([c for c in (att.get("cost_credits"), att.get("estimated_credits"), att.get("credits") or e.get("credits")) if isinstance(c, (int, float))] or [0])
                self.spend.record_external(sp.PICTURES, "frame", f"{k}:{att.get('task') or 'unknown' + str(i)}", credits * runway.USD_PER_CREDIT, "runway")

    # -------- placing
    def _place(self, doc: dict, P) -> tuple[dict, int, int]:
        """Put every made frame on the blob store, and each unheld one in an open place of its route that can hold it, once each (one hash, one place)."""
        d = copy.deepcopy(doc)
        by = {t["id"]: t for t in d.get("territories") or []}
        used = {s.get("sha256") for t in by.values() for s in t.get("pictures") or [] if s.get("kind") == "frame"}
        placed = held = 0
        for tid, th in ((t["id"], route_hash(t)) for t in P["routes"]):
            t = by.get(tid)
            if t is None:
                continue
            mine = sorted(((e["shot"], k, e) for k, e in (P["manifest"].get("frames") or {}).items() if re.match(rf"^{re.escape(tid)}-{th}-f\d-", k)), key=lambda x: x[0])
            fits = offered(t)[0]
            open_slots = [s for s in fits if s.get("kind") != "frame"]
            for _shot, _k, e in mine:
                if not e.get("file") or not (P["vdir"] / e["file"]).exists():
                    continue
                data = (P["vdir"] / e["file"]).read_bytes()
                sha = pictures.hash_of(data)
                self.blobs.put(sha, data)
                name = asset_name(sha, data, e["file"])
                if name not in {a["name"] for a in self.assets}:   # the bytes go back with the change; the host saves them as the document's asset
                    self.assets.append({"name": name, "sha256": sha, "data": data})
                if self.held(e):
                    held += 1
                    continue
                if sha in used or not open_slots:
                    continue
                own = place_of(fits, e.get("shot"))      # the place this frame was made for; the first open one only when that is taken
                slot = next((s for s in open_slots if s["id"] == own), open_slots[0])
                open_slots.remove(slot)
                pictures.attach(t, slot["id"], {"sha256": sha, "rights": "generated", "source": SOURCE})
                used.add(sha)
                placed += 1
        return d, placed, held

    # -------- a person's say on a held frame
    def approve(self, keys, by: str):
        by = (by or "").strip()
        if not by:
            raise Refuse("Say who is accepting the pictures. Only a named person can.")
        keys = list(dict.fromkeys(keys or []))
        if not keys:
            raise Refuse("Say which pictures.")
        P = self._prepare(None)
        frames = P["manifest"].get("frames") or {}
        if any(not (frames.get(k) or {}).get("file") for k in keys):
            raise Refuse("There is no such picture to accept.")
        for k in keys:
            frames[k].update(approved_by_person=True, approved_by=by, approved_at=now())
        runway.save_manifest(P["vdir"], P["manifest"])
        doc, placed, _held = self._place(self.doc, P)
        return doc, [], f"{len(keys)} accepted by {by}; {placed} placed.", {"assets": list(self.assets)}, []

    def leave(self, keys, by: str):
        """A named person leaves held frames out: each is never placed, is gone from the status, and its place stays a sketch. It is moved aside as a
        retry is (its credits stay in its history), so a later ask counts it as new and a new Make may fill the place again."""
        by = (by or "").strip()
        if not by:
            raise Refuse("Say who is leaving the pictures out. Only a named person can.")
        keys = list(dict.fromkeys(keys or []))
        if not keys:
            raise Refuse("Say which pictures.")
        P = self._prepare(None)
        frames = P["manifest"].get("frames") or {}
        if any(not (frames.get(k) or {}).get("file") or not self.held(frames[k]) for k in keys):
            raise Refuse("Only a picture that is waiting for a person can be left out.")
        for k in keys:
            e = frames[k]
            aside = f"{k}.left-{e.get('attempts', 1)}.png"
            if (P["vdir"] / e["file"]).exists():
                (P["vdir"] / e["file"]).rename(P["vdir"] / aside)
            runway.retire(e)
            if e.get("history"):
                e["history"][-1]["file"] = aside
            e.update(file=None, task=None, status="RETRY", guard=None, sha256=None, left_out_by=by, left_out_at=now())
        runway.save_manifest(P["vdir"], P["manifest"])
        self.spend.outcome("frames_left_out", left_out=len(keys), by=by, keys=keys)
        return self.doc, [], f"{len(keys)} left out by {by}.", {}, self.spend.decisions()

    # -------- reading
    def status(self):
        try:
            P = self._prepare(None)
        except Refuse as e:
            return self.doc, [], str(e), {"frames": {"refused": str(e)}}, []
        out = []
        by_id = {t["id"]: t for t in self.doc.get("territories") or []}
        for k, e in sorted((P["manifest"].get("frames") or {}).items()):
            if e.get("left_out_by") and not e.get("file"):
                continue                      # a person left it out: not waiting, not placed
            why = self.held(e)
            t = by_id.get(e.get("territory"))
            out.append({"key": k, "route": e.get("territory"), "shot": e.get("shot"), "place": place_of(offered(t)[0], e.get("shot")) if t else None,
                        "status": e.get("status"), "sha256": e.get("sha256"), "held": bool(why), "why": why,
                        "asset": asset_name(e["sha256"], None, e.get("file")) if e.get("sha256") else None,
                        "approved_by": e.get("approved_by")})
        return self.doc, [], "", {"frames": {"frames": out, "card": self.public(self._card(P))}}, []
