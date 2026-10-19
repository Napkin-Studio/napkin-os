"""Score deck runs on one set of metrics and write a comparison page. No model calls.

    python3 -m deck.evaluate RUN_DIR [RUN_DIR ...] --html report.html [--label DIR=name ...]

Each RUN_DIR is a run_deck output (deck.json, validation.json, report.json). The metrics:

run        built; wall seconds; model calls and tokens per run (from report.json)
shape      presented and appendix slides; presented slides by status (from source, drafted, needs a person)
integrity  errors that mean something was made up or unsafe; must be 0 (INTEGRITY below)
evidence   share of presented claims citing an input; the fit judge's verdicts on headlines
coverage   requirements answered; mandated messages carried; scored-criterion concepts answered
craft      presentability warnings (CRAFT below), after stage e's copy edits (how many applied)
thinking   code-derived, no model: the insight (shape pass or warnings, the judge's verdict on the chosen candidate), the idea (one
           idea, within its words, not a channel list) and the chain (quoted links found on their slides), from the deck and its
           validation (insight_shape, idea_single, chain_links); n/a where the deck has no such slide or stage
readiness  items only a person can supply (labelled placeholders), and agency-only text on screen

There is no single score on purpose: integrity is a gate, the rest are read side by side.
"""
from __future__ import annotations

import argparse
import html
import json
import os
from pathlib import Path

from . import spec

INTEGRITY = ("numbers_trace", "unknown_ref", "rejected_used", "source_required", "bare_claim",
             "quote_source", "banned_phrase", "imagery")
CRAFT = ("word_budget", "action_title", "repeated_line", "copy_spec", "budget_spread", "pitch_length")


def rubric_criteria() -> list:
    """The rubric's criteria (id, name, weight, anchors) from rubric.json, loaded rather than hard-coded.
    Judged scoring lives in ``deck.bench`` (python3 -m deck.bench); this keeps the rubric in one file."""
    from .bench.rubric import load_rubric
    return load_rubric()["criteria"]


def _presented(deck) -> list:
    """Presented slide ids: everything before the Appendix divider (or the trace)."""
    cut = next((i for i, x in enumerate(deck["order"]) if deck["slides"][x]["type"] in ("appendix", "requirement_trace", "appendix_sources")), len(deck["order"]))
    return deck["order"][:cut]


def thinking(deck: dict, F: list) -> dict:
    """The insight, idea and chain measures for one deck (code only). ``insight``: None for a deck built without insight
    candidates, else ``pass`` or ``warn`` (an insight_shape finding), with who chose and whether the judge passed one; ``idea``:
    None with no presented idea slide, else ``single`` or ``warn`` (an idea_single finding); ``chain``: None with no written
    chain, else ``{"links", "ok"}`` (the phrases given and the ones found on their slides)."""
    meta = deck.get("meta") or {}
    n = lambda check: sum(1 for f in F if f["check"] == check)
    ins = meta.get("insight")
    story = _presented(deck)
    chain = meta.get("chain")
    links = sum(1 for k in ("insight_phrase", "strategy_phrase", "idea_phrase", "proof_phrase") if isinstance(chain, dict) and spec.norm_text(chain.get(k) or ""))
    return {
        "insight": None if not ins else {"shape": "warn" if n("insight_shape") else "pass", "chosen_by": ins.get("chosen_by"),
                                         "judge": None if not ins.get("judged") else "pass" if ins.get("judge_pass") else "fail"},
        "idea": "single" if any(deck["slides"][x]["type"] == "idea" for x in story) and not n("idea_single") else
                "warn" if n("idea_single") else None,
        "chain": None if not links else {"links": links, "ok": max(0, links - n("chain_links"))},
    }


