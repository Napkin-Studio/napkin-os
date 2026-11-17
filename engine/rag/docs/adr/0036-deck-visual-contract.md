# ADR 0036 — Deck Maker: layouts, slots, images, theme and issues are one additive contract (proposed)

Status: **proposed** (Claude, 2026-11-17). The design was approved by Sai in chat the same day and slice 1
built it; the ADR stays proposed until the PR merges · Feature: `features/deck-visual-contract.clan` ·
Contract: `docs/contracts/deck-visuals.md` · Builds on ADR 0016 (the deck schema) and ADR 0027 (accepted
2026-11-17: look and pictures are allowed information) · Code: schemas, examples, vocabulary tuples in
`spec.py` and tests only. No engine behaviour changed.

Numbering: the Deck Maker plan calls this ADR 0034. On `develop` 0034 is "SMP and insight from the planning
skill" and 0035 is "first-draft checks", so this is 0036, the next free number on every remote branch (Sai
confirmed 0036, 2026-11-17).

## Context

The Deck Maker writes traceable words and then draws them with 17 layouts chosen inside the renderer
(`render_pptx.choose_layout`), with no pictures, and a rendered-slide QA (`qa_render.py`) whose findings
nothing reads. Six planned features change that: frames from the Territory tool, a layout library, a repair
loop, image generation, look kits and a vision critic. All six, three renderers, the app, the runner and the
Territory tool need the same five shapes: a layout, a slot, an image, a theme and an issue.

None of the five exists as data today:

- The layout is a string in memory (`Renderer.layouts`); `deck.json` does not hold it, and the web renderer
  chooses its own look.
- A slide has no named boxes. Limits are word budgets per slide type (`spec.SLIDE_TYPES`), not per box.
- A picture is `slide.visual = {kind: image_prompt, prompt}`: no file, no source, no approval.
- The look is `theme.Theme` in memory; a deck does not say which look it used.
- Findings have two shapes: `validation.json` `{check, level, slide (an id), message}` and `qa.json`
  `{check, level, message}` keyed by slide **number**.

If each feature added the fields it needed, the first to land (frames) would put pictures where the layout
library later wants slots, and the repair loop would meet three finding shapes.

## Decision

1. **One contract, added to the two schemas that exist.** `engine/deck/deck.schema.json` gains optional
   `layout`, `slots` and `pinned` on a slide, `assets` at the top level and `meta.theme` and
   `meta.repair_policy` and `meta.preferences`. `app/templates/deck-maker/schema.json` mirrors them and gains
   `look`, `inputs.pictures`, `review`, `qa`, `repair` and `inputs.text_mode`. Nothing is required, no enum shrinks, so every deck written
   before stays valid and every golden stays byte-identical.
2. **Blocks stay the words; slots bind them.** `slide.blocks` is still required and still the only source
   of words (ADR 0016, ADR 0023). `slots` is a binding written by code, with a hash of the blocks it was
   bound from (`layout.blocks_sha`). A stale or missing binding is read as absent and the slide is drawn
   as today. No model stage fills slots.
3. **The layout library, golden slides, repair policy and critic rubric are engine data with JSON
   Schemas** (`engine/deck/schemas/*.schema.json`), like `profiles/*.yaml` and `rubric.json`. A layout id is
   one of the library's, at most 40; nothing invents one.
4. **A picture is an image slot plus an asset.** The slot holds the request and the person's decision;
   the content-addressed asset (`img_` + 12 hex of its SHA-256) holds what was made, its rights and the
   guard's result. An approval names the asset it approved, so a regenerated picture is unapproved again.
   A picture is never a ref and never backs a claim; `slide.visual` is not rewritten.
5. **One issue shape, derived.** `validate` and `qa_render` keep writing their own files unchanged; adapters
   turn their findings, slot-schema errors and guard results into issues with a stable id, a source, a
   severity from the policy and a fix. Check names are one list in `spec.py`.
6. **A person's decisions live outside `deck`.** The runner rewrites `deck` on every build, so layout swaps
   are at `look.layouts`, pins at `review.pinned` and image approvals at `review.images`; the runner stamps
   them onto the slide, as it stamps `intake.verified` into `meta.confirm` today.
