# ADR 0025 — Deck Maker: an investor deck kind, with client documents as evidence

Status: proposed (Claude, 2026-10-06, for Sai to review) · Code: `engine/deck/stages.py` (`investor`,
stage i), `prompts/i_investor.md`, `assemble.build_investor`, `inputs.py` (`load_brief_clan`,
`load_doc`), `spec.py` (`KINDS`, `INVESTOR_TYPES`, `INVESTOR_HOME`), `run_deck.py` (`--kind`, `--doc`,
`--brand`) · First run: a seed-round deck, 2026-10-05 · Register: DK-026.

## Context

Sai supplied a founder seed pitch: a Brief Maker CLAN, the founders' deck (PDF and Keynote), a video
script and brand files. An agency response deck (territories, executions, channels) is the wrong
shape for investors.

## Decision

1. `--kind investor` runs one Opus stage (i) that writes the investor story: problem, why now,
   solution, product, market, business model, traction, competition, go-to-market, financials,
   upside, founders, ask, risks, close. The fit judge and copy stage run as for agency decks.
2. `--doc KEY=PATH` loads a client document page by page (PDF pages tagged `[pN]`), cited as
   `doc:KEY#pN`. A Brief Maker CLAN can be passed as `--brief` directly.
3. Where the brief and a document disagree, the document wins and each conflict is listed on an
   internal `conflicts` slide (needs_human) for the founders to resolve.
4. Brief mandatories become requirements; rule-type mandatories ("Avoid", "Never", "Do not") become
   whole-deck rules checked by `rule_broken`.
5. `--brand` applies the client's colours, fonts and logo in all three renderers.

## Consequences

- One run so far (that run: 16 presented slides, 0 errors, 8 conflicts, 11 headlines only partly
  supported). Treat the investor kind as experimental until more briefs are run.
- The 8 conflicts came from Brief Maker ignoring the attached Keynote (DK-026); the fix belongs in
  the brief tool.