def score(run: Path) -> dict:
    """The metrics for one run directory (built=False when it has no deck)."""
    if not (run / "deck.json").exists():
        log = (run / "run.log").read_text()[-600:] if (run / "run.log").exists() else ""
        return {"run": run.name, "built": False, "log": log}
    deck = json.loads((run / "deck.json").read_text())
    F = json.loads((run / "validation.json").read_text())
    rep = json.loads((run / "report.json").read_text()) if (run / "report.json").exists() else {}
    shown = _presented(deck)
    S = [deck["slides"][x] for x in shown]
    count = lambda checks, lvl=None: sum(1 for f in F if f["check"] in checks and (lvl is None or f["level"] == lvl))
    claims = [c for s in S for c in s.get("claims", [])]
    cited = sum(1 for c in claims if c.get("refs"))
    # a narrowed headline keeps the verdict the judge gave before the rewrite (it was never judged again), and is counted apart too
    fv = (deck.get("fit") or {}).get("verdicts", [])
    narrowed = sum(1 for v in fv if v["verdict"] == "narrowed")
    verdicts = [v.get("was", v["verdict"]) if v["verdict"] == "narrowed" else v["verdict"] for v in fv]
    judged = [v for v in verdicts if v in ("supported", "partly", "not")]
    reqs = deck.get("requirements") or {}
    mapped = {r for s in deck["slides"].values() for r in s.get("requirements", [])}
    msgs = [r for r in reqs.values() if r["kind"] == "message"]
    human = sum(1 for s in S for b in s["blocks"] for it in [b] + [i for i in b.get("items", []) or [] if isinstance(i, dict)] if it.get("human"))
    stages = rep.get("stages", {})
    tok = lambda k: sum(int((v or {}).get(k, 0) or 0) for v in stages.values())
    idea = next((s for s in S if s["type"] == "idea"), None)
    return {
        "run": run.name, "built": True, "client": deck["meta"]["client"], "project": deck["meta"]["project"],
        "line": idea["title"] if idea else None, "research": bool(deck["meta"].get("research_doc_id")),
        "sources": {k: (v or {}).get("source") for k, v in stages.items() if k in ("a", "b", "c", "d", "e", "fit", "insight_judge")},
        "copy_edits": (stages.get("e") or {}).get("applied"),
        "secs": round(sum(float((v or {}).get("secs", 0) or 0) for v in stages.values()), 1), "calls": sum(int((v or {}).get("calls", 0) or 0) for v in stages.values()),
        "tokens_in": tok("prompt_tokens") + tok("tokens_in") + tok("cache_read_tokens") + tok("cache_creation_tokens"), "tokens_out": tok("completion_tokens") + tok("tokens_out"),
        "presented": len(shown), "appendix": len(deck["order"]) - len(shown),
        "status": {k: sum(1 for s in S if s["status"] == k) for k in ("from_source", "drafted", "needs_human")},
        "integrity": count(INTEGRITY, "error"), "integrity_by": {c: count((c,), "error") for c in INTEGRITY if count((c,), "error")},
        "errors": count({f["check"] for f in F}, "error"), "warnings": count({f["check"] for f in F}, "warn"),
        "claims": len(claims), "cited": cited, "cited_pct": round(100 * cited / len(claims)) if claims else None,
        "fit": {k: verdicts.count(k) for k in ("supported", "partly", "not", "n/a")}, "fit_narrowed": narrowed,
        "fit_pct": round(100 * verdicts.count("supported") / len(judged)) if judged else None,
        "reqs": len(reqs), "reqs_mapped": sum(1 for r in reqs if r in mapped),
        "msgs": len(msgs), "msgs_carried": len(msgs) - count(("message_carried",)),
        "criteria_missing": count(("criteria_map",)),
        "craft": count(CRAFT), "craft_by": {c: count((c,)) for c in CRAFT if count((c,))},
        "thinking": thinking(deck, F),
        "human": human, "leaks": count(("internal_leak",)), "copy_numbers": count(("copy_number",)), "uncited": count(("numbers_uncited",)),
        "titles": [s["title"] for s in S],
        "findings": [f"{f['level']} {f['check']}{' s' + str(f['slide_no']) if f.get('slide_no') else ''}: {f['message']}" for f in F
                     if f["check"] not in CRAFT and (f["level"] == "error" or f["check"] in ("claim_fit", "message_carried", "criteria_map", "copy_number"))][:12],   # craft is counted in the table
    }


