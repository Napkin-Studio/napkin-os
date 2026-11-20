"""The concept pack (deck-concepts): the chosen concept as one artefact a creative team can take into a CD review without opening the deck.

The European agency workflow report (20 Nov 2026): agencies trade a concept pack (platform, line, key visual, manifesto, script,
executions in several channels, a stretch test), and Napkin wrote most of it at stage d but scattered it across stage files and slides,
with no manifesto and no structured script. This module bundles it, beside the deck, as ``concept_pack.json`` and ``concept_pack.md``,
and builds the one "The concept on a page" slide.

Sources, never invented here: stage d (the line, the idea, the executions, and ``concept``: platform, key visual, manifesto, a timed
30-second script, the stretch test), stage c (the territories considered and the one chosen) and the deck (the key visual's picture when
one is drawn). A part stage d did not write is listed under ``missing`` (a recorded stage d from before the pack), never filled in.
"""
from __future__ import annotations

import json
import re
from pathlib import Path

VERSION = 1
#: The manifesto's length stage d is asked for (words), and what the pack checks.
MANIFESTO_WORDS = (120, 180)
#: The script's length in seconds and the most scenes it may have.
SCRIPT_SECONDS = 30
EXECUTIONS = (3, 6)
TITLE = "The concept on a page"


def _words(text) -> int:
    return len(re.findall(r"\b[\w'’-]+\b", str(text or "")))


def _scene_time(sc: dict) -> str:
    t = str(sc.get("time") or sc.get("t") or "").strip()
    return t or (f"{sc.get('start', '?')}-{sc.get('end', '?')}s" if "start" in sc else "")


def build(st: dict, deck: dict | None = None) -> dict:
    """The pack from the stage outputs ``st`` (keys c, d) and, when given, the built deck (for the key visual's picture). Returns the
    pack: ``{version, platform, campaign_line, idea, key_visual, manifesto, script, executions, stretch, territories, chosen, missing,
    checks}``."""
    c, d = st.get("c") or {}, st.get("d") or {}
    cp = d.get("concept") if isinstance(d.get("concept"), dict) else {}
    terrs = c.get("territories") or []
    chosen = next((t for t in terrs if t.get("id") == c.get("chosen")), terrs[0] if terrs else None)
    reasons = (c.get("ranking") or {}).get("reasons") or {}
    plat = cp.get("platform") if isinstance(cp.get("platform"), dict) else ({"name": cp.get("platform")} if cp.get("platform") else {})
    script = cp.get("script") if isinstance(cp.get("script"), dict) else {}
    scenes = [s for s in script.get("scenes") or [] if isinstance(s, dict)]
    stretch = cp.get("stretch") if isinstance(cp.get("stretch"), dict) else {}
    kv = cp.get("key_visual")
    kv = {"description": kv} if isinstance(kv, str) else (kv if isinstance(kv, dict) else {})
    if deck:
        pic = _idea_picture(deck)
        if pic:
            kv = {**kv, "picture": pic}
    execs = [{"channel": x.get("channel"), "role": x.get("role"), "copy": list(x.get("copy") or []), "answer": x.get("answer"),
              "visual": (x.get("visual") or {}).get("prompt") or (x.get("visual") or {}).get("hint")} for x in d.get("executions") or [] if isinstance(x, dict)]
    pack = {"version": VERSION, "title": TITLE,
            "platform": {"name": str(plat.get("name") or "").strip(), "how_it_lasts": str(plat.get("how_it_lasts") or plat.get("why") or "").strip()},
            "campaign_line": str(d.get("campaign_line") or "").strip(), "idea": str(d.get("idea") or "").strip(),
            "key_visual": {"description": str(kv.get("description") or "").strip(), **({"picture": kv["picture"]} if kv.get("picture") else {})},
            "manifesto": str(cp.get("manifesto") or "").strip(),
            "script": {"length_s": int(script.get("length_s") or SCRIPT_SECONDS), "title": str(script.get("title") or "").strip(),
                       "scenes": [{"time": _scene_time(s), "visual": str(s.get("visual") or "").strip(), "vo": str(s.get("vo") or "").strip(),
                                   "super": str(s.get("super") or "").strip(), "sfx": str(s.get("sfx") or "").strip()} for s in scenes]},
            "executions": execs,
            "stretch": {"years": [{"year": str(y.get("year") or y.get("when") or ""), "what": str(y.get("what") or "")} for y in stretch.get("years") or [] if isinstance(y, dict)],
                        "channels": [{"channel": str(x.get("channel") or ""), "how": str(x.get("how") or "")} for x in stretch.get("channels") or [] if isinstance(x, dict)],
                        "where_it_breaks": str(stretch.get("where_it_breaks") or "").strip()},
            "territories": [{"id": t.get("id"), "name": t.get("name"), "thought": t.get("thought"), "sketch": t.get("sketch"),
                             "chosen": t is chosen, "why": reasons.get(t.get("id"), "")} for t in terrs],
            "chosen": (chosen or {}).get("name")}
    missing = [k for k, v in (("platform", pack["platform"]["name"]), ("campaign_line", pack["campaign_line"]), ("idea", pack["idea"]),
                              ("key_visual", pack["key_visual"]["description"]), ("manifesto", pack["manifesto"]),
                              ("script", pack["script"]["scenes"]), ("stretch", pack["stretch"]["years"] or pack["stretch"]["channels"]),
                              ("territories", pack["territories"])) if not v]
    pack["missing"] = missing
    pack["checks"] = checks(pack)
    return pack


