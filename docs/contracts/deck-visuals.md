# Contract — Deck visuals: layouts, slots, images, theme and issues

Status: **approved by Sai 2026-11-17; the shapes are built, nothing writes them yet.** · Feature:
`features/deck-visual-contract.clan` (slice 1: schemas, examples, vocabulary in `spec.py`, tests; no engine behaviour) ·
Owner: Sai · ADRs: 0016 (the deck schema), 0023 (the input rule), 0027 (look and pictures are allowed
information: **accepted 2026-11-17**), 0036 (this contract: proposed). Template version 0.3.0.
Reads with: `docs/contracts/deck-maker.md` (the run document), `os-layer.md` §3 to §5 (addresses,
appearance, upstream, attach), `clan-fields.md` §2.1 (data paths).

Readers: `engine/deck/` (the assembler, the validators, three renderers, stage h, the bench), the Deck Maker
app (`app/templates/deck-maker/`), the runner (`features/deck-maker-server.clan`), the Territory tool
(`engine/territory/visuals/`, on `feat/territory-slice`), and the Brand Clan (Contract 6, Shrey). Six
features build on it: `deck-visual-checklist`, `deck-frames-in`, `deck-layout-library`, `deck-repair-loop`,
`deck-image-gen`, `deck-look-kits`, and later `deck-vision-critic`.

Today a slide's layout is a string `render_pptx.choose_layout` works out while drawing and keeps only in
memory (`Renderer.layouts`). A slide has no named boxes, a picture is a prompt string in `slide.visual`, the
look a deck used is not on the deck, and the two finding lists (`validation.json`, `qa.json`) have different
shapes that nothing reads together. This contract gives each of those one shape.

## 1. Rules

1. **Every addition is optional.** A deck that holds none of these fields is today's deck: it validates,
   builds and renders as it does now, and every golden stays byte-identical.
2. **Blocks are the words. Slots bind them.** `slide.blocks` stays required and stays the only source of a
   slide's words (ADR 0016). `slide.slots` is a binding of those blocks to a layout's named boxes, written
   by code. Where the two disagree the blocks win, and a stale binding is read as absent (§3.3).
3. **Maps keyed by id, never a position.** Slots by slot name, assets by asset id, issues by issue id, so
   each is a data path (`deck.slides.s07.slots.picture`) and an address (os-layer §3).
4. **One vocabulary, in `engine/deck/spec.py`.** Layout ids, slot kinds, type roles, colour roles, image
   statuses, aspects, issue sources, severities, fixes and check names are tuples in `spec.py`. Each schema
   repeats them as an enum and a test fails when they differ, as `test_intake.py` does for slide types today.
5. **A person's decision is written outside `deck`.** The runner writes `deck` whole on every build, so a
   person's layout swap, pin and image approval live at `look` and `review` (§6) and the runner stamps them
   onto the slide, the way `intake.verified` becomes `meta.confirm[].verified`.
6. **A picture is never evidence.** It is never a ref, never backs a claim, never supplies a word or a
   number, and is placed only on the creative slide types of §4.4. Charts stay native. Every picture is `basis: creative` and is labelled
   Illustrative until a person approves it (ADR 0027, accepted 2026-11-17).
7. **`validation.json` and `qa.json` keep their shapes.** Issues (§7) are derived from them by adapters. A
   validator finding and `golden_validation.json` do not change.
8. **Nothing invents a layout.** A layout id is one of the library's (§2), at most 40 of them.
9. **How a deck should be is the user's choice, asked by the tool.** Which slides carry pictures, how
   much text a slide holds, where pictures come from and what they may cost, which Style Pack, whose brand,
   who approves a picture and what it is labelled are deck preferences (§6.3): fields on the deck, each
   with a default, asked at intake only when the answer changes the build (§6.4). They are not policy
   fixed by Sai or Laurence (Sai, 2026-11-17).

## 2. Where each thing lives, and who writes it

| Thing | Path | Schema | Written by |
|---|---|---|---|
| Layout library | `engine/deck/layouts/<id>.yaml` | `engine/deck/schemas/layout.schema.json` | a person, by PR |
| The slide's layout | `deck.slides.<id>.layout` | `deck.schema.json` `definitions.slide` | the layout plan (code) |
| The slide's slots | `deck.slides.<id>.slots.<slot>` | same | the layout plan; image slots by the image plan |
| A person's pin, stamped | `deck.slides.<id>.pinned` | same | the runner, from `review.pinned` |
| Asset registry | `deck.assets.<asset id>` | `deck.schema.json` | the image plan and the image step |
| The look a deck used | `deck.meta.theme` | `deck.schema.json` `meta` | the runner |
| The repair policy a run used | `deck.meta.repair_policy` | `schemas/repair_policy.schema.json` | the runner |
| Deck preferences: how it looks | `look.pictures`, `look.density`, `look.brand`, `look.style_pack` (top-level `look`, `x-clan-appearance`) | template `schema.json` | the app, from an intake answer, the Start screen or Review |
| Deck preferences: spend and approval | `inputs.pictures.source`, `inputs.pictures.approval` | template `schema.json` | the app, the same three ways |
| The preferences a build used | `deck.meta.preferences` | `deck.schema.json` `meta` | the runner |
| Other look choices | `look.theme`, `look.strict_brand`, `look.layouts` | template `schema.json` | the app |
| The person's review decisions | `review.pinned`, `review.images` | template `schema.json` | the app |
| Fidelity switch | `inputs.text_mode` | template `schema.json` | the app |
| Presentation inputs allowed at all | `inputs.library.enabled` | template `schema.json` (exists) | the app, once ADR 0027 is accepted |
| Issues | run folder `issues.json`; `qa.issues.<issue id>` in the document | `schemas/issue.schema.json` | the runner |
| Repair rounds | run folder `repair.json`; `repair` in the document | template `schema.json` | the runner |
| Golden slides | `engine/deck/golden/<slide type>/<id>.yaml` | `schemas/golden.schema.json` | a person, by PR |
| Critic rubric | `engine/deck/visual_rubric.json` | `schemas/visual_rubric.schema.json` | a person, by PR |
| Brand kit | `upstream.<brand document id>` (Brand Clan, attached) | Contract 6 | the host |
| Image style | `upstream.<style pack document id>` (Style Pack, attached) | `deck-look-kits` | the host |

