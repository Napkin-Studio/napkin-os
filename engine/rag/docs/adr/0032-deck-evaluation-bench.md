# ADR 0032 — Deck Maker: an offline evaluation bench

Status: proposed (for Sai) · Builds on 0006, 0013 · Code: `engine/deck/bench/`, `engine/deck/rubric.json`, `tests/test_bench.py`

## Context

DECK-CRAFT-PLAN 4.3 and 5.1, and TEST-RESULTS, showed the pilot's evidence was thin: a few decks, one judge, order effects
unmeasured and length confounded with score. "The pipeline makes it better" was felt, not measured (roadmap item 7).

## Decision

1. A bench scores finished decks against the nine-criterion rubric in `rubric.json`, blind (labels from a seeded
   permutation, metadata and run names stripped) and in both orders; a pair that flips counts as a tie.
2. Weights are the buyer's when the tender states them, else the profile's split labelled "default, not validated".
3. Judges are Claude-only by default. A non-Claude judge hook exists and refuses unless `DECK_BENCH_ALLOW_NON_CLAUDE=1`.
   A Claude judge refuses without `--live --claude-judge`.
4. A run is `trusted` only with two or more judge families or a waiver, both orders, a flip rate and a length-adjusted score.
5. A 12-deck human gold set marks any criterion with Spearman rho under 0.6 `untrusted`. An experiment designer writes the
   clients x arms x seeds matrix and a cost range; it runs nothing.

## Consequences

- No model call in tests (recorded judgments). The bench can be rerun on any set of run folders.
- The first live bench run, the gold set and the 72-build matrix are not done: the measures for items 2, 4, 8 to 11 stay
  pending until they are.

## Not decided

Which clients are in the matrix, the real cost cap, whether a second judge family is ever enabled, and the threshold for
"better" at the gate (a minimum score gain or flip rate).