CSS = """
:root{--bg:#f6f4ef;--card:#fff;--ink:#1b2430;--muted:#5b6773;--line:#dfe3e8;--accent:#8a5a10;--good:#1e7a4c;--warn:#a26a00;--bad:#b3261e;--bar:#e8a33d}
@media (prefers-color-scheme:dark){:root:not([data-theme="light"]){--bg:#0f141a;--card:#17202a;--ink:#e9edf1;--muted:#9aa6b2;--line:#2a3644;--accent:#e8a33d;--good:#5cc08a;--warn:#e8b04a;--bad:#ef7a72}}
:root[data-theme="dark"]{--bg:#0f141a;--card:#17202a;--ink:#e9edf1;--muted:#9aa6b2;--line:#2a3644;--accent:#e8a33d;--good:#5cc08a;--warn:#e8b04a;--bad:#ef7a72}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:15px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif}
main{max-width:1180px;margin:0 auto;padding:32px 16px 64px}h1{font:700 30px/1.15 Georgia,serif;margin:0 0 6px}h2{font:700 20px/1.2 Georgia,serif;margin:36px 0 12px}
.sub{color:var(--muted);margin:0 0 22px}.wrap{overflow-x:auto;border:1px solid var(--line);border-radius:10px;background:var(--card)}
table{border-collapse:collapse;width:100%;min-width:860px}th,td{padding:9px 12px;border-bottom:1px solid var(--line);text-align:left;vertical-align:top;font-variant-numeric:tabular-nums}
th{font:600 12px/1.2 system-ui;letter-spacing:.06em;text-transform:uppercase;color:var(--muted)}tr:last-child td{border-bottom:0}
td.k{color:var(--muted);white-space:nowrap}.good{color:var(--good);font-weight:600}.warn{color:var(--warn);font-weight:600}.bad{color:var(--bad);font-weight:700}
.bar{height:8px;border-radius:4px;background:var(--line);min-width:80px;margin-top:5px}.bar i{display:block;height:100%;border-radius:4px;background:var(--bar)}
.cards{display:grid;grid-template-columns:repeat(auto-fill,minmax(340px,1fr));gap:16px}.card{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:18px}
.card h3{margin:0 0 2px;font:700 18px/1.2 Georgia,serif}.card .line{font:italic 17px/1.3 Georgia,serif;color:var(--accent);margin:8px 0}
.card ol{margin:8px 0 0;padding-left:20px;color:var(--ink)}.card li{margin:2px 0}.small{font-size:13px;color:var(--muted)}a{color:var(--accent)}
.notes{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:6px 20px}.notes li{margin:6px 0}
"""


def _cell(v, good=None, bad=None, pct=False):
    """A table cell, coloured when the metric has a good or bad side."""
    if v is None:
        return '<td class="small">n/a</td>'
    cls = "good" if good is not None and good(v) else "bad" if bad is not None and bad(v) else ""
    bar = f'<div class="bar"><i style="width:{max(0, min(100, v))}%"></i></div>' if pct else ""
    return f'<td class="{cls}">{v}{"%" if pct else ""}{bar}</td>'


def _ins_cell(i):
    """The insight row's text: the shape result, then the judge's verdict when it ran; None with no candidates."""
    return None if not i else f'{i["shape"]}' + (f' · judge {i["judge"]}' if i.get("judge") else " · not judged")


