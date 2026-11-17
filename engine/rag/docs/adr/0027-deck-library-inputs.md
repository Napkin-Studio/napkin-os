# ADR 0027 — Deck Maker: optional team-library brand kit and pictures (accepted)

Status: **accepted 2026-11-17 (Sai, approved in chat)**, with the four wording points below applied. Written
2026-10-15 for `features/deck-maker-ui.clan`; first decided for `features/deck-visual-contract.clan` ·
Amends ADR 0023 · Code: the shapes are in the deck schemas (ADR 0036); nothing writes them yet. The Deck Maker app
shows the panel behind a flag that is off (`inputs.library.enabled`).

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

## Decision (Sai, 2026-11-17)

**Accepted.** Look and pictures are allowed information. They change how a slide looks and never what it says:
they never add a word, a number or a legal line. Every picture is `basis: creative` and is labelled
Illustrative until a person approves it. How a deck should be is the user's choice, asked by the tool with
sensible defaults (`docs/contracts/deck-visuals.md` section 6.3): the default is existing pictures only, so
nothing is sent out and nothing is spent, and generating is a per-deck choice behind a cost card, a cap and a
person's approval of every picture. `inputs.library.enabled` stays the one gate and stays off until the app
turns it on.

### The wording, with Sai's four points applied

ADR 0023 is read as follows. *Facts, names, numbers and legal lines come only from the prompt, the documents,
the research and the brief. Look and pictures are presentation information. They change how a slide looks and
never what it says.*

1. **Say "information", not "inputs".** The rule is about what a slide may say. The engine already takes
   `--brand FILE`, so it was never "no extra files".
2. **A logo is a name.** A logo is placed only for a brand the information already names (the client, or the
   agency the prompt names), whichever brand the user chooses to wear. A kit never puts a new name on a slide.
3. **The Territory tool's words are an allowed creative input.** Territory text and a shot's on-screen line may
   stand on a slide as `basis: creative`, never `sourced`, and only when the run was made on the deck's own brief
   or research. A field the Territory run tagged `assumed` stays marked as proposed.
4. **No preference can change facts from the brief.** The deck reads a Brand Clan's `visual.*` and its
   checkable `rules`; it never reads `voice`, `strategy`, `claims` or `legal_lines`. Alt text is written by code
   from the slide's own subject, never from a picture's metadata. A Style Pack's words go into an image prompt
   and never onto a slide. A picture goes only on the slide types of `deck-visuals.md` section 4.4 and never on
   an evidence slide. A part marked Confidential with `model: false` is never sent to a provider (os-layer
   section 4), and a prompt never carries a brand name, a person's name or a figure.

### Also decided the same day

- The local Ollama image guard is acceptable as a non-Claude check, because it can only add a flag. It sits beside
  ADR 0006's rule "Claude only, and say who answered" (non-Claude links are dropped unless allowed): this is the
  one allowed exception, because the guard can only add a flag, never pass, block or change a picture or a word,
  and the result says who answered (`deck.assets.<id>.guard.by` is `ollama:<model>`, or `not checked`).
- A frame approved in the Territory tool does not count as approved in the deck: it arrives `made`, and one
  click by the deck's approver approves all four frames of a territory.
- Still Laurence's, with defaults recorded until he answers (`deck-visuals.md` section 11): which slides carry
  pictures, the Style Pack, who approves, critic grading, and which reference images may be sent to an image model.

### Amendment, 2026-11-17 (Sai, in chat, after the design review of `deck-look-kits`): the agency accent

One exception to "library off means today's deck". **The agency accent applies automatically.** An agency that has set up a
look (the People page) has its accent (`accent`, `accent_ink`) on every new deck, with no `inputs.library.enabled` and no
switch to find, and a deck opts out with `look.agency_look.use: false`. The accent is colour only: it adds no word, number,
name or legal line, so the reason for the gate (no outside information reaches a slide) does not apply to it. Agencies with
no look keep today's default theme. Nothing else of the agency look is read: its `base` is shell chrome, and no logo or
wordmark is taken. An existing deck keeps the look it was built with and is never re-dressed on its own; a person chooses
"update to current look". The gate still holds for the Style Pack and the Brand Clan. A client's logo goes on the cover only
when the kit's brand name matches the brief's client (the logo rule above: only for a brand the information already names).
A reference marked `licensed` by a pack steward, with a reason and the licence holder and terms, may go to an image model.