7. **The vocabulary is `spec.py`'s.** Each closed set is a tuple there; each schema repeats it as an enum;
   a test fails when they differ.
8. **Presentation information is allowed** (ADR 0027, accepted 2026-11-17), behind the one gate that already
   exists, `inputs.library.enabled`, which stays off until the app turns it on. Every picture is
   `basis: creative` and labelled Illustrative until a person approves it.
9. **How a deck should be is the user's choice, asked by the tool** (Sai, 2026-11-17). Six deck
   preferences are fields on the deck, each with a default: which slides carry pictures
   (`look.pictures`), text per slide (`look.density`), whose brand (`look.brand`), which Style Pack
   (`look.style_pack`), where pictures come from and the spend cap (`inputs.pictures.source`), who approves
   and the label (`inputs.pictures.approval`). Each records `{by, at, via}` once a person has chosen. A
   preference joins the five intake questions only when its answer changes the build and a place is free;
   otherwise the default applies silently and stays editable on the Start screen and at Review. The engine
   assumes no default: `run_deck` given no preferences behaves as today, so goldens do not change.

## Who writes each field

| Field | Writer | Reader |
|---|---|---|
| `slides.<id>.blocks`, `claims`, `visual` | `assemble.py`, as today | everything |
| `slides.<id>.layout`, text `slots` | the layout plan, in code (`deck-layout-library`) | renderers, QA, the app's swap menu, the bench |
| image `slots`, `assets` | the image plan and image step (`deck-frames-in`, `deck-image-gen`) | renderers, validate, the app |
| `slides.<id>.pinned`, `slots.<slot>.image.approval`, `layout.chosen_by: person` | the runner, stamping `review.pinned`, `review.images` and `look.layouts` | the trim, the red team, the repair loop, renderers |
| `meta.theme`, `meta.repair_policy` | the runner (`run_deck.py`) | the app, the bench, a reader of the deck |
| `look` (pictures, density, brand, style_pack, theme, layouts), `inputs.pictures` (source, approval), `review`, `inputs.text_mode`, `inputs.library.enabled` | a person, through the app: an intake answer, the Start screen or Review | the runner |
| `meta.preferences` | the runner, stamping the resolved preferences with `source: person \| default` | the bench, a reader of the deck |
| `qa`, `repair` | the runner | the app, the export gate |
| `upstream.<brand>`, `upstream.<style pack>` | the host, on attach | the runner |
| `engine/deck/layouts`, `golden`, `policy`, `visual_rubric.json` | a person, by PR | the engine |

## Alternatives rejected

- **Slots replace blocks (a second schema version).** One source of words, but it rewrites `assemble.py`,
  `validate.py`, three renderers, the bench packets and every golden, breaks decks already written, and
  blocks the other five features for two to three weeks.
- **A sidecar `visual.json` beside `deck.json`.** No risk to the schema, but a slot is then not a data path
  in the document: no address for a decision, no refusal of an over-long patch, and a join by slide id that
  goes stale.
- **Let each feature add what it needs.** No cost now; the cost returns as incompatible shapes and three or
  more golden regenerations.

## Where this differs from the Deck Maker plan (17 Nov, sections 2.1 to 2.8)

The plan's shapes are kept except where the code on `develop` contradicts them:

