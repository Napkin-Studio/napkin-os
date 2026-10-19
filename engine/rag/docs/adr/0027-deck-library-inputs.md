# ADR 0027 — Deck Maker: optional team-library brand kit and pictures (proposed)

Status: **proposed, not accepted** (written 2026-10-15 for `features/deck-maker-ui.clan`; needs Sai's decision) ·
Amends ADR 0023 · Code: none yet. The Deck Maker app shows the panel behind a flag that is off.

## Context

ADR 0023 is Sai's rule, verbatim: "the pitch deck cannot have any extra information as input apart
from the prompt user gave, the research tool output and the brief tool output. that is all."

The Deck Maker UI mock offers "From the team library": a brand kit (logo, palette, fonts) and
pictures that replace the "illustrative" placeholders. Neither adds a fact, a name or a legal line,
but both are inputs beyond the three, so adding them is a rule change, not a feature detail.

Two things in the code make this less clean than the mock suggests:

- The engine already takes `--brand FILE` (`engine/deck/README.md`, the investor example), so
  the rule is already read as "no extra facts", not "no extra files". The ADR text does not say so.
- The Production Tool's library (`production-tool/relay/library.py`) holds picture reference keys
  only. There is no brand kit entry, and it is scoped by the Production Tool's workspace sign-in.

## Proposal

1. Brand (logo, colours, fonts) and pictures are **presentation inputs**. They may change how a
   slide looks. They may not change what it says: no text from a brand file or a picture's metadata
   reaches a slide, and a number is never taken from them.
2. They are optional and off by default. A deck built without them is identical to today's.
3. Each is shown on the Start screen as an input and recorded in `deck.json` meta, so a reader can
   see which brand and which pictures a deck used.
4. A picture takes the place of a placeholder only where the slide already says "illustrative";
   it never adds a slide or a claim.

## Open

- Where a brand kit comes from: a new entry kind in the Production Tool library, or an upload.
- How a Deck app finds a library workspace under the OS's roster sign-in.
- Whether the amendment should instead be worded "no extra information" (facts, names, legal lines)
  and say plainly that look and imagery are allowed.

## Consequences

If rejected, the panel stays off and nothing else changes. If accepted, the engine reads the
inputs through the existing `--brand` path first; pictures need a new, separate step.
