"""Cards with frames, and a simple HTML board: one card per territory with its four frames, images by relative path."""
from __future__ import annotations

import html
import os
import re
from pathlib import Path

from .. import cards as cards_mod
from . import runway


def _slug(s: str) -> str:
    return re.sub(r"[^A-Za-z0-9_-]", "_", str(s))


def frames_for(manifest: dict, vdir: Path, run_dir: Path, version: str, plan: dict | None = None) -> dict:
    """territory id -> frames list, one per shot (the pro frame when both models made one): path (relative to the run's folder),
    shot, model, style version, flagged (a guard hit or a refused shot, until a person approves), guard_checked, reason."""
    out: dict = {}
    for key, e in sorted((manifest.get("frames") or {}).items()):
        if not (e.get("file") and (vdir / e["file"]).exists()) and e.get("status") != "REFUSED":
            continue
        g = e.get("guard") or {}
        flagged = bool(e.get("status") == "REFUSED" or g.get("flagged")) and not e.get("approved_by_person")
        f = {"path": os.path.relpath(vdir / e["file"], run_dir) if e.get("file") else None, "shot": e["shot"], "model": e["model"],
             "style_version": version, "flagged": flagged, "guard_checked": bool(g.get("checked")),
             "reason": e.get("error") if e.get("status") == "REFUSED" else g.get("reason"), "prompt": e.get("prompt", ""), "key": key}
        cur = out.setdefault(e["territory"], {})
        if e["shot"] not in cur or e["tier"] == "best":
            cur[e["shot"]] = f
    return {tid: [shots[s] for s in sorted(shots)] for tid, shots in out.items()}


def frames_json(run: dict, frames: dict, version: str) -> dict:
    return {"style_version": version, "cards": cards_mod.cards(run, frames)}


CSS = """body{font:15px/1.45 system-ui,sans-serif;margin:24px;color:#1a1a1a;background:#fafaf7}h1{font-size:20px;margin:0 0 4px}
.meta{color:#555;margin-bottom:20px}.t{background:#fff;border:1px solid #ddd;border-radius:8px;padding:16px;margin-bottom:24px}
.t h2{font-size:17px;margin:0 0 4px}.tier{font-size:12px;text-transform:uppercase;letter-spacing:.06em;color:#555}
.row{display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin-top:12px}@media(max-width:900px){.row{grid-template-columns:repeat(2,1fr)}}
figure{margin:0}img{width:100%;height:auto;border-radius:4px;display:block}figcaption{font-size:12px;color:#555;margin-top:4px}
.flag{border:2px solid #b3261e;padding:2px}.badge{display:inline-block;font-size:11px;padding:1px 6px;border-radius:9px;margin-left:4px}
.bad{background:#b3261e;color:#fff}.warn{background:#e8e0c8;color:#4a3f00}.empty{background:#eee;padding:40px 8px;text-align:center;color:#777;border-radius:4px}
.banner{background:#b3261e;color:#fff;padding:8px 12px;border-radius:6px;margin-bottom:16px}"""


def render_html(run: dict, run_name: str, frames: dict, plan: dict | None, vdir: Path, run_dir: Path, version: str, style: dict,
                safety: dict | None = None) -> str:
    e = html.escape
    shots = (plan or {}).get("territories") or {}
    parts = [f"<!doctype html><meta charset=utf-8><title>Territory frames: {e(run_name)} {e(version)}</title><style>{CSS}</style>",
             f"<h1>{e(run_name)}: frames {e(version)}</h1>",
             f"<div class=meta>Style: {e(style.get('finish', ''))}; {e(', '.join(style.get('look') or []))}; "
             f"{len(style.get('references') or [])} reference image(s); source {e(str(style.get('source', '')))}. "
             f"Pictures are illustrative, not final. The territory text is the saved run, unchanged.</div>"]
    if safety and safety.get("applies"):
        parts.append("<div class=banner>Safe-messaging category (" + e(", ".join(safety["packs"])) + "): reviewed by a person before frames were made. "
                     "Banned imagery was kept out: " + e(", ".join(safety["banned"])) + ".</div>")
    for c in cards_mod.cards(run, frames):
        parts.append(f"<section class=t><div class=tier>{e(c['tier'])}</div><h2>{e(c['name'] or '')}</h2><div>{e(c['thought'] or '')}</div>")
        by_shot = {f["shot"]: f for f in c["frames"]}
        planned = {s["shot"]: s for s in shots.get(c["id"], [])}
        parts.append("<div class=row>")
        for sid in ("f1", "f2", "f3", "f4"):
            f, s = by_shot.get(sid), planned.get(sid, {})
            cap = f"{sid}: {e(s.get('action') or s.get('framing') or '')}"
            if s.get("on_screen_line"):
                cap += f" <em>(on screen: {e(s['on_screen_line'])})</em>"
            if not f:
                parts.append(f"<figure><div class=empty>no frame yet</div><figcaption>{cap}</figcaption></figure>")
                continue
            badges = ""
            if f["flagged"]:
                badges += f"<span class='badge bad'>needs a person</span>"
            elif not f["guard_checked"]:
                badges += "<span class='badge warn'>not checked</span>"
            badges += f"<span class=badge>{e(f['model'])}</span>"
            src = os.path.relpath(Path(run_dir) / f["path"], vdir) if f["path"] else None
            img = f"<img src='{e(src)}' alt='{e(sid)}' loading=lazy>" if src else "<div class=empty>not generated</div>"
            why = f"<br>{e(f['reason'])}" if f["flagged"] and f.get("reason") else ""
            parts.append(f"<figure class='{'flag' if f['flagged'] else ''}'>{img}<figcaption>{cap} {badges}{why}</figcaption></figure>")
        parts.append("</div></section>")
    return "\n".join(parts)
