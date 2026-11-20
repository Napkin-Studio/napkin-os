# Contract: the production brief, and the Deck reading Production contract 3 (proposal)

Status: **proposal** · Feature: `features/deck-handoffs.clan` · Owner: Sai · Readers: the Production Tool (to take the brief in),
`engine/deck/production_brief.py` (writes it), `engine/deck/from_production.py` (reads Production's finals and rights).

Production contract 3 (`production-tool/contracts/`, develop) has no production brief. Its `briefs` are Brief Nodes: a Brief Maker
brief's **spine** (`common.schema.json` `briefSpine`: insight, proposition, audience, tone, feel, mandatories, donts, format), frozen
and read-only. So the Deck writes a document of its own whose `spine` is a valid `briefSpine`, and proposes how Production takes the
rest in. Nothing here changes Production's contract; adopting it is Shrey's decision (contract README, "Locked (D1)").

## The production brief

Written once the deck is built from an approved idea (gate 3), beside the deck: `production_brief.json` (this shape) and
`production_brief.md` (the same, for a person). No model call. What the inputs do not say is `[To supply]` and listed in `to_supply`.

```
{ kind: "napkin.production_brief", version: 1, for: "ie.napkin.production-tool", contract: "3", status: "proposal", label,
  client, project,
  spine:       briefSpine,                               # insight, proposition, audience, tone, feel, mandatories (<= 6), format; each cut at a word to its length
  concept:     { territory {id, name, origin: model|human}, line, idea, manifesto | null,
                 key_visual: { source: production | stage_d | execution | none, label: Final | From Production | Illustrative | To supply,
                               item?, sha256?, rights?, final?, width?, height?, description? } },
  script:      { length_s?, title?, channel?, text?, lines: [{...}] } | null,   # stage d's script when it writes one; read defensively
  deliverables:[{ id, channel, lane: film|social|ooh|print|display|audio|other, role, copy[], visual, script?,
                  formats: [{ pack_id, pack_version, format_id, name, kind, ratio, delivery_px {width, height}, bleed_mm? }],
                  formats_basis, lengths_s? }],
  mandatories: [text],
  rights:      { term, territory, talent, music, voice, pictures, needs: [talent|music|voice|pictures], note },
  timing:      [{ phase, when }],
  to_supply:   [text],
  human_edits: [{ key, after, by, at }],                 # the words a person wrote at the gates (deck.gate_edits)
  made_from:   { b, c, d: produced_by } }
```

- **Deliverables** are stage d's executions. The lane is read from the channel's words (`lane_of`) and matches contract 3's
  `formatChannel` (film, social, ooh, print, display), plus `audio` (no format pack) and `other`. Formats are a proposal from the pinned
  format packs (`engine/deck/vendor/format-packs.json`, the same file Production's packs come from): the commonest two or three of the
  lane, moving or still by the channel's words. The producer picks the final set in Make all sizes.
- **Key visual**: a Production picture the client may see (a final first, then a master, a size, a frame), else stage d's
  `key_visual`, else the first execution's picture description, labelled Illustrative.
- **Rights needs** come from the lanes (film: talent, music, voice; social: talent, music; audio: voice, music; ooh and print: pictures,
  talent; display: pictures). Term is always to supply; territory is the market when the run knows it.
- **Spine** is a valid `briefSpine`: Production can hold it as a Brief Node and link it into a Script, Storyboard or Format set.

### How Production could take it in (proposed)

1. A Brief Node made from `spine` (`source.how: "spinoff"`, `source.app_id` the Deck's), so every job in its scope reads it.
2. One Format set per still deliverable's lane, its `plan` the proposed `formats`; a Script from `script.lines` when present
   (its 600-character action rule applies), with `lengths_s` as the cut-down plan.
3. `rights` shown on the Campaign board as the asks a producer settles; each asset then records its own `rights`.

## The Deck reading contract 3's finals and rights (develop #257)

`engine/deck/from_production.py` reads Production's export or `.clan`:

- `assets[sha].rights`: `unknown` is rights to supply; a person's `own` or `licensed` on an upload or extract places it; `generated`
  stated on a picture Production did not make is not believed, and a value outside the enum is ignored (both named in `warnings`).
  Mock output is refused whatever it states. Absent: inferred from origin, as before.
- `finals`: a final of a size or a frame offers the exact picture it names, marked `final {id, at, by, version?}`, ahead of the shot's
  pick and even when the size is being remade; a final of a Format set's master picture marks the master. Every final is listed under
  `production.json` `finals` with its rights, `client_showable` and the item that carries it (or why none does yet).
- Every item says `client_showable` (generated, own or licensed) and `asset_size {w, h}`; `relay {route: "GET /assets/{sha256}",
  widths: [480, 1200, 2400]}` names the relay's sized copies. No location is ever written.
- A contract 2 document is still read: its selected storyboard frames are offered as frames, rights from origin
  (`source_contract: "2"`).
