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

from . import images

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
        try:
            from visuals import style as mod   # deck-look-kits' home, once it lands
        except ImportError:
            from territory.visuals import style as mod
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
