# Brief Maker: arrange the brief on the page

Design for feature `brief-free-layout` (`features/brief-free-layout.clan`, branch
`feat/brief-free-layout`). Status: **exploring**. Nothing here is approved until the
owner sets `design.approved_by` in the record. Written 2026-10-30 from the owner's
requirements, a research pass (prior art, our own constraints, three candidate
designs and a critique) and a clickable mock.

The mock is outside the repo because its sample text is client material:
`~/Documents/napkin-design-mocks/brief-grid-v3/brief-grid-mock.html` (v1 and v2 are
earlier steps; `drive.mjs` next to it drives it headless). Open it, go to the Layout
tab, and press "Load the sheet from your test" to see the full target.

## 1. What the owner asked for

1. The planner **drags and drops the elements in the brief itself**, not in a side list.
2. How a field is **shown** belongs to the field and/or sits beside it.
3. A **free, grid-like layout**, not a fixed menu of templates. Agents give back data;
   the planner puts it in any format.
4. The template **works as shipped** with no effort; an agency can add its identity
   (logo, typography, colours, from a Brand Clan or an uploaded brand book) through
   **theme tokens only**.
5. Agent output stays data with evidence. A redraft must not wreck the planner's
   layout, and a layout change must not need a redraft.
6. Reference: the owner's two-sheet layout test (banner, info strip, boxed numbered
   cells, statements, an inverted block, sub-fields side by side, footnotes, sources).

## 2. The model: three documents, three writers

| Part | Holds | Written by | Stored in |
|---|---|---|---|
| **Fields** (the record) | What the brief says, with who wrote it and what it rests on | Agents, and the planner editing text | Existing top-level data keys (`insight`, `objectives.commercial`, ...) and the decision chain |
| **Layout** | Where each block sits, how it is shown, its tone and heading, where sheets break | The planner (later, optionally, a layout agent as a proposal) | New appearance key `brief_layout` |
| **Look** | Colours, type, logo, cover, frame, heading style, numbering | The planner, or a Brand Clan / brand book proposal the planner accepts | Existing appearance key `theme`, extended |

The rule from `docs/contracts/clan-fields.md` §1 carries over: what a field is, and
what it needs from a person, is the record's. A layout only chooses how a field
looks and where it sits. It cannot change a value, hide a part that needs review, or
change its evidence.

Why not DEV's blocks (deck-maker `slides[].blocks` with `basis` and `refs`)? There a
block carries its own text and its own placement, so the two cannot move apart.
Here a block is only placement. The one exception is the planner's own free text,
which is a block that holds content and is marked "written by you, no evidence".

## 3. Data shapes

### 3.1 Layout: `brief_layout`

```yaml
brief_layout:
  v: 1
  cols: 12                     # units are cells, never pixels
  blocks:                      # map keyed by stable block id: a drag patches one path per block
    bl_8K2Q1A: { ref: client,                      col: 1, row: 1, span: 3,  as: cell }
    bl_4M7ZPD: { ref: objectives.commercial,       col: 1, row: 5, span: 4,  as: prose }
    bl_9T3XWC: { ref: single_minded_proposition,   col: 1, row: 8, span: 12, as: statement,
                 tone: inverse, label: "The single thought" }
    bl_2F6HJE: { kind: break,                      row: 7 }          # a new printed sheet
    bl_7R1NQB: { ref: open_questions, out: true }                   # taken out, kept
```

- **Block ids** are `bl_` plus six base-36 characters, so a ref with dots
  (`objectives.commercial`) is never a map key and cannot collide with dotted patch paths.
- **`ref`** is the field's data path, using the ref grammar in `clan-fields.md` §2.1.
  A ref that resolves to nothing renders as "missing" and is kept.
- **`as`**: `prose`, `bullets`, `numbered`, `cards`, `cols`, `callout`, `statement`,
  `table`, `cell` (label over value). Any `as` can render any text or list; if a field
  changes shape in a redraft, the stored `as` is kept and renders flat if it no longer
  fits, so changing back restores the planner's choice. Resolution order: the block's
  `as`, then the field's default, then `prose`.