| Plan | Here | Why |
|---|---|---|
| ADR 0034 | ADR 0036 | 0034 and 0035 are taken |
| `pinned` and `approval` are a person's writes on the slide | Written at `review.pinned` and `review.images`; the slide carries the runner's stamp | The runner writes `deck` whole on every build |
| An approval is `{by, at, decision}` | It also names the `asset` | A regenerated picture must not inherit an approval |
| Provider, model, task, cost and the guard's result on the image slot | On the asset | One file can fill two slots; the facts about the file belong to the file |
| A slot value is one of four shapes, told apart by its keys | Every value names its `kind`; `table`, `stat` and `copy` have shapes | The four did not cover a table, stats or execution copy |
| `slide.visual.kind` gains `image` | `visual` is not touched | Two places would say whether a slide has a picture; an untouched `visual` keeps the words byte-identical when only images change |
| `qa.issues` is slide id to a list | A map keyed by issue id | An address is never a position (os-layer §3) |
| `validate` and `qa_render` write issues | They keep their files; adapters derive issues | `golden_validation.json` must not change |
| `unknown_slot` | `slot_unknown`, with `slot_limit`, `slot_missing`, `slot_stale`, `block_unbound` | `empty_slot` already exists in `spec.CHECKS` and means something else |
| Every golden validates today | The investor golden has three schema errors today | Measured |
| `from.kind` includes `library` | Left out | Nothing supplies it; an enum can grow later |
| `look.density` `airy`, `regular`, `dense`; `look.images` `off`, `supplied`, `generate` | `look.density.level` `lean`, `standard`, `detailed`; `look.pictures.on` and `inputs.pictures.source.allow` | Sai's revision: one question each, in the user's words; which slides and where pictures come from are two choices |
| Questions for Sai and Laurence: which slides carry pictures, words per slide, the image cap, one Style Pack, whose brand, who approves, the label | Deck preferences with defaults, asked by the tool | Sai, 2026-11-17 |

## Consequences

- Slice 1 (a day) added `engine/deck/schemas/{layout,issue,golden,repair_policy,visual_rubric}.schema.json` with
  one valid and one invalid example each, the optional fields in `deck.schema.json` and the template schema,
  vocabulary tuples in `spec.py` and `tests/test_visual_contract.py`. No stage, renderer, validator or CLI
  changed; no model call; no cost to a run. The template version is 0.3.0.
- Three validators read the template schema: Python `jsonschema` in the engine tests, the SDK's `jsonschema`
  0.26 on every patch, and a small checker in `app/tests/deckMakerFixtures.test.ts`. The checker now reads
  `const`, `pattern`, `minimum`, `maximum`, `minItems`, `minLength`, `maxLength` and `propertyNames` as well as
  the earlier eight, and a test fails when the template schema uses a keyword it does not read.
- `features/deck-ci.clan` (approved 2026-11-17) makes the deck tests run in `scripts/check.sh` and CI. Until it
  merges the build runs `PYTHONPATH=. python3 -m pytest -q deck/tests` by hand and records the result.
- `deck-maker-server` merges before `deck-layout-library`: both edit `run_deck.py` (Sai, 2026-11-17).
- `types/investor_seed/golden_deck.json` failed `deck.schema.json` with three errors (a `stats` block kind and
  two `basis: null`). `stats` is in the block enum now. The two nulls are the `statement` blocks of the
  `problem` and `ask` slides, written by `assemble.py` line 762. The value for them is `opinion` (contract §9
  gives the reasons). Because the golden is what the engine writes, the golden and that line must change in one
  commit, which is an engine change and so not slice 1's to make alone; it waits on one approval.
- Golden churn is deferred, not avoided: `deck-layout-library` adds `layout` and `slots` to every slide and
  regenerates the goldens once, reviewed.

## Decided (Sai, 2026-11-17, in chat)

- ADR 0027 accepted with its four wording points; the Ollama guard accepted as a non-Claude check that can only
  add a flag (against ADR 0006); `deck-ci` approved; ADR number 0036; the template version 0.3.0.
- A person's decisions are at top-level `review.pinned` and `review.images`; the slide carries the runner's stamp.
- Defaults: picture source `existing`; density `lean` for a presented pitch, `detailed` for the full format;
  about 30 words per content slide for lean and about 60 for standard (`spec.DENSITY_WORDS`).
- A frame approved in the Territory tool arrives `made` in the deck; one click by the deck's approver approves a
  territory's four frames.

## Open

- Laurence's six answers replace the defaults recorded in contract §11.
- The Brand Clan's `visual.layout.logo_placement` (`corner`, `centre`, ...) and the deck's `logo.placement`
  (`cover_only`, `cover_and_footer`, `none`) are different lists; the mapping is Shrey's and Sai's to agree
  in `deck-look-kits`.
- The Style Pack's hash includes the reference files' names (`style._hash`). A Style Pack document must
  keep those names, or a document and a folder give different hashes.
- The two investor-golden values and `assemble.py` line 762 (above).
