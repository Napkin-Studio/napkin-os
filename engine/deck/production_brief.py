"""The production brief (deck-handoffs): what a producer takes from the approved concept into the Production Tool. No model call.

    python3 -m deck.production_brief --stages DIR --out DIR [--client NAME --project NAME --market TEXT]

Written once the idea is approved (gate 3), from the recorded stages: ``production_brief.json`` (for the Production Tool to take in; the
proposal is docs/contracts/production-brief.md) and ``production_brief.md`` (the same, for a person). It holds the deliverables per channel
with their formats and sizes (from the pinned format packs, engine/deck/vendor/format-packs.json), the key visual (a Production final when
the build had one, else the idea's own picture description, labelled illustrative), the script when stage d wrote one, the mandatories,
the rights needs (term, territory, talent, music, pictures) and the timing.

Its ``spine`` is a valid Production contract 3 ``briefSpine`` (production-tool/contracts/common.schema.json on develop), so Production can
hold it as a Brief node. Nothing is invented: what the inputs do not say is a labelled ``[To supply]`` and listed under ``to_supply``.
Stage d's newer fields (``manifesto``, ``script``, ``key_visual``) are read when present and never required.
"""
from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
PACKS = HERE / "vendor" / "format-packs.json"
TO_SUPPLY = "[To supply]"
#: briefSpine lengths (Production contract 3, common.schema.json): each part is cut at a word to its length.
SPINE_MAX = {"insight": 400, "proposition": 200, "audience": 400, "tone": 300, "feel": 200, "format": 160}
SPINE_ITEM_MAX, SPINE_ITEMS = 120, 6
#: Channel words -> a Campaign board lane (contract 3 formatChannel) or ``audio`` (no format pack). Order matters: "social video" is social.
LANES = (("audio", ("radio", "audio", "podcast", "spotify")), ("social", ("social", "instagram", "tiktok", "facebook", "meta", "snapchat", "linkedin")),
         ("film", ("film", "tv", "television", "video", "cinema", "youtube", "vod", "bvod")),
         ("ooh", ("outdoor", "poster", "billboard", "ooh", "sheet", "bus", "transit", "station", "screen", "adshel")),
         ("print", ("press", "print", "magazine", "newspaper", "leaflet", "flyer", "point of sale", "shelf", "chiller", "in-store")),
         ("display", ("display", "banner", "programmatic", "web", "online ad")))
#: The formats a deliverable proposes per lane: the pack's own ids, the commonest first (a proposal; the producer picks in Make all sizes).
LANE_FORMATS = {"social": {"video": ("meta-reels-9x16", "meta-feed-video-4x5", "youtube-16x9"), "image": ("meta-feed-image-4x5", "meta-feed-image-1x1")},
                "film": {"video": ("film-16x9", "film-9x16", "film-1x1")},
                "ooh": {"image": ("uk-48-sheet", "uk-6-sheet", "ie-d48-jcdecaux")},
                "print": {"image": ("mag-a4-full-page", "iso-a4")},
                "display": {"image": ("iab-300x250", "iab-728x90", "iab-300x600")}}
RIGHTS_BY_LANE = {"film": ("talent", "music", "voice"), "social": ("talent", "music"), "audio": ("voice", "music"),
                  "ooh": ("pictures", "talent"), "print": ("pictures", "talent"), "display": ("pictures",)}


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
        return " / ".join(_words(x) for x in v if _words(x))
    if isinstance(v, dict):
        return _words(v.get("text") or v.get("line") or v.get("title") or v.get("prompt") or "")
    return "" if v is None else str(v)


def cut(text: str, n: int) -> str:
    """Cut at a word to at most ``n`` characters (the briefSpine rule)."""
    text = re.sub(r"\s+", " ", str(text or "")).strip()
    if len(text) <= n:
        return text
    head = text[: n - 1].rsplit(" ", 1)[0]
    return (head or text[: n - 1]) + "…"


def lane_of(channel: str) -> str:
    t = f" {str(channel or '').lower()} "
    for lane, words in LANES:
        if any(re.search(rf"\b{re.escape(w)}", t) for w in words):
            return lane
    return "other"


def _packs() -> dict:
    out = {}
    try:
        packs = json.loads(PACKS.read_text())
    except (OSError, ValueError):
        return out
    for p in packs.get("packs") or []:
        for f in p.get("formats") or []:
            out[f["id"]] = {"pack_id": p["id"], "pack_version": packs.get("version"), "format_id": f["id"], "name": f.get("name"), "kind": f.get("kind"),
                            "ratio": f.get("ratio"), "delivery_px": f.get("delivery_px"), **({"bleed_mm": f["bleed_mm"]} if f.get("bleed_mm") else {})}
    return out


