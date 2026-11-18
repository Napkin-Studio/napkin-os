"""Make frames for a SAVED territory run. The text pipeline is never re-run and the run file is only read.

    python -m territory.visuals --from-run <run.json>                                  # dry run: plan state, style, cost card with its id, no call
    python -m territory.visuals --from-run <run.json> --live --yes-cost <card id>      # paid: the frame plan (once) and the images
    python -m territory.visuals --from-run <run.json> --style style --live --yes-cost <card id>    # after the creative lead's style pack arrives

THE SWAP (the creative lead's style pack replaces the default; only pictures change): put its style.yaml and images in a folder and run
    python -m territory.visuals --from-run <run.json> --style <its folder>                 # read the card, then
    python -m territory.visuals --from-run <run.json> --style <its folder> --live --yes-cost <card id>
The run, the territory text and the frame plan are not touched; the pictures go to a new frames/v<N>-<hash>/ folder.

Pictures go to Runway's Gemini image models. Whether a client-derived prompt may go is one switch, visuals.policy.CLIENT_TO_RUNWAY
(refuse by default, Sai 18 Nov 2026; VISUALS_CLIENT_TO_RUNWAY=allow for testing; the card always says which), and marks that cannot be known refuse the frames. Every shot passes the picture-prompt lint (visuals.lint: the common-word allow-list, brand words, the
Confidential deny-list) before it is sent. A yes is the card's id (``--yes-cost c_...``): a stale or wrong id is refused. Spend is
derived from an append-only ledger outside the frames folder (visuals.jobs.Ledger), every attempt of every version counted, and capped
for the run's lifetime (``--max-usd``, default $2.00, never above $2.50).

Runway key: environment variable RUNWAYML_API_SECRET only. The frame plan goes through the engine's model path
(BRIEF_CLAUDE_TRANSPORT=cli for the Claude Code login). Quick model (gemini_image3.1_flash) for all territories,
best (gemini_image3_pro) for ``--shortlist``."""
from __future__ import annotations

import argparse
import json
import math
import re
import sys
import time
from datetime import date, datetime, timezone
from pathlib import Path

from visuals import guard, jobs as vjobs, lint, runway, safety, style as style_mod

from .. import material
from . import board, plan as plan_mod


ID_OK = re.compile(r"^[A-Za-z0-9_-]{1,40}$")      # a territory id becomes part of a file name: no slashes, dots or spaces


def default_ledger() -> Path:
    """The spend ledger: outside every frames folder, so deleting one cannot lower what a run has spent."""
    return Path.home() / ".napkin" / "territory-frames" / "ledger.jsonl"


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
    ap.add_argument("--live", action="store_true")
    ap.add_argument("--yes-cost", nargs="?", const="", default=None, metavar="CARD_ID",
                    help="the id of the cost card you have read (c_ and 16 hex, printed on the card): a stale or wrong id is refused")
    ap.add_argument("--plan-only", action="store_true", help="make the frame plan (one model call) and stop, to read it before spending credits")
    ap.add_argument("--shortlist", default="", help="comma-separated territory ids to make on the best model (gemini_image3_pro)")
    ap.add_argument("--reviewed-by", default="", metavar="NAME", help="the person who has read this safe-messaging run: writes <run>.safe-review.json "
                    "(name, date, run hash) and allows frames. A changed run needs a new review")
    ap.add_argument("--material", choices=material.ORIGINS, help="declare what a run saved before territory.run --material was made from "
                    "(needs --declared-by): writes <run>.material.json bound to the run's hash; client material follows visuals.policy")
    ap.add_argument("--declared-by", default="", metavar="NAME", help="the person who vouches for the material and that no part of it is marked Confidential")
    ap.add_argument("--brief", help="the brief file this run was made from (territory.run --brief): the run keeps only how many parts are marked "
                    "Confidential and the brief's hash, so the deny-list is rebuilt from it here. Needed when the run's brief has marked parts")
    ap.add_argument("--forbid", default="", help="comma-separated names (the client, a brand) the style pack's words may not hold")
    ap.add_argument("--max-usd", type=float, default=runway.DEFAULT_MAX_USD,
                    help=f"the cap for this run's frames over its lifetime (plan call plus every picture, every version); default 2.00, at most {runway.LIFETIME_CAP_USD:.2f}")
    ap.add_argument("--approve", default="", help="comma-separated frame keys a person has looked at and accepts although flagged (needs --approved-by)")
    ap.add_argument("--approved-by", default="", metavar="NAME", help="the person approving the frames named by --approve")
    ap.add_argument("--retry-flagged", action="store_true", help="regenerate flagged frames that nobody approved (costs credits)")
    ap.add_argument("--retry-unknown", action="store_true", help="re-create jobs whose create got no answer (they may already be billed). Needs --live --yes-cost, "
                    "shows them on the card, and must fit inside --max-usd")
    ap.add_argument("--no-guard", action="store_true", help="skip the local Ollama check")
    return ap


