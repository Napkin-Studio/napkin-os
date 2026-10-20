# ADR 0030 — Deck Maker: an objective slide, and a sketch tier for thin inputs

Status: proposed (for Sai) · Amends ADR 0024 · Builds on 0023, 0028 · Code: `engine/deck/spec.py` (`SLIDE_TYPES["objective"]`, `SKETCH_MAX_SLIDES`, `SKETCH_DOC_CHARS`, `SKETCH_LABEL`), `assemble.py`, `validate.py` (`objective_quant`)

## Context

DECK-CRAFT-PLAN (roadmap items 1, 3, 12) found that the pitch opened on the client's brief restated and never said what the
work must achieve, and that a deck built from a one-line prompt looked as finished as one built from a full brief. ADR 0024
fixed the pitch story as 18 slides with `brief_restated` in the appendix; it has no objective slide. The owner approved
building all twelve roadmap fixes, including this one.

## Decision

1. **The objective slide (amends ADR 0024).** A new slide type `objective` (50 words) is slide 2 of an agency pitch and a
   credentials deck, and follows the response map in a tender. Investor decks use it for the round and the milestones. It is
   built only from objective requirements, `brief.objectives` and the person's answer to the objectives question; it is
   absent when the inputs hold none. ADR 0024's appendix list stands: `brief_restated` stays behind the divider. This
   changes ADR 0024's presented story (one slide added, so the 18-slide default can now carry one more before trimming) and
   is proposed until the owner accepts it. `objective_quant` (warning) wants a number and a from/to in the first three slides.
2. **Stated limits win.** A slide or time limit stated by the buyer, the prompt or a document tightens the length in every
   profile; the least needed slides move to the appendix (`spec.TRIM_ORDER`), nothing is reworded.
3. **Sketch tier.** A deck from a prompt alone, or a prompt plus documents under `spec.SKETCH_DOC_CHARS`, presents at most
   10 slides, carries a fixed label on the cover and records `meta.sketch`.

## Consequences

- Tests: `tests/test_core.py`. The agency and investor goldens stay byte-identical when no objective is in the inputs.
- Only the engine and `spec` change; the app's `schema.json` does not yet know the type.
- Still to measure live: whether the objective slide raises the "clear objective" rubric score (plan 6, items 1 and 3 are
  built, the live measure is pending).

## Not decided

The exact slide position for every type, the word budget (50 is a default), whether the sketch limit of 10 and the character
threshold are right, and any rule that the sketch label must be removed by the person before export.