- **`tone`**: `plain` (default), `inverse` (paper on ink), `tint` (accent wash).
- **`label`**: the heading the planner typed; absent means the field's own name.
- **`row`**: rows are renumbered 1..n after every change and **auto-height**: a row is
  as tall as its tallest block, so new text grows a block and never clips or overlaps.
- **`out: true`**: the block was taken out of the brief. It keeps its size and look so
  placing it again restores both. Only an explicit planner action deletes a block.
  Nothing prunes blocks for fields that have gone missing.
- **`kind: break`**: a sheet break (full width, draggable, removable).
- A field with **no block** is "not placed yet": it appears in the tray, marked **new**
  if a redraft added it. It is never lost and never silently shown.

`brief_layout` is marked `x-clan-appearance`, so a person's layout change asks for no
reason and rolls into one look entry (`crates/napkin-host/src/ops/edit.rs:293-308`).
Two consequences the build must respect: every layout patch is **its own patch**,
touching only appearance keys (mixing in a content key loses the exemption); and the
host does not enforce "no layout moves on a locked brief", so the app does.

### 3.2 Look: `theme`

Existing: `bg`, `bg2`, `grad`, `accent`, `text`, `font`. Added:

| Token | Values | Notes |
|---|---|---|
| `head_font`, `font`, `scale` | font stack names, 0.9 to 1.25 | System stacks first; a brand font needs a font file (open) |
| `logo` | `{asset, pos, size}` | `pos`: cover left/right, footer, cover+footer, none; `size` 0.6 to 2.2 |
| `cover` | `plain`, `band`, `full`, `sheet` | `sheet` = the banner (logo, title, "SHEET n/N") |
| `frame` | `open`, `boxed` | `boxed` = ruled, touching, equal-height cells |
| `heads` | `label`, `tab` | `tab` = numbered black tab at the cell's top-left |
| `numbered` | boolean | Numbers come from reading order (see 5.3) |

`brief_style` (`basic|creative|immersive`) and `field_styles` (per-field font, size,
colour) are replaced by this, with no compatibility shim (owner to confirm; list the
documents that carry them first).

### 3.3 Fields

No schema change for sub-fields: `objectives.{commercial,behavioural,attitudinal}` and
`desired_response.{think,feel,do}` are already data paths, so each part is placed
individually and, by default, side by side. The owner's sheet also uses fields the
brief does not have yet; they are a **separate feature**, not part of this one:

| Field | Likely class | Notes |
|---|---|---|
| The job | agent-drafted | One sentence: what the work must make this person do |
| The barrier | agent-drafted | What in their head or habits stops the sale |
| Version, Brief date, Agency | derived by the host | From the document and workspace |
| Reference, Agency lead, Client lead | typed by a person | Shown "to confirm" until filled |

Until they exist, the layout just never references them.

## 4. Default arrangement (the template as shipped)

Computed, never stored, whenever `brief_layout` is absent:

1. An info strip: the small "cell" fields, four per row, three columns each.
2. Then each remaining field full width, in the template's field order.
3. A field's parts (same group) share one row, equal widths.
4. Sources last.

The first drag writes the whole arrangement into `brief_layout`, so from then on the
stored layout is the truth and the default is no longer consulted.

## 5. Interaction spec (all proven in the mock)

### 5.1 Modes
**Arrange** is a toggle. Off: the brief reads as it will export. On: each block shows
its controls on hover, focus or selection. Preview: Screen, Phone, PDF pages.