def shot_for_prompt(s: dict, plan: dict | None) -> dict:
    """The shot as it goes into a picture prompt. A plan made before the 18 Nov 2026 prompt (no ``prompt_version``) put lens and light in
    ``camera``; the style pack is the only visual driver now, so that phrase is left out (framing already says how close the shot is)."""
    if int((plan or {}).get("prompt_version") or 1) >= plan_mod.PROMPT_VERSION:
        return s
    return {k: v for k, v in s.items() if k != "camera"}


def shot_text(s: dict) -> str:
    """The shot description exactly as ``style.frame_prompt`` puts it first in the prompt (what the lint reads)."""
    return " ".join(str(x).rstrip(".") + "." for x in (s.get("framing"), s.get("camera"), s.get("action")) if x)


def main(argv=None, *, llm_factory=None, transport=None, guard_post=None, sleep=time.sleep, environ=None, poll_every: float = 4.0,
         ledger_path: Path | None = None) -> int:
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
    if not runway.cap_ok(a.max_usd):   # nan passes every comparison and inf removes the cap: a finite 0 < cap <= 2.50 only
        print(f"--max-usd {a.max_usd} is refused: give a number above 0 and at most ${runway.LIFETIME_CAP_USD:.2f}, what a run's frames may ever "
              "cost (Sai, 17 Nov 2026). No flag raises it.")
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

    if a.material:
        try:
            material.record_declaration(run_path, rhash, a.material, a.declared_by)
        except ValueError as e:
            print(e)
            return 2
    brief = None
    if a.brief:
        try:
            brief = material.brief_marks(Path(a.brief))
        except Exception as e:   # an unreadable brief or a broken mark: the deny-list cannot be rebuilt, so nothing is drawn
            print(f"--brief {a.brief} could not be read for its marks: {str(e)[:200]}. Nothing was sent.")
            return 2
    mat = material.gate(run, material.load_declaration(run_path, rhash), brief=brief)

    forbid = [x.strip() for x in [mat.get("brand") or "", *a.forbid.split(",")] if x and x.strip()]
    try:
        sty = style_mod.load(a.style if a.style else (run_dir / "style" if (run_dir / "style").is_dir() else None), forbid=forbid)
        refs = style_mod.reference_images(sty)
    except style_mod.StyleError as e:
        print(f"Style pack problem: {e}")
        return 2
    print(f"Style: {sty.source}, finish {sty.finish}, hash {sty.hash}, {len(sty.references)} reference image(s).")
    for w in sty.warnings:
        print(f"WARNING: style pack: {w}")
    if dict(sty.models) != dict(runway.TIER_MODEL):
        print(f"The style pack maps models {dict(sty.models)}; frames use only {dict(runway.TIER_MODEL)} (draft is the quick model, hero the "
              "--shortlist one). A pack cannot change the tiers: fix the pack. Nothing was sent.")
        return 2
    if sty.ignored_references:
        print(f"WARNING: Runway takes at most {style_mod.MAX_REFERENCES} reference images; using the first {style_mod.MAX_REFERENCES} by file name, "
              f"ignoring {len(sty.ignored_references)}: {', '.join(sty.ignored_references)}")
    banned = list(safe["banned"])                  # the category's list ONLY decides the plan and refuses shots: the style pack's own bans go
    guard_banned = list(dict.fromkeys([*banned, *sty.banned_imagery]))   # into the picture prompt and the guard check, never into the words
    why = lint.lint_text(style_mod.style_block(sty, banned), banned=[], allow=guard_banned)
    if why:
        print(f"The style pack's words cannot go to a picture model: {why}. A person fixes the pack; nothing was sent.")
        return 2

    going_live = a.live and bool(a.yes_cost)
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
    ledger = vjobs.Ledger(ledger_path or default_ledger(), "territory:" + rhash)
    if going_live:
        n_back = backfill(ledger, frames_dir, plan_mod.load(run_path))
        if n_back:
            print(f"Spend ledger: {n_back} earlier send(s) of this run were read from its frames folders into the ledger, so they count against the cap.")
    else:   # a dry run writes nothing (no ~/.napkin): the earlier sends are counted on the card in memory, exactly as the live run will write them
        rows = backfill_rows(ledger, frames_dir, plan_mod.load(run_path))
        if rows:
            ledger = _Preview(ledger, rows)
            print(f"Spend ledger: {sum(1 for r in rows if r.get('kind') != 'model_call')} earlier send(s) of this run are in its frames folders and "
                  "count against the cap (a live run records them in the ledger).")

    approved = []
    if a.approve:
        who = a.approved_by.strip()
        if not who:
            print("--approve needs --approved-by <your name>: an approval is a person's, and the board records who")
            return 2
        for k in [x.strip() for x in a.approve.split(",") if x.strip()]:
            e = (manifest.get("frames") or {}).get(k)
            if not e:
                print(f"--approve: no frame {k} in {version}")
                return 2
            e["approved_by_person"] = True
            e["approved_by"] = who
            e["approved_at"] = datetime.now(timezone.utc).isoformat(timespec="seconds")
            approved.append(k)
        runway.save_manifest(vdir, manifest)
        print(f"Approved by {who}: " + ", ".join(approved))

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
    if approved and plan and vdir.is_dir():          # an approval changes what the board and the deck slot show: refresh them now
        _write_board(run, run_path, vdir, version, manifest, plan, sty, safe)
        print(f"Board refreshed: {vdir / 'board.html'}")

    PLACEHOLDER = {"framing": "[frame plan not made yet: this shot is a placeholder]"}
    deny = lint.deny_list(mat["marks"] or [])

    def build_jobs() -> tuple[list[dict], list[dict]]:
        jobs, refused = [], []
        for tid in ids:
            kind = "best" if tid in short else "quick"
            for s in (plan or {}).get("territories", {}).get(tid) or [{"shot": x, **PLACEHOLDER} for x in plan_mod.SHOTS]:
                s = shot_for_prompt(s, plan)
                text = shot_text(s)
                k = runway.job_key(tid, s["shot"], kind)
                hit = safety.banned_in(text, banned)
                bad = lint.lint_text(text, banned, deny) if plan and not hit else None    # a placeholder is never sent: the real shot is linted
                if hit:
                    refused.append({"key": k, "tid": tid, "shot": s["shot"], "kind": kind, "why": "the shot description names banned imagery: " + ", ".join(hit)})
                elif bad:
                    refused.append({"key": k, "tid": tid, "shot": s["shot"], "kind": kind, "why": "the shot description cannot go to a picture model: " + bad})
                else:
                    jobs.append({"key": k, "tid": tid, "shot": s["shot"], "kind": kind, "prompt": style_mod.frame_prompt(s, sty, banned)})
        return jobs, refused

    jobs, refused = build_jobs()
    to_rename = []                                 # flagged files are moved aside only once the card is accepted and under the cap
    if a.retry_flagged:
        for k, e in (manifest.get("frames") or {}).items():
            g = e.get("guard") or {}
            if e.get("file") and g.get("flagged") and not e.get("approved_by_person") and any(j["key"] == k for j in jobs):
                to_rename.append((k, e["file"], f"{k}.flagged-{e.get('attempts', 1)}.png"))
                runway.retire(e)                   # the flagged attempt and its credits stay in the frame's history
                e.update({"file": None, "task": None, "status": "RETRY", "guard": None})
    if a.retry_unknown:                            # in memory until the card is shown and accepted: the unknown jobs become 'new' on the card
        for k, e in (manifest.get("frames") or {}).items():
            if not e.get("task") and e.get("status") in ("CREATING", "UNKNOWN") and any(j["key"] == k for j in jobs):
                runway.retire(e)
                e.update({"status": "RETRY", "retried_unknown": True})
    spent, sends = vjobs.spent_usd({"jobs": {}}, ledger), vjobs.send_count({"jobs": {}}, ledger)
    card = runway.cost_card(jobs, manifest, vdir, plan_usd, len(refs), a.max_usd, spent, sends,
                            id_parts=[rhash, sty.hash, version, bool(a.retry_flagged), bool(a.retry_unknown), bool(a.plan_only), short,
                                      mat["policy"], mat["ok"], len(mat["marks"] or [])])
    print(runway.render_card(card))
    for r in refused:
        print(f"Refused (needs a person): {r['key']}: {r['why']}")
    print("  " + mat["policy_label"])
    if mat["ok"]:
        print(f"Material: {mat['origin']} (marked by {mat['by']})" + (", client-derived" if mat["client_derived"] else "")
              + f"; {len(mat['marks'])} part(s) marked Confidential, kept out of every prompt by the deny-list.")
    else:
        print(f"Frames are refused for this run: {mat['why']}")
    if a.retry_unknown and not going_live:
        print("--retry-unknown re-creates jobs that may already be billed: it needs --live --yes-cost <card id> after you have read the card above. Nothing was made.")
        return 2
    if not going_live:
        if jobs:
            print(runway.preview(jobs[0], refs, placeholder=not plan))
            print(f"  {len(jobs)} request(s) in all; every prompt's sha256 is recorded in the manifest when it is sent.")
        print("Dry run: no model call and no Runway call made." if not a.live else f"Live run needs --yes-cost {card['id']} after you have read the card.")
        return 0
    if a.yes_cost != card["id"]:
        print(f"--yes-cost {a.yes_cost} is not this card's id ({card['id']}): the plan, the spend or the flags changed since the card you read, "
              "or the id is wrong. Nothing was made.")
        return 2
    if card["over_cap"]:
        print(f"The card (${card['total_usd']:.2f}, with ${card['spent_usd']:.2f} already spent on this run) is over the cap (${a.max_usd:.2f}): "
              "nothing will run.")
        return 2
    if not mat["ok"] and not a.plan_only:
        print(f"Nothing was sent: {mat['why']}")
        return 2

    if not plan:
        llm = llm_factory() if llm_factory else _live_llm(min(a.max_usd, plan_usd * 4 + 0.25))
        with ledger.locked():                      # the plan call counts inside the run's cap: checked and recorded under the lock, before it is made
            spent_now = vjobs.spent_usd({"jobs": {}}, ledger)
            if not (spent_now + plan_usd <= a.max_usd + 1e-9):
                print(f"The frame plan call (~${plan_usd:.2f}) with ${spent_now:.2f} already spent on this run is over the cap (${a.max_usd:.2f}): "
                      "nothing was sent.")
                return 2
            ledger.append({"key": "frames-plan", "kind": "model_call", "estimate_usd": plan_usd, "state": "creating"})
        plan = plan_mod.make(run, run_path, llm, banned)
        if isinstance(plan.get("usd"), (int, float)):
            with ledger.locked():
                ledger.append({"key": "frames-plan", "kind": "model_call", "usd": plan["usd"], "state": "made"})
        print(f"Frame plan saved: {plan_mod.plan_path(run_path)}")
        expect["plan_sha256_12"] = plan_mod.plan_hash(run_path)
        jobs, refused = build_jobs()
    if a.plan_only:
        return 0
    if not mat["ok"]:
        print(f"Nothing was sent: {mat['why']}")
        return 2

    vdir.mkdir(parents=True, exist_ok=True)
    for k, old, new in to_rename:
        if (vdir / old).exists():
            (vdir / old).rename(vdir / new)
        hist = (manifest["frames"][k].get("history") or [])
        if hist and hist[-1].get("file") == old:
            hist[-1]["file"] = new
    if new_version:
        vs = _versions(frames_dir)
        vs["versions"].append({"n": n, "hash": sty.hash, "folder": version, "created": date.today().isoformat(), "style": sty.summary()})
        (frames_dir / "versions.json").write_text(json.dumps(vs, indent=1, ensure_ascii=False))
    manifest["style"] = sty.summary()
    manifest["inputs"] = expect                    # what these frames were made from; a re-run with other inputs is refused
    manifest["safe_messaging"] = {k: safe[k] for k in ("applies", "packs", "reviewed")}
    manifest["provenance"] = material.PROVENANCE.get(mat["origin"], "Unknown origin")
    manifest["material"] = {"origin": mat["origin"], "by": mat["by"], "client_derived": mat["client_derived"], "confidential_parts": len(mat["marks"] or []),
                            "policy": mat["policy"], "policy_label": mat["policy_label"]}
    for r in refused:
        rows = manifest.setdefault("frames", {})
        old = rows.get(r["key"]) or {}
        if old.get("file") or old.get("task"):      # made (and paid for) before this rule: kept on record, marked, never sent again
            old["refused_now"] = r["why"]
            continue
        rows[r["key"]] = {"territory": r["tid"], "shot": r["shot"], "tier": r["kind"], "model": runway.MODELS[r["kind"]][0],
                          "status": "REFUSED", "error": r["why"], **({"history": old["history"]} if old.get("history") else {})}
    runway.save_manifest(vdir, manifest)
    client = runway.Client(key, transport)
    res = runway.generate(client, jobs, vdir, manifest, refs, sleep=sleep, poll_every=poll_every, ledger=ledger, cap_usd=a.max_usd)
    if res["unknown"]:
        print(f"UNKNOWN ({len(res['unknown'])}): {', '.join(res['unknown'])}: the create was sent and no answer was seen. They may be billed: check the Runway "
              "dashboard. Not created again automatically; --retry-unknown --live --yes-cost <card id> re-creates them after a fresh card.")
    print(f"Runway: {res['created']} task(s) created, {len(res['still_running'])} still running" + (f" ({res['stopped']})" if res["stopped"] else "")
          + (": run the same command again to pick them up." if res["still_running"] else "."))

    if not a.no_guard:
        _guard(manifest, vdir, guard_banned, guard_post)
    runway.save_manifest(vdir, manifest)
    fr = _write_board(run, run_path, vdir, version, manifest, plan, sty, safe)
    flagged = sum(f["flagged"] for v in fr.values() for f in v)
    total = vjobs.spent_usd({"jobs": {}}, ledger)
    print(f"Board: {vdir / 'board.html'}\nCards with frames: {vdir / 'frames.json'}\n{sum(len(v) for v in fr.values())} frame(s) saved, {flagged} flagged as needing a person; "
          f"spent on this run so far (the ledger: every version and every attempt): ${total:.2f} of the ${a.max_usd:.2f} cap.")
    return 0


