# ADR 0016 — Deck Maker: the deck schema and the stage design

Status: proposed (Claude, 2026-10-02, for Sai to review) · Code: `engine/deck/` (`spec.py`,
`deck.schema.json`, `inputs.py`, `refs.py`, `assemble.py`, `validate.py`, `render_pptx.py`,
`stages.py`, `run_deck.py`, `packs/`) · Tests: `engine/deck/tests/test_validate.py` · Plan:
`docs/deck-maker/PLAN.md` · Register: `docs/deck-maker/edge-cases.md`.

## Context

Napkin OS chains research → brief → deck (os-layer.md §5.2: the deck holds `upstream.<research>`
and `upstream.<brief>`). The brief maker writes `brief_object.json`; nothing turned it into the
deck an agency presents. Agencies build a pitch in gated stages (brief and scoring read, strategy,
a tissue session over several territories, one idea and its executions, channels, measurement,
timeline and money, team, review), and present 20-30 slides. Three things must hold for Napkin:
every number traceable, nothing a person decided ignored, and nothing a person must supply invented.

## Decision

1. **The deck is data first, rendered second.** `deck.json` is the contract; the .pptx and PDF are
   renders of it. Slides are keyed by id (`slides.s07`) with an `order` list, so each slide is a
   dotted data path: a client-review part (os-layer.md §7.5.1 forbids entity-keyed segments) and
   an `/edit` target.
2. **Each slide** has a type from a fixed set (24 types, `spec.SLIDE_TYPES`), a full-sentence
   title, blocks, claims with refs, a visual (layout, native chart, or an image prompt marked
   "illustrative, not final"), speaker notes with the evidence, a status (`from_source`,
   `drafted`, `needs_human`) and the requirement ids it answers.
3. **Refs** reuse the OS prefixes (`f_`, `fi_`) and add `doc:<doc>#<locator>` (a client-document
   figure or passage), `brief:<path>`, `req:<id>` and `calc:<arithmetic>`. A claim with no ref has
   basis `creative`, `opinion` or `proposal`.
4. **Stages.** Model stages write JSON files (a requirements, a2 figures from image-only pages,
   b storyline, c territories plus a blind judge on another model, d idea and executions, e slide
   copy); plain code assembles, validates and renders. A recorded stage file and a live stage are
   interchangeable, so a deck rebuilds for free and a stage can be re-run alone. Gates: Sai
   approves the storyline (1), a person picks the territory (2, default the judge's pick, flagged),
   a person reviews the rendered deck (3).
5. **Validators are code**, not a model: numbers trace, rejected findings never used, low-confidence
   pins flagged, word budgets per type, requirement map, category safety packs and legal lines,
   labelled placeholders on human-only slides. A failed check is shown on the slide.
6. **Renderer: python-pptx** onto a built-in theme, or onto an agency `.potx` master when given.
   Native charts from fact values, PowerPoint sections, notes. Rejected: pptxgenjs (a second
   language and a new tracked node dependency for no capability we need), Gamma (it decides the
   layout and drops traceability), Figma/Canva first (seat and plan limits; later routes).

## Consequences

- A deck can be checked without reading it: `validation.json` and `report.json` say what is traced,
  what is unverified and what a person must supply.
- The renderer owns layout; a designer's master changes the look without touching the pipeline.
- Category packs need primary-source verification before production (edge cases DK-012).
- Not yet built: live stages (cost approval), the Napkin app template and spin-off from Brief Maker,
  the visual-QA model loop, and image generation.
