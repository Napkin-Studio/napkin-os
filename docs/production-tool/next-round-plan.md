# Production Tool: the next round

Written 2026-10-15 for Shrey and Sai. Shrey listed ten things that are not done
in the Production Tool. Each one now has a feature record on the branch
`docs/next-round-plan`. Nine records hold a reviewed design. One record (item 9)
is a discussion paper, because it needs Shrey's answers before anyone can design
it.

Every record started as `status: exploring`. Nobody writes feature code until
Shrey approves the design and sets `design.approved_by` (CLAUDE.md, steps 2 and 3).
By the end of 2026-10-15 Shrey had approved six of them (the Status column below).
Read a record with `scripts/feature show <slug>`.

How we work this round (Shrey, 2026-10-15):

- `feat/production-ui` is the start point: every Production Tool commit so far,
  plus this plan and its records.
- `feat/production-tool-v2` is the interim branch. It starts identical to
  `feat/production-ui`.
- Each item is built on its own branch cut from `feat/production-tool-v2`
  (`feat/<slug>` or `fix/<slug>`), with its record and the usual design approval.
- Each item's branch merges into `feat/production-tool-v2` by PR. We test there
  (`scripts/check.sh --all`, then the local stack).
- When the round is tested, `feat/production-tool-v2` goes to `develop` in one PR,
  for more testing there, then on to `main` as a release.

Sizes: S is up to 1 day, M is 2 to 3 days, L is 4 to 6 days, XL is more than
6 days. One engineer working with agents.

## The ten items

| # | Shrey's words (short) | Record | Size | Status | Depends on |
|---|---|---|---|---|---|
| 1 | The image tool hangs and doesn't work. Click select is slow, and the fill is atrocious. | [image-perf-fill](../../features/image-perf-fill.clan) | L | Pending (owner answers) | Owner call on Ideogram; production-csp; server cut-out (infra, a person applies) |
| 2 | Lasso and Brush mask don't work at all. | [image-editor-masks-layers](../../features/image-editor-masks-layers.clan) | L (with 3) | **Approved** | Shares ImageEditor.tsx with item 1 |
| 3 | Hiding and showing layers is buggy. | [image-editor-masks-layers](../../features/image-editor-masks-layers.clan) | (with 2) | **Approved** | None (IM1-IM3 answered; IM4 split out, see below) |
| 4 | The top bar has too many buttons. The Job button can be just the turning wheel. | [topbar-declutter](../../features/topbar-declutter.clan) | M | **Approved** | None |
| 5 | You can't move the boards around. | [board-move](../../features/board-move.clan) | M | **Approved** | None |
| 6 | Storyboards are treated as the source of truth, so clips come out disjointed. Make one video, or give start and end references. | [connected-video](../../features/connected-video.clan) | XL | **Approved** | Paid tests (phase 0); clip-moment-edit; model-swap |
| 7 | Boards don't organise what is put on them. | [board-autolayout](../../features/board-autolayout.clan) | L | **Approved** (reworked) | board-move (nearestFree); container-select |
| 8 | The drawing's frame is hard to select. | [container-select](../../features/container-select.clan) | M | **Approved** | board-move (shared press table) |
| 9 | Each node could be a CLAN file with two props: what it shows and what it feeds. | [clan-nodes](../../features/clan-nodes.clan) | XL | Pending (**needs discussion**) | Owner answers; os-sign-in; brief-research-spin-in |
| 10 | Making a frame or a picture from a prompt on the canvas is not built. | [prompt-to-frame](../../features/prompt-to-frame.clan) | L | Pending (owner answers) | Shrey's canvas work for items 7 and 8 (phases 3-5) |
| 11 | One concept, every format: see it on billboards, TV, reels and print with one click (Shrey, 2026-10-15). | [campaign-formats](../../features/campaign-formats.clan) | XL | Pending (**needs owner answers**) | Owner answers CF1-CF11; ~$8.30 paid tests; connected-video phase 1; board-autolayout; audio-mix for phase 5's mix |
| IM4 | Open canvas pictures and references in the Image editor (split out of image-editor-masks-layers, 2026-10-15). | none yet | ? | Pending (**new discussion**) | Owner discussion first |

Each design was written by one agent and then checked by a second agent that
tried to break it. Every record keeps the corrections from that review as a
decision. File and line references were checked against the code on this branch.

---

## 1. Image tool hangs, slow Click-select, poor Fill

