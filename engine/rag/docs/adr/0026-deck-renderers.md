# ADR 0026 — Deck Maker: three renderers from one deck.json (web, .pptx, HyperFrames)

Status: accepted for the web deck and HyperFrames (Sai, 2026-10-05: "animated web deck", "lets try
both"); proposed for the details (Claude, 2026-10-06) · Code: `engine/deck/render_web.py`,
`render_pptx.py` (`--animate`), `render_hyperframes.py` (`--hyperframes`, `--builds`) · Builds on ADR
0016 §6 · Register: DK-028.

## Context

ADR 0016 rendered only to `.pptx`. Sai wanted animation and a deck that presents well in a browser,
and asked for animations inside the `.pptx` too.

## Decision

1. **Web deck** (`deck.html`, always written): one self-contained file with entrance animations,
   build mode (B), overview (O), presenter view (P) synced only with its paired window, the appendix
   (A), print, and fit-to-screen scaling. Brand colours and logo applied.
2. **PowerPoint** keeps python-pptx; `--animate auto|click` adds a fade transition and entrance
   builds per block. Appendix slides are hidden, not removed.
3. **HyperFrames** (`--hyperframes`): a slideshow project with one root composition and one GSAP
   timeline; clip `data-start` is relative to its scene; the appendix is a branch sequence. Present
   with `npx hyperframes present`; it is a deck, not a rendered video.
4. All three read the same `deck.json` and `validation.json`; layout and motion are in the
   renderer, never in the deck data.

## Consequences

- Three renderers to keep in step when a block type is added.
- The `.pptx` animations have not been opened in PowerPoint or Keynote, and nothing checks
  rendered slides (stage h is not built). DK-028.
- Execution mockups (phone, search, audio, poster) exist in the web deck and HyperFrames (which reuses `render_web.slide_views`), not in the `.pptx`.