The template's `deck` mirrors `deck.schema.json`. The template schema has no `definitions`, and
`app/tests/deckMakerFixtures.test.ts` checks it with its own small validator, so the mirror is written
inline (no `$ref`) and a test compares it with the engine schema (§9).

## 3. The slide record

### 3.1 `layout`

```
layout: { id, version?, chosen_by, alternatives?, why?, fit?, blocks_sha? }
```

| Field | Values | Meaning |
|---|---|---|
| `id` | a library id, or `flow` | the layout the slide is drawn with. `flow` is reserved: no library layout, the earlier single-column flow, no slots |
| `version` | integer | the layout file's `version` when it was bound |
| `chosen_by` | `rule` · `fit_ladder` · `repair` · `person` | the picker's rules; the free rungs of the fit ladder; a repair round; `look.layouts.<slide id>` |
| `alternatives` | up to 4 ids | layouts a person may swap to. Each accepts the same blocks |
| `why` | up to 160 characters | one line, for the person |
| `fit` | `{rung, scale?, relaxed?}` | `rung`: `as_is` · `shrunk` · `switched` · `shortened` · `split` · `overflow_to_notes` · `no_fit`. `scale` 0.6 to 1.6. `relaxed`: body set at the caption floor (`Renderer._relaxed`) |
| `blocks_sha` | 12 hex | hash of the slide's title and shown blocks when the slots were bound (§3.3) |

### 3.2 `slots`

A map keyed by the layout's slot names (`^[a-z][a-z0-9_]{1,23}$`). Each value names its `kind`, which is
the layout's slot kind, so a reader that has not loaded the library (the app, the bench) can still read it.

