"""Make frames for a SAVED territory run. The text pipeline is never re-run and the run file is only read.

    python -m territory.visuals --from-run <run.json>                          # dry run: plan state, style, cost card, no call
    python -m territory.visuals --from-run <run.json> --live --yes-cost        # paid: the frame plan (once) and the images
    python -m territory.visuals --from-run <run.json> --style style --live --yes-cost    # after Laurence's style pack arrives

THE SWAP (Laurence's style pack replaces the default; only pictures change): put his style.yaml and images in a folder and run
    python -m territory.visuals --from-run <run.json> --style <his folder> --live --yes-cost
The run, the territory text and the frame plan are not touched; the pictures go to a new frames/v<N>-<hash>/ folder.

Runway key: environment variable RUNWAYML_API_SECRET only. The frame plan goes through the engine's model path
(BRIEF_CLAUDE_TRANSPORT=cli for the Claude Code login). Quick model (gemini_image3.1_flash) for all territories,
best (gemini_image3_pro) for ``--shortlist``."""
from __future__ import annotations

import argparse
import json
import re
import sys
import time
from datetime import date, datetime, timezone
from pathlib import Path

from visuals import guard, runway, safety, style as style_mod

from . import board, plan as plan_mod


ID_OK = re.compile(r"^[A-Za-z0-9_-]{1,40}$")      # a territory id becomes part of a file name: no slashes, dots or spaces


def _versions(frames_dir: Path) -> dict:
    p = frames_dir / "versions.json"
    return json.loads(p.read_text()) if p.exists() else {"versions": []}


def _version_for(frames_dir: Path, h: str) -> tuple[int, bool]:
    """(N, is_new): the same style hash always lands in the same folder; a new one takes the next number."""
    vs = _versions(frames_dir)["versions"]
    for v in vs:
        if v["hash"] == h:
            return v["n"], False
    return max([v["n"] for v in vs] or [0]) + 1, True


def _parser() -> argparse.ArgumentParser:
    ap = argparse.ArgumentParser(description="Frames per territory, from a saved run (text frozen).")
    ap.add_argument("--from-run", required=True, help="a saved territory run JSON (from territory.run --out)")
    ap.add_argument("--style", help="the style pack folder (style.yaml + up to 14 images); default: <run folder>/style if it exists, else the built-in default")
    ap.add_argument("--live", action="store_true"), ap.add_argument("--yes-cost", action="store_true")
    ap.add_argument("--plan-only", action="store_true", help="make the frame plan (one model call) and stop, to read it before spending credits")
    ap.add_argument("--shortlist", default="", help="comma-separated territory ids to make on the best model (gemini_image3_pro)")
    ap.add_argument("--reviewed-by", default="", metavar="NAME", help="the person who has read this safe-messaging run: writes <run>.safe-review.json "
                    "(name, date, run hash) and allows frames. A changed run needs a new review")
    ap.add_argument("--max-usd", type=float, default=runway.DEFAULT_MAX_USD, help="hard stop for the whole live run (plan call plus pictures); default 2.00")
    ap.add_argument("--approve", default="", help="comma-separated frame keys a person has looked at and accepts although flagged")
    ap.add_argument("--retry-flagged", action="store_true", help="regenerate flagged frames that nobody approved (costs credits)")
    ap.add_argument("--retry-unknown", action="store_true", help="re-create jobs whose create got no answer (they may already be billed). Needs --live --yes-cost, "
                    "shows them on the card, and must fit inside --max-usd")
    ap.add_argument("--no-guard", action="store_true", help="skip the local Ollama check")
    return ap