def formats_for(lane: str, channel: str, packs: dict) -> list:
    table = LANE_FORMATS.get(lane) or {}
    moving = bool(re.search(r"\b(video|film|tv|reel|stories|story|spot)\b", str(channel or "").lower()))
    ids = table.get("video" if moving and "video" in table else "image") or table.get("video") or ()
    return [packs[i] for i in ids if i in packs]


def script_of(d: dict, ex: dict | None = None) -> dict | None:
    """Stage d's script, read defensively (it is being added in parallel): a dict with lines or beats, a list of lines, or text. None when absent."""
    s = (ex or {}).get("script") if ex else d.get("script")
    if not s:
        return None
    if isinstance(s, str):
        return {"text": s.strip(), "lines": []}
    if isinstance(s, list):
        return {"lines": [x if isinstance(x, dict) else {"text": str(x)} for x in s]}
    if isinstance(s, dict):
        lines = s.get("lines") or s.get("beats") or s.get("shots") or []
        out = {k: s[k] for k in ("title", "length_s", "channel", "format", "text") if s.get(k)}
        out["lines"] = [x if isinstance(x, dict) else {"text": str(x)} for x in lines] if isinstance(lines, list) else []
        return out
    return None


def key_visual(d: dict, c_route: dict, production: dict) -> dict:
    """The key visual: a Production final (else master) the client may see, when the build had one; else stage d's key_visual or the idea's
    first picture description, labelled illustrative."""
    items = (production or {}).get("items") or {}
    best = None
    for key, it in sorted(items.items()):
        if it.get("role") not in ("master", "size", "frame") or not it.get("client_showable", it.get("rights") in ("generated", "own", "licensed")):
            continue
        rank = (0 if it.get("final") else 1, {"master": 0, "size": 1, "frame": 2}[it["role"]], key)
        if best is None or rank < best[0]:
            best = (rank, key, it)
    if best:
        it = best[2]
        return {"source": "production", "item": best[1], "sha256": it.get("sha256"), "rights": it.get("rights"), "final": bool(it.get("final")),
                "width": it.get("width"), "height": it.get("height"), "label": "Final" if it.get("final") else "From Production"}
    kv = d.get("key_visual")
    if isinstance(kv, dict) and _words(kv.get("description") or kv):
        return {"source": "stage_d", "description": _words(kv.get("description") or kv), "label": "Illustrative"}
    if isinstance(kv, str) and kv.strip():
        return {"source": "stage_d", "description": kv.strip(), "label": "Illustrative"}
    for ex in d.get("executions") or []:
        v = (ex or {}).get("visual")
        if _words(v):
            return {"source": "execution", "description": _words(v), "label": "Illustrative", "execution": ex.get("id")}
    return {"source": "none", "description": TO_SUPPLY, "label": "To supply"}


