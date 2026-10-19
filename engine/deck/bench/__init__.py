"""The evaluation bench (roadmap item 7): blind judge packets, both orders, length-adjusted scores, a gold set.

    python3 -m deck.bench score RUN_DIR [RUN_DIR ...] --judgments J.json [--profile ID] --out bench.json
    python3 -m deck.bench gold --human human.json --bench bench.json
    python3 -m deck.bench design --clients a,b --arms prompt,prompt+documents,brief+research --seeds 1,2 --out matrix.json

The bench makes no model call unless ``--live --claude-judge`` are both given (ADR 0006: judges are
Claude-only by default; a non-Claude judge needs DECK_BENCH_ALLOW_NON_CLAUDE=1). Modules: ``rubric``
(rubric.json and weights), ``packets`` (blinding), ``judges`` (the Judge protocol and adapters),
``stats`` (Spearman, regression, noise), ``run`` (scoring a set of decks, scoring_run_meta),
``gold`` (human rank correlation), ``experiment`` (the run matrix and its cost).
"""
