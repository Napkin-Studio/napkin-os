# ADR 0028 — Deck Maker: stands alone, takes whatever the person gives, and is better with the pipeline

Status: **proposed** (Claude, 2026-10-16, from the owner's message, for Sai to confirm) · Amends ADR 0023 ·
Features: `features/deck-maker-intake.clan` (the standalone path), `features/deck-maker-handoff.clan` (the
pipeline path) · Code: none yet.

## Context

ADR 0023 is Sai's rule, verbatim: "the pitch deck cannot have any extra information as input apart from
the prompt user gave, the research tool output and the brief tool output. that is all." Its point 1 already
counts documents attached to the brief as brief material.

On 2026-10-16 Sai said: the Deck Maker should be independent, so that someone who sends a one-line prompt
still gets a deck; sent through the pipeline (research, then brief, then deck) it will be much better; and it
should be allowed to be prompted with all the information and documents the person has.

Today a brief is required (`run_deck.py --brief`, the app's Start screen marks Brief "Needed").

## Decision (proposed)

1. A deck can be built from any of: a prompt (one line to many pages), documents the person attaches, the
   research tool's output, the brief tool's output, in any combination. No single one is required except
   that at least a prompt, a document or a brief is present.
2. Documents attached to the prompt count as the person's own prompt, the same way documents attached to the
   brief count as brief material (ADR 0023 point 1). Every page of every document is read.
3. The guard of ADR 0023 is unchanged: nothing else may add facts, names or legal lines to a slide. A figure
   on a slide must trace to the prompt, a document, the brief or the research (`numbers_trace`). Where nothing
   supports a claim it is labelled proposal, creative or opinion, and what only the person knows stays a
   labelled placeholder.
3a. **Outside facts enter only through the Research Tool.** When what the person gave is not enough, the Deck
   checks what it cannot ground, asks targeted questions, and, only with the person's yes, launches the
   Research Tool on the same prompt and documents. Its output (sourced pins with verbatim quotes, findings a
   person verifies) is an allowed input and reaches the Deck as a spin-off. The Deck never searches the web or
   any knowledge source itself, and never launches research unasked: research spends the agency's shared quota.
4. Precedence where inputs overlap: the brief and research first, then documents (a document that disagrees
   with the brief wins and the conflict is listed, ADR 0025), then the prompt. A prompt or document only fills
   what the brief leaves empty.
5. Every deck records what it was built from (`built_from`) and says so wherever it is shown. A deck built
   from a prompt alone is a review draft: its evidence is thin and the app says so.
6. "Better with the pipeline" is a claim to measure, not assume: the same client is built three ways (prompt
   only, prompt and documents, full pipeline) and scored by `deck.evaluate`.

## Consequences

- The Deck no longer depends on the Brief Maker to exist. The pipeline remains the strong path because its
  inputs were reviewed by a person: sources on figures, decisions on findings, mandatories as requirements.
- A one-line deck will have many placeholders and few traced figures. That is correct, and must be visible.
- Words are still not checked in code (DK-025), and a thin input leaves the model more room to add outside
  facts; the prompts forbid it and the evaluation counts it.
- Amends a rule the owner wrote verbatim: this ADR stays proposed until Sai confirms the wording.