def build(stages: Path, client: str = "", project: str = "", market: str = "", human_edits: list | None = None) -> dict:
    """The production brief from the recorded stages; needs ``d_idea.json`` (the approved idea)."""
    stages = Path(stages)
    d = _read(stages / "d_idea.json")
    if not d:
        raise ValueError("there is no approved idea yet: the production brief is written from stage d once gate 3 is approved")
    b, c, a = _read(stages / "b_storyline.json"), _read(stages / "c_territories.json"), _read(stages / "a_requirements.json")
    production = _read(stages / "production.json")
    packs = _packs()
    route = next((t for t in c.get("territories") or [] if isinstance(t, dict) and t.get("id") == c.get("chosen")), {}) or {}
    to_supply = []

    deliverables = []
    for i, ex in enumerate(d.get("executions") or []):
        if not isinstance(ex, dict):
            continue
        ch = _words(ex.get("channel"))
        lane = lane_of(ch)
        fm = formats_for(lane, ch, packs)
        row = {"id": str(ex.get("id") or f"E{i + 1}"), "channel": ch, "lane": lane, "role": _words(ex.get("role")),
               "copy": [_words(x) for x in ex.get("copy") or [] if _words(x)] if isinstance(ex.get("copy"), list) else ([_words(ex.get("copy"))] if _words(ex.get("copy")) else []),
               "visual": _words(ex.get("visual")), "formats": fm, "formats_basis": "proposal: the commonest formats of the lane, to agree"}
        sc = script_of(d, ex)
        if sc:
            row["script"] = sc
        if lane == "audio":
            row["lengths_s"] = [30, 20]
        elif lane in ("film", "social") and fm and any(f.get("kind") == "video" for f in fm):
            row["lengths_s"] = [30, 15, 6] if lane == "film" else [15, 6]
        if not fm and lane != "audio":
            to_supply.append(f"Formats for {ch or row['id']}: no format pack matches this channel")
        deliverables.append(row)
    if not deliverables:
        to_supply.append("Deliverables: stage d wrote no executions")

    mand = [_words(r.get("text")) for r in a.get("requirements") or [] if isinstance(r, dict) and r.get("kind") == "mandatory" and _words(r.get("text"))]
    lanes = sorted({x["lane"] for x in deliverables})
    needs = sorted({n for ln in lanes for n in RIGHTS_BY_LANE.get(ln, ())})
    rights = {"term": TO_SUPPLY, "territory": market.strip() or TO_SUPPLY, "talent": TO_SUPPLY if "talent" in needs else "Not needed by these deliverables",
              "music": TO_SUPPLY if "music" in needs else "Not needed by these deliverables",
              "voice": TO_SUPPLY if "voice" in needs else "Not needed by these deliverables",
              "pictures": TO_SUPPLY if "pictures" in needs else "Not needed by these deliverables", "needs": needs,
              "note": "Every version inherits these limits; Production records each asset's rights (generated, own, licensed, unknown)."}
    to_supply += ["Rights: usage term (how long the work runs)"] + ([] if market.strip() else ["Rights: territory (the markets it runs in)"])
    to_supply += [f"Rights: {n}" for n in needs]
    timing = [{"phase": _words(t.get("phase")), "when": _words(t.get("when")) or TO_SUPPLY} for t in d.get("timeline") or [] if isinstance(t, dict) and _words(t.get("phase"))]
    if not timing:
        to_supply.append("Timing: stage d wrote no timeline")

    manifesto = _words(d.get("manifesto")) or None
    script = script_of(d)
    if not script:
        script = next((x["script"] for x in deliverables if x.get("script")), None)
    insight = b.get("insight") if isinstance(b.get("insight"), dict) else {}
    aud = b.get("audience") if isinstance(b.get("audience"), dict) else {}
    prop = b.get("proposition") if isinstance(b.get("proposition"), dict) else {}
    spine = {"insight": cut(_words(insight.get("human_truth")) or _words(insight.get("title")), SPINE_MAX["insight"]),
             "proposition": cut(_words(prop.get("line")) or _words(d.get("campaign_line")), SPINE_MAX["proposition"]),
             "audience": cut(_words(aud.get("primary")) or _words(aud.get("title")), SPINE_MAX["audience"]),
             "tone": cut(_words(route.get("mood")), SPINE_MAX["tone"]),
             "feel": cut(_words((b.get("from_to") or {}).get("to")) if isinstance(b.get("from_to"), dict) else "", SPINE_MAX["feel"]),
             "mandatories": [cut(m, SPINE_ITEM_MAX) for m in mand][:SPINE_ITEMS],
             "format": cut("; ".join(f"{x['channel'] or x['lane']}" for x in deliverables), SPINE_MAX["format"])}
    spine = {k: v for k, v in spine.items() if v not in ("", [], None)}
    return {"kind": "napkin.production_brief", "version": 1, "for": "ie.napkin.production-tool", "contract": "3",
            "status": "proposal", "label": "Production brief from the approved concept: a proposal for the producer to agree",
            "client": client, "project": project, "spine": spine,
            "concept": {"territory": {"id": route.get("id"), "name": _words(route.get("name")), "origin": route.get("origin") or "model"} if route else None,
                        "line": _words(d.get("campaign_line")), "idea": _words(d.get("idea")), "manifesto": manifesto,
                        "key_visual": key_visual(d, route, production)},
            "script": script, "deliverables": deliverables, "mandatories": mand, "rights": rights, "timing": timing,
            "to_supply": to_supply, "human_edits": [{k: e.get(k) for k in ("key", "after", "by", "at") if k in e} for e in human_edits or []],
            "made_from": {s: _read(stages / f).get("produced_by") for s, f in (("b", "b_storyline.json"), ("c", "c_territories.json"), ("d", "d_idea.json")) if (stages / f).exists()}}


