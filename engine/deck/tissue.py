"""The tissue-session kit (deck-handoffs): a short routes-only deck and a reactions sheet, from the recorded territories. No model call.

    python3 -m deck.tissue --stages DIR --out DIR [--client NAME --project NAME]      # the kit from stages already written
    python3 -m deck.tissue --format tissue --prompt-text "..." --stages DIR --out DIR   # run_deck up to the territories, then the kit

An agency shows rough routes at a tissue session to get the client's reaction before it commits (reports/European agency workflow vs
Napkin.md, recommendation 7). The kit is one page per territory: its line, a key-visual description (and its picture when the territory
tool made one: ``frames.json``), one example execution, and its risk; then a reactions sheet where the client marks each route love, like or
not for us, with comments. Everything is drafted from stage c's own words and labelled so: nothing here is a finished execution.

Writes into ``--out``: ``tissue.json`` (the kit), ``tissue.html`` (the deck and the sheet, one self-contained page), ``reactions.json``
(the sheet to fill: the shape ``tissue.reactions`` takes in the Deck document).

The reactions come back into the document as ``tissue.reactions`` ``{by, at, routes: {<territory id>: {verdict, comments}}}``;
``apply_reactions`` makes the most loved route the recommendation (stage c's ``chosen``, ``chosen_by`` the tissue session) and
``reaction_notes`` turns the comments into what stage d reads.
"""
from __future__ import annotations

import argparse
import html
import json
import sys
from pathlib import Path

VERDICTS = ("love", "like", "not_for_us")
VERDICT_WORDS = {"love": "Love it", "like": "Like it", "not_for_us": "Not for us"}
SCORE = {"love": 2, "like": 1, "not_for_us": -1}
COMMENT_MAX = 2000
LABEL = "Tissue session: rough routes to react to, not finished work"


def _read(p: Path) -> dict:
    try:
        v = json.loads(Path(p).read_text())
    except (OSError, ValueError):
        return {}
    return v if isinstance(v, dict) else {}


def _words(v) -> str:
    if isinstance(v, str):
        return v.strip()
    if isinstance(v, list):
        return "; ".join(_words(x) for x in v if _words(x))
    if isinstance(v, dict):
        return _words(v.get("text") or v.get("title") or v.get("line") or "")
    return ""


def _channel(stages: Path) -> str:
    """The channel the example executions use: the first channel the requirements name, else an outdoor poster (the plainest proof)."""
    a = _read(Path(stages) / "a_requirements.json")
    for r in a.get("requirements") or []:
        t = str((r or {}).get("text") or "").lower()
        for word, ch in (("social", "Social post"), ("tv", "TV spot"), ("film", "Online film"), ("radio", "Radio"), ("outdoor", "Outdoor poster"),
                         ("ooh", "Outdoor poster"), ("print", "Press ad"), ("digital", "Digital display")):
            if word in t.split() or f" {word}" in f" {t}":
                return ch
    return "Outdoor poster"


def _pictures(stages: Path) -> dict:
    """territory id -> {file, subject, status} from the territory tool's frames (frames.json), the first usable shot per territory."""
    fr = _read(Path(stages) / "frames.json")
    out = {}
    for key in sorted(fr.get("frames") or {}):
        rec = fr["frames"][key] or {}
        tid = rec.get("territory")
        if not tid or tid in out or rec.get("status") not in ("made", "approved") or not rec.get("file"):
            continue
        out[tid] = {"file": rec["file"], "subject": rec.get("subject") or "", "status": rec.get("status")}
    return out