def checks(pack: dict) -> list:
    """What the pack falls short on, as ``[{check, message}]`` (advisory: the report lists them, nothing is rewritten)."""
    out = []
    w = _words(pack["manifesto"])
    if pack["manifesto"] and not MANIFESTO_WORDS[0] - 20 <= w <= MANIFESTO_WORDS[1] + 20:
        out.append({"check": "manifesto_length", "message": f"the manifesto is {w} words; aim for {MANIFESTO_WORDS[0]} to {MANIFESTO_WORDS[1]}"})
    n = len(pack["executions"])
    if not EXECUTIONS[0] <= n <= EXECUTIONS[1]:
        out.append({"check": "executions", "message": f"{n} channel executions; a concept pack shows {EXECUTIONS[0]} to {EXECUTIONS[1]}"})
    if pack["script"]["scenes"] and not all(s["time"] for s in pack["script"]["scenes"]):
        out.append({"check": "script_timing", "message": "a script scene has no time"})
    for k in pack["missing"]:
        out.append({"check": "missing", "message": f"stage d wrote no {k.replace('_', ' ')}: run stage d again to complete the pack"})
    return out


def _idea_picture(deck: dict) -> str | None:
    """The file of the picture drawn on the idea slide (else the cover's), when the deck holds one."""
    assets = deck.get("assets") or {}
    for want in ("idea", "title"):
        for sid in deck.get("order") or []:
            s = deck["slides"][sid]
            if s.get("type") != want:
                continue
            for v in (s.get("slots") or {}).values():
                im = (v or {}).get("image") or {}
                a = assets.get(im.get("asset")) if im.get("status") in ("made", "approved") else None
                if a and a.get("file"):
                    return a["file"]
    return None


