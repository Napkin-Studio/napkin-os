# Brand Clan

This document is a Brand Clan: everything the agency knows and keeps about one
brand that is not a measured fact. It is one kit per brand per agency, and the
shelf calls it the brand kit. Briefs, research and production projects carry a
frozen copy of it with a version, and the copy updates only when a person asks.

It holds identity, strategy, voice, the visual language (logos, colours,
typography, imagery, graphic devices, layout, motion), sound, a flat list of
rules, channel formats, people, and the approved work made for the brand. All of
it lives in `shared/data.yaml`, in the shape of `agent/output-schema.json`.

## What you may and may not write

- **You never invent a fact.** A figure (awareness, share, a launch date, a
  roster category, the client organisation) is a pin in `shared/facts.yaml` from
  the brand layer. The kit never holds a figure's value; an item that rests on
  one cites its pin in `fact_ids`.
- **You never fetch the web and never call a model from this document.** The kit
  is seeded from the roster and the brand layer, from a brand book a person
  supplied, and from what a person types. Nothing else.
- **Origin must be honest.** Every item carries `origin`:
  - `extracted`: read from supplied material. It must carry `source`
    `{material_id, locator, quote}`; the locator is a page ("p.14"), the quote is
    the words as they are on the page.
  - `proposed`: derived from roster or layer pins. It must carry `fact_ids`
    (at least one).
  - `stated`: a person typed it. It must carry `by` (`human:<id>`).
  - `confirmed`: a person accepted it, as read or corrected. It must carry `by`.
  Never write `stated` or `confirmed` for something a person did not do, and
  never overwrite an item whose origin is `stated` or `confirmed`: propose
  instead and let a person decide.
- **Absent means not filled.** No empty strings, no placeholders, no defaults.
- **Maps are keyed by id**, never positional arrays of objects, so every item
  has an address (`#visual.colours.lumen-blue`).
- **`rules[].severity` is always `warn`.** A brand rule never blocks work.
- **Never write `upstream`, `projection` or `kit`.** The host writes them.
  `kit.version` changes only when a person publishes.

## How a brand book is read

When a person drops a brand book (PDF) on the kit, each thing read from it becomes
an `extracted` item with a `source` pointing at the page:

- logos become `visual.logos`, with the page's images as assets;
- colours become `visual.colours`, with hex and role;
- type becomes `visual.typography` with **no file**: a font is never taken from a
  PDF, and `file` arrives only by an upload that also states the licence;
- tone becomes `voice.principles`, and its words `voice.tone_words`;
- do and don't lines become `rules`, one line each, each with an `area`.

Where the book says nothing, leave the item out.

## What other documents take from it

A brief lifts `brand.name.value` into its client, `voice.tone_words.value` into
its tone and world, and `voice.mandatories.value` into its mandatories, only where
those are still empty. The three are plain lift sources: each holds exactly the
value its target wants. A brief offers its single-minded proposition back to
`strategy.proposition.value` once the client accepts it, and a person confirms.
