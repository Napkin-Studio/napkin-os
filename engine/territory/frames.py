"""Frames for the greenlit routes of a Territories document (feature territories-pictures-frames).

``engine/territory/visuals`` makes frames from a saved run FILE (the CLI). In the middleware the document is the run, so this module drives the
SAME reviewed library (``engine/visuals``: the Runway client and its double-pay rules, the picture-prompt lint, the Confidential deny-list, the
client-to-Runway policy, the style pack, the safe-messaging gate, the guard) from a document, for the routes a person greenlit and no others.

    f = Frames(doc, store, blobs, doc_id=..., marks=[...], llm=..., transport=..., guard_post=...)
    f.ask(ids)                 the cost card: how many pictures, which places are not offered and why; the ask goes into the history
    f.make(ids, card_id)       the paid step: the frame plan (once), the pictures, the guard, the placing
    f.approve(keys, by)        a named person accepts frames the guard held back; they are placed
    f.declare(origin, by)      a named person says what the material is (invented, demo or client); client material is refused by default
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
import hashlib
import json
import os
import re
import time
import unicodedata
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
    """A move the engine will not make, in words a person can read. Nothing was sent."""


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


def client_of(doc: dict) -> str | None:
    """The client the document is for: the Brief's ``client`` field carried in ``upstream``, else the brand the title names. Never the agency."""
    for u in (doc.get("upstream") or {}).values():
        if isinstance(u, dict) and isinstance(u.get("client"), str) and u["client"].strip():
            return u["client"].strip()
    return _brand_of(doc)


def client_slug(client: str | None) -> str:
    return re.sub(r"[^a-z0-9]+", "-", unicodedata.normalize("NFKD", client or "").encode("ascii", "ignore").decode().lower()).strip("-")[:60]


def style_folder(frames_dir: Path, client: str | None) -> Path | None:
    """The style pack of THIS client at ``<frames>/style/<client-slug>/``, or ``None`` (the built-in default). Each client has its own style; there is
    no agency-wide one. A stand-in until Brand Clan holds the client's style (decision, features/territories-pictures-frames.clan)."""
    slug = client_slug(client)
    folder = Path(frames_dir) / "style" / slug if slug else None
    return folder if folder is not None and folder.is_dir() else None


def run_view(doc: dict, routes: list[dict], marks: list, origin: str) -> dict:
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
            "material": {"origin": origin, "marks": list(marks), "brand": _brand_of(doc)}}


# ---------------------------------------------------------------- the engine of one document