def build_kit(stages: Path, client: str = "", project: str = "") -> dict:
    """The kit from the recorded stages: needs ``c_territories.json``; reads the storyline and the territory tool's frames when present."""
    stages = Path(stages)
    c = _read(stages / "c_territories.json")
    terr = [t for t in c.get("territories") or [] if isinstance(t, dict) and t.get("id")]
    if not terr:
        raise ValueError("no territories are written yet: the kit is made from stage c (run the deck to the territories gate first)")
    b = _read(stages / "b_storyline.json")
    pics = _pictures(stages)
    channel = _channel(stages)
    order = list((c.get("ranking") or {}).get("order") or [])
    routes = []
    for i, t in enumerate(terr):
        line = _words(t.get("line")) or _words(t.get("sketch")) or _words(t.get("name"))
        kv = t.get("key_visual") if isinstance(t.get("key_visual"), dict) else {}
        refs = _words(t.get("references"))
        desc = _words(kv.get("description")) or ". ".join(x for x in (_words(t.get("mood")), f"References: {refs}" if refs else "",
                                                                       f"A picture that shows: {_words(t.get('thought'))}") if x)
        pic = pics.get(t["id"])
        if pic and not kv.get("description") and pic.get("subject"):
            desc = f"{pic['subject']}. {desc}".strip()
        ex = t.get("execution") if isinstance(t.get("execution"), dict) else {}
        execution = {"channel": _words(ex.get("channel")) or channel, "headline": _words(ex.get("headline") or ex.get("copy")) or line,
                     "body": _words(ex.get("body")) or _words(t.get("thought")), "visual": _words(ex.get("visual")) or desc,
                     "drafted": not ex}
        routes.append({"id": t["id"], "n": i + 1, "name": _words(t.get("name")) or t["id"], "line": line, "thought": _words(t.get("thought")),
                       "why": _words(t.get("why")), "risks": _words(t.get("risks")), "origin": t.get("origin") or "model",
                       "judge_rank": (order.index(t["id"]) + 1) if t["id"] in order else None,
                       "key_visual": {"description": desc, "picture": pic["file"] if pic else None, "label": "Illustrative" if pic else "Description only"},
                       "execution": execution})
    insight = _words((b.get("insight") or {}).get("title")) if isinstance(b.get("insight"), dict) else ""
    prop = _words((b.get("proposition") or {}).get("line")) if isinstance(b.get("proposition"), dict) else ""
    return {"kind": "napkin.tissue_kit", "version": 1, "label": LABEL, "client": client, "project": project, "insight": insight or None,
            "proposition": prop or None, "routes": routes,
            "sheet": {"verdicts": [{"id": v, "label": VERDICT_WORDS[v]} for v in VERDICTS],
                      "routes": [{"id": r["id"], "name": r["name"]} for r in routes]}}


def reactions_template(kit: dict) -> dict:
    """The sheet to fill, in the shape the Deck document's ``tissue.reactions`` takes."""
    return {"by": "", "at": "", "routes": {r["id"]: {"verdict": None, "comments": ""} for r in kit["routes"]}}


def _e(s) -> str:
    return html.escape(str(s or ""), quote=True)