| `kind` | Value | Bound from blocks of kind |
|---|---|---|
| `text` | `{text}` | `text` `small` `statement` `quote` `callout` `sketch`; the slot named `title` binds `slide.title` |
| `list` | `{items: [{text, heading?, refs?, human?}]}`, at most 8 | `bullets` `steps` |
| `group` | `{items: [{heading?, text, refs?}]}`, at most 8 | `card` `kv` `fromto` |
| `stat` | `{items: [{value, text, refs?}]}`, at most 4 | `stats` |
| `table` | `{rows: [[cell]]}`, at most 8 by 5 | `table` |
| `chart` | `{chart}` (the block's own `chart` object) | `chart` |
| `copy` | `{lines: [text], answer?}` | `copy` |
| `image` | `{image}` (§4) | none |

Every value may also carry `blocks` (the indexes, among the slide's shown blocks, it was bound from), `refs`,
`basis`, and the measured `chars` and `words`. A value never holds a word its blocks do not.

### 3.3 Binding rules

1. The layout plan binds each shown block (`spec.shown_blocks`, for the deck's `meta.audience`) to exactly
   one slot. A block no slot takes
   is an issue, `block_unbound`, never a silent drop. A slot name the layout does not have is `slot_unknown`.
2. An empty optional slot collapses and the layout re-balances. An empty required slot is `slot_missing`.
3. A value over its slot's limit is `slot_limit`, with the measure and the limit in `evidence`.
4. `layout.blocks_sha` is the first 12 hex of the SHA-256 of the canonical JSON of `[title, shown blocks]`.
   A reader that computes a different hash treats `layout` and `slots` as absent and draws the slide as
   today (`choose_layout`), and the validator reports `slot_stale`. So an old path, a hand edit or a
   half-written deck falls back to today's behaviour.
5. `slots` is runner-written. The app never patches a text slot; a change to words is a change request
   and goes through the engine (`deck-maker.md`, Rules the screens keep).
6. `slide.visual` is unchanged and is never rewritten. `visual.kind: image_prompt` keeps meaning "the
   slide asked for a picture"; whether one was made is the image slot's `status`.
7. `pinned: true` (stamped from `review.pinned.<slide id>`): the trim, the red team's reorder and the
   repair loop leave the slide's words and place alone.

## 4. Images

### 4.1 The image slot

The value of an `image` slot. It holds the request and the person's decision. What was made is on the asset.

```
image: { kind, status, aspect, asset?, from?, subject?, prompt?, style?, reference_images?,
         target_px?, fit?, focal?, guards?, alt?, attempts?, reason?, approval? }
```

| Field | Values | Meaning |
|---|---|---|
| `kind` | `photo` · `illustration` · `frame` · `screenshot` · `logo` | what sort of picture the slot takes |
| `status` | `empty` · `planned` · `made` · `flagged` · `approved` · `rejected` · `failed` | §4.3 |
| `aspect` | `16:9` · `3:2` · `4:3` · `1:1` · `4:5` · `9:16` | the slot's shape. A renderer crops with `cover`; it never stretches |
| `asset` | `img_` + 12 hex | a key of `deck.assets` |
| `from` | `{kind, key?, run?}` | `kind`: `territory_frame` · `upload` · `brand` · `generated`. `key`: the frame key `<territory id>-<shot>-<flash\|pro>`, a material id, or a Brand Clan logo id. `run`: the territory run's 12-character hash |
| `subject` | up to 400 characters | what a camera could see, from the slide's own creative text. No brand name, person's name, figure or words to paint |
| `prompt` | up to 2400 characters | the exact text sent: subject, style block, guard rails. Recorded, never edited by hand |
| `style` | `{pack, version, hash}` | the Style Pack and its 8-hex hash (`style._hash`) |
| `reference_images` | up to 14 asset ids | from the Style Pack. Runway takes at most 14 |
| `target_px`, `fit`, `focal` | `[w, h]`; `cover` · `contain`; `{x, y}` 0 to 1 | how it is drawn |
| `guards` | `{no_text, no_logos, no_real_people, no_chart_as_image, banned_imagery[], safe_messaging{packs[], reviewed}}` | the rails in force. The four booleans are always `true` |
| `alt` | up to 140 characters | written by code from `subject`. Never from a picture's metadata |
| `attempts` | 0 to 2 | generations tried |
| `reason` | up to 300 characters | why the slot is `empty`, `failed` or held back (a Confidential part, a safe-messaging gate) |
| `approval` | `{asset, decision, by, at, note?}` or null | the runner's stamp of `review.images.<slide id>.<slot>`. `decision`: `approve` · `replace` · `remove`. `by` is `human:<id>`, `at` is not empty. The schema requires an approved slot to hold an approval with `decision: approve`, a `by`, an `at` and an `asset`; that `approval.asset` equals the slot's own `asset` is a rule JSON Schema cannot state, so it is checked in code (`approval_matches_asset` in `test_visual_contract.py`, and the validator that reads it, `deck-repair-loop`) |
| `basis` | `creative` | constant: every picture is creative, never sourced. There is no stored label field: a renderer draws the picture label (`inputs.pictures.approval.label`, Illustrative by default) whenever `status != approved` |

### 4.2 Assets

`deck.assets.<asset id>`, keyed by `img_` + the first 12 hex of the file's SHA-256, so the same file is
the same asset in every slot and every run. Two different files with one id stop the load.

```
{ sha256, file, mime, width, height, bytes?, rights, made?, guard? }
```

- `file`: `assets/<sha256>.<ext>` in the run folder, `human/assets/` in the document.
- `mime`: `image/png` · `image/jpeg` · `image/webp` · `image/svg+xml`. `sha256` and `mime` are the Production
  Tool relay's `assetRef` keys (`production-tool/contracts/common.schema.json`), so moving to the relay
  later changes the client, not the data.
- `rights`: `generated` · `own` · `licensed` · `client_supplied` · `reference_only`. A `reference_only` asset
  is a style reference and may never fill a slot (`image_rights`). Only an image we own or have licensed may
  go to an image model; a client-supplied or unclear image defaults to `reference_only`, for eyes only (§11,
  default until Laurence answers).
- `made`: `{provider, model, task, at, credits, usd}`, for a generated asset.
- `guard`: `{checked, by, flagged, found, reason}`, the shape `engine/territory/visuals/guard.py`
  `check_image` returns. `by` is `ollama:<model>` or `not checked`.

### 4.3 Status

```
empty ──▶ planned ──▶ made ──────▶ approved
                  │        └─────▶ rejected
                  ├──▶ flagged ──▶ approved | rejected
                  └──▶ failed
```

- `planned`: a source was found or a prompt composed. Nothing is spent.
- `made`: the asset exists and the guard found nothing, or did not run. `flagged`: the guard found
  something; the slot waits for a person.
- **A frame from the Territory tool arrives `made`, never `approved`.** Approval in the Territory tool does not
  count in the deck (Sai, 2026-11-17). One click by the deck's approver stamps `approve` on all four frames of
  a territory (`review.images` gets one entry per frame).
- `approved` exists only as the stamp of a person's `approve` whose `asset` is the slot's `asset`. A slot
  whose asset changes after approval returns to `made` or `flagged`: an approval is for one picture.
- A review render draws `made`, `flagged` and `approved` pictures; all but `approved` carry the deck's
  picture label (`inputs.pictures.approval.label`, by default Illustrative). A client render draws only
  `approved`, and only a decision by the deck's approver (`inputs.pictures.approval.approver`) is stamped. Any other filled slot on a client render is
  `image_unapproved` (an error for `--audience client`), and the slide uses the layout's `without_image`.

### 4.4 Where a picture may go

Slide types `title`, `appendix` (the divider), `territory`, `idea`, `execution`, `audience`, `real_question`,
`close`, and the investor types `solution` and `product`. Every other type is an evidence slide and takes
no picture. Within this list the user chooses (`look.pictures`, §6.3): none, the creative slides, the
creative slides and the cover, or slide by slide. The list itself is the rule and part of ADR 0027's
decision: as ADR 0027 is worded (§4, "only where the slide already says illustrative") only `territory`
and `execution` slides qualify, because only they carry `visual.kind: image_prompt` today (`assemble.py`
lines 562 and 586).

### 4.5 Placing existing pictures (deck-frames-in, 17 November 2026)

Three clarifications, no field changes:

1. **An image slot is never stale-checked.** It binds no blocks, so the `blocks_sha` rule (§3.3 rule 4) applies to the text,
   list, group, stat, table, chart and copy slots only. A slide may hold image slots and no `layout` until `deck-layout-library`
   lands; the renderer then places them by its own rule (one carve in `Renderer.slide`, boxes in `images.SLOT_TABLE`).
2. **A slot with count n binds `<name>_1` to `<name>_n`.** The territory's four frames are `frame_1` to `frame_4` and stay so
   in the library: review.images and approvals are keyed per slot, so four pictures need four keys (§5's "one slot with count 4"
   means this).
3. **The one click** (`images.approve_territory`, by a `human:<id>` only) writes one `review.images` entry for every slot holding
   one of that territory's frames, the cover's and the idea's included. It approves only clean frames (made, the guard ran and
   found nothing) and lists the rest: a flagged frame stays flagged, a frame no guard looked at and a refused one wait for a person.
   The Territory tool's own `approved_by_person` is kept as `territory_accepted` and is never approval.

The stage file `--stages/frames.json`, written by `python3 -m deck.from_territory` and read only when `run_deck` is given
`--pictures`:

```
{ stage: "frames", produced_by, run: {file, sha256_12, same_brief: verified | unverified}, version: "v<N>-<hash>",
  style: {pack?, document_id?, version, hash}, safe_messaging, style_hold?: {reason}, fixture?: true,
  frames: { <key>: {territory, shot, tier, model, prompt, prompt_sha256?, subject, guard{checked, flagged, found?, reason?},
                    territory_accepted, status: made | flagged | refused, reason?,
                    file: "assets/<sha256>.<ext>", sha256, mime, width, height} } }
```

One frame per shot: a clean frame beats a flagged or refused one, then the best model beats the quick one. `meta.built_from.territory_run`
records `{file, sha256_12, frames_version, same_brief}`. `meta.preferences.style_pack` may carry `hash` (the Style Pack the deck now
uses: a picture whose style hash differs is stale, not mixed) and `hold` (the Style Pack could not be read; the build went on).
The picture boxes: the cover and the divider 16:9, the idea and the audience 4:3, the territory's four frames in a strip of 16:9
boxes, executions by `spec.frame_for` (phone 9:16, poster 4:5, none 16:9; search and audio take no slot). Nothing is generated:
`inputs.pictures.source.allow: generated` is refused until `deck-image-gen`.

## 5. The layout library

One file per layout, checked on load against `layout.schema.json`. An unknown slide type, block kind,
role or renderer stops the load, as `ProfileError` does for a deck type.

| Field | Meaning |
|---|---|
| `id`, `version` | `^[a-z][a-z0-9_]{2,31}$`; an integer, raised when a slot or a limit changes |
| `group` | `functional` (cover, section, divider, close) · `content` |
| `purpose` | `title` · `statement` · `list` · `compare` · `data` · `timeline` · `image` · `people`: what the swap menu groups by |
| `description`, `slot_summary` | how it arranges things (not what it says); one line of its slots |
| `for_types` | names from `spec.SLIDE_TYPES` |
| `when` | `{blocks_any, blocks_only, needs_image, needs_number, min_items, max_items, status}`: when the picker may choose it |
| `priority` | 0 to 100; highest first, first match wins. Replaces the order of `choose_layout`'s table |
| `alternatives`, `roomier`, `without_image` | up to 4 swaps; the next layout on the fit ladder; the layout used when its image slot stays empty |
| `density` | `lean` · `standard` · `detailed`: the most text the layout is meant for, the same three words as `look.density` (§6.3) |
| `renderer` | the draw routine's name. Every renderer (pptx, web, HyperFrames) has one for it or falls back to `flow` and says so |
| `slots` | 1 to 8 slot definitions, by name |

A slot definition:

| Field | Meaning |
|---|---|
| `kind` | `text` · `list` · `group` · `stat` · `table` · `chart` · `image` · `copy` (§3.2) |
| `role` | the type role (§6.2): `display` · `title` · `lead` · `body` · `small` · `caption` |
| `required`, `dominant` | an empty required slot is an issue; at most one slot per layout is the dominant visual |
| `from_blocks` | block kinds it takes, in order |
| `min_chars`, `max_chars`, `max_words`, `max_lines`, `max_line_in` | limits. `max_chars` is derived from the box and the role's size at 0.85 capacity (`layouts.capacity()`); a test fails when the file disagrees. `max_words` never exceeds the slide type's budget in `spec.SLIDE_TYPES` |
| `min_items`, `max_items`, `center_when_fewer`, `item{heading_max_chars, body_max_chars, max_words}` | lists and groups, at most 8 items |
| `table{max_rows ≤ 8, max_cols ≤ 5, cell_max_chars}` | tables |
| `chart{types, max_categories ≤ 8, max_series ≤ 4, hero_max ≤ 2}` | native charts only |
| `image{aspect, kinds, fit, min_px, text_over, scrim, count ≤ 4}` | an image slot's shape; `count` 4 is a territory's frame strip |
| `master_placeholder` | the placeholder this slot fills on an agency `.potx` master |

The library starts with the 17 layouts `choose_layout` returns today, with no change in look: `cover`,
`emphasis_bar`, `objective_panel`, `risk_cards`, `comparison_grid`, `chart`, `execution`, `territory`,
`placeholder_card`, `quote_cards`, `comparison`, `big_number`, `kpi_row`, `role_grid`, `timeline_strip`,
`native_table`, `cards`. Eight more arrive with pictures (`deck-layout-library`): `cover_image`, `section`,
`image_text`, `image_left`, `full_bleed_statement`, `frames_strip`, `image_grid`, `execution_visual`. That is
25 of the 40 the catalogue may hold.

## 6. Theme and look

### 6.1 `deck.meta.theme`: colour roles

`theme.Theme` made visible, so a reader can see which look a deck used and where each token came from.

| Role | Used for | Brand Clan source (proposed, fixed in `deck-look-kits`) |
|---|---|---|
| `ink` | dark text and dark slides | `visual.colours[role=text]` |
| `paper` | the slide background | `role=background` |
| `panel` | card fill | `role=neutral` |
| `rule` | hairlines | derived |
| `mute` | caption text | derived |
| `accent` | fills, bars, chips | `role=accent`, else `role=primary` |
| `accent_ink` | accent-coloured text, at least 4.5:1 | derived (`theme.tune`) |
| `on_dark`, `on_dark_mute`, `accent_on_dark` | text and accent on `ink` | derived |
| `chart[]` | up to 8 series colours | `visual.deck.chart_colours` (asked of Shrey) |
| `semantic.positive`, `.negative` | up and down in charts | none; a default |

The ten roles are `theme.COLOR_FIELDS`, each a 6-digit hex. `derived[]` names the roles the engine derived;
`problems[]` carries `check_palette`'s findings (shown, never fatal).

### 6.2 Type roles, grid and the rest

- `scale`: points on the fixed 13.333 by 7.5 in canvas, the fields of `theme.Scale`. The six slot roles are
  `display` (44 to 80), `title` (36 to 44), `lead` (20 to 24), `body` (14 to 16), `small`, `caption`
  (10 to 12); the floors are `title_min` 28, `body_floor` 12, `caption_floor` 10, `foot_floor` 9.
- `fonts`: `{head, body, fallback[≤2]}`, two families at most. `line_height`: `{head 0.9 to 1.15, body 1.3 to 1.5}`.
- `grid`: `{margin_in 0.5 to 1.0, gutter_in 0.25 to 0.5, unit_in}` (`Grid.M`, `.G`, `.unit`).
  `canvas`: `{w_in: 13.333, h_in: 7.5}`, fixed. A render scales it and never reflows.
- `logo`: `{asset, placement, min_height_in}`, `placement` `cover_only` · `cover_and_footer` · `none`.
- `accent_use`: `fill` · `outline` (the agency look's switch). `header_position`: `left` · `center`.
- `name`, `source`, `kit`: `source` is `default` · `brand_clan` · `agency_look` · `brand_file` · `master`,
  resolved in the order master, attached Brand Clan, agency look, `--brand` file, the default `napkin`
  theme. `kit` is `{document_id, version}` for a Brand Clan.

From a Brand Clan the deck reads `visual.colours`, `typography`, `logos`, `imagery`, `layout`, and `rules`
that are `checkable` with `area` `logo`, `colour` or `imagery` (a warning, never a block). It never reads
`voice`, `strategy`, `claims` or `legal_lines`: a kit adds no word to a slide.

### 6.3 Deck preferences: what the user chooses

Six choices about how this deck should be. Each is a field on the deck with a default. Each is an object
that holds the choice and, once a person has made it, who and when, like `run.approvals`:
`by` (`human:<id>`), `at`, and `via` (`question` · `start` · `review`). With no `by` the default is in
force and nobody was asked.

```
look:                                   # x-clan-appearance: how the deck looks
  pictures:   { on, slides?, by?, at?, via? }
  density:    { level, by?, at?, via? }
  brand:      { wears, by?, at?, via? }
  style_pack: { use, document_id?, by?, at?, via? }
  theme, strict_brand, layouts: {<slide id>: <layout id>}
inputs:
  pictures:                             # not appearance: it can spend money and send a prompt out
    source:   { allow, cap_usd, by?, at?, via? }
    approval: { approver, user?, label, by?, at?, via? }
  text_mode: preserve | condense
  library: { enabled }
review: { pinned: {<slide id>: {by, at}},
          images: {<slide id>: {<slot>: {asset, decision, by, at, note?}}} }
```

| Field | Values (default first) | The question, as worded | Feeds |
|---|---|---|---|
| `look.pictures.on` | `creative_cover` · `creative` · `none` · `custom` | "Which slides should carry pictures?" The cover, section breaks and the creative slides (each territory, the idea, each execution, the audience) · Creative slides only · None · I'll choose slide by slide | which slides get an image layout (§4.4). `creative_cover` adds `title` and the divider to `creative`. `custom` starts from the default; `slides: {<slide id>: true \| false}` is set at Review, once slides exist, and only for a slide type of §4.4 |
| `look.density.level` | `lean` for a presented pitch, `detailed` for a leave-behind (`inputs.format: full`) · `standard` | "How much text should each slide carry?" Lean: about 30 words, the rest in the speaker notes · Standard: up to about 60 words · Detailed: the full text on the slide | the picker prefers layouts of that `density`, and the fit ladder moves whole points to the notes above the target: 30 words on a content slide, 60, or the slide type's budget (`spec.SLIDE_TYPES`). Nothing is reworded by it |
| `inputs.pictures.source.allow`, `.cap_usd` | `existing` · `generated`; `2.5` (0 to 10) | "Where may the pictures come from?" Only pictures we already have (territory frames and uploads) · Also make new ones, up to $2.50 for this deck (the amount can be changed) | `existing` never calls a provider. `generated` allows it, after the cost card, which shows the cap; the image step stops before the cap is passed |
| `look.style_pack.use`, `.document_id` | `territory` · `other` | "Which Style Pack should the pictures follow?" The one the territory board uses · Another one (pick from the attached Style Packs) | the image prompt's style block and references. With no Style Pack attached the built-in default style is used |
| `look.brand.wears` | `agency` · `client` · `co_branded` | "Whose brand should the deck wear?" Ours, with the client's logo on the cover · The client's · Both, side by side on the cover | which kit `meta.theme` is resolved from, and `logo.placement` |
| `inputs.pictures.approval.approver`, `.user`, `.label` | `owner` · `named` (with `user: human:<id>`); `Illustrative` (up to 30 characters, no digit) | "Who approves pictures before a client sees them?" Me, the deck's owner · Someone else. "What should a picture be labelled until it is approved?" Illustrative | whose `review.images` decision the runner stamps as `approved`; the label drawn on every picture not yet approved |

Rules:

- `look` is marked `"x-clan-appearance": true` on the top-level property, so a person's change there is one
  rolling `look` entry and asks for no reason (os-layer §4). `inputs.pictures` and `review` are not
  appearance: allowing generation, a spend cap, an approver and an approval are ordinary attributed decisions.
- **A default in the schema is what the app shows and the runner applies.** The engine does not assume
  it: `run_deck` given no preferences behaves as it does today (no pictures, the slide types' budgets), so
  recorded runs and goldens are unchanged. The runner always passes the resolved preferences.
- `deck.meta.preferences` is the runner's stamp of what a build used:
  `{pictures, density, picture_source, style_pack, brand, picture_approval}`, each the field's values plus
  `source: person | default`.
- The label is a fixed label like DRAFT and Illustrative today: it holds no fact, and a digit is refused
  so that it can never read as a figure.
- `inputs.library.enabled` is still the one gate (ADR 0027, accepted 2026-11-17). While it is false or absent the picture,
  Style Pack and brand questions are not shown, the runner ignores those preferences, an attached Brand
  Clan and an attached Style Pack, and the deck is today's. Density does not wait on it.
- Two things stay rules, whatever the user chooses: a part marked Confidential with `model: false` is never
  sent to a provider (os-layer §4), and a `reference_only` asset never fills a slot.
- `theme`: `napkin` · `brand` · `classic`. `strict_brand`: only the kit's layouts and given tokens, nothing
  derived. `inputs.text_mode`: `preserve` turns the repair loop's shorten rung off; `condense` is the default.

### 6.4 Asking: intake, the Start screen and Review

A preference is asked as an intake question card only when the answer changes the build. Otherwise the
default applies silently, is shown on the Start screen, and stays editable at Review.

The cards are computed in code, like the type question (`intake.type_question`) and the supply cards
(`intake.supply_questions`): `{id, text, options, allow_text, address, skippable: true, kind: "preference"}`,
with the default option first and marked `origin: default`. `address` is the field (`look.pictures`).

| Card | Joins the questions only when |
|---|---|
| `q_pref_pictures` | the deck has something to place (a Territory run with frames, or an attached picture), or generation is allowed |
| `q_pref_picture_source` | pictures are on, and the pictures the deck already has cannot fill every slide type chosen |
| `q_pref_density` | the format is `pitch` and the deck is not a sketch (`meta.sketch`: at most 10 short slides already) |
| `q_pref_brand` | two brands are available: an agency look or kit, and a client Brand Clan |
| `q_pref_style_pack` | generation is allowed and more than one Style Pack is attached |
| picture approval | never. Nothing in a build depends on it; it is set at Review, beside the first picture |

- **The cap is still five** (`intake.MAX_QUESTIONS`). The type question is first, then the stage's own
  questions and the supply cards, as today. Preference cards take only the places left, in the order of the
  table. A preference card never displaces a question about what the deck says: with no place left the
  default applies and the choice waits on the Start screen.
- **An answer** writes `intake.answers.<qid> = {option_id | text, at, by}` (`by` is new and optional) and,
  in the same patch, the addressed field with `by`, `at` and `via: question`. A skip writes
  `{skipped: true, at}` and no field: the default stays in force.
- **The Start screen** shows all six with their current value; a change writes the field with `via: start`.
- **Review** shows them again. A change writes the field with `via: review` and takes effect on the next
  build: a picture preference rebuilds images only (the words stay byte-identical); density re-plans layouts.
- Build never waits for a preference, as it never waits for any question.

## 7. Issues

One shape for every finding that code can act on, from any source.

```
{ id, round, slide, slot?, source, check, level?, severity, message, evidence?, fix?, status }
```

| Field | Values | Meaning |
|---|---|---|
| `id` | `i_` + 8 hex | the first 8 hex of the SHA-256 of `source\|check\|slide\|slot\|n`, `n` counting repeats on one slide. The same finding keeps its id across rounds, so rounds can be compared |
| `round` | 0 to 2 | 0 is before any repair |
| `slide`, `slot` | a slide id or `deck`; a slot name | `qa.json` keys its findings by slide number; the adapter maps the number to the id through the rendered order |
| `source` | `schema` · `validate` · `qa_render` · `image_guard` · `critic` | who found it |
| `check` | a name from `spec` | §7.1 |
| `level` | `error` · `warn` | the source's own level, kept as written |
| `severity` | `blocker` · `major` · `minor` | from the policy's `severity` map; with no entry, `error` is `blocker` and `warn` is `minor`. The critic never raises a blocker |
| `message` | up to 300 characters | the source's words |
| `evidence` | `{measured, limit, unit}` | what was measured against what |
| `fix` | `{kind, params}` | `shrink` · `switch_layout` · `shorten` · `split` · `overflow_to_notes` · `add_scrim` · `crop_image` · `regen_image` · `drop_image` · `needs_human` |
| `status` | `open` · `fixed` · `unfixed` · `rolled_back` · `left_for_person` | |

In the document, beside `validation` and `report`:

```
qa:     { deck_sha, current, summary: {blocker, major, minor, slides_checked}, issues: {<issue id>: issue} }
repair: { rounds: [{n, kept, fixed, open, usd, seconds}], left_for_person }      # at most 2 rounds
```

`deck_sha` is the hash of the `deck.json` the checks read; `current` is false once the deck has changed.
An export says whether its checks are current. A finding still never fails a review build.

### 7.1 Check names

One list for the engine, the app and the bench, in `spec.py`:

- **Today, unchanged**: the 33 names of `spec.CHECKS` (source `validate`), and stage h's `off_slide`,
  `margin`, `text_overlap`, `text_overflow`, `min_font`, `placeholder`, `contrast`, `mostly_empty`,
  `one_corner`, `qa_internal`, `unreadable` (source `qa_render`).
- **Reserved here, built later**: `slot_limit`, `slot_missing`, `slot_unknown`, `slot_stale`, `block_unbound`,
  `layout_unknown` (`schema` and `validate`); `image_missing`, `image_unapproved`, `image_flagged`,
  `image_rights`, `golden_echo` (`validate`, `image_guard`); `picture_stretch`, `picture_lowres`,
  `text_on_image_contrast`, `layout_repeat`, `title_drift`, `line_length`, `image_style_mixed`
  (`qa_render`); `export_failed` (the runner).

`empty_slot` is an existing validator check (a block with no text) and keeps its meaning; the new names
start `slot_`. `placeholder` is raised by both `validate` and `qa_render`; `source` tells them apart.

## 8. Engine data: policy, goldens, rubric

- **Repair policy** (`policy/repair.yaml`, `repair_policy.schema.json`; a profile may override it):
  `max_rounds` (0 to 2), `max_usd`, `max_seconds`, `repair_on[]`, `client_export_blocks_on[]`,
  `severity{check: severity}`, `ladder[]`, `shrink{min_scale}`, `shorten{max_slots_per_round,
  max_cut_ratio, guards[]}`, `images{max_regens_per_slot, on_flag, max_usd}`, `keep_round_if`,
  `critic{enabled, may_fix[], needs_code_confirm}`. Every key of `severity` is a check name of §7.1.
- **Golden slide** (`golden/<slide type>/<id>.yaml`, `golden.schema.json`): `id` (`g_…`), `slide_type`,
  `deck_types[]`, `layout`, `slots` (valid against the layout), `why_good[1 to 3]`, `not_this{text, why}`,
  `render`, `source{kind: invented, client}`, `approved{by, at}`. Invented clients only: Confidential
  material never becomes a golden (os-layer §4).
- **Visual rubric** (`visual_rubric.json`, `visual_rubric.schema.json`): `version`, `per_slide[≤14]`,
  `per_deck[≤8]`; an item is `{id (v_…), question, pass_is: yes|no, applies_to, severity_if_fail:
  major|minor, fix, confirm_with}`. `confirm_with` names the code check that must agree before a fix runs.

## 9. Compatibility and tests

- `deck.schema.json` and the template schema change by addition only: no new `required`, no enum made
  smaller, no `additionalProperties: false` on an object that exists today.
- The baseline is the set of schema errors each fixture had **before slice 1**, not zero: `lumen_water/golden_deck.json`
  has none, and `types/investor_seed/golden_deck.json` had three (a `stats` block, which `assemble.py` line
  765 writes and the block enum did not list, and two `basis: null`). Slice 1 added `stats` to the block enum,
  because a slot's `from_blocks` must be able to name it, which leaves the two `basis: null` (the `statement`
  block of the `problem` and `ask` slides, `assemble.py` line 762). Sai decided (17 Nov) to fix those two in this
  slice. The value is `opinion`: that is what the same file writes for every other statement or claim with no
  refs (lines 293, 302, 766, 770), `creative` there is only for the `close` sign-off, and a `creative`, `proposal`
  or `meta` basis would exempt the ask's figure from `numbers_trace` (`validate.py` line 315). With `opinion` the
  investor golden still validates with no findings. The golden is what `build_investor` writes, so the golden's two values and `assemble.py` line 762 (`else None`
  became `else "opinion"`) changed in one commit. Sai approved it on 2026-11-17: this is the slice's one noted
  exception to "no behaviour change". It affects the `problem` and `ask` statement block in every investor deck.

## 10. Decisions of 17 November 2026

Sai, in chat, 2026-11-17 (approved in chat):

- ADR 0027 accepted: look and pictures are allowed information; they never add a word, a number or a legal
  line. Every picture is `basis: creative`, labelled Illustrative until a person approves it. Four points of
  wording applied: say "information"; a logo only for a brand the information already names; Territory tool
  words (territory text, on-screen lines) are an allowed creative input; no preference can change facts from
  the brief.
- The local Ollama guard is acceptable as a non-Claude check, because it can only add a flag (ADR 0006).
- `deck-ci` is approved. `deck-maker-server` merges before `deck-layout-library` (both edit `run_deck.py`).
- ADR number 0036. Deck template version 0.3.0.
- The build adds `stats` to the block-kind enum and fixes the investor golden's two `basis: null` (§9).
- A person's review decisions live at top-level `review.pinned` and `review.images`; `pinned` and `approval` on a
  slide are the runner's stamps.
- Defaults: picture source `existing` (nothing sent out, nothing spent); density `detailed` for the full
  (leave-behind) format and `lean` for a presented pitch, about 30 words per content slide for lean and about 60
  for standard.
- A frame approved in the Territory tool is not approved in the deck: it arrives `made`, and one click by the
  deck's approver approves all four frames of a territory.

## 11. Defaults until Laurence answers

Each is a **default until Laurence answers; his answer replaces it** (Sai, 2026-11-17). They are recorded in
`features/deck-visual-contract.clan` open_questions.

1. Pictures go on the cover, section breaks, each territory (its four frames), the idea, each execution and the
   audience slide. Evidence slides get no pictures (`look.pictures.on: creative_cover`, §4.4).
2. The territory board and the deck share one Style Pack (`look.style_pack.use: territory`).
3. The deck's approver (`review.images`) approves each image. Until then it is labelled "Illustrative"
   (`inputs.pictures.approval`).
4. Visual critic grading: none yet. The vision critic stays advisory (`repair_policy.critic.enabled: false`) and
   every rubric question stays off until graded.
5. Reference images: only images we own or have licensed may go to an image model. Client-supplied or unclear
   images default to `rights: reference_only`, for eyes only.
6. A presented pitch defaults to lean, about 30 words per content slide, with the rest in the speaker notes. The
   full (leave-behind) format keeps today's budgets (`look.density.level: detailed`).

## 12. Later slices must enforce

The schemas state shape. These rules are for the code that arrives with each slice, each with a test:

- **Models never write `review.*`.** `review.pinned` and `review.images` are a person's decisions, written by the
  app. The slide-level `pinned` and `slots.<slot>.image.approval` are runner stamps only: no stage, model or repair
  step may set either.
- `approval.asset` must equal the slot's own `asset` (§4.1); a changed asset returns the slot to `made` or `flagged`.
- `qa` and `repair` are closed objects (`additionalProperties: false`): no fixture or app code writes an extra key
  today. A later slice that needs one adds it to the schema first.
- **Slice 4 (`deck-layout-library`) must validate golden slots against their layout on load, with a test.**
  `golden.schema.json` checks only that each slot names a `kind`.

## 13. Not in this contract

- The Style Pack template (`ie.napkin.style-pack`) and the Brand Clan section `visual.deck`: `deck-look-kits`.
- The picker, the fit ladder, `capacity()`, the per-layout slot rules generated into the template schema:
  `deck-layout-library`.
- `from_territory.py` and placing frames: `deck-frames-in`. Generation: `deck-image-gen`.
- The repair loop and the adapters that write issues: `deck-repair-loop`.
- The app's Review controls and the tasks `swap_layout`, `make_images`, `decide_image`: after `deck-maker-server`.
- The preference cards in `intake.py` and the Start and Review controls that write §6.3's fields. This
  contract fixes the fields, the defaults, the wording and when each is asked; `deck-layout-library` reads
  density, `deck-frames-in` and `deck-image-gen` read the picture preferences, `deck-look-kits` reads the
  brand and the Style Pack.
- A per-agency Deck Kit that overrides the library, goldens, policy and rubric.