Record: [`features/image-perf-fill.clan`](../../features/image-perf-fill.clan) · Size L · Pending

**What we found**

- All on-device inference runs on the main thread. The first Click-select
  freezes the page for about 6 s. Every later click freezes it for about 0.27 s.
- The ML code loads the heavy WebGPU build (26.8 MB of wasm) even though
  Click-select only uses wasm. The plain build is 14.2 MB.
- Nothing prepares the picture before the first click, and nothing shows
  progress.
- Remove background downloads 115 MB with no progress and can run 2 minutes on a
  weak GPU. Its server fallback is not deployed, so the relay answers 422.
- Pick masks are stored at 256 px and scaled up with nearest-neighbour, which
  gives stair-stepped edges.
- Fill: Ideogram is off by default (an owner decision), so Fill goes to Gemini.
  Gemini redraws the whole frame from a red box. The client pastes that back
  inside a hard, stair-stepped mask that is up to about 28 px out of line.

**The approach**

- Two Web Workers. A select worker on the plain wasm build stays alive for the
  editor. A cut-out worker on WebGPU can be stopped to cancel.
- Prepare the shown picture in the background when the editor opens. Show
  progress as text plus a thin bar in Rhea's line. No spinner.
- Queue clicks in order. Store pick masks at up to 1024 px, drawn smoothly.
- Relay: line the Fill result up with the input exactly, stitch it back by the
  mask with a soft edge, and match colour around it.
- With Ideogram off, Gemini edits a crop around the area, and the relay stitches
  the crop back. Pixels outside the crop stay exactly as they were.

**Phases**

| Phase | Size |
|---|---|
| 1. Workers, client API, streamed model download | M |
| 2. Warm-up, progress line, Cancel, device choice | S |
| 3. Sharper masks, cached mask drawing, touch subtract | S |
| 4. Model spike (SlimSAM, MobileSAM, EfficientSAM) | S |
| 5. Relay fit-back and soft stitch; client feather and colour match | M |
| 6. Gemini crop-and-stitch (only if Ideogram stays off) | M |
| 7. Apply the owner's Ideogram decision | S |

It ships as two PRs: PR 1 is the web (phases 1-4), PR 2 is the relay (phases 5-7).

**Open questions for Shrey**

- Turn Ideogram (Fill) and Magnific (Upscale) on by default? Their data
  protection terms are "not yet confirmed".
- May the editor fetch about 28 MB and prepare the picture as soon as it opens?
- Should Click-select segment the picture as shown (after Fills) or the base frame?
- Keep model weights on huggingface.co, or move them to our CloudFront?
- Make the server cut-out live now (a person applies Terraform)?
- Keep the "Keep everything outside the blue" checkbox?
- Which laptop is the reference for the 400 ms click goal?

## 2 and 3. Brush and Lasso, layer hide and show

Record: [`features/image-editor-masks-layers.clan`](../../features/image-editor-masks-layers.clan) · Size L · Approved

**What we found**

The brush and lasso maths is correct. The problems are around it:

- A running job puts a card over the whole stage for 10 to 60 s. The card also
  swallows its own Cancel button.
- Painting on a hidden mask is invisible.
- Subtract with nothing to subtract fails silently, or makes an empty mask that
  Fill then rejects.
- Every stroke re-draws every earlier stroke. By stroke 15 one stroke takes
  1.2 s to appear. Every pointer move rebuilds the whole overlay.
- Ctrl/Cmd+Z undoes a document change, not the stroke.
- Layers: Remove background hides the Frame by itself. Hiding the Frame also
  hides every Fill result. Hidden layers are dropped from Apply without saying
  so, and are then lost.

**The approach**

- Move the job's status and Cancel into its row in the Edits list. The stage
  stays visible.
- Draw the live stroke on its own canvas. Cache committed strokes, so a new
  stroke only adds itself.
- Painting shows a hidden mask. Subtract with no mask does nothing and says so.
- Editor-local undo for strokes.
- One rule for what is sent and applied: what you see. Hiding the Frame hides
  only the original picture.
- A Playwright harness with real pointer events, shared by the other UI items.

**Phases**

| Phase | Size |
|---|---|
| P0. Playwright harness and seed helper | M |
| P1. Stage input and the job row | M |
| P2. Targeting rules and editor undo | S |
| P3. Fast mask drawing | M |
| P4. Layer rules (after Shrey answers) | M |
| P5. 9:16 fit and the spec | S |

**Open questions for Shrey**

