# Dex audit — round 0 (code read, 2026-11-21, spike/acne-stena-demo)

Paths relative to production-tool/.

## Shape
- web runner.submit adds linked-note text + brief spine (BRIEF_OPS) → relay _submit → _direct: fit_refs → Haiku cards (6 s) → to_wire → Director.run (sonnet-5-5, director.v14, 20 s timeout) → _check → on any failure: PASSTHROUGH (user words verbatim). shot_list has no fallback.
- Dex sees pixels only for frame_edit and clip_patch. Everything else: names/roles/labels/cards.
- Dex never picks the provider model (relay: modelChoice > sheet default > first allowed alternate; director model overwritten). Joined shots: web boxModel / planRuns → WAN 3.
- upscale/resize/cutdown always passthrough; stitch no Dex.

## Gaps (what Dex could/should get)
1. input.context never filled (types.ts:1118) though director.v14 has a section → linked docs, brand rules dropped.
2. namedInput drops swatches/font/rule → palette, typography, brand rules never reach Dex.
3. Audio always off (providers/types.py:335 video_audio False; director.py:605) → "Veo with sound" for spoken shots never happens; VO/line beats stripped.
4. Veo clip with a frame: all refs dropped, character → "the character" (director.py:167-174).
5. Veo clip with no frame + character: refused (director.py:158,692), passthrough same error.
6. Clips get no script, scene, neighbour takes/frames. Frames get script[:600] not the shot's scene; scene_id/prose never sent.
7. Brief cut per op (frame 360, clip 300, frame_edit 240); generate/view/region_edit never get brief.
8. Dex never sees anchor/previous frame pixels, sketches, drawings; no cards for them.
9. Unnamed drawing/generated image sent as role character → Runway subject:human even for products (controller.ts:461).

## Limits
- Runway images 14 refs, ≤5 characters; adapter refuses >9 non-character refs (runway.py:40,308) — disagrees with sheet 14.
- Canvas allows 14 characters, Runway 5.
- region_edit masked: current + max 4 other refs, silently cut (runway.py:201).
- Passthrough clip prompt action(600)+text(1000) never truncated (director/base.py:164) → over Veo 1000 → job fails.
- Required ref cut → _hold_refs refuses → passthrough.

## Joining shots (owner: "joining two shots doesn't work")
1. Joined take lands outside the cut (jobs/wire.ts:38,46; handlers.ts:222); Edit renders only video.timeline; "Add to edit" appends at end; only "Assemble first cut" rebuilds (loses manual edits). LIKELY ROOT CAUSE.
2. "follows image k" uses shot number but refs are characters-first and untagged (connected.py:173; runway.py:384; clips.ts:179) → wrong image indices.
3. Legacy renderAd path drops `fit` (service.py:2801) → trims instead of retime.
4. Legacy joinInto never sends `continue` (clips.ts:321) → shared frame twice; dip_white becomes black.
5. Take duration: web ceil(sum) vs relay fit_duration with model minimums (Seedance 4 s, Omni 3 s) → wrong windows.
6. Veo can't take; spoken/product/type/end-card shots never join (runs.ts:213-230) — explain in UI.

## Logging gaps
- Real Runway request body never logged (runway.py:479); no submit log with task id (service.py:1716); no stage timings (queue/provider/fetch); metrics/record off unless env; Director.run passes no job id headers (director.py:598); rejected Dex answer not kept (160 chars only); dogfood events need flags.dogfood (on in UAT config).