def backfill_rows(ledger, frames_dir: Path, plan: dict | None) -> list[dict]:
    """The ledger lines backfill() would write, written nowhere: none when the ledger already has a line for this run. Reads only."""
    if ledger.lines():
        return []
    rows = []
    for mpath in sorted(frames_dir.glob("v*/manifest.json")) if frames_dir.is_dir() else []:
        try:
            frames = json.loads(mpath.read_text()).get("frames") or {}
        except (OSError, ValueError):
            continue
        for k, e in frames.items():
            hist = list(e.get("history") or [])
            # an entry written before histories were kept says only how many attempts it took: each one was a send
            own = 0 if (e.get("status") in (None, "REFUSED", "RETRY") and not e.get("task")) else max(1, int(e.get("attempts") or 1) - len(hist))
            for att, times in [*((h, 1) for h in hist), (e, own)]:
                model = att.get("model") or e.get("model") or runway.MODELS["quick"][0]
                rows += [{"key": k, "tier": e.get("tier"), "model": model, "table_credits": e.get("credits") or runway.credits_for(model),
                          "estimated_credits": att.get("estimated_credits"), "cost_credits": att.get("cost_credits"), "state": "creating",
                          "backfilled_from": mpath.parent.name}] * times
    if plan is not None and rows:
        rows.append({"key": "frames-plan", "kind": "model_call", "usd": plan.get("usd"), "estimate_usd": plan_mod.estimate()["est_usd"],
                     "state": "creating", "backfilled_from": "frames-plan"})
    return rows


