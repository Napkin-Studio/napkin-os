"""Carry a Territory run and its frames into a Deck Maker stages folder (deck-frames-in). No model, no network, no spend.

    python3 -m deck.from_territory RUN.json --frames <run>.frames/v<N>-<hash>/manifest.json --stages DIR \
        [--plan PLAN.json] [--brief brief_object.json] [--chosen TID] [--style-pack DIR] [--replace]

Writes into ``--stages``: ``c_territories.json`` (stage c in the deck's own names), ``frames.json`` (one chosen frame per shot, with
its record) and ``assets/<sha256>.<ext>`` (each picture once). ``run_deck`` reads ``frames.json`` only when given ``--pictures``.

The manifest must belong to the run: its ``inputs.run_sha256_12`` and ``inputs.plan_sha256_12`` are checked against RUN.json and its
frame plan, and another run's manifest is refused. A shot is given the frame territory's ``board.frames_for`` would pick: a clean
frame beats a flagged or refused one, then the best model beats the quick one. The Territory tool's own ``approved_by_person`` is
kept as ``territory_accepted`` and changes nothing: only the deck's approver approves a picture for the deck.

The Territory files are read as a file contract (the keys named below), not imported: a test builds entries with the territory
module's own ``job_key`` and ``_entry`` and fails when either moves. This module imports no provider code.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import re
import shutil
import sys
from pathlib import Path

from . import images, inputs

SHOTS = images.SHOTS
ASSUMED_RISK = "Rests on an assumed brief: to confirm"
ENTRY_KEYS = ("territory", "shot", "tier", "model")


class FromTerritoryError(ValueError):
    """The run, manifest or folder cannot be used; the message says why and what to do."""


def sha12(path: Path) -> str:
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()[:12]


def _norm(v) -> str:
    return re.sub(r"\s+", " ", v if isinstance(v, str) else json.dumps(v, sort_keys=True, ensure_ascii=False)).strip().lower()


def check_brief(run: dict, brief_fields: dict | None) -> str:
    """``same_brief``: ``verified`` when every field the run was GIVEN equals the brief's, ``unverified`` when no brief was passed.
    Refuses (raises) when a given field differs or the brief lacks it: the run was made from another brief."""
    if brief_fields is None:
        return "unverified"
    for f in (run.get("assumed_brief") or {}).get("fields") or []:
        if f.get("tag") != "given":
            continue
        have = (brief_fields.get(f.get("key")) or {}).get("value")
        if have in (None, "") or _norm(have) != _norm(f.get("value")):
            raise FromTerritoryError(f"the brief's {f.get('key')!r} is not what the run was given: this run was made from another brief")
    return "verified"


def pick_frames(manifest: dict) -> dict:
    """territory id -> shot -> (key, entry): one entry per shot. Order does not matter: the rank is (flagged or refused, quick), lowest wins."""
    best: dict = {}
    for key, e in (manifest.get("frames") or {}).items():
        if any(k not in e for k in ENTRY_KEYS):
            raise FromTerritoryError(f"manifest entry {key} lacks {[k for k in ENTRY_KEYS if k not in e]}: not a Territory frames manifest")
        refused = e.get("status") == "REFUSED"
        if not refused and not e.get("file"):
            continue   # asked for and not made yet
        bad = refused or bool((e.get("guard") or {}).get("flagged"))
        rank = (bad, e.get("tier") != "best", key)
        cur = best.setdefault(e["territory"], {})
        if e["shot"] not in cur or rank < cur[e["shot"]][0]:
            cur[e["shot"]] = (rank, key, e)
    return {t: {s: (k, e) for s, (r, k, e) in shots.items()} for t, shots in best.items()}


def stage_c(run: dict, chosen: str | None = None) -> dict:
    """The run's territories in stage c's names: name (line), thought (proposition), why (tension_text), sketch (line), with the
    run's own words kept beside them. ``mood`` and ``risks`` are left out (nothing in the run says them) except the fixed label on
    an assumption-dependent territory. The ranking reasons are the tier and its reason. ``chosen`` only when given."""
    terr, reasons = [], {}
    for t in run["territories"]:
        row = {"id": t["id"], "name": t.get("line"), "thought": t.get("proposition") or t.get("line"), "why": t.get("tension_text") or "",
               "sketch": t.get("line"), "proposition": t.get("proposition"), "tension_text": t.get("tension_text"),
               "mechanism": t.get("mechanism"), "tier": t.get("tier")}
        if t.get("assumption_dependent"):
            row["risks"] = ASSUMED_RISK
        terr.append({k: v for k, v in row.items() if v is not None})
        reasons[t["id"]] = f"{t.get('tier')}: {t.get('tier_reason')}" if t.get("tier_reason") else str(t.get("tier"))
    order = [t["id"] for t in sorted(run["territories"], key=lambda t: -((t.get("score") or {}).get("total") or 0))]
    c = {"stage": "c", "produced_by": "deck.from_territory (a Territory run, no model call)", "territories": terr,
         "ranking": {"order": order, "reasons": reasons, "by": "the Territory run's score and tier (advisory, not a decision)"}}
    if chosen:
        if chosen not in {t["id"] for t in terr}:
            raise FromTerritoryError(f"--chosen {chosen}: the run has no such territory ({', '.join(t['id'] for t in terr)})")
        c.update(chosen=chosen, chosen_by="--chosen on from_territory")
    return c


# ── a carried Territories document (territories-spinoff-out-deck) ─────────────────────────────────────────────────────────────
#
# A Deck spun off from a Territories document holds it whole, frozen, at ``data.upstream.<id>`` (the host sends it to the middleware beside
# the index as ``clan.territories_upstream {id, data}``, which sends it to the engine). ``stage_c_from_document`` is the one reader: the
# routes the person sent become stage c (gate 2's territories, the first by judge rank pre-picked) and the route the person picks is the
# territory stage d writes from, with the route's own words beside it. No model is called for stage c. The older ``stage_c`` above reads a run
# FILE (the CLI hand-off); both write the deck's own names and a test holds them to the same shape.

#: text a person must never see on a slide (LESSONS 15): the Territories engine refuses it, and the deck does not draw it if one slips through
LEAK = re.compile(r"\(to confirm\)|\bTBC\b|\*\*|~~|\{\{|\}\}|^#\s|field is null|^(none|null|undefined)$", re.I)
STATED_RIGHTS = {"generated": "Generated", "own": "Own", "licensed": "Licensed"}
RIGHTS_TO_SUPPLY = "Rights to supply"
MAX_ROUTES = 5          # gate 2 shows the routes sent, up to this many (the deck's slides hold five territories)
MAX_WORDS = 6           # a route's own lines carried to the deck


def _clean(v) -> str:
    s = re.sub(r"\s+", " ", v).strip() if isinstance(v, str) else ""
    return "" if not s or LEAK.search(s) else s


is_territories = inputs.is_territories   # the one test of "this upstream entry is a Territories document" (inputs.py)


def carried(data: dict) -> tuple | None:
    """``(source document id, data)`` of the first Territories document a Deck's ``data.upstream`` holds, or None."""
    for k, v in ((data or {}).get("upstream") or {}).items():
        if is_territories(v):
            return str(k), v
    return None


