"""CLI: python3 -m deck.bench {score,gold,design} ..."""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from . import experiment
from .gold import gold_report, judged_from_bench, load_human
from .judges import BenchError, ClaudeJudge, RecordedJudge
from .rubric import criterion_ids, load_rubric
from .run import label_run, run_bench


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
    a = ap.parse_args(argv)
    try:
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