def page(rows: list, notes: list | None = None, title: str = "Deck maker eval") -> str:
    """The comparison page: metrics table, then one card per deck with its line and story."""
    e = lambda t: html.escape(str(t))
    built = [r for r in rows if r["built"]]
    head = "".join(f"<th>{e(r.get('label') or r['run'])}</th>" for r in rows)
    def line(label, fn):
        return f'<tr><td class="k">{label}</td>' + "".join(fn(r) if r["built"] else '<td class="bad">not built</td>' for r in rows) + "</tr>"
    T = [
        line("Inputs", lambda r: f'<td>{"brief + research" if r["research"] else "brief only"}<div class="small">stages: {", ".join(sorted({str(v) for v in r["sources"].values()}))}</div></td>'),
        line("Wall time (s)", lambda r: _cell(r["secs"])),
        line("Model calls / tokens in·out", lambda r: f'<td>{r["calls"]}<div class="small">{r["tokens_in"]:,} · {r["tokens_out"]:,}</div></td>'),
        line("Presented · appendix", lambda r: _cell(f'{r["presented"]} · {r["appendix"]}', good=lambda v: int(v.split(" ")[0]) <= 18)),
        line("From source · drafted · needs a person", lambda r: f'<td>{r["status"]["from_source"]} · {r["status"]["drafted"]} · {r["status"]["needs_human"]}</td>'),
        line("<b>Integrity errors</b> (must be 0)", lambda r: _cell(r["integrity"], good=lambda v: v == 0, bad=lambda v: v > 0)),
        line("Numbers from the inputs left uncited", lambda r: _cell(r["uncited"], good=lambda v: v == 0)),
        line("Figures in copy not in the inputs", lambda r: _cell(r["copy_numbers"], good=lambda v: v == 0, bad=lambda v: v > 0)),
        line("Claims citing an input", lambda r: _cell(r["cited_pct"], pct=True)),
        line("Headlines supported (fit judge)", lambda r: f'{_cell(r["fit_pct"], pct=True)[:-5]}<div class="small">{r["fit"]["supported"]} supported · {r["fit"]["partly"]} partly · {r["fit"]["not"]} not' + (f' · {r["fit_narrowed"]} reworded, not re-judged' if r.get("fit_narrowed") else '') + '</div></td>'),
        line("Requirements answered", lambda r: _cell(f'{r["reqs_mapped"]}/{r["reqs"]}', good=lambda v: v.split("/")[0] == v.split("/")[1])),
        line("Mandated messages carried", lambda r: _cell(f'{r["msgs_carried"]}/{r["msgs"]}' if r["msgs"] else None, good=lambda v: v.split("/")[0] == v.split("/")[1], bad=lambda v: v.split("/")[0] != v.split("/")[1])),
        line("Scored concepts unanswered", lambda r: _cell(r["criteria_missing"], good=lambda v: v == 0, bad=lambda v: v > 0)),
        line("Copy edits applied (stage e)", lambda r: _cell(r.get("copy_edits"))),
        line("Insight: shape · judge", lambda r: _cell(_ins_cell(r["thinking"]["insight"]), good=lambda v: v.startswith("pass"), bad=lambda v: v.startswith("warn"))),
        line("One idea", lambda r: _cell(r["thinking"]["idea"], good=lambda v: v == "single", bad=lambda v: v == "warn")),
        line("Chain links found", lambda r: _cell(None if not r["thinking"]["chain"] else f'{r["thinking"]["chain"]["ok"]}/{r["thinking"]["chain"]["links"]}',
                                                  good=lambda v: v.split("/")[0] == v.split("/")[1], bad=lambda v: v.split("/")[0] != v.split("/")[1])),
        line("Craft warnings", lambda r: f'<td>{r["craft"]}<div class="small">{", ".join(f"{k} {v}" for k, v in r["craft_by"].items())}</div></td>'),
        line("Needs a person (placeholders)", lambda r: _cell(r["human"])),
        line("All errors · warnings", lambda r: f'<td>{r["errors"]} · {r["warnings"]}</td>'),
    ]
    cards = "".join(
        f'<div class="card"><h3>{e(r["client"])}</h3><div class="small">{e(r["project"])}</div>'
        f'<div class="line">{e(r["line"] or "(no idea slide)")}</div>'
        f'<div class="small">The presented story ({r["presented"]} slides):</div><ol>{"".join(f"<li>{e(t)}</li>" for t in r["titles"])}</ol>'
        + (f'<p class="small"><b>Flags:</b><br>{"<br>".join(e(x[:220]) for x in r["findings"])}</p>' if r["findings"] else "")
        + (f'<p class="small"><a href="{e(r["href"])}">Open the deck</a></p>' if r.get("href") else "") + "</div>"
        for r in built)
    failed = "".join(f'<div class="card"><h3>{e(r.get("label") or r["run"])}: not built</h3><pre class="small" style="white-space:pre-wrap">{e(r["log"])}</pre></div>' for r in rows if not r["built"])
    note_html = f'<h2>What the numbers say</h2><div class="notes"><ul>{"".join(f"<li>{n}</li>" for n in notes)}</ul></div>' if notes else ""
    return (f'<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">'
            f'<title>{e(title)}</title><style>{CSS}</style></head><body><main><h1>{e(title)}</h1>'
            f'<p class="sub">{len(built)} of {len(rows)} decks built. Integrity is a gate (must be 0); read the rest side by side.</p>'
            f'{note_html}<h2>Metrics</h2><div class="wrap"><table><thead><tr><th></th>{head}</tr></thead><tbody>{"".join(T)}</tbody></table></div>'
            f'<h2>The decks</h2><div class="cards">{cards}{failed}</div></main></body></html>')


def main(argv=None):
    """CLI: score each run directory; write the comparison page to --html and the rows as JSON beside it (same name, .json)."""
    ap = argparse.ArgumentParser(description="Score deck runs and write a comparison page.")
    ap.add_argument("runs", nargs="+", type=Path)
    ap.add_argument("--html", type=Path, required=True)
    ap.add_argument("--label", action="append", default=[], help="RUN_DIR=name for the table header")
    ap.add_argument("--notes", type=Path, help="a JSON list of note strings (HTML allowed) shown above the table")
    a = ap.parse_args(argv)
    labels = dict(x.split("=", 1) for x in a.label)
    rows = []
    for r in a.runs:
        s = score(r)
        s["label"] = labels.get(str(r)) or labels.get(r.name)
        if s["built"] and (r / "deck.html").exists():
            s["href"] = os.path.relpath((r / "deck.html").resolve(), a.html.resolve().parent)
        rows.append(s)
    notes = json.loads(a.notes.read_text()) if a.notes else None
    a.html.write_text(page(rows, notes), encoding="utf-8")
    (a.html.with_suffix(".json")).write_text(json.dumps(rows, indent=1, ensure_ascii=False))
    print(json.dumps([{k: r.get(k) for k in ("run", "built", "presented", "integrity", "cited_pct", "fit_pct", "craft", "human")} for r in rows], indent=1))


if __name__ == "__main__":
    main()