- Should sends include exactly what is visible, or always include the Frame?
- Should Remove background stop hiding the Frame by itself?
- At Apply, keep hidden edits in the session, or drop them with a warning?
- Separately: canvas pictures can't open in the editor today. Is that wanted?

## 4. Top bar is cluttered

Record: [`features/topbar-declutter.clan`](../../features/topbar-declutter.clan) · Size M · Approved

**What we found**

- Nothing in the bar may shrink. The job pill is a sentence up to 420 px wide.
- At 1440 px, Video with 3 clips running is 1610 px wide. Render ad and the
  account button are off-screen. At 1180 px, three editors overflow even when idle.
- Storyboard shows the project name twice. Only Script has a More menu.
- On iPad there is no hover, so tooltips never show.

**The approach**

- The job pill becomes the turning logo with a count. The sentence moves to the
  tooltip, the screen-reader text and the first row of the popover.
- One shared More menu on every bar. Export and Save now move into it.
- Fixed fit levels by viewport width (full, compact, tight). Titles shrink first.
- Script moves onto the shared editor bar.
- On touch: a 56 px bar, 44 px targets, and Undo always visible.

**Phases**

| Phase | Size |
|---|---|
| 1. Shrinking titles, fit levels, width budget test | S |
| 2. Job button | S |
| 3. More menu and shared save state | S |
| 4. Script onto the shared bar | M |
| 5. Image editor zoom (after Shrey answers) | S |
| 6. Responsive and touch | S |
| 7. Spec and checks | S |

**Open questions for Shrey**

- Assets: keep it as an icon button, or move it into the Boards rail?
- Image editor zoom: move it to a pill on the stage, or keep it in the bar?
- Below 1024 px, move Share into More?
- Copy link in Storyboard, Video and Image: ship it disabled until those editors
  have links, or build the links now?

## 5. Boards can't be moved

Record: [`features/board-move.clan`](../../features/board-move.clan) · Size M · Approved

**What we found**

- A board can only be picked up by an invisible strip above its top edge. At the
  default zoom the title chip is 10 px tall.
- Pressing inside a board or on its edge starts a selection box.
- Arrow keys do nothing. A finger can only pan.
- A moved board can land on another board and hide under it.
- Bug: dragging a locked board moves its contents off it.

**The approach**

- One grab test in the canvas engine: the title chip, the edge, and the inside.
- A title chip that is always at least 20 px tall on screen, with grab cursors.
- One documented press-priority table (`grabOrder`). Items 7 and 8 add rows to
  it instead of adding branches.
- When you let go, the board lands at the nearest free spot. A dashed outline
  shows where while you drag.
- Arrow keys nudge. A finger moves a board by long press, then drag.

**Phases**

| Phase | Size |
|---|---|
| 1. Grab test, press table, title chip, cursors | S |
| 2. Landing rule and outline | S |
| 3. Arrow-key nudge | S |
| 4. Touch (long press) and tap-to-select | S |
| 5. Spec and smoke test | S |

**Open questions for Shrey**

- Should dragging inside an unselected board keep making a selection box?
- Should a click inside a board select the board, or clear the selection?
- Is long press then drag right for fingers?
- Should dragging a Script, Storyboard or Video card move its board when the
  card is the only thing on it?
- Should loose ink block where a board can land?
- The same edge moves an unselected board and resizes a selected one. Is that OK?
- Fix "a resize can grow under a neighbour" here, or separately?

## 6. Clips don't join into one film

Record: [`features/connected-video.clan`](../../features/connected-video.clan) · Size XL · Approved

**What we found**

- Every clip is pinned to its storyboard frame as the first frame. Veo gets no
  character pictures.
- Nothing links clip N to clip N+1.
- The stitcher cuts each clip from its start and hard-joins them with no sound.
  It walks shots in order and ignores the edit list's in and out points.
- Bridge (first plus last frame on Veo) is in the spec but refused as not built.

**The approach**

- Each gap between two shots gets a seam: cut, continue, match, dissolve or
  bridge. Dex proposes it. A person can change it on a chip in the Video editor.
- **Continue:** the next clip starts on the previous clip's last frame.
- **Match:** the next clip's first frame is redrawn from that last frame plus
  the named characters, with the storyboard frame as layout only.
- Storyboard frames pin only the first shot of each run and product or text
  shots. Everywhere else they are inspiration.
- Joined shots run in order. The run lives in the document, and each step has an
  idempotency key, so a closed tab or two people can't stall or pay twice.