def render_html(kit: dict) -> str:
    """One self-contained page: a cover, one slide per route, the reactions sheet. No script, no external file except the route pictures."""
    css = ("body{font:16px/1.45 system-ui,sans-serif;margin:0;background:#f6f4ef;color:#1c1b19}section{max-width:960px;margin:24px auto;background:#fff;"
           "padding:40px 48px;border-radius:12px;box-shadow:0 1px 3px #0002}h1{font-size:34px;margin:0 0 8px}h2{font-size:28px;margin:0 0 6px}"
           ".tag{font:12px/1 ui-monospace,monospace;text-transform:uppercase;letter-spacing:.08em;color:#6b665c}.line{font-size:24px;font-weight:600;"
           "margin:14px 0}.kv{background:#f1eee6;padding:14px 16px;border-radius:8px}.kv img{max-width:100%;border-radius:6px;display:block;margin-bottom:8px}"
           ".ex{border-left:4px solid #1c1b19;padding:6px 14px;margin-top:16px}table{width:100%;border-collapse:collapse}td,th{border:1px solid #d8d3c6;"
           "padding:10px;text-align:left;vertical-align:top}.box{display:inline-block;width:14px;height:14px;border:1.5px solid #1c1b19;margin-right:6px;"
           "vertical-align:-2px}@media (prefers-color-scheme:dark){body{background:#151412;color:#eee}section{background:#1f1e1b}.kv{background:#2a2925}}")
    head = f"<!doctype html><html lang=\"en\"><head><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width,initial-scale=1\"><title>Tissue session</title><style>{css}</style></head><body>"
    cover = (f"<section><div class=\"tag\">{_e(kit['label'])}</div><h1>{_e(kit.get('project') or 'Routes')}</h1><p>{_e(kit.get('client'))}</p>"
             + (f"<p><b>The insight:</b> {_e(kit['insight'])}</p>" if kit.get("insight") else "")
             + (f"<p><b>The proposition:</b> {_e(kit['proposition'])}</p>" if kit.get("proposition") else "")
             + f"<p>{len(kit['routes'])} routes. React to each one: love it, like it or not for us, and say why.</p></section>")
    slides = []
    for r in kit["routes"]:
        kv, ex = r["key_visual"], r["execution"]
        pic = f"<img src=\"{_e(kv['picture'])}\" alt=\"{_e(kv['description'])}\">" if kv.get("picture") else ""
        slides.append(f"<section><div class=\"tag\">Route {r['n']}{' · your own route' if r['origin'] == 'human' else ''}</div><h2>{_e(r['name'])}</h2>"
                      f"<div class=\"line\">{_e(r['line'])}</div><p>{_e(r['thought'])}</p>"
                      f"<div class=\"kv\"><div class=\"tag\">Key visual · {_e(kv['label'])}</div>{pic}{_e(kv['description'])}</div>"
                      f"<div class=\"ex\"><div class=\"tag\">Example execution · {_e(ex['channel'])}{' · drafted from the route' if ex.get('drafted') else ''}</div>"
                      f"<p><b>{_e(ex['headline'])}</b></p><p>{_e(ex['body'])}</p><p><i>{_e(ex['visual'])}</i></p></div>"
                      + (f"<p><b>Risk:</b> {_e(r['risks'])}</p>" if r.get("risks") else "") + "</section>")
    rows = "".join(f"<tr><td><b>{_e(r['name'])}</b><br>{_e(r['line'])}</td>"
                   + "".join(f"<td><span class=\"box\"></span>{_e(VERDICT_WORDS[v])}</td>" for v in VERDICTS) + "<td style=\"min-width:220px\"></td></tr>"
                   for r in kit["routes"])
    sheet = ("<section><div class=\"tag\">Reactions sheet</div><h2>What did you make of each route?</h2><table><tr><th>Route</th>"
             + "".join(f"<th>{_e(VERDICT_WORDS[v])}</th>" for v in VERDICTS) + "<th>Comments</th></tr>" + rows + "</table>"
             "<p class=\"tag\">The agency records the answers in the deck (tissue.reactions): the loved route becomes the recommendation and the comments shape the idea.</p></section>")
    return head + cover + "".join(slides) + sheet + "</body></html>"


def write_kit(stages: Path, out: Path, client: str = "", project: str = "") -> dict:
    """Build and write the kit; returns ``{files, routes}`` for ``run.tissue``."""
    out = Path(out)
    out.mkdir(parents=True, exist_ok=True)
    kit = build_kit(stages, client, project)
    (out / "tissue.json").write_text(json.dumps(kit, indent=1, ensure_ascii=False))
    (out / "tissue.html").write_text(render_html(kit))
    (out / "reactions.json").write_text(json.dumps(reactions_template(kit), indent=1, ensure_ascii=False))
    for r in kit["routes"]:   # the pictures beside the page, under the same relative name
        pic = r["key_visual"].get("picture")
        if pic and (Path(stages) / pic).is_file() and not (out / pic).exists():
            (out / pic).parent.mkdir(parents=True, exist_ok=True)
            (out / pic).write_bytes((Path(stages) / pic).read_bytes())
    return {"files": ["tissue.html", "tissue.json", "reactions.json"], "routes": [{"id": r["id"], "name": r["name"], "line": r["line"]} for r in kit["routes"]]}


# ------------------------------------------------------------------------------------------------ the reactions, back in

def check_reactions(v) -> dict | None:
    """``tissue.reactions`` checked: ``{by, at, routes: {id: {verdict, comments}}}`` with known verdicts only; None when absent or empty.
    Raises ValueError for one the engine will not read."""
    if v is None:
        return None
    if not isinstance(v, dict) or not isinstance(v.get("routes"), dict):
        raise ValueError("tissue.reactions must be {by, at, routes: {<territory id>: {verdict, comments}}}")
    routes = {}
    for tid, r in v["routes"].items():
        if not isinstance(r, dict):
            raise ValueError(f"the reaction to {tid} must be {{verdict, comments}}")
        verdict = r.get("verdict")
        if verdict not in (None, *VERDICTS):
            raise ValueError(f"the reaction to {tid} must be love, like or not_for_us")
        comments = str(r.get("comments") or "").strip()[:COMMENT_MAX]
        if verdict or comments:
            routes[str(tid)] = {"verdict": verdict, "comments": comments}
    if not routes:
        return None
    return {"by": str(v.get("by") or "the client")[:120], "at": str(v.get("at") or "")[:40], "routes": routes}


