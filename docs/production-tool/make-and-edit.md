# Make and Edit: generate footage, then cut it

features/make-and-edit.clan. Approved by Shrey on 2026-10-20 (canvas boards 25-27: Make room, Edit room, Change a take).

The Video editor splits into two rooms over one shared Bin. Make is where you ask Runway for footage: boxes of shots, references, and new takes with one thing changed. Edit is a plain multi-track timeline where you cut that footage. Every generation is its own record (a take) in the Bin, and a timeline clip points at a take, never at a shot. A regeneration always lands as a new take next to the old one, and 'Use this take' swaps it into the same slot, keeping its position, trims, fades and dissolves.

## The mental model

Think of a shoot and a cutting room. Make is the shoot: 'get me this shot', 'get me shots 1 to 3 as one go', 'same shot again but handheld', 'same clip but his shirt is red at 0:06', 'make one shot out of these two clips and the pack shot'. Everything Make produces is footage, a take. It goes into the Bin and never overwrites anything you already have. Edit is the cutting room: you drag takes onto tracks, put one above another, trim, split, fade, dissolve, add text and the end card, and render. Edit never spends anything. The two rooms talk in two plain ways. 'Change this…' on a clip or a marked stretch of the film opens the Change drawer, without leaving Edit. The result comes back as 'New take ready' on that clip, and you choose 'Use this take' (same slot, every edit kept), 'Keep both' (it goes on the track above) or 'Not now'. Boxes still mean what was chosen today: one box is one generation, and the lines inside it are the cuts. Changing one shot inside a box remakes the whole box, because it was filmed as one. In Edit, a box arrives as separate clips at its cuts, joined by a thin bracket. So 'regenerate' always means 'a new take next to the old one', and 'edit' always means 'arrange what I have'. The canvas stays the front door: the film's Video node opens either room, and Back returns to it.

## Screens

### Shared top bar (both rooms)

