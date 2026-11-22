"""Step 1 of Territories (feature territories-engine-insights): read what was carried (a brief, research pins and findings) and propose
ranked, cited insights in ONE model call.

    out = insights.run(doc, llm, facts=facts, findings=findings, sources=sources)
    out["insights"]   # members of ``focus.insights`` (id, kind, text, evidence, strength, ticked, by, rank, derived)
    out["error"]      # a ``run.error`` in plain words when nothing could be saved (contract.refusal_error)
    out["gate"]       # intake's answer when there is nothing to read and category and market are not both known

``llm`` is ``llm(stage, system, user) -> (obj, usage)``; give it ``Spend.wrap(...)`` so every call is capped and never paid twice.

The model writes ``kind``, ``text`` and ``cites`` only. The CODE does the rest: it drops an insight that cites an id not in play (and
says why in ``dropped``), computes ``strength`` from the cited items, sets ``derived`` when a cited finding is not verified, ranks, and
ticks the top five. An insight that cites nothing is Napkin's own idea (a provocation or a borrowed move): it is never ``strong`` and
never ``derived``; a provocation or borrowed move is ``thin`` even when it cites what sparked it. Dev harness: ``python -m territory.insights --doc data.json [--facts f.json --findings fi.json] [--live]``.
"""
from __future__ import annotations

import json
import re

from . import carried, contract, intake
from .llm import prompt

#: kinds the model may write; ``yours`` is the planner's own (``append_planner``)
MODEL_KINDS = ("tension", "truth", "provocation", "borrowed")
NEEDS_CITE = ("tension", "truth")
TICKED = 5
ORDER = {"strong": 0, "moderate": 1, "thin": 2}
_NUMBER = re.compile(r"\d|[\"“”]")
_MARKS = re.compile(r"\*\*|__|~~|`|^\s{0,3}(#{1,6}|[-*•])\s+", re.M)
_ID_IN_TEXT = re.compile(r"\b(brief:[a-z_]+|f_[0-9A-Z]{6,}|fi_[0-9A-Z]{6,}|x_[0-9A-Z]{6,}|in_[a-z0-9]{2,12})\b")


def _plain(s) -> str:
    return re.sub(r"\s+", " ", _MARKS.sub("", str(s or ""))).strip()


def _pin_text(p: dict) -> str:
    v = carried.text_of(p.get("value"))
    return f"{p.get('key', '')}: {v}" + (f" {p['unit']}" if p.get("unit") and p["unit"] != "code" else "")


def payload(inp: dict) -> dict:
    """The model's input from ``carried.engine_input``: every brief field that arrived, every pin, every live finding, by id."""
    return {
        "brief": {f"brief:{k}": v for k, v in inp["brief"].items()},
        "pins": [{"id": p["id"], "what": _pin_text(p), "confidence": p.get("confidence"), "sources": p.get("sources") or []} for p in inp["facts"]],
        "findings": [{"id": f["id"], "statement": f.get("statement", ""), "status": f.get("status"), "confidence": f.get("confidence"),
                      "rests_on": f.get("cites") or []} for f in inp["findings"]],
        "rejected_findings_never_use": inp["rejected_findings"],
    }


def _index(inp: dict) -> dict:
    """id -> {text, solid, derived, sources} for everything that may be cited."""
    ix: dict = {}
    for n, t in inp["brief"].items():
        ix[f"brief:{n}"] = {"text": t, "derived": False, "sources": {"brief"}}
    for p in inp["facts"]:
        ix[p["id"]] = {"text": _pin_text(p), "derived": False, "sources": set(p.get("sources") or []) or {p["id"]}}
    for f in inp["findings"]:
        srcs: set = set()
        for c in f.get("cites") or []:
            srcs |= ix.get(c, {}).get("sources", set())
        ix[f["id"]] = {"text": f.get("statement", ""), "derived": f.get("status") != "verified", "sources": srcs or {f["id"]}}
    return ix


