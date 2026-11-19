"""CLI: python3 -m deck.bench {score,gold,design,checklist,fixtures,compare,visual} ..."""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from . import checklist as checklist_mod
from . import compare as compare_mod
from . import experiment
from . import fixtures as fixtures_mod
from . import visual as visual_mod
from .. import spec
from .gold import gold_report, judged_from_bench, load_human
from .judges import BenchError, ClaudeJudge, RecordedJudge
from .rubric import criterion_ids, load_rubric
from .run import label_run, run_bench


def _visual(a) -> int:
    """The ``visual`` subcommands. ``run`` shows a cost card and refuses a paid call without --live --yes-cost."""
    from . import visual_agree, visual_transport
    if a.vcmd == "renders":
        for n in fixtures_mod.FIXTURES:
            fixtures_mod.build_one(n, a.out_dir / n)
            fixtures_mod.build_one(n, a.out_dir / f"{n}__alt", extra=("--format", "full"))
            print(f"{n}: base and alt")
        return 0
    if a.vcmd == "pack":
        key_out = a.key_out or a.out.with_name(a.out.name + ".key.json")
        key = visual_mod.pack(a.runs, a.session, a.out, key_out, a.seed)
        print(f"{len(key['slides'])} slides ({sum(1 for s in key['slides'].values() if s['seeded'])} seeded, "
              f"{sum(1 for s in key['slides'].values() if s['repeat_of'])} repeats): page {a.out / 'index.html'}, key {key_out}")
        return 0
    if a.vcmd == "run":
        key = json.loads(a.key.read_text())
        transport = None
        if a.live:
            card = visual_mod.plan_cost(key, a.images, a.model, a.orders, a.max_usd, max_deck_usd=a.max_deck_usd)
            print(card["text"])
            if a.yes_cost != card["id"]:
                raise BenchError(f"a live run needs --yes-cost {card['id']} (the id on the card above)")
            transport = visual_transport.ApiTransport(visual_mod.PRIMARY["effort"])
        doc = visual_mod.run(key, a.images, transport, model=a.model, orders=a.orders, max_usd=a.max_usd, max_deck_usd=a.max_deck_usd,
                             recordings=a.recordings, record_to=a.record_to, live=a.live, card_id=a.yes_cost)
        a.out.write_text(json.dumps(doc, indent=1, ensure_ascii=False) + "\n")
        print(f"{doc['calls']} live calls, {doc['replayed']} replayed, {doc['unjudgeable_calls']} unjudgeable; ${doc['usd']:.4f} of ${doc['max_usd']:.2f}")
        return 0
    key = json.loads(a.key.read_text())
    doc = visual_agree.agree(json.loads(a.grades.read_text()), json.loads(a.visual.read_text()), key, a.seed)
    a.out.write_text(json.dumps(doc, indent=1, ensure_ascii=False) + "\n")
    print(", ".join(f"{q}: {v['state']}" for q, v in doc["questions"].items()))
    return 0