- **One take** (one generation across several shots) is Shrey's first choice.
  It is tested first, in phase 0. If it works, it is offered alongside chaining.
- A retake never marks later shots out of date. It shows a quiet note, and
  "Carry the join forward" remakes them only on request.

Cost: about $3.40 for a 15 s ad on veo3.1_fast, against about $2.40 today.

**Phases**

| Phase | Size |
|---|---|
| 0. Paid tests T1-T7, run by a person (One take first), about $19 | S |
| 1. Stitch: edit list, in and out points, transitions, seam scores | M |
| 2. Contract, seam planner, gap chips | M |
| 3. Joined generation (continue, match, bridge) | L |
| 4. Frames as references (after model-swap) | M |
| 5. One take (only if its test passes) | L |

**Open questions for Shrey**

- Should Dex set seams quietly, or ask once per video? Should "As one film" be
  the default?
- Is a 3 to 5 minute longer wait acceptable?
- Approve the about $19 of paid tests, run by Sai?
- If One take passes, should it be the default for shots without dialogue?
- Allow dissolves by default?
- Should first shots, product shots and text shots always keep their storyboard
  frame?
- Is Bridge part of this, or separate?
- Is "Carry the join forward" the right replacement for out-of-date marks?

## 7. Boards don't organise themselves

Record: [`features/board-autolayout.clan`](../../features/board-autolayout.clan) · Size L · Approved (reworked 2026-10-15)

**What we found**

- The Ad template leaves the picture boards no room to grow. One portrait
  picture fills Characters. After that, pictures scatter outside the board on
  several sides.
- Paste and the Picture tool pile everything on one spot.
- Naming a picture doesn't take it to its board.
- Placement knows nothing about keys, roles or shot order. The placement rules
  exist in two copies.