def strength_of(cites: list[str], ix: dict) -> tuple[str, bool, dict]:
    """(strength, derived, parts). Parts: something solid cited (+1), two or more independent sources (+1), a number or a quote (+1).
    A derived finding caps the score at 1, so it is never better than ``thin``. No cites: thin, not derived (Napkin's own idea)."""
    if not cites:
        return "thin", False, {"solid": 0, "independent": 0, "figure": 0}
    derived = any(ix[c]["derived"] for c in cites)
    solid = int(any(not ix[c]["derived"] for c in cites))
    srcs = set().union(*(ix[c]["sources"] for c in cites))
    parts = {"solid": solid, "independent": int(len(srcs) >= 2), "figure": int(any(_NUMBER.search(ix[c]["text"]) for c in cites))}
    pts = min(sum(parts.values()), 1) if derived else sum(parts.values())
    return ("strong" if pts >= 3 else "moderate" if pts == 2 else "thin"), derived, parts


def _shape_problems(rows: list[dict], doc: dict, facts, findings) -> list:
    """What the host would refuse in the insights: each against the schema, then the cites and text rules of ``contract.check``."""
    ps = contract.validate_all("insight", rows)
    if ps:
        return ps
    base = contract.example()
    base = {**base, "upstream": doc.get("upstream") or {}, "focus": {"sources": [], "insights": rows}}
    return [p for p in contract.check(base, facts=facts or [], findings=findings or []) if str(p.path).startswith("focus.insights")]


def build(raw: list, inp: dict) -> tuple[list[dict], list[dict]]:
    """Raw model insights -> (insights in rank order, dropped with the reason). Pure code: no model."""
    ix = _index(inp)
    briefs = {_plain(t).lower() for t in inp["brief"].values()}
    out, dropped, seen = [], [], set()

    def drop(r, why):
        dropped.append({"text": _plain((r or {}).get("text") if isinstance(r, dict) else r)[:120], "reason": why})

    for r in raw if isinstance(raw, list) else []:
        if not isinstance(r, dict):
            drop(r, "not an insight")
            continue
        kind, text = str(r.get("kind") or "").strip().lower(), _plain(r.get("text"))
        cites = [str(c) for c in dict.fromkeys(r.get("cites") or [])]
        if kind not in MODEL_KINDS:
            drop(r, f"unknown kind {kind!r}")
        elif not text or len(text) > 300:
            drop(r, "text empty or too long")
        elif _ID_IN_TEXT.search(text):
            drop(r, "text names an internal id")
        elif any(c not in ix for c in cites):
            drop(r, "cites an id that is not in play: " + ", ".join(c for c in cites if c not in ix))
        elif kind in NEEDS_CITE and not cites:
            drop(r, "a tension or truth must cite its evidence")
        elif text.lower() in briefs:
            drop(r, "restates a brief field")
        elif text.lower() in seen:
            drop(r, "duplicate")
        else:
            seen.add(text.lower())
            s, derived, _ = strength_of(cites, ix)
            if kind not in NEEDS_CITE:
                s = "thin"          # Napkin's idea: what sparked it is cited, but it is never shown as evidence-strong
            out.append({"id": contract.mint("insight", text), "kind": kind, "text": text, "evidence": cites[:8], "strength": s,
                        "ticked": False, "by": "engine", "derived": derived})
    out.sort(key=lambda i: (ORDER[i["strength"]], -len(i["evidence"])))
    out = out[:contract.limit("focus", "insights")]
    for n, i in enumerate(out, 1):
        i["rank"], i["ticked"] = n, n <= TICKED
    return out, dropped


def append_planner(rows: list[dict], text: str, cites: list[str] | None = None, *, by: str, inp: dict | None = None, tick: bool = True) -> list[dict]:
    """The planner's own insight, appended at the end (kind ``yours``, ``by`` their name) with no model call. Strength is computed when
    ``inp`` (the carried input) says what its cites hold, else thin."""
    text = _plain(text)
    if not text or not by.strip():
        raise ValueError("A planner's insight needs its words and a name.")
    if len(rows) >= contract.limit("focus", "insights"):
        raise ValueError("The pick holds at most 25 insights.")
    cites = list(dict.fromkeys(cites or []))
    ix = _index(inp) if inp else {}
    if any(c not in ix for c in cites):
        raise ValueError("An insight can only cite a source that is in play.")
    s, derived, _ = strength_of(cites, ix)
    new = {"id": contract.mint("insight", f"{by}:{text}"), "kind": "yours", "text": text, "evidence": cites[:8], "strength": s, "ticked": tick,
           "by": by.strip()[:80], "rank": len(rows) + 1, "derived": derived}
    return [*rows, new]