def sent_ids(doc: dict) -> tuple[list, list, str]:
    """``(ids, not_chosen, by)``: the routes the person sent to Deck Maker, in the order they were sent. The newest send to ``deck-maker``
    that is ``sent`` or ``asked`` decides; with none (the document was continued in without sending) the greenlit routes are what goes."""
    sends = [s for s in doc.get("sends") or [] if isinstance(s, dict) and s.get("to") == "deck-maker" and s.get("status") in ("sent", "asked")]
    if sends:
        s = sends[-1]
        return [i for i in s.get("territory_ids") or [] if isinstance(i, str)], [i for i in s.get("not_chosen") or [] if isinstance(i, str)], str(s.get("by") or "")
    g = [x for x in doc.get("greenlit") or [] if isinstance(x, dict)]
    return [x["territory_id"] for x in g if isinstance(x.get("territory_id"), str)], [], str(next((x.get("by") for x in g if x.get("by")), "") or "")


def picture_notes(t: dict) -> dict:
    """What a route's pictures are, in words, never a finished picture that is not one. Sketches are counted as mock-ups (palette drawings, no rights
    needed, never shown as a finished picture). A frame by link carries its STATED rights (generated, own, licensed); unknown or none stated reads
    'Rights to supply'. A gap says why. The bytes are not carried: a frame is a link (``sha256``) until the deck can read it, so none is drawn from
    here. ``line`` is the one sentence a slide may say."""
    mock, frames, gaps = 0, [], []
    for p in t.get("pictures") or []:
        if not isinstance(p, dict):
            continue
        if p.get("kind") == "frame":
            frames.append({k: v for k, v in {"id": p.get("id"), "touchpoint": p.get("touchpoint"), "sha256": p.get("sha256"),
                                             "rights": STATED_RIGHTS.get(p.get("rights"), RIGHTS_TO_SUPPLY), "final": bool(p.get("final"))}.items() if v is not None})
        elif p.get("kind") == "gap":
            gaps.append({"touchpoint": p.get("touchpoint"), "gap": _clean(p.get("gap_reason")) or "No picture yet."})
        else:
            mock += 1
    bits = []
    if mock:
        bits.append(f"{mock} mock-up sketch{'es' if mock != 1 else ''}, not finished pictures")
    if frames:
        rights = sorted({f["rights"] for f in frames})
        bits.append(f"{len(frames)} picture{'s' if len(frames) != 1 else ''} by link (rights: {', '.join(rights)})")
    if gaps:
        bits.append(f"{len(gaps)} with no picture yet")
    return {k: v for k, v in {"mock_ups": mock or None, "frames": frames or None, "gaps": gaps or None, "line": "; ".join(bits) or None}.items() if v}