def markdown(pack: dict) -> str:
    """The pack as a document a creative team reads."""
    L = [f"# {pack['title']}: {pack['campaign_line'] or 'the concept'}", ""]
    if pack["platform"]["name"]:
        L += [f"**Platform:** {pack['platform']['name']}" + (f". {pack['platform']['how_it_lasts']}" if pack["platform"]["how_it_lasts"] else ""), ""]
    L += [f"**Campaign line:** {pack['campaign_line'] or '(not written)'}", "", f"**The idea:** {pack['idea'] or '(not written)'}", ""]
    L += ["## Key visual", "", pack["key_visual"]["description"] or "(not written)"]
    if pack["key_visual"].get("picture"):
        L += ["", f"![Key visual]({pack['key_visual']['picture']})"]
    L += ["", "## Manifesto", "", pack["manifesto"] or "(not written)", ""]
    sc = pack["script"]
    L += [f"## {sc['length_s']}-second script" + (f": {sc['title']}" if sc["title"] else ""), ""]
    if sc["scenes"]:
        L += ["| Time | Picture | Voice-over | Super | Sound |", "|---|---|---|---|---|"]
        cell = lambda s: str(s).replace("|", "/").replace("\n", " ")   # noqa: E731
        L += [f"| {cell(s['time'])} | {cell(s['visual'])} | {cell(s['vo'])} | {cell(s['super'])} | {cell(s['sfx'])} |" for s in sc["scenes"]]
    else:
        L += ["(not written)"]
    L += ["", "## Channel executions", ""]
    for i, x in enumerate(pack["executions"], 1):
        L += [f"{i}. **{x['channel']}**: {x['role'] or ''}"] + [f"   - {c}" for c in x["copy"]]
    st = pack["stretch"]
    L += ["", "## Stretch test: three years, every channel", ""]
    L += [f"- **{y['year']}**: {y['what']}" for y in st["years"]] or ["(not written)"]
    if st["channels"]:
        L += [""] + [f"- **{x['channel']}**: {x['how']}" for x in st["channels"]]
    if st["where_it_breaks"]:
        L += ["", f"Where it could break: {st['where_it_breaks']}"]
    L += ["", "## Territories considered", ""]
    L += [f"- **{t['name']}**{' (chosen)' if t['chosen'] else ''}: {t['thought'] or t['sketch'] or ''}" + (f" Why: {t['why']}" if t["why"] else "")
          for t in pack["territories"]] or ["(none recorded)"]
    if pack["checks"]:
        L += ["", "## To finish", ""] + [f"- {c['message']}" for c in pack["checks"]]
    return "\n".join(L).rstrip() + "\n"


def write(pack: dict, out: Path) -> tuple:
    """``concept_pack.json`` and ``concept_pack.md`` in ``out``; returns their paths."""
    out = Path(out)
    out.mkdir(parents=True, exist_ok=True)
    j, m = out / "concept_pack.json", out / "concept_pack.md"
    j.write_text(json.dumps(pack, indent=1, ensure_ascii=False))
    m.write_text(markdown(pack))
    return j, m


def slide(pack: dict, mk) -> dict | None:
    """'The concept on a page': the platform, the line, the idea, the key visual, the manifesto's first sentence, the script in one line,
    the channels and the stretch, as one two-column table. None when stage d wrote no line. ``mk`` is assemble._slide."""
    if not pack["campaign_line"]:
        return None
    first = re.split(r"(?<=[.!?])\s+", pack["manifesto"])[0] if pack["manifesto"] else ""
    rows = [[k, v] for k, v in (("Platform", pack["platform"]["name"]), ("The line", pack["campaign_line"]), ("The idea", pack["idea"]),
                                ("Key visual", pack["key_visual"]["description"]), ("Manifesto", first),
                                ("Film", f"{pack['script']['length_s']} seconds, {len(pack['script']['scenes'])} scenes" if pack["script"]["scenes"] else ""),
                                ("Channels", ", ".join(x["channel"] for x in pack["executions"] if x.get("channel"))),
                                ("Three years", "; ".join(y["what"] for y in pack["stretch"]["years"][:3]))) if v]
    sl = mk("concept", TITLE, [{"kind": "table", "rows": [["The concept", "In a line"]] + rows, "basis": "creative"}], claims=[{"text": pack["idea"], "refs": [], "basis": "creative"}],
            status="drafted", notes="The whole pack: concept_pack.md beside the deck (manifesto, the timed script, every execution, the stretch test).")
    sl["role"] = "concept"
    return sl