def main(argv=None) -> int:
    """Run a subcommand; returns the exit code (2 on a refused bench rule)."""
    ap = argparse.ArgumentParser(prog="deck.bench", description="Evaluation bench: blind judging, gold set, experiment design. No model call unless --live --claude-judge.")
    sub = ap.add_subparsers(dest="cmd", required=True)
    s = sub.add_parser("score", help="judge run directories blind, in both orders")
    s.add_argument("runs", nargs="+", type=Path)
    s.add_argument("--judgments", action="append", default=[], type=Path, help="a recorded judge file (repeatable: one per judge)")
    s.add_argument("--claude-judge", action="store_true", help="add a Claude judge (needs --live; paid)")
    s.add_argument("--live", action="store_true")
    s.add_argument("--profile", help="deck type id for the weights (default: the rubric's own split)")
    s.add_argument("--seed", type=int, default=0)
    s.add_argument("--hide", action="append", default=[], help="a string to scrub from packets (an arm name)")
    s.add_argument("--waiver", help="note that waives the 2-judge-family rule")
    s.add_argument("--label", default=None, help="stamp a label (trusted is refused unless the controls were met)")
    s.add_argument("--out", type=Path, required=True)
    g = sub.add_parser("gold", help="rank correlation of judges against human scores")
    g.add_argument("--human", type=Path, required=True)
    g.add_argument("--bench", type=Path, required=True)
    g.add_argument("--out", type=Path)
    d = sub.add_parser("design", help="write the run matrix and cost estimate (runs nothing)")
    d.add_argument("--clients", required=True, help="comma-separated")
    d.add_argument("--arms", default=",".join(experiment.ARMS))
    d.add_argument("--seeds", default="1,2")
    d.add_argument("--judges", type=int, default=3)
    d.add_argument("--out", type=Path)
    c = sub.add_parser("checklist", help="answer the visual checklist for run folders (no model, no network)")
    c.add_argument("runs", nargs="+", type=Path)
    c.add_argument("--out", type=Path)
    f = sub.add_parser("fixtures", help="build the invented fixture decks offline into OUT_DIR")
    f.add_argument("out_dir", type=Path)
    f.add_argument("--geometry-only", action="store_true", help="skip LibreOffice (no pixel checks)")
    f.add_argument("--density", choices=("lean", "standard", "detailed", "default"), default=None,
                   help="detailed (16:9 and A4): the tests' and goldens' setting; 4:3 builds at standard (spec.BENCH_DENSITY); default: let the engine "
                        "resolve it by format (the look a person gets)")
    f.add_argument("--size", choices=spec.SLIDE_SIZES, default="16:9", help="build the fixtures at this slide size (deck-slide-size); the summary records it")
    k = sub.add_parser("compare", help="what changed between two checklist files")
    k.add_argument("before", type=Path)
    k.add_argument("after", type=Path)
    k.add_argument("--format", choices=("text", "md", "json"), default="text")
    k.add_argument("--fail-on-regress", action="store_true", help="exit 1 on a regression, a worse metric or lost coverage")
    k.add_argument("--tolerance", type=float, default=0.0, help="a metric may move the worse way by this much (default 0)")
    v = sub.add_parser("visual", help="the vision critic bench: renders | pack | run | agree (no model call unless run --live --yes-cost)")
    vs = v.add_subparsers(dest="vcmd", required=True)
    r_ = vs.add_parser("renders", help="build two renders of each invented fixture deck (needs LibreOffice)")
    r_.add_argument("out_dir", type=Path)
    p_ = vs.add_parser("pack", help="write the blind grading page and the key (no model call)")
    p_.add_argument("runs", nargs="+", type=Path)
    p_.add_argument("--session", choices=("A", "B"), required=True)
    p_.add_argument("--out", type=Path, required=True)
    p_.add_argument("--key-out", type=Path, help="default: OUT.key.json beside the page folder")
    p_.add_argument("--seed", type=int, default=0)
    n_ = vs.add_parser("run", help="ask the critic the questions on the packed slides, under --max-usd")
    n_.add_argument("--key", type=Path, required=True)
    n_.add_argument("--images", type=Path, required=True, help="the packed page folder (the same PNGs the person graded)")
    n_.add_argument("--orders", type=int, choices=(1, 2), default=2)
    n_.add_argument("--max-usd", type=float, required=True)
    n_.add_argument("--model", default=visual_mod.PRIMARY["model"])
    n_.add_argument("--recordings", type=Path, help="replay recorded replies from here (free)")
    n_.add_argument("--record-to", type=Path, help="save each live reply here")
    n_.add_argument("--live", action="store_true", help="make paid calls with the API key")
    n_.add_argument("--max-deck-usd", type=float, default=visual_mod.DECK_CAP_USD, help="cap per deck (default and ceiling 0.40)")
    n_.add_argument("--yes-cost", metavar="CARD_ID", help="the id printed on the cost card: a live run is refused without it")
    n_.add_argument("--out", type=Path, required=True)
    g_ = vs.add_parser("agree", help="grade the critic and the code baseline against a person; write the trust file")
    g_.add_argument("grades", type=Path)
    g_.add_argument("visual", type=Path)
    g_.add_argument("--key", type=Path, required=True)
    g_.add_argument("--out", type=Path, default=visual_mod.TRUST_PATH)
    g_.add_argument("--seed", type=int, default=0)
    a = ap.parse_args(argv)
    if getattr(a, "max_deck_usd", None) is not None and a.max_deck_usd > visual_mod.DECK_CAP_USD:
        ap.error(f"--max-deck-usd {a.max_deck_usd}: the per-deck cap is at most {visual_mod.DECK_CAP_USD:.2f}")
    try:
        if a.cmd == "visual":
            return _visual(a)
        if a.cmd == "checklist":
            out = checklist_mod.run_all(a.runs)
            if a.out:
                a.out.write_text(json.dumps(out, indent=1, ensure_ascii=False) + "\n")
            for d, x in out["decks"].items():
                s = x["summary"]
                print(f"{d}: {s['yes']} yes, {s['no']} no, {s['na']} n/a")
            return 0
        if a.cmd == "fixtures":
            dens = spec.BENCH_DENSITY[a.size] if a.density is None else (None if a.density == "default" else a.density)
            for n, p in fixtures_mod.build_all(a.out_dir, a.geometry_only, density=dens, size=a.size).items():
                print(f"{n}: {p}")
            return 0
        if a.cmd == "compare":
            try:
                diff = compare_mod.compare(json.loads(a.before.read_text()), json.loads(a.after.read_text()), a.tolerance)
            except ValueError as e:   # deck-slide-size: two sizes are never compared
                raise BenchError(str(e)) from e
            print(compare_mod.render(diff, a.format))
            return 1 if a.fail_on_regress and compare_mod.failed(diff) else 0
        if a.cmd == "design":
            out = experiment.design(a.clients.split(","), a.arms.split(","), [int(x) for x in a.seeds.split(",")], judges=a.judges)
        elif a.cmd == "gold":
            bench = json.loads(a.bench.read_text())
            out = gold_report(load_human(json.loads(a.human.read_text())), judged_from_bench(bench), criterion_ids(load_rubric()))
        else:
            judges = [RecordedJudge.load(p) for p in a.judgments]
            if a.claude_judge:
                judges.append(ClaudeJudge(live=a.live, confirmed=True))
            if not judges:
                raise BenchError("no judge: give --judgments FILE (recorded) or --live --claude-judge")
            out = run_bench(a.runs, judges, seed=a.seed, profile_id=a.profile, hide=a.hide, waiver=a.waiver)
            if a.label:
                out["scoring_run_meta"] = label_run(out["scoring_run_meta"], a.label)
    except BenchError as e:
        print(f"refused: {e}", file=sys.stderr)
        return 2
    if getattr(a, "out", None):
        a.out.write_text(json.dumps(out, indent=1, ensure_ascii=False))
    print(out["line"] if a.cmd == "design" else json.dumps({k: v for k, v in out.items() if k in ("criterion_means", "weakest_criterion", "untrusted", "scoring_run_meta", "flip", "warnings", "decks")}, indent=1, default=str))
    return 0


if __name__ == "__main__":
    sys.exit(main())