def route_words(t: dict) -> list:
    """A route's own lines for the deck: the person's lead line first, then the four headlines and the world's lines; no leaks, no repeats."""
    w = t.get("world") if isinstance(t.get("world"), dict) else {}
    lead = w.get("lead") if isinstance(w.get("lead"), str) else None
    raw = [lead, *[x for x in (w.get("headlines") or {}).values() if isinstance(x, str)], *[x for x in w.get("lines") or [] if isinstance(x, str)]]
    out = []
    for x in raw:
        x = _clean(x)
        if x and x not in out:
            out.append(x)
    return out[:MAX_WORDS]


def route_row(t: dict) -> dict:
    """One route in stage c's names, with what travelled with it kept beside them (the Deck's slides and stage d read it)."""
    risks = "; ".join(r for r in (_clean(x) for x in t.get("risks") or []) if r)
    checks = [c for c in t.get("checks") or [] if isinstance(c, dict)]
    row = {"id": t["id"], "name": _clean(t.get("name")) or t["id"], "thought": _clean(t.get("thought")) or _clean(t.get("sketch")) or _clean(t.get("name")),
           "why": _clean(t.get("why")) or _clean(t.get("tension")), "mood": _clean(t.get("mood")), "risks": risks,
           "sketch": _clean(t.get("sketch")) or _clean(t.get("thought")), "tier": t.get("tier"), "band": t.get("band"), "rank": t.get("rank"),
           "their_words": route_words(t),
           "checked": [_clean(c.get("text")) for c in checks if c.get("status") == "ok" and _clean(c.get("text"))][:4],
           "to_check": [_clean(c.get("text")) for c in checks if c.get("status") in ("warn", "fail", "unchecked") and _clean(c.get("text"))][:3],
           "evidence": [e for e in t.get("evidence") or [] if isinstance(e, str)][:8], "pictures": picture_notes(t),
           "from_territories": True}
    return {k: v for k, v in row.items() if v not in (None, "", [])}


def stage_c_from_document(doc_id: str, doc: dict) -> dict:
    """Stage c from a carried Territories document: the routes sent (up to ``MAX_ROUTES``), ordered by the blind judge's rank (unranked last, then in
    the order they were sent), the first one chosen by default and flagged for Gate 2. ``from_territories`` says where they came from, how many
    and who sent them, for the slides ("N routes from Territories"). Refuses a document that sent no route the document still holds live."""
    ids, not_chosen, by = sent_ids(doc)
    by_id = {t.get("id"): t for t in doc.get("territories") or [] if isinstance(t, dict)}
    live = [i for i in dict.fromkeys(ids) if i in by_id and by_id[i].get("status") != "killed"]
    if not live:
        raise FromTerritoryError("the Territories document carried no greenlit route to use: nothing was sent from it")
    order = sorted(live, key=lambda i: (by_id[i].get("rank") if isinstance(by_id[i].get("rank"), (int, float)) else 1e9, live.index(i)))[:MAX_ROUTES]
    terr = [route_row(by_id[i]) for i in order]
    reasons = {}
    for i in order:
        t = by_id[i]
        reasons[i] = (f"Territories judge rank {t['rank']}" if isinstance(t.get("rank"), int) else "Greenlit in Territories") + (f"; {t['tier']}" if t.get("tier") else "")
    return {"stage": "c", "produced_by": "deck.from_territory (a carried Territories document, no model call)", "territories": terr,
            "ranking": {"order": order, "reasons": reasons, "by": "the Territories blind judge's rank (advisory, not a decision)"},
            "chosen": order[0], "chosen_by": "default: the Territories judge's first choice among the routes sent, flagged for Gate 2",
            "from_territories": {k: v for k, v in {"document": doc_id, "count": len(terr), "greenlit_by": by or None, "not_chosen": len(not_chosen),
                                                   "held_back": len(live) - len(order), "names": [r["name"] for r in terr]}.items() if v is not None}}