### 5.2 Move
- The grip (top-left, on the block's top border) starts a drag; the block's left edge
  keeps its offset from the pointer, so the column under the block's edge is the target.
- **Target rules**, in order: (1) pointer within 10 px of a row boundary: **insert a new
  row** there (a blue line); (2) pointer in a row, over free cells beside other blocks:
  the block lands there and **shrinks to the free cells** if it is wider (minimum 2);
  (3) pointer over another block, or no free cell: a **new row above that block**;
  (4) below the last row: a new row at the end.
- A dashed box shows the cells it will take; a line shows an insert. Auto-scroll within
  70 px of the viewport edge.
- One drop = one patch: the moved block plus any rows that shifted, appearance keys only.

### 5.3 Resize
The bar on a block's right edge changes `span` in whole columns, minimum 2, maximum up
to the next block in the row or column 12.

### 5.4 Per block
**Show as**, **Tone**, **rename heading** (click the title; Enter or blur saves; empty
restores the field's name), **take out** (to the tray). A block taken out and placed
again returns where the planner puts it, with its old size and look.

### 5.5 Keyboard and announcements
Focus a grip: arrows move one cell or one row (into a free cell, else as a new row);
Shift+arrows resize. Every move is announced (`aria-live`): block name, row, column,
width. Controls are real buttons and selects. The grip and bar use `touch-action:none`
and nothing else does, so the page still scrolls on touch.

### 5.6 Sheets
"+ Sheet break" adds a draggable break. With the `sheet` cover each sheet repeats the
banner with its number out of the total; otherwise a dashed "Sheet n starts here" line
shows on screen. In print each break is a page break. Numbers are derived (1 plus the
breaks before it), never typed.

### 5.7 Numbering
When `numbered` is on, reading order (row, then column) over all non-cell, non-break
blocks gives each a number; **blocks that are parts of one field share a number**
(three objectives are all 05). Numbers follow the layout, so moving a block renumbers.

### 5.8 Narrow screens and Phone preview
Below 600 px the grid becomes one column in reading order. No separate phone
arrangement. Arrange controls are hidden there.

### 5.9 Placeholders
A field the planner placed but that has no value shows a dashed "not drafted yet" box
with its hint. It is for the planner's eyes: the export prints the same box only if the
planner placed it, and the field's own "to confirm" state still applies.

### 5.10 Evidence and review are not layout
The evidence chip and review state of a part are drawn by the OS beside the block,
outside the heading, and cannot be hidden by `as`, `tone`, `heads` or `label` for any
part that is not verified. (The mock hides the author text under tab headings; the
build must not.)

## 6. Redraft behaviour

| Event | Layout |
|---|---|
| Field text redrafted or regenerated | Untouched. The block grows or shrinks with the text. |
| A redraft adds a field | Untouched. The field is in the tray, marked **new**. |
| A redraft removes or renames a field | Untouched. Its block renders "missing" until the planner removes it. |
| A field changes shape (text to list) | Untouched. The stored `as` is kept; it renders flat if it no longer fits. |
| The planner moves a block while a redraft runs | Last write wins, per block id. |

This is the property that makes the design worth building, and the first spike proves it.

## 7. Export

One render function, `renderBrief({fields, layout, theme, edit})`, serves the screen
(edit on) and the export (edit off). `buildExportHTML` becomes a call to it plus the
footnote and Sources markup from `features/brief-sources-in-export.clan`, then the
existing `window.clan.exportDoc(kind, base, html)`. The export:

- places blocks with static inline `grid-column` / `grid-row`, one grid per sheet or a
  page break per sheet break;
- prints inverse and tint tones with `print-color-adjust: exact`;
- avoids breaking inside a block (`break-inside: avoid`);
- never contains edit controls, `contenteditable` or selection state;
- lists only blocks that are placed (a field in the tray is not printed);
- needs the host's PDF renderer to honour grid placement, `outline-offset`, `color-mix`
  and `print-color-adjust`. **Spike before build** (section 9).

The headless CLI export (`clan export`) cannot run app code and falls back to the
default arrangement, with a note in the export footer. The in-app export is the one
that carries the layout.

## 8. Look intake: Brand Clan and brand books

An agency's identity arrives as a **proposal**: colours, fonts, logo and cover from the
Brand Clan's design language, or read from an uploaded brand book. Nothing applies
until the planner accepts (owner decision 2026-10-19: the brief's theme from the brand
is a proposal, never applied). The look panel then edits the same tokens. Reading a
brand book is a separate capability and the Brand Clan itself lives on
`feat/production-tool-overhaul`, so this slice waits for it; the tokens do not.

## 9. Build slices

Estimates are estimates, not measurements.

| Slice | What | Exit check | Size |
|---|---|---|---|
| **S0** | Five spikes below, and contract edits (docs only): `clan-fields.md` (`as`, `tone`, `label`), `os-layer.md` (appearance keys), `EXPORT-CONTRACT.md` (sheets) | Spike results recorded as decisions; contracts reviewed | 1 day |
| **S1** | `brief_layout` + theme tokens in `schema.json`; pure layout functions in one script block with a node test; default arrangement; `renderBrief` for screen and export; no editing yet | Old-brief fixture renders; export equals screen; layout test passes | 2 days |
| **S2** | Arrange: grip drag, resize bar, keyboard, announcements, tray, take out and place back | Headless real-mouse run; touch click-through on a phone | 2 to 3 days |
| **S3** | Show as, Tone, rename, placeholders, evidence chip kept outside the heading | Handler test: redraft leaves layout identical; review chip present in every look | 1 to 2 days |
| **S4** | Look panel: logo, type, colour, cover (incl. sheet banner), frame, headings, numbering, sheet breaks, contrast warning | PDF of a three-sheet boxed brief from the host path looks like the screen | 1 to 2 days |
| **S5** | Brand Clan and brand-book proposals | After brand-clan lands | with that feature |
| **S6** | New agent fields (the job, the barrier, meta cells) | Own feature record | separate |

Total for S0 to S4 is about 6 to 9 days plus one day of cross-device click-through.
Fallback if the hand-written drag runs long: inline GridStack (MIT, no dependencies),
at the cost of a fixed cell height that fights auto-height rows.

### The five spikes (before the owner approves)

1. **`json_merge` nesting.** Read `crates/napkin-host/src/ops/edit.rs:265` and prove a
   nested `blocks` patch merges per block id. If it replaces objects, write a whole-key
   patch per drag and say so here.
2. **Redraft preserves `brief_layout`.** `draft_brief`, `regenerate_field` and
   `fix_parts` leave an unknown top-level key byte-identical. Keep as a standing test.
3. **Pointer drag on a real phone** inside the sandboxed `allow-scripts` iframe, with
   page scroll.
4. **Host PDF renders the sheet.** Push the mock's loaded sheet (or a copy with invented
   text) through the real `exportDoc('pdf', ...)` path and look at it.
5. **An old document** that has its own `output-schema.json`: confirm the appearance
   exemption still applies (`appearance_keys` reads the app's schema too, edit.rs:370-373).

## 10. What the mock proved, and what it did not

Proved, headless Chromium, real mouse events, no page errors: resize; drop beside a
block with shrink-to-fit; insert a new row at a boundary and at the top; take out and
place back; renaming; tone; redraft that rewrites a field and adds one without moving
anything; Phone and PDF views; HTML download with no edit controls; a real
print-to-PDF; numbering matching the owner's sheets (05 shared by three objectives, 11
by three responses, mandatories 13); the sheet banner repeating with 1/3, 2/3, 3/3.

Not tested: touch dragging; Firefox and Safari; the host's own PDF renderer; the
layout as stored data (the mock keeps it in memory); concurrent edits; a brand-book
reader (simulated); locked briefs.

## 11. Open decisions

Listed with recommendations in `features/brief-free-layout.clan` (`open_questions`):
locked briefs; one field in two blocks; where new fields land; which meta cells are
derived; replacing `brief_style` and `field_styles`; sheet banner content; source
numbering; CLI export fallback; whether the sheet look ships as the house look; Brand
Clan sequencing; the deferred "Suggest layout" agent.
