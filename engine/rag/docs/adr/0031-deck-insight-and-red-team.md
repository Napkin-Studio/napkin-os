# ADR 0031 — Deck Maker: insight candidates, headline narrowing and a red team

Status: proposed (for Sai) · Builds on 0016, 0023 · Code: `engine/deck/stages.py` (`insight_judge`, `red_team`, `copy`), `assemble.py` (`valid_candidates`, `judge_verdicts`, `apply_narrowing`, `apply_red_team`), `validate.py`, `prompts/insight_judge.md`, `prompts/red_team.md`

## Context

DECK-CRAFT-PLAN 3.3-3.5 found the insight slide was often a generic observation (the writer's own pick, no check), headlines
claimed more than their slide showed (the fit judge said so, nothing acted on it) and nobody argued against the deck before
the person saw it (4.2). Roadmap items 2, 4, 6 and 8.

## Decision

1. **Insight candidates.** Stage b writes three candidates (behaviour, feeling, category). A separate Sonnet judge, shown
   them blind, answers four yes/no tests; pass or fail is computed in code. The chosen insight is the first passing one, else
   the writer's. Candidates and verdicts are in `deck.meta.insight*` as the Gate 1 payload (the app does not read them yet).
2. **One idea and a chain.** Stage d writes a chain of quoted phrases; checks `insight_shape`, `idea_single`, `chain_links`
   are warnings. A relay test is recorded, never blocking.
3. **Headline narrowing.** Stage e may rewrite a headline the fit judge marked `not` or `partly`; code accepts it only if it
   adds no number and is not longer by more than 3 words.
4. **Red team.** One Sonnet call reads the finished deck and returns at most 6 objections (`spec.RED_TEAM_KINDS`). Code
   applies at most one headline-wording or order change per objection; everything else is left for the person and shown at
   the gates.
5. Every new model stage is skipped quietly when its recorded output is absent and the run is not `--live`.

## Consequences

- Old recorded stage directories rebuild unchanged; a stage b with no candidates builds the old insight slide.
- Judges are Claude-only by default; any non-Claude judge stays off (see 0032).
- All four items are built and tested offline with stubbed `_call` and invented fixtures (`test_thinking.py`,
  `test_redteam.py`). Items 2, 4 and 6 are built, measure pending a live run; item 8 is partial.

## Not decided

Whether the judge may overrule the writer in production, a separate storyline-only red-team pass before Gate 1, an
editable Gate 1 screen for candidates, and a model judge for the relay test.
