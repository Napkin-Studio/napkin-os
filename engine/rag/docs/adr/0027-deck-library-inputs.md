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

## Decision needed from Sai (written 2026-11-17 for `features/deck-visual-contract.clan`)

Still **proposed**. The deck visual contract (`docs/contracts/deck-visuals.md`, ADR 0036) defines the
shapes for a brand's look and for pictures. With no answer here the shapes exist and nobody writes them:
`inputs.library.enabled` stays off and a deck is today's deck.

**Revised the same day.** Sai, 2026-11-17: how a deck should be is the user's choice, asked by the tool
with sensible defaults, not policy. So which slides carry pictures, whether pictures may be generated and
at what cap, which Style Pack, whose brand, who approves and the label are now deck preferences
(`deck-visuals.md` §6.3), and they are no longer questions here. What is left is the rule itself.

### The question

May a deck take inputs that change how it looks (a brand's colours, fonts and logo; a style for its
pictures; the pictures themselves), on the condition that none of them adds a fact, a name, a number or a
legal line to a slide?

| | Answer | Effect |
|---|---|---|
| Accept | Presentation inputs are allowed. The user chooses, per deck, whether pictures are only ones that exist (the default: nothing is sent out, nothing is spent) or may also be generated (a cost card, a cap, a person's approval of every picture) | `inputs.library.enabled` may be turned on; the preference questions appear |
| Reject | Nothing new. `--brand` and `--master` stay as they are | The panel stays off. The contract drops the image slot, the asset registry and the picture, Style Pack and brand preferences, and keeps layouts, slots, density, the theme stamp and issues |

The revision reads as Accept. It is written here as still open because this file's status is Sai's to
change, and because of the four points below.

### Four points the wording has to settle

Each was found by reading the code against the proposal above; none is covered by its four points.

1. **Say "information", not "inputs".** ADR 0023 reads as "no extra inputs", and the engine already takes
   `--brand FILE`. Proposed wording: *facts, names, numbers and legal lines come only from the prompt, the
   documents, the research and the brief. Look and pictures are presentation inputs. They change how a slide
   looks and never what it says.*
2. **A logo is a name.** ADR 0023 point 4: the agency name appears only when the prompt gives one.
   Proposed: a logo is placed only for a brand whose name the inputs already give (the client, or the
   agency the prompt names), whichever brand the user chooses to wear. A kit never puts a new name on a
   slide.
3. **The Territory tool brings words, not only pictures.** `deck-frames-in` lets a saved Territory run
   stand in for stage c, and puts each shot's on-screen line on the slide as text. Those are words from a
   fourth tool, and "look and pictures" does not cover them. A Territory run also works from an assumed
   brief, in which a field may be tagged `assumed`: proposed by the tool, not given
   (`engine/territory/prompts/assumed_brief.md` on `feat/territory-slice`). Either the Territory tool's
   output is named as an allowed **creative** input (basis `creative`, never `sourced`, and only when it
   was run on the deck's own brief or research), or the frames come in and the lines stay out.
4. **What no preference can change.** The deck reads a Brand Clan's `visual.*` and its checkable `rules`;
   it never reads `voice`, `strategy`, `claims` or `legal_lines`. Alt text is written by code from the
   slide's own subject, never from a picture's metadata. A Style Pack's words go into an image prompt and
   never onto a slide. A picture goes only on the creative slide types of `deck-visuals.md` §4.4 (point 4
   above, "only where the slide already says illustrative", allows only `territory` and `execution` today)
   and never on an evidence slide. A part marked Confidential with `model: false` is never sent to a
   provider (os-layer §4), and a prompt never carries a brand name, a person's name or a figure.

Still an organisation's call, not a user's: whether the local Ollama guard is acceptable as a non-Claude
check that can only add a flag, and which reference images may be sent to an image model at all.

### What to write back

One line is enough: Accept or Reject, and for each of the four points "as proposed" or the change. The
answer goes in this file's Status line and in `features/deck-visual-contract.clan` before any schema is
written.