def ask_words(gate: dict) -> str:
    """What is missing, in words (never a field name)."""
    need = [w for w, v in (("the category", gate.get("category")), ("the market", gate.get("market"))) if not v]
    if gate["action"] == "refuse":
        return "There is not enough to work from, so no insights were made."
    return "To start I need " + " and ".join(need or ["a brief"]) + ". Add a brief or research, or tell me these two."


def estimate_usd() -> float:
    """What the one call is expected to cost (advisory), for ``Spend.ask``."""
    import price_table
    from . import cost
    return round(price_table.usd("claude-sonnet-5-5", 8000, 2500) * cost.CALIBRATION, 4)


def run(doc: dict, llm, *, facts=None, findings=None, sources=None, category: str | None = None, market: str | None = None,
        prompt_text: str = "") -> dict:
    """The stage. One model call at most, none when the gate says to ask."""
    inp = carried.engine_input(doc, facts, findings, sources)
    has_input = bool(inp["brief"] or inp["facts"] or inp["findings"])
    if not has_input:
        gate = intake.assess({}, category, market, prompt_text)
        if gate["action"] != "proceed":
            return {"gate": gate, "words": ask_words(gate), "insights": []}
    pl = payload(inp)
    pl.update({k: v for k, v in (("category", category), ("market", market), ("prompt", prompt_text),
                                 ("title", inp["brief_title"] or inp["research_title"])) if v})
    try:
        obj, _ = llm("insights", prompt("insights"), json.dumps(pl, ensure_ascii=False))
    except Exception as e:          # a cap or a transport failure: say it in words, keep the run retryable
        msg = str(e) if e.__class__.__name__ == "CapReached" else "The model did not answer, so no insights were made. Try again."
        return {"error": {"stage": "insights", "message": msg[:400], "retryable": True, "refused": []}, "insights": []}
    rows, dropped = build((obj or {}).get("insights"), inp)
    if not rows:
        return {"error": {"stage": "insights", "message": "The model did not return an insight that rests on what was carried, so none were made. Try again.",
                          "retryable": True, "refused": []}, "insights": [], "dropped": dropped}
    ps = _shape_problems(rows, doc, facts, findings)
    if ps:
        return {"error": contract.refusal_error(ps, "insights"), "insights": [], "dropped": dropped}
    return {"insights": rows, "dropped": dropped}


def main(argv=None) -> int:
    import argparse
    from pathlib import Path
    from .spend import Spend
    ap = argparse.ArgumentParser(prog="territory.insights", description="Dev harness: insights from a spun-off document.")
    ap.add_argument("--doc", required=True, help="data.json of a spun-off Territories document (holds upstream)")
    ap.add_argument("--facts"), ap.add_argument("--findings"), ap.add_argument("--category"), ap.add_argument("--market")
    ap.add_argument("--live", action="store_true", help="a paid call through the model backend the environment names")
    ap.add_argument("--max-usd", type=float, default=0.5)
    ap.add_argument("--out", help="where to write the result (and the spend log beside it)")
    a = ap.parse_args(argv)
    load = lambda p: json.loads(Path(p).read_text()) if p else None
    if not a.live:
        print("Dry run: no model call made. Estimated about $%.2f for one call." % estimate_usd())
        return 0
    from .llm import LiveLLM
    sp = Spend(cap_usd=a.max_usd, store=Path(a.out).with_suffix(".spend.json") if a.out else None)
    sp.ask({"est_usd": estimate_usd(), "calls": 1})
    out = run(load(a.doc), sp.wrap(LiveLLM(approved=True)), facts=load(a.facts), findings=load(a.findings), category=a.category, market=a.market)
    out["spent_usd"] = sp.total()
    if a.out:
        Path(a.out).write_text(json.dumps(out, indent=1, ensure_ascii=False))
    for i in out.get("insights", []):
        print(f"{i['rank']:>2}. [{i['kind']}/{i['strength']}{'/derived' if i['derived'] else ''}{'/ticked' if i['ticked'] else ''}] {i['text']}  {i['evidence']}")
    print(out.get("error") or out.get("words") or "", f"spent ${sp.total():.3f}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