def from_run(run: dict, manifest: dict, plan: dict, run_hash: str, plan_hash: str, vdir: Path, run_name: str, version: str,
             brief_fields: dict | None = None, chosen: str | None = None, hold: dict | None = None) -> tuple:
    """``(c_stage, frames)``. Pure but for reading the pictures in ``vdir`` (their size and sha256)."""
    if run.get("status") != "proceed":
        raise FromTerritoryError(f"the run's status is {run.get('status')!r}, not 'proceed': it has no territories to use")
    inp = manifest.get("inputs") or {}
    if not isinstance(manifest.get("frames"), dict) or not inp.get("run_sha256_12") or not inp.get("plan_sha256_12"):
        raise FromTerritoryError("the manifest has no frames and inputs.run_sha256_12 and inputs.plan_sha256_12: it is not a Territory frames manifest")
    if inp["run_sha256_12"] != run_hash:
        raise FromTerritoryError(f"the manifest was made for another run (its run_sha256_12 is {inp['run_sha256_12']}, this run's is {run_hash}): refused")
    if inp["plan_sha256_12"] != plan_hash or plan.get("run_sha256_12") != run_hash:
        raise FromTerritoryError("the manifest or the frame plan belongs to another run or plan (plan_sha256_12 or the plan's run hash differs): refused")
    same = check_brief(run, brief_fields)
    c = stage_c(run, chosen)
    ids = {t["id"] for t in run["territories"]}
    planned = {tid: {s["shot"]: s for s in shots} for tid, shots in (plan.get("territories") or {}).items()}
    out = {}
    for tid, shots in pick_frames(manifest).items():
        if tid not in ids:
            continue
        for shot, (key, e) in shots.items():
            p = planned.get(tid, {}).get(shot, {})
            subject = ", ".join(x for x in (p.get("framing"), p.get("action")) if x)
            rec = {"territory": tid, "shot": shot, "tier": e["tier"], "model": e["model"], "prompt": e.get("prompt", ""), "subject": subject,
                   "guard": {k: (e.get("guard") or {}).get(k) for k in ("checked", "flagged", "found", "reason") if k in (e.get("guard") or {})},
                   "territory_accepted": bool(e.get("approved_by_person"))}
            if e.get("prompt_sha256"):
                rec["prompt_sha256"] = e["prompt_sha256"]
            if e.get("status") == "REFUSED":
                rec.update(status="refused", reason=str(e.get("error") or "refused"))
            else:
                f = Path(vdir) / e["file"]
                info = images.inspect_file(f)
                if e.get("sha256") and e["sha256"] != info["sha256"]:
                    raise FromTerritoryError(f"{e['file']} is not the picture the manifest recorded (its sha256 differs): refused")
                rec.update(file=f"assets/{info['sha256']}.{info['ext']}", sha256=info["sha256"], mime=info["mime"], width=info["width"],
                           height=info["height"], source=str(f.name))
                if rec["guard"].get("flagged"):
                    rec.update(status="flagged", reason=str((e.get("guard") or {}).get("reason") or "flagged by the guard"))
                else:
                    rec["status"] = "made"
            out[key] = rec
    m_style = manifest.get("style") or {}
    n = re.match(r"v(\d+)", version)
    style = {k: v for k, v in {"pack": m_style.get("source"), "document_id": m_style.get("document_id"),
                               "version": int(n.group(1)) if n else None, "hash": m_style.get("hash")}.items() if v not in (None, "")}
    frames = {"stage": "frames", "produced_by": "deck.from_territory (a Territory run, no model call)",
              "run": {"file": run_name, "sha256_12": run_hash, "same_brief": same}, "version": version, "style": style,
              "safe_messaging": manifest.get("safe_messaging") or {}, "frames": out}
    frames["territories_sha256_12"] = images.territories_sha(c["territories"])   # run_deck refuses frames whose territories are not stage c's
    if manifest.get("fixture"):
        frames["fixture"] = True
    if hold:
        frames["style_hold"] = hold
    return c, frames