def render_md(pb: dict) -> str:
    c = pb["concept"]
    out = [f"# Production brief: {pb.get('project') or 'the approved concept'}", "", f"*{pb['label']}.*", ""]
    if pb.get("client"):
        out += [f"**Client:** {pb['client']}", ""]
    out += ["## The concept", ""]
    if c.get("territory"):
        out.append(f"- **Route:** {c['territory']['name']}" + (" (the agency's own)" if c["territory"].get("origin") == "human" else ""))
    out += [f"- **Line:** {c['line'] or TO_SUPPLY}", f"- **Idea:** {c['idea'] or TO_SUPPLY}"]
    kv = c["key_visual"]
    out.append(f"- **Key visual ({kv['label']}):** " + (f"Production picture {kv['item']} (sha256 {str(kv.get('sha256'))[:12]}…, rights {kv.get('rights')})"
                                                       if kv["source"] == "production" else kv.get("description") or TO_SUPPLY))
    if c.get("manifesto"):
        out += ["", "### Manifesto", "", c["manifesto"]]
    if pb.get("script"):
        s = pb["script"]
        out += ["", "## Script", ""] + ([f"Length: {s['length_s']} s", ""] if s.get("length_s") else [])
        if s.get("text"):
            out.append(s["text"])
        for ln in s.get("lines") or []:
            out.append("- " + " · ".join(f"{k.upper()}: {v}" for k, v in ln.items() if isinstance(v, (str, int, float)) and str(v).strip()))
    out += ["", "## Deliverables", "", "| # | Channel | Lane | Role | Formats | Lengths |", "|---|---|---|---|---|---|"]
    for x in pb["deliverables"]:
        fm = ", ".join(f"{f['name']} ({(f.get('delivery_px') or {}).get('width')}×{(f.get('delivery_px') or {}).get('height')} px)" for f in x["formats"]) or TO_SUPPLY
        out.append(f"| {x['id']} | {x['channel']} | {x['lane']} | {x['role']} | {fm} | {', '.join(f'{n} s' for n in x.get('lengths_s') or []) or '-'} |")
    out += ["", "Formats are a proposal from the format packs; the producer picks the final set in Make all sizes.", "", "## Mandatories", ""]
    out += [f"- {m}" for m in pb["mandatories"]] or [f"- {TO_SUPPLY}"]
    r = pb["rights"]
    out += ["", "## Rights needs", "", f"- **Term:** {r['term']}", f"- **Territory:** {r['territory']}", f"- **Talent:** {r['talent']}",
            f"- **Music:** {r['music']}", f"- **Voice:** {r['voice']}", f"- **Pictures:** {r['pictures']}", "", r["note"], "", "## Timing", ""]
    out += [f"- {t['phase']}: {t['when']}" for t in pb["timing"]] or [f"- {TO_SUPPLY}"]
    if pb.get("human_edits"):
        out += ["", "## Written by people", ""] + [f"- {e.get('key')}: {e.get('after') if isinstance(e.get('after'), str) else 'their own route'} ({e.get('by')}, {e.get('at')})"
                                                     for e in pb["human_edits"]]
    out += ["", "## To supply", ""] + [f"- {t}" for t in pb["to_supply"]]
    return "\n".join(out) + "\n"


def write(stages: Path, out: Path, client: str = "", project: str = "", market: str = "", human_edits: list | None = None) -> dict:
    """Write production_brief.json and .md into ``out``; returns ``{files, deliverables, to_supply}`` for ``run.handoffs``."""
    pb = build(stages, client, project, market, human_edits)
    out = Path(out)
    out.mkdir(parents=True, exist_ok=True)
    (out / "production_brief.json").write_text(json.dumps(pb, indent=1, ensure_ascii=False))
    (out / "production_brief.md").write_text(render_md(pb))
    return {"files": ["production_brief.md", "production_brief.json"], "deliverables": len(pb["deliverables"]), "to_supply": len(pb["to_supply"])}


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(prog="python3 -m deck.production_brief", description=__doc__.split("\n")[0])
    ap.add_argument("--stages", required=True, type=Path)
    ap.add_argument("--out", required=True, type=Path)
    ap.add_argument("--client", default="")
    ap.add_argument("--project", default="")
    ap.add_argument("--market", default="")
    a = ap.parse_args(argv)
    try:
        res = write(a.stages, a.out, a.client, a.project, a.market)
    except ValueError as e:
        print(f"refused: {e}", file=sys.stderr)
        return 2
    print(f"wrote {a.out}/production_brief.md and .json: {res['deliverables']} deliverables, {res['to_supply']} to supply")
    return 0


if __name__ == "__main__":
    sys.exit(main())