def winner(reactions: dict, c: dict) -> str | None:
    """The route the client liked most: the highest verdict (love, then like), ties broken by the blind judge's order. None when no route
    was loved or liked, or none of the reacted routes is in stage c."""
    ids = [t.get("id") for t in c.get("territories") or [] if isinstance(t, dict)]
    order = list((c.get("ranking") or {}).get("order") or []) + ids
    best = None
    for tid, r in (reactions or {}).get("routes", {}).items():
        if tid not in ids or SCORE.get(r.get("verdict"), 0) <= 0:
            continue
        key = (-SCORE[r["verdict"]], order.index(tid))
        if best is None or key < best[0]:
            best = (key, tid)
    return best[1] if best else None


def apply_reactions(stages: Path, reactions: dict) -> dict:
    """Make the client's most liked route the recommendation (stage c's chosen) and record the reactions in stage c, before stage d runs.
    Returns ``{chosen, changed}``. Stage c stays as it was when there is no winner or stage d is already written."""
    stages = Path(stages)
    p = stages / "c_territories.json"
    c = _read(p)
    if not c or (stages / "d_idea.json").exists():
        return {"chosen": c.get("chosen") if c else None, "changed": False}
    w = winner(reactions, c)
    changed = False
    if c.get("tissue_reactions") != reactions:
        c["tissue_reactions"] = reactions
        changed = True
    if w and (c.get("chosen") != w or not str(c.get("chosen_by") or "").startswith("the client at the tissue session")):
        c["chosen"], c["chosen_by"] = w, f"the client at the tissue session ({reactions.get('by') or 'the client'}, {VERDICT_WORDS[reactions['routes'][w]['verdict']].lower()})"
        changed = True
    if changed:
        p.write_text(json.dumps(c, indent=1, ensure_ascii=False))
    return {"chosen": c.get("chosen"), "changed": changed}


def reaction_notes(reactions: dict, c: dict) -> str:
    """What stage d reads from the session: each route's verdict and comments, the chosen route's first."""
    if not reactions:
        return ""
    names = {t.get("id"): t.get("name") for t in c.get("territories") or [] if isinstance(t, dict)}
    chosen = c.get("chosen")
    rows = sorted(reactions["routes"].items(), key=lambda kv: kv[0] != chosen)
    lines = [f"- {names.get(tid, tid)}{' (the route you develop)' if tid == chosen else ''}: {VERDICT_WORDS.get(r.get('verdict'), 'no verdict')}"
             + (f". Comments: {r['comments']}" if r.get("comments") else "") for tid, r in rows]
    return ("\n\n<client_reactions source=\"tissue session\">\n" + "\n".join(lines) + "\n</client_reactions>\nThe client reacted to the routes at a "
            "tissue session. Treat the comments as the client's direction for the idea and its executions; they add no fact.")


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(prog="python3 -m deck.tissue", description=__doc__.split("\n")[0])
    ap.add_argument("--stages", required=True, type=Path)
    ap.add_argument("--out", required=True, type=Path)
    ap.add_argument("--client", default="")
    ap.add_argument("--project", default="")
    ap.add_argument("--format", choices=("tissue",), default=None, help="run run_deck up to the territories first (its other flags follow --)")
    ap.add_argument("--prompt-text", default=None)
    ap.add_argument("--live", action="store_true")
    a = ap.parse_args(argv)
    if a.format == "tissue" and not (a.stages / "c_territories.json").exists():
        from . import run_deck   # noqa: PLC0415
        argv2 = ["--stages", str(a.stages), "--out", str(a.out), "--client", a.client or "[Client]", "--project", a.project or "[Project]",
                 "--until", "c"] + (["--prompt-text", a.prompt_text] if a.prompt_text else []) + (["--live"] if a.live else [])
        run_deck.main(argv2)
    try:
        res = write_kit(a.stages, a.out, a.client, a.project)
    except ValueError as e:
        print(f"refused: {e}", file=sys.stderr)
        return 2
    print(f"wrote {a.out}/tissue.html, tissue.json and reactions.json: {len(res['routes'])} routes")
    return 0


if __name__ == "__main__":
    sys.exit(main())