def main(argv=None, *, llm_factory=None, transport=None, guard_post=None, sleep=time.sleep, environ=None, poll_every: float = 4.0) -> int:
    a = _parser().parse_args(argv)
    run_path = Path(a.from_run).resolve()
    run = json.loads(run_path.read_text())                       # read only: the run file is never opened for writing
    run_dir = run_path.parent
    terr = run.get("territories") or []
    if run.get("status") != "proceed" or not terr:
        print("This run produced no territories: nothing to illustrate.")
        return 0
    ids = [t["id"] for t in terr]
    bad_ids = [i for i in ids if not isinstance(i, str) or not ID_OK.match(i)]
    if bad_ids or len(set(ids)) != len(ids):
        print(f"Territory ids must be unique and use only letters, digits, - and _ (they become file names); refused: {bad_ids or 'duplicate ids'}")
        return 2
    short = [s.strip() for s in a.shortlist.split(",") if s.strip()]
    if set(short) - set(ids):
        print(f"--shortlist names unknown territory id(s) {sorted(set(short) - set(ids))}; this run has {ids}")
        return 2

    rhash = plan_mod.run_hash(run_path)
    safe = safety.check(run)
    if safe["applies"] and a.reviewed_by:
        try:
            safety.record_review(run_path, rhash, a.reviewed_by, safe["packs"])
        except ValueError as e:
            print(e)
            return 2
    review = safety.load_review(run_path, rhash) if safe["applies"] else None
    safe = safety.check(run, reviewed=bool(review))
    if safe["blocked"]:
        print(f"Safe-messaging category ({', '.join(safe['packs'])}): no frame plan and no frames until a person has reviewed this run.\n"
              f"Read the territories, then run again with --reviewed-by <your name>. Banned imagery will be kept out either way: {', '.join(safe['banned'])}.")
        return 2
    if safe["applies"]:
        print(f"Safe-messaging category ({', '.join(safe['packs'])}), reviewed by {review['reviewer']} on {review['date']}: "
              "banned imagery stays out of every prompt and the guard check.")

    try:
        sty = style_mod.load(a.style if a.style else (run_dir / "style" if (run_dir / "style").is_dir() else None))
        refs = style_mod.reference_images(sty)
    except style_mod.StyleError as e:
        print(f"Style pack problem: {e}")
        return 2
    print(f"Style: {sty.source}, finish {sty.finish}, hash {sty.hash}, {len(sty.references)} reference image(s).")
    if sty.ignored_references:
        print(f"WARNING: Runway takes at most {style_mod.MAX_REFERENCES} reference images; using the first {style_mod.MAX_REFERENCES} by file name, "
              f"ignoring {len(sty.ignored_references)}: {', '.join(sty.ignored_references)}")

    going_live = a.live and a.yes_cost
    key = None
    if going_live and not a.plan_only:
        try:
            key = runway.api_key(environ)                        # read first, before the model path can touch the environment
        except runway.RunwayError as e:
            print(e)
            return 2

    frames_dir = run_path.with_name(run_path.stem + ".frames")
    n, new_version = _version_for(frames_dir, sty.hash)
    version = f"v{n}-{sty.hash}"
    vdir = frames_dir / version
    manifest = runway.load_manifest(vdir)
    banned = list(safe["banned"])                  # the category's list ONLY decides the plan and refuses shots: the style pack's own bans go
    guard_banned = list(dict.fromkeys([*banned, *sty.banned_imagery]))   # into the picture prompt and the guard check, never into the words

    if a.approve:
        for k in [x.strip() for x in a.approve.split(",") if x.strip()]:
            e = (manifest.get("frames") or {}).get(k)
            if not e:
                print(f"--approve: no frame {k} in {version}")
                return 2
            e["approved_by_person"] = True
            e["approved_at"] = datetime.now(timezone.utc).isoformat(timespec="seconds")
        runway.save_manifest(vdir, manifest)
        print("Approved by a person: " + a.approve)

    plan = plan_mod.load(run_path)
    plan_usd = None if plan else plan_mod.estimate()["est_usd"]
    print(f"Frame plan: {'saved, reused (' + plan_mod.plan_path(run_path).name + ')' if plan else 'not made yet: one model call'}.")
    if plan and plan.get("run_sha256_12") != rhash:
        print("The run file has changed since this plan was made: the plan's shots would illustrate words that are no longer the run's. Refused.\n"
              f"Keep the run as it was, or move {plan_mod.plan_path(run_path).name} aside and make a new plan (one model call).")
        return 2
    if plan and plan_mod.missing(plan, ids):
        print(f"The saved plan has no four shots for territory id(s) {plan_mod.missing(plan, ids)}: it was made for another run. Refused.")
        return 2
    expect = {"run_sha256_12": rhash, "plan_sha256_12": plan_mod.plan_hash(run_path) if plan else None, "safety_banned_sha256_12": safety.banned_sha(banned)}
    have = manifest.get("inputs")
    if have and plan and have != expect:
        print(f"This version folder ({version}) was made from different inputs than these (run, plan or safety list changed). Refused: "
              f"{json.dumps(have)} against {json.dumps(expect)}. Its frames would not match their prompts.")
        return 2

    PLACEHOLDER = {"framing": "[frame plan not made yet: this shot is a placeholder]"}

    def build_jobs() -> tuple[list[dict], list[dict]]:
        jobs, refused = [], []
        for tid in ids:
            kind = "best" if tid in short else "quick"
            for s in (plan or {}).get("territories", {}).get(tid) or [{"shot": x, **PLACEHOLDER} for x in plan_mod.SHOTS]:
                text = " ".join(str(s.get(k) or "") for k in ("framing", "camera", "action"))
                hit = safety.banned_in(text, banned)
                k = runway.job_key(tid, s["shot"], kind)
                if hit:
                    refused.append({"key": k, "tid": tid, "shot": s["shot"], "kind": kind, "why": "the shot description names banned imagery: " + ", ".join(hit)})
                else:
                    jobs.append({"key": k, "tid": tid, "shot": s["shot"], "kind": kind, "prompt": style_mod.frame_prompt(s, sty, banned)})
        return jobs, refused

    jobs, refused = build_jobs()
    if a.retry_flagged:
        for k, e in (manifest.get("frames") or {}).items():
            g = e.get("guard") or {}
            if e.get("file") and g.get("flagged") and not e.get("approved_by_person") and any(j["key"] == k for j in jobs):
                if going_live:
                    (vdir / e["file"]).rename(vdir / f"{k}.flagged-{e.get('attempts', 1)}.png")
                e.update({"file": None, "task": None, "status": "RETRY", "guard": None})
    if a.retry_unknown:                            # in memory until the card is shown and accepted: the unknown jobs become 'new' on the card
        for k, e in (manifest.get("frames") or {}).items():
            if not e.get("task") and e.get("status") in ("CREATING", "UNKNOWN") and any(j["key"] == k for j in jobs):
                e.update({"status": "RETRY", "retried_unknown": True})
    card = runway.cost_card(jobs, manifest, vdir, plan_usd, len(refs), a.max_usd)
    print(runway.render_card(card))
    for r in refused:
        print(f"Refused (needs a person): {r['key']}: {r['why']}")
    if a.retry_unknown and not going_live:
        print("--retry-unknown re-creates jobs that may already be billed: it needs --live --yes-cost after you have read the card above. Nothing was made.")
        return 2
    if not going_live:
        if jobs:
            print(runway.preview(jobs[0], refs, placeholder=not plan))
            print(f"  {len(jobs)} request(s) in all; every prompt's sha256 is recorded in the manifest when it is sent.")
        print("Dry run: no model call and no Runway call made." if not a.live else "Live run needs --yes-cost after you have read the card.")
        return 0
    if card["over_cap"]:
        print(f"The card (${card['total_usd']:.2f}) is over the hard stop (${a.max_usd:.2f}): nothing will run. Raise --max-usd only if you mean it.")
        return 2

    if not plan:
        llm = llm_factory() if llm_factory else _live_llm(min(a.max_usd, plan_usd * 4 + 0.25))
        plan = plan_mod.make(run, run_path, llm, banned)
        print(f"Frame plan saved: {plan_mod.plan_path(run_path)}")
        expect["plan_sha256_12"] = plan_mod.plan_hash(run_path)
        jobs, refused = build_jobs()
    if a.plan_only:
        return 0

    vdir.mkdir(parents=True, exist_ok=True)
    if new_version:
        vs = _versions(frames_dir)
        vs["versions"].append({"n": n, "hash": sty.hash, "folder": version, "created": date.today().isoformat(), "style": sty.summary()})
        (frames_dir / "versions.json").write_text(json.dumps(vs, indent=1, ensure_ascii=False))
    manifest["style"] = sty.summary()
    manifest["inputs"] = expect                    # what these frames were made from; a re-run with other inputs is refused
    manifest["safe_messaging"] = {k: safe[k] for k in ("applies", "packs", "reviewed")}
    for r in refused:
        manifest.setdefault("frames", {})[r["key"]] = {"territory": r["tid"], "shot": r["shot"], "tier": r["kind"], "model": runway.MODELS[r["kind"]][0],
                                                       "status": "REFUSED", "error": r["why"]}
    runway.save_manifest(vdir, manifest)
    client = runway.Client(key, transport)
    plan_spent = plan_usd or 0                      # the plan call was made in this run only when it was not saved before
    res = runway.generate(client, jobs, vdir, manifest, refs, sleep=sleep, poll_every=poll_every,
                          max_credits=max(0.0, (a.max_usd - plan_spent) / runway.USD_PER_CREDIT))
    if res["unknown"]:
        print(f"UNKNOWN ({len(res['unknown'])}): {', '.join(res['unknown'])}: the create was sent and no answer was seen. They may be billed: check the Runway "
              "dashboard. Not created again automatically; --retry-unknown --live --yes-cost re-creates them after a fresh card.")
    print(f"Runway: {res['created']} task(s) created, {len(res['still_running'])} still running" + (f" ({res['stopped']})" if res["stopped"] else "")
          + (": run the same command again to pick them up." if res["still_running"] else "."))

    if not a.no_guard:
        _guard(manifest, vdir, guard_banned, guard_post)
    runway.save_manifest(vdir, manifest)
    fr = board.frames_for(manifest, vdir, run_dir, version, plan)
    (vdir / "frames.json").write_text(json.dumps(board.frames_json(run, fr, version), indent=1, ensure_ascii=False))
    (vdir / "board.html").write_text(board.render_html(run, run_path.stem, fr, plan, vdir, run_dir, version, sty.summary(), safe))
    flagged = sum(f["flagged"] for v in fr.values() for f in v)
    spent = sum((e.get("cost_credits") or e.get("estimated_credits") or 0) for e in manifest["frames"].values())
    print(f"Board: {vdir / 'board.html'}\nCards with frames: {vdir / 'frames.json'}\n{sum(len(v) for v in fr.values())} frame(s) saved, {flagged} flagged as needing a person; "
          f"credits recorded in the manifest for this version: {spent:g}.")
    return 0


def _guard(manifest: dict, vdir: Path, banned: list[str], post) -> None:
    kw = {"post": post} if post else {}
    down = None
    for k, e in manifest["frames"].items():
        g = e.get("guard") or {}
        if not e.get("file") or g.get("checked"):
            continue
        if down:
            e["guard"] = {"checked": False, "flagged": False, "found": {}, "reason": down}
            continue
        e["guard"] = guard.check_image((vdir / e["file"]).read_bytes(), banned, **kw)
        if not e["guard"]["checked"]:
            down = e["guard"]["reason"]
            print(f"Guard check skipped: {down}. Frames show as 'not checked'.")
        elif e["guard"]["flagged"]:
            print(f"{k}: FLAGGED, needs a person: {e['guard']['reason']}")


def _live_llm(max_usd: float | None = None):
    sys.path[:0] = [str(Path(__file__).resolve().parents[2])]
    from ..llm import LiveLLM
    return LiveLLM(approved=True, max_usd=max_usd)