class Frames:
    def __init__(self, doc: dict, store, blobs, *, doc_id: str, marks=None, llm=None, transport=None, guard_post=None, environ=None, spend=None,
                 sleep=time.sleep, poll_every: float = 4.0, on_line=None):
        self.doc, self.store, self.blobs, self.doc_id = doc, store, blobs, str(doc_id)
        self.marks = marks                                  # None: the document was not checked for Confidential marks, and nothing is drawn
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
    def _prepare(self, ids, retry_flagged=(), retry_unknown=False):
        if self.marks is None:
            raise Refuse("This document was not checked for parts marked Confidential, so nothing is drawn.")
        routes, why = eligible(self.doc, ids)
        if why:
            raise Refuse(" ".join(why))
        run = run_view(self.doc, routes, self.marks, (self.origin() or {}).get("origin") or "client")
        sens = gates.sensitive_state(self.doc)
        safe = safety.check(run, reviewed=sens["done"])
        if (safe["applies"] or sens["required"]) and not sens["done"]:
            raise Refuse("This is a sensitive category. A named person reviews the routes before any picture is made. " + (sens["words"] if sens["required"] else ""))
        mat = material.gate(run, None, environ=self.environ)
        if not mat["ok"]:
            raise Refuse("Pictures are not made for this document: " + mat["why"] + " A named person can say the material is invented or a demo.")
        folder = style_folder(self.dir, client_of(self.doc))
        try:
            sty = style_mod.load(folder, forbid=[x for x in [mat.get("brand")] if x])
            refs = style_mod.reference_images(sty)
        except style_mod.StyleError as e:
            raise Refuse(f"The style pack has a problem: {e}") from e
        if dict(sty.models) != dict(runway.TIER_MODEL):
            raise Refuse("The style pack changes the picture models, which a pack cannot do. Nothing was sent.")
        banned = list(safe["banned"])
        guard_banned = list(dict.fromkeys([*banned, *sty.banned_imagery]))
        bad = lint.lint_text(style_mod.style_block(sty, banned), banned=[], allow=guard_banned)
        if bad:
            raise Refuse(f"The style pack's words cannot go to a picture model: {bad}. A person fixes the pack; nothing was sent.")
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
        deny = lint.deny_list(mat["marks"] or [])
        jobs, refused = [], []
        for t in routes:
            th = route_hash(t)
            for s in shots_of.get(t["id"]) or [{"shot": x, "framing": "[frame plan not made yet: this shot is a placeholder]"} for x in SHOTS]:
                text = " ".join(str(x).rstrip(".") + "." for x in (s.get("framing"), s.get("camera"), s.get("action")) if x)
                row = {"key": runway.job_key(f"{t['id']}-{th}", s["shot"], "quick"), "tid": t["id"], "shot": s["shot"], "kind": "quick"}
                hit = safety.banned_in(text, banned)
                badl = lint.lint_text(text, banned, deny) if t["id"] in shots_of and not hit else None
                if hit:
                    refused.append({**row, "why": "the shot description names banned imagery: " + ", ".join(hit)})
                elif badl:
                    refused.append({**row, "why": "the shot description cannot go to a picture model: " + badl})
                else:
                    jobs.append({**row, "prompt": style_mod.frame_prompt(s, sty, banned)})
        return {"routes": routes, "mat": mat, "sty": sty, "refs": refs, "banned": banned, "guard_banned": guard_banned, "vdir": vdir, "manifest": manifest,
                "shots_of": shots_of, "need": need, "jobs": jobs, "refused": refused, "ids": [t["id"] for t in routes],
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
                                id_parts=["territory-frames-doc", self.doc_id, P["ids"], P["sty"].hash, sorted(P["retry_flagged"]), P["retry_unknown"], P["mat"]["policy"],
                                          bool(P["need"]), [r["key"] for r in P["refused"]]])
        off = {}
        for t in P["routes"]:
            for o in offered(t)[1]:
                off.setdefault(o["touchpoint"], o["why"])
        return {**card, "frames": sum(r["new"] for r in card["rows"]), "routes": len(P["routes"]), "plan_call": bool(P["need"]),
                "not_offered": [{"touchpoint": k, "why": v} for k, v in off.items()], "refused": [{"key": r["key"], "why": r["why"]} for r in P["refused"]],
                "policy": P["mat"]["policy_label"], "unknown": sum(r.get("unknown", 0) for r in card["rows"])}

    @staticmethod
    def public(card: dict) -> dict:
        """The card as the screen may show it: no price anywhere (the ask in the decision history carries it)."""
        keep = ("id", "frames", "routes", "plan_call", "not_offered", "refused", "policy", "unknown", "over_cap", "reference_images")
        out = {k: card[k] for k in keep if k in card}
        out["rows"] = [{k: r[k] for k in ("kind", "new", "saved", "polling", "gave_up", "unknown")} for r in card["rows"]]
        return out

    # -------- the ask
    def ask(self, ids=None, retry_flagged=(), retry_unknown=False, by: str = "a person"):
        P = self._prepare(ids, retry_flagged, retry_unknown)
        card = self._card(P)
        if card["over_cap"]:
            raise Refuse("This would pass the limit set for pictures, so it will not run. The limit is set by the team, not in the app.")
        if not card["frames"] and not P["need"]:
            raise Refuse("Nothing new to make: every picture for these routes is already made or is waiting for a person.")
        last = next((e for e in reversed(self.spend.events) if e.get("kind") == "ask" and e.get("what") == "frames"), None)
        if not (last and last.get("card_id") == card["id"]):
            est = card["usd"] + (plan_mod.estimate()["est_usd"] if P["need"] else 0)
            if hasattr(self.guard_post, "estimate"):      # the cloud check: one Claude vision call per frame, under the Claude cap
                est += card["frames"] * self.guard_post.estimate()
            self.spend.ask({"est_usd": round(est, 2), "calls": card["frames"] * (2 if hasattr(self.guard_post, "estimate") else 1) + (1 if P["need"] else 0), "what": "frames", "card_id": card["id"],
                            "frames": card["frames"], "routes": card["routes"]}, by=by)
        return self.doc, [], "Costed: read the card, then say yes.", {"card": self.public(card)}, self.spend.decisions()

    # -------- the paid step
    def make(self, ids, card_id: str, retry_flagged=(), retry_unknown=False, by: str = "a person"):
        P = self._prepare(ids, retry_flagged, retry_unknown)
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
        manifest["material"] = {"origin": (self.origin() or {}).get("origin") or "client", "policy": P["mat"]["policy"], "confidential_parts": len(P["mat"]["marks"] or [])}
        runway.save_manifest(vdir, manifest)
        client = runway.Client(key, self.transport)
        res = runway.generate(client, jobs, vdir, manifest, P["refs"], sleep=self.sleep, poll_every=self.poll_every, ledger=self.ledger, cap_usd=self.cap)
        self._guard(P)
        runway.save_manifest(vdir, manifest)
        self._book(P)
        doc, placed, held = self._place(self.doc, P)
        self.spend.outcome("frames", made=res["created"], placed=placed, held=held)
        info = {"frames": {"made": res["created"], "placed": placed, "held": held, "still_running": len(res["still_running"]), "unknown": len(res["unknown"]),
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
        run = run_view(self.doc, need, P["mat"]["marks"] or [], "client")
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
            open_slots = [s for s in offered(t)[0] if s.get("kind") != "frame"]
            for _shot, _k, e in mine:
                if not e.get("file") or not (P["vdir"] / e["file"]).exists():
                    continue
                data = (P["vdir"] / e["file"]).read_bytes()
                sha = pictures.hash_of(data)
                self.blobs.put(sha, data)
                if self.held(e):
                    held += 1
                    continue
                if sha in used or not open_slots:
                    continue
                pictures.attach(t, open_slots.pop(0)["id"], {"sha256": sha, "rights": "generated", "source": SOURCE})
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
        return doc, [], f"{len(keys)} accepted by {by}; {placed} placed.", {}, []

    # -------- reading
    def status(self):
        try:
            P = self._prepare(None)
        except Refuse as e:
            return self.doc, [], str(e), {"frames": {"refused": str(e)}}, []
        out = []
        for k, e in sorted((P["manifest"].get("frames") or {}).items()):
            why = self.held(e)
            out.append({"key": k, "route": e.get("territory"), "shot": e.get("shot"), "status": e.get("status"), "sha256": e.get("sha256"), "held": bool(why), "why": why,
                        "approved_by": e.get("approved_by")})
        return self.doc, [], "", {"frames": {"frames": out, "card": self.public(self._card(P))}}, []
