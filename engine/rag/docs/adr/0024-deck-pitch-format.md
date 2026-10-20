# ADR 0024 — Deck Maker: an 18-slide pitch by default, the rest in a hidden appendix

Status: accepted (Sai, 2026-10-05) · Code: `engine/deck/spec.py` (`FORMATS`, `PITCH_MAX`,
`PITCH_APPENDIX_TYPES`, `PITCH_CHARTS`, `PITCH_EXECUTIONS`, `PITCH_MERGES`), `assemble._arrange_pitch`,
`validate.py` (`pitch_length`), the three renderers · Builds on ADR 0016 · Register: DK-024.

## Context

The full deck ran to 31-32 slides: every requirement, territory, chart and process slide in story
order. Sai asked whether that was normal, then: "give the user an option to pick but default to the
agency pitch", and "should be 18 slides no?".

## Decision

1. `--format pitch` (default) presents at most 18 slides, then an Appendix divider, then backup.
   `--format full` keeps every slide in story order.
2. To the appendix: brief restated, scoring, the territories not chosen, territory choice, process,
   open questions, conflicts. At most 2 charts (those the fit judge supports) and 3 executions
   (chosen greedily by the mandated messages they carry) stay presented.
3. Merges: team with credentials, investment with next step; team comes before investment.
4. Renderers hide the appendix from the presented story: hidden `.pptx` slides, a web counter of
   `n / M` with A to open the appendix, a HyperFrames branch sequence behind an "Appendix" hotspot.

## Consequences

- A brief that asks for two routes keeps both territories presented and can reach 19 slides;
  `pitch_length` warns rather than fails (DK-024, open for Sai).
- Nothing is dropped: backup slides keep their refs and checks.