def try_style_pack(folder: Path | None) -> dict | None:
    """Catch a Style Pack that cannot be read. Returns ``{"reason": ...}`` for the hold flag, or None. The pack is never hashed or
    restamped here (deck-look-kits owns that): this only learns whether it loads."""
    if not folder:
        return None
    try:
        from visuals import style as mod   # the one Style Pack reader (engine/visuals)
        mod.load(Path(folder))
    except Exception as e:   # StyleError, or anything a bad pack raises: the build goes on and says so
        if type(e).__name__ == "StyleError" or isinstance(e, (ValueError, OSError)):
            return {"reason": f"the Style Pack could not be read: {e}"[:300]}
        raise
    return None


def write(c: dict, frames: dict, vdir: Path, stages: Path, replace: bool = False) -> None:
    """Write the stage files and copy each picture once (by sha256). Refuses to overwrite a recorded stage c, and says so when a stage d
    was written against other territories."""
    stages = Path(stages)
    cp, dp = stages / "c_territories.json", stages / "d_idea.json"
    notes = []
    if cp.exists() and not replace:
        raise FromTerritoryError(f"{cp} exists: pass --replace to overwrite the recorded territories")
    if dp.exists() and not replace:
        raise FromTerritoryError(f"{dp} exists: the idea was written from other territories. Pass --replace if you mean to use these ones")
    if dp.exists():   # --replace only gets here: an idea written against the old territories no longer matches them
        gone = dp.with_name("d_idea.replaced.json")
        dp.replace(gone)
        notes.append(f"moved {dp.name} to {gone.name}: the idea was written from other territories, so write it again (or restore it if the territories are the same)")
    (stages / "assets").mkdir(parents=True, exist_ok=True)
    for rec in frames["frames"].values():
        if rec.get("file"):
            dst = stages / rec["file"]
            if not dst.exists():
                shutil.copyfile(Path(vdir) / rec["source"], dst)
    for rec in frames["frames"].values():
        rec.pop("source", None)
    cp.write_text(json.dumps(c, indent=1, ensure_ascii=False))
    (stages / "frames.json").write_text(json.dumps(frames, indent=1, ensure_ascii=False))
    for n in notes:
        print(n)


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(prog="python3 -m deck.from_territory", description=__doc__.split("\n")[0])
    ap.add_argument("run", type=Path)
    ap.add_argument("--frames", required=True, type=Path, help="<run>.frames/v<N>-<hash>/manifest.json")
    ap.add_argument("--stages", required=True, type=Path)
    ap.add_argument("--plan", type=Path, help="the frame plan (default: <run>.frames-plan.json beside the run)")
    ap.add_argument("--brief", type=Path, help="brief_object.json: refuse when a field the run was given differs")
    ap.add_argument("--chosen", help="the chosen territory id (the pick at gate 2 does the same)")
    ap.add_argument("--style-pack", type=Path, help="a Style Pack folder: only checked to load; a bad one sets style_pack.hold")
    ap.add_argument("--replace", action="store_true")
    a = ap.parse_args(argv)
    try:
        run = json.loads(a.run.read_text())
        manifest = json.loads(a.frames.read_text())
        plan_path = a.plan or a.run.with_name(a.run.stem + ".frames-plan.json")
        if not plan_path.is_file():
            raise FromTerritoryError(f"no frame plan at {plan_path}: the frames were made from one")
        fields = None
        if a.brief:
            from . import inputs
            fields = inputs.load_brief(a.brief)[0]
        c, frames = from_run(run, manifest, json.loads(plan_path.read_text()), sha12(a.run), sha12(plan_path), a.frames.parent, a.run.name,
                             a.frames.parent.name, fields, a.chosen, try_style_pack(a.style_pack))
        write(c, frames, a.frames.parent, a.stages, a.replace)
    except (FromTerritoryError, images.ImageError) as e:
        print(f"refused: {e}", file=sys.stderr)
        return 2
    n = {s: sum(1 for f in frames["frames"].values() if f["status"] == s) for s in ("made", "flagged", "refused")}
    print(f"wrote {a.stages}/c_territories.json ({len(c['territories'])} territories) and frames.json ({n['made']} made, {n['flagged']} flagged, "
          f"{n['refused']} refused); brief {frames['run']['same_brief']}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