Fixes the missing Back button (Image #6) and makes the two rooms obvious. It carries the card tokens that fix the uneven boxes and clipped text (Images #4 and #5).

**Layout.** 56px tall, full width. Left (16px gutter): a 44x44 Back button '‹ Canvas', then the film name (one line with an ellipsis, full name on hover). Centre: a segmented control 'Make | Edit', each half 120x44. Right: the Jobs pill ('2 making'), 'Open Sound', and the primary button ('Render ad' in Edit, 'Go to Edit' in Make). Global tokens: card radius 12, clip radius 8, padding 12, a 1px border token, titles clamped to 2 lines with an ellipsis and a tooltip, no text within 8px of a rounded edge, and every control at least 44px.

**Interactions.**
- Back returns to the Video node on the canvas. Esc closes an open drawer first, and a second Esc acts as Back.
- 1 or 2 switches room. The selection carries across, so a clip picked in Edit opens its box in Make.
- The Jobs pill lists the takes being made, with plain states (Sending, Making, Checking, Ready). There are no prices; credits appear only in History.

### Make room

Ask for footage. It holds today's box model, per-shot Direct, the takes per box and Compare.

**Layout.** Bin on the left (280px). Centre (about 784px): a player (784x441, scrub bar, timecode in Geist Mono), then the Boxes strip. The strip is one row of box cards, each holding its shot cards. A line between two shot cards is a cut, and a box border is one generation. Under each box sits its takes stack: thumbnails v1…vn, newest first, each with a one-line change label ('Camera: handheld (shot 3)'). A dashed '+ New box' card ends the row, and a 'Film look' chip starts it. Right: Direct panel (376px) with tabs Shot, Box and Change. Shot covers camera (size, angle, movement from the common.schema cameraMovement enum), start and end frame wells, Cast & look ref chips (@ names, up to the model's refsMax), length and speed. Box covers Together/Apart, continuity, and model (filtered by capabilities, with greyed options and a one-line reason). Change is the shared Change component. When a box already has takes, the header reads 'Next take differs: camera Handheld'. Old takes are never marked stale.

**Interactions.**
- Click a shot card to open the Shot tab. Click the box border to open the Box tab. Click a take thumbnail to play it.
- 'Make' on a box sends one generation. The new take lands on that box's stack, and the timeline is not touched.
- On the takes stack, tick two takes and choose 'Compare': side by side or wipe, with one linked scrub bar.
- Pause the player and drag the frame onto a start or end frame well ('Use as start frame').
- Right-click a take for 'New take with a change…', 'Add to edit', or 'Show lineage'.

### Change drawer (one component, opens in Make or over Edit)

The single place to regenerate with a change. It always says what is kept and what changes, so 'same video but X' is explicit.

**Layout.** 480px right drawer. At the top, a 270px player of the parent take with scrub and a dual time readout ('Box 2 at 0:01 · ad 0:06'). The header names the parent ('Box 2 · take v2 · 3.5 s'). Below that, a list of verbs, each a 48px row: Camera, Words, Cast & look, A moment, The whole feel, Make it longer, Blend with other clips. Choosing one shows only its controls. Footer (sticky): the 'Keeps' line (start frame, references, words, length, seed where the model can repeat it), a diff block ('Shot 3 camera: Static → Handheld'), a strength control where the sheet allows it (Keep close / Balanced / Reimagine), the model, a tickbox 'Also use this for future takes' (off by default), and 'Make new take' (primary, 44px).

**Interactions.**
- Camera: shows 'Made as a new take from the same start frame and references. The camera can't be changed on a finished clip.' On models that can't repeat a seed it adds 'Other details may change too.'
- A moment: drag a range on the scrub bar. It snaps to whole seconds, at least 2 s, and the snapped window is shown before sending. Draw a box on the paused frame, type the change, and optionally 'Preview the still first' (region_edit) before 'Make new take' (clip_patch).
- Blend with other clips: a Sources well (clips with in/out handles, plus images), then 'Use them as references' (available now) or 'Blend into one shot' (shown only once verified).
- The result lands as v(n+1) with the diff as its label, and Compare opens on parent against new.

### Bin (left column in both rooms)

One library: every take, upload and render exists once, and timeline clips point at it. This means the player can't play a stale take.

**Layout.** 280px wide. A 44px search field, then filter chips (In this film, Takes, Uploads, Renders, Images, Unused). Tiles sit in a 2-column grid (124px, 16:9 poster plus 2 lines, e.g. 'Box 2 · v3 · 3.5 s'), with badges 'In the cut' or 'New take ready'. A 44px 'Upload footage' button sits at the bottom. It is built as a new 'Footage' tab of AssetsDrawer.

**Interactions.**
- Drag a tile to any track in Edit, or to the Sources well or a ref slot in Make.
- Hover to scrub. Double-click to load the tile into the viewer.
- 'Show lineage' lists parent → this take → children, each with its change label.

### Edit room (timeline)

Cut like a normal editor. It never generates.

**Layout.** Bin on the left (280px). Centre: the Program viewer (784x441), with a 'Preview' or 'Rendered v n' label and transport (J/K/L, play, frame step, timecode in ad time), plus a fit badge ('Fits 10 s' / 'Over by 0.4 s'). Right: Inspector (376px). For a clip it shows the take with 'Change this…' and 'Swap take', In and Out, Speed (up to 1.33x), Fade in, Fade out, Transition in (Cut, Dissolve or Dip, up to 2 s) and Opacity on V2. For text it shows words, style, position and timing. Bottom: the timeline, full width, 300px tall (resizable 220-480). It has a 72px track-header column with lock and hide, a 32px ruler, and rows top to bottom: Notes (24), Text (40), V2 (56), a box bracket band (12), V1 main (72, magnetic) and Sound (32, a read-only summary: 'Sound is added in the Sound editor'). Clip blocks show a poster strip and their name on one line. Below 64px wide they show only a chip. Fade triangles sit on the top corners, and a dissolve is a bow-tie on the cut.

**Interactions.**
- Drag from the Bin onto a track. E appends to V1, and Q places on V2 at the playhead. 'Assemble first cut' fills V1 from the boxes in storyboard order, with the end card last.
- Drag a clip up to V2 or down to V1. A ghost shows where it will land, and it snaps to edges, the playhead and markers.
- Drag an edge to trim (ripple on V1 by default, Alt for no ripple). Dragging past the end of the footage shows 'Not enough footage. Make more?', which opens Change → Make it longer.
- Cmd/Ctrl+B or S splits at the playhead. Delete closes the gap, and Shift+Delete leaves it.
- Drag a fade triangle to fade. Click a cut and choose Cut, Dissolve 0.5 s or Dip to black.
- T adds text, and 'Captions from the script' fills the Text row. The end card is a locked V1 item edited in the Inspector.
- I/O marks a range, then 'Change this part…' opens the Change drawer over Edit, already mapped to take time.
- Right-click a clip for New take…, Change this part…, Change the feel…, Make more, Show takes (n), and Remove from cut. These are the same verbs as the drawer.

### New take ready sheet (Edit)

Bring a regeneration into the cut without losing trims, fades or position.

**Layout.** A 480px sheet anchored to the clip. Old and new sit side by side (224x126 each), with linked scrub over the clip's in/out window and the diff label. A length line ('Old window 1.5 s · new take has 1.4 s'). Buttons: 'Use this take' (primary), 'Keep both (on V2)' and 'Not now'. If the lengths differ: 'Hold the last frame' (default at 0.5 s or less), 'Fit the speed' (at most 1.33x) or 'Shorten the slot', which ripples and is never chosen silently.

**Interactions.**
- It opens only from the badge, never by itself.
- 'Use this take' changes only the source. Start, track, fades, transitions and the text above all stay.
- For a box made together it offers 'Use v3 for all 3 clips of this box'. Undo restores the old take.

## Flows

### (a) Generate one shot from its storyboard frame plus @cast refs

1. Make → click shot card 2 'Chops vegetables'. The Shot tab shows the start frame from the storyboard and the chips @Samurai and @Apron.
2. Set Movement to 'Push in' and length to 1.5 s (or the model's minimum, which pads with a hold). The model list is filtered by capabilities.ts (firstFrameWithRefs).
3. Make → clips.ts makeClip → relay op clip. The relay writes a generation record: kind clip, inputs, model, seed and the held request kept server-side.
4. v1 lands on the box's stack and as the Bin tile 'Shot 2 · v1'. The timeline doesn't change until it is placed.

### (b) Generate several shots as one video (a cut)

1. Select shots 1-3 and choose 'Make together'. The Box tab reads 'Made together · 3 shots · 5 s', with continuity options and only take-capable models (runs.ts limits of 6 shots and 15 s).
2. Make sends one generation (connected.py take or take_refs). take_cuts finds the real cuts, and the segments are stored on the record.
3. In Edit the box unpacks into three V1 clips that point at the same take with different windows, joined by a bracket. Each can be trimmed, faded or moved on its own.

### (c) Same video but the camera handheld

1. In Edit, select the shot 3 clip and choose 'Change this…' → Camera → Handheld. The drawer opens over Edit.
2. Diff: 'Shot 3 camera: Static → Handheld'. Note: 'Shot 3 was filmed with shots 1 and 2, so all three are remade; only shot 3's camera changes.' Keeps: start frame, references, words, length, seed (where the model can repeat it).
3. remakeWith(parent, delta) resends the held request with the patch and parent_id. v2 lands labelled 'Camera: handheld (shot 3)', and Compare opens.
4. The clip shows 'New take ready'. 'Use this take' offers 'for all 3 clips of this box', and in/out, fades and position are kept.

### (d) Keep the clip but at 0:06 change the colour of his shirt

1. In Edit, park at ad 0:06. The label reads 'Box 2 at 0:01 · ad 0:06' (shot 4, folding the shirt). Mark I/O, pause, and draw a box round the shirt.
2. 'Change this part…' → adTimeToSource maps the mark to take time. noteToTakeWindow snaps it to take 0:00-0:02, and the drawer shows 'Changes 0:00-0:02 of this take (shot 4 and the start of shot 5)'.
3. Type 'shirt deep red', optionally 'Preview the still first', then 'Make new take' → patch.ts fixRoute → clip_patch (Aleph 2 range, spliced back, same length, sound kept).
4. v3 is labelled 'Shirt red 0:00-0:02'. Swapping it in is exact, because a patch never changes length.

### (e) Combine clips and a product image into one video

1. In the Bin, select 'Shot 2 · v1' and 'Shot 5 · v2' plus the image 'SuperSamurai pack', then 'Make one video from these'. The Change drawer opens on Blend, with the Sources well holding each clip with in/out handles.
2. Choose 'Use them as references' (stills from start, middle and end, plus the pack, on refsWithoutFrame models) or, once verified, 'Blend into one shot' (clip_edit, stylised models only). Words: 'one move from the chopping board to the gleaming room, ending on the pack'.
3. The relay's staged op combine runs: cut windows and stills, an optional concat, clip or clip_edit, then land.
4. A generation of kind combine lands in the Bin under 'Not in a box'. Drop it on the timeline, or use 'Put in a box' to Direct it further.

### (f) Place, move up a track, trim, fade, dissolve, caption

1. 'Assemble first cut' lays V1 out as Box 1 (shots 1-3), Box 2 (shots 4-5) and the end card.
2. Drag 'Shot 5 · v2' (the tea close-up) to V2 over the end of shot 4. It plays over V1, and V1 doesn't move.
3. Trim the head of shot 2 by 0.2 s (ripple). Fade in shot 1 for 0.3 s from black. Put a 0.5 s dissolve between shot 5 and the end card.
4. T adds 'Clean like a samurai.' at 7.0-8.5 s as a Lower third. The Program viewer plays the compiled plan.

### (g) Regenerate one shot after editing and keep the edit

1. Shot 4 is trimmed (in 0.2) with a fade-out of 0.3. 'Change this…' → Words: 'folds the shirt in one swift move'. Editing carries on while 'Making v4' shows on the clip.
2. The badge appears, and the sheet compares old and new over the same window.
3. 'Use this take' maps in/out through shot 4's segment in v4. If it is 0.3 s shorter, Hold the last frame is the default. Undo restores v3.

### (h) Render the ad

1. Press 'Render ad'. Jude's checks list issues that don't block the render ('2 cuts may jump', 'Dissolve needs 0.5 s more footage'), each with 'Show me'.
2. compileTimeline(doc) builds one plan (V1, V2, fades, transitions, text PNGs, end card) → relay op stitch in timeline mode, free and internal.
3. Render v1 lands in Bin → Renders, and the viewer switches to 'Rendered v1'. If there is no sound yet: 'This render has no sound yet. Open Sound to add it.'

## Reused

- production-tool/stitch/stitch.py (build_command :348, XFADE :63, fit_windows :318, seam_scores :446): becomes the Edit renderer, extended with per-item fades, a V2 overlay and text.
- production-tool/stitch/cutdown.py: merge its timed PNG overlay and crop path into stitch, so the master and sizes share one graph.
- production-tool/stitch/splice.py (cut :129, take_cuts :243, splice :478, land :278): patch, unpacking boxes, frame grabs, and cutting the windows for combine.
- production-tool/relay/service.py stage machine (:1260-1274) and op flags (:851-868): host the new combine and extend ops.
- production-tool/relay/providers/runway.py _clip :349, _clip_edit :406: unchanged builders, except videos[] where a model accepts several clips.
- production-tool/relay/connected.py take/take_refs/redo_window: 'Make together' and 'Redo part'.
- production-tool/contracts/capabilities/runway.json + web/src/capabilities.ts: drive every Make and Change control.
- web/src/jobs/clips.ts remakeAsFinal :226 (the template for remakeWith), makeClip :75, makeTake :117, changeFeel :195. stitchInput :244 is replaced by compileTimeline.
- web/src/jobs/patch.ts fixRoute :41 + clan-store/src/patch.ts noteToTakeWindow :48, applyPatchTake :204: mounted as 'A moment'.
- web/src/jobs/runs.ts planRuns :180, takeTiming.ts, joins.ts, runView.ts: the box planner in Make.
- web/src/stages/Video.tsx Player (note and box drawing), ShotCard, ShotMenu; VideoStrips.tsx becomes the Boxes strip; videoEdits.ts addTakeNote.
- web/src/stages/ImageEditor.tsx Compare :528 and EditTray: the Compare and diff patterns.
- web/src/ui/assets/AssetsDrawer.tsx + jobs/assets.ts + relay/library.py: the Bin as a 'Footage' tab.
- web/src/campaign/film.ts captionLayers :251, TypeEditor.tsx, relay/typeset.py: the Text row and the end card.
- web/src/canvas/nodes/cards.tsx VideoCard :159: the canvas entry. stack.ts/provenance.ts can later show takes on the canvas.
- features/audio-mix.clan graph: design the picture fades in the same per-input graph.
- docs/production-tool/ui-behaviour.md 3.13: rewrite as 3.13 Make and 3.13b Edit.

## New

- Phase 0 (no contract change, ships now on a fix/ branch): card tokens (radius 12, padding 12, 2-line clamp with tooltip, 44px minimum) applied to Video.tsx and VideoStrips.tsx, a persistent Back button in every editor's top bar, and the patch.ts mount.
- Contract: a generation record in document.schema.json (id, kind clip|together|change|patch|feel|combine|extend|upload|render, parent_id, delta[{field,from,to}], inputs, box_id, shot_ids, segments[{shot_id,in_s,out_s,by}], patched[], asset, state, job_id). The full held request stays server-side with the job. One migration of existing takes, with no shim.
- Contract: video.timeline replaces video.edl (tracks V1 magnetic, V2, text; items with start_s, source {generation_id|asset, in_s, out_s}, follows {box_id, shot_id}, fades, transition_in, speed at most 1.33, opacity, text; end_card). size.edl reads V1.
- Make room shell: the top bar, Boxes strip, takes stack, Compare (side by side and wipe), the Shot/Box/Change tabs and the Film look.
- The Change drawer component plus a remakeWith(parentId, delta) job. Old takes stop going stale (stale.ts markShotEdit).
- adTimeToSource in clan-store, twinned in relay/time_rules.py.
- Edit room: the timeline component, the Inspector, Assemble first cut, the undo stack and keyboard shortcuts.
- compileTimeline, shared by the preview and the render. A browser compositor (pooled video elements drawn to a canvas) plus a free Draft render.
- stitch timeline mode: fades, a V2 overlay with alpha, text layers and the end card.
- The New take ready sheet and the swap rule (hold, fit or shorten; 'use for all clips of this box').
- Relay ops combine and extend, and capability facts videosMax, extend and cameraRef.
- Feature record features/make-and-edit.clan on feat/make-and-edit. It supersedes the edit parts of connected-video and video-stage-findings, and audio-mix is designed alongside it. Phases: P0 polish; P1 generation record, Bin, Make room, Change (camera, words, moment), Compare; P2 Edit V1 + Text + end card, compiler, preview, stitch timeline mode, swap; P3 V2, ad-time marks, extend; P4 combine, upload, Sound row, EDL/XML export.

## Risks

- No Runway model is confirmed to change camera movement on a finished clip, so 'handheld' is always a new take, and the copy must never say 'same clip'.
- Several-video input to a v2v model is not confirmed. Ship 'Use them as references' first, and verify 'Blend' with one paid test within the $50 stop and never on the owner's live relay.
- Kling, Hailuo and Omni can't repeat a seed, so a minimal change can drift. Say so, and prefer Veo or Seedance for small changes.
- Changing one shot inside a box remakes the whole box, which costs more and may shift the other shots. Make this visible and offer 'Make this shot apart'.
- Aleph 2 windows are whole seconds, at least 2 s, so a 1.5 s shot can't be patched alone. Show the snapped window before sending.
- The preview can drift from the render. Mitigate with one compiler, text from the same PNGs, a frame-hash parity test and visible Preview/Rendered labels.
- Contract churn across clan-store, film.ts sizes, stitch and jobs/*.ts. Ship the contract first with one migration, and freeze the in-flight video UI work.
- Scope creep towards a full NLE. Hold v1 to V1, V2, Text, a Sound summary, trims, split, ripple, fades and dissolve/dip.
- Silent renders until audio-mix lands. Say it plainly.

## Decisions (recommended answers, approved)

- Where 'Change this…' opens from Edit: a drawer over Edit, or a jump to the Make room? Recommend: a drawer over Edit (the same component as Make's Change tab), so the cut stays in view, with 'Open in Make' for deeper work.
- Should the rooms live in the Video editor or should generation move onto the canvas as Generate nodes? Recommend: rooms in the Video editor now, opened from the canvas Video node with Back returning to it. Show takes as canvas stacks later, as an option.
- Changing one shot inside a box made together remakes the whole box. Recommend: yes by default, with the note shown before sending and a 'Make this shot apart' alternative.
- Default when a swapped take is a different length. Recommend: hold the last frame at 0.5 s or less, otherwise ask. Never ripple without asking.
- Replace video.edl with video.timeline, and shot-bound takes with generation records, in one migration with no shim. Recommend: yes, contract first, owner-approved before any UI build.
- Where the held request lives. Recommend: the full request server-side on the job and generation record, with the inputs summary and delta in the document, so 'Change this' works on any device.
- Feature ownership. Recommend: open features/make-and-edit on feat/make-and-edit, supersede the edit parts of connected-video and video-stage-findings, freeze their UI work, and design audio-mix's graph alongside it.
- Phase 0 polish (card tokens, clamped text, Back button, mounting patch.ts). Recommend: ship it now on a fix/ branch, without waiting for the contract.
- Blend of real clips into one shot. Recommend: ship 'Use them as references' first, and enable 'Blend into one shot' only after one paid test confirms several-video input (within the $50 stop, not on the live relay).
- Old takes going stale when shot settings change. Recommend: remove staleness, so takes keep their lineage and changes apply only to the next take unless 'Also use for future takes' is ticked.
- Editor scope for v1. Recommend: V1, V2, Text, a Sound summary, trims, split, ripple, fades and dissolve/dip only. Grading, keyframed transforms and more tracks come later.
- Preview fidelity. Recommend: a browser compositor from the same compiled plan plus a free 'Draft render', with the viewer always labelled Preview or Rendered.

## Mock-up board specs

### Make room: boxes, Direct, takes and Compare (MakeRoom.dc.html)

Interactive 1440x980 mock-up of the Make room. No real video: posters are flat colour panels with a large shot label and a simulated playhead (a timecode that ticks while 'playing'). Fonts: UI sans plus Geist Mono for timecodes. Tokens: card radius 12, clip radius 8, padding 12, 1px border, every control at least 44px, and titles clamped to 2 lines with a title tooltip. No prices anywhere. British English.

SAMPLE FILM 'SuperSamurai: Clean Sweep', 10 s: shot 1 'Puts on apron in a messy room' 2 s; shot 2 'Chops vegetables' 1.5 s; shot 3 'Sweeps the floor' 1.5 s; shot 4 'Folds a shirt' 1.5 s; shot 5 'Tea, the room gleams' 2 s; shot 6 'End card: SuperSamurai' 1.5 s. Box 1 = shots 1-3 made together (5 s, takes v1 and v2). Box 2 = shots 4-5 made together (3.5 s, takes v1 and v2). Shot 6 is the editable end card (not generated), shown as a grey 'Card' tile with 'Edit in Edit room'.

REGIONS. Top bar 0-56px: Back '‹ Canvas' 44x44 at x16; film name 'SuperSamurai: Clean Sweep'; centred segmented control 'Make | Edit' (120x44 each, Make active); right side Jobs pill '1 making', 'Open Sound', and primary 'Go to Edit'. Left Bin x0-280, y56-980: search field 44px; chips In this film / Takes / Uploads / Renders / Images / Unused; 2-column tiles 124px wide: 'Box 1 · v2 · 5 s', 'Box 1 · v1 · 5 s', 'Box 2 · v2 · 3.5 s', 'Box 2 · v1 · 3.5 s', image 'SuperSamurai pack', image 'Samurai front' (@Samurai), image 'Apron' (@Apron). Badge 'In the cut' on Box 1 v2 and Box 2 v2. 'Upload footage' button at the bottom. Centre x280-1064: player 784x441 at y72 with scrub bar, play button, timecode 'Box 1 · v2 · 0:00.0 / 0:05.0' and a 'Compare' button. Below it, the Boxes strip at y540: a 'Film look' chip, then Box 1 card (border = one generation, header 'Box 1 · Made together · 5 s' and a 'Make' button) containing shot cards 1, 2 and 3 (thumb 96x54, a 2-line title, a camera chip such as 'Wide · Static'), separated by vertical cut lines with a small scissors icon. Then Box 2 card (shots 4 and 5), then the end card tile, then a dashed '+ New box'. Under each box, a takes stack of thumbnails (newest first) with labels: Box 1 'v2 · Camera: push in (shot 2)', 'v1 · First take'; Box 2 'v2 · Words: swifter fold', 'v1 · First take'. Right panel x1064-1440: tabs Shot | Box | Change (each 44px).

STATES AND CLICKS. 1) Default: Box 1 v2 is loaded in the player and shot 2 is selected. The Shot tab shows: Camera size [Close · Medium · Wide], Angle [Eye level · High · Low], Movement picker (Static, Pan, Tilt, Push in, Pull out, Track, Orbit, Handheld, Crane, Drone) with 'Push in' selected; Start frame well (168x94, storyboard frame) and End frame well, greyed with the reason 'This model can't end on a set frame when shots are made together'; Cast & look chips '@Samurai' and '@Apron' plus '+ Add' (shows 'Up to 4 for this model'); Length 1.5 s with a speed slider. 2) Clicking another shot card switches the Shot tab to it. 3) Changing Movement to Handheld on shot 3 shows a header banner 'Next take differs: shot 3 camera Handheld' and turns the box's button into 'Make new take'. The old takes are NOT dimmed or marked stale. 4) Clicking the box border opens the Box tab: 'Made together' or 'Made apart' toggle, Continuity [Same place and light · Free], Model list (Seedance 2.5, Omni Flash 1.1, WAN 3; Veo 3.1 greyed with 'Can't make several shots as one video'), and a limits line 'Up to 6 shots or 15 s together'. 5) Clicking 'Make' on Box 1: the Jobs pill becomes '2 making', and a placeholder v3 with a spinner and the state 'Making' appears on top of Box 1's stack. After 4 s it becomes 'v3 · Camera: handheld (shot 3)' and a toast reads 'New take ready for Box 1'. 6) Ticking two takes and pressing 'Compare' splits the player into A | B (each 388x218) with one shared scrub bar, a 'Wipe' toggle that merges them into one frame with a draggable divider, labels under each, and buttons 'Make v3 the top take' and 'Close'. 7) Right-clicking a take opens a menu: 'New take with a change…' (switches to the Change tab, prefilled with parent 'Box 1 · v2'), 'Add to edit', 'Show lineage' (a popover: v1 → v2 'Camera: push in (shot 2)' → v3). 8) Clicking 'Edit' in the top bar or 'Go to Edit' shows a note 'Opens the Edit room (see EditRoom board)'. 9) Back shows the note 'Back to the canvas Video node'. 10) Clicking the 'Film look' chip opens a small panel: words field 'warm morning light, clean whites' and 'Apply to all boxes (new takes)'. Every truncated text shows its full text on hover.

### Edit room: timeline, tracks, fades and the new take swap (EditRoom.dc.html)

Interactive 1440x980 mock-up of the Edit room for the same 10 s SuperSamurai film: shot 1 apron in a messy room 2 s, shot 2 chops vegetables 1.5 s, shot 3 sweeps the floor 1.5 s, shot 4 folds shirt 1.5 s, shot 5 tea while the room gleams 2 s, shot 6 end card SuperSamurai 1.5 s. Same tokens as MakeRoom. Clips are colour blocks with poster-strip stripes. The timeline is drawn with DOM or SVG; 1 s = 100px at default zoom.

REGIONS. Top bar 56px: '‹ Canvas', film name, 'Make | Edit' with Edit active, Jobs pill, 'Open Sound', primary 'Render ad' (136x44). Bin x0-280 (as in MakeRoom, Renders chip shows 'No renders yet'). Program viewer x280-1064: 784x441 with the label 'Preview' top-left and a fit badge 'Fits 10 s' top-right; transport row 48px with frame back, play, frame forward, timecode 'ad 0:00.0 / 0:10.0' and a second label 'Box 1 at 0:00.0'. Inspector x1064-1440. Timeline y560-980 (420px for the mock-up, the build default is 300): a toolbar 44px [Select, Split (S), Ripple on, Snap on, + Text (T), 'Captions from the script', Zoom – / +]; track headers 72px wide with lock and eye toggles; ruler 32px labelled 0:00…0:10; rows Notes 24, Text 40, V2 56, bracket band 12, V1 72, Sound 32 reading 'Sound is added in the Sound editor · Open Sound'.

INITIAL V1: a button 'Assemble first cut' sits in the empty V1. Clicking it fills V1: S1 0-2, S2 2-3.5, S3 3.5-5 (all from 'Box 1 · v2', with a bracket above them labelled 'Box 1 · made together'), S4 5-6.5, S5 6.5-8.5 (bracket 'Box 2'), End card 8.5-10 (locked padlock icon, label 'SuperSamurai'). Each clip shows its name on one line ('Shot 2 · Chops vegetables' becomes 'Shot 2 · Chops…' when narrow). Below 64px wide it shows only a numbered chip.

INTERACTIONS. 1) Click a clip: it is selected with a 2px outline, and the Inspector shows Source 'Box 1 · v2 · shot 2', buttons 'Change this…' and 'Swap take', In 0.0 / Out 1.5, Speed 1.00x, Fade in 0, Fade out 0, Transition in [Cut | Dissolve | Dip to black] with length, and on V2 also Opacity. 2) Drag a clip horizontally on V1: it reorders magnetically and the others slide, with a ghost and snap lines. 3) Drag 'Shot 5' up to V2: it sits over 6.0-8.0 on V2, the Inspector says 'Track: V2 (over)', and with ripple on V1 closes the gap so the fit badge updates to 'Fits 8 s · 2 s short' (any honest arithmetic). Drag it back down to restore. 4) Drag S2's left edge right by 0.2 s: a tooltip 'In 0:00.2 · −0:00.2' appears and the clips after it ripple. Alt-drag trims without ripple and leaves a hatched gap. 5) Drag past the media end of S4's right edge: a popover 'Not enough footage. Make more?' with 'Make more' (note: opens Change → Make it longer) and 'Cancel'. 6) Fade triangles: dragging S1's top-left corner sets 'Fade in 0.3 s' (shown as a shaded wedge). 7) Click the cut between S5 and the End card: a popover offers [Cut, Dissolve, Dip to black] and a length of 0.5 s; choosing Dissolve draws a bow-tie. If there isn't enough handle footage, show 'Not enough footage after the cut for a dissolve. Trim 0.5 s first?'. 8) Put the playhead at 4.0 and press S or 'Split': S3 splits into two clips. Delete removes one and closes the gap, and Shift+Delete leaves a gap. 9) + Text or T: a text clip 'New text' 3 s appears on the Text row at the playhead. Its Inspector has words ('Clean like a samurai.'), style [Lower third · Centre title · Caption] and timing 7.0-8.5. The viewer draws the text over the frame. 'Captions from the script' fills 2 sample caption blocks. 10) Click the End card: the Inspector shows editable fields Headline 'SuperSamurai', Line 'Clean in one sweep', a Logo slot and Length 1.5 s locked last. 11) Play: the playhead moves across, the viewer shows the colour of whichever block is under it, V2 over V1, text at its times, and a crossfade blend at the dissolve. The label stays 'Preview'. 12) 'Change this…' or right-click → 'Change this part…' slides in a 480px drawer from the right over the Inspector, titled 'Change: Box 1 · v2' (contents: see ChangeTake board; here show a stub with a 'Make new take' button). Pressing it puts a 'Making v3' spinner on the clip, editing still works, and after 4 s a 'New take ready' badge appears on the clip and its Bin tile. 13) Clicking the badge opens the New take ready sheet (480px, anchored above the clip): old and new posters (224x126) with a linked scrub, label 'Camera: handheld (shot 3)', a length line 'Old window 1.5 s · new take has 1.3 s for this shot', a radio [Hold the last frame (default) · Fit the speed (1.15x) · Shorten the slot], buttons 'Use this take', 'Keep both (on V2)', 'Not now', and a tickbox 'Use v3 for all 3 clips of Box 1' (on). 'Use this take' updates the clip labels to v3 and keeps the trim, fades and dissolve. Cmd/Ctrl+Z reverts. 14) Right-click any clip: a menu with New take…, Change this part…, Change the feel…, Make more, Show takes (2), Remove from cut. 15) Render ad: a checks sheet titled 'Jude checked the cut' with lines '1 cut may jump: Shot 3 → Shot 4 · Show me' and 'Dissolve has enough footage ✓', and buttons 'Render ad' / 'Back to the cut'. Rendering shows a progress state, then the viewer label reads 'Rendered v1', a Bin Renders tile 'Render v1 · 0:10' appears, and a banner reads 'This render has no sound yet. Open Sound to add it.'

### Change a take: handheld, shirt at 0:06, combine clips (ChangeTake.dc.html)

Interactive 1440x980 board that walks through the three regenerate-with-change cases in the Change drawer, shown over a dimmed Edit room. Same film, tokens and rules (no prices, British English, 44px targets). Left 900px: the dimmed Edit room context (viewer plus timeline thumbnails, non-interactive except clip selection). Right x960-1440: the 480px Change drawer. A scenario switcher at the top of the board (outside the product frame, labelled 'Scenario') has three 44px pills: 'Same video, handheld', 'Shirt colour at 0:06', 'Combine clips'.

DRAWER ANATOMY (shared). Header 56px: 'Change: <parent>' and a close X (44x44). Source player 432x243 with scrub bar and a dual readout in Geist Mono ('Box 1 at 0:03.5 · ad 0:03.5'). A verb list of 48px rows: Camera, Words, Cast & look, A moment, The whole feel, Make it longer, Blend with other clips. The chosen row expands; the others collapse. Sticky footer: a Keeps line, a diff block, the model select, a tickbox 'Also use this for future takes of this shot' (off), and 'Make new take' (primary).

SCENARIO 1 'Same video, handheld'. The parent is 'Box 1 · v2 · 5 s' (shots 1-3: apron in messy room 2 s, chops vegetables 1.5 s, sweeps floor 1.5 s) and the selected clip is shot 3. Camera row expanded: a Shot selector (1 | 2 | 3 with 3 active) and Movement chips with 'Static' current; clicking 'Handheld' highlights it, shows 'was: Static', and a strength line is hidden for this verb. Info note: 'Made as a new take from the same start frame and references. The camera can't be changed on a finished clip.' A second note: 'Shot 3 was filmed with shots 1 and 2, so all three are remade. Only shot 3's camera changes.' with a link button 'Make shot 3 apart instead'. Model select: Seedance 2.5 (keeps the seed) default; choosing Omni Flash 1.1 adds 'This model can't repeat the take exactly, so other details may differ.' Keeps: 'Start frame · References @Samurai @Apron · Words · Length 5 s · Seed'. Diff: 'Shot 3 camera movement: Static → Handheld'. Clicking 'Make new take' shows a making state (a progress bar, 'Making v3…', and 'You can keep editing' with no prices), then a Compare panel inside the drawer (v2 | v3 side by side, 208x117 each, linked scrub, a Wipe toggle) and buttons 'Use this take' / 'Keep both (on V2)' / 'Not now'.

SCENARIO 2 'Shirt colour at 0:06'. The parent is 'Box 2 · v2 · 3.5 s' (shot 4 folds shirt 1.5 s, shot 5 tea and the room gleams 2 s). The readout shows 'Box 2 at 0:01.0 · ad 0:06.0'. 'A moment' row expanded: a mini scrubber of the 3.5 s take with a draggable range. Initially the user's mark is 0:00.8-0:01.2, and the drawer shows the snapped window as a solid band at 0:00-0:02 with the text 'Changes take 0:00-0:02 (whole seconds, at least 2 s): shot 4 and the first 0.5 s of shot 5'. Box tool: the user can drag a rectangle on the paused frame (pre-draw one around a shirt-shaped area). Field 'What should change here?' prefilled 'his shirt is deep red'. Button 'Preview the still first' shows, after 2 s, an edited still at 0:01 (the same poster with a red rectangle region) with 'Looks right' / 'Try again'. Keeps: 'Everything outside 0:00-0:02 · Sound · Length 3.5 s'. Diff: 'Shirt red 0:00-0:02'. Note: 'A change to part of a clip takes a few minutes.' 'Make new take' → making → Compare with the patched span outlined on both scrubbers → 'Use this take' shows the result line 'Same length, so nothing in your cut moves.'

SCENARIO 3 'Combine clips'. Entry: on the left, the Bin shows multi-select ticks on 'Shot 2 · Chops vegetables (Box 1 v2)', 'Shot 5 · Tea, room gleams (Box 2 v2)' and image 'SuperSamurai pack', with the button 'Make one video from these'. The drawer opens with 'Blend with other clips' expanded: a Sources well listing each clip (poster 120x68, an in/out handle bar: Shot 2 0:02.0-0:03.5, Shot 5 0:01.5-0:03.5) and the image as '@Pack'. Each row has a remove X (44px) and '+ Add from Bin'. A 'How to use these' choice: 'Use them as references (new motion, keeps people and things)', enabled and default, or 'Blend into one shot (keeps the motion, stylised looks only)', disabled with the tag 'Not checked on Runway yet'. Words: 'one move from the chopping board to the gleaming room, ending on the pack'. Length 4 s within the model range. The model list shows only models that take refs without a frame (Seedance 2.5, Omni Flash 1.1, WAN 3, Hailuo 3). Keeps: '@Pack · stills from both clips'. 'Make new take' → making → the result card 'Combined · 4 s · Not in a box' with buttons 'Add to edit', 'Put in a box', 'Compare with sources'. 'Add to edit' adds a tile to the dimmed timeline's V2 at the playhead.

GLOBAL. Esc closes the drawer. Each scenario has a 'Reset' link. Every truncated label has a hover tooltip. No text touches the rounded edges.