**The approach (reworked to Shrey's answers, 2026-10-15)**

Shrey: "Don't shuffle the old things, make space for the new thing" (BA1), and
start new projects on an empty canvas (BA2 = c).

- **An empty canvas.** A new project has no Ad template and no boards. Its
  Script, Storyboard and Video nodes are placed as today, and never get a board.
  Excalidraw doesn't change.
- **Boards are for collections of pictures.** A person makes one ("+ New board",
  or B and drag), or accepts the nudge: when two or more loose pictures share a
  role, their selection bar offers "Gather into a Characters board". That is one
  undo step: the board lands clear of its neighbours (board-move's `nearestFree`)
  and the pictures go in, laid out by the board's purpose. If a Characters board
  already exists, the bar offers "Move to Characters" instead.
- **The rail lists nodes and boards.** Script, Storyboard and Video first, then
  the boards by rank, so ⌥1 still jumps to Script (review item 1).
- **Make space, never shuffle.** Nothing already on a board moves by itself. A
  new picture takes the next free slot of its board's layout: a key's new view
  goes after its other views, a new key starts a new row, References go in rows
  by role (no row labels in v1), and many views of one key stay one full row.
  The board grows to fit it by the 2026-10-15 rules. What can't fit goes in one
  row outside. A drop that lands free inside a board stays exactly there.
- **Naming routes.** Naming a loose picture moves it to its role's board, with
  Undo, when there is one. A picture already on another board stays, with
  "Move to Characters" in its bar.
- **Tidy** in the board bar lines a board up by its purpose. It is the only time
  existing members move.
- **Existing projects keep their boards**, node boards included. Nothing is
  removed. Their picture boards follow the next-slot rule, with a one-time note.
- Paste, Picture (I) and + Node off a board land clear of everything.

Dropped from the reviewed design: the roomier template, re-ordering by drag
and its insertion marker, the "Arranges itself" switch (and its board prop),
and the order on a Storyboard board (a storyboard's frames stay inside its node).
There is no document or canvas contract change.

**Phases**

| Phase | Size |
|---|---|
| 1. Empty canvas, the rail lists nodes, free-spot paste, one overflow row | S |
| 2. Engine placer: next free slot and Tidy | M |
| 3. Lanes per purpose, routing after naming, Move to <Board> | M |
| 4. The Gather nudge, Tidy in the bar, the one-time note, glides | M |
| 5. Spec and smoke | S |

**Shrey's answers (2026-10-15), all in the record**

- BA1: new things take the next free slot; old things never move on their own.
- BA2 = (c): empty canvas; nodes never get boards; boards by hand or the nudge.
- BA3 yes: a picture named for another board's role stays, with "Move to Characters".
- BA4 yes: many views of one key make one full row.
- BA5 yes: no role labels on References rows in v1.
- BA6 dropped: a storyboard's frames stay inside its node.
- BA7 yes: existing boards follow the new rule, with a one-time note.

## 8. A drawing's frame is hard to select

Record: [`features/container-select.clan`](../../features/container-select.clan) · Size M · Approved

**What we found**

- Strokes are hit by their bounding box, which covers the frame. Only 66% of
  clicks on a stick figure select its Drawing, and 20% on a real sketch.
- The label can't be clicked. Esc doesn't clear a selection.
- Right after Generate the strokes stay selected, so the first drag pulls them
  out of their own Drawing.
- Ink drawn on a Drawing later never joins it.

**The approach**

- A click goes up to the container: the Drawing, then the group, then the element.
- A double-click or double-tap enters the container to pick one stroke. Esc
  leaves it.
- Strokes are hit by distance to their line, not by their box.
- The Drawing is selected after Generate. Ink drawn inside a Drawing joins it,
  and the frame refits.

**Phases**

| Phase | Size |
|---|---|
| 1. Precise stroke hit | S |
| 2. Container resolution and entered scope | M |
| 3. Labels and Esc | S |
| 4. Drawing upkeep (refit, join, select after Generate) | S |
| 5. Tests and PR | S |

**Open questions for Shrey**

- Should sketch areas behave like Drawings when clicked?
- Should ink drawn inside a Drawing join it automatically?
- Add Generate to the ink-group bar here?
- When the last stroke leaves a Drawing, keep the empty Drawing?
- Show a faint outline on hover?

## 9. Nodes as CLAN files (discussion)

Record: [`features/clan-nodes.clan`](../../features/clan-nodes.clan) · Size XL as written · **Needs discussion**

This is a discussion paper, not a design. The idea: every node has two
properties, what it **shows** (its card) and what it **feeds** (typed outputs
that linked nodes use, such as tone, proposition and mandatories). Brief,
Research and Pitch could then sit on the canvas next to the production tools.

**What exists today**

- The contract already allows a Document or note to be linked into Script,
  Storyboard or Video as context. `JobInput.context` exists. Nothing fills it
  and nothing reads it.
- Only pictures flow today. Card content is hand-written for three kinds.
- Brief Maker documents live in napkin-web's tenant store. Projects live in the
  relay's S3.
- An earlier plan, `feat/brief-research-spin-in`, already designs a signed,
  tenant-checked brief view. It is not approved.

**The options: what "a node is a CLAN file" could mean**

| Option | What it is | Cost | Fits |
|---|---|---|---|
| A. Reference | The node pins `{doc_id, app, version}`. The document stays in its own app. The card shows a signed view of the approved version. | M for the first app, S after | Brief, Research, Pitch |
| B. Embed | A copy of the document goes inside the project. | M to L, and up to MBs per brief | Not recommended (size cap, client material in S3) |
| C. Sections | The document becomes part of the project file. | XL for Brief | Production nodes already work this way |
| D. Show/feed contract | One manifest per node kind: what it shows, what it feeds, what it never feeds, what each kind accepts. | S + M + M | Works with A or C |

Tentative: D with A for Brief, Research and Pitch. D (feeds and accepts only)
with C for the production nodes, which keep their own cards.

**One part can start without the discussion.** Phase 1a fills and reads
`JobInput.context` for linked notes and Documents, and adds Document to + Node.
Size S. Every option above needs it.

**Questions for Shrey**

1. What does "a node is a CLAN file" mean to you: A, B, C or D?
2. Should Script ever become its own file?
3. Is a brief edited only in Brief Maker, or also on the canvas?
4. Which version does a linked brief feed: the latest approved one, pinned with
   an Update button (recommended), or the latest draft?
5. Pitch: an input node, or an output made from the project?
6. Is what flows along a link fixed, or does a person tick it on the link?
7. Is what a card shows fixed per kind, or can a person choose?
8. What exactly does Brief feed Video and Storyboard? Never materials, capture,
   passages, budget, objectives or review?
9. Can one brief feed many projects? Does a new approval switch them all?
10. A person who can open the project but not the brief: a locked card, or nothing?
11. Does the Brief node replace the "From Napkin" spin-in card?
12. Should a feed carry how it is used ("as inspiration" or "as keyframes")?
    This ties into item 6.
13. Does an export carry only references, or a frozen excerpt of the brief?
14. Fold `feat/brief-research-spin-in` into this record?
15. Other OS apps as nodes now, or only Brief and Research?
16. Must Dex say why for each brief feed it uses in a shot?
17. May phase 1a go ahead now?

## 10. Prompt to frame or picture on the canvas

Record: [`features/prompt-to-frame.clan`](../../features/prompt-to-frame.clan) · Size L · Pending

**What we found**

- "+ Node → A picture" only uploads a file. The picture-from-words start in the
  code is not used anywhere.
- An empty sketch area sends a blank white layout picture.
- A storyboard can't draw any frame until a picture is named. Yet the relay and
  Runway already draw frames with no references (tested on the mock).
- Unknown @names block every send. With the real director, a name with no
  picture makes the director's answer fail, and the job quietly falls back to a
  bare prompt.
- The editor's "describe the frame" start can't be reached.

**The approach**

- "+ Node → A picture → Describe it" opens the existing send tray, with a new
  shape pill. The picture lands at the point, on the board under it.
- After it lands, an inline "Just added" chip lets you name it. No dialog.
- Remove the "name a picture first" gates. A name with no picture is said in
  plain words. "Make @samurai first" makes it through the tray.
- The relay says unpictured names in words instead of refusing. A new
  `director.v9` adds rules for frames without references.
- An empty sketch area sends words only.

**Phases**

| Phase | Size |
|---|---|
| 1. Frames without named pictures (web) | M |
| 2. Relay director rule and director.v9 | S |
| 3. Canvas "Describe it" | M |
| 4. Empty sketch area | S |
| 5. Naming chip | S |
| 6. Use in shot N; Make @name first | S |
| 7. Browser checks, two PRs | S |

**Open questions for Shrey**

- Should Draw frame and Draw the rest go through the send tray, now that they
  can spend with no names?
- Double-click on empty canvas to describe: own engine only, or drop it?
- Should "plan from a line" write that line into the script?
- Should Dex recommend "Make @samurai first"?
- Default shape for a picture outside every board: scene or portrait?
- May the builder record director.v9 evals? That calls Claude and costs money.

---

## 11. One concept, every format

Record: [`features/campaign-formats.clan`](../../features/campaign-formats.clan) · Size XL · Pending
(**needs owner answers**). Full write-up with sources: [campaign-formats.md](campaign-formats.md).

**What we found**

- Agencies adapt one approved master into each format: re-laid stills, film cutdowns
  (30, 15, 6 s) and native bumpers. The logo, line, colours and fonts stay locked, and a person
  reviews every format.
- Tools (Adobe GenStudio, Canva, Pencil, Celtra, Smartly, Meta and Google auto-crop or expand) make
  "one click" reliable for stills only. Auto-crop cuts logos and heads, and generative fill goes
  soft at print size.
- 3.19, the format packs (67 draft formats) and contract-v3's `format_set`, `size`, `resize` and
  `cutdown` exist, but nothing is built. `selbar.ts:55` is a stub.
- 3.19 assumes things the models can't do:
  - no Runway model tracks a subject;
  - images have no outpaint, only an Ideogram 4.5 mask;
  - Aleph 2 has no 4:5;
  - Veo makes only 16:9 and 9:16.

**The approach (D, a method per format)**

- Wren asks once what must stay. Each format is then a free crop when that holds, an Ideogram extend
  for moderate gaps, or a Gemini regeneration for extreme shapes. Banners are a layout.
- Type, logo, supers and the end card are layers laid out per format, never painted into pictures.
- Cutdowns re-edit the same takes. Dex picks the beats and Edie cuts.
- Vertical, 4:5 and 1:1 video are crops per shot, with Aleph 2 only on the shots where the crop fails.
- Everything lands on one Campaign board: a grid by channel with safe-area overlays, status, Jude's
  checks, and Redo, Change method, Adjust crop, Edit type and Lock on each tile.
- Export makes one zip at delivery size with a manifest. OOH files say "Confirm with the media owner".
- A typical campaign costs about $7 for previews and about $15 delivered, shown only in History.

**Phases**

| Phase | Size |
|---|---|
| 0. Paid tests CF-T1..T6 (~$8.30, cap $10) | S |
| 1. Contract | M |
| 2. Campaign board and free crops (usable alone) | L |
| 3. Type as layers, Jude per format | M |
| 4. Paid stills: extend, regenerate, layout, delivery upscales | L |
| 5. Cutdowns (re-edit) | L |
| 6. Video re-aspect (crop, Aleph where needed) | L |
| 7. Optional: in-place mock-ups; Seedance/WAN after model-swap | M |

**Open questions for Shrey** (each has a recommendation in the record)

- CF1. Method per format (D), or crop only first?
- CF2. 2K previews, with delivery upscales only on export?
- CF3. A mixed "Campaign launch" pack, plus clients' own mixes?
- CF4. In-place mock-ups ("see it on a billboard") for pitching?
- CF5. Default cutdown lengths: 15 s and 6 s?
- CF6. Vertical video: crop and Aleph, or remake natively on Veo?
- CF7. 4:5 video made at 3:4 and then cropped?
- CF8. May Skye suggest a shorter OOH line (ask only)?
- CF9. Burn captions into the social versions by default?
- CF10. Show the Format set as a Campaign board instead of a node card?
- CF11. Approve about $8.30 of paid tests?

---

## Who does what (decided by Shrey, 2026-10-15)

Shrey: "Assign me the open decision discussion we have. The rest you can divide as
per your wish, just any open decisions those designs have, give those to me, rest
to Sai."

- **Shrey decides.** He approves each design (`design.approved_by`), answers every
  open question in the records (65 in all), and leads the clan-nodes discussion.
  Handoff H-2 in `napkin-studio.clan`.
- **Sai builds.** He owns the eight designed records (`owner: Sai`) and builds each
  one once Shrey has approved it. Handoff H-3 in `napkin-studio.clan`.

| Record | Open questions (Shrey) | Builds (Sai) | Size |
|---|---|---|---|
| image-editor-masks-layers (2, 3) | 4 | yes, **first** | L |
| board-move (5) | 7 | yes, **first** | M |
| container-select (8) | 5 | yes | M |
| topbar-declutter (4) | 4 | yes | M |
| image-perf-fill (1) | 7 | yes | L |
| prompt-to-frame (10) | 6 | yes | L |
| board-autolayout (7) | 7 | yes | L |
| connected-video (6) | 8, plus approving about $19 of paid tests | yes | XL |
| clan-nodes (9) | 17, plus choosing option A-D | after Shrey decides and a design is written | XL |
| campaign-formats (11) | 11, plus approving about $8.30 of paid tests | yes, after Shrey's answers | XL |

### Build order for Sai

Sai works on at most two items at a time (the project's WIP limit). The order puts
the bugs Shrey hit first, then follows the shared files, so later items build on
earlier ones instead of colliding:

1. **image-editor-masks-layers** and **board-move.** Both are bugs Shrey hit.
   board-move lays down the press-priority table (`grabOrder`) that items 7 and 8
   extend. masks-layers P0 also lands the Playwright harness every later UI item uses.
2. **container-select**, after board-move (it adds rows to `grabOrder`).
3. **topbar-declutter.** Its phase 4 moves the Script editor onto the shared bar,
   so it lands before prompt-to-frame and connected-video touch `ScriptEditor.tsx`.
4. **image-perf-fill**, after masks-layers (both touch `ImageEditor.tsx` and `Stage.tsx`).
5. **prompt-to-frame.** It creates `director.v9`, which connected-video extends.
6. **board-autolayout**, after board-move and container-select (it reuses
   board-move's `nearestFree` and container-select's membership map; since the
   2026-10-15 rework it adds no `grabOrder` rows).
7. **connected-video**, after Shrey approves its paid tests (phase 0).
8. **clan-nodes**, once Shrey has decided and its design is approved.
9. **campaign-formats**, once Shrey has answered CF1-CF11 and approved the design. Phases 1-3
   spend nothing and can start after board-autolayout. Phase 5 needs connected-video phase 1
   (the stitch edit list).

### What Shrey's answers unblock

Each item starts when Shrey approves its design. Some phases also wait for a
specific answer:

- image-perf-fill phases 5-7: whether Ideogram (Fill) and Magnific (Upscale) are on by
  default decides whether phase 6 (Gemini crop-and-stitch) is needed.
- image-editor-masks-layers P4: the hidden-layer rules.
- topbar-declutter phase 5: where the Image editor's zoom goes.
- board-move phases 1 and 4: what a click inside a board does, and touch.
- connected-video phase 0: approve about $19 of paid Runway tests. Phase 3 and later
  follow their results.
- board-autolayout: answered and approved (reworked: an empty canvas, picture
  boards by hand or by the Gather nudge, new things take the next free slot, and
  the 2026-10-15 "stays where dropped" rule is kept).
- container-select phase 2: how sketch areas behave.
- prompt-to-frame: whether Draw goes through the send tray, and recording director.v9
  evals (paid).
- campaign-formats: everything (CF1-CF11). CF2 and CF6 set the cost per pass, and CF11 approves
  about $8.30 of paid tests (phase 0).
- clan-nodes: everything, except phase 1a (fill and read `JobInput.context`), which
  needs only its own approval.

---

## Backlog: earlier open items (not designed here)

Shrey answered "yes" to the recommended fix for several of these on 2026-10-15.
They are marked **Decided**, with where each one is being done.

| Item | Suggested size |
|---|---|
| **Decided (yes, 2026-10-15).** The local relay saves jobs to disk, so a restart can't lose a paid clip. Being built on `fix/relay-durable-jobs`. | S |
| **Decided (yes, 2026-10-15).** Decide where pictures are saved. 17 pictures existed only in the browser, not on the relay. Being investigated on `fix/picture-storage`. | M |
| Ideogram and Magnific on by default? (Also an open question in item 1.) | S (a decision) |
| Ad template: growing room for boards. Moot: board-autolayout's rework (2026-10-15) drops the template; new projects start on an empty canvas. | — |
| **Decided (yes, 2026-10-15).** Ink drawn on a board joins the board. In `feat/board-move`. | S |
| Strokes move with their Drawing frame. (Partly covered by container-select.) | S |
| A drawn frame's label overlaps the board title. | S |
| **Decided (yes, 2026-10-15).** The Delete key deletes a selected link. In `feat/board-move`. | S |
| **Decided (yes, 2026-10-15).** Picking `@samurai` from the @ popover links the key. Checked on 2026-10-15: **it already does, in the Script editor.** The popover offers a key with two or more views as one row, "@samurai · 3 views" (`text/mention/source.ts` `mentionSource`). Picking it, or any one of its views, adds one key→script link in the key's role, as one undo step, and the page says "Linked @samurai · 3 views to this script" with Undo (`linkForMention` in source.ts, `scriptMentionHooks` in `script/mentionHooks.ts`, the toast in `ScriptEditor.tsx:154`). Test: `text/mention/source.test.ts` ("a view of a key with two or more views links the whole key, once, in its role"). In the Storyboard and Video shot editors nothing links, because they have no script (`Storyboard.tsx:102` and `VideoShots.tsx:29` pass no script, so every reference counts as in scope). A test that picks the group row itself (kind `key`, not yet linked) is missing; add it with the next change there. | S (a test) |
| **Decided (yes, 2026-10-15).** The phone bar gets the job icon. Added to `topbar-declutter` for Sai (decision and `next_step` on the record). | S |
| Nvidia CUDA server exception: keep it or drop it? | S (a decision) |
| A third-party notices page before the first customer. | S |
| Host the client model weights on our CDN. (Also an open question in item 1.) | S-M |
| `scripts/check.sh` rebuilds `production-tool/web/dist` with base `/`, which breaks the live `/production` stack. Build to a separate outDir. | S |
| Brief and Research as nodes. Plan on branch `feat/brief-research-spin-in`, waiting for approval. (Overlaps item 9.) | M |
| The `production-csp` and `clan-sdk-repack` records, on `feat/production-tool-overhaul` (PR #75). | M each |
| Terraform applies for os-sign-in and the image editor's server cut-out. A person runs them. | S each |
| Set `TOKEN_SECRET` before deploy. | S |
| **Decided (yes, 2026-10-15).** Skye's draft answered after its scene was undone lands as a new first scene. In `fix/relay-durable-jobs`. | S |
| In another browser, Skye's waiting question shows only at the top of the page, not on its line (the target lives in the asking browser). Needs a contract field. | S |
| Flaky under the full parallel test run, pass alone: `src/canvas/nodes/cards.test.tsx` (empty-node PromptStart) and `src/script/perf.test.ts` (compose under 100 ms); in mock-backend, `test_model.ModelServer.test_concurrency_cap` (one request short under load). All three failed inside the pre-push hook once and passed on rerun. | S |
| **Decided (yes, 2026-10-15).** The pre-push hook change. Shrey approved it, but the agent permission classifier blocks it as a CI change, so a person applies it to `.githooks/pre-push`. | S |