def backfill(ledger, frames_dir: Path, plan: dict | None) -> int:
    """Frames made before the ledger existed (the 18 Nov 2026 first run) count too: when the ledger has no line for this run, every send
    its version manifests record (each attempt, and every attempt kept in a frame's history) and the plan call are appended once, under
    the lock. Only a live run calls it (a dry run counts backfill_rows in memory). Returns how many sends were added."""
    with ledger.locked():
        rows = backfill_rows(ledger, frames_dir, plan)
        for r in rows:
            ledger.append(dict(r))
    return sum(1 for r in rows if r.get("kind") != "model_call")


class _Preview:
    """A read-only view of a ledger plus the lines a live run would backfill: what a dry run's card counts. It has no lock and no append."""

    def __init__(self, ledger, rows: list[dict]):
        self._ledger, self._rows = ledger, [{"deck": ledger.deck_id, **r} for r in rows]
        self.path, self.deck_id = ledger.path, ledger.deck_id

    def lines(self) -> list[dict]:
        return self._ledger.lines() + [dict(r) for r in self._rows]


def _write_board(run: dict, run_path: Path, vdir: Path, version: str, manifest: dict, plan: dict | None, sty, safe: dict) -> dict:
    fr = board.frames_for(manifest, vdir, run_path.parent, version, plan)
    (vdir / "frames.json").write_text(json.dumps(board.frames_json(run, fr, version), indent=1, ensure_ascii=False))
    (vdir / "board.html").write_text(board.render_html(run, run_path.stem, fr, plan, vdir, run_path.parent, version, sty.summary(), safe))
    return fr


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
